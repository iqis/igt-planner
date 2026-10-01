// The IGT layout RULES -- no DOM, no three.js. What hooks onto what, where a hooked board ends up,
// which slots a module takes, what the bill is, and what is wrong with a layout. The planner (app.js)
// imports all of it and draws; anything else -- a test in Node, an API in a Worker, someone's own
// agent -- can import it and ask the same questions with the same answers.
//
//   import * as core from "./core.js";
//   core.loadCatalog({ catalog, colors, textures, fittings });   // the four catalog/*.json files
//   const report = core.evaluate(layoutDoc);                     // see evaluate() at the bottom
//
// Millimetres and radians throughout, like the rest of the planner.

import { burnerOf, BBQ_SURFACE_SKUS, shelterVerts, shelterBBox, GROUND_HIP } from "./partsdata.js";
import EN from "./i18n/en.js";   // the English sentences of warnings(), so they live in one place

export const FRAME_THICK = 30;
// The rail's inner recess is ~10mm deep, and a flat module's edge drops into it as its
// flange. So a slotted flat board is DRAWN 10mm thick -- it fills the recess exactly and its
// top finishes flush with the rail, instead of clipping through the rail as a full-thickness
// slab or floating proud of it. Matches `recess` in railProfile.
export const RAIL_RECESS = 10;
// A module's rim lands at z = +/-180 and rests on the rail's inner lip (158.5 .. 182.5).
// That 360 is the SEAT, not the span between the rails -- which is 317. See SECTION.
export const MODULE_SEAT = 360;
export const LEG_R = 13;
export const SNAP = 25;        // ground grid the free tables slide on
export const TOUCH = 30;       // two tables closer than this are connected

// A sliding extension (CK-153/154) mounts on the frame's LONG rail and cantilevers out. It
// is not a wire-hook board -- it has two integral brackets that grip the rail directly (JP
// a002/a003) -- so it needs no rail joint, takes no legs, and it SLIDES: it tiles the long
// side in slots one board wide (two CK-154 span a four-unit side exactly, 548x2 = 1096).
export const isSlide = p => p?.attach === "slide_in";

export let CAT, GRID, LAYOUT, CONN, HALF, PARTS, BY_ROLE, COLORS, TEXTURES, FRAMES, HOOKABLE, SLIDE_IN, SECTION;
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
export const state = { nodes: [], sel: null, nextId: 1, shelterLock: true, selSet: new Set(), rulers: [], scene: "grid" };
export let rulerSeq = 1;   // ids for measurements -- their own counter, reassigned fresh on load
export const nextRulerId = () => rulerSeq++;

export const byId = id => state.nodes.find(n => n.id === id);
export const sel = () => byId(state.sel);

// Rotate a vector in the ground plane. three's `rotation.y = -r` maps a local vector at
// angle a to world angle a + r, so this and the mesh always agree about which way is out.
export const rotv = (v, r) => ({
  x: v.x * Math.cos(r) - v.z * Math.sin(r),
  z: v.x * Math.sin(r) + v.z * Math.cos(r),
});
export const angleOf = v => Math.atan2(v.z, v.x);
// Keep rotations in (-pi, pi]. A quarter turn that reports itself as -270 degrees is not
// wrong, but it is the sort of thing you waste ten minutes on in a debug dump.
export const norm = r => Math.atan2(Math.sin(r), Math.cos(r));

// ---------------------------------------------------------------- node geometry

export const overhead = () => GRID.families?.standard?.end_overhead_mm ?? 96;

// The Jikaro Firering Table is FOUR trapezoid segments, and they go together either way
// round -- long edge inward (the published 1120mm ring with a 600mm fire hole) or short edge
// inward (a compact 885mm ring with a 365mm hole). Same four pieces; two different tables.
// So its footprint is not a property of the SKU, it is a property of the NODE.
export const JIKARO = "ST-050";
export const jikaroCfg = n => (LAYOUT.tables?.[JIKARO]?.configs || {})[n?.config || "long_in"];
export const isJikaro = n => n?.sku === JIKARO && jikaroCfg(n);

// The Connection Table (LV-381): a layout table that ALSO takes IGT extensions on its two ends,
// so a run can carry on off it. Owner: it has two hole sets at different pitches (tables +
// accessories); we model the table-hook edges, which use the same wire hook as a frame end.
export const CONN_TABLE = "LV-381";
export const isConnTable = n => n?.sku === CONN_TABLE;

// Expandable self-contained tables (CK-090 Extension IGT): a config that changes footprint AND
// exposed unit-slots. Read lazily -- LAYOUT is fetched at boot, after these arrows are defined.
export const expDef = sku => (LAYOUT.expandables || {})[sku];
export const expCfg = n => { const e = expDef(n?.sku); return e && e.configs[n?.config || e.default]; };
export const isExpandable = n => !!expDef(n?.sku);

// Self-contained IGTs (Entry / Slim) -- a 3-unit frame in a fixed body whose custom wood top
// lifts out per half-unit so IGT units drop in.
export const selfIgt = sku => (LAYOUT.self_igt || {})[sku];

// A scale figure's height is per-NODE (config = mm, else the record's median); everything
// about its box follows from it, including the seated knees-forward depth.
export const figH = n => Number(n.config) || PARTS[n.sku].assembled_mm.h;

export function footprintOf(sku, kind, node) {
  const p = PARTS[sku];
  if (kind === "footprint") { const b = shelterBBox(shelterVerts(p.geometry)); return { w: b.w, d: b.d }; }
  if (p.role === "figure" && node) {
    const h = figH(node);
    // On the ground an adult sits cross-legged (knees out wide, shallow) and a toddler sits with
    // its legs straight out in a V (narrower, long) -- the same split figureGroup draws.
    if (node.pose === "ground")
      return p.figure === "toddler" ? { w: Math.round(h * .36), d: Math.round(h * .56) }
                                    : { w: Math.round(h * .46), d: Math.round(h * .30) };
    return node.pose === "sit" ? { w: Math.round(h * .28), d: Math.round(h * .42) }
                               : { w: Math.round(h * .28), d: Math.round(h * .17) };
  }
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
export const footprint = n => footprintOf(n.sku, n.kind, n);

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
export function topOf(n, depth = 0) {
  // A leg set is named for the TABLE HEIGHT it gives, not its own length: CK-112 "400mm" is 410mm of
  // tube, CK-114 "830mm" is 840 -- the extra 10mm goes up into the frame's corner sockets. So a frame
  // on the Low leg stands at exactly 400, flush with the Jikaro, the Connection Table and every other
  // datum table, which is the whole premise of the 400mm datum (layout.json). Adding the frame's 30mm
  // on top put it at 430 and flagged "different heights" on the very pairing the system is built for.
  if (n.kind === "frame") return PARTS[n.leg]?.height_mm ?? 0;
  if (n.kind === "ext") {
    const h = byId(n.host);
    // Flush with the host, MINUS any height-adjuster step (n.step rungs down the ladder).
    if (h && depth < 16) return topOf(h, depth + 1) - stepDropMm(hostLegOf(h), n.step || 0);
    return PARTS[n.leg]?.height_mm ?? PARTS[n.sku].assembled_mm?.h ?? 25;   // a loose board on its own legs: the leg's named height
  }
  // Self-contained IGTs stand at the datum by design; Slim's 408mm is within tolerance of 400, so
  // snap them to the datum -- they line up with any 400mm table and join via a connection hook, not
  // a height adjuster.
  if (selfIgt(n.sku)) return LAYOUT.datum_height_mm;
  if (PARTS[n.sku].role === "figure")
    return n.pose === "sit" ? Math.round(420 + figH(n) * .30)
      : n.pose === "ground" ? Math.round(figH(n) * (GROUND_HIP + .30))
      : figH(n);
  return PARTS[n.sku].height_mm ?? PARTS[n.sku].assembled_mm?.h ?? LAYOUT.datum_height_mm;
}

// The IGT height ladder -- the leg SKUs top to bottom. A height adjuster (CK-151) bridges ONE
// adjacent step and only downward (per the CK-151 manual: 830<->660<->400<->300; it CANNOT skip
// a step like 830->400, and CANNOT raise). legAtStep drops a leg SKU by `step` rungs, clamped.
export const HEIGHT_LADDER = ["CK-114", "CK-113", "CK-112", "CK-109"];   // 830, 660, 400, 300 mm
export const legRung = leg => HEIGHT_LADDER.indexOf(leg);
export function legAtStep(fromLeg, step = 0) {
  const i = legRung(fromLeg);
  if (i < 0) return fromLeg;
  return HEIGHT_LADDER[Math.max(0, Math.min(i + step, HEIGHT_LADDER.length - 1))];
}
export const legMm = leg => PARTS[leg]?.height_mm ?? 0;
/** Which rung of the leg ladder a top height is at (-1 if none): heights, not legs, decide a step --
 *  a slide-in board has no leg, and a layout table carries none, yet both stand at a ladder height. */
export const rungAt = mm => HEIGHT_LADDER.findIndex(l => legMm(l) === mm);
export const stepDropMm = (fromLeg, step = 0) => legMm(fromLeg) - legMm(legAtStep(fromLeg, step));
export const stepRoom = hostLeg => Math.max(0, HEIGHT_LADDER.length - 1 - legRung(hostLeg));  // rungs left below
// The leg a host effectively stands on -- its own, or the datum leg for a legless layout table.
export const hostLegOf = h => h?.leg || PARTS[h?.sku]?.requires_leg || LAYOUT.leg_at_datum;

/** World-space AABB, honouring the node's rotation. */
export function aabb(n) {
  const f = footprint(n);
  const c = Math.abs(Math.cos(n.rot)), s = Math.abs(Math.sin(n.rot));
  const w = f.w * c + f.d * s, d = f.w * s + f.d * c;
  return { x0: n.x - w / 2, x1: n.x + w / 2, z0: n.z - d / 2, z1: n.z + d / 2, w, d };
}

/** Two tables are connected if their footprints touch. */
export function neighbours(n) {
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
export function steps() {
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
export function contactEdge(a, b) {
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

export const mean = pts => ({
  x: pts.reduce((a, p) => a + p[0], 0) / pts.length,
  z: pts.reduce((a, p) => a + p[1], 0) / pts.length,
});

/** The outward normal of the board's HOOK edge, in the board's own coordinates.
 *
 *  This used to snap to +/-x or +/-z. A rectangle and a quarter round are both axis-aligned,
 *  so it worked -- right up until an angle extension arrived, whose hook edge faces -30.4
 *  degrees and got snapped to +x. The board was modelled as STRAIGHT and the entire 60
 *  degrees vanished into a rounding. Read the measured normal. */
export const hookNormal = sku => {
  const e = TEXTURES[sku]?.hook_edge;
  return e ? { x: e[0], z: e[1] } : { x: 1, z: 0 };
};

/** The signed turn this board imposes on the run: 0 straight, +/-90 a corner, +/-60 an
 *  angle extension. Snapped to the design intent at measurement time (the same fit that
 *  reads 60.8 for an angle board reads 90.9 for a corner that is certainly 90), so six
 *  angle boards close a hexagon EXACTLY and four corners close a rectangle. */
export const turnOf = sku => (TEXTURES[sku]?.turn ?? 0) * Math.PI / 180;

/** The outward normal of the BRACKET edge -- the leg seats, and where the next board hooks.
 *  Straight on from the hooks, then turned. Derived from the canonical turn rather than
 *  read raw, so the geometry of a chain closes instead of drifting by a degree a board. */
export function bracketNormal(sku) {
  const h = hookNormal(sku);
  return rotv({ x: -h.x, z: -h.z }, turnOf(sku));
}

/** Where on the board the hooks are (their midpoint), and where the brackets are.
 *
 *  These are the ANCHORS, and they replace "the midpoint of a bounding-box face". A slanted
 *  edge has no bounding-box face; and even a straight board is really located by its hooks,
 *  which is what actually drops into what. */
export const hookAnchor = sku => mean(TEXTURES[sku]?.hooks_mm || [[0, 0]]);
export const bracketAnchor = sku => mean(TEXTURES[sku]?.legs_mm || [[0, 0]]);

/** The half of the joint that THIS node brings, in its own coordinates.
 *
 *  A bamboo board brings wire hooks, measured off its own plan view. A FRAME brings CK-175,
 *  which turns its end piece into a hook -- so what mates is the end FACE, and the two
 *  frames butt. Same placement rule either way; only the half differs. */
export function hookGeometry(n) {
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
export const RAIL_JOINT = "XCK-128-01";

// The frame's hook holes sit 16.5mm in from the end face -- measured on CK-149, whose ends
// are at x = +/-423 and whose holes are at +/-406.5. They are 287.8mm apart in z, and every
// bamboo board's hooks measure 289-293mm apart: 2mm of clearance, which is exactly what a
// hook needs to drop in. That agreement, across eight boards and one frame, is what licenses
// using the hook spacing as a RULER -- and it is how CK-218's published depth was caught.
export const HOLE_INSET = 16.5;

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
export const FRAME_HOOK = "CK-175";

/** An attachment edge, resolved in the host's OWN coordinates.
 *
 *  An edge is not an axis. It is a place where two named holes are, facing a particular
 *  way -- and on an angle extension that way is -30.4 degrees, which no axis can say.
 *  So an edge carries an ANCHOR (the midpoint of the holes) and a NORMAL (which way it
 *  faces), and both are measured.
 */
export function hostEdge(n, key, guest = "ext") {
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

export const S = Math.SQRT1_2;   // 1/sqrt(2)
export const JIKARO_EDGES = {
  // the four OUTER STRAIGHT sides
  "jik+x": { x: 1, z: 0 }, "jik-x": { x: -1, z: 0 },
  "jik+z": { x: 0, z: 1 }, "jik-z": { x: 0, z: -1 },
  // the four 45-degree CHAMFERS. Owner: in the SPREAD form all eight edges take IGT extensions,
  // so the chamfers are offered too (gated to long_in in edgeKeysOf).
  "jikNE": { x: S, z: S, chamfer: true }, "jikSE": { x: S, z: -S, chamfer: true },
  "jikNW": { x: -S, z: S, chamfer: true }, "jikSW": { x: -S, z: -S, chamfer: true },
};

export const EDGE_KEYS = { frame: ["end+x", "end-x", "rail+z", "rail-z"], ext: ["bracket"], table: [] };
// A self-contained IGT (Entry / Slim) IS a fixed-body 3-unit frame: holes at the ends, rails on the
// long sides. It offers whichever of those its connections.hosts entry declares -- so it connects
// like a frame, driven by the same data, without being kind "frame".
export function selfIgtEdges(n) {
  const ports = CONN.hosts[n.sku] || [];
  const keys = [];
  if (ports.some(p => p.at === "end"))  keys.push("end+x", "end-x");
  if (ports.some(p => p.at === "rail")) keys.push("rail+z", "rail-z");
  return keys;
}
export const edgeKeysOf = n => isJikaro(n) ? [...Object.keys(JIKARO_EDGES).filter(k =>
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
export function openEdges(n) {
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

export const anyOpenEdge = () => state.nodes.some(n => openEdges(n).length > 0);

// A node's ASSEMBLY -- the connected component it belongs to. Follow host links (of ANY kind,
// unlike rootOf which stops at non-ext) up to the free root, then gather everything sharing it.
// A hooked board, a sliding extension, a frame joined to another frame: one assembly, moved and
// selected as one.
export function asmRoot(n) {
  const seen = new Set();
  while (n.host && !seen.has(n.id)) {
    seen.add(n.id);
    const h = byId(n.host);
    if (!h) break;                       // dangling host -> treat the current node as the root
    n = h;
  }
  return n;
}
export function assemblyOf(n) {
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
export function place(n) {
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

export const SLIDE_SNAP = 25;   // mm -- a light grid so a dragged extension lands tidy, not free-float

/** How far a sliding extension may slide before it runs off the rail OR overlaps another one
 *  on the same rail -- two must NOT overlap. Neighbours are classed by which side they are on
 *  now, so the board slides up to TOUCHING one but not through it. */
export function slideBounds(n, host) {
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
export function slideOffset(n, host) {
  const { lo, hi } = slideBounds(n, host);
  const snapped = Math.round((n.slide ?? 0) / SLIDE_SNAP) * SLIDE_SNAP;
  return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, snapped));
}

/** Where a newly added sliding extension starts: the first board-wide tiling position no other
 *  one already sits at, so a second tiles beside the first. From there it is dragged anywhere. */
export function initialSlide(host, key, sku) {
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
export function resolve() {
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
export function bayUnits(n) {
  if (n.kind === "frame") return PARTS[n.sku].units || 0;
  if (isJikaro(n) && n.bridge) return jikaroCfg(n).bridge_units || 0;
  if (isExpandable(n)) return expCfg(n)?.bay_units || 0;
  if (selfIgt(n.sku)) return selfIgt(n.sku).units || 0;   // Entry/Slim: a 3-unit frame, top lifts out
  return 0;
}
export const hasBay = n => bayUnits(n) > 0;
// Refit the modules after the bay shrank or vanished (bridge off, collapse, 2U->1U). Each
// module that still fits the smaller bay is KEPT -- at its old spot if free, else re-packed into
// the first free run; anything now too wide, or with no room left, is dropped. So 2U-full -> 1U
// keeps one unit's worth and drops the overflow; a lone module slides into the surviving unit.
export function pruneModules(n) {
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
export const slotsOf = n => bayUnits(n) * 2;
export const runOf = n => bayUnits(n) * 250;
export const slotX = (n, i) => -runOf(n) / 2 + i * HALF;

export function railW(p) {
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
export function depthOf(p) {
  const a = p.assembled_mm;
  if (!a) return MODULE_SEAT;
  const r = railW(p);
  return Math.abs(a.w - r) <= Math.abs(a.d - r) ? a.d : a.w;
}
export const spanOf = p => p.span;

export function occupancy(n) {
  const cells = new Array(slotsOf(n)).fill(null);
  for (const pl of n.placements)
    for (let i = pl.start; i < pl.start + pl.span && i < cells.length; i++) cells[i] = pl;
  return cells;
}
export function firstFit(n, span, ignore = null) {
  const cells = occupancy(n);
  for (let s = 0; s + span <= cells.length; s++) {
    let ok = true;
    for (let i = s; i < s + span; i++) if (cells[i] && cells[i] !== ignore) { ok = false; break; }
    if (ok) return s;
  }
  return -1;
}
export function canPlaceAt(n, start, span, ignore) {
  if (start < 0 || start + span > slotsOf(n)) return false;
  const cells = occupancy(n);
  for (let i = start; i < start + span; i++) if (cells[i] && cells[i] !== ignore) return false;
  return true;
}


export const EDGE_IFACES = new Set(["ext_table", "side_rail", "knob", "hearth"]);   // the edge menu; slot + hanging are placed via the slot menu

/** The interface ports a resolved edge exposes, read from connections.hosts (a frame splits its
 *  end from its rail; a Jikaro / Connection Table / a board's bracket expose all their edge ports). */
export function portsAt(e) {
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
export const hostsHanging = n => (CONN.hosts[n.sku] || CONN.hosts[PARTS[n.sku]?.role] || []).some(p => p.iface === "hanging");

export const partsForRole = role =>
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
export const guestsFor = ifaces => Object.entries(CONN.guests || {})
  .filter(([, g]) => ifaces.has(g.via)).flatMap(([role]) => partsForRole(role)).filter(Boolean);
export const SLOT_IFACES = new Set(["slot", "hanging"]);

export const adapterList = () => Object.values(CONN.adapters || {}).filter(a => a.from);
// Interface match, directly or bridged by an adapter. SCALE is NOT a gate here: a table-scale
// guest (a frame) MAY still join a board-scale port (a rail joint / a board's bracket) -- it just
// has to stand on its OWN legs there, because that port can't bear it. That's a warning, not a
// block (see boardScalePort + paintWarnings).
export const canAttach = (guest, ports) => ports.some(port =>
  guest.via === port.iface
  || adapterList().some(a => a.from === port.iface && (a.to || []).includes(guest.via)));

export function legalOn(e) {
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
export function fitsOpening(p, e) {
  if (e.at !== "opening" || !e.opening) return true;
  const a = p.assembled_mm;
  return !!a && Math.max(a.w, a.d) <= e.opening;
}

// The ET port a hosted node occupies is BOARD-scale -- a rail joint's output, or a board's own
// bracket -- neither of which can bear a frame. A frame there must keep its own four legs.
export function boardScalePort(n) {
  const h = byId(n.host);
  return !!h && (!!n.rail || h.kind === "ext");
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

export const baseSku = sku => sku.replace(/-(US|INT|EC|R)$/i, "");

/** Two frames are interchangeable hosts if they have the same unit count -- established
 *  when the collapsible frames were confirmed to share the standard ones' footprint to the
 *  millimetre. So a whitelist that names one frame implies every frame of its size. */
export function hostEquivalents(sku) {
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
export function compat(guestSku, hostSku) {
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

export const HOOKS_ON = new Set(["extension_table", "corner"]);
// A sliding extension is a hooked node too (it hangs off a host edge, is not dragged), so it
// is kind "ext" -- but a rail-only one, offered on long edges and drawn as a cantilever.
export const kindOf = p => (p.role === "frame" ? "frame"
  : p.role === "seating" || p.role === "hearth" || p.role === "figure" ? "prop"   // placed, not connected
  : p.role === "shelter" ? "footprint"            // a tent/tarp ground outline -- a scale reference
  : (HOOKS_ON.has(p.role) || isSlide(p)) ? "ext" : "table");

// A leg SET is two legs -- "Each purchase includes two legs", and the JP spec agrees
// (25mm dia x 840mm, 0.45kg x2). So a frame stands on four legs and needs TWO sets.
//
// An extension needs only ONE. Its hooked edge hangs off the host and carries no leg at
// all; the legs live under the far edge, in the brackets that also hold the holes the
// NEXT extension hooks into.
export const LEG_SETS = { frame: 2, ext: 1, table: 0 };


/** Where a floating add lands: a clear spot in front of the layout (+z), staggered sideways by how
 *  many parts are already floating so a run of adds doesn't stack on one spot. Shared by addNode and
 *  the hover preview -- one source of truth for "where would this go". */
export function floatSpot(n) {
  const others = state.nodes.filter(m => m.kind !== "footprint");
  const zFront = others.length ? Math.max(...others.map(m => aabb(m).z1)) : 0;
  const nFloat = state.nodes.filter(m => m.floating).length;
  return { x: nFloat * 700, z: zFront + footprint(n).d / 2 + 300, rot: 0 };
}
/** Where a footprint lands: centred on the whole layout's extent, or the origin on an empty canvas. */
export function footprintSpot(n) {
  const others = state.nodes.filter(m => m.kind !== "footprint");
  if (!others.length) return { x: 0, z: 0, rot: 0 };
  const xs = others.flatMap(m => { const a = aabb(m); return [a.x0, a.x1]; });
  const zs = others.flatMap(m => { const a = aabb(m); return [a.z0, a.z1]; });
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, rot: 0 };
}


// ---- Drag to reconnect: detach a hooked part, float it, drop it onto another legal edge --------
// The ids of n and everything hanging off it -- a node can't be hooked to itself or its own guest.
export function subtreeIds(n) {
  const ids = new Set([n.id]);
  for (let i = 0; i < 16; i++)
    for (const m of state.nodes) if (m.host != null && ids.has(m.host)) ids.add(m.id);
  return ids;
}
/** Cut a hooked node loose: it keeps its current position and becomes a free-standing root. */
export function detachNode(n) {
  n.host = null;
  delete n.edge; delete n.rail; delete n.slide; delete n.step; delete n.sharedJoint;
}
/** Hook an EXISTING node onto a host edge (re-attach after a detach), like attach() but in place. */
export function hookNode(n, host, key) {
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
export function findDropTarget(n) {
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

/** Drop a part onto an OCCUPIED edge -> insert it into the chain: it takes the edge, and whatever
 *  was there re-hosts onto the newcomer's far edge, so the run grows by one in the middle. */
export function insertAt(n, host, key) {
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


export function rootOf(n, depth = 0) {
  if (n.kind !== "ext" || depth > 16) return n;
  const h = byId(n.host);
  return h ? rootOf(h, depth + 1) : n;
}

// A hanging rack is a hanger with a span: it occupies slots (2U) but hangs below the frame
// rather than dropping into it. CK-220 (two tiers), CK-230 (one tier, its own surface).
export const isHangRack = p => p?.role === "hanger" && p?.span;
export const hasHangRack = n => n.placements.some(pl => isHangRack(PARTS[pl.sku]));


/** The maximal run of contiguous FREE half-slots that CONTAINS `cell` -- extended BOTH ways
 *  to the next occupied cell or the frame's end. This is the real space available at a slot;
 *  counting only forwards said "0.5u" next to a half-unit even with a clear unit to its left. */
export function freeBlock(n, cell) {
  const cells = occupancy(n);
  if (cells[cell]) return null;
  let lo = cell, hi = cell;
  while (lo > 0 && !cells[lo - 1]) lo--;
  while (hi < cells.length - 1 && !cells[hi + 1]) hi++;
  return { lo, hi, len: hi - lo + 1 };
}


export function bomLines() {
  const lines = [];
  for (const n of state.nodes) {
    if (n.kind === "footprint") continue;   // a shelter is a size reference, not part of the IGT bill
    if (PARTS[n.sku].role === "figure") continue;   // and a person is not for sale
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
    const rH = rungAt(topOf(hi)), rL = rungAt(topOf(lo));
    if (rH >= 0 && rL - rH === 1) lines.push({ sku: "CK-151", req: true });
  }
  return lines;
}


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
export const SAVE_V = 1;
// Everything a node carries that is a DECISION. Anything absent from a node is simply left out.
export const INTENT = ["sku", "host", "edge", "leg", "legFinish", "floating", "locked", "step", "slide",
                "config", "sharedJoint", "bridge", "surface", "coal", "base", "canister", "pose", "placements"];

/** The scene as a plain object -- intent only. `sel` is not saved: a selection is not a design. */
export function serializeLayout(nodes = state.nodes) {
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
  // The SCENE -- a ground or a place -- belongs to the design too: this page is on the beach, that one
  // in the meadow, and a shared link should arrive where it was set. Whole-scene saves only, like the
  // rulers; absent means the bare grid, so every older file reads the same as it always did.
  if (nodes === state.nodes && state.scene && state.scene !== "grid") doc.scene = state.scene;
  return doc;
}

/** Rebuild the scene from a saved object. Returns {nodes, nextId, dropped[]} without touching state,
 *  so a caller can look before it leaps. A part that has left the catalog is DROPPED and named --
 *  never silently, and never as a mystery box. */
export function readLayout(doc) {
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
  // The scene is passed through as a name; the planner checks it against what it can draw.
  const scene = typeof doc.scene === "string" ? doc.scene : "grid";
  return { nodes, nextId, dropped: [...new Set(dropped)], rulers, scene };
}


/** Everything worth saying about the layout, as data: {level, cat, text}.
 *
 *  `cat` sorts them the way a person acts on them:
 *    "problem"  it will not stand, will not fit, or the manual forbids it -- fix it
 *    "check"    probably fine, but nothing confirms it: a manual that predates the part, a height
 *               that is off the leg ladder
 *    "added"    a part the layout implies and the bill now carries (a Height Adjuster)
 *    "note"     a fact worth knowing: the run turns, a gas line's side, a frame is full
 *  `level` is "warn" for problems and "info" for the rest -- what evaluate()'s `buildable` reads.
 *  One sentence each: the planner folds these into a panel, and an agent reads them as a list. */
export function warnings() {
  const out = [];
  // add(cat, key, parts, vals): `parts` are SKUs (named in English here, in the viewer's language by the
  // planner), `vals` are numbers and words. `text` is the English sentence an agent reads.
  const add = (cat, key, parts = {}, vals = {}) => {
    const names = Object.fromEntries(Object.entries(parts).map(([k, sku]) => [k, PARTS[sku]?.title_en || sku]));
    const text = (EN[key] || key).replace(/\{(\w+)\}/g, (m, k) => (k in names ? names[k] : k in vals ? vals[k] : m));
    out.push({ level: cat === "problem" ? "warn" : "info", cat, key, parts, vals, text });
  };

  // A board dragged off its host and not yet dropped onto another edge.
  for (const n of state.nodes)
    if (n.kind === "ext" && n.host == null)
      add("problem", "w.detached", { a: n.sku });

  // Height changes between touching tables, judged on the HEIGHTS -- which rung of the leg ladder each
  // top is at -- not on which leg a node carries: a slide-in board has no leg of its own and used to be
  // read as the 400mm datum leg, so it was reported "off the ladder" next to the frame it hangs from.
  for (const [a, b] of steps()) {
    const hi = topOf(a) >= topOf(b) ? a : b, lo = hi === a ? b : a;
    const H = topOf(hi), L = topOf(lo), rH = rungAt(H), rL = rungAt(L);
    const ab = { a: hi.sku, b: lo.sku }, hl = { h: H, l: L };
    if (rH >= 0 && rL >= 0 && rL - rH === 1) add("added", "w.step.added", ab, hl);
    else if (rH >= 0 && rL >= 0) add("problem", "w.step.toomany", ab, { ...hl, n: rL - rH });
    else add("check", "w.step.offladder", ab, hl);
  }

  // The datum is the reason the fire-side tables specify low legs: they are all 400mm, and so is the
  // IGT Low leg. A frame at 830mm simply cannot meet one flush.
  for (const n of state.nodes) {
    if (n.kind !== "frame") continue;
    for (const m of neighbours(n)) {
      const p = PARTS[m.sku];
      if (p.role !== "layout_table" || !p.requires_leg) continue;
      if (n.leg !== p.requires_leg)
        add("problem", "w.datum", { a: m.sku, leg: p.requires_leg }, { h: p.height_mm });
    }
  }

  for (const n of state.nodes) {
    if (n.kind !== "frame") continue;
    const used = occupancy(n).filter(Boolean).length;
    if (used === slotsOf(n)) add("note", "w.full", { a: n.sku }, { used, slots: slotsOf(n) });
  }

  // GAS NEEDS AN EXIT. The burners feed from OUTSIDE the frame: the GS-450R's manual pins the hose to
  // the module's short edge -- which in the frame points at a long rail -- the GS-355 runs the same
  // hose, and the GS-230 hangs its two canisters off its knob face. So a gas module needs at least one
  // long-rail side of its span left open, and boards ON the rail cover exactly that zone.
  for (const n of state.nodes) {
    if (!hasBay(n)) continue;
    const railGuests = state.nodes.filter(m => m.host === n.id && m.rail);
    if (!railGuests.length) continue;
    for (const pl of n.placements) {
      if (!burnerOf(pl.sku)?.hose) continue;
      const x0 = slotX(n, pl.start), x1 = x0 + pl.span * HALF;
      const sides = new Set();
      for (const m of railGuests) {
        const off = slideOffset(m, n), bw = railW(PARTS[m.sku]);
        if (off - bw / 2 < x1 && off + bw / 2 > x0) sides.add(m.edge);
      }
      if (sides.size >= 2) add("problem", "w.gas.blocked", { a: pl.sku });
      else if (sides.size === 1) add("note", "w.gas.one", { a: pl.sku });
    }
  }

  // A frame joined at a BOARD-scale port (a rail joint, or a board's bracket) can't lean on that joint.
  for (const n of state.nodes) {
    if (n.kind !== "frame" || !n.host || !boardScalePort(n)) continue;
    const where = n.rail ? "rail" : "bracket";
    if (n.sharedJoint) add("problem", `w.board.shared.${where}`, { a: n.sku });
    else add("note", `w.board.legs.${where}`, { a: n.sku });
  }

  // What the MANUALS say about a pairing: blacklisted -> forbidden; not on a whitelist that may simply
  // predate this host -> worth checking, in one line (the full list is in the part's manual).
  const seen = new Set();
  const flag = (guest, hostSku) => {
    const c = compat(guest.sku, hostSku);
    if (c.level === "ok") return;
    const key = guest.sku + ">" + hostSku;
    if (seen.has(key)) return;
    seen.add(key);
    if (c.level === "blocked") add("problem", "w.compat.blocked", { g: guest.sku, h: hostSku }, { why: c.why });
    else add("check", "w.compat.unlisted", { g: guest.sku, h: hostSku });
  };
  for (const n of state.nodes) {
    if (n.kind === "frame") for (const pl of n.placements) flag(PARTS[pl.sku], n.sku);
    if (n.host) flag(PARTS[n.sku], rootOf(n).sku);
  }

  // Frame to FRAME only: two end pieces butting is what eats the 99mm.
  for (const n of state.nodes.filter(n => n.kind === "frame" && n.host && byId(n.host)?.kind === "frame"))
    add("note", "w.joined", { a: byId(n.host).sku, b: n.sku });

  // What the run does: a corner turns it 90°, an angle extension 60° -- measured off the plan views.
  const turns = state.nodes.filter(n => n.kind === "ext" && (TEXTURES[n.sku]?.turn ?? 0) !== 0);
  if (turns.length) {
    const total = turns.reduce((a, n) => a + TEXTURES[n.sku].turn, 0);
    const parts = turns.map(n => `${TEXTURES[n.sku].turn > 0 ? "+" : ""}${TEXTURES[n.sku].turn}°`);
    const sum = `${total > 0 ? "+" : ""}${total}°`, list = parts.join(" ");
    add("note", Math.abs(total) === 360 ? "w.turns.closed" : turns.length > 1 ? "w.turns.multi" : "w.turns.one", {}, { list, sum });
  }
  return out;
}


// The scale figures. NOT catalog parts -- no product page, no price, no weight -- so they are
// registered here rather than in overrides.json: a catalog entry would be an invented product,
// and the BOM skips them for the same reason. The default heights are published medians (a CDC
// adult mid-point, the WHO growth standard at age two); the options popover exists to replace
// them with the real family's numbers.
export const FIGURES = [
  { sku: "FIG-ADULT", title_en: "Scale figure — adult", role: "figure", figure: "adult",
    assembled_mm: { w: 460, d: 290, h: 1700 } },
  { sku: "FIG-CHILD", title_en: "Scale figure — toddler", role: "figure", figure: "toddler",
    assembled_mm: { w: 240, d: 150, h: 870 } },
];


/** Load the four catalog files (the same JSON the planner fetches) and derive everything the rules
 *  read from them. Call once, before anything else; a browser, Node or a Worker all call it the same
 *  way. Returns PARTS for convenience. */
export function loadCatalog({ catalog, colors, textures, fittings }) {
  CAT = catalog;
  COLORS = colors.colors;
  TEXTURES = textures.textures;
  FRAMES = fittings.frames;
  // The rail in cross-section, measured off CK-149. Same for every frame in both
  // families: the collapsible ones have identical footprints (846x496, 1096x496) and
  // differ only in thickness (28 vs 30mm) and weight.
  SECTION = FRAMES["CK-149"].section;
  GRID = CAT.grid;
  LAYOUT = CAT.layout;
  CONN = CAT.layout.connections || { interfaces: {}, hosts: {}, guests: {}, adapters: {} };
  HALF = GRID.half_unit_mm;
  PARTS = Object.fromEntries(CAT.parts.map(p => [p.sku, p]));

  for (const f of FIGURES) PARTS[f.sku] = f;

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
  BY_ROLE.figure = FIGURES;
  return PARTS;
}

// ---------------------------------------------------------------- the agent-facing surface
//
// Everything above answers the planner's questions one at a time, against the live `state`. These
// answer an AGENT's: "here is a whole layout -- is it buildable, what does it come to, and what could
// go next?" in one call, without a browser. The layout is the same intent-only JSON the planner saves
// and shares (serializeLayout), so a design can go back and forth between a person and an agent.
//
// An agent writes INTENT -- which part, hooked to which node's which edge, which slots a module
// takes -- and never coordinates for anything hooked: those are derived (place / resolve), exactly as
// in the planner. That is the division of labour that makes this safe to hand to a language model:
// it says what it wants, and the geometry is ours.

const deg = r => Math.round(r * 180 / Math.PI * 10) / 10;

/** The catalog, flattened to what an agent needs to choose parts. `query` matches sku / English /
 *  Japanese name (case-insensitive substring); `role` filters by role. Out-of-scope parts are left out. */
export function listParts({ query = "", role = "" } = {}) {
  const q = query.toLowerCase().replace(/[^a-z0-9぀-ヿ㐀-鿿]+/g, "");
  return Object.values(PARTS)
    .filter(p => !p.excluded && (!role || p.role === role))
    .filter(p => !q || [p.sku, p.title_en, p.title_jp].some(s =>
      (s || "").toLowerCase().replace(/[^a-z0-9぀-ヿ㐀-鿿]+/g, "").includes(q)))
    .map(p => ({
      sku: p.sku, name: p.title_en, name_jp: p.title_jp || undefined, role: p.role, kind: kindOf(p),
      units: p.units || undefined, span_half_units: p.span || undefined,
      size_mm: p.assembled_mm ? { w: p.assembled_mm.w, d: p.assembled_mm.d, h: p.assembled_mm.h } : undefined,
      height_mm: p.height_mm || undefined, weight_g: p.weight_g || undefined,
      attach: p.attach || undefined,
    }));
}

/** Structural problems in a layout an agent wrote -- the things the planner's UI can never produce
 *  (it only ever offers legal moves), but a hand-written file can. Each is a "warn". */
function structuralProblems() {
  const out = [];
  const name = n => `#${n.id} ${PARTS[n.sku]?.title_en || n.sku}`;
  const taken = new Map();
  for (const n of state.nodes) {
    if (n.host == null) continue;
    const h = byId(n.host);
    if (!h) continue;
    if (!edgeKeysOf(h).includes(n.edge)) {
      out.push(`${name(n)} is hooked to "${n.edge}", which ${name(h)} does not have — its edges are: ${edgeKeysOf(h).join(", ") || "none"}.`);
      continue;
    }
    const e = hostEdge(h, n.edge, n.kind);
    if (!e) continue;
    const legal = legalOn({ ...e, node: h, key: n.edge });
    if (!legal.some(p => p.sku === n.sku))
      out.push(`${name(n)} cannot attach to ${name(h)}'s "${n.edge}" edge. What can: ${legal.map(p => p.sku).join(", ") || "nothing"}.`);
    if (!e.rail) {
      const k = `${h.id}:${n.edge}`;
      if (taken.has(k)) out.push(`${name(n)} and ${name(taken.get(k))} both claim ${name(h)}'s "${n.edge}" edge — an edge takes one.`);
      else taken.set(k, n);
    }
  }
  for (const n of state.nodes) {
    if (!(n.placements || []).length) continue;
    if (!hasBay(n)) { out.push(`${name(n)} has modules but no bay to hold them.`); continue; }
    const cells = new Array(slotsOf(n)).fill(null);
    for (const pl of n.placements) {
      const p = PARTS[pl.sku];
      if (p.span && pl.span !== p.span)
        out.push(`${p.title_en} on ${name(n)} spans ${p.span} half-units, not ${pl.span}.`);
      if (pl.start < 0 || pl.start + pl.span > cells.length) {
        out.push(`${p.title_en} on ${name(n)} runs off the bay (start ${pl.start}, span ${pl.span}, bay ${cells.length} half-slots).`);
        continue;
      }
      for (let i = pl.start; i < pl.start + pl.span; i++) {
        if (cells[i]) out.push(`${p.title_en} and ${PARTS[cells[i].sku].title_en} overlap on ${name(n)} at half-slot ${i}.`);
        cells[i] = pl;
      }
    }
  }
  return out.map(text => ({ level: "warn", cat: "problem", text }));
}

/** What could go next on node n: each open edge with the parts that attach there, and each free run
 *  of half-slots with the modules that fit it. The same lists the planner's + menus offer. */
function nextMoves(n) {
  const edges = openEdges(n).map(e => ({
    edge: e.key, rail: e.rail || undefined,
    fits: legalOn(e).map(p => p.sku),
  })).filter(e => e.fits.length);
  let slots;
  if (hasBay(n)) {
    const cells = occupancy(n), runs = [];
    for (let i = 0; i < cells.length;) {
      if (cells[i]) { i++; continue; }
      let j = i; while (j < cells.length && !cells[j]) j++;
      runs.push({ start: i, len: j - i }); i = j;
    }
    slots = runs.map(r => ({
      start: r.start, half_units: r.len,
      fits: guestsFor(SLOT_IFACES).filter(p => spanOf(p) <= r.len
        && !(isHangRack(p) && (!hostsHanging(n) || hasHangRack(n)))
        && compat(p.sku, n.sku).level !== "blocked").map(p => p.sku),
    }));
  }
  return { edges, slots };
}

/** The bill, grouped by SKU: the parts placed AND the ones the rules add (leg sets, rail joints,
 *  connection hooks, height adjusters). `auto: true` marks a line nobody placed by hand. */
export function bill() {
  const rows = new Map();
  let grams = 0;
  for (const l of bomLines()) {
    const p = PARTS[l.sku];
    if (!p) continue;
    grams += p.weight_g || 0;
    const r = rows.get(l.sku) || { sku: l.sku, name: p.title_en, qty: 0, weight_g: p.weight_g || null, auto: true };
    r.qty++;
    if (!l.req) r.auto = false;
    rows.set(l.sku, r);
  }
  return { lines: [...rows.values()], total_weight_kg: Math.round(grams / 100) / 10 };
}

/** Evaluate a layout document (planner JSON: {app:"igt-planner", v:1, nodes:[...]}) without touching
 *  the planner's own scene. Returns where everything ends up, what is wrong, what it costs to carry,
 *  and what could attach next -- enough for an agent to iterate without ever seeing the 3D view. */
export function evaluate(doc) {
  const { nodes, nextId, dropped } = readLayout(doc);
  const saved = { nodes: state.nodes, nextId: state.nextId };
  state.nodes = nodes; state.nextId = nextId;
  try {
    resolve();
    const problems = [
      ...dropped.map(sku => ({ level: "warn", cat: "problem", text: `${sku} is not in the catalog — left out.` })),
      ...structuralProblems(),
      ...warnings(),
    ];
    const tables = nodes.filter(n => n.kind !== "footprint");
    const boxes = tables.map(aabb);
    const extent = boxes.length ? {
      w_mm: Math.round(Math.max(...boxes.map(b => b.x1)) - Math.min(...boxes.map(b => b.x0))),
      d_mm: Math.round(Math.max(...boxes.map(b => b.z1)) - Math.min(...boxes.map(b => b.z0))),
    } : { w_mm: 0, d_mm: 0 };
    return {
      buildable: !problems.some(p => p.level === "warn"),
      problems,
      extent,
      bill: bill(),
      nodes: nodes.map(n => ({
        id: n.id, sku: n.sku, name: PARTS[n.sku].title_en, kind: n.kind,
        host: n.host ?? undefined, edge: n.edge, leg: n.leg || undefined,
        x_mm: Math.round(n.x), z_mm: Math.round(n.z), rot_deg: deg(n.rot),
        top_mm: n.kind === "footprint" ? undefined : Math.round(topOf(n)),
        footprint_mm: footprint(n),
        modules: (n.placements || []).length ? n.placements.map(pl => ({ sku: pl.sku, start: pl.start, span: pl.span })) : undefined,
        next: nextMoves(n),
      })),
    };
  } finally {
    state.nodes = saved.nodes; state.nextId = saved.nextId;
  }
}
