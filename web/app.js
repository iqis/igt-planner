import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { materialFor, roundedBox, boardMaterial, grainMaterial } from "./materials.js";
import { PUBLIC, GRAIN_MEANS } from "./build.js";
import { proceduralGrain } from "./proctex.js";
import { icon, brand } from "./icons.js";
import qrcode from "./vendor/qrcode.mjs";
import { t, getLang, setLang, applyStatic, LANGS } from "./i18n.js";
import {
  BY_ROLE, CAT, COLORS, CONN, CONN_TABLE, EDGE_IFACES, EDGE_KEYS, FIGURES,
  FRAMES, FRAME_HOOK, FRAME_THICK, GRID, HALF, HEIGHT_LADDER, HOLE_INSET, HOOKABLE,
  HOOKS_ON, INTENT, JIKARO, JIKARO_EDGES, LAYOUT, LEG_R, LEG_SETS, MODULE_SEAT,
  PARTS, RAIL_JOINT, RAIL_RECESS, S, SAVE_V, SECTION, SLIDE_IN, SLIDE_SNAP,
  SLOT_IFACES, SNAP, TEXTURES, TOUCH, aabb, adapterList, angleOf, anyOpenEdge,
  asmRoot, assemblyOf, baseSku, bayUnits, boardScalePort, bomLines, bracketAnchor, bracketNormal,
  byId, canAttach, canPlaceAt, compat, contactEdge, depthOf, detachNode, edgeKeysOf,
  expCfg, expDef, figH, findDropTarget, firstFit, fitsOpening, floatSpot, footprint,
  footprintOf, footprintSpot, freeBlock, guestsFor, hasBay, hasHangRack, hookAnchor, hookGeometry,
  hookNode, hookNormal, hostEdge, hostEquivalents, hostLegOf, hostsHanging, initialSlide, insertAt,
  isConnTable, isExpandable, isHangRack, isJikaro, isSlide, jikaroCfg, kindOf, legAtStep,
  legMm, legRung, legalOn, loadCatalog, mean, neighbours, nextRulerId, norm,
  occupancy, openEdges, overhead, partsForRole, place, portsAt, pruneModules, railW,
  readLayout, resolve, rootOf, rotv, rulerSeq, runOf, sel, selfIgt,
  selfIgtEdges, serializeLayout, slideBounds, slideOffset, slotX, slotsOf, spanOf, state,
  stepDropMm, stepRoom, steps, subtreeIds, topOf, turnOf, warnings,
} from "./core.js";
import { moduleGroup, flatBoardGeo as flatGeo, frameGroup, tableGroup,
         jikaroGroup, jikaroBridge, hangRackGroup, slideExtGroup,
         entryIgtGroup, slimIgtGroup, extIgtGroup, igtWoodTop, lv310Group, LV310_TOP,
         foldingChairGroup, lowBeachChairGroup, campfieldSofaGroup,
         loungeCushionGroup, foldingBenchGroup, bambooShelfGroup,
         takeChairGroup, shelterFootprint, BBQ_SURFACE_SKUS, takibiGroup, gs1000Group,
         propGroup, shelterOf, SHELTER_FILL, shelterVerts, shelterBBox, burnerOf,
         tarpPitchGroup, landLockGroup, pentaTarpGroup, figureGroup } from "./parts3d.js";

// Millimetres everywhere, scaled once on the way into the scene. The catalog speaks
// mm; converting at the boundary keeps every number here readable against the spec
// table it came from. Angles are RADIANS everywhere, for the same reason: one unit,
// no conversions buried in the middle of the code.
const MM = 0.001;



const $ = id => document.getElementById(id);



// ---- on-demand rendering ------------------------------------------------------------------------
// The rAF loop at the bottom only DRAWS when something asked for it: scene changes raise
// this flag (rebuild does it for everyone), the camera raises it by moving (OrbitControls'
// update() says so), a running tween keeps it up, and an async texture arrival raises it so
// wood grain never pops in a frame late. An idle planner renders nothing -- which on a
// phone is the difference between a warm pocket and a dead battery.
let needsRender = true;
const invalidate = () => { needsRender = true; };
const renderStats = { frames: 0 };               // the smoke test reads this: idle must not spin

const texLoader = new THREE.TextureLoader();
const texCache = {};
// Every photo-derived texture goes through here. The public build ships no photographs (build.js),
// so there a grain becomes a canvas aimed at the photo's mean colour, and the plan-view decal --
// the photograph itself, laid on the board -- is simply not drawn.
const PHOTO_FREE = ["tex/brushed_steel.jpg", "tex/canvas.jpg", "tex/chair_mesh.png"];   // generated, ours
function loadImageTex(path) {
  if (!PUBLIC || PHOTO_FREE.includes(path)) return texLoader.load(path, invalidate);
  return proceduralGrain(path === TEAK_GRAIN ? "teak" : "bamboo", GRAIN_MEANS[path]);
}
const textureOf = (sku, key = "file") => {
  const path = TEXTURES[sku]?.[key];
  if (!path || (PUBLIC && key === "file")) return null;
  if (!texCache[path]) texCache[path] = loadImageTex(path);
  return texCache[path];
};
// The sliding extension's own bamboo, perspective-rectified from its top-view photo (the US
// hero) and cropped to a clean grain -- so it wears its real surface, not a borrowed one.
const loadTex = path => (texCache[path] ??= loadImageTex(path));
const BAMBOO_GRAIN = "tex/CK-153TR_top.jpg";
// Dedicated grain instances for the self-IGT wood tops, keyed by tile shape. Kept OUT of the
// shared cache so their tiling (repeat) does not fight the sliding extension, which draws the
// same bamboo photo at a different size. One instance per (key), repeat baked in once.
const WOOD_GRAIN = "tex/CK-116TR_grain.jpg";   // a clean bamboo crop -- no printed logo, unlike the _top photo
const TEAK_GRAIN = "tex/CK-180_teak.jpg";       // real teak, rectified from the CK-180 product photo
const STEEL_TEX = "tex/brushed_steel.jpg";      // brushed stainless (拉丝) for the Jikaro bridge
const woodTexCache = {};
function woodGrain(key, rx, ry, path = WOOD_GRAIN) {
  if (woodTexCache[key]) return woodTexCache[key];
  const t = loadImageTex(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(rx, ry);
  woodTexCache[key] = t;
  return t;
}
const steelTex = () => woodGrain("steel", 3, 1, STEEL_TEX);
// Chair fabrics: a canvas weave (a colour map) and a perforated mesh (an alphaMap -- kept in
// LINEAR space, since it is coverage data, not colour).
const CANVAS_TEX = "tex/canvas.jpg", MESH_ALPHA = "tex/chair_mesh.png";
function chairTex(key, path, rep, srgb) {
  if (woodTexCache[key]) return woodTexCache[key];
  const t = texLoader.load(path, invalidate);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(rep, rep);
  woodTexCache[key] = t;
  return t;
}
// The flat burner (GS-450R) shows its real top -- stainless well, brass head, ports, grate.
// (The GS-450R's photo top is gone: it was an oblique detail crop baked onto a flat plane,
// skewed from every angle but the photo's own. The burner is procedural geometry now.)
const burnerTop = () => null;

// Colours come from Snow Peak's product photography (catalog/colors.json). The swatch in
// the palette is the same colour the part is rendered in, so the two never drift.
const swatchOf = sku => COLORS[sku]?.color_hex || "#8a929c";
// A part's name in the interface's language. Official names exist in English (US store) and Japanese
// (JP store) only -- see i18n.js -- so Japanese shows the JP name and every other language the English.
const nameOf = p => (getLang() === "ja" && p?.title_jp) ? p.title_jp : (p?.title_en ?? "");

// Legs are aluminium: SILVER by default, every one of them. Black exists as a FINISH -- CK-109 and
// CK-112 sample pure black in Snow Peak's own photos, so black-anodised legs are real -- but which
// finish a leg wears is a decision on the node, not a property of the height you picked. The sampled
// per-SKU leg colour in colors.json conflated finish with height (picking a 400mm leg turned it
// black), so leg colour no longer reads from swatchOf; it reads the node's chosen finish. Default
// silver; that data stays only as evidence.
const LEG_SILVER = "#c0c4c8", LEG_BLACK = "#17191b";
const legColorOf = n => (n?.legFinish === "black" ? LEG_BLACK : LEG_SILVER);

// The selection can hold more than one node (shift-click). `state.sel` is the PRIMARY -- it drives
// the inspector, toolbar and numeric fields; `state.selSet` is the whole set. selectedIds() is it as
// an array. A plain click selects one; shift toggles membership.
function selectOnly(id) { state.sel = id; state.selSet = new Set(id == null ? [] : [id]); }
function toggleInSel(id) {
  if (state.selSet.has(id)) { state.selSet.delete(id); if (state.sel === id) state.sel = [...state.selSet].pop() ?? null; }
  else { state.selSet.add(id); state.sel = id; }
}
const selectedIds = () => state.selSet.size ? [...state.selSet] : (state.sel != null ? [state.sel] : []);
const isSelectedId = id => state.selSet.size ? state.selSet.has(id) : id === state.sel;

// ---------------------------------------------------------------- scene

const canvas = $("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Shadows, at last -- the missing dark seam under every frame and chair was the single
// biggest reason parts read as stickers floating over the ground. The depth pass is NOT
// per-frame: the scene only changes through rebuild(), so autoUpdate stays off and rebuild
// flips needsUpdate -- the steady-state rAF loop a phone pays for renders shadows for free.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);   // replaced by applyTheme() on boot

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
camera.position.set(1.6, 1.5, 2.1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.35, 0);
// Never under the ground: a layout is looked at from above or level with it, and below the horizon
// there is only the underside of a floor plane. Level (the front/side presets) is still allowed.
controls.maxPolarAngle = Math.PI / 2 - 0.01;
controls.maxDistance = 18;   // a place's horizon is painted 24m out; never back the camera through it
controls.addEventListener("change", invalidate);   // any camera input wakes the renderer
// The scroll wheel already dollies, so the middle button is free -- and PAN is what you actually
// reach for. Right pans too: on a canvas where the left button is spoken for, one obvious way to
// pan beats a clever one. (Right-CLICK still opens a module's menu -- OrbitControls only pans on a
// DRAG, and the contextmenu handler only fires when the press did not travel.)
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
// Touch: one finger turns it, two pan and pinch. These are the DEFAULTS, which is the whole point --
// they are what a hand already expects, and the only reason they never worked is that pointerdown
// was swallowing the first finger before OrbitControls ever saw it.
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
// WHO OWNS THE LEFT BUTTON, decided in one place because three things want it.
//   * Alt held      -> PAN. The trackpad half of the world has no middle button, and OrbitControls
//                      has no modifier map of its own, so the binding is swapped while the key is down.
//   * band tool on  -> NOBODY. `null` is not ignored: OrbitControls' own switch falls through to
//                      `default: state = STATE.NONE`, which is the clean way to say "not yours".
//                      `controls.enabled = false` is the wrong tool for it twice over -- it kills
//                      middle and right as well, and it loses a RACE, because OrbitControls has its
//                      own pointerdown on this canvas and it runs BEFORE anything in this file.
//   * otherwise     -> ROTATE.
// (Free, from reading the vendored source: MOUSE.ROTATE with shift/ctrl/meta held PANS by itself.
// So shift+drag on empty ground pans too, without anyone here arranging it.)
let altDown = false;
function syncLeft() {
  controls.mouseButtons.LEFT = altDown ? THREE.MOUSE.PAN : (bandTool || rulerTool) ? null : THREE.MOUSE.ROTATE;
}
const setAlt = down => { altDown = down; syncLeft(); };
addEventListener("keydown", e => { if (e.key === "Alt") setAlt(true); });
addEventListener("keyup", e => { if (e.key === "Alt") setAlt(false); });
// Put it back on blur, or alt-tabbing away leaves the canvas panning on left-drag forever.
addEventListener("blur", () => setAlt(false));

const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x33383f, 1.5);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 3.4, 1.8);
// A tight ortho frustum: layouts live within a few metres of the origin, and shadow-map
// texels spent on empty floor are texels the contact seam does not get.
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -4.5;
key.shadow.camera.right = key.shadow.camera.top = 4.5;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 12;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.015;
scene.add(key);
scene.add(key.target);
// The catcher: ShadowMaterial renders NOTHING but the shadows cast on it, so the bare grid
// floor gets a contact seam without getting a floor. The textured grounds receive on their
// own mesh and this plane sits just beneath them, invisible either way.
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.ShadowMaterial({ opacity: 0.3 }),
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = -0.001;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);
// The floor grid. Its colours are baked into the geometry, so a theme change rebuilds it.
// It is graph paper: ON only for the bare "Grid" ground, OFF once a real surface is chosen (you do
// not rule a lawn) -- but a theme change rebuilds the grid, so it re-reads that choice each time.
let grid = null;
let currentGround = "grid";
function setGrid(major, minor) {
  if (grid) scene.remove(grid);
  grid = new THREE.GridHelper(8, 32, major, minor);
  grid.visible = currentGround === "grid";
  scene.add(grid);
}
setGrid(0x2b3038, 0x21252b);

// ---- ground surface ------------------------------------------------------------------------------
// A textured ground for setting a layout in a place instead of on graph paper. The textures are
// GENERATED on a canvas, not fetched -- so there is nothing to source, nothing to license, and nothing
// to ship: it stays as self-contained as the rest of the planner. Choosing a real surface HIDES the
// grid (see setGround): the grid is graph paper for reading distances off the bare floor, and it reads
// as litter once there is grass or wood under it -- the ruler tool is there when you actually need a
// measurement. The choice belongs to the PAGE (state.scene, in the layout doc): it was once a browser-wide
// preference like the theme, until places made it part of the design -- this page is on the beach, that
// one in the meadow -- so now it switches with the tab and travels in a shared link.
function groundCanvas(draw) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  draw(c.getContext("2d"), 512);
  return c;
}
function makeGrassTexture() {
  return groundCanvas((ctx, S) => {
    ctx.fillStyle = "#3d4b2e"; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 14000; i++) {                 // short blades in varied greens
      const x = Math.random() * S, y = Math.random() * S, g = 58 + Math.random() * 66;
      ctx.strokeStyle = `rgb(${g * 0.55 | 0},${g | 0},${g * 0.48 | 0})`;
      ctx.globalAlpha = 0.45 + Math.random() * 0.5;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 2.5, y - 2 - Math.random() * 3.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 34; i++) {                    // faint darker patches
      ctx.fillStyle = `rgba(18,28,14,${0.05 + Math.random() * 0.09})`;
      ctx.beginPath(); ctx.arc(Math.random() * S, Math.random() * S, 22 + Math.random() * 64, 0, 7); ctx.fill();
    }
  });
}
function makeWoodTexture() {
  return groundCanvas((ctx, S) => {
    const planks = 6, pw = S / planks;
    for (let i = 0; i < planks; i++) {
      const b = 100 + (Math.random() * 26 - 13);      // per-plank brown
      ctx.fillStyle = `rgb(${b + 32 | 0},${b | 0},${b - 42 | 0})`;
      ctx.fillRect(i * pw, 0, pw, S);
      for (let j = 0; j < 90; j++) {                  // grain streaks along the plank
        const d = Math.random() * 40 - 20, x = i * pw + Math.random() * pw, y = Math.random() * S;
        ctx.strokeStyle = `rgba(${b + 32 + d | 0},${b + d | 0},${b - 42 + d | 0},0.4)`;
        ctx.lineWidth = 0.5 + Math.random();
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 4, y + 12 + Math.random() * 40); ctx.stroke();
      }
      ctx.fillStyle = "rgba(28,18,8,0.6)";            // dark seam between planks
      ctx.fillRect((i + 1) * pw - 1.5, 0, 1.5, S);
      // End joints: boards are ~1.2m long at this scale, butted end to end, staggered row to row.
      const off = (i * 0.37 % 1) * S;
      for (const y of [off, (off + S / 2) % S]) ctx.fillRect(i * pw, y, pw - 1.5, 1.5);
    }
  });
}
function makeGravelTexture() {
  return groundCanvas((ctx, S) => {
    ctx.fillStyle = "#565654"; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2400; i++) {                  // pebbles, each with a small shadow
      const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 6.5, v = 58 + Math.random() * 96;
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.beginPath(); ctx.ellipse(x + r * 0.35, y + r * 0.35, r, r * 0.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = `rgb(${v | 0},${v | 0},${v * 0.97 | 0})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.7 + Math.random() * 0.3), Math.random() * 3, 0, 7); ctx.fill();
    }
  });
}
function makeSandTexture() {
  return groundCanvas((ctx, S) => {
    ctx.fillStyle = "#bfa87f"; ctx.fillRect(0, 0, S, S);
    const img = ctx.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) {           // fine per-pixel grain
      const n = Math.random() * 28 - 14;
      d[i] += n; d[i + 1] += n * 0.95; d[i + 2] += n * 0.8;
    }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 2600; i++) {                  // darker specks
      ctx.fillStyle = `rgba(120,100,70,${0.1 + Math.random() * 0.18})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random(), 1 + Math.random());
    }
  });
}
const GROUNDS = {
  grid:   { name: "Grid" },                                                     // no texture -- the bare CAD floor
  grass:  { name: "Grass",  make: makeGrassTexture,  repeat: 8, rough: 0.96 },
  wood:   { name: "Wood",   make: makeWoodTexture,   repeat: 36, rough: 0.72 },   // 6 boards a tile -> ~12cm each
  gravel: { name: "Gravel", make: makeGravelTexture, repeat: 8, rough: 0.95 },
  sand:   { name: "Sand",   make: makeSandTexture,   repeat: 7, rough: 0.9 },
};
const LS_GROUND = "igt.ground";   // LEGACY: the scene was once browser-wide; read once at boot to migrate
const groundTexCache = {};
let groundMesh = null;
function groundTexture(key) {
  if (groundTexCache[key]) return groundTexCache[key];
  const g = GROUNDS[key];
  const tex = new THREE.CanvasTexture(g.make());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(g.repeat, g.repeat);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  groundTexCache[key] = tex;
  return tex;
}
// ---- places: a backdrop, a sky and the light that goes with them --------------------------------
// The grounds put a layout ON something. A place puts it SOMEWHERE: a ground, plus a horizon all the
// way round -- mountains, a pine treeline, the sea, desert mesas, a starry night -- and the light and
// haze that belong to it. For fun, and for the photo plate, which is where a layout gets shown off.
//
// The same rule as the grounds: everything is GENERATED on a canvas. Nothing is fetched, nothing is
// licensed, and the panorama is built from whole-number harmonics so it closes on itself with no seam.
// It is painted on the inside of a wide open cylinder; the ground fades into fog of the horizon's own
// colour before it gets there, so the two meet without an edge.
//
// Vertically the canvas spans BACKDROP_Y0..BACKDROP_Y1 metres on a BACKDROP_R-metre cylinder, so a
// shape's height in metres is just its height on the canvas -- a 5m ridge 24m off reads as a range.
const BACKDROP_R = 24, BACKDROP_Y0 = -1, BACKDROP_Y1 = 15;   // 40m read as too far off -- the owner wanted the hills to loom
const PANO_W = 4096, PANO_H = 1024;
const PX_PER_M = PANO_H / (BACKDROP_Y1 - BACKDROP_Y0);
const HORIZON = PANO_H - (0 - BACKDROP_Y0) * PX_PER_M;     // canvas row of y = 0

const PLACES = {
  meadow: {
    name: "Alpine meadow", ground: "grass",
    sky: ["#4f86cf", "#9dc1e8", "#dfe9f1"], haze: "#d3dde6", clouds: 7,
    layers: [
      { kind: "mountains", m: 6.5, color: "#9aaec3", snow: "#f1f5f9", seed: 3 },
      { kind: "mountains", m: 3.2, color: "#6f8a83", seed: 8 },
      { kind: "trees", m: 1.6, color: "#3f5d45", seed: 11, count: 220 },
    ],
    light: { sky: 0xf3f7ff, ground: 0x2b3a22, hemi: 1.55, key: 0xfff3dc, keyI: 1.65, exposure: 0.95 },
  },
  forest: {
    name: "Pine forest", ground: "grass",
    sky: ["#8fa7b8", "#c4d1d6", "#dfe4e1"], haze: "#cfd7d3", clouds: 4,
    layers: [
      { kind: "trees", m: 4.2, color: "#7d9188", seed: 21, count: 420 },
      { kind: "trees", m: 3.4, color: "#4d6457", seed: 22, count: 360 },
      { kind: "trees", m: 2.6, color: "#2f4436", seed: 23, count: 300 },
    ],
    light: { sky: 0xe8f0ea, ground: 0x23301e, hemi: 1.45, key: 0xfff1df, keyI: 1.2, exposure: 0.95 },
  },
  beach: {
    name: "Beach", ground: "sand",
    sky: ["#3f8fd8", "#8fc4ee", "#e4f1f8"], haze: "#e6eef0", clouds: 6,
    layers: [
      { kind: "mountains", m: 1.6, color: "#a9bccb", seed: 31, span: [0.08, 0.3] },   // a far headland
      { kind: "sea", m: 0.9, color: "#3b7fae", foam: "#e8f2f4" },
    ],
    light: { sky: 0xf6fbff, ground: 0x8a7a5c, hemi: 1.7, key: 0xfffaf0, keyI: 1.75, exposure: 0.92 },
  },
  desert: {
    name: "Desert dusk", ground: "sand",
    sky: ["#2d3b78", "#c8738a", "#f4b46e"], haze: "#e7a77c", sun: { x: 0.62, color: "#ffd9a0" },
    layers: [
      { kind: "mesas", m: 4.0, color: "#9a5a52", seed: 41 },
      { kind: "mesas", m: 2.2, color: "#6e3b38", seed: 42 },
    ],
    light: { sky: 0xffd6c0, ground: 0x6a4b38, hemi: 1.25, key: 0xffb27a, keyI: 1.5, exposure: 0.9 },
  },
  night: {
    name: "Starry night", ground: "grass",
    sky: ["#03050c", "#0b1430", "#1e2c4c"], haze: "#1b2742", stars: 900, moon: { x: 0.3, y: 0.42 },
    layers: [
      { kind: "mountains", m: 3.8, color: "#141d33", seed: 51 },
      { kind: "trees", m: 2.0, color: "#070b14", seed: 52, count: 320 },
    ],
    light: { sky: 0x6f84b8, ground: 0x0d1220, hemi: 0.75, key: 0xb9c8ff, keyI: 0.55, exposure: 0.85 },
  },
};

function rng32(seed) {                                    // mulberry32: same place, same panorama
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// A skyline profile in 0..1 around the circle, built from WHOLE-NUMBER harmonics so it is periodic:
// the right edge of the canvas meets the left exactly. `base` is how many big features go round the
// whole circle -- the camera sees about a sixth of it, so a base of 1 would read as a flat wall.
function ridgeProfile(seed, { base = 6, sharp = 1.8 } = {}) {
  const r = rng32(seed), H = [];
  for (let i = 1; i <= 12; i++)
    H.push({ k: Math.max(1, Math.round(base * i * (0.75 + r() * 0.5))), a: 1 / Math.pow(i, 1.35), p: r() * 7 });
  const raw = x => H.reduce((s, h) => s + h.a * Math.sin(2 * Math.PI * h.k * x + h.p), 0);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 2048; i++) { const v = raw(i / 2048); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return x => Math.pow((raw(x) - lo) / (hi - lo), sharp);
}

function paintPlace(place) {
  const c = document.createElement("canvas");
  c.width = PANO_W; c.height = PANO_H;
  const g = c.getContext("2d");
  const W = PANO_W, Y = HORIZON;
  const sky = g.createLinearGradient(0, 0, 0, Y);
  sky.addColorStop(0, place.sky[0]); sky.addColorStop(0.62, place.sky[1]); sky.addColorStop(1, place.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, Y);
  g.fillStyle = place.haze; g.fillRect(0, Y, W, PANO_H - Y);          // below the horizon: the ground's haze
  const r = rng32(7);
  const wrap = (x, fn) => { fn(x); if (x < 200) fn(x + W); if (x > W - 200) fn(x - W); };

  if (place.sun) {
    const sx = place.sun.x * W, glow = g.createRadialGradient(sx, Y, 0, sx, Y, 520);
    glow.addColorStop(0, place.sun.color); glow.addColorStop(1, "rgba(255,200,150,0)");
    g.fillStyle = glow; g.fillRect(sx - 520, Y - 520, 1040, 520);
  }
  if (place.stars) for (let i = 0; i < place.stars; i++) {
    const x = r() * W, y = r() * Y * 0.92, a = 0.25 + r() * 0.75, s = r() < 0.06 ? 2 : 1;
    g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, s, s);
  }
  if (place.moon) {
    const mx = place.moon.x * W, my = place.moon.y * Y;
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 120);
    halo.addColorStop(0, "rgba(220,230,255,.35)"); halo.addColorStop(1, "rgba(220,230,255,0)");
    g.fillStyle = halo; g.fillRect(mx - 120, my - 120, 240, 240);
    g.fillStyle = "#eef2fb"; g.beginPath(); g.arc(mx, my, 22, 0, 7); g.fill();
  }
  for (let i = 0; i < (place.clouds || 0); i++) {      // soft streaks, a few overlapping puffs each
    const cx = r() * W, cy = Y * (0.25 + r() * 0.45), w = 160 + r() * 320;
    for (let j = 0; j < 7; j++) wrap(cx + (r() - 0.5) * w, x => {
      const rr = 30 + r() * 50, gr = g.createRadialGradient(x, cy, 0, x, cy, rr * 1.8);
      gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(x - rr * 1.8, cy - rr, rr * 3.6, rr * 2);
    });
  }

  for (const L of place.layers) {
    const hmax = L.m * PX_PER_M;
    if (L.kind === "mountains" || L.kind === "mesas") {
      const prof = L.kind === "mesas" ? ridgeProfile(L.seed, { base: 9, sharp: 1 }) : ridgeProfile(L.seed);
      const jag = ridgeProfile(L.seed + 100, { base: 60, sharp: 1 });   // fine texture for the snow line
      // One filled PATH, not a fence of 2px columns: the canvas antialiases a path's edge, and a ridge
      // magnified on a 40m wall shows every stair of a column fill.
      const hAt = u => {
        if (L.span && (u < L.span[0] || u > L.span[1])) return 0;
        let h = prof(u);
        if (L.span) h *= Math.sin(Math.PI * (u - L.span[0]) / (L.span[1] - L.span[0]));   // a headland tapers into the sea
        // Mesas: where the profile clears 0.62 it becomes a flat-topped butte with near-vertical sides;
        // below that, low rolling ground. Isolated tables, not a wall.
        if (L.kind === "mesas") h = h > 0.62 ? 0.82 + (h - 0.62) * 0.3 : h > 0.56 ? 0.25 + (h - 0.56) * 9.5 : h * 0.45;
        return h;
      };
      const ridge = new Path2D();
      ridge.moveTo(0, Y + 1);
      for (let x = 0; x <= W; x += 3) ridge.lineTo(x, Y - hAt(x / W) * hmax);
      ridge.lineTo(W, Y + 1); ridge.closePath();
      g.fillStyle = L.color; g.fill(ridge);
      if (L.snow) {                                     // the snow: everything above a ragged line, inside the ridge
        g.save(); g.clip(ridge);
        g.beginPath(); g.moveTo(0, 0);
        for (let x = 0; x <= W; x += 3) g.lineTo(x, Y - (0.58 + (jag(x / W) - 0.5) * 0.12) * hmax);
        g.lineTo(W, 0); g.closePath();
        g.fillStyle = L.snow; g.fill();
        g.restore();
      }
    } else if (L.kind === "trees") {
      const tr = rng32(L.seed);
      g.fillStyle = L.color;
      for (let i = 0; i < L.count; i++) {
        const x = tr() * W, h = hmax * (0.55 + tr() * 0.45), w = h * (0.32 + tr() * 0.1);
        wrap(x, xx => {
          for (let t = 0; t < 3; t++) {                 // three stacked tiers: a conifer, not a triangle
            const ty = Y - h * (0.2 + t * 0.27), th = h * (0.55 - t * 0.1), tw = w * (1 - t * 0.22);
            g.beginPath(); g.moveTo(xx - tw / 2, ty + th * 0.35); g.lineTo(xx, ty - th * 0.65); g.lineTo(xx + tw / 2, ty + th * 0.35); g.fill();
          }
          g.fillRect(xx - w * 0.04, Y - h * 0.2, w * 0.08, h * 0.2);
        });
      }
    } else if (L.kind === "sea") {
      const top = Y - L.m * PX_PER_M;
      const sea = g.createLinearGradient(0, top, 0, Y);
      sea.addColorStop(0, L.color); sea.addColorStop(1, "#6fa9c6");
      g.fillStyle = sea; g.fillRect(0, top, W, Y - top + 1);
      g.fillStyle = L.foam;
      for (let i = 0; i < 260; i++) g.fillRect(r() * W, top + r() * (Y - top), 12 + r() * 40, 1);
    }
  }
  return c;
}

const backdropCache = {};
let backdrop = null;
function setBackdrop(key) {
  if (backdrop) { scene.remove(backdrop); backdrop.geometry.dispose(); backdrop.material.dispose(); backdrop = null; }
  const place = PLACES[key];
  if (!place) return;
  if (!backdropCache[key]) {
    const t = new THREE.CanvasTexture(paintPlace(place));
    t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    backdropCache[key] = t;
  }
  backdrop = new THREE.Mesh(
    new THREE.CylinderGeometry(BACKDROP_R, BACKDROP_R, BACKDROP_Y1 - BACKDROP_Y0, 128, 1, true),
    // fog:false -- the painting carries its own haze; toneMapped:false -- its colours are final.
    new THREE.MeshBasicMaterial({ map: backdropCache[key], side: THREE.BackSide, fog: false, toneMapped: false }),
  );
  backdrop.position.y = (BACKDROP_Y0 + BACKDROP_Y1) / 2;
  scene.add(backdrop);
}

/** A place's sky, haze and light, laid over whatever the theme just set. */
function applyPlaceLight(name) {   // not `key`: that is the sun (the DirectionalLight) in this file
  const place = PLACES[name];
  if (!place) return false;
  const L = place.light;
  scene.background = new THREE.Color(place.sky[0]);
  scene.fog = new THREE.Fog(new THREE.Color(place.haze), 7, BACKDROP_R - 3);
  hemi.color.set(L.sky); hemi.groundColor.set(L.ground); hemi.intensity = L.hemi;
  key.color.set(L.key); key.intensity = L.keyI;
  renderer.toneMappingExposure = L.exposure;
  return true;
}

/** Set the scene. It belongs to the PAGE (state.scene, saved in its doc, carried by a shared link),
 *  not to the browser: `record` false is for loading a doc / undo, where it is already the record. */
function setGround(key, { record = true } = {}) {
  if (!GROUNDS[key] && !PLACES[key]) key = "grid";
  const changed = state.scene !== key;
  currentGround = key;
  state.scene = key;
  if (groundMesh) { scene.remove(groundMesh); groundMesh.material.dispose(); groundMesh.geometry.dispose(); groundMesh = null; }
  if (grid) grid.visible = key === "grid";            // graph paper only on the bare floor
  const place = PLACES[key];
  const surface = place ? place.ground : key;         // a place stands on one of the grounds
  setBackdrop(key);
  if (surface !== "grid") {
    const g = GROUNDS[surface];
    // A place's floor runs out to its horizon (the fog takes it before the backdrop), so it is far
    // bigger -- with its UVs scaled to match, or the same texture would tile four times coarser.
    const size = place ? BACKDROP_R * 2.2 : 26;
    const geo = new THREE.PlaneGeometry(size, size);
    if (place) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 26, uv.getY(i) * size / 26); }
    groundMesh = new THREE.Mesh(
      geo,                                            // wide enough that the fog swallows its edge
      new THREE.MeshStandardMaterial({ map: groundTexture(surface), roughness: g.rough, metalness: 0 }),
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.003;                   // just under the grid lines and the parts' feet
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
  }
  // Ground bounce: the hemisphere's under-light takes the surface's own colour, so grass
  // reflects green up at the parts instead of studio grey -- the cheapest cue after shadows
  // that things stand IN the scene rather than on a swatch of it.
  const BOUNCE = { grass: 0x25301c, wood: 0x4a3c28, gravel: 0x353533, sand: 0x74644c };
  hemi.groundColor.set(BOUNCE[surface] || 0x33383f);
  // Sky, haze and sun: a place sets its own; leaving one hands them back to the theme.
  applyTheme(document.documentElement.dataset.theme || "light");
  renderer.shadowMap.needsUpdate = true;
  invalidate();
  const sel = $("groundsel");
  if (sel && sel.value !== key) sel.value = key;
  if (record && changed) commitHistory();            // undoable, and autosaved into the page like any edit
}

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

const nodeMeshes = [];   // meshes carrying .node      (picking + dragging tables)
const slotMeshes = [];   // meshes carrying .placement (dragging modules)
const edgeMeshes = [];   // meshes carrying .edge      (the hover-to-extend handles)
const slotHandleMeshes = []; // meshes carrying .slot   (hover-a-free-slot-to-add-a-module)

// The two anodised finishes on an IGT frame -- brushed aluminium and matte black -- both
// sampled off the product photos. Which surface wears which is what tells the families
// apart, so they are named here rather than pulled from a single swatch that can only be
// one colour.
// The frame's aluminium/black finishes and its rivets now live with the geometry, in
// frameGroup (parts3d.js) -- ALU/BLK and the rivet helper moved there with the shell.

function drawFrame(g, n) {
  const p = PARTS[n.sku];
  const f = footprint(n);
  const top = topOf(n);
  const isSel = state.sel === n.id;
  const glow = isSel ? 0x0a1a3a : 0x000000;

  // The frame SHELL -- rails, black end pieces, hook holes, corner plates, rivets -- is built
  // by frameGroup in parts3d.js, so the part bench draws the identical frame (recess and all)
  // instead of a slab. The two families wear the finishes the other way round (standard =
  // silver rails + black ends; collapsible = black rails + silver corner hinges); frameGroup
  // reads p.collapsible for it. Legs and modules are placement, and stay here.
  const collapsible = !!p.collapsible;
  const { group: shell, pick } = frameGroup({
    w: f.w, d: f.d, thick: FRAME_THICK, collapsible,
    section: SECTION, hookHoles: FRAMES[n.sku]?.hook_holes_mm, holeInset: HOLE_INSET, glow,
  });
  shell.position.y = top * MM;
  for (const m of pick) { m.userData.node = n; nodeMeshes.push(m); }
  g.add(shell);

  // Legs: a straight tube with a black adjuster foot -- measured, not styled. The leg heroes
  // (web/img/CK-112.jpg, CK-113.jpg, CK-114.jpg) hold one diameter end to end -- CK-113's tube
  // scans 22-23px across its whole 588px length -- so a drawn taper would be invented, and with
  // four-plus legs under every table a non-parallel silhouette shows at iso framing. The foot
  // is the height adjuster in CK-112's JP detail shots: a black sleeve on the tube, a shade
  // narrower at the waist, then a wider knurled cap rounded at the bottom -- ~33mm of black in
  // all, barely wider than the tube. No socket collar at the top: the assembled shots
  // (CK-150LOW.jpg, CK-149's JP gallery) show the tube meeting the frame's underside clean and
  // constant-width to the last pixel before the rail, so none is drawn.
  // The legs go in the sockets, and the sockets were measured off the frame's underside:
  // CK-149's are at x=+/-347, z=+/-207.5. The old code put them 40mm in from each edge --
  // right by luck in z, 36mm out in x.
  const leg = PARTS[n.leg];
  if (leg?.height_mm) {
    const h = leg.height_mm;
    const measured = FRAMES[n.sku]?.leg_sockets_mm;
    // Sockets are measured on the 3-unit frame; a longer frame moves them out with its
    // ends, so hold the inset from the end rather than the absolute x.
    const ref = FRAMES["CK-149"];
    const inset = ref ? (846 / 2) - Math.abs(ref.leg_sockets_mm[0][0]) : 40;
    const sideIn = ref ? (496 / 2) - Math.abs(ref.leg_sockets_mm[0][1]) : 40;
    let spots = measured || [
      [-(f.w / 2 - inset), -(f.d / 2 - sideIn)], [-(f.w / 2 - inset), f.d / 2 - sideIn],
      [f.w / 2 - inset, -(f.d / 2 - sideIn)], [f.w / 2 - inset, f.d / 2 - sideIn],
    ];
    // Frames joined with a CK-175 can SHARE the joint: the continuation drops the two legs at
    // its joined end (the pair nearest the host). User's choice -- default keeps its own four.
    const host2 = byId(n.host);
    if (host2 && n.sharedJoint) {
      const loc = rotv({ x: host2.x - n.x, z: host2.z - n.z }, -n.rot);   // host direction, frame-local
      const jointX = Math.sign(loc.x);
      spots = spots.filter(([lx]) => Math.sign(lx) !== jointX);
    }
    const FOOT = 33, WAIST = 16, CAP = 12;   // the black stack, off CK-113's hero at 1.12mm/px
    for (const [lx, lz] of spots) {
      const shaft = stock(
        new THREE.CylinderGeometry(LEG_R * MM, LEG_R * MM, (h - FOOT) * MM, 16),
        new THREE.Color(legColorOf(n)), 0.85, 0.3,
      );
      shaft.position.set(lx, (h + FOOT) / 2, lz).multiplyScalar(MM);
      g.add(shaft);
      // the adjuster's waist, a shade narrower than the tube (21.5px against the tube's 23)
      const waist = stock(
        new THREE.CylinderGeometry(LEG_R * 0.93 * MM, LEG_R * 0.93 * MM, WAIST * MM, 14),
        0x2a2d31, 0.1, 0.85,
      );
      waist.position.set(lx, FOOT - WAIST / 2, lz).multiplyScalar(MM);
      g.add(waist);
      // the knurled cap, barely wider than the tube (27px against 23), rounded off underneath
      const cap = stock(
        new THREE.CylinderGeometry(LEG_R * 1.18 * MM, LEG_R * 1.18 * MM, CAP * MM, 14),
        0x2a2d31, 0.1, 0.85,
      );
      cap.position.set(lx, 7 + CAP / 2, lz).multiplyScalar(MM);
      g.add(cap);
      const tip = stock(new THREE.SphereGeometry(LEG_R * 1.18 * MM, 12, 8), 0x2a2d31, 0.1, 0.85);
      tip.scale.y = 0.45;
      tip.position.set(lx, 7, lz).multiplyScalar(MM);
      g.add(tip);
    }
  }

  drawModules(g, n, top);
}

/** Render the modules dropped into a host's bay -- SHARED by the frame, the bridged Jikaro and
 *  the opened Extension IGT, so all three take the same parts the same way. Modules are drawn at
 *  their OWN width, centred in the slots they claim (a 5mm-narrow tray shows a real gap; the Flat
 *  Burner's wider rim really overlaps), and drop IN from `top`, the bay's work surface. */
function drawModules(g, n, top) {
  for (const pl of n.placements) {
    const p2 = PARTS[pl.sku];
    const cx = slotX(n, pl.start) + (pl.span * HALF) / 2;

    // A hanging rack occupies the slots but hangs BELOW -- it is not a tray in the frame.
    if (isHangRack(p2)) { drawHangRack(g, n, pl, cx, top); continue; }

    const w = railW(p2), d = depthOf(p2), h = p2.assembled_mm?.h ?? 40;
    const y = top - h / 2;   // modules drop IN; nothing sits on the frame any more

    // Everything with a real 3D form comes from parts3d.js, so the part bench draws the
    // identical object. A burner, a wire mesh tray, a box or bin -- built once, shared.
    const built = moduleGroup(p2, w, d, h, swatchOf(p2.sku), burnerTop(p2.sku), pl.config);
    if (built) { dropModule(g, n, pl, cx, top, built); continue; }

    // A flat insert or lid that drops into the slot: a bamboo board, a stainless lid-tray.
    // Drawn at the RECESS depth, not its full thickness, so its edge fills the rail's ~10mm
    // rebate and its face lands flush -- a full-thickness slab would clip straight through
    // the rail's inner wall (which is exactly what the owner was seeing).
    const grain = textureOf(p2.sku, "grain");
    if (grain) {
      const geo = t => flatBoardGeo(p2, w, d, t);
      const board = new THREE.Mesh(geo(RAIL_RECESS), grainMaterial(p2, COLORS, grain, w, d, false));
      board.position.set(cx, top, 0).multiplyScalar(MM);
      board.userData.placement = pl; board.userData.node = n;
      g.add(board); slotMeshes.push(board);
      const tex = textureOf(p2.sku);
      if (tex) {
        const decal = new THREE.Mesh(geo(0.4),
          boardMaterial(p2, COLORS, tex, w * MM, d * MM, false));
        decal.position.set(cx, top + 0.4, 0).multiplyScalar(MM);
        g.add(decal);
      }
      continue;
    }

    // Anything left is a simple slab (a thin tray, a plate insert): its own box, its colour.
    const m = partMesh(p2, w, h, d);
    m.position.set(cx, y, 0).multiplyScalar(MM);
    m.userData.placement = pl; m.userData.node = n;
    g.add(m); slotMeshes.push(m);
  }
}

// What 3D form a slotted part takes -- burner, mesh tray, or box/bin -- built from the
/** A hanging rack, below the frame. Its hooks rest OVER the rails (not in a slot), and it
 *  drops one or two shelves down inside the frame's depth.
 *
 *  CK-230 brings its own base plate (a solid shelf); CK-220 hangs two OPEN frames meant to
 *  hold trays and boxes. The one fact the drawing must not fudge: CK-220's assembled height
 *  is NOT published -- only its packed size is -- so the drop is modelled, and it is drawn
 *  a little translucent to say "this height is an estimate, not a measurement".
 */
function drawHangRack(g, n, pl, cx, top) {
  const p = PARTS[pl.sku];
  const a = p.assembled_mm;
  // Side frames, hooks and tiers come from hangRackGroup in parts3d.js -- one rack, both
  // renderers. It hangs from y=0 to -drop, so place it at the slot centre and the frame
  // top. CK-220's assembled height is not published (only packed), so it is drawn a little
  // translucent to say "estimated". The rack is mostly air now, so picking rides its faint
  // ghost box (`body`) -- the same deal as the mesh trays.
  const { group, body } = hangRackGroup({
    w: a.w, d: a.d, drop: a.h, tiers: p.tiers || 1,
    hasSurface: !!p.has_surface, color: swatchOf(p.sku), estimated: p.assembled_estimated,
  });
  group.position.set(cx * MM, top * MM, 0);
  body.userData.placement = pl; body.userData.node = n; slotMeshes.push(body);
  g.add(group);
}

/** The Jikaro: an octagonal ring of four trapezoid segments, with the fire in the hole.
 *
 *  Four pieces, and they go together either way round -- which is two different tables, not
 *  a detail. Both are here because the app has to be able to plan either.
 *
 *  It stands on folding WIRE legs, one pair per segment. They are part of the table; there
 *  is no leg SKU to buy. What hooks onto it does need legs, and at 400mm.
 */
function drawJikaro(g, n) {
  const p = PARTS[n.sku];
  const c = jikaroCfg(n);
  const top = topOf(n);
  const isSel = state.sel === n.id;

  // Ring, seams and folding wire legs come from jikaroGroup in parts3d.js -- same table in
  // the bench. It builds with the ring top at y=0 and the legs dropping to -height, so the
  // group sits at the table height and the legs reach the ground.
  const { group } = jikaroGroup({
    outer: c.outer_mm, opening: c.opening_mm, edge: c.edge_mm, height: top,
    color: swatchOf(n.sku), ringMat: materialFor(p, COLORS, isSel),
  });
  group.position.y = top * MM;
  const ring = group.children[0];
  ring.userData.node = n; g.add(group); nodeMeshes.push(ring);

  // An OPTIONAL bridge across the fire opening turns it into an IGT bay (2U spread / 1U compact).
  if (n.bridge) {
    const { group: bg } = jikaroBridge({ opening: c.opening_mm, units: c.bridge_units || 2, tex: steelTex() });
    bg.position.y = top * MM;
    bg.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(bg);
    drawModules(g, n, top);   // modules drop into the bridged bay, same as a frame
  }
}

// The flat-board geometry (traced corners/notched bamboo, dimension-built rectangles with a
// punched finger hole) lives in parts3d.js so the part bench builds the identical shape.
const flatBoardGeo = (p, w, d, thickMM) => flatGeo(p.role, TEXTURES[p.sku], w, d, thickMM);

/** Drop a shared part group into a frame slot: place it at the slot centre with its rim at
 *  the frame top, and make its `body` the drag target. The geometry lives in parts3d.js so
 *  the part bench draws the identical thing -- one shape, one source. */
function dropModule(g, n, pl, cx, top, built) {
  const { group, body } = built;
  group.position.set(cx * MM, top * MM, 0);
  body.userData.placement = pl; body.userData.node = n;
  g.add(group); slotMeshes.push(body);
}

/** A sliding extension on a frame's long rail: the cantilevered bamboo board (slideExtGroup,
 *  the same shape the bench draws) hung at the host's work-surface height so its top is flush,
 *  reaching outward. No legs -- it grips the rail. The node group is already placed and turned
 *  by rebuild(); this draws it in local coordinates. */
function drawSlideExt(g, n) {
  const p = PARTS[n.sku];
  const host = byId(n.host);
  const top = host ? topOf(host) : (PARTS[n.leg]?.height_mm ?? 400) + FRAME_THICK;
  const w = railW(p), d = depthOf(p), h = p.assembled_mm?.h ?? 33;
  const { group, body } = slideExtGroup(w, d, h, swatchOf(n.sku), loadTex(BAMBOO_GRAIN));
  group.position.y = top * MM;
  body.userData.node = n; g.add(group); nodeMeshes.push(body);
}

// Prop geometry by `chair` type. A prop's builder takes (w, d, h, opts) and returns { group }.
// Free-standing things placed around the layout. Keyed by the part's own builder name -- `chair` for
// the seating, `prop` for anything that stands on the ground but isn't one (the fire pit). A hearth
// with `chair: "takibi"` would be a lie; the taxonomy is worth one extra key.

/** A free-standing prop (a chair): built at floor level (y = 0), tagged for selection + drag like
 *  a table but never connected to the IGT grid -- no hooks, no bay, no legs. */
function drawProp(g, n) {
  const p = PARTS[n.sku];
  // The scale figures bypass propGroup: they have no catalog record for it to key on, and
  // their whole state -- height and pose -- is per-NODE, which is this function's half.
  if (p.role === "figure") {
    const built = figureGroup(figH(n), { toddler: p.figure === "toddler", pose: n.pose || "stand" });
    built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(built.group);
    return;
  }
  // WHICH builder, and the part's own colours, come from propGroup in parts3d.js -- shared with the
  // bench, because "two sources of truth for which shape" is how the bench ended up drawing a stove
  // as a burner disc. Everything passed in here is per-NODE state, which is the only part of this
  // the bench has no opinion about:
  //  - the Takibi's four options are FOUR independent decisions on one fire pit (bridge, what's on
  //    it, coal bed, ground plate) -- a real setup mixes them, so they are not one enum;
  //  - the GS-1000's canister is OFF by default: it is 専用容器, bought separately, and not in the
  //    stove's 1,800g. The stove is what you own; the can is what you happened to bring.
  const built = propGroup(p, {
    folded: n.config === "folded",                                        // lounge cushion: round vs folded
    bridge: !!n.bridge, surface: n.surface || null, coalBed: !!n.coal, basePlate: !!n.base,
    canister: !!n.canister,
  }, {
    canvas: () => chairTex("canvas", CANVAS_TEX, 4, true),
    mesh: () => chairTex("mesh", MESH_ALPHA, 6, false),
    wood: () => woodGrain("shelfwood", 3, 1),                             // bamboo grain on the shelf top
  });
  built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
  g.add(built.group);
}

/** A shelter footprint (tent / shell / tarp): its ground outline laid flat as a scale reference.
 *  Not a solid object -- a translucent membrane + bright outline + billboard label, tagged for
 *  drag / rotate / delete like any node but never connected to anything. */
function drawFootprint(g, n) {
  const p = PARTS[n.sku];
  const built = shelterOf(p, n.sku);   // shared with the bench -- see propGroup
  // Locked = a backdrop: only the CURRENTLY SELECTED footprint stays pickable (so you can still
  // drag the one you're placing), every other one is click-through so it can't steal a click meant
  // for the furniture standing on it. Unlocked = all footprints pick normally. Either way it draws.
  const pickable = !state.shelterLock || n.id === state.sel;
  if (pickable) {
    built.body.userData.node = n;
    nodeMeshes.push(built.body);
  }
  g.add(built.group);
  // The ridge tarps STAND now -- membrane, poles, guys -- so "does the kitchen fit under it"
  // finally has a height answer, not just a floor one. The flat outline stays underneath:
  // it is still the placement handle and the size label. Tents and shells stay flat until
  // they earn bodies of their own.
  let body = null;
  if (p.shelter_type === "tarp") {
    const vs = shelterVerts(p.geometry);
    const color = COLORS[n.sku]?.color_hex || 0x8a7460;
    const pitchH = Number(n.config) || p.assembled_mm.h;   // the chosen Wing Pole, or the set's
    // 4 = recta's roof pitch; 6 and 8 = the hexa swoop (the Octa is a hexa with clipped
    // tips -- the midpoint-splice path handles its ridge); 5 = the Penta's one-pole wedge.
    if (vs.length === 5)
      body = pentaTarpGroup({ verts: vs, h: pitchH, color });
    else if (vs.length >= 4 && vs.length <= 8)
      body = tarpPitchGroup({ verts: vs, h: pitchH, color,
        family: vs.length === 4 ? "recta" : "hexa" });
  }
  if (p.shell3d === "landlock")
    body = landLockGroup(p.assembled_mm.w, p.assembled_mm.d, p.assembled_mm.h,
      { fabricTex: chairTex("canvas", CANVAS_TEX, 4, true), awning: n.config || "closed" });
  if (body) {
    if (pickable) body.group.traverse(o => {
      if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); }
    });
    g.add(body.group);
  }
}

/** The Connection Table (LV-381): a black heat-resistant stainless top on black X-frame folding
 *  legs. Reuses the bamboo-shelf builder in black (a top + X-legs + stretcher), at its top height
 *  -- so its surface lines up at the datum with any IGT extension hooked to its edges. */
function drawConnTable(g, n) {
  const f = footprint(n), tp = topOf(n);
  const built = bambooShelfGroup(f.w, f.d, tp, { frame: 0x2a2c30, wood: 0x1c1e22 });
  built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
  g.add(built.group);
}

function drawTable(g, n) {
  if (isJikaro(n)) return drawJikaro(g, n);
  if (isConnTable(n)) return drawConnTable(g, n);
  if (isSlide(n.sku ? PARTS[n.sku] : null)) return drawSlideExt(g, n);

  // Stainless Kitchen Table (LV-310): an open A-frame stand -- two hung stainless tops and a
  // hanger frame -- not the solid block the fall-through drew. The builder hangs everything
  // from the WORKTOP at y=0 (the manual mounts it at 830, the IGT 830-leg datum), so it is
  // lifted by LV310_TOP, NOT by its published 1100 -- the 1100 is the hanger bar, which the
  // builder itself puts at +(h - 830). Mostly air: the faint ghost box carries the pick.
  if (n.sku === "LV-310") {
    const f = footprint(n);
    const built = lv310Group(f.w, f.d, PARTS[n.sku].assembled_mm?.h ?? 1100, swatchOf(n.sku));
    built.group.position.y = LV310_TOP * MM;
    built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(built.group);
    return;
  }

  // The self-contained IGTs with their own fixed folding legs are built part by part
  // (parts3d.js). The builder draws the top at y=0 with the legs hanging below, so lift it to
  // the work-surface height; the node group g is already turned and placed.
  // Extension IGT: two bamboo tops that slide apart, exposing a central 2-unit bay.
  if (n.sku === "CK-090") {
    const f = footprint(n), tp = topOf(n);
    const c = expCfg(n);
    const built = extIgtGroup(f.w, f.d, tp, { bayW: c?.bay_w_mm || 0, bayD: c?.bay_d_mm || 360, tex: woodGrain("ext", 2, 2) });
    built.group.position.y = tp * MM;
    built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(built.group);
    if (bayUnits(n)) drawModules(g, n, tp);   // the opened centre bay hosts modules
    return;
  }

  // Entry / Slim IGT: a 3-unit frame in a fixed body. Build the frame + fixed legs, lay the
  // REMOVABLE wood top over the FREE half-units only, and let drawModules fill the occupied ones
  // -- so dropping a unit literally takes a top piece's place.
  const si = selfIgt(n.sku);
  if (si) {
    const f = footprint(n), tp = topOf(n);
    const built = n.sku === "CK-180"
      ? slimIgtGroup(f.w, f.d, tp, { tex: woodGrain("teak", 1, 2, TEAK_GRAIN) })   // the same grain instance its top wears
      : entryIgtGroup(f.w, f.d, tp);
    built.group.position.y = tp * MM;
    built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(built.group);

    const cells = occupancy(n), skip = [];
    for (let i = 0; i < cells.length; i++) if (cells[i]) skip.push(i);
    const teak = si.top === "teak";
    // Entry tops are a half / one-unit / half / one-unit from the left (CK-080R's plan shot);
    // the Slim's teak really is one panel per half-unit, so it takes no pieces split.
    const top = igtWoodTop({ units: si.units, color: teak ? 0xffffff : 0xd8bd86,
      pieces: teak ? null : [1, 2, 1, 2],
      skip, d: f.d, tex: teak ? woodGrain("teak", 1, 2, TEAK_GRAIN) : woodGrain("tile", 1, 2) });
    top.group.position.y = tp * MM;
    top.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(top.group);
    drawModules(g, n, tp);
    return;
  }

  const p = PARTS[n.sku];
  const f = footprint(n);
  const top = topOf(n);
  const isSel = state.sel === n.id;
  // The board's REAL thickness. A hook-on board was being drawn 30mm thick because that is
  // what the frame's rail is; the spec says 25mm, and the spec is right there.
  const thick = p.assembled_mm?.h ?? 25;

  // The shape comes from flatBoardGeo -- trace the corners and the notched bamboo, build the
  // rectangles (and punch their finger holes) from dimensions. A layout table that isn't a
  // board keeps the centred roundedBox.
  const ring = TEXTURES[p.sku]?.outline_mm;
  let geo, hangs = true;
  if (n.kind === "ext" || ring) geo = flatBoardGeo(p, f.w, f.d, thick);
  else { geo = roundedBox(f.w * MM, thick * MM, f.d * MM, 2.2 * MM); hangs = false; }

  // The plan view is the TOP. Snow Peak's own studio shot (JP a099) settles it: the two
  // bracket plates sit ON the bamboo, and the next board's wire hooks drop INTO them from
  // above -- which they could not do if the plates were underneath. The legs then screw
  // up into the same plate from below. So the ironmongery you see in the plan view is on
  // the work surface, because that is where it has to be.
  //
  // I had this backwards, moved the photo under the board, and invented a grain crop for
  // the top to cover for it. The photo goes back where it belongs.
  const grain = textureOf(p.sku, "grain");
  const m = new THREE.Mesh(geo, grain
    ? grainMaterial(p, COLORS, grain, f.w, f.d, isSel)
    : materialFor(p, COLORS, isSel));
  m.position.set(0, hangs ? top : top - thick / 2, 0).multiplyScalar(MM);
  m.userData.node = n; g.add(m); nodeMeshes.push(m);

  const tex = textureOf(p.sku);
  if (tex && (n.kind === "ext" || ring)) {
    const decal = new THREE.Mesh(
      flatBoardGeo(p, f.w, f.d, 0.4),
      boardMaterial(p, COLORS, tex, f.w * MM, f.d * MM, isSel),
    );
    decal.position.set(0, top + 0.5, 0).multiplyScalar(MM);
    g.add(decal);
  }

  if (n.kind === "ext") {
    const legH = top - thick;
    const legSku = n.leg;

    // Two wire hooks on the edge that meets the host: they hang over it and drop into the
    // bracket plates on the far side. That side needs no leg -- the host is holding it up.
    for (const [px, pz] of TEXTURES[p.sku]?.hooks_mm || []) {
      const pin = stock(new THREE.CylinderGeometry(4 * MM, 4 * MM, 26 * MM, 8), 0xc8ccd2, 0.9, 0.25);
      pin.position.set(px, top - thick - 11, pz).multiplyScalar(MM);
      g.add(pin);
    }

    // The legs go where the BRACKETS are, and the brackets were measured off the plan
    // view. Placing them at the corners because that is where legs usually go would be a
    // guess sitting right next to a measurement.
    //
    // The plate lies ON the board: the next board's hooks come down into it, and the leg
    // screws up into it from below.
    const seats = TEXTURES[p.sku]?.legs_mm || [];
    const spots = seats.length
      ? seats
      : [[-(f.w / 2 - 45), -f.d * 0.3], [-(f.w / 2 - 45), f.d * 0.3]];

    for (const [bx, bz] of spots) {
      const bracket = stock(roundedBox(58 * MM, 6 * MM, 44 * MM, 1 * MM), 0xc8ccd2, 0.9, 0.3);
      bracket.position.set(bx, top + 3, bz).multiplyScalar(MM);
      g.add(bracket);

      if (legSku && PARTS[legSku]?.height_mm) {
        const leg = stock(
          new THREE.CylinderGeometry(12.5 * MM, 10.5 * MM, legH * MM, 14),
          new THREE.Color(legColorOf(n)), 0.85, 0.32,
        );
        leg.position.set(bx, legH / 2, bz).multiplyScalar(MM);
        g.add(leg);
      }
    }
    return;
  }

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = stock(
      new THREE.CylinderGeometry(10 * MM, 8 * MM, (top - thick) * MM, 14),
      new THREE.Color(legColorOf(n)), 0.85, 0.32,
    );
    leg.position.set(sx * (f.w / 2 - 35), (top - thick) / 2, sz * (f.d / 2 - 35)).multiplyScalar(MM);
    g.add(leg);
  }
}

/** An invisible slab lying along each open edge. Hovering it is how you say "here".
 *
 *  It is deliberately the FULL length of the edge and nothing more: the handles are the
 *  planner's honest statement of where an extension may go, so they must appear exactly
 *  where the holes are and nowhere else. There is no handle down the long side of a frame,
 *  because there are no holes down the long side of a frame. */
// A finger is ~9mm of glass, and these volumes are sized in MODEL millimetres: at a phone's
// default framing the 46mm slab projects to a 15-20px strip -- a precision target at the one
// interaction the app exists for. On coarse pointers only the HIT volumes grow (and the tab a
// step, so the promise matches the target); the mouse geometry stays exact.
const COARSE = matchMedia("(pointer: coarse)").matches;

function drawEdgeHandles() {
  const s = sel();
  if (!s) return;                        // select-first: the add-handles belong to the selection
  const asm = new Set(assemblyOf(s));
  for (const n of state.nodes) {
    if (!asm.has(n)) continue;
    for (const e of openEdges(n)) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x3b82f6, transparent: true, opacity: 0, depthWrite: false,
        }),
      );
      m.scale.set((COARSE ? 110 : 72) * MM, (COARSE ? 100 : 46) * MM, e.len * MM);
      m.rotation.y = -angleOf(e.dir);      // local +x points out of the edge
      m.position.set(e.mid.x * MM, (e.mid.y - 12) * MM, e.mid.z * MM);
      m.renderOrder = 2;
      m.userData.edge = e;
      build.add(m);
      edgeMeshes.push(m);

      // A visible tab, so the add-points show the moment you select -- no hovering to discover
      // them. It carries the edge too, so clicking the tab opens the same menu as the slab.
      const tab = new THREE.Mesh(
        new THREE.SphereGeometry((COARSE ? 24 : 14) * MM, 18, 12),
        new THREE.MeshStandardMaterial({
          color: 0x6b9cf5, metalness: 0.1, roughness: 0.4, emissive: 0x1d3f8a, emissiveIntensity: 0.55,
        }),
      );
      tab.position.set(e.mid.x * MM, (e.mid.y + (COARSE ? 22 : 16)) * MM, e.mid.z * MM);
      tab.renderOrder = 3;
      tab.userData.edge = e;
      build.add(tab);
      edgeMeshes.push(tab);
    }
  }
}

/** An invisible pad over every FREE half-slot of every frame. Hovering it is how you say
 *  "put a module here". Like the edge handles, it appears only where a part can actually go
 *  -- an occupied cell has none -- so hovering the frame's interior offers exactly the unit
 *  accessories that the space left can still hold. */
function drawSlotHandles() {
  const s = sel();
  if (!s) return;                        // select-first: module slots show on the selected frame
  const asm = new Set(assemblyOf(s));
  for (const n of state.nodes) {
    if (!hasBay(n) || !asm.has(n)) continue;
    const cells = occupancy(n);
    const top = topOf(n);
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) continue;                       // taken -- no handle
      const xLocal = slotX(n, i) + HALF / 2;         // centre of the half-slot
      const w = rotv({ x: xLocal, z: 0 }, n.rot);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x5aa9ff, transparent: true, opacity: 0, depthWrite: false,
        }),
      );
      m.scale.set(HALF * 0.92 * MM, (COARSE ? 80 : 30) * MM, 300 * MM);
      m.rotation.y = -n.rot;
      m.position.set((n.x + w.x) * MM, (top - 6) * MM, (n.z + w.z) * MM);
      m.renderOrder = 2;
      m.userData.slot = { node: n, start: i, key: "slot" + i, isSlot: true,
        mid: { x: n.x + w.x, y: top, z: n.z + w.z } };
      build.add(m);
      slotHandleMeshes.push(m);
    }
  }
}

// The top of a selected object, in mm -- where its bounding box ends and the action toolbar floats.
function selTop(n) {
  if (n.kind === "prop" && PARTS[n.sku].role === "figure") return topOf(n);
  return n.kind === "prop" ? (PARTS[n.sku].assembled_mm?.h || 800)
    : n.kind === "footprint" ? 30
    : topOf(n) + 8;
}

// A clean CAD-style selection outline: a tight oriented box hugging the selected object. Added to
// the object's OWN group (already positioned + rotated), so it stays tight at any camera angle, and
// drawn depth-test-off so it reads as a selection highlight that's always visible.
const SEL_COLOR = 0x3b82f6;

// A ring where a dragged part will land: green on a free edge (hook on), cyan on an occupied one
// (insert between). Lives in `build`, so it's cleared every rebuild.
function addDropMarker(hint) {
  const y = topOf(hint.host) * MM;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(70 * MM, 9 * MM, 8, 28),
    new THREE.MeshBasicMaterial({ color: hint.occupied ? 0x3ec6f0 : 0x4fc98a, transparent: true, opacity: 0.9, depthTest: false }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(hint.wx * MM, y + 0.006, hint.wz * MM);
  ring.renderOrder = 10;
  build.add(ring);
}

function addSelBox(g, n) {
  const f = footprint(n), h = selTop(n), pad = 18;
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry((f.w + pad) * MM, (h + pad) * MM, (f.d + pad) * MM)),
    new THREE.LineBasicMaterial({ color: SEL_COLOR, transparent: true, opacity: 0.85, depthTest: false }),
  );
  box.position.y = h / 2 * MM;
  box.renderOrder = 9;
  g.add(box);
}

// ---- Viewport <-> outliner hover link ---------------------------------------------------------
// Hovering an object in EITHER place lights it up in the OTHER: a faint ghost box in the 3D view,
// a highlight on its tree row (scrolled into view). Selection is the firm correspondence (the orange
// box + the accent row); this is the soft, no-commitment one that lets you see which is which.
let hoverNodeId = null, hoverBox = null;
function showHoverBox(n) {
  invalidate();                           // the box comes and goes without a rebuild
  if (hoverBox) { scene.remove(hoverBox); hoverBox.geometry.dispose(); hoverBox.material.dispose(); hoverBox = null; }
  if (!n || n.id === state.sel) return;   // the selected object already wears its own box
  const f = footprint(n), h = selTop(n), pad = 14;
  hoverBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry((f.w + pad) * MM, (h + pad) * MM, (f.d + pad) * MM)),
    // The selection's own blue, fainter: hover is a lighter touch of the same idea, as in any design tool.
    new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4, depthTest: false }));
  hoverBox.position.set(n.x * MM, h / 2 * MM, n.z * MM);
  hoverBox.rotation.y = -n.rot;
  hoverBox.renderOrder = 8;
  scene.add(hoverBox);
}
function setHoverNode(id) {
  if (id === hoverNodeId) return;
  hoverNodeId = id;
  showHoverBox(id != null ? byId(id) : null);
  let matched = null;
  for (const row of document.querySelectorAll("#scene .tree-row")) {
    const on = row.dataset.node === String(id);
    row.classList.toggle("hover", on);
    if (on && !matched) matched = row;
  }
  matched?.scrollIntoView({ block: "nearest" });   // bring an off-screen row into view; a no-op if visible
}
function clearHoverNode() { setHoverNode(null); }

// ---- The floating (not-yet-placed) look --------------------------------------------------------
// A provisional part reads as provisional three ways at once, because one alone is missable at a bad
// camera angle: it hovers off the ground, it goes translucent, and it drops a dashed footprint ring
// where it would actually land. The ring is the honest part -- lifted and see-through say "not real
// yet", but only the ring on the ground answers "where does it go".
const GHOST_LIFT = 45;   // mm a floating part hovers above the ground
function ghostify(g, opacity = 0.42) {
  // Clone every material before fading it: the draw builders share and cache materials, and dimming a
  // shared one would ghost solid parts elsewhere in the scene. Picking is unaffected -- a raycast hits
  // the mesh whatever its opacity -- so a ghost stays selectable and draggable. A hover PREVIEW passes
  // a fainter value, so "what add would drop" reads distinct from "placed but not locked".
  g.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const fade = m => { m.transparent = true; m.opacity = Math.min(m.opacity ?? 1, opacity); m.depthWrite = false; };
    if (Array.isArray(o.material)) { o.material = o.material.map(m => m.clone()); o.material.forEach(fade); }
    else { o.material = o.material.clone(); fade(o.material); }
  });
}
function addGhostFootprint(n) {
  const f = footprint(n);
  const hw = f.w / 2 * MM, hd = f.d / 2 * MM;
  const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]].map(([x, z]) => new THREE.Vector3(x, 0.002, z));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: 0x3b82f6, dashSize: 0.035, gapSize: 0.02, transparent: true, opacity: 0.95 }),
  );
  line.computeLineDistances();                 // a dashed line draws nothing without this
  line.position.set(n.x * MM, 0, n.z * MM);
  line.rotation.y = -n.rot;
  build.add(line);
}

function rebuild() {
  invalidate();                   // a rebuilt scene is, by definition, one that needs drawing
  clearHoverNode();               // node positions may have moved; drop any stale hover highlight
  // Object3D.clear() detaches children and disposes NOTHING: every rebuild stranded a whole
  // scene's worth of GL buffers until the browser happened to GC the wrappers -- sawtooth
  // memory on a desktop, and on iOS Safari the classic road to a lost WebGL context and a
  // silently reloaded tab. Geometries and materials here are built fresh each rebuild, so
  // they are ours to free. The TEXTURES are not: they live in texCache/woodTexCache and are
  // shared across rebuilds -- material.dispose() leaves a material's maps alone, which is
  // exactly right.
  build.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      // One exception to "maps are shared, leave them": the shelter-footprint label sprite
      // draws a fresh CanvasTexture every rebuild (parts3d builds it inline, uncached), so
      // it is ours to free -- and at drag rate it was the one texture that still leaked.
      if (m.isSpriteMaterial && m.map) m.map.dispose();
      m.dispose();
    }
  });
  build.clear();
  nodeMeshes.length = 0;
  slotMeshes.length = 0;
  edgeMeshes.length = 0;
  slotHandleMeshes.length = 0;

  const selIds = new Set(selectedIds());
  for (const n of state.nodes) {
    const g = new THREE.Group();
    g.position.set(n.x * MM, n.floating ? GHOST_LIFT * MM : 0, n.z * MM);
    g.rotation.y = -n.rot;
    (n.kind === "frame" ? drawFrame : n.kind === "prop" ? drawProp : n.kind === "footprint" ? drawFootprint : drawTable)(g, n);
    // Provisional look, applied AFTER the build and BEFORE the selection outline, so the outline
    // stays crisp while the part itself fades.
    if (n.floating) { ghostify(g); addGhostFootprint(n); }
    if (selIds.has(n.id)) addSelBox(g, n);   // CAD-style outline around each selected object
    build.add(g);
  }

  // Hover preview: a fainter ghost of what the palette row under the pointer would ADD, at the exact
  // spot addNode would drop it. Built on the fly -- not in state, and trimmed back out of the pick
  // arrays so it is look-only: you can't select or drag a thing that isn't there yet.
  if (hoverPreview && PARTS[hoverPreview]) {
    const n = previewNode(hoverPreview);
    const g = new THREE.Group();
    g.position.set(n.x * MM, n.kind === "footprint" ? 0 : GHOST_LIFT * MM, n.z * MM);
    g.rotation.y = -n.rot;
    const keep = [nodeMeshes.length, slotMeshes.length, edgeMeshes.length, slotHandleMeshes.length];
    (n.kind === "frame" ? drawFrame : n.kind === "prop" ? drawProp : n.kind === "footprint" ? drawFootprint : drawTable)(g, n);
    nodeMeshes.length = keep[0]; slotMeshes.length = keep[1]; edgeMeshes.length = keep[2]; slotHandleMeshes.length = keep[3];
    ghostify(g, 0.26);
    if (n.kind !== "footprint") addGhostFootprint(n);
    build.add(g);
  }

  if (dropHint) addDropMarker(dropHint);     // where a dragged part will hook / insert on release

  // Shadow casting, decided by VISIBILITY: the invisible hit slabs (opacity 0) and the
  // fading ghosts must not print on the floor, and the shadow catcher must not re-catch
  // its own children. One pass here, so no builder has to remember it.
  build.traverse(o => {
    if (!o.isMesh || o.isSprite) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const solid = m && !(m.transparent && m.opacity < 0.55);
    o.castShadow = solid;
    o.receiveShadow = solid;
  });
  renderer.shadowMap.needsUpdate = true;

  // Step joints, where two touching tables stand at different heights. The CK-151 is a stainless
  // post of FIXED length (~320mm) that screws to the HIGHER table and hangs down; the lower
  // table's hook drops into whichever HOLE matches the step -- 830->660 = 170mm, 660->400 =
  // 260mm, 400->300 = 100mm below the top. It comes as a PAIR (本体×2), so draw two on the seam.
  const CK151_LEN = 320, CK151_HOLES = [100, 170, 260];   // hole depths from the top, mm
  const SILVER = new THREE.Color(0xb9bdc2);
  for (const [a, b] of steps()) {
    const loT = Math.min(topOf(a), topOf(b)), hiT = Math.max(topOf(a), topOf(b));
    const rise = Math.round(hiT - loT);
    if (rise < 5) continue;
    const c = contactEdge(a, b);
    const ctr = (c.lo + c.hi) / 2;
    const off = Math.min(144, Math.max(0, (c.hi - c.lo) / 2 - 30));   // end-hole half-spacing, clamped to the seam
    for (const s of [-1, 1]) {
      const t = ctr + s * off;
      const px = (c.axis === "z" ? c.fixed : t), pz = (c.axis === "z" ? t : c.fixed);
      const post = stock(
        new THREE.CylinderGeometry(9 * MM, 9 * MM, CK151_LEN * MM, 12), SILVER, 0.9, 0.28,
      );
      post.position.set(px * MM, (hiT - CK151_LEN / 2) * MM, pz * MM);   // hangs from the higher top
      build.add(post);
      // the three hole positions; the one that matches this step (== rise) is the join, drawn dark
      for (const hole of CK151_HOLES) {
        const used = Math.abs(hole - rise) < 8;
        const ring = stock(
          new THREE.CylinderGeometry(9.8 * MM, 9.8 * MM, 5 * MM, 12),
          new THREE.Color(used ? 0x2b2f35 : 0x8b9096), 0.4, 0.6,
        );
        ring.position.set(px * MM, (hiT - hole) * MM, pz * MM);
        build.add(ring);
      }
    }
  }

  drawEdgeHandles();
  drawSlotHandles();

  // Raycasting reads matrixWorld, and three only refreshes it inside render(). Every mesh
  // here is brand new, so until the next frame they all still sit at the origin and the
  // picker quietly misses all of them. Real pointer events arrive a frame later and never
  // see it; anything that rebuilds and then hit-tests in the same tick does. Costs nothing.
  build.updateMatrixWorld(true);

  // The meshes are new every rebuild, so the highlight has to be re-applied to them --
  // and an edge that has just been filled is no longer an edge.
  if (hover && !openEdges(hover.node).some(e => e.key === hover.key)) setHover(null);
  else paintHover();
}

// ---------------------------------------------------------------- edge hover -> menu

let hover = null;      // {node, local, dir, mid, len} -- the edge under the pointer

const btn = $("edgebtn");
const menu = $("edgemenu");
const selTools = $("seltools");
const replaceMenu = $("replacemenu");
const toolPop = $("toolpop");

/** Project a point in the layout onto the canvas, in CSS pixels. */
function toScreen(mm) {
  const v = new THREE.Vector3(mm.x * MM, mm.y * MM, mm.z * MM).project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, behind: v.z > 1 };
}

function paintHover() {
  for (const m of edgeMeshes)
    m.material.opacity = hover && !hover.isSlot && m.userData.edge.node.id === hover.node.id
      && m.userData.edge.key === hover.key ? 0.42 : 0;
  for (const m of slotHandleMeshes)
    m.material.opacity = hover?.isSlot && m.userData.slot.node.id === hover.node.id
      && m.userData.slot.start === hover.start ? 0.3 : 0;
  invalidate();   // opacities changed in place -- no rebuild saw it
}

/** Keep the button glued to its edge while the camera orbits. */
function followHover() {
  if (!hover) return;
  const s = toScreen(hover.mid);
  btn.hidden = s.behind;
  btn.style.left = `${s.x}px`;
  btn.style.top = `${s.y}px`;
  if (!menu.hidden) {
    menu.style.left = `${Math.min(s.x + 14, canvas.clientWidth - 250)}px`;
    menu.style.top = `${Math.min(s.y + 14, canvas.clientHeight - 230)}px`;
  }
}

function setHover(e) {
  const same = e && hover && e.node.id === hover.node.id && e.key === hover.key;
  if (same) return;
  hover = e;
  menu.hidden = true;
  hidePreview();
  btn.hidden = !e;
  if (e) {
    btn.title = e.isSlot ? "add a unit accessory to this slot"
      : `hook an extension onto the ${nameOf(PARTS[e.node.sku])}`;
    followHover();
  }
  paintHover();
}

function openMenu() {
  if (!hover) return;
  if (hover.isSlot) paintSlotMenu(); else paintMenu();
  menu.hidden = false;
  followHover();
}

btn.onclick = openMenu;

// ---- The selected object's floating action toolbar --------------------------------------------
// Delete / duplicate / replace / rotate, right at the object, so acting on a selection never means
// crossing the screen to a side panel. It tracks the object as the camera orbits (followSelTools).
function toolBtn(content, title, cls, onClick) {
  const b = document.createElement("button");
  b.innerHTML = content; b.title = title; if (cls) b.className = cls;
  b.onclick = ev => { ev.stopPropagation(); onClick(); };
  return b;
}

// An icon button's content: the icon, and its word in a .lbl span. The word is hidden on a mouse
// (the icon + its tooltip carry it) and SHOWN on touch, where no tooltip is ever seen -- the finding
// that once turned this toolbar into words was about bare Unicode glyphs, which meant nothing on their
// own. Real icons for the universal verbs, a word beside the ones that are not (class "keep").
const ib = (name, label) => `${icon(name)}<span class="lbl">${label}</span>`;

// ---- The selected object's OWN controls, in the viewport ----------------------------------------
// Leg height and part options used to sit in the left panel, which meant leaving the object to change
// it. They open from the object's own toolbar now; the panel keeps only the browsing lists.
const legAdjustable = n => !!n && (n.kind === "frame" || n.kind === "ext");
const hasActions = n => !!n && (isJikaro(n) || isExpandable(n)
  || (n.kind === "prop" && PARTS[n.sku].chair === "cushion")
  || PARTS[n.sku].prop === "takibi"          // the fire pit's bridge / surface / coal bed / base plate
  || PARTS[n.sku].prop === "gs1000"          // the stove's canister
  || PARTS[n.sku].shell3d === "landlock"     // the 跳ね上げ awnings, either end
  || PARTS[n.sku].shelter_type === "tarp"    // wing-pole length -- a tarp pitches on any of them
  || PARTS[n.sku].role === "figure"          // a figure's height and pose
  || (n.kind === "ext" && n.host && !isSlide(PARTS[n.sku]))
  || (n.kind === "frame" && n.host));

/** Leg-height options. A frame sets its own; a hooked board is flush with its host, so this sets the
 *  whole run's. Self-contained IGTs and the Jikaro have fixed legs -- they get no height button. */
function fillLegs(box, n) {
  for (const p of BY_ROLE.leg)
    box.append(chip(`${p.height_mm}mm`, n.leg === p.sku,
      n.kind === "ext" ? "an extension is flush with what it hooks to — it takes the same legs, so "
        + "this sets them for the whole run" : nameOf(p),
      () => setLeg(n, p.sku)));
  // Finish is independent of height: legs are silver by default, black is a variant some SKUs ship in.
  // A hooked run shares one finish, the same way it shares its height.
  const sep = document.createElement("span"); sep.className = "sep"; box.append(sep);
  const fin = n.legFinish || "silver";
  box.append(chip("silver", fin === "silver", "aluminium silver — the default finish", () => setLegFinish(n, "silver")));
  box.append(chip("black", fin === "black", "black-anodised — a variant finish (CK-109 / CK-112 ship this way)", () => setLegFinish(n, "black")));
}

/** Everything this particular part can be configured into. */
function fillActions(box, n) {
  if (isJikaro(n)) {
    // The Jikaro is four trapezoids, and which way round they go is the whole table:
    // 1120mm with a 600mm fire hole, or 885mm with a 365mm one. Not a finish option.
    for (const [key, c] of Object.entries(LAYOUT.tables[JIKARO].configs))
      box.append(chip(c.name, n.config === key,
        `${c.outer_mm}mm across, ${c.opening_mm}mm fire opening, four ${c.edge_mm}mm edges to hook to`,
        () => { n.config = key; pruneModules(n); render(); }));
    // The optional bridge across the fire opening -> an IGT bay. Units + SKU follow the assembly.
    const jc = jikaroCfg(n);
    box.append(chip(
      n.bridge ? `bridge ✓ ${jc.bridge_units}U · ${jc.bridge_sku}` : `+ bridge (${jc.bridge_units}U)`,
      !!n.bridge,
      n.bridge ? `${jc.bridge_units}-Unit bridge (${jc.bridge_sku}) across the ${jc.opening_mm}mm opening — click to remove`
               : `lay the optional ${jc.bridge_units}-Unit bridge (${jc.bridge_sku}) across the ${jc.opening_mm}mm opening to make an IGT bay`,
      () => { n.bridge = !n.bridge; pruneModules(n); render(); }));
  }
  // Expandable table (CK-090): slide the two tops together or apart. Open exposes the IGT bay.
  if (isExpandable(n)) {
    const e = expDef(n.sku), cur = n.config || e.default;
    for (const [key, c] of Object.entries(e.configs))
      box.append(chip(c.bay_units ? `${c.name} · ${c.bay_units}U bay` : c.name, cur === key,
        `${c.w_mm}×${c.d_mm}mm` + (c.bay_units ? ` — opens a ${c.bay_units}-Unit bay` : ` — closed, no bay`),
        () => { n.config = key; pruneModules(n); render(); }));
  }
  // A tarp's pitch height IS its pole: the Wing Pole retails in five lengths (280/240/210/
  // 170/140cm, 60+70cm sections), and the set's published height is just the pole it ships
  // with. Same interaction as a frame's legs -- pick the pole, the whole pitch follows.
  if (PARTS[n.sku].shelter_type === "tarp") {
    const pub = PARTS[n.sku].assembled_mm.h;
    box.append(chip(`set pole · ${pub}mm`, !n.config,
      "the height the set ships to — its own pole", () => { delete n.config; render(); }));
    for (const mm of [2800, 2400, 2100, 1700, 1400]) {
      if (Math.abs(mm - pub) < 60) continue;     // the set pole already covers this rung
      box.append(chip(`${mm / 10}cm`, n.config === mm,
        `pitched on ${mm / 10}cm Wing Poles`, () => { n.config = mm; render(); }));
    }
  }
  // Land Lock: the 跳ね上げ -- either end panel props open on two uprights as an awning.
  // One enum, four honest states of one shelter.
  if (PARTS[n.sku].shell3d === "landlock") {
    const cur = n.config || "closed";
    for (const [key, label, hint] of [
      ["closed", "▣ closed", "both end panels down — the closed shell"],
      ["front", "◨ front open", "the entrance panel propped as an awning on two uprights"],
      ["rear", "◧ rear open", "the inner-room end propped open — PDP_2's pitch"],
      ["both", "◫ both open", "a breezeway: both ends propped"]])
      box.append(chip(label, cur === key, hint, () => { n.config = key; render(); }));
  }
  // A scale figure: pose first, then height. The heights are honest rungs -- 5cm steps for the
  // adult, WHO growth-standard medians by age for the toddler -- and the default chip returns
  // to the record's median. The point of the popover is to set the REAL person's numbers.
  if (PARTS[n.sku].role === "figure") {
    const p = PARTS[n.sku];
    box.append(chip("standing", !n.pose, "on its feet", () => { delete n.pose; render(); }));
    box.append(chip("seated", n.pose === "sit",
      "sitting at camp-chair height (420mm). A toddler's feet dangle — that is the honest geometry.",
      () => { n.pose = "sit"; render(); }));
    box.append(chip("on the ground", n.pose === "ground",
      p.figure === "toddler" ? "sitting on the ground, legs out in front" : "sitting cross-legged on the ground",
      () => { n.pose = "ground"; render(); }));
    const sep = document.createElement("span"); sep.className = "sep"; box.append(sep);
    const pub = p.assembled_mm.h;
    box.append(chip(`${pub / 10}cm · median`, !n.config,
      p.figure === "toddler" ? "the WHO median for age two" : "a median adult — the default",
      () => { delete n.config; render(); }));
    const rungs = p.figure === "toddler"
      ? [["~1y", 750], ["~18m", 820], ["~3y", 960], ["~4y", 1030], ["~5y", 1100]]
      : [1500, 1550, 1600, 1650, 1750, 1800, 1850, 1900].map(mm => [`${mm / 10}cm`, mm]);
    for (const [label, mm] of rungs)
      box.append(chip(p.figure === "toddler" ? `${label} · ${mm / 10}cm` : label, n.config === mm,
        `${mm / 10}cm tall`, () => { n.config = mm; render(); }));
  }
  // Lounge cushion: round (open) or folded to a half-circle -- a form toggle like the Jikaro's.
  if (n.kind === "prop" && PARTS[n.sku].chair === "cushion") {
    const cur = n.config || "round";
    for (const [key, label, hint] of [
      ["round", "◯ round", "the open round pad"],
      ["folded", "◗ folded", "folded in half to a half-circle (doubled thickness) for seating"]])
      box.append(chip(label, cur === key, hint, () => { n.config = key; render(); }));
  }
  // The Takibi's options. NOT one enum: four independent decisions on one fire pit -- the bridge,
  // what's on it, the coal bed, the ground plate -- and a real setup mixes them. None of them is
  // ever a node: the bridge's own manual forbids standing it alone, the coal bed has no legs (it
  // wedges in the taper), and the base plate's position IS the Takibi's footprint.
  if (PARTS[n.sku].prop === "takibi") {
    box.append(chip(n.bridge ? "bridge ✓ ST-032GBR" : "+ grill bridge", !!n.bridge,
      "ST-032GBR hooks over the rim and carries the cooking surface. Its manual: only stable ON the "
      + "Takibi L — so it's a setting here, never its own thing on the ground.",
      () => { n.bridge = !n.bridge; if (!n.bridge) delete n.surface; render(); }));
    if (n.bridge) for (const [key, label, sku, hint] of [
      [null, "— bare", null, "the bridge with nothing on it"],
      ["net", "▦ grill net", "ST-032MAR", "焼アミ Pro.L — a 484×352 stainless net, the same net the CK-160 takes"],
      ["halves", "▤▤ two half nets", "S-029HA", "339×206 half nets ×2 — also cross-listed on the CK-160"],
      ["plate", "▬ griddle", "GR-006", "鉄板 — a 500×330 black-steel griddle; its 500 IS the CK-160's 500"]])
      box.append(chip(label, (n.surface || null) === key, sku ? `${sku} — ${hint}` : hint,
        () => { n.surface = key; render(); }));
    box.append(chip(n.coal ? "coal bed ✓ ST-032S" : "+ coal bed", !!n.coal,
      "炭床Pro.L — a 310×310 casting that wedges 64mm down the taper and raises the burn floor",
      () => { n.coal = !n.coal; render(); }));
    box.append(chip(n.base ? "base plate ✓ ST-032BP" : "+ base plate", !!n.base,
      "ベースプレートL — 450×450×9 of black steel on the ground, catching ash and keeping the heat off the grass",
      () => { n.base = !n.base; render(); }));
  }
  // The GS-1000's canister. drawProp has read `n.canister` since the stove landed and NOTHING ever
  // wrote it -- the option existed only from the console, which is the same as not existing.
  // It is a toggle for the same reason the Takibi's are: 専用容器 is bought separately (GP-250S /
  // GP-500S / GP-500BL) and is not in the stove's 1,800g. The stove is what you own; the can is what
  // you happened to bring. And "LI" is LIQUID INJECTION -- it hangs UPSIDE DOWN under the burner,
  // which is why the legs make a cage instead of a tripod.
  if (PARTS[n.sku].prop === "gs1000")
    box.append(chip(n.canister ? "canister ✓" : "+ canister", !!n.canister,
      "専用容器 (GP-250S / GP-500S / GP-500BL), mounted INVERTED under the burner — bought separately, "
      + "not part of the stove's 1,800g. Its size has no source in the catalog: it is proportioned "
      + "off the manual drawing, and it is the least trustworthy shape on this part.",
      () => { n.canister = !n.canister; render(); }));
  // Height adjuster: a hooked board sits flush with its host, or drops ONE rung of the ladder
  // (830->660->400->300) via a CK-151. One step per adjuster -- lower still means chaining.
  if (n.kind === "ext" && n.host && !isSlide(PARTS[n.sku])) {
    const hostLeg = hostLegOf(byId(n.host));
    const room = Math.min(1, stepRoom(hostLeg));
    for (let s = 0; s <= room; s++) {
      const leg = legAtStep(hostLeg, s);
      box.append(chip(s === 0 ? `⇥ ${legMm(hostLeg)}mm` : `↓ ${legMm(leg)}mm +adj`, (n.step || 0) === s,
        s === 0 ? "flush — the same height as what it hooks to"
                : `one step down (${legMm(hostLeg)}→${legMm(leg)}mm) with an IGT Height Adjuster (CK-151)`,
        () => setStep(n, s)));
    }
  }
  // A frame joined to another with a CK-175 can keep its own four legs (what the one connection
  // photo shows) OR share the joint and drop the pair at the joined end. The user chooses.
  if (n.kind === "frame" && n.host) {
    box.append(chip("4 legs", !n.sharedJoint,
      "keep its own four legs — both frames legged at the joint (the connection photo)",
      () => { n.sharedJoint = false; render(); }));
    box.append(chip("2 legs · shared joint", !!n.sharedJoint,
      "drop the two legs at the joined end and share the host's",
      () => { n.sharedJoint = true; render(); }));
  }
}

/** Open the object's leg-height or options popover, at its toolbar. */
function openToolPop(which, n) {
  toolPop.innerHTML = "";
  const head = document.createElement("div");
  head.className = "mhead";
  head.textContent = which === "legs" ? t("tool.height.tip")
                                      : `${nameOf(PARTS[n.sku])} — options`;
  toolPop.append(head);
  const box = document.createElement("div");
  box.className = "chips";
  (which === "legs" ? fillLegs : fillActions)(box, n);
  toolPop.append(box);
  toolPop.hidden = false;
  followSelTools();
}

/** The one placement-lifecycle button, whichever move fits where this part is now:
 *   floating (ghost)        -> "place"  : lock it down where it sits
 *   free, committed, open    -> "lock"   : fix it so a stray drag can't move it
 *   free, locked             -> "unlock" : float it again to move it
 *   hooked to an edge        -> "detach" : pull it off, floating, to move or re-hook
 *   on a rail                -> lock / unlock the slide position (never detaches -- delete to remove)
 *  Words, not an icon: a padlock glyph would be the one emoji in a toolbar of thin line symbols, and
 *  "detach" says a thing no padlock does. */
function placementBtn(n) {
  if (n.host != null && n.rail)
    return toolBtn(n.locked ? ib("unlock", t("tool.unlock")) : ib("lock", t("tool.lock")),
      n.locked ? t("tool.unlock.rail.tip") : t("tool.lock.rail.tip"), "ib",
      () => { n.locked = !n.locked; render(); });
  if (n.host != null)
    return toolBtn(ib("detach", t("tool.detach")), t("tool.detach.tip"), "ib",
      () => { detachNode(n); n.floating = true; n.locked = false; selectOnly(n.id); render();
              note("pulled off — drag it where you want, then lock it"); });
  const fixed = !!n.locked;
  return toolBtn(fixed ? ib("unlock", t("tool.unlock")) : (n.floating ? ib("anchor", t("tool.place")) : ib("lock", t("tool.lock"))),
    fixed ? t("tool.unlock.tip")
      : (n.floating ? t("tool.place.tip") : t("tool.lock.tip")),
    n.floating && !fixed ? "ib keep" : "ib",
    () => { if (fixed) { n.locked = false; n.floating = true; } else { n.locked = true; n.floating = false; } render(); });
}

function paintSelTools() {
  const n = sel();
  replaceMenu.hidden = true;   // any repaint (selection change, action) closes a stale popup
  toolPop.hidden = true;
  if (!n) { selTools.hidden = true; return; }
  selTools.innerHTML = "";
  // ICONS, with their words where they must speak: on touch every label shows; on a mouse the
  // universal verbs (rotate, copy, delete...) are icons with tooltips, and the decisions that are
  // not universal -- place, the leg height -- keep their word.
  // A multi-selection gets a compact toolbar: a count, duplicate-all (the free ones), delete-all.
  if (state.selSet.size > 1) {
    const count = document.createElement("span");
    count.className = "count"; count.textContent = t("sel.count", { n: state.selSet.size });
    selTools.append(count);
    selTools.append(toolBtn(ib("copy", t("tool.copy")), t("tool.dupall.tip"), "ib", () => duplicateSelected()));
    selTools.append(toolBtn(ib("block", t("tool.block")), t("tool.blockall.tip"), "ib",
      () => { const name = prompt(t("tool.blockname"), ""); if (name && name.trim()) saveBlock(name.trim()); }));
    const sep0 = document.createElement("span"); sep0.className = "sep"; selTools.append(sep0);
    selTools.append(toolBtn(ib("trash", t("tool.delete")), t("tool.delall.tip"), "ib danger", () => removeNode(n)));
  } else {
    // Placement first: is this thing floating, placed, locked, hooked? -- the leading decision.
    selTools.append(placementBtn(n));
    // This part's OWN controls, at the part: height, then whatever it can be configured into.
    if (legAdjustable(n) && PARTS[n.leg])
      selTools.append(toolBtn(`${icon("height")}<span class="num">${PARTS[n.leg].height_mm}</span>`, t("tool.height.tip"), "ib keep",
        () => openToolPop("legs", n)));
    if (hasActions(n)) selTools.append(toolBtn(ib("options", t("tool.options")), t("tool.options.tip", { name: nameOf(PARTS[n.sku]) }), "ib", () => openToolPop("actions", n)));
    if (!n.host) {
      selTools.append(toolBtn(ib("rotate", t("tool.rotate")), t("tool.rotate.tip"), "ib", () => rotateNode(n)));
      selTools.append(toolBtn(ib("copy", t("tool.copy")), t("tool.dup.tip"), "ib", () => duplicateNode(n)));
      // A block is a duplicate that outlives the session, so its button lives next to duplicate.
      selTools.append(toolBtn(ib("block", t("tool.block")), t("tool.block.tip"), "ib",
        () => { const name = prompt(t("tool.blockname"), ""); if (name && name.trim()) saveBlock(name.trim()); }));
    }
    if (replaceOptions(n).length > 1) selTools.append(toolBtn(ib("swap", t("tool.swap")), t("tool.swap.tip"), "ib", () => openReplaceMenu(n)));
    const sep = document.createElement("span"); sep.className = "sep"; selTools.append(sep);
    selTools.append(toolBtn(ib("trash", t("tool.delete")), t("tool.del.tip"), "ib danger", () => removeNode(n)));
  }
  selTools.hidden = false;
  followSelTools();
}

function followSelTools() {
  const n = sel();
  if (!n || selTools.hidden) return;
  const s = toScreen({ x: n.x, y: selTop(n), z: n.z });
  selTools.style.visibility = s.behind ? "hidden" : "visible";
  if (s.behind) { replaceMenu.hidden = true; toolPop.hidden = true; return; }
  // It hangs ABOVE its anchor (translate -100%), so its top edge must clear the undo/scene bar at the
  // view's top-left, and its sides must stay on the canvas -- on a phone it is nearly as wide as it.
  const vt = $("viewtop"), half = selTools.offsetWidth / 2;
  const minY = (vt ? vt.offsetTop + vt.offsetHeight : 0) + selTools.offsetHeight + 8;
  selTools.style.left = `${Math.max(half + 6, Math.min(canvas.clientWidth - half - 6, s.x))}px`;
  selTools.style.top = `${Math.max(minY, s.y - 14)}px`;
  for (const pop of [replaceMenu, toolPop]) {
    if (pop.hidden) continue;
    pop.style.left = `${Math.min(s.x + 12, canvas.clientWidth - 244)}px`;
    pop.style.top = `${Math.min(s.y + 8, canvas.clientHeight - 272)}px`;
  }
}

// What a node can be swapped for, keeping its place: same kind, same slot. A hooked board offers
// whatever else is legal on its host edge; a free node offers its role's family.
function replaceOptions(n) {
  if (n.kind === "frame") return BY_ROLE.frame;
  if (n.kind === "prop") return BY_ROLE[PARTS[n.sku].role] || BY_ROLE.seating;
  if (n.kind === "footprint") return BY_ROLE.shelter;
  if (n.kind === "ext") {
    const host = byId(n.host);
    if (!host) return [];
    return legalOn({ ...hostEdge(host, n.edge), node: host, key: n.edge });
  }
  return [...BY_ROLE.layout_table, ...BY_ROLE.standalone];
}

function openReplaceMenu(n) {
  replaceMenu.innerHTML = "";
  const head = document.createElement("div");
  head.className = "mhead";
  head.textContent = `replace ${nameOf(PARTS[n.sku])} with:`;
  replaceMenu.append(head);
  for (const p of replaceOptions(n)) {
    if (p.sku === n.sku) continue;
    const row = document.createElement("div");
    row.className = "part";
    row.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span><span class="nm">${nameOf(p)}</span>`;
    row.onclick = () => { replaceMenu.hidden = true; replaceNode(n, p.sku); };
    wirePreview(row, p);
    replaceMenu.append(row);
  }
  replaceMenu.hidden = false;
  followSelTools();
}

// Swap the part in place -- keep position / host / edge / rotation / leg, re-seed the config the new
// part needs, and drop any placed module that no longer fits.
function replaceNode(n, sku) {
  n.sku = sku;
  if (sku === JIKARO) { n.config = "long_in"; n.bridge = n.bridge || false; }
  else if (expDef(sku)) n.config = expDef(sku).default;
  else if (PARTS[sku].chair === "cushion") n.config = "round";
  else if (PARTS[sku].shell3d === "landlock") n.config = "closed";
  else { delete n.config; delete n.bridge; }
  if (n.kind === "frame" && !n.leg) n.leg = "CK-114";
  if (n.placements?.length) pruneModules(n);
  render();
}

addEventListener("keydown", e => {
  if (e.key === "Escape") { setHover(null); hideModMenu(); replaceMenu.hidden = true; toolPop.hidden = true; }
});

// The action menu for a placed module -- reached by right-click or a left long-press, so a
// removal is a considered second click, not a twitchy one. Positioned at the pointer.
const modmenu = $("modmenu");
// A few modules can be configured in place -- the BBQ's two halves are each a grill net or a
// griddle plate (it ships with two nets; the plate is a separate buy, and is size-shared with the
// Takibi Fire & Grill L). The choice rides on the PLACEMENT, not the part: two BBQs in a layout can
// be set up differently.
const MODULE_CONFIGS = {
  // GS-230's cover is its windscreen: clamped down it's a lid lying flat (~15mm proud of the frame,
  // owner), stood up it's the screen behind the burners. One or the other, never both.
  "GS-230": {
    default: "cooking",
    options: {
      cooking: ["◳ windscreen up", "the cover stood up behind the burners, wings swung forward — cooking"],
      closed:  ["▬ cover on", "the cover clamped flat over the stove — sits ~15mm proud; off, it's flush"],
    },
  },
  // Every option is a real SKU, and Snow Peak cross-lists both of the bought ones on this box's own
  // page. No net+plate mix: the only half-size plate (S-029HD) is 20mm too deep for the 360 and
  // isn't on its 関連アイテム list -- that combination would be a shape with no part behind it.
  "CK-160": {
    default: "nets",
    options: {
      nets:   ["◫◫ two nets", "焼き網 ×2 — what it ships with"],
      halves: ["▤▤ two half nets", "S-029HA 焼アミハーフ Pro. ×2, 339×206 each — cross-listed on this box"],
      plate:  ["▬ griddle plate", "GR-006 グリルプレート黒皮鉄板, 500×330 — FULL size, it replaces both nets. Its 500 IS this box's 500"],
    },
  },
};
const moduleCfgOf = sku => MODULE_CONFIGS[sku.replace(/-(US|INT|EC|R)$/i, "")];

function showModMenu(node, pl, clientX, clientY) {
  const p = PARTS[pl.sku];
  modmenu.innerHTML = `<div class="mhead">${nameOf(p)}</div>`;
  // Its own options first -- you right-clicked the thing, so act on the thing.
  const cfg = moduleCfgOf(pl.sku);
  if (cfg) {
    const cur = pl.config || cfg.default;
    for (const [key, [label, hint]] of Object.entries(cfg.options)) {
      const row = document.createElement("div");
      row.className = "act" + (cur === key ? " on" : "");
      row.textContent = label; row.title = hint;
      row.onclick = () => { pl.config = key; hideModMenu(); render(); };
      modmenu.append(row);
    }
  }
  const del = document.createElement("div");
  del.className = "act del"; del.innerHTML = `${icon("trash", 14)} remove from frame`;
  del.onclick = () => { removePlacement(node, pl); hideModMenu(); };
  modmenu.append(del);
  const sr = $("stage").getBoundingClientRect();
  modmenu.style.left = Math.max(4, Math.min(clientX - sr.left, sr.width - 172)) + "px";
  modmenu.style.top = Math.max(4, Math.min(clientY - sr.top, sr.height - 72)) + "px";
  modmenu.hidden = false;
}
const hideModMenu = () => { modmenu.hidden = true; };

// A menu row is a swatch, a name and a span — no room for the picture or the numbers.
// Passing over one opens a card beside the menu with the thumbnail (web/img/SKU.jpg) and
// the details: full name, sku, assembled size, weight. No price -- owner: "都不必有了". Choosing
// between two parts is a question of size, span and what it weighs; the money question, if it comes,
// belongs on the part bench, which prices a part in every region.
const preview = $("preview");
function showPreview(p, rowEl, why = "") {
  const a = p.assembled_mm;
  const span = spanOf(p) ? `${spanOf(p) / 2}u` : "";
  preview.innerHTML =
    (PUBLIC ? "" : `<img src="img/${p.sku}.jpg" alt="">`)   // product photos stay off the public build
    + `<div class="pv-name">${nameOf(p)}</div>`
    + ((getLang() === "ja" ? p.title_en : p.title_jp) ? `<div class="pv-jp">${getLang() === "ja" ? p.title_en : p.title_jp}</div>` : "")
    + `<div class="pv-row"><span class="pv-sku">${p.sku}</span></div>`
    + (a ? `<div class="pv-row"><span>size</span><b>${a.w}×${a.d}×${a.h}mm</b></div>` : "")
    + (span ? `<div class="pv-row"><span>span</span><b>${span}</b></div>` : "")
    + (p.weight_g ? `<div class="pv-row"><span>weight</span><b>${(p.weight_g / 1000).toFixed(2)}kg</b></div>` : "")
    + (why ? `<div class="pv-why">${why}</div>` : "");
  const img = preview.querySelector("img");
  if (img) img.onerror = () => { img.style.visibility = "hidden"; };
  // Beside the hovered ROW (always visible), to its LEFT; flip right if there is no room,
  // and clamp inside the stage so it never escapes over the panels.
  const sr = $("stage").getBoundingClientRect();
  const rr = rowEl.getBoundingClientRect();
  const W = 202;
  let left = rr.left - sr.left - W - 6;
  if (left < 4) left = rr.right - sr.left + 8;
  left = Math.max(4, Math.min(left, sr.width - W));
  const top = Math.max(4, Math.min(rr.top - sr.top - 4, sr.height - 210));
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
  preview.hidden = false;
}
const hidePreview = () => { preview.hidden = true; };
function wirePreview(row, p, why = "") {
  row.addEventListener("mouseenter", () => showPreview(p, row, why));
  row.addEventListener("mouseleave", hidePreview);
}

/** What may legally hook onto this edge.
 *
 *  Every part whose attachment the COPY says is hook_on, and nothing else. CK-218/219,
 *  the angle extensions, are not on this list: Snow Peak's copy never says how they
 *  attach and their plan views show no hooks, so the planner does not know which edge
 *  they hang from. Offering them anyway would mean guessing an orientation, and a guess
 *  sitting next to twelve measurements is worse than an absence. */
/** What may legally go on this edge.
 *
 *  A frame's END takes a board (its wire hooks drop into the holes) OR another FRAME (via
 *  CK-175, which turns the neighbouring end into a hook). A frame's RAIL takes boards only:
 *  the rail joint gives a wire hook something to hang from, and a frame does not have wire
 *  hooks -- it has an end piece. A board's BRACKET edge takes boards.
 *
 *  Could a frame hook onto a board's brackets? CK-175 does give it a hook, and the brackets
 *  do receive hooks. But nothing says so, and a frame hanging off a bamboo board held up by
 *  that board's two legs is not a thing I am going to invent. Not offered. */
// What can attach to an edge is now INFERRED from layout.connections, not hard-coded: a guest joins
// a host PORT when their interface matches (and scale fits -- a table-scale guest needs a
// table-scale port), OR an ADAPTER bridges the port's interface to the guest's. So "a frame joins a
// Jikaro" (both table-scale ET ports) and "an extension board joins a frame's rail" (side_rail -> ET
// via the rail joint XCK-128, which also -> hanging) both fall out of the data. See layout.connections.
function paintMenu() {
  menu.innerHTML = "";
  const head = document.createElement("div");
  head.className = "mhead";
  head.textContent = hover.at === "opening"
    ? `into the ring — the ${Math.round(hover.opening)}mm opening the fire ring is built around. `
      + `The pit stands on the GROUND on its own feet; the ring only surrounds it — and moves it.`
    : hover.rail
    ? "onto the LONG rail — a board hooks on (via a rail joint), a sliding extension grips it and tiles"
    : hover.node.kind === "frame"
      ? "the frame's end: a board hooks into the holes, or another frame joins with a CK-175"
      : isJikaro(hover.node)
        ? `one of the fire ring's four outer edges (${Math.round(hover.len)}mm) — at the `
          + `400mm datum, so it takes low legs`
        : isConnTable(hover.node)
          ? "the Connection Table's edge — an IGT extension hooks on here (two hole pitches, for tables and accessories)"
          : "this board's far edge — the next extension hooks into its brackets and carries the run on, "
            + "at the same height on its own legs";
  menu.append(head);

  // The host for a manual whitelist is the ROOT frame -- a corner's manual lists the frames
  // it goes on, whether it hooks the frame directly or another extension that is on one.
  const rootSku = rootOf(hover.node).sku;

  for (const p of legalOn(hover)) {
    const c = compat(p.sku, rootSku);
    if (c.level === "blocked") continue;   // the manual forbids it; do not even offer it

    const row = document.createElement("div");
    row.className = "part" + (c.level === "unlisted" ? " caution" : "");
    // The trailing badge is the COMPAT flag only now -- a "?" when the manual doesn't list this
    // pairing -- never a price. It was carrying both, and the price was the half that didn't belong.
    row.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
      + `<span class="nm">${nameOf(p)}</span>`
      + (c.level === "unlisted" ? `<span class="sp caution">?</span>` : "");
    const f = footprintOf(p.sku, kindOf(p));
    row.title = c.level === "unlisted"
      ? `${p.sku} — ${c.why}`
      : `${p.sku} — ${Math.round(f.w)}×${Math.round(f.d)}mm`
        + (kindOf(p) === "frame" ? " — joins end to end (+ CK-175)" : "");
    row.onclick = () => { attach(p.sku, hover.node, hover.key); setHover(null); };
    wirePreview(row, p);
    menu.append(row);
  }
}

/** The menu for a free slot inside a frame: the unit accessories that fit the space left
 *  HERE. "Here" is the whole contiguous free run the slot sits in, measured BOTH ways -- so
 *  the half-slot beside an occupied one still offers a full unit if the run continues past it.
 *  A part needs `span` <= that run; anything wider is left out. */
function paintSlotMenu() {
  menu.innerHTML = "";
  const n = hover.node, start = hover.start;
  const free = freeBlock(n, start)?.len ?? 0;
  const head = document.createElement("div");
  head.className = "mhead";
  head.textContent = `${free / 2}u free here — a unit accessory that fits`;
  menu.append(head);

  const list = guestsFor(SLOT_IFACES);   // slot modules + hanging racks, from connections.guests
  let offered = 0;
  for (const p of list) {
    if (spanOf(p) > free) continue;                                      // wider than the run
    if (isHangRack(p) && !hostsHanging(n)) continue;                     // a rack needs rails to hook over
    if (isHangRack(p) && hasHangRack(n)) continue;                        // one rack per host
    const c = compat(p.sku, n.sku);
    if (c.level === "blocked") continue;

    const row = document.createElement("div");
    row.className = "part" + (c.level === "unlisted" ? " caution" : "");
    // The trailing badge is the COMPAT flag only now -- a "?" when the manual doesn't list this
    // pairing -- never a price. It was carrying both, and the price was the half that didn't belong.
    row.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
      + `<span class="nm">${nameOf(p)}</span>`
      + (c.level === "unlisted" ? `<span class="sp caution">?</span>` : "");
    row.title = c.level === "unlisted" ? `${p.sku} — ${c.why}` : `${p.sku} — ${spanOf(p) / 2}u`;
    row.onclick = () => { placeModuleAt(p.sku, n, start); setHover(null); };
    wirePreview(row, p);
    menu.append(row);
    offered++;
  }
  if (!offered) {
    const none = document.createElement("div");
    none.className = "mhead";
    none.textContent = "nothing in the catalog fits the space left here.";
    menu.append(none);
  }
}

// ---------------------------------------------------------------- interaction

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let dragNode = null, dragMod = null, dragSlide = null, longPress = null, dragHooked = false;
let bandTool = false;     // the rubber-band TOOL: off by default, because empty ground is the camera's
let rulerTool = false;    // the measure TOOL: click two ground points to lay a dimension between them
let rulerDraft = null;    // {x, z} of the first point placed, waiting for the second
let rulerHover = null;    // {x, z} the pointer is over while drafting -- draws the live preview line
let hoverPreview = null;  // sku of the palette part the pointer is over -- a ghost of what "add" would drop
let emptyPress = null;   // where a press on nothing landed -- a click deselects, a drag is the camera
let dragGroup = null;    // [{node, ox, oz}] when a whole multi-selection is being moved together
let marquee = null;      // {x0, y0} while a rubber-band select is being dragged on empty ground
const dragOff = new THREE.Vector3();

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
  // THE CAMERA OWNS EVERY BUTTON BUT THE PRIMARY ONE -- and it owns that one too while Alt is held.
  // There was no guard here at all, and pointerdown fires for middle and right exactly the same, so
  // one `controls.enabled = false` further down took orbit, pan AND dolly with it. On a touch screen
  // it took the second finger as well. Every button was dead but the scroll wheel, which is the one
  // input that never goes through this handler.
  // Leave the event completely alone: OrbitControls has its own listener on this canvas and reads
  // the raw event. Returning is enough; touching `controls` is what broke it.
  if (e.button !== 0 || e.altKey) return;
  // A SECOND finger is a pinch, not a second interaction. Every extra touch arrives here as
  // another pointerdown with button 0, and it used to re-enter the whole handler -- re-aiming
  // the one shared drag state at whatever it landed on, so a pinch centred on the table
  // (which is where everyone pinches) yanked furniture between two fingertips. The drag is
  // abandoned where it stands and the gesture is PARKED until the fingers lift: controls stay
  // off, because OrbitControls never saw finger 2 (its own pointerdown ran while disabled) --
  // re-enabling it mid-gesture feeds two alternating fingertips into one stale one-finger
  // rotation, and the camera whips. Pinches that start on empty ground never disabled it, so
  // they zoom as they always did; the primary pointerup gives the camera back here.
  if (!e.isPrimary) {
    clearTimeout(longPress);
    const wasDragging = dragNode || dragMod || dragSlide || dragGroup;
    dragNode = dragMod = dragSlide = dragGroup = null;
    dragHooked = false;
    dropHint = null;
    emptyPress = null;                 // a gesture that grew a second finger is not a click on nothing
    if (wasDragging) { render(); commitHistory(); }   // a detached part stays put, on the record
    return;
  }
  hideModMenu();                      // any press elsewhere dismisses the module menu
  toPtr(e);
  ray.setFromCamera(ptr, camera);

  // The measure tool is MODAL: while it is on, the left button lays measurement points and does
  // nothing else -- not select, not drag, not orbit (syncLeft already took the button off the
  // camera). A point drops on the ground under the cursor even when that is over a table, so you
  // can measure between the far corners of a layout, not just across open floor.
  if (rulerTool) { placeRulerPoint(); return; }

  // Anything on the long rail -- a sliding extension OR a hook-on board -- is GRABBED to drag it
  // ALONG the rail. It sits on the rail, so the rail's own "add here" edge handle would otherwise
  // swallow the click; the board is the closer hit, so prefer it.
  const edge = ray.intersectObjects(edgeMeshes, false)[0];
  const slideHit = ray.intersectObjects(nodeMeshes, false)
    .find(h => { const nn = h.object.userData.node; return nn?.host && nn?.rail; });
  if (slideHit && (!edge || slideHit.distance <= edge.distance + 1)) {
    const sn = slideHit.object.userData.node;
    // A LOCKED slide is fixed in place -- that is what "lock the slide position" means. Select it
    // (so its toolbar, and the unlock button, are right there) but do not start a drag.
    if (sn.locked) { selectOnly(sn.id); render(); return; }
    dragSlide = sn;
    selectOnly(dragSlide.id);
    controls.enabled = false;
    render();
    return;
  }

  // An edge handle is not a thing you drag; it is a thing you press. Pressing it opens the
  // menu straight away -- the button is the affordance, not a toll gate.
  //
  // Orbit is already off here (hovering the edge turned it off), and it has to be off
  // BEFORE the press, not during it: OrbitControls has its own pointerdown listener on
  // this same canvas and it runs first, so returning early from this handler does not
  // stop it. It spent one debugging round quietly rotating the camera out from under the
  // very edge I was trying to click.
  if (edge) {
    setHover(edge.object.userData.edge);
    openMenu();
    return;
  }
  // A free slot inside a frame: press it to add a module that fits the space there.
  const slot = ray.intersectObjects(slotHandleMeshes, false)[0];
  if (slot) {
    setHover(slot.object.userData.slot);
    openMenu();
    return;
  }
  menu.hidden = true;

  const mod = ray.intersectObjects(slotMeshes, false)[0];
  if (mod) {
    const pl = mod.object.userData.placement, node = mod.object.userData.node;
    dragMod = { pl, node, downX: e.clientX, downY: e.clientY, moved: false };
    selectOnly(node.id);
    controls.enabled = false;
    // Hold still (a long press) and the action menu opens instead of a drag. Moving past a
    // few pixels first (see pointermove) cancels it -- then it is a drag, as before.
    longPress = setTimeout(() => {
      if (dragMod && !dragMod.moved) { showModMenu(node, pl, dragMod.downX, dragMod.downY); dragMod = null; }
    }, 450);
    paint();
    return;
  }

  const nd = ray.intersectObjects(nodeMeshes, false)[0];
  // PRESSED EMPTY GROUND -- the one decision the whole scheme hangs off.
  //
  // Pointing at nothing MOVES THE CAMERA. That is not a preference: it is the only binding a phone
  // can honour, because one finger is all there is, and a model you cannot turn is not a 3D view.
  // The rubber band was sitting on this gesture and had quietly eaten orbit on every device.
  //
  // So the band is a TOOL now -- an explicit mode off the viewport bar, which is the one mechanism
  // that works the same with a mouse and with a thumb.
  if (!nd) {
    const r = canvas.getBoundingClientRect();
    if (bandTool) {
      // No `controls.enabled` here on purpose: with the tool on, the LEFT button is already not the
      // camera's (syncLeft), so there is nothing to switch off and nothing to race.
      marquee = { x0: e.clientX - r.left, y0: e.clientY - r.top, add: e.shiftKey || e.ctrlKey || e.metaKey };
      return;
    }
    // Otherwise the drag belongs to OrbitControls. Only remember WHERE the press landed: if the
    // pointer barely travels it was a CLICK on nothing, which still deselects. Don't touch
    // `controls` -- that is exactly the mistake this comment exists because of.
    emptyPress = { x: e.clientX - r.left, y: e.clientY - r.top };
    return;
  }
  const n = nd.object.userData.node;
  // Shift / Ctrl / Cmd toggles this object in the multi-selection (and never starts a drag).
  if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleInSel(n.id); render(); return; }
  // Pressing something ALREADY in a multi-selection keeps the selection and moves the whole set --
  // PowerPoint's rule, and the one you expect. Pressing anything else resets to just that object.
  const inMulti = state.selSet.size > 1 && state.selSet.has(n.id);
  if (!inMulti) selectOnly(n.id);
  // A LOCKED node is fixed: select it (its toolbar carries the unlock button) but do not drag it.
  // The whole point of the lock is that a stray press cannot nudge a part you have committed.
  if (n.locked && !inMulti) { controls.enabled = false; render(); return; }
  // Any node can be dragged -- a FREE one moves, a hooked one DETACHES on the first move and floats
  // free until dropped onto a legal edge again. (Rail-hosted nodes are caught above and slide along
  // their rail instead of detaching.)
  dragNode = n;
  dragHooked = !inMulti && n.host != null;   // a group drag never detaches -- it's a move, not a re-hook
  const at = hitPlane(0);
  if (at) {
    dragOff.set(n.x - at.x / MM, 0, n.z - at.z / MM);
    // Everything FREE in the selection travels along, each keeping its own offset from the pointer.
    // Hooked nodes are left out on purpose: they're resolved from their host's edge, so they follow
    // it for free -- and if their host isn't coming, they can't come either.
    dragGroup = inMulti
      ? selectedIds().map(byId).filter(m => m && m.host == null)
          .map(m => ({ node: m, ox: m.x - at.x / MM, oz: m.z - at.z / MM }))
      : null;
  }
  controls.enabled = false;
  // A sliding extension (also a hosted node) is handled up top -- it is grabbed before the
  // edge check so its rail handle cannot swallow the grab.
  render();
});

canvas.addEventListener("pointermove", e => {
  if (!e.isPrimary) return;           // finger 1 owns the interaction; see pointerdown
  // Sweeping a rubber band -- just draw it; nothing is selected until you let go.
  if (marquee) {
    const r = canvas.getBoundingClientRect();
    marquee.x1 = e.clientX - r.left; marquee.y1 = e.clientY - r.top;
    const box = $("marquee");
    box.style.left = `${Math.min(marquee.x0, marquee.x1)}px`;
    box.style.top = `${Math.min(marquee.y0, marquee.y1)}px`;
    box.style.width = `${Math.abs(marquee.x1 - marquee.x0)}px`;
    box.style.height = `${Math.abs(marquee.y1 - marquee.y0)}px`;
    box.hidden = false;
    return;
  }
  toPtr(e);
  ray.setFromCamera(ptr, camera);

  // Drafting a measurement: track the ground point under the cursor so followRulers can draw the
  // live preview line. No render() -- the overlay redraws itself every frame in the loop.
  if (rulerTool && rulerDraft) { const at = hitPlane(0); if (at) { rulerHover = groundSnap(at); invalidate(); } return; }

  if (!dragNode && !dragMod && !dragSlide) {
    const hit = ray.intersectObjects(edgeMeshes, false)[0];
    if (hit) {
      // Take the canvas off orbit while the pointer is on an edge: this patch of screen
      // belongs to the handle now, and a stray drag here should not spin the camera.
      controls.enabled = false;
      setHover(hit.object.userData.edge);
      return;
    }
    // A free slot inside a frame gets the same treatment: hovering it offers a module.
    const hitS = ray.intersectObjects(slotHandleMeshes, false)[0];
    if (hitS) {
      controls.enabled = false;
      setHover(hitS.object.userData.slot);
      return;
    }
    controls.enabled = true;

    // Let go of the edge by MOVING AWAY from the button, not by missing the handle.
    // Deciding on the raycast alone made the button vanish the moment the pointer left a
    // 46mm-thick slab -- including on its way to press the button, which is a cruel joke
    // to play on a hover affordance. Distance is what the hand is actually doing.
    if (hover && menu.hidden) {
      const r = canvas.getBoundingClientRect();
      const s = toScreen(hover.mid);
      if (Math.hypot(e.clientX - r.left - s.x, e.clientY - r.top - s.y) > 72) setHover(null);
    }
    // Link the viewport to the outliner: hovering an object (when no edge/slot handle owns the
    // pointer) lights it up and highlights its tree row. An edge hover keeps priority.
    if (!hover) {
      const nd = ray.intersectObjects(nodeMeshes, false)[0];
      setHoverNode(nd ? nd.object.userData.node.id : null);
      canvas.style.cursor = nd ? "pointer" : "";
    }
    return;
  }

  if (dragMod) {
    const { pl, node } = dragMod;
    // Past a few pixels this is a drag, not a long press: cancel the pending menu.
    if (!dragMod.moved && Math.hypot(e.clientX - dragMod.downX, e.clientY - dragMod.downY) > 5) {
      dragMod.moved = true;
      clearTimeout(longPress);
    }
    const at = hitPlane(topOf(node));
    if (!at) return;
    // Undo the node's own rotation to get a position along its rail.
    const r = -node.rot;
    const lx = (at.x / MM - node.x) * Math.cos(r) - (at.z / MM - node.z) * Math.sin(r);
    const start = Math.round((lx + runOf(node) / 2 - (pl.span * HALF) / 2) / HALF);
    if (start !== pl.start && canPlaceAt(node, start, pl.span, pl)) {
      pl.start = start;
      rebuild(); paintSlots(); paintDimHud();     // the full paint() waits for pointerup, like any drag
    }
    return;
  }

  if (dragSlide) {
    const n = dragSlide, host = byId(n.host), e2 = hostEdge(host, n.edge);
    const at = hitPlane(topOf(host));
    if (at && e2) {
      const d = rotv(e2.normal, host.rot);           // rail's outward normal, in the world
      const along = { x: d.z, z: -d.x };             // the rail's own axis
      const raw = (at.x / MM - host.x) * along.x + (at.z / MM - host.z) * along.z;
      const { lo, hi } = slideBounds(n, host);       // stop AT a neighbour, not through it
      n.slide = Math.max(lo, Math.min(hi, raw));
      renderDragging();
    }
    return;
  }

  const at = hitPlane(0);
  if (!at) return;
  // A whole multi-selection moves as one: every free member keeps its own offset from the pointer, so
  // their spacing is preserved. No detach, no edge snapping -- this is a MOVE of an arrangement you
  // already made, not an attempt to re-hook one part of it.
  if (dragGroup) {
    let moved = false;
    for (const m of dragGroup) {
      const gx = Math.round((at.x / MM + m.ox) / SNAP) * SNAP;
      const gz = Math.round((at.z / MM + m.oz) / SNAP) * SNAP;
      if (gx !== m.node.x || gz !== m.node.z) { m.node.x = gx; m.node.z = gz; moved = true; }
    }
    if (moved) renderDragging();                  // still inside the same snap cells -> nothing changed
    return;
  }
  const nx = Math.round((at.x / MM + dragOff.x) / SNAP) * SNAP;
  const nz = Math.round((at.z / MM + dragOff.z) / SNAP) * SNAP;
  // Inside the same 25mm snap cell as last frame: the scene it would draw is the scene on
  // screen. The dragMod branch has always had this guard; these branches rebuilt everything.
  if (nx === dragNode.x && nz === dragNode.z) return;
  // First real move of a hooked node cuts it loose -- from here on it's a free-floating part.
  if (dragHooked && (Math.abs(nx - dragNode.x) > 2 || Math.abs(nz - dragNode.z) > 2)) {
    detachNode(dragNode);
    dragHooked = false;
  }
  dragNode.x = nx;
  dragNode.z = nz;
  if (dragNode.host == null) {                    // a free/detached node can re-hook onto a legal edge
    dropHint = findDropTarget(dragNode);
    if (!dropHint) snapToNeighbours(dragNode);    // no edge nearby -> fall back to table-edge snapping
  }
  renderDragging();
});

addEventListener("pointerup", e => {
  if (!e.isPrimary) return;           // a lifted second finger ends nothing; see pointerdown
  clearTimeout(longPress);
  // A press that landed on NOTHING. Barely moved -> it was a click, and a click on nothing
  // deselects. Travelled -> that was the camera orbiting, and orbiting must not also wipe the
  // selection out from under you.
  if (emptyPress) {
    const r = canvas.getBoundingClientRect();
    const d = Math.hypot((e.clientX - r.left) - emptyPress.x, (e.clientY - r.top) - emptyPress.y);
    emptyPress = null;
    if (d <= 6 && (state.sel != null || state.selSet.size)) { selectOnly(null); render(); }
    return;
  }
  // A rubber band closes here. Swept more than a few pixels -> take everything whose object sits
  // inside it; barely moved -> it was a click on empty ground, which means deselect.
  if (marquee) {
    const swept = marquee.x1 != null
      && Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) > 6;
    if (swept) {
      const lo = { x: Math.min(marquee.x0, marquee.x1), y: Math.min(marquee.y0, marquee.y1) };
      const hi = { x: Math.max(marquee.x0, marquee.x1), y: Math.max(marquee.y0, marquee.y1) };
      // An object is IN if its own centre projects inside the band. Its bounding box would sweep up
      // half the layout every time you brushed past a frame.
      const hit = state.nodes.filter(n => {
        const s = toScreen({ x: n.x, y: selTop(n) / 2, z: n.z });
        return !s.behind && s.x >= lo.x && s.x <= hi.x && s.y >= lo.y && s.y <= hi.y;
      });
      if (!marquee.add) state.selSet = new Set();     // plain sweep replaces, shift-sweep adds
      for (const n of hit) state.selSet.add(n.id);
      state.sel = [...state.selSet].pop() ?? null;
    } else if (state.sel != null || state.selSet.size) {
      selectOnly(null);
    }
    marquee = null;
    $("marquee").hidden = true;
    render();
    return;
  }
  const wasDragging = dragNode || dragMod || dragSlide;
  // Dropped a free/detached part on a legal edge -> hook it back on (an occupied edge = insert).
  // Hooking IS committing: a part hanging off a real edge is placed, so it stops floating. Dropping
  // on open ground does NOT commit -- a ghost stays a ghost until you hook it or press lock, which is
  // what lets you nudge it around before deciding.
  if (dragNode && dragNode.host == null && dropHint) {
    if (dropHint.occupied) insertAt(dragNode, dropHint.host, dropHint.key);
    else hookNode(dragNode, dropHint.host, dropHint.key);
    dragNode.floating = false;
  }
  dropHint = null;
  dragNode = dragMod = dragSlide = dragGroup = null; dragHooked = false; controls.enabled = true;
  if (wasDragging) { render(); commitHistory(); }   // resolve the new hook, snapshot once
});

// Right-click a module in a frame to open its action menu (Remove). Only when the click is
// actually on a module -- anywhere else the browser's own context menu is left alone.
canvas.addEventListener("contextmenu", e => {
  toPtr(e);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(slotMeshes, false)[0];
  if (!hit) return;
  e.preventDefault();
  const { placement, node } = hit.object.userData;
  if (placement && node) showModMenu(node, placement, e.clientX, e.clientY);
});

/** Pull a dragged table flush against whatever it is nearly touching. Layout tables are
 *  meant to butt edge to edge -- that is the whole point of a shared 496mm depth.
 *  Only free nodes are ever dragged, and only free nodes are considered as targets:
 *  a hooked board is already exactly where it belongs. */
function snapToNeighbours(n) {
  const a = aabb(n);
  for (const m of state.nodes) {
    if (m === n || m.host) continue;
    const b = aabb(m);
    const nearZ = a.z0 < b.z1 + 200 && b.z0 < a.z1 + 200;
    const nearX = a.x0 < b.x1 + 200 && b.x0 < a.x1 + 200;
    if (nearZ && Math.abs(a.x0 - b.x1) < 80) { n.x = b.x1 + a.w / 2; return; }
    if (nearZ && Math.abs(a.x1 - b.x0) < 80) { n.x = b.x0 - a.w / 2; return; }
    if (nearX && Math.abs(a.z0 - b.z1) < 80) { n.z = b.z1 + a.d / 2; return; }
    if (nearX && Math.abs(a.z1 - b.z0) < 80) { n.z = b.z0 - a.d / 2; return; }
  }
}

/** Add a part. New objects arrive FLOATING -- a lifted, translucent ghost dropped in a clear spot in
 *  front of the layout, NOT jammed onto whatever is already there. You move it where you want, then
 *  lock it (or drag it onto an edge to hook). This is the whole point of the change: where a new part
 *  goes is your call, not the layout's.
 *
 *  Two things do NOT float. A footprint is a ground reference -- it lies flat and centred like a floor
 *  plan, not a thing you place and lock. And the first-run default frame (float=false) arrives already
 *  placed at the origin: a blank canvas offering you a ghost to chase is a worse welcome than a table.
 *
 *  A hook-on board floats too now. It used to auto-hook to the first free edge, which is exactly the
 *  "deploys onto the old object" behaviour being removed. It comes in as a ghost; drag it onto an edge
 *  to hook it (that still commits instantly), or lock it loose. Hooking a board straight onto a chosen
 *  edge still happens the direct way -- through that edge's own + menu, which calls attach(). */
function addNode(sku, float = true) {
  hoverPreview = null;          // the click that adds it replaces the preview ghost with the real one
  const p = PARTS[sku];
  const kind = kindOf(p);

  const n = {
    id: state.nextId++, sku, kind, x: 0, z: 0, rot: 0,
    leg: kind === "frame" ? "CK-114" : null,
    placements: [],
    // Four pieces, two ways round. Default to the one Snow Peak publishes; no bridge yet.
    ...(sku === JIKARO ? { config: "long_in", bridge: false } : {}),
    // Expandable tables (CK-090) open to their default config.
    ...(expDef(sku) ? { config: expDef(sku).default } : {}),
    // A lounge cushion defaults to its round (open) form; it can be folded to a half-circle.
    ...(p.chair === "cushion" ? { config: "round" } : {}),
  };

  // A shelter footprint is a big ground reference: drop it CENTRED on whatever is already there
  // (so it frames the layout), or at the origin if the canvas is empty. It does not float.
  if (kind === "footprint") {
    Object.assign(n, footprintSpot(n));
    state.nodes.unshift(n);   // render first, under everything -- it is the floor plan
    selectOnly(n.id);
    render();
    return;
  }

  if (float) {
    // A clear spot in front of the layout, staggered so repeats don't stack. Provisional -- nothing
    // auto-hooks, nothing lands flush. floatSpot() is shared with the hover preview, so the ghost you
    // see is exactly where the click will drop it.
    n.floating = true;
    Object.assign(n, floatSpot(n));
  }
  // else: the first-run frame, placed at the origin and committed.
  state.nodes.push(n);
  selectOnly(n.id);
  render();
}

/** The node a palette row would ADD, built on the fly for the hover preview -- same fields addNode
 *  would set, at the same spot, but never pushed into state. id -1 marks it as not real. */
function previewNode(sku) {
  const p = PARTS[sku], kind = kindOf(p);
  const n = {
    id: -1, sku, kind, x: 0, z: 0, rot: 0,
    leg: kind === "frame" ? "CK-114" : null, placements: [],
    ...(sku === JIKARO ? { config: "long_in", bridge: false } : {}),
    ...(expDef(sku) ? { config: expDef(sku).default } : {}),
    ...(p.chair === "cushion" ? { config: "round" } : {}),
  };
  Object.assign(n, kind === "footprint" ? footprintSpot(n) : floatSpot(n));
  return n;
}

/** Hook a board onto one specific edge of one specific host.
 *
 *  A board on the frame's LONG rail hangs from a rail joint, so the joint goes in the BOM.
 *  Two per board, and they come as a pair (XCK-128-01 is a 2-piece set) -- so one set. */
function attach(sku, host, key) {
  const slide = isSlide(PARTS[sku]);
  const n = {
    id: state.nextId++, sku, kind: kindOf(PARTS[sku]), host: host.id, edge: key,
    // A slide cantilevers, a pit in an aperture stands on its own feet -- neither takes a leg from
    // its host. Only what the host BEARS inherits its legs. (Same rule as hookNode.)
    x: 0, z: 0, rot: 0, leg: (slide || key === "opening") ? null : host.leg, placements: [],
    rail: key.startsWith("rail"),
    // Anything on the long rail carries a slide offset so it can be dragged ALONG the rail --
    // a sliding extension starts staggered, a hook-on board starts centred (0).
    ...(key.startsWith("rail") ? { slide: slide ? initialSlide(host, key, sku) : 0 } : {}),
  };
  state.nodes.push(n);
  selectOnly(n.id);
  render();
}

let dropHint = null;

/** Remove a node, and everything hanging off it. A hook chain is not a set of tables that
 *  happen to be near each other -- take out the frame and the extensions have nothing to
 *  hang from. They come down with it. */
function removeNode(n) {
  // Remove n, OR -- if it's part of a multi-selection -- every selected object, and in each case
  // everything hooked below it. A hook chain comes down with its host.
  const roots = (n && state.selSet.has(n.id)) ? [...state.selSet] : [n.id];
  const doomed = new Set(roots);
  for (let i = 0; i < 16; i++)
    for (const m of state.nodes)
      if (m.host && doomed.has(m.host)) doomed.add(m.id);
  state.nodes = state.nodes.filter(m => !doomed.has(m.id));
  for (const id of doomed) state.selSet.delete(id);
  if (doomed.has(state.sel)) state.sel = [...state.selSet].pop() ?? state.nodes[0]?.id ?? null;
  if (!state.selSet.size && state.sel != null) state.selSet.add(state.sel);
  setHover(null);
  render();
}

/** Take one accessory back out of a frame -- an added module is not permanent. */
function removePlacement(node, pl) {
  node.placements = node.placements.filter(x => x !== pl);
  render();
}

/** Turn a free node a quarter turn. Hooked boards follow, because they are resolved from
 *  their host's edge, not from a remembered position. */
function rotateNode(n) {
  if (n.host) return;
  n.rot = norm(n.rot + Math.PI / 2);
  render();
}

/** Clone a free-standing node AND everything hooked to it, a short step away. Ids are remapped and
 *  host links rewired so the copy is a self-contained assembly; only the root is offset -- hooked
 *  boards re-resolve from their (cloned) host's edge. A hooked board has no position of its own, so
 *  it can't be the duplicate root. */
function duplicateNode(n) {
  if (n.host) return;
  const sub = new Set([n.id]);
  for (let i = 0; i < 16; i++)
    for (const m of state.nodes) if (m.host != null && sub.has(m.host)) sub.add(m.id);
  const idMap = new Map(), clones = [];
  for (const m of state.nodes) if (sub.has(m.id)) {
    const c = JSON.parse(JSON.stringify(m));
    c.id = state.nextId++;
    idMap.set(m.id, c.id);
    clones.push([m, c]);
  }
  for (const [m, c] of clones) {
    if (c.host != null) c.host = idMap.get(c.host) ?? c.host;
    if (m.id === n.id) {
      c.x = n.x + 180; c.z = n.z + 180;   // offset the root; children follow the host edge
      // A copy is a new thing to place: it arrives FLOATING (a ghost) and never inherits a lock, so
      // duplicating a pinned-down part doesn't hand you a second part you can't move.
      c.floating = true; delete c.locked;
    }
  }
  state.nodes.push(...clones.map(([, c]) => c));
  selectOnly(idMap.get(n.id));
  render();
}

/** Duplicate every free-standing object in the selection; the copies become the new selection. */
function duplicateSelected() {
  const clones = [];
  for (const id of [...state.selSet]) {
    const n = byId(id);
    if (n && !n.host) { duplicateNode(n); clones.push(state.sel); }
  }
  if (clones.length) { state.sel = clones[clones.length - 1]; state.selSet = new Set(clones); render(); }
}

// ---- Camera navigation: smooth moves, preset angles, fit-to-scene --------------------------------
let camTween = null;
/** Ease the camera to a new position + target over `ms`, instead of cutting. */
function flyTo(pos, target, ms = 440) {
  camTween = { fromP: camera.position.clone(), toP: pos.clone(),
    fromT: controls.target.clone(), toT: target.clone(), t0: performance.now(), ms };
}
function stepCamTween() {
  if (!camTween) return;
  const k = Math.min(1, (performance.now() - camTween.t0) / camTween.ms);
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;   // easeInOutQuad
  camera.position.lerpVectors(camTween.fromP, camTween.toP, e);
  controls.target.lerpVectors(camTween.fromT, camTween.toT, e);
  if (k >= 1) camTween = null;
}

/** The whole layout's extent, in scene metres: a centre and a radius that encloses everything. */
function sceneBounds() {
  if (!state.nodes.length) return { center: new THREE.Vector3(0, 0.2, 0), radius: 0.8 };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, hi = 0;
  for (const n of state.nodes) {
    const a = aabb(n);
    x0 = Math.min(x0, a.x0); x1 = Math.max(x1, a.x1);
    z0 = Math.min(z0, a.z0); z1 = Math.max(z1, a.z1);
    hi = Math.max(hi, selTop(n));
  }
  const center = new THREE.Vector3((x0 + x1) / 2 * MM, hi / 2 * MM, (z0 + z1) / 2 * MM);
  const radius = Math.max(0.5, Math.hypot((x1 - x0) * MM, (z1 - z0) * MM, hi * MM) / 2);
  return { center, radius };
}
/** Distance at which a sphere of `radius` fills the frame, with a little margin. */
const fitDist = radius => radius / Math.sin(camera.fov * Math.PI / 180 / 2) * 1.15;

const VIEW_DIRS = {
  top: new THREE.Vector3(0.0001, 1, 0.0001),
  front: new THREE.Vector3(0, 0.001, 1),
  side: new THREE.Vector3(1, 0.001, 0.0001),
  iso: new THREE.Vector3(1, 0.8, 1),
};
/** Snap to a named angle, framing the whole scene from that direction. */
function setView(name) {
  if (name === "fit") return fitAll();
  const { center, radius } = sceneBounds();
  const dir = VIEW_DIRS[name] || VIEW_DIRS.iso;
  flyTo(center.clone().addScaledVector(dir.clone().normalize(), fitDist(radius)), center);
}
/** Keep the current angle, just re-frame everything. */
function fitAll() {
  const { center, radius } = sceneBounds();
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(center.clone().addScaledVector(dir, fitDist(radius)), center);
}

/** Frame the selection: swing the orbit target onto the object and pull to a distance that suits
 *  its size, keeping the current viewing direction -- as a smooth move. */
function focusSelection(n) {
  const f = footprint(n), h = selTop(n);
  const c = new THREE.Vector3(n.x * MM, h / 2 * MM, n.z * MM);
  const dist = Math.max(0.6, Math.max(f.w, f.d, h) * MM * 1.9);
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(c.clone().addScaledVector(dir, dist), c);
}

for (const b of document.querySelectorAll("#viewnav button[data-view]"))
  b.onclick = () => setView(b.dataset.view);

// The rubber-band TOOL. A mode, deliberately: it is the one affordance that reads the same to a
// mouse and to a thumb, and the alternative -- a modifier chord -- does not exist on a phone at all.
// Off by default, because empty ground belongs to the camera.
const bandBtn = $("bandtool");
function setBand(on) {
  if (on && rulerTool) setRuler(false);   // one modal tool at a time -- they both own the left button
  bandTool = on;
  syncLeft();
  bandBtn.classList.toggle("on", on);
  bandBtn.setAttribute("aria-pressed", String(on));
  canvas.style.cursor = on ? "crosshair" : "";
}
bandBtn.onclick = () => setBand(!bandTool);

// ---- Measurements: two ground points and the distance between them ------------------------------
// A ruler is intent (two points on the ground), not a thing in the 3D scene -- it draws as an SVG
// overlay so the line stays one pixel crisp at any zoom and never fights the model for depth. The
// points snap to the same 25mm grid the tables sit on, so a reading between two grid-placed parts
// comes out a round number instead of 1247.8.
const rulerBtn = $("rulertool");
function setRuler(on) {
  if (on && bandTool) setBand(false);
  rulerTool = on;
  rulerDraft = null; rulerHover = null;
  syncLeft();
  rulerBtn.classList.toggle("on", on);
  rulerBtn.setAttribute("aria-pressed", String(on));
  canvas.style.cursor = on ? "crosshair" : "";
  paintRulers();
}
rulerBtn.onclick = () => setRuler(!rulerTool);

const groundSnap = at => ({ x: Math.round(at.x / MM / SNAP) * SNAP, z: Math.round(at.z / MM / SNAP) * SNAP });

/** A left-press while the measure tool is on. First press sets one end; second press completes the
 *  measurement and clears the draft, so a third press starts a fresh one. */
function placeRulerPoint() {
  const at = hitPlane(0);
  if (!at) return;
  const p = groundSnap(at);
  if (!rulerDraft) { rulerDraft = p; rulerHover = p; return; }
  if (p.x === rulerDraft.x && p.z === rulerDraft.z) return;   // a zero-length measure is a mis-click
  state.rulers.push({ id: nextRulerId(), a: rulerDraft, b: p });
  rulerDraft = null; rulerHover = null;
  paintRulers();
  commitHistory();
}
function removeRuler(id) {
  state.rulers = state.rulers.filter(r => r.id !== id);
  paintRulers();
  commitHistory();
}
function clearRulerDraft() {
  if (!rulerDraft && !rulerHover) return;
  rulerDraft = null; rulerHover = null;
}
function rulerDist(r) { return Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z); }
/** The reading: straight-line distance big, and Δx / Δz small -- a layout is placed on two axes, so
 *  "how far apart along each" is as much the question as the diagonal between them. */
function rulerText(r) {
  const d = rulerDist(r), dx = Math.abs(r.b.x - r.a.x), dz = Math.abs(r.b.z - r.a.z);
  const main = d >= 1000 ? `${Math.round(d)} mm · ${(d / 1000).toFixed(2)} m` : `${Math.round(d)} mm`;
  return `<span class="d">${main}</span>` + (dx && dz ? ` <span class="dx">Δx ${Math.round(dx)} · Δz ${Math.round(dz)}</span>` : "");
}

// A persistent label div per measurement (its × survives across frames, so the click always lands);
// followRulers only MOVES them. Reconciled here on any change to the set.
const rulerEls = new Map();
function paintRulers() {
  const seen = new Set();
  for (const r of state.rulers) {
    seen.add(r.id);
    let el = rulerEls.get(r.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "rlabel";
      const txt = document.createElement("span");
      const del = document.createElement("button");
      del.innerHTML = icon("x", 12); del.title = "remove this measurement";
      del.onclick = ev => { ev.stopPropagation(); removeRuler(r.id); };
      el.append(txt, del);
      el._txt = txt;
      $("rulerlabels").append(el);
      rulerEls.set(r.id, el);
    }
    el._txt.innerHTML = rulerText(r);
  }
  for (const [id, el] of rulerEls) if (!seen.has(id)) { el.remove(); rulerEls.delete(id); }
}

const svgLine = (a, b, draft) => `<line class="${draft ? "draft" : ""}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
const svgDot = p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"/>`;

/** Called every frame: project each measurement's two ground points to the screen and lay the SVG
 *  over them, plus the live draft line. Cheap -- a handful of elements, redrawn as strings. */
function followRulers() {
  const svg = $("rulersvg");
  const draftLabel = $("rulerdraftlabel");
  if (!state.rulers.length && !rulerDraft) {
    if (svg.childNodes.length) svg.replaceChildren();
    draftLabel.hidden = true;
    return;
  }
  const parts = [];
  for (const r of state.rulers) {
    const A = toScreen({ x: r.a.x, y: 0, z: r.a.z });
    const B = toScreen({ x: r.b.x, y: 0, z: r.b.z });
    const el = rulerEls.get(r.id);
    if (A.behind || B.behind) { if (el) el.style.display = "none"; continue; }
    parts.push(svgLine(A, B, false), svgDot(A), svgDot(B));
    if (el) {
      el.style.display = "";
      el.style.left = `${(A.x + B.x) / 2}px`;
      el.style.top = `${(A.y + B.y) / 2}px`;
    }
  }
  if (rulerDraft && rulerHover) {
    const A = toScreen({ x: rulerDraft.x, y: 0, z: rulerDraft.z });
    const B = toScreen({ x: rulerHover.x, y: 0, z: rulerHover.z });
    if (!A.behind && !B.behind) {
      parts.push(svgLine(A, B, true), svgDot(A), svgDot(B));
      const live = { a: rulerDraft, b: rulerHover };
      draftLabel.innerHTML = rulerText(live);
      draftLabel.style.left = `${(A.x + B.x) / 2}px`;
      draftLabel.style.top = `${(A.y + B.y) / 2}px`;
      draftLabel.hidden = false;
    } else draftLabel.hidden = true;
  } else draftLabel.hidden = true;
  svg.innerHTML = parts.join("");
}

function setLeg(n, sku) {
  const root = n.kind === "ext" ? rootOf(n) : n;
  if (!root || root.kind === "table") return;
  root.leg = sku;
  render();
}

/** Silver or black. Applies to the whole run for a hooked board, the same rule setLeg uses -- one
 *  run wears one finish. Stored on the node so it survives a reload and travels in a shared link. */
function setLegFinish(n, finish) {
  const root = n.kind === "ext" ? rootOf(n) : n;
  if (!root) return;
  if (finish === "silver") delete root.legFinish;   // silver is the default -- absence means silver
  else root.legFinish = finish;
  render();
}

// A hooked board's height adjuster: step it DOWN the ladder from its host. Clamped to one rung
// (one CK-151 bridges one adjacent step) and to the floor of the ladder.
function setStep(n, step) {
  const room = Math.min(1, stepRoom(hostLegOf(byId(n.host))));
  n.step = Math.max(0, Math.min(step, room));
  render();
}
function placeModule(sku) {
  const n = sel();
  if (!n || !hasBay(n)) return;
  // One hanging rack per frame -- the manuals are explicit that a second one's side frames
  // collide with the first's. Not a soft warning: the second simply does not go on.
  if (isHangRack(PARTS[sku]) && hasHangRack(n)) return;
  const span = spanOf(PARTS[sku]);
  const start = firstFit(n, span);
  if (start < 0) return;
  n.placements.push({ sku, span, start });
  render();
}

/** Place a module in the free run the pointer was over. The module covers the pointed cell
 *  and fits inside the run: it starts there and extends right, sliding LEFT only as far as it
 *  must to fit. So hovering the half-slot beside an occupied one still lets a whole unit go in
 *  when the space on the OTHER side is free -- the bug was measuring the run in one direction. */
function placeModuleAt(sku, n, cell) {
  if (!n || !hasBay(n)) return;
  if (isHangRack(PARTS[sku]) && hasHangRack(n)) return;
  const span = spanOf(PARTS[sku]);
  const b = freeBlock(n, cell);
  if (!b || span > b.len) return;
  const start = Math.max(b.lo, Math.min(cell, b.hi - span + 1));
  if (!canPlaceAt(n, start, span)) return;
  n.placements.push({ sku, span, start });
  render();
}

// ---------------------------------------------------------------- ui

function chip(label, on, title, fn, dead = false) {
  const c = document.createElement("button");
  c.className = "chip" + (on ? " on" : "") + (dead ? " dead" : "");
  c.textContent = label;
  c.title = title || "";
  if (!dead) c.onclick = fn;
  return c;
}

// Search matches SKU, name, AND a few category words -- so "burner", "corner", "chair", "tarp"
// find their parts even when the exact word isn't in the title.
const CAT_WORDS = {
  frame: "frame", extension_table: "extension board", corner: "corner angle extension",
  leg: "leg height", slot_module: "module burner stove tray box grill accessory", hanger: "hanging rack shelf",
  layout_table: "table", standalone: "table igt", seating: "chair bench seat stool furniture",
  shelter: "tent tarp shelter shell footprint",
  figure: "person people human scale figure adult child kid toddler",
};
const searchKey = p => `${p.sku} ${p.title_en || ""} ${CAT_WORDS[p.role] || p.role || ""}`.toLowerCase();

function partRow(p, fn, dead, why, badge) {
  const el = document.createElement("div");
  el.className = "part" + (dead ? " dead" : "");
  const s = spanOf(p);
  el.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
    + `<span class="nm">${nameOf(p)}</span>`
    + `<span class="sp">${badge ?? (s ? s / 2 + "u" : "")}</span>`;
  // The details live in the hover card now (wirePreview), the same card the + menus show -- a native
  // title tooltip on top of it would say the same thing twice, late. Touch keeps the tooltip-free row.
  if (COARSE) el.title = why || `${p.sku} — ${nameOf(p)}`;
  el.dataset.search = searchKey(p);
  el.dataset.sku = p.sku;
  el.dataset.name = p.title_en || "";
  if (p.title_jp) el.dataset.jp = p.title_jp;
  if (!dead) { el.onclick = () => { hidePreview(); fn(p); if (PHONE.matches) setSheet(null); }; previewOnHover(el, p.sku); }
  if (!COARSE) wirePreview(el, p, dead ? why : "");   // a dead row's card says WHY it is dead
  return el;
}

// Hovering a palette row shows a ghost of that part in the 3D view, right where "add" would drop it.
// Only rebuild() -- the scene, not the panels -- so hovering the list doesn't repaint the list under
// the pointer. Mouse only: a touch has no hover, and coarse pointers hide hint affordances anyway.
function previewOnHover(el, sku) {
  el.addEventListener("mouseenter", () => { hoverPreview = sku; rebuild(); });
  el.addEventListener("mouseleave", () => { if (hoverPreview === sku) { hoverPreview = null; rebuild(); } });
}

function paintPalette() {
  hidePreview();   // the row under the card is about to be replaced; its mouseleave will never fire
  // Frames were still the ORIGINAL "Add a table" chip row -- "2u ⤢", meaning stated nowhere --
  // years after every other category went to full rows. Same rows now; the unit count is the
  // badge and "Collapsible" is in the name, where the answer belongs.
  const add = $("add"); add.innerHTML = "";
  for (const p of BY_ROLE.frame)
    add.append(partRow(p, () => addNode(p.sku), false, null, `${p.units}u`));

  // Hook-on boards. Since float-first, "add" no longer needs a free edge -- the board comes in
  // floating and you drag it onto an edge (or use an edge's own + menu to hook it straight on).
  // So the rows are always live; the tooltip just says which.
  const ext = $("extensions"); ext.innerHTML = "";
  const open = anyOpenEdge();
  for (const p of HOOKABLE)
    ext.append(partRow(p, () => addNode(p.sku), false,
      open ? `${p.sku} — adds as a floating board; drag it onto a highlighted edge to hook it (or use that edge's + menu).`
           : `${p.sku} — adds as a floating board. Put a frame down and drag it onto an edge to hook it.`));
  // Two different gaps, and they deserve two different sentences. One part has no copy
  // saying how it attaches; the other says it hooks on but has no plan view, so WHICH
  // edge carries the hooks was never measured. Both are unplaceable, for opposite reasons.
  for (const p of BY_ROLE.unsourced)
    ext.append(partRow(p, null, true, p.attach === "hook_on"
      ? `${p.sku} — the copy says it hooks on, but its gallery has no plan view, so which `
        + `edge carries the hooks is unmeasured. The planner will not guess.`
      : `${p.sku} — Snow Peak never documents how this attaches. The planner will not guess.`));

  // Slide-in extensions: same float-first flow, different rail. They were only reachable
  // through a long rail's + menu -- a whole attach mechanism the library never showed.
  const sl = $("slides"); sl.innerHTML = "";
  for (const p of SLIDE_IN)
    sl.append(partRow(p, () => addNode(p.sku), false,
      `${p.sku} — adds as a floating board; drag it onto a frame's LONG rail. It slides along it, and tiles.`));

  // The freestanding surfaces, split the way the connection graph splits them: layout tables
  // are part of the system (frames hook onto them), standalone IGTs just stand there.
  const lay = $("laytables"); lay.innerHTML = "";
  for (const p of BY_ROLE.layout_table)
    lay.append(partRow(p, () => addNode(p.sku), false));
  const free = $("freetables"); free.innerHTML = "";
  for (const p of BY_ROLE.standalone)
    free.append(partRow(p, () => addNode(p.sku), false));

  // Non-IGT props placed around the layout (chairs). Free-standing -- add and drag.
  const seat = $("seating"); seat.innerHTML = "";
  for (const p of BY_ROLE.seating)
    seat.append(partRow(p, () => addNode(p.sku), false));

  // The fire pit. Its OWN section, not appended to seating -- a Takibi in the chair list is exactly
  // the taxonomy slippage this catalog keeps having to undo.
  const hearth = $("hearth");
  if (hearth) {
    hearth.innerHTML = "";
    for (const p of BY_ROLE.hearth)
      hearth.append(partRow(p, () => addNode(p.sku), false,
        `${p.sku} — stands on the ground beside the layout. Its bridge, cooking surface, coal bed and `
        + `base plate are options ON it (select it), and each is a real part on the bill.`));
  }

  // Shelter footprints (tents / shells / tarps) -- a ground outline dropped as a scale reference.
  const shel = $("shelters");
  if (shel) {
    shel.innerHTML = "";
    // Lock toggle. Locked = the footprints are a backdrop: only the SELECTED one is draggable, the
    // rest are click-through so a big translucent tarp can't steal a click meant for the furniture
    // on top of it. Unlocked = every footprint picks normally.
    shel.append(chip(state.shelterLock ? "🔒 layer locked" : "🔓 layer editable", state.shelterLock,
      state.shelterLock ? "footprints are click-through — only the selected one drags. Click to unlock all."
                        : "every footprint is selectable and draggable. Click to lock the layer.",
      () => { state.shelterLock = !state.shelterLock; render(); }));
    // The catalog: setup-size footprints (vestibule/canopy included -- NOT the inner mat).
    for (const p of BY_ROLE.shelter)
      shel.append(partRow(p, () => addNode(p.sku), false,
        `${p.sku} — ${p.shelter_type || "shelter"} footprint (setup size, vestibule/canopy included), laid flat as a size reference.`));
    // Already placed: a list that selects OR deletes even while the layer is locked.
    const placed = state.nodes.filter(n => n.kind === "footprint");
    if (placed.length) {
      const hdr = document.createElement("div");
      hdr.className = "subhead"; hdr.textContent = `placed · ${placed.length}`;
      shel.append(hdr);
      for (const n of placed) {
        const row = document.createElement("div");
        row.className = "part" + (n.id === state.sel ? " on" : "");
        const sw = document.createElement("span");
        sw.className = "sw";
        sw.style.background = "#" + (SHELTER_FILL[PARTS[n.sku].shelter_type] || 0x8a8f97).toString(16).padStart(6, "0");
        const nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = nameOf(PARTS[n.sku]) || n.sku;
        nm.title = "select this footprint (works even when the layer is locked)";
        nm.onclick = () => { state.sel = n.id; render(); };
        const del = document.createElement("span");
        del.className = "del"; del.innerHTML = icon("x", 12);
        del.title = "remove this footprint";
        del.onclick = (e) => { e.stopPropagation(); removeNode(n); };
        row.append(sw, nm, del);
        shel.append(row);
      }
    }
  }

  // The scale figures -- the planner's own measuring stick. Two rows, because "an adult" and
  // "a toddler" are different canons, not different heights of one shape.
  const figs = $("figures");
  if (figs) {
    figs.innerHTML = "";
    for (const p of BY_ROLE.figure)
      figs.append(partRow(p, () => addNode(p.sku), false,
        `${p.sku} — not a product: a scale figure for reading sizes. Adds standing at `
        + `${p.assembled_mm.h / 10}cm (a published median); select it to set the real `
        + `person's height, or sit it down.`,
        `${p.assembled_mm.h / 10}cm`));
  }

  const n = sel();

  // The slot modules, BROWSABLE AT LAST. They used to exist only in the selected-frame box --
  // a first-timer could scroll the whole library and never learn the system has burners. The
  // rows are always here now, live when a bay host is selected (frame, bridged ring, opened
  // Extension IGT), dead-with-a-reason when nothing is. Cooking and storage split, because
  // "which stove" and "which tray" are different questions.
  const host = n && hasBay(n) ? n : null;
  const railHost = host && hostsHanging(host) ? host : null;
  const cook = $("cooking"), tray = $("trays");
  cook.innerHTML = ""; tray.innerHTML = "";
  const isCooking = p => !!burnerOf(p.sku) || p.sku.replace(/-(US|INT|EC|R)$/i, "") === "CK-160";
  for (const p of BY_ROLE.slot_module) {
    const c = host ? compat(p.sku, host.sku) : { level: "ok" };
    const dead = !host || firstFit(host, p.span) < 0 || c.level === "blocked";
    const why = !host ? `${p.sku} — drops into a frame's slots. Select a frame first.`
      : c.level === "blocked" || c.level === "unlisted" ? `${p.sku} — ${c.why}` : null;
    const row = partRow(p, () => placeModule(p.sku), dead, why);
    if (c.level === "unlisted" && !dead) row.classList.add("caution");
    (isCooking(p) ? cook : tray).append(row);
  }

  // Hanging racks occupy 2U of the grid but hang BELOW the frame instead of sitting in it.
  // One per frame -- their side frames collide otherwise (both manuals say so). So they are
  // dead if the frame already has one, or if 2U will not fit.
  const hang = $("hangers"); hang.innerHTML = "";
  for (const p of BY_ROLE.hang_rack) {
    const dead = !railHost || hasHangRack(railHost) || firstFit(railHost, p.span) < 0;
    hang.append(partRow(p, () => placeModule(p.sku), dead,
      !railHost ? `${p.sku} — hangs under 2U of a frame's rails. Select a frame first.`
        : dead && hasHangRack(railHost)
          ? `${p.sku} — one hanging rack per host; the side frames would collide.`
          : `${p.sku} — hangs a ${p.tiers === 2 ? "two-tier" : "one-tier"} rack under 2U of the rails.`));
  }

  $("selname").textContent = n ? nameOf(PARTS[n.sku]) : t("sel.none");
  $("selbox").hidden = !n;   // the selected-part controls ride at the TOP, only while something is picked
  paintCatCounts();      // put the part-count on each category head, now the rows exist
  filterPalette();       // re-apply the current search over the freshly painted rows
}

// The number beside each category head. Counts only real catalog rows -- everything the palette
// draws that a search can match carries data-search, while the shelter lock toggle, the "placed"
// subhead and its rows do not, so they are excluded for free. Total, not filtered: it says how big
// the category is, and holds steady while a search hides rows inside it.
function paintCatCounts() {
  for (const sec of document.querySelectorAll(".cat")) {
    const head = sec.querySelector(".cathead");
    if (!head) continue;
    let span = head.querySelector(".catcount");
    if (!span) { span = document.createElement("span"); span.className = "catcount"; head.append(span); }
    const n = sec.querySelectorAll(".catbody [data-search]").length;
    span.textContent = n ? String(n) : "";
  }
}

// Find a part by name, number or category: hide the rows that don't match, show a hit count, and
// while searching force every category open and drop the ones with no match, so the list becomes
// just the results. Runs after every repaint so the filter survives re-renders.
//
// What a query can be (learned from igtplanner.com's panel, plus the Japanese names only we carry):
//   - WORDS, each of which must land somewhere -- "bamboo long" finds "Bamboo IGT Table Long";
//     the old whole-string substring test needed the words adjacent and in order.
//   - a PART NUMBER with or without its punctuation -- "ck149", "gs 450".
//   - a SPAN -- "2u", "0.5u", "1 unit" -- matched against the badge the row shows.
//   - the CATEGORY's own heading -- "cooking", "trays" -- which brings the whole section.
//   - a slightly MISSPELLED name -- "flat brner" -- by an in-order letter match, kept tight so a
//     short query can't match everything.
//   - KATAKANA / KANJI from the JP title -- "焚火", "フラット" -- NFKC folds half-width forms.
// Matches are ranked inside each section: exact part number, then words at the start of a name,
// then anywhere in it, then category words, then the misspelling match.
const fold = s => (s || "").normalize("NFKC").toLowerCase();
const alnum = s => s.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g, "");
const UNIT_RE = /(\d*\.?\d+)\s*(?:u|units?)(?![a-z])/g;

function parseQuery(raw) {
  let q = fold(raw).trim();
  const units = [];
  q = q.replace(UNIT_RE, (_, n) => { units.push(parseFloat(n)); return " "; });
  q = q.replace(/\bhalf[- ]units?\b/g, () => { units.push(0.5); return " "; });
  return { units, words: q.split(/\s+/).filter(Boolean) };
}

// In-order letters of w inside s, held to a tight spread so "brnr" finds "burner" but "ab" finds nothing.
function looseScore(s, w) {
  if (w.length < 3) return 0;
  let best = 0;
  for (let start = s.indexOf(w[0]); start !== -1; start = s.indexOf(w[0], start + 1)) {
    let i = start, ok = true;
    for (const ch of w.slice(1)) { i = s.indexOf(ch, i + 1); if (i === -1) { ok = false; break; } }
    if (!ok) break;
    const spread = i - start + 1;
    if (spread <= w.length * 1.6 + 1) best = Math.max(best, 60 - (spread - w.length) * 6);
  }
  return best;
}

function wordScore(doc, w) {
  const wa = alnum(w);
  if (wa && doc.sku === wa) return 1000;
  let sc = 0;
  if (wa.length >= 2 && doc.sku.includes(wa)) sc = Math.max(sc, 400);
  const at = doc.name.indexOf(w);
  if (at !== -1) sc = Math.max(sc, at === 0 || /[\s(/-]/.test(doc.name[at - 1]) ? 300 : 200);
  if (doc.jp && doc.jp.includes(w)) sc = Math.max(sc, 250);
  if (!sc && doc.words.includes(w)) sc = CAT_HIT;
  if (!sc) sc = looseScore(doc.name, w);
  return sc;
}
// A category-word hit is the WEAK kind: "burner" is one of the words on every slot module, so
// counted alongside real name hits it buried the four burners under every tray and box. It only
// counts for a word that no row matches by name, number or JP title ("cooking", "seat").
const CAT_HIT = 100;

function rowDoc(el, catText) {
  const d = el.dataset;
  return {
    sku: alnum(fold(d.sku || "")),
    name: fold(d.name || d.search || ""),
    jp: fold(d.jp || ""),
    words: `${fold(d.search || "")} ${catText}`,
    unit: parseFloat((el.querySelector(".sp")?.textContent || "").replace(/u$/, "")),
  };
}

function filterPalette() {
  const { units, words } = parseQuery($("palsearch").value || "");
  const q = units.length + words.length > 0;
  $("palette").classList.toggle("searching", q);
  let shown = 0;
  // Every parts container in the palette, enumerated LIVE -- the hand-kept id list this used
  // to walk still said "tables, legs, modules" years after those ids died, which silently took
  // Cooking, the trays, the racks and both freestanding sections out of search entirely.
  const hosts = [...document.querySelectorAll("#palette .parts")];
  const rows = [];                                     // [el, per-word scores] for every candidate
  for (const host of hosts) {
    const catText = fold(host.closest(".cat")?.querySelector(".cathead")?.textContent || "");
    [...host.children].forEach((el, i) => { if (el._ord == null) el._ord = i; });
    if (!q) continue;
    for (const el of host.children) {
      if (el.dataset.search == null) continue;
      const doc = rowDoc(el, catText);
      if (units.length && !units.includes(doc.unit)) continue;
      rows.push([el, words.map(w => wordScore(doc, w))]);
    }
  }
  const strong = words.map((_, i) => rows.some(([, sc]) => sc[i] > CAT_HIT));
  for (const host of hosts) for (const el of host.children) { el._score = 0; el.style.display = q ? "none" : ""; }
  for (const [el, sc] of rows) {
    if (sc.some((v, i) => !v || (strong[i] && v <= CAT_HIT))) continue;
    el._score = 1 + sc.reduce((a, v) => a + v, 0);
    el.style.display = "";
    shown++;
  }
  for (const host of hosts) {
    const kids = [...host.children];
    // Best first while searching; the catalogue's own order back the moment the query clears.
    const order = q ? [...kids].sort((a, b) => b._score - a._score || a._ord - b._ord)
                    : [...kids].sort((a, b) => a._ord - b._ord);
    if (order.some((el, i) => el !== host.children[i])) host.append(...order);
  }
  for (const cat of document.querySelectorAll("#palette .cat")) {
    const hit = [...cat.querySelectorAll("[data-search]")].some(el => el.style.display !== "none");
    cat.classList.toggle("empty", q && !hit);
  }
  const cnt = $("searchcount");
  cnt.hidden = !q;
  if (q) cnt.textContent = shown ? t(shown === 1 ? "pal.match1" : "pal.matches", { n: shown }) : t("pal.nomatch");
}
$("palsearch").addEventListener("input", filterPalette);

// Collapse / expand a library category by clicking its header.
for (const h of document.querySelectorAll(".cathead"))
  h.addEventListener("click", () => h.closest(".cat").classList.toggle("collapsed"));
// One switch for the lot: fold if anything is open, else open everything.
function paintFoldAll() {
  const anyOpen = [...document.querySelectorAll("#palette .cat")].some(c => !c.classList.contains("collapsed"));
  $("foldall").innerHTML = anyOpen ? icon("fold") : icon("unfold");
  $("foldall").title = t(anyOpen ? "pal.foldall" : "pal.openall");
}
$("foldall").onclick = () => {
  const cats = [...document.querySelectorAll("#palette .cat")];
  const fold = cats.some(c => !c.classList.contains("collapsed"));
  for (const c of cats) c.classList.toggle("collapsed", fold);
  paintFoldAll();
};
for (const h of document.querySelectorAll(".cathead")) h.addEventListener("click", paintFoldAll);
// On a phone the palette is a short window over a very long list; open categories mean the
// one thing a first-timer must find -- Frames -- starts below the fold. Folded headers make
// the library a table of contents instead. Search still force-opens matching sections.
if (COARSE)
  for (const cat of document.querySelectorAll("#palette .cat")) cat.classList.add("collapsed");
paintFoldAll();

// Fold either side panel away to a thin strip so the viewport gets the room. The renderer has to be
// told the canvas changed width -- after the grid transition, or it measures the old one.
const mainEl = document.querySelector("main");
for (const b of document.querySelectorAll(".panel-toggle")) {
  b.onclick = () => {
    const side = b.dataset.panel;                       // "left" | "right"
    const on = b.closest("aside").classList.toggle("collapsed");
    mainEl.classList.toggle(`${side}-collapsed`, on);
    b.textContent = (side === "left") === !on ? "‹" : "›";
    b.title = `${on ? "expand" : "collapse"} the ${side === "left" ? "parts" : "build"} panel`;
    setTimeout(resize, 170);
  };
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

// BUILD is a PACKING LIST -- what you own and what it weighs -- and it took a re-read of the whole
// panel to see that it had not been one for a while.
//
// It used to print one row per node, with an × to delete and a price. But the SCENE tree above it
// does exactly that job and does it better: it shows the NESTING, so you can see what hooks onto
// what, and it has its own × on every row. Two lists of the same objects, both deletable, stacked in
// one panel -- and the BOM was the worse of the two at a job it was not for.
//
// What the BOM alone knows is the CONSUMABLES: the leg sets, the CK-175s, the rail joints. Things
// that are not nodes, that no tree will ever show you, and that you still have to own and carry.
// That is the list worth keeping, so it is the only list it keeps now.
//
// And it groups. It listed "IGT Low Height 400mm Leg Set" four separate times for two frames --
// a shopping list that makes you count is not doing its job.
function paintBOM() {
  const tbl = $("bomtable"); tbl.innerHTML = "";
  let grams = 0;

  // Same sku, same row. `req`/`pl` only decide the lead mark, so they collapse together.
  const rows = new Map();
  for (const l of bomLines()) {
    const p = PARTS[l.sku];
    if (!p) continue;
    grams += p.weight_g || 0;
    const r = rows.get(l.sku) || { p, n: 0, req: true, pl: false };
    r.n++;
    if (!l.req) r.req = false;         // one placed by hand makes the whole row not "required"
    if (l.pl) r.pl = true;
    rows.set(l.sku, r);
  }

  for (const { p, n, req, pl } of rows.values()) {
    const tr = document.createElement("tr");
    const lead = req ? "↳ " : pl ? "· " : "";           // ↳ comes with · you dropped in
    const kg = (p.weight_g || 0) * n / 1000;
    tr.innerHTML = `<td class="qty">${n > 1 ? "×" + n : ""}</td>`
      + `<td class="nm" title="${p.sku} — ${nameOf(p)}">${lead}${nameOf(p)}</td>`
      + `<td class="p">${p.weight_g ? kg.toFixed(1) + " kg" : "—"}</td>`;
    tbl.append(tr);
  }
  const tot = { g: grams };

  // WHAT YOU CARRY. Not what it costs -- owner, twice, and he is right twice: where to buy a frame is
  // not how to lay one out, and money sat in the corner of every session answering a question nobody
  // was asking. The part bench prices a part, in every region, which is where a "how much" belongs.
  //
  // Both units, no toggle. He buys in a pound country and thinks in kilos; a toggle would make him
  // click to find out what he already wanted to know, and there is room for six more characters.
  const kg = tot.g / 1000;
  $("totals").innerHTML = `
    <div class="row big"><span>${t("bom.carry")}</span><b>${kg.toFixed(1)} kg</b></div>
    <div class="row"><span></span><b class="alt">${(kg * 2.20462).toFixed(1)} lb</b></div>`;
}

// The messages, folded. They used to be a wall above the bill -- ten paragraphs for one layout -- so
// they sit behind a one-line summary now (closed by default, remembered while you work), grouped the
// way you act on them: what to fix, what to check, what was added for you, and plain notes.
const WARN_CATS = [
  ["problem", t("warn.problem")], ["check", t("warn.check")], ["added", t("warn.added")], ["note", t("warn.note")],
];
let warnOpen = false;
function paintWarnings() {
  const w = $("warnings"); w.innerHTML = "";
  const all = warnings();
  const fix = all.filter(x => x.cat === "problem").length, badge = document.querySelector("#dockbuild .badge");
  if (badge) { badge.hidden = !fix; badge.textContent = fix; }
  if (!all.length) return;
  const box = document.createElement("details");
  box.className = "warnbox";
  box.open = warnOpen;
  box.ontoggle = () => { warnOpen = box.open; };
  const sum = document.createElement("summary");
  sum.innerHTML = WARN_CATS.map(([cat, label]) => {
    const n = all.filter(x => x.cat === cat).length;
    return n ? `<span class="wc ${cat}"><i></i>${n} ${label}</span>` : "";
  }).join("");
  box.append(sum);
  for (const [cat, label] of WARN_CATS) {
    const items = all.filter(x => x.cat === cat);
    if (!items.length) continue;
    const g = document.createElement("div");
    g.className = `wgroup ${cat}`;
    g.innerHTML = `<div class="wghead">${label}</div>`;
    for (const { text } of items) {
      const d = document.createElement("div");
      d.className = "witem"; d.textContent = text; g.append(d);
    }
    box.append(g);
  }
  w.append(box);
}

// The scene outliner: placed objects as a tree, nested by host-guest -- a hooked board sits under
// its host, a module under the frame whose bay it fills. Click a row to select (and get the object's
// toolbar in the viewport); the × removes it (and its children / the module).
const KIND_GLYPH = { frame: "▤", ext: "↳", prop: "◗", footprint: "▢", table: "▦" };

function treeRow(n, depth, { module = false, pl = null } = {}) {
  const row = document.createElement("div");
  const p = PARTS[(module ? pl.sku : n.sku)];
  row.className = "tree-row" + (!module && isSelectedId(n.id) ? " on" : "") + (module ? " module" : "");
  row.style.paddingLeft = `${0.35 + depth * 0.85}rem`;
  row.dataset.node = n.id;   // the 3D object this row stands for (a module row points at its host)
  const glyph = module ? "·" : n.host != null ? "↳" : (KIND_GLYPH[n.kind] || "▤");
  row.innerHTML = `<span class="tw">${glyph}</span>`
    + `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
    + `<span class="nm" title="${nameOf(p)}">${nameOf(p)}</span>`;
  // Shift / Ctrl / Cmd click adds/removes from the selection; a plain click selects just this one.
  // (A module row has no object of its own, so it just selects its host frame.)
  row.onclick = e => { (!module && (e.shiftKey || e.ctrlKey || e.metaKey)) ? toggleInSel(n.id) : selectOnly(n.id); render(); };
  row.onmouseenter = () => setHoverNode(n.id);           // light up the object in the 3D view
  row.onmouseleave = () => { if (hoverNodeId === n.id) setHoverNode(null); };
  const del = document.createElement("span");
  del.className = "del"; del.innerHTML = icon("x", 12);
  del.title = module ? "remove this module" : "remove this object (and anything on it)";
  del.onclick = e => { e.stopPropagation(); module ? removePlacement(n, pl) : removeNode(n); };
  row.append(del);
  return row;
}

function appendTree(host, n, depth) {
  host.append(treeRow(n, depth));
  for (const pl of n.placements || []) host.append(treeRow(n, depth + 1, { module: true, pl }));
  for (const c of state.nodes.filter(m => m.host === n.id)) appendTree(host, c, depth + 1);
}

let lastTreeSel;
function paintOutliner() {
  const host = $("scene"); if (!host) return;
  host.innerHTML = "";
  const roots = state.nodes.filter(n => n.host == null);
  if (!roots.length) {
    const e = document.createElement("div");
    e.className = "tree-empty"; e.textContent = "nothing placed yet";
    host.append(e);
    lastTreeSel = null;
    return;
  }
  for (const n of roots) appendTree(host, n, 0);
  // When the selection changes (e.g. by clicking the object in 3D), bring its row into view.
  if (state.sel !== lastTreeSel) {
    host.querySelector(".tree-row.on")?.scrollIntoView({ block: "nearest" });
    lastTreeSel = state.sel;
  }
}

// Dimensions read-out: the layout's overall footprint, and the selected object's own size.
function paintDimHud() {
  const hud = $("dimhud"); if (!hud) return;
  const objs = state.nodes.filter(n => n.kind !== "footprint");   // footprints are references, not the build
  let overall = "";
  if (objs.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const n of objs) { const a = aabb(n); x0 = Math.min(x0, a.x0); x1 = Math.max(x1, a.x1); z0 = Math.min(z0, a.z0); z1 = Math.max(z1, a.z1); }
    overall = `layout <b>${((x1 - x0) / 1000).toFixed(2)} × ${((z1 - z0) / 1000).toFixed(2)} m</b>`;
  }
  const n = sel();
  let selLine = "";
  if (n) {
    const f = footprint(n), h = selTop(n);
    const size = n.kind === "footprint"
      ? `${Math.round(f.w)} × ${Math.round(f.d)} mm`
      : `${Math.round(f.w)} × ${Math.round(f.d)} × ${Math.round(h)} mm`;
    selLine = `${nameOf(PARTS[n.sku])}  <b>${size}</b>`;
  }
  hud.innerHTML = (overall ? `<div>${overall}</div>` : "") + (selLine ? `<div class="sel">${selLine}</div>` : "");
  hud.hidden = !overall && !selLine;
}

// Numeric placement for the selected free object -- a hooked board has no position of its own.
function paintTransform() {
  const box = $("transform"); if (!box) return;
  const n = sel();
  if (!n || n.host != null) { box.hidden = true; return; }
  box.hidden = false;
  const px = $("posx"), pz = $("posz");
  if (document.activeElement !== px) px.value = Math.round(n.x);
  if (document.activeElement !== pz) pz.value = Math.round(n.z);
  $("rotread").textContent = `${Math.round(norm(n.rot) * 180 / Math.PI)}°`;
}
const bindPos = (id, axis) => $(id).addEventListener("input", () => {
  const n = sel(); if (!n || n.host != null) return;
  n[axis] = Number($(id).value) || 0;
  render();
});
bindPos("posx", "x");
bindPos("posz", "z");

// The one instruction line, kept TRUE. The edge handles only exist while something is
// selected (drawEdgeHandles is select-first), so "hover a table edge" is a lie in exactly
// the state a first-timer lands in after clicking empty ground. Two states, and touch gets
// touch words -- the line used to be display:none'd on phones, which left them nothing.
function paintHint() {
  const el = $("hint");
  // Point at the dots only when there ARE dots: a chair, a footprint, or a frame with every
  // edge taken draws no handles (paint runs after rebuild, so edgeMeshes is this frame's).
  if (sel() && edgeMeshes.length) el.innerHTML = t(COARSE ? "hint.dot.touch" : "hint.dot");
  else el.innerHTML = t(COARSE ? "hint.frame.touch" : "hint.frame");
}
function paint() { paintPalette(); paintSlots(); paintBOM(); paintWarnings(); paintSelTools(); paintOutliner(); paintDimHud(); paintTransform(); paintBlocks(); paintRulers(); paintHint(); }

/** Put a read layout on screen. */
function loadLayout(doc) {
  const { nodes, nextId, dropped, rulers, scene } = readLayout(doc);
  state.nodes = nodes; state.nextId = nextId; state.rulers = rulers;
  setGround(scene, { record: false });
  selectOnly(null);
  undoStack.length = 0; redoStack.length = 0;      // a new document has no past
  render();
  if (dropped.length) note(`left out ${dropped.length} part(s) no longer in the catalog: ${dropped.join(", ")}`);
  return dropped;
}
// For callers that post their own "opened ..." note over loadLayout's: carry the dropped
// parts along instead of burying the honest answer to "why is this table missing its burner".
const droppedSuffix = d => d.length ? ` — left out ${d.join(", ")}, no longer in the catalog` : "";

// ---------------------------------------------------------------- where a layout lives
//
// STATIC-FIRST, deliberately. The owner is weighing a public deployment, and that one maybe decides
// the shape of all of this: an endpoint POSTing layouts to the server's disk is fine on a laptop and
// a liability the hour the URL is public -- one filesystem shared by strangers, no accounts, and a
// write path anyone can reach. serve.py already has such an endpoint for the bench's annotations,
// and it is exactly the thing NOT to copy here. So nothing below needs a server, and the decision
// stays open in both directions instead of being made by accident.
//
//   the current scene   localStorage   survives a reload. On a public site each visitor keeps their
//                                      own, which is right, and costs nothing to be right about.
//   named layouts       localStorage   same.
//   sharing             the URL        send a link and they see the design. No account, no server.
//   archiving           a .json file   yours to drop in V:\ and commit -- the only copy git can see.
//
// localStorage is a CACHE and not a backup: clear the browser and it is gone. Export is what makes a
// layout outlive this machine. The UI says that out loud rather than letting the word "save" imply
// something it cannot do.
const LS_SCENE = "igt.scene", LS_SAVED = "igt.saved", LS_BLOCKS = "igt.blocks", LS_PAGES = "igt.pages";

const lsGet = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const lsPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

// A one-line word to the user, over the viewport. Small, and it goes away.
let noteTimer = null;
function note(msg, ms = 3200) {
  const el = $("note");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// The scene, kept warm. Debounced because render() fires on every drag frame and localStorage is
// synchronous -- writing there 60 times a second would make dragging feel like the bug.
//
// The live scene IS the active page. So a save folds what is on screen back into that page, writes
// the whole book, and mirrors the active page to the legacy single-scene key -- the mirror keeps the
// old boot fallback warm, so nothing a page loses can strand the current design.
let autoTimer = null, warnedNoStore = false;
function autosave() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    commitActivePage();
    const a = lsPut(LS_PAGES, book);
    const b = lsPut(LS_SCENE, activePage()?.doc);
    // Said ONCE, not every 400ms: a private-mode tab or a full quota fails every write, and
    // the pager's promise -- "a reload brings back every page" -- is quietly broken the
    // whole session. An hour of work that was never stored deserves a sentence.
    if (!(a && b) && !warnedNoStore) {
      warnedNoStore = true;
      note("this browser is not keeping your work — use export to save a file", 8000);
    }
  }, 400);
}

// ---- pages: a book of independent designs -------------------------------------------------------
// Each page is a whole layout, kept by the same intent-only serializer a file uses. The one on screen
// is the active page; switching folds the live scene back into the page you are leaving and loads the
// one you are opening. The whole book lives in localStorage, so a reload brings back every page and
// the one you were on -- not just the last thing you touched.
let book = { activeId: null, pages: [] };   // pages: [{ id, name, doc }]  (doc = a serializeLayout object)
let pageSeq = 1;
const activePage = () => book.pages.find(p => p.id === book.activeId);
/** Fold the live scene back into the active page, so the book is current before we persist or leave. */
function commitActivePage() { const p = activePage(); if (p) p.doc = serializeLayout(); }

/** Wrap whatever is on screen right now as the first (or a shared) page. Used on first run and after a
 *  shared link, where there is a live scene but no book yet. */
function adoptAsBook(name) {
  book = { activeId: 1, pages: [{ id: 1, name, doc: serializeLayout() }] };
  pageSeq = 2;
  commitActivePage(); lsPut(LS_PAGES, book); lsPut(LS_SCENE, activePage().doc);
  paintPager();
}
function switchPage(id) {
  if (id === book.activeId) return;
  const prevId = book.activeId;
  commitActivePage();                 // save what's on screen into the page we're leaving
  book.activeId = id;
  const p = activePage(); if (!p) { book.activeId = prevId; return; }
  let dropped;
  try { dropped = loadLayout(p.doc); }  // loadLayout resets undo + selection: a page opens as its own document
  catch (e) {
    // Boot guards this same call; unguarded here, a page with an unreadable doc threw with
    // activeId already pointing at it -- and the next autosave folded the OLD page's scene
    // into the bad page's slot. Point back before anything can commit.
    book.activeId = prevId;
    note(`could not open that page: ${e.message}`, 5000);
    return;
  }
  lsPut(LS_PAGES, book); lsPut(LS_SCENE, p.doc);
  paintPager();
  note(`opened "${p.name}"${droppedSuffix(dropped)}`);
}
function newPage(name) {
  commitActivePage();
  const id = pageSeq++;
  const doc = { app: "igt-planner", v: SAVE_V, nodes: [] };
  book.pages.push({ id, name: name || t("page.n", { n: book.pages.length + 1 }), doc });
  book.activeId = id;
  loadLayout(doc);                    // a fresh, empty design
  lsPut(LS_PAGES, book); lsPut(LS_SCENE, doc);
  paintPager();
}
function deletePage(id) {
  if (book.pages.length <= 1) { note("this is the only page — can't delete it"); return; }
  const idx = book.pages.findIndex(p => p.id === id);
  if (idx < 0) return;
  const wasActive = id === book.activeId;
  book.pages.splice(idx, 1);
  if (wasActive) {
    book.activeId = book.pages[Math.min(idx, book.pages.length - 1)].id;
    loadLayout(activePage().doc);
  }
  commitActivePage(); lsPut(LS_PAGES, book); lsPut(LS_SCENE, activePage().doc);
  paintPager();
}
function renamePage(id, name) {
  const p = book.pages.find(q => q.id === id);
  if (!p) return;
  p.name = name;
  lsPut(LS_PAGES, book);
  paintPager();
}
function paintPager() {
  const el = $("pager");
  if (!el) return;
  el.innerHTML = "";
  for (const p of book.pages) {
    const tab = document.createElement("button");
    tab.className = "ptab" + (p.id === book.activeId ? " on" : "");
    tab.title = "open · double-click to rename";
    const name = document.createElement("span");
    name.className = "pname"; name.textContent = p.name;
    tab.append(name);
    tab.onclick = () => switchPage(p.id);
    const rename = () => { const nn = prompt("rename this page:", p.name); if (nn && nn.trim()) renamePage(p.id, nn.trim()); };
    tab.ondblclick = rename;
    // Double-tap belongs to the browser on a phone (iOS never delivers the dblclick);
    // press-and-hold is the touch spelling of the same intent. The contextmenu gate keys on
    // the SAME touch that armed the timer -- not on COARSE -- so a finger on a laptop
    // touchscreen doesn't get the rename prompt and the browser menu from one gesture.
    tab.onpointerdown = ev => {
      if (ev.pointerType === "mouse") return;
      tab._lpArmed = true;
      tab._lp = setTimeout(rename, 500);
    };
    tab.onpointerup = tab.onpointercancel = tab.onpointerleave = () => { clearTimeout(tab._lp); tab._lpArmed = false; };
    tab.oncontextmenu = ev => { if (tab._lpArmed) ev.preventDefault(); };
    // No delete on the last page: a book always has at least one page.
    if (book.pages.length > 1) {
      const x = document.createElement("span");
      x.className = "pclose"; x.innerHTML = icon("x", 12); x.title = t("page.delete");
      x.onclick = ev => { ev.stopPropagation(); if (confirm(`Delete page "${p.name}"? This can't be undone.`)) deletePage(p.id); };
      tab.append(x);
    }
    el.append(tab);
  }
  const add = document.createElement("button");
  add.className = "padd"; add.innerHTML = icon("plus", 15); add.title = t("page.new");
  add.onclick = () => newPage();
  el.append(add);
}

// ---- named layouts ----------------------------------------------------------------------------
const savedAll = () => lsGet(LS_SAVED, {});
function saveNamed(name) {
  const all = savedAll();
  all[name] = { ...serializeLayout(), name, at: new Date().toISOString() };
  if (!lsPut(LS_SAVED, all)) return note("could not save -- browser storage is full");
  note(`saved "${name}" — in this browser only; use export to keep it`);
  paintFiles();
}
function openNamed(name) {
  const doc = savedAll()[name];
  if (!doc) return;
  // Look before we leap -- an unreadable layout must not mint an empty page on its way to
  // the throw. (A rolled-back app.js reading a newer save is the realistic path here.)
  try { readLayout(doc); }
  catch (e) { note(`could not open "${name}": ${e.message}`, 5000); return; }
  // Opening used to replace the page on screen -- no confirm, no undo (loadLayout clears the
  // stacks), autosaved over the original 400ms later. "Start over" earned a confirm for less,
  // and the pages model already holds the right answer: a non-empty page keeps itself and the
  // layout opens as a NEW page. Only an empty page is worth replacing in place. And browsing
  // the same saves twice must not grow the book twice: an existing page holding this exact
  // layout is switched to, not duplicated.
  const asPage = state.nodes.length > 0;
  if (asPage) {
    const docStr = JSON.stringify({ ...doc, name: undefined, at: undefined });
    const dup = book.pages.find(p => p.name === name
      && JSON.stringify({ ...p.doc, name: undefined, at: undefined }) === docStr);
    if (dup) { switchPage(dup.id); return; }
    newPage(name);
  }
  const dropped = loadLayout(doc);
  if (asPage) { commitActivePage(); lsPut(LS_PAGES, book); lsPut(LS_SCENE, activePage().doc); }
  note(`opened "${name}"${asPage ? " as a new page" : ""}${droppedSuffix(dropped)}`);
}
function deleteNamed(name) {
  const all = savedAll(); delete all[name]; lsPut(LS_SAVED, all); paintFiles();
}

// ---- the file: the only copy that leaves this machine -------------------------------------------
function exportFile() {
  const doc = { ...serializeLayout(), at: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  // A timestamped name, because a file called "layout.json" is a file you overwrite.
  a.href = URL.createObjectURL(blob);
  a.download = `igt-layout-${doc.at.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  note("exported — that file is the copy git can see");
}
function importFile() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      readLayout(doc);                       // look before we leap: no new page for a bad file
      const asPage = state.nodes.length > 0; // same rule as openNamed -- never cost the page on screen
      if (asPage) newPage(f.name.replace(/\.json$/i, ""));
      const dropped = loadLayout(doc);
      if (asPage) { commitActivePage(); lsPut(LS_PAGES, book); lsPut(LS_SCENE, activePage().doc); }
      note(`opened ${f.name}${asPage ? " as a new page" : ""}${droppedSuffix(dropped)}`);
    }
    catch (e) { note(`could not read that file: ${e.message}`, 5000); }
  };
  inp.click();
}

// ---- the URL: how a design reaches someone else --------------------------------------------------
// gzip then base64url. CompressionStream is native; nothing is vendored for this.
//
// MEASURED, not guessed (I first wrote "roughly a fifth" here and it is 2.5x): a realistic 8-node
// scene -- two frames joined end to end with a BBQ box and a GS-230 in them, a Jikaro with a Takibi
// in its opening wearing bridge + griddle + coal bed, and four chairs -- is 703 bytes of JSON, 280
// gzipped, and a 413-character link. The intent-only format is doing most of that work: there are no
// derived fields to compress in the first place.
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = str => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const pipe = async (bytes, stream) =>
  new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();

async function shareLink() {
  // The whole body is guarded: on iOS below 16.4 `new CompressionStream` itself throws, and
  // an unhandled rejection out of a bare async onclick is a button that silently does nothing.
  try {
    const json = new TextEncoder().encode(JSON.stringify(serializeLayout()));
    const gz = await pipe(json, new CompressionStream("gzip"));
    const url = `${location.origin}${location.pathname}#d=${b64u(gz)}`;
    // A link nobody can paste is not a share. Say the number rather than discover it later.
    if (url.length > 8000) return note(`this layout is too big for a link (${(url.length / 1000).toFixed(1)}k) — export the file instead`, 6000);
    // On a phone, the native share sheet: it IS the platform's "send a link", and its
    // activation window is far more forgiving than the clipboard's -- which is what
    // routinely dumped Safari users into the prompt() fallback. If share itself refuses
    // (double-tap = InvalidStateError, an expired activation = NotAllowedError), fall
    // THROUGH to the clipboard path rather than report a link that built fine as broken.
    if (COARSE && navigator.share) {
      try { await navigator.share({ url }); return; }
      catch (e) { if (e.name === "AbortError") return; }   // user closed the sheet: done
    }
    try { await navigator.clipboard.writeText(url); note(`link copied (${url.length} chars) — it carries the whole design, no server involved`, 5000); }
    catch { prompt("copy this link:", url); }
  } catch (e) {
    note(`this browser could not build a share link (${e.message}) — export a file instead`, 6000);
  }
}
async function fromHash() {
  // Two link forms. #d= is what the share button mints: gzipped, base64url, short. #layout= is the
  // same JSON, just URL-encoded -- longer, but writable by anyone, including an agent in a chat
  // window that cannot gzip. Both land the same way.
  const plain = /[#&]layout=([^&]+)/.exec(location.hash);
  const m = /[#&]d=([^&]+)/.exec(location.hash);
  if (!m && !plain) return false;
  try {
    const json = plain ? decodeURIComponent(plain[1])
      : new TextDecoder().decode(await pipe(unb64u(m[1]), new DecompressionStream("gzip")));
    const dropped = loadLayout(JSON.parse(json));
    note(`opened from a shared link — it is yours now; save or export to keep it${droppedSuffix(dropped)}`, 6000);
    return true;
  } catch (e) { note(`that link did not decode: ${e.message}`, 5000); return false; }
}

// ---- blocks: the reusable half -------------------------------------------------------------------
// A block is a SUBTREE -- a host and everything hooked below it -- saved by name and dropped into any
// layout. That is what "reuse" means here: not a whole scene you fork, but the cooking station you
// already worked out, arriving intact with its modules on it.
//
// Almost all of it existed already: subtreeIds() knows what hangs off a node, and duplicateNode()
// clones a subtree onto fresh ids. A block is the same operation with a FILE where the live node was.
const blocksAll = () => lsGet(LS_BLOCKS, {});
function saveBlock(name) {
  const roots = selectedIds().map(byId).filter(Boolean);
  if (!roots.length) return;
  const ids = new Set();
  for (const r of roots) for (const id of subtreeIds(r)) ids.add(id);
  const nodes = state.nodes.filter(n => ids.has(n.id));
  // A block travels: store it around its own origin, so dropping it is a translation and not a
  // memory of where it happened to be sitting the day it was saved.
  const free = nodes.filter(n => n.host == null);
  const ox = free.reduce((s, n) => s + n.x, 0) / (free.length || 1);
  const oz = free.reduce((s, n) => s + n.z, 0) / (free.length || 1);
  const doc = serializeLayout(nodes);
  for (const o of doc.nodes) if (o.x !== undefined) { o.x -= ox; o.z -= oz; }
  const all = blocksAll();
  all[name] = { ...doc, name, at: new Date().toISOString() };
  if (!lsPut(LS_BLOCKS, all)) return note("could not save -- browser storage is full");
  note(`block "${name}" saved — ${nodes.length} part(s)`);
  paint();
}
function deleteBlock(name) { const all = blocksAll(); delete all[name]; lsPut(LS_BLOCKS, all); paint(); }
/** Drop a saved block into the CURRENT layout: fresh ids, hosts re-pointed inside the block, placed
 *  clear of what is already there. Nothing existing is touched. */
function addBlock(name) {
  const doc = blocksAll()[name];
  if (!doc) return;
  const { nodes, dropped } = readLayout(doc);
  if (!nodes.length) return note(`block "${name}" has nothing left in the catalog`);
  const remap = new Map();
  for (const n of nodes) remap.set(n.id, state.nextId++);
  const at = freeSpot();
  for (const n of nodes) {
    n.id = remap.get(n.id);
    if (n.host != null) n.host = remap.get(n.host) ?? null;
    if (n.host == null) { n.x += at.x; n.z += at.z; }
    state.nodes.push(n);
  }
  state.selSet = new Set(nodes.filter(n => n.host == null).map(n => n.id));
  state.sel = [...state.selSet].pop() ?? null;
  render();
  if (dropped.length) note(`dropped ${dropped.join(", ")} — no longer in the catalog`);
}
/** Somewhere the new arrival will not land inside what is already built. */
function freeSpot() {
  if (!state.nodes.length) return { x: 0, z: 0 };
  let maxX = -Infinity, minZ = Infinity;
  for (const n of state.nodes) { const f = footprint(n); maxX = Math.max(maxX, n.x + f.w / 2); minZ = Math.min(minZ, n.z); }
  return { x: maxX + 700, z: minZ };
}

// ---------------------------------------------------------------- the layouts menu
const fileMenu = $("filemenu");
function paintFiles() {
  const all = savedAll();
  const names = Object.keys(all).sort();
  fileMenu.innerHTML = "";
  const row = (label, sub, fn, cls = "") => {
    const d = document.createElement("div");
    d.className = "frow " + cls;
    d.innerHTML = `<span>${label}</span>` + (sub ? `<span class="fsub">${sub}</span>` : "");
    d.onclick = () => { fileMenu.hidden = true; fn(); };
    fileMenu.append(d);
    return d;
  };
  const head = t => { const h = document.createElement("div"); h.className = "fhead"; h.textContent = t; fileMenu.append(h); };

  head(t("files.this"));
  row(t("files.save"), t("files.save.sub"), () => {
    const name = prompt(t("files.savename"), "");
    if (name && name.trim()) saveNamed(name.trim());
  });
  row(t("files.export"), t("files.export.sub"), exportFile);
  row(t("files.import"), "", importFile);
  row(t("files.reset"), "", () => {
    if (state.nodes.length && !confirm(t("files.resetq"))) return;
    state.nodes = []; state.nextId = 1; selectOnly(null);
    undoStack.length = 0; redoStack.length = 0; render();
  });

  head(t(names.length ? "files.saved" : "files.none"));
  for (const n of names) {
    const at = (all[n].at || "").slice(0, 10);
    const r = row(n, `${(all[n].nodes || []).length} parts · ${at}`, () => openNamed(n));
    const x = document.createElement("button");
    x.className = "fdel"; x.innerHTML = icon("x", 12); x.title = t("files.forget");
    x.onclick = e => { e.stopPropagation(); if (confirm(`forget "${n}"?`)) deleteNamed(n); };
    r.append(x);
  }
  if (names.length) {
    const w = document.createElement("div");
    w.className = "fnote";
    // Say the true thing where the word "save" is, not in a help page nobody opens.
    w.textContent = t("files.note");
    fileMenu.append(w);
  }
}
$("filebtn").onclick = e => {
  e.stopPropagation();
  if (!fileMenu.hidden) { fileMenu.hidden = true; return; }
  paintFiles();
  const r = e.currentTarget.getBoundingClientRect();
  fileMenu.style.left = `${Math.max(8, r.right - 260)}px`;
  fileMenu.style.top = `${r.bottom + 6}px`;
  fileMenu.hidden = false;
};

// ---------------------------------------------------------------- the PNG export
//
// A share LINK needs the recipient to open the planner; a PICTURE lands in the family group
// chat as itself. So the export is a plate, not a screenshot: the view you composed, an
// orthographic plan with a scale bar (the one view that says where things ARE), and the bill
// with the carry weight -- one image that answers "what is this" with no planner in sight.
//
// The heavy lifting reuses the live renderer: resize the drawing buffer, render, copy the
// pixels out, restore -- all synchronous, so the screen never paints an in-between state.
// The selection is cleared for the shot (an outline is UI, not design) and put back before
// any DOM repaints could notice; rulers stay, because a measurement is authored content.
// Options (the photo card sets them): `layout` "plate" (view + plan + bill) or "view" (the 3D view
// alone, for posting); `aspect` of a view-only shot; `scale` 1 or 2 (pixels, not layout); `to`
// "download" | "copy" | "share". deliver:false just returns the blob (the smoke test uses that).
const VIEW_SIZES = { "4:3": [1600, 1200], "1:1": [1400, 1400], "3:4": [1200, 1600], "4:5": [1280, 1600], "16:9": [1920, 1080] };
async function exportPng({ deliver = true, layout = "plate", aspect = "4:3", scale = 1, to = "download" } = {}) {
  try {
    if (!state.nodes.length) { note("nothing to photograph — the page is empty"); return null; }
    const css = getComputedStyle(document.documentElement);
    const v = (name, d) => css.getPropertyValue(name).trim() || d;
    const MONO = v("--mono", "monospace"), SANS = v("--sans", "sans-serif");
    const INK = v("--ink", "#e6e8ec"), LINE = v("--line", "#2b3038");

    // Two extents, two jobs. The PLAN frames everything, footprints included -- it must show
    // the tarp. The "layout" NUMBER counts only the furniture, because that is what the word
    // means everywhere else in the app (the dims HUD) -- under a 5.7m tarp, "layout 5.70 m"
    // would be the tarp talking over the table.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    let fx0 = Infinity, fx1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;
    for (const n of state.nodes) {
      const a = aabb(n);
      x0 = Math.min(x0, a.x0); x1 = Math.max(x1, a.x1);
      z0 = Math.min(z0, a.z0); z1 = Math.max(z1, a.z1);
      if (n.kind === "footprint") continue;
      fx0 = Math.min(fx0, a.x0); fx1 = Math.max(fx1, a.x1);
      fz0 = Math.min(fz0, a.z0); fz1 = Math.max(fz1, a.z1);
    }

    // ---- capture, at export resolution, selection hidden
    const keepSel = state.sel, keepSet = state.selSet;
    state.sel = null; state.selSet = new Set();
    rebuild();

    const viewOnly = layout === "view";
    const [heroW, heroH] = viewOnly ? (VIEW_SIZES[aspect] || VIEW_SIZES["4:3"]) : [1560, 1170];
    const planW = 640;
    const grab = (cam, w, h) => {
      renderer.setSize(w, h, false);
      if (cam.isPerspectiveCamera) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
      renderer.render(scene, cam);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(renderer.domElement, 0, 0, w, h);
      return c;
    };
    const hero = grab(camera, heroW * scale, heroH * scale);
    if (viewOnly) {
      state.sel = keepSel; state.selSet = keepSet;
      rebuild(); resize();
      return await deliverPng(hero, { deliver, to });
    }

    // The plan: straight down, orthographic, contain-fit with symmetric padding. Fog off --
    // it is distance-based, and from 14m up it would grey the whole floor.
    const pad = 350;
    const spanX = (x1 - x0) + 2 * pad, spanZ = (z1 - z0) + 2 * pad;
    const planH = Math.max(320, Math.min(640, Math.round(planW * spanZ / spanX)));
    const mmPerPx = Math.max(spanX / planW, spanZ / planH);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ortho = new THREE.OrthographicCamera(
      -planW * mmPerPx / 2 * MM, planW * mmPerPx / 2 * MM,
      planH * mmPerPx / 2 * MM, -planH * mmPerPx / 2 * MM, 0.01, 60);
    ortho.position.set(cx * MM, 14, cz * MM);
    ortho.up.set(0, 0, -1);
    ortho.lookAt(cx * MM, 0, cz * MM);
    const fog = scene.fog;
    scene.fog = null;
    const plan = grab(ortho, planW * scale, planH * scale);
    scene.fog = fog;

    state.sel = keepSel; state.selSet = keepSet;
    rebuild();
    resize();   // puts the drawing buffer and the camera's aspect back to the stage's

    // ---- the bill, grouped the way paintBOM groups it
    const rows = new Map();
    let grams = 0;
    for (const l of bomLines()) {
      const p = PARTS[l.sku];
      if (!p) continue;
      grams += p.weight_g || 0;
      const r = rows.get(l.sku) || { p, n: 0 };
      r.n++;
      rows.set(l.sku, r);
    }
    const bill = [...rows.values()];

    // ---- compose the plate
    const M = 48, GAP = 36, HEAD = 108;
    const W = M + heroW + GAP + planW + M;
    const H = M + HEAD + heroH + 96;
    const out = document.createElement("canvas");
    out.width = W * scale; out.height = H * scale;
    const ctx = out.getContext("2d");
    ctx.scale(scale, scale);    // lay out in 1x units; every pixel is drawn at `scale`
    ctx.fillStyle = v("--bg", "#14161a");
    ctx.fillRect(0, 0, W, H);
    const faint = (a, fn) => { ctx.globalAlpha = a; fn(); ctx.globalAlpha = 1; };
    const frame = (x, y, w, h) => { ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2); };

    // header: the page's name, and the date it was true
    ctx.fillStyle = INK;
    ctx.font = `600 44px ${SANS}`;
    ctx.fillText(activePage()?.name || "IGT layout", M, M + 46);
    ctx.font = `26px ${SANS}`;
    faint(.55, () => {
      const date = new Date().toISOString().slice(0, 10);
      ctx.fillText(date, W - M - ctx.measureText(date).width, M + 44);
      ctx.fillText("Siqi's IGT Planner · igt.iqis.app", M, M + 84);
    });

    const top = M + HEAD;
    ctx.drawImage(hero, M, top, heroW, heroH);
    frame(M, top, heroW, heroH);
    ctx.font = `28px ${MONO}`;
    if (fx1 > fx0) faint(.7, () => ctx.fillText(
      `layout ${((fx1 - fx0) / 1000).toFixed(2)} × ${((fz1 - fz0) / 1000).toFixed(2)} m`, M, top + heroH + 52));

    const rx = M + heroW + GAP;
    ctx.drawImage(plan, rx, top, planW, planH);
    frame(rx, top, planW, planH);
    // scale bar: a metre (or half of one, if the plan is tight) in the plan's own scale
    const barMm = 1000 / mmPerPx > planW * .6 ? 500 : 1000;
    const barPx = barMm / mmPerPx;
    const by = top + planH + 34;
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    faint(.7, () => {
      ctx.beginPath();
      ctx.moveTo(rx, by - 6); ctx.lineTo(rx, by);
      ctx.lineTo(rx + barPx, by); ctx.lineTo(rx + barPx, by - 6);
      ctx.stroke();
      ctx.font = `24px ${MONO}`;
      ctx.fillText(barMm === 1000 ? "1 m" : "0.5 m", rx + barPx + 14, by + 2);
    });

    // the bill: what you'd carry to make the picture true
    let ly = by + 64;
    ctx.font = `600 26px ${SANS}`;
    faint(.55, () => ctx.fillText("Build", rx, ly));
    ly += 40;
    ctx.font = `26px ${SANS}`;
    const fit = s => {
      while (ctx.measureText(s).width > planW && s.length > 4) s = s.slice(0, -2);
      return ctx.measureText(s).width > planW - 4 ? s.slice(0, -1) + "…" : s;
    };
    const maxRows = Math.floor((H - M - 40 - ly) / 36);
    for (const { p, n } of bill.slice(0, bill.length > maxRows ? maxRows - 1 : maxRows)) {
      ctx.fillText(fit(`${n > 1 ? "×" + n + " " : ""}${nameOf(p)}`), rx, ly);
      ly += 36;
    }
    if (bill.length > maxRows) {
      faint(.55, () => ctx.fillText(`+ ${bill.length - (maxRows - 1)} more`, rx, ly));
      ly += 36;
    }
    ly += 10;
    const kg = grams / 1000;
    ctx.font = `600 28px ${SANS}`;
    ctx.fillText(`you carry ${kg.toFixed(1)} kg · ${(kg * 2.20462).toFixed(1)} lb`, rx, ly);
    return await deliverPng(out, { deliver, to });
  } catch (e) { note(`photo failed — ${e.message}`, 5000); return null; }
}

/** Hand a finished canvas over: as a blob (deliver:false), a download, the clipboard, or the share
 *  sheet. "share" falls back to a download where the browser cannot share files. */
async function deliverPng(canvas, { deliver = true, to = "download" } = {}) {
  try {

    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    if (!deliver) return blob;
    const fname = `igt-${(activePage()?.name || "layout").replace(/[^\w-]+/g, "_")}-`
      + `${new Date().toISOString().slice(0, 10)}.png`;
    const file = new File([blob], fname, { type: "image/png" });
    if (to === "copy") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      note("picture copied — paste it anywhere");
      return blob;
    }
    if (to === "share" && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return blob; }
      catch (e) { if (e.name === "AbortError") return blob; }   // cancelled IS an answer
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note(`saved ${fname}`);
    return blob;
  } catch (e) { note(`photo failed — ${e.message}`, 5000); return null; }
}
addEventListener("pointerdown", e => { if (!fileMenu.hidden && !fileMenu.contains(e.target)) fileMenu.hidden = true; }, true);

// ---------------------------------------------------------------- the header cards: AI, photo, share
//
// Each of these used to be one blind action -- a link out, a file dropped, a link copied. They open a
// card now, at the button, with the choices that action actually has: which AI, which picture, which
// place to send it. One popover, rebuilt per card; a click outside or Esc closes it.
const card = $("popcard");
let cardOwner = null;
function openCard(btn, build) {
  if (cardOwner === btn && !card.hidden) { closeCard(); return; }
  fileMenu.hidden = true;
  card.innerHTML = "";
  card.className = "";
  build(card);
  card.hidden = false;
  const r = btn.getBoundingClientRect(), w = card.offsetWidth;
  card.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  card.style.top = `${r.bottom + 6}px`;
  cardOwner = btn;
}
function closeCard() { card.hidden = true; cardOwner = null; }
addEventListener("pointerdown", e => {
  if (!card.hidden && !card.contains(e.target) && !cardOwner?.contains(e.target)) closeCard();
}, true);
addEventListener("keydown", e => { if (e.key === "Escape" && !card.hidden) closeCard(); });

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const cardHead = (title, sub) => el("div", "chead", `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}`);
function cardBtn(html, onClick, cls = "") {
  const b = el("button", `cbtn ${cls}`, html);
  b.onclick = onClick;
  return b;
}
/** A segmented choice: [label, value] pairs; remembers its pick per browser under `key`. */
function segmented(key, options, fallback, onChange) {
  let cur = fallback;
  try { cur = localStorage.getItem(key) || fallback; } catch {}
  if (!options.some(([, v]) => v === cur)) cur = fallback;
  const box = el("div", "seg");
  for (const [label, value] of options) {
    const b = el("button", value === cur ? "on" : "", label);
    b.onclick = () => {
      cur = value;
      try { localStorage.setItem(key, value); } catch {}
      for (const x of box.children) x.classList.toggle("on", x === b);
      onChange?.(value);
    };
    box.append(b);
  }
  box.value = () => cur;
  return box;
}
const PUBLIC_SITE = "https://igt.iqis.app";

// ---- share ----------------------------------------------------------------------------------------
/** The page as a link: gzipped JSON in the hash. Null where the browser cannot compress. */
async function makeShareUrl() {
  try {
    const json = new TextEncoder().encode(JSON.stringify(serializeLayout()));
    const gz = await pipe(json, new CompressionStream("gzip"));
    return `${location.origin}${location.pathname}#d=${b64u(gz)}`;
  } catch { return null; }
}
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); note(`${what} copied`); return true; }
  catch { prompt(`copy this ${what}:`, text); return false; }
}
// Where a link can go. `max` = the service's limit on text + link, where it has one that bites.
const SOCIAL = [
  ["x", "X", (u, t) => `https://x.com/intent/post?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}`],
  ["facebook", "Facebook", u => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`],
  ["reddit", "Reddit", (u, t) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(t)}`],
  ["whatsapp", "WhatsApp", (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}`],
  ["line", "LINE", u => `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(u)}`],
  ["telegram", "Telegram", (u, t) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(t)}`],
];
async function openShareCard(btn) {
  const url = await makeShareUrl();
  openCard(btn, c => {
    c.append(cardHead(t("share.title"), t("share.sub")));
    if (!url) { c.append(el("p", "cnote", t("share.nolink"))); return; }
    if (url.length > 8000) c.append(el("p", "cnote warn", t("share.long", { k: (url.length / 1000).toFixed(1) })));
    const row = el("div", "crow");
    const field = el("input", "cfield"); field.readOnly = true; field.value = url;
    field.onfocus = () => field.select();
    row.append(field, cardBtn(`${icon("copy")}<span>${t("common.copy")}</span>`, () => copyText(url, t("share.link")), "primary"));
    c.append(row);
    const title = t("share.post", { name: activePage()?.name || t("share.adesign") });
    const grid = el("div", "cgrid");
    for (const [key, label, make, max] of SOCIAL) {
      const href = make(url, title);
      const tooLong = max && (title.length + 1 + url.length) > max;
      const a = el("a", `csocial${tooLong ? " dead" : ""}`, `${brand(key, 18)}<span>${label}</span>`);
      if (tooLong) a.title = t("share.toolong", { label, max, n: url.length });
      else { a.href = href; a.target = "_blank"; a.rel = "noopener"; }
      grid.append(a);
    }
    // WeChat has no web share: the link becomes a QR code -- scan it with WeChat, open it on the phone,
    // forward it from there. RedNote (Xiaohongshu) posts are pictures and links in them do not click: so the
    // caption (with the link) goes on the clipboard and the photo card opens set to its 3:4.
    const qrBox = el("div", "cqr");
    qrBox.hidden = true;
    const wechat = cardBtn(`${brand("wechat", 18)}<span>WeChat</span>`, () => {
      if (!qrBox.hidden) { qrBox.hidden = true; return; }
      const qr = qrcode(0, "L");
      qr.addData(url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true })
        + `<p>${t("share.wechat")}</p>`
        + (url.length > 1200 ? `<p class="warn">${t("share.qrdense")}</p>` : "");
      qrBox.hidden = false;
    }, "csocial");
    const xhs = cardBtn(`${brand("xiaohongshu", 18)}<span>RedNote</span>`, async () => {
      await copyText(`${title}
${url}`, t("share.caption"));
      try { localStorage.setItem("igt.photo.layout", "view"); localStorage.setItem("igt.photo.aspect", "3:4"); } catch {}
      openPhotoCard($("pngbtn"));
      note(t("share.rednote"), 6000);
    }, "csocial");
    grid.append(wechat, xhs);
    const mail = el("a", "csocial", `${icon("mail", 18)}<span>${t("share.email")}</span>`);
    mail.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;
    grid.append(mail);
    if (navigator.share) grid.append(cardBtn(`${icon("share", 18)}<span>${t("share.more")}</span>`,
      () => navigator.share({ title, url }).catch(() => {}), "csocial"));
    c.append(grid, qrBox);
    const foot = el("div", "cfoot");
    foot.append(cardBtn(`${icon("camera")}<span>${t("share.picture")}</span>`, () => openPhotoCard($("pngbtn")), "link"));
    c.append(foot);
  });
}

// ---- photo ----------------------------------------------------------------------------------------
function openPhotoCard(btn) {
  openCard(btn, c => {
    c.append(cardHead(t("photo.title"), t("photo.sub")));
    const shape = el("div", "cfield-row");
    const layoutSeg = segmented("igt.photo.layout", [[t("photo.plate"), "plate"], [t("photo.view"), "view"]], "plate",
      v => { shape.hidden = v !== "view"; hint.textContent = HINTS[v]; });
    const HINTS = {
      plate: t("photo.plate.hint"),
      view: t("photo.view.hint"),
    };
    const aspectSeg = segmented("igt.photo.aspect", [["4:3", "4:3"], ["1:1", "1:1"], ["3:4", "3:4"], ["4:5", "4:5"], ["16:9", "16:9"]], "4:3");
    const scaleSeg = segmented("igt.photo.scale", [[t("photo.std"), "1"], [t("photo.x2"), "2"]], "1");
    const field = (label, ctl) => { const r = el("div", "cfield-row"); r.append(el("label", "", label), ctl); return r; };
    c.append(field(t("photo.layout"), layoutSeg));
    shape.append(el("label", "", t("photo.shape")), aspectSeg);
    shape.hidden = layoutSeg.value() !== "view";
    c.append(shape, field(t("photo.size"), scaleSeg));
    const hint = el("p", "cnote", HINTS[layoutSeg.value()]);
    c.append(hint);
    const go = to => { closeCard(); exportPng({ layout: layoutSeg.value(), aspect: aspectSeg.value(), scale: +scaleSeg.value(), to }); };
    const acts = el("div", "crow end");
    if (navigator.canShare && COARSE) acts.append(cardBtn(`${icon("share")}<span>${t("photo.share")}</span>`, () => go("share")));
    if (window.ClipboardItem && navigator.clipboard?.write) acts.append(cardBtn(`${icon("clipboard")}<span>${t("common.copy")}</span>`, () => go("copy")));
    acts.append(cardBtn(`${icon("download")}<span>${t("photo.download")}</span>`, () => go("download"), "primary"));
    c.append(acts);
  });
}

// ---- use with AI ----------------------------------------------------------------------------------
// The planner runs no model. These buttons open the person's OWN assistant with the prompt filled in
// -- and, if they like, this page's design inside it -- and the box below takes back what it writes.
function aiPrompt(withDesign) {
  const doc = JSON.stringify(serializeLayout());
  const lines = [
    "I'm planning a Snow Peak IGT (Iron Grill Table) camp-kitchen setup with Siqi's IGT Planner.",
    `First read ${PUBLIC_SITE}/llms.txt — it explains the layout format and the rules — and use the parts catalog at ${PUBLIC_SITE}/catalog/igt-catalog.json.`,
  ];
  if (withDesign) lines.push("", "Here is my current design (planner layout JSON):", "```json", doc, "```");
  lines.push("", "Ask me what I want to build or change. Then write the layout JSON and give me a link:",
    `${PUBLIC_SITE}/web/#layout= followed by the URL-encoded JSON.`);
  return lines.join("\n");
}
/** Read whatever an assistant handed back: layout JSON (bare or fenced), a #layout= link, or a #d= link. */
async function parseAiReply(text) {
  const t = text.trim();
  let m = /#(?:.*&)?layout=([^&\s]+)/.exec(t);
  if (m) return JSON.parse(decodeURIComponent(m[1]));
  m = /#(?:.*&)?d=([A-Za-z0-9_-]+)/.exec(t);
  if (m) return JSON.parse(new TextDecoder().decode(await pipe(unb64u(m[1]), new DecompressionStream("gzip"))));
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const body = fenced ? fenced[1] : t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  return JSON.parse(body);
}
/** Open a layout document as a NEW page (never costing the one on screen), and say what happened. */
function openDocAsPage(doc, name) {
  readLayout(doc);                         // throws on a document the planner would refuse
  const asPage = state.nodes.length > 0;
  if (asPage) newPage(name);
  const dropped = loadLayout(doc);
  if (asPage) { commitActivePage(); lsPut(LS_PAGES, book); lsPut(LS_SCENE, activePage().doc); }
  note(`opened ${name}${asPage ? " as a new page" : ""}${droppedSuffix(dropped)}`);
}
function openAiCard(btn) {
  openCard(btn, c => {
    c.append(cardHead("Design with your own AI",
      "describe the setup; your assistant writes the layout and the planner's rules check it. Nothing is sent from here."));
    const inc = el("label", "ccheck");
    const box = el("input"); box.type = "checkbox"; box.checked = state.nodes.length > 0;
    inc.append(box, document.createTextNode(" include this page's design, so it can build on it"));
    c.append(inc);
    const LIMIT = 7000;   // a prefilled-chat URL much longer than this gets cut by some browsers
    const prompt = () => {
      let p = aiPrompt(box.checked);
      if (p.length > LIMIT) { p = aiPrompt(false); note("this design is too big to fit in a link — copy the prompt instead"); }
      return p;
    };
    const open = url => window.open(url, "_blank", "noopener");
    const acts = el("div", "crow");
    acts.append(
      cardBtn(`${brand("claude")}<span>Open in Claude</span>`, () => open(`https://claude.ai/new?q=${encodeURIComponent(prompt())}`)),
      cardBtn(`${icon("chat")}<span>Open in ChatGPT</span>`, () => open(`https://chatgpt.com/?q=${encodeURIComponent(prompt())}`)),
    );
    c.append(acts);
    c.append(cardBtn(`${icon("copy")}<span>Copy the prompt — for any other assistant</span>`,
      () => copyText(aiPrompt(box.checked), "prompt"), "link"));

    c.append(el("div", "csep"));
    c.append(cardHead("Got a layout back?", "paste the JSON or the link your assistant gave you"));
    const area = el("textarea", "carea");
    area.placeholder = '{ "app": "igt-planner", ... }   or   https://igt.iqis.app/web/#layout=…';
    c.append(area);
    const row = el("div", "crow end");
    row.append(cardBtn(`${icon("plus")}<span>Open as a new page</span>`, async () => {
      try { openDocAsPage(await parseAiReply(area.value), "From AI"); closeCard(); }
      catch (e) { note(`that did not read as a layout — ${e.message}`, 5000); }
    }, "primary"));
    c.append(row);

    const links = el("div", "cfoot");
    links.innerHTML = `<a href="${PUBLIC_SITE}/web/ai" target="_blank" rel="noopener">How it works</a>`
      + `<a href="${PUBLIC_SITE}/llms.txt" target="_blank" rel="noopener">llms.txt</a>`
      + `<a href="https://github.com/iqis/igt-planner/blob/main/docs/AI.md#option-b--an-agent-that-can-run-commands" target="_blank" rel="noopener">Run it in a terminal</a>`;
    c.append(links);
  });
}

// ---- phone: the panels as sheets -----------------------------------------------------------------
// Under 760px the view takes the screen and the parts library / build panel slide up from a dock. One
// open at a time; the dock button, the sheet's handle, or a tap on the view closes it -- and adding a
// part closes the library, so you see what you just added.
// "Compact" = a phone either way up: narrow, OR a short landscape screen under a finger. LAND marks
// the landscape case. Both become body classes so the stylesheet has one set of compact rules.
const PHONE = matchMedia("(max-width: 760px), (max-height: 520px) and (orientation: landscape) and (pointer: coarse)");
const LAND = matchMedia("(orientation: landscape)");
function syncCompact() {
  document.body.classList.toggle("compact", PHONE.matches);
  document.body.classList.toggle("land", PHONE.matches && LAND.matches);
}
syncCompact();
LAND.addEventListener("change", syncCompact);
function setSheet(which) {
  document.body.classList.toggle("sheet-parts", which === "parts");
  document.body.classList.toggle("sheet-build", which === "build");
  for (const b of document.querySelectorAll("#dock button")) b.classList.toggle("on", b.dataset.sheet === which);
}
const openSheet = () => document.body.classList.contains("sheet-parts") ? "parts"
  : document.body.classList.contains("sheet-build") ? "build" : null;
for (const b of document.querySelectorAll("#dock button"))
  b.onclick = () => setSheet(openSheet() === b.dataset.sheet ? null : b.dataset.sheet);
for (const h of document.querySelectorAll(".sheet-handle")) h.onclick = () => setSheet(null);
$("stage").addEventListener("pointerdown", () => { if (PHONE.matches && openSheet()) setSheet(null); }, true);
PHONE.addEventListener("change", () => { syncCompact(); setSheet(null); });
$("dockparts").innerHTML = `${icon("block", 18)}<span>${t("dock.parts")}</span>`;
$("dockbuild").innerHTML = `${icon("clipboard", 18)}<span>${t("dock.build")}</span><i class="badge" hidden></i>`;

// Language: a short list, the current one ticked. Choosing reloads into it (see setLang).
$("langbtn").onclick = e => {
  e.stopPropagation();
  openCard(e.currentTarget, c => {
    c.classList.add("narrow");
    c.append(el("div", "chead", `<b>${t("lang.title")}</b>`));
    for (const [code, label] of LANGS) {
      const b = cardBtn(`<span>${label}</span>${code === getLang() ? icon("check") : ""}`, () => setLang(code), "langrow");
      if (code === getLang()) b.classList.add("on");
      c.append(b);
    }
  });
};

// About. A click on the backdrop (the dialog element itself, outside its box) closes it too.
const infoModal = $("infomodal");
$("infobtn").onclick = () => { closeCard(); infoModal.showModal(); };
infoModal.addEventListener("click", e => { if (e.target === infoModal) infoModal.close(); });
$("infomodal").querySelector(".iclose").innerHTML = icon("x");
$("sharebtn").onclick = e => { e.stopPropagation(); openShareCard(e.currentTarget); };
$("pngbtn").onclick = e => { e.stopPropagation(); openPhotoCard(e.currentTarget); };
// The AI link stays a real link (middle-click, open in new tab still go to the guide); a plain click
// opens the card instead.
document.querySelector(".hlink.ai").addEventListener("click", e => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault(); e.stopPropagation(); openAiCard(e.currentTarget);
});


// ---------------------------------------------------------------- the blocks shelf
function paintBlocks() {
  const host = $("blocks");
  if (!host) return;
  const all = blocksAll();
  const names = Object.keys(all).sort();
  host.innerHTML = "";
  if (!names.length) {
    const d = document.createElement("div");
    d.className = "hint pad";
    d.textContent = "Select a table you have set up and press ⧉ block on its toolbar. It comes back here with its modules on it.";
    host.append(d);
    return;
  }
  for (const n of names) {
    const b = document.createElement("div");
    b.className = "part";
    b.dataset.search = n.toLowerCase();
    b.innerHTML = `<span class="sw" style="background:var(--accent)"></span><span>${n}</span>`
                + `<span class="hint">${(all[n].nodes || []).length}</span>`;
    b.onclick = () => addBlock(n);
    const x = document.createElement("button");
    x.className = "fdel"; x.innerHTML = icon("x", 12); x.title = "forget this block";
    x.onclick = e => { e.stopPropagation(); if (confirm(`forget block "${n}"?`)) deleteBlock(n); };
    b.append(x);
    host.append(b);
  }
}

// ---------------------------------------------------------------- undo / redo
// Snapshots of the layout (nodes only -- selection is transient, not worth an undo step). Every
// committed render pushes one; a drag pushes only its final state (see pointerup). Ctrl/Cmd-Z
// steps back, Shift-Ctrl-Z (or Ctrl-Y) redoes.
const undoStack = [], redoStack = [];
let restoring = false;
const snapshot = () => JSON.stringify({ nodes: state.nodes, nextId: state.nextId, rulers: state.rulers, scene: state.scene });
function commitHistory() {
  if (restoring) return;
  const s = snapshot();
  if (undoStack[undoStack.length - 1] === s) return;   // nothing structural changed
  undoStack.push(s);
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
  paintUndo();
  autosave();      // same definition of "something changed" the undo stack uses
}
function restoreHistory(json) {
  const s = JSON.parse(json);
  state.nodes = s.nodes; state.nextId = s.nextId; state.rulers = s.rulers || [];
  if ((s.scene || "grid") !== state.scene) setGround(s.scene || "grid", { record: false });
  for (const id of [...state.selSet]) if (!byId(id)) state.selSet.delete(id);   // drop vanished ids
  if (!byId(state.sel)) state.sel = [...state.selSet].pop() ?? null;
  restoring = true; render(); restoring = false;   // render without pushing a fresh snapshot
  paintUndo();
}
function undo() {
  if (undoStack.length < 2) return;                // [last] is the current state
  redoStack.push(undoStack.pop());
  restoreHistory(undoStack[undoStack.length - 1]);
}
function redo() {
  const j = redoStack.pop(); if (!j) return;
  undoStack.push(j); restoreHistory(j);
}
function paintUndo() {
  const u = $("undo"), r = $("redo");
  if (u) u.disabled = undoStack.length < 2;
  if (r) r.disabled = redoStack.length === 0;
}
addEventListener("keydown", e => {
  const k = (e.key || "").toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
  // Ctrl+F (and "/") is the part search, as in any library panel; Esc in the box clears it.
  if (((e.ctrlKey || e.metaKey) && k === "f") || (k === "/" && !/^(input|textarea|select)$/i.test(e.target?.tagName || ""))) {
    e.preventDefault();
    const box = $("palsearch");
    if ($("palette").classList.contains("collapsed")) document.querySelector('.panel-toggle[data-panel="left"]')?.click();
    box.focus(); box.select();
    return;
  }
  if (k === "escape" && e.target?.id === "palsearch" && e.target.value) {
    e.target.value = ""; filterPalette(); return;
  }
  // Single-key actions on the selection -- but never while typing in the search box.
  if (/^(input|textarea|select)$/i.test(e.target?.tagName || "")) return;
  const n = sel();
  if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); if (state.selSet.size > 1) duplicateSelected(); else if (n) duplicateNode(n); return; }
  if (k === "delete" || k === "backspace") { e.preventDefault(); if (n) removeNode(n); return; }
  if (k === "r" && !e.ctrlKey && !e.metaKey) { if (n && !n.host) rotateNode(n); return; }
  if (k === "f") { n ? focusSelection(n) : fitAll(); return; }   // frame the selection, or fit all
  if (k === "b") { setBand(!bandTool); return; }                 // the rubber-band tool, on / off
  if (k === "m") { setRuler(!rulerTool); return; }               // the measure tool, on / off
  if (k === "escape") { if (rulerDraft) { clearRulerDraft(); return; } if (rulerTool) { setRuler(false); return; } }
  if (k === "1") { setView("top"); return; }
  if (k === "2") { setView("front"); return; }
  if (k === "3") { setView("side"); return; }
  if (k === "0") { setView("iso"); return; }
});
$("undo").onclick = undo;
$("redo").onclick = redo;

function render() {
  resolve(); rebuild(); paint();
  if (!(dragNode || dragMod || dragSlide)) commitHistory();   // a drag commits once, on pointerup
}
// The DRAG-FRAME render: scene plus the readouts that track the hand -- occupancy, the
// dimensions HUD, and the selected part's own X/Z. The heavy remainder of paint() (palette,
// BOM, outliner: hundreds of DOM nodes torn down and rebuilt) deliberately waits for
// pointerup -- at 60-120 pointermoves a second it was most of the frame, and mid-drag it
// only changes on a detach, which resolves the moment the hand stops anyway.
function renderDragging() { resolve(); rebuild(); paintSlots(); paintDimHud(); paintTransform(); }

// ---------------------------------------------------------------- theme
// Light / dark, persisted. The panels are pure CSS variables; the 3D canvas follows by
// reading the resolved --scene and --line off :root, so one palette drives both.
const THEME_KEY = "igt-theme";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const css = getComputedStyle(document.documentElement);
  const val = (v, d) => css.getPropertyValue(v).trim() || d;
  // Phone browser chrome follows the panels, not the colour the page happened to load with.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", val("--bg", "#14161a"));
  scene.background = new THREE.Color(val("--scene", "#14161a"));
  // Fog in the background's own colour: the ground plane DISSOLVES into the distance
  // instead of ending at a razor edge -- the cheapest possible horizon.
  scene.fog = new THREE.Fog(scene.background, 9, 24);
  // Daylight for the light theme: brighter, whiter ambient, softer shadow -- parts lit for
  // a dark room read muddy against a bright page.
  hemi.intensity = t === "light" ? 1.75 : 1.5;
  hemi.color.set(t === "light" ? 0xf2f5f9 : 0xdfe6f0);
  key.color.set(0xffffff); key.intensity = 1.4; renderer.toneMappingExposure = 0.95;   // the studio sun
  shadowCatcher.material.opacity = t === "light" ? 0.2 : 0.32;
  // Grid lines: faint on either ground. Baked into the geometry, so rebuild on change.
  if (t === "light") setGrid(0xc2c7cf, 0xd8dbe1);
  else setGrid(0x2b3038, 0x21252b);
  $("theme").innerHTML = icon(t === "light" ? "sun" : "moon");
  applyPlaceLight(currentGround);                     // a place outranks the studio light
  invalidate();
}
function initTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || "light");   // light first: the cleaner face; dark stays one click away
  $("theme").onclick = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };
}

function initGround() {
  const sel = $("groundsel");
  if (!sel) return;
  sel.innerHTML = "";
  for (const [label, set] of [[t("scene.g.ground"), GROUNDS], [t("scene.g.places"), PLACES]]) {
    const grp = document.createElement("optgroup");
    grp.label = label;
    for (const [key, g] of Object.entries(set)) {
      const o = document.createElement("option");
      o.value = key; o.textContent = t(`scene.${key}`);
      grp.append(o);
    }
    sel.append(grp);
  }
  sel.onchange = () => setGround(sel.value);
  // Textures are generated lazily on first pick, so an empty canvas costs nothing until it is used.
  setGround(state.scene || "grid", { record: false });   // the page that loads next sets the real one
}

// ---------------------------------------------------------------- boot

function resize() {
  const r = $("stage").getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  invalidate();
}
// Observe the STAGE, not the window: the stage changes size for reasons the window never
// hears about -- the pager filling in at boot, a side panel collapsing -- and a canvas
// sized from a stale measurement is how the bottom of the app ended up clipped.
new ResizeObserver(resize).observe($("stage"));
addEventListener("resize", resize);

(function loop() {
  requestAnimationFrame(loop);
  const tweening = !!camTween;                   // read BEFORE stepping: the last step nulls it
  stepCamTween();
  const moved = controls.update();               // true while orbiting or while damping settles
  if (!(needsRender || tweening || moved)) return;
  needsRender = false;
  renderStats.frames++;
  followHover();
  followSelTools();
  followRulers();
  renderer.render(scene, camera);
})();

// Four files, in parallel, failing LOUDLY. These were four bare serial awaits: a 404 or a
// half-written catalog rebuild rejected the module's top-level await AFTER the chrome was
// wired -- full header, empty palette, dead canvas, and nothing telling anyone why. A guest
// cannot debug that; a sentence can send them back on their way.
const fetchJson = async path => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};
let catFiles;
try {
  catFiles = await Promise.all([
    fetchJson("../catalog/igt-catalog.json"),
    fetchJson("../catalog/colors.json"),
    fetchJson("../catalog/textures.json"),
    fetchJson("../catalog/frame_fittings.json"),
  ]);
} catch (e) {
  const el = $("note");
  el.textContent = "the parts catalog did not load — reload the page; if it keeps happening the server is down";
  el.hidden = false;                       // no timer: this note has nowhere to go
  throw e;
}
loadCatalog({ catalog: catFiles[0], colors: catFiles[1], textures: catFiles[2], fittings: catFiles[3] });

// A way in from the console. Being able to put the camera straight overhead is how you
// check a silhouette; orbiting by hand and squinting is how you convince yourself.
window.__igt = { THREE, scene, camera, controls, state, PARTS, TEXTURES, render,
  openEdges, hookNormal, bracketNormal, turnOf, hostEdge, aabb, legalOn, portsAt, CONN,
  findDropTarget, hookNode, detachNode, insertAt, edgeKeysOf, selectedIds,
  serializeLayout, readLayout, loadLayout, saveNamed, openNamed, savedAll, blocksAll,
  saveBlock, addBlock, shareLink, exportFile,
  newPage, switchPage, deletePage, renamePage, pages: () => book,
  renderStats, invalidate, exportPng,
  top() { camera.position.set(0.001, 3.6, 0.001); controls.target.set(0.6, 0.8, 0); invalidate(); } };

// Fixed text into the interface's language first (index.html carries data-i18n keys), then icons.
applyStatic();
// Not on the public site yet (owner, 2026-10-01: the tents and tarps want more polish). A shared design
// that already has one still draws it; the library just does not offer them.
if (PUBLIC) $("shelters")?.closest(".cat")?.remove();

// The fixed buttons' icons. index.html keeps plain words in them, so a page that never ran this
// still says what each one is.
for (const [id, html] of [
  ["filebtn", `${icon("folder")}<span>${t("hdr.layouts")}</span>`], ["sharebtn", `${icon("share")}<span>${t("hdr.share")}</span>`],
  ["pngbtn", `${icon("camera")}<span>${t("hdr.photo")}</span>`], ["langbtn", icon("lang")],
  ["undo", icon("undo")], ["redo", icon("redo")], ["edgebtn", icon("plus", 15)],
  ["infobtn", icon("info")],
  ["bandtool", `${icon("select")}<span>${t("view.band")}</span>`], ["rulertool", `${icon("ruler")}<span>${t("view.ruler")}</span>`],
]) { const el = $(id); if (el) el.innerHTML = html; }
{ const fit = document.querySelector('#viewnav [data-view="fit"]'); if (fit) fit.innerHTML = `${icon("fit")}<span>${t("view.fit")}</span>`; }
{ const sc = document.querySelector("#scenechip .scico"); if (sc) sc.innerHTML = icon("scene"); }

resize();
initTheme();
initGround();
paintFiles();

// WHAT YOU SEE WHEN YOU ARRIVE, most specific first:
//   a shared link   -- someone sent you a design; it lands as a NEW PAGE in your book
//   your book       -- every page you had, and the one you were on; a reload loses nothing
//   a legacy scene  -- the single scene from before pages existed, migrated into page 1
//   a 4-unit frame  -- a blank page is not a starting point
(async () => {
  const savedBook = lsGet(LS_PAGES, null);
  const hasBook = !!savedBook?.pages?.length;

  // The scene used to be ONE browser-wide choice (igt.ground). It belongs to each page now, so whatever
  // was set is carried onto every saved page that has none -- once -- and nobody's meadow vanishes in
  // the upgrade. The old key goes after.
  let legacyGround = null;
  try { legacyGround = localStorage.getItem(LS_GROUND); } catch {}
  if (legacyGround) {
    if (legacyGround !== "grid" && hasBook) {
      for (const pg of savedBook.pages) if (pg.doc && !pg.doc.scene) pg.doc.scene = legacyGround;
      lsPut(LS_PAGES, savedBook);
    }
    try { localStorage.removeItem(LS_GROUND); } catch {}
  }

  if (await fromHash()) {
    // The shared design is on screen. It used to become a fresh one-page book right here --
    // which OVERWROTE every page the recipient had, and the people most likely to trade
    // links back and forth are exactly the people with pages to lose. So: a new page in the
    // existing book. And the hash is stripped, because a payload left in the URL re-ran this
    // whole branch on every reload -- phones reload background tabs constantly -- resetting
    // the design to the moment the link was minted.
    history.replaceState(null, "", location.pathname);
    if (hasBook) {
      book = savedBook;
      pageSeq = Math.max(0, ...book.pages.map(p => p.id)) + 1;
      // First free EXACT name, not a count: counting /^Shared/ matches minted duplicates
      // the moment a page was renamed or deleted ("Shared with Ben" inflated it too).
      const taken = new Set(book.pages.map(p => p.name));
      let name = "Shared";
      for (let i = 2; taken.has(name); i++) name = `Shared ${i}`;
      const id = pageSeq++;
      book.pages.push({ id, name, doc: serializeLayout() });
      book.activeId = id;
      lsPut(LS_PAGES, book); lsPut(LS_SCENE, activePage().doc);
      paintPager();
    } else {
      adoptAsBook("Shared");
    }
    return;
  }

  if (hasBook) {
    book = savedBook;
    pageSeq = Math.max(0, ...book.pages.map(p => p.id)) + 1;
    if (!activePage()) book.activeId = book.pages[0].id;
    try { loadLayout(activePage().doc); }
    catch (e) { note(`could not open that page: ${e.message}`, 5000); loadLayout({ app: "igt-planner", v: SAVE_V, nodes: [] }); }
    paintPager();
    return;
  }

  // First run under the pages model. A single scene from before -> migrate it into page 1 so no
  // in-progress design is lost in the upgrade; otherwise a placed 4-unit frame.
  const legacy = lsGet(LS_SCENE, null);
  if (legacy) { try { loadLayout(legacy); } catch { addNode("CK-150", false); } }
  else addNode("CK-150", false);
  adoptAsBook(t("page.n", { n: 1 }));
})();
