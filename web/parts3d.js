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
  "GS-230":  { heads: 2, knobs: 2, windscreen: true },
  "GP-040":  { heads: 1, knobs: 1, mounts: "GS-1000" },
  "GS-1000": { heads: 1, knobs: 1 },
  "CK-160":  { bbq: true },     // charcoal, split top -- a grate half and a griddle half
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
export function burnerGroup(spec, w, d, h) {
  const g = new THREE.Group();
  const steel = 0x9aa0a8, dark = 0x26292e;

  // The stainless housing, dropped in. Rim at y=0, body hanging to -h.
  const body = box(g, w, h, d, 3, metal(steel, 0.85, 0.35), 0, -h / 2, 0);

  if (spec.bbq) {
    const lift = 34, half = (w - 16) / 2;
    box(g, half, 6, d - 12, 2, metal(0x30343a, 0.4, 0.6), -half / 2 - 2, lift, 0);
    for (let i = -3; i <= 3; i++)
      box(g, half - 6, 3, 3, 1, metal(steel, 0.9, 0.3), -half / 2 - 2, lift + 5, i * (d / 9));
    box(g, half, 8, d - 12, 2, metal(steel, 0.8, 0.4), half / 2 + 2, lift, 0);
  } else if (spec.plate) {
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
export function meshTrayGroup(w, d, h, color) {
  const g = new THREE.Group();
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.12 }),
    0, -h / 2, 0);
  const wires = meshWires(w, h, d, new THREE.Color(color));   // mm in, scales itself to metres
  wires.position.y = (-h / 2) * MM;
  g.add(wires);
  return { group: g, body: ghost };
}

/** What 3D form a slotted part takes -- burner, mesh tray, or open box/bin. ONE classifier,
 *  so the planner and the part bench never disagree about a part's shape.
 *
 *  Every group's TOP sits at local y = 0, and the caller places that at the frame's top --
 *  because an IGT unit embeds FLUSH with the work surface. That is the default and the rule:
 *  the body hangs below into the frame, the rim is level with the tabletop. The few parts
 *  that rise above it do so from their own geometry (a burner's grate and pot-supports, the
 *  BBQ's lifted split top) -- the exception, built in, not the norm.
 *
 *  Returns null for a part that is genuinely just a thin slab (a shallow tray); the caller
 *  draws that itself. `color` is the part's swatch, passed in so this stays state-free. */
export function moduleGroup(p, w, d, h, color) {
  const bspec = burnerOf(p.sku);
  if (bspec) return burnerGroup(bspec, w, d, h);
  if (isMesh(p)) return meshTrayGroup(w, d, h, new THREE.Color(color));
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

  // Eight folding wire legs -- TWO per segment, at the two ENDS of its outer edge (its pair of
  // slanted short sides), not the middle where they used to float. Each is a U-shaped hairpin
  // (a009, the disassembled photo): two near-vertical wires that widen and kick slightly
  // outward to a foot bar. NOT an A-frame -- the U is the real shape.
  const wire = metalE(color, 0.9, 0.28);
  const R = outer / 2, e = edge / 2;
  const strut = (a, b) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM);
    const vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3 * MM, 3 * MM, va.distanceTo(vb), 6), wire);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m);
  };
  const inset = 24, top = 40, foot = 56, kick = 30;   // corner inset; U width at top/foot; outward kick
  for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tx = -uz, tz = ux;                            // tangential, along the outer edge
    for (const s of [-1, 1]) {                          // the two ends of the segment
      const cx = ux * R + tx * s * (e - inset), cz = uz * R + tz * s * (e - inset);
      const legs = [];
      for (const u of [-1, 1]) {                        // the two wires of one U
        const t0 = [cx + tx * u * top / 2, 0, cz + tz * u * top / 2];
        const t1 = [cx + tx * u * foot / 2 + ux * kick, -height, cz + tz * u * foot / 2 + uz * kick];
        strut(t0, t1);
        legs.push(t1);
      }
      strut(legs[0], legs[1]);                          // the foot joining them
    }
  }
  return { group: g, body: ring };
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
