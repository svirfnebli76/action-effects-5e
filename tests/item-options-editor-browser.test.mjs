import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { resolve, extname, join } from "node:path";

const chromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find(path => existsSync(path));
test("Item Options browser interactions and sheet entry points", {
  skip: !chromium || (process.env.AE5E_BROWSER_TESTS !== "1" && "Set AE5E_BROWSER_TESTS=1 to run installed Chromium"), timeout: 20000
}, async context => {
  const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const profile = await mkdtemp(join(tmpdir(), "ae5e-editor-browser-"));
  const server = createServer(async (request, response) => {
    const path = resolve(directory, `.${new URL(request.url, "http://localhost").pathname}`);
    if (!path.startsWith(`${directory}/`)) { response.writeHead(403).end(); return; }
    try {
      const data = await readFile(path);
      response.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" }[extname(path)] ?? "text/plain");
      response.end(data);
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.on("error", reject); server.listen(0, "127.0.0.1", resolve); });
    browser = spawn(chromium, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", `--user-data-dir=${profile}`,
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
    const { targetId } = await call("Target.createTarget", { url: `http://127.0.0.1:${server.address().port}/tests/item-options-editor-browser.html` });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      const evaluated = await call("Runtime.evaluate", { expression: 'document.querySelector("#result")?.textContent', returnByValue: true }, sessionId);
      result = evaluated.result?.value;
      if (/^(PASS|FAIL)/.test(result ?? "")) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(result ?? "No browser result", /^PASS 18 browser checks/);
  } finally {
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, "exit");
      browser.kill("SIGKILL");
      await exited;
    }
    if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(profile, { recursive: true, force: true });
  }
});
