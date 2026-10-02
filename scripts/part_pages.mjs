// The public part pages: dist/p/<SKU>/index.html, one per part the planner lists, plus the planner's
// own drawing of each part, sitemap.xml and robots.txt. Run by build_public.py after dist/ is built.
//
//   node scripts/part_pages.mjs [dist]
//
// The planner itself is the in-app part page (openPartPage). These are its plain twins for search
// engines and link previews: real HTML with the facts in it, a picture, and one button into the
// planner (/web/#part=SKU). Their facts come from the same core.partInfo() the app reads, and the
// picture from the same partShot() -- drawn in a headless Chrome against the built dist/, so what a
// search result shows is exactly what the public planner draws. English only (one canonical page).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import * as core from "../web/core.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = resolve(ROOT, process.argv[2] || "dist");
const CHANNEL = process.argv[3] || "prod";
const SITE = CHANNEL === "dev" ? "https://igt-dev.iqis.app" : "https://igt.iqis.app";
const PORT = 8819;

const cat = f => JSON.parse(readFileSync(join(ROOT, "catalog", f), "utf8"));
core.loadCatalog({ catalog: cat("igt-catalog.json"), colors: cat("colors.json"),
  textures: cat("textures.json"), fittings: cat("frame_fittings.json"), experimental: CHANNEL === "dev" });
const PARTS = core.PARTS;
const parts = core.pageParts();
const listed = new Set(parts.map(p => p.sku));

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mm3 = s => s && `${Math.round(s.w)} × ${Math.round(s.d)} × ${Math.round(s.h)} mm`;
const PLACE = { end: "short end", rail: "long rail", edge: "edge", opening: "fire opening", bay: "unit bay" };
const REASON = [[/tipping/i, "risk of tipping over"], [/dimension/i, "dimensions don't fit"]];
const link = sku => listed.has(sku)
  ? `<a class="chip" href="/p/${encodeURIComponent(sku)}/">${esc(PARTS[sku].title_en)}</a>`
  : `<span class="chip">${esc(PARTS[sku]?.title_en || sku)}</span>`;

function groups(title, by) {
  const keys = Object.keys(PLACE).filter(k => by[k]?.length);
  if (!keys.length) return "";
  return `<h2>${title}</h2>` + keys.map(k => `<div class="where">${PLACE[k]}</div><div class="chips">${
    by[k].filter(s => listed.has(s)).map(link).join("")}</div>`).join("");
}

function describe(info) {
  const bits = [];
  if (info.size_mm) bits.push(mm3(info.size_mm));
  if (info.weight_g) bits.push(`${(info.weight_g / 1000).toFixed(2)} kg`);
  const onto = [...new Set(Object.values(info.onto).flat())].filter(s => listed.has(s));
  const takes = [...new Set(Object.values(info.takes).flat())].filter(s => listed.has(s));
  let s = `${info.name} (Snow Peak ${info.sku}${info.name_jp ? `, ${info.name_jp}` : ""}): ${bits.join(", ")}.`;
  if (onto.length) s += ` Fits ${onto.length} IGT part${onto.length > 1 ? "s" : ""}, including ${onto.slice(0, 3).map(x => PARTS[x].title_en).join(", ")}.`;
  if (takes.length) s += ` Takes ${takes.length} part${takes.length > 1 ? "s" : ""}.`;
  return s + " Plan it in 3D with the rules checked.";
}

function page(p, info, shot) {
  const url = `${SITE}/p/${encodeURIComponent(p.sku)}/`;
  const title = `${p.title_en} (${p.sku}) — Siqi's IGT Planner`;
  const desc = describe(info);
  const spec = [
    ["Size", mm3(info.size_mm)], ["Packed", mm3(info.packed_mm)],
    ["Weight", info.weight_g && `${(info.weight_g / 1000).toFixed(2)} kg · ${(info.weight_g / 453.592).toFixed(1)} lb`],
    ["Units", info.units ? `${info.units}u` : info.span_half_units ? `${info.span_half_units / 2}u` : ""],
    ["Height", info.height_mm && `${info.height_mm} mm`], ["Seat height", info.seat_h_mm && `${info.seat_h_mm} mm`],
  ].filter(([, v]) => v);
  const site = p.url?.us || p.url?.jp;
  const notWith = Object.entries(info.not_with || {}).map(([s, why]) => {
    const q = PARTS[s] || Object.values(PARTS).find(x => core.baseSku(x.sku) === s);
    const r = REASON.find(([re]) => re.test(why || ""));
    return `<li>${q ? link(q.sku) : `<span class="chip">${esc(s)}</span>`}${r ? ` <span class="why">${r[1]}</span>` : ""}</li>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/web/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/web/icon-180.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Siqi's IGT Planner">
<meta property="og:title" content="${esc(`${p.title_en} (${p.sku})`)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${shot ? `${url}shot.jpg` : `${SITE}/web/og.png`}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>
:root { --bg: #f6f7f9; --panel: #fff; --ink: #172033; --dim: #5b6474; --line: #dfe3ea; --accent: #2563eb; --bad: #c2410c;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #14161a; --panel: #1b1e24; --ink: #e6e8ec; --dim: #9aa3b2; --line: #2b3038; --accent: #5b8def; --bad: #f08a5d; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 var(--sans); }
header, main, footer { max-width: 760px; margin: 0 auto; padding: 0 16px; }
header { display: flex; align-items: center; gap: .6rem; padding-top: 18px; padding-bottom: 6px; }
header a { display: inline-flex; align-items: center; gap: .55rem; color: var(--ink); text-decoration: none; font-weight: 650; }
header small { display: block; font-size: .7rem; font-weight: 500; color: var(--dim); line-height: 1; }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 1rem 0 .2rem; }
.sub { color: var(--dim); margin: 0 0 1rem; }
img.shot { display: block; width: 100%; height: auto; aspect-ratio: 1200 / 630; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); }
.acts { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
.btn { display: inline-flex; align-items: center; padding: .5rem .9rem; border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel); color: var(--ink); text-decoration: none; font-weight: 550; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1.2rem; margin: 1rem 0; }
dt { color: var(--dim); } dd { margin: 0; font-variant-numeric: tabular-nums; }
h2 { font-size: 1.05rem; margin: 1.6rem 0 .2rem; }
.where { color: var(--dim); font-size: .85rem; margin: .6rem 0 .3rem; }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; }
.chip { display: inline-block; padding: .15rem .6rem; border: 1px solid var(--line); border-radius: 999px; background: var(--panel);
  color: var(--ink); text-decoration: none; font-size: .85rem; }
a.chip:hover { border-color: var(--accent); color: var(--accent); }
ul.not { list-style: none; padding: 0; display: grid; gap: .35rem; }
.why { color: var(--bad); font-size: .85rem; }
footer { color: var(--dim); font-size: .8rem; padding-top: 2rem; padding-bottom: 2rem; }
footer a { color: var(--dim); }
</style>
</head>
<body>
<header><a href="/web/"><img src="/web/favicon.svg" width="30" height="30" alt=""><span><small>Siqi's</small>IGT Planner</span></a></header>
<main>
<h1>${esc(p.title_en)}</h1>
<p class="sub">${esc([p.title_jp, p.sku].filter(Boolean).join(" · "))}</p>
${shot ? `<img class="shot" src="shot.jpg" width="1200" height="630" alt="${esc(p.title_en)}, drawn by the planner">` : ""}
<div class="acts">
  <a class="btn primary" href="/web/#part=${encodeURIComponent(p.sku)}">Open in the planner</a>
  ${site ? `<a class="btn" href="${esc(site)}" rel="noopener">Snow Peak page</a>` : ""}
  ${p.manual ? `<a class="btn" href="${esc(p.manual)}" rel="noopener">Manual (PDF)</a>` : ""}
</div>
<dl>${spec.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
${groups("Fits onto", info.onto)}
${groups("Takes", info.takes)}
${p.role === "leg" ? `<p>A set of two legs. A frame stands on two sets.</p>` : ""}
${notWith ? `<h2>Its manual says: not with</h2><ul class="not">${notWith}</ul>` : ""}
</main>
<footer>
<p>What fits where is read off the planner's rules — the same ones that check a layout as you build it.
Sizes and weights are Snow Peak's published figures. Not affiliated with Snow Peak.</p>
<p><a href="/web/">Siqi's IGT Planner</a> · <a href="https://github.com/iqis/igt-planner">source</a></p>
</footer>
</body>
</html>
`;
}

// ---- the pictures: the public planner draws each part, once
const srv = spawn("py", [join(ROOT, "serve.py"), "--port", String(PORT), "--root", DIST], { stdio: "ignore" });
const shots = {};
try {
  await new Promise(r => setTimeout(r, 1500));
  const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const pg = await b.newPage();
    await pg.setViewport({ width: 1280, height: 800 });
    await pg.evaluateOnNewDocument(() => { localStorage.clear(); localStorage.setItem("igt-theme", "light"); localStorage.setItem("igt.lang", "en"); });
    await pg.goto(`http://127.0.0.1:${PORT}/web/`, { waitUntil: "networkidle2" });
    await pg.waitForFunction("window.__igt && window.__igt.state.nodes.length");
    await new Promise(r => setTimeout(r, 800));   // the procedural grains settle
    for (const p of parts) {
      const data = await pg.evaluate(s => window.__igt.partShot(s, 1200, 630, "image/jpeg"), p.sku);
      if (data) shots[p.sku] = Buffer.from(data.split(",")[1], "base64");
    }
  } finally { await b.close(); }
} finally { srv.kill(); }

// ---- the pages
for (const p of parts) {
  const dir = join(DIST, "p", p.sku);
  mkdirSync(dir, { recursive: true });
  if (shots[p.sku]) writeFileSync(join(dir, "shot.jpg"), shots[p.sku]);
  writeFileSync(join(dir, "index.html"), page(p, core.partInfo(p.sku), !!shots[p.sku]));
}
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/web/</loc><lastmod>${today}</lastmod></url>
${parts.map(p => `  <url><loc>${SITE}/p/${encodeURIComponent(p.sku)}/</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>
`);
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`part pages: ${parts.length}, pictures: ${Object.keys(shots).length}`);
