import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { materialFor, roundedBox, boardMaterial, grainMaterial } from "./materials.js";
import { moduleGroup, flatBoardGeo as flatGeo, frameGroup, tableGroup,
         jikaroGroup, jikaroBridge, hangRackGroup, slideExtGroup,
         entryIgtGroup, slimIgtGroup, extIgtGroup, igtWoodTop,
         foldingChairGroup, lowBeachChairGroup, campfieldSofaGroup,
         loungeCushionGroup, foldingBenchGroup, bambooShelfGroup,
         takeChairGroup, shelterFootprint, BBQ_SURFACE_SKUS, takibiGroup, gs1000Group,
         propGroup, shelterOf, SHELTER_FILL, shelterVerts, shelterBBox } from "./parts3d.js";

// Millimetres everywhere, scaled once on the way into the scene. The catalog speaks
// mm; converting at the boundary keeps every number here readable against the spec
// table it came from. Angles are RADIANS everywhere, for the same reason: one unit,
// no conversions buried in the middle of the code.
const MM = 0.001;

const FRAME_THICK = 30;
// The rail's inner recess is ~10mm deep, and a flat module's edge drops into it as its
// flange. So a slotted flat board is DRAWN 10mm thick -- it fills the recess exactly and its
// top finishes flush with the rail, instead of clipping through the rail as a full-thickness
// slab or floating proud of it. Matches `recess` in railProfile.
const RAIL_RECESS = 10;
// A module's rim lands at z = +/-180 and rests on the rail's inner lip (158.5 .. 182.5).
// That 360 is the SEAT, not the span between the rails -- which is 317. See SECTION.
const MODULE_SEAT = 360;
const LEG_R = 13;
const SNAP = 25;        // ground grid the free tables slide on
const TOUCH = 30;       // two tables closer than this are connected

// A sliding extension (CK-153/154) mounts on the frame's LONG rail and cantilevers out. It
// is not a wire-hook board -- it has two integral brackets that grip the rail directly (JP
// a002/a003) -- so it needs no rail joint, takes no legs, and it SLIDES: it tiles the long
// side in slots one board wide (two CK-154 span a four-unit side exactly, 548x2 = 1096).
const isSlide = p => p?.attach === "slide_in";


const $ = id => document.getElementById(id);

let CAT, GRID, LAYOUT, CONN, HALF, PARTS, BY_ROLE, COLORS, TEXTURES, FRAMES, HOOKABLE, SLIDE_IN, SECTION;
const texLoader = new THREE.TextureLoader();
const texCache = {};
const textureOf = (sku, key = "file") => {
  const path = TEXTURES[sku]?.[key];
  if (!path) return null;
  if (!texCache[path]) texCache[path] = texLoader.load(path);
  return texCache[path];
};
// The sliding extension's own bamboo, perspective-rectified from its top-view photo (the US
// hero) and cropped to a clean grain -- so it wears its real surface, not a borrowed one.
const loadTex = path => (texCache[path] ??= texLoader.load(path));
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
  const t = texLoader.load(path);
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
  const t = texLoader.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(rep, rep);
  woodTexCache[key] = t;
  return t;
}
// The flat burner (GS-450R) shows its real top -- stainless well, brass head, ports, grate.
const burnerTop = sku => sku.startsWith("GS-450R") ? loadTex("tex/GS-450R_top.jpg") : null;

// Colours come from Snow Peak's product photography (catalog/colors.json). The swatch in
// the palette is the same colour the part is rendered in, so the two never drift.
const swatchOf = sku => COLORS[sku]?.color_hex || "#8a929c";

// Legs are aluminium: SILVER by default, every one of them. Black exists as a FINISH -- CK-109 and
// CK-112 sample pure black in Snow Peak's own photos, so black-anodised legs are real -- but which
// finish a leg wears is a decision on the node, not a property of the height you picked. The sampled
// per-SKU leg colour in colors.json conflated finish with height (picking a 400mm leg turned it
// black), so leg colour no longer reads from swatchOf; it reads the node's chosen finish. Default
// silver; that data stays only as evidence.
const LEG_SILVER = "#c0c4c8", LEG_BLACK = "#17191b";
const legColorOf = n => (n?.legFinish === "black" ? LEG_BLACK : LEG_SILVER);

// A layout is a set of tables. An IGT frame is one kind of table -- the kind with a
// grid in it. Snow Peak calls the whole thing the Layout System, and the frame is a
// node in it, not the thing itself.
//
// Two kinds of node, and the difference is physical, not cosmetic:
//
//   FREE   frame, layout table, standalone. Stands on the ground. You drag it.
//   HOOKED extension table, corner. Hangs off another node's EDGE. You do NOT drag it;
//          it is wherever its hooks are. It carries `host` + `edge`, and its x/z/rot
//          are DERIVED from them.
//
// Modelling the hooked ones as free nodes that happen to be adjacent is what kept the
// corner from turning: adjacency has no handedness, and a corner is nothing but handedness.
const state = { nodes: [], sel: null, nextId: 1, shelterLock: true, selSet: new Set(), rulers: [] };
let rulerSeq = 1;   // ids for measurements -- their own counter, reassigned fresh on load

const byId = id => state.nodes.find(n => n.id === id);
const sel = () => byId(state.sel);
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

// Rotate a vector in the ground plane. three's `rotation.y = -r` maps a local vector at
// angle a to world angle a + r, so this and the mesh always agree about which way is out.
const rotv = (v, r) => ({
  x: v.x * Math.cos(r) - v.z * Math.sin(r),
  z: v.x * Math.sin(r) + v.z * Math.cos(r),
});
const angleOf = v => Math.atan2(v.z, v.x);
// Keep rotations in (-pi, pi]. A quarter turn that reports itself as -270 degrees is not
// wrong, but it is the sort of thing you waste ten minutes on in a debug dump.
const norm = r => Math.atan2(Math.sin(r), Math.cos(r));

// ---------------------------------------------------------------- node geometry

const overhead = () => GRID.families?.standard?.end_overhead_mm ?? 96;

// The Jikaro Firering Table is FOUR trapezoid segments, and they go together either way
// round -- long edge inward (the published 1120mm ring with a 600mm fire hole) or short edge
// inward (a compact 885mm ring with a 365mm hole). Same four pieces; two different tables.
// So its footprint is not a property of the SKU, it is a property of the NODE.
const JIKARO = "ST-050";
const jikaroCfg = n => (LAYOUT.tables?.[JIKARO]?.configs || {})[n?.config || "long_in"];
const isJikaro = n => n?.sku === JIKARO && jikaroCfg(n);

// The Connection Table (LV-381): a layout table that ALSO takes IGT extensions on its two ends,
// so a run can carry on off it. Owner: it has two hole sets at different pitches (tables +
// accessories); we model the table-hook edges, which use the same wire hook as a frame end.
const CONN_TABLE = "LV-381";
const isConnTable = n => n?.sku === CONN_TABLE;

// Expandable self-contained tables (CK-090 Extension IGT): a config that changes footprint AND
// exposed unit-slots. Read lazily -- LAYOUT is fetched at boot, after these arrows are defined.
const expDef = sku => (LAYOUT.expandables || {})[sku];
const expCfg = n => { const e = expDef(n?.sku); return e && e.configs[n?.config || e.default]; };
const isExpandable = n => !!expDef(n?.sku);

// Self-contained IGTs (Entry / Slim) -- a 3-unit frame in a fixed body whose custom wood top
// lifts out per half-unit so IGT units drop in.
const selfIgt = sku => (LAYOUT.self_igt || {})[sku];

function footprintOf(sku, kind, node) {
  const p = PARTS[sku];
  if (kind === "footprint") { const b = shelterBBox(shelterVerts(p.geometry)); return { w: b.w, d: b.d }; }
  if (kind === "frame") return { w: 250 * p.units + overhead(), d: p.assembled_mm?.d ?? 496 };
  if (sku === JIKARO && node) {
    const c = jikaroCfg(node);
    if (c) return { w: c.outer_mm, d: c.outer_mm };
  }
  if (node && isExpandable(node)) {
    const c = expCfg(node);
    if (c) return { w: c.w_mm, d: c.d_mm };
  }
  const a = p.assembled_mm;
  return { w: a?.w ?? 496, d: a?.d ?? 496 };
}
const footprint = n => footprintOf(n.sku, n.kind, n);

// ---- Shelter footprints ---------------------------------------------------------------
// A tent / shell / tarp laid on the ground as a SCALE REFERENCE. Its `geometry` is either an
// explicit {kind:"polygon", vertices:[[x,y],...]} or a named primitive we expand here -- so the
// catalog can say "hexagon 5700x4200 waist 1800" instead of listing six points. All mm, centred;
// +y = front (door / ridge), which drawFootprint maps to scene +z.

/** Top surface height.
 *
 *  A hook-on table hangs from the frame's rail, so its surface is FLUSH with whatever it
 *  hooks to -- not (its own legs + its own 25mm top), which would sit 5mm proud of a
 *  30mm frame and trip the step-joint rule for a difference that does not exist. Its legs
 *  hold up the far end; they do not set its height. And because the copy says "the frame
 *  OR OTHER EXTENSION", a whole chain inherits the frame's height, all the way down.
 */
function topOf(n, depth = 0) {
  if (n.kind === "frame") return (PARTS[n.leg]?.height_mm ?? 0) + FRAME_THICK;
  if (n.kind === "ext") {
    const h = byId(n.host);
    // Flush with the host, MINUS any height-adjuster step (n.step rungs down the ladder).
    if (h && depth < 16) return topOf(h, depth + 1) - stepDropMm(hostLegOf(h), n.step || 0);
    return (PARTS[n.leg]?.height_mm ?? 0) + (PARTS[n.sku].assembled_mm?.h ?? 25);
  }
  // Self-contained IGTs stand at the datum by design; Slim's 408mm is within tolerance of 400, so
  // snap them to the datum -- they line up with any 400mm table and join via a connection hook, not
  // a height adjuster.
  if (selfIgt(n.sku)) return LAYOUT.datum_height_mm;
  return PARTS[n.sku].height_mm ?? PARTS[n.sku].assembled_mm?.h ?? LAYOUT.datum_height_mm;
}

// The IGT height ladder -- the leg SKUs top to bottom. A height adjuster (CK-151) bridges ONE
// adjacent step and only downward (per the CK-151 manual: 830<->660<->400<->300; it CANNOT skip
// a step like 830->400, and CANNOT raise). legAtStep drops a leg SKU by `step` rungs, clamped.
const HEIGHT_LADDER = ["CK-114", "CK-113", "CK-112", "CK-109"];   // 830, 660, 400, 300 mm
const legRung = leg => HEIGHT_LADDER.indexOf(leg);
function legAtStep(fromLeg, step = 0) {
  const i = legRung(fromLeg);
  if (i < 0) return fromLeg;
  return HEIGHT_LADDER[Math.max(0, Math.min(i + step, HEIGHT_LADDER.length - 1))];
}
const legMm = leg => PARTS[leg]?.height_mm ?? 0;
const stepDropMm = (fromLeg, step = 0) => legMm(fromLeg) - legMm(legAtStep(fromLeg, step));
const stepRoom = hostLeg => Math.max(0, HEIGHT_LADDER.length - 1 - legRung(hostLeg));  // rungs left below
// The leg a host effectively stands on -- its own, or the datum leg for a legless layout table.
const hostLegOf = h => h?.leg || PARTS[h?.sku]?.requires_leg || LAYOUT.leg_at_datum;

/** World-space AABB, honouring the node's rotation. */
function aabb(n) {
  const f = footprint(n);
  const c = Math.abs(Math.cos(n.rot)), s = Math.abs(Math.sin(n.rot));
  const w = f.w * c + f.d * s, d = f.w * s + f.d * c;
  return { x0: n.x - w / 2, x1: n.x + w / 2, z0: n.z - d / 2, z1: n.z + d / 2, w, d };
}

/** Two tables are connected if their footprints touch. */
function neighbours(n) {
  const a = aabb(n);
  return state.nodes.filter(m => {
    if (m === n || m.kind === "footprint" || n.kind === "footprint") return false;   // a ground reference never "connects"
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
  for (const n of state.nodes) {
    if (n.kind === "prop" || n.kind === "footprint") continue;   // free-standing -- not a table
    for (const m of neighbours(n))
      if (m.kind !== "prop" && m.kind !== "footprint" && n.id < m.id && Math.abs(topOf(n) - topOf(m)) > 5) out.push([n, m]);
  }
  return out;
}

// Where two touching footprints actually MEET -- the seam, not the line between their centres.
// Returns the fixed coordinate, the axis the seam runs along, and the overlap span on it, so a
// step joint can be drawn ON the seam (and not shot through the middle of a table).
function contactEdge(a, b) {
  const A = aabb(a), B = aabb(b);
  const ox0 = Math.max(A.x0, B.x0), ox1 = Math.min(A.x1, B.x1);   // shared x extent
  const oz0 = Math.max(A.z0, B.z0), oz1 = Math.min(A.z1, B.z1);   // shared z extent
  const sides = [
    { d: Math.abs(A.x1 - B.x0), axis: "z", fixed: (A.x1 + B.x0) / 2, lo: oz0, hi: oz1 },
    { d: Math.abs(A.x0 - B.x1), axis: "z", fixed: (A.x0 + B.x1) / 2, lo: oz0, hi: oz1 },
    { d: Math.abs(A.z1 - B.z0), axis: "x", fixed: (A.z1 + B.z0) / 2, lo: ox0, hi: ox1 },
    { d: Math.abs(A.z0 - B.z1), axis: "x", fixed: (A.z0 + B.z1) / 2, lo: ox0, hi: ox1 },
  ];
  return sides.sort((p, q) => p.d - q.d)[0];   // the side with the smallest gap is where they touch
}

// ---------------------------------------------------------------- hooks and brackets
//
// Both of these come off the plan-view photographs (catalog/textures.json). Nothing here
// is assumed, and that matters, because the ONE fact that makes a corner a corner is the
// angle between these two axes:
//
//   CK-117TR  straight ext   hooks x=+560     brackets x=-504     -> opposite. Run continues.
//   CK-119TR  right corner   hooks z=+261     brackets x=+223     -> PERPENDICULAR. Run turns.
//   CK-118TR  left corner    hooks z=+261     brackets x=-229     -> perpendicular, other way.
//
// The two corners are exact mirrors, measured independently from their own photographs.
// That is the whole of the 90 degrees, and it was sitting in the data all along.

const mean = pts => ({
  x: pts.reduce((a, p) => a + p[0], 0) / pts.length,
  z: pts.reduce((a, p) => a + p[1], 0) / pts.length,
});

/** The outward normal of the board's HOOK edge, in the board's own coordinates.
 *
 *  This used to snap to +/-x or +/-z. A rectangle and a quarter round are both axis-aligned,
 *  so it worked -- right up until an angle extension arrived, whose hook edge faces -30.4
 *  degrees and got snapped to +x. The board was modelled as STRAIGHT and the entire 60
 *  degrees vanished into a rounding. Read the measured normal. */
const hookNormal = sku => {
  const e = TEXTURES[sku]?.hook_edge;
  return e ? { x: e[0], z: e[1] } : { x: 1, z: 0 };
};

/** The signed turn this board imposes on the run: 0 straight, +/-90 a corner, +/-60 an
 *  angle extension. Snapped to the design intent at measurement time (the same fit that
 *  reads 60.8 for an angle board reads 90.9 for a corner that is certainly 90), so six
 *  angle boards close a hexagon EXACTLY and four corners close a rectangle. */
const turnOf = sku => (TEXTURES[sku]?.turn ?? 0) * Math.PI / 180;

/** The outward normal of the BRACKET edge -- the leg seats, and where the next board hooks.
 *  Straight on from the hooks, then turned. Derived from the canonical turn rather than
 *  read raw, so the geometry of a chain closes instead of drifting by a degree a board. */
function bracketNormal(sku) {
  const h = hookNormal(sku);
  return rotv({ x: -h.x, z: -h.z }, turnOf(sku));
}

/** Where on the board the hooks are (their midpoint), and where the brackets are.
 *
 *  These are the ANCHORS, and they replace "the midpoint of a bounding-box face". A slanted
 *  edge has no bounding-box face; and even a straight board is really located by its hooks,
 *  which is what actually drops into what. */
const hookAnchor = sku => mean(TEXTURES[sku]?.hooks_mm || [[0, 0]]);
const bracketAnchor = sku => mean(TEXTURES[sku]?.legs_mm || [[0, 0]]);

/** The half of the joint that THIS node brings, in its own coordinates.
 *
 *  A bamboo board brings wire hooks, measured off its own plan view. A FRAME brings CK-175,
 *  which turns its end piece into a hook -- so what mates is the end FACE, and the two
 *  frames butt. Same placement rule either way; only the half differs. */
function hookGeometry(n) {
  if (n.kind === "frame" || isConnTable(n)) {
    // A frame butts its -x end face to face; the Connection Table butts its short end the same
    // way, so it lines up edge to edge with the Jikaro at the datum.
    const f = footprint(n);
    return { normal: { x: -1, z: 0 }, anchor: { x: -f.w / 2, z: 0 } };
  }
  // A sliding extension has no measured wire hooks -- it mounts by the brackets along one
  // whole long edge. So its "hook" is that edge: anchored at the edge midpoint, facing out.
  // parts3d's slideExtGroup draws the brackets on -z and the board reaching +z, to match.
  if (isSlide(PARTS[n.sku]))
    return { normal: { x: 0, z: -1 }, anchor: { x: 0, z: -depthOf(PARTS[n.sku]) / 2 } };
  return { normal: hookNormal(n.sku), anchor: hookAnchor(n.sku) };
}

// The rail joint. Two of them come in the box with a corner, and they are sold on their
// own as XCK-128-01 (マルチファンクションテーブル レールジョイント2個セット) -- which is
// filed under spare parts and sits in none of the IGT collections, so a collection sweep
// never finds it. It took reading a manual.
const RAIL_JOINT = "XCK-128-01";

// The frame's hook holes sit 16.5mm in from the end face -- measured on CK-149, whose ends
// are at x = +/-423 and whose holes are at +/-406.5. They are 287.8mm apart in z, and every
// bamboo board's hooks measure 289-293mm apart: 2mm of clearance, which is exactly what a
// hook needs to drop in. That agreement, across eight boards and one frame, is what licenses
// using the hook spacing as a RULER -- and it is how CK-218's published depth was caught.
const HOLE_INSET = 16.5;

// CK-175, IGTコネクションフック. JP-only, no manual, and exactly ONE real photograph in its
// gallery -- which happens to be of exactly the thing: two IGT frames butted END TO END,
// their black end pieces face to face, two knurled thumbscrews spanning the joint.
//
// A frame's end already has the HOLES. CK-175 supplies the other half -- it gives the end
// a HOOK -- and two frames become one run. The spec table says セット内容 本体x2 (a pair,
// 45g each), and a frame's end has two holes, so ONE set makes ONE joint.
//
// The frames do NOT share legs. Each keeps its own four, and the photograph shows it: two
// pairs of legs bunched together at the joint.
const FRAME_HOOK = "CK-175";

/** An attachment edge, resolved in the host's OWN coordinates.
 *
 *  An edge is not an axis. It is a place where two named holes are, facing a particular
 *  way -- and on an angle extension that way is -30.4 degrees, which no axis can say.
 *  So an edge carries an ANCHOR (the midpoint of the holes) and a NORMAL (which way it
 *  faces), and both are measured.
 */
function hostEdge(n, key, guest = "ext") {
  const f = footprint(n);
  // A frame and a self-contained IGT (Entry / Slim) share one edge geometry: ends at +/-w/2 with
  // holes a board hooks into, long rails at +/-d/2. The self-IGT stands at the datum, so a board
  // on it inherits the datum the same way a frame's board does.
  if (n.kind === "frame" || selfIgt(n.sku)) {
    // A BOARD's wire hooks drop INTO the holes, 16.5mm in from the end face, so the board
    // ends up resting 4mm onto the end piece. A FRAME does not: with CK-175 the two end
    // pieces butt FACE TO FACE and the fitting spans them. Two guests, two anchors, one
    // edge -- and aligning a frame to the hole line instead would bury it 33mm into its
    // neighbour, which is what the first version did.
    const inset = guest === "frame" ? 0 : HOLE_INSET;
    if (key === "end+x") return { anchor: { x: f.w / 2 - inset, z: 0 }, normal: { x: 1, z: 0 }, len: f.d };
    if (key === "end-x") return { anchor: { x: -(f.w / 2 - inset), z: 0 }, normal: { x: -1, z: 0 }, len: f.d };
    // The long rail. The joints SLIDE, so there is no fixed hole to aim at -- anchor at the
    // middle of the run and let the joints go wherever the board's hooks land.
    if (key === "rail+z") return { anchor: { x: 0, z: f.d / 2 }, normal: { x: 0, z: 1 }, len: f.w, rail: true };
    if (key === "rail-z") return { anchor: { x: 0, z: -f.d / 2 }, normal: { x: 0, z: -1 }, len: f.w, rail: true };
  }
  if (n.kind === "ext" && key === "bracket") {
    // The bracket plates ARE the sockets: the next board's wire hooks come down into them.
    const lg = TEXTURES[n.sku]?.legs_mm;
    return {
      anchor: bracketAnchor(n.sku),
      normal: bracketNormal(n.sku),
      len: lg ? Math.hypot(lg[0][0] - lg[1][0], lg[0][1] - lg[1][1]) * 1.35 : 400,
    };
  }

  // The Jikaro's four OUTER STRAIGHT sides. Snow Peak's own photo (JP a011) shows a Bamboo
  // IGT Table hooked to one of them, standing on 400mm legs -- so the fire ring is a host
  // like any other, and a board on it inherits the datum.
  //
  // The four 45-degree CHAMFERS are NOT offered. Nothing says a board hooks there, and a
  // 45-degree edge is exactly the kind of thing it is tempting to assume symmetry about.
  // The ring's APERTURE. Not an edge at all -- a HOLE, concentric with the ring, at ground level.
  // Nothing hooks and nothing is borne: the ring simply stands around a pit that carries itself on
  // its own feet. It is a port because the ring is BUILT around it -- see connections.interfaces.
  if (isJikaro(n) && key === "opening") {
    const c = jikaroCfg(n);
    return {
      anchor: { x: 0, z: 0 }, normal: { x: 0, z: 1 },
      len: c.opening_mm, at: "opening", opening: c.opening_mm,
    };
  }
  if (isJikaro(n) && JIKARO_EDGES[key]) {
    const c = jikaroCfg(n);
    const v = JIKARO_EDGES[key], normal = { x: v.x, z: v.z };
    const half = c.outer_mm / 2, e = c.edge_mm / 2;
    // A 45-degree CHAMFER face sits (half+e)/sqrt2 out from centre and is sqrt2*(half-e) long;
    // its normal is the diagonal. Owner: the spread Jikaro takes IGT extensions on all eight.
    if (v.chamfer) {
      const faceDist = (half + e) / Math.SQRT2 - HOLE_INSET;
      return { anchor: { x: normal.x * faceDist, z: normal.z * faceDist }, normal, len: Math.SQRT2 * (half - e), at: "edge" };
    }
    // NOTE (owner correction): the Jikaro joins via its built-in side KNOBS (ツマミ, in its material
    // spec), NOT the frame's wire hook -- this is the `knob` interface (symmetric, no CK-175), the
    // SAME joint its four segments use between themselves. The 16.5mm inset below is a leftover
    // placeholder from the old wire-hook assumption; the real knob offset is unmeasured. See
    // layout.connections. (It only shifts the guest ~16mm, so behaviour is unaffected for now.)
    const r = half - HOLE_INSET;
    return { anchor: { x: normal.x * r, z: normal.z * r }, normal, len: c.edge_mm, at: "edge" };
  }

  // The Connection Table's ends carry an IGT extension the SAME way a frame end does -- the same
  // wire hook, dropping 16.5mm in from the end face. It stands at the datum, so the run does too.
  if (isConnTable(n)) {
    if (key === "end+x") return { anchor: { x: f.w / 2 - HOLE_INSET, z: 0 }, normal: { x: 1, z: 0 }, len: f.d };
    if (key === "end-x") return { anchor: { x: -(f.w / 2 - HOLE_INSET), z: 0 }, normal: { x: -1, z: 0 }, len: f.d };
    // The two LONG SIDES take an extension too (a second hole set at its own pitch, owner's note).
    if (key === "side+z") return { anchor: { x: 0, z: f.d / 2 - HOLE_INSET }, normal: { x: 0, z: 1 }, len: f.w };
    if (key === "side-z") return { anchor: { x: 0, z: -(f.d / 2 - HOLE_INSET), }, normal: { x: 0, z: -1 }, len: f.w };
  }
  return null;
}

const S = Math.SQRT1_2;   // 1/sqrt(2)
const JIKARO_EDGES = {
  // the four OUTER STRAIGHT sides
  "jik+x": { x: 1, z: 0 }, "jik-x": { x: -1, z: 0 },
  "jik+z": { x: 0, z: 1 }, "jik-z": { x: 0, z: -1 },
  // the four 45-degree CHAMFERS. Owner: in the SPREAD form all eight edges take IGT extensions,
  // so the chamfers are offered too (gated to long_in in edgeKeysOf).
  "jikNE": { x: S, z: S, chamfer: true }, "jikSE": { x: S, z: -S, chamfer: true },
  "jikNW": { x: -S, z: S, chamfer: true }, "jikSW": { x: -S, z: -S, chamfer: true },
};

const EDGE_KEYS = { frame: ["end+x", "end-x", "rail+z", "rail-z"], ext: ["bracket"], table: [] };
// A self-contained IGT (Entry / Slim) IS a fixed-body 3-unit frame: holes at the ends, rails on the
// long sides. It offers whichever of those its connections.hosts entry declares -- so it connects
// like a frame, driven by the same data, without being kind "frame".
function selfIgtEdges(n) {
  const ports = CONN.hosts[n.sku] || [];
  const keys = [];
  if (ports.some(p => p.at === "end"))  keys.push("end+x", "end-x");
  if (ports.some(p => p.at === "rail")) keys.push("rail+z", "rail-z");
  return keys;
}
const edgeKeysOf = n => isJikaro(n) ? [...Object.keys(JIKARO_EDGES).filter(k =>
    !JIKARO_EDGES[k].chamfer || n.config === "long_in"), "opening"]   // chamfers only in the spread
                                                  // form; the aperture in BOTH -- what fits in it
                                                  // is decided by measuring, in legalOn
  : isConnTable(n) ? ["end+x", "end-x", "side+z", "side-z"]   // Connection Table: ends AND long sides
  : isSlide(PARTS[n.sku]) ? []                    // a sliding extension is a leaf -- nothing
                                                  // hooks onto it, and its phantom bracket
                                                  // edge was intercepting the click to drag it
  : selfIgt(n.sku) ? selfIgtEdges(n)              // Entry / Slim IGT: frame-like ends (+ rails)
  : EDGE_KEYS[n.kind] || [];

/** Every edge of this node that an extension could still hook onto.
 *
 *  A FRAME offers its two SHORT ends DIRECTLY: the hook holes are in the black end pieces,
 *  at x = +/-406.5, and there are none anywhere along the rails. That much is measured.
 *
 *  But it also offers its two LONG SIDES, through a RAIL JOINT. CK-119TR's manual, step 4:
 *
 *      レールジョイントを使用する場合は IGTフレームの長辺のレールに挿入します
 *      "If using the rail joints, insert them into the rail on the LONG SIDE of the IGT
 *       frame."   ...then (5) 天板フックを連結します -- and hook the tabletop onto them.
 *
 *  The joint clips into the rail and gives the board's wire hook something to hang from.
 *  Nothing in the marketing copy says this and no photograph shows it; the planner forbade
 *  it outright, on the strength of a measurement that was true and a conclusion that was
 *  not. A hole you cannot find is not a hole that isn't there.
 *
 *  A HOOKED board offers exactly one edge in turn: the one carrying its brackets, which
 *  hold both its legs and the holes for the next board.
 */
function openEdges(n) {
  const hosts = state.nodes.filter(m => m.host === n.id);
  const out = [];
  for (const key of edgeKeysOf(n)) {
    const e = hostEdge(n, key);
    if (!e) continue;
    const on = hosts.filter(m => m.edge === key);
    // A long RAIL can hold SEVERAL sliding extensions -- it stays open until they fill it.
    // Any other occupant (a hook-on board, a joined frame) claims the whole edge at once.
    if (e.rail) {
      if (on.some(m => !isSlide(PARTS[m.sku]))) continue;             // a hook-on board claims it
      const used = on.reduce((s, m) => s + railW(PARTS[m.sku]), 0);
      if (used >= e.len - 1) continue;                               // the slots are full
    } else if (on.length) {
      continue;
    }
    const a = rotv(e.anchor, n.rot);
    out.push({
      node: n, key, len: e.len, rail: !!e.rail,
      // Carry the edge's CLASS through. portsAt splits a host's ports by it and legalOn measures an
      // aperture's guest with it -- drop them here and the fire pit is silently offered on the fire
      // ring's OUTER edges, which is the exact mistake this field exists to prevent.
      at: e.at, opening: e.opening,
      dir: rotv(e.normal, n.rot),
      mid: { x: n.x + a.x, y: topOf(n), z: n.z + a.z },
    });
  }
  return out;
}

const anyOpenEdge = () => state.nodes.some(n => openEdges(n).length > 0);

// A node's ASSEMBLY -- the connected component it belongs to. Follow host links (of ANY kind,
// unlike rootOf which stops at non-ext) up to the free root, then gather everything sharing it.
// A hooked board, a sliding extension, a frame joined to another frame: one assembly, moved and
// selected as one.
function asmRoot(n) {
  const seen = new Set();
  while (n.host && !seen.has(n.id)) {
    seen.add(n.id);
    const h = byId(n.host);
    if (!h) break;                       // dangling host -> treat the current node as the root
    n = h;
  }
  return n;
}
function assemblyOf(n) {
  const root = asmRoot(n);
  return state.nodes.filter(m => asmRoot(m) === root);
}

// ---------------------------------------------------------------- hook chain

/** Put a hooked board where its hooks are.
 *
 *  Turn it so its hook edge faces back at the host, then slide it until its HOOKS land on
 *  the host's HOLES. Not "until its bounding box butts against the host's" -- an angle
 *  extension's hook edge is at -30.4 degrees and its bounding box has nothing to do with
 *  the joint. What drops into what is the hooks, so that is what the model aligns.
 */
function place(n) {
  const h = byId(n.host);
  if (!h) return;
  const e = hostEdge(h, n.edge, n.kind);
  if (!e) return;

  // A pit in a ring does not MATE an edge -- there are no hooks on either side. It stands on the
  // ground in the middle of the aperture, which is concentric with the ring, and square to it
  // (a 455mm Takibi turned 45 degrees measures 643 across the diagonal and would not go in a 600
  // opening at all). It keeps its own feet, so it takes no leg from its host -- that is the whole
  // difference between "borne by" and "surrounded by".
  if (e.at === "opening") {
    n.x = h.x; n.z = h.z; n.rot = h.rot; n.leg = null;
    return;
  }

  const dir = rotv(e.normal, h.rot);
  const a = rotv(e.anchor, h.rot);
  const at = { x: h.x + a.x, z: h.z + a.z };
  const mine = hookGeometry(n);

  n.rot = norm(angleOf({ x: -dir.x, z: -dir.z }) - angleOf(mine.normal));

  const w = rotv(mine.anchor, n.rot);
  n.x = at.x - w.x;
  n.z = at.z - w.z;

  // A sliding extension does not centre on the rail -- it SLIDES, and you can DRAG it along
  // (unlike a hooked board, pinned by its hooks). Its position is a stored offset from the
  // middle of the run, snapped to a light grid and clamped to the rail.
  // On the long rail, BOTH a sliding extension and a hook-on board move along the rail -- apply
  // the stored offset. The slide then cantilevers and drops its legs; a hook-on board falls
  // through and keeps its host's legs.
  if (n.rail && e.rail) {
    const along = { x: dir.z, z: -dir.x };
    const off = isSlide(PARTS[n.sku]) ? slideOffset(n, h) : (n.slide || 0);
    n.x += along.x * off;
    n.z += along.z * off;
    if (isSlide(PARTS[n.sku])) { n.leg = null; return; }   // cantilevers off the rail; no legs
  }

  // A board flush with its host stands at its host's height, so it takes its host's legs.
  // Arithmetic, not preference -- the same argument as the 400mm datum. Two frames hooked
  // end to end are the same case: they are one work surface, so they are one height.
  //
  // A layout table has no leg SKU of its own -- it comes with legs. But it does have a
  // height, and the datum tables are all 400mm, so a board hooked to one takes the 400mm
  // IGT Low leg (CK-112). Snow Peak's photo of a Bamboo table on the Jikaro shows exactly
  // that, and it is the same arithmetic that made CK-112 the datum leg in the first place.
  // Flush takes the host's leg; a height adjuster drops it n.step rungs down the ladder.
  n.leg = legAtStep(hostLegOf(h), n.step || 0) || n.leg;
}

const SLIDE_SNAP = 25;   // mm -- a light grid so a dragged extension lands tidy, not free-float

/** How far a sliding extension may slide before it runs off the rail OR overlaps another one
 *  on the same rail -- two must NOT overlap. Neighbours are classed by which side they are on
 *  now, so the board slides up to TOUCHING one but not through it. */
function slideBounds(n, host) {
  // A sliding extension must fit ON the rail, so subtract its width. A hook-on board just hangs
  // from a rail joint at a POINT and can overhang, so it ranges over the whole rail (bw = 0) --
  // otherwise a board wider than the frame clamps to a zero range and cannot be dragged at all.
  const bw = isSlide(PARTS[n.sku]) ? railW(PARTS[n.sku]) : 0;
  const rail = Math.max(0, (footprint(host).w - bw) / 2);
  let lo = -rail, hi = rail;
  const cur = n.slide ?? 0;
  for (const m of state.nodes) {
    if (m === n || m.host !== host.id || m.edge !== n.edge || !isSlide(PARTS[m.sku])) continue;
    const gap = (bw + railW(PARTS[m.sku])) / 2;     // min centre-to-centre to not overlap
    const ms = m.slide ?? 0;
    if (ms > cur) hi = Math.min(hi, ms - gap);
    else lo = Math.max(lo, ms + gap);
  }
  return { lo, hi };
}

/** How far along the rail a sliding extension sits: its own `slide`, snapped to the grid and
 *  clamped so it stays on the rail AND clear of its neighbours. A STORED position, not a
 *  derived one -- it is what the drag writes. Two 548mm boards on a 1096mm side sit at -274/+274. */
function slideOffset(n, host) {
  const { lo, hi } = slideBounds(n, host);
  const snapped = Math.round((n.slide ?? 0) / SLIDE_SNAP) * SLIDE_SNAP;
  return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, snapped));
}

/** Where a newly added sliding extension starts: the first board-wide tiling position no other
 *  one already sits at, so a second tiles beside the first. From there it is dragged anywhere. */
function initialSlide(host, key, sku) {
  const railLen = footprint(host).w;
  const bw = railW(PARTS[sku]);
  const nslots = Math.max(1, Math.floor(railLen / bw));
  const here = state.nodes
    .filter(m => m.host === host.id && m.edge === key && isSlide(PARTS[m.sku]))
    .map(m => m.slide ?? 0);
  for (let i = 0; i < nslots; i++) {
    const off = -railLen / 2 + bw * (i + 0.5);
    if (!here.some(s => Math.abs(s - off) < bw * 0.5)) return off;
  }
  return 0;
}

/** Hooked things are not free: they are where their hooks are. Re-derive the whole chain
 *  from its roots whenever anything moves. Roots first, then what hangs off them.
 *
 *  A FRAME can be hooked too now (CK-175), so the test is "does it have a host", not "is it
 *  an extension". Frames used to be the roots by definition; they are not any more. */
function resolve() {
  const done = new Set(state.nodes.filter(n => !n.host).map(n => n.id));
  for (let pass = 0; pass < 16; pass++) {
    let moved = false;
    for (const n of state.nodes) {
      if (!n.host || done.has(n.id) || !done.has(n.host)) continue;
      place(n);
      done.add(n.id);
      moved = true;
    }
    if (!moved) break;
  }
}

// ---------------------------------------------------------------- slots (per frame)

// The IGT bay a node exposes for modules: a whole frame, a bridged Jikaro opening, or the
// opened Extension IGT centre. Its unit count drives the slot grid; 0 = it hosts nothing.
// This is what lets a Jikaro-with-bridge and an open Extension IGT take modules like a frame.
function bayUnits(n) {
  if (n.kind === "frame") return PARTS[n.sku].units || 0;
  if (isJikaro(n) && n.bridge) return jikaroCfg(n).bridge_units || 0;
  if (isExpandable(n)) return expCfg(n)?.bay_units || 0;
  if (selfIgt(n.sku)) return selfIgt(n.sku).units || 0;   // Entry/Slim: a 3-unit frame, top lifts out
  return 0;
}
const hasBay = n => bayUnits(n) > 0;
// Refit the modules after the bay shrank or vanished (bridge off, collapse, 2U->1U). Each
// module that still fits the smaller bay is KEPT -- at its old spot if free, else re-packed into
// the first free run; anything now too wide, or with no room left, is dropped. So 2U-full -> 1U
// keeps one unit's worth and drops the overflow; a lone module slides into the surviving unit.
function pruneModules(n) {
  const s = slotsOf(n), keep = [];
  const free = (start, span) => start >= 0 && start + span <= s
    && !keep.some(k => start < k.start + k.span && k.start < start + span);
  for (const pl of (n.placements || [])) {
    if (pl.span > s) continue;                                   // too wide for the bay now
    let start = free(pl.start, pl.span) ? pl.start : -1;         // keep its place if it's clear
    if (start < 0) for (let i = 0; i + pl.span <= s; i++) if (free(i, pl.span)) { start = i; break; }
    if (start >= 0) keep.push({ ...pl, start });
  }
  n.placements = keep;
}
const slotsOf = n => bayUnits(n) * 2;
const runOf = n => bayUnits(n) * 250;
const slotX = (n, i) => -runOf(n) / 2 + i * HALF;

function railW(p) {
  return p.along_rail_mm || (p.span ? p.span * HALF : (p.assembled_mm?.w ?? HALF));
}
/** Which of a module's two plan dimensions runs ACROSS the rails.
 *
 *  The catalog's w/d axes are not consistent between families -- the 1-unit trays put the along-rail
 *  dimension in `w`, the half-units put it in `d` -- so this has to work it out. The rule: whichever
 *  dimension is CLOSER to the rail span the part occupies is the along-rail one; the other is the
 *  depth.
 *
 *  It used to demand |w - railW| < 1, i.e. an EXACT match, and fell back to "then w must be the
 *  depth". That broke on any part that overhangs its slot by even a millimetre. GS-450R-US is 270
 *  along a 250 rail span (its own fit_delta_mm says 20) and 410 deep -- so the exact test failed, w
 *  was taken as the depth, and the flat burner was drawn 270 x 270 instead of 270 x 410. It carries
 *  its real top as a PHOTO, so a wrong depth doesn't just mis-size it, it squashes the picture --
 *  which is exactly what the owner spotted. Nearest-wins gets it right without needing every part to
 *  declare along_rail_mm. */
function depthOf(p) {
  const a = p.assembled_mm;
  if (!a) return MODULE_SEAT;
  const r = railW(p);
  return Math.abs(a.w - r) <= Math.abs(a.d - r) ? a.d : a.w;
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
scene.background = new THREE.Color(0x14161a);   // replaced by applyTheme() on boot

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
camera.position.set(1.6, 1.5, 2.1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.35, 0);
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

scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x33383f, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 3.4, 1.8);
scene.add(key);
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
// measurement. The choice is a PREFERENCE like the theme -- one per browser, not part of a design, so
// it lives in its own localStorage key and never travels in a shared link.
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
  wood:   { name: "Wood",   make: makeWoodTexture,   repeat: 5, rough: 0.72 },
  gravel: { name: "Gravel", make: makeGravelTexture, repeat: 8, rough: 0.95 },
  sand:   { name: "Sand",   make: makeSandTexture,   repeat: 7, rough: 0.9 },
};
const LS_GROUND = "igt.ground";
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
function setGround(key) {
  if (!GROUNDS[key]) key = "grid";
  currentGround = key;
  try { localStorage.setItem(LS_GROUND, key); } catch {}
  if (groundMesh) { scene.remove(groundMesh); groundMesh.material.dispose(); groundMesh.geometry.dispose(); groundMesh = null; }
  if (grid) grid.visible = key === "grid";            // graph paper only on the bare floor
  if (key !== "grid") {
    const g = GROUNDS[key];
    groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),                // wider than the 8m grid, so it fills the view
      new THREE.MeshStandardMaterial({ map: groundTexture(key), roughness: g.rough, metalness: 0 }),
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.003;                   // just under the grid lines and the parts' feet
    scene.add(groundMesh);
  }
  const sel = $("groundsel");
  if (sel && sel.value !== key) sel.value = key;
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
  const glow = isSel ? 0x2e1806 : 0x000000;

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

  // Legs: tapered tube with a foot, the way they actually are.
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
    for (const [lx, lz] of spots) {
      const shaft = stock(
        new THREE.CylinderGeometry(LEG_R * MM, LEG_R * 0.82 * MM, h * MM, 16),
        new THREE.Color(legColorOf(n)), 0.85, 0.3,
      );
      shaft.position.set(lx, h / 2, lz).multiplyScalar(MM);
      g.add(shaft);
      const foot = stock(
        new THREE.CylinderGeometry(LEG_R * 1.25 * MM, LEG_R * 1.35 * MM, 12 * MM, 16),
        0x2a2d31, 0.1, 0.85,
      );
      foot.position.set(lx, 6, lz).multiplyScalar(MM);
      g.add(foot);
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
  // Body, side panels, hooks and shelves come from hangRackGroup in parts3d.js -- one rack,
  // both renderers. It hangs from y=0 to -drop, so place it at the slot centre and the frame
  // top. CK-220's assembled height is not published (only packed), so it is drawn a little
  // translucent to say "estimated".
  const { group, pick } = hangRackGroup({
    w: a.w, d: a.d, drop: a.h, tiers: p.tiers || 1,
    hasSurface: !!p.has_surface, color: swatchOf(p.sku), estimated: p.assembled_estimated,
  });
  group.position.set(cx * MM, top * MM, 0);
  for (const m of pick) { m.userData.placement = pl; m.userData.node = n; slotMeshes.push(m); }
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
  if (!state.shelterLock || n.id === state.sel) {
    built.body.userData.node = n;
    nodeMeshes.push(built.body);
  }
  g.add(built.group);
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
    const built = (n.sku === "CK-180" ? slimIgtGroup : entryIgtGroup)(f.w, f.d, tp);
    built.group.position.y = tp * MM;
    built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(built.group);

    const cells = occupancy(n), skip = [];
    for (let i = 0; i < cells.length; i++) if (cells[i]) skip.push(i);
    const teak = si.top === "teak";
    const top = igtWoodTop({ units: si.units, color: teak ? 0xffffff : 0xd8bd86,
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
          color: 0xd8813f, transparent: true, opacity: 0, depthWrite: false,
        }),
      );
      m.scale.set(72 * MM, 46 * MM, e.len * MM);
      m.rotation.y = -angleOf(e.dir);      // local +x points out of the edge
      m.position.set(e.mid.x * MM, (e.mid.y - 12) * MM, e.mid.z * MM);
      m.renderOrder = 2;
      m.userData.edge = e;
      build.add(m);
      edgeMeshes.push(m);

      // A visible tab, so the add-points show the moment you select -- no hovering to discover
      // them. It carries the edge too, so clicking the tab opens the same menu as the slab.
      const tab = new THREE.Mesh(
        new THREE.SphereGeometry(14 * MM, 18, 12),
        new THREE.MeshStandardMaterial({
          color: 0xf0a463, metalness: 0.1, roughness: 0.4, emissive: 0x7a4310, emissiveIntensity: 0.55,
        }),
      );
      tab.position.set(e.mid.x * MM, (e.mid.y + 16) * MM, e.mid.z * MM);
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
      m.scale.set(HALF * 0.92 * MM, 30 * MM, 300 * MM);
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
  return n.kind === "prop" ? (PARTS[n.sku].assembled_mm?.h || 800)
    : n.kind === "footprint" ? 30
    : topOf(n) + 8;
}

// A clean CAD-style selection outline: a tight oriented box hugging the selected object. Added to
// the object's OWN group (already positioned + rotated), so it stays tight at any camera angle, and
// drawn depth-test-off so it reads as a selection highlight that's always visible.
const SEL_COLOR = 0xf0a463;

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
  if (hoverBox) { scene.remove(hoverBox); hoverBox.geometry.dispose(); hoverBox.material.dispose(); hoverBox = null; }
  if (!n || n.id === state.sel) return;   // the selected object already wears its own box
  const f = footprint(n), h = selTop(n), pad = 14;
  hoverBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry((f.w + pad) * MM, (h + pad) * MM, (f.d + pad) * MM)),
    // Cyan, so it's distinct from the orange SELECTION box and legible on either theme's ground.
    new THREE.LineBasicMaterial({ color: 0x3ec6f0, transparent: true, opacity: 0.75, depthTest: false }));
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
    new THREE.LineDashedMaterial({ color: 0xd8813f, dashSize: 0.035, gapSize: 0.02, transparent: true, opacity: 0.95 }),
  );
  line.computeLineDistances();                 // a dashed line draws nothing without this
  line.position.set(n.x * MM, 0, n.z * MM);
  line.rotation.y = -n.rot;
  build.add(line);
}

function rebuild() {
  clearHoverNode();               // node positions may have moved; drop any stale hover highlight
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
      : `hook an extension onto the ${PARTS[e.node.sku].title_en}`;
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
function toolBtn(glyph, title, cls, onClick) {
  const b = document.createElement("button");
  b.textContent = glyph; b.title = title; if (cls) b.className = cls;
  b.onclick = ev => { ev.stopPropagation(); onClick(); };
  return b;
}

// ---- The selected object's OWN controls, in the viewport ----------------------------------------
// Leg height and part options used to sit in the left panel, which meant leaving the object to change
// it. They open from the object's own toolbar now; the panel keeps only the browsing lists.
const legAdjustable = n => !!n && (n.kind === "frame" || n.kind === "ext");
const hasActions = n => !!n && (isJikaro(n) || isExpandable(n)
  || (n.kind === "prop" && PARTS[n.sku].chair === "cushion")
  || PARTS[n.sku].prop === "takibi"          // the fire pit's bridge / surface / coal bed / base plate
  || PARTS[n.sku].prop === "gs1000"          // the stove's canister
  || (n.kind === "ext" && n.host && !isSlide(PARTS[n.sku]))
  || (n.kind === "frame" && n.host));

/** Leg-height options. A frame sets its own; a hooked board is flush with its host, so this sets the
 *  whole run's. Self-contained IGTs and the Jikaro have fixed legs -- they get no height button. */
function fillLegs(box, n) {
  for (const p of BY_ROLE.leg)
    box.append(chip(`${p.height_mm}mm`, n.leg === p.sku,
      n.kind === "ext" ? "an extension is flush with what it hooks to — it takes the same legs, so "
        + "this sets them for the whole run" : p.title_en,
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
      ["net", "▦ 焼アミ Pro.L", "ST-032MAR", "484×352 stainless net — the same net the CK-160 takes"],
      ["halves", "▤▤ two half nets", "S-029HA", "339×206 half nets ×2 — also cross-listed on the CK-160"],
      ["plate", "▬ 鉄板", "GR-006", "500×330 black-steel griddle — its 500 IS the CK-160's 500"]])
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
    box.append(chip(n.canister ? "canister ✓ OD 缶" : "+ canister", !!n.canister,
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
  head.textContent = which === "legs" ? "leg height — sets the standing height"
                                      : `${PARTS[n.sku].title_en} — options`;
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
    return toolBtn(n.locked ? "unlock" : "lock",
      n.locked ? "unlock — free to slide along the rail" : "lock the slide position so it can't move", "wide",
      () => { n.locked = !n.locked; render(); });
  if (n.host != null)
    return toolBtn("detach", "pull it off — float it free to move or re-hook onto another edge", "wide",
      () => { detachNode(n); n.floating = true; n.locked = false; selectOnly(n.id); render();
              note("pulled off — drag it where you want, then lock it"); });
  const fixed = !!n.locked;
  return toolBtn(fixed ? "unlock" : (n.floating ? "place" : "lock"),
    fixed ? "unlock — float it to move it again"
      : (n.floating ? "place it — lock it down where it sits" : "lock it in place so a stray drag can't move it"),
    "wide",
    () => { if (fixed) { n.locked = false; n.floating = true; } else { n.locked = true; n.floating = false; } render(); });
}

function paintSelTools() {
  const n = sel();
  replaceMenu.hidden = true;   // any repaint (selection change, action) closes a stale popup
  toolPop.hidden = true;
  if (!n) { selTools.hidden = true; return; }
  selTools.innerHTML = "";
  // A multi-selection gets a compact toolbar: a count, duplicate-all (the free ones), delete-all.
  if (state.selSet.size > 1) {
    const count = document.createElement("span");
    count.className = "count"; count.textContent = `${state.selSet.size} selected`;
    selTools.append(count);
    selTools.append(toolBtn("⧉", "duplicate all  (Ctrl+D)", "", () => duplicateSelected()));
    selTools.append(toolBtn("⧉+", "save all of it as one block", "",
      () => { const name = prompt("name this block:", ""); if (name && name.trim()) saveBlock(name.trim()); }));
    const sep0 = document.createElement("span"); sep0.className = "sep"; selTools.append(sep0);
    selTools.append(toolBtn("✕", "delete all  (Del)", "danger", () => removeNode(n)));
  } else {
    // Placement first: is this thing floating, placed, locked, hooked? -- the leading decision.
    selTools.append(placementBtn(n));
    // This part's OWN controls, at the part: height, then whatever it can be configured into.
    if (legAdjustable(n) && PARTS[n.leg])
      selTools.append(toolBtn(`${PARTS[n.leg].height_mm}`, "leg height — sets the standing height", "wide",
        () => openToolPop("legs", n)));
    if (hasActions(n)) selTools.append(toolBtn("⚙", `${PARTS[n.sku].title_en} — options`, "", () => openToolPop("actions", n)));
    if (!n.host) {
      selTools.append(toolBtn("⟲", "rotate 90°  (R)", "", () => rotateNode(n)));
      selTools.append(toolBtn("⧉", "duplicate  (Ctrl+D)", "", () => duplicateNode(n)));
      // A block is a duplicate that outlives the session, so its button lives next to duplicate.
      selTools.append(toolBtn("⧉+", "save as a block — this and everything on it, kept by name", "",
        () => { const name = prompt("name this block:", ""); if (name && name.trim()) saveBlock(name.trim()); }));
    }
    if (replaceOptions(n).length > 1) selTools.append(toolBtn("⇄", "replace with a similar part", "", () => openReplaceMenu(n)));
    const sep = document.createElement("span"); sep.className = "sep"; selTools.append(sep);
    selTools.append(toolBtn("✕", "delete  (Del)", "danger", () => removeNode(n)));
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
  selTools.style.left = `${s.x}px`;
  selTools.style.top = `${Math.max(30, s.y - 14)}px`;
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
  head.textContent = `replace ${PARTS[n.sku].title_en} with:`;
  replaceMenu.append(head);
  for (const p of replaceOptions(n)) {
    if (p.sku === n.sku) continue;
    const row = document.createElement("div");
    row.className = "part";
    row.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span><span class="nm">${p.title_en}</span>`;
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
  modmenu.innerHTML = `<div class="mhead">${p.title_en}</div>`;
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
  del.className = "act del"; del.textContent = "× remove from frame";
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
function showPreview(p, rowEl) {
  const a = p.assembled_mm;
  const span = spanOf(p) ? `${spanOf(p) / 2}u` : "";
  preview.innerHTML =
    `<img src="img/${p.sku}.jpg" alt="">`
    + `<div class="pv-name">${p.title_en}</div>`
    + `<div class="pv-row"><span class="pv-sku">${p.sku}</span></div>`
    + (a ? `<div class="pv-row"><span>size</span><b>${a.w}×${a.d}×${a.h}mm</b></div>` : "")
    + (span ? `<div class="pv-row"><span>span</span><b>${span}</b></div>` : "")
    + (p.weight_g ? `<div class="pv-row"><span>weight</span><b>${(p.weight_g / 1000).toFixed(2)}kg</b></div>` : "");
  const img = preview.querySelector("img");
  img.onerror = () => { img.style.visibility = "hidden"; };
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
function wirePreview(row, p) {
  row.addEventListener("mouseenter", () => showPreview(p, row));
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
const EDGE_IFACES = new Set(["ext_table", "side_rail", "knob", "hearth"]);   // the edge menu; slot + hanging are placed via the slot menu

/** The interface ports a resolved edge exposes, read from connections.hosts (a frame splits its
 *  end from its rail; a Jikaro / Connection Table / a board's bracket expose all their edge ports). */
function portsAt(e) {
  const host = e.node;
  const ports = (CONN.hosts[host.sku] || CONN.hosts[PARTS[host.sku]?.role] || []).filter(p => p.iface !== "slot");
  // A frame and a self-IGT split their edges by position: an end carries the ET port, a long rail
  // carries the side_rail / hanging ports. Every other host (a board's bracket, LV-381, ST-050) has
  // one port per edge, so it needs no split.
  if (host.kind === "frame" || selfIgt(host.sku)) return ports.filter(p => (e.rail ? p.at === "rail" : p.at === "end"));
  // A host whose edges are NOT all alike splits them the same way, by the `at` the resolved edge
  // names. The Jikaro is the first: four outer sides that take boards, and one central aperture
  // that takes a fire -- and without this split the fire pit would be offered on the ring's OUTSIDE.
  if (e.at) return ports.filter(p => p.at === e.at);
  return ports;
}

// A hanging rack hooks OVER rails -- so it can go on anything that declares a `hanging` port
// (a frame, and now the Entry IGT), not just a literal frame.
const hostsHanging = n => (CONN.hosts[n.sku] || CONN.hosts[PARTS[n.sku]?.role] || []).some(p => p.iface === "hanging");

const partsForRole = role =>
  PARTS[role] ? [PARTS[role]]                          // a specific sku, e.g. LV-381 (the knob peer)
    : role === "sliding_extension" ? SLIDE_IN
    : role === "frame" ? BY_ROLE.frame
    : role === "slot_module" ? BY_ROLE.slot_module
    : role === "hanger" ? BY_ROLE.hang_rack
    : role === "hearth" ? BY_ROLE.hearth
    : HOOKABLE.filter(p => p.role === role);            // extension_table / corner

// Every part that attaches via ANY of the given interfaces -- the raw candidate list for a menu,
// read from connections.guests (legalOn then narrows the edge set with canAttach; the slot menu
// narrows by span/compat). One source of truth for "what attaches".
const guestsFor = ifaces => Object.entries(CONN.guests || {})
  .filter(([, g]) => ifaces.has(g.via)).flatMap(([role]) => partsForRole(role)).filter(Boolean);
const SLOT_IFACES = new Set(["slot", "hanging"]);

const adapterList = () => Object.values(CONN.adapters || {}).filter(a => a.from);
// Interface match, directly or bridged by an adapter. SCALE is NOT a gate here: a table-scale
// guest (a frame) MAY still join a board-scale port (a rail joint / a board's bracket) -- it just
// has to stand on its OWN legs there, because that port can't bear it. That's a warning, not a
// block (see boardScalePort + paintWarnings).
const canAttach = (guest, ports) => ports.some(port =>
  guest.via === port.iface
  || adapterList().some(a => a.from === port.iface && (a.to || []).includes(guest.via)));

function legalOn(e) {
  const ports = portsAt(e);
  const out = new Set();
  for (const [role, guest] of Object.entries(CONN.guests || {})) {
    if (!EDGE_IFACES.has(guest.via)) continue;         // hangers / modules go through the slot menu
    if (canAttach(guest, ports)) for (const p of partsForRole(role)) out.add(p);
  }
  return [...out].filter(Boolean).filter(p => fitsOpening(p, e));
}

/** An aperture admits what MEASURES inside it -- nothing else about it is a rule. This is the whole
 *  of "the big ring takes the Takibi and the small one doesn't": a Takibi Fire & Grill L is 455mm
 *  square, the spread opening is 600 and the compact one 365, so the arithmetic decides and no list
 *  has to be maintained. (The compact 365 is not left empty -- it takes the GS-1000 burner by the
 *  other route: bridge it with ST-051 and it IS a 1-Unit IGT bay, which GP-040 drops into.)
 *  Every other edge is untouched: only an opening measures its guest. */
function fitsOpening(p, e) {
  if (e.at !== "opening" || !e.opening) return true;
  const a = p.assembled_mm;
  return !!a && Math.max(a.w, a.d) <= e.opening;
}

// The ET port a hosted node occupies is BOARD-scale -- a rail joint's output, or a board's own
// bracket -- neither of which can bear a frame. A frame there must keep its own four legs.
function boardScalePort(n) {
  const h = byId(n.host);
  return !!h && (!!n.rail || h.kind === "ext");
}

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
      + `<span class="nm">${p.title_en}</span>`
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
      + `<span class="nm">${p.title_en}</span>`
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
  if (rulerTool && rulerDraft) { const at = hitPlane(0); if (at) rulerHover = groundSnap(at); return; }

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
      rebuild(); paint();
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
      render();
    }
    return;
  }

  const at = hitPlane(0);
  if (!at) return;
  // A whole multi-selection moves as one: every free member keeps its own offset from the pointer, so
  // their spacing is preserved. No detach, no edge snapping -- this is a MOVE of an arrangement you
  // already made, not an attempt to re-hook one part of it.
  if (dragGroup) {
    for (const m of dragGroup) {
      m.node.x = Math.round((at.x / MM + m.ox) / SNAP) * SNAP;
      m.node.z = Math.round((at.z / MM + m.oz) / SNAP) * SNAP;
    }
    render();
    return;
  }
  const nx = Math.round((at.x / MM + dragOff.x) / SNAP) * SNAP;
  const nz = Math.round((at.z / MM + dragOff.z) / SNAP) * SNAP;
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
  render();
});

addEventListener("pointerup", e => {
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

// ---------------------------------------------------------------- compatibility
//
// The manuals carry two kinds of rule, mined in parse_manuals.py, and they are NOT
// symmetric -- treating them the same is how you get one backwards:
//
//   BLACKLIST (非対応品番)  "these must NOT be attached; it will tip / it will not fit."
//                          A definite negative, with a physical reason. It does not expire:
//                          if it toppled in 2019 it topples now. Enforced HARD.
//
//   WHITELIST  (対応品番)   "attaches to these; nothing else is supported." Authoritative
//                          -- but only as of the manual's date. The corner whitelist names
//                          CK-149/CK-150 and omits the collapsible frames (CK-902/3/4),
//                          which have the IDENTICAL footprint and end holes and certainly
//                          do fit. So "not listed" is a CAUTION, not a block, and it is
//                          checked only after expanding through frame-equivalence.

const baseSku = sku => sku.replace(/-(US|INT|EC|R)$/i, "");

/** Two frames are interchangeable hosts if they have the same unit count -- established
 *  when the collapsible frames were confirmed to share the standard ones' footprint to the
 *  millimetre. So a whitelist that names one frame implies every frame of its size. */
function hostEquivalents(sku) {
  const p = PARTS[sku];
  const out = new Set([sku, baseSku(sku)]);
  if (p?.role === "frame" && p.units)
    for (const q of CAT.parts)
      if (q.role === "frame" && q.units === p.units) { out.add(q.sku); out.add(baseSku(q.sku)); }
  return out;
}

/** Is `guest` allowed onto `host`? -> { level: "ok" | "unlisted" | "blocked", why }.
 *  The manuals speak in base SKUs, so compare on those, and expand the host through
 *  frame-equivalence before judging a whitelist. */
function compat(guestSku, hostSku) {
  const g = PARTS[guestSku];
  if (!g || !hostSku) return { level: "ok" };
  const hosts = hostEquivalents(hostSku);

  const black = g.manual_incompatible_with;
  if (black) for (const bad of Object.keys(black))
    if (hosts.has(bad) || hosts.has(baseSku(bad)))
      return { level: "blocked", why: black[bad] || "the manual forbids this pairing" };

  const white = g.manual_compatible_with;
  if (white?.length) {
    const ok = white.some(w => hosts.has(w) || hosts.has(baseSku(w)));
    if (!ok) return {
      level: "unlisted",
      why: `its manual lists ${white.join(", ")} — not ${baseSku(hostSku)}. `
        + `That may just predate this part; check before trusting it.`,
    };
  }
  return { level: "ok" };
}

// ---------------------------------------------------------------- state ops

const HOOKS_ON = new Set(["extension_table", "corner"]);
// A sliding extension is a hooked node too (it hangs off a host edge, is not dragged), so it
// is kind "ext" -- but a rail-only one, offered on long edges and drawn as a cantilever.
const kindOf = p => (p.role === "frame" ? "frame"
  : p.role === "seating" || p.role === "hearth" ? "prop"   // a chair, or the fire pit: placed, not connected
  : p.role === "shelter" ? "footprint"            // a tent/tarp ground outline -- a scale reference
  : (HOOKS_ON.has(p.role) || isSlide(p)) ? "ext" : "table");

// A leg SET is two legs -- "Each purchase includes two legs", and the JP spec agrees
// (25mm dia x 840mm, 0.45kg x2). So a frame stands on four legs and needs TWO sets.
//
// An extension needs only ONE. Its hooked edge hangs off the host and carries no leg at
// all; the legs live under the far edge, in the brackets that also hold the holes the
// NEXT extension hooks into.
const LEG_SETS = { frame: 2, ext: 1, table: 0 };

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

/** Where a floating add lands: a clear spot in front of the layout (+z), staggered sideways by how
 *  many parts are already floating so a run of adds doesn't stack on one spot. Shared by addNode and
 *  the hover preview -- one source of truth for "where would this go". */
function floatSpot(n) {
  const others = state.nodes.filter(m => m.kind !== "footprint");
  const zFront = others.length ? Math.max(...others.map(m => aabb(m).z1)) : 0;
  const nFloat = state.nodes.filter(m => m.floating).length;
  return { x: nFloat * 700, z: zFront + footprint(n).d / 2 + 300, rot: 0 };
}
/** Where a footprint lands: centred on the whole layout's extent, or the origin on an empty canvas. */
function footprintSpot(n) {
  const others = state.nodes.filter(m => m.kind !== "footprint");
  if (!others.length) return { x: 0, z: 0, rot: 0 };
  const xs = others.flatMap(m => { const a = aabb(m); return [a.x0, a.x1]; });
  const zs = others.flatMap(m => { const a = aabb(m); return [a.z0, a.z1]; });
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, rot: 0 };
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

// ---- Drag to reconnect: detach a hooked part, float it, drop it onto another legal edge --------
// The ids of n and everything hanging off it -- a node can't be hooked to itself or its own guest.
function subtreeIds(n) {
  const ids = new Set([n.id]);
  for (let i = 0; i < 16; i++)
    for (const m of state.nodes) if (m.host != null && ids.has(m.host)) ids.add(m.id);
  return ids;
}
/** Cut a hooked node loose: it keeps its current position and becomes a free-standing root. */
function detachNode(n) {
  n.host = null;
  delete n.edge; delete n.rail; delete n.slide; delete n.step; delete n.sharedJoint;
}
/** Hook an EXISTING node onto a host edge (re-attach after a detach), like attach() but in place. */
function hookNode(n, host, key) {
  const slide = isSlide(PARTS[n.sku]);
  n.host = host.id;
  n.edge = key;
  n.rail = key.startsWith("rail");
  // A slide cantilevers and a pit in an aperture stands on its own feet -- neither takes a leg from
  // its host. Only something the host actually BEARS inherits the host's legs.
  n.leg = (slide || key === "opening") ? null : host.leg;
  if (n.rail) n.slide = slide ? initialSlide(host, key, n.sku) : 0;
  else delete n.slide;
}
/** The nearest edge a dragged node could legally hook onto, within a snap radius. Returns the host,
 *  the edge key, its world point, and whether it's already occupied (an occupied edge = insert). */
function findDropTarget(n) {
  const sub = subtreeIds(n), p = PARTS[n.sku];
  let best = null, bestD = 300;   // mm snap radius
  for (const h of state.nodes) {
    if (sub.has(h.id) || h.kind === "footprint") continue;
    for (const key of edgeKeysOf(h)) {
      const e = hostEdge(h, key);
      if (!e) continue;
      if (!legalOn({ ...e, node: h, key }).some(x => x.sku === p.sku)) continue;
      const a = rotv(e.anchor, h.rot);
      const wx = h.x + a.x, wz = h.z + a.z;
      const d = Math.hypot(n.x - wx, n.z - wz);
      if (d < bestD) {
        const occupied = state.nodes.some(m => m.id !== n.id && m.host === h.id && m.edge === key && !m.rail);
        // An occupied EDGE means insert: the run grows by one in the middle. An occupied APERTURE
        // just means full -- two fires do not go in one hole, and there is no "chain" to insert
        // into -- so it stops being a target at all.
        if (occupied && key === "opening") continue;
        bestD = d; best = { host: h, key, wx, wz, occupied };
      }
    }
  }
  return best;
}
let dropHint = null;

/** Drop a part onto an OCCUPIED edge -> insert it into the chain: it takes the edge, and whatever
 *  was there re-hosts onto the newcomer's far edge, so the run grows by one in the middle. */
function insertAt(n, host, key) {
  const occ = state.nodes.find(m => m.id !== n.id && m.host === host.id && m.edge === key && !m.rail);
  hookNode(n, host, key);
  if (!occ) return;
  const farKey = edgeKeysOf(n).find(k => {
    const e = hostEdge(n, k);
    return e && legalOn({ ...e, node: n, key: k }).some(x => x.sku === occ.sku);
  });
  if (farKey) hookNode(occ, n, farKey);
  else detachNode(occ);   // nowhere on the newcomer for it -> leave it floating rather than overlap
}

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
  state.rulers.push({ id: rulerSeq++, a: rulerDraft, b: p });
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
      del.textContent = "×"; del.title = "remove this measurement";
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
function rootOf(n, depth = 0) {
  if (n.kind !== "ext" || depth > 16) return n;
  const h = byId(n.host);
  return h ? rootOf(h, depth + 1) : n;
}

// A hanging rack is a hanger with a span: it occupies slots (2U) but hangs below the frame
// rather than dropping into it. CK-220 (two tiers), CK-230 (one tier, its own surface).
const isHangRack = p => p?.role === "hanger" && p?.span;
const hasHangRack = n => n.placements.some(pl => isHangRack(PARTS[pl.sku]));

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

/** The maximal run of contiguous FREE half-slots that CONTAINS `cell` -- extended BOTH ways
 *  to the next occupied cell or the frame's end. This is the real space available at a slot;
 *  counting only forwards said "0.5u" next to a half-unit even with a clear unit to its left. */
function freeBlock(n, cell) {
  const cells = occupancy(n);
  if (cells[cell]) return null;
  let lo = cell, hi = cell;
  while (lo > 0 && !cells[lo - 1]) lo--;
  while (hi < cells.length - 1 && !cells[hi + 1]) hi++;
  return { lo, hi, len: hi - lo + 1 };
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
};
const searchKey = p => `${p.sku} ${p.title_en || ""} ${CAT_WORDS[p.role] || p.role || ""}`.toLowerCase();

function partRow(p, fn, dead, why) {
  const el = document.createElement("div");
  el.className = "part" + (dead ? " dead" : "");
  const s = spanOf(p);
  el.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
    + `<span class="nm">${p.title_en}</span>`
    + `<span class="sp">${s ? s / 2 + "u" : ""}</span>`;
  el.title = why || `${p.sku} — ${p.title_en}`;
  el.dataset.search = searchKey(p);
  if (!dead) { el.onclick = () => fn(p); previewOnHover(el, p.sku); }
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
  const add = $("add"); add.innerHTML = "";
  for (const p of BY_ROLE.frame) {
    const c = chip(`${p.units}u${p.collapsible ? " ⤢" : ""}`, false, p.title_en, () => addNode(p.sku));
    c.dataset.search = searchKey(p);
    previewOnHover(c, p.sku);
    add.append(c);
  }

  // Extensions & corners: the hook-on boards. Since float-first, "add" no longer needs a free edge --
  // the board comes in floating and you drag it onto an edge (or use an edge's own + menu to hook it
  // straight on). So the rows are always live; the tooltip just says which.
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

  // Tables: the free-standing surfaces (layout tables + all-in-one IGTs like the Entry).
  const tab = $("tables"); tab.innerHTML = "";
  for (const p of [...BY_ROLE.layout_table, ...BY_ROLE.standalone])
    tab.append(partRow(p, () => addNode(p.sku), false));

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
        nm.textContent = PARTS[n.sku].title_en || n.sku;
        nm.title = "select this footprint (works even when the layer is locked)";
        nm.onclick = () => { state.sel = n.id; render(); };
        const del = document.createElement("span");
        del.className = "del"; del.textContent = "×";
        del.title = "remove this footprint";
        del.onclick = (e) => { e.stopPropagation(); removeNode(n); };
        row.append(sw, nm, del);
        shel.append(row);
      }
    }
  }

  const n = sel();

  const mods = $("modules"); mods.innerHTML = "";
  // Any node with a bay hosts slot modules (frame, bridged Jikaro, opened Extension IGT); a hanging
  // rack hooks over RAILS, so it goes on any host that declares a `hanging` port (a frame or the
  // Entry IGT), not just a literal frame.
  const host = n && hasBay(n) ? n : null;
  const railHost = host && hostsHanging(host) ? host : null;
  for (const p of BY_ROLE.slot_module) {
    const c = host ? compat(p.sku, host.sku) : { level: "ok" };
    const dead = !host || firstFit(host, p.span) < 0 || c.level === "blocked";
    const why = c.level === "blocked" ? `${p.sku} — ${c.why}`
      : c.level === "unlisted" ? `${p.sku} — ${c.why}` : null;
    const row = partRow(p, () => placeModule(p.sku), dead, why);
    if (c.level === "unlisted" && !dead) row.classList.add("caution");
    mods.append(row);
  }

  // Hanging racks occupy 2U of the grid but hang BELOW the frame instead of sitting in it.
  // One per frame -- their side frames collide otherwise (both manuals say so). So they are
  // dead if the frame already has one, or if 2U will not fit.
  for (const p of BY_ROLE.hang_rack) {
    const dead = !railHost || hasHangRack(railHost) || firstFit(railHost, p.span) < 0;
    mods.append(partRow(p, () => placeModule(p.sku), dead,
      dead && railHost && hasHangRack(railHost)
        ? `${p.sku} — one hanging rack per host; the side frames would collide.`
        : `${p.sku} — hangs a ${p.tiers === 2 ? "two-tier" : "one-tier"} rack under 2U of the rails.`));
  }

  $("selname").textContent = n ? PARTS[n.sku].title_en : "nothing selected";
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
function filterPalette() {
  const q = ($("palsearch").value || "").trim().toLowerCase();
  $("palette").classList.toggle("searching", !!q);
  let shown = 0;
  for (const id of ["add", "extensions", "tables", "seating", "shelters", "legs", "modules"]) {
    const host = $(id); if (!host) continue;
    for (const el of host.children) {
      const searchable = el.dataset.search != null;
      const match = !q || (searchable && el.dataset.search.includes(q));
      el.style.display = match ? "" : "none";
      if (q && match && searchable) shown++;
    }
  }
  for (const cat of document.querySelectorAll("#palette .cat")) {
    const hit = [...cat.querySelectorAll("[data-search]")].some(el => el.style.display !== "none");
    cat.classList.toggle("empty", !!q && !hit);
  }
  const cnt = $("searchcount");
  cnt.hidden = !q;
  if (q) cnt.textContent = `${shown} match${shown === 1 ? "" : "es"}`;
}
$("palsearch").addEventListener("input", filterPalette);

// Collapse / expand a library category by clicking its header.
for (const h of document.querySelectorAll(".cathead"))
  h.addEventListener("click", () => h.closest(".cat").classList.toggle("collapsed"));

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

function bomLines() {
  const lines = [];
  for (const n of state.nodes) {
    if (n.kind === "footprint") continue;   // a shelter is a size reference, not part of the IGT bill
    lines.push({ sku: n.sku, node: n });
    // A set is two legs. A frame stands on four -- unless it shares a CK-175 joint, in which
    // case the continuation drops the pair at the joined end and stands on two.
    const shared = n.host && n.kind === "frame" && n.sharedJoint;
    const sets = shared ? 1 : (LEG_SETS[n.kind] ?? 0);
    if (n.leg) for (let i = 0; i < sets; i++)
      lines.push({ sku: n.leg, req: n.kind === "ext" });
    // Hooked onto the frame's long rail: a wire-hook board hangs from a pair of rail joints.
    // A sliding extension does not -- its own brackets grip the rail -- so it needs none.
    if (n.rail && !isSlide(PARTS[n.sku]) && PARTS[RAIL_JOINT]) lines.push({ sku: RAIL_JOINT, req: true });
    // Two frames end to end: CK-175 is what turns one end into a hook. Sold as a pair
    // (本体x2), and an end has two holes -- so one set makes one joint.
    if (n.host && n.kind === "frame" && PARTS[FRAME_HOOK])
      lines.push({ sku: FRAME_HOOK, req: true });
    if (n.kind === "frame") {
      const rails = PARTS[n.sku].requires_rails;
      if (rails && PARTS[rails]) lines.push({ sku: rails, req: true });
    }
    // The Takibi's options are real parts on a real bill, though none is ever a node: the bridge
    // can't stand alone (its manual forbids it), the coal bed and base plate have no position that
    // isn't the Takibi's, and a cooking surface only exists on the bridge.
    if (PARTS[n.sku].prop === "takibi") {
      if (n.bridge) lines.push({ sku: "ST-032GBR", req: true });
      if (n.bridge && n.surface)
        for (const sku of ({ net: ["ST-032MAR"], plate: ["GR-006"], halves: ["S-029HA", "S-029HA"] }[n.surface] || []))
          if (PARTS[sku]) lines.push({ sku, req: true });
      if (n.coal) lines.push({ sku: "ST-032S", req: true });
      if (n.base) lines.push({ sku: "ST-032BP", req: true });
    }
    // The optional Jikaro bridge is a real SKU on the table's bill, though never its own node.
    if (isJikaro(n) && n.bridge) {
      const b = jikaroCfg(n).bridge_sku;
      if (b) lines.push({ sku: b, req: true });
    }
    // Modules dropped into any host's bay (frame, bridged Jikaro, opened Extension IGT).
    for (const pl of n.placements || []) {
      lines.push({ sku: pl.sku, node: n, pl });
      // A module's chosen surface is a part you BUY -- the CK-160's nets come in the box, but the
      // half nets (S-029HA x2) and the 鉄板 (GR-006) do not, and Snow Peak lists both on its page.
      for (const sku of BBQ_SURFACE_SKUS[pl.config] || [])
        if (PARTS[sku]) lines.push({ sku, req: true });
    }
    const conn = PARTS[n.sku].requires_connector;
    if (conn && PARTS[conn]) lines.push({ sku: conn, req: true });
  }
  // One step joint per LEGAL (one-rung) height change between touching tables. A skip of more
  // than one rung is not a thing a CK-151 can bridge, so it gets a warning, not a part.
  for (const [a, b] of steps()) {
    const hi = topOf(a) >= topOf(b) ? a : b, lo = hi === a ? b : a;
    if (legRung(hostLegOf(lo)) - legRung(hostLegOf(hi)) === 1) lines.push({ sku: "CK-151", req: true });
  }
  return lines;
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
  const t = $("bomtable"); t.innerHTML = "";
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
      + `<td class="nm" title="${p.sku} — ${p.title_en}">${lead}${p.title_en}</td>`
      + `<td class="p">${p.weight_g ? kg.toFixed(1) + " kg" : "—"}</td>`;
    t.append(tr);
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
    <div class="row big"><span>you carry</span><b>${kg.toFixed(1)} kg</b></div>
    <div class="row"><span></span><b class="alt">${(kg * 2.20462).toFixed(1)} lb</b></div>`;
}

function paintWarnings() {
  const w = $("warnings"); w.innerHTML = "";
  const add = (msg, cls = "warn") => {
    const d = document.createElement("div");
    d.className = cls; d.textContent = msg; w.append(d);
  };

  // A board that has been dragged off its host and not yet dropped onto another edge.
  for (const n of state.nodes)
    if (n.kind === "ext" && n.host == null)
      add(`${PARTS[n.sku].title_en} is detached — a hook-on board can't stand on its own. `
        + `Drag it onto a highlighted edge to reconnect, or delete it.`, "warn");

  for (const [a, b] of steps()) {
    const hi = topOf(a) >= topOf(b) ? a : b, lo = hi === a ? b : a;
    const rungs = legRung(hostLegOf(lo)) - legRung(hostLegOf(hi));   // how far DOWN the ladder
    const names = `${PARTS[a.sku].title_en} and ${PARTS[b.sku].title_en}`;
    if (rungs === 1)
      add(`${names} meet one step apart (${topOf(hi)} vs ${topOf(lo)}mm) — an IGT Height Adjuster `
        + `(CK-151) bridges it. Added.`, "warn info");
    else if (rungs > 1)
      add(`${names} meet ${topOf(hi)} vs ${topOf(lo)}mm — that is ${rungs} steps, and a Height `
        + `Adjuster only bridges ONE. Put them at adjacent heights, or chain a table between.`, "warn");
    else
      add(`${names} meet at different heights (${topOf(hi)} vs ${topOf(lo)}mm), off the standard `
        + `ladder — a Height Adjuster may not fit. Check the heights.`, "warn");
  }

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

  for (const n of state.nodes) {
    if (n.kind !== "frame") continue;
    const used = occupancy(n).filter(Boolean).length;
    if (used === slotsOf(n)) add(`${PARTS[n.sku].title_en}: full, ${used}/${slotsOf(n)} half-slots.`, "warn info");
  }

  // A frame joined at a BOARD-scale port (a rail joint, or a board's bracket) can't lean on that
  // joint for support -- it stands on its own four legs. Fine by default; a warning if the user has
  // dropped a pair (shared joint), because then it has nothing to hold it up.
  for (const n of state.nodes) {
    if (n.kind !== "frame" || !n.host || !boardScalePort(n)) continue;
    const where = n.rail ? "a rail joint" : "a board's bracket";
    if (n.sharedJoint)
      add(`${PARTS[n.sku].title_en} joins via ${where}, which can't bear a frame — give it back its `
        + `four legs (drop the shared joint) or it has nothing to stand on.`);
    else
      add(`${PARTS[n.sku].title_en} joins via ${where}; that joint isn't load-bearing, so it keeps `
        + `its own four legs.`, "warn info");
  }

  // What the MANUALS say about a pairing, made to speak. A module against its host frame,
  // and a hooked board against the root frame it hangs from. Blacklisted -> the manual
  // forbids it (it should not be here at all -- the palette blocks it -- but a saved layout
  // or a data change could reintroduce it, so check). Unlisted -> the whitelist predates
  // this host; a caution in the manual's own words, not an error.
  const seen = new Set();
  const flag = (guest, hostSku, label) => {
    const c = compat(guest.sku, hostSku);
    if (c.level === "ok") return;
    const key = guest.sku + ">" + hostSku;
    if (seen.has(key)) return;
    seen.add(key);
    const g = PARTS[guest.sku].title_en, h = PARTS[hostSku]?.title_en || hostSku;
    if (c.level === "blocked")
      add(`${g} must NOT go on ${h}: ${c.why}`);
    else
      add(`${g} on ${h}: ${c.why}`, "warn info");
  };
  for (const n of state.nodes) {
    if (n.kind === "frame") for (const pl of n.placements) flag(PARTS[pl.sku], n.sku);
    if (n.host) flag(PARTS[n.sku], rootOf(n).sku);
  }

  // Two frames end to end. Their end pieces butt -- 49.4mm each, so the joint eats 99mm --
  // and the unit grid does NOT carry across it. Nothing can be placed spanning the seam,
  // and the planner shows that by giving each frame its own slots, but say it out loud.
  const joined = state.nodes.filter(n => n.kind === "frame" && n.host);
  for (const n of joined) {
    const h = byId(n.host);
    add(`${PARTS[h.sku].title_en} + ${PARTS[n.sku].title_en} joined end to end with an `
      + `IGT Connection Hook. Their end pieces take up ~99mm at the seam, so the unit grid `
      + `does not run through it — no module spans the joint.`, "warn info");
  }

  // What the run actually does. A corner turns it 90°, an angle extension 60° -- measured
  // off the plan views, not read off a name: the two are filed under the same role and only
  // the angle between their hook edge and their bracket edge tells them apart.
  const turns = state.nodes.filter(n => n.kind === "ext" && (TEXTURES[n.sku]?.turn ?? 0) !== 0);
  if (turns.length) {
    const total = turns.reduce((a, n) => a + TEXTURES[n.sku].turn, 0);
    const parts = turns.map(n => `${TEXTURES[n.sku].turn > 0 ? "+" : ""}${TEXTURES[n.sku].turn}°`);
    add(`The run turns ${parts.join(" ")} = ${total > 0 ? "+" : ""}${total}° in total`
      + (Math.abs(total) === 360 ? " — it closes." : "."), "warn info");
  }
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
    + `<span class="nm" title="${p.title_en}">${p.title_en}</span>`;
  // Shift / Ctrl / Cmd click adds/removes from the selection; a plain click selects just this one.
  // (A module row has no object of its own, so it just selects its host frame.)
  row.onclick = e => { (!module && (e.shiftKey || e.ctrlKey || e.metaKey)) ? toggleInSel(n.id) : selectOnly(n.id); render(); };
  row.onmouseenter = () => setHoverNode(n.id);           // light up the object in the 3D view
  row.onmouseleave = () => { if (hoverNodeId === n.id) setHoverNode(null); };
  const del = document.createElement("span");
  del.className = "del"; del.textContent = "×";
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
    selLine = `${PARTS[n.sku].title_en}  <b>${size}</b>`;
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

function paint() { paintPalette(); paintSlots(); paintBOM(); paintWarnings(); paintSelTools(); paintOutliner(); paintDimHud(); paintTransform(); paintBlocks(); paintRulers(); }

// ---------------------------------------------------------------- saving a layout
//
// A FILE IS NOT A SNAPSHOT. `snapshot()` below stringifies the nodes verbatim, and for undo that is
// exactly right -- it never leaves the session, so nothing it captures can drift. A saved layout
// outlives both the session and the CATALOG, and the moment it does, every DERIVED field frozen in
// it becomes a lie that draws.
//
// This is not hypothetical; it is a bug I proved in the console. `kind` comes from `kindOf(role)`.
// The GS-1000's role changed accessory -> hearth, so a file written the day before says
// `kind: "table"` -- and it loads, and it silently draws the stove as a one-mesh tabletop slab at
// the right size, which is the worst kind of wrong. So the file stores INTENT and nothing else:
//
//   INTENT   what you chose ....... sku, which port (host + edge), where a FREE thing stands,
//                                   the leg, the rungs, the slide, the config and the toggles
//   DERIVED  what follows .......... kind (from role), rail (from edge), and x/z/rot of anything
//                                   HOOKED -- place() recomputes those from its host every render
//
// The planner already says this about position: "HOOKED -- x/z/rot are DERIVED, never stored as
// intent". A file has no excuse to disagree with the model it came from.
const SAVE_V = 1;
// Everything a node carries that is a DECISION. Anything absent from a node is simply left out.
const INTENT = ["sku", "host", "edge", "leg", "legFinish", "floating", "locked", "step", "slide",
                "config", "sharedJoint", "bridge", "surface", "coal", "base", "canister", "placements"];

/** The scene as a plain object -- intent only. `sel` is not saved: a selection is not a design. */
function serializeLayout(nodes = state.nodes) {
  const doc = {
    app: "igt-planner", v: SAVE_V,
    nodes: nodes.map(n => {
      const o = {};
      o.i = n.id;
      for (const k of INTENT) if (n[k] !== undefined && n[k] !== null) o[k] = n[k];
      // Only a FREE node's position is a decision. A hooked one is wherever its host's edge puts it.
      if (n.host == null) { o.x = n.x; o.z = n.z; o.rot = n.rot; }
      return o;
    }),
  };
  // Measurements belong to the whole scene, not to any node -- so they ride along only on a full-scene
  // save, never when serializeLayout is asked for a subset (a saved block is parts, not annotations).
  if (nodes === state.nodes && state.rulers.length)
    doc.rulers = state.rulers.map(r => ({ a: { x: r.a.x, z: r.a.z }, b: { x: r.b.x, z: r.b.z } }));
  return doc;
}

/** Rebuild the scene from a saved object. Returns {nodes, nextId, dropped[]} without touching state,
 *  so a caller can look before it leaps. A part that has left the catalog is DROPPED and named --
 *  never silently, and never as a mystery box. */
function readLayout(doc) {
  if (!doc || doc.app !== "igt-planner") throw new Error("not an IGT layout file");
  if (!(doc.v <= SAVE_V)) throw new Error(`layout is version ${doc.v}; this planner reads up to ${SAVE_V}`);
  const dropped = [], keep = new Map();
  for (const o of doc.nodes || []) {
    if (!PARTS[o.sku]) { dropped.push(o.sku); continue; }
    keep.set(o.i, o);
  }
  const nodes = [];
  for (const o of keep.values()) {
    const p = PARTS[o.sku];
    const n = { id: o.i, sku: o.sku, placements: [], x: 0, z: 0, rot: 0, leg: null };
    for (const k of INTENT) if (o[k] !== undefined) n[k] = o[k];
    if (o.x !== undefined) { n.x = o.x; n.z = o.z; n.rot = o.rot; }
    // DERIVED, recomputed here rather than trusted from the file -- the whole point of the format.
    n.kind = kindOf(p);
    n.host = keep.has(o.host) ? o.host : null;      // host dropped -> this becomes a free node
    if (n.host == null) delete n.edge;
    n.rail = !!(n.edge && n.edge.startsWith("rail"));
    // A module whose SKU has gone is dropped the same way, and said out loud.
    n.placements = (n.placements || []).filter(pl => {
      if (PARTS[pl.sku]) return true;
      dropped.push(pl.sku); return false;
    });
    nodes.push(n);
  }
  const nextId = Math.max(0, ...nodes.map(n => n.id)) + 1;
  // Measurements get fresh session ids (the file stores only the two points). Coerced to numbers so
  // a hand-edited or older file can't smuggle a NaN into the geometry.
  const rulers = (doc.rulers || [])
    .filter(r => r?.a && r?.b)
    .map(r => ({ id: rulerSeq++, a: { x: +r.a.x || 0, z: +r.a.z || 0 }, b: { x: +r.b.x || 0, z: +r.b.z || 0 } }));
  return { nodes, nextId, dropped: [...new Set(dropped)], rulers };
}

/** Put a read layout on screen. */
function loadLayout(doc) {
  const { nodes, nextId, dropped, rulers } = readLayout(doc);
  state.nodes = nodes; state.nextId = nextId; state.rulers = rulers;
  selectOnly(null);
  undoStack.length = 0; redoStack.length = 0;      // a new document has no past
  render();
  if (dropped.length) note(`left out ${dropped.length} part(s) no longer in the catalog: ${dropped.join(", ")}`);
  return dropped;
}

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
let autoTimer = null;
function autosave() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    commitActivePage();
    lsPut(LS_PAGES, book);
    lsPut(LS_SCENE, activePage()?.doc);
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
  commitActivePage();                 // save what's on screen into the page we're leaving
  book.activeId = id;
  const p = activePage(); if (!p) return;
  loadLayout(p.doc);                  // loadLayout resets undo + selection: a page opens as its own document
  lsPut(LS_PAGES, book); lsPut(LS_SCENE, p.doc);
  paintPager();
  note(`opened "${p.name}"`);
}
function newPage(name) {
  commitActivePage();
  const id = pageSeq++;
  const doc = { app: "igt-planner", v: SAVE_V, nodes: [] };
  book.pages.push({ id, name: name || `Page ${book.pages.length + 1}`, doc });
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
    tab.ondblclick = () => { const nn = prompt("rename this page:", p.name); if (nn && nn.trim()) renamePage(p.id, nn.trim()); };
    // No delete on the last page: a book always has at least one page.
    if (book.pages.length > 1) {
      const x = document.createElement("span");
      x.className = "pclose"; x.textContent = "×"; x.title = "delete this page";
      x.onclick = ev => { ev.stopPropagation(); if (confirm(`Delete page "${p.name}"? This can't be undone.`)) deletePage(p.id); };
      tab.append(x);
    }
    el.append(tab);
  }
  const add = document.createElement("button");
  add.className = "padd"; add.textContent = "+"; add.title = "new page — a fresh, independent design";
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
  loadLayout(doc);
  note(`opened "${name}"`);
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
    try { loadLayout(JSON.parse(await f.text())); note(`opened ${f.name}`); }
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
  const json = new TextEncoder().encode(JSON.stringify(serializeLayout()));
  const gz = await pipe(json, new CompressionStream("gzip"));
  const url = `${location.origin}${location.pathname}#d=${b64u(gz)}`;
  // A link nobody can paste is not a share. Say the number rather than discover it later.
  if (url.length > 8000) return note(`this layout is too big for a link (${(url.length / 1000).toFixed(1)}k) — export the file instead`, 6000);
  try { await navigator.clipboard.writeText(url); note(`link copied (${url.length} chars) — it carries the whole design, no server involved`, 5000); }
  catch { prompt("copy this link:", url); }
}
async function fromHash() {
  const m = /[#&]d=([^&]+)/.exec(location.hash);
  if (!m) return false;
  try {
    const raw = await pipe(unb64u(m[1]), new DecompressionStream("gzip"));
    loadLayout(JSON.parse(new TextDecoder().decode(raw)));
    note("opened from a shared link — it is yours now; save or export to keep it", 5000);
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

  head("this layout");
  row("Save as…", "keeps it in this browser", () => {
    const name = prompt("name this layout:", "");
    if (name && name.trim()) saveNamed(name.trim());
  });
  row("Export a file…", "the copy that outlives this browser", exportFile);
  row("Import a file…", "", importFile);
  row("Start over", "", () => {
    if (state.nodes.length && !confirm("clear the layout?")) return;
    state.nodes = []; state.nextId = 1; selectOnly(null);
    undoStack.length = 0; redoStack.length = 0; render();
  });

  head(names.length ? "in this browser" : "nothing saved in this browser yet");
  for (const n of names) {
    const at = (all[n].at || "").slice(0, 10);
    const r = row(n, `${(all[n].nodes || []).length} parts · ${at}`, () => openNamed(n));
    const x = document.createElement("button");
    x.className = "fdel"; x.textContent = "×"; x.title = "forget this one";
    x.onclick = e => { e.stopPropagation(); if (confirm(`forget "${n}"?`)) deleteNamed(n); };
    r.append(x);
  }
  if (names.length) {
    const w = document.createElement("div");
    w.className = "fnote";
    // Say the true thing where the word "save" is, not in a help page nobody opens.
    w.textContent = "These live in this browser only — clearing site data deletes them. Export to keep one for real.";
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
$("sharebtn").onclick = shareLink;
addEventListener("pointerdown", e => { if (!fileMenu.hidden && !fileMenu.contains(e.target)) fileMenu.hidden = true; }, true);

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
    x.className = "fdel"; x.textContent = "×"; x.title = "forget this block";
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
const snapshot = () => JSON.stringify({ nodes: state.nodes, nextId: state.nextId, rulers: state.rulers });
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

// ---------------------------------------------------------------- theme
// Light / dark, persisted. The panels are pure CSS variables; the 3D canvas follows by
// reading the resolved --scene and --line off :root, so one palette drives both.
const THEME_KEY = "igt-theme";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const css = getComputedStyle(document.documentElement);
  const val = (v, d) => css.getPropertyValue(v).trim() || d;
  scene.background = new THREE.Color(val("--scene", "#14161a"));
  // Grid lines: faint on either ground. Baked into the geometry, so rebuild on change.
  if (t === "light") setGrid(0xc2c7cf, 0xd8dbe1);
  else setGrid(0x2b3038, 0x21252b);
  $("theme").textContent = t === "light" ? "☀" : "☾";   // sun / moon
}
function initTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
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
  for (const [key, g] of Object.entries(GROUNDS)) {
    const o = document.createElement("option");
    o.value = key; o.textContent = g.name;
    sel.append(o);
  }
  sel.onchange = () => setGround(sel.value);
  // Textures are generated lazily on first pick, so an empty canvas costs nothing until it is used.
  setGround(localStorage.getItem(LS_GROUND) || "grid");
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
  stepCamTween();
  controls.update();
  followHover();
  followSelTools();
  followRulers();
  renderer.render(scene, camera);
})();

CAT = await (await fetch("../catalog/igt-catalog.json")).json();
COLORS = (await (await fetch("../catalog/colors.json")).json()).colors;
TEXTURES = (await (await fetch("../catalog/textures.json")).json()).textures;
FRAMES = (await (await fetch("../catalog/frame_fittings.json")).json()).frames;
// The rail in cross-section, measured off CK-149. Same for every frame in both
// families: the collapsible ones have identical footprints (846x496, 1096x496) and
// differ only in thickness (28 vs 30mm) and weight.
SECTION = FRAMES["CK-149"].section;
GRID = CAT.grid;
LAYOUT = CAT.layout;
CONN = CAT.layout.connections || { interfaces: {}, hosts: {}, guests: {}, adapters: {} };
HALF = GRID.half_unit_mm;
PARTS = Object.fromEntries(CAT.parts.map(p => [p.sku, p]));

for (const p of CAT.parts) {
  if (p.role !== "frame") continue;
  const rails = `${p.sku}-1`;
  if (PARTS[rails]) { p.requires_rails = rails; p.collapsible = true; }
}

// Excluded parts are real products that are OUT OF SCOPE for a portable-kit planner -- the
// Takibi Garden tables and the Garden Unit Table are fixed garden furniture, assembled in
// place. They stay in the catalog (flagged, with a reason) so the record is honest, but the
// planner does not offer them. Filtering here means every list below inherits it -- palette,
// hookable set, and the unsourced list all -- without each having to remember.
const inScope = CAT.parts.filter(p => !p.excluded);
const by = r => inScope.filter(p => p.role === r);

// What can hook: the copy says hook_on AND the photograph says where the hooks are. Both,
// because the planner needs to know both THAT it hooks and WHICH EDGE hooks. A part with
// only the first is honestly unplaceable, and is listed as such rather than guessed at.
const hookRoles = p => HOOKS_ON.has(p.role) && p.assembled_mm;
HOOKABLE = inScope.filter(p => hookRoles(p) && p.attach === "hook_on"
  && TEXTURES[p.sku]?.hooks_mm?.length);
// The sliding extensions -- offered on frame LONG rails only. No measured hooks needed: they
// mount by their brackets along a whole edge, which hookGeometry supplies synthetically.
SLIDE_IN = inScope.filter(p => isSlide(p) && p.assembled_mm);

BY_ROLE = {
  frame: by("frame").filter(p => p.units).sort((a, b) => a.units - b.units),
  leg: by("leg").filter(p => p.height_mm).sort((a, b) => a.height_mm - b.height_mm),
  slot_module: by("slot_module").filter(p => p.span && p.assembled_mm)
    .sort((a, b) => a.span - b.span || a.title_en.localeCompare(b.title_en)),
  hang_rack: by("hanger").filter(p => p.span && p.assembled_mm)
    .sort((a, b) => (a.tiers || 0) - (b.tiers || 0)),
  layout_table: by("layout_table").filter(p => p.assembled_mm),
  standalone: by("standalone").filter(p => p.assembled_mm),
  seating: by("seating").filter(p => p.assembled_mm),
  hearth: by("hearth").filter(p => p.assembled_mm),
  shelter: by("shelter").filter(p => p.geometry)
    .sort((a, b) => (a.shelter_type || "").localeCompare(b.shelter_type || "") || a.title_en.localeCompare(b.title_en)),
  unsourced: inScope.filter(p => hookRoles(p) && !HOOKABLE.includes(p)),
};


// A way in from the console. Being able to put the camera straight overhead is how you
// check a silhouette; orbiting by hand and squinting is how you convince yourself.
window.__igt = { THREE, scene, camera, controls, state, PARTS, TEXTURES, render,
  openEdges, hookNormal, bracketNormal, turnOf, hostEdge, aabb, legalOn, portsAt, CONN,
  findDropTarget, hookNode, detachNode, insertAt, edgeKeysOf, selectedIds,
  serializeLayout, readLayout, loadLayout, saveNamed, openNamed, savedAll, blocksAll,
  saveBlock, addBlock, shareLink, exportFile,
  newPage, switchPage, deletePage, renamePage, pages: () => book,
  top() { camera.position.set(0.001, 3.6, 0.001); controls.target.set(0.6, 0.8, 0); } };

resize();
initTheme();
initGround();
paintFiles();

// WHAT YOU SEE WHEN YOU ARRIVE, most specific first:
//   a shared link   -- someone sent you a design; it becomes a fresh one-page book to branch from
//   your book       -- every page you had, and the one you were on; a reload loses nothing
//   a legacy scene  -- the single scene from before pages existed, migrated into page 1
//   a 4-unit frame  -- a blank page is not a starting point
(async () => {
  if (await fromHash()) { adoptAsBook("Shared"); return; }

  const savedBook = lsGet(LS_PAGES, null);
  if (savedBook?.pages?.length) {
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
  adoptAsBook("Page 1");
})();
