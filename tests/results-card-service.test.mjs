import test from "node:test";
import assert from "node:assert/strict";
import {
  RESULTS_CARD_SCHEMA, RESULTS_CARD_DEFAULT_STYLE, resolveResultsCardStyle,
  normalizeResultsCard, renderResultsCard, ResultsCardService
} from "../scripts/chat/results-card-service.js";

function example() {
  return {
    item: { img: "icons/magic/fire/explosion-fireball-orange.webp" },
    header: { title: "Fireball:", subtitle: "Saves / Damage" },
    saves: { heading: "DC 15 Dexterity Saving Throw", rows: [
      { name: "Leader", image: "icons/svg/mystery-man.svg", outcome: "failed", total: 8, dc: 15 },
      { name: "Neutral", outcome: "passed", total: 19, dc: 15 }
    ] },
    damage: { rows: [
      { name: "Leader", amount: 28, type: "Fire" },
      { name: "Neutral", amount: 14, type: "Fire" }
    ] }
  };
}
test("results card defaults match approved compact Fireball layout", () => {
  const d = resolveResultsCardStyle();
  assert.equal(RESULTS_CARD_SCHEMA, 1);
  assert.equal(d.iconSize, 48);
  assert.deepEqual(d.title, { size: 16, weight: 700 });
  assert.deepEqual(d.subtitle, { size: 16, weight: 600 });
  assert.equal(d.saveTargetName.size, 14);
  assert.equal(d.saveTotal.size, 12);
  assert.equal(d.saveDc.size, 12);
  assert.deepEqual(d.damageHeading, { size: 13, weight: 700 });
  assert.deepEqual(d.damageTargetName, { size: 12, weight: 500 });
  assert.deepEqual(d.damageAmount, { size: 12, weight: 700 });
  assert.notEqual(d, RESULTS_CARD_DEFAULT_STYLE);
});
test("partial style override retains defaults and does not mutate them", () => {
  const overrides = { title: { size: 19 }, damageAmount: { weight: 800 }, rowGap: 9 };
  const before = structuredClone(overrides);
  const r = resolveResultsCardStyle(overrides);
  assert.deepEqual(r.title, { size: 19, weight: 700 });
  assert.deepEqual(r.damageAmount, { size: 12, weight: 800 });
  assert.equal(r.rowGap, 9);
  assert.equal(RESULTS_CARD_DEFAULT_STYLE.title.size, 16);
  assert.deepEqual(overrides, before);
});
test("invalid CSS-like overrides are rejected", () => {
  for (const style of [
    { title: { color: "red" } }, { title: { size: 150 } },
    { title: { weight: 615 } }, { title: "large" },
    { arbitraryCss: "display:none" }, { iconSize: 1 }, { rowGap: -1 }, []
  ]) assert.throws(() => resolveResultsCardStyle(style));
});
test("escaping and unsafe image scheme protection", () => {
  const data = example();
  data.header.title = '<img src=x onerror="alert(1)">';
  data.saves.rows[0].name = "<script>alert(1)</script>";
  data.damage.rows[0].name = "A&B";
  const markup = renderResultsCard(normalizeResultsCard(data));
  assert.doesNotMatch(markup, /<script>|onerror="/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /A&amp;B/);
  data.header.icon = "javascript:alert(1)";
  assert.throws(() => normalizeResultsCard(data), /safe HTTP/);
  data.header.icon = "//evil.example/image.svg";
  assert.throws(() => normalizeResultsCard(data), /safe HTTP/);
  data.header.icon = "data:image/svg+xml;base64,test";
  assert.throws(() => normalizeResultsCard(data), /safe HTTP/);
});
test("approved result structure separates compact saves from damage", () => {
  const snap = normalizeResultsCard(example());
  const html = renderResultsCard(snap);
  assert.match(html, /ae5e-results-save-failed/);
  assert.match(html, /ae5e-results-save-passed/);
  assert.match(html, /DC 15 Dexterity Saving Throw/);
  assert.match(html, /Damage Results/);
  assert.match(html, /28 Fire/);
  assert.doesNotMatch(html, /28 Fire Damage/);
  assert.match(html, /--ae5e-results-damage-amount-size:12px/);
  assert.match(html, /--ae5e-results-title-weight:700/);
});
test("save outcomes are explicit, never derived from private workflows", () => {
  const data = example();
  data.saves.rows[0].outcome = undefined;
  assert.throws(() => normalizeResultsCard(data), /explicitly/);
  data.saves.rows[0].outcome = "passed";
  const snap = normalizeResultsCard({ ...data, workflow: { saves: ["secret"], totalDamage: 9999 } });
  assert.doesNotMatch(JSON.stringify(snap), /secret|9999/);
});
test("independent save or damage sections; zero damage and missing save totals", () => {
  const damageOnly = normalizeResultsCard({
    header: { title: "Damage" },
    damage: { rows: [{ name: "Very long creature name".repeat(5), amount: 0, type: "Cold" }] }
  });
  assert.equal(damageOnly.saves, null);
  assert.match(renderResultsCard(damageOnly), /0 Cold/);
  const saveOnly = normalizeResultsCard({
    header: { title: "Save" }, saves: { rows: [{ name: "Creature", outcome: "passed" }] }
  });
  assert.equal(saveOnly.damage, null);
  assert.doesNotMatch(renderResultsCard(saveOnly), /class="ae5e-results-dc"/);
  assert.doesNotMatch(renderResultsCard(saveOnly), /class="ae5e-results-save-total"/);
});
test("invalid damage fails before posting any chat message", async () => {
  const old = globalThis.ChatMessage, writes = [];
  globalThis.ChatMessage = { create: async data => { writes.push(data); return data; } };
  try {
    const svc = new ResultsCardService(), request = example();
    request.damage.rows[0].amount = Infinity;
    await assert.rejects(svc.create(request), /resolved damage number/);
    request.damage.rows[0].amount = -10;
    await assert.rejects(svc.create(request), /resolved damage number/);
    assert.equal(writes.length, 0);
  } finally { globalThis.ChatMessage = old; }
});
test("one message stores a resolved style snapshot, no workflow data", async () => {
  const oldChat = globalThis.ChatMessage, oldGame = globalThis.game, writes = [];
  globalThis.game = { user: { id: "user-1" } };
  globalThis.ChatMessage = {
    getSpeaker: () => ({ alias: "Raven" }),
    create: async data => { writes.push(data); return { id: "message-1", ...data }; }
  };
  try {
    const svc = new ResultsCardService();
    const req = { ...example(), workflow: { item: { img: "icons/svg/fire.svg" }, secrets: ["private"] },
      style: { title: { size: 18 } } };
    const result = await svc.create(req);
    assert.equal(result.id, "message-1");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].user, "user-1");
    assert.equal(writes[0].speaker.alias, "Raven");
    const flag = writes[0].flags["action-effects-5e"].resultsCard;
    assert.equal(flag.style.title.size, 18);
    assert.equal(flag.style.title.weight, 700);
    assert.equal(flag.style.damageTargetName.size, 12);
    assert.equal(flag.damage.rows[0].amount, 28);
    assert.equal(flag.header.icon, "icons/magic/fire/explosion-fireball-orange.webp");
    assert.doesNotMatch(JSON.stringify(flag), /secrets|private/);
    assert.equal(writes[0].content, renderResultsCard(flag));
    assert.equal(svc.getDefaults().title.size, 16);
  } finally { globalThis.ChatMessage = oldChat; globalThis.game = oldGame; }
});
test("whisper and blind visibility preserved; no public blind messages", async () => {
  const old = globalThis.ChatMessage, writes = [];
  globalThis.ChatMessage = { create: async data => { writes.push(data); return data; } };
  try {
    const svc = new ResultsCardService();
    await svc.create({ ...example(), whisper: ["gm-1"], blind: true });
    assert.deepEqual(writes[0].whisper, ["gm-1"]);
    assert.equal(writes[0].blind, true);
    await assert.rejects(svc.create({ ...example(), blind: true }), /recipients/);
    await assert.rejects(svc.create({ ...example(), whisper: [4] }), /user IDs/);
    assert.equal(writes.length, 1);
  } finally { globalThis.ChatMessage = old; }
});
