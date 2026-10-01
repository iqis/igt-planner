// The share preview card (web/og.png, 1200x630): what a link to the planner looks like when it is posted
// to X, LINE, WeChat or Facebook. A real render of a real layout in the meadow, the logo, one line.
// Re-run after the look changes:   node scripts/make_og.mjs
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8841;
const srv = spawn("py", [join(ROOT, "serve.py"), "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

try {
  // 1. the scene: a 4-unit run with a burner and a mesh tray, a straight board and a corner, the Jikaro
  //    behind, two chairs and a figure sitting on the grass.
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => { localStorage.setItem("igt-theme", "light"); localStorage.setItem("igt.lang", "en"); });
  const layout = { app: "igt-planner", v: 1, scene: "meadow", nodes: [
    { i: 1, sku: "CK-150", leg: "CK-112", x: 0, z: 0, rot: 0, placements: [{ sku: "GS-450R-US", span: 2, start: 1 }, { sku: "CK-226", span: 1, start: 4 }] },
    { i: 2, sku: "CK-116TR", host: 1, edge: "end+x" }, { i: 3, sku: "CK-118TR", host: 1, edge: "end-x" },
    { i: 4, sku: "ST-050", x: 300, z: -1500, rot: 0, config: "long_in" },
    { i: 5, sku: "LV-077GY", x: 1750, z: -800, rot: 2.4 }, { i: 6, sku: "LV-077RD", x: -1400, z: -1400, rot: 0.9 },
    { i: 7, sku: "FIG-ADULT", pose: "ground", x: -900, z: -2600, rot: 0.3 }] };
  await p.goto(`http://127.0.0.1:${PORT}/web/#layout=${encodeURIComponent(JSON.stringify(layout))}`, { waitUntil: "networkidle2" });
  await p.reload({ waitUntil: "networkidle2" });
  await p.waitForFunction("window.__igt && window.__igt.state.nodes.length > 5");
  await p.evaluate(() => {
    const a = window.__igt; a.state.sel = null; a.state.selSet = new Set(); a.render();
    a.camera.position.set(0.55, 1.75, 4.2); a.controls.target.set(-0.95, 0.45, -0.7); a.controls.update(); a.invalidate();
  });
  await new Promise(r => setTimeout(r, 1500));
  const hero = await p.evaluate(async () => {
    const blob = await window.__igt.exportPng({ deliver: false, layout: "view", aspect: "16:9" });
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  });

  // 2. the card
  const mark = readFileSync(join(ROOT, "web/favicon.svg"), "utf8");
  const card = await b.newPage(); await card.setViewport({ width: 1200, height: 630 });
  await card.setContent(`<!doctype html><html><head><style>
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden; font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif; }
    .bg { position: absolute; inset: 0; background: url(data:image/png;base64,${hero}) center 35% / cover no-repeat; }
    .bg::after { content: ""; position: absolute; inset: 0;
      background: linear-gradient(90deg, rgba(14,20,34,.9) 0%, rgba(14,20,34,.62) 34%, rgba(14,20,34,0) 58%); }
    .inner { position: absolute; left: 64px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; gap: 26px; color: #fff; }
    .lock { display: flex; align-items: center; gap: 22px; }
    .lock svg { width: 92px; height: 92px; flex: none; }
    .name { display: flex; flex-direction: column; line-height: 1.02; }
    .name small { font-size: 25px; font-weight: 500; opacity: .7; }
    .name b { font-size: 60px; font-weight: 650; letter-spacing: -.01em; }
    .tag { font-size: 30px; line-height: 1.35; color: rgba(255,255,255,.9); max-width: 520px; }
    .url { font-size: 22px; color: rgba(255,255,255,.62); letter-spacing: .02em; }
  </style></head><body><div class="bg"></div><div class="inner">
    <div class="lock">${mark}<div class="name"><small>Siqi's</small><b>IGT Planner</b></div></div>
    <div class="tag">Plan a Snow Peak IGT setup in 3D — and know it will go together.</div>
    <div class="url">igt.iqis.app</div></div></body></html>`);
  await new Promise(r => setTimeout(r, 300));
  writeFileSync(join(ROOT, "web/og.png"), await card.screenshot({ type: "png" }));
  console.log("wrote web/og.png");
} finally {
  await b.close(); srv.kill();
}
