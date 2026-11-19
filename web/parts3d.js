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
import { BURNERS, burnerOf, BBQ_SURFACE_SKUS, shelterVerts, shelterBBox, GROUND_HIP } from "./partsdata.js";
export { BURNERS, burnerOf, BBQ_SURFACE_SKUS, shelterVerts, shelterBBox };

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
  const geo = new THREE.ExtrudeGeometry(s, { depth: depth * MM, bevelEnabled: false });
  // An extrusion's UVs are its own metres, which lays the canvas weave (and the mesh's holes)
  // 10-12 mm coarse: polka dots from a metre off. Scaled to a 2 mm weave, which is what both are.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 6);
  return geo;
}

/** A sling panel: cloth spanning `span` between two rails, bellied `sag` mm at mid-span (a
 *  negative sag bows it the other way -- a chair back bulging away from the sitter), `depth`
 *  along the rails. With `lip`, the cloth rides the crest of an r10 end rail at each side and
 *  hangs a short hem outside it (no builder asks for it now: the folding bench's cloth is sleeved
 *  on its rails and draws its own profile).
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
  // A hook-on RECTANGLE (CK-116/117, TR and Light): the published box, its corners and its two
  // bracket notches, from millimetres. Its traced ring hung each long edge on two or three scan
  // rows (7-10 mm of slant over a 400-600 mm edge) and read a white bracket plate as a hole.
  if (t.legs_mm?.length && t.hooks_mm?.length)
    return boardFromOutline(hookRectOutline(w, d, t), thickMM * MM);
  if (t.outline_mm) return boardFromOutline(t.outline_mm, thickMM * MM);   // bamboo, edge notch
  return flatRect(w * MM, d * MM, thickMM * MM, 6 * MM);
}

// ---- the hook-on bamboo boards: CK-116/117 (TR and Light), corners CK-118/119, angle CK-218/219 ----

/** The ironmongery of a hook-on board, in millimetres. ONE bracket casting is on all eight boards:
 *  rectified out of the eight plan photographs, sixteen brackets agree to about a millimetre (the
 *  two Light boards' JP a001 shots are the sharpest, 0.75 mm/px).
 *
 *    bracket   a 62 x 59.5 plate lying ON the bamboo, 18.5 mm back from the board's edge, its leg
 *              hole 49.5 mm in (48.0-50.1 measured). In front of it the board is NOTCHED, 70 long x
 *              20 deep, and in the notch sits the edge bar of the casting under the board: 12 mm
 *              wide, two holes in its top 12.5 mm in from the edge line and 35.6 apart.
 *    sockets   those holes are what the NEXT board hooks into, and it uses the inner one of each
 *              bracket: leg holes 325.8 apart less 35.6 is 290.2, and every board's two hooks are
 *              288-292 apart.
 *    hook      a 6 mm stainless wire from under the board, up across the edge, out and straight
 *              down. Its outer face is 25.1-28.8 mm outside the edge in plan (sixteen hooks, mean
 *              27.0), so the down leg's centre is 24 mm out; CK-218's JP a009 close-up has the leg
 *              ending about eight wire diameters below the top of the bend.
 *    corners   a rectangle's four corners are 15-20 mm radii (CK-117TL a001 against a 10 mm grid).
 *
 *  The envelope is the published 25 mm: bamboo (14 mm, or 9 on a Light board -- see board_mm in
 *  the catalogue) plus the casting under each bracket. core.js places a hooked board with the
 *  same two numbers (SOCKET_OUT = legIn - socketIn). */
export const HOOK_BOARD = Object.freeze({
  legIn: 49.5, plateL: 62, plateW: 59.5, plateT: 2,
  notchL: 70, notchD: 20, notchR: 5,
  barIn: 6.5, barW: 12, barTop: 6, socketIn: 12.5, socketHalf: 17.8,
  wire: 6, hookOut: 24, hookDrop: 48, cornerR: 17,
});

/** A measured edge normal, as a unit vector; one within two degrees of an axis IS that axis (a
 *  rectangle's and a corner's edges are square, whatever the photograph's last pixel says). */
function edgeDir(v) {
  const L = Math.hypot(v[0], v[1]) || 1;
  let x = v[0] / L, z = v[1] / L;
  if (Math.abs(x) > 0.9994) { x = Math.sign(x); z = 0; }
  if (Math.abs(z) > 0.9994) { z = Math.sign(z); x = 0; }
  return [x, z];
}
/** Which way a board's hook edge and bracket edge face (outward, board coordinates). The bracket
 *  edge is the measured one where the photograph gave it; otherwise the hook edge turned through
 *  the board's angle, the same rule core.js bracketNormal uses to place the next board. */
function hookBoardEdges(t) {
  const hook = edgeDir(t.hook_edge || [1, 0]);
  const a = (t.turn || 0) * Math.PI / 180;
  const turned = [-hook[0] * Math.cos(a) + hook[1] * Math.sin(a), -hook[0] * Math.sin(a) - hook[1] * Math.cos(a)];
  return { hook, bracket: edgeDir(t.bracket_edge || turned) };
}

/** A ring of [x, z, r] corners with each one turned through an arc of its radius (0 = left sharp). */
function filletRing(verts, segDeg = 18) {
  const out = [], n = verts.length;
  for (let i = 0; i < n; i++) {
    const [vx, vz, r] = verts[i], P = verts[(i - 1 + n) % n], N = verts[(i + 1) % n];
    let ax = P[0] - vx, az = P[1] - vz, bx = N[0] - vx, bz = N[1] - vz;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const th = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
    if (!r || th > Math.PI - 1e-3) { out.push([vx, vz]); continue; }
    const cut = r / Math.tan(th / 2), hx = ax + bx, hz = az + bz, hl = Math.hypot(hx, hz);
    const cx = vx + hx / hl * r / Math.sin(th / 2), cz = vz + hz / hl * r / Math.sin(th / 2);
    const a0 = Math.atan2(vz + az * cut - cz, vx + ax * cut - cx);
    let da = Math.atan2(vz + bz * cut - cz, vx + bx * cut - cx) - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const k = Math.max(2, Math.ceil(Math.abs(da) * 180 / Math.PI / segDeg));
    for (let j = 0; j <= k; j++) out.push([cx + r * Math.cos(a0 + da * j / k), cz + r * Math.sin(a0 + da * j / k)]);
  }
  return out;
}

/** The outline of a hook-on rectangle: w x d, four rounded corners, and a notch in the bracket
 *  edge in front of each leg hole. Millimetres, [x, z] pairs, the frame textures.json uses. */
export function hookRectOutline(w, d, t) {
  const H = HOOK_BOARD, { bracket } = hookBoardEdges(t);
  const box = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const ring = [];
  for (let i = 0; i < 4; i++) {
    const a = box[i], b = box[(i + 1) % 4];
    ring.push([a[0], a[1], H.cornerR]);
    const ex = Math.sign(b[0] - a[0]), ez = Math.sign(b[1] - a[1]);     // along this side; (ez, -ex) faces out of it
    if (ez * bracket[0] - ex * bracket[1] < 0.99) continue;
    const nx = ez, nz = -ex;                                             // this side carries the brackets
    const at = (t.legs_mm || []).map(l => (l[0] - a[0]) * ex + (l[1] - a[1]) * ez).sort((p, q) => p - q);
    for (const s of at) {
      const m0 = [a[0] + ex * (s - H.notchL / 2), a[1] + ez * (s - H.notchL / 2)];
      const m1 = [a[0] + ex * (s + H.notchL / 2), a[1] + ez * (s + H.notchL / 2)];
      ring.push([m0[0], m0[1], 0], [m0[0] - nx * H.notchD, m0[1] - nz * H.notchD, H.notchR],
                [m1[0] - nx * H.notchD, m1[1] - nz * H.notchD, H.notchR], [m1[0], m1[1], 0]);
    }
  }
  return filletRing(ring);
}

/** Brackets and hooks onto a hook-on board's group (board top at y = 0), where textures.json has
 *  them: legs_mm is each bracket's leg hole, hooks_mm each hook's down leg. `boardMm` is the
 *  bamboo, `total` the published envelope the casting under each bracket makes up. */
function hookBoardHardware(g, t, boardMm, total) {
  const H = HOOK_BOARD, { hook, bracket } = hookBoardEdges(t);
  // Satin aluminium, pale: the plates photograph near white (one keyed out as background). At
  // metalness 0.9 they mirrored the dark room and read charcoal.
  const alu = metal(0xd6d9dc, 0.35, 0.5), dark = metal(0x17191c, 0.2, 0.85);
  const screw = metal(0xb9bdc2, 0.6, 0.35);
  // Stainless rod, kept bright the same way: a 6 mm wire at 0.9 metal has nothing to reflect but
  // the floor and drew as a black line against the bamboo.
  const steel = metal(0xdadde1, 0.5, 0.32);

  for (const [lx, lz] of t.legs_mm || []) {
    // the bracket's own frame: +x out through the board's edge, origin on the leg hole
    const b = new THREE.Group();
    b.position.set(lx * MM, 0, lz * MM);
    b.rotation.y = -Math.atan2(bracket[1], bracket[0]);
    g.add(b);
    const edge = H.legIn;                                    // the bamboo's edge line, from the leg hole
    box(b, H.plateL, H.plateT, H.plateW, 0, alu, 0, H.plateT / 2, 0);                  // the plate, ON the bamboo
    cyl(b, 6, 6, 0.5, 14, dark, 0, H.plateT + 0.1, 0);                                 // its leg hole
    for (const sx of [-1, 1]) for (const sz of [-1, 1])                                // four rivets, 48 x 33 apart
      cyl(b, 3.2, 3.2, 1, 8, screw, sx * 24, H.plateT + 0.5, sz * 16.5);
    // the casting under the board: a block the leg screws up into (its round socket and stud show
    // from below until a leg is in it -- CK-116TR a001), and its bar standing in the notch
    box(b, H.plateL, total - boardMm, H.plateW, 0, alu, 0, -(boardMm + total) / 2, 0);
    cyl(b, 11, 11, 0.5, 18, dark, 0, -total - 0.1, 0);
    cyl(b, 4.5, 4.5, 0.6, 10, screw, 0, -total - 0.3, 0);
    const barX = edge - H.barIn - H.barW / 2, barH = total - 3 - H.barTop;
    box(b, H.barW, barH, H.plateW, 0, alu, barX, -H.barTop - barH / 2, 0);
    for (const sz of [-1, 1])                                                          // the two hook sockets
      cyl(b, 4, 4, 0.5, 12, dark, edge - H.socketIn, -H.barTop + 0.1, sz * H.socketHalf);
  }

  // The hooks. Each lies under the board, climbs the edge, runs out about level with the top and
  // turns straight down: the down leg is what drops into a frame's end hole or a bracket's socket.
  // The level run is drawn with its crown 2 mm proud (CK-116TR a002 has it arching just clear of
  // the two boards); flush, it ran wholly inside a frame's end piece and the hook vanished.
  const r = H.wire / 2, run = 2 - r;
  for (const [hx, hz] of t.hooks_mm || []) {
    const at = (s, y) => [hx + hook[0] * (s - H.hookOut), y, hz + hook[1] * (s - H.hookOut)];   // s = mm outside the edge
    bentTube(g, [at(-34, -boardMm - r), at(3, -boardMm - r), at(8, run), at(H.hookOut, run), at(H.hookOut, -H.hookDrop)],
      r, steel, { rad: [0, 4, 4, 7, 0], radial: 8 });
  }
}

/** A hook-on bamboo board, whole: the slab (flatBoardGeo's shape, `boardMm` thick), the plan
 *  photograph laid on it where the build has one (`decalMat`), its two brackets and its two hooks.
 *  Top face at y = 0, the casting under each bracket reaching down to -`total`. The legs are not
 *  this part -- they are their own SKU, and the planner stands them under the leg holes.
 *  `mat` is the bamboo's material (the caller owns grain and selection glow). */
export function hookBoardGroup(role, t, w, d, { boardMm = 14, total = 25, mat, decalMat = null } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(flatBoardGeo(role, t, w, d, boardMm), mat);
  g.add(body);
  if (decalMat) {
    const decal = new THREE.Mesh(flatBoardGeo(role, t, w, d, 0.4), decalMat);
    decal.position.y = 0.5 * MM;
    g.add(decal);
  }
  hookBoardHardware(g, t || {}, boardMm, Math.max(total, boardMm + 6));
  return { group: g, body };
}

/** LI Stove Joint Kit (GP-040; JP IGT剛炎ジョイントフレーム): the 1.5-unit frame that puts the
 *  GS-1000 in the grid -- and it is nothing but WIRE: a square outline, a ring, and two arms.
 *  It spent its life in burnerGroup's generic branch wearing a solid housing, an invented head
 *  and a knob; the product has none of them.
 *
 *  Everything below is measured off the big studio shot (gallery 05_c101, the hero at 1500px),
 *  rectified to plan through the outline's own four corners:
 *  - The OUTLINE is a straight-sided square with tight corners: each side fits a straight line
 *    to within one pixel, corner radius about 12. Its OUTSIDE is the published 362. (It was a
 *    closed spline through eight corner points, which bowed every side out 13mm.)
 *  - The 377 is the ENVELOPE across the rails: the two arms poke about 15 past the outline on
 *    ONE side, lying on top of the rod there. In a frame (JP a001) that is the stub riding out
 *    over the rail's top face while the outline sits in the rebate. So the outline is centred
 *    between the rails and the envelope is not; the builder takes 362 / 377 from the part's own
 *    assembled_mm, not from the slot it is dropped in.
 *  - The two ARMS are mirror images, one each side of centre. From its stub (x = +/-120) an arm
 *    runs in and DOWN to the ring, crosses under it as a chord at x = +/-82, climbs back out to
 *    a knee near the far side and ends against the inside of that rod (x = +/-120). In the
 *    rectified photo the two chords land at +66 and -94: they are the same +/-80 seen 14mm
 *    nearer the camera, which is what a rod lying about 15-18mm below the outline does. The
 *    published h = 33 says the same thing: stub top to chord underside. (It had five runs --
 *    two stub arms, a long diagonal "Y" and a single arm -- and no chords.)
 *  - The RING lies on the chords, centred on the square, 220 across its centreline (dia 212
 *    inside): the stove's bowl stands in it. Its fitted radius in the rectified photo is 104, a
 *    little small for the same reason the chords are displaced.
 *  - GAUGE dia 7.5: the published 1,020g over the ~2.9m of rod the photo shows, stainless at
 *    7.9 g/cm3. Polished rod on white measures thinner than it is.
 *
 *  Mostly air, so a faint ghost box carries picking (meshTrayGroup's trick). The outline's top
 *  at y = 0; the stubs lie 7.5 proud of it, on the rail; the chords hang to 7.5 - h. */
export function gp040Group(w = 362, d = 377, h = 33) {
  const g = new THREE.Group();
  const steel = metal(0xd3d7db, 0.7, 0.28);      // polished rod
  const gauge = 7.5, r = gauge / 2;
  const side = w / 2 - r;                        // the outline's centreline: its outside is w
  const ringR = 110;
  const rimY = -r, armY = r;                     // the outline, and an arm lying on it
  const lowY = gauge - h + r, ringY = lowY + gauge;   // a chord, and the ring lying on the chords
  const zStub = -(d - w / 2);                    // the stub tips: the far edge of the envelope

  // A faint ghost box, full envelope: it carries picking (dropModule tags only `body`) and
  // nothing else. The rods are the read.
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd3d7db), transparent: true, opacity: 0.05, depthWrite: false }),
    0, gauge - h / 2, -(d - w) / 2);

  // The outline: four straight rods, four tight corners.
  bentTube(g, [[side, rimY, side], [-side, rimY, side], [-side, rimY, -side], [side, rimY, -side]],
    r, steel, { rad: 12, closed: true, radial: 8 });

  // The ring, on the chords.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR * MM, r * MM, 8, 48), steel);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = ringY * MM;
  g.add(ring);

  // The two arms: stub over the back rod, down to the ring, the chord, up to the knee, the end
  // butted against the inside of the front rod.
  const chord = Math.sqrt(ringR * ringR - 82 * 82);          // where x = 82 crosses the ring: 73
  for (const s of [-1, 1])
    bentTube(g, [[s * 120, armY, zStub], [s * 120, armY, -166], [s * 82, lowY, -chord],
                 [s * 82, lowY, chord + 3], [s * 117, rimY, 146], [s * 120, rimY, side - r]],
      r, steel, { rad: 14, radial: 8 });

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

/** A polyline handed to TubeGeometry knot by knot. u IS the knot parameter (not arc length), so
 *  a tube of knots-1 segments puts one ring on every knot: none wasted on the straights, none
 *  missing from a bend. */
class KnotCurve extends THREE.Curve {
  constructor(knots, closed) { super(); this.knots = knots; this.closed = closed; }
  getPoint(t, target = new THREE.Vector3()) {
    const k = this.knots, n = k.length, segs = this.closed ? n : n - 1;
    const u = Math.min(Math.max(t, 0), 1) * segs, i = Math.min(Math.floor(u), segs - 1);
    return target.copy(k[i]).lerp(k[(i + 1) % n], u - i);
  }
  getPointAt(u, target) { return this.getPoint(u, target); }
  getTangentAt(u, target) { return this.getTangent(u, target); }
}

/** A bent wire through `pts` (mm): STRAIGHT runs, each corner turned through a fillet of radius
 *  `rad` (one number, or one per point; 0 = a sharp corner; the ends of an open wire never
 *  turn). A Catmull-Rom spline through the same corners -- what the wire parts used -- bows
 *  out along every straight run: a 245 x 356 basket rim came out 275 x 380 and lay over its
 *  neighbour. A real wire is straight between its bends. */
function bentTube(g, pts, r, mat, { rad = 0, closed = false, radial = 6 } = {}) {
  const P = pts.map(p => new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(MM));
  const n = P.length, knots = [];
  for (let i = 0; i < n; i++) {
    const v = P[i];
    const rho = (closed || (i > 0 && i < n - 1)) ? (Array.isArray(rad) ? rad[i] || 0 : rad) * MM : 0;
    const din = P[(i - 1 + n) % n].clone().sub(v), dout = P[(i + 1) % n].clone().sub(v);
    // how far back along each run a true arc of that radius starts; never past half a run
    const cut = rho ? Math.min(rho / Math.tan(din.angleTo(dout) / 2), din.length() / 2, dout.length() / 2) : 0;
    if (!(cut > 1e-5)) { knots.push(v); continue; }
    const turn = new THREE.QuadraticBezierCurve3(
      v.clone().addScaledVector(din.normalize(), cut), v, v.clone().addScaledVector(dout.normalize(), cut));
    for (let k = 0; k <= 4; k++) knots.push(turn.getPoint(k / 4));
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new KnotCurve(knots, closed),
    closed ? knots.length : knots.length - 1, r * MM, radial, closed), mat);
  g.add(m);
  return m;
}

/** Many small axis-aligned boxes as ONE mesh -- a griddle's ribs, a net's wires. Each entry is
 *  [w, h, d, x, y, z] in mm (size, then centre). One draw call where a mesh apiece was a hundred. */
function boxesInto(g, list, mat) {
  const pos = [], nor = [];
  for (const [w, h, d, x, y, z] of list) {
    const b = new THREE.BoxGeometry(w * MM, h * MM, d * MM).toNonIndexed();
    b.translate(x * MM, y * MM, z * MM);
    for (const v of b.attributes.position.array) pos.push(v);
    for (const v of b.attributes.normal.array) nor.push(v);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  const m = new THREE.Mesh(geo, mat);
  g.add(m);
  return m;
}

/** A pressed pan: a flat floor and a wall flaring out to a rounded-rectangle rim, as one
 *  double-sided sheet (mm). `w` x `d` is the rim, `fw` x `fd` the floor, `h` the depth, `r` the
 *  rim's corner radius; the rim's edge is at y = `top`, centred on (x, z). `mat` is made
 *  double-sided here, so hand it a material of its own. */
function panInto(g, mat, { w, d, fw, fd, h, r = 20, top = 0, x = 0, z = 0 }) {
  // A rounded rectangle as a ring of points. The corners are the same quadratic turns bentTube
  // makes, so a rim wire laid round the same rectangle follows the wall's edge exactly.
  const ring = (hw, hd, rr, y) => {
    const C = [[hw, hd], [-hw, hd], [-hw, -hd], [hw, -hd]], out = [];
    for (let i = 0; i < 4; i++) {
      const [vx, vz] = C[i], [px, pz] = C[(i + 3) % 4], [nx, nz] = C[(i + 1) % 4];
      const ax = vx + Math.sign(px - vx) * rr, az = vz + Math.sign(pz - vz) * rr;
      const bx = vx + Math.sign(nx - vx) * rr, bz = vz + Math.sign(nz - vz) * rr;
      for (let k = 0; k <= 5; k++) {
        const t = k / 5, u = 1 - t;
        out.push([x + u * u * ax + 2 * u * t * vx + t * t * bx, y,
                  z + u * u * az + 2 * u * t * vz + t * t * bz]);
      }
    }
    return out;
  };
  const T = ring(w / 2, d / 2, r, top);
  const B = ring(fw / 2, fd / 2, Math.max(2, r - (w - fw) / 2), top - h);
  const n = T.length, pos = [], idx = [];
  for (const p of [...T, ...B, ...B]) pos.push(p[0] * MM, p[1] * MM, p[2] * MM);   // wall top, wall foot, floor edge
  pos.push(x * MM, (top - h) * MM, z * MM);                                        // floor centre
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, n + j, j, i, n + i, n + j, 2 * n + j, 2 * n + i, 3 * n);           // faces look in and up
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(geo, mat);
  g.add(m);
  return m;
}

// The burners, by what their photographs show -- one round head or two, a flat grill plate,
// or a charcoal BBQ with a split top. `spec` is the same object app.js keys by SKU.
// `legs` ({ w, d } = the published standing footprint) stands the Flat Burner on its two wire
// leg frames, the way the part bench shows it; in a frame it has none.
export function burnerGroup(spec, w, d, h, topTex = null, { legs = null } = {}) {
  const g = new THREE.Group();
  const steel = 0x9aa0a8, dark = 0x26292e;

  // The Flat Burner (GS-450R). `w` x `d` here is the top plate, 250 x 360 (the catalogue's
  // plate_mm): the published 270 x 410 x 110 is the stove STANDING on its plug-in wire legs, and
  // drawn 410 deep the plate lay 25mm onto each rail. Everything is measured off two photographs:
  //
  //   detail_03 (the parts laid flat, plate 270px = 360mm): plate 1 : 1.43; the hole 164 across;
  //     the dish 184 across, eight-sided, four slots, the head on a raised disc; the grate's four
  //     rods on a 52mm pitch (x = +/-26 and +/-78), the outer pair 302 long with their tips turned
  //     down into the plate's slots, the inner pair 334 long and pinched to +/-12 over the head;
  //     two cross rods 234 apart, each kinked up between the inner pair.
  //   alt_03 (side elevation, plate 416px): long edges folded down 10; a skirt under the plate to
  //     -22; the dish hanging from it to -39; the valve block 92 x 19 under the dish, off-centre
  //     toward the hose; the grate's highest point (the kinks) 11 above the plate; plate top 99
  //     above the ground on its legs.
  //
  // It was a capped cylinder for a bowl (its lid plugged the hole at y = 0, burying the head), a
  // solid skirt box, and a grate of twelve separate dashes at three heights.
  if (spec.flat450) {
    const sus = metal(0xa2a7ac, 0.5, 0.45);          // the satin top, looking up
    const side = metal(0xb9bec3, 0.45, 0.5);         // stainless seen side-on mirrors the dark half
    const wire = metal(0xdfe2e5, 0.9, 0.2);
    const R = 82, FOLD = 10, GRATE = 11.5;
    // The plate, WITH THE HOLE IN IT. Rounded rectangle, circular cutout, 1.5mm of steel.
    const sh = new THREE.Shape();
    const hw = (w / 2) * MM, hd = (d / 2) * MM, cr = 4 * MM;
    sh.moveTo(-hw + cr, -hd);
    sh.lineTo(hw - cr, -hd); sh.quadraticCurveTo(hw, -hd, hw, -hd + cr);
    sh.lineTo(hw, hd - cr); sh.quadraticCurveTo(hw, hd, hw - cr, hd);
    sh.lineTo(-hw + cr, hd); sh.quadraticCurveTo(-hw, hd, -hw, hd - cr);
    sh.lineTo(-hw, -hd + cr); sh.quadraticCurveTo(-hw, -hd, -hw + cr, -hd);
    const hole = new THREE.Path();
    hole.absarc(0, 0, R * MM, 0, Math.PI * 2, true);
    sh.holes.push(hole);
    const plate = new THREE.Mesh(
      new THREE.ExtrudeGeometry(sh, { depth: 1.5 * MM, bevelEnabled: false, curveSegments: 40 }), sus);
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -1.5 * MM;                  // top face at the rim, y = 0
    g.add(plate);
    const body = plate;
    // The long edges fold down 10 -- the depth of the rail's rebate, so the plate sits flush --
    // and a skirt under the plate carries the dish.
    for (const sx of [-1, 1]) box(g, 1.5, FOLD, d, 0, side, sx * (w / 2 - 0.75), -FOLD / 2, 0);
    for (const sx of [-1, 1]) box(g, 1.5, 12, 258, 0, side, sx * 112, -16, 0);
    for (const sz of [-1, 1]) box(g, 224, 12, 1.5, 0, side, 0, -16, sz * 129);
    // The dish seen THROUGH the hole: eight-sided, open, its rim under the plate.
    const dishGeo = new THREE.LatheGeometry(
      [[0, -39], [78, -39], [92, -22]].map(p => new THREE.Vector2(p[0] * MM, p[1] * MM)), 8).toNonIndexed();
    dishGeo.computeVertexNormals();
    const dishMat = metal(0xbfc4c9, 0.5, 0.42);
    dishMat.side = THREE.DoubleSide;
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.rotation.y = Math.PI / 8;                 // flats square to the plate, as in detail_03
    g.add(dish);
    cyl(g, 50, 50, 3, 28, metal(0xd2d6da, 0.55, 0.35), 0, -37.5, 0);     // the raised disc the head stands on
    const punch = metalE(0x0e0f12, 0.2, 0.8);
    for (let k = 0; k < 4; k++) {                  // the dish's four air slots, on the diagonals
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      box(g, 31, 0.8, 4, 0, punch, Math.cos(a) * 64, -38.7, Math.sin(a) * 64, -a - Math.PI / 2);
    }
    // The head: a stem, the dark ported band, and the pale cap -- its top 8 under the plate.
    cyl(g, 20, 22, 12, 20, metal(0x4a4d52, 0.6, 0.5), 0, -30, 0);
    cyl(g, 29.5, 29.5, 14, 28, metal(0x5e4630, 0.6, 0.5), 0, -17, 0);
    cyl(g, 20, 22, 2, 28, metal(0xe3d2a6, 0.35, 0.5), 0, -9, 0);
    // The grate: four continuous rods on two cross rods. dia 5.
    for (const s of [-1, 1]) {
      bentTube(g, [[s * 78, -1, -151], [s * 78, 7.5, -151], [s * 78, 7.5, 151], [s * 78, -1, 151]],
        2.5, wire, { rad: 3 });
      bentTube(g, [[s * 26, 7.5, -167], [s * 26, 7.5, -36], [s * 12, 7.5, -4], [s * 12, 7.5, 4],
                   [s * 26, 7.5, 36], [s * 26, 7.5, 167]], 2.5, wire, { rad: 6 });
      bentTube(g, [[-80, 2.5, s * 117], [-20, 2.5, s * 117], [0, GRATE - 2.5, s * 124],
                   [20, 2.5, s * 117], [80, 2.5, s * 117]], 2.5, wire, { rad: 4 });
    }
    // The valve block under the dish, and the gas port: out a SHORT (250mm) edge, under the plate
    // -- the manual's own warning diagram ("バーナー本体の器具栓及びホースは、トッププレートの
    // 短辺側から出してください"). In the frame that edge faces a long rail; the hose ducks under it
    // to the canister, where the regulator is.
    box(g, 40, 19, 92, 0, metal(0x8d9298, 0.5, 0.5), 0, -51.5, 36);
    cyl(g, 5, 5, 12, 10, metal(0xb08a4a, 0.8, 0.35), 0, -52, 88, Math.PI / 2);
    bentTube(g, [[0, -52, 94], [0, -52, d / 2 - 8]], 6, metal(0x9a9da0, 0.5, 0.5), { radial: 8 });
    // The two wire leg frames, plugged over the short edges: each a U whose uprights lean out to
    // the published footprint, with the pale silicone sleeves the photographs show at its bends.
    if (legs) {
      const footY = -(h - GRATE) + 2.5, fx = legs.w / 2 - 2.5, tx = w / 2 - 8;
      const sleeve = new THREE.MeshStandardMaterial({ color: 0xc3d6e8, metalness: 0, roughness: 0.5 });
      const part = (a, b, t0, t1) => bentTube(g,                 // a sleeve over part of the run a -> b
        [t0, t1].map(t => a.map((v, i) => v + (b[i] - v) * t)), 3.6, sleeve, { radial: 8 });
      for (const sz of [-1, 1]) {
        const zt = sz * (d / 2 - 3), zf = sz * (legs.d / 2 - 2.5), zj = zf - sz * 8;
        const pts = [[-tx, -4, zt - sz * 14], [-tx, -4, zt + sz * 3], [-fx, footY, zf], [-60, footY, zj],
                     [60, footY, zj], [fx, footY, zf], [tx, -4, zt + sz * 3], [tx, -4, zt - sz * 14]];
        bentTube(g, pts, 2.5, wire, { rad: [0, 5, 8, 20, 20, 8, 5, 0] });
        part(pts[2], pts[1], 0.1, 0.5); part(pts[5], pts[6], 0.1, 0.5);
        part(pts[2], pts[3], 0.12, 0.6); part(pts[5], pts[4], 0.12, 0.6);
      }
    }
    return { group: g, body };
  }

  // The Grill Burner (GS-355 雪峰苑), 250 x 360 x 175 -- and the whole 175 is there in a frame.
  // Top to bottom, off the hero (standing alone; 580px = 175mm down its near corner post) and JP
  // a002 (seated in a frame, seen from below the rail):
  //
  //   グリドル   the cast-iron griddle, about 240 x 340 (a004: a finger of gap all round it in its
  //             slot), level with the end piece and the neighbouring lid -- drawn 5 proud. Its
  //             ribs run down four falls to the drain slot in the middle, like a hipped roof.
  //   本体      the stainless housing: an end plate across each short end (41mm tall in the hero)
  //             and a 風防 leaning in down each long side to about 76 below the table, its lower
  //             corners cut off -- so the section is a trough. Four ears off the end plates land
  //             on the rail lips. No knob anywhere: the 器具栓 rides the remote canister, at the
  //             end of the hose that leaves one short end.
  //   水皿      the black enamel water tray, tucked right under the 風防 (a002). Rim about
  //             220 x 290 -- its two far corners sit 211 x 272 apart in the hero -- and 36 deep.
  //             It is always fitted (manual p.5: 「水皿はいかなる場合においても必ず水を入れ」) and
  //             slides in from a short end (04_9: a hand pulling it out from under the rail; two
  //             grooves pressed along its floor ride the stand's wires).
  //   脚        the wire stand, to 170 below the table: one wire down each long side, a post at
  //             each corner, a hairpin at the ground, then up and inward to a run under the
  //             tray. Three of the four hairpins show in the hero, and solved together they
  //             rise about 40 while coming in about 76.
  //
  // It was a 65mm box with a knob, its plate riding 38mm above the table on four posts, on the
  // belief that the stand folds away in a frame. It does not: it is what carries the tray.
  if (spec.plate) {
    const GW = 240, GD = 340, proud = 5, faceY = proud - 2;
    const iron = metal(0x1c1e21, 0.2, 0.7);
    const body = new THREE.Mesh(flatRect(GW * MM, GD * MM, 10 * MM, 14 * MM), iron);
    body.position.y = faceY * MM;                  // the casting's face; the ribs stand 2 above it
    g.add(body);
    const ribs = [], pitch = 14, hip = (GD - GW) / 2;   // the hips run in from the corners at 45
    for (let z = -140; z <= 140; z += pitch) {     // the two long falls: ribs across
      const x0 = Math.max(9, Math.abs(z) - hip + 6), x1 = GW / 2 - 9;
      if (x1 - x0 >= 12) for (const s of [-1, 1]) ribs.push([x1 - x0, 2, 5, (s * (x0 + x1)) / 2, proud - 1, z]);
    }
    for (let x = -98; x <= 98; x += pitch) {       // the two end falls: ribs along
      const z0 = Math.abs(x) + hip + 6, z1 = GD / 2 - 9;
      if (z1 - z0 >= 12) for (const s of [-1, 1]) ribs.push([5, 2, z1 - z0, x, proud - 1, (s * (z0 + z1)) / 2]);
    }
    boxesInto(g, ribs, metal(0x25272b, 0.25, 0.6));
    const punch = metalE(0x0e0f12, 0.2, 0.8);
    box(g, 8, 0.6, 34, 0, punch, 0, faceY + 0.1, 0);                             // the drain slot

    // 本体: the trough. Stainless seen side-on, so not mirror-metal (it would render black).
    const sus = metal(0xc9cdd1, 0.35, 0.55);
    const topY = -8, endY = -47, botY = -76, xTop = 123, xBot = 96, zEnd = 153;
    const slant = Math.hypot(xTop - xBot, topY - botY), lean = Math.atan2(xTop - xBot, topY - botY);
    const xAt = y => xTop - ((xTop - xBot) * (topY - y)) / (topY - botY);        // the 風防's face at height y
    // one 風防: a long hexagon in its own plane (along z, and down the slope), leaned in
    const s1 = (slant * (topY - endY)) / (topY - botY), cut = 28, gs = new THREE.Shape();
    gs.moveTo(-zEnd * MM, 0); gs.lineTo(zEnd * MM, 0); gs.lineTo(zEnd * MM, -s1 * MM);
    gs.lineTo((zEnd - cut) * MM, -slant * MM); gs.lineTo(-(zEnd - cut) * MM, -slant * MM);
    gs.lineTo(-zEnd * MM, -s1 * MM); gs.closePath();
    const guardGeo = new THREE.ExtrudeGeometry(gs, { depth: 1.5 * MM, bevelEnabled: false });
    guardGeo.translate(0, 0, -0.75 * MM);
    guardGeo.rotateY(Math.PI / 2);                 // the shape's x runs along z; its sheet faces +/-x
    for (const sx of [-1, 1]) {
      const guard = new THREE.Mesh(guardGeo, sus);
      guard.position.set(sx * xTop * MM, topY * MM, 0);
      guard.rotation.z = -sx * lean;
      g.add(guard);
      box(g, 12, 1.5, 2 * zEnd, 0, sus, sx * (w / 2 - 6), topY, 0);              // its lip, beside the griddle
    }
    const hole = cyl(g, 6, 6, 3, 12, punch, xAt(-38), -38, 0);                   // 点火穴, in one 風防
    hole.rotation.z = -(Math.PI / 2 + lean);
    const end = new THREE.Shape();
    end.moveTo(-xTop * MM, topY * MM); end.lineTo(xTop * MM, topY * MM);
    end.lineTo(xAt(endY) * MM, endY * MM); end.lineTo(-xAt(endY) * MM, endY * MM); end.closePath();
    const endGeo = new THREE.ExtrudeGeometry(end, { depth: 1.5 * MM, bevelEnabled: false });
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(endGeo, sus);
      m.position.z = (sz * zEnd - 0.75) * MM;
      g.add(m);
      for (const sx of [-1, 1])                                                  // the ears, on the rail lips
        box(g, 26, 2, d / 2 - zEnd, 0, sus, sx * (xTop - 13), -9, (sz * (d / 2 + zEnd)) / 2);
    }
    // the burner tube in the trough, and at one short end the hose bracket and the start of the hose
    bentTube(g, [[-45, -42, -130], [-45, -42, 118], [45, -42, 118], [45, -42, -130]], 9,
      metal(0x3b3e43, 0.5, 0.55), { rad: 40, radial: 8 });
    box(g, 96, 30, 1.5, 0, sus, -34, endY - 15, zEnd);
    bentTube(g, [[-34, endY - 20, zEnd], [-34, endY - 20, d / 2 - 6]], 6, metal(0x9a9da0, 0.5, 0.5), { radial: 8 });

    // 水皿: glossy black enamel, flared, with its two grooves.
    const enamel = metal(0x101114, 0.3, 0.25);
    const trayW = 220, trayD = 290, trayTop = -88, trayH = 36, grooveX = 40;
    panInto(g, enamel, { w: trayW, d: trayD, fw: trayW - 48, fd: trayD - 50, h: trayH, r: 24, top: trayTop });
    bentTube(g, [[trayW / 2, trayTop, trayD / 2], [-trayW / 2, trayTop, trayD / 2],
                 [-trayW / 2, trayTop, -trayD / 2], [trayW / 2, trayTop, -trayD / 2]],
      2, enamel, { rad: 24, closed: true });                                     // its rolled rim
    for (const sx of [-1, 1]) box(g, 8, 3, trayD - 90, 0, enamel, sx * grooveX, trayTop - trayH + 1.5, 0);

    // 脚: dia 5 wire. Down a post at each corner to the ground, a hairpin, then up and in to the
    // run the tray's groove rides.
    const wire = metal(0xd6dade, 0.6, 0.3);
    const px = 116, pz = 146, footY = -(h - proud) + 0.3, runY = trayTop - trayH - 2.5;
    for (const sx of [-1, 1])
      bentTube(g, [[sx * px, -12, pz], [sx * px, footY, pz], [sx * grooveX, runY, pz - 44],
                   [sx * grooveX, runY, -(pz - 44)], [sx * px, footY, -pz], [sx * px, -12, -pz]],
        2.5, wire, { rad: [0, 4, 14, 14, 4, 0] });
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
  // Rim overhang: across the rails / along it. The half unit's basket is 110 x 288 under its
  // 120 x 356 rim (CK-226's side and end elevations, scaled on the 356) -- 34mm of black panel
  // stands past each end of it, and those panels are its seat.
  const seat = panels ? 34 : 20, side = panels ? 5 : 9;
  const lift = panels ? 9 : 6;                      // floor above the envelope's bottom
  const cw = w - 2 * side, cd = d - 2 * seat;       // the cavity in plan
  const fy = -(h - lift);                           // the floor
  const bend = Math.min(9, (h - lift) * 0.3);       // the turn into the floor: tight, ~9mm
  const flange = Math.min(10, (h - lift) * 0.3);    // where a wire leaves the wall for the rim
  const rimR = gauge * 1.15 / 2;                    // the rim is heavier stock than the mat

  // A faint ghost box, full envelope: it carries picking (dropModule tags only `body`) and nothing
  // else. The wires are the read.
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }),
    0, -h / 2, 0);

  // A bent wire: straight runs, a small fillet at each bend (bentTube). These were Catmull-Rom
  // splines through the corner points, and a spline bows out between its points -- the 1-unit
  // rim swelled to 275 x 380 and overlapped the tray beside it by 26mm.
  const wire = (pts, r = gauge / 2, rad = 0, closed = false) => bentTube(g, pts, r, steel, { rad, closed });

  // A rounded-rectangle loop whose OUTSIDE is 2hw x 2hd: the centreline runs a wire radius in.
  const loop = (hw, hd, y, corner, r) => wire([[hw - r, y, -hd + r], [hw - r, y, hd - r],
    [-hw + r, y, hd - r], [-hw + r, y, -hd + r]], r, corner, true);

  // One hairpin, rim to rim. `spans` is the axis its two arms straddle, `t` its station on the
  // other. The arms leave the wall at -flange and finish OUT on the rim: that outward kick is what
  // holds the rim off the basket, and it is the row of little peaks along every near edge.
  const hairpin = (spans, halfA, rimA, t) => {
    const P = (a, y) => (spans === "z" ? [t, y, a] : [a, y, t]);
    wire([P(-rimA, 0), P(-halfA, -flange), P(-halfA, fy), P(halfA, fy), P(halfA, -flange), P(rimA, 0)],
      gauge / 2, [0, 3, bend, bend, 3, 0]);
  };
  // A plain wall wire: over the rim, down, and stopped at the floor.
  const post = (spans, halfA, rimA, t, s) => {
    const P = (a, y) => (spans === "z" ? [t, y, a] : [a, y, t]);
    wire([P(s * rimA, 0), P(s * halfA, -flange), P(s * halfA, fy)], gauge / 2, [0, 3, 0]);
  };

  // The rim, its outside on the published plan; then the body's own top frame, inboard of it.
  // On the half unit the rim rides inside the end panels' thickness, so the panels cap it.
  loop(w / 2, d / 2, panels ? -3.5 : 0, 12, rimR);
  loop(cw / 2, cd / 2, -flange, 8, gauge / 2);

  if (!panels) {
    // CK-225 / CK-250. The mat spans the 356 and is spaced along the 245: 16 wires at 13.6mm over
    // 204mm, leaving the ~11mm margin to each long wall that the top view shows.
    const pitch = 13.6, spread = cw - 23, n = Math.round(spread / pitch);
    for (let i = 0; i <= n; i++) hairpin("z", cd / 2, d / 2 - rimR, -spread / 2 + (i * spread) / n);

    // The two long walls: 13 verticals at 26.3mm across the 316 cavity. Measured off the manual's
    // line art as a dead-regular projected pitch, which then puts the 13th wire on 316.6mm -- the
    // published cavity, arrived at from the other direction. No horizontal courses: the drawing has
    // none and 121mm of wall does not ask for any.
    const nw = Math.round(cd / 26.3);
    for (let i = 0; i <= nw; i++) for (const s of [-1, 1])
      post("x", cw / 2, w / 2 - rimR, -cd / 2 + (i * cd) / nw, s);

    // Four transverse ribs UNDER the mat, at the stations measured off the top view (+/-0.171 and
    // +/-0.376 of the depth, dead symmetric). They are what the floor rides on, and their undersides
    // are the -h the catalogue publishes.
    for (const f of [-0.376, -0.171, 0.171, 0.376])
      wire([[-cw / 2 + 6, fy - gauge, f * d], [cw / 2 - 6, fy - gauge, f * d]]);
  } else {
    // CK-226 / CK-251. The mat is turned 90 degrees: the U's span the narrow 110 and are spaced
    // along the 288 -- a finer, denser weave than the 1-unit's.
    const nu = Math.round(cd / 12.2);
    for (let i = 0; i <= nu; i++) hairpin("x", cw / 2, w / 2 - rimR, -cd / 2 + (i * cd) / nu);
    for (const f of [-0.33, 0, 0.33])                 // long floor wires tying the mat together
      wire([[f * cw, fy, -cd / 2 + 4], [f * cw, fy, cd / 2 - 4]]);

    // Horizontal courses, each a closed ring round the basket: three on the deep tray at 30, 63
    // and 97 below the top (CK-226's side elevation), one on the shallow. The end walls carry
    // nothing else -- the ten "end posts" drawn here before were built on the wrong axis and
    // stood 158mm either side of the tray, inside the neighbouring slots.
    const courses = h > 100 ? [30, 63, 97].map(v => v * h / 139) : [25 * h / 48];
    for (const cy of courses) loop(cw / 2, cd / 2, -cy, 8, gauge / 2);

    // Two wire feet under the floor; their undersides are the -h the catalogue publishes.
    const footY = -h + gauge / 2;
    for (const fz of [-0.3, 0.3])
      wire([[-cw / 2 + 12, fy, fz * cd], [-cw / 2 + 12, footY, fz * cd],
            [cw / 2 - 12, footY, fz * cd], [cw / 2 - 12, fy, fz * cd]], gauge / 2, [0, 4, 4, 0]);

    // The two polypropylene end panels: THE SEAT. Flat caps over the 120mm ends, wholly outboard
    // of the basket, logo printed on them, a bossed hole for the TTA 300mm shaft. Their tops are
    // the tray's top, so they land in the rails' recess and the tray hangs off them.
    const pd = seat + 1, pt = 7, pp = metal(0x1c1e22, 0.05, 0.65);
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
 *      a mid-grey PVC grip sleeve. a001 lays one handle FLAT on the lid, and flat is the state
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
  // The PVC grip wrap is the body's own mid-grey: #a6a7a9 where it lies flat on the lid in
  // UG-472's hero, against #a8acad for the wall beside it. It was drawn near white (0xc6c9cb).
  // A touch under the wall's value because it lies face-up, where the light is.
  const sleeve  = metal(0x9a9ea0, 0, 0.5);

  // The grey tub and the black collar over it, one soft rounded form -- corner radius ~20
  // is what welded EVA panels pull themselves into. The tub tucks 2mm up behind the collar
  // so no seam gap opens; the collar runs 1mm proud each side, the lid assembly overhanging
  // the body the way the photos show.
  const body = box(t, L, h - COLLAR + 2, S, 20, eva,
                   0, -(COLLAR - 2) - (h - COLLAR + 2) / 2, 0);
  box(t, L + 2, COLLAR, S + 2, 12, collar, 0, -COLLAR / 2, 0);
  // The moulded base tray: a slight flare with its seam ~13mm up, and the foot the bag
  // stands on -- dropped 1.5 so its underside is not coplanar with the tub's.
  // A rounded-rectangle slab in PLAN, corners matching the tub's: as a plain box its square
  // corners stood out past the tub's rounded ones like a plinth (hidden until 2026-11 only
  // because roundedBox built the tub 40mm too long).
  const tray = new THREE.Mesh(flatRect((L + 3) * MM, (S + 3) * MM, 13 * MM, 21 * MM), evaDark);
  tray.position.y = (-h + 11.5) * MM;
  t.add(tray);

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
/** Double BBQ Box (CK-160; JP リフトアップBBQ BOX, "lift-up"): a charcoal BBQ that drops into the
 *  frame. Its manual settles what it is, and it is NOT the grate-half + griddle-half the old bbq
 *  branch drew. There is no griddle:
 *
 *    本体            the stainless box, vents in its two SHORT ends (JP a001: two groups of five
 *                    holes and a slot under each; the long walls are plain)
 *    インナートレー(炭床)  the charcoal bed: a perforated bright tray sitting INSIDE the box (step 3)
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
 *  BBQ Box" has been saying all along. So the body is built 500 wide; the 55 that H175 has over
 *  the packed 120 is the lift frame standing up, which is where the nets are drawn. The box itself
 *  hangs about 80, not the packed 120 it was drawn at: the 120 includes the lid, whose skirt stands
 *  about 42 over the rim (06_2, the box packed: lid skirt 85px + body 155px = 240px = 120). And `w`
 *  is deliberately unused, because the 605
 *  measures across the splayed stands and the stands come off. D360 is real -- it is the rim, and
 *  it lands on the rail lip like any module.
 *
 *  EITHER HALF SWAPS (owner): a 鉄板 griddle plate takes a net's place, so the two halves are
 *  independently net-or-plate -- `surfaces`. Two nets is what it SHIPS with; the plate is bought
 *  separately. Its cooking surfaces are size-shared with the Takibi Fire & Grill L.
 *
 *  Rim at y = 0 hanging to -bodyH, and the surfaces RISE ABOVE it -- the exception this file's
 *  header already names. */
export function bbqBoxGroup(w, d, h, { color = 0xb9bec4, bodyW = 500, bodyH = 80, packedH = 120,
                                       surface = "nets" } = {}) {
  const wallD = wallSpan(d), wall = 2;
  const { group: g, body } = binGroup(bodyW, wallD, bodyH, { open: true, color, wall });
  const mat = metal(color, 0.8, 0.4);
  railRimInto(g, bodyW, d, mat);

  // The vents, in the two SHORT ends: each end has two groups of five round holes with a slot
  // under each (JP a001 looks straight at one). Punched dark, the way frameGroup does its hook
  // holes. (They were a row of ten along each long wall, which is plain.)
  const punch = metalE(0x0e0f12, 0.2, 0.8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (bodyW / 2 - wall / 2);
    for (let i = 0; i < 5; i++)
      cyl(g, 6, 6, wall + 0.6, 12, punch, x, -bodyH + 44 - i * 2, sz * (28 + i * 24), 0).rotation.z = Math.PI / 2;
    box(g, wall + 0.6, 5, 100, 0, punch, x, -bodyH + 20, sz * 76);
  }

  // インナートレー -- the charcoal bed: a shallow pan set inboard of the lift frame (step 3), its
  // floor punched in two hole sizes so ash drops through. It is BRIGHT (07_3, the nets lifted off
  // it); it only looks dark in the shade of the black plate, and was drawn dark throughout.
  const trayMat = surface === "plate" ? metal(0x2b2e33, 0.35, 0.62) : metal(0xc9cdd2, 0.45, 0.5);
  const trW = bodyW - 56, trD = wallD - 52, trY = -bodyH + 40, trH = 22;
  box(g, trW, 2, trD, 1, trayMat, 0, trY, 0);
  for (const sz of [-1, 1]) box(g, trW, trH, 2, 0.5, trayMat, 0, trY + trH / 2, sz * (trD / 2 - 1));
  for (const sx of [-1, 1]) box(g, 2, trH, trD, 0.5, trayMat, sx * (trW / 2 - 1), trY + trH / 2, 0);
  for (const r of [-1, 0, 1]) for (let i = 0; i < 11; i++)
    cyl(g, i % 2 ? 4 : 6.5, i % 2 ? 4 : 6.5, 4, 10, punch,
        -trW * 0.42 + (i * trW * 0.84) / 10, trY, r * trD * 0.26);

  // 昇降フレーム + 焼き網 x2, drawn at the RAISED height -- which is exactly what H175 measures:
  // the published 175 less the packed 120.
  const lift = Math.max(h - packedH, 0), netT = 5, barT = 12;
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
  // so what you see is what you'd buy: a net is a wire grid in a thin border at the real 15mm
  // pitch (see `net`; its spec prints ネット φ2.5mm), a 鉄板 is a solid slab with a raised lip to
  // hold the fat in, and it reads DARK -- it is not stainless.
  const netMat = metal(0xd0d4d9, 0.5, 0.4);       // half-metal: mirror-metal wires rendered near black
  const plateMat = metal(0x33373d, 0.42, 0.55);
  const net = (nw, nd, cx) => {
    // 15mm pitch, φ2.5 wire, square to the frame. S-029HA's spec prints the gauge, and its
    // plan view (gallery 08_a007) puts a column every 62px across the 1412px that is its 339mm.
    // (It was 11, from a count of the hero's oblique view.)
    const rim = 6, pitch = 15;
    for (const sz of [-1, 1]) box(g, nw, 4, rim, 1, netMat, cx, lift - 2, sz * (nd / 2 - rim / 2));
    for (const sx of [-1, 1]) box(g, rim, 4, nd, 1, netMat, cx + sx * (nw / 2 - rim / 2), lift - 2, 0);
    const iw = nw - 2 * rim, id = nd - 2 * rim;
    const nx = Math.max(2, Math.round(iw / pitch)), nz = Math.max(2, Math.round(id / pitch));
    for (let j = 1; j < nx; j++) box(g, 2.5, 2, id, 0, netMat, cx - iw / 2 + (j * iw) / nx, lift - 1.5, 0);
    for (let j = 1; j < nz; j++) box(g, iw, 2, 2.5, 0, netMat, cx, lift - 3.5, -id / 2 + (j * id) / nz);
  };
  if (surface === "plate") {
    // GR-006, 500 x 330 x 35: ONE plate over the whole top. Its 500 is the body's 500 exactly.
    grillPanInto(g, lift + 23);                          // the same pan the bench draws
  } else if (surface === "halves") {
    // S-029HA x2, side by side: each lies 206 along the rails and 339 across. (They were turned
    // the other way, 339 along, and overlapped into one 551 x 206 strip.)
    for (const sx of [-1, 1]) net(206, 339, sx * 106);
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
 *    - TWO wire ゴトク, one per burner (p.11 flips them 180 degrees for HIGH/LOW; this is LOW):
 *      racks about 220 x 275 that cover the well, not the two small asterisks they were drawn as.
 *    - TWO knobs on the FRONT face, standing proud of it -- what makes the deployed DEPTH 383
 *      against a 360 body.
 *    - TWO canisters clamped INVERTED under the front deck, one dead under each knob -- the
 *      液出し (liquid feed) in the product's own name, brass feed valve at the BOTTOM. Not a
 *      toggle: without its cans this stove is not itself.
 *    - a THREE-panel windscreen: the carry COVER stood up at the back, a wing hinged off each end
 *      swinging forward. Folded, the wings lie inside the cover -- which is why packed width is 500
 *      and deployed width 563: the wings swing out PAST the body. Drawn only when asked for
 *      (`windscreen`, which the part bench does): every photograph of the stove in a frame has
 *      the screen off, and its wings reach 31mm past each end of the body, into the neighbour.
 *
 *  `w` is the along-rail width -- 500, two units, which is what railW(span 4) gives and what the
 *  in-frame photo measures. The d/h a caller derives from assembled_mm describe the DEPLOYED
 *  envelope, not the body, so this builder does not take them. Rim at y = 0, pan hanging to -bodyH,
 *  windscreen (if asked for) standing above. */
export function gs230Group(w = 500, { seat = 360, h = 293, bodyH = 70, lid = false, windscreen = false } = {}) {
  const g = new THREE.Group();
  const steel = 0x9aa0a8, dark = 0x26292e, screen = 0xb4b9bf;
  const SPACING = 233;                       // head centres, measured in the frame
  // The well, off the plan view in a frame (02_5: the body 657px = 500): the deck is a narrow
  // 11mm strip at each end and about 35 front and back. (It was drawn 460 x 264.)
  const wellW = 478, wellD = 290, wellY = -48;
  const screenH = h - bodyH;                 // 223 -- what stands ABOVE the tabletop

  // The housing: a shallow pan, built as a deck flange round a sunken well rather than a solid
  // block, because the well IS what you see. Flange outer 500x360, inner 478x290.
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

  const rackMat = metal(0xdfe2e5, 0.9, 0.2);
  for (const sx of [-1, 1]) {
    const hx = sx * (SPACING / 2);
    // the head: an 88mm ported ring round a brass centre, with its nozzle below at 6 o'clock
    cyl(g, 44, 44, 16, 28, metal(0x4c5259, 0.5, 0.55), hx, wellY + 10, 0);
    cyl(g, 25, 25, 10, 24, metal(0x9c6b3a, 0.75, 0.4), hx, wellY + 18, 0);
    cyl(g, 5, 5, 22, 10, metal(0xb08a4a, 0.8, 0.35), hx, wellY - 4, 34);
    // the ゴトク: a wire rack over each burner, about 15 above the deck (hero). Traced off 02_5:
    // three dia 5 rods along z, 275 long on a 78 pitch -- the outer two pinched in to 38 either
    // side of the head, the middle one broken over it -- lying on a U-shaped loop 224 x 160 that
    // is open toward the middle of the stove. The rods' ends turn down into the well's edge.
    const rackY = 15, zR = 137;
    for (const c of [-1, 1]) {
      const xo = hx + c * 78, xi = hx + c * 38;
      bentTube(g, [[xo, -8, -zR], [xo, rackY, -zR], [xo, rackY, -56], [xi, rackY, -4], [xi, rackY, 4],
                   [xo, rackY, 56], [xo, rackY, zR], [xo, -8, zR]], 2.5, rackMat, { rad: 5 });
      bentTube(g, [[hx, -8, c * zR], [hx, rackY, c * zR], [hx, rackY, c * 50]], 2.5, rackMat, { rad: 5 });
    }
    bentTube(g, [[hx - sx * 112, rackY - 5, -80], [hx + sx * 112, rackY - 5, -80],
                 [hx + sx * 112, rackY - 5, 80], [hx - sx * 112, rackY - 5, 80]], 2.5, rackMat, { rad: 10 });
    // the knob, out under its own burner
    cyl(g, 13, 13, 23, 16, metal(0x1c1f24, 0.4, 0.6), hx, -40, seat / 2 + 11.5, Math.PI / 2);
    // The CANISTER, clamped INVERTED under the deck -- the 液出し of the product's own name,
    // so it is ALWAYS drawn: the GS-1000's can is 専用容器 bought separately and toggles, but
    // this stove without its two cans is not itself (the hero mounts both). Measured off the
    // hero against the 500mm face (152px): body 33px = φ108 -- the φ110-class can gs1000Group
    // already draws at r=54, NOT a slim bottle -- hung dead under its knob (centres read
    // ±115 ≈ SPACING/2, a second, independent scale check), top against the pan floor. It is
    // the 500 can, the only one the manual allows: in the hero (428px = the 500 face) its
    // shoulder ends 194 below the deck and the valve 210, so the body is 105 long (it was 68,
    // and stopped at -182). The brass feed valve is at the BOTTOM, under the domed shoulder --
    // valve-down is what liquid feed IS; the dark ring above is the socket the can twists up into.
    const canMat = metal(0xc8ccd0, 0.7, 0.4);
    const canZ = 150;                       // under the front deck, a little proud of the wall
    cyl(g, 30, 30, 14, 18, metal(dark, 0.5, 0.5), hx, -bodyH - 5, canZ);       // the socket ring
    cyl(g, 54, 54, 105, 24, canMat, hx, -bodyH - 64.5, canZ);                  // the can, base up
    cyl(g, 54, 34, 22, 24, canMat, hx, -bodyH - 128, canZ);                    // shoulder, now down
    cyl(g, 7, 7, 10, 10, metal(0xb08a4a, 0.8, 0.35), hx, -bodyH - 144, canZ);  // the brass feed valve
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
  if (!windscreen) return { group: g, body };      // in a frame: the screen is off

  // The windscreen, DEPLOYED. The back panel is the cover, 500 wide, standing on the back deck; each
  // wing hinges at its end and swings forward, splayed just enough to put its free edge at
  // x = +/-281.5 -- which is the published 563. Each wing TAPERS, tall at the hinge and falling to
  // its free edge (the fold-away plan p.7 and the hero both show the slope), so it is extruded from
  // an outline rather than boxed.
  // Half-metal: a mirror-metal panel standing upright reflects the dark half of the room and
  // rendered near black.
  const screenMat = metal(screen, 0.4, 0.5);
  box(g, w, screenH, 3, 1, screenMat, 0, screenH / 2, -(seat / 2 - 1.5));
  const WING = 250, TIP = 130, SPLAY = Math.asin((563 / 2 - w / 2) / WING);
  const wing = new THREE.Shape();
  wing.moveTo(0, 0); wing.lineTo(WING * MM, 0);
  wing.lineTo(WING * MM, TIP * MM); wing.lineTo(0, screenH * MM); wing.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 3 * MM, bevelEnabled: false });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(wingGeo, screenMat);
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
  // Its own 362 x 377, never the slot's: the caller's numbers are the 375 rail run and whichever
  // of the two published dimensions lies nearer it, and built from those the frame came out 408.
  if (bspec?.gp040) return gp040Group(p.assembled_mm?.w ?? 362, p.assembled_mm?.d ?? 377, h);
  // GS-230 is an appliance, and its assembled_mm describes the DEPLOYED envelope (563 over the
  // splayed windscreen, 383 over the knobs) rather than the body -- so the d/h the caller derives
  // cannot be used. It takes only the along-rail width, the one number that is right:
  // railW(span 4) = 500 = the two units the in-frame photo measures. Its own stand is not built:
  // that is for standing on the ground, and on the IGT you take it off (owner).
  if (bspec?.gs230) return gs230Group(w, { lid: cfg === "closed" });
  // The Flat Burner is built at its PLATE size (plate_mm, 250 x 360): its assembled_mm is the
  // stove standing on its wire legs, which it does not have in a frame.
  if (bspec?.flat450)
    return burnerGroup(bspec, p.plate_mm?.w ?? 250, p.plate_mm?.d ?? 360, h, topTex);
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
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }),
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

// The collapsible frame's END BAR (CK-902 / 903 / 904), measured off the plan photographs
// (gallery CK-903 02_*08522 and CK-904 02_*08520, both 0.553 px/mm, the frame's published 496
// across as the ruler) and read against the close-ups 05-09 and the hero:
//   - a brushed ALUMINIUM bar 42 along the frame (846 less the 762 rails, halved) and 476 long:
//     it stops 10mm short of the frame's side at each end;
//   - a black nylon block on the outer half of each end of the bar, 108 long: 26 deep for the
//     46mm that hold the hook hole (144 from the centre line, 16 from the end -- the standard
//     frame's hole to the millimetre), then a 15mm chamfer down to a 9mm-deep step for the last
//     47mm, and round the bar's end as a 3mm cap;
//   - in that step, a knurled aluminium thumbscrew (dia 20) pointing out along the frame, on the
//     leg socket's line: it is the bolt that takes the rail's end plate (close-up 08);
//   - between the blocks the bar's outer face carries a dark slot (hero).
const CBAR = { w: 42, inset: 10, block: 108, deep: 26, hole: 46, chamfer: 15, step: 9, cap: 3 };

/** One end bar of a collapsible frame, at the `sx` end. Adds to `g`, returns what to pick. */
function endBarInto(g, sx, { w, d, thick, barColor, blockColor, glow }) {
  const out = [];
  // the bar wears the standard rail's brushed finish; the nylon is dead matte
  const bar = metalE(barColor, 0.8, 0.42, glow), blk = metalE(blockColor, 0.1, 0.8, glow);
  const half = d / 2 - CBAR.inset;                       // the bar's half length, 238
  const X = u => sx * (w / 2 - u);                       // u = mm in from the frame's end face
  const put = (u0, u1, y0, y1, z0, z1, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry((u1 - u0) * MM, (y0 - y1) * MM, (z1 - z0) * MM), mat);
    m.position.set(X((u0 + u1) / 2) * MM, (y0 + y1) / 2 * MM, (z0 + z1) / 2 * MM);
    g.add(m); out.push(m);
  };
  const zIn = half - CBAR.block;                         // where the blocks stop: 130 from centre
  // the aluminium: the inner strip runs the whole bar, the outer half only between the blocks
  put(CBAR.deep, CBAR.w, 0, -thick, -(half - CBAR.cap), half - CBAR.cap, bar);
  put(0, CBAR.deep, 0, -thick * 0.2, -zIn, zIn, bar);
  put(1.5, CBAR.deep, -thick * 0.2, -thick * 0.58, -zIn, zIn, blk);    // the slot in the outer face
  put(0, CBAR.deep, -thick * 0.58, -thick, -zIn, zIn, bar);
  for (const sz of [-1, 1]) {
    // the nylon block in plan: hook-hole part, chamfer, step -- extruded the bar's full height
    const z1 = zIn + CBAR.hole, z2 = z1 + CBAR.chamfer, uS = CBAR.deep - CBAR.step;
    const s = new THREE.Shape([[0, zIn], [0, z1], [uS, z2], [uS, half], [CBAR.deep, half], [CBAR.deep, zIn]]
      .map(([u, z]) => new THREE.Vector2(X(u) * MM, sz * z * MM)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: thick * MM, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);                            // shape y -> z, the extrusion hangs from y = 0
    const m = new THREE.Mesh(geo, blk);
    g.add(m); out.push(m);
    put(CBAR.deep, CBAR.w, 0, -thick, sz > 0 ? half - CBAR.cap : -half, sz > 0 ? half : -(half - CBAR.cap), blk);
    // the thumbscrew: a knurled head on a short sprung shaft, out of the step's face
    const zT = sz * (half - 31), yT = -thick / 2 * MM;   // 207 from the centre line
    const head = new THREE.Mesh(new THREE.CylinderGeometry(10 * MM, 10 * MM, 5 * MM, 18),
      metalE(0xd2d5d8, 0.9, 0.3, glow));
    head.rotation.z = Math.PI / 2;
    head.position.set(X(5.5) * MM, yT, zT * MM);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.5 * MM, 4.5 * MM, (uS - 8) * MM, 10),
      metalE(0x9aa0a6, 0.85, 0.4));
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(X((uS + 8) / 2) * MM, yT, zT * MM);
    g.add(head, shaft);
  }
  return out;
}

/** The frame SHELL: two extruded rails, two ends, the hook holes and the four leg sockets. NO
 *  legs and NO modules -- those are placement, and the caller adds them. This is the exact
 *  geometry drawFrame used to build inline; it is here so the bench builds the identical frame
 *  (recess and all) instead of a slab.
 *
 *  Two families. The STANDARD frame is silver rails between two solid black end pieces. The
 *  COLLAPSIBLE one is black rails between two brushed-aluminium end bars with black nylon
 *  corner blocks (endBarInto), a silver plate on each rail end where the leg goes. (Until
 *  2026-11 the collapsible was drawn as the standard frame in black with a silver plate on each
 *  corner of the ring: an all-black ring, where the real one shows two bright bars.)
 *
 *  `section` is the measured rail cross-section (SECTION); `hookHoles` the measured hole
 *  centres, or null to fall back to the standard inset. `legAt(sx, sz)` says whether a leg
 *  stands in that corner's socket: its stud then shows bright in the hole, as in CK-175 a001,
 *  where the legless frame's sockets are empty holes. Returns { group, pick } -- pick is the
 *  rails + ends, for the planner to tag for selection; the bench ignores it. */
export function frameGroup({ w, d, thick, collapsible = false, section, hookHoles = null,
                             holeInset = 16.5, railColor, endColor = BLK_, plateColor = ALU_,
                             legInset = 75.5, legSide = 40.5, glow = 0x000000, legAt = null }) {
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
  // The rails run BETWEEN the end pieces, not under them. The joint photograph (CK-175 a001)
  // shows each rail butting a solid black block, and CK-149's plan view measures the silver at
  // 748 of the 846. The block is drawn 48 long -- the unit grid's own end allowance (W = 250n +
  // 96) -- so the rail is exactly the run of units; the measured 49.4 would tuck 1.4mm of block
  // under the first module's rim.
  // The collapsible's rails stop at its 42mm end bars instead: w - 84, which is the length the
  // rails are sold at (CK-902-1 / 903-1 / 904-1: 512 / 762 / 1012). The unit grid still starts
  // 48 in, so the bay there has 6mm to spare at each end.
  const blockW = collapsible ? CBAR.w : Math.min(endW, 48);
  for (const s of [-1, 1]) {
    // Black rails (the collapsible's) are the same anodised coating as the ends -- matte.
    const anodised = railColor === BLK_;
    const railMat = metalE(railColor, anodised ? 0.3 : 0.8, anodised ? 0.6 : 0.42, glow);
    railMat.vertexColors = true;   // the baked seat-crease shadow railProfile carries -- rails only
    const r = new THREE.Mesh(railProfile((w - 2 * blockW) * MM, thick * MM, prof, s), railMat);
    r.position.set(0, -thick / 2 * MM, s * (d / 2 - railWidth / 2) * MM);
    g.add(r); pick.push(r);
  }
  // End pieces -- anodised black on the standard frame; the hook holes live in them. A SOLID
  // block the full height of the rail, its top flush with the rail top and its outer face the
  // end of the frame. (From 2026-07 to 2026-11 this was a thin cap with a skirt, overhanging
  // 8mm each end, read off an in-use photo; the frame built 862 long against a published 846.
  // CK-175 a001 looks straight at the end of one: a block.) Matte, like all the anodising.
  for (const sx of [-1, 1]) {
    if (collapsible) {
      pick.push(...endBarInto(g, sx, { w, d, thick, barColor: plateColor, blockColor: endColor, glow }));
      continue;
    }
    // Its top and bottom edges are eased 2.5mm (the casting's are rounded about that much in
    // a001): two frames butted end to end then show their seam as a groove, where two sharp
    // boxes ran together into one black slab. The outline stays the full block.
    const block = new THREE.Mesh(easedBlock(blockW, thick, d, 2.5), metalE(endColor, 0.28, 0.62, glow));
    block.position.set(sx * (w - blockW) / 2 * MM, -thick / 2 * MM, 0);
    g.add(block); pick.push(block);
  }
  // The hook holes in the end pieces, where an extension's wire hooks drop in: two per end, at
  // the measured spacing. Always four -- the detector found only three of CK-149's, and a
  // frame has no end with one hole. A dark plug, a hair proud of the top face.
  const holeZ = hookHoleZ(hookHoles);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(6 * MM, 6 * MM, 12 * MM, 10),
      metalE(0x0e0f12, 0.2, 0.8));
    hole.position.set(sx * (w / 2 - holeInset) * MM, -5.8 * MM, sz * holeZ * MM);
    g.add(hole);
  }
  // The leg sockets. On the standard frame there is NO plate: four rivets and the leg stud's
  // hole sit in the rail's own top face, where the leg stands (CK-149 hero, CK-175 a001).
  // The collapsible's rail carries a 2mm silver plate there, riveted on: on the plan photo it
  // runs 43 to 97mm from the frame's end (it starts where the rail does), 11 to 69 from the
  // side, its hole 76 / 41 from the corner -- the planner's leg socket -- and its rivets 30
  // apart round the hole. Drawn 54 across, not 58: this rail's flat top is 65.5 wide (the
  // standard frame's section) and the plate must stop at the seat's step. (It was a 60 x 86
  // plate over the whole corner of the ring, which is where the end bar is.)
  const sockX = w / 2 - legInset, sockZ = d / 2 - legSide;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * sockX, cz = sz * sockZ;
    const legged = !!legAt && legAt(sx, sz);
    if (collapsible) {
      railPlateInto(g, sx * (w / 2 - CBAR.w - 28), sz * (d / 2 - 37.5), cx, cz, { plateColor, glow, legged });
      continue;
    }
    rivetsInto(g, [[cx - 17, cz - 12], [cx + 17, cz - 12], [cx - 17, cz + 12], [cx + 17, cz + 12]],
      -0.7, plateColor);
    socketStudInto(g, cx, 0, cz, legged);
  }
  return { group: g, pick };
}

/** A box (mm, centred) whose top and bottom edges are chamfered `c` all round, the four upright
 *  edges left sharp. Exactly w x h x d overall. */
function easedBlock(w, h, d, c) {
  const s = new THREE.Shape([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([x, z]) => new THREE.Vector2(x * MM, z * MM)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: (h - 2 * c) * MM, bevelEnabled: true,
    bevelThickness: c * MM, bevelSize: c * MM, bevelOffset: -c * MM, bevelSegments: 1 });
  geo.translate(0, 0, -(h / 2 - c) * MM);       // centre the extrusion, bevels included
  geo.rotateX(Math.PI / 2);                     // the extrusion stands up: shape y -> z
  return geo;
}

/** The z of a frame's hook holes: the mean of the measured centres, or the standard 143.9. */
export function hookHoleZ(hookHoles) {
  const zs = (hookHoles || []).map(hh => Math.abs(hh[1]));
  return zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 143.9;
}

/** What shows in a leg socket, in the face at height `top`: an empty socket is a dark hole;
 *  with a leg in it, the leg's stud fills the hole (CK-175 a001 shows both, side by side). */
function socketStudInto(g, x, top, z, legged) {
  const stud = new THREE.Mesh(new THREE.CylinderGeometry(5.5 * MM, 5.5 * MM, 3 * MM, 12),
    legged ? metalE(0xb4b8bc, 0.9, 0.3) : metalE(0x0e0f12, 0.2, 0.8));
  stud.position.set(x * MM, (top - (legged ? 0.9 : 1.3)) * MM, z * MM);
  g.add(stud);
}

/** The silver plate on the end of a collapsible rail: 54 x 54 x 2 centred at (px, pz), four
 *  rivets 30 apart round the leg socket's hole at (cx, cz). Shared by the frame and by the
 *  rail set sold on its own. */
function railPlateInto(g, px, pz, cx, cz, { plateColor = ALU_, glow = 0x000000, legged = false } = {}) {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(54 * MM, 2 * MM, 54 * MM),
    metalE(plateColor, 0.8, 0.42, glow));
  plate.position.set(px * MM, 1 * MM, pz * MM);
  g.add(plate);
  rivetsInto(g, [[cx - 15, cz - 15], [cx + 15, cz - 15], [cx - 15, cz + 15], [cx + 15, cz + 15]],
    1.2, 0x9da1a6);
  socketStudInto(g, cx, 2, cz, legged);
}

/** A knurled thumb knob standing on local y, its base at `y` (mm): a bright turned disc with a
 *  darker, rougher band round its edge -- at planner distance that band is all knurling shows. */
function knobInto(g, x, y, z, r, h) {
  const face = cyl(g, r, r, h, 20, metal(0xcfd3d6, 0.8, 0.42), x, y + h / 2, z);
  cyl(g, r + 0.3, r + 0.3, h * 0.7, 20, metal(0x878c92, 0.75, 0.6), x, y + h / 2, z);
  return face;
}

/** An IGT leg (CK-109 / 112 / 113 / 114): a straight tube with a black height-adjuster foot --
 *  measured, not styled. The leg heroes hold one diameter end to end (CK-113's tube scans 22-23px
 *  across its whole 588px length), so a drawn taper would be invented. The foot is the adjuster
 *  in CK-112's detail shots: a black sleeve on the tube a shade narrower at the waist, then a
 *  wider knurled cap rounded off underneath -- 33mm of black in all (CK-109's hero at
 *  0.584 mm/px: cap 29.2 across and 17.5 long, waist 23.4, against a 25mm tube). On top, the
 *  stud that goes up into the frame's socket: 11.7 across and 6.7 long on CK-109's hero, 11.0
 *  and 6.9 on CK-112's. The planner leaves the stud to the frame (frameGroup draws it in the
 *  socket) and asks for the tube alone; the bench shows the whole leg.
 *  `h` is the overall height drawn, stud included when asked for. Top at y = 0, foot at -h. */
export function legGroup({ h, r = 13, color = 0xc0c4c8, stud = false }) {
  const g = new THREE.Group();
  const black = metalE(0x2a2d31, 0.1, 0.85);
  const FOOT = 33, WAIST = 16, CAP = 12;         // the black stack, off CK-113's hero at 1.12mm/px
  const STUD = stud ? 7 : 0, tubeL = h - FOOT - STUD;
  const tube = cyl(g, r, r, tubeL, 16, metalE(color, 0.85, 0.3), 0, -STUD - tubeL / 2, 0);
  // the adjuster's waist, a shade narrower than the tube (21.5px against the tube's 23)
  cyl(g, r * 0.93, r * 0.93, WAIST, 14, black, 0, -h + FOOT - WAIST / 2, 0);
  // the knurled cap, barely wider than the tube (27px against 23), rounded off underneath
  cyl(g, r * 1.18, r * 1.18, CAP, 14, black, 0, -h + 7 + CAP / 2, 0);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 1.18 * MM, 12, 8), black);
  tip.scale.y = 0.45;
  tip.position.y = (-h + 7) * MM;
  g.add(tip);
  if (stud) cyl(g, 6, 6, STUD, 12, metalE(0xb4b8bc, 0.9, 0.3), 0, -STUD / 2, 0);
  return { group: g, body: tube };
}

/** IGT Connection Hook (CK-175): the fitting that joins two frames end to end. Its one product
 *  shot (gallery CK-175 03_c101) is a stainless U of round rod with a knurled knob on one leg;
 *  its one in-use shot (00_a001) shows where the U goes: UNDER the two end pieces. The knob
 *  stands on one frame's end piece over its hook hole, and the tip of the plain leg shows in
 *  the neighbour's hole. Nothing crosses the seam on top.
 *  Measured on c101 with the knob's published dia 28 as the ruler: rod dia 7, knob 10 tall on a
 *  dia 19 boss. Published 28 x 53 x 40. The legs are drawn 33 apart -- two hook holes, each 16.5
 *  in from its frame's end -- which makes the part 50.5 across against the published 53.
 *  Built as installed: y = 0 is the end piece's top face, the knob's leg at the origin, the
 *  plain leg `span` along +x. */
export function connectionHookGroup({ span = 33 } = {}) {
  const g = new THREE.Group();
  const steel = metal(0xc3c7cb, 0.8, 0.42);            // satin stainless: the rail's light response
  bentTube(g, [[0, 6, 0], [0, -20.5, 0], [span, -20.5, 0], [span, 1, 0]], 3.5, steel, { rad: 9, radial: 8 });
  cyl(g, 3.5, 3.5, 0.6, 8, steel, span, 1, 0);          // the plain leg's cut end, seen in the hole
  cyl(g, 9.5, 9.5, 6, 16, steel, 0, 3, 0);              // the knob's boss
  const knob = knobInto(g, 0, 6, 0, 14, 10);
  return { group: g, body: knob };
}

/** IGT Height Adjuster (CK-151; IGT段差ジョイント): the post a lower table hangs from. A stainless
 *  tube the diameter of a leg (25.4; a001 shows it beside one) that hangs UNDER the higher
 *  frame's end piece, held by a thumbscrew dropped through the hook hole into the tube's top.
 *  Measured on a004, the tube's published 25.4 and the 320 overall as rulers (4.4 px/mm):
 *  tube 294 long; two black rubber sleeves dia 37 x 44, starting 36 and 197 down; hook
 *  windows cut in one side, their seats 81, 150 and 241 down, engraved 400-300, 830-660 and
 *  660-400 -- a seat is 20 lower than its step, so the tube's top is 20 under the table top;
 *  a dia 23 knurled thumbscrew on a dia 10.5 boss. (It was a dia 18 rod with three rings.)
 *  The windows face +x. `gap` is how much thread shows between tube and knob: 16 as
 *  photographed, 20 when it is through an end piece. Tube top at y = 0, hanging to -294. */
export function heightAdjusterGroup({ gap = 16 } = {}) {
  const g = new THREE.Group();
  const steel = metal(0xc0c4c8, 0.85, 0.3), rubber = metal(0x1d1f22, 0.05, 0.85);   // a leg's tube, a leg's finish
  const dark = metal(0x17181b, 0.3, 0.7);
  const R = 12.7, L = 294;
  const tube = cyl(g, R, R, L, 20, steel, 0, -L / 2, 0);
  for (const y0 of [36, 197]) cyl(g, 18.5, 18.5, 44, 20, rubber, 0, -(y0 + 22), 0);
  box(g, 1.2, 45, 9, 0, dark, R - 0.2, -127.5, 0);                    // the open window, 105 to 150
  for (const s of [81, 150, 241]) box(g, 1.2, 6, 13, 0, dark, R - 0.2, -s, 0);   // the three seats
  cyl(g, 2.4, 2.4, gap, 8, steel, 0, gap / 2, 0);                     // the thumbscrew's thread
  cyl(g, 5.25, 5.25, 8, 12, steel, 0, gap + 4, 0);
  knobInto(g, 0, gap + 8, 0, 11.5, 4);
  return { group: g, body: tube };
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

/** Takibi My Table (LV-039; JP TAKIBI Myテーブル): the folding side table in fire-proof stainless.
 *  It was drawn as a slab on four round corner legs; it has no corner legs. Its manual names the
 *  parts (各部の名称: 天板, ピン, スタンド, 支柱, ハンギングバー) and the photographs show each:
 *
 *    天板        two stainless leaves hinged across the middle -- the long elevation (JP a001)
 *               shows the seam at half length -- with a turned-down edge that scales to 12mm
 *               against the published 496, and a stadium hand slot at each short end: 205 x 22,
 *               about 12 in from the end (a001, measured against the 332 depth; a002 close up).
 *    スタンド     two aluminium tube loops, each a U hinged under the seam and raked out to a foot
 *               bar. a001 solved as a camera (the top's four corners give its scale and a 19 deg
 *               tilt): pivot 30 below the top face, the foot tube's outer edge 246 from the
 *               centre, tube dia 18-19. The packed size agrees: pivot to foot 431 plus the tube is
 *               the published 450. The folded view (a004) gives the loop flat: arms 270 apart at
 *               the pivot flaring to 310 at the feet, and a foot bar HUMPED ~28mm in the middle,
 *               so the table stands on four short flats and not on two rails.
 *    支柱        one dia-4 wire U per end, from under the leaf 40 in from its end down to the
 *               arms' rivets, ~205 along from the pivot (a001: both wires end on the rivets).
 *    ハンギングバー a flat bar under each slot (a002 looks down through the slot at it).
 *
 *  Top at y = 0, feet at -h. */
export function myTableGroup(w = 496, d = 332, h = 400, color = 0xd4d4d4) {
  const g = new THREE.Group();
  const sheet = metalE(color, 0.6, 0.42);          // the leaves: brushed stainless sheet
  const alu = metal(0xdde0e3, 0.7, 0.42);          // the stand: satin aluminium tube
  const wire = metal(0xc9cdd1, 0.85, 0.3);
  const topT = 12, tubeR = 9.5, seam = 2;
  const slotL = 205, slotW = 22, slotIn = 12;
  const slotX = w / 2 - slotIn - slotW / 2;

  // One leaf, built once and turned for the other side: a rectangle from the seam to the end,
  // the slot punched THROUGH it (the stays and the hanging bar show through, as in the hero).
  const x0 = seam / 2 * MM, x1 = w / 2 * MM, hz = d / 2 * MM, cr = 4 * MM;
  const s = new THREE.Shape();
  s.moveTo(x0, -hz); s.lineTo(x1 - cr, -hz); s.quadraticCurveTo(x1, -hz, x1, -hz + cr);
  s.lineTo(x1, hz - cr); s.quadraticCurveTo(x1, hz, x1 - cr, hz); s.lineTo(x0, hz); s.closePath();
  const slot = new THREE.Path(), sr = slotW / 2 * MM, sl = (slotL - slotW) / 2 * MM;
  slot.absarc(slotX * MM, sl, sr, 0, Math.PI, false);
  slot.absarc(slotX * MM, -sl, sr, Math.PI, 2 * Math.PI, false);
  slot.closePath();
  s.holes.push(slot);
  const leafGeo = new THREE.ExtrudeGeometry(s, { depth: topT * MM, bevelEnabled: false, curveSegments: 6 });
  leafGeo.rotateX(-Math.PI / 2);
  leafGeo.translate(0, -topT * MM, 0);
  let body = null;
  for (const turn of [0, Math.PI]) {
    const leaf = new THREE.Mesh(leafGeo, sheet);
    leaf.rotation.y = turn;
    g.add(leaf);
    if (!body) body = leaf;
  }
  // The seam: the hinge knuckles fill it, so it reads as a dark line, not as daylight.
  box(g, seam + 0.8, topT - 2, d - 8, 0, metal(0x6b6f74, 0.5, 0.6), 0, -1 - (topT - 2) / 2, 0);

  // The stand. Each loop lives in its own raked plane: u runs from the pivot down the arm,
  // z across. The foot bar's centreline lands one tube radius above the ground.
  const yp = 30;                                   // pivot, below the top face
  const footX = w / 2 - 12;                        // foot bar centreline: 236 on the 496
  const drop = h - tubeR - yp;
  const L = Math.hypot(footX, drop), sin = footX / L, cos = drop / L;
  const zf = d / 2 - 11;                           // arm centreline at the foot: 155 on the 332
  for (const sx of [-1, 1]) {
    const P = (u, z) => [sx * u * sin, -yp - u * cos, z];
    // The two loops nest at the pivot, one inside the other by a tube's width.
    const zt = zf - 20 + sx * tubeR;
    bentTube(g, [P(-8, zt), P(L, zf), P(L, zf - 57), P(L - 28, 28),
                 P(L - 28, -28), P(L, -(zf - 57)), P(L, -zf), P(-8, -zt)], tubeR, alu,
      { rad: [0, 38, 45, 45, 45, 45, 38, 0], radial: 10 });
    // 支柱: one wire U, its cross run hinged under the leaf, its legs down to the arms.
    const us = 205, za = zt + (zf - zt) * us / L - tubeR - 2;
    const T = z => [sx * (w / 2 - 40), -topT - 2, z];
    bentTube(g, [P(us, za), T(za - 14), T(-(za - 14)), P(us, -za)], 2, wire, { rad: 6 });
    // ハンギングバー, under the slot.
    box(g, 12, 3, slotL + 30, 0, wire, sx * (slotX + 4), -topT - 6, 0);
  }
  // ピン: the hinge pins the arms turn on, one at each long side.
  for (const sz of [-1, 1]) cyl(g, 4, 4, 2 * tubeR + 22, 8, wire, 0, -yp, sz * (zf - 20), Math.PI / 2);
  return { group: g, body };
}

/** Connection Table (LV-381; JP コネクションテーブル): a heat-proof painted stainless top on two
 *  folding leg frames, the table that joins the Jikaro. It borrowed the bamboo shelf's builder in
 *  black, whose end X-frames are wider than this table: the feet landed outside the top on all
 *  four sides. Its own photographs, against the published 840 x 420 x 400:
 *
 *    top     a flat tray-edged sheet about 22 thick with its four corners CLIPPED ~25 (plan view,
 *            LV-3812). It photographs charcoal, #585855 on a #28292d ground, not black.
 *    legs    two inverted-U tube frames (LV-3812 shows one laid flat), each a bar under the top
 *            with a leg at either end, crossing as an X seen from the end. End elevation
 *            (LV-3811, top 411 px = 420): the bars sit 100 either side of the centre line, the
 *            feet land 166 the OTHER side. Side elevation (LV-38113): leg tops ~75 in from each
 *            end, feet ~60 in, the two frames nested one inside the other. Tube dia ~18.
 *
 *  Top at y = 0, feet at -h. */
export function connTableGroup(w = 840, d = 420, h = 400, { top = 0x4a4a48, frame = 0x2a2c30 } = {}) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(top), metalness: 0.25, roughness: 0.7 });
  const tubeMat = metalE(frame, 0.3, 0.6);
  const rubber = metalE(0x17181b, 0.05, 0.9);
  const topT = 22, ch = 25, tubeR = 9, capH = 26;
  const hw = w / 2 * MM, hd = d / 2 * MM, c = ch * MM;
  const s = new THREE.Shape();
  s.moveTo(-hw + c, -hd); s.lineTo(hw - c, -hd); s.lineTo(hw, -hd + c); s.lineTo(hw, hd - c);
  s.lineTo(hw - c, hd); s.lineTo(-hw + c, hd); s.lineTo(-hw, hd - c); s.lineTo(-hw, -hd + c);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: topT * MM, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -topT * MM, 0);
  const body = new THREE.Mesh(geo, paint);
  g.add(body);
  const barY = -topT - tubeR - 1, footY = -h + capH - 4;
  for (const sz of [-1, 1]) {
    const nest = sz > 0 ? 0 : 2 * tubeR;         // the second frame sits inside the first
    const tx = w / 2 - 75 - nest, fx = w / 2 - 60 - nest, tz = sz * 100, fz = -sz * 166;
    bentTube(g, [[-fx, footY, fz], [-tx, barY, tz], [tx, barY, tz], [fx, footY, fz]], tubeR, tubeMat,
      { rad: 30, radial: 8 });
    for (const sx of [-1, 1]) cyl(g, 11, 13, capH, 10, rubber, sx * fx, -h + capH / 2, fz);
  }
  return { group: g, body };
}

// ---- the self-contained tables (Entry IGT, IGT Slim, Extension IGT): shared small pieces ----

/** A flat plate cut to an outline. `pts` is the outline in mm as [a, b] in the plate's own
 *  plane; `ea` and `eb` are the world directions of those two axes (perpendicular), `at` the
 *  world point (mm) the outline's origin sits on, and the plate is `thk` mm thick, centred on
 *  that plane. With ea = z and eb = y it is a bar of constant section running along x. */
function plate(g, pts, thk, mat, at, ea, eb) {
  const s = new THREE.Shape();
  pts.forEach(([a, b], i) => (i ? s.lineTo(a * MM, b * MM) : s.moveTo(a * MM, b * MM)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: thk * MM, bevelEnabled: false });
  geo.translate(0, 0, -thk / 2 * MM);
  const m = new THREE.Mesh(geo, mat);
  const A = new THREE.Vector3(...ea).normalize(), B = new THREE.Vector3(...eb).normalize();
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(A, B, new THREE.Vector3().crossVectors(A, B)));
  m.position.set(at[0] * MM, at[1] * MM, at[2] * MM);
  g.add(m);
  return m;
}

/** A flat link bar from a to b (mm), `wid` wide in the vertical plane it lies in and `thk` thick
 *  across it -- the stays that lock a folding leg open. a and b share one z. */
function flatLink(g, a, b, wid, thk, mat) {
  const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
  const m = new THREE.Mesh(new THREE.BoxGeometry(wid * MM, va.distanceTo(vb), thk * MM), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  g.add(m);
  return m;
}

/** Lay a wood texture on a board as seen from ABOVE: each vertex takes its uv from where it sits
 *  in plan -- `fn(x, z)` in mm, mesh-local, returns [u, v]. A box's own unwrap runs u along x on
 *  the top face, and every wood texture here (photo crop or proctex canvas) runs its grain along
 *  u, so left alone the grain always follows the table's LENGTH; the Entry's boards and the
 *  Slim's slats run the DEPTH. The thin edges take the streak under them, which is what an edge
 *  of long-grain wood shows. */
function planUV(geo, fn) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const [u, v] = fn(p.getX(i) / MM, p.getZ(i) / MM);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

// The Slim's teak panels are thinner than the Entry's bamboo boards; its pipes hang under them.
const SLIM_PANEL = 10, ENTRY_BOARD = 12;

/** Entry IGT (CK-080R; CK-080R-EC is the same table powder-coated black): a 3-unit IGT frame of
 *  two aluminium extrusions and two end plates on two folding U-bent tube legs. Its bamboo top
 *  is REMOVABLE (2x one-unit + 2x half-unit pieces, no SKU) so IGT units drop in; the top is
 *  drawn by igtWoodTop per free half-unit, so this builds only the frame + legs. Top at y = 0.
 *
 *  Measured off Snow Peak's own shots against the published 833 x 440 x 400:
 *  - PLAN (CK-080R-EC 08527, straight down, 0.90 mm/px): long rails 37-38 wide, end plates 37-39,
 *    bamboo 756 x 365 between them. So the rails are 40 with their inner edges 360 apart -- the
 *    IGT seat -- and the boards FILL the frame. (It used to be a 12mm ring with a 28mm
 *    see-through gap all round the boards.)
 *  - SIDE (04987 front, 1.41 mm/px): the rail face is 44-47 tall, a proud top lip over a set-back
 *    web. Bare frame (04978): a shelf runs down the inside of each rail a board's thickness below
 *    the top; boards and unit rims rest on it.
 *  - The END PLATE is a sheet lying ON the rail ends, folded down over the end as a skirt about
 *    36 tall with clipped lower corners (04992 end-on). Its two hook holes measure 14 in and 147
 *    either side of centre in the plan shot -- the standard frame's 16.5 and 143.9 to within the
 *    photo's 3 px, and the same extension tables hook into both, so the standard numbers are used.
 *  - LEGS (04977 hero, 04987, 04992): one bent tube per end, about 16 through. The uprights are
 *    ~340 apart (they stand under the rails' inner edges, not out at the corners), leave the frame
 *    45 inside the end and reach the ground 15 inside it -- 833 is the frame and nothing passes
 *    it (the feet used to land 18 OUTSIDE, 886 over all). The run between the feet lifts in a
 *    shallow arch; a black block with a levelling screw sits under each bend (05047); a flat
 *    stay locks each upright to the rail (05038).
 *  The photo's frame sides read #c0bfba; at metalness 0.85 with nothing to reflect they drew
 *  #676a6f, so the bare aluminium is 0.5 here. */
export function entryIgtGroup(w, d, height, { black = false } = {}) {
  const g = new THREE.Group();
  const alu = black ? metalE(0x26282c, 0.3, 0.6) : metalE(0xd0d3d7, 0.5, 0.42);
  const railW = 40, railH = 45, shelf = 14;
  const zo = d / 2, zi = zo - railW;                 // 220 / 180: the rail's outer face, its inner edge
  // the two rails, full length: lip, set-back web, and the shelf inside
  for (const s of [-1, 1])
    plate(g, [[zo, 0], [zo, -18], [zo - 4, -18], [zo - 4, -railH], [zi + 4, -railH],
              [zi + 4, -ENTRY_BOARD - 6], [zi - shelf, -ENTRY_BOARD - 6], [zi - shelf, -ENTRY_BOARD],
              [zi, -ENTRY_BOARD], [zi, 0]].map(([z, y]) => [s * z, y]),
      w, alu, [0, 0, 0], [0, 0, 1], [0, 1, 0]);
  // end plates: a 3mm sheet on the rail ends (1mm proud, as a sheet laid on is), its skirt, its holes
  const hole = metalE(0x0e0f12, 0.2, 0.8);
  for (const ex of [-1, 1]) {
    box(g, railW, 3, d, 0, alu, ex * (w / 2 - railW / 2), -0.5, 0);
    plate(g, [[-zo, -2], [zo, -2], [zo - 20, -38], [-(zo - 20), -38]], 3, alu,
      [ex * (w / 2 - 1.5), 0, 0], [0, 0, 1], [0, 1, 0]);
    for (const sz of [-1, 1]) cyl(g, 4.5, 4.5, 3.6, 10, hole, ex * (w / 2 - 16.5), -0.6, sz * 143.9);
  }
  // the legs: bent tube, uprights raked out from 45 inside the end to 15 inside it
  const legMat = black ? metalE(0x1e2024, 0.3, 0.6) : metalE(0xc9ccd0, 0.55, 0.38);
  const stayMat = black ? legMat : metalE(0xb4b7bb, 0.6, 0.35);
  const footMat = metalE(0x1b1c1f, 0.1, 0.85);
  const zs = zo - 48, xt = w / 2 - 45, xf = w / 2 - 15;       // uprights 344 apart
  const yT = -(railH - 8), yB = -(height - 22);                // tube centre: in the rail / at the bend
  for (const ex of [-1, 1]) {
    bentTube(g, [[ex * xt, yT, -zs], [ex * xf, yB, -zs], [ex * xf, yB + 26, -(zs - 110)],
                 [ex * xf, yB + 26, zs - 110], [ex * xf, yB, zs], [ex * xt, yT, zs]],
      8, legMat, { rad: [0, 30, 110, 110, 30, 0], radial: 8 });
    for (const sz of [-1, 1]) {
      box(g, 20, 22, 26, 0, footMat, ex * xf, -(height - 23), sz * (zs - 9));     // the foot block
      cyl(g, 10, 10, 8, 12, footMat, ex * xf, -(height - 4), sz * (zs - 9));      // its levelling screw
      cyl(g, 3, 3, 6, 8, footMat, ex * xf, -(height - 10), sz * (zs - 9));
      const ys = -railH - 33, xs = xt + (xf - xt) * (yT - ys) / (yT - yB);        // 33 down the upright
      flatLink(g, [ex * xs, ys, sz * (zs + 11)], [ex * (xs - 70), -railH + 3, sz * (zs + 11)], 10, 2, stayMat);
    }
  }
  return { group: g, body: g.children[0] };
}

/** The removable custom top of a self-contained IGT (Entry/Slim): wood boards over the FREE
 *  half-units of the 3-unit run, so a dropped module simply takes a board's place -- which is
 *  exactly how the real tops lift out. `skip` = occupied half-slot indices; `wood` "bamboo" or
 *  "teak"; `color` the untextured bamboo fallback; `d` the body depth. `pieces` is the real piece
 *  split as half-unit spans: the Entry top is [1, 2, 1, 2] -- a half, a one-unit, a half, a
 *  one-unit, THREE seams (CK-080R-EC's plan shot measures 127 / 251 / 127 / 250 mm across the
 *  run). A piece draws as ONE board while every half under it is free and falls back to its
 *  halves when a module lands mid-piece, so lift-out-per-half still works. No `pieces` = one
 *  board per half-unit, which is the Slim's six panels.
 *
 *  The boards BUTT: the loose pieces in CK-080R 05012 lie edge to edge and the plan shots show a
 *  hairline, so the joint is 1.5mm (it was 4), and each board is 358 deep in the 360 seat.
 *  GRAIN: bamboo strips run the DEPTH of every Entry board (the plan shot). One tile covers a
 *  board's depth, and across the strips a tile is 320mm (as on every other bamboo board in the
 *  planner), each board starting far enough into it that no tile edge falls inside a board --
 *  the photo crop does not repeat cleanly and its edge showed as a line. Teak: each Slim panel is TWO
 *  slats running the depth (CK-180 alt04/alt05 -- twelve slats across the six panels). The teak
 *  texture, photo or canvas, is five planks along u with a groove at every v = k/5, so a panel
 *  takes 0.4 of v: two planks, a groove down its middle and one at each edge. (It was one tile
 *  across and two up the depth: grain along the table, and a band across the middle of every
 *  panel that read as a 6 x 2 grid.) Tiles hang just below y = 0. */
export function igtWoodTop({ units, color, skip = [], d, wood = "bamboo", thick = null, tex = null, pieces = null }) {
  const g = new THREE.Group();
  const teak = wood === "teak";
  thick = thick ?? (teak ? SLIM_PANEL : ENTRY_BOARD);
  // `tex` is a crop of the wood itself and already carries its colour, so a textured top takes NO
  // tint -- multiplying bamboo by a bamboo `color` squared it to orange. `color` is the untextured
  // fallback only.
  const mat = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : (teak ? 0x986d50 : color),
    map: tex || null, roughness: 0.62, metalness: 0.03 });
  const HALF = 125, run = units * 250, tileD = Math.min(d - 40, 360) - 2, gap = 1.5, TILE = 320;
  const skipSet = new Set(skip);
  const board = (i, span) => {                        // one board over half-slots i..i+span-1
    const cx = -run / 2 + (i + span / 2) * HALF;
    const geo = roundedBox((span * HALF - gap) * MM, thick * MM, tileD * MM, 1 * MM);
    if (tex) planUV(geo, teak
      ? (x, z) => [z / tileD + 0.5, (i + x / HALF + span / 2) * 0.4]
      : (x, z) => [z / tileD + 0.5, 0.02 + (i % 3) * 0.1 + (x / HALF + span / 2) * HALF / TILE]);
    const tile = new THREE.Mesh(geo, mat);
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

/** IGT Slim (CK-180): a 3-unit run of six lift-out teak panels between two teak end bars, on
 *  stainless pipes, standing on two black wire legs. The manual's material line is ステンレス、
 *  天然木（チーク）、スチール（カチオン電着塗装）: pipes stainless, bars and panels teak, legs
 *  black-coated steel. Nothing hooks onto it (no end holes, no rail). The panels are drawn by
 *  igtWoodTop; this builds the bars, pipes and legs. `tex` = the teak the top wears. Top at y = 0.
 *
 *  `w` is the published 940, and that is the span over the FEET, not the top: the manual gives
 *  サイズ 940 x 403 x 408 and 収納サイズ 852 x 403 x 80 -- it packs SHORTER than it stands. (The
 *  top used to be built 940 long with the legs raking a further 44 out each end: 1037.)
 *  - PLAN (alt04, straight down; the bars' 403 = 288 px, 1.40 mm/px): bar to bar 823; each teak
 *    bar 31 wide; the six panels run 744. The bare frame from above (JP a001, 0.76 mm/px) gives
 *    829 and 34. So the top is 824 and the bars 31, with a steel bracket plate on each bar's
 *    inner face (the silver line between bar and panels in alt04, the silver flank in alt02).
 *    (The bars were 50 wide and stood 45 clear of the panels with bare pipe between.)
 *  - BAR height 37: its end face in the JP lifestyle shot 2, 43 px against the 403's 465.
 *  - PIPES: a pair under each long edge, about 12 through, 18 apart (a001). In plan only the
 *    outer one shows, 7-14 inside the bar ends; the inner one carries the panel ends.
 *  - LEGS (hero, alt02, JP shot 2 end-on, a001 folded): one bent wire per end. It leaves the
 *    bracket under the bar as a short stub pointing outward, turns down just outside the bar,
 *    and rakes out to a V-shaped foot; the uprights are 284 apart at the top and 350 at the
 *    feet. Between the two feet the wire steps UP 30 and runs straight (186 long), so the table
 *    stands on four points. The V-points are what reach +/-470.
 *  The bars sample darker than the slats (alt04: #714d34 against #966a4c), so they take the
 *  same teak tinted down. */
export function slimIgtGroup(w, d, height, { tex = null } = {}) {
  const g = new THREE.Group();
  const topL = 824, barW = 31, barH = 37, plateT = 4;
  const teak = new THREE.MeshStandardMaterial({ color: tex ? 0xb8b4b0 : 0x714d34,
    map: tex || null, roughness: 0.62, metalness: 0.03 });
  for (const sx of [-1, 1]) {
    const geo = roundedBox(barW * MM, barH * MM, d * MM, 3 * MM);
    // one plank of the teak texture down the bar's length, clear of its grooves
    if (tex) planUV(geo, (x, z) => [z / d + 0.5, (sx > 0 ? 0.63 : 0.03) + (x / barW + 0.5) * 0.14]);
    const c = new THREE.Mesh(geo, teak);
    c.position.set(sx * (topL / 2 - barW / 2) * MM, -barH / 2 * MM, 0); g.add(c);
  }
  const steel = metalE(0xc8ccd2, 0.6, 0.32);
  const inner = topL / 2 - barW - plateT;               // where pipes and panels start: 377
  for (const sx of [-1, 1])                             // the bracket plate on each bar's inner face
    box(g, plateT, barH - 3, d - 6, 0, steel, sx * (inner + plateT / 2), -(3 + (barH - 3) / 2), 0);
  const pipeR = 6;
  for (const sz of [-1, 1]) for (const zIn of [12.5, 30.5]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(pipeR * MM, pipeR * MM, 2 * inner * MM, 12), steel);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, -(SLIM_PANEL + pipeR) * MM, sz * (d / 2 - zIn) * MM); g.add(r);
  }
  // the wire legs -- the one part that IS the black steel
  const wire = metalE(0x1c1e22, 0.4, 0.5), wr = 3;
  // The V is a bend, not a point: its fillet rounds off about 0.5 of the reach and 1.6 of the drop, so
  // the corner is set that much further out for the WIRE to touch +/-w/2 and the ground.
  const xs = topL / 2 + 12, xv = w / 2 - wr + 0.5;      // upright top, just outside the bar; the V-point
  const yS = -(barH + 6), yV = -(height - wr) - 1.6, lift = 30;
  const zt = 142, zv = 175, zb = 93;
  const xb = xv - (xv - xs) * lift / (yS - yV);         // the raised run stays in the leg's plane
  for (const ex of [-1, 1])
    bentTube(g, [[ex * (xs - 34), yS, -zt], [ex * xs, yS, -zt], [ex * xv, yV, -zv],
                 [ex * xb, yV + lift, -zb], [ex * xb, yV + lift, zb],
                 [ex * xv, yV, zv], [ex * xs, yS, zt], [ex * (xs - 34), yS, zt]],
      wr, wire, { rad: [0, 12, 5, 14, 14, 5, 12, 0] });
  return { group: g, body: g.children[0] };
}

/** Extension IGT (CK-090): two laminated-bamboo tops on a black aluminium stand, each sliding
 *  one unit outward to open a 2-unit IGT bay over the stand's middle. `w` is the length over the
 *  TOPS (840 closed / 1348 open), `bayW` the unit run the open bay hosts (0 when closed). Top at
 *  y = 0. Returns { group, body, bay } -- bay = { w, d, y } of the exposed slot (y = where a
 *  unit's top face sits, relative to the bamboo), or null.
 *
 *  The STAND never changes: the legs belong to it, and open, each top cantilevers about 170 past
 *  the feet. (Until 2026-11 the legs hung off the ends of the current top width -- 1550 over the
 *  feet when open -- inside a black ring drawn round the whole footprint, with silver lipped
 *  rails framing the bay. None of the three exists.) Measured off the product elevations,
 *  scaled by the published 1348 / 840 / 498 / 400:
 *  - alt_10 (open, side-on, 1.85 mm/px): tops 421 each with 509 between them; the stand's beam
 *    828 long and 44 tall directly under the 18 bamboo; foot centres 1009 apart. alt_09 (closed,
 *    0.68 mm/px in the crop): the same feet, 84 beyond each end of the 840.
 *  - alt_11 (end-on, 0.43 mm/px): bamboo 18 thick and the widest thing there is; a grey end
 *    apron 47 tall, 439 wide at its top edge and 417 at its foot; the leg's two struts 340 apart
 *    and 21 across; the rung a flat bar 26 tall with a gusset at each end, about half way down.
 *    Outside the apron, hard under the bamboo, the black end of the runner each top slides on
 *    (11 x 22): alt_10 shows it running the length of each top, which is the black line under
 *    the cantilevered bamboo in every 3/4 view.
 *  - alt_07 / alt_02 (the open bay from above): the bamboo edges are bare, and the bay is
 *    framed by the stand's own two black rails -- a flat top about 40 wide with a shallow step
 *    down its inner edge. That step is the unit seat: the rails' inner edges are the IGT 360
 *    apart. alt_04, alt_08 and alt_03 (burners installed) show where a unit ends up: its rim
 *    level with the black rails, a bamboo-thickness BELOW the table top -- which is why the
 *    table ships two metal guards for the bamboo edges (天板保護パーツ; not drawn).
 *  - The struts are flat bar, 34 across at the top tapering to 17 at the foot, raked from 44
 *    inside the closed table's end at the stand to 86 outside it on the ground; a short flat
 *    stay (the manual's 補強バー, four of them) ties each to the stand. */
export function extIgtGroup(w, d, height, { bayW = 0, bayD = 360, tex = null } = {}) {
  const g = new THREE.Group();
  const SLAB = 420, TOP = 18, STAND = 828, RAIL_H = 45;
  const bamboo = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0xd8bd86, map: tex || null, roughness: 0.62, metalness: 0.03 });   // a map carries the colour; see igtWoodTop
  const black = metalE(0x1c1d20, 0.3, 0.6);          // the stand and legs are painted matte black
  const zi = bayD / 2, zo = zi + 40;                 // 180 / 220: a stand rail's inner edge and outer face
  // the two bamboo tops, bare, the outermost thing in plan; and the runner under each long edge
  for (const sx of [-1, 1]) {
    const cx = sx * (w / 2 - SLAB / 2);
    const slab = box(g, SLAB, TOP, d, 1, bamboo, cx, -TOP / 2, 0);
    // the strips run the table's length (alt_11 shows their end grain on the short edge): one
    // tile along each top, so no seam crosses the grain, and two across
    if (tex) planUV(slab.geometry, (x, z) => [x / SLAB + 0.5, z / (d / 2) + (sx > 0 ? 0.37 : 0)]);
    for (const sz of [-1, 1]) box(g, SLAB, 22, 11, 0, black, cx, -TOP - 11, sz * (zo + 5.5));
  }
  // the stand: two rails with the unit seat down their inner edges, closed by the grey end aprons
  for (const s of [-1, 1]) {
    const railMat = metalE(0x1c1d20, 0.3, 0.6);
    railMat.vertexColors = true;                     // the baked seat-crease shadow railProfile carries
    const r = new THREE.Mesh(railProfile(STAND * MM, RAIL_H * MM,
      { outerWall: 6 * MM, channel: 34 * MM, lip: 12 * MM }, s), railMat);
    r.position.set(0, -(TOP + RAIL_H / 2) * MM, s * (zo - 26) * MM);
    g.add(r);
  }
  const apron = metalE(0x606164, 0.25, 0.6);         // alt_11 samples #4d4c4d against the legs' black
  for (const ex of [-1, 1])
    plate(g, [[-zo, -TOP], [zo, -TOP], [zo - 11, -TOP - 47], [-(zo - 11), -TOP - 47]], 3, apron,
      [ex * (STAND / 2 - 1.5), 0, 0], [0, 0, 1], [0, 1, 0]);
  // the legs, on the stand: flat tapered struts, a gusseted rung, a stay to each strut
  const footMat = metalE(0x141517, 0.1, 0.85);
  const yT = -(TOP + RAIL_H), yB = -(height - 10), zs = 170;
  for (const ex of [-1, 1]) {
    const xT = 376, xB = 506;                        // strut centreline: under the stand / at the foot
    for (const sz of [-1, 1]) {
      plate(g, [[ex * (xT - 17), yT], [ex * (xT + 17), yT], [ex * (xB + 8.5), yB], [ex * (xB - 8.5), yB]],
        21, black, [0, 0, sz * zs], [1, 0, 0], [0, 1, 0]);
      box(g, 24, 12, 25, 0, footMat, ex * xB, -(height - 6), sz * zs);
      const xs = xT + (xB - xT) * 32 / (yT - yB);    // the stay: 32 down the strut, 88 inboard
      flatLink(g, [ex * xs, yT - 32, sz * (zs + 13)], [ex * (xs - 88), yT + 2, sz * (zs + 13)], 10, 3, black);
    }
    const len = Math.hypot(xB - xT, yT - yB), b0 = len * 0.45, zr = zs - 10.5;
    plate(g, [[-zr, b0], [zr, b0], [zr, b0 + 60], [zr - 62, b0 + 26], [-(zr - 62), b0 + 26], [-zr, b0 + 60]],
      10, black, [ex * xT, yT, 0], [0, 0, 1], [ex * (xB - xT), yB - yT, 0]);
  }
  return { group: g, body: g.children[0], bay: bayW > 0 ? { w: bayW, d: bayD, y: -TOP } : null };
}

/** Snow Peak Folding Chair (LV-077): a director's chair that folds side to side. A crossing X in
 *  the front face and one in the back face, each member running from a seat corner down to the
 *  OPPOSITE side's floor skid; the skids are long tubes lying on the ground, projecting ahead of
 *  the front X and behind the back one. Seat rails, arm tubes in padded sleeves, and back posts
 *  that stand plumb to the arms and then rake. Canvas (or mesh) seat sling and back panel.
 *  Feet at y = 0, faces +z.
 *
 *  (The X was drawn widest at the floor, 566, on rails only as long as the seat, and the back
 *  leaned 7 degrees.)
 *
 *  Off the LV-077GY set: alt_06, side-on, is 417 px deep by 591 tall, so the published 594 runs
 *  from the skid's front end to the top of the raked back; the skid is about 545 long (the
 *  packed 580 agrees), 64 past each X; the X's stand 415 apart and are plumb in this view down to
 *  about 150, then sweep out to the skid's ends; the back rakes 23 degrees above the arms, its
 *  top 110 behind the rear X. alt_05, front-on: skids 396 apart against 504 at the seat corners,
 *  so the X NARROWS to the floor; arm sleeves are the 566. */
export function foldingChairGroup(w, d, h, { frame = 0x232528, fabric = 0x8c8279, seatH = 457, canvasTex = null, meshAlpha = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.5, 0.45);
  // Canvas (a woven map, tinted) or a see-through mesh (a perforated alphaMap over dark fabric).
  const cloth = meshAlpha
    ? new THREE.MeshStandardMaterial({ color: fabric, alphaMap: meshAlpha, transparent: true, alphaTest: 0.12, roughness: 0.85, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  const R = 9, tube = (pts, rad = 0, r = R) => bentTube(g, pts, r, tubeMat, { rad, radial: 8 });
  const sw = 252, fx = 198;                           // half-widths: seat corners, floor skids
  const zF = d / 2 - 64, zB = zF - 415;               // the front and back X planes
  const zS0 = d / 2 + 2, zS1 = zB - 64;                 // skid ends: the corners its rounded ends turn about
  const armH = seatH + 150, xa = w / 2 - 25, padR = 25, rake = 23 * Math.PI / 180;
  const kneeY = 150, kx = t => -sw + (fx + sw) * t;   // an X member's x, t = how far down it is
  for (const s of [-1, 1]) {
    // One tube per floor side: down the front X from the far seat corner, along the floor, up the back X.
    const k = (seatH - kneeY) / (seatH - R);
    // (the two members of each X lap, a tube's width apart)
    const o = s * (R + 0.5);
    tube([[-s * sw, seatH, zF + o], [s * kx(k), kneeY, zF + o], [s * fx, R, zS0], [s * fx, R, zS1], [s * kx(k), kneeY, zB + o], [-s * sw, seatH, zB + o]],
      [0, 70, 40, 40, 70, 0]);
    tube([[s * sw, seatH, zF], [s * sw, seatH, zB]]);                                   // seat rail
    // arm: up from the seat's front corner, back along the arm, into the back post
    tube([[s * sw, seatH, zF], [s * xa, armH, zF], [s * xa, armH, zB]], 28, 8);
    cyl(g, padR, padR, zF - zB - 70, 12, cloth, s * xa, armH, (zF + zB) / 2 - 5, Math.PI / 2);   // the padded sleeve
    // back post: plumb to the arm, then raked
    tube([[s * sw, seatH, zB], [s * sw, armH - 7, zB], [s * sw, h - 4, zB - (h - 4 - (armH - 7)) * Math.tan(rake)]], 30, 8);
  }
  // seat sling: bellied ~15mm between the side rails
  const seat = new THREE.Mesh(slingPanel(2 * sw, 15, 12, zF - zB), cloth);
  seat.position.set(0, (seatH + 7) * MM, zB * MM);
  g.add(seat);
  // the back panel: 215 tall, raked WITH the posts, bowed ~10 around them away from the sitter,
  // its top edge at the post tops
  const bh = 215;
  const yb = h - 3 - bh * Math.cos(rake), zb = zB - (yb - (armH - 7)) * Math.tan(rake);
  const back = new THREE.Mesh(slingPanel(2 * sw + 20, -10, 14, bh), cloth);
  back.rotation.x = -Math.PI / 2 - rake;   // stand the panel up, leaning with the posts
  back.position.set(0, yb * MM, zb * MM);  // bottom edge on the posts, top landing at h
  g.add(back);
  return { group: g, body: seat };
}

/** Snow Peak Low Beach Chair (LV-091) and Luxury Low Beach Chair (LV-093): a low reclined
 *  sling chair that folds on a side scissor and a lateral X. Each side: a FRONT LEG raked back
 *  from its foot to a steel bracket under the bamboo arm; a SEAT BAR pivoted on the seat rail,
 *  crossing the leg and running down and back to a short floor skid; a seat rail and a back
 *  post inside the cloth's edges. Across the back, two bars from the back hinges down to the
 *  opposite skids. One canvas runs from a roll over the front tube, through the seat, up the
 *  back and over the top tube. Feet at y = 0, faces +z; the lip is the front of the box and the
 *  skid ends the rear.
 *
 *  (It stood on four splayed legs joined by two full-width floor tubes -- neither exists -- at
 *  a depth hard-coded whatever `d` said, the arms 76 low, the back top 21 short.)
 *
 *  From the side view in the LV-091 gallery (LowPng, black frame, scaled by the 400 mm table
 *  standing beside it): front foot 57 behind the lip, leg top 365 behind it and 419 up; seat
 *  pivot 95 behind the lip at 322; leg and bar cross about 220 up; back hinge 391 behind the
 *  lip; skid 127 long, its end 579 behind the lip (the published depth); arm top 468, arm
 *  244 long; back 24 degrees off plumb. The rear views (lv-091_reverse, LV-093 alt_07) show the
 *  lateral X and the plumb-looking front legs outboard of it. The back leans its 24 degrees
 *  unless that would carry its top past the skids, in which case the depth wins. */
export function lowBeachChairGroup(w, d, h, { frame = 0xbfc3c7, fabric = 0xc6b487, wood = 0xd8bd86, seatH = 300, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.45, 0.42);
  const steel = metal(0xc9ccd0, 0.6, 0.35);
  const rubber = metalE(0x1c1e22, 0.1, 0.85);
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.92, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.55, metalness: 0.03 });
  const R = 9, z0 = d / 2;
  const tube = (pts, rad = 0) => bentTube(g, pts, R, tubeMat, { rad, radial: 8 });
  const xa = w / 2 - 22.5, xs = xa - 23;                // front legs under the arms; seat rails just inboard
  // side-profile stations as [z, y]
  const FF = [z0 - 57, 8], LT = [z0 - 365, 432];        // front foot, leg top at the arm bracket
  const SF = [z0 - 16, seatH + 62], SP = [z0 - 95, seatH + 54], HB = [z0 - 391, seatH + 24];   // seat front tube, seat pivot, back hinge
  const KB = [-z0 + 127, R], KE = [-z0 + 6, R];         // the skid: where the seat bar meets the floor, and its end
  const topY = h - 15.5;                                // top tube centre: tube + cloth over it = h
  const lean = Math.min(Math.tan(24 * Math.PI / 180), (HB[0] - 16 - (-z0)) / (topY - HB[1]));
  const BT = [HB[0] - lean * (topY - HB[1]), topY];
  const hingeY = Math.min(seatH + 258, topY - 40), XT = [HB[0] - lean * (hingeY - HB[1]), hingeY];   // where the lateral X takes the back posts
  for (const sx of [-1, 1]) {
    const P = (p, x) => [sx * x, p[1], p[0]];
    tube([P(FF, xa), P(LT, xa)]);                                           // front leg
    tube([P(SF, xs), P(HB, xs), P(BT, xs)], 18);                            // seat rail into back post
    tube([P(SP, xs - 2 * R), P(KB, xs - 2 * R), P(KE, xs - 2 * R)], 30);    // seat bar and its floor skid, inside the rail
    tube([[sx * xs, XT[1], XT[0] + sx * R], [-sx * (xs - 2 * R), 2 * R + 4, -z0 + 60 + sx * R]]);   // lateral X, to the opposite skid (the pair lapped)
    cyl(g, 12.5, 14, 14, 10, rubber, sx * xa, 7, FF[0]);                    // front foot
    box(g, 22, 14, 26, 2, rubber, sx * (xs - 2 * R), 7, -z0 + 13);          // skid end cap
    box(g, 4, 20, 96, 1, steel, sx * (xa - 14), 440, LT[0] - 8);            // the bracket the leg hangs from
    box(g, 45, 16, 244, 3, woodMat, sx * xa, 460, z0 - 348);                // arm, top at 468
  }
  tube([[-xs, SF[1], SF[0]], [xs, SF[1], SF[0]]]);                           // seat front tube
  tube([[-xs, BT[1], BT[0]], [xs, BT[1], BT[0]]]);                           // top tube

  // Canvas: ONE run -- rolled over the front tube, a seat sagging to the seat height two thirds
  // back, a rounded knee at the hinge, taut up the back, over the top tube into a short tail.
  const bl = Math.hypot(BT[0] - HB[0], BT[1] - HB[1]);
  const bd = [(BT[0] - HB[0]) / bl, (BT[1] - HB[1]) / bl], bnv = [bd[1], -bd[0]];   // up the back posts; off them, frontward
  const at = (Q, a, b) => [Q[0] + bnv[0] * a + bd[0] * b, Q[1] + bnv[1] * a + bd[1] * b];
  const line = [[SF[0] - 6, SF[1] - 13], [SF[0] + 9, SF[1] - 9], [SF[0] + 12, SF[1]], [SF[0] + 7, SF[1] + 10]];
  qpts([SF[0], SF[1] + 12], [(SF[0] + HB[0]) / 2 - 40, seatH - 46], [HB[0] + 45, HB[1] + 6], 8, line);
  qpts([HB[0] + 45, HB[1] + 6], at(HB, 11, 0), at(HB, 11, 85), 6, line);
  line.push(at(BT, 11, 0));
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI * i / 6;
    line.push([BT[0] + 11 * (bnv[0] * Math.cos(a) + bd[0] * Math.sin(a)), BT[1] + 11 * (bnv[1] * Math.cos(a) + bd[1] * Math.sin(a))]);
  }
  line.push(at(BT, -11, -42));
  const cw = 2 * xs - 2 * R + 4, sheet = new THREE.Mesh(sheetGeo(line, 9, cw), cloth);
  sheet.rotation.y = -Math.PI / 2;    // profile plane -> the scene's z-y plane
  sheet.position.x = cw / 2 * MM;     // extrusion ran off along -x; recentre on the frame
  g.add(sheet);
  return { group: g, body: sheet };
}

/** Snow Peak Campfield Futon (SET-200) in its basic SOFA form (the set also makes a bed, chairs
 *  and shelves; only the sofa is drawn). Three brown plastic deck modules side by side, each on a
 *  front and a rear aluminium hairpin hoop; two seat cushions flush with the deck's front and two
 *  more stood up behind them against black backrests on poles; a wooden arm board on a scissor X
 *  at each end. Feet at y = 0, faces +z.
 *
 *  It was a chunky low box: a 195 slab on 138 legs, 626 deep, back top 619, the arms on two posts.
 *
 *  Scaled off the side view (set-220 alt_06) by the 749 deck depth, and the front view (alt_03)
 *  by the 1494 across the two seat cushions:
 *  - DECK. A thin slab the whole 749 deep, underside 240 up, top 297. Three modules of 498 make
 *    the published 1494; so do two cushions, 747 x 507 each -- the same cushion stands up as the
 *    back (507 tall) and four of them make the bed (alt_03 of set-200). The ARM BOARDS sit
 *    astride the deck's ends, half of each outside it, so the sofa over all is 104 wider than
 *    the published number: `w` here is that over-all width.
 *  - SEAT top 367 (cushion 70 thick, measured; its back edge 507 behind the deck front).
 *  - BACK. The cushion leans 10 degrees, its top at 795 -- the published 650 fits no sofa
 *    photograph -- with about 175 of bare deck behind its foot. Its rear face is black (rear
 *    view, alt_04), and behind each a black backrest panel hangs between two poles leaning 13
 *    degrees out of the deck.
 *  - ARMS. Board 491 x 104 x 18, top at 471, on two flat 24 mm bars crossed in the side view:
 *    feet on the deck's end 520 apart, pinned at 373 up.
 *  - HOOPS. 20 mm tube, uprights 396 apart under each module, in planes 40 inside the deck's
 *    front and rear edges; the floor run rises 24 in the middle (front view), so each hoop
 *    stands on two points. Black sockets at the deck, black clamps 114 up, and from clamp to
 *    clamp a LEVEL black webbing front to rear (side view) -- not the diagonal it was drawn as. */
export function campfieldSofaGroup(w, d, h, { frame = 0xbfc3c7, fabric = 0x72615a, wood = 0xc8a074, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.35, 0.45);
  const cushion = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.96 });
  const woodMat = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.55, metalness: 0.03 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x574a40, roughness: 0.9, metalness: 0.05 });   // #62554b lit, #44372e shaded in the photos
  const black = new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.85 });
  const armW = 104, dw = w - armW, hd = d / 2;        // dw: the deck and the cushions
  const deckY0 = 240, deckY1 = 297, cushT = 70, cushD = 507, mod = dw / 3;
  const pillow = (bw, bh, bd) => {                   // a cushion: soft edges, and the weave at cloth scale
    const geo = roundedBox(bw * MM, bh * MM, bd * MM, 22 * MM), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 6);
    return geo;
  };

  // The deck: three modules, a seam between them. First mesh in, so it is the pick body.
  for (const k of [-1, 0, 1]) box(g, mod - 3, deckY1 - deckY0, d, 3, plastic, k * mod, (deckY0 + deckY1) / 2, 0);
  // the bare strip behind the backs is ribbed, with black webbing laid in the grooves
  for (const k of [-1, 0, 1]) for (const z of [-hd + 40, -hd + 85, -hd + 130])
    box(g, mod - 60, 8, 16, 2, black, k * mod, deckY1 + 3, z);

  // Hoops: front and rear under each module.
  const zh = hd - 40, ux = 198, clampY = 114;
  for (const k of [-1, 0, 1]) {
    const mx = k * mod;
    for (const zc of [zh, -zh]) {
      bentTube(g, [[mx - ux, deckY0, zc], [mx - ux, 10, zc], [mx - 95, 10, zc], [mx, 34, zc], [mx + 95, 10, zc],
        [mx + ux, 10, zc], [mx + ux, deckY0, zc]], 10, tubeMat, { rad: [0, 42, 60, 130, 60, 42, 0], radial: 8 });
      for (const sx of [-1, 1]) {
        cyl(g, 13, 13, 30, 10, black, mx + sx * ux, deckY0 - 13, zc);        // deck socket
        cyl(g, 12, 12, 22, 10, black, mx + sx * ux, clampY, zc);            // webbing clamp
      }
    }
    for (const sx of [-1, 1])                                               // level webbing, front clamp to rear clamp
      box(g, 3, 25, 2 * zh, 1, black, mx + sx * (ux + 11), clampY, 0);
  }

  // Cushions: two on the deck, two stood up behind them.
  const rake = 10 * Math.PI / 180, backT = 65, backL = cushD, cw = dw / 2 - 4;
  const zSeatBack = hd - cushD;                                             // the seat's rear edge = the back's front foot
  const yFoot = h - backL * Math.cos(rake) - backT / 2 * Math.sin(rake) + 4; // the back's top front edge is h (4: its rounded corner)
  const zFoot = zSeatBack - backT / 2 * Math.cos(rake);
  const prake = 13 * Math.PI / 180, zPole = zFoot - backT / 2 - 10;
  for (const sx of [-1, 1]) {
    const cx = sx * dw / 4;
    const seat = new THREE.Mesh(pillow(cw, cushT, cushD), cushion);
    seat.position.set(cx * MM, (deckY1 + cushT / 2) * MM, (hd - cushD / 2) * MM);
    g.add(seat);
    const back = new THREE.Group();                                         // pivots about the cushion's foot
    back.position.set(cx * MM, yFoot * MM, zFoot * MM);
    back.rotation.x = -rake;
    const pad = new THREE.Mesh(pillow(cw, backL, backT), cushion);
    pad.position.y = backL / 2 * MM;
    back.add(pad);
    const lining = new THREE.Mesh(new THREE.BoxGeometry((cw - 40) * MM, (backL - 40) * MM, 4 * MM), black);
    lining.position.set(0, backL / 2 * MM, -(backT / 2 + 1) * MM);
    back.add(lining);
    g.add(back);
    // the backrest: two poles out of the deck, a black panel hung between their tops
    const rest = new THREE.Group();
    rest.position.set(cx * MM, deckY1 * MM, zPole * MM);
    rest.rotation.x = -prake;
    for (const px of [-205, 205]) cyl(rest, 9, 9, 300, 10, tubeMat, px, 150, 0);
    box(rest, 500, 240, 34, 12, black, 0, 335, 0);
    g.add(rest);
  }

  // Arms: a board astride each end of the deck, on two flat bars crossed in the side view.
  for (const sx of [-1, 1]) {
    const board = new THREE.Mesh(flatRect(armW * MM, 491 * MM, 18 * MM, 14 * MM), woodMat);
    board.position.set(sx * dw / 2 * MM, 471 * MM, 106 * MM);
    g.add(board);
    const X = sx * (dw / 2 + 14);
    flatBar(g, [X - sx * 6.5, 272, 306], [X - sx * 6.5, 450, -118], 24, 12, [1, 0, 0], tubeMat, true);
    flatBar(g, [X + sx * 6.5, 448, 295], [X + sx * 6.5, 272, -214], 24, 12, [1, 0, 0], tubeMat, true);
    cyl(g, 4.5, 4.5, 30, 8, tubeMat, X, 373, 52).rotation.z = Math.PI / 2;   // the pin where they cross
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
  // DEFAULT round form: a full disc lying flat, with the seam it folds along running across
  // the diameter (TM-096GR alt02). It had a centre tuft, which the real pad does not. UVs x6, the
  // chairs' weave scale: at 1 the canvas read as polka dots.
  const padGeo = new THREE.CylinderGeometry(R * MM, R * MM, h * MM, 56);
  const uv = padGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 6);
  const pad = new THREE.Mesh(padGeo, cloth);
  pad.position.y = h / 2 * MM; g.add(pad);
  const seam = new THREE.Mesh(new THREE.BoxGeometry((2 * R - 8) * MM, 1 * MM, 3 * MM),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(fabric).multiplyScalar(0.72), roughness: 0.9 }));
  seam.position.y = (h + 0.2) * MM; g.add(seam);
  return { group: g, body: pad };
}

/** Snow Peak Folding Bench (LV-071): two full-length tubes and a cloth. Each tube is ONE piece --
 *  a rail running inside a long edge of the cloth, turned down through a rounded shoulder at
 *  each end into a leg -- and the two cross as an X at each end: the front rail stands on the
 *  back feet, the back rail on the front feet, pinned where they cross, a thin rod tying the
 *  two pins. The cloth is sleeved on the rails, so it sags ACROSS the depth and its short ends
 *  hang free. Canvas or mesh, like the chair. Feet at y = 0, cloth top at h, faces +z.
 *
 *  (It was drawn the other way round: the cloth wrapped two short end loops with its long edges
 *  free, on legs splayed 50 outboard to feet 76 too deep.)
 *
 *  Off the LV-071GY set: the hero shows the tube leaving the sleeve and turning into the leg;
 *  alt_03, square-on, has the legs plumb in the length and the cloth 700 of the 829 px over
 *  all, so 925 of the published 1095; alt_05, end-on, has rails and feet the same 330 apart with
 *  the pin at half height. The back tube is the outer one, the front tube nests a tube's width
 *  inside it (alt_03: two legs side by side at each end). 20 mm tube, by its width against the
 *  rail spacing in alt_05. The published 358 is the top of the cloth; the packed 1095 x 470 is
 *  one tube lying flat, and a leg here is 470 from rail top to foot. */
export function foldingBenchGroup(w, d, h, { frame = 0x232528, fabric = 0x8c8279, canvasTex = null, meshAlpha = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.5, 0.45);
  const rubber = metalE(0x1c1e22, 0.1, 0.85);
  const cloth = meshAlpha
    ? new THREE.MeshStandardMaterial({ color: fabric, alphaMap: meshAlpha, transparent: true, alphaTest: 0.12, roughness: 0.85, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.92, side: THREE.DoubleSide });
  const R = 10, CL = 4;                              // tube radius; cloth thickness round it
  const zr = d / 2 - R - CL, yr = h - R - CL;        // rail centreline: the sleeve's outside is the d and the h
  // A leg ends in a rubber cap on its own axis; the cap's lowest edge is the ground and its
  // outer edge the published depth, which fixes where the tube's end is.
  const capR = 12.5, capL = 36;
  let lean = Math.atan(2 * zr / yr), ey = 0, ez = 0;
  for (let i = 0; i < 3; i++) {
    ey = capR * Math.sin(lean); ez = d / 2 - capR * Math.cos(lean);
    lean = Math.atan((zr + ez) / (yr - ey));
  }
  const yPin = yr - (yr - ey) * zr / (zr + ez);      // the two legs cross at z = 0
  const xOut = w / 2 - capR, xIn = xOut - 2 * R - 1; // the caps are the length; the front tube nests inside the back one
  for (const [sz, xl] of [[-1, xOut], [1, xIn]]) {   // sz: which long edge this tube's rail is in
    bentTube(g, [[-xl, ey, -sz * ez], [-xl, yr, sz * zr], [xl, yr, sz * zr], [xl, ey, -sz * ez]], R, tubeMat, { rad: 50, radial: 10 });
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(capR * MM, capR * MM, capL * MM, 12), rubber);
      const up = new THREE.Vector3(0, yr - ey, sz * (zr + ez)).normalize();
      cap.position.set(sx * xl * MM, ey * MM, -sz * ez * MM).addScaledVector(up, capL / 2 * MM);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      g.add(cap);
    }
  }
  // the tie rod through the two pins, a bolt head outside each
  cyl(g, 3.5, 3.5, 2 * xOut, 8, tubeMat, 0, yPin, 0).rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) cyl(g, 6, 6, 3, 10, metal(0xc9ccd0, 0.7, 0.35), sx * (xOut + R - 1.5), yPin, 0).rotation.z = Math.PI / 2;

  // The cloth: sewn round each rail, 18 of sag between them. Profile across the depth (u) and up
  // (v, from the rail centreline), run 925 along the length.
  const rs = R + CL / 2, line = [], arc = (cx, a0, a1) => {
    for (let a = a0; a >= a1 - 1e-6; a -= 23) line.push([cx + rs * Math.cos(a * Math.PI / 180), rs * Math.sin(a * Math.PI / 180)]);
  };
  arc(-zr, 320, 113);                                // under the back rail, up its outside to the crest
  qpts([-zr, rs], [0, rs - 36], [zr, rs], 12, line);
  arc(zr, 67, -140);                                 // over the front rail and back under
  const len = 925 / 1095 * w, seat = new THREE.Mesh(sheetGeo(line, CL, len), cloth);
  seat.rotation.y = Math.PI / 2;                     // profile plane -> the scene's z-y plane, run along x
  seat.position.set(-len / 2 * MM, yr * MM, 0);
  g.add(seat);
  return { group: g, body: seat };
}

/** Snow Peak Bamboo Folding Shelf / Bench (LV-066TR & siblings): a rigid laminated-BAMBOO top on
 *  folding stainless end X-frames -- a multi-use narrow table / bench / storage shelf. Top at
 *  y = h, faces +z. `woodTex` grains the bamboo. From the LV-066TR set: alt_03, square-on, has the
 *  legs plumb in the length and about 40 inside the board's ends; alt_05, end-on, has the board
 *  320 px against 295 across the feet, so the feet stand INSIDE the 330 board (304 over all), and
 *  the board 12 thick. (It was 22 thick on legs splayed 40 past the ends and 20 past the edges:
 *  a 1128 x 394 footprint under a 1095 x 330 top.) */
export function bambooShelfGroup(w, d, h, { frame = 0xcfd3d7, wood = 0xcaa96b, woodTex = null } = {}) {
  const g = new THREE.Group();
  const tubeMat = metalE(frame, 0.35, 0.45);   // matte white-silver in every photo; high metalness read as dark chrome
  const woodMat = new THREE.MeshStandardMaterial({ color: woodTex ? 0xffffff : wood, map: woodTex || null, roughness: 0.6, metalness: 0.03 });   // a map carries the colour; see igtWoodTop
  const tube = (a, b, r = 9) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 12), tubeMat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const topThk = 12, sw = w / 2 - 40, sd = d / 2 - 10, fd = d / 2 - 25, railY = h - topThk - 10;
  const top = new THREE.Mesh(roundedBox(w * MM, topThk * MM, d * MM, 3 * MM), woodMat);
  top.position.y = (h - topThk / 2) * MM; g.add(top);
  for (const sx of [-1, 1]) {                  // end X-frames, plumb in the length
    const X = sx * sw;
    tube([X, railY, sd - 4], [X, 8, -fd]);
    tube([X, railY, -(sd - 4)], [X, 8, fd]);
    for (const z of [-fd, fd]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(10 * MM, 12 * MM, 12 * MM, 10), metalE(0x1c1e22, 0.1, 0.85));
      cap.position.set(X * MM, 6 * MM, z * MM); g.add(cap);
    }
  }
  // the lengthwise members run directly UNDER the top's long edges -- the LV-066TR hero
  // shows two bright rails hugging the underside end to end, and NO bar lower down (the old
  // mid-air stretcher at y=130 floated a silver line where the real product is open).
  for (const zc of [sd - 4, -(sd - 4)]) tube([-sw, railY, zc], [sw, railY, zc]);
  return { group: g, body: top };
}

/** A flat bar between two points (mm): `wide` across its face, `thick` through it, the thickness
 *  laid along `n` (squared to the bar here, so a rough direction will do). With `round` the ends
 *  are half-rounds in the face plane and a/b are their CENTRES -- a bamboo batten's tip; without,
 *  the ends are sawn square at a and b -- aluminium flat bar, a steel strap. */
function flatBar(g, a, b, wide, thick, n, mat, round = false) {
  const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
  const Y = vb.clone().sub(va), L = Y.length();
  Y.normalize();
  const Z = new THREE.Vector3(...n);
  Z.addScaledVector(Y, -Z.dot(Y)).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  let geo;
  if (round) {
    const r = wide / 2 * MM, s = new THREE.Shape();
    s.absarc(0, L / 2, r, 0, Math.PI, false);
    s.absarc(0, -L / 2, r, Math.PI, 2 * Math.PI, false);
    geo = new THREE.ExtrudeGeometry(s, { depth: thick * MM, bevelEnabled: false, curveSegments: 5 });
    geo.translate(0, 0, -thick / 2 * MM);
  } else geo = new THREE.BoxGeometry(wide * MM, L, thick * MM);
  const m = new THREE.Mesh(geo, mat);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  g.add(m);
  return m;
}

/** A cut cloth panel with body: the closed outline `pts` ([u, v] mm), each corner eased to `r` mm
 *  (one number, or one per point -- a big radius on a mid-edge point turns a kinked edge into a
 *  curve), `thk` mm thick, its edges rolled over `soft` mm so a sleeve reads stuffed rather than
 *  sawn. Local x/y carry u/v; the body runs 0..thk along local z. An extrusion's
 *  UVs are its shape in metres, which lays the canvas weave 12 mm coarse -- polka dots from a
 *  metre off -- so they are scaled to a 2 mm weave. */
function clothPanel(pts, r, thk, soft = 0) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ri = Array.isArray(r) ? r[i] : r, ca = Math.min(ri, la / 2), cb = Math.min(ri, lb / 2);
    const x0 = p[0] + (a[0] - p[0]) / la * ca, y0 = p[1] + (a[1] - p[1]) / la * ca;
    if (i === 0) s.moveTo(x0 * MM, y0 * MM); else s.lineTo(x0 * MM, y0 * MM);
    s.quadraticCurveTo(p[0] * MM, p[1] * MM, (p[0] + (b[0] - p[0]) / lb * cb) * MM, (p[1] + (b[1] - p[1]) / lb * cb) * MM);
  }
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, soft
    ? { depth: (thk - 2 * soft) * MM, curveSegments: 4, bevelEnabled: true, bevelThickness: soft * MM, bevelSize: soft * MM, bevelOffset: -soft * MM, bevelSegments: 2 }
    : { depth: thk * MM, bevelEnabled: false, curveSegments: 4 });
  if (soft) geo.translate(0, 0, soft * MM);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 6);
  return geo;
}

/** Snow Peak Take! Bamboo Chair (LV-085): a folding TUB chair. Each side is two flat bamboo
 *  battens crossed scissor-fashion (front foot up to the back, rear foot up to the front corner);
 *  two flat-bar aluminium X's, one across the front and one across the back, tie the sides and
 *  fold the chair flat sideways. One cream canvas hangs on the four batten tips: a deep tub with
 *  a level rim, its front corners turned over the front tips as flat triangular pockets, and a
 *  flat full-width band sleeved over the back tips. Feet at y = 0, faces +z.
 *
 *  It was drawn as a shallow hammock narrower than its frame, gripped by four capsule pockets,
 *  on four foot skids. None of that is on the chair.
 *
 *  Where the numbers come from (studio set in the gallery, LV-085_06 side / _03 front / _07 rear,
 *  the side view scaled by the published 749 height):
 *  - SIDE SCISSOR, traced by colour along scanlines of the side view: the back batten runs
 *    34 degrees off plumb from a front foot at 0.44 d to the top of the back band; the front
 *    batten 46 degrees from the rear foot to a tip at 0.78 h, 0.46 d. They cross at 0.47 h. Both
 *    are 32 x 15 with plain half-round ends; the front batten rides outboard of the back one.
 *  - WIDTHS. The front and rear views are shot from above at about 20 degrees, 2.5 m off, so
 *    near things read wide: a camera fitted to six heights known from the side view gives feet
 *    370 apart, the band 460 wide and the pockets 470 over all. That 470 is the build width;
 *    Snow Peak publishes 549, which no view supports (kept in the catalogue as published_mm).
 *  - CLOTH. Rim at 0.80-0.82 h from pocket to band (side view), the floor at the published
 *    420 seat height, so the wall is about 190 deep and hides the top third of the frame. The
 *    front lip is a U in a plumb plane, its centre about 455 up. The rear wall climbs to the
 *    band, which is 160 long on the battens' rake, 36 thick (it sleeves a 32 batten), its top
 *    edge dipping about 26 between the tips (rear view). The pockets are triangles 95 deep at
 *    the front corner tapering to nothing 250 back along the rim (side view). A black webbing
 *    is sewn along the rear half of the rim.
 *  - ALUMINIUM: 20 x 10 flat bar. The front X stands plumb 30-55 ahead of the battens on steel
 *    straps, from the front feet (55 up) to the opposite front batten just under its pocket
 *    (0.71 h); the rear X leans from the back battens at 0.86 h to the opposite rear feet at
 *    0.12 h. */
export function takeChairGroup(w, d, h, { frame = 0xcfd3d7, fabric = 0xe6d5b6, wood = 0xb98a58, seatH = 420, canvasTex = null } = {}) {
  const g = new THREE.Group();
  const alu = metalE(frame, 0.2, 0.55);              // satin anodised bar: it photographs white-silver, never dark
  const steel = metal(0xd6d9dc, 0.6, 0.35);
  const dark = new THREE.MeshStandardMaterial({ color: 0x26272a, roughness: 0.9 });
  const bambooMat = new THREE.MeshStandardMaterial({ color: wood, roughness: 0.55, metalness: 0.03 });
  // Cotton canvas passes light: the shaded outside of the tub stays cream in every photo, so the
  // cloth carries a little of its own colour as glow instead of going slate under the rim.
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, map: canvasTex || null, roughness: 0.9, side: THREE.DoubleSide,
    emissive: new THREE.Color(fabric), emissiveIntensity: 0.26 });

  // The side scissor, as [x, y, z] end centres on the +x side. A = front foot -> back tip (inboard),
  // B = rear foot -> front tip (outboard, clear of A by a spacer at the pivot).
  const R = 16, BT = 15;
  const A0 = [0.385 * w, R, 0.436 * d], A1 = [0.447 * w, h - 30, -0.321 * d];
  const B0 = [0.435 * w, R, -0.5 * d + R], B1 = [0.479 * w, 0.776 * h, 0.463 * d];
  const on = (P, Q, y) => { const t = (y - P[1]) / (Q[1] - P[1]); return [P[0] + (Q[0] - P[0]) * t, y, P[2] + (Q[2] - P[2]) * t]; };
  const kA = (A1[2] - A0[2]) / (A1[1] - A0[1]), kB = (B1[2] - B0[2]) / (B1[1] - B0[1]);
  const yP = R + (A0[2] - B0[2]) / (kB - kA);          // where the two cross in the side view
  const fz = 0.458 * d;                                // the front X's plane
  const nR = [0, -0.17, 1];                            // the rear X's plane leans back with its bars
  for (const sx of [-1, 1]) {
    const at = p => [sx * p[0], p[1], p[2]];
    flatBar(g, at(A0), at(A1), 2 * R, BT, [1, 0, 0], bambooMat, true);
    flatBar(g, at(B0), at(B1), 2 * R, BT, [1, 0, 0], bambooMat, true);
    const pa = on(A0, A1, yP), pb = on(B0, B1, yP);    // the pivot bolt, through both and the spacer
    cyl(g, 5, 5, pb[0] - pa[0] + BT + 10, 10, steel, sx * (pa[0] + pb[0]) / 2, yP, pa[2]).rotation.z = Math.PI / 2;

    // front X: this side's foot to the far side's batten, the pair lapped 11 apart
    const fb = [sx * (A0[0] - 10), 55, fz + sx * 5.5], ft = [-sx * (B1[0] - 16), 0.71 * h, fz + sx * 5.5];
    flatBar(g, fb, ft, 20, 10, [0, 0, 1], alu);
    const sa = on(A0, A1, 34), sb = on(B0, B1, 0.70 * h);
    flatBar(g, [fb[0], 34, sa[2]], [fb[0], 59, fz], 14, 3, [1, 0, 0], steel);                       // foot strap
    flatBar(g, [-ft[0], sb[1], sb[2]], [-ft[0], 0.71 * h, fz], 14, 3, [1, 0, 0], steel);            // top strap
    // rear X: this side's back batten down to the far side's rear foot
    const ra = on(A0, A1, 0.86 * h), rb = on(B0, B1, 0.12 * h);
    flatBar(g, [sx * (ra[0] - 13), ra[1], ra[2] + sx * 5.5], [-sx * (rb[0] - 13), rb[1], rb[2] - 18 + sx * 5.5], 20, 10, nR, alu);
  }

  // The back band: a sleeve over the two back tips, lying on the battens' rake. Its top FRONT edge
  // is the chair's highest line, so that is what sits at h.
  const rake = Math.atan2(A0[2] - A1[2], A1[1] - A0[1]), sr = Math.sin(rake), cr = Math.cos(rake);
  const BL = 160, BK = 36, soft = 9, bw = 0.485 * w, dip = 26;
  const yT = h - (BK / 2 - soft) * sr, zT = on(A0, A1, yT)[2];
  const yB = yT - BL * cr, zB = zT + BL * sr;          // centre of its bottom edge
  const bandGeo = clothPanel([[-bw, 0], [bw, 0], [bw, BL], [bw / 2, BL - 0.75 * dip], [0, BL - dip],
    [-bw / 2, BL - 0.75 * dip], [-bw, BL]], [12, 12, 14, 90, 140, 90, 14], BK, soft);
  bandGeo.translate(0, 0, -BK / 2 * MM);
  const band = new THREE.Mesh(bandGeo, cloth);
  band.rotation.x = -rake;
  band.position.set(0, yB * MM, zB * MM);
  g.add(band);

  // The tub: ONE sheet, front lip -> floor -> rear wall, as U-sections. Per station: z, the rim's
  // height, its half-width, how much of the rim-to-seat drop the centre takes, and the section's
  // power (2 = a parabola; higher = a flatter floor with steeper walls -- the rear wall is the
  // section flattening out as it climbs to the band's front face).
  const zL = zB + BK / 2 * cr - 3, yL = yB + BK / 2 * sr + 3, zF = -0.098 * d;
  const S = [
    [0.492 * d, 0.750 * h, 0.452 * w, 0.72, 2.4],      // front lip, its ends tucked into the pockets' lower corners
    [0.455 * d, 0.800 * h, 0.452 * w, 0.82, 2.6],
    [0.340 * d, 0.806 * h, 0.449 * w, 0.92, 2.9],
    [0.190 * d, 0.801 * h, 0.443 * w, 0.975, 3.0],
    [0.050 * d, 0.800 * h, 0.435 * w, 1.0, 3.0],       // lowest: the published seat height
    [-0.050 * d, 0.803 * h, 0.428 * w, 0.985, 3.2],
    [zF, 0.808 * h, 0.423 * w, 0.96, 3.6],             // the floor's rear edge
    [zF + (zL - zF) * 0.35, 0.813 * h, 0.421 * w, 0.80, 4.5],
    [zF + (zL - zF) * 0.65, 0.817 * h, 0.419 * w, 0.48, 6],
    [zF + (zL - zF) * 0.90, 0.820 * h, 0.418 * w, 0.10, 8],
    [zL, yL, 0.418 * w, 0, 8],                         // the band's lower front edge
  ];
  const cols = 16, geo = new THREE.PlaneGeometry(1, 1, cols, S.length - 1), pos = geo.attributes.position;
  const lip = [], rimL = [], rimR = [];
  for (let i = 0; i < S.length; i++) for (let j = 0; j <= cols; j++) {
    const [z, rim, hw, fill, n] = S[i], u = Math.sin((j / cols * 2 - 1) * Math.PI / 2);   // columns crowd the walls
    const p = [u * hw, rim - (rim - seatH) * fill * (1 - Math.abs(u) ** n), z];
    pos.setXYZ(i * (cols + 1) + j, p[0] * MM, p[1] * MM, p[2] * MM);
    if (i === 0) lip.push(p);
    if (i >= 3 && j === 0) rimL.push(p);
    if (i >= 3 && j === cols) rimR.push(p);
  }
  geo.computeVertexNormals();
  for (let i = 0, uv = geo.attributes.uv; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);   // a finer weave: see clothPanel
  const sheet = new THREE.Mesh(geo, cloth);
  g.add(sheet);
  bentTube(g, lip, 5, cloth);                          // the lip's rolled hem
  for (const rim of [rimL, rimR])                      // black webbing sewn outside the rear half of each rim
    for (let i = 1; i < rim.length; i++) {
      const o = Math.sign(rim[i][0]) * 1.5;
      flatBar(g, [rim[i - 1][0] + o, rim[i - 1][1] - 6, rim[i - 1][2]], [rim[i][0] + o, rim[i][1] - 6, rim[i][2]], 7, 2, [1, 0, 0], dark);
    }

  // The front corners, turned over the front batten tips: flat triangular pockets on the outside
  // of the tub, the widest thing on the chair. Outline in [-z, y].
  const wing = clothPanel([[-0.5 * d, 0.812 * h], [-0.452 * d, 0.848 * h], [-0.10 * d, 0.806 * h], [-0.497 * d, 0.722 * h]], 14, 0.048 * w, 6);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(wing, cloth);
    m.rotation.y = Math.PI / 2;
    m.position.x = (sx > 0 ? 0.452 : -0.5) * w * MM;
    g.add(m);
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
  const lidH = h * 0.16, seam = 3, bodyH = h - lidH - seam;   // the lid is about a sixth of the height in the hero (it was 0.22: a thick lid)
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
 *  middle, standing on eight folding wire gates (two under each segment, along its slant
 *  sides). `ringMat` paints the ring; `color` the wire. Ring top at y = 0, legs to -height. */
export function jikaroGroup({ outer, opening, edge, height, color, ringMat }) {
  const g = new THREE.Group();
  const thick = 6, edgeT = 25;
  const mat = ringMat || metalE(color, 0.85, 0.3);
  // The deck is a brushed sheet lying face-up: at full metalness it mirrored the horizon and
  // read #7f7f7f from a low camera, where the photographs sample #c6 to #d5. Mostly diffuse.
  mat.metalness = Math.min(mat.metalness, 0.3);
  mat.roughness = Math.max(mat.roughness, 0.5);
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

  // The legs: EIGHT wire gates, two per panel, each hanging ALONG one of the panel's two slant
  // sides. The manual (data/manuals/ST-050.pdf, a scan, rendered and read) counts 脚×4 and seats
  // each in 溝A and 溝B; its 裏面 drawing, which is to scale (it returns the panel's own 600 / 370 /
  // 260), shows what those are -- two bars under each panel, parallel to the slant sides, with
  // groove A at +/-90 along the panel and 34 in from its short edge, groove B at +/-245 and 196
  // in. Step 3 then draws the panel standing on two wire gates, one at each end. So a "脚" is the
  // bar pair, and each gate you can see is one A wire, one B wire and the foot bar between them:
  // about 224 long, plumb, its foot bar rising to a shallow notch in the middle (a009).
  // The photographs agree: the elevations (a003, a005) show the wires clustered at the corners
  // and none canted, the hero two gates under one chamfer, and the mid-sides clear.
  // (This was drawn as two gates per panel hung PARALLEL to its long and short edges on the
  // centreline, one elbowed inward -- wires under the middle of every straight side.)
  // The stations are measured from the panel's SHORT edge, so they follow the panel into either
  // assembly: under the chamfers when the short edges face out, along the diagonal seams when
  // they face the hearth.
  const wire = metalE(color, 0.9, 0.28);
  const wr = 3, notch = 30;
  const shortOut = edge < opening;               // spread: the 365 edges are the outer straights
  const rad = v => shortOut ? R - v : o + v;     // v mm in from the short edge -> distance from centre
  for (let k = 0; k < 4; k++) {
    const cs = Math.cos(k * Math.PI / 2), sn = Math.sin(k * Math.PI / 2);
    const at = (x, y, z) => [x * cs + z * sn, y, -x * sn + z * cs];
    for (const sx of [-1, 1]) {
      const ax = sx * 90, az = rad(34), bx = sx * 245, bz = rad(196);
      // The wire rests ON the ground. Its foot corners are filleted, so the corner itself is
      // set a hair lower by what the fillet cuts off (the bar leaves each foot already rising).
      const rise = notch / Math.hypot(Math.hypot(bx - ax, bz - az) / 2, notch);
      const footY = -height + wr - 10 / Math.tan(Math.acos(rise) / 2) * rise / (1 + rise);
      bentTube(g, [at(ax, -thick, az), at(ax, footY, az),
                   at((ax + bx) / 2, footY + notch, (az + bz) / 2),
                   at(bx, footY, bz), at(bx, -thick, bz)], wr, wire, { rad: [0, 10, 14, 10, 0] });
    }
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
 *  Both hang the same way. A side frame stands at each END, spans the table's DEPTH between
 *  the rails, and lands four hooks on them (左右合計4か所のフック, both manuals). The rails'
 *  lips sit at |z| 158.5..182.5 (railProfile) with the clear opening inside them, so a side
 *  frame's body stays inside +/-158 and only its hook arms reach out over the lip, underside
 *  on the -10 recess modules rest in, tips at |z| = d/2 = 177. (The arms were drawn out to
 *  198, 16mm past the lip.) Everything else hangs BETWEEN the two side frames.
 *
 *      CK-220  セット内容: メインフレーム x2, サイドフレーム x2 (manual, 各部の名称).
 *              SIDE FRAME: a closed rectangle. On top a 55mm band with an oblong hand slot,
 *              its two top corners notched into the rail hooks; each band end folds OUT into
 *              a tab, and a 17mm flat-bar leg is riveted to the tab (two rivets) with its
 *              face to the table's LONG side; a bottom bar joins the two feet. Each leg has
 *              THREE vertical slots (メインフレーム用フック穴), 125mm apart. The legs were
 *              drawn a quarter turn round (4mm wide from the long side) with six round
 *              holes, and the band 92 tall.
 *              MAIN FRAME: a bare tier rim, no floor -- trays and boxes hang THROUGH it.
 *              Two long angle bars (24 tall, a 12mm flange turned in at the top, the ledge
 *              a tray's rim rests on) between two plain end bars; the end bars run on
 *              through the leg slots and turn down, four hooks a tier.
 *              SIZE is not published (only the packed 539 x 368 x 55), so it is measured,
 *              and the catalogue keeps it flagged estimated. Ruler: the deep mesh trays
 *              hanging in it, whose end wall is 14 wires + 2 corner posts across 234.6mm
 *              (CK-225's orthographic top view puts the long walls at +/-117.3), i.e. a
 *              16.76mm wire pitch. In the frontal in-use photo (gallery 05_19) the legs
 *              stand 33.2 pitches apart outside to outside, in CK-250's frontal `switch2`
 *              33.3: 555mm. That is the packed 539 (the main frame, end bar to end bar on
 *              the legs' centre lines) plus one 17mm leg, which is the cross-check. Depth
 *              354 over the leg faces (the sibling CK-230's published depth; the tier hooks
 *              poke 7mm past each, which is the packed 368). Leg, tab top to foot: 25.9
 *              pitches = 432; frame top to foot in `switch2` 449: drop 450. Tier rims top
 *              out 172 and 426 below the table. It used to be 510 x 354 x 372 and, because
 *              that was a guess, translucent; a see-through rack read as a fault, so it is
 *              solid steel now and `estimated` only travels in the data.
 *      CK-230  本体 x1: a perforated base plate whose side panels fold up to 90 degrees,
 *              each one stamped plate -- top rail, two upright end posts, a V of braces
 *              meeting over the shelf's centre (the embossed logo sits under that meeting),
 *              a black strip along the foot. Published 510 x 354 x 242, but the folded
 *              pack is 503 x 315 x 20: plate and panels are 315 deep and pass BETWEEN the
 *              rails, and only the four hook links -- an L on a pivot at each post top,
 *              swung out and up (photos 08/09) -- reach the 354. The body was drawn ~350
 *              deep, through both rails. Post tops and pivots ~30 below the hook top and
 *              the top rail ~56 below, off the close-up (photo 04) against the 242.
 *
 *  Mostly air, so a faint ghost box carries picking (the meshTrayGroup deal). Top at
 *  y = 0, hangs to -drop. Returns { group, body }. */
export function hangRackGroup({ w, d, drop, tiers = 1, hasSurface = false, color }) {
  const g = new THREE.Group();
  const steel = metal(color, 0.9, 0.28);
  const dark = metalE(0x0e0f12, 0.2, 0.8);      // punched holes -- frameGroup's own fake
  const bar = (bw, bh, bd, x, y, z) => box(g, bw, bh, bd, 1, steel, x, y, z);
  const LIP = 10;                               // the rails' recess: a hook arm's underside
  const zr = d / 2;                             // hook tips, on the lip

  // The ghost pick box: the full envelope, faint, and the only mesh the planner tags.
  const ghost = box(g, w, drop, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }),
    0, -drop / 2, 0);

  if (!hasSurface) {
    // CK-220.
    const T = 1.6;                              // sheet gauge
    const LEG = 17, TAB = 21;                   // leg bar; the folded tab it is riveted to
    const xLeg = w / 2 - LEG / 2;               // legs' centre lines; outer edges on w/2
    const zLeg = d / 2 - 1;                     // 2mm bar, outer face on d/2
    const xBand = w / 2 - TAB;                  // the band's plane: where the tab folds out
    const BAND = 55, top = -1;
    const RIM = 24;                             // tier bar, on edge
    const first = Math.min(172, (drop - RIM) / 2), last = drop - RIM;   // tier rims' tops
    const tierTop = i => (tiers === 1 ? last : first + (i * (last - first)) / (tiers - 1));
    const slots = [first + 3, (first + last) / 2 + 3, last + 3];        // a rim tops out 3 above its slot's centre

    // The band, cut from one sheet: straight top edge, a hook at each top corner (the arm
    // on the lip, a notch under it for the lip's edge), and the hand slot clean through.
    const s = new THREE.Shape();
    const zb = zr - 2, zn = zr - 13;
    [[-zr, top], [zr, top], [zr, -LIP], [zn, -LIP], [zn, -LIP - 7], [zb, -LIP - 7], [zb, top - BAND],
     [-zb, top - BAND], [-zb, -LIP - 7], [-zn, -LIP - 7], [-zn, -LIP], [-zr, -LIP]]
      .forEach(([z, y], i) => (i ? s.lineTo(z * MM, y * MM) : s.moveTo(z * MM, y * MM)));
    s.closePath();
    const hand = new THREE.Path(), hl = 60, hr = 10, hy = -28;      // 140 x 20, off the hero
    hand.moveTo(-hl * MM, (hy + hr) * MM);
    hand.lineTo(hl * MM, (hy + hr) * MM);
    hand.absarc(hl * MM, hy * MM, hr * MM, Math.PI / 2, -Math.PI / 2, true);
    hand.lineTo(-hl * MM, (hy - hr) * MM);
    hand.absarc(-hl * MM, hy * MM, hr * MM, -Math.PI / 2, Math.PI / 2, true);
    s.holes.push(hand);
    const bandGeo = new THREE.ExtrudeGeometry(s, { depth: T * MM, bevelEnabled: false, curveSegments: 6 });

    for (const sx of [-1, 1]) {
      const band = new THREE.Mesh(bandGeo, steel);
      band.rotation.y = -Math.PI / 2;           // the sheet's own x runs along the table's depth
      band.position.x = (sx * xBand + T / 2) * MM;
      g.add(band);
      for (const sz of [-1, 1]) {
        bar(TAB, 46, T, sx * (xBand + TAB / 2), -41, sz * (zLeg - 1 - T / 2));
        bar(LEG, drop - 20, 2, sx * xLeg, -(20 + (drop - 20) / 2), sz * zLeg);
        for (const ry of [30, 46]) cyl(g, 3, 3, 1.6, 8, steel, sx * xLeg, -ry, sz * (d / 2 + 0.4), Math.PI / 2);
        for (const sy of slots) box(g, 4.5, 33, 2.8, 1, dark, sx * xLeg, -sy, sz * zLeg);
      }
      bar(T, 16, d - 4, sx * (w / 2 - T / 2), -(drop - 8), 0);       // the bar joining the feet
    }

    // The tier rims (main frames), hooked into the top and bottom slots.
    const zL = d / 2 - 4;                       // long bars, just inside the legs
    for (let i = 0; i < tiers; i++) {
      const ty = tierTop(i);
      for (const sz of [-1, 1]) {
        bar(2 * xLeg, RIM, T, 0, -(ty + RIM / 2), sz * zL);
        bar(2 * xLeg - 4, T, 12, 0, -(ty + T / 2), sz * (zL - 6.8));
      }
      for (const sx of [-1, 1]) {
        bar(T, RIM, 2 * zL, sx * xLeg, -(ty + RIM / 2), 0);
        for (const sz of [-1, 1]) {             // out through the leg slot, and turned down
          bar(T, 13, 11, sx * xLeg, -(ty + 9.5), sz * (zL + 5.5));
          bar(T, 10, 3, sx * xLeg, -(ty + 19), sz * (d / 2 + 5.5));
        }
      }
    }
  } else {
    // CK-230. The plate and the folded panels are the packed 503 x 315; the caller's d is
    // the 354 over the hooks.
    const SW = Math.min(503, w), SD = Math.min(315, d), hz = SD / 2;
    const px = SW / 2 - 1.5;                    // the panels' plane, at the plate's ends
    const zp = hz - 10;                         // post centre lines
    const shelfTop = drop - 18;
    const railY = 56, railH = 26, footH = 28;   // top rail; the panel's foot rail
    const black = metal(0x1c1e22, 0.1, 0.65);
    const bead = metal(new THREE.Color(color).multiplyScalar(0.72), 0.9, 0.35);
    for (const sx of [-1, 1]) {
      const X = sx * px;
      bar(3, railH, SD, X, -(railY + railH / 2), 0);
      box(g, 3.6, 3, SD - 70, 1, bead, X, -(railY + railH / 2), 0);            // its pressed bead
      bar(3, footH, SD, X, -(shelfTop - footH / 2), 0);
      for (const sz of [-1, 1]) {
        bar(4, shelfTop - 30, 20, X, -(30 + (shelfTop - 30) / 2), sz * zp);     // the post, upright
        cyl(g, 10, 10, 4.2, 14, steel, X, -30, sz * zp).rotation.z = Math.PI / 2;   // its pivot lug
        // The V brace: from under the top rail beside the post to the foot's centre.
        const zT = hz - 34, zB = 16, y0 = railY + railH - 2, rise = shelfTop - footH + 2 - y0;
        bar(3.5, Math.hypot(rise, zT - zB), 20, X, -(y0 + rise / 2), sz * ((zT + zB) / 2))
          .rotation.x = sz * Math.atan2(zT - zB, rise);
        // The hook link, outboard of the panel on the pivot: a riser inside the rail opening
        // and an arm laid out over the lip to |z| = d/2.
        const xh = sx * (px + 3);
        bar(3, 26, 14, xh, -(LIP + 13), sz * (hz - 7));
        bar(3, LIP - 2, zr - (hz - 14), xh, -(2 + (LIP - 2) / 2), sz * ((zr + hz - 14) / 2));
        cyl(g, 4.5, 4.5, 2.5, 10, steel, sx * (px + 3.75), -30, sz * zp).rotation.z = Math.PI / 2;   // pivot pin
      }
      // the black strip along the panel's foot, on the inside (every CK-230 photo)
      box(g, 5, 20, SD - 6, 2, black, sx * (px - 4), -(shelfTop - 10), 0);
    }
    // The base plate: a shallow pan at the very bottom -- floor, long lips folded DOWN,
    // and the rows of dash perforations, drawn flush and dark (the through-hole fake).
    box(g, SW, 3, SD, 1, steel, 0, -(shelfTop + 1.5), 0);
    for (const sz of [-1, 1]) bar(SW, 15, 3, 0, -(shelfTop + 10.5), sz * (hz - 1.5));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++)
      box(g, 26, 1.2, 5, 0.5, dark,
        (c - 2 + (r % 2 ? 0.25 : -0.25)) * (SW / 6.5), -(shelfTop - 0.3), (r - 1.5) * (SD / 4.6));
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

/** The Penta (STP-381): the ONE-POLE wedge. Its whole pitch is a fan -- the apex vertex
 *  rides a single pole at the published height, the other four corners stake to the ground,
 *  and the fabric falls from the point in one sweep. Same catenary language as the hexa
 *  (edges bow inward and lift between anchors), one pole, two guys past the apex. */
export function pentaTarpGroup({ verts, h, color = 0x8a7460 }) {
  const g = new THREE.Group();
  // the apex is the lone vertex on the symmetry axis; the perimeter chain is the rest,
  // walked in ring order from one apex-adjacent corner around to the other
  const xs = verts.map(v => v[0]), zs = verts.map(v => v[1]);
  const ext = a => Math.max(...a) - Math.min(...a);
  const ax = ext(xs) >= ext(zs) ? 0 : 1, perp = 1 - ax;
  let ai = 0;
  for (let i = 0; i < verts.length; i++) if (Math.abs(verts[i][perp]) < 1) ai = i;
  const apex = verts[ai];
  const chain = [];
  for (let k = 1; k < verts.length; k++) chain.push(verts[(ai + k) % verts.length]);

  const membrane = new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
    metalness: 0, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  const trimMat = metal(0xa8382e, 0.15, 0.6);
  const V3 = (x, y, z) => new THREE.Vector3(x * MM, y * MM, z * MM);

  // the boundary sweep: apex -> corners -> apex, heights apex=h, ground corners 30mm
  const nodes = [{ v: apex, y: h }, ...chain.map(v => ({ v, y: 30 })), { v: apex, y: h }];
  const segLen = []; let L = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i].v, b = nodes[i + 1].v;
    segLen.push(Math.hypot(b[0] - a[0], b[1] - a[1])); L += segLen[i];
  }
  const E = t => {
    let s = t * L, i = 0;
    while (i < segLen.length - 1 && s > segLen[i]) s -= segLen[i++];
    const lt = segLen[i] ? s / segLen[i] : 0;
    const a = nodes[i], b = nodes[i + 1];
    const p = [a.v[0] + (b.v[0] - a.v[0]) * lt, a.v[1] + (b.v[1] - a.v[1]) * lt];
    let y = a.y + (b.y - a.y) * lt;
    const arc = Math.sin(Math.PI * lt);
    y += 0.05 * segLen[i] * arc;                // edges lift a touch between anchors
    const cx = (apex[0]) * 0.3, cz = (apex[1]) * 0.3;   // bow toward the tarp's own middle
    const dx = p[0] - cx, dz = p[1] - cz, dl = Math.hypot(dx, dz) || 1;
    const bow = 0.06 * segLen[i] * arc;
    return { x: p[0] - (dx / dl) * bow, z: p[1] - (dz / dl) * bow, y };
  };
  const NU = 40, NV = 8, pos = [], idx = [];
  for (let iu = 0; iu <= NU; iu++) {
    const e = E(iu / NU);
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV;
      let x = apex[0] + (e.x - apex[0]) * v, z = apex[1] + (e.z - apex[1]) * v;
      let y = h + (e.y - h) * v;
      y -= 0.04 * Math.hypot(e.x - apex[0], e.z - apex[1]) * Math.sin(Math.PI * v) * Math.sin(Math.PI * (iu / NU));
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
  const trimPts = [];
  for (let i = 0; i <= 48; i++) { const e = E(i / 48); trimPts.push(V3(e.x, e.y, e.z)); }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trimPts), 96, 3.5 * MM, 6, false), trimMat));

  // the one pole, its two guys running on past the apex, and a stake at every corner
  const alu = metal(0xc9ccd1, 0.8, 0.35);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(12 * MM, 12 * MM, h * MM, 12), alu);
  pole.position.set(apex[0] * MM, h / 2 * MM, apex[1] * MM);
  g.add(pole);
  const guyPts = [];
  const dirA = [Math.sign(apex[0] || 0), Math.sign(apex[1] || 0)];
  for (const side of [-1, 1]) {
    const sx = apex[0] + dirA[0] * 0.5 * h + side * (perp === 0 ? 0.3 * h : 0),
          sz = apex[1] + dirA[1] * 0.5 * h + side * (perp === 1 ? 0.3 * h : 0);
    guyPts.push(V3(apex[0], h, apex[1]), V3(sx, 0, sz));
    cyl(g, 4, 5, 22, 8, metal(0x3a3d42, 0.4, 0.6), sx, 11, sz);
  }
  for (const c of chain) cyl(g, 4, 5, 22, 8, metal(0x3a3d42, 0.4, 0.6), c[0], 11, c[1]);
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(guyPts),
    new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.85 })));

  return { group: g, body: mesh };
}

/** Land Lock (TP-671R): the flagship 2-room shell, STANDING. The published 6250x4050x2050
 *  envelope shapes the loft; the manual's frame plan (TP-671R_manual.pdf p.5) names what the
 *  hero photo shows: two A-FRAMES crossing over the body, two C-FRAMES rounding the ends,
 *  one CENTRE ridge frame -- so those five tubes are drawn riding just proud of the fabric,
 *  where their sleeves are. Brown skin, red trim (the door surround and ridge accents), the
 *  darker skirt at grade. Same 0.5 opacity as the tarps, for the same two reasons: the
 *  kitchen lives INSIDE this one, and an opaque 25 square metres would print a shadow-map
 *  blob over half the layout. */
export function landLockGroup(w = 6250, d = 4050, h = 2050,
    { opacity = 0.5, fabricTex = null, awning = "closed" } = {}) {
  const g = new THREE.Group();
  // The 跳ね上げ states: either end panel props open on two upright poles as an awning.
  // front = the entrance (-x) end. One string, like every other node config in this app.
  const openF = awning === "front" || awning === "both";
  const openR = awning === "rear" || awning === "both";
  const nPlan = 3, L2 = w / 2, W2 = d / 2;
  // The massing is a LOAF with CUT ENDS: a level ridge between the A-frames, then each end
  // is one long SLOPED FACE -- the open-portal photo shows the C-frame arch leaning back
  // inside that plane, feet at the very end, crown meeting the level body. So the level
  // section stops at the C-frame crowns (~0.28w) and the slope runs all the way out.
  const halfW = x => W2 * Math.pow(Math.max(1e-4, 1 - Math.pow(Math.abs(x / L2), nPlan)), 1 / nPlan);
  const XF = 0.28 * w;                          // where the level body hands over to the cut end
  const hBody = x => h * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / L2), 4.5)), 1 / 1.8);
  const hAt = x => {
    if (Math.abs(x) <= XF) return hBody(x);
    const t = (Math.abs(x) - XF) / (L2 - XF);   // near-linear ramp: the sloped end face
    return hBody(XF) * Math.max(0, 1 - Math.pow(t, 1.1));
  };
  const CS = 2.7;                               // cross-section exponent: plumb walls, flat crown
                                                // (the beach side-on reads more vertical than 2.4 gave)

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
    for (const f of frameLines) { const dd = f(x, z); b += 45 * Math.exp(-(dd * dd) / (2 * 280 * 280)); }
    return Math.min(b, 60);                     // the beach photo's roofline visibly humps at the frames
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
  // An open end TRUNCATES the loft along the LEANING ARCH LINE -- the C-frame is the
  // portal's edge, crown meeting the level body, feet at the very end (PDP_1) -- and the
  // sloped cap beyond it is exactly the panel that swung up to become the awning.
  const xEdge = (s, f) => {
    const t = Math.acos(Math.min(1, f / 0.95)) / Math.PI;   // arch param: crown t=.5, feet t=0
    return s * (0.47 * w - 0.19 * w * Math.sin(t * Math.PI));
  };
  for (let iu = 0; iu <= NU; iu++) {
    for (let iv = 0; iv <= NV; iv++) {
      const v = -1 + (2 * iv) / NV;
      const f = Math.abs(Math.sin(v * Math.PI / 2));
      const xLo = openF ? xEdge(-1, f) : -L2, xHi = openR ? xEdge(1, f) : L2;
      const x = xLo + ((xHi - xLo) * iu) / NU;
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
  for (const s of [-1, 1]) {                      // C-frames: the LEANING portal arches -- feet at
    const NC = 6, cpts = [];                      // the very end, crowns meeting the level body,
    for (let i = 0; i <= NC; i++) {               // each living in its sloped end plane
      const t = i / NC;
      const x = s * (0.47 * w - 0.19 * w * Math.sin(t * Math.PI));
      const z = 0.95 * halfW(x) * Math.cos(t * Math.PI);
      const q = ride(x, z, 22);
      if (i === 0 || i === NC) q.y = 0;
      cpts.push(q);
    }
    seg(cpts, 11, alu);
    seg(cpts.slice(1, 6).map(p => p.clone().setY(p.y + 8 * MM)), 6, orange);   // sleeve tape, full arc
  }
  for (const s of [-1, 1]) {                      // A-frames: the crossing diagonals of the plan
    const apts = arcOver(-0.30 * w * s, s * 0.94 * halfW(-0.30 * w * s),
                         0.30 * w * s, s * 0.94 * halfW(0.30 * w * s), 6);
    seg(apts, 11, alu);
    seg(apts.slice(1, 6).map(p => p.clone().setY(p.y + 8 * MM)), 6, orange);   // its sleeve tape --
  }                                               // the beach photo's red lines OWN the roof
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
  // The side walls are MOSTLY WINDOW -- the beach side-on shows huge dark-trimmed panels
  // dominating the wall, only narrow fabric piers between them. The door side keeps its
  // front zone for the door; the far side gets the full pair.
  for (const s of [-1, 1]) {
    patch(0.03 * w, 0.31 * w, s * 0.38, s * 0.94, meshMat);
    rimLoop(0.17 * w, 0.14 * w, s * 0.66, s * 0.27, 4, tan);
    if (s < 0) {
      patch(-0.30 * w, -0.03 * w, s * 0.38, s * 0.94, meshMat);
      rimLoop(-0.165 * w, 0.135 * w, s * 0.66, s * 0.27, 4, tan);
    }
  }
  // Vent hoods capping each end, just under the ridge line -- only where the cap still is.
  for (const s of [-1, 1]) {
    if ((s < 0 && openF) || (s > 0 && openR)) continue;
    patch(s * 0.40 * w, s * 0.475 * w, -0.30, 0.30, darkMat, 24);
  }

  // Guy-line plumbing, shared by the frame feet and the awning poles below.
  const guyPts = [], gv = (x, y, z) => new THREE.Vector3(x * MM, y * MM, z * MM);
  const stakeAt = (x, z) => { cyl(g, 4, 5, 22, 8, metal(0x3a3d42, 0.4, 0.6), x, 11, z); };

  // The awnings: each open end's cap fabric, swung up past the portal and propped on two
  // upright poles -- PDP_2's rear panel, as a state. Hinged at the portal crown band,
  // reaching just past where the cap's tip used to be, with a soft belly and its red
  // binding; the poles get their own guys.
  const awnMat = new THREE.MeshStandardMaterial({ color: BROWN, metalness: 0, roughness: 0.9,
    side: THREE.DoubleSide, transparent: opacity < 1, opacity });
  for (const s of [-1, 1]) {
    const open = s < 0 ? openF : openR;
    if (!open) continue;
    const len = 1500, VA = 0.6;
    const yTip = surfY(s * XF, 0) - 260;
    const P = [], I = [], M = 8, N = 8;
    for (let i = 0; i <= M; i++) for (let j = 0; j <= N; j++) {
      const t = i / M, v = -VA + (2 * VA * j) / N;
      const fh = Math.abs(Math.sin(v * Math.PI / 2));
      const xh = xEdge(s, fh);                    // hinged ON the portal arch, not a flat plane
      const hp = skin(xh, v);
      const ox = xh + s * len, oz = hp.z * 1.22;
      const oy = yTip - 90 * (1 - Math.cos(v * Math.PI));
      let x = hp.x + (ox - hp.x) * t, z = hp.z + (oz - hp.z) * t, y = hp.y + (oy - hp.y) * t;
      y -= 70 * Math.sin(Math.PI * t);            // the fabric's belly between hinge and poles
      P.push(x * MM, y * MM, z * MM);
    }
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
      const a = i * (N + 1) + j, b = a + N + 1;
      I.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    ag.setIndex(I); ag.computeVertexNormals();
    g.add(new THREE.Mesh(ag, awnMat));
    // outer-edge binding, the two uprights, and their guys
    const edge = [];
    for (let j = 0; j <= 12; j++) {
      const v = -VA + (2 * VA * j) / 12;
      const fh = Math.abs(Math.sin(v * Math.PI / 2));
      const hp = skin(xEdge(s, fh), v);
      edge.push(new THREE.Vector3((xEdge(s, fh) + s * len) * MM,
        (yTip - 90 * (1 - Math.cos(v * Math.PI))) * MM, hp.z * 1.22 * MM));
    }
    tube(edge, 4, red);
    for (const sv of [-1, 1]) {
      const vP = sv * VA * 0.92, fP = Math.abs(Math.sin(vP * Math.PI / 2));
      const hp = skin(xEdge(s, fP), vP);
      const px = xEdge(s, fP) + s * (len - 60), pz = hp.z * 1.22, py = yTip - 90 * (1 - Math.cos(VA * 0.92 * Math.PI));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(9 * MM, 9 * MM, py * MM, 10), alu);
      pole.position.set(px * MM, py / 2 * MM, pz * MM);
      g.add(pole);
      guyPts.push(gv(px, py, pz), gv(px + s * 550, 0, pz + Math.sign(pz) * 260));
      stakeAt(px + s * 550, pz + Math.sign(pz) * 260);
    }
    // the portal's own binding, hugging the leaning arch
    const rim = [];
    for (let j = 0; j <= 16; j++) {
      const v = -1 + (2 * j) / 16, fr = Math.abs(Math.sin(v * Math.PI / 2));
      const p = skin(xEdge(s, fr), v);
      rim.push(new THREE.Vector3(p.x * MM, (p.y + 6) * MM, p.z * MM));
    }
    tube(rim, 4, red);
  }

  // Guys at the frame feet, out at the manual's ~45 degrees, and their stakes. An OPEN end
  // has lost its cap -- its anchors moved to the awning poles above, so skip them here.
  for (const [gx, gz] of [[-0.47, 0.3], [-0.47, -0.3], [0.47, 0.3], [0.47, -0.3],
                          [-0.30, 0.98], [-0.30, -0.98], [0.30, 0.98], [0.30, -0.98]]) {
    if (Math.abs(gx) > 0.4 && ((gx < 0 && openF) || (gx > 0 && openR))) continue;
    const ax = gx * w, az = gz * halfW(gx * w);
    const ay = surfY(ax, az) * 0.55;
    const sx = ax + Math.sign(gx) * 0.5 * ay, sz = az + Math.sign(gz) * 0.9 * ay;
    guyPts.push(gv(ax, ay, az), gv(sx, 0, sz));
    stakeAt(sx, sz);
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
  const steel = metal(color, 0.5, 0.35);
  // One bent wire, hook to hook: a flat, square-cornered U bail, each arm jogging 12mm inward
  // before it turns up into its hook -- up to the top, over, and down as the free leg that drops
  // into the frame's end-piece hole. The bail hangs 26 below the hooks' tops; the published 41 is
  // that free leg (hero, and the two photos of it carrying a box). It was a Catmull-Rom wire that
  // sagged and bulged to 172 x 52.
  const r = 2.5, x0 = w / 2 - r, x1 = x0 - 12;
  const zH = -d / 2 + r + 12, zF = d / 2 - r;
  const yTop = -r, yBail = -26 + r, yTip = -h + r;
  const half = s => [[s * x1, yTip, zH - 12], [s * x1, yTop, zH - 12], [s * x1, yTop, zH], [s * x1, yBail, zH],
                     [s * x1, yBail, zH + 22], [s * x0, yBail, zH + 36], [s * x0, yBail, zF]];
  bentTube(g, [...half(-1), ...half(1).reverse()], r, steel,
    { rad: [0, 5, 5, 5, 6, 6, 10, 10, 6, 6, 5, 5, 5, 0] });
  // the two joint blocks that seat the hooks on the end piece
  const alu = metal(0xc4c8ca, 0.5, 0.4);
  for (const s of [-1, 1]) box(g, 22, 18, 16, 2, alu, s * x1, -11, zH - 6);
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }),
    0, -h / 2, 0);
  return { group: g, body: ghost };
}

/** TTA Side Tray (CK-304): a 200mm round stainless tray, not a clamp. The hero: a flat disc
 *  with a short rolled edge, and standing on a boss the black-gripped fixing shaft (the
 *  シリコンゴム of the materials line; JP a002 shows the same shaft dropped through the
 *  table-edge clamp in use -- the clamp is mounting, not the read, and is not modelled).
 *  The post is OFF-CENTRE: the tray hangs from the table edge by it, so it stands near the rim
 *  -- about 50mm from the middle in the side-on JP a001 (44 px at 1.14 mm/px, plus what the
 *  camera cannot see in depth), 47mm in the hero; 55 here. (It used to stand dead centre.)
 *  Measured against the published phi200: boss phi28 x 16, shaft ~phi7, grip phi12 x 35, the
 *  grip's top 86mm over the floor in a001 (it was ~50). The published h=28 is dish + boss;
 *  the shaft is packed loose and stands past it. Lip at y = 0, dish floor at -8, the post
 *  rising above -- the burners' exception, built in. */
export function sideTrayGroup(w, d, h, color) {
  const g = new THREE.Group();
  const R = Math.min(w, d) / 2;
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
    metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  // the dish, lathed: floor, a rise to the lip, and the lip rolled back under itself
  const prof = [[0, -8], [R - 14, -8], [R - 6, -5], [R - 1.5, -0.5], [R, 0], [R - 3, -2.5]]
    .map(([px, py]) => new THREE.Vector2(px * MM, py * MM));
  const dish = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), steel);
  g.add(dish);
  const pz = -55;                                                      // the post, toward the rim
  cyl(g, 14, 14, 16, 24, metal(color, 0.85, 0.3), 0, 0, pz);           // the boss, on the floor
  cyl(g, 3.5, 3.5, 38, 12, metal(0xc6cacf, 0.85, 0.3), 0, 26, pz);     // the fixing shaft
  cyl(g, 6, 6, 35, 14, metal(0x17181b, 0.05, 0.75), 0, 59.5, pz);      // its black grip, top at +77
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

/** TTA Unit Clamp Tool (CK-300): the clamp every Table Top Architect part stands in. Polished
 *  stainless, and nothing like a bent C-plate: TWO knurled barrels on one vertical axis -- the
 *  upper one sits on the table top and takes an accessory's shaft, the lower one screws up
 *  under the table -- carried in a yoke of two flat C-shaped cheeks joined down the back, which
 *  wraps the table edge (hero 01404; in use 05971 / 05976).
 *  Against the published 56 x 52 x 100: the yoke is the 56, the 52 runs from the back of the
 *  yoke to the front of the barrels, the 100 is cap to cap. In the hero each barrel measures
 *  about phi30 x 34 with a grooved cap, the gap between them (the table) 32, and each cheek a
 *  strap about 12 wide with its outer corners clipped. The barrels hang on a cross pin through
 *  the cheeks. Metalness 0.3: with nothing to mirror, polished steel at 0.85 draws near black.
 *  Top cap at y = 0, hanging to -h; the yoke's back at -z, the barrels toward +z (the table). */
export function unitClampGroup(w, d, h, color) {
  const g = new THREE.Group();
  const steel = metal(color, 0.3, 0.3), bright = metal(0xd2d4d6, 0.3, 0.22);
  const R = 15, bh = 34, zc = d / 2 - R;             // barrel radius and height; the barrels' axis
  let body = null;
  for (const [y0, cap] of [[0, -1], [-(h - bh), 1]]) {     // upper, lower; which end wears the cap
    const b = cyl(g, R, R, bh - 6, 24, steel, 0, y0 - bh / 2 + cap * 3, zc);
    body = body || b;
    const yc = cap < 0 ? y0 - 3 : y0 - bh + 3;       // the cap: a groove, then a slightly proud disc
    cyl(g, R - 2, R - 2, 2, 20, steel, 0, yc - cap * -2, zc);
    cyl(g, R + 0.5, R + 0.5, 4, 24, bright, 0, cap < 0 ? y0 - 2 : y0 - bh + 2, zc);
    const pin = cyl(g, 3, 3, w, 10, steel, 0, cap < 0 ? y0 - 11 : y0 - bh + 11, zc);
    pin.rotation.z = Math.PI / 2;                    // the cross pin the barrel hangs on
  }
  // the yoke: two cheeks (C-shaped straps, 3 thick) and the web down their backs
  const zb = -d / 2, zf = zc + 7, s = 12, yT = -5, yB = -(h - 5);
  const cee = [[zf, yT], [zb + 9, yT], [zb, yT - 9], [zb, yB + 9], [zb + 9, yB], [zf, yB],
               [zf, yB + s], [zb + s + 3, yB + s], [zb + s, yB + s + 3], [zb + s, yT - s - 3],
               [zb + s + 3, yT - s], [zf, yT - s]];
  for (const sx of [-1, 1]) plate(g, cee, 3, steel, [sx * (w / 2 - 1.5), 0, 0], [0, 0, 1], [0, 1, 0]);
  box(g, w - 6, h - 34, 2, 0, steel, 0, -h / 2, zb + 1);
  return { group: g, body };
}

/** TTA Windscreen (CK-301): FOUR galvalume panels hinged edge to edge -- two wide centre
 *  panels and a narrow wing at each end -- with a black clip over the top of each of the three
 *  hinges. Laid flat (hero 09981, 760 = 1150 px, 0.66 mm/px) the panels measure 132 | 249 |
 *  249 | 132, 225 tall; each wing's top outer corner is cut away on a long diagonal, from 20
 *  out along the top edge down to 122 below it on the outer edge, and each wing carries two
 *  black keyhole grommets 42 from its hinge. (It was three equal 253 panels with gaps, in dark
 *  grey.) Drawn the way it stands in use (06031 / 06040): the centre pair in one plane, the
 *  wings swung forward about 0.6 rad -- so it builds about 714 x 226 x 76 against the published
 *  flat 760 x 26 x 226. Bright spangled zinc, kept at low metalness so it reads as bright.
 *  Clips' tops at y = 0, hanging to -h; the wings come toward +z. */
export function screenGroup(w, d, h, color) {
  const g = new THREE.Group();
  const zinc = metalE(0xd6d9dc, 0.4, 0.5), black = metalE(0x17181b, 0.1, 0.8);
  const wing = 131, mid = (w - 2 * wing) / 2, H = h - 4, t = 1.5, fold = 0.6, y0 = -h;
  let body = null;
  for (const sx of [-1, 1]) {
    const c = plate(g, [[0, 0], [mid - 1, 0], [mid - 1, H], [0, H]], t, zinc, [sx > 0 ? 1 : -mid, y0, 0], [1, 0, 0], [0, 1, 0]);
    body = body || c;
    const out = [sx * Math.cos(fold), 0, Math.sin(fold)];        // the wing's own outward direction
    plate(g, [[1, 0], [wing - 8, 0], [wing, 8], [wing, H - 122], [20, H], [1, H]], t, zinc,
      [sx * mid, y0, 0], out, [0, 1, 0]);
    for (const up of [50, 109]) {                                // the two keyhole grommets
      const k = cyl(g, 7, 7, t + 2, 12, black, sx * mid + out[0] * 42, y0 + up, out[2] * 42);
      k.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-out[2], 0, out[0]));
    }
  }
  for (const x of [-mid, 0, mid]) {                              // hinge pins and their clips
    cyl(g, 1.6, 1.6, H, 6, zinc, x, y0 + H / 2, 0);
    box(g, 38, 17, 8, 0, black, x, -8.5, 0);
  }
  return { group: g, body };
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
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }),
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
 *  hero shows them (just below the top corners, just above the bottom ones). The sides are
 *  STRAIGHT and the corners a tight bend, about R25 in the hero and in the bare top U (01304).
 *  (It was a spline through the corner points, which bowed every side outward: 370 x 507.)
 *  Mostly air -> a faint ghost box carries picking. */
export function ttaFrameGroup(w, d, h, color) {
  const g = new THREE.Group();
  const steel = metal(color, 0.9, 0.25);
  const r = Math.min(d, 12) / 2;                    // the published d=12 IS the tube
  const fr = r * 1.5;                               // the knurled ferrules, 1.5 tubes across (01304)
  const x1 = w / 2 - fr, yT = -r, yB = -(h - r);    // they are the widest thing: 333 is over them
  bentTube(g, [[x1, yB, 0], [x1, yT, 0], [-x1, yT, 0], [-x1, yB, 0]], r, steel, { rad: 25, closed: true, radial: 8 });
  for (const sx of [-1, 1]) for (const fy of [-0.11 * h, -0.90 * h])   // the ferrule joints
    cyl(g, fr, fr, 26, 12, metal(color, 0.85, 0.3), sx * x1, fy, 0);
  const ghost = box(g, w, h, Math.max(d, 26), 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }),
    0, -h / 2, 0);
  return { group: g, body: ghost };
}

/** A ring holder (CK-306 Sierra cup holder / DB-005 garbage frame): a flat wire ring. CK-306
 *  carries a short straight STEM standing radially off the ring, and on the stem, in line with
 *  it, a slotted clamp barrel with a knurled knob on its outboard end (07198 hero, 07202 plan,
 *  07208) -- so `clamp` draws that; DB-005 keeps the plain tab. The published 160 x 125 x 18 is
 *  stem-and-barrel length x ring x barrel: ring OD 125 of 5mm wire, barrel phi18, and the 35 left
 *  over is a 12 stem and a 23 barrel-with-knob. (The barrel used to lie TANGENT on the ring,
 *  which built 119 long.) The plan photo itself would make stem + barrel nearer 45 against a
 *  125 ring; the published length is kept. */
export function ringGroup(w, d, h, color, { clamp = false } = {}) {
  const g = new THREE.Group();
  const mat = metalE(color, 0.85, 0.32);
  const R = Math.min(w, d) / 2;
  if (clamp) {
    // ring, stem, barrel, knob, in a row along x; the ring sits off-centre so the whole is w long
    const wr = 2.5, br = h / 2, stem = 12, knobL = 9, y = -h / 2;
    const cx = -w / 2 + R, bodyL = w - 2 * R - stem - knobL;      // ring centre; barrel body length
    const steel = metalE(color, 0.5, 0.3);
    const ring = new THREE.Mesh(new THREE.TorusGeometry((R - wr) * MM, wr * MM, 10, 48), steel);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx * MM, y * MM, 0);
    g.add(ring);
    const along = (rr, len, x0, m, seg = 16) => {                 // a cylinder lying along x from x0
      const c = cyl(g, rr, rr, len, seg, m, x0 + len / 2, y, 0);
      c.rotation.z = Math.PI / 2;
      return c;
    };
    along(wr, stem + 2, cx + R - 2, steel, 8);
    along(br, bodyL, cx + R + stem, steel);
    along(br, knobL - 1, cx + R + stem + bodyL + 1, metalE(color, 0.5, 0.45), 20);   // the knurled knob, a hair off the body
    return { group: g, body: ring };
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry((R - 6) * MM, 3 * MM, 10, 28), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -h / 2 * MM;
  g.add(ring);
  {
    const tab = new THREE.Mesh(roundedBox(18 * MM, Math.max(h, 10) * MM, 4 * MM, 1 * MM), mat);
    tab.position.set(0, -h / 2 * MM, -(R - 2) * MM);
    g.add(tab);
  }
  return { group: g, body: ring };
}

/** A soft carrying case: a closed rounded box with a lid seam and an arch handle -- a bag,
 *  not an open bin. */
/** A soft cloth body: a superellipse section (n = 2 an ellipse, higher a softer rectangle) swept
 *  along x, each end a flat cap with its edge rounded over `end` mm. Indexed, so its normals are
 *  smooth: an extruded rounded box shades every facet flat, which reads as a hard case. mm in,
 *  metres out, centred on the origin. */
function softRollGeo(len, h, d, { n = 5, end = 16, seg = 32, rings = 5 } = {}) {
  const e = Math.min(end, len / 2), rho = Math.min(0.95, e / (Math.min(h, d) / 2));
  const half = [[0, 0]];                                 // [distance in from the end, section scale]
  for (let k = 0; k <= rings; k++) {
    const a = (k / rings) * Math.PI / 2;
    half.push([e * (1 - Math.cos(a)), 1 - rho * (1 - Math.sin(a))]);
  }
  const st = [...half.map(([x, s]) => [-len / 2 + x, s]), ...half.map(([x, s]) => [len / 2 - x, s]).reverse()];
  const pos = [], uv = [], idx = [], q = 2 / n;
  st.forEach(([x, s], i) => {
    for (let j = 0; j < seg; j++) {
      const t = (j / seg) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      pos.push(x * MM, s * (h / 2) * Math.sign(sn) * Math.abs(sn) ** q * MM, s * (d / 2) * Math.sign(c) * Math.abs(c) ** q * MM);
      uv.push(i / (st.length - 1), j / seg);
    }
  });
  for (let i = 0; i < st.length - 1; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = (i + 1) * seg + j, a1 = i * seg + (j + 1) % seg, b1 = (i + 1) * seg + (j + 1) % seg;
      idx.push(a, b, a1, b, b1, a1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function caseGroup(w, d, h, color) {
  const g = new THREE.Group();
  // A soft black wrap case, 110 x 90 in section with soft edges and squarish ends. Two webbing
  // straps wrap it either side of the middle, and a flat webbing handle runs between them on
  // each side of the top, lying slack (UG-902 and UG-903 heroes, UG-904 a099). No zip: it closes
  // as a wrap, the flap's edge showing as a line low on the front. It was a faceted rounded box
  // with a zip, round rope straps and a rigid arched grip.
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0, roughness: 0.92 });
  const web = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), metalness: 0, roughness: 0.85 });
  const body = new THREE.Mesh(softRollGeo(w, h, d), cloth);
  body.position.y = -h / 2 * MM;
  g.add(body);
  const sx0 = Math.min(125, w * 0.18);
  for (const s of [-1, 1]) {
    const band = new THREE.Mesh(softRollGeo(26, h + 3, d + 3, { end: 1, rings: 1 }), web);
    band.position.set(s * sx0 * MM, -h / 2 * MM, 0);
    g.add(band);
  }
  for (const [z, rise] of [[-16, 22], [16, 12]]) {       // the two handles: 22 wide webbing, slack
    const hd = bentTube(g, [[-sx0, 1.5, 0], [-sx0 * 0.6, rise, 0], [sx0 * 0.6, rise, 0], [sx0, 1.5, 0]],
      1.6, web, { rad: 18, radial: 4 });
    hd.scale.z = 7;
    hd.position.z = z * MM;
  }
  box(g, w - 44, 1, 1.2, 0, web, 0, -h * 0.64, d / 2 + 0.2);     // the wrap flap's edge
  return { group: g, body };
}

/** A rail set sold on its own (CK-902-1 / 903-1 / 904-1, the collapsible frames' rails): what
 *  is in the box is TWO separate black rails, each the published 86 wide x 25 thick and 512 /
 *  762 / 1012 long, a silver plate riveted on each end (gallery CK-903 03_* and 04_*). `w` is
 *  the rail's length, `d` ONE rail's width. (This took the 86 for a frame's depth and built a
 *  single slab with the two rails folded through each other.) Laid side by side the way they
 *  go in the frame, seats facing, a hand's width apart. Tops at y = 0. */
export function railsGroup({ w, d, thick, section, color = BLK_ }) {
  const g = new THREE.Group();
  const gap = 60;
  // the frame's own section, its seat narrowed so the rail is the published width: the flat
  // top stays the frame's 65.5, which is what the plate sits on
  const lipW = section.lip_mm[1] - section.lip_mm[0], chan = section.channel_mm[1] - section.channel_mm[0];
  const flat = section.rail_width_mm - lipW;
  const prof = { outerWall: (flat - chan) * MM, channel: chan * MM, lip: (d - flat) * MM };
  for (const s of [-1, 1]) {
    const railMat = metalE(color, 0.3, 0.6);       // matte black anodising, as on the frame
    railMat.vertexColors = true;   // same baked seat crease as the frame's rails
    const r = new THREE.Mesh(railProfile(w * MM, thick * MM, prof, s), railMat);
    r.position.set(0, -thick / 2 * MM, s * (gap / 2 + d / 2) * MM);
    g.add(r);
    const edge = gap / 2 + d;                      // this rail's outer edge
    for (const sx of [-1, 1])                      // the plate: 1 to 55 from the rail's end, as on the frame
      railPlateInto(g, sx * (w / 2 - 28), s * (edge - 37.5), sx * (w / 2 - 33.5), s * (edge - 40.5));
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

/** Stainless Kitchen Table IGT Frame Connector (LV-312): a PAIR of folded stainless bars, each
 *  the published 515 x 45 x 25 -- a 45-wide flange the frame's end rests on, a 25 web folded
 *  down one long edge with three hook notches near each end, a tab folded down across each end
 *  and a low lip along the other edge (hero; a003 the notches, a004 the tab and the slotted
 *  hole in the flange). Notch centres off the hero, the 515 as the ruler: 49, 87, 113 and 369,
 *  396, 438 from one end; each about 6 wide and 9 deep, round-topped. The set's knurled
 *  thumbscrew and sleeve nut (a001, a002) stand in the flange's slotted hole; one per bar, at
 *  the end a004 shows -- ASSUMED, no photo shows a whole flange from above. (It was one flat
 *  strip.) The two bars lie side by side as in the hero. Flange tops at y = 0. */
export function frameConnectorGroup(w, d, h, color) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
    metalness: 0.8, roughness: 0.42, side: THREE.DoubleSide });   // satin, the rail's response
  const t = 1.5, gap = 60;
  // the web, drawn flat: the bar's length by its height, notches cut up from the free edge
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  for (const x of [49, 87, 113, 369, 396, 438]) {
    s.lineTo((x - 3) * MM, 0); s.lineTo((x - 3) * MM, 6 * MM);
    s.absarc(x * MM, 6 * MM, 3 * MM, Math.PI, 0, true);
    s.lineTo((x + 3) * MM, 0);
  }
  s.lineTo(w * MM, 0); s.lineTo(w * MM, h * MM); s.lineTo(0, h * MM);
  const webGeo = new THREE.ExtrudeGeometry(s, { depth: t * MM, bevelEnabled: false, curveSegments: 5 });
  let body = null;
  for (const k of [-1, 1]) {
    const z0 = k * (gap + d) / 2;                                    // this bar's centre line
    const flange = box(g, w, t, d, 0, steel, 0, -t / 2, z0);
    body = body || flange;
    const web = new THREE.Mesh(webGeo, steel);
    web.position.set(-w / 2 * MM, -h * MM, (z0 + d / 2 - t) * MM);
    g.add(web);
    for (const sx of [-1, 1]) box(g, t, h, 28, 0, steel, sx * (w - t) / 2, -h / 2, z0 + d / 2 - 14);
    box(g, w - 2 * t, 3, t, 0, steel, 0, -t - 1.5, z0 - d / 2 + t / 2);
    // the thumbscrew through the flange's slotted hole, its sleeve nut underneath
    const hx = -w / 2 + 70;
    knobInto(g, hx, 1.5, z0, 6, 3.5);
    cyl(g, 3, 3, 1.5, 10, steel, hx, 0.75, z0);
    cyl(g, 4, 4, 13, 10, steel, hx, -t - 6.5, z0);
    cyl(g, 6, 6, 3, 14, metal(0x878c92, 0.75, 0.6), hx, -t - 14.5, z0);
  }
  return { group: g, body };
}

/** A bamboo sliding extension (CK-153/154): a cantilevered bamboo board on the frame's LONG side.
 *  Board top at y = 0, flush with the frame; the mounting edge is at -z, the board reaches +z.
 *
 *  From above it is a clean board with two small silver tabs at the rail edge (the US plan shot
 *  alt_02: tabs at +/-111 of the 423, 22 wide, reaching 21 mm past the board's edge; CK-154's
 *  gallery is CK-153's photographs, so its tabs take the same fraction of its width, assumed).
 *  Everything else is UNDER it (JP a003, a004): beneath each tab a triangular aluminium gusset --
 *  a flange screwed to the underside about 95 mm out, a strut back down from its far end -- on
 *  the hook profile that clips the rail's outer grooves. The published 33 mm is board plus that
 *  bracket; the board is `boardMm` (about 13: its edge is 0.46 of the frame's 30 mm end piece in
 *  a004). The board's edge stands `SLIDE_STANDOFF` off the rail, the profile between them (a001).
 *
 *  It was a 16 mm board with two dark L-brackets standing 18 mm proud ON TOP of it. */
export const SLIDE_STANDOFF = 12;   // board edge to rail face; core.js SLIDE_GAP places it by the same number
export function slideExtGroup(w, d, h, color, grainTex = null, boardMm = 13) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.05, roughness: 0.7 });
  const R = 16;                                       // corner radius in plan, off alt_02
  const top = new THREE.Mesh(flatRect(w * MM, d * MM, boardMm * MM, R * MM), wood);
  g.add(top);                                         // flatRect hangs from its top face: y = 0

  // The board's own top, rectified from its photograph, laid on as a thin decal cut to the same
  // rounded outline (a plain rectangle's corners stood out past the board's).
  if (grainTex) {
    // A photograph is sRGB. Left untagged it was read as linear light and the board came out
    // near white beside every other bamboo part.
    if (grainTex.colorSpace !== THREE.SRGBColorSpace) {
      grainTex.colorSpace = THREE.SRGBColorSpace;
      if (grainTex.image) grainTex.needsUpdate = true;
    }
    const s = new THREE.Shape(filletRing([[-w / 2, -d / 2, R], [w / 2, -d / 2, R], [w / 2, d / 2, R], [-w / 2, d / 2, R]])
      .map(([x, y]) => new THREE.Vector2(x * MM, y * MM)));
    const geo = new THREE.ShapeGeometry(s);
    // The photograph over the whole board -- less the white it carries at its two ends (16 and 11
    // of its 640 px), which lay on the board as a pale strip down each short edge.
    const pos = geo.attributes.position, uv = geo.attributes.uv, u0 = 0.028, u1 = 0.980;
    for (let i = 0; i < pos.count; i++)
      uv.setXY(i, u0 + (pos.getX(i) / (w * MM) + 0.5) * (u1 - u0), pos.getY(i) / (d * MM) + 0.5);
    const decal = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grainTex, metalness: 0.03, roughness: 0.72 }));
    decal.rotation.x = -Math.PI / 2;                  // lay it flat, facing up
    decal.position.y = 0.3 * MM;                      // just above the board top (y=0)
    g.add(decal);
  }

  const alu = metal(0xd6d9dc, 0.35, 0.5);             // the same pale satin aluminium as the board brackets
  const edgeZ = -d / 2, tabW = 22, bx = w * 0.26;
  const drop = h - boardMm;                           // the bracket's reach below the board: 20
  for (const sx of [-1, 1]) {
    const x = sx * bx;
    // the tab: all that shows from above -- 12 mm onto the board, 21 past its edge onto the rail
    box(g, tabW, 1.5, 33, 0, alu, x, 0.75, edgeZ - 4.5);
    // the hook profile, in the gap between board and rail, down to the bottom of the bracket
    box(g, tabW, h, 5, 0, alu, x, -h / 2, edgeZ - SLIDE_STANDOFF / 2);
    // the gusset: its flange against the underside, and the strut from the flange's far end back
    // down to the foot of the profile
    box(g, tabW, 3, 95, 0, alu, x, -boardMm - 1.5, edgeZ + 47.5);
    const run = 95 + SLIDE_STANDOFF / 2, len = Math.hypot(run, drop - 3);
    const strut = box(g, tabW - 6, 3, len, 0, alu, x, -boardMm - 1.5 - (drop - 3) / 2, edgeZ + 95 - run / 2);
    strut.rotation.x = -Math.atan2(drop - 3, run);
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
  const mat = metalE(color, 0.5, 0.4);
  // The border: the dia 5 frame rod, top face on the y = 0 datum.
  for (const sz of [-1, 1]) box(g, w, 5, 5, 2, mat, 0, -2.5, sz * (d / 2 - 2.5));
  for (const sx of [-1, 1]) box(g, 5, 5, d - 10, 2, mat, sx * (w / 2 - 2.5), -2.5, 0);
  // The weave: square to the frame at a 15mm pitch -- S-029HA's true plan view (gallery 08_a007)
  // puts a column every 62px across the 1412px that is its 339mm. (It was drawn on the diagonal at
  // 11mm, off the hero's oblique view.) The two families stack a hair apart, which is all a
  // weave is at this scale.
  const iw = w - 10, id = d - 10, pitch = 15;
  const nx = Math.round(iw / pitch), nz = Math.round(id / pitch);
  for (let j = 1; j < nx; j++) box(g, 2.5, 2.2, id, 0, mat, -iw / 2 + (j * iw) / nx, -1.8, 0);
  for (let j = 1; j < nz; j++) box(g, iw, 2.2, 2.5, 0, mat, 0, -3.2, -id / 2 + (j * id) / nz);
  // The feet: a dia 5 rod under each LONG edge, its ends rising back into the frame; they are
  // what the published 18 measures.
  for (const sz of [-1, 1]) {
    const fz = sz * (d / 2 - 2.5);
    box(g, w - 56, 5, 5, 2, mat, 0, -(h - 2.5), fz);
    for (const sx of [-1, 1]) cyl(g, 2.5, 2.5, h - 5, 10, mat, sx * (w / 2 - 30), -h / 2, fz);
  }
  // The ghost pick box: the part is mostly air, and this is what the caller tags.
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false }),
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
  const netMat = metal(0xd0d4d9, 0.5, 0.4), plateMat = metal(0x33373d, 0.42, 0.55);
  const net = (nw, nd, cx) => {
    // 15mm pitch, φ2.5 wire, square to the frame -- S-029HA's plan view (gallery 08_a007) puts
    // a column every 62px across the 1412px that is its 339mm, and its spec prints the gauge
    // (ネット／ステンレス φ2.5mm); same weave on the Pro.L. (It was 11, off the hero's oblique
    // view, and the weave was believed to run diagonal.)
    const rim = 6, pitch = 15;
    for (const sz of [-1, 1]) box(g, nw, 4, rim, 1, netMat, cx, y - 2, sz * (nd / 2 - rim / 2));
    for (const sx of [-1, 1]) box(g, rim, 4, nd, 1, netMat, cx + sx * (nw / 2 - rim / 2), y - 2, 0);
    const iw = nw - 2 * rim, id = nd - 2 * rim;
    const nx = Math.round(iw / pitch), nz = Math.round(id / pitch);
    for (let j = 1; j < nx; j++) box(g, 2.5, 2, id, 0, netMat, cx - iw / 2 + (j * iw) / nx, y - 1.5, 0);
    for (let j = 1; j < nz; j++) box(g, iw, 2, 2.5, 0, netMat, cx, y - 3.5, -id / 2 + (j * id) / nz);
  };
  if (kind === "net") return net(484, 352, 0);
  // two half nets side by side, each 206 along the bridge's rails and 339 across them (they
  // were turned the other way and overlapped into one strip)
  if (kind === "halves") { net(206, 339, -106); net(206, 339, 106); return; }
  if (kind === "plate") {
    grillPanInto(g, y + 23);                             // the same pan the bench draws
  }
}

/** 炭床Pro.L (ST-032S), dropped into a group at `y`. A 310x310x20 cast-iron GRATE, not a tray: its
 *  photo is a dense field of parallel slots interrupted by a raised rectangular boss with the logo
 *  on it, and four little feet underneath (the JP copy says so -- 裏には4個の小さな脚 -- which is why
 *  it doubles as a trivet). It is clear-coated cast iron and photographs a warm grey-khaki: both
 *  studio shots sample #a9a28e to #b3ac95. (It was drawn 0x3a3632, near black.) */
function coalBedInto(g, bed, y) {
  const iron = metal(0xaea791, 0.3, 0.68);
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

/** 焚火台グリルブリッジL (ST-032GBR): a flat stainless frame on two folding end gates that stand it
 *  over the Takibi L's rim. Its manual is unusually blunt about what it is, under 警告:
 *  「本製品は焚火台Lにセットした場合にのみ安定する構造です。単品で自立させてものを置くと転倒事故の
 *  原因になりますので、必ず焚火台Lにセットした状態でご使用ください」-- only stable ON the Takibi L.
 *  That is why the planner never places it: a part that tips over if you set it down is not a part
 *  with a position.
 *
 *  Off its hero: two rails about 45 wide lying FLAT along the 445, their outer edges the 440; a thin
 *  bar closing each end; and under each end a gate -- two notched straps tied by one bottom
 *  stretcher -- that folds flat under the frame (445 x 440 x 175, packing to x28). (The rails were
 *  drawn as 26 x 9 bars on edge with nothing across the ends, so the nets floated between two
 *  fences.) The 484 net and the 500 plate are longer than the 445, which is how they bear on it.
 *
 *  The straps carry a three-notch ladder, about 50 / 90 / 130 below the rail top in the hero, and
 *  it is drawn because you can see it; WHICH notch is engaged is not offered, because the three
 *  heights are not published (see BRIDGE_RISE, the middle one).
 *
 *  Rails at y = 0 -- its working top is where the food goes -- body hanging to -h. */
export function grillBridgeGroup(w, d, h, { color = 0xb9bec4, surface = null } = {}) {
  const g = new THREE.Group();
  const mat = metal(color, 0.45, 0.42);
  const railW = 45, railT = 8, strapW = 22, strapT = 3;

  let body = null;
  for (const sz of [-1, 1]) {                    // the two flat rails
    const r = box(g, w, railT, railW, 1.5, mat, 0, -railT / 2, sz * (d / 2 - railW / 2));
    if (!body) body = r;
  }
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 4.5);
    box(g, 9, 5, d - 2 * railW, 1, mat, x, -2.5, 0);                  // the thin end bar, rail to rail
    box(g, strapT, 8, d - strapW, 1, mat, x, -(h - 4), 0);            // the gate's bottom stretcher
    for (const sz of [-1, 1]) {
      const z = sz * (d / 2 - strapW / 2);
      box(g, strapT, h - railT, strapW, 1, mat, x, -railT - (h - railT) / 2, z);   // a notched strap
      for (const drop of [50, 90, 130])          // the ladder: three lugs, the rim sits in one
        box(g, strapT, 5, 9, 0.8, mat, x, -drop, z - sz * (strapW / 2 + 3));
    }
  }
  if (surface) surfaceInto(g, surface, 2);
  return { group: g, body };
}

/** Takibi Fire & Grill L (ST-032RS; JP 焚火台L, US "Pack & Carry L Fireplace"): four stainless
 *  plates hinged into an inverted PYRAMID, standing on four bent-tube loops that cross under its
 *  point. The manual's セット内容 line drawing, the studio shot and the elevations all show the
 *  same four triangles converging on one vertex.
 *
 *    本体      four identical plates. Each plate's plane meets the next along a slant seam, and the
 *              four planes close a 455 square at the rim -- that is the published W455 x D455 --
 *              but the plates' top corners are ROUNDED OFF, so each rim tube is only about 390
 *              long and the corners of the square stand open. Measured on the face-on elevation
 *              (JP switch2, scanned row by row): the plate's slant edges run out to 327 px at the
 *              rim line, the tips of the two side plates stand 317 px apart (= 455), and the rim
 *              itself spans 273 px = 392. A corner radius of 31 gives exactly that, and it is also
 *              what lets four such plates fold to the published 640 pack. (Drawn before as sharp
 *              triangles on the full 455, the bowl read a fifth too wide.)
 *    ヒンジ     adjacent plates are hinged along their slant edges -- which is why the four collapse
 *              to a 32mm pack, and why the slant edges are drawn TWICE below: each plate carries its
 *              own tube and the two lie side by side at the seam.
 *    縁        a rolled tube around each plate's WHOLE perimeter, corners and all.
 *    穴        five holes per plate in a line under the rim: the primary air. Counted (5) and scaled
 *              (~50mm pitch) off two elevations that agree; the diameter is the weakest of the three
 *              and is drawn at 8, not claimed.
 *    脚        FOUR tube loops, one per plate, each running from the vertex out to a foot under the
 *              opposite corner -- so from any side the limbs cross in an X under the point. Two
 *              kinds, in opposite pairs, read off the hero and the two elevations together:
 *                - under two opposite plates the limb lands, runs ~67 along the ground and rises as
 *                  an outer STRUT to the rim corner, where it elbows out and wraps the open corner
 *                  (the carrying handle; these two corners meet when the pit folds);
 *                - under the other two it turns in a tight hairpin and climbs back to the seam,
 *                  where a strap rivets it about two fifths of the way up.
 *              On the elevation (455 = 317 px): limbs land 111 out along each axis, the strut
 *              leaves the ground at 178 and elbows at about 193 out, 272 up. The loop that closed
 *              each pair of limbs with a bar on the floor under the vertex does not exist.
 *
 *  All three published numbers get used: 455 is the rim square, 315 is rim-to-ground, and the bowl
 *  is TAKIBI_DEPTH deep -- so the vertex stands 115 above the ground.
 *
 *  Feet at y = 0, rim at y = h -- built the way a prop is built, because a fire pit stands on the
 *  ground and does not hang from a rail. `d` is unused: the rim is square and `w` says so. */
export function takibiGroup(w, d, h, { steel = 0xc8cbce, depth = TAKIBI_DEPTH, bridge = false,
                                       surface = null, coalBed = false, basePlate = false } = {}) {
  const g = new THREE.Group();
  const pit = new THREE.Group();               // all of it but the ground plate, which it stands ON
  g.add(pit);
  const tubeR = 5, legR = 4, plateT = 1.6;
  const half = w / 2 - tubeR;                  // 222.5: the rim tube's centreline; its outer face is the 455
  const rimY = h - tubeR, apexY = h - depth;   // the rim tube's top is the 315; the vertex at 115
  const drop = rimY - apexY;
  const slant = Math.hypot(drop, half);        // base to vertex, DOWN the plate
  const tilt = Math.atan2(half, drop);         // the plate's lean off vertical
  const CR = 31;                               // the plates' top-corner radius (see 本体)
  const edge = Math.hypot(half, slant);        // a slant edge, corner to vertex
  const cut = CR / Math.tan(Math.atan2(slant, half) / 2);   // where the corner curve leaves the straights

  // A high-metalness plate mirrors the dark half of the sky, and the bowl's outside leans its faces
  // at the ground: it rendered near black (#0e0f11) where the photos sample #b0aba7. So: pale,
  // mostly diffuse, and a little self-lit so the down-turned faces stay grey.
  const shell = metalE(steel, 0.2, 0.55, 0x55534f);
  const tubeMat = metal(0xd0d3d6, 0.5, 0.4);   // the rolled edge tube: a touch brighter than the plate
  const legMat = metal(0xc4c8cc, 0.6, 0.38);
  const punch = metalE(0x0e0f12, 0.2, 0.8);    // a hole, punched dark -- frameGroup's trick

  // ONE plate geometry, four plates. Built in its own plane with the base on the x-axis and the
  // vertex hanging at -slant, then leaned and swung into place.
  const ex = half / edge * cut, ey = slant / edge * cut;
  const s = new THREE.Shape();
  s.moveTo((-half + cut) * MM, 0);
  s.lineTo((half - cut) * MM, 0);
  s.quadraticCurveTo(half * MM, 0, (half - ex) * MM, -ey * MM);
  s.lineTo(0, -slant * MM);
  s.lineTo((-half + ex) * MM, -ey * MM);
  s.quadraticCurveTo(-half * MM, 0, (-half + cut) * MM, 0);
  const plateGeo = new THREE.ExtrudeGeometry(s, { depth: plateT * MM, bevelEnabled: false, curveSegments: 5 });
  plateGeo.translate(0, 0, -plateT * MM / 2);

  let body = null;
  for (let k = 0; k < 4; k++) {
    const rot = (k * Math.PI) / 2;
    const side = new THREE.Group();
    side.rotation.y = rot;
    // Lean the plate INWARD: its local -Y must run base -> vertex, i.e. down by `drop` and in by
    // `half`, from z = +half to z = 0. Rotating about X by +tilt sends local (0,-1,0) to
    // (0, -cos tilt, -sin tilt) -- exactly that.
    const plate = new THREE.Mesh(plateGeo, shell);
    plate.rotation.x = tilt;
    plate.position.set(0, rimY * MM, half * MM);
    side.add(plate);
    if (!body) body = plate;                   // the caller tags ONE mesh; the first plate is it

    // Five air holes, in a line parallel to the base. `t` walks down the plate, so the line follows
    // the lean instead of floating off it.
    const t = 34 / slant, hy = rimY - drop * t, hz = half * (1 - t);
    for (let i = -2; i <= 2; i++) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(4 * MM, 4 * MM, (plateT + 1) * MM, 10), punch);
      hole.rotation.x = Math.PI / 2 - tilt;    // stand the hole normal to the leaning plate
      hole.position.set(i * 50 * MM, hy * MM, hz * MM);
      side.add(hole);
    }
    pit.add(side);

    // This plate's rolled edge: along the rim, round both corners, down both slant edges to the
    // vertex. Every plate draws its own, so the seams come out double -- as the hinge photo shows.
    const c = Math.cos(rot), sn = Math.sin(rot);
    const at = (x, y, z) => [x * c + z * sn, y, -x * sn + z * c];
    bentTube(pit, [at(-half, rimY, half), at(half, rimY, half), [0, apexY, 0]], tubeR, tubeMat,
      { rad: [CR, CR, 0], closed: true });
  }
  cyl(pit, 9, 7, 16, 10, legMat, 0, apexY - 4, 0);   // the boss at the vertex, where the limbs meet

  // The legs (see 脚). The frame has a half-turn symmetry, not a quarter-turn one: sg = +1 and -1
  // are the two halves. Every tube rests ON the ground: centrelines at one tube radius.
  const L0 = 111, strutX = 178, tip = w / 2 - legR;
  // A tight V-bend's corner, sunk just far enough that the filleted tube touches the ground.
  const restOn = (a, v, b, rho) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), V = new THREE.Vector3(...v);
    for (let i = 0; i < 3; i++) {
      const u1 = A.clone().sub(V).normalize(), u2 = B.clone().sub(V).normalize();
      const run = rho / Math.tan(u1.angleTo(u2) / 2);
      V.y = legR - run * u1.y * u2.y / (u1.y + u2.y);
    }
    return [V.x, V.y, V.z];
  };
  const elbowY = 272, zAt = y => half * (y - apexY) / drop;   // the +z plate's plane, at height y
  for (const sg of [1, -1]) {
    // The strut loop: vertex -> foot -> along the ground -> up outside the bowl -> out to the open
    // rim corner, then back along the neighbouring plate's rim line to where its tube begins.
    bentTube(pit, [[0, apexY, 0], [-sg * L0, legR, -sg * L0], [-sg * strutX, legR, -sg * L0],
                   [-sg * 193, elbowY, sg * zAt(elbowY)], [-sg * tip, h - legR, sg * half],
                   [-sg * tip, h - legR, sg * (half - cut)]], legR, legMat,
      { rad: [0, 30, 30, 26, 12, 0], radial: 8 });
    // The hairpin loop: vertex -> foot -> back up to the seam, two fifths of the way to the rim.
    const up = 0.42, seam = [sg * up * half, apexY + up * drop, sg * up * half];
    bentTube(pit, [[0, apexY, 0], restOn([0, apexY, 0], [-sg * L0, 0, sg * L0], seam, 14), seam],
      legR, legMat, { rad: 14, radial: 8 });
  }

  // 炭床Pro.L: a 310x310 casting that wedges where the taper is 310. Its height is not a placement
  // choice, it is a consequence -- solve the taper for 310.
  if (coalBed) {
    const bed = 310;
    coalBedInto(pit, bed, apexY + (bed / 2) / half * drop);
  }
  // ベースプレートL: 450x450x9 of black steel on the floor. The pit's feet land inside it (they
  // reach 178 from the centre), so the whole pit stands 9 higher when it is there.
  if (basePlate) {
    box(g, 450, 9, 450, 2, metal(0x2a2c2f, 0.35, 0.65), 0, 4.5, 0);
    pit.position.y = 9 * MM;
  }
  // グリルブリッジL + whatever is laid on it.
  if (bridge) {
    const b = grillBridgeGroup(445, 440, 175, { surface });
    b.group.position.y = (h + BRIDGE_RISE) * MM;
    pit.add(b.group);
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

// What is INSIDE that envelope is measured off the photographs, not the manual's line drawing:
//   06_a002 (folded, side-on; the ring 925px = dia 240): the wind screen is a BAND 33mm tall with
//     ONE row of ports, a shallow dish under it, and the legs hang from pressed plates.
//   00_hero_01 (standing; 595px = 420): the band's rim sits at about 378, the pot supports rise
//     42 above it, the head's top is level with the rim, the leg plates pinch in to the valve
//     block at about 272 and spread again to the leg hinges at about 200; the can is 127 long
//     from its base to the end of its shoulder (the 500 can: 150 with its valve).
//   02 (the bowl from above): the head is a disc about dia 100 with six oval holes, inside a
//     second, lower ring; a brass tube loops over its side.
// It was a drum 86 tall with two port rows and its rim at 408, flat pot-support bars, the head
// down on the floor, and four straight legs off a central hub.
export function gs1000Group(w = GS1000.span, d = GS1000.span, h = GS1000.h, { canister = false } = {}) {
  const g = new THREE.Group();
  const dark = 0x30343a, brass = 0xb08a4a;
  // Bright stainless that mostly faces sideways or down: at high metalness it mirrors the dark
  // half of the room and renders black, so it is kept half-metal.
  const shell = metal(0xc8ccd0, 0.45, 0.45), bright = metal(0xd4d8dc, 0.55, 0.35);
  const punch = metalE(0x0e0f12, 0.2, 0.8);        // a hole, punched dark -- frameGroup's trick

  // 使用時 φ350 is an OUTER ENVELOPE, so it is the OUTSIDE of the rubber foot that lands on it, not
  // the foot's centre. Putting the toe at 175 pushed a 13mm-radius foot out to 188 and built a 376mm
  // stove -- 26mm over the one number that is published, and invisible to the eye. Measure the build.
  const footR = 13, R = w / 2, toeR = R - footR;   // 175 published; toes at 162 so the feet reach it
  const bodyR = GS1000.body / 2;                   // 120 -- PUBLISHED, via 収納時 φ240.
  const gotokuR = GS1000.gotoku / 2;               // 150 -- from 使用鍋径 φ31cm以下.
  // h = 420 is the OVERALL height, and it is the pot supports that reach it.
  const rimY = h - 42, bandH = 33, bandY = rimY - bandH, dishY = bandY - 12;
  const waistY = 272, waistR = 48, hingeY = 200, hingeR = 74;   // the leg plates, off the hero

  const tube = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a).multiplyScalar(MM), vb = new THREE.Vector3(...b).multiplyScalar(MM);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * MM, r * MM, va.distanceTo(vb) || MM, 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(m); return m;
  };
  const open = (color, m, r) => { const mat = metal(color, m, r); mat.side = THREE.DoubleSide; return mat; };

  // ---- the wind screen: a band, φ240 x 33, one row of ports, open top and bottom
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyR * MM, bodyR * MM, bandH * MM, 48, 1, true), open(0xc8ccd0, 0.45, 0.45));
  wall.position.y = (bandY + bandH / 2) * MM;
  g.add(wall);
  const body = wall;
  // The rolled top rim -- a TORUS, because `cyl` makes a capped cylinder and a capped cylinder here
  // is a LID: it sealed the bowl over with a solid disc and the burner head vanished behind it.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(bodyR * MM, 2.5 * MM, 6, 48), bright);
  rim.rotation.x = Math.PI / 2; rim.position.y = (rimY - 2.5) * MM;
  g.add(rim);
  // The ports: 18 round holes at mid-band. A punched dark disc only READS as a hole while it stays
  // flush and small. A cylinder's axis is local +y; rotation.z = PI/2 lays it radial.
  for (let i = 0; i < 18; i++) {
    const a = ((i + 0.5) / 18) * Math.PI * 2;
    const o = new THREE.Mesh(new THREE.CylinderGeometry(4.5 * MM, 4.5 * MM, 3 * MM, 10), punch);
    o.rotation.z = Math.PI / 2; o.rotation.y = -a;
    o.position.set(Math.cos(a) * bodyR * MM, (bandY + bandH * 0.45) * MM, Math.sin(a) * bodyR * MM);
    g.add(o);
  }
  // the shallow dish under the band, and the lower ring round the head
  const lathe = pts => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0] * MM, p[1] * MM)), 32);
  g.add(new THREE.Mesh(lathe([[0, dishY], [64, dishY], [bodyR - 1, bandY]]), open(0xbfc4c9, 0.45, 0.45)));
  g.add(new THREE.Mesh(lathe([[75, dishY], [75, rimY - 22]]), open(0xc8ccd0, 0.45, 0.45)));

  // ---- the burner head: a disc with six oval holes over a perforated skirt, its top at the rim
  cyl(g, 20, 26, rimY - 24 - dishY, 16, shell, 0, (rimY - 24 + dishY) / 2, 0);        // its pedestal
  cyl(g, 50, 43, 16, 32, metal(0x7d8288, 0.6, 0.5), 0, rimY - 16, 0);                 // the perforated skirt
  cyl(g, 50, 50, 8, 32, bright, 0, rimY - 4, 0);
  cyl(g, 10, 10, 1, 16, metal(0x8a8f96, 0.6, 0.5), 0, rimY + 0.3, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const o = cyl(g, 6, 6, 1, 12, punch, Math.cos(a) * 29, rimY + 0.3, Math.sin(a) * 29);
    o.scale.set(1.5, 1, 1); o.rotation.y = -a;                                        // an oval, long axis radial
  }
  // the brass tube that loops over the head's side
  bentTube(g, [[20, rimY - 26, 62], [14, rimY + 5, 60], [-14, rimY + 5, 60], [-20, rimY - 26, 62]],
    2, metal(brass, 0.8, 0.35), { rad: 8 });

  // ---- 回転式ゴトク: four serrated plates pivoting on the rim, rising outward to the published
  // height. They turn to meet the pot, so they sit at 45deg to the legs. One outline, four plates:
  // drawn in its own (radius, height above the rim) plane, the slot cut through it.
  const gs = new THREE.Shape(), r0 = 104, top = r => 27 + ((h - rimY - 27) * (r - r0)) / (gotokuR - r0);
  gs.moveTo(r0 * MM, 2 * MM); gs.lineTo(gotokuR * MM, 30 * MM); gs.lineTo(gotokuR * MM, top(gotokuR) * MM);
  for (let r = gotokuR - 5; r > r0 + 8; r -= 7) {                                     // the teeth
    gs.lineTo(r * MM, (top(r) - 4) * MM); gs.lineTo((r - 3) * MM, top(r - 3) * MM);
  }
  gs.lineTo(r0 * MM, top(r0) * MM); gs.closePath();
  const slot = new THREE.Path();
  slot.moveTo(116 * MM, 16 * MM); slot.lineTo(140 * MM, 29 * MM); slot.lineTo(140 * MM, 34 * MM);
  slot.lineTo(116 * MM, 23 * MM); slot.closePath();
  gs.holes.push(slot);
  const gotokuGeo = new THREE.ExtrudeGeometry(gs, { depth: 3 * MM, bevelEnabled: false });
  gotokuGeo.translate(0, 0, -1.5 * MM);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const m = new THREE.Mesh(gotokuGeo, bright);
    m.rotation.y = -a; m.position.y = rimY * MM;
    g.add(m);
    const px = Math.cos(a) * (r0 + 6), pz = Math.sin(a) * (r0 + 6), tx = -Math.sin(a) * 3, tz = Math.cos(a) * 3;
    tube([px - tx, rimY + 12, pz - tz], [px + tx, rimY + 12, pz + tz], 4, shell);       // its pivot
  }

  // ---- under the dish: the stem, the bell, and the valve block the leg plates pinch in to
  cyl(g, 10, 10, dishY - waistY - 22, 14, bright, 0, (dishY + waistY + 22) / 2, 0);
  cyl(g, 12, 30, 14, 20, shell, 0, waistY + 19, 0);
  box(g, 44, 24, 44, 0, metal(0xb4b9be, 0.5, 0.45), 0, waistY, 0, Math.PI / 4);

  // ---- the four legs. Each hangs from a pressed plate that runs in from under the band to a waist
  // at the valve block and spreads again to the leg's hinge -- an X when you look at the stove,
  // and the cage the canister hangs in. A plate here is two flat straps in the leg's radial plane.
  const strap = (a, ra, ya, wa, rb, yb, wb) => {
    const L = Math.hypot(rb - ra, yb - ya), s = new THREE.Shape();
    s.moveTo((-wa / 2) * MM, 0); s.lineTo((wa / 2) * MM, 0);
    s.lineTo((wb / 2) * MM, -L * MM); s.lineTo((-wb / 2) * MM, -L * MM); s.closePath();
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 2.5 * MM, bevelEnabled: false }), plateMat);
    const rad = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const up = rad.clone().multiplyScalar((ra - rb) / L).setY((ya - yb) / L);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tan, up, new THREE.Vector3().crossVectors(tan, up)));
    m.position.set(rad.x * ra * MM, ya * MM, rad.z * ra * MM);
    g.add(m);
  };
  const plateMat = metal(0xcdd1d5, 0.25, 0.55);    // their outer faces look DOWN: barely metal, or they go black
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0, roughness: 0.8 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const cs = Math.cos(a), sn = Math.sin(a);
    strap(a, 106, bandY - 2, 46, waistR, waistY, 18);
    strap(a, waistR, waistY, 18, hingeR, hingeY - 22, 40);
    // 脚: an upper tube off the hinge, a lower one telescoping inside it with the row of holes the
    // 脚長さ調節ボタン drops into, and a rubber foot on the ground.
    const hip = [cs * hingeR, hingeY, sn * hingeR], toe = [cs * toeR, 28, sn * toeR];
    const knee = hip.map((v, k) => v + (toe[k] - v) * 0.46);
    tube(hip, knee, 9, shell);
    tube(knee, toe, 7, bright);
    for (let k = 0; k < 5; k++) {                    // the holes, punched through the tube sideways
      const p = knee.map((v, j) => v + (toe[j] - v) * (0.18 + k * 0.14));
      tube([p[0] + sn * 7, p[1], p[2] - cs * 7], [p[0] - sn * 7, p[1], p[2] + cs * 7], 2.2, punch);
    }
    cyl(g, 11, footR, 30, 14, rubber, cs * toeR, 15, sn * toeR);     // sat ON the ground: centre 15 = half of 30
  }

  // ---- 器具栓: the flame lever, a wire triangle on a stalk off the valve block, out between two legs
  const wire = metal(0xd6dade, 0.6, 0.3), q = Math.SQRT1_2;
  bentTube(g, [[q * 20, waistY + 14, q * 20], [q * 92, waistY + 20, q * 92], [q * 124 + q * 16, waistY + 20, q * 124 - q * 16],
               [q * 124 - q * 16, waistY + 20, q * 124 + q * 16], [q * 92, waistY + 20, q * 92]], 1.6, wire, { rad: 3 });

  // ---- 専用容器, INVERTED: not part of the stove, so only when asked for. The 500 can, dia 108:
  // its base up under the valve block, its shoulder and brass valve down, the valve's own wire
  // lever beside it -- 150 from base to valve.
  if (canister) {
    const canR = 54, canTop = waistY - 22, canMat = metal(0xc8ccd0, 0.5, 0.45);
    cyl(g, canR, canR, 116, 24, canMat, 0, canTop - 58, 0);
    cyl(g, canR, 22, 22, 24, canMat, 0, canTop - 127, 0);                        // the shoulder, now down
    cyl(g, 8, 8, 12, 12, metal(brass, 0.8, 0.35), 0, canTop - 144, 0);           // the brass valve
    bentTube(g, [[6, canTop - 146, 0], [30, canTop - 150, 0], [62, canTop - 144, 14], [62, canTop - 144, -14],
                 [30, canTop - 150, 0]], 1.4, wire, { rad: 2 });
  }

  return { group: g, body };
}

// ---------------------------------------------------------------- the scale figure
//
// Not a product -- the planner's own measuring stick, so it is built here with the props but
// never enters the catalog. The style is the architectural scale figure: matte, faceless,
// capsule-limbed. It must read as a UNIT OF HEIGHT, never as a person modelled; detail would
// be invention, and the one thing this figure asserts -- how tall -- is the caller's number.
//
// Proportions are the classic head-count canons: an adult stands ~7.5 heads, a two-year-old
// ~4.5 -- which is WHY toddlers look the way they do, so the canon is the whole difference
// between the two figures. `pose` is "stand", "sit" or "ground". Seated hips ride at `seatH` (a
// camp chair by default); shins hang toward the ground and stop at their OWN length, so a toddler's
// feet dangling off an adult-height seat is the honest geometry, not a bug. On the GROUND an adult
// sits cross-legged, hands on knees; a toddler sits the way toddlers do -- legs straight out in a V.
export function figureGroup(hMm, { toddler = false, pose = "stand", seatH = 420 } = {}) {
  const g = new THREE.Group();
  const H = hMm;
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a948b, metalness: 0, roughness: 0.62 });

  // A limb: a capsule whose sphere ENDS sit exactly on the two joints. Millimetres in.
  const bone = (ax, ay, az, bx, by, bz, r) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r * MM, d.length() * MM, 4, 14), mat);
    m.position.copy(a.add(b).multiplyScalar(0.5 * MM));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(m);
    return m;
  };

  // The canon, as fractions of STANDING height.
  const P = toddler
    ? { headR: .110, hip: .46, sho: .74, shoW: .115, hipW: .065, armR: .042, legR: .055,
        torsoR: .120, flat: .62, wristY: .42, thigh: .21, shin: .19, foot: .13 }
    : { headR: .066, hip: .52, sho: .81, shoW: .105, hipW: .056, armR: .027, legR: .038,
        torsoR: .100, flat: .55, wristY: .44, thigh: .245, shin: .245, foot: .135 };

  const hipY = pose === "sit" ? seatH : pose === "ground" ? GROUND_HIP * H : P.hip * H;
  const shoY = hipY + (P.sho - P.hip) * H;
  const hipX = P.hipW * H, shoX = P.shoW * H;

  // Torso: one vertical capsule, flattened front-to-back, with a shoulder girdle across it --
  // so the figure is wider at the shoulders than it is deep, which is most of "reads as human".
  // The torso capsule's round end hangs torsoR below its start -- kept off the floor when the
  // hips are almost on it (ground pose); a no-op standing or on a chair.
  const body = bone(0, Math.max(hipY - .02 * H, P.torsoR * H * .9), 0, 0, shoY - .02 * H, 0, P.torsoR * H);
  body.scale.z = P.flat;
  bone(-shoX, shoY, 0, shoX, shoY, 0, P.armR * H * 1.25);

  // Head + neck. The crown lands at EXACTLY the stated height when standing: the head/neck
  // block always spans (1 - sho) of H above the shoulders, seated or not. The slight vertical
  // stretch shortens the visible neck -- to almost nothing on the toddler, as in life.
  const headR = P.headR * H;
  const headTopY = shoY + (1 - P.sho) * H;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR * MM, 20, 16), mat);
  head.scale.y = 1.08;
  head.position.set(0, (headTopY - headR * 1.08) * MM, 0);
  g.add(head);
  cyl(g, .030 * H, .036 * H, .06 * H, 12, mat, 0, shoY + .02 * H, 0);

  if (pose === "ground" && !toddler) {
    // Cross-legged: thighs splay forward and out to knees resting low and wide, shins fold back
    // inward and cross in front of the body, the feet tucked under the opposite knee.
    const kneeX = .19 * H, kneeY = .05 * H, kneeZ = .15 * H;
    for (const s of [-1, 1]) {
      bone(s * hipX, hipY, .01 * H, s * kneeX, kneeY, kneeZ, P.legR * H);
      bone(s * kneeX, kneeY, kneeZ, -s * .05 * H, .035 * H, kneeZ + (s > 0 ? .03 : .05) * H, P.legR * H * .9);
      bone(-s * .05 * H, .03 * H, kneeZ + (s > 0 ? .03 : .05) * H,
           -s * .12 * H, .03 * H, kneeZ + (s > 0 ? .01 : .03) * H, .024 * H);
      // arms: shoulder -> elbow, then the forearm down to a hand resting on the knee
      const elbow = [s * (shoX + .02 * H), shoY - .17 * H, .06 * H];
      bone(s * shoX, shoY, 0, ...elbow, P.armR * H);
      bone(...elbow, s * kneeX * .92, kneeY + P.legR * H * 1.6, kneeZ * .9, P.armR * H * .9);
    }
  } else if (pose === "ground") {
    // Toddler: legs straight out in front, a little apart and slightly bent; hands on the ground
    // beside the hips, the way a small child props itself up.
    const reach = (P.thigh + P.shin) * H;
    for (const s of [-1, 1]) {
      const kx = s * hipX * 1.6, kz = P.thigh * H * .95;
      bone(s * hipX, hipY, .01 * H, kx, hipY + .015 * H, kz, P.legR * H);
      bone(kx, hipY + .015 * H, kz, s * hipX * 2.2, .03 * H, reach * .98, P.legR * H * .9);
      bone(s * hipX * 2.2, .03 * H, reach * .98, s * hipX * 2.2, .08 * H, reach * .98 + .03 * H, .024 * H);
      bone(s * shoX, shoY, 0, s * (shoX + .05 * H), .04 * H, -.01 * H, P.armR * H);
    }
  } else if (pose !== "sit") {
    for (const s of [-1, 1]) {
      bone(s * hipX, hipY, 0, s * hipX * 1.12, .05 * H, 0, P.legR * H);
      bone(s * hipX * 1.12, .026 * H, -.02 * H,
           s * hipX * 1.12, .026 * H, P.foot * H - .02 * H, .026 * H);
      bone(s * (shoX + .012 * H), shoY - .01 * H, 0,
           s * (shoX + .030 * H), P.wristY * H, .012 * H, P.armR * H);
    }
  } else {
    const kneeZ = P.thigh * H;
    const ankleY = Math.max(hipY - P.shin * H, .026 * H);       // the ground, or a dangle
    const footY = Math.max(ankleY - .02 * H, .026 * H);
    for (const s of [-1, 1]) {
      bone(s * hipX, hipY, 0, s * hipX * 1.06, hipY, kneeZ, P.legR * H);
      bone(s * hipX * 1.06, hipY, kneeZ,
           s * hipX * 1.06, ankleY, kneeZ + .01 * H, P.legR * H * .9);
      bone(s * hipX * 1.06, footY, kneeZ + .01 * H,
           s * hipX * 1.06, footY, kneeZ + .01 * H + P.foot * H * .8, .026 * H);
      bone(s * shoX, shoY, 0,
           s * (shoX + .01 * H), shoY - .17 * H, .04 * H, P.armR * H);
      bone(s * (shoX + .01 * H), shoY - .17 * H, .04 * H,
           s * hipX * 1.2, hipY + .02 * H, kneeZ * .72, P.armR * H * .9);
    }
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

/** A tarp as SOLVED cloth (web/tarp.js solvePitch): the relaxed mesh itself, its curved edge bound in
 *  red, a pole under every pole-held corner, and the ropes -- two 二又 guys off each main pole along
 *  the ridge, one guy per wing corner out along the line from the centre (the manual's 延長線上).
 *  Millimetres in; the ground at y = 0. Drawn at opacity 0.5 for the same reason as tarpPitchGroup. */
export function clothTarpGroup(sol, { color = 0x8a7460, letters = false } = {}) {
  const g = new THREE.Group();
  const pos = new Float32Array(sol.pts.length * 3);
  sol.pts.forEach((p, i) => { pos[3 * i] = p.x * MM; pos[3 * i + 1] = p.y * MM; pos[3 * i + 2] = p.z * MM; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(sol.tris.flat());
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(color),
    metalness: 0, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })));
  // the red edge binding, one curve PER EDGE: a single closed spline through the whole rim rounds
  // every corner off, and a tarp's corners are sharp points (the grommet tabs)
  const trim = metal(0xa8382e, 0.15, 0.6);
  const V = i => new THREE.Vector3(sol.pts[i].x * MM, sol.pts[i].y * MM, sol.pts[i].z * MM);
  const nO = sol.outline.length, E = sol.edgeN || nO;
  for (let e = 0; e * E < nO; e++) {
    const run = [];
    for (let k = 0; k <= E; k++) run.push(V(sol.outline[(e * E + k) % nO]));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(run, false, "centripetal"), E * 4, 9 * MM, 5, false), trim));
  }
  const alu = metal(0xc9ccd1, 0.8, 0.35), steel = metal(0x3a3d42, 0.4, 0.6);
  const guys = [];
  const stake = (x, z) => cyl(g, 4, 5, 22, 8, steel, x, 11, z);
  const T = sol.anchors.find(a => a.name === "T").at, B = sol.anchors.find(a => a.name === "B").at;
  const cx = (T.x + B.x) / 2, cz = (T.z + B.z) / 2;
  for (const a of sol.anchors) {
    const p = a.at;
    const ox = p.x - cx, oz = p.z - cz, ol = Math.hypot(ox, oz) || 1, ux = ox / ol, uz = oz / ol;
    if (a.pole) {
      // foot to top: a leaning pole is drawn leaning (tarp.js puts the foot inboard of the top)
      const f = a.foot || { x: p.x, y: 0, z: p.z };
      const top = new THREE.Vector3(p.x * MM, p.y * MM, p.z * MM), foot = new THREE.Vector3(f.x * MM, 0, f.z * MM);
      const len = top.distanceTo(foot), r = (a.role === "tip" ? 14 : 11) * MM;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), alu);
      m.position.copy(top).add(foot).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
      g.add(m);
    }
    // the ropes, to the pegs tarp.js solved (taut, straight, of the manual's lengths)
    for (const pg of a.pegs || []) {
      guys.push(new THREE.Vector3(p.x * MM, p.y * MM, p.z * MM), new THREE.Vector3(pg.x * MM, 0, pg.z * MM));
      stake(pg.x, pg.z);
    }
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(guys),
    new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.85 })));
  // Selected, every pole point wears its letter -- the same A, B, C... the pitch menu uses -- on a
  // round chip just above it: a pole on it shows blue, a free corner grey.
  if (letters) for (const a of sol.anchors) {
    if (!a.letter) continue;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 96;
    const cx = cv.getContext("2d");
    cx.fillStyle = a.pole ? "rgba(37,99,235,0.92)" : "rgba(18,20,24,0.78)";
    cx.beginPath(); cx.arc(48, 48, 44, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = "#fff"; cx.font = "700 58px system-ui, sans-serif";
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText(a.letter, 48, 52);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    sprite.scale.set(0.26, 0.26, 1);
    sprite.position.set(a.at.x * MM, a.at.y * MM + 0.22, a.at.z * MM);
    sprite.renderOrder = 11;
    g.add(sprite);
  }
  return { group: g };
}

// ---- Parts the planner never places alone: drawn on the part bench -------------------------------
// (2026-11: each of these had been a generic stand-in -- an open metal bin for a soft bag, a round
// ring for a rectangular wire frame, a ridged slab for a pan.)

/** GR-006 Grill Plate: a black steel pan -- smooth floor, a flared wall about 30 high, rounded
 *  corners, a handle tab with a hanging hole at each short end (the product's one photograph).
 *  The tabs sit inside the published 500, so the pan itself is about 430 x 330; that split is read
 *  off one oblique photo and is the least certain number here. `top` = the rim's height. */
function grillPanInto(g, top, x = 0, z = 0) {
  const steel = metal(0x2a2c2f, 0.35, 0.6);
  const pan = panInto(g, steel, { w: 430, d: 330, fw: 392, fd: 292, h: 30, r: 28, top, x, z });
  bentTube(g, [[x + 213, top, z - 163], [x + 213, top, z + 163], [x - 213, top, z + 163], [x - 213, top, z - 163]],
    2, steel, { rad: 26, closed: true });                       // the rolled rim
  for (const sx of [-1, 1]) {
    box(g, 37, 3, 96, 1, steel, x + sx * 232, top - 1.5, z);
    cyl(g, 4, 4, 3.6, 10, metal(0x0e0f12, 0.2, 0.8), x + sx * 238, top - 1.5, z);
  }
  return pan;
}
export function grillPanGroup() {
  const g = new THREE.Group();
  return { group: g, body: grillPanInto(g, 0) };
}

/** DB-005 Garbage Frame: one bent wire. A rectangular hoop that holds a bag open, standing out
 *  from a table's edge; both of its long runs step up over their middle third (the published 44),
 *  and three black-capped prongs reach back from the run at the table: the two outer ones under
 *  the top (their tips turned up), the short middle one over it -- that grip is all that holds it
 *  (hero, and the photo of it on a bamboo board). The published 255 is hoop + prongs, measured
 *  out from the edge; the 320 runs along the edge. Here x is out from the table, z along it. */
export function garbageFrameGroup(w = 255, d = 320, h = 44, color = 0xc9cdd2) {
  const g = new THREE.Group();
  const steel = metal(color, 0.5, 0.35), cap = metal(0x18191b, 0.05, 0.7);
  const r = 2.5, prong = 105;
  const x0 = -w / 2 + prong, x1 = w / 2 - r;             // the run at the table edge / the far run
  const hz = d / 2 - r, sz = d / 6;
  const yL = -h + r, yH = -r;
  bentTube(g, [
    [x0, yL, -hz], [x0, yL, -sz - 10], [x0, yH, -sz + 10], [x0, yH, sz - 10], [x0, yL, sz + 10], [x0, yL, hz],
    [x1, yL, hz], [x1, yL, sz + 10], [x1, yH, sz - 10], [x1, yH, -sz + 10], [x1, yL, -sz - 10], [x1, yL, -hz],
  ], r, steel, { rad: 8, closed: true });
  const tip = (x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(5 * MM, 10, 8), cap);
    m.position.set(x * MM, y * MM, z * MM); g.add(m); };
  for (const s of [-1, 1]) {
    bentTube(g, [[x0, yL, s * hz], [-w / 2 + 30, yL, s * hz], [-w / 2 + 5, yL + 25, s * hz]], r, steel, { rad: 12 });
    tip(-w / 2 + 5, yL + 25, s * hz);
  }
  bentTube(g, [[x0, yH, 0], [x0 - 36, yH, 0]], r, steel);
  tip(x0 - 36, yH, 0);
  const ghost = box(g, w, h, d, 2,
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.04, depthWrite: false }), 0, -h / 2, 0);
  return { group: g, body: ghost };
}

/** BG-031 / BG-032 Waterproof Gear Box: a closed soft box in matte black fabric -- a zip-round
 *  lid, a webbing strap with a buckle down each quarter of the two long faces, the straps
 *  carrying on up into two handles that meet in a grip over the middle, and a grab loop on each
 *  end (hero). The published size is the INNER cavity; it is drawn at that size. Top at y = 0. */
export function softBoxGroup(w, d, h) {
  const g = new THREE.Group();
  const cloth = metal(0x1d1e21, 0, 0.92), web = metal(0x111214, 0, 0.85), trim = metal(0x45484d, 0.15, 0.65);
  const body = new THREE.Mesh(roundedBox(w * MM, h * MM, d * MM, 16 * MM), cloth);
  body.position.y = -h / 2 * MM;
  g.add(body);
  for (const s of [-1, 1]) {                             // the lid's zip, a seam ~45 down
    box(g, w - 34, 3, 2, 0, trim, 0, -45, s * (d / 2 + 0.4));
    box(g, 2, 3, d - 34, 0, trim, s * (w / 2 + 0.4), -45, 0);
  }
  const xs = w * 0.24;
  for (const sz of [-1, 1]) {
    const zf = sz * (d / 2 + 1.2);
    for (const sx of [-1, 1]) {
      box(g, 26, h * 0.72, 2.4, 0, web, sx * xs, -4 - h * 0.36, zf);
      box(g, 30, 22, 9, 1, trim, sx * xs, -h * 0.44, sz * (d / 2 + 4));
    }
    bentTube(g, [[-xs, -4, zf], [-xs, 44, sz * (d / 2 - 34)], [-xs * 0.45, 80, sz * 13],
                 [xs * 0.45, 80, sz * 13], [xs, 44, sz * (d / 2 - 34)], [xs, -4, zf]], 6, web, { rad: 30 });
  }
  box(g, xs * 0.9, 17, 46, 0, web, 0, 80, 0);            // the grip wrapped round both handles
  for (const sx of [-1, 1])
    bentTube(g, [[sx * (w / 2 + 1), -72, -46], [sx * (w / 2 + 17), -62, -30], [sx * (w / 2 + 17), -62, 30],
                 [sx * (w / 2 + 1), -72, 46]], 5, web, { rad: 12 });
  return { group: g, body };
}

/** GF-010 Garden Unit Table Wood Insert: eight half-round slats lying along the 360, on two
 *  cross battens (hero, a001). Slats 27 wide on a 31 pitch across the 250. Top at y = 0. */
export function slatInsertGroup(w = 250, d = 360, h = 24, color = 0xb08a5a) {
  const g = new THREE.Group();
  const wood = metal(color, 0.02, 0.7);
  const n = 8, pitch = w / n, sw = pitch - 4, batten = 10, slat = h - batten;
  let body = null;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * pitch;
    const base = box(g, sw, slat - 5, d, 0, wood, x, -5 - (slat - 5) / 2, 0);
    body = body || base;
    // the half-round crown: a half cylinder turned to lie along z with its flat side down,
    // then pressed to 5mm high
    const cg = new THREE.CylinderGeometry(sw / 2 * MM, sw / 2 * MM, d * MM, 12, 1, false, 0, Math.PI);
    cg.rotateY(Math.PI / 2); cg.rotateX(Math.PI / 2);
    const crown = new THREE.Mesh(cg, wood);
    crown.scale.y = 5 / (sw / 2);
    crown.position.set(x * MM, -5 * MM, 0);
    g.add(crown);
  }
  for (const s of [-1, 1]) box(g, w - 6, batten, 22, 0, wood, 0, -h + batten / 2, s * d * 0.33);
  return { group: g, body };
}

/** GF-015 Garden Unit Table Set: a slatted wooden top with an IGT opening down its middle, on
 *  four square stainless legs. The manual gives the top as 900 x 1420 x 65 and the legs as
 *  41 x 41 x 675; the opening (about 1000 x 360, four units) is read off its drawing. Top at y = 0. */
export function gardenUnitTableGroup(w = 900, d = 1420, h = 700) {
  const g = new THREE.Group();
  const wood = metal(0xb08a5a, 0.02, 0.7), groove = metal(0x6f5234, 0, 0.8), steel = metal(0xd2d5d8, 0.35, 0.45);
  const T = 65, ow = 360, od = 1000;                     // top thickness; the opening
  const sideW = (w - ow) / 2, endD = (d - od) / 2;
  let body = null;
  for (const s of [-1, 1]) {
    const m = box(g, sideW, T, d, 0, wood, s * (ow / 2 + sideW / 2), -T / 2, 0);   // the two long sides
    body = body || m;
    box(g, ow, T, endD, 0, wood, 0, -T / 2, s * (od / 2 + endD / 2));                 // the two ends
    for (let k = 1; k < 9; k++)                           // slat seams along the long sides
      box(g, 2, 1, d, 0, groove, s * (ow / 2 + (k * sideW) / 9), 0.2, 0);
    for (let k = 1; k < 12; k++)                          // ...and across the ends
      box(g, 2, 1, endD, 0, groove, -ow / 2 + (k * ow) / 12, 0.2, s * (od / 2 + endD / 2));
    box(g, 3, T - 8, od, 0, steel, s * (ow / 2 - 1.5), -T / 2, 0);                  // the opening's steel lining
    box(g, ow, T - 8, 3, 0, steel, 0, -T / 2, s * (od / 2 - 1.5));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(g, 41, h - T, 41, 0, steel, sx * (w / 2 - 50), -T - (h - T) / 2, sz * (d / 2 - 50));
  return { group: g, body };
}

/** GF-051 / GF-052 Takibi Garden Table: a square ring of four stainless panels round a square
 *  fire opening, its outer corners clipped, an apron folded down the outer edges, on four wide
 *  folded-sheet legs that splay out from under the opening's corners (heroes, alt_04 / alt_05).
 *  The opening is about 540 on the 1200 table, scaled off the Takibi L standing in it -- low
 *  precision, and the 1500 table is drawn in the same proportion. Top at y = 0, feet at -h. */
export function gardenRingTableGroup(w = 1200, d = 1200, h = 400) {
  const g = new THREE.Group();
  const steel = metal(0xd2d5d8, 0.3, 0.5), seam = metal(0x7d8186, 0.3, 0.6);
  steel.side = THREE.DoubleSide;
  const R = w / 2, o = w * 0.225, c = w * 0.15;
  const s = new THREE.Shape();
  s.moveTo(R - c, -R); s.lineTo(R, -R + c); s.lineTo(R, R - c); s.lineTo(R - c, R);
  s.lineTo(-R + c, R); s.lineTo(-R, R - c); s.lineTo(-R, -R + c); s.lineTo(-R + c, -R); s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-o, -o); hole.lineTo(-o, o); hole.lineTo(o, o); hole.lineTo(o, -o); hole.closePath();
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -3, 0); geo.scale(MM, MM, MM);
  const top = new THREE.Mesh(geo, steel);
  g.add(top);
  for (const sg of [-1, 1]) {
    box(g, 2 * (R - c), 90, 3, 0, steel, 0, -45, sg * (R - 1.5));          // the outer apron
    box(g, 3, 90, 2 * (R - c), 0, steel, sg * (R - 1.5), -45, 0);
    box(g, 2 * o, 60, 3, 0, steel, 0, -30, sg * (o + 1.5));                 // the fold round the opening
    box(g, 3, 60, 2 * o, 0, steel, sg * (o + 1.5), -30, 0);
  }
  const L = Math.hypot(h - 3, 170), tilt = -Math.atan2(170, h - 3);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    const mid = (o * Math.SQRT2 + (R - c / 2) * Math.SQRT2) / 2;
    box(g, (R - c / 2 - o) * Math.SQRT2, 0.8, 3, 0, seam, mid * ca, 0.3, mid * sa, -a);   // the panel seams
    const rm = o * Math.SQRT2 + 70 + 85;                 // leg: top 70 outside the opening's corner, foot 170 further
    const leg = new THREE.Mesh(new THREE.BoxGeometry(240 * MM, L * MM, 4 * MM), steel);
    leg.rotation.order = "YXZ";
    leg.rotation.y = Math.PI / 2 - a;
    leg.rotation.x = tilt;
    leg.position.set(rm * ca * MM, -(h + 3) / 2 * MM, rm * sa * MM);
    g.add(leg);
  }
  return { group: g, body: top };
}

/** ST-032BP Fireplace Base Plate L: a shallow black tray with a rolled rim and four slots, one
 *  toward each corner, each parallel to an edge (hero). Top (the rim) at y = 0. */
export function basePlateGroup(w = 450, d = 450, h = 9) {
  const g = new THREE.Group();
  const iron = metal(0x1c1e21, 0.3, 0.6);
  iron.side = THREE.DoubleSide;
  const hw = w / 2 - 3, hd = d / 2 - 3, r = 30;
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hd); s.lineTo(hw - r, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r); s.quadraticCurveTo(hw, hd, hw - r, hd); s.lineTo(-hw + r, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - r); s.lineTo(-hw, -hd + r); s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const a = w * 0.25;
  for (const [cx, cz, alongX] of [[a, a, true], [-a, -a, true], [a, -a, false], [-a, a, false]]) {
    const lx = alongX ? 50 : 10, lz = alongX ? 10 : 50, slot = new THREE.Path();
    slot.moveTo(cx - lx, cz - lz); slot.lineTo(cx - lx, cz + lz); slot.lineTo(cx + lx, cz + lz);
    slot.lineTo(cx + lx, cz - lz); slot.closePath();
    s.holes.push(slot);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 2, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -h, 0); geo.scale(MM, MM, MM);
  const floor = new THREE.Mesh(geo, iron);
  g.add(floor);
  bentTube(g, [[hw, -3, -hd], [hw, -3, hd], [-hw, -3, hd], [-hw, -3, -hd]], 3, iron, { rad: r, closed: true });
  return { group: g, body: floor };
}

/** ST-032S Fireplace Coal Bed L, alone: the slotted cast grate the Takibi carries (coalBedInto). */
export function coalBedGroup(w = 310) {
  const g = new THREE.Group();
  coalBedInto(g, w, 0);
  return { group: g, body: g.children[0] };
}
