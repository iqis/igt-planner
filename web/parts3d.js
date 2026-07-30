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

// ---- cloth, hung not boarded: the seating props' shared fabric helpers. Every sling in this
// family's heroes HANGS -- a shallow belly between rails, a hem curling over a tube -- and the
// flat rounded boxes the chair builders used to cut read as boards at bench distance.

/** Sample a quadratic Bezier (2D, mm) into `out`. The cloth profiles below are all
 *  belly-of-a-parabola plus a few straight points, so this is the whole toolkit. */
function qpts(p0, p1, p2, n, out) {
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
              u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

/** A cloth sheet from its 2D centreline: the sampled polyline (mm) is offset half the cloth
 *  thickness along its normals on both sides, closed into one Shape, and extruded `depth` mm.
 *  The extrusion runs 0..depth along local z; the caller orients and positions the mesh. */
function sheetGeo(line, thk, depth) {
  const n = line.length, up = [], dn = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    up.push([line[i][0] - dy / L * thk / 2, line[i][1] + dx / L * thk / 2]);
    dn.push([line[i][0] + dy / L * thk / 2, line[i][1] - dx / L * thk / 2]);
  }
  const s = new THREE.Shape();
  s.moveTo(up[0][0] * MM, up[0][1] * MM);
  for (let i = 1; i < n; i++) s.lineTo(up[i][0] * MM, up[i][1] * MM);
  for (let i = n - 1; i >= 0; i--) s.lineTo(dn[i][0] * MM, dn[i][1] * MM);
  return new THREE.ExtrudeGeometry(s, { depth: depth * MM, bevelEnabled: false });
}

/** A sling panel: cloth spanning `span` between two rails, bellied `sag` mm at mid-span (a
 *  negative sag bows it the other way -- a chair back bulging away from the sitter), `depth`
 *  along the rails. With `lip`, the cloth rides the crest of an r10 end rail at each side and
 *  hangs a short hem outside it, the way the folding bench's sling wraps its end loops.
 *  Profile in local x/y (span across x, belly in -y), extruded 0..depth along local z. */
function slingPanel(span, sag, thk, depth, lip = 0) {
  const half = span / 2, crest = lip > 0 ? 9 : 0, line = [];
  if (lip > 0) line.push([-half - 11, crest - lip], [-half - 10, crest - 2]);
  qpts([-half, crest], [0, crest - 2 * sag], [half, crest], 10, line);
  if (lip > 0) line.push([half + 10, crest - 2], [half + 11, crest - lip]);
  return sheetGeo(line, thk, depth);
}


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
// `hose: true` = the gas supply CLAIMS A LONG-RAIL SIDE. GS-450R's manual is explicit -- the
// valve and hose exit the top plate's SHORT edge only ("長辺側には取り付けできない"), which in
// the frame points at a long rail; the GS-355 runs the same hose to a standing canister; the
// GS-230 mounts its two canisters under the knob face. All three need one long side of their
// span left open, and a slide-in board over both sides leaves the gas nowhere to go.
export const BURNERS = {
  "GS-355":  { plate: true, knobs: 1, hose: true },
  // Fully procedural, NO photo top and NO knob. The old top was an OBLIQUE detail crop baked
  // onto a flat plane -- the burner head's own side was in the picture, so it read skewed
  // from every angle but the photo's -- and the front knob was invented: the real regulator
  // rides the REMOTE canister at the end of a braided hose (JP a003), the body only carries
  // a side port. Geometry from the JP photos: a thin plate, a recessed bowl, a small head,
  // four W-kinked grate wires, a side valve stub.
  "GS-450R": { flat450: true, hose: true },
  // Its own builder -- an appliance, not a box. Kept here so burnerOf still says "yes, a burner".
  "GS-230":  { gs230: true, heads: 2, knobs: 2, hose: true },
  // Not a burner but the frame the GS-1000 STANDS IN -- a bare wire outline, its own builder
  // (gp040Group). The row stays so burnerOf keeps saying "cooking" (the palette keys on it).
  // `hose` because the stove it carries is liquid-feed: the inverted canister hangs beneath the
  // table and the flame knob rides a stalk out one long-rail side -- board that side over and
  // the knob is out of reach.
  "GP-040":  { gp040: true, hose: true },
  "GS-1000": { heads: 1, knobs: 1 },
  // CK-160 was here as { bbq: true } -- "a grate half and a griddle half". Its MANUAL says
  // otherwise (セット内容: 焼き網 x2, and step 1 is "take the lid off"): there is no griddle, the
  // dark slab in the photos is the LID resting inverted on the two nets. It has its own builder
  // now (bbqBoxGroup) and is no longer a burner.
};
export const burnerOf = sku => BURNERS[sku] || BURNERS[sku.replace(/-(US|INT|EC|R)$/i, "")];

/** LI Stove Joint Kit (GP-040; JP IGT剛炎ジョイントフレーム): the 1.5-unit frame that puts the
 *  GS-1000 in the grid -- and it is nothing but WIRE. The hero (web/img/GP-040.jpg, = JP item
 *  photo) shows the whole bill of material: a rounded-square rod outline, a centre ring, five
 *  slender bent runs holding it. It spent its life in burnerGroup's generic branch wearing a
 *  solid housing, an invented head and a knob; the product has none of them.
 *
 *  Measured, against the numbers this part publishes:
 *  - GAUGE. The hero's rods measure ~5mm, but polished rod on white always measures thin (the
 *    highlight blows out and the eye keeps the dark core). The published 1,020g does not:
 *    spread over the ~2.9m of rod the photo shows (outline ~1.41m + ring ~0.69m + arms ~0.8m),
 *    stainless at 7.9 g/cm3 comes back φ7.5. The in-use shot (JP a001) sides with the weight:
 *    the arms crossing the rails read pencil-stout, not wire.
 *  - The OUTLINE IS SQUARE, 362 on a side -- the hero reads square, and 362 is the along-rail
 *    number the span evidence already pinned (2.90 half-units, 1.5U by its label). The 377
 *    across is the ENVELOPE: the two stub tips poke ~11mm past the wire on ONE side (the hero
 *    shows them), so (d - w) / 2 = 7.5 is the square sitting that far off-centre in its own
 *    envelope. The offset is derived, not styled.
 *  - The RING is φ227 outside -- 0.43 of the frame diagonal in the hero, same as built. That is
 *    SMALLER than the stove's 収納時 φ240: the body does not drop through, it STANDS IN it. The
 *    bowl's base (φ228 at the foot of its taper, gs1000Group's own numbers) lands on the ring
 *    and the cone under it noses ~2mm in and centres. Seated so, the ゴトク ride ~69mm above the
 *    tabletop -- which is what a001 shows: wind screen half-proud, pot at hand height. A ring
 *    the φ240 body passed would sink the stove until its gotoku sat BELOW the table.
 *  - h=33 is the rim plane to the ring's underside: the ring hangs ~29mm into the bay. The hero
 *    is shot UPSIDE-DOWN (resting on its outline, ring arched up -- the only stable way to lay
 *    it); every height here is that photo flipped.
 *
 *  The five runs, traced off the hero: TWO near-parallel arms cross UNDER the perimeter 62mm in
 *  from the two corners of one side, each ending in the poked-out stub; on the opposite side two
 *  legs converge in a Y whose joined tail elbows up to lie alongside the perimeter near one
 *  corner, and a single arm does the same near the other. Mostly air, so a faint ghost box
 *  carries picking (meshTrayGroup's trick). Rim at y = 0, everything hanging below. */
export function gp040Group(w = 362, d = 377, h = 33) {
  const g = new THREE.Group();
  const steel = metal(0xd3d7db, 0.9, 0.25);      // polished rod, the finish burnerGroup's wires wear
  const gauge = 7.5, r = gauge / 2;              // φ7.5 -- bought by the published 1,020g, above
  const hw = w / 2, cr = 20;                     // square half-side; corner radius, off the hero
  const ringR = 110;                             // ring centreline: OD 227.5, ID 212.5 (see above)
  const z0 = (d - w) / 2;                        // the square, off-centre in its envelope: +7.5
  const zB = z0 - hw, zF = z0 + hw;              // its stub side and its landing side
  const rimY = -r;                               // perimeter centreline -- rod TOP at y = 0
  const ringY = -(h - r);                        // ring centreline -- rod BOTTOM at y = -h
  const underY = rimY - gauge;                   // an arm crossing UNDER the perimeter rod

  // A faint ghost box, full envelope: it carries picking (dropModule tags only `body`) and
  // nothing else. The rods are the read.
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd3d7db), transparent: true, opacity: 0.05 }),
    0, -h / 2, 0);

  // A bent rod swept along its centreline -- meshTrayGroup's idiom, at joint-frame stock.
  const wire = (pts, closed = false) =>
    g.add(new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM)), closed),
      closed ? 96 : pts.length * 8, r * MM, 10, closed), steel));

  // The rounded-square outline, flat at the rim.
  wire([[hw, rimY, zB + cr], [hw, rimY, zF - cr], [hw - cr, rimY, zF], [-hw + cr, rimY, zF],
        [-hw, rimY, zF - cr], [-hw, rimY, zB + cr], [-hw + cr, rimY, zB], [hw - cr, rimY, zB]],
       true);

  // The ring, centred on the square, hanging at the bottom of the envelope.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR * MM, r * MM, 10, 64), steel);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, ringY * MM, z0 * MM);
  g.add(ring);

  // The two stub arms: off the ring toward the back corners, under the back rod 62mm in from
  // each corner (17% of the side, measured), tips poked out to the envelope's far edge -- the
  // 15mm that makes 362 into 377.
  for (const s of [-1, 1])
    wire([[s * 78, ringY, z0 - 78], [s * 119, underY, zB], [s * 126, underY - 3, zB - 11]]);

  // The Y: two legs converging toward the far corner, the joined tail elbowed up to lie
  // alongside the perimeter -- the hero shows it as a doubled rod at the rail.
  wire([[108.7, ringY, z0 - 17.2], [128, -20, 78], [146, underY, 163.5]]);
  wire([[-21, ringY, z0 + 108], [62, -20, 140], [146, underY, 163.5]]);
  wire([[146, underY, 163.5], [142, rimY - 1, zF - 9.5], [112, rimY, zF - gauge]]);

  // The single arm to the fourth corner, same elbow-and-lie-alongside ending.
  wire([[-78, ringY, z0 + 78], [-99, -18, 135], [-112, underY, 172],
        [-115, rimY - 1, zF - 9.5], [-88, rimY, zF - gauge]]);

  return { group: g, body: ghost };
}


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

  // The Flat Burner (GS-450R): everything the eye checks is above the rim, so the body is a
  // shallow pan, not a full-depth box -- in the frame the real thing nearly disappears
  // below the rail line (JP a003 shows a pot ON it and daylight UNDER it).
  if (spec.flat450) {
    const bright = metal(0xc9cdd2, 0.9, 0.25);
    const R = Math.min(w, d) * 0.40;
    // The plate, WITH THE HOLE IN IT: a solid slab over the bowl would bury the recess
    // that makes this a burner. Rounded rectangle, circular cutout, 3mm of steel.
    const sh = new THREE.Shape();
    const hw = (w / 2) * MM, hd = (d / 2) * MM, cr = 8 * MM;
    sh.moveTo(-hw + cr, -hd);
    sh.lineTo(hw - cr, -hd); sh.quadraticCurveTo(hw, -hd, hw, -hd + cr);
    sh.lineTo(hw, hd - cr); sh.quadraticCurveTo(hw, hd, hw - cr, hd);
    sh.lineTo(-hw + cr, hd); sh.quadraticCurveTo(-hw, hd, -hw, hd - cr);
    sh.lineTo(-hw, -hd + cr); sh.quadraticCurveTo(-hw, -hd, -hw + cr, -hd);
    const hole = new THREE.Path();
    hole.absarc(0, 0, R * MM, 0, Math.PI * 2, true);
    sh.holes.push(hole);
    const plate = new THREE.Mesh(
      new THREE.ExtrudeGeometry(sh, { depth: 3 * MM, bevelEnabled: false, curveSegments: 40 }), bright);
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -3 * MM;                    // top face lands at the rim, y = 0
    g.add(plate);
    const body = plate;
    box(g, w - 8, 16, d - 8, 3, metal(0x9aa0a8, 0.8, 0.4), 0, -11, 0);   // the shallow skirt
    // The bowl seen THROUGH the hole: tapering wall, floor, the head standing on it.
    cyl(g, R, R * 0.86, 26, 40, metal(0xaeb4bb, 0.85, 0.35), 0, -13, 0);
    cyl(g, R * 0.85, R * 0.85, 3, 40, metal(0x878d95, 0.8, 0.45), 0, -26, 0);
    cyl(g, 30, 38, 16, 24, metal(0x4a4d52, 0.6, 0.5), 0, -17, 0);        // the head's body
    cyl(g, 27, 27, 5, 24, metal(0xb98a4a, 0.75, 0.4), 0, -7, 0);         // brass port ring
    cyl(g, 10, 10, 2, 12, metal(0x2b2e33, 0.4, 0.6), 0, -4, 0);          // the jet cap
    // Four grate wires along the depth, each dipping toward the bowl in a shallow W (a002).
    const wire = metal(0xd3d7db, 0.9, 0.25);
    const seg = d * 0.30, dip = seg * 0.55;
    for (const i of [-1.5, -0.5, 0.5, 1.5]) {
      const x = i * (w * 0.22);
      for (const s of [-1, 1]) {
        box(g, 5, 5, seg, 2, wire, x, 10, s * (d / 2 - seg / 2 - 8));
        const a = new THREE.Mesh(roundedBox(5 * MM, 5 * MM, dip * MM, 2 * MM), wire);
        a.position.set(x * MM, 7.5 * MM, s * (d / 2 - seg - 8 + dip / 2 - 4) * MM);
        a.rotation.x = s * 0.10;
        g.add(a);
      }
      box(g, 5, 5, d * 0.16, 2, wire, x, 5, 0);      // the low centre run over the bowl
    }
    // The gas port: out a SHORT (270mm) edge, under the plate -- the manual's own warning
    // diagram ("バーナー本体の器具栓及びホースは、トッププレートの短辺側から出してください").
    // In the frame that edge faces a long rail; the hose ducks under it to the canister.
    const port = new THREE.Mesh(new THREE.CylinderGeometry(7 * MM, 7 * MM, 26 * MM, 12),
      metal(0x63676d, 0.7, 0.4));
    port.rotation.x = Math.PI / 2;
    port.position.set(w * 0.18 * MM, -14 * MM, (d / 2 + 6) * MM);
    g.add(port);
    return { group: g, body };
  }

  // The Grill Burner (GS-355 雪峰苑). Its catalog h=175 is the STANDALONE height -- it measures
  // over the fold-out wire stand the hero shows splayed under the pan -- so hanging the full h
  // below the rim buried a 175mm slab under the rails that the real module doesn't have. In
  // the frame the stand folds away and only the drip pan drops in, a shallow ~65mm band (the
  // hero's pan is a narrow strip against the stand's 175). And the plate does not LIE in the
  // pan: it RIDES on corner posts with daylight under it, the bright pan rim showing beneath
  // the black casting from every side (hero; clearest in the JP in-frame shot a004). Flush it
  // read as a dark tray insert; the air gap is what says grill. Knob at the front-RIGHT
  // corner -- the hero puts it under the pan's right end, not centred.
  if (spec.plate) {
    const panH = 65, lift = 38;             // pan below the rim; the plate's underside above it
    const body = box(g, w, panH, d, 3, metal(steel, 0.85, 0.35), 0, -panH / 2, 0);
    box(g, w - 4, 4, d - 4, 1.5, metal(0xaeb4bb, 0.85, 0.35), 0, 2, 0);   // the pan's bright lip
    for (const sx of [-1, 1]) for (const sz of [-1, 1])                   // the posts it rides on
      cyl(g, 4, 4, 34, 10, metal(0x63676d, 0.7, 0.4), sx * (w / 2 - 20), 21, sz * (d / 2 - 20));
    box(g, w - 8, 10, d - 8, 4, metal(dark, 0.3, 0.6), 0, lift + 5, 0);   // the cast plate, aloft
    for (let i = -2; i <= 2; i++)        // its ridge bars -- the real casting is a herringbone
      box(g, w - 24, 3, 5, 1, metal(0x1b1e22, 0.2, 0.7), 0, lift + 10, i * (d / 6));
    cyl(g, 9, 9, 10, 16, metal(0x1c1f24, 0.4, 0.6), w / 2 - 30, -panH * 0.45, d / 2 + 4, Math.PI / 2);
    return { group: g, body };
  }

  // The stainless housing, dropped in. Rim at y=0, body hanging to -h.
  const body = box(g, w, h, d, 3, metal(steel, 0.85, 0.35), 0, -h / 2, 0);

  const heads = spec.heads || 1;
  for (let i = 0; i < heads; i++) {
    const hx = heads === 1 ? 0 : (i - (heads - 1) / 2) * (w / heads);
    const r = Math.min(w / heads, d) * 0.32;
    cyl(g, r, r, 10, 24, metal(dark, 0.5, 0.5), hx, 5, 0);
    cyl(g, r * 0.5, r * 0.6, 12, 20, metal(0x3a3d42, 0.6, 0.45), hx, 6, 0);
    for (let a = 0; a < 4; a++)
      box(g, r * 2.4, 4, 6, 1, metal(steel, 0.9, 0.3), hx, 16, 0, (a * Math.PI) / 4);
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

/** Waterproof Unit Gear Bag (UG-471 / UG-472): a CLOSED welded-EVA tub that drops into the
 *  frame -- 本体／EVA生地、PVCメッシュ、ナイロンテープ, the catalogue says, and the photos agree: a
 *  matte grey soft box, a black zip-top lid faced in PVC mesh, nylon webbing handles. Not a
 *  stainless bin, which is what the h >= 60 fallthrough had been drawing it as.
 *
 *  The two SKUs are ONE bag at two wall heights (110 / 220), and the JP studio shot of the
 *  pair (a001) shows the whole top assembly is SHARED -- same black zip band, same handles,
 *  same anchor hardware on both. So everything above the grey is absolute millimetres,
 *  measured on a001 against the published 360 x 220 face, and only the grey wall stretches:
 *
 *    - collar: the black band under the lid reads ~1/6 of the 220 -- 36mm.
 *    - anchors: each 360-wide face carries two moulded recess plates, ~72 x 36, centred a
 *      quarter of the width in from each end (+/-90 on 360), tops ~8mm below the collar.
 *      The webbing ends land ON them.
 *    - handles: one webbing U per wide face -- up from both recesses, along the top through
 *      a pale PVC grip sleeve. a001 lays one handle FLAT on the lid, and flat is the state
 *      drawn here: in the frame the only other place for a strap is dangling down a face
 *      the rails own (a002, the install photo, shows exactly that), which would clip every
 *      neighbouring module.
 *
 *  The 360 spans the rails the way any 360-deep module does, and the EVA is why the 317
 *  clear opening is survivable -- the body squashes through; the model keeps the published
 *  plan. Rim at y = 0 hanging to -h; the lid slab and the flattened straps ride a few mm
 *  proud of the tabletop, the exception the file header names.
 *
 *  The planner hands (w, d) along-rail-first, the bench hands them as published, so the
 *  build is normalised long-side-along-x and turned to fit the caller. `color` is the body
 *  EVA, defaulting to the grey colors.json sampled off UG-472's product photo -- the one
 *  photo of the two where the grey body outweighs the black lid. */
export function gearBagGroup(w, d, h, { color = 0xa8acac } = {}) {
  const g = new THREE.Group();
  const t = new THREE.Group();                     // built 360-along-x, turned to the caller
  t.rotation.y = w < d ? Math.PI / 2 : 0;
  g.add(t);
  const L = Math.max(w, d), S = Math.min(w, d);
  const COLLAR = 36;                               // the shared black zip band, off a001

  const eva     = metal(color, 0, 0.85);           // welded EVA: no metal in it at all
  const evaDark = metal(new THREE.Color(color).multiplyScalar(0.86), 0, 0.85);
  const collar  = metal(0x1d1f22, 0, 0.88);
  const lidTop  = metal(0x232528, 0, 0.95);        // the PVC-mesh lid face, duller still
  const webbing = metal(0x141518, 0, 0.9);
  const zipMat  = metal(0x45484d, 0, 0.8);
  const sleeve  = metal(0xc6c9cb, 0, 0.5);         // the pale PVC grip wrap

  // The grey tub and the black collar over it, one soft rounded form -- corner radius ~20
  // is what welded EVA panels pull themselves into. The tub tucks 2mm up behind the collar
  // so no seam gap opens; the collar runs 1mm proud each side, the lid assembly overhanging
  // the body the way the photos show.
  const body = box(t, L, h - COLLAR + 2, S, 20, eva,
                   0, -(COLLAR - 2) - (h - COLLAR + 2) / 2, 0);
  box(t, L + 2, COLLAR, S + 2, 12, collar, 0, -COLLAR / 2, 0);
  // The moulded base tray: a slight flare with its seam ~13mm up, and the foot the bag
  // stands on -- dropped 1.5 so its underside is not coplanar with the tub's.
  box(t, L + 3, 13, S + 3, 6, evaDark, 0, -h + 5, 0);

  // The lid: a black slab inset ~11mm all round, its mesh face 2.5mm proud of the rim.
  box(t, L - 22, 5, S - 22, 2.5, lidTop, 0, 0, 0);
  // The zip: a thin lighter ring where the lid meets the collar, 8mm in from the edge,
  // with the slider and its pull hanging at a front corner.
  for (const s of [-1, 1]) {
    box(t, L - 13, 1.8, 3, 0.8, zipMat, 0, 1.2, s * (S / 2 - 8));
    box(t, 3, 1.8, S - 13, 0.8, zipMat, s * (L / 2 - 8), 1.2, 0);
  }
  box(t, 6, 3, 5, 1, zipMat, L / 2 - 30, 1.2, S / 2 - 8);
  box(t, 5, 14, 1.8, 0.8, zipMat, L / 2 - 26, -9, S / 2 + 1.2);

  // The handles, folded flat. Per wide face: two legs up from the recess plates, over the
  // rim, in across the lid, joined by the top run wearing its grip sleeve. The webbing is
  // 25mm nylon, drawn 2.6 thick.
  const AX = L / 4;                                // anchor stations: quarter-width in
  const AY = COLLAR + 26;                          // recess centres, tops ~8mm under the collar
  const CROSS = 60;                                // where a folded handle's top run lands
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) {
      box(t, 72, 36, 2.5, 6, evaDark, e * AX, -AY, s * (S / 2 + 0.5));    // recess plate
      box(t, 25, AY, 2.6, 1, webbing, e * AX, -AY / 2, s * (S / 2 + 2));  // leg, down the wall
      box(t, 25, 3, 16, 1.2, webbing, e * AX, 0.5, s * (S / 2 - 6));      // over the rim
      box(t, 25, 2.6, S / 2 - 74, 1, webbing,                             // in across the lid
          e * AX, 3.8, s * (S / 2 - 14 + CROSS) / 2);
    }
    box(t, L / 2 + 25, 2.6, 25, 1, webbing, 0, 3.8, s * CROSS);           // the top run
    box(t, 96, 7, 30, 3, sleeve, 0, 4.4, s * CROSS);                      // its grip sleeve
  }
  return { group: g, body };
}


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

// What the CK-160's top can be. Owner: "可以用铁板换烤网" -- and Snow Peak backs it in BOTH
// directions: CK-160's 関連アイテム are exactly GR-006 and S-029HA, and GR-006's own page names
// リフトアップBBQ BOX. So the surfaces really are shared with the Takibi Fire & Grill L (owner) --
// and the number they share is the 500: GR-006 is not approximately the CK-160's 500, it IS it, the
// two-IGT-unit number. What is NOT shared is the Takibi's own 455 rim; these overhang that bowl and
// bear on the Grill Bridge's rails, and it is a coincidence of the useful kind that the size which
// spans a 445 bridge is also the size that drops into a 500 x 360 box.
//
// Three options, every one a real SKU on the bill:
//   nets    what it SHIPS with -- 焼き網 x2, one per unit, already on the box's own line
//   halves  S-029HA 焼アミハーフ Pro. x2, 339 x 206 each -- cross-listed on the CK-160
//   plate   GR-006, 500 x 330 -- FULL size: it replaces BOTH nets, not one
// There is deliberately NO net+plate mix: the only half-size plate Snow Peak makes (S-029HD) is
// 20mm too deep for the CK-160's 360 and is not on its 関連アイテム list, so that combination would
// be a shape with no part behind it.
export const BBQ_SURFACE_SKUS = {
  nets:   [],
  halves: ["S-029HA", "S-029HA"],
  plate:  ["GR-006"],
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
                                       surface = "nets" } = {}) {
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

  // The cooking surface, laid on the lift frame. Each option is a real part at its published size,
  // so what you see is what you'd buy: a net is a wire grid in a thin border at the real ~11mm
  // pitch (the S-029HA photo counts it out, and its spec prints ネット φ2.5mm), a 鉄板 is a solid
  // slab with a raised lip to hold the fat in, and it reads DARK -- it is not stainless.
  const netMat = metal(0xd0d4d9, 0.92, 0.24);
  const plateMat = metal(0x33373d, 0.42, 0.55);
  const net = (nw, nd, cx) => {
    // 11mm pitch, φ2.5 wire -- the real numbers (S-029HA's spec prints the gauge, its hero
    // counts ~30 openings across 339, and the CK-160 hero's own nets read the same weave).
    const rim = 6, pitch = 11;
    for (const sz of [-1, 1]) box(g, nw, 4, rim, 1, netMat, cx, lift - 2, sz * (nd / 2 - rim / 2));
    for (const sx of [-1, 1]) box(g, rim, 4, nd, 1, netMat, cx + sx * (nw / 2 - rim / 2), lift - 2, 0);
    const iw = nw - 2 * rim, id = nd - 2 * rim;
    const nx = Math.max(2, Math.round(iw / pitch)), nz = Math.max(2, Math.round(id / pitch));
    for (let j = 1; j < nx; j++) box(g, 2.5, 2, id, 0, netMat, cx - iw / 2 + (j * iw) / nx, lift - 1.5, 0);
    for (let j = 1; j < nz; j++) box(g, iw, 2, 2.5, 0, netMat, cx, lift - 3.5, -id / 2 + (j * id) / nz);
  };
  if (surface === "plate") {
    // GR-006, 500 x 330 x 35: ONE plate over the whole top. Its 500 is the body's 500 exactly.
    box(g, 500, 8, 330, 1.5, plateMat, 0, lift - 4, 0);
    for (const sz of [-1, 1]) box(g, 500, 27, 4, 1, plateMat, 0, lift + 9.5, sz * 163);
    for (const sx of [-1, 1]) box(g, 4, 27, 330, 1, plateMat, sx * 248, lift + 9.5, 0);
  } else if (surface === "halves") {
    for (const sx of [-1, 1]) net(339, 206, sx * 106);   // S-029HA x2, at their published 339 x 206
  } else {
    for (const sx of [-1, 1]) net(lfW / 2 - 3, lfD - 8, sx * (lfW / 4 + 1.5));   // the 焼き網 it ships with
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
 *    - TWO canisters clamped INVERTED under the front deck, one dead under each knob -- the
 *      液出し (liquid feed) in the product's own name, brass feed valve at the BOTTOM. Not a
 *      toggle: without its cans this stove is not itself.
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
    // The CANISTER, clamped INVERTED under the deck -- the 液出し of the product's own name,
    // so it is ALWAYS drawn: the GS-1000's can is 専用容器 bought separately and toggles, but
    // this stove without its two cans is not itself (the hero mounts both). Measured off the
    // hero against the 500mm face (152px): body 33px = φ108 -- the φ110-class can gs1000Group
    // already draws at r=54, NOT a slim bottle -- hung dead under its knob (centres read
    // ±115 ≈ SPACING/2, a second, independent scale check), top against the pan floor, ~110
    // of hang. The brass feed valve is at the BOTTOM, under the domed shoulder -- valve-down
    // is what liquid feed IS; the dark ring above is the socket the can twists up into.
    const canMat = metal(0xc8ccd0, 0.7, 0.4);
    const canZ = 150;                       // under the front deck, a little proud of the wall
    cyl(g, 30, 30, 14, 18, metal(dark, 0.5, 0.5), hx, -bodyH - 5, canZ);       // the socket ring
    cyl(g, 54, 54, 68, 24, canMat, hx, -bodyH - 46, canZ);                     // the can, base up
    cyl(g, 54, 34, 22, 24, canMat, hx, -bodyH - 91, canZ);                     // shoulder, now down
    cyl(g, 7, 7, 10, 10, metal(0xb08a4a, 0.8, 0.35), hx, -bodyH - 107, canZ);  // the brass feed valve
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
  if (base === "CK-160") return bbqBoxGroup(w, d, h, { color, surface: cfg || "nets" });
  // The waterproof gear bags are welded EVA soft tubs with a zip lid, not stainless bins --
  // and the swatch cannot be trusted for the body: colors.json sampled UG-471 at #282828
  // because its hero crop is mostly the black lid. The grey EVA is the same on both bags,
  // so the builder's own sampled default stands and the swatch stays out of it.
  if (base === "UG-471" || base === "UG-472") return gearBagGroup(w, d, h);
  const bspec = burnerOf(p.sku);
  // GP-040 is not a burner -- it is the bare wire frame the GS-1000 stands in. Its own shape,
  // ahead of the generic branches that used to dress it in a housing, a head and a knob.
  if (bspec?.gp040) return gp040Group(w, d, h);
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

/** Stainless Kitchen Table (LV-310; ステンレスキッチンテーブル): an open A-frame STAND, not the
 *  solid 1175x545x1100 block the fall-through drew. Its manual (LV-310_manual.pdf) itemises the
 *  whole part, and the photos confirm each piece:
 *
 *    左/右フレーム     two arched tube end frames: straight legs splayed front-back to the full
 *                    545 (the published depth IS the feet), a broad rounded shoulder over the
 *                    top, a clamp bracket + thumbscrew on the apex. The apex is NOT the 1100:
 *                    measured on the on-white hanger-form photo (JP a001) against the published
 *                    height, the brackets sit at ~930 (+/-15).
 *    テーブルトップ x2  two IDENTICAL stainless tops -- three panels between folded ~30mm hems
 *                    (the two joins and the hem edge: a001/a005). Each hangs INSIDE the legs on
 *                    four connection-piece pins ("オスが内側に来るように", manual p.4), at the
 *                    published hole ladder 830/660/400/250/120. The kitchen form is the manual's
 *                    own example -- worktop 830, shelf 250 -- and 830 is the IGT 830-leg datum,
 *                    which is what "integrates with the Iron Grill Table" is in millimetres
 *                    (LV-312 inserts a 4-Unit frame at that height; not modelled).
 *    上フレーム        the hanger U dropped into the two brackets and locked by the thumbscrew.
 *                    The catalogue's 1100 is ITS bar, not a tabletop, so it tops out at
 *                    h - 830 above the worktop. The holes along it take the CK-020 / CK-128
 *                    hangers (manual p.8) -- punched dark, frameGroup's trick.
 *    下フレーム        a near-ground U along one long side with two 補強バー braces facing
 *                    outward (manual p.3, 「補強バーが外側を向く」). Schematic the way
 *                    bbqBoxGroup's linkage is: the members are real, their exact anchor points
 *                    do not read off any photo.
 *
 *  The top depth is DERIVED, not published: at the 830 rung the leg splay leaves ~424mm between
 *  tube centres, and a top that hangs on inward pins inside that gap is ~405 deep -- which is
 *  what the photos show (shelf well inboard of the legs at 250, flush against them at 830).
 *
 *  Worktop at y = 0 -- the planner's table convention -- legs to -830, hanger to +(h - 830).
 *  THE CALLER LIFTS THE GROUP BY LV310_TOP, not by the published h. Mostly air, so a faint
 *  ghost box spans the full published envelope and carries picking (meshTrayGroup's trick). */
export const LV310_TOP = 830;   // the worktop's rung -- the manual's kitchen example, = IGT 830

export function lv310Group(w, d, h, color) {
  const g = new THREE.Group();
  const rise = h - LV310_TOP;                       // the hanger frame's reach above the worktop
  const tube = metal(0xd2d6da, 0.9, 0.28);          // polished tube -- brighter than the sheet
  const panel = metal(color, 0.78, 0.44);           // the tops' brushed stainless
  const seamMat = metal(0x83888e, 0.7, 0.5);        // a panel join, a shade darker
  const black = metal(0x25272b, 0.1, 0.85);         // アジャスター feet -- the ポリ in the 材質

  // The ghost pick box, full published envelope: picking for a part that is mostly air.
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06 }),
    0, h / 2 - LV310_TOP, 0);

  const strut = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  // A bent tube swept along its centreline -- the arch shoulders and both U-frames are generous
  // factory bends in every photo, not mitres, so they are swept, not butted.
  const bent = (pts, r) => g.add(new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM))),
    pts.length * 8, r * MM, 10), tube));

  const xa = w / 2 - 55;         // the arch planes: brackets, knobs and feet are the outermost metal
  const TW = w - 40, TD = 405;   // one tabletop -- it overruns each arch plane by ~25mm (hero)
  const topZ = TD / 2 + 9.5;     // leg tube centre at the worktop: hem + inward pin
  const botZ = d / 2 - 14;       // and at the floor: foot caps reach the published 545
  const legZ = y => topZ + (botZ - topZ) * ((25 - y) / 837);   // the straight leg line

  for (const sx of [-1, 1]) {
    const X = sx * xa;
    for (const sz of [-1, 1]) {
      strut([X, -812, sz * botZ], [X, 25, sz * topZ], 9.5, tube);        // a straight leg
      cyl(g, 12.5, 14.5, 20, 12, black, X, 10 - LV310_TOP, sz * botZ);   // its adjuster foot
    }
    // shoulder-and-apex, one sweep rim to rim: near-flat crown ~190 wide, tube top ~930 abs (a001)
    bent([[X, 25, topZ], [X, 52, 202], [X, 74, 168], [X, 87, 95], [X, 90, 0],
          [X, 87, -95], [X, 74, -168], [X, 52, -202], [X, 25, -topZ]], 9.5);
    box(g, 40, 26, 32, 2, metal(0xc3c8cd, 0.85, 0.35), X, 100, 0);       // the apex bracket
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(7.5 * MM, 7.5 * MM, 8 * MM, 12),
      metal(0x2c2f33, 0.4, 0.6));                                        // 上フレーム固定ネジ
    knob.rotation.z = Math.PI / 2;                                       // axis out along x
    knob.position.set((X + sx * 26) * MM, 100 * MM, 0);
    g.add(knob);
  }

  // 上フレーム: the hanger U dropped into the brackets. Its bar top IS the published height.
  const barY = rise - 8;
  bent([[-xa, 108, 0], [-xa, barY - 62, 0], [-xa + 12, barY - 26, 0], [-xa + 48, barY - 6, 0],
        [-xa + 105, barY, 0], [0, barY, 0], [xa - 105, barY, 0], [xa - 48, barY - 6, 0],
        [xa - 12, barY - 26, 0], [xa, barY - 62, 0], [xa, 108, 0]], 8);
  for (const f of [-0.68, -0.24, 0.24, 0.68])       // 上フレーム穴 -- where CK-020/CK-128 drop in
    cyl(g, 2.2, 2.2, 18, 8, metal(0x0e0f12, 0.2, 0.8), f * xa, barY, 0, Math.PI / 2);

  // One tabletop hung by its top face at ty: a 3mm sheet, the ~30mm hem all round (a005,
  // edge-on -- the keyhole slots punched in it are sub-8mm and not drawn), and the two joins
  // where its three panels meet (a001; the manual's 天板 drawing).
  const topAt = ty => {
    box(g, TW, 3, TD, 1, panel, 0, ty - 1.5, 0);
    for (const sz of [-1, 1]) box(g, TW, 28, 2, 0.5, panel, 0, ty - 17, sz * (TD / 2 - 1));
    for (const sx of [-1, 1]) box(g, 2, 28, TD - 4, 0.5, panel, sx * (TW / 2 - 1), ty - 17, 0);
    for (const sx of [-1, 1]) box(g, 1.6, 0.7, TD - 8, 0.2, seamMat, sx * TW / 6, ty + 0.05, 0);
  };
  topAt(0);                    // the worktop -- the datum this whole builder hangs from
  topAt(250 - LV310_TOP);      // the SAME physical part again (セット内容: テーブルトップx2), on the 250 rung

  // 下フレーム + 補強バー: the near-ground U along one long side, braces facing outward.
  const runY = 24 - LV310_TOP, runZ = 188;
  strut([-(xa - 95), runY, runZ], [xa - 95, runY, runZ], 7.5, tube);
  for (const sx of [-1, 1]) {
    strut([sx * (xa - 95), runY, runZ], [sx * xa, runY + 16, legZ(runY + 16)], 7.5, tube);
    strut([sx * (xa - 330), runY, runZ], [sx * (xa - 25), runY + 8, legZ(runY + 8) - 12], 6, tube);
  }

  return { group: g, body: ghost };
}


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
    // Black rails (the collapsible's) are the same anodised coating as the ends -- matte.
    const anodised = railColor === BLK_;
    const railMat = metalE(railColor, anodised ? 0.3 : 0.8, anodised ? 0.6 : 0.42, glow);
    railMat.vertexColors = true;   // the baked seat-crease shadow railProfile carries -- rails only
    const r = new THREE.Mesh(railProfile(w * MM, thick * MM, prof, s), railMat);
    r.position.set(0, -thick / 2 * MM, s * (d / 2 - railWidth / 2) * MM);
    g.add(r); pick.push(r);
  }
  // End pieces -- anodised black on the standard frame; the hook holes live in them.
  // NOT a full-height block: the photos (CK-149, the in-use a002) show a THIN top plate
  // capping the rail ends -- slightly proud of the rails, overhanging the end a touch,
  // a short folded skirt down its outer edge, and OPEN underneath: you see straight
  // through the frame below it. The airy end is the empty frame's identity, and a solid
  // 30mm block was the single biggest lie in the shell. Matte, like all the anodising.
  for (const sx of [-1, 1]) {
    const xc = sx * ((w - endW) / 2 + 4);              // +4: half of the 8mm overhang past the end
    const plate = new THREE.Mesh(roundedBox((endW + 8) * MM, 10 * MM, d * MM, 3 * MM),
      metalE(endColor, 0.28, 0.62, glow));
    plate.position.set(xc * MM, -3 * MM, 0);           // top at +2: proud of the rails, like the corner plates
    g.add(plate); pick.push(plate);
    // The folded outer edge, dropping past the plate -- the cap's short skirt.
    const skirt = new THREE.Mesh(roundedBox(5 * MM, 16 * MM, d * MM, 2 * MM),
      metalE(endColor, 0.28, 0.62, glow));
    skirt.position.set((sx * (w / 2 + 8) - sx * 2.5) * MM, -14 * MM, 0);
    g.add(skirt);
    // Two silver rivets in the top face, near the corners (the photos show them plainly).
    rivetsInto(g, [[xc, -(d / 2 - 14)], [xc, d / 2 - 14]], 3.5, plateColor);
  }
  // The hook holes in the end pieces, where an extension's wire hooks drop in. They punch
  // the PLATE now, not a block -- same centres as ever, the measured ones.
  const holes = hookHoles || [
    [-(w / 2 - holeInset), -143.9], [-(w / 2 - holeInset), 143.9],
    [w / 2 - holeInset, -143.9], [w / 2 - holeInset, 143.9],
  ];
  for (const [hx, hz] of holes) {
    const x = Math.sign(hx) * (w / 2 - holeInset);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(6 * MM, 6 * MM, 13 * MM, 10),
      metalE(0x0e0f12, 0.2, 0.8));
    hole.position.set(x * MM, -3 * MM, hz * MM);
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

// A folding leg at one short end: two struts dropping from the pivot under the frame to the
// ground, the way the built-in legs of the self-contained IGTs fold down. ex = which end (±1).
// The pair lives at ±zEdge and stays PARALLEL in depth unless zSplay pushes the feet wider;
// the fold direction is the LENGTH -- pivot at w/2 - inset, feet raked out to w/2 + splay.
// `barY` places the cross bar as a fraction of the way down the strut: 1 is a bar lying at
// the feet (the Entry's ground U-loop, and the default so the old calls draw unchanged),
// ~0.6 a mid-height rung (the Extension). `stay` > 0 adds the thin kickstand cylinder from
// the bar's midpoint up-inboard to the frame underside `stay` mm inside the pivot -- the
// fold lock the photos show in the leg's opening.
function foldLeg(g, { ex, w, d, top, footY, mat, r, splay, inset, zIn, feet = false,
                      barY = 1, stay = 0, zSplay = 0 }) {
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
    strut([topX, top, sz * zEdge], [footX, footY, sz * (zEdge + zSplay)], r);   // an upright
    foot.push([footX, footY, sz * (zEdge + zSplay)]);
  }
  // the cross bar sits ON the struts at barY -- at 1 it is the old foot bar exactly
  const bar = sz => [topX + (footX - topX) * barY, top + (footY - top) * barY,
                     sz * (zEdge + zSplay * barY)];
  strut(bar(-1), bar(1), r * 0.85);
  if (stay) strut(bar(0), [topX - ex * stay, top, 0], r * 0.4);   // the kickstand, up-inboard
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

/** The removable custom top of a self-contained IGT (Entry/Slim): wood boards over the FREE
 *  half-units of the 3-unit run, so a dropped module simply takes a board's place -- which is
 *  exactly how the real tops lift out. `skip` = occupied half-slot indices; `color` bamboo/teak;
 *  `d` the body depth (the tile spans the IGT depth, centred). `pieces` is the real piece split
 *  as half-unit spans: the Entry top is [1, 2, 1, 2] -- a half, a one-unit, a half, a one-unit,
 *  THREE seams -- counted off CK-080R's plan and front product shots (the plan view measures
 *  ~115/256/125/254mm across the 750 run), not the five equal seams one-board-per-half gives.
 *  A piece draws as ONE board while every half under it is free and falls back to its halves
 *  when a module lands mid-piece, so lift-out-per-half still works. No `pieces` = one board
 *  per half-unit, which is the Slim's six panels. Tiles hang just below y = 0. */
export function igtWoodTop({ units, color, skip = [], d, thick = 14, tex = null, pieces = null }) {
  const g = new THREE.Group();
  // `tex` (a grain map configured by the caller) gives the wood its figure; `color` tints it.
  const wood = new THREE.MeshStandardMaterial({ color, map: tex || null, roughness: 0.62, metalness: 0.03 });
  const HALF = 125, run = units * 250, tileD = Math.min(d - 40, 360), gap = 4;
  const skipSet = new Set(skip);
  const board = (i, span) => {                        // one board over half-slots i..i+span-1
    const cx = -run / 2 + (i + span / 2) * HALF;
    const tile = new THREE.Mesh(roundedBox((span * HALF - gap) * MM, thick * MM, tileD * MM, 1 * MM), wood);
    tile.position.set(cx * MM, -thick / 2 * MM, 0); g.add(tile);
  };
  // a split that does not cover the run exactly is a caller bug; fall back to per-half
  const split = pieces && pieces.reduce((a, b) => a + b, 0) === units * 2
    ? pieces : Array(units * 2).fill(1);
  let at = 0;
  for (const span of split) {
    let free = true;
    for (let k = 0; k < span; k++) if (skipSet.has(at + k)) free = false;
    if (free) board(at, span);                        // the whole piece is in place
    else for (let k = 0; k < span; k++)               // a module took part of it -- halves
      if (!skipSet.has(at + k)) board(at + k, 1);
    at += span;
  }
  return { group: g };
}

/** Slim IGT (CK-180): a self-contained 3-unit IGT frame -- two chunky TEAK end bars joined by a
 *  bright stainless pipe under each long edge, on two folding THIN-WIRE legs. The manual's
 *  material line leads with the stainless (ステンレス、天然木（チーク）、スチール カチオン電着塗装)
 *  and its warnings pin the black 電着塗装 to the 脚部 -- so the pipes are stainless, the bars
 *  teak, and only the LEGS are black; the bare-frame product photo (images.json alt02) shows
 *  exactly that. The pipes are panel supports, not system rails -- nothing hooks on them (the
 *  owner-confirmed "no side rails" in the catalog is about CONNECTION, and still stands). Its
 *  top is SIX removable half-unit teak panels (any lifts out for a stovetop) -- drawn by
 *  igtWoodTop -- so this builds only the bars, pipes and legs. `tex` = the teak grain the top
 *  wears, shared onto the end bars. Top at y = 0. */
export function slimIgtGroup(w, d, height, { tex = null } = {}) {
  const g = new THREE.Group();
  const thick = 16, cap = 50, railR = 8;
  // teak end bars, the outermost thing in the footprint: the hero measures them ~50x42 in
  // section against the published 940 width. Same surface response as igtWoodTop's panels; the
  // grain is tinted DOWN (the hero's bars sample ~0.78 of the slat tone) -- teak-brown untextured.
  const teak = new THREE.MeshStandardMaterial({ color: tex ? 0xc6c2be : 0x987c66,
    map: tex || null, roughness: 0.62, metalness: 0.03 });
  for (const sx of [-1, 1]) {
    const c = new THREE.Mesh(roundedBox(cap * MM, 42 * MM, d * MM, 3 * MM), teak);
    c.position.set(sx * (w / 2 - cap / 2) * MM, -21 * MM, 0); g.add(c);
  }
  // a BRIGHT stainless pipe under each long edge, bar to bar -- the silver line the hero leads
  // with. It measures ~phi16 against the 940 width; top tangent at the panels' underside (14mm
  // igtWoodTop tiles), outer face flush with the body edge. The real frame runs a PAIR per edge
  // (alt02) -- the inboard twin is hidden under the panels, so only the edge pipe is drawn.
  const rail = metalE(0xc8ccd2, 0.85, 0.28);
  for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(railR * MM, railR * MM, (w - 2 * cap) * MM, 12), rail);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, -(14 + railR) * MM, sz * (d / 2 - railR) * MM); g.add(r);
  }
  // two built-in folding thin-wire legs, splayed wide -- the one part that IS the black steel
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
  // two built-in folding legs at the ends -- black, matching the frame. Measured off the JP
  // elevations (img.snowpeak.co.jp SNP0121A0087 a003 front-on, a004/a005 end-on, scaled by the
  // published 1348/498/400): the pair stands NARROW -- strut centres ~330mm apart on the 498
  // depth (zIn 82) -- and the end views hold the struts plumb in depth to a couple of pixels
  // over the whole drop, so no zSplay; the fold rake is in the LENGTH, pivot ~12mm inside the
  // table end and feet ~88mm past it. The rung ties the pair at ~0.58 of the way down (there
  // is no ground bar on this table), and the thin stay runs from it up-inboard to the
  // underside. The 3/4 hero's 'legs splayed in depth' look is this length-rake seen at an
  // angle. r 9: the struts are ~20mm flat bars in the end views, drawn as this file's
  // cylinders.
  const legMat = metalE(0x1e2024, 0.6, 0.5);
  for (const ex of [-1, 1])
    foldLeg(g, { ex, w, d, top: -thick, footY: -(height - thick), mat: legMat, r: 9,
                 splay: 88, inset: 12, zIn: 82, feet: true, barY: 0.58, stay: 170 });
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
  // seat sling: bellied ~15mm between the side rails -- the hero shows a hang, not a board
  const seat = new THREE.Mesh(slingPanel(2 * sw, 15, 12, 2 * sd), cloth);
  seat.position.set(0, (seatH + 7) * MM, -sd * MM);
  g.add(seat);

  // back posts (tilt back) + the back panel, the chair's dominant surface. Measured on the
  // LV-077GY hero against the 838 spec height: ~215mm tall (a quarter of the chair), its top
  // edge flush with the post tops, raked WITH the posts, bowed ~10mm around them away from
  // the sitter. The old 165mm vertical board matched neither the rake nor the proportion.
  for (const sx of [-1, 1]) tube([sx * sw, seatH, -sd], [sx * sw, h, -sd - 45], 8);
  const rake = Math.atan(45 / (h - seatH)), bh = 215;
  const yb = h - bh * Math.cos(rake), zb = -sd - 45 * (yb - seatH) / (h - seatH);
  const back = new THREE.Mesh(slingPanel(2 * sw + 20, -10, 14, bh), cloth);
  back.rotation.x = -Math.PI / 2 - rake;   // stand the panel up, leaning with the posts
  back.position.set(0, yb * MM, zb * MM);  // bottom edge on the posts, top landing at h
  g.add(back);

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
  // canvas: ONE continuous run. The LV-091 hero shows a single cloth starting at the front
  // lip, sagging ~10mm between the side rails, sweeping up the reclined back with no crease
  // at the hinge, and wrapping over the top cross tube into a short tail behind (the sewn
  // sleeve in the photo). The old pair of flat boxes met at a hard crease with a gap -- a
  // deck chair, not this chair. Sampled (z,y) centreline, thickened and extruded across.
  const bl = Math.hypot(BT[0] - HB[0], BT[1] - HB[1]);
  const bd = [(BT[0] - HB[0]) / bl, (BT[1] - HB[1]) / bl];   // unit vector up the back rails
  const bnv = [bd[1], -bd[0]];                               // its normal, off the rails frontward
  const at = (P, a, b) => [P[0] + bnv[0] * a + bd[0] * b, P[1] + bnv[1] * a + bd[1] * b];
  const line = [];
  qpts([SF[0] + 14, SF[1] + 10], [55, SF[1] - 23], [HB[0] + 45, 290], 8, line);  // seat, ~10mm belly
  qpts([HB[0] + 45, 290], at(HB, 11, 0), at(HB, 11, 85), 6, line);  // the knee, rounded not creased
  line.push(at(BT, 11, 0));                                         // taut up the back
  for (let i = 1; i <= 6; i++) {                                    // over the top tube
    const p = Math.PI * i / 6;
    line.push([BT[0] + 11 * (bnv[0] * Math.cos(p) + bd[0] * Math.sin(p)),
               BT[1] + 11 * (bnv[1] * Math.cos(p) + bd[1] * Math.sin(p))]);
  }
  line.push(at(BT, -11, -42));                                      // the tail, hanging behind
  const sheet = new THREE.Mesh(sheetGeo(line, 9, 2 * sw - 10), cloth);
  sheet.rotation.y = -Math.PI / 2;    // profile plane -> the scene's z-y plane
  sheet.position.x = (sw - 5) * MM;   // extrusion ran off along -x; recentre on the frame
  g.add(sheet);
  return { group: g, body: g.children[0] };
}

/** Snow Peak Campfield Futon (SET-200) in its basic SOFA form: a low two-seat loveseat -- taupe
 *  seat + reclined back cushions on a dark plastic slat deck, natural-wood armrests on the ends.
 *  There is NO X-frame anywhere in the hero: the deck stands on silver U-HAIRPIN loop legs (a bent
 *  tube dropping from the deck, sweeping a wide floor bend, running the floor, climbing back up),
 *  one hoop front + rear per deck module, three modules, tied by thin black diagonal braces. The
 *  real set reconfigures many ways (bed / chairs / shelves); we model only the sofa.
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
  // the dark-brown plastic slat deck: the hero shows a deep fascia band under the cushions
  // (#5a4f49 sampled off it), the legs socketed into its underside. First mesh in, so the slab is
  // also the pick body -- it raycasts far better than the leg tube that used to be children[0].
  const plastic = new THREE.MeshStandardMaterial({ color: 0x5a4f49, roughness: 0.9, metalness: 0.05 });
  const blackMat = metalE(0x1f2124, 0.3, 0.6);
  box(w - 60, 75, d - 150, 0, 175.5, 0, plastic);       // fascia band, 138 up to just under the seats
  // NO X anywhere in the hero: the futon stands on silver U-HAIRPIN loops in the width-height
  // plane -- one hoop at the front + one at the rear of EACH of the three deck modules. Uprights
  // ~350 apart per module and a ~15-dia tube (measured against the published 1494 width); the
  // floor bends are generous factory sweeps, not mitres, so the hoop is swept along its centreline.
  const bent = (pts, r, mat) => g.add(new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM))),
    pts.length * 8, r * MM, 10), mat));
  const lz = fd - 20;                                   // loop planes tuck just behind the fascia
  for (const mx of [-w / 3, 0, w / 3]) {
    const uL = mx - 175, uR = mx + 175;
    for (const zc of [lz, -lz]) {
      bent([[uL, 140, zc], [uL, 66, zc], [uL + 4, 28, zc], [uL + 34, 8, zc], [mx, 8, zc],
            [uR - 34, 8, zc], [uR - 4, 28, zc], [uR, 66, zc], [uR, 140, zc]], 8, tubeMat);
      for (const ux of [uL, uR]) cyl([ux, 140, zc], [ux, 108, zc], 10.5, blackMat); // deck sockets
    }
    for (const ux of [uL, uR]) {
      cyl([ux, 60, lz], [ux, 130, -lz], 3.5, blackMat); // thin black diagonal: front leg mid -> rear top (hero, right end)
      cyl([ux, 70, lz], [ux, 50, lz], 9.5, blackMat);   // the clamp collar the brace grips on the front leg
    }
  }
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
  const seatH = h, sw = w / 2 - 55, sd = d / 2 - 15, fd = d / 2 + 25, fx = sw + 50;
  // two end X-frames (in the depth-height plane) + the seat-end loops the canvas wraps. In
  // the LV-071GY hero the feet stand clearly WIDER than the seat: each leg splays ~50mm
  // outboard along the length on its way down, so the stance reads the catalog 1095 while
  // the sling spans only the end loops
  for (const sx of [-1, 1]) {
    const X = sx * sw;
    tube([X, seatH, sd], [sx * fx, 8, -fd]);   // front leg -> back foot, splayed outboard
    tube([X, seatH, -sd], [sx * fx, 8, fd]);   // back leg -> front foot, splayed outboard
    tube([X, seatH, sd], [X, seatH, -sd]);  // seat-end loop
    for (const z of [-fd, fd]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(11 * MM, 13 * MM, 12 * MM, 10), metalE(0x1c1e22, 0.1, 0.85));
      cap.position.set(sx * fx * MM, 6 * MM, z * MM); g.add(cap);
    }
  }
  // one thin rod ties the two X crossings -- the only lengthwise member the hero shows (the
  // old front/back seat rails do not exist on the product; the fabric edges hang free)
  const tc = sd / (sd + fd), yc = seatH - (seatH - 8) * tc, xc = sw + 50 * tc;
  tube([-xc, yc, 0], [xc, yc, 0], 4);
  // the sling wraps over each end loop (a hem hanging outside it) and sags ~12mm mid-span --
  // the old dead-flat slab read as a wooden bench, not canvas
  const seat = new THREE.Mesh(slingPanel(2 * sw, 12, 10, 2 * sd, 26), cloth);
  seat.position.set(0, seatH * MM, -sd * MM); g.add(seat);
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
  const topThk = 22, sw = w / 2 - 35, sd = d / 2 - 10, fd = d / 2 + 20, railY = h - topThk - 10;
  const top = new THREE.Mesh(roundedBox(w * MM, topThk * MM, d * MM, 3 * MM), woodMat);
  top.position.y = (h - topThk / 2) * MM; g.add(top);
  for (const sx of [-1, 1]) {                  // end X-frames
    const X = sx * sw;
    tube([X, railY, sd - 4], [sx * (sw + 40), 8, -fd]);
    tube([X, railY, -(sd - 4)], [sx * (sw + 40), 8, fd]);
    for (const z of [-fd, fd]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(10 * MM, 12 * MM, 12 * MM, 10), metalE(0x1c1e22, 0.1, 0.85));
      cap.position.set(sx * (sw + 40) * MM, 6 * MM, z * MM); g.add(cap);
    }
  }
  // the lengthwise members run directly UNDER the top's long edges -- the LV-066TR hero
  // shows two bright rails hugging the underside end to end, and NO bar lower down (the old
  // mid-air stretcher at y=130 floated a silver line where the real product is open). The
  // legs splay ~40mm out along the length; the hero's feet land just past the top edge.
  for (const zc of [sd - 4, -(sd - 4)]) tube([-sw, railY, zc], [sw, railY, zc]);
  return { group: g, body: top };
}

/** Snow Peak Take! Bamboo Chair (LV-085): a BUTTERFLY chair, and the JP photo set says how it
 *  is put together. The a003 side elevation: each side is TWO continuous laminated-bamboo
 *  battens crossing scissor-fashion mid-height -- front foot straight up to the back canvas
 *  corner, back foot straight up to the front corner -- nothing splits at the seat, and each
 *  foot ends in a flat bamboo skid. The aluminium is thinner stock and lives BETWEEN the
 *  sides: a front and a rear lateral scissor X (a001 front/back views) whose tube ends meet
 *  the batten tips inside the cloth pockets, and that is what folds the chair flat sideways.
 *  One continuous cream canvas hangs off the four tips: wrap-over HORNS at the back posts,
 *  plump wing ROLLS over the front tips, a deep dimpled bucket slung between (US hero, JP
 *  a004). The bucket's low point is the one published number in the drape -- シート高420mm on
 *  the JP spec sheet, 0.56 of the 749 height -- and the sheet is hung from it. Feet at y = 0,
 *  faces +z. */
export function takeChairGroup(w, d, h, { frame = 0xcfd3d7, fabric = 0xefe6d0, wood = 0xd8bd86, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const alu = metalE(frame, 0.85, 0.32);
  const bambooMat = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.55, metalness: 0.03 });
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.9, side: THREE.DoubleSide });
  const orient = (m, va, vb) => {
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const v3 = a => new THREE.Vector3(a[0] * MM, a[1] * MM, a[2] * MM);
  // the alu is thin round tube; the bamboo is a FLAT batten -- ~34mm face in the side view,
  // ~13mm edge-on from the front -- so it is an oriented box, not a fatter cylinder
  const tube = (a, b, r = 5.5) => { const va = v3(a), vb = v3(b);
    return orient(new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), alu), va, vb); };
  const batten = (a, b) => { const va = v3(a), vb = v3(b);
    return orient(new THREE.Mesh(roundedBox(13 * MM, va.distanceTo(vb), 34 * MM, 5 * MM), bambooMat), va, vb); };

  // Frame stations, measured off a003 against the published 750 height / 630 depth (and a001
  // for the widths: the sides SPLAY -- feet inboard at 0.38w, batten tips outboard at 0.43w,
  // the cloth wings at the full w/2).
  const fx = w / 2 - 68, tx = w / 2 - 37;          // batten planes at foot / at tip
  const footF = 0.386 * d, footB = -0.5 * d;       // ground contacts: +243 / -315
  const hingeY = 0.815 * h, hingeZ = -0.248 * d;   // stainless bracket under the horn (a003 top)
  const hornY = 0.90 * h, hornZ = -0.31 * d;       // back batten tip, inside the horn pocket
  const wingY = 0.72 * h, wingZ = 0.47 * d;        // front batten tip, inside the wing roll

  for (const sx of [-1, 1]) {
    // one CONTINUOUS batten front foot -> horn, one back foot -> wing; they rivet face to
    // face where they cross (~0.44h in a003), so one rides 6.5mm outboard, the other inboard
    batten([sx * (fx + 6.5), 14, footF], [sx * (tx + 6.5), hornY, hornZ]);
    batten([sx * (fx - 6.5), 14, footB], [sx * (tx - 6.5), wingY, wingZ]);
    // flat bamboo skid shoes running INWARD from each foot (a003 bottom edge)
    box(g, 34, 14, 140, 5, bambooMat, sx * fx, 7, footF - 48);
    box(g, 34, 14, 140, 5, bambooMat, sx * fx, 7, footB + 48);
    box(g, 8, 32, 16, 2, metal(0xd6d9dc, 0.9, 0.3), sx * (tx + 11), hingeY, hingeZ);  // horn hinge strap
    // the two lateral scissor X's, thin alu tube, each foot to the OPPOSITE side's tip
    tube([sx * fx, 22, footF], [-sx * tx, wingY, wingZ]);     // front X, up into the wing rolls
    tube([sx * fx, 22, footB], [-sx * tx, hingeY, hingeZ]);   // rear X, up to the horn brackets
  }

  // The drape: ONE sheet, front edge -> seat pocket -> waist -> back -> top edge. Per station:
  // z along the depth, the cloth's height at its EDGES, its HALF-width, how far the centre
  // SAGS below the edges, and (back panel only) how far the middle bellies rearward. Stations
  // trace the hero + a004 silhouette hung on three anchors: wings 0.72h, horns ~h, floor 420.
  const S = [
    //   z/d     yE/h   hw/w  sag belly
    [ 0.470,  0.695,  0.435,  55,  0],   // front edge, sagging between the wing rolls
    [ 0.360,  0.675,  0.415,  72,  0],
    [ 0.240,  0.665,  0.385,  80,  0],
    [ 0.100,  0.660,  0.355,  76,  0],   // pocket floor: centre 418 = the published 420
    [-0.020,  0.665,  0.330,  68,  0],
    [-0.100,  0.685,  0.315,  52,  0],   // bucket rear climbing out
    [-0.145,  0.730,  0.300,  36,  0],   // the waist -- narrowest, bucket turns into back
    [-0.175,  0.785,  0.335,  28, 12],
    [-0.205,  0.845,  0.370,  24, 16],   // back panel widening toward the horns
    [-0.235,  0.905,  0.400,  26, 18],
    [-0.265,  0.955,  0.415,  38, 14],
    [-0.295,  0.985,  0.425,  64,  8],   // top edge: ~65mm dip between the horn peaks (hero)
  ];
  const cols = 10, geo = new THREE.PlaneGeometry(1, 1, cols, S.length - 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < S.length; i++) for (let j = 0; j <= cols; j++) {
    const [zc, ye, hw, sag, belly] = S[i], u = (j / cols) * 2 - 1, dip = 1 - u * u;
    pos.setXYZ(i * (cols + 1) + j, u * hw * w * MM, (ye * h - sag * dip) * MM, (zc * d - belly * dip) * MM);
  }
  geo.computeVertexNormals();
  const sheet = new THREE.Mesh(geo, cloth);
  g.add(sheet);

  // The four pockets gripping the batten tips: wrap-over horns peaking at ~the full 749, and
  // plump forward wing rolls whose crowns ride ~70mm above the sagging front edge.
  const pocket = (x, y, z, dir, r, len) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r * MM, len * MM, 4, 12), cloth);
    m.position.set(x * MM, y * MM, z * MM);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
    g.add(m); return m;
  };
  for (const sx of [-1, 1]) {
    pocket(sx * 0.425 * w, 0.93 * h, hornZ + 9, [sx * 0.04, 0.836, -0.555], 26, 64);  // horn, along the batten
    pocket(sx * 0.43 * w, 0.73 * h, 0.40 * d, [sx * 0.12, 0.18, 0.975], 30, 70);      // wing roll, pointing forward
  }
  return { group: g, body: sheet };   // the sheet is the chair's own big pick surface
}

/** Hard Rock Cooler 40QT (UG-302GY): the Grizzly-built rotomolded cooler in Snow Peak grey.
 *  From the UG-302_hero01 photo: a soft-cornered tub, a lid that overhangs it slightly with
 *  screw bosses in its top corners, TWO RED T-LATCHES bridging the seam on the front face --
 *  the one detail that identifies it across a campsite -- recessed grip notches in the short
 *  ends, and a drain plug low on the front right. Stands on the ground, +z is the latch face.
 *  `frame` paints the body (the catalog's frame_hex channel), `fabric` the latches. */
export function coolerGroup(w, d, h, { frame = 0x8a7e76, fabric = 0xa83832 } = {}) {
  const g = new THREE.Group();
  const poly = new THREE.MeshStandardMaterial({ color: new THREE.Color(frame), metalness: 0, roughness: 0.62 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(frame).multiplyScalar(0.55), metalness: 0, roughness: 0.85 });
  const lidH = h * 0.22, seam = 3, bodyH = h - lidH - seam;
  const body = new THREE.Mesh(roundedBox((w - 12) * MM, bodyH * MM, (d - 12) * MM, 12 * MM), poly);
  body.position.y = bodyH / 2 * MM; g.add(body);
  // The seam: a slightly recessed dark band, so the lid reads as a separate piece.
  const band = new THREE.Mesh(roundedBox((w - 20) * MM, seam * 2 * MM, (d - 20) * MM, 8 * MM), dark);
  band.position.y = (bodyH + seam) * MM; g.add(band);
  const lid = new THREE.Mesh(roundedBox(w * MM, lidH * MM, d * MM, 12 * MM), poly);
  lid.position.y = (bodyH + seam + lidH / 2) * MM; g.add(lid);
  // Screw bosses in the lid's top corners (the hero shows all four).
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    cyl(g, 16, 16, 4, 18, dark, sx * (w / 2 - 42), bodyH + seam + lidH - 1, sz * (d / 2 - 42));
  // The red T-latches: a vertical rubber strap over the seam, crossbar at the bottom.
  const latch = new THREE.MeshStandardMaterial({ color: new THREE.Color(fabric), metalness: 0, roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const x = sx * w * 0.22, zc = (d - 6) / 2;
    box(g, 26, 105, 9, 3, latch, x, bodyH + seam + lidH * 0.45 - 105 / 2 + 8, zc);
    box(g, 62, 24, 11, 4, latch, x, bodyH - 88, zc);      // the T's crossbar, pulled down on the body
  }
  // Recessed grips in the short ends, and the drain plug low on the front right.
  for (const sx of [-1, 1]) box(g, 8, 34, 130, 3, dark, sx * (w - 14) / 2, bodyH * 0.62, 0);
  cyl(g, 15, 15, 6, 16, dark, w / 2 - 70, 32, (d - 8) / 2, Math.PI / 2);
  return { group: g, body };
}

/** The Jikaro: an octagonal ring of four trapezoid segments with the fire hole in the
 *  middle, standing on folding wire legs. `ringMat` paints the ring; `color` the wire.
 *  Ring top at y = 0, legs to -height. */
export function jikaroGroup({ outer, opening, edge, height, color, ringMat }) {
  const g = new THREE.Group();
  const thick = 6, edgeT = 25;
  const mat = ringMat || metalE(color, 0.85, 0.3);
  const R = outer / 2, e = edge / 2, o = opening / 2;
  // The top is a folded PAN, not a sheet: the a005 side elevation shows a 25mm edge band
  // (41px against the published 400mm height at 1.63px/mm), and a002 looks straight into
  // the fold walls lining the fire hole. So: the 6mm deck keeps the y=0 datum, and 2mm
  // skirts drop to -25 under the outer edge (four straights, four chamfers) and the
  // hearth edge. Hollow between them -- that cavity is where the wire legs fold away.
  const ring = new THREE.Mesh(jikaroRing(outer, opening, edge, thick * MM), mat);
  g.add(ring);                                 // stays children[0]: app.js picks the ring by index
  const skirtH = edgeT - thick, skirtY = -thick - skirtH / 2;
  for (const s of [-1, 1]) {
    box(g, edge, skirtH, 2, 0.5, mat, 0, skirtY, s * (R - 1));      // outer straight sides
    box(g, 2, skirtH, edge, 0.5, mat, s * (R - 1), skirtY, 0);
    box(g, opening, skirtH, 2, 0.5, mat, 0, skirtY, s * (o + 1));   // the hearth fold, a002
    box(g, 2, skirtH, opening, 0.5, mat, s * (o + 1), skirtY, 0);
  }
  const cham = (R - e) * Math.SQRT2, cc = (R + e) / 2 - 0.7;        // chamfers, corner to corner
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
    box(g, cham, skirtH, 2, 0.5, mat, cx * cc, skirtY, cz * cc, cx * cz > 0 ? Math.PI / 4 : -Math.PI / 4);
  const seams = jikaroSeams(outer, opening, edge, 0x6a7079);
  seams.position.y = 0.4 * MM;
  g.add(seams);

  // The multifunction punching: every panel carries a row of 19 slots at a 22mm pitch on
  // its 600mm edge, spanning the middle ~400mm (a002, measured against that edge: 34.5px
  // pitch, 18 clear units plus one washed out, evenly spaced). The 600 edge faces the
  // HEARTH in the published long-edge-in ring (a001) and faces OUT built short-edge-in
  // (a002), so the row follows whichever side that edge landed on. Each punching is a
  // port plus a narrow relief dash; at planner distance one dark inlay per unit is the
  // read, laid a hair proud of the deck like the seams.
  const inlay = metal(0x33373d, 0.3, 0.7);
  const rowAt = opening > edge ? o + 16 : R - 16;   // slots 16mm long, starting 8mm off the fold
  for (let k = 0; k < 19; k++) {
    const u = (k - 9) * 22;
    box(g, 7, 1, 16, 0.4, inlay, u, -0.3, rowAt);
    box(g, 7, 1, 16, 0.4, inlay, u, -0.3, -rowAt);
    box(g, 16, 1, 7, 0.4, inlay, rowAt, -0.3, u);
    box(g, 16, 1, 7, 0.4, inlay, -rowAt, -0.3, u);
  }

  // FOUR legs, one per panel -- the manual settles it (data/manuals/ST-050.pdf, a scan,
  // rendered and read): セット内容 counts 脚×4, and the 組立 steps seat ONE wire leg per top --
  // 脚A辺 into 溝A (2ヶ所), spread the leg (広げすぎ注意: a sprung fold, not a hinge), 脚B辺
  // into 溝B (2ヶ所) -- four grooves, one leg, per panel. The eight per-slant hairpins drawn
  // before were this model's reading of the elevations; the manual's own leg figure wins.
  // What one leg is, off that figure and the JP photos (a002/a005/a009): two rectangular wire
  // gates spread into a shallow V, top edges PARALLEL to the panel's folds. The wider gate
  // hangs plumb just inboard of the WIDE fold; the narrower gate hangs from the NARROW fold's
  // grooves, drops plumb, then elbows inward (the kink in a002) to land its feet astride
  // mid-panel. Each gate bottoms in its own foot bar with the shallow centre notch (a009),
  // the two bars lying close and parallel (a005, notches interleaving). Measured from the
  // folds, both build patterns produce the SAME two gates -- one leg, either table, which is
  // what a reversible panel demands and a good cross-check that the stations are right.
  const wire = metalE(color, 0.9, 0.28);
  const strut = (a, b) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM);
    const vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3 * MM, 3 * MM, va.distanceTo(vb), 6), wire);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m);
  };
  // The panel's half-width at radius z -- the trapezoid the gates must fit under.
  const halfAt = z => o + (e - o) * (z - o) / (R - o);
  const zIn = o + 34, zOut = R - 34;             // the groove rows, just inboard of each fold (裏面 fig)
  const [zWide, zNarrow] = o > e ? [zIn, zOut] : [zOut, zIn];
  const spanW = 0.46 * halfAt(zWide);            // gate half-spans: the 裏面 drawing's 溝 pairs sit
  const spanN = 0.46 * halfAt(zNarrow);          //   ~46% of the local panel width apart, both rows
  const zFeet = (zWide + zNarrow) / 2;           // the narrow gate's feet land astride mid-panel
  const elbowY = -0.55 * height, notch = 32;     // the a002 kink height; foot-bar centre rise (a009)
  for (let k = 0; k < 4; k++) {
    const cs = Math.cos(k * Math.PI / 2), sn = Math.sin(k * Math.PI / 2);
    const at = (x, y, z) => [x * cs + z * sn, y, -x * sn + z * cs];
    const gate = (half, zTop, zF, elbow) => {
      const feet = [];
      for (const sx of [-1, 1]) {
        if (elbow) {                             // plumb to the kink, then canted in to the foot
          strut(at(sx * half, -thick, zTop), at(sx * half, elbowY, zTop));
          strut(at(sx * half, elbowY, zTop), at(sx * half, -height, zF));
        } else strut(at(sx * half, -thick, zTop), at(sx * half, -height, zF));
        feet.push(at(sx * half, -height, zF));
      }
      const mid = [(feet[0][0] + feet[1][0]) / 2, -height + notch, (feet[0][2] + feet[1][2]) / 2];
      strut(feet[0], mid); strut(mid, feet[1]);  // the foot bar, dipping to its feet round the notch
    };
    gate(spanW, zWide, zWide, false);            // the wide gate, plumb under the wide fold
    gate(spanN, zNarrow, zFeet, true);           // the narrow gate, elbowed in to mid-panel
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

/** The two rail-hung racks (CK-220 hanging rack frame / CK-230 shallow hanging shelf), by
 *  what their manuals and photos actually show: OPEN construction. The old drawing closed
 *  each side with a solid full-drop sheet, and under a tabletop the rack read as a cabinet;
 *  web/img/CK-220.jpg shows daylight everywhere -- flat bar, plates, punched holes.
 *
 *  Both hang the same way. A side frame stands at each END (x = +/-w/2), spans the table's
 *  DEPTH, and lands hooks on the rails. The CK-230 manual's 断面図 draws the hook as a flat
 *  finger in the panel's own plane laying an arm outward on top of the rail, and counts
 *  左右合計4か所のフック; CK-220's counts the same four. The rails' lips sit at |z|
 *  158.5..182.5 (railProfile), so every hook here lives at |z| ~170 and its arm's underside
 *  lands at -10 -- the measured recess modules rest in. Everything else hangs BETWEEN the
 *  two side frames; nothing closes the sides.
 *
 *      CK-220  セット内容: メインフレーム x2, サイドフレーム x2. Each side frame is a band
 *              below the rail line (~92mm against the hero's 372, an oblong hand slot
 *              through it, logo out) with a flat-bar leg dropping from each end and a column
 *              of フック穴 down the leg. The MAIN frames are bare tier rims -- no floor, the
 *              trays and boxes hang THROUGH them -- hooked into those holes at 4 corners
 *              each. Tier tops -150/-340, measured off the hero at ~1px:1mm against the 372;
 *              372 itself is unpublished, so the translucent "estimated" dress stays.
 *      CK-230  本体 x1: a perforated base plate whose side panels fold up to 90 degrees,
 *              each a triangulated plate -- top rail, end posts leaning inward on the way
 *              down, a V of braces meeting over the shelf's centre (the embossed logo sits
 *              under that meeting). Published 510 x 354 x 242.
 *
 *  Mostly air now, so a faint ghost box carries picking (the meshTrayGroup deal). Top at
 *  y = 0, hangs to -drop. Returns { group, body }. */
export function hangRackGroup({ w, d, drop, tiers = 1, hasSurface = false, color, estimated = false }) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), metalness: 0.9, roughness: 0.28,
    transparent: estimated, opacity: estimated ? 0.78 : 1,
  });
  const dark = metalE(0x0e0f12, 0.2, 0.8);      // punched holes -- frameGroup's own fake
  const bar = (bw, bh, bd, x, y, z) => box(g, bw, bh, bd, 1, steel, x, y, z);
  const px = w / 2 - 2;                         // the side frames' plane, one per end

  // The ghost pick box: the full envelope, faint, and the only mesh the planner tags.
  const ghost = box(g, w, drop, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06 }),
    0, -drop / 2, 0);

  // Four rail hooks, two per side frame: a riser in the panel's plane, an arm laid outward
  // over the rail (underside on the -10 lip), a small down-step at the tip. Drawn a hair
  // thicker than the plates they grow from so the overlaps don't shimmer.
  const hookZ = Math.min(d / 2 - 8, 170);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bar(4, 26, 18, sx * px, -17, sz * hookZ);
    bar(4, 6, 34, sx * px, -7, sz * (hookZ + 12));
    bar(4, 10, 4, sx * px, -9, sz * (hookZ + 27));
  }

  if (!hasSurface) {
    // CK-220. The side frame: a full-depth band below the rail line, the hand slot punched
    // through it (a dark plug a hair proud of both faces), and a leg off each end carrying
    // the hook-hole column the tier frames adjust on. Open everywhere below the band.
    for (const sx of [-1, 1]) {
      bar(3, 92, d, sx * px, -58, 0);
      box(g, 4.5, 14, 100, 2, dark, sx * px, -58, 0);
      for (const sz of [-1, 1]) {
        bar(4, drop - 104, 16, sx * px, -(104 + (drop - 104) / 2), sz * (d / 2 - 9));
        for (let k = 0; k < 6; k++)
          cyl(g, 3.2, 3.2, 6, 10, dark, sx * px, -(140 + k * 40), sz * (d / 2 - 9))
            .rotation.z = Math.PI / 2;
      }
    }
    // The tier rims: flat bar on edge with a narrow flange turned INWARD at the top -- the
    // ledge the mesh trays' rims rest on in the catalogue shots. The corner hooks into the
    // leg holes are real but sub-planner-distance, so they are not drawn.
    for (let i = 0; i < tiers; i++) {
      const ty = tiers === 1 ? drop - 32 : 150 + (i * (drop - 32 - 150)) / (tiers - 1);
      for (const sz of [-1, 1]) {
        bar(w - 10, 20, 4, 0, -(ty + 10), sz * (d / 2 - 8));
        bar(w - 10, 3, 12, 0, -(ty + 1.5), sz * (d / 2 - 16));
      }
      for (const sx of [-1, 1]) bar(4, 20, d - 16, sx * (w / 2 - 5), -(ty + 10), 0);
    }
  } else {
    // CK-230. Side panels: top rail, end posts leaning ~6 degrees inward on the way down
    // (the taper the photos show), a V of braces to the shelf's centre. All flat strap.
    const shelfTop = drop - 18;
    for (const sx of [-1, 1]) {
      bar(3, 20, d - 16, sx * px, -40, 0);
      for (const hz of [-110, 0, 110])
        cyl(g, 2.5, 2.5, 6, 10, dark, sx * px, -40, hz).rotation.z = Math.PI / 2;
      for (const sz of [-1, 1]) {
        const run = shelfTop - 50;
        bar(4, run, 18, sx * px, -(50 + run / 2), sz * (d / 2 - 12)).rotation.x = sz * 0.10;
        const zT = d / 2 - 27, zB = 12, rise = shelfTop - 14 - 55;
        bar(4, Math.hypot(rise, zT - zB), 18, sx * px, -(55 + rise / 2), sz * ((zT + zB) / 2))
          .rotation.x = sz * Math.atan2(zT - zB, rise);
      }
      // the black trim strip riding the panel-shelf joint in every CK-230 photo
      box(g, 6, 10, d - 20, 2, metal(0x1c1e22, 0.1, 0.65), sx * (w / 2 - 4), -(shelfTop - 3), 0);
    }
    // The base plate: a shallow pan at the very bottom -- floor, long lips folded DOWN,
    // and the rows of dash perforations, drawn flush and dark (the through-hole fake).
    box(g, w - 8, 3, d - 4, 1, steel, 0, -(shelfTop + 1.5), 0);
    for (const sz of [-1, 1]) bar(w - 8, 18, 3, 0, -(shelfTop + 9), sz * (d / 2 - 3.5));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++)
      box(g, 26, 1.2, 5, 0.5, dark,
        (c - 2 + (r % 2 ? 0.25 : -0.25)) * (w / 6.5), -(shelfTop - 0.3), (r - 1.5) * (d / 4.6));
  }
  return { group: g, body: ghost };
}

/** A ridge-pitched tarp, STANDING -- the first shelter to get a body instead of a ground
 *  outline. One builder, two pitches, because the photos say they are two different objects:
 *
 *    hexa   (6 verts)  2 poles at the ridge tips, the four wing corners guyed LOW (~0.20h,
 *                      measured against the known 2400 pole in the TP-862 set hero). Every
 *                      edge arcs INWARD AND UPWARD between its anchors -- the catenary cut,
 *                      the thing that makes a hexa a hexa -- at a sagitta of ~8-10% of the
 *                      chord, read off the same hero.
 *    recta  (4 verts)  SIX poles: two main at the ridge (mid-short-edge) and four corner
 *                      sub-poles at ~0.65h (the TP-842 hero measures 0.62-0.67). The fabric
 *                      is a gently-sloped roof; edges nearly straight with a whisper of sag.
 *
 *  The membrane is a ruled surface per half -- ridge curve to outer edge chain -- with a
 *  slight belly, built straight from the MEASURED footprint polygon and the published pole
 *  height. It draws at opacity 0.5: see-through enough that the kitchen under it stays the
 *  subject, and just under rebuild()'s 0.55 shadow threshold, so a tarp shades nothing --
 *  a hard black shadow-map blob over the whole layout would be worse than no shade.
 *  `verts` the footprint polygon (mm, [x,z]); `h` the published pole height; rim at y = 0
 *  is GROUND here (shelters stand; they do not hang). */
export function tarpPitchGroup({ verts, h, color = 0x8a7460, family = "hexa" }) {
  const P = family === "recta"
    ? { cornerH: 0.65, bow: 0.02, lift: -0.025, ridgeSag: 0.012, belly: 0.03, cornerPoles: true, lean: 0 }
    : { cornerH: 0.20, bow: 0.085, lift: 0.10, ridgeSag: 0.02, belly: 0.05, cornerPoles: false, lean: 4 };
  const g = new THREE.Group();

  // The ridge runs along the footprint's LONG axis. A hexa has its two tip vertices ON that
  // axis; a recta has none, so its ridge ends are the mid-points of the two short edges,
  // spliced into the boundary chain as extra nodes.
  const xs = verts.map(v => v[0]), zs = verts.map(v => v[1]);
  const ext = a => Math.max(...a) - Math.min(...a);
  const ax = ext(xs) >= ext(zs) ? 0 : 1, perp = 1 - ax;
  let ring = verts.map(v => [v[0], v[1]]);
  if (!ring.some(v => Math.abs(v[perp]) < 1)) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      out.push(a);
      if ((a[perp] > 0) !== (b[perp] > 0)) {         // this edge crosses the axis: splice the midpoint
        const t = a[perp] / (a[perp] - b[perp]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    ring = out;
  }
  const onAxis = ring.map((v, i) => [i, v]).filter(([, v]) => Math.abs(v[perp]) < 1);
  const [iA] = onAxis.reduce((m, c) => c[1][ax] > m[1][ax] ? c : m);
  const [iB] = onAxis.reduce((m, c) => c[1][ax] < m[1][ax] ? c : m);
  const seq = [];                                     // ring rotated to start at tip A
  for (let k = 0; k < ring.length; k++) seq.push(ring[(iA + k) % ring.length]);
  const cut = seq.findIndex(v => Math.abs(v[perp]) < 1 && v !== seq[0] && Math.abs(v[ax] - ring[iB][ax]) < 1);
  // BOTH chains run tip A -> tip B, so each half's edge parameter marches the same way as
  // the ridge's -- pairing them the raw ring order gave one half an E running B->A against
  // an R running A->B, and the surface twisted across the diagonal.
  const chains = [seq.slice(0, cut + 1), [seq[0], ...seq.slice(cut + 1).reverse(), seq[cut]]];

  const V3 = (x, y, z) => new THREE.Vector3(x * MM, y * MM, z * MM);
  const tipA = ring[iA], tipB = ring[iB];
  const membrane = new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
    metalness: 0, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  const trimMat = metal(0xa8382e, 0.15, 0.6);          // the red edge binding, both families' heroes
  let body = null;

  for (const chain of chains) {
    if (chain.length < 3) continue;
    // node heights: pole tips at h, everything between at the measured corner fraction
    const nodes = chain.map((v, i) => ({ v, y: (i === 0 || i === chain.length - 1) ? h : h * P.cornerH }));
    const segLen = [];
    let L = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i].v, b = nodes[i + 1].v;
      segLen.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
      L += segLen[i];
    }
    const E = t => {                                   // the outer edge, catenary bows and all
      let s = t * L, i = 0;
      while (i < segLen.length - 1 && s > segLen[i]) s -= segLen[i++];
      const lt = segLen[i] ? s / segLen[i] : 0;
      const a = nodes[i], b = nodes[i + 1];
      const x = a.v[0] + (b.v[0] - a.v[0]) * lt, z = a.v[1] + (b.v[1] - a.v[1]) * lt;
      let y = a.y + (b.y - a.y) * lt;
      const arc = Math.sin(Math.PI * lt);
      y += P.lift * segLen[i] * arc;                   // the edge arcs up (hexa) or sags (recta)
      const p = [x, z];
      const inward = -Math.sign(p[perp]) * P.bow * segLen[i] * arc;   // and bows toward the ridge
      p[perp] += inward;
      return { x: p[0], z: p[1], y };
    };
    const R = t => {                                   // the ridge, tip to tip, with its slight sag
      const x = tipA[0] + (tipB[0] - tipA[0]) * t, z = tipA[1] + (tipB[1] - tipA[1]) * t;
      return { x, z, y: h - P.ridgeSag * L * Math.sin(Math.PI * t) };
    };
    const NU = 36, NV = 10, pos = [], idx = [];
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU, r = R(u), e = E(u);
      for (let iv = 0; iv <= NV; iv++) {
        const v = iv / NV;
        let x = r.x + (e.x - r.x) * v, z = r.z + (e.z - r.z) * v, y = r.y + (e.y - r.y) * v;
        y -= P.belly * Math.hypot(e.x - r.x, e.z - r.z) * Math.sin(Math.PI * v) * Math.sin(Math.PI * u);
        pos.push(x * MM, y * MM, z * MM);
      }
    }
    for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) {
      const a = iu * (NV + 1) + iv, b = a + NV + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, membrane);
    g.add(mesh);
    body = body || mesh;
    // the red binding, swept along the same edge curve that shaped the fabric
    const trimPts = [];
    for (let i = 0; i <= 48; i++) { const e = E(i / 48); trimPts.push(V3(e.x, e.y, e.z)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trimPts), 96, 4 * MM, 6, false), trimMat));
  }

  // Poles, guys, stakes. The hexa's mains lean a few degrees out along the ridge (hero);
  // the recta's stand plumb, and its corners get their sub-poles.
  const alu = metal(0xc9ccd1, 0.8, 0.35);
  const guyPts = [];
  const stake = (x, z) => { cyl(g, 4, 5, 22, 8, metal(0x3a3d42, 0.4, 0.6), x, 11, z); };
  const pole = (v, top, r, leanDeg) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, top * MM, 12), alu);
    const lean = (leanDeg * Math.PI) / 180 * Math.sign(v[ax] || 1);
    m.position.set(v[0] * MM, top / 2 * MM, v[1] * MM);
    if (ax === 0) m.rotation.z = -lean; else m.rotation.x = lean;
    g.add(m);
  };
  pole(tipA, h, 14, P.lean); pole(tipB, h, 14, P.lean);
  for (const [tip, s] of [[tipA, 1], [tipB, -1]]) {    // each main pole: two guys past the tip
    for (const side of [-1, 1]) {
      const st = [tip[0], tip[1]], out = [0, 0];
      out[ax] = s * 0.55 * h; out[perp] = side * 0.33 * h;
      const sx = st[0] + out[0], sz = st[1] + out[1];
      guyPts.push(V3(tip[0], h, tip[1]), V3(sx, 0, sz));
      stake(sx, sz);
    }
  }
  for (const chain of chains) for (let i = 1; i < chain.length - 1; i++) {
    const c = chain[i], yc = h * P.cornerH;
    if (P.cornerPoles) pole(c, yc, 11, 0);
    const dx = c[0] - (tipA[0] + tipB[0]) / 2, dz = c[1] - (tipA[1] + tipB[1]) / 2;
    const dl = Math.hypot(dx, dz) || 1;
    const sx = c[0] + (dx / dl) * 0.4 * h, sz = c[1] + (dz / dl) * 0.4 * h;
    guyPts.push(V3(c[0], yc, c[1]), V3(sx, 0, sz));
    stake(sx, sz);
  }
  const guyGeo = new THREE.BufferGeometry().setFromPoints(guyPts);
  g.add(new THREE.LineSegments(guyGeo, new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.85 })));

  return { group: g, body };
}

/** Land Lock (TP-671R): the flagship 2-room shell, STANDING. The published 6250x4050x2050
 *  envelope shapes the loft; the manual's frame plan (TP-671R_manual.pdf p.5) names what the
 *  hero photo shows: two A-FRAMES crossing over the body, two C-FRAMES rounding the ends,
 *  one CENTRE ridge frame -- so those five tubes are drawn riding just proud of the fabric,
 *  where their sleeves are. Brown skin, red trim (the door surround and ridge accents), the
 *  darker skirt at grade. Same 0.5 opacity as the tarps, for the same two reasons: the
 *  kitchen lives INSIDE this one, and an opaque 25 square metres would print a shadow-map
 *  blob over half the layout. */
export function landLockGroup(w = 6250, d = 4050, h = 2050, { opacity = 0.5, fabricTex = null } = {}) {
  const g = new THREE.Group();
  const nPlan = 3, L2 = w / 2, W2 = d / 2;
  // The massing is a LOAF with CUT ENDS: a long near-level ridge, walls that stand nearly
  // plumb under a flat crown -- and end caps that are SLOPED FACES, not round domes (the
  // PDP side view shows the rear end as a flattish inclined triangle wearing the door).
  const halfW = x => W2 * Math.pow(Math.max(1e-4, 1 - Math.pow(Math.abs(x / L2), nPlan)), 1 / nPlan);
  const XF = 0.36 * w;                          // where the level body hands over to the cut end
  const hBody = x => h * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / L2), 4.5)), 1 / 1.8);
  const hAt = x => {
    if (Math.abs(x) <= XF) return hBody(x);
    const t = (Math.abs(x) - XF) / (L2 - XF);   // near-linear ramp: the sloped end face
    return hBody(XF) * Math.max(0, 1 - Math.pow(t, 1.12));
  };
  const CS = 2.4;                               // cross-section exponent: plumb-ish walls, flat crown

  // WHAT KEEPS IT FROM READING AS BREAD: tensioned fabric is not a smooth solid. The skin
  // BULGES along every frame sleeve and relaxes between them, so the frame plan prints
  // itself into the surface. Each frame contributes a gaussian ridge (~30mm, sigma ~280mm
  // of plan distance) along its plan line; the pole tubes then ride on top of their own
  // bulges. Plan lines: C-frames at +/-0.42w, the two crossing A-frame diagonals, the
  // centre ridge -- the manual's page-5 drawing, expressed as distance fields.
  const segDist = (px, pz, ax_, az_, bx_, bz_) => {
    const dx = bx_ - ax_, dz = bz_ - az_;
    const t = Math.max(0, Math.min(1, ((px - ax_) * dx + (pz - az_) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - (ax_ + dx * t), pz - (az_ + dz * t));
  };
  const frameLines = [
    (x, z) => segDist(x, z, -0.42 * w, -W2, -0.42 * w, W2),        // C-frame, entrance end
    (x, z) => segDist(x, z, 0.42 * w, -W2, 0.42 * w, W2),          // C-frame, inner-room end
    (x, z) => segDist(x, z, -0.30 * w, 0.94 * W2, 0.30 * w, -0.94 * W2),   // A-frame
    (x, z) => segDist(x, z, -0.30 * w, -0.94 * W2, 0.30 * w, 0.94 * W2),   // its crossing mirror
    (x, z) => segDist(x, z, -0.14 * w, 0, 0.14 * w, 0),            // the centre ridge frame
  ];
  const bumpAt = (x, z) => {
    let b = 0;
    for (const f of frameLines) { const dd = f(x, z); b += 30 * Math.exp(-(dd * dd) / (2 * 280 * 280)); }
    return Math.min(b, 42);
  };
  const skin = (x, v) => {
    const cw = halfW(x), ch = hAt(x), sz = Math.sin(v * Math.PI / 2);
    const z = cw * sz;
    const y0 = ch * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(sz), CS)), 1 / CS);
    const b = bumpAt(x, z) * Math.min(1, y0 / 400);   // fade the bulge out at the skirt
    // push along the local outward direction: up on the crown, out on the walls
    return { x, z: z + b * Math.abs(sz) * Math.sign(sz || 1), y: y0 + b * Math.cos(v * Math.PI / 2) };
  };
  const surfY = (x, z) => {                     // fabric height over a plan point, for the frames
    const cw = halfW(x), t = Math.min(1, Math.abs(z) / cw);
    const y0 = hAt(x) * Math.pow(Math.max(0, 1 - Math.pow(t, CS)), 1 / CS);
    return y0 + bumpAt(x, z) * Math.min(1, y0 / 400) * Math.sqrt(Math.max(0, 1 - t * t));
  };

  // TWO-TONE, per vertex: the identity feature the first passes missed -- an IVORY crown
  // band runs the ridge between the C-frames (bright in every product shot), brown walls
  // and brown end caps. Vertex colours on a white material, so one mesh carries both.
  const IVORY = new THREE.Color(0xa89e8d), BROWN = new THREE.Color(0x5d4c3e);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true,
    map: fabricTex || null,                        // the chairs' canvas weave, caller-supplied
    metalness: 0, roughness: 0.9, side: THREE.DoubleSide,
    transparent: opacity < 1, opacity });
  const smooth = (a, b, t) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
  const NU = 44, NV = 20, pos = [], col = [], uv = [], idx = [];
  const cTmp = new THREE.Color();
  for (let iu = 0; iu <= NU; iu++) {
    const x = -L2 + (w * iu) / NU;
    for (let iv = 0; iv <= NV; iv++) {
      const v = -1 + (2 * iv) / NV;
      const s = skin(x, v);
      pos.push(s.x * MM, s.y * MM, s.z * MM);
      uv.push((iu / NU) * 12, (iv / NV) * 6);   // weave tiling for the caller's canvas map
      // crown -> wall by |v| (a RIDGE BAND, not a white roof), fading out over the end caps
      const wall = Math.max(smooth(0.13, 0.32, Math.abs(v)), smooth(0.84, 0.97, Math.abs(x) / L2));
      cTmp.copy(IVORY).lerp(BROWN, wall);
      col.push(cTmp.r, cTmp.g, cTmp.b);
    }
  }
  for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) {
    const a = iu * (NV + 1) + iv, b = a + NV + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const shell = new THREE.Mesh(geo, skinMat);
  g.add(shell);

  // the skirt: a darker band standing at grade, following the plan outline
  const skirtPos = [], skirtIdx = [];
  const NS = 64;
  for (let i = 0; i <= NS; i++) {
    const th = (2 * Math.PI * i) / NS;
    const x = L2 * Math.sign(Math.cos(th)) * Math.pow(Math.abs(Math.cos(th)), 2 / nPlan);
    const z = W2 * Math.sign(Math.sin(th)) * Math.pow(Math.abs(Math.sin(th)), 2 / nPlan);
    skirtPos.push(x * MM, 0, z * MM, x * MM, 140 * MM, z * MM);
    if (i < NS) { const a = i * 2; skirtIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.setIndex(skirtIdx);
  skirtGeo.computeVertexNormals();
  g.add(new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(0x4a3f36),
    metalness: 0, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })));

  // The frame, riding 20mm proud of the fabric where the sleeves are. Positions from the
  // manual's plan: C-frames arc across near each end, the two A-frames run diagonally and
  // CROSS over the body, the centre frame bridges the crossing points along the ridge.
  const tube = (pts, r, mat) => g.add(new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts), pts.length * 4, r * MM, 8, false), mat));
  // The poles are FACETED: PDP_1's open portal shows the arch as five-odd straight segments
  // meeting at visible joints, not a smooth curve. So frames draw as strut chains.
  const seg = (pts, r, mat) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, a.distanceTo(b) || MM, 10), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
    }
  };
  const alu = metal(0xc9ccd1, 0.8, 0.35);
  const red = metal(0xa8332e, 0.15, 0.6);
  const orange = metal(0xc4682a, 0.1, 0.65);      // the crown sleeve tapes read ORANGE (PDP_2)
  const ride = (x, z, lift = 20) => new THREE.Vector3(x * MM, (surfY(x, z) + lift) * MM, z * MM);
  const arcOver = (xa, za, xb, zb, N = 6) => {    // a faceted pole from ground A over to ground B
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = xa + (xb - xa) * t, z = za + (zb - za) * t;
      const p = ride(x, z);
      if (i === 0 || i === N) p.y = 0;
      pts.push(p);
    }
    return pts;
  };
  for (const s of [-1, 1]) {                      // C-frames: faceted hoops leaning out over the ends
    const xc = s * 0.42 * w, NC = 6, cpts = [];
    for (let i = 0; i <= NC; i++) {
      const t = i / NC;
      const z = halfW(xc) * Math.cos(t * Math.PI) * 0.98;
      const x = xc + Math.sin(t * Math.PI) * 0.07 * w * s;
      const q = ride(x, z, 22);
      if (i === 0 || i === NC) q.y = 0;
      cpts.push(q);
    }
    seg(cpts, 11, alu);
    seg(cpts.slice(2, 5).map(p => p.clone().setY(p.y + 8 * MM)), 5, orange);   // crown tape
  }
  for (const s of [-1, 1]) {                      // A-frames: the crossing diagonals of the plan
    const apts = arcOver(-0.30 * w * s, s * 0.94 * halfW(-0.30 * w * s),
                         0.30 * w * s, s * 0.94 * halfW(0.30 * w * s), 6);
    seg(apts, 11, alu);
    seg(apts.slice(1, 6).map(p => p.clone().setY(p.y + 8 * MM)), 4.5, orange); // its sleeve tape
  }
  seg([ride(-0.14 * w, 0, 26), ride(0, 0, 26), ride(0.14 * w, 0, 26)], 11, alu);   // centre frame
  seg([ride(-0.14 * w, 0, 34), ride(0, 0, 34), ride(0.14 * w, 0, 34)], 5, orange); // its tape

  // Panel seams: tensioned fabric is SEWN, and the stitch lines are what stop 25 square
  // metres reading as one blown-up loaf. Two horizontal seams per side, full length.
  const seamMat = metal(0x57493d, 0.05, 0.9);
  for (const s of [-1, 1]) for (const vlev of [0.30, 0.62]) {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const x = -0.95 * L2 + (1.9 * L2 * i) / 30;
      const p = skin(x, s * vlev);
      pts.push(new THREE.Vector3(p.x * MM, (p.y + 6) * MM, (p.z + 5 * s * vlev) * MM));
    }
    tube(pts, 2.5, seamMat);
  }

  // The door (entrance end's side panel, red-bound) and the big mesh window opposite.
  const patch = (x0, x1, v0, v1, mat, lift = 8) => {
    const P = [], I = [], M = 10, N = 8;
    for (let i = 0; i <= M; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * i) / M, v = v0 + ((v1 - v0) * j) / N;
      const s = skin(x, v);
      P.push(s.x * MM, (s.y + lift * Math.pow(Math.cos(v * Math.PI / 2), 0.5)) * MM,
             (s.z + lift * Math.sin(v * Math.PI / 2)) * MM);
    }
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
      const a = i * (N + 1) + j, b = a + N + 1;
      I.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    pg.setIndex(I); pg.computeVertexNormals();
    g.add(new THREE.Mesh(pg, mat));
  };
  // A rim loop on the skin -- door bindings, window surrounds.
  const rimLoop = (cx, rx, vc, rv, r, mat, lift = 10) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const th = (i / 24) * 2 * Math.PI;
      const s = skin(cx + rx * Math.cos(th), vc + rv * Math.sin(th));
      pts.push(new THREE.Vector3(s.x * MM, (s.y + lift) * MM,
        (s.z + lift * Math.sin((vc) * Math.PI / 2)) * MM));
    }
    tube(pts, r, mat);
  };
  const meshMat = new THREE.MeshStandardMaterial({ color: 0x3f4240, roughness: 0.85,
    side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2723, roughness: 0.85, side: THREE.DoubleSide });
  const tan = metal(0x8d7a67, 0.05, 0.85);

  // The entrance-end door, red-bound (hero, front left), and its small mesh light.
  patch(-0.34 * w, -0.10 * w, 0.42, 0.96, darkMat);
  rimLoop(-0.22 * w, 0.12 * w, 0.69, 0.27, 5, red);
  patch(-0.30 * w, -0.14 * w, 0.48, 0.72, meshMat, 12);
  // The BIG side windows -- PDP_2 shows them filling most of the wall height, wide
  // rounded rectangles. One large each side rear-of-middle, one forward on the far side.
  for (const s of [-1, 1]) {
    patch(0.02 * w, 0.32 * w, s * 0.44, s * 0.92, meshMat);
    rimLoop(0.17 * w, 0.15 * w, s * 0.68, s * 0.22, 4, tan);
    if (s < 0) { patch(-0.32 * w, -0.10 * w, s * 0.46, s * 0.90, meshMat); rimLoop(-0.21 * w, 0.11 * w, s * 0.68, s * 0.20, 4, tan); }
  }
  // Vent hoods capping each end, just under the ridge line.
  for (const s of [-1, 1]) patch(s * 0.40 * w, s * 0.475 * w, -0.30, 0.30, darkMat, 24);

  // Guys at the frame feet, out at the manual's ~45 degrees, and their stakes.
  const guyPts = [], gv = (x, y, z) => new THREE.Vector3(x * MM, y * MM, z * MM);
  for (const [gx, gz] of [[-0.47, 0.3], [-0.47, -0.3], [0.47, 0.3], [0.47, -0.3],
                          [-0.30, 0.98], [-0.30, -0.98], [0.30, 0.98], [0.30, -0.98]]) {
    const ax = gx * w, az = gz * halfW(gx * w);
    const ay = surfY(ax, az) * 0.55;
    const sx = ax + Math.sign(gx) * 0.5 * ay, sz = az + Math.sign(gz) * 0.9 * ay;
    guyPts.push(gv(ax, ay, az), gv(sx, 0, sz));
    cyl(g, 4, 5, 22, 8, metal(0x3a3d42, 0.4, 0.6), sx, 11, sz);
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(guyPts),
    new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.85 })));

  return { group: g, body: shell };
}

// ===========================================================================================
// The smaller hardware -- clamps, poles, screens, cases, rails, rings. None of these is a
// box, and every one of them was being drawn as one (or crashing). These are honest,
// low-detail shapes: enough silhouette to tell a lantern pole from a windscreen from a
// clamp, no invented ornament. All take MILLIMETRES and hang from y = 0.
// ===========================================================================================

/** IGT Stainless Box Hanger (CK-020): not a clamp -- a long bent WIRE bail. The hero and the
 *  in-use shot (JP a001, the CK-025 box hanging at a frame end) agree on the topology: two
 *  small J-hooks curl over the rail, each fixed by a little aluminium joint block (the
 *  レールジョイント金具 of the materials line -- the two loose blocks in the hero), and one wire
 *  drops and runs a full-width U out from the table: the shelf the box hangs its rim in. The
 *  published 340 x 161 x 41 is the whole part -- 340 the span (the hero puts hooks and U
 *  corners on the same line, ~8mm in from each end), 161 the reach, 41 the shallow drop from
 *  hook top to wire. ~5mm wire. Mostly air, so a faint ghost box carries picking, the
 *  meshTrayGroup way. Hooks over the rail at y = 0; rail side -z, the bail reaching +z. */
export function boxHangerGroup(w, d, h, color) {
  const g = new THREE.Group();
  const steel = metal(color, 0.9, 0.25);
  const rw = 2.5;
  const wire = pts => g.add(new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM))),
    pts.length * 8, rw * MM, 6, false), steel));
  const hx = w / 2 - 8, zR = -(d / 2) + 12;         // hook axes / the rail line
  // the two J-hooks, curling over the rail and tailing down its far side
  for (const s of [-1, 1])
    wire([[s * hx, -26, zR + 14], [s * hx, -2, zR + 9], [s * hx, 6, zR],
          [s * hx, -1, zR - 8], [s * hx, -14, zR - 9]]);
  // the bail: ONE wire, hook to hook -- down, kicked out, the full-width U, and back up
  wire([[-hx, -20, zR + 12], [-hx, -h + 3, zR + 42], [-hx, -h, d / 2 - 22],
        [-hx + 14, -h, d / 2 - 4], [hx - 14, -h, d / 2 - 4], [hx, -h, d / 2 - 22],
        [hx, -h + 3, zR + 42], [hx, -20, zR + 12]]);
  // the aluminium joint blocks, one at each hook, on the rail where a001 puts them
  const alu = metal(0xc4c8ca, 0.85, 0.35);
  for (const s of [-1, 1]) box(g, 22, 18, 16, 2, alu, s * (hx - 26), -9, zR + 2);
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06 }),
    0, -h / 2, 0);
  return { group: g, body: ghost };
}

/** TTA Side Tray (CK-304): a 200mm round stainless tray, not a clamp. The hero: a flat disc
 *  with a short rolled edge, and standing in its centre boss the black-sleeved fixing shaft
 *  (the シリコンゴム of the materials line; JP a002 shows the same shaft dropped through the
 *  table-edge clip in use -- the clip is mounting, not the read, and is not modelled).
 *  Measured against the published phi200: boss ~phi36, the capped shaft topping out ~50mm
 *  over the floor. The published h=28 is dish + boss; the shaft is packed loose and stands
 *  past it. Lip at y = 0, dish floor at -8, the post rising above -- the burners' exception,
 *  built in. */
export function sideTrayGroup(w, d, h, color) {
  const g = new THREE.Group();
  const R = Math.min(w, d) / 2;
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
    metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  // the dish, lathed: floor, a rise to the lip, and the lip rolled back under itself
  const prof = [[2, -8], [R - 14, -8], [R - 6, -5], [R - 1.5, -0.5], [R, 0], [R - 3, -2.5]]
    .map(([px, py]) => new THREE.Vector2(px * MM, py * MM));
  const dish = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), steel);
  g.add(dish);
  cyl(g, 18, 18, 22, 24, metal(color, 0.85, 0.3), 0, 3, 0);            // the centre boss
  cyl(g, 5, 5, 18, 12, metal(0xc6cacf, 0.85, 0.3), 0, 22, 0);          // the fixing shaft
  cyl(g, 8, 8, 22, 14, metal(0x17181b, 0.05, 0.75), 0, 32, 0);         // its black sleeve
  return { group: g, body: dish };
}

/** TTA Cylinder Stand (CK-305): a plain straight-walled stainless cup, phi67 x 110 -- the
 *  sleeve a gas cartridge drops into. Nothing else: wall, floor, a thin rolled lip. (The PP
 *  edge bracket of the materials line is the mounting, not the read, and is not modelled.)
 *  Satin, not mirror -- the hero's finish. Rim at y = 0, hanging to -h. */
export function cylinderStandGroup(w, d, h, color) {
  const g = new THREE.Group();
  const R = Math.min(w, d) / 2;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R * MM, R * MM, h * MM, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
      metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
  wall.position.y = -h / 2 * MM;
  g.add(wall);
  cyl(g, R - 1, R - 1, 3, 28, metal(color, 0.6, 0.5), 0, -h + 5, 0);   // the floor, up a step
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R * MM, 1.6 * MM, 8, 36), metal(color, 0.7, 0.4));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -1.6 * MM;
  g.add(lip);
  return { group: g, body: wall };
}
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

/** TTA Lantern Hanger (CK-302): ONE continuous bent line, not a pole with parts bolted on.
 *  What the photos say: the hero silhouette is bottom shaft -> ~45deg dogleg -> long rise ->
 *  the crank folded back down against the pole in a narrow triangle; the in-use JP a001/a002
 *  show the same tube standing in a clamp at the table edge, the dogleg stepping the rise
 *  clear of it, the crank swung out with a pin for the lantern hook. The manual's set line
 *  says why one line comes in two pieces -- クランクシャフト + シャフト, socketed.
 *  Numbers: h=713 is trusted whole. The hero cutout is NOT to scale across -- its stance
 *  measures ~240mm against its own 713 height, twice the published 116, while the in-use
 *  a001 shows an offset of ~7 tube widths (~85mm) -- so the published 116 envelope decides
 *  every x here: dogleg offset, fold, pin. The knees sit at 0.74h/0.86h (45deg over the
 *  offset the envelope allows; the hero puts them in the same lower third). The disc and
 *  black-capped pin ~0.26h down are the crank's hook pin and stop, folded home; the PVC of
 *  the materials line is the grey cap on the bottom tip. Mostly air -> a ghost sliver picks.
 *  Hangs from y = 0 to -h like the rest of the TTA family. */
export function lanternHangerGroup(w, d, h, color) {
  const g = new THREE.Group();
  const steel = metal(color, 0.9, 0.25);
  const r = Math.min(d, 12) / 2;                        // ~12mm stainless tube
  const riseX = -(w / 2) + 28, tipX = w / 2 - r;        // rise axis / bottom-shaft axis
  const kneeB = -0.86 * h, kneeT = kneeB + (tipX - riseX);   // 45deg: rise = run
  const tube = pts => g.add(new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM))),
    pts.length * 10, r * MM, 8, false), steel));
  // the whole part is this one line: tip, shaft, dogleg, rise, and the crank folding back
  tube([[tipX, -h + 8, 0], [tipX, kneeB, 0], [riseX, kneeT, 0], [riseX, -22, 0],
        [riseX - 5, -5, 0], [riseX - 14, -16, 0], [riseX - 19, -0.15 * h, 0],
        [riseX - 22, -0.24 * h, 0]]);
  // the crank's hook pin (black grip) and its stop disc, folded home against the pole
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(3.5 * MM, 3.5 * MM, 40 * MM, 10),
    metalE(0x2a2c30, 0.2, 0.7));
  pin.rotation.z = Math.PI / 2;
  pin.position.set((riseX + 12) * MM, -0.25 * h * MM, 0);
  g.add(pin);
  cyl(g, r + 5, r + 5, 4, 16, steel, riseX, -0.27 * h, 0);
  // the PVC cap on the shaft tip -- the end that drops into the clamp
  cyl(g, r + 1.5, r + 1.5, 18, 12, metalE(0x6d7175, 0.25, 0.65), tipX, -h + 9, 0);
  // a faint ghost sliver: a 6mm tube is no picking target
  const ghost = box(g, w, h, Math.max(d, 30), 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06 }),
    0, -h / 2, 0);
  return { group: g, body: ghost };
}

/** TTA Unit Frame (CK-303): there are no legs. The hero is the part slightly unpacked: a top
 *  U and a bottom U of ~12mm stainless tube with two long side tubes between them, joined by
 *  small ferrule sleeves -- assembled it is ONE flat rounded-rect ring, 333 x 480, that
 *  stands in two TTA Clamp Tools on the table edge ("connect the frame ends into two TTA
 *  Clamp Tools"). d=12 in assembled_mm is the TUBE, not a plan depth -- the old rim-on-legs
 *  read of (w,d,h) is what made it a ladder on stilts. Built VERTICAL in x-y, hanging from
 *  y = 0 like the rest of the TTA family; the four ferrules sit on the side runs where the
 *  hero shows them (just below the top corners, just above the bottom ones). Mostly air ->
 *  a faint ghost box carries picking. */
export function ttaFrameGroup(w, d, h, color) {
  const g = new THREE.Group();
  const steel = metal(color, 0.9, 0.25);
  const r = Math.min(d, 12) / 2;                    // the published d=12 IS the tube
  const R = 35;                                     // corner radius, read off the hero
  const x1 = w / 2 - r, yT = -r, yB = -(h - r);
  const pts = [
    [x1, yB + R, 0], [x1, yT - R, 0], [x1 - R, yT, 0], [-x1 + R, yT, 0],
    [-x1, yT - R, 0], [-x1, yB + R, 0], [-x1 + R, yB, 0], [x1 - R, yB, 0],
  ];
  g.add(new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM)), true),
    96, r * MM, 8, true), steel));
  for (const sx of [-1, 1]) for (const fy of [-0.11 * h, -0.90 * h])   // the ferrule joints
    cyl(g, r * 1.7, r * 1.7, 26, 12, metal(color, 0.85, 0.3), sx * x1, fy, 0);
  const ghost = box(g, w, h, Math.max(d, 26), 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06 }),
    0, -h / 2, 0);
  return { group: g, body: ghost };
}

/** A ring holder (CK-306 Sierra cup holder / DB-005 garbage frame): a flat wire ring. CK-306
 *  hangs off a small horizontal clamp BARREL with a thumb-knob capping its end -- the hero
 *  (web/img/CK-306.jpg) shows the ring's wire running INTO the barrel, no flat tab anywhere --
 *  so `clamp` draws that; DB-005 keeps the plain tab. */
export function ringGroup(w, d, h, color, { clamp = false } = {}) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.85, 0.32);
  const R = Math.min(w, d) / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry((R - 6) * MM, 3 * MM, 10, 28), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -h / 2 * MM;
  g.add(ring);
  if (clamp) {
    // The clamp barrel: φ14 x 22, measured on the hero against the ring OD (~0.125 of it
    // across, ~0.19 long), lying tangent at the back where the ring's wire enters it. The
    // knob is the darker machined end -- the clamp thumbscrew's own steel.
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(7 * MM, 7 * MM, 22 * MM, 14), mat);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(0, -h / 2 * MM, -(R - 4) * MM);
    g.add(barrel);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(4 * MM, 4 * MM, 10 * MM, 12),
      metalE(0x1c1f24, 0.5, 0.5));
    knob.rotation.z = Math.PI / 2;
    knob.position.set(16 * MM, -h / 2 * MM, -(R - 4) * MM);
    g.add(knob);
  } else {
    const tab = new THREE.Mesh(roundedBox(18 * MM, Math.max(h, 10) * MM, 4 * MM, 1 * MM), mat);
    tab.position.set(0, -h / 2 * MM, -(R - 2) * MM);
    g.add(tab);
  }
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
    const railMat = metalE(color, 0.8, 0.42);
    railMat.vertexColors = true;   // same baked seat crease as the frame's rails
    const r = new THREE.Mesh(railProfile(w * MM, thick * MM, prof, s), railMat);
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
 *  is cast (S-029HD and the like; the woven nets are grillNetGroup's). */
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

// ===========================================================================================
// The Takibi Fire & Grill L, and what hangs on it. Not IGT -- a fire pit that stands on the
// ground beside the layout, the way the chairs do. It is in this file for a BILL reason, not a
// scenery one: its cooking surfaces are the CK-160's cooking surfaces (owner, and Snow Peak's own
// cross-listing both ways), so the net and the 鉄板 here and the ones bbqBoxGroup draws are the
// same objects and are drawn in the same language on purpose.
// ===========================================================================================

// How deep the bowl is: rim down to the apex. Snow Peak publishes W455 x D455 x H315 and says
// NOTHING about the taper, so this is MEASURED off the two on-white elevations in the JP gallery
// (SNP0120A0737, a002 and a003). Method, because a number off a photo is worth what its method is
// worth: both images show the near AND far rim tubes, both are the same known 455, and they come out
// different widths in pixels -- which gives the image scale at each depth and the camera's tilt. The
// apex sits halfway between them; solve for its drop.  a002 -> 203mm.  a003 -> 196mm.  200 is the
// middle and +/- 10 is the honest precision.
//
// It then survives two cross-checks it was NOT fitted to:
//   1. At 200 the bowl's square section is 310 exactly 64mm below the rim -- and 炭床Pro.L (ST-032S)
//      is a 310x310 casting that wedges into that section. Its own photo shows it sitting there,
//      high in the bowl, about a third down.
//   2. The legs are riveted at the plate vertex (a002, zoomed: two tubes crossing through a boss).
//      That forces where their feet land (see footRun), and at depth 200 it puts the bottom bends at
//      x = +/-131mm in a003's view. Measured there: -124, +141.
// A number that predicts two things it was not told about is a measurement. It is still not a
// published spec, and if Snow Peak ever prints one, that wins.
const TAKIBI_DEPTH = 200;

// How far the grill bridge's rails clear the rim. THIS IS THE SOFT ONE, and the only soft number
// here. ST-032GBR's legs carry a three-notch ladder and the manual says so (「3段階の高さ調整で、
// 火加減をコントロール」), but Snow Peak publishes only the 175 overall -- the three stage heights are
// nowhere. So ONE height is drawn, scaled off the middle notch, and the planner offers NO stage
// config: three settings we cannot place are worse than one we can see.
const BRIDGE_RISE = 90;

/** 焼アミステンレスハーフ Pro. (S-029HA), close up: an OPEN woven grill net, not a griddle.
 *  The hero is see-through -- a crimped weave running at 45 DEGREES to the frame, ~30
 *  openings across the published 339 (11mm counted along the edge, so the diagonal runs sit
 *  11/SQRT2 apart), inside a straight border rod, a straight foot rod tucked under each long
 *  edge with its ends turned up into the frame. The spec prints both gauges -- フレーム φ5mm、
 *  ネット φ2.5mm -- so nothing here is styled. surfaceInto and bbqBoxGroup draw this same net
 *  at planner distance, where density is the read and the 45 is not; this is the bench's
 *  close-up. Mostly air, so a faint ghost box carries picking (meshTrayGroup's trick).
 *  Net top at y = 0, feet reaching -h. */
export function grillNetGroup(w, d, h, color) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.9, 0.25);
  // The border: the φ5 frame rod, top face on the y = 0 datum.
  for (const sz of [-1, 1]) box(g, w, 5, 5, 2, mat, 0, -2.5, sz * (d / 2 - 2.5));
  for (const sx of [-1, 1]) box(g, 5, 5, d - 10, 2, mat, sx * (w / 2 - 2.5), -2.5, 0);
  // The weave: two families of φ2.5 runs at +/-45, clipped to the border. Each run is the
  // chord of x - s*z = c across the inner rectangle; stepping c by 11 puts the crossings
  // 11mm apart along the edge, which is what the hero counts out. The families stack a hair
  // apart in y, which is all a weave is at this scale.
  const hw = w / 2 - 5, hd = d / 2 - 5, step = 11;
  for (const s of [1, -1]) {
    const y = s > 0 ? -1.8 : -3.2;
    for (let c = Math.ceil((-hw - hd) / step) * step; c <= hw + hd; c += step) {
      const x0 = Math.max(-hw, c - hd), x1 = Math.min(hw, c + hd);
      if (x1 - x0 < 6) continue;                 // a corner stub -- not worth a mesh
      const cx = (x0 + x1) / 2, cz = s * (cx - c);
      box(g, (x1 - x0) * Math.SQRT2, 2.2, 2.5, 1, mat, cx, y, cz, -s * Math.PI / 4);
    }
  }
  // The feet: a φ5 rod under each LONG edge, inset like the hero's, its ends rising back
  // into the frame; they are what the published 18 measures.
  for (const sz of [-1, 1]) {
    const fz = sz * (d / 2 - 16);
    box(g, w - 56, 5, 5, 2, mat, 0, -(h - 2.5), fz);
    for (const sx of [-1, 1]) cyl(g, 2.5, 2.5, h - 5, 10, mat, sx * (w / 2 - 30), -h / 2, fz);
  }
  // The ghost pick box: the part is mostly air, and this is what the caller tags.
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06 }),
    0, -h / 2, 0);
  return { group: g, body: ghost };
}

/** A cooking surface laid on the bridge's rails at `y`. These are the SAME objects bbqBoxGroup lays
 *  on the CK-160's lift frame -- that is the literal finding, so they are drawn the same way. Each
 *  at its own published size:
 *    net     ST-032MAR  焼アミPro.L         484 x 352 x 19   stainless
 *    plate   GR-006     グリルプレート黒皮鉄板  500 x 330 x 35   2.5mm black steel
 *    halves  S-029HA x2 焼アミハーフ Pro.     339 x 206 x 18   two side by side */
function surfaceInto(g, kind, y) {
  const netMat = metal(0xd0d4d9, 0.92, 0.24), plateMat = metal(0x33373d, 0.42, 0.55);
  const net = (nw, nd, cx) => {
    // 11mm pitch, φ2.5 wire -- the S-029HA hero counts ~30 openings across its published 339
    // and its spec prints the gauge (ネット／ステンレス φ2.5mm); same weave on the Pro.L. The
    // old 22 drew an oven rack. (The real weave runs diagonal -- grillNetGroup draws that for
    // the bench close-up; at planner distance the density is the read, not the angle.)
    const rim = 6, pitch = 11;
    for (const sz of [-1, 1]) box(g, nw, 4, rim, 1, netMat, cx, y - 2, sz * (nd / 2 - rim / 2));
    for (const sx of [-1, 1]) box(g, rim, 4, nd, 1, netMat, cx + sx * (nw / 2 - rim / 2), y - 2, 0);
    const iw = nw - 2 * rim, id = nd - 2 * rim;
    const nx = Math.round(iw / pitch), nz = Math.round(id / pitch);
    for (let j = 1; j < nx; j++) box(g, 2.5, 2, id, 0, netMat, cx - iw / 2 + (j * iw) / nx, y - 1.5, 0);
    for (let j = 1; j < nz; j++) box(g, iw, 2, 2.5, 0, netMat, cx, y - 3.5, -id / 2 + (j * id) / nz);
  };
  if (kind === "net") return net(484, 352, 0);
  if (kind === "halves") { net(339, 206, -106); net(339, 206, 106); return; }
  if (kind === "plate") {
    box(g, 500, 8, 330, 1.5, plateMat, 0, y - 4, 0);
    for (const sz of [-1, 1]) box(g, 500, 27, 4, 1, plateMat, 0, y + 9.5, sz * 163);
    for (const sx of [-1, 1]) box(g, 4, 27, 330, 1, plateMat, sx * 248, y + 9.5, 0);
  }
}

/** 炭床Pro.L (ST-032S), dropped into a group at `y`. A 310x310x20 cast-iron GRATE, not a tray: its
 *  photo is a dense field of parallel slots interrupted by a raised rectangular boss with the logo
 *  on it, and four little feet underneath (the JP copy says so -- 裏には4個の小さな脚 -- which is why
 *  it doubles as a trivet). It reads DARK: clear-coated cast iron, not the stainless of the bowl. */
function coalBedInto(g, bed, y) {
  const iron = metal(0x3a3632, 0.3, 0.68);
  const barW = 7, gap = 6, pitch = barW + gap;
  const n = Math.floor((bed - 24) / pitch);
  for (const sx of [-1, 1]) box(g, 12, 20, bed, 1, iron, sx * (bed / 2 - 6), y - 10, 0);
  for (const sz of [-1, 1]) box(g, bed, 20, 12, 1, iron, 0, y - 10, sz * (bed / 2 - 6));
  for (let i = 0; i < n; i++)                       // the slot field
    box(g, barW, 14, bed - 24, 0.5, iron, -((n - 1) * pitch) / 2 + i * pitch, y - 7, 0);
  box(g, 132, 16, 82, 1, iron, 0, y - 6, 0);        // the raised logo boss, mid-plate
  for (const sx of [-1, 1]) for (const sz of [-1, 1])   // the four feet, under it
    box(g, 14, 10, 14, 1, iron, sx * (bed / 2 - 26), y - 25, sz * (bed / 2 - 26));
}

/** 焚火台グリルブリッジL (ST-032GBR): two flat stainless RAILS on four folding straps whose inward
 *  lugs hook over the Takibi L's rim. Its manual is unusually blunt about what it is, under 警告:
 *  「本製品は焚火台Lにセットした場合にのみ安定する構造です。単品で自立させてものを置くと転倒事故の
 *  原因になりますので、必ず焚火台Lにセットした状態でご使用ください」-- only stable ON the Takibi L.
 *  That is why the planner never places it: a part that tips over if you set it down is not a part
 *  with a position.
 *
 *  445 x 440 x 175 packing to x28 -- so 175 is the legs DOWN and 28 is them folded. The straps carry
 *  a three-notch ladder and it is drawn, because you can see it; WHICH notch is engaged is not
 *  offered, because the three heights are not published (see BRIDGE_RISE).
 *
 *  Rails at y = 0 -- its working top is where the food goes -- body hanging to -h. */
export function grillBridgeGroup(w, d, h, { color = 0xb9bec4, surface = null } = {}) {
  const g = new THREE.Group();
  const mat = metal(color, 0.85, 0.32);
  const railH = 26, railT = 9, strapW = 20, strapT = 3;
  const legLen = h - railH;

  // The two rails. They run the 445 and sit at the 440's edges: that is the span the surfaces are
  // cut to -- 484 and 500 both OVERHANG this frame, which is how they bear on it.
  let body = null;
  for (const sz of [-1, 1]) {
    const r = box(g, w, railH, railT, 1.5, mat, 0, -railH / 2, sz * (d / 2 - railT / 2));
    if (!body) body = r;
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - strapW / 2), z = sz * (d / 2 - railT / 2);
    box(g, strapW, legLen, strapT, 1, mat, x, -railH - legLen / 2, z);
    box(g, strapW * 0.6, strapT, d * 0.34, 1, mat, x, -railH - 14, z - sz * d * 0.19);
    for (let i = 0; i < 3; i++)                  // the ladder: three lugs, the rim sits on one
      box(g, 9, 4, strapT + 3, 0.8, mat, x - sx * (strapW / 2 - 4), -railH - 46 - i * 26, z);
  }
  if (surface) surfaceInto(g, surface, 2);
  return { group: g, body };
}

/** Takibi Fire & Grill L (ST-032RS; JP 焚火台L, US "Pack & Carry L Fireplace"): four stainless
 *  TRIANGLES on a folding tube X. It is a true inverted PYRAMID -- the plates run to a point. Not a
 *  box, and not a truncated pyramid: the manual's セット内容 line drawing, the studio shot and the
 *  elevations all show the same four triangles converging on one vertex.
 *
 *    本体      four identical triangular plates. Each plate's BASE is one whole side of the 455 rim;
 *              each plate's APEX is the bowl's single bottom vertex.
 *    ヒンジ     adjacent plates are hinged along their slant edges -- which is why the four collapse
 *              to a 32mm pack, and why the slant edges are drawn TWICE below: each plate carries its
 *              own tube and the two lie side by side at the seam.
 *    縁        a rolled tube around each plate's WHOLE perimeter. What reads as "the rim" is four of
 *              those tube bases meeting.
 *    穴        five holes per plate in a line under the rim: the primary air. Counted (5) and scaled
 *              (~50mm pitch) off two elevations that agree; the diameter is the weakest of the three
 *              and is drawn at 8, not claimed.
 *    脚        two tube loops crossing at the apex and splaying to the ground.
 *
 *  All three published numbers get used and none get invented: 455 is the rim square, 315 is
 *  rim-to-ground, and the bowl is TAKIBI_DEPTH deep -- so the apex lands at 315-200 = 115 above the
 *  ground and the legs make up the rest.
 *
 *  Feet at y = 0, rim at y = h -- built the way a prop is built, because a fire pit stands on the
 *  ground and does not hang from a rail. `d` is unused: the rim is square and `w` says so. */
export function takibiGroup(w, d, h, { steel = 0x9aa0a8, depth = TAKIBI_DEPTH, bridge = false,
                                       surface = null, coalBed = false, basePlate = false } = {}) {
  const g = new THREE.Group();
  const half = w / 2;                          // 227.5 -- the rim square's half side
  const slant = Math.hypot(depth, half);       // 303 -- base to apex, DOWN the plate
  const tilt = Math.atan2(half, depth);        // the plate's lean off vertical
  const apexY = h - depth;                     // 115
  const plateT = 1.6, tubeR = 5;

  const shell = metal(steel, 0.72, 0.38);      // the plates: brushed, not mirror
  const tubeMat = metal(0xb6bcc2, 0.88, 0.28); // the rolled edge tube: brighter than the plate
  const punch = metalE(0x0e0f12, 0.2, 0.8);    // a hole, punched dark -- frameGroup's trick

  const tube = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };

  // ONE plate geometry, four plates -- this file's whole point. Built in its own plane with the base
  // on the x-axis and the apex hanging at -slant, then leaned and swung into place.
  const s = new THREE.Shape();
  s.moveTo(-half * MM, 0); s.lineTo(half * MM, 0); s.lineTo(0, -slant * MM); s.closePath();
  const plateGeo = new THREE.ExtrudeGeometry(s, { depth: plateT * MM, bevelEnabled: false });
  plateGeo.translate(0, 0, -plateT * MM / 2);

  let body = null;
  for (let k = 0; k < 4; k++) {
    const rot = (k * Math.PI) / 2;
    const side = new THREE.Group();
    side.rotation.y = rot;
    // Lean the plate INWARD: its local -Y must run base -> apex, i.e. down by `depth` and in by
    // `half`, from z = +half to z = 0. Rotating about X by +tilt sends local (0,-1,0) to
    // (0, -cos tilt, -sin tilt) -- exactly that. (It was -tilt, which sends the apex to z = +2*half:
    // the plates splayed OUTWARD to a mouth 455 wide instead of closing to a point, while the edge
    // tubes -- drawn straight to the apex -- closed correctly. The owner caught the contradiction.)
    const plate = new THREE.Mesh(plateGeo, shell);
    plate.rotation.x = tilt;
    plate.position.set(0, h * MM, half * MM);
    side.add(plate);
    if (!body) body = plate;                   // the caller tags ONE mesh; the first plate is it

    // Five air holes, in a line parallel to the base. `t` walks down the plate, so the line follows
    // the lean instead of floating off it.
    const t = 34 / slant, hy = h - depth * t, hz = half * (1 - t);
    for (let i = -2; i <= 2; i++) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(4 * MM, 4 * MM, (plateT + 1) * MM, 10), punch);
      hole.rotation.x = Math.PI / 2 - tilt;    // stand the hole normal to the leaning plate
      hole.position.set(i * 50 * MM, hy * MM, hz * MM);
      side.add(hole);
    }
    g.add(side);

    // This plate's rolled edge: base, then both slant edges down to the apex. Every plate draws its
    // own, so the seams come out double -- which is what the hinge photo shows.
    const c = Math.cos(rot), sn = Math.sin(rot);
    const at = (x, y, z) => [x * c + z * sn, y, -x * sn + z * c];
    const A = at(-half, h, half), B = at(half, h, half), P = [0, apexY, 0];
    tube(A, B, tubeR, tubeMat);
    tube(A, P, tubeR, tubeMat);
    tube(B, P, tubeR, tubeMat);
  }

  // The legs. Two loops, each a flat-bottomed U in a vertical plane through one DIAGONAL of the rim
  // -- the only arrangement that gives all three things the photos show at once: a tube end at each
  // rim corner, the two loops crossing at the apex, four bends on the ground.
  //
  // footRun is DERIVED, not eyeballed. The limbs are straight and riveted at the apex (a002's apex is
  // a boss with both tubes through it), so a limb is the line from a rim corner through the apex,
  // extended to the floor -- and where it lands is forced. Nothing here is chosen: if TAKIBI_DEPTH is
  // ever corrected, the feet move with it, correctly.
  const u0 = half * Math.SQRT2;
  const footRun = (u0 * (h - depth)) / depth;
  const legMat = metal(0xc2c7cc, 0.86, 0.3);
  for (const sd of [1, -1]) {
    const ux = sd / Math.SQRT2, uz = 1 / Math.SQRT2;   // the two diagonals
    const C1 = [u0 * ux, h, u0 * uz], C2 = [-u0 * ux, h, -u0 * uz];
    const K1 = [-footRun * ux, 0, -footRun * uz], K2 = [footRun * ux, 0, footRun * uz];
    tube(C1, K1, 4.5, legMat);   // down from one corner, through the apex, out to the far foot
    tube(K1, K2, 4.5, legMat);   // the flat bottom of the U -- the foot itself
    tube(K2, C2, 4.5, legMat);   // and back up to the opposite corner
  }

  // 炭床Pro.L: a 310x310 casting that wedges where the taper is 310. Its height is not a placement
  // choice, it is a consequence -- solve the taper for 310.
  if (coalBed) {
    const bed = 310, drop = depth * (1 - bed / w);
    coalBedInto(g, bed, h - drop);
  }
  // ベースプレートL: 450x450x9 of black steel, flat on the floor under all of it.
  if (basePlate) box(g, 450, 9, 450, 2, metal(0x2a2c2f, 0.35, 0.65), 0, 4.5, 0);
  // グリルブリッジL + whatever is laid on it.
  if (bridge) {
    const b = grillBridgeGroup(445, 440, 175, { surface });
    b.group.position.y = (h + BRIDGE_RISE) * MM;
    g.add(b.group);
  }
  return { group: g, body };
}

// ---------------------------------------------------------------- GS-1000  ギガパワー LIストーブ 剛炎
//
// The one stove that STANDS IN a fire ring instead of sitting in a bay. Its whole size comes off its
// own spec table -- data/manuals/GS-1000.pdf p1, 仕様 -- which is a scan with no text layer, so the
// page was rendered and read rather than parsed:
//
//     外形寸法   使用時 φ350×h420mm     収納時 φ240×H205mm
//     重量      1,800g                 使用鍋径 φ31cm以下
//
// Three numbers pin this model, and the good part is that they AGREE with each other:
//   * the FEET reach φ350 -- 使用時 is the widest thing on the stove, and that is the legs;
//   * the BODY is φ240 -- fold the legs in and the wind screen is what is left over: 収納時;
//   * the GOTOKU reach ~φ300 -- they must carry a φ310 pot and nothing wider.
// φ350 > φ300 > φ240 falls straight out of the published spec; nothing here is chosen. The HEIGHTS
// inside that envelope are read off the manual's 各部の名称 drawing and are NOT published -- they are
// the assumed part of this part, and understanding.json says so.
//
// "LI" is LIQUID INJECTION, and it is why the thing looks like this: the canister mounts UPSIDE DOWN
// beneath the burner (「容器を逆さまにして容器底部の淵(凸)を容器取付け溝(2箇所)にはめ込み」), hanging
// inside the cage the four legs make. But the canister is NOT part of the product -- it is 専用容器,
// bought separately (GP-250S / GP-500S / GP-500BL), and the 1,800g does not include it. So it is a
// TOGGLE, exactly like the Takibi's bridge and coal bed, not something the stove is drawn wearing.
// Its size is unmeasured -- no OD can is in the catalog -- so it is proportioned off the drawing
// against the known φ240 body, and it is the least trustworthy thing in here.
export const GS1000 = { span: 350, body: 240, gotoku: 300, h: 420 };

export function gs1000Group(w = GS1000.span, d = GS1000.span, h = GS1000.h, { canister = false } = {}) {
  const g = new THREE.Group();
  const steel = 0x9aa0a8, alu = 0xb4b9bf, dark = 0x30343a, brass = 0x9c6b3a, foot = 0x71767d;
  const shell = metal(steel, 0.8, 0.36), bright = metal(alu, 0.88, 0.28);
  const punch = metalE(0x0e0f12, 0.2, 0.8);        // a hole, punched dark -- frameGroup's trick

  // 使用時 φ350 is an OUTER ENVELOPE, so it is the OUTSIDE of the rubber foot that lands on it, not
  // the foot's centre. Putting the toe at 175 pushed a 13mm-radius foot out to 188 and built a 376mm
  // stove -- 26mm over the one number that is published, and invisible to the eye. Measure the build.
  const footR = 13, R = w / 2, toeR = R - footR;   // 175 published; toes at 162 so the feet reach it
  const bodyR = GS1000.body / 2;                   // 120 -- PUBLISHED, via 収納時 φ240.
  const gotokuR = GS1000.gotoku / 2;               // 150 -- from 使用鍋径 φ31cm以下.
  // h = 420 is the OVERALL height, and it is the GOTOKU that reach it: they are what a pot sits on,
  // and the wind screen stands below them shielding the flame. So the teeth top out AT h and every
  // other height hangs down from there. Sitting the arms on top of the rim instead put the teeth at
  // 427 -- 7mm outside the one number on this part that is published.
  // Everything from here down is read off the manual's 各部の名称 drawing and is NOT published.
  const teethTop = h, armTop = h - 10, rimY = h - 12;
  const bowlH = 86, floorY = rimY - bowlH;
  const hubR = 52, hubY = floorY - 38;

  const tube = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };

  // ---- the wind screen: an open bowl, φ240, ported all round. The drawing shows two rows of ovals.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyR * MM, (bodyR - 6) * MM, bowlH * MM, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(steel), metalness: 0.8, roughness: 0.36,
                                     side: THREE.DoubleSide }),
  );
  wall.position.y = (floorY + bowlH / 2) * MM;
  g.add(wall);
  const body = wall;
  // The rolled top rim -- a TORUS, because `cyl` makes a capped cylinder and a capped cylinder here
  // is a LID: it sealed the bowl over with a solid disc and the burner head vanished behind it. A
  // rolled edge is a ring, and a ring is the one thing a cylinder cannot be.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(bodyR * MM, 3.5 * MM, 8, 48), bright);
  rim.rotation.x = Math.PI / 2; rim.position.y = (rimY - 3.5) * MM;
  g.add(rim);
  cyl(g, bodyR - 6, bodyR - 6, 4, 40, metal(dark, 0.5, 0.5), 0, floorY + 2, 0);   // the bowl floor
  // The ports. A punched dark disc only READS as a hole while it stays flush and small: at r=7,
  // 8 long and 16-per-row these stood 4mm proud and covered half the band, so the wind screen came
  // out a ring of black studs with slivers of steel between -- the wall looked unlit, and it was
  // just buried. Small, barely proud, and with gaps is what makes a hole a hole.
  // Orientation, the part that is easy to get backwards: a cylinder's axis is local +y, so after
  // rotation.z = PI/2 it is local X that stands up in the world -- scale THAT to make the oval tall.
  // Scaling local z (the intuitive guess) lays it on its side, which is what the drawing does not show.
  for (let row = 0; row < 2; row++) {
    const hy = floorY + 26 + row * 32;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (row ? Math.PI / 14 : 0);
      const o = new THREE.Mesh(new THREE.CylinderGeometry(5 * MM, 5 * MM, 5 * MM, 10), punch);
      o.scale.set(1.8, 1, 1);                       // a TALL oval port -- local x is the vertical one
      o.rotation.z = Math.PI / 2; o.rotation.y = -a;
      o.position.set(Math.cos(a) * bodyR * MM, hy * MM, Math.sin(a) * bodyR * MM);
      g.add(o);
    }
  }

  // ---- the burner head: a ported disc on a brass centre, down on the bowl floor
  cyl(g, 74, 74, 12, 32, metal(0x4c5259, 0.5, 0.55), 0, floorY + 10, 0);
  cyl(g, 30, 30, 8, 24, metal(brass, 0.75, 0.4), 0, floorY + 17, 0);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    cyl(g, 3, 3, 6, 8, punch, Math.cos(a) * 55, floorY + 16, Math.sin(a) * 55);
  }

  // ---- 回転式ゴトク: four arms out to φ300, serrated on top. They ROTATE to meet the pot, so they
  // sit at 45deg to the legs -- which is also the only way they read as separate at this size.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    box(g, gotokuR - 40, 5, 16, 1, bright,
        Math.cos(a) * (gotokuR + 40) / 2, armTop - 2.5, Math.sin(a) * (gotokuR + 40) / 2, -a);
    for (let t = 0; t < 4; t++) {                   // the teeth a pot settles down between
      const rr = 70 + t * 22;
      box(g, 5, 7, 14, 0.5, bright, Math.cos(a) * rr, teethTop - 3.5, Math.sin(a) * rr, -a);
    }
  }

  // ---- under-body: the cone down off the bowl, then the hub the legs and the spindle hang from
  cyl(g, bodyR - 8, hubR + 8, floorY - hubY, 28, shell, 0, (floorY + hubY) / 2, 0);
  cyl(g, hubR, hubR, 22, 20, metal(dark, 0.6, 0.45), 0, hubY - 4, 0);
  cyl(g, 7, 7, 34, 10, bright, 0, hubY - 24, 0);                        // スピンドル, down the middle

  // ---- the four legs. 脚A x2 and 脚B x2 -- named apart because they fold opposite ways, but the
  // same tube. An upper leg off the hub, a lower one telescoping inside it with the row of holes the
  // 脚長さ調節ボタン drops into, and a rubber foot on the ground.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const cs = Math.cos(a), sn = Math.sin(a);
    const top = [cs * hubR, hubY, sn * hubR];
    const knee = [cs * (hubR + (toeR - hubR) * 0.46), hubY * 0.54, sn * (hubR + (toeR - hubR) * 0.46)];
    const toe = [cs * toeR, 28, sn * toeR];
    tube(top, knee, 8, shell);                       // upper: the fat section, off the hub bracket
    tube(knee, toe, 6.5, bright);                    // lower: slides inside it
    box(g, 26, 20, 12, 2, shell, cs * (hubR + 16), hubY + 6, sn * (hubR + 16), -a);   // hub bracket
    for (let k = 0; k < 6; k++) {                    // 脚長さ調節 holes, up the lower leg
      const t = 0.16 + k * 0.13;
      cyl(g, 2.2, 2.2, 16, 8, punch,
          knee[0] + (toe[0] - knee[0]) * t, knee[1] + (toe[1] - knee[1]) * t,
          knee[2] + (toe[2] - knee[2]) * t, Math.PI / 2);
    }
    cyl(g, 11, footR, 30, 14, metal(foot, 0.25, 0.75), cs * toeR, 15, sn * toeR);   // the rubber foot,
                                                          // sat ON the ground: centre 15 = half of 30
  }

  // ---- 器具栓 (火力調整ツマミ) -- the flame knob, out on its stalk where a hand reaches it
  tube([0, hubY - 10, 0], [0, hubY - 10, hubR + 54], 5, bright);
  cyl(g, 13, 13, 20, 16, metal(0x1c1f24, 0.4, 0.6), 0, hubY - 10, hubR + 66, Math.PI / 2);

  // ---- 専用容器, INVERTED: not part of the stove, so only when asked for. Proportioned off the
  // drawing against the known φ240 body -- the one thing in here with no number behind it.
  if (canister) {
    const canR = 54, canH = 112, canTop = hubY - 30;
    cyl(g, canR, canR, canH, 24, metal(0xc8ccd0, 0.7, 0.4), 0, canTop - canH / 2, 0);
    cyl(g, canR - 8, canR, 14, 24, metal(0xc8ccd0, 0.7, 0.4), 0, canTop - canH - 6, 0);  // the domed BASE, now down
    cyl(g, 18, 18, 12, 16, metal(dark, 0.5, 0.5), 0, canTop + 5, 0);                     // the valve, now up
  }

  return { group: g, body };
}

// ---------------------------------------------------------------- WHICH builder a part uses
//
// The shapes moved into this file long ago; the CHOOSING did not. `PROP_BUILDERS` stayed behind in
// app.js, so the part bench -- the tool this project built to check exactly this -- never got the
// memo: it fell through to moduleGroup's catch-all, which never says "I don't know this part", it
// just draws something. A GS-1000 came out a flat burner disc. A folding chair came out a storage
// box. 39 of 139 parts, every one of them wrong, right next to the text describing the right one.
//
// That is the bug the header of this file is about, one level up: not two sources of truth for a
// SHAPE, but two for WHICH SHAPE. So the dispatch lives here now, and both renderers call it.
//
// Textures are the caller's business (the planner and the bench have their own loaders and caches),
// so they come in as thunks rather than being loaded here -- this file stays state-free.
export const PROP_BUILDERS = {
  folding: foldingChairGroup, lowbeach: lowBeachChairGroup, sofa: campfieldSofaGroup,
  cushion: loungeCushionGroup, bench: foldingBenchGroup, shelf: bambooShelfGroup,
  take: takeChairGroup, takibi: takibiGroup, gs1000: gs1000Group, cooler: coolerGroup,
};

/** A free-standing part -- a chair, a fire pit, a stove -- from its catalog record.
 *  `cfg` is the per-NODE state (a Takibi's bridge, a cushion's fold); the bench passes none and
 *  gets the part as it comes. `tex` supplies {canvas, mesh, wood} thunks; omit for flat colour. */
export function propGroup(p, cfg = {}, tex = {}) {
  const a = p.assembled_mm || { w: 500, d: 500, h: 800 };
  const which = p.prop || p.chair;
  const build = PROP_BUILDERS[which] || foldingChairGroup;
  const isMeshFabric = p.fabric_type === "mesh";
  return build(a.w, a.d, a.h, {
    frame: Number(p.frame_hex) || 0x232528,
    fabric: Number(p.fabric_hex) || 0x8c8279,
    wood: Number(p.wood_hex) || 0xd8bd86,
    seatH: p.seat_h_mm || 400,
    canvasTex: isMeshFabric ? null : (tex.canvas ? tex.canvas() : null),
    meshAlpha: isMeshFabric ? (tex.mesh ? tex.mesh() : null) : null,
    woodTex: which === "shelf" && tex.wood ? tex.wood() : null,
    depth: p.bowl_depth_mm || undefined,
    ...cfg,
  });
}

// ---------------------------------------------------------------- shelter outlines
// A tent/tarp footprint is a SHAPE, so it belongs beside the other shapes rather than in the
// planner -- the bench could not draw one either, for the same reason as the props.
//
// The catalog gives either an explicit {kind:"polygon", vertices:[[x,y],...]} or a named primitive
// expanded here, so it can say "hexagon 5700x4200 waist 1800" instead of listing six points. All mm,
// centred; +y = front (door / ridge), which the caller maps to scene +z.
export const SHELTER_FILL = { tent: 0x5b8dd6, shell: 0x57b894, tarp: 0xd6a24e };
export function shelterVerts(g) {
  if (!g) return [[-500, -500], [500, -500], [500, 500], [-500, 500]];
  switch (g.kind) {
    case "polygon": return g.vertices;
    case "rectangle": { const w = g.w / 2, d = g.d / 2; return [[-w, -d], [w, -d], [w, d], [-w, d]]; }
    case "hexagon": {  // elongated hexagon: two tips on the long (front-back) axis, a waist band across
      const L = g.length / 2, W = g.width / 2, waist = (g.waist ?? g.length * 0.3) / 2;
      return [[0, L], [W, waist], [W, -waist], [0, -L], [-W, -waist], [-W, waist]];
    }
    case "pentagon": {  // a "house": rectangle back + triangular front peak
      const w = g.width / 2, d = g.length / 2, apex = g.apex ?? g.length * 0.34;
      return [[-w, -d], [w, -d], [w, d - apex], [0, d], [-w, d - apex]];
    }
    case "octagon": {   // rectangle with the four corners cut
      const w = g.width / 2, d = g.length / 2, c = g.chamfer ?? Math.min(g.width, g.length) * 0.29;
      return [[-w + c, -d], [w - c, -d], [w, -d + c], [w, d - c], [w - c, d], [-w + c, d], [-w, d - c], [-w, -d + c]];
    }
    case "oval": {
      const w = g.w / 2, d = g.d / 2, N = 44, out = [];
      for (let i = 0; i < N; i++) { const t = i / N * Math.PI * 2; out.push([Math.cos(t) * w, Math.sin(t) * d]); }
      return out;
    }
    default: { const w = (g.w || 1000) / 2, d = (g.d || 1000) / 2; return [[-w, -d], [w, -d], [w, d], [-w, d]]; }
  }
}
export function shelterBBox(verts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of verts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { w: x1 - x0, d: y1 - y0 };
}

/** The footprint for a shelter part, straight from its catalog record. */
export function shelterOf(p, sku = null) {
  const verts = shelterVerts(p.geometry);
  const b = shelterBBox(verts);
  return shelterFootprint(verts, {
    fill: SHELTER_FILL[p.shelter_type] || 0x8a8f97,
    label: p.title_en || sku || p.sku,
    sub: `${(b.w / 1000).toFixed(2)} x ${(b.d / 1000).toFixed(2)} m`,
  });
}
