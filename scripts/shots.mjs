// Look-and-feel screenshots: the same small scene, desktop light + dark and a phone, so a visual
// change can be judged side by side instead of from memory.
//   node scripts/shots.mjs <outdir> <tag> [root]      (root defaults to the repo; "dist" for public)
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const [OUT, TAG = "shot", SERVE = ""] = process.argv.slice(2);
const PORT = 8824;
const srv = spawn("py", [join(ROOT, "serve.py"), "--port", String(PORT), "--root", SERVE ? join(ROOT, SERVE) : ROOT],
  { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

const VIEWS = [
  ["light", { width: 1440, height: 900 }],
  ["dark", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
];
try {
  for (const [name, vp] of VIEWS) {
    const p = await b.newPage();
    await p.setViewport(vp);
    await p.evaluateOnNewDocument(t => localStorage.setItem("igt-theme", t), name === "dark" ? "dark" : "light");
    await p.goto(`http://127.0.0.1:${PORT}/web/`, { waitUntil: "networkidle2" });
    await p.waitForFunction("window.__igt && window.__igt.state.nodes.length");
    await p.evaluate(() => {
      const app = window.__igt;
      const frame = app.state.nodes.find(n => n.kind === "frame");
      const pick = (cat, re) => [...document.querySelectorAll(`#${cat} .part`)]
        .find(x => !x.classList.contains("dead") && (!re || re.test(x.textContent)));
      app.state.sel = frame.id; app.state.selSet = new Set([frame.id]); app.render();
      pick("cooking", /Flat Burner/)?.click();
      pick("extensions", /Bamboo IGT Table Regular/)?.click();
      const board = app.state.nodes[app.state.nodes.length - 1];
      const e = app.openEdges(frame)[0];
      if (e) app.hookNode(board, frame, e.key);
      app.state.sel = frame.id; app.state.selSet = new Set([frame.id]); app.render();
    });
    await p.keyboard.press("0"); await new Promise(r => setTimeout(r, 300)); await p.keyboard.press("f");
    await new Promise(r => setTimeout(r, 1500));
    await p.screenshot({ path: `${OUT}/${TAG}_${name}.png` });
    await p.close();
  }
} finally {
  await b.close(); srv.kill();
}
