import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const installed = (root, ...parts) => root ? join(root, ...parts) : null;
const chromium = [
  process.env.AE5E_CHROMIUM_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  installed(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
  installed(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
  installed(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  installed(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
  installed(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe")
].filter(Boolean).find(path => existsSync(path));

if (!chromium) {
  throw new Error("Chromium was not found. Install Chrome/Chromium/Edge or set AE5E_CHROMIUM_PATH to its executable.");
}

test("Item Options browser interactions and compendium-only context menu", { timeout: 20000 }, async context => {
  const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const profile = await mkdtemp(join(tmpdir(), "ae5e-editor-browser-"));
  const pageUrl = pathToFileURL(resolve(directory, "tests/item-options-editor-browser.html")).href;
  let browser;
  try {
    browser = spawn(chromium, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files", `--user-data-dir=${profile}`,
      "--remote-debugging-pipe"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], signal: context.signal });
    const pending = new Map();
    let sequence = 0;
    let buffer = "";
    const fail = error => { pending.forEach(request => request.reject(error)); pending.clear(); };
    browser.stderr.resume();
    browser.on("error", fail);
    browser.on("exit", code => fail(new Error(`Chromium exited ${code}`)));
    browser.stdio[4].on("data", chunk => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      browser.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
    const { targetId } = await call("Target.createTarget", { url: pageUrl });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      const evaluated = await call("Runtime.evaluate", { expression: 'document.querySelector("#result")?.textContent', returnByValue: true }, sessionId);
      result = evaluated.result?.value;
      if (/^(PASS|FAIL)/.test(result ?? "")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (result == null) {
      const diagnostic = await call("Runtime.evaluate", {
        expression: 'JSON.stringify({href: location.href, readyState: document.readyState, title: document.title, body: document.body?.innerText})',
        returnByValue: true
      }, sessionId);
      result = `No browser result: ${diagnostic.result?.value ?? "no page diagnostic"}`;
    }
    assert.match(result, /^PASS 21 browser checks/);
    const evaluate = async expression => {
      const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result?.value;
    };
    const clickWithMouse = async selector => {
      const { x, y } = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        element.scrollIntoView({ block: "center" });
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      })()`);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
    };
    await evaluate("preparePointerCheck()");
    await evaluate(`(() => {
      const editor = document.querySelector("[data-declaration-json]");
      editor.focus();
      editor.select();
    })()`);
    await call("Input.insertText", { text: '{"id":"second","settings":{"draft":true}' }, sessionId);
    await clickWithMouse('[data-declaration-list] [data-row]');
    assert.equal(await evaluate('pointerCheck.controller.selected.key === pointerCheck.draft.group("future").rows[0].key'),
      true, "first pointer click must switch rows after editing JSON");
    await clickWithMouse('[data-options-save]');
    assert.equal(await evaluate('pointerCheck.writes.length === 0 && document.querySelector("[data-options-status]").textContent.includes("Invalid JSON")'),
      true, "invalid unselected JSON must block saving without any Item write");
    await evaluate("preparePointerCheck()");
    await evaluate('document.querySelector("[data-declaration-json]").select()');
    await call("Input.insertText", { text: '{"id":"second","settings":{"draft":true}}' }, sessionId);
    await clickWithMouse('[data-declaration-list] [data-row]');
    assert.equal(await evaluate('pointerCheck.controller.selected.key === pointerCheck.draft.group("future").rows[0].key'),
      true, "first pointer click must also switch rows after valid JSON edits");
    await clickWithMouse('[data-declaration-list] [data-row]:last-child');
    assert.equal(await evaluate('JSON.parse(document.querySelector("[data-declaration-json]").value).settings.draft'),
      true, "edited record must retain its draft after switching back with the mouse");
  } finally {
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, "exit");
      browser.kill("SIGKILL");
      await exited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
