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
import { roundedBox, meshWires, isMesh, flatRect, boardFromOutline } from "./materials.js";

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
