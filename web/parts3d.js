// Part geometry, built ONCE and shared. The planner (app.js) and the part bench (part.js)
// are two renderers; before this file they each had their own idea of what a part looked
// like, and the bench's idea was "a flat slab of the bounding box" -- every burner, box and
// frame a featureless cube. Two sources of truth for one shape is the exact bug this project
// keeps fighting (the leaf, the z-mirror patch), so the shape lives here and both call it.
//
// Every builder takes MILLIMETRES, works in scene metres internally (mm * MM, the way the
// rest of the code does), and returns { group, body } with the part's working TOP at local
// y = 0 -- body hanging below, heads/plates above. The caller places the group and hangs
// picking data on `body`; these builders stay state-free.

import * as THREE from "three";
import { roundedBox, meshWires, isMesh, flatRect, boardFromOutline,
         railProfile, jikaroRing, jikaroSeams } from "./materials.js";

const MM = 0.001;

/** The geometry of a flat board, by what its shape actually is -- three cases, one rule:
 *
 *    corner            genuinely not a rectangle (a quarter round, an angle trapezoid)
 *                      -> trace the silhouette. High-contrast bamboo, traces cleanly.
 *    finger_hole_mm    a stainless lid: a clean published rectangle with a THROUGH hole
 *                      -> build the rectangle from its dimensions and punch the hole.
 *    otherwise         a bamboo board whose finger notch is cut into its EDGE
 *                      -> trace the silhouette, so the edge notch comes along for free.
 *
 *  The rectangles are built from millimetres, never traced -- a pale plate on white tore
 *  into a Z. The traces are kept only where the shape is not a number we already have.
 *  `role` is the part's role, `t` its textures.json record, `w/d/thickMM` millimetres.
 *  Returns geometry hanging from its top face.
 */
export function flatBoardGeo(role, t, w, d, thickMM) {
  t = t || {};
  const hole = t.finger_hole_mm;
  if (role === "corner" && t.outline_mm) return boardFromOutline(t.outline_mm, thickMM * MM);
  if (hole)
    return flatRect(w * MM, d * MM, thickMM * MM, 6 * MM,
      { x: hole.x * MM, z: hole.z * MM, r: hole.r * MM });
  if (t.outline_mm) return boardFromOutline(t.outline_mm, thickMM * MM);   // bamboo, edge notch
  return flatRect(w * MM, d * MM, thickMM * MM, 6 * MM);
}

// The burners, by what their photographs show -- looked at, not guessed. Kept here with the
// geometry it drives, and keyed by base SKU (region suffixes stripped).
export const BURNERS = {
  "GS-355":  { plate: true, knobs: 1 },
  "GS-450R": { heads: 1, knobs: 1 },
  // Its own builder -- an appliance, not a box. Kept here so burnerOf still says "yes, a burner".
  "GS-230":  { gs230: true, heads: 2, knobs: 2 },
  "GP-040":  { heads: 1, knobs: 1, mounts: "GS-1000" },
  "GS-1000": { heads: 1, knobs: 1 },
  // CK-160 was here as { bbq: true } -- "a grate half and a griddle half". Its MANUAL says
  // otherwise (セット内容: 焼き網 x2, and step 1 is "take the lid off"): there is no griddle, the
  // dark slab in the photos is the LID resting inverted on the two nets. It has its own builder
  // now (bbqBoxGroup) and is no longer a burner.
};
export const burnerOf = sku => BURNERS[sku] || BURNERS[sku.replace(/-(US|INT|EC|R)$/i, "")];

const metal = (color, m = 0.85, r = 0.35) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: m, roughness: r });

/** Add a mesh built from mm dimensions and mm position, into a metres-space group. */
function box(g, w, h, d, r, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(roundedBox(w * MM, h * MM, d * MM, r * MM), mat);
  m.position.set(x * MM, y * MM, z * MM);
  if (ry) m.rotation.y = ry;
  g.add(m);
  return m;
}
function cyl(g, rTop, rBot, h, seg, mat, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop * MM, rBot * MM, h * MM, seg), mat);
  m.position.set(x * MM, y * MM, z * MM);
  if (rx) m.rotation.x = rx;
  g.add(m);
  return m;
}

// The burners, by what their photographs show -- one round head or two, a flat grill plate,
// or a charcoal BBQ with a split top. `spec` is the same object app.js keys by SKU.
export function burnerGroup(spec, w, d, h, topTex = null) {
  const g = new THREE.Group();
  const steel = 0x9aa0a8, dark = 0x26292e;

  // The stainless housing, dropped in. Rim at y=0, body hanging to -h.
  const body = box(g, w, h, d, 3, metal(steel, 0.85, 0.35), 0, -h / 2, 0);

  // A flat burner (GS-450R) carries its REAL top as a photo: the stainless well, the brass
  // head with its ring of ports, the pot-support grate over it -- laid on the housing rim.
  // It is a flat burner, so there is no modelled cylinder head; the picture is the top.
  if (topTex) {
    const s = Math.min(w, d) * 0.96;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(s * MM, s * MM),
      new THREE.MeshStandardMaterial({ map: topTex, metalness: 0.5, roughness: 0.5 }));
    top.rotation.x = -Math.PI / 2;             // lay it flat, facing up
    top.position.y = 1.4 * MM;
    g.add(top);
    for (let i = 0; i < (spec.knobs || 0); i++)
      cyl(g, 9, 9, 10, 16, metal(0x1c1f24, 0.4, 0.6), 0, -h * 0.35, d / 2 + 4, Math.PI / 2);
    return { group: g, body };
  }

  if (spec.plate) {
    box(g, w - 8, 10, d - 8, 4, metal(dark, 0.3, 0.6), 0, 4, 0);
    for (let i = -2; i <= 2; i++)
      box(g, w - 24, 3, 5, 1, metal(0x1b1e22, 0.2, 0.7), 0, 9, i * (d / 6));
  } else {
    const heads = spec.heads || 1;
    for (let i = 0; i < heads; i++) {
      const hx = heads === 1 ? 0 : (i - (heads - 1) / 2) * (w / heads);
      const r = Math.min(w / heads, d) * 0.32;
      cyl(g, r, r, 10, 24, metal(dark, 0.5, 0.5), hx, 5, 0);
      cyl(g, r * 0.5, r * 0.6, 12, 20, metal(0x3a3d42, 0.6, 0.45), hx, 6, 0);
      for (let a = 0; a < 4; a++)
        box(g, r * 2.4, 4, 6, 1, metal(steel, 0.9, 0.3), hx, 16, 0, (a * Math.PI) / 4);
    }
  }

  for (let i = 0; i < (spec.knobs || 0); i++) {
    const kx = (spec.knobs === 1 ? 0 : i - (spec.knobs - 1) / 2) * 60;
    cyl(g, 9, 9, 10, 16, metal(0x1c1f24, 0.4, 0.6), kx, -h * 0.35, d / 2 + 4, Math.PI / 2);
  }
  if (spec.windscreen)
    box(g, w - 10, 70, 3, 1, metal(steel, 0.85, 0.35), 0, 35, -(d / 2 - 6));

  return { group: g, body };
}

// A box or bin: stainless walls and a floor, OPEN at the top (a container you put things in)
// or closed. Storage boxes, the stainless half-unit box, the gear bags.
export function binGroup(w, d, h, { open = true, color = 0xb9bec4, wall = 3 } = {}) {
  const g = new THREE.Group();
  const mat = metal(color, 0.8, 0.4);
  const floor = box(g, w, wall, d, 1, mat, 0, -h + wall / 2, 0);
  box(g, wall, h, d, 1, mat, -(w / 2 - wall / 2), -h / 2, 0);
  box(g, wall, h, d, 1, mat, w / 2 - wall / 2, -h / 2, 0);
  box(g, w, h, wall, 1, mat, 0, -h / 2, -(d / 2 - wall / 2));
  box(g, w, h, wall, 1, mat, 0, -h / 2, d / 2 - wall / 2);
  if (!open) box(g, w, wall, d, 1, mat, 0, -wall / 2, 0);
  return { group: g, body: floor };
}

// A shallow tray: a low open pan, thin-walled.
export function trayGroup(w, d, h, color = 0xb9bec4) {
  return binGroup(w, d, Math.max(h, 8), { open: true, color, wall: 2 });
}

// A wire mesh tray: mostly air. A faint ghost box carries picking; the wires are the read.
/** The mesh trays (CK-225 / CK-226 / CK-250 / CK-251). Snow Peak's own manual names them:
 *  アイアングリルテーブル専用の水切りカゴ -- a dish-DRAINING BASKET made for the IGT. That is what the
 *  photographs show and it settles the shape: a stainless WIRE basket, mostly air, that drops
 *  through the rails and hangs by its top. All four used to leave here as one ghost box wearing a
 *  square 26mm grid, which is three wrong claims -- wrong pitch, wrong weave, wrong part count.
 *
 *  The 1-unit manual publishes 容量(内寸) -- the CAVITY -- beside the outside size, and that one
 *  extra number is most of the part:
 *
 *      CK-225 deep      245 x 356 x 127      cavity 227 x 316 x 121
 *      CK-250 shallow   245 x 356 x  42      cavity 227 x 316 x  36
 *
 *  - The cavity is the SAME 227 x 316 in both. Deep and shallow are ONE basket at two wall heights,
 *    not two designs, so they are one builder and h is the only thing that moves.
 *  - 356 - 316 = 40, i.e. 20mm a side ACROSS the rails. That is not slop, it is the SEAT: the body
 *    (316) drops through the rails' 317mm clear opening and the rim's 20mm overhang lands on the
 *    22.5mm inner lip -- both numbers measured in railProfile, off a different drawing, years apart.
 *    A published cavity and a measured rail section agreeing to the millimetre is why the rim is
 *    drawn standing OFF the wall: the standoff is the part's whole mounting.
 *  - 245 - 227 = 18, i.e. 9mm a side ALONG the rail -- no rail there, just rim proud of wall.
 *  - 127 - 121 = 6, and the 6mm is the UNDER-FLOOR RIBS: the mat sits on them and their undersides
 *    are the bottom of the envelope. The lift is not a gap, it is a part.
 *
 *  The half units are not that part scaled down, and this is what the placeholder hid. CK-226 /
 *  CK-251 are "ステンレス、ポリプロピレン" where CK-225 / CK-250 are plain "ステンレス", and the
 *  polypropylene is in every photograph: a BLACK PANEL capping each 120mm end, logo printed on it,
 *  a bossed hole through it. The CK-226 manual's IGT figure says what they are for -- the tray drops
 *  in and the two panels come down ON THE RAILS. They are the half unit's seat the way the wire rim
 *  is the 1-unit's. (The hole takes the TTA 300mm shaft; the two PP brackets in the box are TTA-only
 *  fixings and are not modelled -- this planner draws IGT.)
 *
 *  Both are mats of U-HAIRPINS -- one wire per U: over the rim, down a wall, round into the floor,
 *  across, up the far wall, back over the rim. But the two are laid at RIGHT ANGLES to each other,
 *  and that is the difference you actually see:
 *
 *      1-unit     U's span the 356 (across the rails), spaced along the 245: 16 at 13.6mm, measured
 *                 off the orthographic top view. The two long walls get 13 verticals at 26.3mm.
 *      half unit  U's span its narrow 120, spaced along the 356: ~27, a much finer basket (650g
 *                 against 1100g), with horizontal courses up the long walls.
 *
 *  Neither is a square grid, so neither is meshWires -- that helper's own comment guesses "3mm wire,
 *  ~26mm pitch", and 26mm turns out to be right for the 1-unit's WALL and wrong for everything else.
 *
 *  `panels` = the part declares polypropylene, i.e. it is a half unit. Rim at y = 0. */
export function meshTrayGroup(w, d, h, color, { panels = false } = {}) {
  const g = new THREE.Group();
  const steel = metal(color, 0.9, 0.25);            // polished, not the satin the boxes wear
  const gauge = panels ? 2.5 : 4;                   // wire, measured off the manuals' line art
  const seat = 20, side = 9;                        // rim overhang: across the rails / along it
  const lift = 6;                                   // floor above the envelope's bottom
  const cw = w - 2 * side, cd = d - 2 * seat;       // the cavity in plan
  const fy = -(h - lift);                           // the floor
  const bend = Math.min(21, (h - lift - 14) * 0.9); // the hairpin's radius into the floor
  const flange = Math.min(10, (h - lift) * 0.3);    // where a wire leaves the wall for the rim

  // A faint ghost box, full envelope: it carries picking (dropModule tags only `body`) and nothing
  // else. The wires are the read.
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06 }),
    0, -h / 2, 0);

  // A bent wire, swept along its centreline. Straight sticks butted at 90 degrees read as a diagram;
  // every wire in these photographs turns through a generous radius.
  const wire = (pts, r = gauge / 2, closed = false) =>
    g.add(new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM)), closed),
      closed ? 96 : pts.length * 6, r * MM, 6, closed), steel));

  // A rounded-rectangle loop -- every corner here is a generous radius, not a mitre, and the top
  // view shows two concentric ones: the rim and the body's own top frame.
  const loop = (hw, hd, y, r, rad) => wire([
    [hw, y, -hd + r], [hw, y, hd - r], [hw - r, y, hd], [-hw + r, y, hd],
    [-hw, y, hd - r], [-hw, y, -hd + r], [-hw + r, y, -hd], [hw - r, y, -hd]], rad, true);

  // One hairpin, rim to rim. `spans` is the axis its two arms straddle, `t` its station on the
  // other. The arms leave the wall at -flange and finish OUT on the rim: that outward kick is what
  // holds the rim off the basket, and it is the row of little peaks along every near edge.
  const hairpin = (spans, halfA, rimA, t) => {
    const P = (a, y) => (spans === "z" ? [t, y, a] : [a, y, t]);
    wire([P(-rimA, 0), P(-halfA, -flange), P(-halfA, fy + bend), P(-halfA + bend, fy),
          P(halfA - bend, fy), P(halfA, fy + bend), P(halfA, -flange), P(rimA, 0)]);
  };
  // A plain wall wire: over the rim, down, and stopped at the floor.
  const post = (spans, halfA, rimA, t, s) => {
    const P = (a, y) => (spans === "z" ? [t, y, a] : [a, y, t]);
    wire([P(s * rimA, 0), P(s * halfA, -flange), P(s * halfA, fy + bend * 0.5), P(s * (halfA - 2), fy)]);
  };

  loop(w / 2, d / 2, 0, 22, gauge * 1.15 / 2);      // the rim -- heavier stock than the mat
  loop(cw / 2, cd / 2, -flange, 16, gauge / 2);     // the body's top frame, inboard of it

  if (!panels) {
    // CK-225 / CK-250. The mat spans the 356 and is spaced along the 245: 16 wires at 13.6mm over
    // 204mm, leaving the ~11mm margin to each long wall that the top view shows.
    const pitch = 13.6, spread = cw - 23, n = Math.round(spread / pitch);
    for (let i = 0; i <= n; i++) hairpin("z", cd / 2, d / 2, -spread / 2 + (i * spread) / n);

    // The two long walls: 13 verticals at 26.3mm across the 316 cavity. Measured off the manual's
    // line art as a dead-regular projected pitch, which then puts the 13th wire on 316.6mm -- the
    // published cavity, arrived at from the other direction. No horizontal courses: the drawing has
    // none and 121mm of wall does not ask for any.
    const nw = Math.round(cd / 26.3);
    for (let i = 0; i <= nw; i++) for (const s of [-1, 1])
      post("y", cw / 2, w / 2, -cd / 2 + (i * cd) / nw, s);

    // Four transverse ribs UNDER the mat, at the stations measured off the top view (+/-0.171 and
    // +/-0.376 of the depth, dead symmetric). They are what the floor rides on, and their undersides
    // are the -h the catalogue publishes.
    for (const f of [-0.376, -0.171, 0.171, 0.376])
      wire([[-cw / 2 + 6, fy - gauge, f * d], [cw / 2 - 6, fy - gauge, f * d]]);
  } else {
    // CK-226 / CK-251. The mat is turned 90 degrees: the U's span the narrow 120 and are spaced
    // along the 356, ~27 of them -- a finer, denser weave than the 1-unit's.
    const nu = Math.round(cd / 12.2);
    for (let i = 0; i <= nu; i++) hairpin("x", cw / 2, w / 2, -cd / 2 + (i * cd) / nu);
    for (const f of [-0.33, 0, 0.33])                 // long floor wires tying the mat together
      wire([[f * cw, fy, -cd / 2 + 4], [f * cw, fy, cd / 2 - 4]]);

    // Horizontal courses up each long wall -- the half unit is narrow and tall and carries them
    // where the 1-unit carries none. Four on the deep one; the shallow has room for one.
    const nc = Math.max(1, Math.round((h - lift) / 30));
    for (let i = 1; i <= nc; i++) for (const s of [-1, 1])
      wire([[s * cw / 2, fy + ((h - lift) * i) / (nc + 1), -cd / 2], [s * cw / 2, fy + ((h - lift) * i) / (nc + 1), cd / 2]]);
    for (let i = 0; i <= 4; i++) for (const s of [-1, 1])   // the capped 102mm ends
      post("y", cd / 2, d / 2, -cw / 2 + (i * cw) / 4, s);

    // The two polypropylene end panels: THE SEAT. Flat caps over the 120mm ends, logo printed on
    // them, a bossed hole for the TTA 300mm shaft. Their tops are the tray's top, so they land in
    // the rails' recess and the tray hangs off them.
    const pd = 30, pt = 7, pp = metal(0x1c1e22, 0.05, 0.65);
    for (const sz of [-1, 1]) {
      const pz = sz * (d / 2 - pd / 2);
      box(g, w, pt, pd, 3, pp, 0, -pt / 2, pz);
      cyl(g, 9, 9, pt + 2, 14, pp, 0, -pt / 2, pz);               // the raised boss
      // the shaft hole, faked with a dark plug the way frameGroup fakes its hook holes
      cyl(g, 5.5, 5.5, pt + 4, 12, metal(0x0e0f12, 0.2, 0.8), 0, -pt / 2, pz);
    }
  }
  return { group: g, body: ghost };
}

// Where an IGT module's rim actually lands -- measured, not guessed. frame_fittings.json read the
// rail section off the CK-149 underside plan: the clear span between the rails is 317, and the LIP
// (the ledge a module rests on) runs |z| 158.5..182.5. A module published 360 deep reaches
// |z| = 180 -- onto that lip. So a stainless module is a box whose WALLS drop through the 317
// opening and whose rim turns out ~21.5mm each rail side to sit on it. That is what "an IGT unit
// embeds FLUSH with the work surface" is, in millimetres. Both stainless boxes below are that.
const RAIL_SPAN = 317;
const wallSpan = d => Math.min(d, RAIL_SPAN);

/** A module's two rail-side rims: flat strips from the wall out to the published depth `d`, their
 *  top at y = 0 -- the faces that actually carry the part on the frame. */
function railRimInto(g, w, d, mat) {
  const wd = wallSpan(d), rim = (d - wd) / 2;
  if (rim <= 0.5) return;
  for (const sz of [-1, 1]) box(g, w, 1.5, rim, 0.5, mat, 0, -0.75, (sz * (wd + rim)) / 2);
}

/** Stainless Box Half Unit (CK-025): the half-unit (125 x 360) stainless box that hangs in the
 *  frame. What the photographs show, and what they don't:
 *
 *    hero_01     a plain folded-sheet box: vertical walls, open top, and NO handle. The handle is
 *                a different part -- the catalogue's CK-020 Box Hanger is what carries it.
 *    hero_01     a column of ~5 spot welds up each vertical corner, where the folded end panel is
 *                joined to the long one. The only mark the box has; there is no other ornament.
 *    switch2     four boxes dropped in a frame with their lids off: they hang by an out-turned
 *                RIM, and they butt together at a 125 pitch with no gap between neighbours.
 *
 *  The rim is measured (see RAIL_SPAN). Only the two RAIL-side rims are built -- whether the fold
 *  also turns out at the two short ends is not readable (the hero has the lid over it; in switch2
 *  the boxes butt), so it is left out, and in x the box stays the full 125, which is what makes
 *  four of them tile a frame.
 *
 *  The LID is not built here. It is CK-026 -- a plate with a finger hole that flatBoardGeo already
 *  draws from its own record. One shape, one owner. Rim at y = 0, body hanging to -h. */
export function stainlessBoxGroup(w, d, h, { color = 0xb9bec4, wall = 3 } = {}) {
  const wallD = wallSpan(d);
  // It IS a bin -- four walls and a floor, open on top -- narrowed to drop through the rail opening.
  const { group: g, body } = binGroup(w, wallD, h, { open: true, color, wall });
  railRimInto(g, w, d, metal(color, 0.8, 0.4));

  // The corner spot welds: five up each of the four vertical corners. Small proud studs -- at this
  // scale that is what a weld nugget reads as.
  const weld = metal(0x969ba2, 0.9, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < 5; i++)
    cyl(g, 1.8, 1.8, 1.2, 8, weld, sx * (w / 2 - 7), -16 - (i * (h - 32)) / 4,
        sz * (wallD / 2), Math.PI / 2);

  return { group: g, body };
}

// What the BBQ's two halves can be. It SHIPS with two 焼き網 nets; a 鉄板 griddle plate is bought
// separately and takes either net's place (owner) -- so the halves are independent. The cooking
// surfaces are size-shared with the Takibi Fire & Grill L, so a plate bought for one fits the other.
// How proud of the frame the GS-230 sits with its cover on. Owner, from use: "about half an inch to
// three-quarters" -- so ~15mm, the middle of that. Remembered, not measured; with the cover OFF the
// stove is flush, which is the rim at y = 0.
const LID_PROUD = 15;

export const BBQ_SURFACES = {
  nets:   ["net", "net"],
  mixed:  ["net", "plate"],
  plates: ["plate", "plate"],
};

/** Double BBQ Box (CK-160; JP リフトアップBBQ BOX, "lift-up"): a charcoal BBQ that drops into the
 *  frame. Its manual settles what it is, and it is NOT the grate-half + griddle-half the old bbq
 *  branch drew. There is no griddle:
 *
 *    本体            the stainless box, vents low in its long walls
 *    インナートレー(炭床)  the charcoal bed: a perforated dark tray sitting INSIDE the box (step 3)
 *    昇降フレーム       the LIFT frame, which stands up on links and carries the nets
 *    焼き網 x2        TWO grill nets, side by side, half the top each -- this is the "Double"
 *    フタ / スタンド x2 / ハンドル   a lid, two stands, and a crank handle
 *
 *  The dark slab in the gallery is the LID resting on the nets ("rest the lid on the grate to hold
 *  in heat"), inverted so we look into it -- not a cooking surface. It is not built: step 1 is
 *  "take the lid off", which is where cooking starts.
 *
 *  W605 x D360 x H175 is the STANDALONE form. The IGT form is smaller, and the manual says so:
 *  step 6 mounts it by REMOVING the handle and the stands. What is left is the 収納 size,
 *  W500 x D370 x H120 -- and 500 is exactly two IGT units, one per net, which is what "Double Unit
 *  BBQ Box" has been saying all along. So the body is built at 500 x 120; the 55 that H175 has over
 *  the packed 120 is the lift frame standing up; and `w` is deliberately unused, because the 605
 *  measures across the splayed stands and the stands come off. D360 is real -- it is the rim, and
 *  it lands on the rail lip like any module.
 *
 *  EITHER HALF SWAPS (owner): a 鉄板 griddle plate takes a net's place, so the two halves are
 *  independently net-or-plate -- `surfaces`. Two nets is what it SHIPS with; the plate is bought
 *  separately. Its cooking surfaces are size-shared with the Takibi Fire & Grill L.
 *
 *  Rim at y = 0 hanging to -bodyH, and the surfaces RISE ABOVE it -- the exception this file's
 *  header already names. */
export function bbqBoxGroup(w, d, h, { color = 0xb9bec4, bodyW = 500, bodyH = 120,
                                       surfaces = ["net", "net"] } = {}) {
  const wallD = wallSpan(d), wall = 2;
  const { group: g, body } = binGroup(bodyW, wallD, bodyH, { open: true, color, wall });
  const mat = metal(color, 0.8, 0.4);
  railRimInto(g, bodyW, d, mat);

  // The vents: a row of round holes low in each long wall. Punched dark, the way frameGroup does
  // its hook holes.
  const punch = metalE(0x0e0f12, 0.2, 0.8);
  for (const sz of [-1, 1]) for (let i = 0; i < 10; i++)
    cyl(g, 5, 5, wall + 3, 12, punch, -bodyW * 0.4 + (i * bodyW * 0.8) / 9, -bodyH + 32,
        sz * (wallD / 2 - wall / 2), Math.PI / 2);

  // インナートレー -- the charcoal bed: a shallow pan set inboard of the lift frame (step 3), its
  // floor punched in two hole sizes so ash drops through. It reads DARK in every photo: that is the
  // coated steel of the 材質, not the stainless of the box.
  const trayMat = metal(0x2b2e33, 0.35, 0.62);
  const trW = bodyW - 56, trD = wallD - 52, trY = -bodyH + 66, trH = 22;
  box(g, trW, 2, trD, 1, trayMat, 0, trY, 0);
  for (const sz of [-1, 1]) box(g, trW, trH, 2, 0.5, trayMat, 0, trY + trH / 2, sz * (trD / 2 - 1));
  for (const sx of [-1, 1]) box(g, 2, trH, trD, 0.5, trayMat, sx * (trW / 2 - 1), trY + trH / 2, 0);
  for (const r of [-1, 0, 1]) for (let i = 0; i < 11; i++)
    cyl(g, i % 2 ? 4 : 6.5, i % 2 ? 4 : 6.5, 4, 10, punch,
        -trW * 0.42 + (i * trW * 0.84) / 10, trY, r * trD * 0.26);

  // 昇降フレーム + 焼き網 x2, drawn at the RAISED height -- which is exactly what H175 measures.
  const lift = Math.max(h - bodyH, 0), netT = 5, barT = 12;
  const lfW = bodyW - 14, lfD = wallD - 14, lfY = lift - netT - barT / 2;
  for (const sz of [-1, 1]) box(g, lfW, barT, 10, 1.5, mat, 0, lfY, sz * (lfD / 2 - 5));
  for (const sx of [-1, 1]) box(g, 10, barT, lfD, 1.5, mat, sx * (lfW / 2 - 5), lfY, 0);

  // The links that stand the frame up. A crank on the front wall drives them (step 5). They are
  // plainly a scissor between the body rim and the frame, but the exact bar layout does not read
  // off any photo -- so this is a schematic X per end, not a claim about the linkage.
  const linkMat = metal(0xaeb4ba, 0.9, 0.3);
  const link = (a, b) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2.5 * MM, 2.5 * MM, va.distanceTo(vb) || MM, 8), linkMat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m);
  };
  for (const sx of [-1, 1]) {
    const x = sx * (lfW / 2 - 24), zs = lfD / 2 - 18, yTop = lfY - barT / 2;
    link([x, -6, -zs], [x, yTop, zs]);
    link([x, -6, zs], [x, yTop, -zs]);
  }

  // The two cooking surfaces, one per unit -- each independently a 焼き網 net or a 鉄板 griddle
  // plate. A net is a woven wire grid in a thin border (the pitch is representative; the real mesh
  // is finer than it is worth drawing). A plate is what it sounds like: a solid slab with a raised
  // lip to hold the fat in, and it reads DARK -- it is not stainless.
  const netMat = metal(0xd0d4d9, 0.92, 0.24);
  const plateMat = metal(0x33373d, 0.42, 0.55);
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const nw = lfW / 2 - 3, nd = lfD - 8, cx = sx * (lfW / 4 + 1.5), rim = 6;
    if (surfaces[i] === "plate") {
      box(g, nw, 7, nd, 1.5, plateMat, cx, lift - 3.5, 0);                      // the slab
      for (const sz of [-1, 1]) box(g, nw, 5, 3, 1, plateMat, cx, lift + 2.5, sz * (nd / 2 - 1.5));
      for (const s2 of [-1, 1]) box(g, 3, 5, nd, 1, plateMat, cx + s2 * (nw / 2 - 1.5), lift + 2.5, 0);
      continue;
    }
    const pitch = 22;
    for (const sz of [-1, 1]) box(g, nw, 4, rim, 1, netMat, cx, lift - 2, sz * (nd / 2 - rim / 2));
    for (const s2 of [-1, 1]) box(g, rim, 4, nd, 1, netMat, cx + s2 * (nw / 2 - rim / 2), lift - 2, 0);
    const iw = nw - 2 * rim, id = nd - 2 * rim;
    const nx = Math.max(2, Math.round(iw / pitch)), nz = Math.max(2, Math.round(id / pitch));
    for (let j = 1; j < nx; j++) box(g, 2, 2, id, 0, netMat, cx - iw / 2 + (j * iw) / nx, lift - 1.5, 0);
    for (let j = 1; j < nz; j++) box(g, iw, 2, 2, 0, netMat, cx, lift - 3.5, -id / 2 + (j * id) / nz);
  }
  return { group: g, body };
}

/** Snow Peak GigaPower Two Burner "liquid feed" (GS-230): the big two-burner stove -- the one slot
 *  module that is really a self-contained appliance, so it gets a builder rather than a BURNERS row.
 *
 *  READ THE SPEC RIGHT, or nothing fits. The manual (GS-230_manual.pdf p.16) lists W x H x D, not
 *  W x D x H: "収納時 500x110x360 / 風防装着使用時 563x293x383 / スタンド装着時 563x514x383".
 *  Fitting the STAND moves only the middle number, by +221mm -- legs raise a stove, they do not make
 *  it deeper -- so the middle number is the HEIGHT. The same reading makes the packed figure a
 *  500-wide, 110-THICK, 360-deep slab: the body with its cover clamped on. The catalogue's
 *  assembled_mm had d and h SWAPPED, which is why d=293 came out SMALLER than the frame's own 317mm
 *  clear span -- it could not have rested on the rails, yet the photo shows it seated. (Corrected in
 *  overrides.json; this builder does not depend on it.)
 *
 *  What the photographs show (the hero front elevation; the top view of the stove dropped INTO an
 *  IGT frame; the manual's exploded set-contents p.6 and fold-away plan p.7):
 *    - a shallow stainless PAN -- a deck with a well sunk into it, its rim landing on the rails like
 *      any other unit. Not a deep box: 70mm below the rim (packed 110 less its ~40mm cover).
 *    - TWO brass-ported heads down in the well on 233mm centres -- measured against the frame's own
 *      published geometry, and 23cm is the manual's biggest pot: the burners sit one pot apart.
 *    - TWO wire ゴトク, one per burner (p.11 flips them 180 degrees for HIGH/LOW; this is LOW).
 *    - TWO knobs on the FRONT face, standing proud of it -- what makes the deployed DEPTH 383
 *      against a 360 body.
 *    - a THREE-panel windscreen: the carry COVER stood up at the back, a wing hinged off each end
 *      swinging forward. Folded, the wings lie inside the cover -- which is why packed width is 500
 *      and deployed width 563: the wings swing out PAST the body.
 *
 *  `w` is the along-rail width -- 500, two units, which is what railW(span 4) gives and what the
 *  in-frame photo measures. The d/h a caller derives from assembled_mm describe the DEPLOYED
 *  envelope, not the body, so this builder does not take them. Rim at y = 0, pan hanging to -bodyH,
 *  windscreen standing above. */
export function gs230Group(w = 500, { seat = 360, h = 293, bodyH = 70, lid = false } = {}) {
  const g = new THREE.Group();
  const steel = 0x9aa0a8, dark = 0x26292e, screen = 0xb4b9bf;
  const SPACING = 233;                       // head centres, measured in the frame
  const wellW = 460, wellD = 264, wellY = -48;
  const screenH = h - bodyH;                 // 223 -- what stands ABOVE the tabletop

  // The housing: a shallow pan, built as a deck flange round a sunken well rather than a solid
  // block, because the well IS what you see. Flange outer 500x360, inner 460x264.
  const deck = metal(steel, 0.85, 0.35);
  const endW = (w - wellW) / 2, sideD = (seat - wellD) / 2;
  const body = box(g, w, 6, sideD, 1, deck, 0, -3, (wellD + sideD) / 2);   // front deck: the knobs
  box(g, w, 6, sideD, 1, deck, 0, -3, -(wellD + sideD) / 2);               // back deck: the screen
  for (const sx of [-1, 1]) box(g, endW, 6, wellD, 1, deck, sx * (wellW + endW) / 2, -3, 0);

  // the pan's outer skirt, and the well's dark floor down inside it
  const skin = metal(steel, 0.8, 0.4);
  for (const sz of [-1, 1]) box(g, w, bodyH, 8, 1, skin, 0, -bodyH / 2, sz * (seat / 2 - 4));
  for (const sx of [-1, 1]) box(g, 8, bodyH, seat, 1, skin, sx * (w / 2 - 4), -bodyH / 2, 0);
  box(g, wellW, 4, wellD, 1, metal(dark, 0.4, 0.6), 0, wellY, 0);

  for (const sx of [-1, 1]) {
    const hx = sx * (SPACING / 2);
    // the head: an 88mm ported ring round a brass centre, with its nozzle below at 6 o'clock
    cyl(g, 44, 44, 16, 28, metal(0x4c5259, 0.5, 0.55), hx, wellY + 10, 0);
    cyl(g, 25, 25, 10, 24, metal(0x9c6b3a, 0.75, 0.4), hx, wellY + 18, 0);
    cyl(g, 5, 5, 22, 10, metal(0xb08a4a, 0.8, 0.35), hx, wellY - 4, 34);
    // the ゴトク. The real one is an hourglass wire frame pinched either side of the head; four
    // crossed bars is what that reads as at this size, and is the same shorthand burnerGroup uses.
    for (let a = 0; a < 4; a++)
      box(g, 118, 4, 5, 1, metal(steel, 0.9, 0.3), hx, 35, 0, (a * Math.PI) / 4);
    for (const c of [-1, 1]) box(g, 4, 80, 4, 1, metal(steel, 0.9, 0.3), hx + c * 52, -5, 0);
    // the knob, out under its own burner
    cyl(g, 13, 13, 23, 16, metal(0x1c1f24, 0.4, 0.6), hx, -40, seat / 2 + 11.5, Math.PI / 2);
  }

  // COVER ON -- the third state, the one the manual never dimensions. The windscreen panel IS the
  // carry cover: clamped down it lies flat over the stove instead of standing up behind it, so it
  // is one or the other, never both. OWNER (2026-07-16), from use rather than from a drawing: with
  // the lid on it stands about half to three-quarters of an inch proud of the frame; take the lid
  // off and the stove is FLUSH -- which is the rim at y = 0 this builder already had, confirmed
  // from the other side. LID_PROUD is the middle of that recollection, ~15mm. Said plainly: it is
  // remembered, not measured, and it does not reconcile with the packed 110 (body 70 + cover 40),
  // which suggests the cover nests down INTO the rim rather than sitting on it -- so 40 is the
  // cover's depth and ~15 is only what shows.
  if (lid) {
    box(g, w, LID_PROUD, seat, 2, metal(screen, 0.8, 0.4), 0, LID_PROUD / 2, 0);
    return { group: g, body };
  }

  // The windscreen, DEPLOYED. The back panel is the cover, 500 wide, standing on the back deck; each
  // wing hinges at its end and swings forward, splayed just enough to put its free edge at
  // x = +/-281.5 -- which is the published 563. Each wing TAPERS, tall at the hinge and falling to
  // its free edge (the fold-away plan p.7 and the hero both show the slope), so it is extruded from
  // an outline rather than boxed.
  box(g, w, screenH, 3, 1, metal(screen, 0.8, 0.4), 0, screenH / 2, -(seat / 2 - 1.5));
  const WING = 250, TIP = 130, SPLAY = Math.asin((563 / 2 - w / 2) / WING);
  const wing = new THREE.Shape();
  wing.moveTo(0, 0); wing.lineTo(WING * MM, 0);
  wing.lineTo(WING * MM, TIP * MM); wing.lineTo(0, screenH * MM); wing.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 3 * MM, bevelEnabled: false });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(wingGeo, metal(screen, 0.8, 0.4));
    m.rotation.y = -Math.PI / 2 + sx * SPLAY;      // local +x runs hinge -> free edge, splayed out
    m.position.set(sx * (w / 2) * MM, 0, -(seat / 2) * MM);
    g.add(m);
  }
  return { group: g, body };
}

/** What 3D form a slotted part takes -- burner, mesh tray, or open box/bin. ONE classifier,
 *  so the planner and the part bench never disagree about a part's shape.
 *
 *  Every group's TOP sits at local y = 0, and the caller places that at the frame's top --
 *  because an IGT unit embeds FLUSH with the work surface. That is the default and the rule:
 *  the body hangs below into the frame, the rim is level with the tabletop. The few parts
 *  that rise above it do so from their own geometry (a burner's grate and pot-supports, the
 *  BBQ's lift frame and its two nets) -- the exception, built in, not the norm.
 *
 *  Returns null for a part that is genuinely just a thin slab (a shallow tray); the caller
 *  draws that itself. `color` is the part's swatch, passed in so this stays state-free; `cfg` is
 *  the placement's chosen configuration, for the few modules that have one. */
export function moduleGroup(p, w, d, h, color, topTex = null, cfg = null) {
  // The two stainless boxes are their own shapes, not the generic bin: both hang by a measured rim,
  // and the BBQ carries a whole charcoal fire. They go FIRST, before the generic h >= 60 bin.
  const base = p.sku.replace(/-(US|INT|EC|R)$/i, "");
  if (base === "CK-025") return stainlessBoxGroup(w, d, h, { color });
  if (base === "CK-160") return bbqBoxGroup(w, d, h, { color, surfaces: BBQ_SURFACES[cfg] || BBQ_SURFACES.nets });
  const bspec = burnerOf(p.sku);
  // GS-230 is an appliance, and its assembled_mm describes the DEPLOYED envelope (563 over the
  // splayed windscreen, 383 over the knobs) rather than the body -- so the d/h the caller derives
  // cannot be used. It takes only the along-rail width, the one number that is right:
  // railW(span 4) = 500 = the two units the in-frame photo measures. Its own stand is not built:
  // that is for standing on the ground, and on the IGT you take it off (owner).
  if (bspec?.gs230) return gs230Group(w, { lid: cfg === "closed" });
  if (bspec) return burnerGroup(bspec, w, d, h, topTex);
  // A mesh SLOT MODULE -- the four draining baskets. The role guard matters: isMesh is /mesh/i on
  // the title, which also catches the Mesh Folding Chair and Bench (mesh FABRIC). app.js routes
  // those through drawProp, but the part bench has no seating branch and would render an 838mm
  // chair as a wire basket.
  if (isMesh(p) && p.role === "slot_module")
    return meshTrayGroup(w, d, h, new THREE.Color(color),
      { panels: /ポリプロピレン|polypropylene/i.test(p.material || "") });
  if (h >= 60) return binGroup(w, d, h, { open: true, color });   // a box you put things in
  return null;                                                    // a thin tray: a slab
}

// ===========================================================================================
// The bigger nodes -- frame, table, Jikaro, hanging rack -- used to live only in the planner
// (app.js), so the part bench drew them as cubes or, being under 60mm, crashed on a null.
// They move here for the same reason the modules did: ONE shape, both renderers. Each is
// state-free, takes MILLIMETRES, and hangs from its working TOP at local y = 0.
// ===========================================================================================

const ALU_ = 0xc4c8ca;     // brushed aluminium -- standard rails, corner plates, rivets
const BLK_ = 0x24262a;     // anodised black -- end pieces, the collapsible's side rails

const metalE = (color, m, r, glow = 0x000000) =>
  new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), metalness: m, roughness: r,
    emissive: new THREE.Color(glow),
  });

// A rivet cluster, dropped onto a plate. Same little studs the frame corners wear.
function rivetsInto(g, pts, y, color = ALU_) {
  for (const [x, z] of pts) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * MM, 2.6 * MM, 3 * MM, 8),
      metalE(color, 0.9, 0.3));
    m.position.set(x * MM, y * MM, z * MM);
    g.add(m);
  }
}

/** The frame SHELL: two extruded rails, two end pieces, the hook holes, and four corner
 *  plates with rivets. NO legs and NO modules -- those are placement, and the caller adds
 *  them. This is the exact geometry drawFrame used to build inline; it is here so the bench
 *  builds the identical frame (recess and all) instead of a slab.
 *
 *  `section` is the measured rail cross-section (SECTION); `hookHoles` the measured hole
 *  centres, or null to fall back to the standard inset. Returns { group, pick } -- pick is
 *  the rails + ends, for the planner to tag for selection; the bench ignores it. */
export function frameGroup({ w, d, thick, collapsible = false, section, hookHoles = null,
                             holeInset = 16.5, railColor, endColor = BLK_, plateColor = ALU_,
                             glow = 0x000000 }) {
  const g = new THREE.Group();
  const pick = [];
  const railWidth = section.rail_width_mm;
  const endW = section.end_piece_mm;
  railColor = railColor ?? (collapsible ? BLK_ : ALU_);

  const prof = {
    outerWall: (d / 2 - section.channel_mm[1]) * MM,
    channel: (section.channel_mm[1] - section.channel_mm[0]) * MM,
    lip: (section.lip_mm[1] - section.lip_mm[0]) * MM,
  };
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(railProfile(w * MM, thick * MM, prof, s), metalE(railColor, 0.8, 0.42, glow));
    r.position.set(0, -thick / 2 * MM, s * (d / 2 - railWidth / 2) * MM);
    g.add(r); pick.push(r);
  }
  // End pieces -- anodised black on the standard frame; the hook holes live in them.
  for (const x of [-(w - endW) / 2, (w - endW) / 2]) {
    const e = new THREE.Mesh(roundedBox(endW * MM, thick * MM, d * MM, 2 * MM), metalE(endColor, 0.55, 0.5, glow));
    e.position.set(x * MM, -thick / 2 * MM, 0);
    g.add(e); pick.push(e);
  }
  // The hook holes in the end pieces, where an extension's wire hooks drop in.
  const holes = hookHoles || [
    [-(w / 2 - holeInset), -143.9], [-(w / 2 - holeInset), 143.9],
    [w / 2 - holeInset, -143.9], [w / 2 - holeInset, 143.9],
  ];
  for (const [hx, hz] of holes) {
    const x = Math.sign(hx) * (w / 2 - holeInset);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(6 * MM, 6 * MM, (thick + 2) * MM, 10),
      metalE(0x0e0f12, 0.2, 0.8));
    hole.position.set(x * MM, -thick / 2 * MM, hz * MM);
    g.add(hole);
  }
  // Corner plates: leg-socket plates on the standard frame, larger fold hinges on the
  // collapsible. Sit ON top of the rails, rivetted.
  const cornerX = w / 2 - (collapsible ? 34 : 26);
  const cornerZ = d / 2 - railWidth / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const plate = new THREE.Mesh(
      roundedBox((collapsible ? 60 : 46) * MM, 4 * MM, (collapsible ? railWidth - 4 : 44) * MM, 2 * MM),
      metalE(plateColor, 0.85, 0.35, glow));
    plate.position.set(sx * cornerX * MM, 2 * MM, sz * cornerZ * MM);
    g.add(plate);
    rivetsInto(g, [
      [sx * (cornerX - 16), sz * (cornerZ - 12)], [sx * (cornerX + 16), sz * (cornerZ - 12)],
      [sx * (cornerX - 16), sz * (cornerZ + 12)], [sx * (cornerX + 16), sz * (cornerZ + 12)],
    ], 3, plateColor);
  }
  return { group: g, pick };
}

/** A layout table or standalone IGT: a work surface on four tapered legs. `height` is the
 *  table's overall height, `thick` the top's thickness. Surface top at y = 0, legs to
 *  -height. The planner uses drawTable for its configured leg heights; this is the same
 *  object at the part's own standalone height, for the bench. */
export function tableGroup(w, d, height, thick, color, legColor = null) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(roundedBox(w * MM, thick * MM, d * MM, 2.2 * MM),
    metalE(color, 0.6, 0.45));
  top.position.y = -thick / 2 * MM;
  g.add(top);
  const legH = Math.max(height - thick, 20);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(10 * MM, 8 * MM, legH * MM, 14),
      metalE(legColor ?? 0x9aa0a8, 0.85, 0.32));
    leg.position.set(sx * (w / 2 - 35) * MM, -(thick + legH / 2) * MM, sz * (d / 2 - 35) * MM);
    g.add(leg);
  }
  return { group: g, body: top };
}

// A folding leg at one short end: two struts splaying from under the frame OUT past the end to
// a foot bar, the way the built-in legs of the entry/slim IGTs fold down. ex = which end (±1).
function foldLeg(g, { ex, w, d, top, footY, mat, r, splay, inset, zIn, feet = false }) {
  const strut = (a, b, rr) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rr * MM, rr * MM, va.distanceTo(vb) || MM, 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m);
  };
  const topX = ex * (w / 2 - inset), footX = ex * (w / 2 + splay), zEdge = d / 2 - zIn;
  const foot = [];
  for (const sz of [-1, 1]) {
    strut([topX, top, sz * zEdge], [footX, footY, sz * zEdge], r);      // an upright
    foot.push([footX, footY, sz * zEdge]);
  }
  strut(foot[0], foot[1], r * 0.85);                                    // the foot bar
  if (feet) for (const f of foot) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3 * MM, r * 1.5 * MM, 12 * MM, 10),
      metalE(0x27292d, 0.1, 0.85));
    cap.position.set(f[0] * MM, f[1] * MM, f[2] * MM); g.add(cap);
  }
}

/** Entry IGT (CK-080R): a self-contained 3-unit IGT frame -- an aluminium ring on two built-in
 *  folding TUBE legs. Its bamboo top is REMOVABLE (2x one-unit + 2x half-unit pieces, no SKU) so
 *  IGT units drop in; the top itself is drawn by igtWoodTop, per free half-unit, so this builds
 *  only the frame + legs. Top at y = 0. */
export function entryIgtGroup(w, d, height) {
  const g = new THREE.Group();
  const alu = metalE(0xd0d3d7, 0.85, 0.35);
  const thick = 26, bar = 12;
  // the aluminium frame: a shallow ring of four bars round the top edge
  for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(roundedBox(w * MM, thick * MM, bar * MM, 1.5 * MM), alu);
    b.position.set(0, -thick / 2 * MM, sz * (d / 2 - bar / 2) * MM); g.add(b);
  }
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(roundedBox(bar * MM, thick * MM, d * MM, 1.5 * MM), alu);
    b.position.set(sx * (w / 2 - bar / 2) * MM, -thick / 2 * MM, 0); g.add(b);
  }
  // two built-in folding tube legs
  const legMat = metalE(0xc6c9cd, 0.85, 0.32);
  for (const ex of [-1, 1])
    foldLeg(g, { ex, w, d, top: -thick, footY: -(height - thick), mat: legMat, r: 6, splay: 18, inset: 34, zIn: 26, feet: true });
  return { group: g, body: g.children[0] };
}

/** The removable custom top of a self-contained IGT (Entry/Slim): one wood tile per FREE
 *  half-unit across the 3-unit run, so a dropped module simply takes a tile's place -- which is
 *  exactly how the real tops lift out. `skip` = occupied half-slot indices; `color` bamboo/teak;
 *  `d` the body depth (the tile spans the IGT depth, centred). Tiles hang just below y = 0. */
export function igtWoodTop({ units, color, skip = [], d, thick = 14, tex = null }) {
  const g = new THREE.Group();
  // `tex` (a grain map configured by the caller) gives the wood its figure; `color` tints it.
  const wood = new THREE.MeshStandardMaterial({ color, map: tex || null, roughness: 0.62, metalness: 0.03 });
  const HALF = 125, run = units * 250, tileD = Math.min(d - 40, 360), gap = 4;
  const skipSet = new Set(skip);
  for (let i = 0; i < units * 2; i++) {
    if (skipSet.has(i)) continue;                       // a module sits here instead
    const cx = -run / 2 + i * HALF + HALF / 2;
    const tile = new THREE.Mesh(roundedBox((HALF - gap) * MM, thick * MM, tileD * MM, 1 * MM), wood);
    tile.position.set(cx * MM, -thick / 2 * MM, 0); g.add(tile);
  }
  return { group: g };
}

/** Slim IGT (CK-180): a self-contained 3-unit IGT frame -- NO long-side rails, just two dark end
 *  caps and thin support rods, on two folding THIN-WIRE legs. Its top is SIX removable half-unit
 *  teak panels (any lifts out for a stovetop) -- drawn by igtWoodTop -- so this builds only the
 *  end caps, rods and legs. Top at y = 0. */
export function slimIgtGroup(w, d, height) {
  const g = new THREE.Group();
  // The frame is BLACK-coated steel (spec: スチール カチオン電着塗装) -- only the top is teak.
  const black = metalE(0x24262a, 0.5, 0.5);
  const thick = 16, cap = 26;
  // black steel end caps (the short ends -- there is NO rail down the long sides)
  for (const sx of [-1, 1]) {
    const c = new THREE.Mesh(roundedBox(cap * MM, (thick + 8) * MM, d * MM, 1.5 * MM), black);
    c.position.set(sx * (w / 2 - cap / 2) * MM, -(thick + 8) / 2 * MM, 0); g.add(c);
  }
  // a thin black support rod under each long edge (carries the removable panels -- NOT a rail)
  const rod = black;
  for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(3 * MM, 3 * MM, (w - 2 * cap) * MM, 8), rod);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, -(thick + 1) * MM, sz * (d / 2 - 5) * MM); g.add(r);
  }
  // two built-in folding thin-wire legs, splayed wide
  const wire = metalE(0x1c1e22, 0.4, 0.5);
  for (const ex of [-1, 1])
    foldLeg(g, { ex, w, d, top: -thick, footY: -(height - thick), mat: wire, r: 3, splay: 44, inset: 13, zIn: 12, feet: true });
  return { group: g, body: g.children[0] };
}

/** Extension IGT (CK-090): two laminated-bamboo tops on an aluminium stand that SLIDE APART.
 *  Closed it is a plain table; slid open it exposes a central IGT bay between the two tops.
 *  `w` is the CURRENT footprint width (1348 open / 840 closed); `bayW` the gap opened between
 *  the tops (0 when closed) -- silver IGT rails show across that gap. Fixed folding tube legs.
 *  Top at y = 0. Returns { group, body, bay } -- bay = {w,d} of the exposed slot, or null. */
export function extIgtGroup(w, d, height, { bayW = 0, bayD = 360, tex = null } = {}) {
  const g = new THREE.Group();
  const alu = metalE(0x26282c, 0.7, 0.45);   // BLACK frame -- the real CK-090 stand is matte black
  const bamboo = new THREE.MeshStandardMaterial({ color: 0xd8bd86, map: tex || null, roughness: 0.62, metalness: 0.03 });
  const thick = 22, bar = 12;
  const topW = (w - bayW) / 2;                        // each bamboo top's slice of the width
  // aluminium stand: a shallow ring of four bars round the whole footprint
  for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(roundedBox(w * MM, thick * MM, bar * MM, 1.5 * MM), alu);
    b.position.set(0, -thick / 2 * MM, sz * (d / 2 - bar / 2) * MM); g.add(b);
  }
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(roundedBox(bar * MM, thick * MM, d * MM, 1.5 * MM), alu);
    b.position.set(sx * (w / 2 - bar / 2) * MM, -thick / 2 * MM, 0); g.add(b);
  }
  // the two bamboo tops, one each side of the centre bay
  const panelD = d - 2 * bar, panelW = topW - 8;
  for (const sx of [-1, 1]) {
    const cx = sx * (bayW / 2 + topW / 2);
    const p = new THREE.Mesh(roundedBox(panelW * MM, (thick - 6) * MM, panelD * MM, 1 * MM), bamboo);
    p.position.set(cx * MM, -(thick - 6) / 2 * MM - 3 * MM, 0); g.add(p);
  }
  // the exposed IGT bay: two silver rails bridging the gap, at the datum, framing the slot
  if (bayW > 0) {
    const rail = metalE(0xbfc3c7, 0.9, 0.3);
    for (const sz of [-1, 1]) {
      const r = new THREE.Mesh(roundedBox((bayW + 16) * MM, (thick - 4) * MM, 16 * MM, 1.5 * MM), rail);
      r.position.set(0, -(thick - 4) / 2 * MM, sz * (bayD / 2) * MM); g.add(r);
    }
    for (const sx of [-1, 1]) {                       // short end lips closing the slot
      const e = new THREE.Mesh(roundedBox(14 * MM, (thick - 4) * MM, bayD * MM, 1.5 * MM), rail);
      e.position.set(sx * (bayW / 2) * MM, -(thick - 4) / 2 * MM, 0); g.add(e);
    }
  }
  // two built-in folding tube legs at the ends -- black, matching the frame
  const legMat = metalE(0x1e2024, 0.6, 0.5);
  for (const ex of [-1, 1])
    foldLeg(g, { ex, w, d, top: -thick, footY: -(height - thick), mat: legMat, r: 6, splay: 18, inset: 40, zIn: 30, feet: true });
  return { group: g, body: g.children[0], bay: bayW > 0 ? { w: bayW, d: bayD } : null };
}

/** Snow Peak Folding Chair (LV-077): a director's chair -- a black aluminium X-frame (it folds
 *  side to side, so the crossing X sits in the front and back faces) carrying a taupe canvas seat,
 *  back and armrests. The FIRST non-IGT prop: free-standing, feet on the ground at y = 0. Faces
 *  +z (back panel at -z). Modelled from the LV-077GY product photo. */
export function foldingChairGroup(w, d, h, { frame = 0x232528, fabric = 0x8c8279, seatH = 457, canvasTex = null, meshAlpha = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.5, 0.45);
  // Canvas (a woven map, tinted) or a see-through mesh (a perforated alphaMap over dark fabric).
  const cloth = meshAlpha
    ? new THREE.MeshStandardMaterial({ color: fabric, alphaMap: meshAlpha, transparent: true, alphaTest: 0.12, roughness: 0.85, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  const cyl = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const tube = (a, b, r = 9) => cyl(a, b, r, tubeMat);
  const roll = (a, b, r) => cyl(a, b, r, cloth);          // a fabric/foam sleeve over the frame
  const pad = (bw, bh, bd, x, y, z) => {
    const m = new THREE.Mesh(roundedBox(bw * MM, bh * MM, bd * MM, 3 * MM), cloth);
    m.position.set(x * MM, y * MM, z * MM); g.add(m); return m;
  };
  const sw = w / 2 - 35, fw = w / 2, sd = 195, armH = seatH + 150;

  // front & back X-frames -- each crosses a top seat corner to the opposite foot; the two sit at
  // z = +/-sd and, seen head-on, overlap into the single X the photo shows.
  for (const zc of [sd, -sd]) {
    tube([-sw, seatH, zc], [fw, 8, zc]);
    tube([sw, seatH, zc], [-fw, 8, zc]);
  }
  // side foot rails + seat side rails tie the front frame to the back frame
  for (const sx of [-1, 1]) {
    tube([sx * fw, 8, sd], [sx * fw, 8, -sd]);
    tube([sx * sw, seatH, sd], [sx * sw, seatH, -sd]);
  }
  pad(2 * sw, 12, 2 * sd, 0, seatH - 14, 0);   // seat sling

  // back posts (tilt back) + canvas panel floating above the arms
  for (const sx of [-1, 1]) tube([sx * sw, seatH, -sd], [sx * sw, h, -sd - 45], 8);
  pad(2 * sw + 20, 165, 14, 0, h - 95, -sd - 30);

  // armrests: a front support up, the arm tube back to the post, and a fabric+foam SLEEVE that
  // wraps the arm tube (a cylinder round the frame, not a flat pad).
  for (const sx of [-1, 1]) {
    tube([sx * sw, seatH, sd], [sx * sw, armH, sd - 5], 8);
    tube([sx * sw, armH, sd - 5], [sx * sw, armH, -sd + 20], 8);
    roll([sx * sw, armH, sd - 14], [sx * sw, armH, -sd + 28], 18);
  }
  return { group: g, body: g.children[0] };
}

/** Snow Peak Low Beach Chair (LV-091): a low, reclined beach chair -- a SILVER aluminium tube
 *  frame, a khaki canvas sling (seat + high reclined back), and two straight laminated-BAMBOO
 *  armrests. Low seat (~300mm), feet on the ground at y = 0, faces +z. From the LV-091KH photo. */
export function lowBeachChairGroup(w, d, h, { frame = 0xbfc3c7, fabric = 0xc6b487, wood = 0xd8bd86, seatH = 300, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.7, 0.35);
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.92, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.55, metalness: 0.03 });
  const cyl = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const tube = (a, b, r = 9) => cyl(a, b, r, tubeMat);
  const box = (bw, bh, bd, x, y, z, mat, rx = 0) => {
    const m = new THREE.Mesh(roundedBox(bw * MM, bh * MM, bd * MM, 3 * MM), mat);
    m.position.set(x * MM, y * MM, z * MM); m.rotation.x = rx; g.add(m); return m;
  };
  const sw = w / 2 - 30;
  // side-profile joints as [z, y]: front foot, seat front, hinge, back top, back foot. The back
  // top rides off `h`, so a lower-backed sibling (the Luxury chair) falls out of its dimensions.
  const FF = [270, 0], SF = [175, 305], HB = [-115, 285], BT = [-255, h - 45], BF = [-175, 0];
  for (const sx of [-1, 1]) {
    const X = sx * sw;
    tube([X, FF[1], FF[0]], [X, SF[1], SF[0]]);   // front leg
    tube([X, SF[1], SF[0]], [X, HB[1], HB[0]]);   // seat rail
    tube([X, HB[1], HB[0]], [X, BT[1], BT[0]]);   // reclined back rail
    tube([X, HB[1], HB[0]], [X, BF[1], BF[0]]);   // back leg
    tube([X, SF[1], 150], [X, 376, 132], 8);      // armrest front support
    box(46, 16, 270, X, 384, -4, woodMat);        // straight wood armrest
    for (const f of [FF, BF]) {                    // black feet
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(13 * MM, 15 * MM, 12 * MM, 10), metalE(0x1c1e22, 0.1, 0.85));
      cap.position.set(X * MM, 6 * MM, f[0] * MM); g.add(cap);
    }
  }
  // cross rails tie the two side frames together
  tube([-sw, FF[1], FF[0]], [sw, FF[1], FF[0]]);
  tube([-sw, BF[1], BF[0]], [sw, BF[1], BF[0]]);
  tube([-sw, SF[1], SF[0]], [sw, SF[1], SF[0]]);
  tube([-sw, BT[1], BT[0]], [sw, BT[1], BT[0]]);
  tube([-sw, HB[1], HB[0]], [sw, HB[1], HB[0]]);
  // canvas sling: seat panel + reclined back panel
  box(2 * sw - 10, 10, 300, 0, 291, 30, cloth);
  const blen = Math.hypot(BT[0] - HB[0], BT[1] - HB[1]);   // panel: tall (blen) in Y, thin in Z
  box(2 * sw - 10, blen, 10, 0, (HB[1] + BT[1]) / 2, (HB[0] + BT[0]) / 2, cloth,
    Math.atan2(BT[0] - HB[0], BT[1] - HB[1]));
  return { group: g, body: g.children[0] };
}

/** Snow Peak Campfield Futon (SET-200) in its basic SOFA form: a low two-seat loveseat -- a
 *  silver aluminium X-frame base, taupe seat + reclined back cushions, natural-wood armrests on
 *  the ends. The real set reconfigures many ways (bed / chairs / shelves); we model only the sofa.
 *  Feet at y = 0, faces +z. */
export function campfieldSofaGroup(w, d, h, { frame = 0xbfc3c7, fabric = 0xa08d80, wood = 0xcbb083, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.7, 0.35);
  const cushion = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.96, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.55, metalness: 0.03 });
  const cyl = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const tube = (a, b, r = 9) => cyl(a, b, r, tubeMat);
  const box = (bw, bh, bd, x, y, z, mat, rx = 0) => {
    const m = new THREE.Mesh(roundedBox(bw * MM, bh * MM, bd * MM, 8 * MM), mat);
    m.position.set(x * MM, y * MM, z * MM); m.rotation.x = rx; g.add(m); return m;
  };
  const sw = w / 2, hd = d / 2, deckY = 200, fd = hd - 70;
  // silver X-frame legs across the width, tied by foot + deck rails
  for (const xc of [-w / 2 + 180, 0, w / 2 - 180]) {
    tube([xc, deckY, fd], [xc, 8, -fd]);
    tube([xc, deckY, -fd], [xc, 8, fd]);
  }
  for (const zc of [fd, -fd]) {
    tube([-sw + 120, 8, zc], [sw - 120, 8, zc]);        // foot rail
    tube([-sw + 120, deckY, zc], [sw - 120, deckY, zc]); // deck rail
  }
  box(w - 60, 22, d - 150, 0, deckY + 2, 0, cushion);   // base deck
  for (const sx of [-1, 1]) box(w / 2 - 50, 120, d - 250, sx * (w / 4), deckY + 75, 55, cushion);   // seats
  const bBot = deckY + 130, bTop = h - 40;
  for (const sx of [-1, 1]) box(w / 2 - 50, bTop - bBot, 95, sx * (w / 4), (bBot + bTop) / 2, -hd + 120, cushion, -0.14);  // backs
  for (const sx of [-1, 1]) {                            // wood armrests on the ends
    const X = sx * (sw - 25);
    tube([X, deckY, fd - 40], [X, 400, fd - 60], 9);
    tube([X, deckY, -fd + 60], [X, 400, -fd + 40], 9);
    box(52, 22, d - 210, X, 412, -10, woodMat);
  }
  return { group: g, body: g.children[0] };
}

/** Snow Peak Lounge Cushion (TM-096): a round cotton-canvas floor cushion, shown in its FOLDED
 *  half-circle seating form -- the round pad folded in half, so a HALF-DISC of doubled thickness.
 *  Sits on the ground (y = 0). `w` = the straight fold edge (= the open pad's diameter). */
export function loungeCushionGroup(w, d, h, { fabric = 0xcf6a20, folded = false, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.95, side: THREE.DoubleSide });
  const R = w / 2;
  if (folded) {
    // FOLDED form: the round pad folded in half -> a SOLID half-disc of doubled thickness. Built by
    // extruding a half-circle shape (all faces closed, so no stray cap strip). Lies flat, curved
    // edge to the front, centred.
    const thk = h * 2;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R * MM, 0, Math.PI, false);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thk * MM, bevelEnabled: false, curveSegments: 44 });
    const pad = new THREE.Mesh(geo, cloth);
    pad.rotation.x = -Math.PI / 2;        // lay it flat: thickness along Y, half-circle in XZ
    pad.position.z = R / 2 * MM;          // centre the D-shape
    g.add(pad);
    return { group: g, body: pad };
  }
  // DEFAULT round form: a full disc lying flat, with a soft centre tuft
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(R * MM, R * MM, h * MM, 56), cloth);
  pad.position.y = h / 2 * MM; g.add(pad);
  const tuft = new THREE.Mesh(new THREE.CylinderGeometry(16 * MM, 16 * MM, (h + 3) * MM, 16),
    new THREE.MeshStandardMaterial({ color: fabric, roughness: 0.7 }));
  tuft.position.y = (h - 1.5) / 2 * MM; g.add(tuft);
  return { group: g, body: pad };
}

/** Snow Peak Folding Bench (LV-071): the folding chair's bench sibling -- BACKLESS and armless, a
 *  long canvas (or mesh) sling on two end X-frames tied by a lengthwise stretcher. Seat at y = h,
 *  faces +z. From the LV-071GY photo. Supports canvas + mesh like the chair. */
export function foldingBenchGroup(w, d, h, { frame = 0x232528, fabric = 0x8c8279, canvasTex = null, meshAlpha = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.5, 0.45);
  const cloth = meshAlpha
    ? new THREE.MeshStandardMaterial({ color: fabric, alphaMap: meshAlpha, transparent: true, alphaTest: 0.12, roughness: 0.85, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.92, side: THREE.DoubleSide });
  const cyl = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const tube = (a, b, r = 10) => cyl(a, b, r, tubeMat);
  const seatH = h, sw = w / 2 - 30, sd = d / 2 - 15, fd = d / 2 + 25;
  // two end X-frames (in the depth-height plane) + the seat-end loops
  for (const sx of [-1, 1]) {
    const X = sx * sw;
    tube([X, seatH, sd], [X, 8, -fd]);      // front leg -> back foot
    tube([X, seatH, -sd], [X, 8, fd]);      // back leg -> front foot
    tube([X, seatH, sd], [X, seatH, -sd]);  // seat-end loop
    for (const z of [-fd, fd]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(11 * MM, 13 * MM, 12 * MM, 10), metalE(0x1c1e22, 0.1, 0.85));
      cap.position.set(X * MM, 6 * MM, z * MM); g.add(cap);
    }
  }
  tube([-sw, seatH, sd], [sw, seatH, sd]);   // seat front rail
  tube([-sw, seatH, -sd], [sw, seatH, -sd]); // seat back rail
  tube([-sw, 130, 0], [sw, 130, 0], 5);      // lengthwise stretcher near the bottom
  const seat = new THREE.Mesh(roundedBox(2 * sw * MM, 12 * MM, 2 * sd * MM, 4 * MM), cloth);
  seat.position.y = (seatH - 12) * MM; g.add(seat);
  return { group: g, body: g.children[0] };
}

/** Snow Peak Bamboo Folding Shelf / Bench (LV-066TR & siblings): a rigid laminated-BAMBOO top on
 *  folding stainless end X-frames -- a multi-use narrow table / bench / storage shelf. Top at
 *  y = h, faces +z. `woodTex` grains the bamboo. From the LV-066TR photo. */
export function bambooShelfGroup(w, d, h, { frame = 0xcfd3d7, wood = 0xcaa96b, woodTex = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.85, 0.3);   // stainless
  const woodMat = new THREE.MeshStandardMaterial({ color: wood, map: woodTex || null, roughness: 0.6, metalness: 0.03 });
  const tube = (a, b, r = 9) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), tubeMat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const topThk = 22, sw = w / 2 - 25, sd = d / 2 - 10, fd = d / 2 + 20;
  const top = new THREE.Mesh(roundedBox(w * MM, topThk * MM, d * MM, 3 * MM), woodMat);
  top.position.y = (h - topThk / 2) * MM; g.add(top);
  for (const sx of [-1, 1]) {                  // end X-frames
    const X = sx * sw;
    tube([X, h - topThk, sd], [X, 8, -fd]);
    tube([X, h - topThk, -sd], [X, 8, fd]);
    for (const z of [-fd, fd]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(10 * MM, 12 * MM, 12 * MM, 10), metalE(0x1c1e22, 0.1, 0.85));
      cap.position.set(X * MM, 6 * MM, z * MM); g.add(cap);
    }
  }
  tube([-sw, 130, 0], [sw, 130, 0], 5);        // lengthwise stretcher
  return { group: g, body: top };
}

/** Snow Peak Take! Bamboo Chair (LV-085): the tricky one -- natural BAMBOO X-legs, a slim
 *  aluminium seat frame + back posts, and a draped cream cotton-canvas seat & back. Feet at
 *  y = 0, faces +z. Modelled from the LV-085 photos (curves approximated with straight tubes). */
export function takeChairGroup(w, d, h, { frame = 0xcfd3d7, fabric = 0xefe6d0, wood = 0xd8bd86, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const alu = metalE(frame, 0.85, 0.32);
  const bambooMat = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.55, metalness: 0.03 });
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.9, side: THREE.DoubleSide });
  const cyl = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const tube = (a, b, r = 8) => cyl(a, b, r, alu);
  const pole = (a, b, r = 13) => cyl(a, b, r, bambooMat);
  const box = (bw, bh, bd, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(roundedBox(bw * MM, bh * MM, bd * MM, 4 * MM), cloth);
    m.position.set(x * MM, y * MM, z * MM); m.rotation.x = rx; g.add(m); return m;
  };
  const seatH = Math.round(h * 0.44), sw = w / 2 - 40, sd = d / 2 - 120, fd = d / 2 + 10;
  // bamboo X-legs on each side (front-top crosses to back-foot, and vice versa), splayed out
  for (const sx of [-1, 1]) {
    const X = sx * sw;
    pole([X, seatH, sd], [sx * (sw + 40), 8, -fd]);
    pole([X, seatH, -sd], [sx * (sw + 40), 8, fd]);
    for (const z of [-fd, fd]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(14 * MM, 15 * MM, 10 * MM, 10), metalE(0x2a2c30, 0.1, 0.85));
      cap.position.set(sx * (sw + 40) * MM, 5 * MM, z * MM); g.add(cap);
    }
  }
  // aluminium seat frame (a hoop) + back posts
  for (const zc of [sd, -sd]) tube([-sw, seatH, zc], [sw, seatH, zc]);
  for (const sx of [-1, 1]) tube([sx * sw, seatH, sd], [sx * sw, seatH, -sd]);
  for (const sx of [-1, 1]) tube([sx * sw, seatH, -sd], [sx * (sw - 8), h, -sd - 45]);
  // draped cream canvas: a slung seat and a back panel
  box(2 * sw - 6, 10, 2 * sd, 0, seatH - 6, 10, 0);
  const bBot = seatH + 150, bTop = h - 25;
  box(2 * sw - 6, bTop - bBot, 10, 0, (bBot + bTop) / 2, -sd - 32, -0.13);
  return { group: g, body: g.children[0] };
}

/** The Jikaro: an octagonal ring of four trapezoid segments with the fire hole in the
 *  middle, standing on folding wire legs. `ringMat` paints the ring; `color` the wire.
 *  Ring top at y = 0, legs to -height. */
export function jikaroGroup({ outer, opening, edge, height, color, ringMat }) {
  const g = new THREE.Group();
  const thick = 6;
  const ring = new THREE.Mesh(jikaroRing(outer, opening, edge, thick * MM),
    ringMat || metalE(color, 0.85, 0.3));
  g.add(ring);
  const seams = jikaroSeams(outer, opening, edge, 0x6a7079);
  seams.position.y = 0.4 * MM;
  g.add(seams);

  // Eight folding wire legs -- a U-hairpin running ALONG each of the trapezoid's two SHORT
  // (slant) edges: the 285mm sides that join the inner (hole) edge to the outer (flat) edge,
  // two per segment, eight in all. NOT at the octagon corners -- that was the last miss; the
  // user's correction is explicit that the legs follow the two opposite slant edges. Each
  // hairpin's two wires sit on its slant near the outer and inner ends and drop straight to a
  // foot bar with a shallow centre notch (a009). The marks D,E land on the OUTER end of the +x
  // pair of slants, which the octagon's four-fold symmetry repeats to all eight.
  const wire = metalE(color, 0.9, 0.28);
  const R = outer / 2, e = edge / 2, o = opening / 2;
  const strut = (a, b) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM);
    const vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3 * MM, 3 * MM, va.distanceTo(vb), 6), wire);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m);
  };
  // each slant edge as [inner hole corner .. outer flat corner]; two per segment, four segments
  const slants = [
    [o, o, e, R], [-o, o, -e, R],        // +z segment
    [o, o, R, e], [o, -o, R, -e],        // +x segment
    [o, -o, e, -R], [-o, -o, -e, -R],    // -z segment
    [-o, o, -R, e], [-o, -o, -R, -e],    // -x segment
  ];
  const fIn = 0.16, fOut = 0.95, notch = 32;   // where the two wires sit ALONG the slant (inner→outer); foot-bar centre rise
  for (const [ix, iz, ox, oz] of slants) {
    const feet = [];
    for (const f of [fIn, fOut]) {               // the hairpin's two wires, spaced along the slant
      const px = ix + (ox - ix) * f, pz = iz + (oz - iz) * f;
      strut([px, 0, pz], [px, -height, pz]);
      feet.push([px, -height, pz]);
    }
    const mid = [(feet[0][0] + feet[1][0]) / 2, -height + notch, (feet[0][2] + feet[1][2]) / 2];
    strut(feet[0], mid); strut(mid, feet[1]);    // foot bar, dipping to the feet with a centre notch
  }
  return { group: g, body: ring };
}

/** The OPTIONAL Jikaro bridge (ST-051 1-Unit / CPL-JT2U 2-Unit): brackets laid over the fire
 *  opening with bars sliding into them, turning the hole into an IGT unit-slot. Stainless.
 *  `opening` = the Jikaro's central opening (600 spread / 365 compact); `units` = 1 or 2. Built
 *  with its top at y = 0 so the caller drops it at the ring's datum height. Returns { group }. */
export function jikaroBridge({ opening, units = 2, tex = null }) {
  const g = new THREE.Group();
  // Brushed stainless -- the `tex` map (fine directional streaks) gives it the 拉丝 finish.
  const ss = tex
    ? new THREE.MeshStandardMaterial({ color: 0xd2d5d9, map: tex, metalness: 0.9, roughness: 0.42 })
    : metalE(0xccd0d4, 0.92, 0.26);
  const bayW = units * 250, bayD = 360;
  // Two main brackets: the long rails a module bridges, spanning the opening (they rest on the
  // rim both sides -> a touch longer), one at each depth edge.
  for (const sz of [-1, 1]) {
    const b = new THREE.Mesh(roundedBox((opening + 40) * MM, 24 * MM, 20 * MM, 2 * MM), ss);
    b.position.set(0, -12 * MM, sz * (bayD / 2) * MM); g.add(b);
  }
  // Two bars closing the bay's SHORT ENDS. The middle stays OPEN -- IGT has no unit dividers, a
  // unit is a 250mm notion along a continuous rail, so a bar bisecting the slot would be wrong.
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(roundedBox(16 * MM, 12 * MM, bayD * MM, 1.5 * MM), ss);
    bar.position.set(sx * (bayW / 2) * MM, -8 * MM, 0); g.add(bar);
  }
  return { group: g, body: g.children[0] };
}

/** A hanging rack that hooks over a frame's rails and drops shelves inside its depth.
 *  Standalone here (its hooks sit at its own depth edges); the planner places it at a slot.
 *  `tiers` shelves, `hasSurface` a solid shelf vs an open rim. Top at y = 0, to -drop.
 *  Returns { group, pick } so the planner can tag the bars. */
export function hangRackGroup({ w, d, drop, tiers = 1, hasSurface = false, color, estimated = false }) {
  const g = new THREE.Group();
  const pick = [];
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), metalness: 0.9, roughness: 0.28,
    transparent: estimated, opacity: estimated ? 0.78 : 1,
  });
  const bar = (bw, bh, bd, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw * MM, bh * MM, bd * MM), mat);
    m.position.set(x * MM, y * MM, z * MM);
    g.add(m); pick.push(m);
    return m;
  };
  const hookZ = Math.min(d / 2, 203);
  for (const sz of [-1, 1]) for (const sx of [-0.5, 0.5]) bar(16, 10, 40, sx * (w - 40), 2, sz * hookZ);
  for (const sx of [-1, 1]) bar(6, drop, d, sx * (w / 2 - 3), -drop / 2, 0);
  for (let i = 1; i <= tiers; i++) {
    const y = -(drop * i) / tiers;
    if (hasSurface) { bar(w - 12, 8, d, 0, y, 0); }
    else {
      bar(w - 12, 20, 12, 0, y, d / 2 - 6);
      bar(w - 12, 20, 12, 0, y, -(d / 2 - 6));
      bar(12, 20, d, w / 2 - 6, y, 0);
      bar(12, 20, d, -(w / 2 - 6), y, 0);
    }
  }
  return { group: g, pick };
}

// ===========================================================================================
// The smaller hardware -- clamps, poles, screens, cases, rails, rings. None of these is a
// box, and every one of them was being drawn as one (or crashing). These are honest,
// low-detail shapes: enough silhouette to tell a lantern pole from a windscreen from a
// clamp, no invented ornament. All take MILLIMETRES and hang from y = 0.
// ===========================================================================================

/** An edge clamp / hook bracket: a back plate with a jaw that curls over an edge at the top
 *  and a shorter return at the bottom -- a C that grips a tabletop. CK-020 box hanger,
 *  CK-175 connection hook, the TTA unit clamp all read as this. */
export function clampGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.85, 0.32);
  const bw = Math.min(w, 30), t = 4;
  const back = new THREE.Mesh(roundedBox(bw * MM, h * MM, t * MM, 1 * MM), mat);
  back.position.set(0, -h / 2 * MM, 0);
  g.add(back);
  const jaw = Math.min(d, 40);
  const topJaw = new THREE.Mesh(roundedBox(bw * MM, t * MM, jaw * MM, 1 * MM), mat);
  topJaw.position.set(0, -t / 2 * MM, jaw / 2 * MM);
  g.add(topJaw);
  const botJaw = new THREE.Mesh(roundedBox(bw * MM, t * MM, jaw * 0.7 * MM, 1 * MM), mat);
  botJaw.position.set(0, (-h + t / 2) * MM, jaw * 0.35 * MM);
  g.add(botJaw);
  // A thumb screw under the bottom jaw, the way a clamp tightens.
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(5 * MM, 5 * MM, 14 * MM, 10), metalE(0x1c1f24, 0.5, 0.5));
  screw.position.set(0, (-h + t) * MM, jaw * 0.5 * MM);
  g.add(screw);
  return { group: g, body: back };
}

/** A folding windscreen: three thin upright panels in a shallow zigzag. */
export function screenGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.8, 0.4);
  const pw = w / 3, t = 2;
  const angles = [0.35, 0, -0.35];
  let x = -w / 2 + pw / 2;
  for (const a of angles) {
    const panel = new THREE.Mesh(roundedBox(pw * MM, h * MM, t * MM, 0.5 * MM), mat);
    panel.position.set(x * MM, -h / 2 * MM, 0);
    panel.rotation.y = a;
    g.add(panel);
    x += pw * Math.cos(a);
  }
  return { group: g, body: g.children[0] };
}

/** A lantern hanger / cylinder stand: a vertical pole with a clamp foot and an arm reaching
 *  out near the top, a small hook at the arm's end. */
export function postArmGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.85, 0.3);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(6 * MM, 6 * MM, h * MM, 12), mat);
  pole.position.set(0, -h / 2 * MM, 0);
  g.add(pole);
  const reach = Math.max(w, d, 120);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(4 * MM, 4 * MM, reach * MM, 10), mat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(reach / 2 * MM, -20 * MM, 0);
  g.add(arm);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(9 * MM, 2.5 * MM, 8, 16, Math.PI * 1.4), mat);
  hook.position.set(reach * MM, -34 * MM, 0);
  hook.rotation.x = Math.PI / 2;
  g.add(hook);
  // Clamp foot -- how it grips the frame edge.
  const foot = new THREE.Mesh(roundedBox(26 * MM, 30 * MM, 20 * MM, 2 * MM), mat);
  foot.position.set(0, (-h + 15) * MM, 0);
  g.add(foot);
  return { group: g, body: pole };
}

/** A small IGT-style frame on legs (CK-303 TTA Unit Frame): a thin rectangular rim on four
 *  short legs -- a frame you can see through, not a filled box. */
export function ttaFrameGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.8, 0.4);
  const t = 10;
  const rim = (bw, bd, x, z) => {
    const m = new THREE.Mesh(roundedBox(bw * MM, t * MM, bd * MM, 1 * MM), mat);
    m.position.set(x * MM, -t / 2 * MM, z * MM);
    g.add(m);
  };
  rim(w, t, 0, d / 2 - t / 2); rim(w, t, 0, -(d / 2 - t / 2));
  rim(t, d, w / 2 - t / 2, 0); rim(t, d, -(w / 2 - t / 2), 0);
  const legH = Math.max(h - t, 20);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(6 * MM, 5 * MM, legH * MM, 12), mat);
    leg.position.set(sx * (w / 2 - t) * MM, -(t + legH / 2) * MM, sz * (d / 2 - t) * MM);
    g.add(leg);
  }
  return { group: g, body: g.children[0] };
}

/** A ring holder (CK-306 Sierra cup holder): a flat ring with a small clamp tab. */
export function ringGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.85, 0.32);
  const R = Math.min(w, d) / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry((R - 6) * MM, 3 * MM, 10, 28), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -h / 2 * MM;
  g.add(ring);
  const tab = new THREE.Mesh(roundedBox(18 * MM, Math.max(h, 10) * MM, 4 * MM, 1 * MM), mat);
  tab.position.set(0, -h / 2 * MM, -(R - 2) * MM);
  g.add(tab);
  return { group: g, body: ring };
}

/** A soft carrying case: a closed rounded box with a lid seam and an arch handle -- a bag,
 *  not an open bin. */
export function caseGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.05, roughness: 0.85 });
  const body = new THREE.Mesh(roundedBox(w * MM, h * MM, d * MM, Math.min(w, d, h) * 0.16 * MM), mat);
  body.position.y = -h / 2 * MM;
  g.add(body);
  // Lid seam -- a thin band a third of the way down.
  const seam = new THREE.Mesh(roundedBox((w + 2) * MM, 4 * MM, (d + 2) * MM, 2 * MM),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), metalness: 0.1, roughness: 0.8 }));
  seam.position.y = -h / 3 * MM;
  g.add(seam);
  // An arch handle on top.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, 60) * 0.4 * MM, 4 * MM, 8, 20, Math.PI), mat);
  handle.position.set(0, 2 * MM, 0);
  g.add(handle);
  return { group: g, body };
}

/** A rail set sold on its own (CK-902-1 collapsible rails): a pair of rail profiles at the
 *  frame's spacing, no ends -- what you actually get in the box. */
export function railsGroup({ w, d, thick, section, color = BLK_ }) {
  const g = new THREE.Group();
  const railWidth = section.rail_width_mm;
  const prof = {
    outerWall: (d / 2 - section.channel_mm[1]) * MM,
    channel: (section.channel_mm[1] - section.channel_mm[0]) * MM,
    lip: (section.lip_mm[1] - section.lip_mm[0]) * MM,
  };
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(railProfile(w * MM, thick * MM, prof, s), metalE(color, 0.8, 0.42));
    r.position.set(0, -thick / 2 * MM, s * (d / 2 - railWidth / 2) * MM);
    g.add(r);
  }
  return { group: g, body: g.children[0] };
}

/** A flat connector plate with a couple of studs (LV-312 frame connector, the height
 *  adjuster's plate): a thin plate, not a block. */
export function plateGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.85, 0.35);
  const t = Math.min(h, 8);
  const plate = new THREE.Mesh(roundedBox(w * MM, t * MM, d * MM, 2 * MM), mat);
  plate.position.y = -t / 2 * MM;
  g.add(plate);
  rivetsInto(g, [[-w / 4, 0], [w / 4, 0]], 1, color);
  return { group: g, body: plate };
}

/** A bamboo sliding extension (CK-153/154): a cantilevered bamboo board that mounts on the
 *  frame's LONG side and reaches outward. Two silver brackets on ONE long edge hook over the
 *  rail; the board's top finishes about level with the frame top. Photographed, not guessed
 *  (JP a002/a003 show the two hinged brackets gripping the rail, the board reaching out).
 *  Board top at y = 0; the mounting edge is at -z, so the board reaches toward +z. */
export function slideExtGroup(w, d, h, color, grainTex = null) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.05, roughness: 0.7 });
  const board = 16;                                   // the bamboo itself; h(33) is board + bracket
  const top = new THREE.Mesh(roundedBox(w * MM, board * MM, d * MM, 6 * MM), wood);
  top.position.y = -board / 2 * MM;
  g.add(top);

  // The bamboo grain, laid on the top face as a thin decal (the roundedBox has no clean UVs
  // to map onto). It is the same bamboo as every other board, so it wears the same grain.
  if (grainTex) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(w * MM, d * MM),
      new THREE.MeshStandardMaterial({ map: grainTex, metalness: 0.03, roughness: 0.72 }));
    decal.rotation.x = -Math.PI / 2;                  // lay it flat, facing up
    decal.position.y = 0.3 * MM;                      // just above the board top (y=0)
    g.add(decal);
  }

  // Two slide brackets on the mounting (-z) long edge: a foot lying on the board and an
  // upstand at the very edge that hooks over the rail. Spaced like the hero shot.
  const steel = metalE(0xc8ccd2, 0.9, 0.28);
  const edgeZ = -(d / 2);
  const bx = Math.min(w * 0.22, 110);
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(roundedBox(32 * MM, 4 * MM, 46 * MM, 1 * MM), steel);
    foot.position.set(sx * bx * MM, 2 * MM, (edgeZ + 28) * MM);
    g.add(foot);
    const lip = new THREE.Mesh(roundedBox(32 * MM, 20 * MM, 7 * MM, 1 * MM), steel);
    lip.position.set(sx * bx * MM, 8 * MM, (edgeZ + 4) * MM);
    g.add(lip);
  }
  return { group: g, body: top };
}

/** A flat grill / griddle plate: a slab with parallel ridges on top, the way a grill plate
 *  is cast (S-029HA and the like). */
export function gridPlateGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.35, 0.6);
  const t = Math.max(h, 6);
  const slab = new THREE.Mesh(roundedBox(w * MM, t * MM, d * MM, 2 * MM), mat);
  slab.position.y = -t / 2 * MM;
  g.add(slab);
  const ridge = metalE(0x1b1e22, 0.3, 0.65);
  for (let i = -3; i <= 3; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry((w - 20) * MM, 3 * MM, 4 * MM), ridge);
    r.position.set(0, 1.5 * MM, i * (d / 8) * MM);
    g.add(r);
  }
  return { group: g, body: slab };
}

/** A SHELTER FOOTPRINT: a tent / shell / tarp's ground outline, laid FLAT on the floor as a
 *  scale reference -- so you can see whether a layout fits under a given tarp or inside a tent.
 *  Not a solid object; a translucent fill + a bright outline + a billboard label. `verts` is the
 *  polygon in MILLIMETRES, centred, polygon +y = front (maps to scene +z). Returns the fill as the
 *  pick body (drag/rotate/delete like any node); the outline and label ride along, untagged. */
export function shelterFootprint(verts, { fill = 0x5b8dd6, label = "", sub = "" } = {}) {
  const g = new THREE.Group();

  // Fill: a translucent membrane at floor level. MeshBasic (unlit -- it is a diagram, not a
  // surface), double-sided, depthWrite off so furniture standing on it always draws over it.
  const shape = new THREE.Shape();
  verts.forEach(([x, y], i) => (i ? shape.lineTo(x * MM, -y * MM) : shape.moveTo(x * MM, -y * MM)));
  const fillMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide, depthWrite: false }),
  );
  fillMesh.rotation.x = -Math.PI / 2;   // XY shape -> XZ ground; the -y above lands +y at +z
  fillMesh.position.y = 0.002;
  g.add(fillMesh);

  // Outline: the actual polygon edge, a bright closed loop a hair above the fill.
  const loop = verts.map(([x, y]) => new THREE.Vector3(x * MM, 0.004, y * MM));
  loop.push(loop[0].clone());
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(loop),
    new THREE.LineBasicMaterial({ color: fill, transparent: true, opacity: 0.85 }),
  );
  g.add(line);

  // Label: a billboard so it reads from any angle. Name on top, size below, on a dark chip.
  if (label) {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 160;
    const cx = cv.getContext("2d");
    cx.fillStyle = "rgba(18,20,24,0.82)";
    roundRect(cx, 6, 6, 500, 148, 22); cx.fill();
    cx.fillStyle = "#" + fill.toString(16).padStart(6, "0");
    cx.fillRect(6, 6, 12, 148);
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillStyle = "#f2f4f7"; cx.font = "600 52px system-ui, sans-serif";
    cx.fillText(label, 262, sub ? 62 : 82);
    if (sub) { cx.fillStyle = "#aab2bd"; cx.font = "400 38px system-ui, sans-serif"; cx.fillText(sub, 262, 112); }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(0.44, 0.1375, 1);
    sprite.position.set(0, 0.09, 0);
    sprite.renderOrder = 10;
    g.add(sprite);
  }

  return { group: g, body: fillMesh };
}

function roundRect(cx, x, y, w, h, r) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
}
