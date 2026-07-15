import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { materialFor, roundedBox, boardMaterial, grainMaterial } from "./materials.js";
import { moduleGroup, flatBoardGeo as flatGeo, frameGroup, tableGroup,
         jikaroGroup, jikaroBridge, hangRackGroup, slideExtGroup,
         entryIgtGroup, slimIgtGroup, extIgtGroup } from "./parts3d.js";

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

const TO_USD = { us: c => c / 100, jp: y => y / 157, uk: p => (p / 100) * 1.27 };

const $ = id => document.getElementById(id);

let CAT, GRID, LAYOUT, HALF, PARTS, BY_ROLE, COLORS, TEXTURES, FRAMES, HOOKABLE, SLIDE_IN, SECTION;
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
// The flat burner (GS-450R) shows its real top -- stainless well, brass head, ports, grate.
const burnerTop = sku => sku.startsWith("GS-450R") ? loadTex("tex/GS-450R_top.jpg") : null;

// Colours come from Snow Peak's product photography (catalog/colors.json). The swatch in
// the palette is the same colour the part is rendered in, so the two never drift.
const swatchOf = sku => COLORS[sku]?.color_hex || "#8a929c";

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
const state = { nodes: [], sel: null, nextId: 1 };

const byId = id => state.nodes.find(n => n.id === id);
const sel = () => byId(state.sel);

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

// Expandable self-contained tables (CK-090 Extension IGT): a config that changes footprint AND
// exposed unit-slots. Read lazily -- LAYOUT is fetched at boot, after these arrows are defined.
const expDef = sku => (LAYOUT.expandables || {})[sku];
const expCfg = n => { const e = expDef(n?.sku); return e && e.configs[n?.config || e.default]; };
const isExpandable = n => !!expDef(n?.sku);

function footprintOf(sku, kind, node) {
  const p = PARTS[sku];
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
  if (n.kind === "frame") {
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
  if (n.kind === "frame") {
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
  if (isJikaro(n) && JIKARO_EDGES[key]) {
    const c = jikaroCfg(n);
    const v = JIKARO_EDGES[key];
    // The hook engages the same depth in from the edge as it does on a frame -- 16.5mm --
    // because it is the SAME wire hook. That is a mechanical argument, not a measurement:
    // I have not measured the Jikaro's slots. Anchoring on the outer FACE instead leaves the
    // board's edge hanging 12mm clear of the table, which is what the first version did and
    // what a hook, by construction, does not do.
    const r = c.outer_mm / 2 - HOLE_INSET;
    return { anchor: { x: v.x * r, z: v.z * r }, normal: v, len: c.edge_mm };
  }
  return null;
}

const JIKARO_EDGES = {
  "jik+x": { x: 1, z: 0 }, "jik-x": { x: -1, z: 0 },
  "jik+z": { x: 0, z: 1 }, "jik-z": { x: 0, z: -1 },
};

const EDGE_KEYS = { frame: ["end+x", "end-x", "rail+z", "rail-z"], ext: ["bracket"], table: [] };
const edgeKeysOf = n => isJikaro(n) ? Object.keys(JIKARO_EDGES)
  : isSlide(PARTS[n.sku]) ? []                    // a sliding extension is a leaf -- nothing
                                                  // hooks onto it, and its phantom bracket
                                                  // edge was intercepting the click to drag it
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

const slotsOf = n => PARTS[n.sku].units * 2;
const runOf = n => PARTS[n.sku].units * 250;
const slotX = (n, i) => -runOf(n) / 2 + i * HALF;

function railW(p) {
  return p.along_rail_mm || (p.span ? p.span * HALF : (p.assembled_mm?.w ?? HALF));
}
function depthOf(p) {
  const a = p.assembled_mm;
  if (!a) return MODULE_SEAT;
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
scene.background = new THREE.Color(0x14161a);   // replaced by applyTheme() on boot

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
camera.position.set(1.6, 1.5, 2.1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.35, 0);

scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x33383f, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 3.4, 1.8);
scene.add(key);
// The floor grid. Its colours are baked into the geometry, so a theme change rebuilds it.
let grid = null;
function setGrid(major, minor) {
  if (grid) scene.remove(grid);
  grid = new THREE.GridHelper(8, 32, major, minor);
  scene.add(grid);
}
setGrid(0x2b3038, 0x21252b);

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
        new THREE.Color(swatchOf(n.leg)), 0.85, 0.3,
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

  // Modules: drawn at their OWN width, centred in the slots they claim. A tray 5mm
  // narrower than its unit shows a real gap; the Flat Burner's 20mm-wider rim really
  // does overlap the rails. Stretching parts to fill their allocation would hide it.
  for (const pl of n.placements) {
    const p2 = PARTS[pl.sku];
    const cx = slotX(n, pl.start) + (pl.span * HALF) / 2;

    // A hanging rack occupies the slots but hangs BELOW -- it is not a tray in the frame.
    if (isHangRack(p2)) { drawHangRack(g, n, pl, cx, top); continue; }

    const w = railW(p2), d = depthOf(p2), h = p2.assembled_mm?.h ?? 40;
    const y = top - h / 2;   // modules drop IN; nothing sits on the frame any more

    // Everything with a real 3D form comes from parts3d.js, so the part bench draws the
    // identical object. A burner, a wire mesh tray, a box or bin -- built once, shared.
    const built = moduleGroup(p2, w, d, h, swatchOf(p2.sku), burnerTop(p2.sku));
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
    const { group: bg } = jikaroBridge({ opening: c.opening_mm, units: c.bridge_units || 2 });
    bg.position.y = top * MM;
    bg.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(bg);
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

function drawTable(g, n) {
  if (isJikaro(n)) return drawJikaro(g, n);
  if (isSlide(n.sku ? PARTS[n.sku] : null)) return drawSlideExt(g, n);

  // The self-contained IGTs with their own fixed folding legs are built part by part
  // (parts3d.js). The builder draws the top at y=0 with the legs hanging below, so lift it to
  // the work-surface height; the node group g is already turned and placed.
  if (n.sku === "CK-080R" || n.sku === "CK-080R-EC" || n.sku === "CK-180" || n.sku === "CK-090") {
    const f = footprint(n), tp = topOf(n);
    let built;
    if (n.sku === "CK-090") {
      const c = expCfg(n);
      built = extIgtGroup(f.w, f.d, tp, { bayW: c?.bay_w_mm || 0, bayD: c?.bay_d_mm || 360 });
    } else {
      built = (n.sku === "CK-180" ? slimIgtGroup : entryIgtGroup)(f.w, f.d, tp);
    }
    built.group.position.y = tp * MM;
    built.group.traverse(o => { if (o.isMesh) { o.userData.node = n; nodeMeshes.push(o); } });
    g.add(built.group);
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
          new THREE.Color(swatchOf(legSku)), 0.85, 0.32,
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
      new THREE.Color(swatchOf(n.sku)), 0.85, 0.32,
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
    if (n.kind !== "frame" || !asm.has(n)) continue;
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

function rebuild() {
  build.clear();
  nodeMeshes.length = 0;
  slotMeshes.length = 0;
  edgeMeshes.length = 0;
  slotHandleMeshes.length = 0;

  for (const n of state.nodes) {
    const g = new THREE.Group();
    g.position.set(n.x * MM, 0, n.z * MM);
    g.rotation.y = -n.rot;
    (n.kind === "frame" ? drawFrame : drawTable)(g, n);
    build.add(g);
  }

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
addEventListener("keydown", e => { if (e.key === "Escape") { setHover(null); hideModMenu(); } });

// The action menu for a placed module -- reached by right-click or a left long-press, so a
// removal is a considered second click, not a twitchy one. Positioned at the pointer.
const modmenu = $("modmenu");
function showModMenu(node, pl, clientX, clientY) {
  const p = PARTS[pl.sku];
  modmenu.innerHTML = `<div class="mhead">${p.title_en}</div>`
    + `<div class="act del">× remove from frame</div>`;
  modmenu.querySelector(".act.del").onclick = () => { removePlacement(node, pl); hideModMenu(); };
  const sr = $("stage").getBoundingClientRect();
  modmenu.style.left = Math.max(4, Math.min(clientX - sr.left, sr.width - 172)) + "px";
  modmenu.style.top = Math.max(4, Math.min(clientY - sr.top, sr.height - 72)) + "px";
  modmenu.hidden = false;
}
const hideModMenu = () => { modmenu.hidden = true; };

// A menu row is a swatch, a name and a span — no room for the picture or the numbers.
// Passing over one opens a card beside the menu with the thumbnail (web/img/SKU.jpg) and
// the details: full name, sku, assembled size, price, weight.
const preview = $("preview");
const usd1 = p => (p.price?.us ? "$" + TO_USD.us(p.price.us).toFixed(0) : "");
function showPreview(p, rowEl) {
  const a = p.assembled_mm;
  const span = spanOf(p) ? `${spanOf(p) / 2}u` : "";
  preview.innerHTML =
    `<img src="img/${p.sku}.jpg" alt="">`
    + `<div class="pv-name">${p.title_en}</div>`
    + `<div class="pv-row"><span class="pv-sku">${p.sku}</span><b>${usd1(p)}</b></div>`
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
function legalOn(e) {
  // A frame's END: a hook-on board, or another frame (CK-175). A frame's long RAIL: hook-on
  // boards (via a rail joint) AND the sliding extensions (which grip the rail themselves).
  // Any other edge (a board's brackets, the Jikaro): hook-on boards only.
  if (e.node.kind === "frame" && !e.rail) return [...HOOKABLE, ...BY_ROLE.frame];
  if (e.rail) return [...HOOKABLE, ...SLIDE_IN];
  return HOOKABLE;
}

function paintMenu() {
  menu.innerHTML = "";
  const head = document.createElement("div");
  head.className = "mhead";
  head.textContent = hover.rail
    ? "onto the LONG rail — a board hooks on (via a rail joint), a sliding extension grips it and tiles"
    : hover.node.kind === "frame"
      ? "the frame's end: a board hooks into the holes, or another frame joins with a CK-175"
      : isJikaro(hover.node)
        ? `one of the fire ring's four outer edges (${Math.round(hover.len)}mm) — at the `
          + `400mm datum, so it takes low legs`
        : "hooks into the brackets on this edge";
  menu.append(head);

  // The host for a manual whitelist is the ROOT frame -- a corner's manual lists the frames
  // it goes on, whether it hooks the frame directly or another extension that is on one.
  const rootSku = rootOf(hover.node).sku;

  for (const p of legalOn(hover)) {
    const c = compat(p.sku, rootSku);
    if (c.level === "blocked") continue;   // the manual forbids it; do not even offer it

    const row = document.createElement("div");
    row.className = "part" + (c.level === "unlisted" ? " caution" : "");
    const usd = p.price?.us ? "$" + TO_USD.us(p.price.us).toFixed(0) : "";
    row.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
      + `<span class="nm">${p.title_en}</span>`
      + `<span class="sp">${c.level === "unlisted" ? "?" : usd}</span>`;
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

  const list = [...BY_ROLE.slot_module, ...BY_ROLE.hang_rack];
  let offered = 0;
  for (const p of list) {
    if (spanOf(p) > free) continue;                                      // wider than the run
    if (isHangRack(p) && hasHangRack(n)) continue;                        // one rack per frame
    const c = compat(p.sku, n.sku);
    if (c.level === "blocked") continue;

    const row = document.createElement("div");
    row.className = "part" + (c.level === "unlisted" ? " caution" : "");
    const usd = p.price?.us ? "$" + TO_USD.us(p.price.us).toFixed(0) : "";
    row.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
      + `<span class="nm">${p.title_en}</span>`
      + `<span class="sp">${c.level === "unlisted" ? "?" : usd}</span>`;
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
let dragNode = null, dragMod = null, dragSlide = null, longPress = null;
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
  hideModMenu();                      // any press elsewhere dismisses the module menu
  toPtr(e);
  ray.setFromCamera(ptr, camera);

  // Anything on the long rail -- a sliding extension OR a hook-on board -- is GRABBED to drag it
  // ALONG the rail. It sits on the rail, so the rail's own "add here" edge handle would otherwise
  // swallow the click; the board is the closer hit, so prefer it.
  const edge = ray.intersectObjects(edgeMeshes, false)[0];
  const slideHit = ray.intersectObjects(nodeMeshes, false)
    .find(h => { const nn = h.object.userData.node; return nn?.host && nn?.rail; });
  if (slideHit && (!edge || slideHit.distance <= edge.distance + 1)) {
    dragSlide = slideHit.object.userData.node;
    state.sel = dragSlide.id;
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
    state.sel = node.id;
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
  if (!nd) {                             // pressed empty space -> deselect (and drop its handles)
    if (state.sel != null) { state.sel = null; render(); }
    return;
  }
  const n = nd.object.userData.node;
  state.sel = n.id;
  // A hooked board hangs where its hooks are. Dragging it would be asking the model to
  // lie: it cannot be anywhere else. Select it, do not move it.
  if (!n.host) {
    dragNode = n;
    const at = hitPlane(0);
    if (at) dragOff.set(n.x - at.x / MM, 0, n.z - at.z / MM);
    controls.enabled = false;
  }
  // A sliding extension (also a hosted node) is handled up top -- it is grabbed before the
  // edge check so its rail handle cannot swallow the grab.
  render();
});

canvas.addEventListener("pointermove", e => {
  toPtr(e);
  ray.setFromCamera(ptr, camera);

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
  dragNode.x = Math.round((at.x / MM + dragOff.x) / SNAP) * SNAP;
  dragNode.z = Math.round((at.z / MM + dragOff.z) / SNAP) * SNAP;
  snapToNeighbours(dragNode);
  render();
});

addEventListener("pointerup", () => {
  clearTimeout(longPress);
  const wasDragging = dragNode || dragMod || dragSlide;
  dragNode = dragMod = dragSlide = null; controls.enabled = true;
  if (wasDragging) commitHistory();   // the drag is over -- snapshot its final position, once
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
  : (HOOKS_ON.has(p.role) || isSlide(p)) ? "ext" : "table");

// A leg SET is two legs -- "Each purchase includes two legs", and the JP spec agrees
// (25mm dia x 840mm, 0.45kg x2). So a frame stands on four legs and needs TWO sets.
//
// An extension needs only ONE. Its hooked edge hangs off the host and carries no leg at
// all; the legs live under the far edge, in the brackets that also hold the holes the
// NEXT extension hooks into.
const LEG_SETS = { frame: 2, ext: 1, table: 0 };

/** Put a free-standing node on the ground. */
function addNode(sku) {
  const p = PARTS[sku];
  const kind = kindOf(p);

  if (kind === "ext") {
    // A hook-on board cannot stand alone -- so "add" means "hook onto the first edge
    // that is free", starting with whatever is selected. If nothing has a free edge,
    // there is nowhere for it to go, and the palette row is dead anyway.
    for (const h of [sel(), ...state.nodes].filter(Boolean)) {
      const e = openEdges(h)[0];
      if (e) return attach(sku, h, e.key);
    }
    return;
  }

  const n = {
    id: state.nextId++, sku, kind, x: 0, z: 0, rot: 0,
    leg: kind === "frame" ? "CK-114" : null,
    placements: [],
    // Four pieces, two ways round. Default to the one Snow Peak publishes; no bridge yet.
    ...(sku === JIKARO ? { config: "long_in", bridge: false } : {}),
    // Expandable tables (CK-090) open to their default config.
    ...(expDef(sku) ? { config: expDef(sku).default } : {}),
  };
  // Land it flush against the right edge of what is already there. This is a layout
  // system -- tables connect. Dropping the new one in open space and making you drag
  // it into contact would be a worse default than the thing the system is for.
  const free = state.nodes.filter(m => m.kind !== "ext");
  const right = free.length ? Math.max(...free.map(m => aabb(m).x1)) : null;
  n.x = right === null ? 0 : right + footprint(n).w / 2;
  if (free.length) n.z = free[free.length - 1].z;
  state.nodes.push(n);
  state.sel = n.id;
  render();
}

/** Hook a board onto one specific edge of one specific host.
 *
 *  A board on the frame's LONG rail hangs from a rail joint, so the joint goes in the BOM.
 *  Two per board, and they come as a pair (XCK-128-01 is a 2-piece set) -- so one set. */
function attach(sku, host, key) {
  const slide = isSlide(PARTS[sku]);
  const n = {
    id: state.nextId++, sku, kind: kindOf(PARTS[sku]), host: host.id, edge: key,
    x: 0, z: 0, rot: 0, leg: slide ? null : host.leg, placements: [],
    rail: key.startsWith("rail"),
    // Anything on the long rail carries a slide offset so it can be dragged ALONG the rail --
    // a sliding extension starts staggered, a hook-on board starts centred (0).
    ...(key.startsWith("rail") ? { slide: slide ? initialSlide(host, key, sku) : 0 } : {}),
  };
  state.nodes.push(n);
  state.sel = n.id;
  render();
}

/** Remove a node, and everything hanging off it. A hook chain is not a set of tables that
 *  happen to be near each other -- take out the frame and the extensions have nothing to
 *  hang from. They come down with it. */
function removeNode(n) {
  const doomed = new Set([n.id]);
  for (let i = 0; i < 16; i++)
    for (const m of state.nodes)
      if (m.host && doomed.has(m.host)) doomed.add(m.id);
  state.nodes = state.nodes.filter(m => !doomed.has(m.id));
  if (doomed.has(state.sel)) state.sel = state.nodes[0]?.id ?? null;
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

function setLeg(n, sku) {
  const root = n.kind === "ext" ? rootOf(n) : n;
  if (!root || root.kind === "table") return;
  root.leg = sku;
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
  if (!n || n.kind !== "frame") return;
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
  if (!n || n.kind !== "frame") return;
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

function chip(label, on, title, fn) {
  const c = document.createElement("button");
  c.className = "chip" + (on ? " on" : "");
  c.textContent = label;
  c.title = title || "";
  c.onclick = fn;
  return c;
}

function partRow(p, fn, dead, why) {
  const el = document.createElement("div");
  el.className = "part" + (dead ? " dead" : "");
  const s = spanOf(p);
  el.innerHTML = `<span class="sw" style="background:${swatchOf(p.sku)}"></span>`
    + `<span class="nm">${p.title_en}</span>`
    + `<span class="sp">${s ? s / 2 + "u" : ""}</span>`;
  el.title = why || `${p.sku} — ${p.title_en}`;
  el.dataset.search = `${p.sku} ${p.title_en || ""}`.toLowerCase();   // palette search key
  if (!dead) el.onclick = () => fn(p);
  return el;
}

function paintPalette() {
  const add = $("add"); add.innerHTML = "";
  for (const p of BY_ROLE.frame) {
    const c = chip(`${p.units}u${p.collapsible ? " ⤢" : ""}`, false, p.title_en, () => addNode(p.sku));
    c.dataset.search = `${p.sku} ${p.title_en}`.toLowerCase();
    add.append(c);
  }

  const tab = $("tables"); tab.innerHTML = "";
  const open = anyOpenEdge();
  for (const p of HOOKABLE)
    tab.append(partRow(p, () => addNode(p.sku), !open,
      open ? `${p.sku} — hooks onto an edge. Hover an edge in the scene to choose which.`
           : `${p.sku} — hooks onto a frame or another extension. Put a frame down first.`));
  // Two different gaps, and they deserve two different sentences. One part has no copy
  // saying how it attaches; the other says it hooks on but has no plan view, so WHICH
  // edge carries the hooks was never measured. Both are unplaceable, for opposite reasons.
  for (const p of BY_ROLE.unsourced)
    tab.append(partRow(p, null, true, p.attach === "hook_on"
      ? `${p.sku} — the copy says it hooks on, but its gallery has no plan view, so which `
        + `edge carries the hooks is unmeasured. The planner will not guess.`
      : `${p.sku} — Snow Peak never documents how this attaches. The planner will not guess.`));
  for (const p of [...BY_ROLE.layout_table, ...BY_ROLE.standalone])
    tab.append(partRow(p, () => addNode(p.sku), false));

  const n = sel();
  const hooked = n?.kind === "ext";
  const legs = $("legs"); legs.innerHTML = "";
  for (const p of BY_ROLE.leg) {
    const c = chip(`${p.height_mm}mm`, n?.leg === p.sku,
      hooked ? `an extension is flush with what it hooks to — it takes the same legs, `
             + `so this sets them for the whole run` : p.title_en,
      () => { if (n) setLeg(n, p.sku); });
    c.dataset.search = `${p.sku} ${p.title_en}`.toLowerCase();
    legs.append(c);
  }

  const acts = $("actions"); acts.innerHTML = "";
  if (n && isJikaro(n)) {
    // The Jikaro is four trapezoids, and which way round they go is the whole table:
    // 1120mm with a 600mm fire hole, or 885mm with a 365mm one. Not a finish option.
    const cfgs = LAYOUT.tables[JIKARO].configs;
    for (const [key, c] of Object.entries(cfgs))
      acts.append(chip(c.name, n.config === key,
        `${c.outer_mm}mm across, ${c.opening_mm}mm fire opening, four ${c.edge_mm}mm edges to hook to`,
        () => { n.config = key; render(); }));
    // The optional bridge across the fire opening -> an IGT bay. The unit count and the SKU
    // follow the assembly (600 opening -> 2U/CPL-JT2U, 365 -> 1U/ST-051).
    const jc = jikaroCfg(n);
    acts.append(chip(
      n.bridge ? `bridge ✓ ${jc.bridge_units}U · ${jc.bridge_sku}` : `+ bridge (${jc.bridge_units}U)`,
      !!n.bridge,
      n.bridge ? `${jc.bridge_units}-Unit bridge (${jc.bridge_sku}) across the ${jc.opening_mm}mm opening — click to remove`
               : `lay the optional ${jc.bridge_units}-Unit bridge (${jc.bridge_sku}) across the ${jc.opening_mm}mm opening to make an IGT bay`,
      () => { n.bridge = !n.bridge; render(); }));
  }
  // Expandable table (CK-090): slide the two tops together or apart. Open exposes the IGT bay.
  if (n && isExpandable(n)) {
    const e = expDef(n.sku), cur = n.config || e.default;
    for (const [key, c] of Object.entries(e.configs))
      acts.append(chip(
        c.bay_units ? `${c.name} · ${c.bay_units}U bay` : c.name,
        cur === key,
        `${c.w_mm}×${c.d_mm}mm` + (c.bay_units ? ` — opens a ${c.bay_units}-Unit bay` : ` — closed, no bay`),
        () => { n.config = key; render(); }));
  }
  // Height adjuster: a hooked board sits flush with its host, or drops ONE rung of the ladder
  // (830->660->400->300) via a CK-151. One step per adjuster -- lower still means chaining.
  if (n && n.kind === "ext" && n.host && !isSlide(PARTS[n.sku])) {
    const hostLeg = hostLegOf(byId(n.host));
    const room = Math.min(1, stepRoom(hostLeg));
    for (let s = 0; s <= room; s++) {
      const leg = legAtStep(hostLeg, s);
      acts.append(chip(
        s === 0 ? `⇥ ${legMm(hostLeg)}mm` : `↓ ${legMm(leg)}mm +adj`,
        (n.step || 0) === s,
        s === 0 ? "flush — the same height as what it hooks to"
                : `one step down (${legMm(hostLeg)}→${legMm(leg)}mm) with an IGT Height Adjuster (CK-151)`,
        () => setStep(n, s)));
    }
  }
  // A frame joined to another with a CK-175 can keep its own four legs (what the one connection
  // photo shows) OR share the joint and drop the pair at the joined end. The user chooses.
  if (n && n.kind === "frame" && n.host) {
    acts.append(chip("4 legs", !n.sharedJoint,
      "keep its own four legs — both frames legged at the joint (the connection photo)",
      () => { n.sharedJoint = false; render(); }));
    acts.append(chip("2 legs · shared joint", !!n.sharedJoint,
      "drop the two legs at the joined end and share the host's",
      () => { n.sharedJoint = true; render(); }));
  }
  if (n) {
    if (!n.host) acts.append(chip("⟲ turn 90°", false, "rotate this table", () => rotateNode(n)));
    acts.append(chip("× remove", false,
      n.kind === "ext" ? "remove this board and anything hooked to it"
                       : "remove this table and everything hooked to it", () => removeNode(n)));
  }

  const mods = $("modules"); mods.innerHTML = "";
  const frame = n?.kind === "frame" ? n : null;
  for (const p of BY_ROLE.slot_module) {
    const c = frame ? compat(p.sku, frame.sku) : { level: "ok" };
    const dead = !frame || firstFit(frame, p.span) < 0 || c.level === "blocked";
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
    const dead = !frame || hasHangRack(frame) || firstFit(frame, p.span) < 0;
    mods.append(partRow(p, () => placeModule(p.sku), dead,
      dead && frame && hasHangRack(frame)
        ? `${p.sku} — one hanging rack per frame; the side frames would collide.`
        : `${p.sku} — hangs a ${p.tiers === 2 ? "two-tier" : "one-tier"} rack under 2U of the frame.`));
  }

  $("selname").textContent = n ? PARTS[n.sku].title_en : "nothing selected";
  $("selbox").hidden = !n;   // the selected-part controls ride at the TOP, only while something is picked
  filterPalette();       // re-apply the current search over the freshly painted rows
}

// Find a part by name or number: hide the palette rows and chips that don't match. Runs after
// every repaint so the filter survives re-renders; an empty query shows everything.
function filterPalette() {
  const q = ($("palsearch").value || "").trim().toLowerCase();
  for (const id of ["add", "tables", "legs", "modules"])
    for (const el of $(id).children)
      el.style.display = (!q || (el.dataset.search || "").includes(q)) ? "" : "none";
}
$("palsearch").addEventListener("input", filterPalette);

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
      for (const pl of n.placements) lines.push({ sku: pl.sku, node: n, pl });
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
    // A node (frame/table) and an accessory placed in one both get an ×; the required
    // hardware that comes with them (legs, joints) does not -- it follows what it hangs off.
    const removable = l.node ? "×" : "";
    const lead = l.req ? "↳ " : l.pl ? "· " : "";       // · marks a module you dropped in
    tr.innerHTML = `<td class="x">${removable}</td>`
      + `<td class="nm" title="${p.sku} — ${p.title_en}">${lead}${p.title_en}</td>`
      + `<td class="p">${usd}</td>`;
    if (l.pl) tr.querySelector(".x").onclick = () => removePlacement(l.node, l.pl);
    else if (l.node) tr.querySelector(".x").onclick = () => removeNode(l.node);
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

function paint() { paintPalette(); paintSlots(); paintBOM(); paintWarnings(); }
// ---------------------------------------------------------------- undo / redo
// Snapshots of the layout (nodes only -- selection is transient, not worth an undo step). Every
// committed render pushes one; a drag pushes only its final state (see pointerup). Ctrl/Cmd-Z
// steps back, Shift-Ctrl-Z (or Ctrl-Y) redoes.
const undoStack = [], redoStack = [];
let restoring = false;
const snapshot = () => JSON.stringify({ nodes: state.nodes, nextId: state.nextId });
function commitHistory() {
  if (restoring) return;
  const s = snapshot();
  if (undoStack[undoStack.length - 1] === s) return;   // nothing structural changed
  undoStack.push(s);
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
  paintUndo();
}
function restoreHistory(json) {
  const s = JSON.parse(json);
  state.nodes = s.nodes; state.nextId = s.nextId;
  if (!byId(state.sel)) state.sel = null;
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
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
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
  followHover();
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
  unsourced: inScope.filter(p => hookRoles(p) && !HOOKABLE.includes(p)),
};

$("datum").textContent = `${LAYOUT.datum_height_mm}mm`;

// A way in from the console. Being able to put the camera straight overhead is how you
// check a silhouette; orbiting by hand and squinting is how you convince yourself.
window.__igt = { THREE, scene, camera, controls, state, PARTS, TEXTURES, render,
  openEdges, hookNormal, bracketNormal, turnOf, hostEdge, aabb,
  top() { camera.position.set(0.001, 3.6, 0.001); controls.target.set(0.6, 0.8, 0); } };

resize();
initTheme();
addNode("CK-150");
