import { MODULE_ID } from "../core/constants.js";
import { parseDeclarationJson } from "../declarations/json-data.js";

const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function addLineNumbers(textarea) {
  const document = textarea.ownerDocument;
  const wrapper = document.createElement("div");
  wrapper.className = "ae5e-json-editor";
  const gutter = document.createElement("pre");
  gutter.className = "ae5e-json-line-numbers";
  gutter.dataset.lineNumbers = "";
  gutter.setAttribute("aria-hidden", "true");
  textarea.before(wrapper);
  wrapper.append(gutter, textarea);
  textarea.wrap = "off";
  // Match the installed theme's text metrics and vertical inset, so line
  // numbers remain aligned even when Foundry overrides native textarea styles.
  const style = globalThis.getComputedStyle(textarea);
  for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
    "paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]) gutter.style[key] = style[key];
  let previousCount = 0;
  const update = () => {
    const count = textarea.value.split("\n").length;
    if (count !== previousCount) {
      gutter.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
      wrapper.style.setProperty("--ae5e-json-gutter-width", `${Math.max(3, String(count).length) + 2}ch`);
      previousCount = count;
    }
    gutter.scrollTop = textarea.scrollTop;
  };
  textarea.addEventListener("input", update);
  textarea.addEventListener("scroll", () => { gutter.scrollTop = textarea.scrollTop; });
  update();
  return { update };
}

/** Exported mount keeps draft behavior testable independently of Foundry's dialog host. */
export function mountItemOptionsEditor(root, { draft, authoring, onSave, onCancel, onBusy = () => {} }) {
  root.innerHTML = `
    <div class="ae5e-cat-options-editor">
      <strong>${escape(draft.document.name)} — Item Options</strong>
      <div class="ae5e-cat-options-context">
        <span>Identifier: ${escape(draft.document.system?.identifier || "—")}</span>
        <span>Ruleset: ${escape(draft.document.system?.source?.rules || "—")}</span>
        <span>CAT version: ${escape(draft.document.flags?.cat?.automation?.version || "Not published")}</span>
      </div>
      <nav class="ae5e-options-tabs" aria-label="Item Options">
        <button type="button" data-options-tab="cat" aria-pressed="true">CAT Configuration</button>
        <button type="button" data-options-tab="declarations" aria-pressed="false">AE5E Declarations</button>
      </nav>
      <section data-options-panel="cat" class="ae5e-cat-options-data-block">
        <label>CAT Configuration Data
          <textarea data-options-configuration rows="25" spellcheck="false"></textarea>
        </label>
        <p>Control definitions are stored in <code>flags.action-effects-5e.cat.configSchema</code>.
          Installed preferences remain in <code>flags.cat.config.*</code>.</p>
      </section>
      <section data-options-panel="declarations" hidden>
        <div class="ae5e-declaration-add">
          <label>Family <select data-declaration-family></select></label>
          <label>Template / role <select data-declaration-template></select></label>
          <label>New / duplicate ID <input data-declaration-id type="text" spellcheck="false" placeholder="unique-id"></label>
          <button type="button" data-declaration-add>Add Declaration</button>
        </div>
        <div class="ae5e-declaration-layout">
          <aside data-declaration-list aria-label="Declarations by family"></aside>
          <div class="ae5e-declaration-detail">
            <p data-declaration-destination>Select a declaration, or add one from a registered family.</p>
            <label>Declaration JSON <textarea data-declaration-json rows="25" spellcheck="false" disabled></textarea></label>
            <div class="ae5e-cat-metadata-actions">
              <button type="button" data-declaration-duplicate disabled>Duplicate</button>
              <button type="button" data-declaration-remove disabled>Remove Declaration</button>
            </div>
          </div>
        </div>
        <p data-declaration-preserved></p>
      </section>
      <div class="ae5e-cat-metadata-status" data-options-status role="status" aria-live="polite"></div>
      <div class="ae5e-cat-metadata-actions">
        <button type="button" data-options-validate>Validate All</button>
        <button type="button" data-options-cancel>Cancel</button>
        <button type="button" data-options-save>Save All Changes</button>
      </div>
    </div>`;
  const find = selector => root.querySelector(selector);
  const configuration = find("[data-options-configuration]");
  const familySelect = find("[data-declaration-family]");
  const templateSelect = find("[data-declaration-template]");
  const idInput = find("[data-declaration-id]");
  const recordEditor = find("[data-declaration-json]");
  const destination = find("[data-declaration-destination]");
  const status = find("[data-options-status]");
  const list = find("[data-declaration-list]");
  let selected = null;
  let busy = false;
  const show = (message, error = false) => { status.textContent = message; status.dataset.kind = error ? "error" : "success"; };
  const guard = action => {
    if (busy) return;
    try { action(); } catch (error) { show(error.message, true); }
  };
  configuration.value = draft.configurationText;
  addLineNumbers(configuration);
  const recordLines = addLineNumbers(recordEditor);
  configuration.addEventListener("input", () => { draft.configurationText = configuration.value; });
  familySelect.innerHTML = draft.families.map(group => `<option value="${escape(group.family.id)}">${escape(group.family.label)}</option>`).join("");
  const templates = () => {
    const group = draft.families.find(group => group.family.id === familySelect.value);
    templateSelect.innerHTML = (group?.family.templates ?? []).map(template => `<option value="${escape(template.id)}">${escape(template.label)}</option>`).join("");
    find("[data-declaration-add]").disabled = !group || group.blocked || !group.family.templates.length;
  };
  familySelect.addEventListener("change", templates);
  templates();
  const renderList = () => {
    list.innerHTML = draft.families.filter(group => group.rows.length).map(group => `
      <section><strong>${escape(group.family.label)}</strong>${group.rows.map(row => {
        const parsed = parseDeclarationJson(row.text);
        return `<button type="button" data-family="${escape(group.family.id)}" data-row="${row.key}"
          aria-pressed="${selected?.key === row.key}">${escape(parsed.data?.id ?? "Invalid JSON")}</button>`;
      }).join("")}</section>`).join("") || "<p>No declarations. Opening this tab creates nothing.</p>";
    for (const button of list.querySelectorAll("[data-row]")) {
      button.addEventListener("click", () => guard(() => select(button.dataset.family, button.dataset.row)));
    }
  };
  const updateDestination = () => {
    if (!selected) return;
    const group = draft.group(selected.family);
    const row = group.rows.find(row => row.key === selected.key);
    const id = parseDeclarationJson(row.text).data?.id;
    destination.textContent = `${group.family.label} / ${id ?? "invalid record"} — ${group.family.flagPath}`;
    // Keep the row node in place while editing. Rebuilding the list on blur
    // removes the pointer-down target before the browser can deliver its click.
    const button = list.querySelector(`[data-row="${selected.key}"]`);
    if (button) button.textContent = id ?? "Invalid JSON";
  };
  const select = (family, key) => {
    const row = draft.group(family).rows.find(row => row.key === key);
    selected = row ? { family, key } : null;
    recordEditor.value = row?.text ?? "";
    recordLines.update();
    recordEditor.disabled = !row;
    find("[data-declaration-duplicate]").disabled = !row;
    find("[data-declaration-remove]").disabled = !row;
    if (row) updateDestination();
    else destination.textContent = "Select a declaration, or add one from a registered family.";
    renderList();
  };
  recordEditor.addEventListener("input", () => guard(() => {
    if (!selected) return;
    draft.edit(selected.family, selected.key, recordEditor.value);
    updateDestination();
  }));
  find("[data-declaration-add]").addEventListener("click", () => guard(() => {
    const row = draft.add(familySelect.value, idInput.value.trim(), templateSelect.value);
    select(familySelect.value, row.key);
  }));
  find("[data-declaration-duplicate]").addEventListener("click", () => guard(() => {
    if (!selected) return;
    const row = draft.duplicate(selected.family, selected.key, idInput.value.trim());
    select(selected.family, row.key);
  }));
  find("[data-declaration-remove]").addEventListener("click", () => guard(() => {
    if (!selected) return;
    const family = selected.family;
    draft.remove(family, selected.key);
    select(family, draft.group(family).rows[0]?.key);
  }));
  const preserved = draft.families.filter(group => group.blocked).map(group => `${group.family.label}: ${group.issues.join(" ")}`);
  preserved.push(...draft.collections.discover([draft.document]).diagnostics.filter(entry => entry.message.startsWith("Unknown declaration family")).map(entry => `${entry.family}: ${entry.message}`));
  find("[data-declaration-preserved]").textContent = preserved.join("\n");
  for (const button of root.querySelectorAll("[data-options-tab]")) {
    button.addEventListener("click", () => {
      for (const tab of root.querySelectorAll("[data-options-tab]")) tab.setAttribute("aria-pressed", String(tab === button));
      for (const panel of root.querySelectorAll("[data-options-panel]")) panel.hidden = panel.dataset.optionsPanel !== button.dataset.optionsTab;
    });
  }
  find("[data-options-validate]").addEventListener("click", () => guard(() => {
    const result = draft.validate();
    show(result.valid ? "All editable declarations and changed CAT configuration are valid." : result.issues.join("\n"), !result.valid);
  }));
  find("[data-options-cancel]").addEventListener("click", () => { if (!busy) onCancel(); });
  find("[data-options-save]").addEventListener("click", async () => {
    if (busy) return;
    const validation = draft.validate();
    if (!validation.valid) { show(validation.issues.join("\n"), true); return; }
    busy = true;
    onBusy(true);
    const disabledBefore = new Map([...root.querySelectorAll("button, input, select, textarea")].map(control => [control, control.disabled]));
    disabledBefore.forEach((_value, control) => { control.disabled = true; });
    show("Saving all Item Options…");
    try { await onSave(await authoring.save(draft)); }
    catch (error) { show(error.message, true); }
    finally { busy = false; onBusy(false); disabledBefore.forEach((disabled, control) => { control.disabled = disabled; }); }
  });
  renderList();
  return { select, get selected() { return selected; } };
}

export async function openItemOptionsEditor(document, { authoring, onSaved = async () => {} }) {
  const draft = authoring.createDraft(document);
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2) throw new Error("Foundry DialogV2 is unavailable; Item Options cannot open.");
  let finish;
  let settled = false;
  let saving = false;
  const result = new Promise(resolve => { finish = value => { if (!settled) { settled = true; resolve(value); } }; });
  const dialog = new DialogV2({
    window: { title: `Edit Item Options — ${document.name}` },
    classes: [`${MODULE_ID}-owned-dialog`, "ae5e-cat-options-editor-dialog"],
    content: '<div class="ae5e-cat-options-editor-host"></div>',
    buttons: [{ action: "ae5e-options-host", label: "Item Options", type: "button", disabled: true, style: { display: "none" } }],
    modal: false
  });
  const close = dialog.close.bind(dialog);
  dialog.close = (...args) => saving ? Promise.resolve(dialog) : close(...args);
  dialog.addEventListener?.("close", () => finish({ saved: false, cancelled: true, document }));
  await dialog.render({ force: true });
  const element = dialog.element?.[0] ?? dialog.element;
  const root = element?.querySelector?.(".ae5e-cat-options-editor-host");
  if (!root) { await dialog.close(); throw new Error("Item Options editor host was not rendered."); }
  mountItemOptionsEditor(root, { draft, authoring,
    onBusy: value => { saving = value; },
    onCancel: async () => { finish({ saved: false, cancelled: true, document }); await dialog.close(); },
    onSave: async saved => {
      // A registry refresh failure must not turn a successful Item write into a retry.
      let registration = null;
      try { registration = await onSaved(saved); }
      catch (error) { globalThis.ui?.notifications?.warn?.(`Item Options saved; CAT refresh failed: ${error.message}`); }
      finish({ saved: true, cancelled: false, document, result: saved, registration });
      await close();
    }
  });
  return result;
}
