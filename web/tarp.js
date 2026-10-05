// A tarp is CLOTH: it does not stretch. So where its corners land is not an input -- it is what the
// poles and the ropes leave the fabric able to do. Raise the poles and the shelter gets narrower and
// steeper; ask for heights the cloth cannot span and the pitch cannot be made. This file is that
// arithmetic, DOM-free (the smoke test reads it too); app.js draws the answer.
//
// THE MODEL: a small cloth relaxation. The flat pattern (its real curved cut) becomes a mesh whose
// every edge keeps its flat length. Then, as in the field:
//   - a POLE fixes its corner's height; the corner is free to move across the ground, pulled outward
//     by its main rope (二又, along the ridge);
//   - a GUYED corner has no height of its own: its rope pulls it out and down along the line from
//     the tarp's centre through the corner (the manual's 延長線上), and the cloth decides where it
//     floats;
//   - a SUB-POLE corner is a pole: height fixed, pulled outward by its guy;
//   - gravity sags the cloth; the ridge's low point is an OUTPUT.
// A pitch that asks one part of the cloth to reach further than it is cut is IMPOSSIBLE, and shows up
// as the mesh having to stretch -- that is the test, not a guess.
//
// WHY RELAXATION and not tarp-shade's closed form: that solver prescribes every corner's height, and a
// guyed corner has none -- it is exactly the unknown. Rope tensions here are CALIBRATED, not measured:
// against Snow Peak's published guyed footprints and the Octa manual's side elevation (see octa()).
// (An earlier note here claimed a manual figure of a 185-200 cm ridge for the Hexa L; no such figure is
// in the manual, and nothing holds it.)
//
// WHAT IS MEASURED AND WHAT IS NOT. Snow Peak publishes a tarp's overall size and nothing else. The
// HD Hexa manual (TP-861H/862H p.8) draws the outline with three dimensions -- tip to tip and the span
// at each pair of wing corners (the two ends are NOT the same width) -- but the drawing is not to
// scale, so the corners' positions along the ridge and the curved cut's depth were read off it per
// axis: approximate. Every pattern says which kind it is in `source`.

const MANUAL = "manual";     // from the manual's drawing (schematic; positions read per axis)
const ESTIMATE = "estimate"; // a sibling's manual shape scaled to this tarp's published size
const PUBLISHED = "published"; // the published size is the whole outline (a rectangle)

/** A hexa: tips on the ridge (z axis), a narrow pair of wing corners toward tip T and a wide pair
 *  toward tip B. `sag*` = the curved cut's depth as a fraction of each chord (manual drawing). */
function hexa({ len, narrow, wide, zN, zW, sagTip = 0.078, sagSide = 0.058, source }) {
  const ring = [
    { name: "T", x: 0, z: len / 2, role: "tip" },
    { name: "NR", x: narrow / 2, z: zN, role: "corner", side: "right", rope: 3000 },
    { name: "WR", x: wide / 2, z: zW, role: "corner", side: "right", rope: 2000 },
    { name: "B", x: 0, z: -len / 2, role: "tip" },
    { name: "WL", x: -wide / 2, z: zW, role: "corner", side: "left", rope: 2000 },
    { name: "NL", x: -narrow / 2, z: zN, role: "corner", side: "left", rope: 3000 },
  ];
  return { family: "hexa", ring, sag: [sagTip, sagSide, sagTip, sagTip, sagSide, sagTip], source,
    size: { w: wide, d: len } };
}
/** A recta: the ridge runs the long way, its tips at the middle of the two short edges. */
function recta({ len, width, sag = 0.015, source }) {
  const L = len / 2, W = width / 2;
  const ring = [
    { name: "T", x: 0, z: L, role: "tip" },
    { name: "CR1", x: W, z: L, role: "corner", side: "right", rope: 2000 },
    { name: "CR2", x: W, z: -L, role: "corner", side: "right", rope: 2000 },
    { name: "B", x: 0, z: -L, role: "tip" },
    { name: "CL2", x: -W, z: -L, role: "corner", side: "left", rope: 2000 },
    { name: "CL1", x: -W, z: L, role: "corner", side: "left", rope: 2000 },
  ];
  return { family: "recta", ring, sag: [0, sag, 0, 0, sag, 0], source, size: { w: width, d: len } };
}
/** An octa (TAKIBI Tarp Octa, TP-430): poles at the middle of the two ends, and per side three
 *  stretches of wing -- an end corner (E, 3 m rope), a side corner (S, 2 m rope), and between the two
 *  side corners the WING CENTRE (M): no rope in the basic pitch, or raised on a 140 cm Wing Pole with
 *  a 7 m 二又 (the manual's 両翼の中央を跳ね上げる).
 *
 *  The outline is the manual's own vector plan (p.4 上から見た図, the PDF's path 477 -- exact control
 *  points, not pixels; scripts/derive_octa_pattern.py). That plan is the PITCHED tarp seen from above,
 *  so along the ridge it is to scale (its pegs put the length at 4.97 m against the published 5.10) but
 *  across it is foreshortened by the falling wings (0.877 = cos 29 deg). So: along the ridge as drawn,
 *  across stretched back to the published 450 cm.
 *
 *  PITCHED BY THE MANUAL'S 45-DEGREE RULE (`rope45`; p.4: peg out as far as you can, the rope meeting the
 *  ground at ~45 deg). The main 二又 legs meet the ground as far out as the pole top is high, and the
 *  end corners' 3 m ropes go to those same pegs (shared, manual). The side corners take up their 2 m
 *  ropes to 45 deg. Checked against the manual's side elevation (p.11, vector, to scale: its pole
 *  spacing measures 4.93 m against our 4.95 m ridge):
 *    main pegs along   8.89 m   vs 8.80 published (9.07 on the elevation)
 *    end-corner rope   2.59 m at 34 deg  vs ~2.55 m at ~30 deg on the elevation
 *    corner heights    end 1.47 / side 0.98 / wing centre 1.03 m  vs 1.27 / 0.87 / 1.01 on the elevation
 *  With every rope at full length instead (the hexa model) the corners rode ~30 cm high and the main
 *  pegs landed 9.6 m apart: a corner's height is set by the DIRECTION it is pulled, not how hard.
 *
 *  ACROSS, the published 750 cannot be reached by this cloth at all: a 2 m rope off a corner at most
 *  2.25 m of cloth from the ridge pegs out at most 3.28 m from it -- 6.56 m in all; 7.5 would need a
 *  5.26 m-wide cloth. The 750 and the plan view's across proportions come from one schematic and agree
 *  with each other, not with the 450. So across, only the 450 is trusted. */
function octa({ source }) {
  const R = (name, x, z, role, rope, side, peg) => ({ name, x, z, role, rope, side, ...(peg && { peg }) });
  const ring = [
    R("T", 0, 2477, "tip"),
    R("ER1", 1636, 2550, "corner", 3000, "right", "main"), R("SR1", 2250, 1072, "corner", 2000, "right"),
    R("MR", 2183, 0, "mid", 3500, "right"),
    R("SR2", 2250, -1072, "corner", 2000, "right"), R("ER2", 1636, -2550, "corner", 3000, "right", "main"),
    R("B", 0, -2477, "tip"),
    R("EL2", -1636, -2550, "corner", 3000, "left", "main"), R("SL2", -2250, -1072, "corner", 2000, "left"),
    R("ML", -2183, 0, "mid", 3500, "left"),
    R("SL1", -2250, 1072, "corner", 2000, "left"), R("EL1", -1636, 2550, "corner", 3000, "left", "main"),
  ];
  // the cut, per edge (ring[i] -> ring[i+1]): the ends are straight (the pole corner sits 73 mm in --
  // that shallow V IS the end's cut); end corner -> side corner is the deep curve (6% of its chord);
  // the wing's middle stretch barely curves (1%)
  const sag = [0, 0.06, 0.01, 0.01, 0.06, 0, 0, 0.06, 0.01, 0.01, 0.06, 0];
  return { family: "octa", ring, sag, source, size: { w: 4500, d: 5100 }, rope45: true };
}
const HEXA_L = s => hexa({ len: 5700, narrow: 4000, wide: 5000, zN: 1310, zW: -1240, source: s });
const HEXA_M = s => hexa({ len: 4750, narrow: 3700, wide: 4200, zN: 1090, zW: -1030, source: s });
export const PATTERNS = {
  "TP-862": HEXA_L(MANUAL),
  "TP-861": HEXA_M(MANUAL),
  "TP-851": HEXA_L(ESTIMATE),          // Amenity Tarp Hexa L: the same published 570 x 500
  "TP-440": HEXA_M(ESTIMATE),          // TAKIBI Tarp Hexa M: the same published 475 x 420
  // a recta's outline IS its published size -- a rectangle has nothing else to know
  "TP-842": recta({ len: 5490, width: 4270, source: PUBLISHED }),
  "TP-841": recta({ len: 4150, width: 3400, source: PUBLISHED }),
  "TP-430": octa({ source: MANUAL }),
};

// Snow Peak's recommended pitch per family (manuals): poles at the two tips; a hexa's wings guyed,
// a recta's corners on sub-poles. `left` / `right` = a sub-pole height for that side's corners, or
// null = guyed.
// Every family pitched the way its manual says: wings first, then the mains (owner, 2026-10-05) -- how
// hard the mains go is the one figure fitted per family (see RIDGES): the Hexa's every-rope-alike puts its
// guyed footprint on Snow Peak's published one, the Octa's firm puts its ridge where its manual draws it.
export const DEFAULTS = {
  hexa: { a: 2800, b: 2400, left: null, right: null, lean: 5, order: "wings", mainPull: 1 },
  recta: { a: 2800, b: 2800, left: 1700, right: 1700, lean: 5, order: "wings", mainPull: 1 },
  // the Octa's manual: two 280s (and 280 is REQUIRED with a fire under it), every corner guyed, the
  // wing centres down
  octa: { a: 2800, b: 2800, left: null, right: null, lean: 5, order: "wings", mainPull: 4 },
};
// How the ropes were tightened, as the pitch menu offers it. "taut": mains first, the ridge locked straight
// (a 2% dip). The others: wings first, as the manuals have it, then the mains taken up `mainPull` times as
// hard as one wing rope -- the ridge's curve and the pole tips' "horns" are what that leaves.
//   soft (1x, every rope alike -- the manual's 均等): the HD Hexa L on 280 + 240 pegs out 11.7 x 7.6 m
//     against Snow Peak's published 12.2 x 7.8 (taut: 7.2 across, 8% short)
//   firm (4x): the Octa as its manual's side elevation draws it -- ridge dip 0.22 m, poles 4.95 m apart,
//     side corners 0.94 m, wing centres 0.97 m (drawn: 0.20 / 4.93 / 0.87 / 1.01)
// Past ~15x the solver's own give (it holds the cloth inextensible only to within a few %) starts to show.
// "taut" is stored as order "mains" -- spelled out, because the default is now the manual's order and an
// absent key would read back as that.
export const RIDGES = [
  { key: "taut", order: "mains" },
  { key: "soft", order: "wings", mainPull: 1 },
  { key: "medium", order: "wings", mainPull: 2 },
  { key: "firm", order: "wings", mainPull: 4 },
];
export const ridgeOf = P => P.order !== "wings" ? "taut" : RIDGES.find(r => r.order === "wings" && r.mainPull === P.mainPull)?.key || "custom";

// The wing-centre pole (an octa's `mid` vertex): the manual's 140 cm Wing Pole, or none.
export const MID_POLES = [1400];
export const MAIN_POLES = [2800, 2400, 2100, 1700, 1400];   // Wing Poles, 60/70 cm sections
export const SUB_POLES = [1900, 1700, 1250];                // uprights: TP-080, TP-022, TP-161
// Pole lean, degrees off vertical, tops pulled OUT by their ropes (the manual: the main rope's
// tension tips the pole top slightly outward). A leaning pole stands lower -- length x cos -- and its
// foot sits inboard of its top by length x sin: which is where the poles end up among the furniture.
export const LEANS = [0, 5, 10, 15];
// The ridge's dip as a fraction of its span (see solvePitch). 2% is ~11 cm on a Hexa L: barely there.
export const RIDGE_SAG = 0.02;
// One leg of a main pole's 二又 rope (the set's 10 m 二又, doubled). With it, the solved pegs put the
// HD Hexa L's guyed footprint within ~5-8% of Snow Peak's published 780 x 1220 cm (smoke holds 10%).
export const MAIN_ROPE_LEG = 5000;

// Calibrated (see the header): per unit of cloth weight, the pull of a main rope and of a guy.
const TUNE = { gravity: 1, guy: 500, steps: 600, iters: 16, N: 8, H: 280, shear: 0.35 };

export const pitchOf = (sku, p = {}) => {
  const pat = PATTERNS[sku];
  if (!pat) return null;
  const P = { ...DEFAULTS[pat.family], ...(p || {}) };
  // each wing corner on its own: corners[name] = a sub-pole height, or null = guyed. A corner not
  // named falls back to its side's value -- how older pitches (and the recta's default) say it.
  // A wing centre (`mid`) rides in the same map: a pole height, or null = no pole and no rope at all.
  // It never takes its side's default -- that is a guyed-or-sub-pole choice for corners.
  P.corners = Object.fromEntries(pat.ring.filter(v => v.role === "corner" || v.role === "mid")
    .map(v => [v.name, (p?.corners && v.name in p.corners) ? p.corners[v.name]
      : v.role === "mid" ? null : (P[v.side] ?? null)]));
  return P;
};

/** Each pole point's LETTER: A at the front tip, then on around the ring (right side, back tip, left
 *  side) -- what the pitch menu and the 3D labels call it, so "C" in one is "C" in the other. */
export const letterOf = (sku, name) => {
  const i = PATTERNS[sku]?.ring.findIndex(v => v.name === name);
  return i >= 0 ? String.fromCharCode(65 + i) : "";
};

/** The poles a pitch stands on, by length: the two mains (a, b) and one per sub-poled corner -- what
 *  the bill turns into SKUs. A guyed corner needs no pole. A tarp with no known cut has no pitch here. */
export function polesOf(sku, pitch) {
  const P = pitchOf(sku, pitch);
  if (!P) return [];
  // a wing-centre pole is a Wing Pole (the 140), so it bills as a main pole, not an upright
  const role = Object.fromEntries(PATTERNS[sku].ring.map(v => [v.name, v.role]));
  return [{ use: "main", mm: P.a }, { use: "main", mm: P.b },
    ...Object.entries(P.corners).filter(([, h]) => h != null)
      .map(([name, mm]) => ({ use: role[name] === "mid" ? "main" : "sub", mm }))];
}

/** The flat pattern as a WOVEN mesh: a square lattice whose threads run the way cloth's do -- warp
 *  along the ridge, weft across it -- clipped to the curved cut and triangulated, with the outline
 *  sampled N times per side as its edge. (It was a ring mesh fanning out from the centre once: every
 *  "thread" then ran into the centre, and with the ridge free the wings hung the whole tarp off that
 *  one point -- the ridge came out as a V. Real threads run parallel and carry a wing's pull along
 *  the diagonal to the whole ridge.) */
function flatMesh(pat, N = TUNE.N, H = TUNE.H) {
  const ring = pat.ring, n = ring.length;
  const cx = 0, cz = (ring.find(v => v.name === "T").z + ring.find(v => v.name === "B").z) / 2;
  const edge = [];      // the outline, flat, with the curved cut
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez);
    let nx = -ez / L, nz = ex / L;
    if (nx * (cx - (a.x + b.x) / 2) + nz * (cz - (a.z + b.z) / 2) < 0) { nx = -nx; nz = -nz; }
    for (let k = 0; k < N; k++) {
      const s = k / N, bow = 4 * pat.sag[i] * L * s * (1 - s);
      edge.push({ x: a.x + ex * s + nx * bow, z: a.z + ez * s + nz * bow, vert: k === 0 ? i : -1 });
    }
  }
  const A = edge.length;
  const inside = (x, z) => {        // even-odd test against the outline polyline
    let c = false;
    for (let i = 0, j = A - 1; i < A; j = i++) {
      const p = edge[i], q = edge[j];
      if ((p.z > z) !== (q.z > z) && x < (q.x - p.x) * (z - p.z) / (q.z - p.z) + p.x) c = !c;
    }
    return c;
  };
  const segDist = (x, z, p, q) => {
    const dx = q.x - p.x, dz = q.z - p.z;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - p.x - t * dx, z - p.z - t * dz);
  };
  const nearEdge = (x, z) => {
    let m = Infinity;
    for (let i = 0; i < A; i++) m = Math.min(m, segDist(x, z, edge[i], edge[(i + 1) % A]));
    return m;
  };
  // the lattice: a column on the ridge (x = 0), rows through the centre; points too near the edge are
  // left to the edge's own samples, or the triangles there come out as slivers
  const pts = edge.map(e => ({ x: e.x, z: e.z }));
  const lat = new Map();            // "i,j" -> node
  const xs = edge.map(e => e.x), zs = edge.map(e => e.z);
  for (let i = Math.floor(Math.min(...xs) / H); i <= Math.ceil(Math.max(...xs) / H); i++)
    for (let j = Math.floor((Math.min(...zs) - cz) / H); j <= Math.ceil((Math.max(...zs) - cz) / H); j++) {
      const x = i * H, z = cz + j * H;
      if (!inside(x, z) || nearEdge(x, z) < 0.45 * H) continue;
      lat.set(`${i},${j}`, pts.length);
      pts.push({ x, z });
    }
  // every triangle wound the same way (clockwise with x right and z up, as the outline runs), or their
  // normals point half up, half down and the cloth shades flat
  const tris = delaunay(pts).filter(([a, b, c]) =>
    inside((pts[a].x + pts[b].x + pts[c].x) / 3, (pts[a].z + pts[b].z + pts[c].z) / 3))
    .map(([a, b, c]) => (pts[b].x - pts[a].x) * (pts[c].z - pts[a].z) - (pts[c].x - pts[a].x) * (pts[b].z - pts[a].z) > 0
      ? [a, c, b] : [a, b, c]);
  const links = new Map();
  const link = (a, b, w = 1) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!links.has(k)) links.set(k, [a, b, w]); };
  // Warp and weft hold; the BIAS gives -- woven cloth shears on the diagonal, which is what lets a taut
  // tarp take its saddle. An edge within ~20 deg of a thread is a thread; the rest are bias.
  for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const dx = Math.abs(pts[q].x - pts[p].x), dz = Math.abs(pts[q].z - pts[p].z);
    link(p, q, Math.max(dx, dz) / Math.hypot(dx, dz) > 0.94 ? 1 : TUNE.shear);
  }
  for (let k = 0; k < A; k++) link(k, (k + 1) % A, 1);           // the edge binding does not stretch
  // a little bending stiffness: every other knot along each thread, and along the edge
  for (const [key, a] of lat) {
    const [i, j] = key.split(",").map(Number);
    for (const k2 of [`${i + 2},${j}`, `${i},${j + 2}`]) if (lat.has(k2)) link(a, lat.get(k2), 0.15);
  }
  for (let k = 0; k < A; k++) link(k, (k + 2) % A, 0.15);
  const C = [...links.values()].map(([a, b, w]) => [a, b, Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z), w]);
  const outer = [];
  for (let k = 0; k < A; k++) outer.push(k);
  const vertNode = {};
  edge.forEach((e, k) => { if (e.vert >= 0) vertNode[e.vert] = k; });
  // the ridge: tip T, down the lattice column on x = 0, to tip B
  const iT = vertNode[ring.findIndex(v => v.name === "T")], iB = vertNode[ring.findIndex(v => v.name === "B")];
  const col = [...lat].filter(([k]) => k.startsWith("0,")).map(([, a]) => a).sort((a, b) => pts[b].z - pts[a].z);
  const ridge = [iT, ...col, iB];
  // each node's share of the cloth: a third of every triangle it is a corner of
  const area = new Float64Array(pts.length);
  for (const [a, b, c] of tris) {
    const A3 = Math.abs((pts[b].x - pts[a].x) * (pts[c].z - pts[a].z) - (pts[c].x - pts[a].x) * (pts[b].z - pts[a].z)) / 6;
    area[a] += A3; area[b] += A3; area[c] += A3;
  }
  const meanA = area.reduce((t, v) => t + v, 0) / pts.length;
  const weight = Array.from(area, v => v / meanA);
  return { pts, tris, C, outer, vertNode, weight, ridge, centre: { x: cx, z: cz } };
}

/** Bowyer-Watson Delaunay triangulation of points {x, z} -> [[a, b, c], ...]. */
function delaunay(P) {
  const xs = P.map(p => p.x), zs = P.map(p => p.z);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, mz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const R = 20 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const V = [...P, { x: mx - R, z: mz - R }, { x: mx + R, z: mz - R }, { x: mx, z: mz + R }];
  const n = P.length;
  const circ = (a, b, c) => {
    const A = V[a], B = V[b], C = V[c];
    const d = 2 * (A.x * (B.z - C.z) + B.x * (C.z - A.z) + C.x * (A.z - B.z));
    const a2 = A.x * A.x + A.z * A.z, b2 = B.x * B.x + B.z * B.z, c2 = C.x * C.x + C.z * C.z;
    const ux = (a2 * (B.z - C.z) + b2 * (C.z - A.z) + c2 * (A.z - B.z)) / d;
    const uz = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
    return { ux, uz, r2: (A.x - ux) ** 2 + (A.z - uz) ** 2 };
  };
  let tris = [{ t: [n, n + 1, n + 2], c: circ(n, n + 1, n + 2) }];
  for (let i = 0; i < n; i++) {
    const p = V[i], bad = [], keep = [];
    for (const T of tris) ((p.x - T.c.ux) ** 2 + (p.z - T.c.uz) ** 2 < T.c.r2 * (1 - 1e-12) ? bad : keep).push(T);
    const count = new Map();
    const edgesOf = t => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
    for (const { t } of bad) for (const [a, b] of edgesOf(t)) {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(k, (count.get(k) || 0) + 1);
    }
    for (const { t } of bad) for (const [a, b] of edgesOf(t)) {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (count.get(k) === 1) keep.push({ t: [a, b, i], c: circ(a, b, i) });
    }
    tris = keep;
  }
  return tris.map(T => T.t).filter(t => t.every(v => v < n));
}

const meshCache = new Map();
const meshOf = sku => {
  if (!meshCache.has(sku)) meshCache.set(sku, flatMesh(PATTERNS[sku]));
  return meshCache.get(sku);
};

// How far out a guyed corner's rope meets the ground: the full rope, taut -- or, under the 45-degree rule,
// as far out as the corner is high (the rope taken up to fit), never further than the rope reaches.
const reachOf = (pat, a, h) => {
  const full = Math.sqrt(Math.max(0, (a.rope || 2000) ** 2 - h * h));
  return pat.rope45 && a.peg !== "main" ? Math.min(h, full) : full;
};
// A peg's name in `pitch.pegs`: a corner's own peg is its name; a main pole's or a raised wing centre's
// two 二又 legs are `T-` / `T+` (by which side of the ridge, x < 0 or > 0) -- except a main leg whose peg
// a corner shares (the Octa's ends), which answers to that corner, so the one peg has one name.
export function pegKey(a, side, s = Math.sign(a.z) || 1) {
  if (a.role === "tip" && a.share) {
    const c = a.share.find(q => Math.sign(q.x) === side);
    if (c) return c.name;
  }
  return `${a.name}${side < 0 ? "-" : "+"}`;
}
const solveCache = new Map();
/** Pitch a tarp. -> { ok, why?, pts (mesh nodes, mm, y up), tris, outline (outer ring node ids),
 *  anchors [{name, role, pole, at, pull}], ridgeLow, area_m2, span, source } */
export function solvePitch(sku, pitch, { fast = false } = {}) {
  const pat = PATTERNS[sku];
  if (!pat) return null;
  const P = pitchOf(sku, pitch);
  // pegs the user placed (tarp mode): { key: {x, z} } in the tarp's own frame -- see `pegKey` below
  const U = P.pegs || {};
  const key = `${sku}|${P.a}|${P.b}|${JSON.stringify(P.corners)}|${P.lean}|${P.sag}|${JSON.stringify(U)}|${P.order}|${P.mainPull}|${fast}`;
  // dragging a peg re-solves on every frame: a quarter of the work gives the shape to within a few cm
  // (a free ridge -- wings first -- settles slower: its poles have to slide into place)
  const STEPS = fast ? TUNE.steps / (P.order === "wings" ? 2 : 4) : TUNE.steps, ITERS = fast ? TUNE.iters / 2 : TUNE.iters;
  const lean = (P.lean || 0) * Math.PI / 180;
  const topY = len => len * Math.cos(lean);           // a leaning pole's top stands lower
  const hA = topY(P.a), hB = topY(P.b);
  if (solveCache.has(key)) return solveCache.get(key);
  const mesh = meshOf(sku);
  const nP = mesh.pts.length;
  const cz = mesh.centre.z;
  // start from the flat pattern lifted to a tent shape, so the relaxation begins near the answer
  const top = Math.max(P.a, P.b) * Math.cos((P.lean || 0) * Math.PI / 180);
  const x = new Float64Array(nP * 3);
  mesh.pts.forEach((p, i) => { x[3 * i] = p.x; x[3 * i + 1] = top * 0.7; x[3 * i + 2] = p.z; });
  // anchors
  const anchors = pat.ring.map((v, i) => {
    const node = mesh.vertNode[i];
    const out = { x: v.x - mesh.centre.x, z: v.z - cz }, l = Math.hypot(out.x, out.z);
    const u = { x: out.x / l, z: out.z / l };
    if (v.role === "tip") return { ...v, node, pole: v.name === "T" ? P.a : P.b, u };
    return { ...v, node, pole: P.corners[v.name] ?? null, u };
  });
  // a main pole's legs: which corners share their pegs (the Octa's ends, guyed)
  for (const a of anchors) if (a.role === "tip")
    a.share = anchors.filter(q => q.peg === "main" && !q.pole && Math.sign(q.z - cz) === (a.name === "T" ? 1 : -1));
  // TAUT (order "mains"): the ridge tape runs pole top to pole top as a line, and it does not stretch:
  // so the two poles stand exactly as far apart (in plan) as the ridge's length allows for their height
  // difference, and every node on the ridge sits on that line; the cloth only decides the wings. Not
  // the default any more -- see `free` below: the manuals tighten the wings first, and the ridge then
  // is free.
  const iTn = anchors.find(a => a.name === "T").node, iBn = anchors.find(a => a.name === "B").node;
  const zT = mesh.pts[iTn].z, zB = mesh.pts[iBn].z, Lr = zT - zB;
  // A taut ridge is ALMOST straight: pitched well it keeps a slight, soft dip -- `sag` of its span
  // (the owner's correction of "straight"). The tape still does not stretch, so a dipping ridge pulls
  // its poles a little closer: a parabola of sag s over chord C is C (1 + 8 s^2 / 3) long.
  const sagR = P.sag ?? RIDGE_SAG;
  const C3 = Lr / (1 + 8 * sagR * sagR / 3);
  const dip = sagR * C3;
  const D = Math.sqrt(Math.max(0, C3 * C3 - (hA - hB) ** 2));
  // Under the 45-degree rule a main pole's 二又 legs meet the ground as far out as its top is high,
  // 45 deg either side of the ridge. A corner that shares a leg's peg (peg: "main") is pulled to it.
  const userPeg = k => U[k] && { x: U[k].x, z: U[k].z + cz };   // a user's peg, in the solver's frame
  const mainPeg = c => {
    const s = Math.sign(c.z - cz) || 1, h = s > 0 ? hA : hB, side = Math.sign(c.x) || 1;
    return { x: side * h * Math.SQRT1_2, z: s * D / 2 + cz + s * h * Math.SQRT1_2 };
  };
  // THE ORDER THE ROPES ARE TIGHTENED (`order`). Mains first (the default): the main ropes lock the poles'
  // spacing with the ridge pulled straight, the wings cannot bend it -- the pinned ridge above. WINGS
  // FIRST, as both Snow Peak manuals have it (HD Hexa p.5 / Octa p.6: slacken the ridge ~20%, tension the
  // wings, and only once the slack is gone tighten the mains, all ropes alike): the poles' spacing is
  // never locked. Each pole top keeps its height and slides along the ridge, pulled out by its two
  // 二又 legs; the wings pull the ridge down and out; where those balance is the pitch -- the ridge's
  // curve and the pole tips standing up out of it (the "horns") are OUTPUTS.
  const free = P.order === "wings";
  const fixed = new Map();            // node -> [x, y, z] (full pin)
  if (!free) for (const i of mesh.ridge) {
    const s = (mesh.pts[i].z - zB) / Lr;
    fixed.set(i, [0, hB + s * (hA - hB) - 4 * dip * s * (1 - s), -D / 2 + s * D + cz]);
  }
  // wings first: a pole top is held at its height and on the centre line, free along it, and pulled at
  // its two legs' pegs -- staked where the taut pitch would put them, and left there as the top moves
  const tips = !free ? [] : anchors.filter(a => a.role === "tip").map(a => {
    const s = a.name === "T" ? 1 : -1, h = s > 0 ? hA : hB, zt = s * D / 2 + cz;
    const reach = pat.rope45 ? h : Math.sqrt(Math.max(0, MAIN_ROPE_LEG ** 2 - h * h));
    const pegs = [-1, 1].map(side => userPeg(pegKey(a, side, s))
      || (a.share?.find(q => Math.sign(q.x) === side) && pat.rope45 ? mainPeg(a.share.find(q => Math.sign(q.x) === side)) : null)
      || { x: side * reach * Math.SQRT1_2, z: zt + s * reach * Math.SQRT1_2 });
    return { node: a.node, h, pegs };
  });
  // sub-pole corners: the pole fixes the height; the guy decides where across the ground
  const fixedY = new Map(anchors.filter(a => a.pole && a.role !== "tip").map(a => [a.node, topY(a.pole)]));
  // Start from the answer's neighbourhood: each wing swung down about the (straight) ridge like an
  // opening book -- a rigid move, so the cloth starts unstretched -- rather than from a flat sheet
  // that takes thousands of steps to fall into place.
  const swing = 50 * Math.PI / 180;
  mesh.pts.forEach((p, i) => {
    const s = (p.z - zB) / Lr, ry = hB + s * (hA - hB) - 4 * dip * s * (1 - s);
    x[3 * i] = p.x * Math.cos(swing);
    x[3 * i + 1] = Math.max(0, ry - Math.abs(p.x) * Math.sin(swing));
    x[3 * i + 2] = -D / 2 + s * D + cz;
  });
  for (const [i, [px, py, pz]] of fixed) { x[3 * i] = px; x[3 * i + 1] = py; x[3 * i + 2] = pz; }
  const prev = Float64Array.from(x);
  // area-ish mass per node is uniform here: forces are per node, scaled by node count
  const g = TUNE.gravity * 9.81e-3;
  const dt = 1;
  const force = new Float64Array(nP * 3);
  for (let i = 0; i < nP; i++) force[3 * i + 1] = -g * mesh.weight[i];
  const per = nP / 80;                     // keep rope pulls in proportion to the cloth's weight
  // A corner's pull goes into the cloth through its reinforcement patch, not one point: spread it
  // over the nodes within ~40 cm of the corner (weighted toward it), or the solver tears the corner.
  const PATCH = 400;
  // Each anchor's patch: the nodes its pull is spread over, weighted toward the corner.
  // (a wing centre with no pole has no rope either: it is just cloth)
  const patches = anchors.filter(a => a.role !== "tip" && !(a.role === "mid" && !a.pole)).map(a => {
    const c0 = mesh.pts[a.node], near = [];
    mesh.pts.forEach((q, i) => { const d = Math.hypot(q.x - c0.x, q.z - c0.z); if (d < PATCH) near.push([i, 1 - d / PATCH]); });
    const wsum = near.reduce((t, [, w]) => t + w, 0);
    return { a, near: near.map(([i, w]) => [i, w / wsum]) };
  });
  const gravity = Float64Array.from(force);
  // A guyed corner's rope has a LENGTH (the manual: 2 m on the long wing, 3 m on the short), and it
  // runs straight from the corner down to its peg -- so its slope is not a free number: a corner at
  // height h on a rope of length L pulls along h / sqrt(L^2 - h^2). The pull's direction is
  // re-aimed as the corner settles. (A fixed "down" angle was the knob that decided everything,
  // and it put the Hexa L's guyed footprint 1.6 m narrower than Snow Peak publishes.)
  // The pegs a corner is pulled AT, when it has any: the user's (tarp mode), or -- an Octa end corner --
  // the main leg's peg it shares. A raised wing centre has two (its 二又); a leg the user left alone
  // keeps its default place. None: the corner is pulled the rule's way (below).
  const pullPegs = a => {
    if (a.role === "mid") {
      if (!a.pole || !U[pegKey(a, -1)] && !U[pegKey(a, 1)]) return null;
      const px = x[3 * a.node], pz = x[3 * a.node + 2];
      const h = fixedY.get(a.node);
      const reach = (pat.rope45 ? h : Math.sqrt(Math.max(0, a.rope ** 2 - h * h))) * Math.SQRT1_2;
      return [-1, 1].map(side => userPeg(pegKey(a, side))
        || { x: px + (a.u.x - side * a.u.z) * reach, z: pz + (a.u.z + side * a.u.x) * reach });
    }
    const own = userPeg(a.name);
    if (own) return [own];
    if (pat.rope45 && a.peg === "main" && !a.pole) return [mainPeg(a)];
    return null;
  };
  const aimGuys = () => {
    force.set(gravity);
    for (const { a, near } of patches) {
      const f = TUNE.guy * g * per;
      let down = 0;
      const pp = pullPegs(a);
      if (pp) {
        // pulled straight at its peg(s): a rope goes where it is staked, whatever the rule would say
        let vx = 0, vy = 0, vz = 0;
        for (const pg of pp) {
          const dx = pg.x - x[3 * a.node], dy = -x[3 * a.node + 1], dz = pg.z - x[3 * a.node + 2];
          const l = Math.hypot(dx, dy, dz) || 1;
          vx += dx / l; vy += dy / l; vz += dz / l;
        }
        const l = Math.hypot(vx, vy, vz) || 1;
        for (const [i, w] of near) {
          force[3 * i] += f * w * vx / l; force[3 * i + 1] += f * w * vy / l; force[3 * i + 2] += f * w * vz / l;
        }
        continue;
      }
      if (!a.pole) {
        const h = Math.max(0, x[3 * a.node + 1]), L = a.rope || 2000;
        down = h / Math.sqrt(Math.max(L * L - h * h, (0.05 * L) ** 2));
        // a pattern pitched by its manual's 45-degree rule: the rope is taken up on its adjuster until
        // it meets the ground at ~45 deg -- steeper only if the rope is too short for that
        if (pat.rope45 && a.peg !== "main") down = Math.max(1, down);
      }
      const k = Math.hypot(1, down);
      for (const [i, w] of near) {
        force[3 * i] += a.u.x * f * w / k;
        force[3 * i + 2] += a.u.z * f * w / k;
        force[3 * i + 1] -= f * w * down / k;
      }
    }
    // wings first: each pole top pulled at its two legs' pegs, every rope at the same tension (the
    // manual: "均等"); its height and its place on the centre line are the pole's, so only the pull
    // along the ridge does anything
    for (const tp of tips) {
      const f = TUNE.guy * g * per * (P.mainPull ?? 1);
      for (const pg of tp.pegs) {
        const dx = pg.x - x[3 * tp.node], dy = -x[3 * tp.node + 1], dz = pg.z - x[3 * tp.node + 2];
        force[3 * tp.node + 2] += f * dz / (Math.hypot(dx, dy, dz) || 1);
      }
    }
  };
  aimGuys();
  // constraints as flat typed arrays: this loop runs ~10 million times per pitch
  const nC = mesh.C.length;
  const CA = new Int32Array(nC), CB = new Int32Array(nC), CR = new Float64Array(nC), CW = new Float64Array(nC);
  mesh.C.forEach(([a, b, r, w], q) => { CA[q] = 3 * a; CB[q] = 3 * b; CR[q] = r; CW[q] = w; });
  const pinN = [...fixedY.keys()].map(k => 3 * k + 1), pinY = [...fixedY.values()];
  const fullN = [...fixed.keys()].map(k => 3 * k), fullP = [...fixed.values()];
  for (let step = 0; step < STEPS; step++) {
    if (step % 20 === 0) aimGuys();
    // Verlet with heavy damping: we want the resting shape, not the flapping
    for (let i = 0; i < nP * 3; i++) {
      const v = (x[i] - prev[i]) * 0.86;
      prev[i] = x[i];
      x[i] += v + force[i] * dt * dt;
    }
    for (let it = 0; it < ITERS; it++) {
      // alternate the sweep: one-directional Gauss-Seidel leaves a handed bias (a symmetric pitch
      // came out lopsided by 40 cm)
      const fwd = (it + step) % 2 === 0;
      for (let qq = 0; qq < nC; qq++) {
        const q = fwd ? qq : nC - 1 - qq;
        const ax = CA[q], bx = CB[q], rest = CR[q], w = CW[q];
        const dx = x[bx] - x[ax], dy = x[bx + 1] - x[ax + 1], dz = x[bx + 2] - x[ax + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        if (d < rest) continue;                   // cloth pulls, it never pushes: squeezed, it goes slack
        const k = (d - rest) / d * 0.5 * w;
        x[ax] += dx * k; x[ax + 1] += dy * k; x[ax + 2] += dz * k;
        x[bx] -= dx * k; x[bx + 1] -= dy * k; x[bx + 2] -= dz * k;
      }
      for (let p = 0; p < pinN.length; p++) x[pinN[p]] = pinY[p];
      for (let p = 0; p < fullN.length; p++) { const b = fullN[p], v = fullP[p]; x[b] = v[0]; x[b + 1] = v[1]; x[b + 2] = v[2]; }
      for (const tp of tips) { x[3 * tp.node] = 0; x[3 * tp.node + 1] = tp.h; }
      for (let i = 0; i < nP; i++) if (x[3 * i + 1] < 0) x[3 * i + 1] = 0;
    }
  }
  // stretch: how far the cloth had to give to make this pitch
  let worst = 0;
  for (const [a, b, rest, w] of mesh.C) {
    if (w < 1) continue;
    const d = Math.hypot(x[3 * b] - x[3 * a], x[3 * b + 1] - x[3 * a + 1], x[3 * b + 2] - x[3 * a + 2]);
    worst = Math.max(worst, (d - rest) / rest);
  }
  // centre it: the ridge tips' midpoint at the origin, B -> T along +z
  const T = anchors.find(a => a.name === "T").node, B = anchors.find(a => a.name === "B").node;
  const ox = (x[3 * T] + x[3 * B]) / 2, oz = (x[3 * T + 2] + x[3 * B + 2]) / 2;
  const rot = Math.atan2(x[3 * T] - x[3 * B], x[3 * T + 2] - x[3 * B + 2]);
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < nP; i++) {
    const px = x[3 * i] - ox, pz = x[3 * i + 2] - oz;
    pts.push({ x: px * c - pz * s, y: x[3 * i + 1], z: px * s + pz * c });
  }
  const outline = mesh.outer;
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = pts[outline[i]], q = pts[outline[(i + 1) % outline.length]];
    area += p.x * q.z - q.x * p.z;
  }
  const ox2 = outline.map(i => pts[i].x), oz2 = outline.map(i => pts[i].z);
  const ridgeLow = Math.min(...mesh.ridge.map(i => pts[i].y));
  const cornerLow = Math.min(...anchors.filter(a => a.role === "corner").map(a => pts[a.node].y));
  const res = {
    // the solver itself leaves ~1-3% give under these pulls; a pitch the cloth truly cannot reach
    // stretches far past that, so the line sits clear of the solver's own noise
    ok: worst < 0.06, why: worst < 0.06 ? undefined : "short", stretch: worst,
    family: pat.family, source: pat.source, pitch: P,
    pts, tris: mesh.tris, outline, ridge: mesh.ridge, edgeN: TUNE.N,   // outline[e * edgeN] is ring vertex e: the corners
    anchors: anchors.map(a => {
      const at = pts[a.node];
      // Where its rope(s) meet the ground, ropes straight and taut. A main pole: two 二又 legs, 45 deg
      // either side of the ridge. A guyed corner: its own rope (2 m / 3 m) out along the line from the
      // centre. A sub-pole: its guy out along that line at 45 deg.
      const cl = Math.hypot(at.x, at.z) || 1, ox = at.x / cl, oz = at.z / cl;
      let pegs;
      if (a.role === "tip") {
        const reach = pat.rope45 ? at.y : Math.sqrt(Math.max(0, MAIN_ROPE_LEG ** 2 - at.y ** 2)), s = a.name === "T" ? 1 : -1;
        const tp = tips.find(q => q.node === a.node);
        if (tp) pegs = tp.pegs.map((pg, i) => {        // wings first: the legs stay where they were staked
          const k = pegKey(a, [-1, 1][i], s);
          return { x: pg.x, z: pg.z - cz, key: k, ...(U[k] && { user: true }) };
        });
        else pegs = [-1, 1].map(side => {
          // a leg whose peg is shared with a corner answers to that corner's key; the user's peg wins
          const k = pegKey(a, side, s), mine = U[k];
          if (mine) return { x: mine.x, z: mine.z, key: k, user: true };
          const keyed = q => ({ ...q, key: k });
          if (pat.rope45) return keyed({ x: at.x + side * reach * Math.SQRT1_2, z: at.z + s * reach * Math.SQRT1_2 });
          // A corner whose rope SHARES this leg's peg (the Octa's end corners: 3 m rope and 二又 leg on
          // one peg, manual p.4): the peg is where that rope, taut, meets the 45-degree leg -- the
          // corner's rope length decides the main rope's reach, not the other way round.
          const c = anchors.find(q => q.peg === "main" && Math.sign(q.x) === side && Math.sign(q.z) === s);
          if (c && !c.pole) {
            const cp = pts[c.node], r2 = reachOf(pat, c, cp.y) ** 2;
            // P = at + t (side, s)/sqrt2 on the ground; |P - cp|^2 = r2 -> t^2 + 2 b t + (|d|^2 - r2) = 0
            const dx = at.x - cp.x, dz = at.z - cp.z, b = (dx * side + dz * s) * Math.SQRT1_2;
            const t = -b + Math.sqrt(Math.max(0, b * b - (dx * dx + dz * dz - r2)));
            return keyed({ x: at.x + side * t * Math.SQRT1_2, z: at.z + s * t * Math.SQRT1_2 });
          }
          return keyed({ x: at.x + side * reach * Math.SQRT1_2, z: at.z + s * reach * Math.SQRT1_2 });
        });
      } else if (a.role === "mid") {
        // a raised wing centre: its own 二又 (7 m, doubled), two legs 45 deg either side of straight out;
        // not raised, it has no rope at all
        // (under the 45-degree rule, each leg meets the ground as far out as the pole top is high)
        const reach = !a.pole ? 0 : pat.rope45 ? at.y : Math.sqrt(Math.max(0, a.rope ** 2 - at.y ** 2));
        pegs = !a.pole ? [] : [-1, 1].map(side => {
          const k = pegKey(a, side);
          return U[k] ? { x: U[k].x, z: U[k].z, key: k, user: true }
            : { x: at.x + (ox - side * oz) * reach * Math.SQRT1_2, z: at.z + (oz + side * ox) * reach * Math.SQRT1_2, key: k };
        });
      } else if (a.peg === "main" && !a.pole) {
        pegs = null;     // shares the main pole's peg: filled in below, once the tips have theirs
      } else {
        const reach = a.pole ? at.y : reachOf(pat, a, at.y);
        pegs = [U[a.name] ? { x: U[a.name].x, z: U[a.name].z, key: a.name, user: true }
          : { x: at.x + ox * reach, z: at.z + oz * reach, key: a.name }];
      }
      const letter = String.fromCharCode(65 + pat.ring.findIndex(v => v.name === a.name));
      if (!a.pole) return { name: a.name, letter, role: a.role, side: a.side, pole: null, rope: a.rope, at, pegs };
      // the foot: inboard of the top, along the pull -- the ridge for a main pole, the line from the
      // centre through the corner for a sub-pole
      let ux = 0, uz = a.name === "T" ? 1 : -1;
      if (a.role !== "tip") { const l = Math.hypot(at.x, at.z) || 1; ux = at.x / l; uz = at.z / l; }
      const off = a.pole * Math.sin(lean);
      return { name: a.name, letter, role: a.role, side: a.side, pole: a.pole, rope: a.rope, at, pegs,
        foot: { x: at.x - ux * off, y: 0, z: at.z - uz * off } };
    }),
    ridgeLow, cornerLow, area_m2: Math.abs(area) / 2 / 1e6,
    span: { w: Math.max(...ox2) - Math.min(...ox2), d: Math.max(...oz2) - Math.min(...oz2) },
  };
  // a corner that shares a main leg's peg ropes to exactly that peg
  for (const a of res.anchors) if (a.pegs === null) {
    const tip = res.anchors.find(q => q.role === "tip" && Math.sign(q.at.z) === Math.sign(a.at.z));
    a.pegs = [{ ...tip.pegs.reduce((m, p) => Math.sign(p.x) === Math.sign(a.at.x) ? p : m, tip.pegs[0]) }];
  }
  // Does each rope reach? A rope is taken up on its adjuster, never let out past its length: `need` is
  // the straight run from where it ties on to its peg, `have` the rope (a main leg: half its 二又; a
  // sub-pole's guy is not the tarp's to check). Too short, and that peg cannot be where it is drawn.
  for (const a of res.anchors) for (const pg of a.pegs) {
    const have = a.role === "tip" ? MAIN_ROPE_LEG : a.pole && a.role === "corner" ? null : a.rope || 2000;
    const run = Math.hypot(pg.x - a.at.x, pg.z - a.at.z);
    pg.need = Math.hypot(run, a.at.y);
    pg.have = have;
    pg.deg = Math.atan2(a.at.y, run) * 180 / Math.PI;
    pg.short = have != null && pg.need > have * 1.005;
  }
  res.short = res.anchors.filter(a => a.pegs.some(p => p.short)).map(a => a.letter);
  const gx = [...ox2, ...res.anchors.flatMap(a => a.pegs.map(p => p.x))];
  const gz = [...oz2, ...res.anchors.flatMap(a => a.pegs.map(p => p.z))];
  res.guyed = { w: Math.max(...gx) - Math.min(...gx), d: Math.max(...gz) - Math.min(...gz) };
  solveCache.set(key, res);
  return res;
}
