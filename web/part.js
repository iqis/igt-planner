import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { materialFor, roundedBox, boardMaterial, flatRect,
         boardFromOutline, grainMaterial } from "./materials.js";
import { moduleGroup, flatBoardGeo, frameGroup, tableGroup, jikaroGroup,
         hangRackGroup, clampGroup, screenGroup, postArmGroup, ttaFrameGroup,
         ringGroup, caseGroup, railsGroup, plateGroup, gridPlateGroup,
         slideExtGroup, entryIgtGroup, slimIgtGroup, extIgtGroup, igtWoodTop } from "./parts3d.js";

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
// The measured frame fittings -- the same file the planner reads. The bench needs the rail
// cross-section (SECTION) and the hook-hole centres to build a real frame instead of a slab.
const FRAMES = await fetch("../catalog/frame_fittings.json")
  .then(r => r.ok ? r.json() : { frames: {} }).then(d => d.frames || {}).catch(() => ({}));
const SECTION = FRAMES["CK-149"]?.section;
// My hand-written understanding of specific parts (what / model / fits + derived/assumed/unknown).
// The bench synthesises a baseline for every part from role; this is the layer I've reviewed.
const UNDERSTOOD = await fetch("../catalog/understanding.json")
  .then(r => r.ok ? r.json() : {}).catch(() => ({}));

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
// The sliding extension's own bamboo, rectified from its top-view photo and cropped to grain.
const loadTex = path => (texCache[path] ??= texLoader.load(path));
const BAMBOO_GRAIN = "tex/CK-153TR_top.jpg";
// Dedicated grain instances for the self-IGT wood tops (own tiling, kept off the shared cache).
const WOOD_GRAIN = "tex/CK-116TR_grain.jpg";   // clean bamboo crop, no printed logo
const woodTexCache = {};
function woodGrain(key, rx, ry) {
  if (woodTexCache[key]) return woodTexCache[key];
  const t = texLoader.load(WOOD_GRAIN);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(rx, ry);
  woodTexCache[key] = t;
  return t;
}
const burnerTop = sku => sku.startsWith("GS-450R") ? loadTex("tex/GS-450R_top.jpg") : null;

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

/** A group for any NON-board part, chosen by role -- the bench's dispatcher. Every branch
 *  returns a real shape from parts3d.js; the whole point of this function is that the last
 *  resort is a role-appropriate form, never a featureless box. The big nodes (frame, table,
 *  Jikaro, hanging rack) build the SAME geometry the planner does; the small hardware
 *  (clamp, pole, screen, case, rails, ring, plate) has its own honest low-detail shape. */
function benchGeo(p, box) {
  const color = swatchOf(p.sku);
  const w = box.w, d = box.d, h = box.h ?? 40;
  const sku = p.sku, role = p.role;

  // Jikaro: a layout_table, but its own octagon. Default to the published long-edge-in ring.
  if (sku === "ST-050")
    return jikaroGroup({ outer: 1120, opening: 600, edge: 365, height: h,
      color, ringMat: materialFor(p, COLORS, false) }).group;

  if (role === "frame" && SECTION)
    return frameGroup({ w, d, thick: h, collapsible: !!p.collapsible, section: SECTION,
      hookHoles: FRAMES[sku]?.hook_holes_mm }).group;

  // The self-contained IGTs with their own FIXED folding legs, modelled part by part.
  // Entry / Slim IGT: a 3-unit frame whose custom wood top lifts out for IGT units. The bench
  // shows the full top (no modules placed) over the frame + fixed folding legs.
  if (sku === "CK-080R" || sku === "CK-080R-EC" || sku === "CK-180") {
    const si = (CAT.layout?.self_igt || {})[sku] || { units: 3, top: sku === "CK-180" ? "teak" : "bamboo" };
    const wrap = new THREE.Group();
    wrap.add((sku === "CK-180" ? slimIgtGroup : entryIgtGroup)(w, d, h).group);
    wrap.add(igtWoodTop({ units: si.units, color: si.top === "teak" ? 0xb98046 : 0xd8bd86,
      skip: [], d, tex: woodGrain("tile", 1, 2) }).group);
    return wrap;
  }
  // Extension IGT: two bamboo tops that slide apart. The bench shows the expanded form (its
  // assembled_mm is the open 1348), so the central 2-Unit bay is visible.
  if (sku === "CK-090") {
    const e = (CAT.layout?.expandables || {})["CK-090"], c = e && e.configs[e.default];
    return extIgtGroup(w, d, h, { bayW: c?.bay_w_mm || 500, bayD: c?.bay_d_mm || 360, tex: woodGrain("ext", 2, 2) }).group;
  }

  if (role === "layout_table" || role === "standalone")
    return tableGroup(w, d, h, 30, color).group;

  if (role === "hanger") {
    if (p.span) return hangRackGroup({ w, d, drop: h, tiers: p.tiers || 1,
      hasSurface: !!p.has_surface, color, estimated: p.assembled_estimated }).group;
    if (sku === "DB-005") return ringGroup(w, d, h, color).group;   // a ring that holds a bag
    return clampGroup(w, d, h, color).group;                        // CK-020 box hanger
  }

  if (role === "edge_clamp") {
    if (sku === "CK-301") return screenGroup(w, d, h, color).group;    // folding windscreen
    if (sku === "CK-302" || sku === "CK-305") return postArmGroup(w, d, h, color).group;
    if (sku === "CK-303") return ttaFrameGroup(w, d, h, color).group;  // a small frame on legs
    if (sku === "CK-306") return ringGroup(w, d, h, color).group;      // Sierra cup holder
    return clampGroup(w, d, h, color).group;                          // CK-300 unit clamp
  }

  // A bamboo sliding extension (CK-153/154): mounts on the frame's long side, reaches out.
  if (role === "extension") return slideExtGroup(w, d, h, color, loadTex(BAMBOO_GRAIN)).group;

  if (role === "case") return caseGroup(w, d, h, color).group;
  if (role === "rails" && SECTION)
    return railsGroup({ w, d, thick: h, section: SECTION, color }).group;
  if (role === "joint") return plateGroup(w, d, h, color).group;
  if (role === "frame_hook") return clampGroup(w, d, h, color).group;  // CK-175 connection hook

  // A grill / griddle plate (S-029HA): a ridged slab, not a box.
  if (role === "accessory" && !moduleGroup(p, w, d, h, color) && h < 40)
    return gridPlateGroup(w, d, h, color).group;

  // Slot modules, storage boxes, gear bags, burners, mesh trays -- moduleGroup knows them.
  const mod = moduleGroup(p, w, d, h, color, burnerTop(sku));
  if (mod) return mod.group;

  // What is left is a genuinely thin, flat thing (a sliding bamboo extension, a wood insert,
  // a shallow tray): a low slab, honestly flat -- still not a cube.
  const g = new THREE.Group();
  const slab = new THREE.Mesh(roundedBox(w * MM, Math.max(h, 8) * MM, d * MM, 2 * MM),
    materialFor(p, COLORS, false));
  slab.position.y = -Math.max(h, 8) / 2 * MM;
  g.add(slab);
  return g;
}

function drawPart() {
  stage.clear();
  const p = PARTS[sku];
  const box = p.assembled_mm;
  if (!box) return;

  const t = TEXTURES[sku] || {};
  const thick = box.h ?? 25;
  const grain = textureOf(sku, "grain");

  // A flat board -- a corner (traced), a bamboo board (traced, edge notch), or a stainless
  // lid (a dimension-built rectangle with a punched finger hole). Same shape rule as the
  // planner, from parts3d. A part with no board shape at all (a burner, a box, a mesh tray)
  // comes from moduleGroup instead.
  const isBoard = grain || t.outline_mm || p.role === "corner";

  if (!isBoard) {
    stage.add(benchGeo(p, box));
  } else {
    const board = new THREE.Mesh(flatBoardGeo(p.role, t, box.w, box.d, thick), grain
      ? grainMaterial(p, COLORS, grain, box.w, box.d, false)
      : materialFor(p, COLORS, false));
    board.position.y = 0;                       // hangs from the top face
    stage.add(board);

    const tex = textureOf(sku);
    if (show.photo && tex) {
      const decal = new THREE.Mesh(flatBoardGeo(p.role, t, box.w, box.d, 0.4),
        boardMaterial(p, COLORS, tex, box.w * MM, box.d * MM, false));
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
    a.title = (view ? `you said: ${view}` : "unlabelled") + " — click to load it above and mark it up";
    // Click loads it into the photo pane to annotate; ctrl/cmd/middle-click still opens the tab.
    a.onclick = ev => {
      if (ev.metaKey || ev.ctrlKey || ev.button === 1) return;
      ev.preventDefault();
      loadAnnoImage(im.url);
    };
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
// A plain-language meaning for each role, and how a part of that role is modelled. This is the
// baseline understanding the bench shows for EVERY part; understanding.json overrides it where
// I have actually reviewed the part.
const ROLE_DEF = {
  frame: "a rigid leg frame -- the backbone a run is built on",
  extension_table: "a bamboo tabletop that hooks onto a frame end and runs the length out",
  corner: "a board that turns the run 90 degrees at a corner",
  extension: "a bamboo board that grips the frame's long rail and reaches out",
  layout_table: "a standalone layout-system table (grouped by height, not joined by rail)",
  standalone: "a self-contained IGT table with its own legs",
  slot_module: "a unit-sized module that drops into the frame -- rim on the rails, body below",
  hanger: "hangs off a frame edge -- a rack, shelf or box below the table",
  edge_clamp: "clamps to a unit edge (the TTA accessory family)",
  case: "a carrying case for a frame or set",
  rails: "the collapsible rails that pair with a folding frame",
  joint: "hardware that connects one table or frame to another",
  rail_joint: "the joint that ties one frame's long rail to the next",
  frame_hook: "a connection hook between frames",
  leg: "a leg set -- a height, not a surface",
  accessory: "an accessory that sits on or in the frame",
  storage: "a gear box sized in IGT units",
  set: "a bundle of other parts, not a single object",
  excluded: "excluded from the planner",
};
const ROLE_MODEL = {
  frame: "frameGroup -- the measured cross-section swept to length, with hook-holes and leg sockets",
  extension_table: "tableGroup -- a flat slab with the plan-view photo underlaid in the same frame",
  corner: "tableGroup -- a flat slab whose hook and bracket edges are perpendicular, so it turns the run",
  extension: "slideExtGroup -- a bamboo slab with under-brackets that clip over the rail",
  layout_table: "tableGroup (ST-050 is modelled as its own octagon)",
  standalone: "tableGroup -- a slab on its own legs",
  slot_module: "moduleGroup -- a unit-sized box; burners carry a real top texture",
  hanger: "hangRackGroup / ringGroup / clampGroup, by kind",
  edge_clamp: "a windscreen / arm / small frame / cup ring / clamp, by SKU",
  case: "caseGroup -- a soft case volume",
  rails: "railsGroup -- the rail cross-section, no top",
  joint: "plateGroup -- a small connecting plate (hardware)",
  rail_joint: "plateGroup -- a small connecting plate (hardware)",
  frame_hook: "clampGroup -- a small hook",
  leg: "not a surface -- shown at its height only",
  accessory: "gridPlateGroup for thin grills, else moduleGroup, else an honest flat slab",
  storage: "moduleGroup -- a box sized in units",
  set: "not modelled as one object (it is a bundle)",
  excluded: "not modelled",
};
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const cleanName = t => (t || "").replace(/ONLINE.*$|／\s*EC.*$|\/\s*EC.*$/, "").trim();

// Say, in plain language, what I think this part IS and how I model it -- and keep what I
// DERIVED separate from what I ASSUMED and what I do not know, so feedback has something to aim at.
function paintUnderstanding() {
  const p = PARTS[sku];
  const u = UNDERSTOOD[sku];
  const name = cleanName(p.title_en) || p.sku;
  const what = u?.what || `${name} — ${ROLE_DEF[p.role] || p.role || "a part of the IGT system"}.`;
  const model = u?.model || ROLE_MODEL[p.role] || "a plain slab, sized from the catalogue.";
  const arr = v => Array.isArray(v) ? v : (v ? [v] : []);   // some fields are a string, some a list
  const rel = [];
  if (arr(p.attaches_to).length) rel.push(`attaches to ${arr(p.attaches_to).join(", ")}`);
  if (arr(p.connects_to).length) rel.push(`connects to ${arr(p.connects_to).join(", ")}`);
  if (p.mounts) rel.push(`mounts ${p.mounts}`);
  if (p.mounted_by) rel.push(`mounted by ${p.mounted_by}`);
  if (arr(p.contains).length) rel.push(`bundles ${arr(p.contains).length} parts`);
  const fits = u?.fits || (rel.length ? cap(rel.join("; ")) + "." : "");

  const epi = (label, arr, cls) => (arr && arr.length)
    ? `<div class="epi ${cls}"><span>${label}</span><ul>${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`
    : "";

  $("understand").innerHTML =
    `<div class="u-what">${esc(what)}</div>`
    + `<div class="u-row"><span>how I model it</span>${esc(model)}</div>`
    + (fits ? `<div class="u-row"><span>how it fits</span>${esc(fits)}</div>` : "")
    + epi("derived", u?.derived, "d")
    + epi("assumed", u?.assumed, "a")
    + epi("unknown", u?.unknown, "u")
    + `<div class="u-tag ${u ? "ok" : "auto"}">${u
        ? `hand-reviewed${u.confidence ? ` · confidence ${esc(u.confidence)}` : ""}`
        : "baseline from role — not yet hand-reviewed"}</div>`;
}

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
  const el = $("partlist"); el.innerHTML = "";
  const q = ($("partsearch").value || "").trim().toLowerCase();
  const match = p => !q || p.sku.toLowerCase().includes(q) || (p.title_en || "").toLowerCase().includes(q);
  const groups = [
    ["hook-on boards", p => p.role === "extension_table" || p.role === "corner"],
    ["slot modules", p => p.role === "slot_module"],
    ["frames", p => p.role === "frame"],
    ["everything else", p => !["extension_table", "corner", "slot_module", "frame"].includes(p.role)],
  ];
  for (const [name, test] of groups) {
    const ps = CAT.parts.filter(p => p.assembled_mm && test(p) && match(p));
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
$("partsearch").addEventListener("input", paintList);   // filter the list by name or part number

function redraw() { drawPart(); paintChrome(); }

function select(next) {
  sku = next;
  drawPart();
  setView(view);
  paintList();
  paintPhoto();
  paintGallery();
  paintLinks();
  paintUnderstanding();
  paintFacts();
  annoReset();
  anno3dReset();
  pairReset();
  backendSync();          // mirror the newly-shown part's marks to anno/<sku>.json
  history.replaceState(null, "", `?sku=${sku}`);
  $("detail").scrollTop = 0;
}

// ---------------------------------------------------------------- annotate
// Draw on the photo -- numbered POINTS, a POLYLINE, ARROWS, TEXT -- to point at exactly what
// you mean. Marks DRAG to move, PERSIST to localStorage per image, and are readable as DATA
// off window.__bench.anno(): the coordinates on the ORIGINAL image, not a screenshot, are what
// gets discussed. All coords are fractions (0..1) of the image, so they survive any resize.
const annocanvas = $("annocanvas");
const actx = annocanvas.getContext("2d");
let annoTool = "point";
let annoItems = [];        // {type:'point'|'poly'|'arrow'|'text', ...}
let annoPoly = null;       // the polyline in progress
let annoArrow = null;      // the arrow being dragged out
let annoDrag = null;       // a handle being moved: {it,k?} or {pts,i}

const ANNO_KEY = "igt-anno";
const annoUrl = () => $("photo").getAttribute("src") || "";
function annoSave() {
  try {
    const all = JSON.parse(localStorage.getItem(ANNO_KEY) || "{}");
    if (annoItems.length) all[annoUrl()] = annoItems; else delete all[annoUrl()];
    localStorage.setItem(ANNO_KEY, JSON.stringify(all));
  } catch { /* private mode / quota -- annotations just won't persist */ }
  backendSync();
}
function annoLoadFor(url) {
  annoPoly = annoArrow = annoDrag = null;
  try { annoItems = (JSON.parse(localStorage.getItem(ANNO_KEY) || "{}")[url]) || []; }
  catch { annoItems = []; }
}
const annoChanged = () => { annoRender(); annoSave(); };

function annoResize() {
  const r = $("shot").getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio, 2);
  annocanvas.width = Math.max(1, Math.round(r.width * dpr));
  annocanvas.height = Math.max(1, Math.round(r.height * dpr));
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
  annoRender();
}
// A label with a dark halo, nudged so it never runs off the top/right of the pane.
function annoLabel(txt, x, y, fill, W) {
  actx.font = "bold 13px ui-monospace, monospace";
  const w = actx.measureText(txt).width;
  let lx = x + 9, ly = y - 6;
  if (lx + w > W - 2) lx = x - 9 - w;
  if (ly < 12) ly = y + 15;
  actx.lineWidth = 3.5; actx.strokeStyle = "#101215"; actx.strokeText(txt, lx, ly);
  actx.fillStyle = fill; actx.fillText(txt, lx, ly);
}
function annoRender() {
  const r = $("shot").getBoundingClientRect(), W = r.width, H = r.height;
  actx.clearRect(0, 0, W, H);
  for (const pl of annoItems.filter(i => i.type === "poly").concat(annoPoly || [])) {
    actx.strokeStyle = "#37c26e"; actx.fillStyle = "#37c26e"; actx.lineWidth = 2.5;
    actx.beginPath();
    pl.pts.forEach((p, i) => (i ? actx.lineTo : actx.moveTo).call(actx, p.x * W, p.y * H));
    actx.stroke();
    for (const p of pl.pts) { actx.beginPath(); actx.arc(p.x * W, p.y * H, 4, 0, 7); actx.fill(); }
  }
  for (const it of annoItems.filter(i => i.type === "arrow").concat(annoArrow || [])) {
    const x = it.x * W, y = it.y * H, x2 = it.x2 * W, y2 = it.y2 * H, a = Math.atan2(y2 - y, x2 - x);
    actx.strokeStyle = "#ff7a3a"; actx.fillStyle = "#ff7a3a"; actx.lineWidth = 2.5;
    actx.beginPath(); actx.moveTo(x, y); actx.lineTo(x2, y2); actx.stroke();
    actx.beginPath(); actx.moveTo(x2, y2);
    actx.lineTo(x2 - 12 * Math.cos(a - 0.42), y2 - 12 * Math.sin(a - 0.42));
    actx.lineTo(x2 - 12 * Math.cos(a + 0.42), y2 - 12 * Math.sin(a + 0.42));
    actx.closePath(); actx.fill();
  }
  for (const it of annoItems.filter(i => i.type === "text")) annoLabel(it.text, it.x * W, it.y * H, "#ffd24a", W);
  let n = 0;
  for (const it of annoItems.filter(i => i.type === "point")) {
    n++; const x = it.x * W, y = it.y * H;
    actx.beginPath(); actx.arc(x, y, 7, 0, 7); actx.fillStyle = "#2f9bff"; actx.fill();
    actx.lineWidth = 2; actx.strokeStyle = "#fff"; actx.stroke();
    annoLabel(String(n), x, y, "#fff", W);
  }
  // The photo halves of the correspondences -- only those pinned on the image now shown.
  const url = annoUrl();
  pairs.forEach((pr, i) => {
    if (pr.img && pr.img !== url) return;
    const x = pr.ph.x * W, y = pr.ph.y * H;
    actx.beginPath(); actx.arc(x, y, 7, 0, 7); actx.fillStyle = "#d13ad1"; actx.fill();
    actx.lineWidth = 2; actx.strokeStyle = "#fff"; actx.stroke();
    annoLabel(pairLetter(i), x, y, "#fff", W);
  });
}
const annoAt = e => {
  const r = $("shot").getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
};
// The handle under the pointer, if any -- so an existing mark can be grabbed and dragged.
function annoHit(p) {
  const r = $("shot").getBoundingClientRect();
  const near = (x, y) => Math.hypot((x - p.x) * r.width, (y - p.y) * r.height) < 11;
  for (const it of annoItems) {
    if (it.type === "point" || it.type === "text") { if (near(it.x, it.y)) return { it }; }
    else if (it.type === "arrow") {
      if (near(it.x, it.y)) return { it, k: "a" };
      if (near(it.x2, it.y2)) return { it, k: "b" };
    } else if (it.type === "poly")
      for (let i = 0; i < it.pts.length; i++) if (near(it.pts[i].x, it.pts[i].y)) return { pts: it.pts, i };
  }
  return null;
}
annocanvas.addEventListener("pointerdown", e => {
  const p = annoAt(e), hit = annoHit(p);
  if (pairMode) { pairAddPhoto(p); return; }   // photo half of a pair -- click the model first
  if (hit) { annoDrag = hit; annocanvas.setPointerCapture(e.pointerId); return; }  // grab to move
  if (annoTool === "poly") {
    (annoPoly ??= { type: "poly", pts: [] }).pts.push({ x: p.x, y: p.y }); annoRender();
  } else if (annoTool === "arrow") {
    annoArrow = { type: "arrow", x: p.x, y: p.y, x2: p.x, y2: p.y }; annocanvas.setPointerCapture(e.pointerId);
  } else if (annoTool === "text") {
    const t = prompt("label:"); if (t) { annoItems.push({ type: "text", ...p, text: t }); annoChanged(); }
  } else { annoItems.push({ type: "point", ...p }); annoChanged(); }
});
annocanvas.addEventListener("pointermove", e => {
  const p = annoAt(e);
  if (annoDrag) {
    if (annoDrag.pts) annoDrag.pts[annoDrag.i] = { x: p.x, y: p.y };
    else if (annoDrag.k === "b") { annoDrag.it.x2 = p.x; annoDrag.it.y2 = p.y; }
    else { annoDrag.it.x = p.x; annoDrag.it.y = p.y; }
    annoRender();
  } else if (annoArrow) { annoArrow.x2 = p.x; annoArrow.y2 = p.y; annoRender(); }
});
annocanvas.addEventListener("pointerup", () => {
  if (annoDrag) { annoDrag = null; annoChanged(); }
  else if (annoArrow) {
    if (Math.hypot(annoArrow.x2 - annoArrow.x, annoArrow.y2 - annoArrow.y) > 0.01) annoItems.push(annoArrow);
    annoArrow = null; annoChanged();
  }
});
annocanvas.addEventListener("dblclick", () => {   // finish the polyline
  if (annoPoly?.pts.length >= 2) annoItems.push(annoPoly);
  annoPoly = null; annoChanged();
});
function annoFinishPoly() { if (annoPoly?.pts.length >= 2) annoItems.push(annoPoly); annoPoly = null; }
for (const b of document.querySelectorAll(".anno-tool"))
  b.onclick = () => {
    annoFinishPoly(); annoChanged();
    annoTool = b.dataset.tool;
    document.querySelectorAll(".anno-tool").forEach(x => x.classList.toggle("on", x === b));
  };
$("announdo").onclick = () => { if (annoPoly) annoPoly = null; else annoItems.pop(); annoChanged(); };
$("annoclear").onclick = () => { annoItems = []; annoPoly = null; annoChanged(); };
/** Reload the marks saved for whatever image is now in the pane. */
function annoReset() { annoLoadFor(annoUrl()); annoResize(); }
/** Load a reference image into the photo pane to mark up. Its own measurements do not apply,
 *  so the measurement overlay is cleared; the marks saved for THAT image come back. */
function loadAnnoImage(url) {
  $("shot").style.display = "";       // paintPhoto hides it when a part has no measured-from shot
  $("marks").innerHTML = "";
  annoLoadFor(url);
  $("photo").src = url;               // load event -> annoResize -> render
}
$("photo").addEventListener("load", annoResize);
addEventListener("resize", annoResize);

// ---------------------------------------------------------------- annotate the 3D model
// Click the MODEL to drop a numbered point at that exact spot -- a RAYCAST, so the millimetres
// are real, not eyeballed off an oblique photo (the reason this beats marking the photo for
// placing geometry). Drag still orbits. Persists per part; read the points as mm off
// window.__bench.anno3d(). The part sits at the origin, so world mm == the part's own mm.
const ray3 = new THREE.Raycaster();
let mark3d = false;
let anno3d = [];           // {v: THREE.Vector3 (scene units = metres), el: label div}
let down3 = null;
const anno3dLayer = $("anno3d");
const ANNO3D_KEY = "igt-anno3d";

function anno3dSave() {
  try {
    const all = JSON.parse(localStorage.getItem(ANNO3D_KEY) || "{}");
    if (anno3d.length) all[sku] = anno3d.map(a => [a.v.x, a.v.y, a.v.z]); else delete all[sku];
    localStorage.setItem(ANNO3D_KEY, JSON.stringify(all));
  } catch { /* private mode -- just won't persist */ }
  backendSync();
}
function anno3dPlace() {    // number + position each label by projecting its 3D point to screen
  const r = canvas.getBoundingClientRect();
  anno3d.forEach((a, i) => {
    const p = a.v.clone().project(camera);
    a.el.textContent = i + 1;
    a.el.style.left = ((p.x * 0.5 + 0.5) * r.width) + "px";
    a.el.style.top = ((-p.y * 0.5 + 0.5) * r.height) + "px";
    a.el.style.display = p.z < 1 ? "flex" : "none";
  });
}
function anno3dAdd(v, save = true) {
  const el = document.createElement("div"); el.className = "a3d"; anno3dLayer.append(el);
  anno3d.push({ v: v.clone(), el });
  if (save) anno3dSave();
  anno3dPlace();
}
function anno3dChrome() {
  $("mark3d").classList.toggle("on", mark3d);
  $("pairmode").classList.toggle("on", pairMode);
  $("mark3dundo").hidden = $("mark3dclear").hidden = !(mark3d || pairMode || anno3d.length || pairs.length);
}
function anno3dReset() {    // load the marks saved for the part now shown
  for (const a of anno3d) a.el.remove();
  anno3d = [];
  try {
    for (const [x, y, z] of (JSON.parse(localStorage.getItem(ANNO3D_KEY) || "{}")[sku] || []))
      anno3dAdd(new THREE.Vector3(x, y, z), false);
  } catch { /* ignore */ }
  anno3dChrome();
}
$("mark3d").onclick = () => {
  mark3d = !mark3d;
  if (mark3d && pairMode) { pairMode = false; if (pairPend) { pairPend.mEl.remove(); pairPend = null; pairModelLabels(); } }
  anno3dChrome();
};
// undo/clear act on whichever 3D-view mode is live: correspondences in pair mode, points otherwise.
$("mark3dundo").onclick = () => {
  if (pairMode) {
    if (pairPend) { pairPend.mEl.remove(); pairPend = null; pairModelLabels(); }   // back out a half-made pair
    else { const p = pairs.pop(); if (p) { p.mEl.remove(); pairSave(); pairModelLabels(); annoRender(); } }
  } else { const a = anno3d.pop(); if (a) a.el.remove(); anno3dSave(); anno3dPlace(); }
  anno3dChrome();
};
$("mark3dclear").onclick = () => {
  if (pairMode) {
    for (const p of pairs) p.mEl.remove(); pairs = [];
    if (pairPend) { pairPend.mEl.remove(); pairPend = null; }
    pairSave(); pairModelLabels(); annoRender();
  } else { for (const a of anno3d) a.el.remove(); anno3d = []; anno3dSave(); }
  anno3dChrome();
};
canvas.addEventListener("pointerdown", e => { down3 = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerup", e => {
  const d = down3; down3 = null;
  if ((!mark3d && !pairMode) || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; // drag = orbit
  const r = canvas.getBoundingClientRect();
  ray3.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  // Only the part's own MESHES -- not the reference grid or axis lines that also live in stage.
  const hit = ray3.intersectObjects(stage.children, true).find(h => h.object.isMesh);
  if (!hit) return;
  if (pairMode) pairStartModel(hit.point); else anno3dAdd(hit.point);
  anno3dChrome();
});

// ---------------------------------------------------------------- pair model <-> photo
// Link a point on the MODEL to a point on the PHOTO. In pair mode: click the model (the half
// shows magenta, dashed while it waits), then click the matching spot on the photo -- both are
// lettered A, B, C. The letter IS the correspondence. Read as data (model mm + photo px) off
// window.__bench.pairs(). Persists per part.
let pairMode = false;
let pairs = [];            // {v: Vector3 (model), ph:{x,y} photo frac, img: url, mEl: div}
let pairPend = null;       // {v, mEl} model half awaiting its photo point
const PAIR_KEY = "igt-pairs";
const pairLetter = i => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");
function pairSave() {
  try {
    const all = JSON.parse(localStorage.getItem(PAIR_KEY) || "{}");
    if (pairs.length) all[sku] = pairs.map(p => ({ v: [p.v.x, p.v.y, p.v.z], ph: [p.ph.x, p.ph.y], img: p.img, iw: p.iw, ih: p.ih }));
    else delete all[sku];
    localStorage.setItem(PAIR_KEY, JSON.stringify(all));
  } catch { /* private mode */ }
  backendSync();
}
function pairModelLabels() {   // reproject the model halves each frame, like anno3d
  const r = canvas.getBoundingClientRect();
  const put = (v, el, txt, cls) => {
    const p = v.clone().project(camera);
    el.textContent = txt; el.className = "a3d " + cls;
    el.style.left = ((p.x * 0.5 + 0.5) * r.width) + "px";
    el.style.top = ((-p.y * 0.5 + 0.5) * r.height) + "px";
    el.style.display = p.z < 1 ? "flex" : "none";
  };
  pairs.forEach((p, i) => put(p.v, p.mEl, pairLetter(i), "pair"));
  if (pairPend) put(pairPend.v, pairPend.mEl, pairLetter(pairs.length), "pend");
}
function pairStartModel(pt) {   // model half -> pending (a new click replaces an unfinished one)
  if (pairPend) pairPend.mEl.remove();
  const mEl = document.createElement("div"); anno3dLayer.append(mEl);
  pairPend = { v: pt.clone(), mEl };
  pairModelLabels();
}
function pairAddPhoto(p) {       // photo half -> completes the pending pair (needs a model half)
  if (!pairPend) return false;
  const im = $("photo");        // pin the image's pixel size so photo_px survives switching images
  pairs.push({ v: pairPend.v, ph: { x: p.x, y: p.y }, img: annoUrl(), iw: im.naturalWidth, ih: im.naturalHeight, mEl: pairPend.mEl });
  pairPend = null;
  pairModelLabels(); annoRender(); pairSave();
  return true;
}
function pairReset() {          // load the pairs saved for the part now shown
  for (const p of pairs) p.mEl.remove();
  if (pairPend) pairPend.mEl.remove();
  pairs = []; pairPend = null;
  try {
    for (const rec of (JSON.parse(localStorage.getItem(PAIR_KEY) || "{}")[sku] || [])) {
      const mEl = document.createElement("div"); anno3dLayer.append(mEl);
      pairs.push({ v: new THREE.Vector3(...rec.v), ph: { x: rec.ph[0], y: rec.ph[1] }, img: rec.img, iw: rec.iw, ih: rec.ih, mEl });
    }
  } catch { /* ignore */ }
  pairModelLabels();
}
$("pairmode").onclick = () => {
  pairMode = !pairMode;
  if (pairMode) mark3d = false;                    // one 3D-view mode at a time
  if (!pairMode && pairPend) { pairPend.mEl.remove(); pairPend = null; pairModelLabels(); }
  anno3dChrome();
};
// Load any image to annotate -- a file off disk, or a pasted URL (Enter).
$("annofile").onchange = e => { const f = e.target.files?.[0]; if (f) loadAnnoImage(URL.createObjectURL(f)); e.target.value = ""; };
$("annourl").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const u = e.target.value.trim(); if (u) { loadAnnoImage(u); e.target.blur(); }
});

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
  anno3dPlace();          // keep the 3D-point labels glued to the model as it orbits
  pairModelLabels();      // ...and the model halves of the correspondences
})();

// Theme -- shared with the planner (same localStorage key). The panels are pure CSS
// variables; the 3D canvas follows by reading the resolved --scene off :root.
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--scene").trim() || "#14161a";
  scene.background = new THREE.Color(bg);
  $("theme").textContent = t === "light" ? "☀" : "☾";
}
applyTheme(localStorage.getItem("igt-theme") || "dark");
$("theme").onclick = () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("igt-theme", next);
  applyTheme(next);
};

// Push a readable snapshot -- points/pairs as mm and px -- to the server, which drops it at
// anno/<sku>.json, so the marks can be read straight off the disk with no browser round-trip.
// Defined BEFORE boot: select() calls it, so its state must be initialised first (no TDZ).
let backendTimer = 0;
function backendSync() {
  clearTimeout(backendTimer);
  backendTimer = setTimeout(() => {
    const b = window.__bench; if (!b) return;
    const body = JSON.stringify({ sku, updated_epoch_ms: performance.timeOrigin + performance.now(),
      anno3d: b.anno3d(), pairs: b.pairs(), photo: b.anno() });
    fetch("/anno", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
  }, 300);
}

resize();
select(new URLSearchParams(location.search).get("sku") || "CK-119TR");
annoResize();

window.__bench = { THREE, scene, camera, controls, PARTS, TEXTURES, select, setView, show, redraw,
  // The annotations, so they can be read straight off the page -- numbered points, arrows and
  // text labels, as fractions of the image AND its pixels. No screenshot needed to read them.
  anno: () => {
    const img = $("photo"), W = img.naturalWidth, H = img.naturalHeight;
    const px = (x, y) => ({ x: Math.round(x * W), y: Math.round(y * H) });
    let n = 0;
    return {
      image: img.getAttribute("src"), naturalWidth: W, naturalHeight: H,
      points: annoItems.filter(i => i.type === "point")
        .map(p => ({ n: ++n, frac: { x: +p.x.toFixed(4), y: +p.y.toFixed(4) }, px: px(p.x, p.y) })),
      polylines: annoItems.filter(i => i.type === "poly").map(pl => ({ px: pl.pts.map(p => px(p.x, p.y)) })),
      arrows: annoItems.filter(i => i.type === "arrow").map(a => ({ from: px(a.x, a.y), to: px(a.x2, a.y2) })),
      labels: annoItems.filter(i => i.type === "text").map(t => ({ text: t.text, px: px(t.x, t.y) })),
    };
  },
  // The points marked ON the 3D model, as millimetres in the part's own frame.
  anno3d: () => anno3d.map((a, i) => ({ n: i + 1,
    mm: { x: Math.round(a.v.x * 1000), y: Math.round(a.v.y * 1000), z: Math.round(a.v.z * 1000) } })),
  // The model<->photo correspondences: each lettered pair as model mm AND photo px. photo_frac
  // is canonical (resolution-independent); photo_px uses the image's own pixel size (pinned per
  // pair), falling back to the loaded photo, else null -- so it's right even off a stale image.
  pairs: () => pairs.map((p, i) => {
    const w = p.iw || (p.img === annoUrl() ? $("photo").naturalWidth : 0);
    const h = p.ih || (p.img === annoUrl() ? $("photo").naturalHeight : 0);
    return {
      label: pairLetter(i),
      model_mm: { x: Math.round(p.v.x * 1000), y: Math.round(p.v.y * 1000), z: Math.round(p.v.z * 1000) },
      photo_frac: { x: +p.ph.x.toFixed(4), y: +p.ph.y.toFixed(4) },
      photo_px: (w && h) ? { x: Math.round(p.ph.x * w), y: Math.round(p.ph.y * h) } : null,
      image: p.img,
    };
  }),
};
