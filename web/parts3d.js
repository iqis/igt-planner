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
export function moduleGroup(p, w, d, h, color, topTex = null) {
  const bspec = burnerOf(p.sku);
  if (bspec) return burnerGroup(bspec, w, d, h, topTex);
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
export function loungeCushionGroup(w, d, h, { fabric = 0xcf6a20 } = {}) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, roughness: 0.95, side: THREE.DoubleSide });
  const R = w / 2;
  // the half-disc pad: a half-cylinder lying flat (round faces up/down), curved edge toward +z
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(R * MM, R * MM, h * MM, 48, 1, false, 0, Math.PI), cloth);
  pad.position.y = h / 2 * MM; g.add(pad);
  // cap the open flat face (the fold edge), and score a seam where the two layers meet
  const flat = new THREE.Mesh(roundedBox(w * MM, h * MM, 4 * MM, 1 * MM), cloth);
  flat.position.y = h / 2 * MM; g.add(flat);
  const seam = new THREE.Mesh(roundedBox((w - 20) * MM, 3 * MM, 5 * MM, 1 * MM),
    new THREE.MeshStandardMaterial({ color: fabric, roughness: 0.6, metalness: 0.0 }));
  seam.position.set(0, h / 2 * MM, 1 * MM); g.add(seam);
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
