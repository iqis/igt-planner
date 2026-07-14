import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { materialFor, roundedBox, railProfile, meshWires, isMesh,
         quarterRound, angleBoard } from "./materials.js";

// Millimetres everywhere, scaled once on the way into the scene. The catalog speaks
// mm; converting at the boundary keeps every number here readable against the spec
// table it came from.
const MM = 0.001;

const FRAME_THICK = 30;
const RAIL_SPAN = 360;
const LEG_R = 13;
const SNAP = 25;        // ground grid the tables slide on
const TOUCH = 30;       // two tables closer than this are connected

const TO_USD = { us: c => c / 100, jp: y => y / 157, uk: p => (p / 100) * 1.27 };

const $ = id => document.getElementById(id);

let CAT, GRID, LAYOUT, HALF, PARTS, BY_ROLE, COLORS;

// Colours come from Snow Peak's product photography (catalog/colors.json). The swatch in
// the palette is the same colour the part is rendered in, so the two never drift.
const swatchOf = sku => COLORS[sku]?.color_hex || "#8a929c";

// A layout is a set of tables. An IGT frame is one kind of table -- the kind with a
// grid in it. Snow Peak calls the whole thing the Layout System, and the frame is a
// node in it, not the thing itself.
const state = { nodes: [], sel: null, nextId: 1 };

// ---------------------------------------------------------------- node geometry

const overhead = () => GRID.families?.standard?.end_overhead_mm ?? 96;

function footprint(n) {
  const p = PARTS[n.sku];
  if (n.kind === "frame") return { w: 250 * p.units + overhead(), d: p.assembled_mm?.d ?? 496 };
  const a = p.assembled_mm;
  return { w: a?.w ?? 496, d: a?.d ?? 496 };
}

/** Top surface height.
 *
 *  A hook-on table hangs from the frame's rail, so its surface is FLUSH with whatever it
 *  hooks to -- not (its own legs + its own 25mm top), which would sit 5mm proud of a
 *  30mm frame and trip the step-joint rule for a difference that does not exist. Its legs
 *  hold up the far end; they do not set its height.
 */
function topOf(n, seen = new Set()) {
  if (n.kind === "frame") return (PARTS[n.leg]?.height_mm ?? 0) + FRAME_THICK;
  if (n.kind === "ext") {
    seen.add(n.id);
    const host = neighbours(n).find(m => !seen.has(m.id));
    if (host) return topOf(host, seen);      // chainable: "the frame OR OTHER EXTENSION"
    return (PARTS[n.leg]?.height_mm ?? 0) + (PARTS[n.sku].assembled_mm?.h ?? 25);
  }
  return PARTS[n.sku].height_mm ?? PARTS[n.sku].assembled_mm?.h ?? LAYOUT.datum_height_mm;
}

/** World-space AABB, honouring the node's 90-degree rotation. */
function aabb(n) {
  const f = footprint(n);
  const turned = n.rot % 180 !== 0;
  const w = turned ? f.d : f.w, d = turned ? f.w : f.d;
  return { x0: n.x - w / 2, x1: n.x + w / 2, z0: n.z - d / 2, z1: n.z + d / 2, w, d };
}

/** Two tables are connected if their footprints touch. */
function neighbours(n) {
  const a = aabb(n);
  return state.nodes.filter(m => {
    if (m === n) return false;
    const b = aabb(m);
    const gapX = Math.max(a.x0 - b.x1, b.x0 - a.x1);
    const gapZ = Math.max(a.z0 - b.z1, b.z0 - a.z1);
    return gapX < TOUCH && gapZ < TOUCH && !(gapX > 0 && gapZ > 0);
  });
}

/** Every adjacency where the two tops sit at different heights. Each one needs a
 *  step joint (CK-151) -- that is what the part is for, and the only thing it is for. */
function steps() {
  const out = [];
  for (const n of state.nodes)
    for (const m of neighbours(n))
      if (n.id < m.id && Math.abs(topOf(n) - topOf(m)) > 5) out.push([n, m]);
  return out;
}

// ---------------------------------------------------------------- slots (per frame)

const slotsOf = n => PARTS[n.sku].units * 2;
const runOf = n => PARTS[n.sku].units * 250;
const slotX = (n, i) => -runOf(n) / 2 + i * HALF;

function railW(p) {
  return p.along_rail_mm || (p.span ? p.span * HALF : (p.assembled_mm?.w ?? HALF));
}
function depthOf(p) {
  const a = p.assembled_mm;
  if (!a) return RAIL_SPAN;
  return Math.abs(a.w - railW(p)) < 1 ? a.d : a.w;
}
const spanOf = p => p.span;

function occupancy(n) {
  const cells = new Array(slotsOf(n)).fill(null);
  for (const pl of n.placements)
    for (let i = pl.start; i < pl.start + pl.span && i < cells.length; i++) cells[i] = pl;
  return cells;
}
function firstFit(n, span, ignore = null) {
  const cells = occupancy(n);
  for (let s = 0; s + span <= cells.length; s++) {
    let ok = true;
    for (let i = s; i < s + span; i++) if (cells[i] && cells[i] !== ignore) { ok = false; break; }
    if (ok) return s;
  }
  return -1;
}
function canPlaceAt(n, start, span, ignore) {
  if (start < 0 || start + span > slotsOf(n)) return false;
  const cells = occupancy(n);
  for (let i = start; i < start + span; i++) if (cells[i] && cells[i] !== ignore) return false;
  return true;
}

// ---------------------------------------------------------------- scene

const canvas = $("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
camera.position.set(1.6, 1.5, 2.1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.35, 0);

scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x33383f, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 3.4, 1.8);
scene.add(key);
scene.add(new THREE.GridHelper(8, 32, 0x2b3038, 0x21252b));

// Metal cannot look like metal with nothing to reflect. Without an environment map a
// MeshStandardMaterial at metalness 0.9 renders nearly black; the flat, plasticky look
// the first pass had was not the colours, it was this.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const build = new THREE.Group();
scene.add(build);

/** A part, rendered: real colour, real light response, edges taken off. */
function partMesh(p, w, h, d, selected = false) {
  return new THREE.Mesh(
    roundedBox(w * MM, h * MM, d * MM, 2.2 * MM),
    materialFor(p, COLORS, selected),
  );
}

/** Structural stock (rails, ends, posts) -- not a catalog part, so it takes the frame's
 *  own colour and an anodised-aluminium response. */
const stock = (geo, color, metalness = 0.8, roughness = 0.42, emissive = 0x000000) =>
  new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, metalness, roughness, emissive: new THREE.Color(emissive),
  }));

const nodeMeshes = [];   // meshes carrying .node (for picking + dragging tables)
const slotMeshes = [];   // meshes carrying .placement (for dragging modules)

function drawFrame(g, n) {
  const p = PARTS[n.sku];
  const f = footprint(n);
  const top = topOf(n);
  const railD = (f.d - RAIL_SPAN) / 2;
  const sel = state.sel === n.id;
  const alu = new THREE.Color(swatchOf(n.sku));
  const glow = sel ? 0x2e1806 : 0x000000;

  // Two extruded rails and two ends -- not a slab. There are no dividers; a "unit" is a
  // 250mm notion along the run. The rail is a channel with a lip, which is what every
  // module actually hangs from, and most of why an IGT frame reads as an IGT frame.
  for (const z of [-(RAIL_SPAN + railD) / 2, (RAIL_SPAN + railD) / 2]) {
    const r = stock(railProfile(f.w * MM, FRAME_THICK * MM, railD * MM), alu, 0.8, 0.42, glow);
    r.rotation.y = z > 0 ? Math.PI : 0;
    r.position.set(0, top - FRAME_THICK / 2, z).multiplyScalar(MM);
    r.userData.node = n; g.add(r); nodeMeshes.push(r);
  }
  for (const x of [-(f.w - 48) / 2, (f.w - 48) / 2]) {
    const e = stock(roundedBox(48 * MM, FRAME_THICK * MM, RAIL_SPAN * MM, 2 * MM), alu, 0.8, 0.42, glow);
    e.position.set(x, top - FRAME_THICK / 2, 0).multiplyScalar(MM);
    e.userData.node = n; g.add(e); nodeMeshes.push(e);
  }
  for (let i = 1; i < p.units; i++) {
    const t = stock(roundedBox(3 * MM, (FRAME_THICK + 1) * MM, railD * MM, 0.4 * MM), 0x596069);
    t.position.set(slotX(n, i * 2), top - FRAME_THICK / 2, -(RAIL_SPAN + railD) / 2).multiplyScalar(MM);
    g.add(t);
  }

  // Legs: tapered tube with a foot, the way they actually are.
  const leg = PARTS[n.leg];
  if (leg?.height_mm) {
    const h = leg.height_mm;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const shaft = stock(
        new THREE.CylinderGeometry(LEG_R * MM, LEG_R * 0.82 * MM, h * MM, 16),
        new THREE.Color(swatchOf(n.leg)), 0.85, 0.3,
      );
      shaft.position.set(sx * (f.w / 2 - 40), h / 2, sz * (f.d / 2 - 40)).multiplyScalar(MM);
      g.add(shaft);
      const foot = stock(
        new THREE.CylinderGeometry(LEG_R * 1.25 * MM, LEG_R * 1.35 * MM, 12 * MM, 16),
        0x2a2d31, 0.1, 0.85,
      );
      foot.position.set(sx * (f.w / 2 - 40), 6, sz * (f.d / 2 - 40)).multiplyScalar(MM);
      g.add(foot);
    }
  }

  // Modules: drawn at their OWN width, centred in the slots they claim. A tray 5mm
  // narrower than its unit shows a real gap; the Flat Burner's 20mm-wider rim really
  // does overlap the rails. Stretching parts to fill their allocation would hide it.
  for (const pl of n.placements) {
    const p2 = PARTS[pl.sku];
    const cx = slotX(n, pl.start) + (pl.span * HALF) / 2;
    const w = railW(p2), d = depthOf(p2), h = p2.assembled_mm?.h ?? 40;
    const y = top - h / 2;   // modules drop IN; nothing sits on the frame any more

    const m = partMesh(p2, w, h, d);
    m.position.set(cx, y, 0).multiplyScalar(MM);
    m.userData.placement = pl; m.userData.node = n;
    g.add(m); slotMeshes.push(m);

    // A wire basket drawn as a block is wrong in a way no colour can fix. The ghost box
    // above stays as the drag target; the wires are what you see.
    if (isMesh(p2)) {
      const wires = meshWires(w, h, d, new THREE.Color(swatchOf(p2.sku)));  // mm; it scales itself
      wires.position.set(cx, y, 0).multiplyScalar(MM);
      g.add(wires);
    }
  }
}

function drawTable(g, n) {
  const p = PARTS[n.sku];
  const f = footprint(n);
  const top = topOf(n);
  const sel = state.sel === n.id;
  const thick = p.role === "corner" ? (p.assembled_mm?.h ?? 25) : 30;

  // The published size is a BOUNDING BOX, not a silhouette. A corner is a quarter round
  // and an angle extension is a splayed board; drawing either as its box is how they came
  // out as slabs.
  let geo;
  if (/corner/i.test(p.title_en)) geo = quarterRound(f.w * MM, thick * MM);
  else if (/angle/i.test(p.title_en)) geo = angleBoard(f.w * MM, f.d * MM, thick * MM, 200 * MM);
  else geo = roundedBox(f.w * MM, thick * MM, f.d * MM, 2.2 * MM);

  const m = new THREE.Mesh(geo, materialFor(p, COLORS, sel));
  m.position.set(0, top - thick / 2, 0).multiplyScalar(MM);
  m.userData.node = n; g.add(m); nodeMeshes.push(m);

  if (!p.needs_legs && n.kind !== "table") return;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = stock(
      new THREE.CylinderGeometry(10 * MM, 8 * MM, (top - thick) * MM, 14),
      new THREE.Color(swatchOf(n.sku)), 0.85, 0.32,
    );
    leg.position.set(sx * (f.w / 2 - 35), (top - thick) / 2, sz * (f.d / 2 - 35)).multiplyScalar(MM);
    g.add(leg);
  }
}

function rebuild() {
  build.clear();
  nodeMeshes.length = 0;
  slotMeshes.length = 0;

  for (const n of state.nodes) {
    const g = new THREE.Group();
    g.position.set(n.x * MM, 0, n.z * MM);
    g.rotation.y = (n.rot * Math.PI) / 180;
    (n.kind === "frame" ? drawFrame : drawTable)(g, n);
    build.add(g);
  }

  // Step joints, where two touching tables stand at different heights. Drawn as the
  // 320mm post the part actually is.
  for (const [a, b] of steps()) {
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    const hi = Math.max(topOf(a), topOf(b));
    const post = stock(
      new THREE.CylinderGeometry(12.7 * MM, 12.7 * MM, 320 * MM, 16),
      new THREE.Color(swatchOf("CK-151")), 0.85, 0.3,
    );
    post.position.set(mid.x * MM, (hi - 160) * MM, mid.z * MM);
    build.add(post);
  }
}

// ---------------------------------------------------------------- interaction

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let dragNode = null, dragMod = null, dragOff = new THREE.Vector3();

const toPtr = e => {
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};
const hitPlane = y => {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y * MM);
  const at = new THREE.Vector3();
  return ray.ray.intersectPlane(plane, at) ? at : null;
};

canvas.addEventListener("pointerdown", e => {
  toPtr(e);
  ray.setFromCamera(ptr, camera);

  const mod = ray.intersectObjects(slotMeshes, false)[0];
  if (mod) {
    dragMod = { pl: mod.object.userData.placement, node: mod.object.userData.node };
    state.sel = dragMod.node.id;
    controls.enabled = false;
    paint();
    return;
  }
  const nd = ray.intersectObjects(nodeMeshes, false)[0];
  if (nd) {
    dragNode = nd.object.userData.node;
    state.sel = dragNode.id;
    const at = hitPlane(0);
    if (at) dragOff.set(dragNode.x - at.x / MM, 0, dragNode.z - at.z / MM);
    controls.enabled = false;
    render();
  }
});

canvas.addEventListener("pointermove", e => {
  if (!dragNode && !dragMod) return;
  toPtr(e);
  ray.setFromCamera(ptr, camera);

  if (dragMod) {
    const { pl, node } = dragMod;
    const at = hitPlane(topOf(node));
    if (!at) return;
    // Undo the node's own rotation to get a position along its rail.
    const rad = (-node.rot * Math.PI) / 180;
    const lx = (at.x / MM - node.x) * Math.cos(rad) - (at.z / MM - node.z) * Math.sin(rad);
    const start = Math.round((lx + runOf(node) / 2 - (pl.span * HALF) / 2) / HALF);
    if (start !== pl.start && canPlaceAt(node, start, pl.span, pl)) {
      pl.start = start;
      rebuild(); paint();
    }
    return;
  }

  const at = hitPlane(0);
  if (!at) return;
  dragNode.x = Math.round((at.x / MM + dragOff.x) / SNAP) * SNAP;
  dragNode.z = Math.round((at.z / MM + dragOff.z) / SNAP) * SNAP;
  snapToNeighbours(dragNode);
  rebuild(); paint();
});

addEventListener("pointerup", () => { dragNode = dragMod = null; controls.enabled = true; });

/** Pull a dragged table flush against whatever it is nearly touching. Layout tables are
 *  meant to butt edge to edge -- that is the whole point of a shared 496mm depth. */
function snapToNeighbours(n) {
  const a = aabb(n);
  for (const m of state.nodes) {
    if (m === n) continue;
    const b = aabb(m);
    const nearZ = a.z0 < b.z1 + 200 && b.z0 < a.z1 + 200;
    const nearX = a.x0 < b.x1 + 200 && b.x0 < a.x1 + 200;
    if (nearZ && Math.abs(a.x0 - b.x1) < 80) { n.x = b.x1 + a.w / 2; return; }
    if (nearZ && Math.abs(a.x1 - b.x0) < 80) { n.x = b.x0 - a.w / 2; return; }
    if (nearX && Math.abs(a.z0 - b.z1) < 80) { n.z = b.z1 + a.d / 2; return; }
    if (nearX && Math.abs(a.z1 - b.z0) < 80) { n.z = b.z0 - a.d / 2; return; }
  }
}

// ---------------------------------------------------------------- state ops

const sel = () => state.nodes.find(n => n.id === state.sel);

const HOOKS_ON = new Set(["extension_table", "corner"]);

function addNode(sku) {
  const p = PARTS[sku];
  // A bamboo table hooks onto the frame's EDGE and stands on its own legs. It is a node
  // in the layout, not a lid on the frame -- which is what the copy says and what the
  // dimensions could never have told us.
  const kind = p.role === "frame" ? "frame" : HOOKS_ON.has(p.role) ? "ext" : "table";
  const n = {
    id: state.nextId++, sku, kind, x: 0, z: 0, rot: 0,
    leg: (kind === "frame" || kind === "ext") ? "CK-114" : null,
    placements: [],
  };
  // Land it flush against the right edge of what is already there. This is a layout
  // system -- tables connect. Dropping the new one in open space and making you drag
  // it into contact would be a worse default than the thing the system is for.
  const right = state.nodes.length ? Math.max(...state.nodes.map(m => aabb(m).x1)) : null;
  n.x = right === null ? 0 : right + footprint(n).w / 2;
  if (state.nodes.length) n.z = state.nodes[state.nodes.length - 1].z;
  state.nodes.push(n);
  state.sel = n.id;
  render();
}

function placeModule(sku) {
  const n = sel();
  if (!n || n.kind !== "frame") return;
  const p = PARTS[sku];
  const span = spanOf(p);
  const start = firstFit(n, span);
  if (start < 0) return;
  n.placements.push({ sku, span, start });
  render();
}

// ---------------------------------------------------------------- ui

function chip(label, on, title, fn) {
  const c = document.createElement("button");
  c.className = "chip" + (on ? " on" : "");
  c.textContent = label;
  c.title = title || "";
  c.onclick = fn;
  return c;
}

function partRow(p, fn, dead) {
  const el = document.createElement("div");
  el.className = "part" + (dead ? " dead" : "");
  const s = spanOf(p);
  el.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
    + `<span class="nm">${p.title_en}</span>`
    + `<span class="sp">${s ? s / 2 + "u" : ""}</span>`;
  el.title = `${p.sku} — ${p.title_en}`;
  if (!dead) el.onclick = () => fn(p);
  return el;
}

function paintPalette() {
  const add = $("add"); add.innerHTML = "";
  for (const p of BY_ROLE.frame) add.append(chip(`${p.units}u${p.collapsible ? " ⤢" : ""}`, false, p.title_en, () => addNode(p.sku)));
  for (const p of BY_ROLE.corner) add.append(chip("corner", false, p.title_en, () => addNode(p.sku)));

  const tab = $("tables"); tab.innerHTML = "";
  for (const p of [...BY_ROLE.extension_table, ...BY_ROLE.corner,
                   ...BY_ROLE.layout_table, ...BY_ROLE.standalone])
    tab.append(partRow(p, () => addNode(p.sku), false));

  const n = sel();
  const legs = $("legs"); legs.innerHTML = "";
  for (const p of BY_ROLE.leg)
    legs.append(chip(`${p.height_mm}`, n?.leg === p.sku, p.title_en, () => {
      if (n && (n.kind === "frame" || n.kind === "ext")) { n.leg = p.sku; render(); }
    }));

  const mods = $("modules"); mods.innerHTML = "";
  const frame = n?.kind === "frame" ? n : null;
  for (const p of BY_ROLE.slot_module)
    mods.append(partRow(p, () => placeModule(p.sku), !frame || firstFit(frame, p.span) < 0));

  $("selname").textContent = n ? PARTS[n.sku].title_en : "nothing selected";
}

function paintSlots() {
  const bar = $("slotbar"); bar.innerHTML = "";
  const n = sel();
  if (!n || n.kind !== "frame") return;
  for (const c of occupancy(n)) {
    const d = document.createElement("div");
    d.className = "cell" + (c ? " used" : "");
    bar.append(d);
  }
}

function bomLines() {
  const lines = [];
  for (const n of state.nodes) {
    lines.push({ sku: n.sku, node: n });
    if (n.kind === "ext" && n.leg) lines.push({ sku: n.leg, req: true });
    if (n.kind === "frame") {
      if (n.leg) lines.push({ sku: n.leg });
      const rails = PARTS[n.sku].requires_rails;
      if (rails && PARTS[rails]) lines.push({ sku: rails, req: true });
      for (const pl of n.placements) lines.push({ sku: pl.sku, node: n, pl });
    }
    const conn = PARTS[n.sku].requires_connector;
    if (conn && PARTS[conn]) lines.push({ sku: conn, req: true });
  }
  // One step joint per height change between touching tables.
  for (let i = 0; i < steps().length; i++) lines.push({ sku: "CK-151", req: true });
  return lines;
}

function paintBOM() {
  const t = $("bomtable"); t.innerHTML = "";
  const tot = { us: 0, jp: 0, uk: 0, g: 0 };

  for (const l of bomLines()) {
    const p = PARTS[l.sku];
    if (!p) continue;
    for (const k of ["us", "jp", "uk"]) if (p.price[k]) tot[k] += TO_USD[k](p.price[k]);
    tot.g += p.weight_g || 0;

    const tr = document.createElement("tr");
    const usd = p.price.us ? "$" + TO_USD.us(p.price.us).toFixed(0) : "—";
    tr.innerHTML = `<td class="x">${l.node && !l.pl ? "×" : ""}</td>`
      + `<td class="nm" title="${p.sku} — ${p.title_en}">${l.req ? "↳ " : ""}${p.title_en}</td>`
      + `<td class="p">${usd}</td>`;
    if (l.node && !l.pl) tr.querySelector(".x").onclick = () => {
      state.nodes = state.nodes.filter(n => n !== l.node);
      if (state.sel === l.node.id) state.sel = state.nodes[0]?.id ?? null;
      render();
    };
    t.append(tr);
  }

  const cheapest = ["us", "jp", "uk"].filter(k => tot[k] > 0).sort((a, b) => tot[a] - tot[b])[0];
  $("totals").innerHTML = `
    <div class="row"><span>weight</span><b>${(tot.g / 1000).toFixed(1)} kg</b></div>
    ${["us", "jp", "uk"].map(k => {
      const d = tot.us ? ((tot[k] - tot.us) / tot.us) * 100 : 0;
      const cls = k === "us" ? "" : d < 0 ? "cheap" : "dear";
      const pct = k === "us" ? "" : ` (${d > 0 ? "+" : ""}${d.toFixed(0)}%)`;
      return `<div class="row ${k === cheapest ? "big" : ""}"><span>${k.toUpperCase()}</span>`
        + `<b class="${cls}">$${tot[k].toFixed(0)}${pct}</b></div>`;
    }).join("")}
    <div class="note">JP/UK converted at fixed rates for orientation, not for checkout.</div>`;
}

function paintWarnings() {
  const w = $("warnings"); w.innerHTML = "";
  const add = (msg, cls = "warn") => {
    const d = document.createElement("div");
    d.className = cls; d.textContent = msg; w.append(d);
  };

  for (const [a, b] of steps())
    add(`${PARTS[a.sku].title_en} and ${PARTS[b.sku].title_en} meet at different heights `
      + `(${topOf(a)} vs ${topOf(b)}mm). That needs an IGT Height Adjuster — added.`, "warn info");

  // The datum is the reason the fire-side tables specify low legs: they are all 400mm,
  // and so is the IGT Low leg. A frame at 830mm simply cannot meet one flush.
  for (const n of state.nodes) {
    if (n.kind !== "frame") continue;
    for (const m of neighbours(n)) {
      const p = PARTS[m.sku];
      if (p.role !== "layout_table" || !p.requires_leg) continue;
      if (n.leg !== p.requires_leg)
        add(`${p.title_en} stands at ${p.height_mm}mm — it needs the `
          + `${PARTS[p.requires_leg].title_en} on the frame it joins.`);
    }
  }

  // A hook-on table cannot stand alone: it hangs off a frame's edge, and its own legs
  // only hold up the far end.
  for (const n of state.nodes)
    if (n.kind === "ext" && neighbours(n).length === 0)
      add(`${PARTS[n.sku].title_en} hooks onto a frame (or another extension) — `
        + `on its own it has nothing to hang from.`);

  for (const n of state.nodes) {
    if (n.kind !== "frame") continue;
    const used = occupancy(n).filter(Boolean).length;
    if (used === slotsOf(n)) add(`${PARTS[n.sku].title_en}: full, ${used}/${slotsOf(n)} half-slots.`, "warn info");
  }
}

function paint() { paintPalette(); paintSlots(); paintBOM(); paintWarnings(); }
function render() { rebuild(); paint(); }

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

CAT = await (await fetch("../catalog/igt-catalog.json")).json();
COLORS = (await (await fetch("../catalog/colors.json")).json()).colors;
GRID = CAT.grid;
LAYOUT = CAT.layout;
HALF = GRID.half_unit_mm;
PARTS = Object.fromEntries(CAT.parts.map(p => [p.sku, p]));

for (const p of CAT.parts) {
  if (p.role !== "frame") continue;
  const rails = `${p.sku}-1`;
  if (PARTS[rails]) { p.requires_rails = rails; p.collapsible = true; }
}

const by = r => CAT.parts.filter(p => p.role === r);
BY_ROLE = {
  frame: by("frame").filter(p => p.units).sort((a, b) => a.units - b.units),
  leg: by("leg").filter(p => p.height_mm).sort((a, b) => a.height_mm - b.height_mm),
  slot_module: by("slot_module").filter(p => p.span && p.assembled_mm)
    .sort((a, b) => a.span - b.span || a.title_en.localeCompare(b.title_en)),
  extension_table: by("extension_table").filter(p => p.assembled_mm),
  layout_table: by("layout_table").filter(p => p.assembled_mm),
  standalone: by("standalone").filter(p => p.assembled_mm),
  corner: by("corner").filter(p => p.assembled_mm),
};

$("datum").textContent = `${LAYOUT.datum_height_mm}mm`;

resize();
addNode("CK-150");
