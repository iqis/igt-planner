import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { materialFor, roundedBox, boardMaterial, flatRect,
         boardFromOutline, grainMaterial } from "./materials.js";
import { moduleGroup } from "./parts3d.js";

/* The bench.
 *
 * One part, alone, at the origin, in ITS OWN coordinates -- no layout, no host, no
 * rotation. Next to it, the photograph it was measured from, with the measurements drawn
 * back ONTO the photograph in the same frame.
 *
 * That last part is the whole point. Every number in this project comes off a photo, and
 * up to now the only way to check one was to build a layout and squint at it. Here the
 * claim and the evidence sit side by side: if the red dots are not on the hooks, the
 * detector is wrong; if the model does not look like the photo, the model is wrong. You
 * can tell which without reasoning about it.
 *
 * Both panes use the same frame:  +x RIGHT, +z DOWN (as you look down at the part).
 */

const MM = 0.001;
const $ = id => document.getElementById(id);

const CAT = await (await fetch("../catalog/igt-catalog.json")).json();
const COLORS = (await (await fetch("../catalog/colors.json")).json()).colors;
const TEXTURES = (await (await fetch("../catalog/textures.json")).json()).textures;
const IMAGES = (await (await fetch("../catalog/images.json")).json()).images;
// What a human has SAID an image is. A declared view beats a guessed one, and this is the
// file that records the difference. Absent until someone looks.
const VIEWS = await fetch("../catalog/views.json")
  .then(r => r.ok ? r.json() : { views: {} }).then(d => d.views || {}).catch(() => ({}));

const PARTS = Object.fromEntries(CAT.parts.map(p => [p.sku, p]));
const swatchOf = sku => COLORS[sku]?.color_hex || "#8a929c";

const texLoader = new THREE.TextureLoader();
const texCache = {};
const textureOf = (sku, key = "file") => {
  const path = TEXTURES[sku]?.[key];
  if (!path) return null;
  if (!texCache[path]) texCache[path] = texLoader.load(path);
  return texCache[path];
};

// The axis a set of measured points sits on. Same rule as the planner uses, so what you
// see here is what the layout will do with it.
function axisOf(pts) {
  if (!pts?.length) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const mz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return Math.abs(mx) >= Math.abs(mz) ? { x: Math.sign(mx), z: 0 } : { x: 0, z: Math.sign(mz) };
}
const nameAxis = a => !a ? "—"
  : a.x === 1 ? "+x (right)" : a.x === -1 ? "-x (left)"
  : a.z === 1 ? "+z (near)" : "-z (far)";

// ---------------------------------------------------------------- scene

const canvas = $("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(35, 1, 0.02, 40);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x33383f, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(1.4, 2.6, 1.2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.7);
fill.position.set(-1.2, -2.2, -1.0);      // from below, so the underside is readable
scene.add(fill);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const stage = new THREE.Group();
scene.add(stage);

const stock = (geo, color, metalness = 0.9, roughness = 0.3) =>
  new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, metalness, roughness }));

const show = { photo: true, hooks: true, legs: true, grid: true };
let sku = null;

// ---------------------------------------------------------------- draw

function drawPart() {
  stage.clear();
  const p = PARTS[sku];
  const box = p.assembled_mm;
  if (!box) return;

  const t = TEXTURES[sku] || {};
  const thick = box.h ?? 25;
  const grain = textureOf(sku, "grain");

  // Only a CORNER is genuinely not a rectangle; trace its silhouette. Everything else flat --
  // extension tables, inserts, lids -- is a published rectangle, so build it from its
  // dimensions and put the photo on it. Tracing a rectangle from a pale photo was the whole
  // source of the torn shapes.
  const ring = p.role === "corner" ? TEXTURES[sku]?.outline_mm : null;

  // A part with a real 3D form -- a burner, a box, a mesh tray -- comes from the SAME shared
  // builder the planner uses. Before this, the bench drew every non-board part as a flat slab
  // of its bounding box, which is why so much of the catalog looked like untextured cubes.
  const built = !ring && !grain ? moduleGroup(p, box.w, box.d, thick, swatchOf(sku)) : null;
  if (built) {
    stage.add(built.group);
  } else {
    const geo = ring ? boardFromOutline(ring, thick * MM)
                     : flatRect(box.w * MM, box.d * MM, thick * MM, 8 * MM);
    const board = new THREE.Mesh(geo, grain
      ? grainMaterial(p, COLORS, grain, box.w, box.d, false)
      : materialFor(p, COLORS, false));
    board.position.y = 0;                       // flatRect / boardFromOutline hang from the top
    stage.add(board);

    const tex = textureOf(sku);
    if (show.photo && tex) {
      const decal = new THREE.Mesh(
        ring ? boardFromOutline(ring, 0.4 * MM) : flatRect(box.w * MM, box.d * MM, 0.4 * MM, 8 * MM),
        boardMaterial(p, COLORS, tex, box.w * MM, box.d * MM, false),
      );
      decal.position.y = 0.5 * MM;
      stage.add(decal);
    }
  }

  // Hooks hang DOWN off the edge; brackets sit ON the surface. Both drawn at the exact
  // millimetres they were measured at, so they should land on their own photographs.
  if (show.hooks) for (const [x, z] of t.hooks_mm || []) {
    const pin = stock(new THREE.CylinderGeometry(5 * MM, 5 * MM, 26 * MM, 10), 0xff6b5a, 0.3, 0.5);
    pin.position.set(x, -thick - 11, z).multiplyScalar(MM);
    stage.add(pin);
  }

  if (show.legs) for (const [x, z] of t.legs_mm || []) {
    const br = stock(roundedBox(58 * MM, 7 * MM, 44 * MM, 1 * MM), 0x5aa9ff, 0.3, 0.5);
    br.position.set(x, 4, z).multiplyScalar(MM);
    stage.add(br);
    const leg = stock(new THREE.CylinderGeometry(12.5 * MM, 12.5 * MM, 90 * MM, 12), 0x5aa9ff, 0.3, 0.5);
    leg.position.set(x, -thick - 45, z).multiplyScalar(MM);
    stage.add(leg);
  }

  // A 100mm grid on the work surface, and the two axes named. Without this "which way is
  // +x" is a thing you have to go and look up, which is how orientation bugs survive.
  if (show.grid) {
    const g = new THREE.GridHelper(2, 20, 0x3a414c, 0x252a31);
    g.position.y = 0.4 * MM;
    stage.add(g);
    for (const [dir, col] of [[[1, 0], 0xd8813f], [[0, 1], 0x6fa8dc]]) {
      const pts = [new THREE.Vector3(0, 1 * MM, 0),
                   new THREE.Vector3(dir[0] * (box.w / 2 + 90) * MM, 1 * MM, dir[1] * (box.d / 2 + 90) * MM)];
      stage.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: col })));
    }
  }

  const r = Math.max(box.w, box.d) * MM;
  camera.far = r * 20;
  camera.updateProjectionMatrix();
  controls.target.set(0, -thick / 2 * MM, 0);
}

// ---------------------------------------------------------------- views

const CAM = {
  top:    () => [0, 1, 0],
  bottom: () => [0, -1, 0],
  front:  () => [0, 0.25, 1],
  "3/4":  () => [0.75, 0.7, 0.9],
};
let view = "top";

function setView(v) {
  view = v;
  const box = PARTS[sku].assembled_mm;
  const r = Math.max(box.w, box.d, 400) * MM * 3.2;
  const [x, y, z] = CAM[v]();
  const L = Math.hypot(x, y, z);
  // Looking straight up or down, `up` must not be the axis you are looking along, or
  // lookAt degenerates and the view spins to some arbitrary heading. Point it at -z, so
  // BOTH plan views come out with +x right and +z down -- the frame the photo pane uses.
  camera.up.set(0, 0, v === "top" || v === "bottom" ? -1 : 1);
  if (v !== "top" && v !== "bottom") camera.up.set(0, 1, 0);
  camera.position.set((x / L) * r, (y / L) * r + controls.target.y, (z / L) * r);
  controls.update();
  paintChrome();
}

// ---------------------------------------------------------------- the photograph

/** Draw the measurements back onto the photograph they came from. */
function paintPhoto() {
  const t = TEXTURES[sku] || {};
  const img = $("photo");
  const svg = $("marks");
  svg.innerHTML = "";

  if (!t.file || !t.board_frac) {
    img.removeAttribute("src");
    $("photohint").textContent = "— none in the gallery";
    $("shot").style.display = "none";
    return;
  }
  $("shot").style.display = "";
  $("photohint").textContent = `— aspect ${t.aspect} vs ${t.wanted} wanted`;
  img.src = t.file;

  const box = PARTS[sku].assembled_mm;
  const [fx0, fy0, fx1, fy1] = t.board_frac;

  // mm (origin at the board's centre) -> fraction of the image. The image is cropped to
  // the whole silhouette; the millimetres are measured off the BOARD. board_frac is the
  // one bridging the two, and it is why the dots land on the hardware instead of near it.
  const W = 1000, H = 1000 * (img.naturalHeight || 1) / (img.naturalWidth || 1);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const U = x => (fx0 + (x / box.w + 0.5) * (fx1 - fx0)) * W;
  const V = z => (fy0 + (z / box.d + 0.5) * (fy1 - fy0)) * H;

  const el = (tag, attrs) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
    return e;
  };

  if (t.outline_mm)
    el("polygon", { class: "mk-out",
      points: t.outline_mm.map(([x, z]) => `${U(x)},${V(z)}`).join(" ") });

  el("line", { class: "mk-axis", x1: U(-box.w / 2), y1: V(0), x2: U(box.w / 2), y2: V(0) });
  el("line", { class: "mk-axis", x1: U(0), y1: V(-box.d / 2), x2: U(0), y2: V(box.d / 2) });

  for (const [x, z] of t.hooks_mm || []) {
    el("circle", { class: "mk-hook", cx: U(x), cy: V(z), r: 9 });
    el("text", { class: "mk-lab", x: U(x) + 12, y: V(z) + 3 }).textContent = `${x},${z}`;
  }
  for (const [x, z] of t.legs_mm || []) {
    el("rect", { class: "mk-leg", x: U(x) - 11, y: V(z) - 8, width: 22, height: 16, rx: 2 });
    el("text", { class: "mk-lab", x: U(x) + 15, y: V(z) + 3 }).textContent = `${x},${z}`;
  }
}

/** Every photograph Snow Peak publishes of this part.
 *
 *  Each carries Snow Peak's OWN tag (a001, a099, alt_02...) because that is the only
 *  stable name an image has, and it is what you point at when you say what it is. Say it
 *  and it goes in views.json; make_textures.py then uses the declared view instead of
 *  guessing the plan shot by matching silhouette aspect to published w:d.
 *
 *  The one currently being measured from is marked. Click any image to open it full size.
 */
function paintGallery() {
  const el = $("gallery"); el.innerHTML = "";
  const rec = IMAGES[sku] || {};
  const used = TEXTURES[sku]?.source;
  const said = VIEWS[sku] || {};

  if (!rec.images?.length) {
    el.innerHTML = `<div class="note">No photographs in the catalog for this part.</div>`;
    return;
  }
  for (const im of rec.images) {
    const a = document.createElement("a");
    a.className = "thumb" + (im.url === used ? " used" : "");
    a.href = im.url; a.target = "_blank"; a.rel = "noreferrer";
    const view = said[im.tag];
    a.innerHTML = `<img src="${im.url}" loading="lazy" alt="">`
      + `<span class="tag">${im.source}·${im.tag.replace(/\.(jpg|jpeg|png)$/i, "")}</span>`
      + (view ? `<span class="said">${view}</span>` : "")
      + (im.url === used ? `<span class="using">measured</span>` : "");
    a.title = view ? `you said: ${view}` : "unlabelled — tell me what this is";
    el.append(a);
  }
}

function paintLinks() {
  const el = $("links"); el.innerHTML = "";
  const p = PARTS[sku];
  const man = IMAGES[sku]?.manual;
  const link = (label, href, title) => {
    if (!href) return;
    const a = document.createElement("a");
    a.className = "chip"; a.href = href; a.target = "_blank"; a.rel = "noreferrer";
    a.textContent = label; a.title = title || href;
    el.append(a);
  };
  link("snowpeak.com", p.url?.us);
  link("ec.snowpeak.co.jp", p.url?.jp);
  link("manual (pdf)", man, "the only place Snow Peak documents assembly");
  if (!p.url?.us && !p.url?.jp) el.innerHTML = `<span class="muted">no product page</span>`;
}

const MM3 = b => b ? `${b.w}×${b.d}×${b.h}mm` : null;
// A relationship field may be an array (attaches_to: [...]) OR a plain string (the TTA
// ecosystem sets attaches_to to one). Coerce, so the bench does not throw on a string.
const list = v => (Array.isArray(v) ? v.join(", ") : v) || null;
const money = p => [
  p.us && `US $${(p.us / 100).toFixed(0)}`,
  p.jp && `JP ¥${p.jp.toLocaleString()}`,
  p.uk && `UK £${(p.uk / 100).toFixed(0)}`,
].filter(Boolean).join("  ·  ") || null;

/** Everything the catalog holds, and nothing invented. A field it does not have is shown
 *  as absent, not filled in with a plausible number. */
function paintFacts() {
  const p = PARTS[sku];
  const t = TEXTURES[sku] || {};
  const hook = axisOf(t.hooks_mm);
  const leg = axisOf(t.legs_mm);
  const turns = hook && leg && (hook.x !== -leg.x || hook.z !== -leg.z);

  const row = (k, v, cls = "") => v == null || v === "" ? ""
    : `<div class="row ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const gap = k => `<div class="row none"><span>${k}</span><b>not published</b></div>`;

  $("facts").innerHTML =
    row("sku", p.sku)
    + row("title (jp)", p.title_jp)
    + row("role", p.role)
    + row("attach", p.attach ?? null) + (p.attach ? "" : gap("attach"))
    + row("system", p.system)
    + row("assembled", MM3(p.assembled_mm)) + (p.assembled_mm ? "" : gap("assembled"))
    + row("packed", MM3(p.packed_mm)) + (p.packed_mm ? "" : gap("packed"))
    + row("weight", p.weight_g ? `${(p.weight_g / 1000).toFixed(2)} kg` : null)
      + (p.weight_g ? "" : gap("weight"))
    + row("material", p.material) + (p.material ? "" : gap("material"))
    + row("price", money(p.price || {}))
    + row("in stock", p.available === undefined ? null : (p.available ? "yes" : "no"))
    + row("span", p.span ? `${p.span / 2} unit${p.span === 2 ? "" : "s"}` : null)
    + row("span from", p.span_source)
    + row("along rail", p.along_rail_mm ? `${p.along_rail_mm}mm` : null)
    + row("fit vs slot", p.fit_delta_mm ? `${p.fit_delta_mm > 0 ? "+" : ""}${p.fit_delta_mm}mm` : null)
    + row("units", p.units)
    + row("height", p.height_mm ? `${p.height_mm}mm` : null)
    + row("needs legs", p.needs_legs === undefined ? null : (p.needs_legs ? "yes" : "no"))
    + row("contains", list(p.contains))
    + row("attaches to", list(p.attaches_to))
    + row("connects to", list(p.connects_to))
    + row("mounts", p.mounts)
    + row("mounted by", p.mounted_by)
    + (p.excluded ? row("excluded", "yes — not in the planner", "none") : "")
    + row("barcode", p.barcode)
    + row("collections", (p.collections || []).join(", ") || null)
    + row("hook edge", nameAxis(hook), hook ? "hook" : "none")
    + row("bracket edge", nameAxis(leg), leg ? "leg" : "none")
    + row("hooks", (t.hooks_mm || []).map(h => `[${h}]`).join(" ") || "not measured",
        t.hooks_mm?.length ? "hook" : "none")
    + row("brackets", (t.legs_mm || []).map(l => `[${l}]`).join(" ") || "not measured",
        t.legs_mm?.length ? "leg" : "none")
    + (p.attach_evidence ? `<div class="note quote">“${p.attach_evidence}”</div>` : "")
    + (p.span_evidence ? `<div class="note quote">“${p.span_evidence}”</div>` : "")
    + (p.curated_reason ? `<div class="note">curated: ${p.curated_reason}</div>` : "")
    + (hook && leg
        ? `<div class="note">${turns
            ? "Hook edge and bracket edge are PERPENDICULAR — this part turns the run 90°."
            : "Hook edge and bracket edge are opposite — the run carries straight on."}</div>`
        : `<div class="note">Without both edges the planner cannot orient this part, and it `
          + `will not guess. It is listed but unplaceable.</div>`);
}

function paintChrome() {
  const bar = $("viewbar"); bar.innerHTML = "";
  const chip = (label, on, fn, title) => {
    const b = document.createElement("button");
    b.className = "chip" + (on ? " on" : "");
    b.textContent = label; b.title = title || "";
    b.onclick = fn; bar.append(b);
  };
  for (const v of Object.keys(CAM)) chip(v, view === v, () => setView(v));
  chip("photo", show.photo, () => { show.photo = !show.photo; redraw(); },
    "the plan view, laid under the board");
  chip("hooks", show.hooks, () => { show.hooks = !show.hooks; redraw(); });
  chip("brackets", show.legs, () => { show.legs = !show.legs; redraw(); });

  $("axes").innerHTML = `<b>+x</b> → right &nbsp; <b>+z</b> → toward you<br>`
    + `grid 100mm · the photo pane uses the same frame`;
}

function paintList() {
  const el = $("parts"); el.innerHTML = "";
  const groups = [
    ["hook-on boards", p => p.role === "extension_table" || p.role === "corner"],
    ["slot modules", p => p.role === "slot_module"],
    ["frames", p => p.role === "frame"],
    ["everything else", p => !["extension_table", "corner", "slot_module", "frame"].includes(p.role)],
  ];
  for (const [name, test] of groups) {
    const ps = CAT.parts.filter(p => p.assembled_mm && test(p));
    if (!ps.length) continue;
    const h = document.createElement("div");
    h.className = "grp"; h.textContent = name; el.append(h);
    for (const p of ps) {
      const d = document.createElement("div");
      d.className = "part" + (p.sku === sku ? " on" : "");
      const has = TEXTURES[p.sku]?.hooks_mm?.length ? "◉" : TEXTURES[p.sku] ? "○" : "";
      d.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
        + `<span class="nm">${p.title_en}</span><span class="sp">${has}</span>`;
      d.title = `${p.sku} — ◉ measured fittings, ○ photo only`;
      d.onclick = () => select(p.sku);
      el.append(d);
    }
  }
}

function redraw() { drawPart(); paintChrome(); }

function select(next) {
  sku = next;
  drawPart();
  setView(view);
  paintList();
  paintPhoto();
  paintGallery();
  paintLinks();
  paintFacts();
  history.replaceState(null, "", `?sku=${sku}`);
  $("detail").scrollTop = 0;
}

// ---------------------------------------------------------------- boot

function resize() {
  const r = $("stage").getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();

resize();
select(new URLSearchParams(location.search).get("sku") || "CK-119TR");

window.__bench = { THREE, scene, camera, controls, PARTS, TEXTURES, select, setView, show, redraw };
