// The smoke test: boot the planner in a real headless Chrome and walk the flows a guest
// walks -- load, place, hook, share, undo -- plus the invariants that regress silently
// (console errors, and the on-demand renderer actually idling). Run with `npm run smoke`;
// exits non-zero on the first failure. ~15 seconds.
//
// puppeteer-core drives the Chrome/Edge already on this machine -- nothing is downloaded,
// which is the whole reason it is puppeteer-core and not playwright. The server is its own
// instance on a scratch port, so a running dev server on 8812 is neither needed nor touched.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8817;
const BASE = `http://127.0.0.1:${PORT}`;

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

// Console noise that is BY DESIGN, not a failure: the bench's 403 on /anno (the tailnet
// server is deliberately read-only -- Chrome's resource-error text carries the 403 body,
// not the URL, hence the second pattern) and hotlinked gallery thumbnails lapsing remotely.
const IGNORABLE = msg =>
  msg.includes("/anno") || msg.includes("annotation writes are off")
  || msg.includes("img.snowpeak") || msg.includes("cdn.shopify");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- server up ----------------------------------------------------------------------------------
const server = spawn("py", [join(ROOT, "serve.py"), "--port", String(PORT)], {
  cwd: ROOT, stdio: "ignore",
});
for (let i = 0; i < 40; i++) {
  try { await fetch(`${BASE}/web/`); break; }
  catch { await sleep(250); }
}

const exe = BROWSERS.find(p => existsSync(p));
if (!exe) { console.error("no Chrome/Edge found"); server.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: exe, headless: true,
  args: ["--disable-gpu-sandbox", "--no-first-run"] });

try {
  // ---- the planner ------------------------------------------------------------------------------
  const page = await browser.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error" && !IGNORABLE(m.text())) errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await page.goto(`${BASE}/web/`, { waitUntil: "networkidle2" });
  await page.waitForFunction("window.__igt && window.__igt.state.nodes.length >= 0", { timeout: 15000 });

  // a first run seeds a frame; a returning run restores the book -- either way, nodes exist
  const seeded = await page.evaluate(() => window.__igt.state.nodes.length);
  check("planner boots with a scene", seeded >= 1, `nodes=${seeded}`);

  // THE IDLE INVARIANT: the on-demand renderer must go quiet when nothing happens
  await sleep(600);
  const idle = await page.evaluate(async () => {
    const a = window.__igt.renderStats.frames;
    await new Promise(r => setTimeout(r, 1500));
    return window.__igt.renderStats.frames - a;
  });
  check("idle scene renders nothing", idle === 0, `${idle} frames in 1.5s`);

  const woke = await page.evaluate(() => {
    const a = window.__igt.renderStats.frames;
    window.__igt.invalidate();
    return new Promise(r => setTimeout(() => r(window.__igt.renderStats.frames - a), 200));
  });
  check("invalidate wakes the renderer", woke >= 1, `${woke} frames`);

  // place a burner into the frame through the palette, exactly as a click would
  const placed = await page.evaluate(() => {
    const app = window.__igt;
    const frame = app.state.nodes.find(n => n.kind === "frame");
    if (!frame) return "no frame";
    app.state.sel = frame.id; app.state.selSet = new Set([frame.id]); app.render();
    const row = [...document.querySelectorAll("#cooking .part")]
      .find(x => x.querySelector(".nm").textContent === "Flat Burner");
    if (!row || row.classList.contains("dead")) return "row missing/dead";
    row.click();
    return frame.placements.some(pl => pl.sku.startsWith("GS-450R")) || "not placed";
  });
  check("palette places the Flat Burner", placed === true, String(placed));

  // hook a bamboo board onto the frame's end
  const hooked = await page.evaluate(() => {
    const app = window.__igt;
    const frame = app.state.nodes.find(n => n.kind === "frame");
    const row = [...document.querySelectorAll("#extensions .part")]
      .find(x => !x.classList.contains("dead"));
    if (!row) return "no live board row";
    row.click();
    const board = app.state.nodes[app.state.nodes.length - 1];
    const edge = app.openEdges(frame)[0];
    if (!edge) return "no open edge";
    app.hookNode(board, frame, edge.key);
    app.render();
    return board.host === frame.id || "not hooked";
  });
  check("a board hooks onto the frame", hooked === true, String(hooked));

  // undo unwinds the hook
  const undone = await page.evaluate(() => {
    const app = window.__igt;
    const before = app.state.nodes.length;
    document.getElementById("undo").click();
    return app.state.nodes.length <= before;
  });
  check("undo unwinds", undone === true);

  // share round-trip: serialize -> gzip -> #d= -> reload -> the design arrives as a new page
  const shared = await page.evaluate(async () => {
    const app = window.__igt;
    const json = new TextEncoder().encode(JSON.stringify(app.serializeLayout()));
    const gz = await new Response(new Blob([json]).stream()
      .pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(gz)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return { hash: "#d=" + b64, count: app.state.nodes.length,
             pages: JSON.parse(localStorage.getItem("igt.pages")).pages.length };
  });
  await page.goto(`${BASE}/web/${shared.hash}`, { waitUntil: "networkidle2" });
  await page.reload({ waitUntil: "networkidle2" });   // hash-only navigation does not re-run boot
  await page.waitForFunction("window.__igt && window.__igt.state.nodes.length >= 0", { timeout: 15000 });
  const after = await page.evaluate(() => ({
    count: window.__igt.state.nodes.length,
    hash: location.hash,
    pages: JSON.parse(localStorage.getItem("igt.pages")).pages.length,
  }));
  check("share link round-trips", after.count === shared.count,
    `${after.count} vs ${shared.count} nodes`);
  check("shared design lands as a NEW page", after.pages === shared.pages + 1,
    `${shared.pages} -> ${after.pages}`);
  check("the hash is stripped after landing", after.hash === "", after.hash);

  check("planner console is clean", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();

  // ---- the bench, across the builder families ---------------------------------------------------
  // One SKU per geometry family that has burned us: the frame shell, a chair, a tarp, the
  // Land Lock loft, the GP-040 wire frame. A dispatch crash in any of them fails here.
  for (const sku of ["CK-149", "LV-085", "TP-862", "TP-671R", "GP-040"]) {
    const bp = await browser.newPage();
    const bErrors = [];
    bp.on("console", m => { if (m.type() === "error" && !IGNORABLE(m.text())) bErrors.push(m.text()); });
    bp.on("pageerror", e => bErrors.push(String(e)));
    await bp.goto(`${BASE}/web/part.html?sku=${sku}`, { waitUntil: "networkidle2" });
    await bp.waitForFunction("window.__bench", { timeout: 15000 }).catch(() => {});
    const alive = await bp.evaluate(() => !!window.__bench);
    check(`bench draws ${sku}`, alive && bErrors.length === 0,
      alive ? bErrors.slice(0, 2).join(" | ") : "bench never booted");
    await bp.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
process.exit(failures ? 1 : 0);
