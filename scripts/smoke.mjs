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
// SMOKE_ROOT=dist runs the same walk against the public build (scripts/build_public.py): no bench
// there, and one extra check -- that the page never asked for a photograph.
const SERVE_ROOT = process.env.SMOKE_ROOT ? join(ROOT, process.env.SMOKE_ROOT) : ROOT;
const PUBLIC = SERVE_ROOT !== ROOT;
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

// ---- the rules engine, no browser ---------------------------------------------------------------
// web/core.js is what an agent (or scripts/igt.mjs) calls. It must load in plain Node -- no DOM, no
// three -- and give the planner's answers: a good layout is buildable, a bad one says why.
{
  const core = await import("../web/core.js");
  const { readFileSync } = await import("node:fs");
  const cat = f => JSON.parse(readFileSync(join(ROOT, "catalog", f), "utf8"));
  core.loadCatalog({ catalog: cat("igt-catalog.json"), colors: cat("colors.json"),
    textures: cat("textures.json"), fittings: cat("frame_fittings.json") });
  const good = core.evaluate({ app: "igt-planner", v: 1, nodes: [
    { i: 1, sku: "CK-150", leg: "CK-114", x: 0, z: 0, rot: 0, placements: [{ sku: "GS-450R-US", span: 2, start: 0 }] },
    { i: 2, sku: "CK-116TR", host: 1, edge: "end+x" }] });
  check("core: a good layout is buildable", good.buildable && good.bill.lines.length >= 4,
    JSON.stringify(good.problems));
  check("core: a hooked board is placed off its host", good.nodes[1].x_mm > 900 && good.nodes[1].top_mm === good.nodes[0].top_mm,
    JSON.stringify(good.nodes[1]));
  const bad = core.evaluate({ app: "igt-planner", v: 1, nodes: [
    { i: 1, sku: "CK-150", leg: "CK-114", x: 0, z: 0, rot: 0, placements: [{ sku: "GS-355", span: 2, start: 7 }] },
    { i: 2, sku: "LV-077GY", host: 1, edge: "end+x" }] });
  check("core: a bad layout says why", !bad.buildable && bad.problems.length >= 2, JSON.stringify(bad.problems));
  // the 400mm datum: a frame on the Low leg (CK-112) meets the Jikaro FLUSH -- no step, no warning
  const jik = core.evaluate({ app: "igt-planner", v: 1, nodes: [
    { i: 1, sku: "ST-050", x: 0, z: 0, rot: 0, config: "long_in" },
    { i: 2, sku: "CK-902", leg: "CK-112", host: 1, edge: "jik+x" }] });
  check("core: Low-leg frame is flush with the Jikaro", jik.buildable && !jik.problems.length
    && jik.nodes.every(n => n.top_mm === 400), JSON.stringify({ p: jik.problems, tops: jik.nodes.map(n => n.top_mm) }));
  // the part page's two lists come from the same rules as the menus: a box goes in a frame's bay,
  // a frame takes boards at its ends
  // the tarp is cloth, pitched taut: the ridge runs pole top to pole top with only a gentle dip, and
  // raising the wings on sub-poles buys covered ground
  const tarp = await import("../web/tarp.js");
  const hexaL = tarp.solvePitch("TP-862", {}), raised = tarp.solvePitch("TP-862", { left: 1900, right: 1900 });
  // pitched taut (mains first -- no longer the default), the ridge is locked nearly straight
  const tautL = tarp.solvePitch("TP-862", { order: "mains" });
  const ridgeOff = (() => { const T = tautL.anchors.find(a => a.name === "T").at, B = tautL.anchors.find(a => a.name === "B").at;
    return Math.max(...tautL.ridge.map(i => tautL.pts[i]).map(p => {
      const s = (p.z - B.z) / (T.z - B.z); return Math.abs(p.y - (B.y + s * (T.y - B.y))); })); })();
  check("tarp: a taut ridge dips only gently", tautL.ok && ridgeOff > 50 && ridgeOff < 200, `${ridgeOff.toFixed(0)} mm below the pole-to-pole line`);
  const one = tarp.solvePitch("TP-862", { corners: { NR: 1900 } });
  const ys = Object.fromEntries(one.anchors.filter(a => a.role === "corner").map(a => [a.name, Math.round(a.at.y)]));
  const y0 = Object.fromEntries(hexaL.anchors.filter(a => a.role === "corner").map(a => [a.name, Math.round(a.at.y)]));
  check("tarp: one sub-pole lifts one corner", one.ok && ys.NR > 1850
    && ["NL", "WR", "WL"].every(k => Math.abs(ys[k] - y0[k]) < 150), `${JSON.stringify(ys)} vs ${JSON.stringify(y0)}`);
  // the calibration: Snow Peak publishes the Hexa L's guyed footprint, 780 x 1220 cm -- the solved
  // cloth, ropes of the manual's lengths and their pegs land within 10% of it
  check("tarp: Hexa L pegs out where Snow Peak says (780 x 1220 cm)",
    Math.abs(hexaL.guyed.w / 7800 - 1) < 0.1 && Math.abs(hexaL.guyed.d / 12200 - 1) < 0.1,
    `${(hexaL.guyed.w / 1000).toFixed(2)} x ${(hexaL.guyed.d / 1000).toFixed(2)} m`);
  check("tarp: sub-poles on the wings cover more ground", raised.ok && raised.area_m2 > hexaL.area_m2 + 1,
    `${hexaL.area_m2.toFixed(1)} -> ${raised.area_m2.toFixed(1)} m2`);
  // a tarp is carried: the cloth plus the poles its pitch stands on. Hexa L on 240/210 mains, two
  // corners on 190 uprights (one TP-080 pair) and one on a 170 = 3.6 + 1.1 + 0.9 + 2.8 + 0.4 kg
  const carried = core.evaluate({ app: "igt-planner", v: 1, nodes: [
    { i: 1, sku: "TP-862", x: 0, z: 0, rot: 0, pitch: { a: 2400, b: 2100, corners: { NR: 1900, WR: 1900, WL: 1700 } } }] }).bill;
  check("tarp: the bill carries the cloth and its poles",
    carried.total_weight_kg === 8.8 && carried.lines.map(l => l.sku).sort().join() === "TP-002,TP-003,TP-022,TP-080,TP-862",
    JSON.stringify(carried));
  // the Amenity Hexa L comes with its own main poles (not the Wing Poles sold apart): they are in its
  // weight, so only a raised corner's upright is added
  const amenity = core.evaluate({ app: "igt-planner", v: 1, nodes: [
    { i: 1, sku: "TP-851", x: 0, z: 0, rot: 0, pitch: { corners: { NR: 1700 } } }] }).bill;
  check("tarp: a set's own poles are not billed twice",
    amenity.total_weight_kg === 8.3 && amenity.lines.map(l => l.sku).sort().join() === "TP-022,TP-851",
    JSON.stringify(amenity));
  // the Octa is sold without poles and has no pitch control: it bills its manual's two 280s
  const octa = core.evaluate({ app: "igt-planner", v: 1, nodes: [{ i: 1, sku: "TP-430", x: 0, z: 0, rot: 0 }] }).bill;
  check("tarp: the Octa carries the two 280s its manual asks for",
    octa.total_weight_kg === 11.3 && octa.lines.find(l => l.sku === "TP-001")?.qty === 2, JSON.stringify(octa));
  // the Octa: cut from its manual's vector plan; on two 280s it pegs out along the ridge where Snow Peak
  // says (880 cm, within 12%), and raising the wing centres on 140s buys covered ground and bills two TP-140
  const octaS = tarp.solvePitch("TP-430", {}), octaUp = tarp.solvePitch("TP-430", { corners: { MR: 1400, ML: 1400 } });
  check("tarp: the Octa pegs out along its ridge where Snow Peak says (880 cm)",
    octaS.ok && Math.abs(octaS.guyed.d / 8800 - 1) < 0.04, `${(octaS.guyed.d / 1000).toFixed(2)} m`);
  // ...and its corners hang where the manual's side elevation draws them (1.27 / 0.87 / 1.01 m)
  const oy = Object.fromEntries(octaS.anchors.map(a => [a.name, a.at.y]));
  check("tarp: the Octa's corners hang at the manual's heights (within 25 cm)",
    Math.abs(oy.ER1 - 1270) < 250 && Math.abs(oy.SR1 - 870) < 250 && Math.abs(oy.MR - 1010) < 250,
    `end ${oy.ER1.toFixed(0)} side ${oy.SR1.toFixed(0)} centre ${oy.MR.toFixed(0)} mm`);
  const octaUpBill = core.evaluate({ app: "igt-planner", v: 1, nodes: [
    { i: 1, sku: "TP-430", x: 0, z: 0, rot: 0, pitch: { corners: { MR: 1400, ML: 1400 } } }] }).bill;
  check("tarp: the Octa's raised wing centres cover more ground and bill two 140s",
    octaUp.ok && octaUp.area_m2 > octaS.area_m2 + 0.5 && octaUpBill.lines.find(l => l.sku === "TP-140")?.qty === 2
    && octaUpBill.total_weight_kg === 12.3, `${octaS.area_m2.toFixed(1)} -> ${octaUp.area_m2.toFixed(1)} m2; ${JSON.stringify(octaUpBill)}`);
  // tarp mode's pegs: a corner is pulled AT its peg -- out, it rides up; in, it comes down; past its
  // rope, the rope is flagged short. The drag-time fast solve lands within a few cm of the full one.
  const pg0 = octaS.anchors.find(a => a.name === "SR1").pegs[0];
  const hAt = k => tarp.solvePitch("TP-430", { pegs: { SR1: { x: pg0.x * k, z: pg0.z } } }).anchors.find(a => a.name === "SR1");
  const outC = hAt(1.3), inC = hAt(0.8), farC = hAt(2.2);
  const fastC = tarp.solvePitch("TP-430", { pegs: { SR1: { x: pg0.x * 1.3, z: pg0.z } } }, { fast: true }).anchors.find(a => a.name === "SR1");
  check("tarp mode: a peg moved out lifts its corner, in lowers it, too far is a short rope",
    outC.at.y > oy.SR1 + 50 && inC.at.y < oy.SR1 - 50 && farC.pegs[0].short && !outC.pegs[0].short
    && Math.abs(fastC.at.y - outC.at.y) < 60,
    `out ${outC.at.y.toFixed(0)} / in ${inC.at.y.toFixed(0)} / base ${oy.SR1.toFixed(0)} / fast ${fastC.at.y.toFixed(0)}`);
  // wings first (the manuals' order): the ridge is free, and comes out a smooth curve with the pole tips
  // (no step in its middle over 6 deg -- the old ring mesh hung it as a V, ~10 deg at the centre)
  // standing up out of it -- steep only at the ends (the "horns"), never a V at the centre
  const ridgeProfile = s => {
    const pr = s.ridge.map(i => s.pts[i]);
    return pr.slice(0, -1).map((q, i) => Math.atan2(pr[i + 1].y - q.y, Math.abs(pr[i + 1].z - q.z)) * 180 / Math.PI);
  };
  const soft = tarp.solvePitch("TP-862", { order: "wings", mainPull: 1 }), sl = ridgeProfile(soft);
  const mid = sl.slice(Math.round(sl.length * 0.2), Math.round(sl.length * 0.8));
  const midTurn = Math.max(...mid.slice(1).map((v, i) => Math.abs(v - mid[i])));
  check("tarp: wings first, the ridge is a smooth curve with horns at the poles",
    soft.ok && midTurn < 6 && Math.abs(sl[0]) > Math.max(...mid.map(Math.abs)) + 5,
    `middle turns at most ${midTurn.toFixed(1)} deg; end ${sl[0].toFixed(0)} deg vs middle ${Math.max(...mid.map(Math.abs)).toFixed(0)}`);
  // ...and pitched the manual's way, the Hexa L pegs out where Snow Peak publishes (780 x 1220 cm)
  check("tarp: wings first, the Hexa L pegs out within 5% of 780 x 1220 cm",
    Math.abs(soft.guyed.w / 7800 - 1) < 0.05 && Math.abs(soft.guyed.d / 12200 - 1) < 0.05,
    `${(soft.guyed.w / 1000).toFixed(2)} x ${(soft.guyed.d / 1000).toFixed(2)} m`);
  // ...and the Octa, pitched the same way, as its manual's side elevation draws it (dip 0.20, poles 4.93 m)
  const man = tarp.solvePitch("TP-430", {});
  const fT = man.anchors.find(a => a.name === "T").at, fB = man.anchors.find(a => a.name === "B").at;
  const fDip = Math.max(...man.ridge.map(i => man.pts[i]).map(q => {
    const u = (q.z - fB.z) / (fT.z - fB.z); return fB.y + u * (fT.y - fB.y) - q.y; }));
  check("tarp: the Octa, the manual's way, dips its ridge and stands its poles as its manual draws",
    Math.abs(fDip - 200) < 80 && Math.abs(fT.z - fB.z - 4930) < 150, `dip ${fDip.toFixed(0)} mm, poles ${(fT.z - fB.z).toFixed(0)} mm apart`);
  // a symmetric pitch hangs symmetric: every corner matches its mirror twin, left/right and (Octa) front/back
  const twin = { ER1: "EL1", SR1: "SL1", MR: "ML", SR2: "SL2", ER2: "EL2", ER1_: "ER2" };
  const mA = Object.fromEntries(man.anchors.map(a => [a.name, a.at]));
  const lop = Math.max(...Object.entries(twin).map(([r, l]) => r.endsWith("_")
    ? Math.abs(mA[r.slice(0, -1)].y - mA[l].y) + Math.abs(mA[r.slice(0, -1)].z + mA[l].z)
    : Math.abs(mA[r].y - mA[l].y) + Math.abs(mA[r].x + mA[l].x)));
  check("tarp: a symmetric pitch hangs symmetric (mirror corners within 1 cm)", lop < 10, `${lop.toFixed(1)} mm`);
  const tarpBad = Object.keys(tarp.PATTERNS).filter(sku => !tarp.solvePitch(sku, {}).ok);
  check("tarp: every known cut pitches at its defaults", !tarpBad.length, tarpBad.join(", "));
  // every starter layout is a real design: buildable by the rules, nothing dropped
  const { TEMPLATES } = await import("../web/templates.js");
  const tplBad = TEMPLATES.map(tp => [tp.id, core.evaluate(tp.doc)])
    .filter(([, r]) => !r.buildable || r.problems.some(p => /not in the catalog/.test(p.text)));
  check("core: every template is buildable", TEMPLATES.length >= 4 && !tplBad.length,
    tplBad.map(([id, r]) => `${id}: ${r.problems.map(p => p.text).join("; ")}`).join(" | "));
  const box = core.partInfo("CK-160"), fr = core.partInfo("CK-150");
  check("core: part page knows where a module goes", box.onto.bay?.includes("CK-150"), JSON.stringify(box.onto));
  check("core: part page knows what a frame takes", fr.takes.end?.includes("CK-116TR") && fr.takes.bay?.includes("CK-160"),
    JSON.stringify(Object.keys(fr.takes)));
}

// ---- every language has every key ------------------------------------------------------------
{
  const en = (await import("../web/i18n/en.js")).default;
  for (const code of ["zh-Hans", "zh-Hant", "ja", "ko", "th"]) {
    const d = (await import(`../web/i18n/${code}.js`)).default;
    const missing = Object.keys(en).filter(k => !(k in d));
    const extra = Object.keys(d).filter(k => !(k in en));
    const holes = Object.keys(en).filter(k => k in d && (en[k].match(/\{\w+\}/g) || []).sort().join() !== (d[k].match(/\{\w+\}/g) || []).sort().join());
    check(`i18n: ${code} is complete`, !missing.length && !extra.length && !holes.length,
      JSON.stringify({ missing: missing.slice(0, 5), extra: extra.slice(0, 5), placeholders: holes.slice(0, 5) }));
  }
}

// ---- server up ----------------------------------------------------------------------------------
const server = spawn("py", [join(ROOT, "serve.py"), "--port", String(PORT), "--root", SERVE_ROOT], {
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

  // the scale figure: places from its palette row, takes a pose and a height, and NEVER
  // lands on the bill -- it is a measuring stick, not a product
  const figured = await page.evaluate(() => {
    const app = window.__igt;
    const row = [...document.querySelectorAll("#figures .part")]
      .find(x => x.querySelector(".nm").textContent.includes("adult"));
    if (!row) return "no figure row";
    const before = document.querySelectorAll("#bomtable tr").length;
    row.click();
    const fig = app.state.nodes[app.state.nodes.length - 1];
    if (fig.sku !== "FIG-ADULT") return "figure not added";
    fig.pose = "sit"; fig.config = 1850; app.render();
    const after = document.querySelectorAll("#bomtable tr").length;
    return after === before || `bill grew ${before} -> ${after}`;
  });
  check("a scale figure stays off the bill", figured === true, String(figured));

  // tarp mode: opens on a tarp, a peg dragged in plan lands on the node (with undo), and it closes clean
  const tm = await page.evaluate(() => {
    const app = window.__igt;
    window.__kept = app.serializeLayout();          // the checks after this one want the scene back
    app.loadLayout({ app: "igt-planner", v: 1, nodes: [{ i: 1, sku: "TP-430", x: 0, z: 0, rot: 0.3 }] });
    window.__tm = app.openTarpModeFor(app.state.nodes[0]);
    const h = window.__tm.pegsOnScreen().find(q => q.key === "SR1");
    return { h, open: !!document.querySelector(".tmodal[open]"), h0: window.__tm.solution.anchors.find(a => a.name === "SR1").at.y };
  });
  await page.mouse.move(tm.h.x, tm.h.y); await page.mouse.down();
  for (let k = 1; k <= 4; k++) { await page.mouse.move(tm.h.x + k * 10, tm.h.y); await new Promise(r => setTimeout(r, 40)); }
  await page.mouse.up();
  const tmAfter = await page.evaluate(() => {
    const n = window.__igt.state.nodes[0], s = window.__tm.solution;
    window.__tm.close();
    return { pegs: n.pitch?.pegs, h1: s.anchors.find(a => a.name === "SR1").at.y };
  });
  await new Promise(r => setTimeout(r, 100));        // a dialog's close event comes a task later
  tmAfter.gone = await page.evaluate(() => { window.__igt.loadLayout(window.__kept); return !document.querySelector(".tmodal"); });
  check("tarp mode: a dragged peg lands on the tarp and moves its corner", tm.open && tmAfter.gone
    && tmAfter.pegs?.SR1 && Math.abs(tmAfter.h1 - tm.h0) > 20, JSON.stringify({ ...tm, ...tmAfter }));

  // the PNG plate: composes to a real image, and the screen comes back at its own size
  const png = await page.evaluate(async () => {
    const app = window.__igt;
    const before = { w: app.renderStats && document.getElementById("canvas").width };
    const blob = await app.exportPng({ deliver: false });
    const after = document.getElementById("canvas").width;
    if (!blob) return "no blob";
    if (blob.type !== "image/png") return `type ${blob.type}`;
    if (blob.size < 30000) return `only ${blob.size} bytes`;
    if (after !== before.w) return `canvas left at ${after}, was ${before.w}`;
    return true;
  });
  check("the photo plate composes", png === true, String(png));

  // share round-trip: serialize -> gzip -> #d= -> reload -> the design arrives as a new page
  const shared = await page.evaluate(async () => {
    const app = window.__igt;
    const json = new TextEncoder().encode(JSON.stringify({ ...app.serializeLayout(), name: "Lake kitchen", author: "Ben" }));
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
    name: (b => b.pages.find(p => p.id === b.activeId)?.name)(JSON.parse(localStorage.getItem("igt.pages"))),
    author: (b => b.pages.find(p => p.id === b.activeId)?.author)(JSON.parse(localStorage.getItem("igt.pages"))),
    fig: (() => { const f = window.__igt.state.nodes.find(n => n.sku === "FIG-ADULT");
                  return f ? `${f.pose}/${f.config}` : "missing"; })(),
  }));
  check("share link round-trips", after.count === shared.count,
    `${after.count} vs ${shared.count} nodes`);
  check("shared design lands as a NEW page", after.pages === shared.pages + 1,
    `${shared.pages} -> ${after.pages}`);
  check("the hash is stripped after landing", after.hash === "", after.hash);
  check("a shared page keeps its name", /^Lake kitchen( \d+)?$/.test(after.name || ""), after.name);
  check("a shared page knows who it is by", after.author === "Ben", String(after.author));
  check("the figure's pose and height survive the link", after.fig === "sit/1850", after.fig);

  // the plain form an agent can write without gzip: #layout=<URL-encoded JSON>
  const plainDoc = { app: "igt-planner", v: 1, nodes: [{ i: 1, sku: "CK-149", leg: "CK-112", x: 0, z: 0, rot: 0 }] };
  await page.goto(`${BASE}/web/#layout=${encodeURIComponent(JSON.stringify(plainDoc))}`, { waitUntil: "networkidle2" });
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction("window.__igt && window.__igt.state.nodes.length >= 0", { timeout: 15000 });
  const plainGot = await page.evaluate(() => window.__igt.state.nodes.map(n => n.sku).join(","));
  check("a plain #layout= link opens", plainGot === "CK-149", plainGot);

  // the scene belongs to the PAGE: set the beach here, a new page is bare grid, coming back is the beach;
  // it is undoable, and it is in the saved doc (so a shared link carries it)
  const sceneRun = await page.evaluate(() => {
    const app = window.__igt, sel = document.getElementById("groundsel");
    const pick = v => { sel.value = v; sel.dispatchEvent(new Event("change")); };
    const here = app.pages().activeId;
    pick("beach");
    const doc = app.serializeLayout().scene;
    app.newPage("scene test");
    const fresh = sel.value;
    app.switchPage(here);
    const back = sel.value;
    pick("night");
    document.getElementById("undo").click();
    return { doc, fresh, back, undone: sel.value };
  });
  check("the scene goes with the page", sceneRun.doc === "beach" && sceneRun.fresh === "grid"
    && sceneRun.back === "beach" && sceneRun.undone === "beach", JSON.stringify(sceneRun));

  // part search: words in any order, part numbers without punctuation, spans, typos, JP titles
  const search = await page.evaluate(() => {
    const top = q => {
      const box = document.getElementById("palsearch");
      box.value = q; box.dispatchEvent(new Event("input"));
      const hit = [...document.querySelectorAll("#palette .parts > [data-search]")]
        .find(e => e.style.display !== "none" && e.offsetParent !== null);
      return hit?.dataset.sku || "";
    };
    const got = { "bamboo long": top("bamboo long"), ck149: top("ck149"), "0.5u": top("0.5u"),
      "flat brner": top("flat brner"), "焚火": top("焚火") };
    top("");
    return got;
  });
  check("part search ranks the right part first",
    search["bamboo long"].startsWith("CK-117") && search.ck149 === "CK-149" && search["0.5u"].startsWith("CK-2")
      && search["flat brner"].startsWith("GS-450R") && search["焚火"].startsWith("ST-032"),
    JSON.stringify(search));

  // the favicon really decodes as an image (an XML slip -- "--" in a comment -- once broke it silently)
  const favOk = await page.evaluate(() => new Promise(res => {
    const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = "favicon.svg";
  }));
  check("the favicon decodes", favOk);

  // The part page: every part the library lists opens one, without an error, and a module's page
  // carries the planner's drawing of it. Opened through the same entry the (i) button uses.
  const pp = await page.evaluate(async () => {
    const before = JSON.stringify(window.__igt.serializeLayout());
    const skus = [...new Set([...document.querySelectorAll("#palette .part[data-sku]")].map(r => r.dataset.sku))];
    const bad = [];
    for (const s of skus) {
      try { window.__igt.openPartPage(s); if (!document.getElementById("partmodal").open) bad.push(s); }
      catch (e) { bad.push(`${s}: ${e.message}`); }
    }
    window.__igt.openPartPage("CK-160");
    const img = !!document.querySelector("#ppbody .ppshot");
    const chips = document.querySelectorAll("#ppbody .ppchip").length;
    document.getElementById("partmodal").close();
    return { n: skus.length, bad, img, chips, same: JSON.stringify(window.__igt.serializeLayout()) === before };
  });
  check("every listed part opens its page", pp.n > 50 && !pp.bad.length, `${pp.n} parts; ${pp.bad.slice(0, 3).join(" | ")}`);
  check("a module's page shows its drawing and its frames", pp.img && pp.chips >= 3, JSON.stringify(pp));
  check("drawing a part leaves the scene alone", pp.same);

  check("planner console is clean", errors.length === 0, errors.slice(0, 3).join(" | "));
  if (PUBLIC) {
    const photos = await page.evaluate(() => performance.getEntriesByType("resource").map(e => e.name)
      .filter(u => /\/img\/|\/tex\/(?!brushed_steel|canvas|chair_mesh)/.test(u)));
    check("public build requests no photographs", photos.length === 0, photos.slice(0, 3).join(" | "));
    // The static part pages: real HTML with the facts in it, and the planner's picture of the part.
    const pageHtml = await (await fetch(`${BASE}/p/CK-150/`)).text();
    const shotOk = (await fetch(`${BASE}/p/CK-160/shot.jpg`)).ok;
    check("public part pages carry their facts and picture", /Fits onto/.test(pageHtml) && /CK-150/.test(pageHtml) && shotOk);
  }
  await page.close();

  // ---- the bench, across the builder families ---------------------------------------------------
  // One SKU per geometry family that has burned us: the frame shell, a chair, a tarp, the
  // Land Lock loft, the GP-040 wire frame. A dispatch crash in any of them fails here.
  for (const sku of PUBLIC ? [] : ["CK-149", "LV-085", "TP-862", "TP-671R", "GP-040"]) {
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
