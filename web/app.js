import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Everything is in millimetres, then scaled once on the way into the scene. The
// catalog speaks mm; converting at the boundary keeps every number below readable
// against the spec table it came from.
const MM = 0.001;

const FRAME_THICK = 30;   // frame slab; the rails a module hangs from
const RAIL_SPAN = 360;    // default depth when a part does not state one
const LEG_R = 13;

// Prices are stored in minor units per region. Rates are for orientation only.
const TO_USD = { us: c => c / 100, jp: y => y / 157, uk: p => (p / 100) * 1.27 };

const MATERIALS = [
  [/竹|bamboo/i, 0xb98b53],
  [/ステンレス|stainless/i, 0xb9c0c9],
  [/アルミ|alumin/i, 0x9aa3ad],
  [/鋳鉄|鉄|iron|steel/i, 0x59606b],
  [/ポリエステル|ナイロン|polyester|nylon/i, 0x5c6b63],
];
const colorFor = m => (MATERIALS.find(([re]) => re.test(m || "")) || [null, 0x8a929c])[1];

const $ = id => document.getElementById(id);

let CAT, GRID, HALF, PARTS;
const state = { frame: "CK-150", leg: "CK-114", top: null, placed: [] };

// ---------------------------------------------------------------- geometry

const unitsOf = sku => PARTS[sku]?.units || 0;
const runMM = () => unitsOf(state.frame) * 250;          // the usable rail length
const slots = () => unitsOf(state.frame) * 2;            // in half-units
const legH = () => PARTS[state.leg]?.height_mm || 0;
const frameTop = () => legH() + FRAME_THICK;

/** A part's size along the rail. The catalog already resolved which axis that is --
 *  the JP spec table writes dimensions longest-first, so it is not always `w`. */
function railW(p) {
  return p.along_rail_mm || (p.span ? p.span * HALF : (p.assembled_mm?.w ?? HALF));
}
function depthOf(p) {
  const a = p.assembled_mm;
  if (!a) return RAIL_SPAN;
  return Math.abs(a.w - railW(p)) < 1 ? a.d : a.w;
}

/** Left edge of half-slot i, in mm, with the frame centred on the origin. */
const slotX = i => -runMM() / 2 + i * HALF;

function occupancy() {
  const cells = new Array(slots()).fill(null);
  for (const pl of state.placed)
    for (let i = pl.start; i < pl.start + pl.span && i < cells.length; i++) cells[i] = pl;
  return cells;
}

/** First run of `span` free half-slots, or -1. */
function firstFit(span, ignore = null) {
  const cells = occupancy();
  for (let s = 0; s + span <= cells.length; s++) {
    let ok = true;
    for (let i = s; i < s + span; i++) if (cells[i] && cells[i] !== ignore) { ok = false; break; }
    if (ok) return s;
  }
  return -1;
}

function canPlaceAt(start, span, ignore) {
  if (start < 0 || start + span > slots()) return false;
  const cells = occupancy();
  for (let i = start; i < start + span; i++) if (cells[i] && cells[i] !== ignore) return false;
  return true;
}

// ---------------------------------------------------------------- scene

const canvas = $("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
camera.position.set(1.15, 1.05, 1.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x33383f, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(2, 3.4, 1.8);
scene.add(key);

const floor = new THREE.GridHelper(6, 24, 0x2b3038, 0x21252b);
scene.add(floor);

const build = new THREE.Group();   // everything that a state change rebuilds
scene.add(build);

const box = (w, h, d, color, opts = {}) => new THREE.Mesh(
  new THREE.BoxGeometry(w * MM, h * MM, d * MM),
  new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.12, ...opts }),
);

const draggable = [];   // meshes carrying a .placement

function rebuild() {
  build.clear();
  draggable.length = 0;

  const f = PARTS[state.frame];
  const n = unitsOf(state.frame);
  const outerW = 250 * n + (GRID.families?.standard?.end_overhead_mm ?? 96);
  const depth = f.assembled_mm?.d ?? 496;
  const top = frameTop();

  // Frame: drawn as two rails plus two ends, so the units read as openings rather
  // than as a solid slab -- which is what they are. There are no dividers.
  const railD = (depth - RAIL_SPAN) / 2;
  const alu = 0x8f979f;
  for (const z of [-(RAIL_SPAN + railD) / 2, (RAIL_SPAN + railD) / 2]) {
    const rail = box(outerW, FRAME_THICK, railD, alu);
    rail.position.set(0, (top - FRAME_THICK / 2) * MM, z * MM);
    build.add(rail);
  }
  for (const x of [-(outerW - 48) / 2, (outerW - 48) / 2]) {
    const end = box(48, FRAME_THICK, RAIL_SPAN, alu);
    end.position.set(x * MM, (top - FRAME_THICK / 2) * MM, 0);
    build.add(end);
  }

  // Unit ticks along the front rail: the 250mm grid, made visible.
  for (let i = 1; i < n; i++) {
    const tick = box(3, FRAME_THICK + 1, railD, 0x596069);
    tick.position.set((slotX(i * 2)) * MM, (top - FRAME_THICK / 2) * MM, -(RAIL_SPAN + railD) / 2 * MM);
    build.add(tick);
  }

  // Legs
  const leg = PARTS[state.leg];
  if (leg?.height_mm) {
    const h = leg.height_mm;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(LEG_R * MM, LEG_R * MM, h * MM, 12),
        new THREE.MeshStandardMaterial({ color: 0x767d86, roughness: 0.5, metalness: 0.3 }),
      );
      m.position.set(sx * (outerW / 2 - 40) * MM, (h / 2) * MM, sz * (depth / 2 - 40) * MM);
      build.add(m);
    }
  }

  // Slot modules. Each is drawn at its OWN width, centred in the slots it claims --
  // so a tray that is 5mm narrower than its unit shows a real gap, and a burner whose
  // rim is 20mm wider really does overlap the rails. Stretching parts to fill their
  // allocation would hide exactly the thing worth seeing.
  for (const pl of state.placed) {
    const p = PARTS[pl.sku];
    const alloc = pl.span * HALF;
    const cx = slotX(pl.start) + alloc / 2;
    const w = railW(p), d = depthOf(p), h = p.assembled_mm?.h ?? 40;
    const onTop = p.role === "full_top";

    const m = box(w, h, d, colorFor(p.material));
    m.position.set(cx * MM, (onTop ? top + h / 2 : top - h / 2) * MM, 0);
    m.userData.placement = pl;
    build.add(m);
    draggable.push(m);
  }
}

// ---------------------------------------------------------------- drag

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let dragging = null;

const toPtr = e => {
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};

canvas.addEventListener("pointerdown", e => {
  toPtr(e);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(draggable, false)[0];
  if (!hit) return;
  dragging = hit.object.userData.placement;
  controls.enabled = false;
});

canvas.addEventListener("pointermove", e => {
  if (!dragging) return;
  toPtr(e);
  ray.setFromCamera(ptr, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -frameTop() * MM);
  const at = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, at)) return;

  // Snap to the half-unit grid: the atom of the system.
  const x = at.x / MM;
  const start = Math.round((x + runMM() / 2 - (dragging.span * HALF) / 2) / HALF);
  if (start !== dragging.start && canPlaceAt(start, dragging.span, dragging)) {
    dragging.start = start;
    rebuild();
    paint();
  }
});

addEventListener("pointerup", () => { dragging = null; controls.enabled = true; });

// ---------------------------------------------------------------- ui

function place(sku) {
  const p = PARTS[sku];
  const span = p.role === "full_top" ? p.covers_units * 2 : p.span;
  const start = firstFit(span);
  if (start < 0) return false;
  if (p.role === "full_top") state.placed = state.placed.filter(x => PARTS[x.sku].role !== "full_top");
  state.placed.push({ sku, span, start });
  return true;
}

function partRow(p, onClick) {
  const el = document.createElement("div");
  el.className = "part";
  const span = p.role === "full_top" ? p.covers_units * 2 : p.span;
  el.innerHTML = `<span class="sw" style="background:#${colorFor(p.material).toString(16).padStart(6, "0")}"></span>`
    + `<span class="nm">${p.title_en}</span>`
    + `<span class="sp">${span / 2}u</span>`;
  el.onclick = () => onClick(p);
  return el;
}

function paintPalette() {
  const frames = $("frames"); frames.innerHTML = "";
  for (const p of PARTS_BY_ROLE.frame) {
    const c = document.createElement("button");
    c.className = "chip" + (state.frame === p.sku ? " on" : "");
    c.textContent = `${p.units}u${p.collapsible ? " ⤢" : ""}`;
    c.title = p.title_en;
    c.onclick = () => { state.frame = p.sku; state.placed = []; state.top = null; render(); };
    frames.append(c);
  }

  const legs = $("legs"); legs.innerHTML = "";
  for (const p of PARTS_BY_ROLE.leg.sort((a, b) => a.height_mm - b.height_mm)) {
    const c = document.createElement("button");
    c.className = "chip" + (state.leg === p.sku ? " on" : "");
    c.textContent = `${p.height_mm}`;
    c.title = p.title_en;
    c.onclick = () => { state.leg = p.sku; render(); };
    legs.append(c);
  }

  const tops = $("tops"); tops.innerHTML = "";
  for (const p of PARTS_BY_ROLE.full_top) {
    const el = partRow(p, () => { if (place(p.sku)) render(); });
    if (p.covers_units * 2 > slots()) el.classList.add("dead");
    tops.append(el);
  }

  const mods = $("modules"); mods.innerHTML = "";
  for (const p of PARTS_BY_ROLE.slot_module) {
    const el = partRow(p, () => { if (place(p.sku)) render(); });
    if (firstFit(p.span) < 0) el.classList.add("dead");
    mods.append(el);
  }
}

function paintSlots() {
  const bar = $("slotbar"); bar.innerHTML = "";
  const cells = occupancy();
  for (const c of cells) {
    const d = document.createElement("div");
    d.className = "cell" + (c ? (PARTS[c.sku].role === "full_top" ? " top" : " used") : "");
    bar.append(d);
  }
}

function paintBOM() {
  const rows = [
    { sku: state.frame, kind: "frame" },
    { sku: state.leg, kind: "legs" },
    ...state.placed.map(pl => ({ sku: pl.sku, pl })),
  ];

  // A collapsible frame is inert without its rails: they are a separate SKU and the
  // build is not buildable if you forget them, so the BOM adds them rather than
  // letting a plan quietly ship incomplete.
  const req = PARTS[state.frame]?.requires_rails;
  if (req && PARTS[req]) rows.splice(1, 0, { sku: req, kind: "required" });

  const t = $("bomtable"); t.innerHTML = "";
  const tot = { us: 0, jp: 0, uk: 0, g: 0 };
  let missing = false;

  for (const r of rows) {
    const p = PARTS[r.sku];
    const tr = document.createElement("tr");
    for (const k of ["us", "jp", "uk"]) {
      if (p.price[k]) tot[k] += TO_USD[k](p.price[k]);
      else if (k === "us") missing = true;
    }
    tot.g += p.weight_g || 0;

    const usd = p.price.us ? "$" + TO_USD.us(p.price.us).toFixed(0) : "—";
    tr.innerHTML = `<td class="x">${r.pl ? "×" : ""}</td>`
      + `<td class="nm" title="${p.sku} — ${p.title_en}">${p.title_en}</td>`
      + `<td class="p">${usd}</td>`;
    if (r.pl) tr.querySelector(".x").onclick = () => {
      state.placed = state.placed.filter(x => x !== r.pl);
      render();
    };
    t.append(tr);
  }

  const cheapest = ["us", "jp", "uk"].filter(k => tot[k] > 0).sort((a, b) => tot[a] - tot[b])[0];
  const box = $("totals");
  box.innerHTML = `
    <div class="row"><span>weight</span><b>${(tot.g / 1000).toFixed(1)} kg</b></div>
    ${["us", "jp", "uk"].map(k => {
      const d = tot.us ? ((tot[k] - tot.us) / tot.us) * 100 : 0;
      const cls = k === "us" ? "" : d < 0 ? "cheap" : "dear";
      const pct = k === "us" ? "" : ` (${d > 0 ? "+" : ""}${d.toFixed(0)}%)`;
      return `<div class="row ${k === cheapest ? "big" : ""}"><span>${k.toUpperCase()}</span>`
        + `<b class="${cls}">$${tot[k].toFixed(0)}${pct}</b></div>`;
    }).join("")}
    <div class="note">JP/UK converted at fixed rates for orientation, not for
      checkout.${missing ? " Some parts have no US price." : ""}</div>`;
}

function paintWarnings() {
  const w = $("warnings"); w.innerHTML = "";
  const used = occupancy().filter(Boolean).length;
  const add = (msg, cls = "warn") => {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = msg;
    w.append(d);
  };

  const req = PARTS[state.frame]?.requires_rails;
  if (req) add(`This frame folds — it needs ${req} rails, which are sold separately. Added to the build.`, "warn info");
  if (used === slots() && slots()) add(`Full: ${used}/${slots()} half-slots.`, "warn info");
}

function paint() { paintSlots(); paintBOM(); paintWarnings(); paintPalette(); }
function render() { rebuild(); paint(); }

// ---------------------------------------------------------------- boot

let PARTS_BY_ROLE;

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

const res = await fetch("../catalog/igt-catalog.json");
CAT = await res.json();
GRID = CAT.grid;
HALF = GRID.half_unit_mm;

PARTS = Object.fromEntries(CAT.parts.map(p => [p.sku, p]));

// Collapsible frames name their rails by convention: CK-903 -> CK-903-1.
for (const p of CAT.parts) {
  if (p.role !== "frame") continue;
  const rails = `${p.sku}-1`;
  if (PARTS[rails]) { p.requires_rails = rails; p.collapsible = true; }
}

const by = r => CAT.parts.filter(p => p.role === r);
PARTS_BY_ROLE = {
  frame: by("frame").filter(p => p.units).sort((a, b) => a.units - b.units || a.sku.localeCompare(b.sku)),
  leg: by("leg").filter(p => p.height_mm),
  full_top: by("full_top").filter(p => p.covers_units),
  // Only parts whose span is actually known can be placed on a grid.
  slot_module: by("slot_module").filter(p => p.span && p.assembled_mm)
    .sort((a, b) => a.span - b.span || a.title_en.localeCompare(b.title_en)),
};

resize();
render();
