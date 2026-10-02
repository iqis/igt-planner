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
// chosen so Snow Peak's own setup comes out as the manual says (HD Tarp Hexa L on 280 + 240 poles ->
// ridge curve 185-200 cm). The smoke test holds that.
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
};

// Snow Peak's recommended pitch per family (manuals): poles at the two tips; a hexa's wings guyed,
// a recta's corners on sub-poles. `left` / `right` = a sub-pole height for that side's corners, or
// null = guyed.
export const DEFAULTS = {
  hexa: { a: 2800, b: 2400, left: null, right: null, lean: 5 },
  recta: { a: 2800, b: 2800, left: 1700, right: 1700, lean: 5 },
};
export const MAIN_POLES = [2800, 2400, 2100, 1700, 1400];   // Wing Poles, 60/70 cm sections
export const SUB_POLES = [1900, 1700, 1250];                // uprights: TP-080, TP-022, TP-161
// Pole lean, degrees off vertical, tops pulled OUT by their ropes (the manual: the main rope's
// tension tips the pole top slightly outward). A leaning pole stands lower -- length x cos -- and its
// foot sits inboard of its top by length x sin: which is where the poles end up among the furniture.
export const LEANS = [0, 5, 10, 15];
// The ridge's dip as a fraction of its span (see solvePitch). 2% is ~11 cm on a Hexa L: barely there.
export const RIDGE_SAG = 0.02;

// Calibrated (see the header): per unit of cloth weight, the pull of a main rope and of a guy.
const TUNE = { gravity: 1, guy: 500, guyDown: 1.2, steps: 600, iters: 16, N: 8, K: 6, shear: 0.35 };

export const pitchOf = (sku, p = {}) => {
  const pat = PATTERNS[sku];
  if (!pat) return null;
  const P = { ...DEFAULTS[pat.family], ...(p || {}) };
  // each wing corner on its own: corners[name] = a sub-pole height, or null = guyed. A corner not
  // named falls back to its side's value -- how older pitches (and the recta's default) say it.
  P.corners = Object.fromEntries(pat.ring.filter(v => v.role === "corner")
    .map(v => [v.name, (p?.corners && v.name in p.corners) ? p.corners[v.name] : (P[v.side] ?? null)]));
  return P;
};

/** The flat pattern as a conforming mesh: K rings from the centre out to the curved edge, the edge
 *  sampled N times per side. Ring 0 is the centre; the outer ring IS the cut outline. */
function flatMesh(pat, N = TUNE.N, K = TUNE.K) {
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
  const pts = [{ x: cx, z: cz }];
  for (let j = 1; j <= K; j++) for (let k = 0; k < A; k++) {
    const t = j / K, e = edge[k];
    pts.push({ x: cx + (e.x - cx) * t, z: cz + (e.z - cz) * t });
  }
  const id = (j, k) => j === 0 ? 0 : 1 + (j - 1) * A + ((k % A) + A) % A;
  const tris = [];
  for (let k = 0; k < A; k++) tris.push([0, id(1, k), id(1, k + 1)]);
  for (let j = 1; j < K; j++) for (let k = 0; k < A; k++) {
    tris.push([id(j, k), id(j + 1, k), id(j + 1, k + 1)]);
    tris.push([id(j, k), id(j + 1, k + 1), id(j, k + 1)]);
  }
  // constraints: every triangle edge, the quads' other diagonals (shear), and skip-one links along
  // rings and spokes (a little bending stiffness, so the cloth drapes rather than crumples)
  const links = new Map();
  const link = (a, b, w = 1) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!links.has(k)) links.set(k, [a, b, w]); };
  // Warp and weft hold (spokes and rings, near enough the threads); the BIAS gives. Woven cloth
  // shears on the diagonal, and that is what lets a taut tarp take its saddle -- a ridge with a soft
  // dip and wings falling away. Rigid diagonals too, and the cloth cannot curve both ways at once: it
  // pleated under the ridge instead.
  for (let j = 0; j < K; j++) for (let k = 0; k < A; k++) link(id(j, k), id(j + 1, k));
  for (let j = 1; j <= K; j++) for (let k = 0; k < A; k++) link(id(j, k), id(j, k + 1));
  for (let j = 1; j < K; j++) for (let k = 0; k < A; k++) {
    link(id(j, k), id(j + 1, k + 1), TUNE.shear);
    link(id(j, k + 1), id(j + 1, k), TUNE.shear);
  }
  for (let j = 1; j <= K; j++) for (let k = 0; k < A; k++) link(id(j, k), id(j, k + 2), 0.15);
  for (let j = 0; j + 2 <= K; j++) for (let k = 0; k < A; k++) link(id(j, k), id(j + 2, k), 0.15);
  const C = [...links.values()].map(([a, b, w]) => [a, b, Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z), w]);
  const outer = []; for (let k = 0; k < A; k++) outer.push(id(K, k));
  const vertNode = {}; edge.forEach((e, k) => { if (e.vert >= 0) vertNode[e.vert] = id(K, k); });
  // the ridge: the spokes to T and B
  const iT = ring.findIndex(v => v.name === "T"), iB = ring.findIndex(v => v.name === "B");
  const spoke = i => { const k = edge.findIndex(e => e.vert === i); const s = [0]; for (let j = 1; j <= K; j++) s.push(id(j, k)); return s; };
  // Each node's share of the cloth: a third of every triangle it is a corner of. The ring mesh crowds
  // nodes at the centre, so equal weight per NODE made the middle a lead blob that hung in a pleat
  // under the ridge; weight goes by AREA (normalised so the mean node weighs 1).
  const area = new Float64Array(pts.length);
  for (const [a, b, c] of tris) {
    const A3 = Math.abs((pts[b].x - pts[a].x) * (pts[c].z - pts[a].z) - (pts[c].x - pts[a].x) * (pts[b].z - pts[a].z)) / 6;
    area[a] += A3; area[b] += A3; area[c] += A3;
  }
  const meanA = area.reduce((t, v) => t + v, 0) / pts.length;
  const weight = Array.from(area, v => v / meanA);
  return { pts, tris, C, outer, vertNode, weight, ridge: [...spoke(iT).reverse(), ...spoke(iB).slice(1)], centre: { x: cx, z: cz } };
}
const meshCache = new Map();
const meshOf = sku => {
  if (!meshCache.has(sku)) meshCache.set(sku, flatMesh(PATTERNS[sku]));
  return meshCache.get(sku);
};

const solveCache = new Map();
/** Pitch a tarp. -> { ok, why?, pts (mesh nodes, mm, y up), tris, outline (outer ring node ids),
 *  anchors [{name, role, pole, at, pull}], ridgeLow, area_m2, span, source } */
export function solvePitch(sku, pitch) {
  const pat = PATTERNS[sku];
  if (!pat) return null;
  const P = pitchOf(sku, pitch);
  const key = `${sku}|${P.a}|${P.b}|${JSON.stringify(P.corners)}|${P.lean}|${P.sag}`;
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
  // THE RIDGE IS STRAIGHT. Pitched taut -- the way nearly everyone pitches -- the ridge tape runs
  // pole top to pole top as a line, and it does not stretch: so the two poles stand exactly as far
  // apart (in plan) as the ridge's length allows for their height difference, and every node on the
  // ridge sits on that line. The cloth only decides the WINGS. (An earlier version let the ridge sag
  // under the wings' pull; a taut hexa's ridge does not, and the owner called it.)
  const iTn = anchors.find(a => a.name === "T").node, iBn = anchors.find(a => a.name === "B").node;
  const zT = mesh.pts[iTn].z, zB = mesh.pts[iBn].z, Lr = zT - zB;
  // A taut ridge is ALMOST straight: pitched well it keeps a slight, soft dip -- `sag` of its span
  // (the owner's correction of "straight"). The tape still does not stretch, so a dipping ridge pulls
  // its poles a little closer: a parabola of sag s over chord C is C (1 + 8 s^2 / 3) long.
  const sagR = P.sag ?? RIDGE_SAG;
  const C3 = Lr / (1 + 8 * sagR * sagR / 3);
  const dip = sagR * C3;
  const D = Math.sqrt(Math.max(0, C3 * C3 - (hA - hB) ** 2));
  const fixed = new Map();            // node -> [x, y, z] (full pin)
  for (const i of mesh.ridge) {
    const s = (mesh.pts[i].z - zB) / Lr;
    fixed.set(i, [0, hB + s * (hA - hB) - 4 * dip * s * (1 - s), -D / 2 + s * D + cz]);
  }
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
  for (const a of anchors) {
    if (a.role === "tip") continue;          // the tips are pinned with the ridge
    const f = TUNE.guy * g * per;
    const down = a.pole ? 0 : TUNE.guyDown;
    const h = Math.hypot(1, down);
    const c0 = mesh.pts[a.node];
    const near = [];
    mesh.pts.forEach((q, i) => { const d = Math.hypot(q.x - c0.x, q.z - c0.z); if (d < PATCH) near.push([i, 1 - d / PATCH]); });
    const wsum = near.reduce((t, [, w]) => t + w, 0);
    for (const [i, w] of near) {
      const fi = f * w / wsum;
      force[3 * i] += a.u.x * fi / h;
      force[3 * i + 2] += a.u.z * fi / h;
      force[3 * i + 1] -= fi * down / h;
    }
  }
  // constraints as flat typed arrays: this loop runs ~10 million times per pitch
  const nC = mesh.C.length;
  const CA = new Int32Array(nC), CB = new Int32Array(nC), CR = new Float64Array(nC), CW = new Float64Array(nC);
  mesh.C.forEach(([a, b, r, w], q) => { CA[q] = 3 * a; CB[q] = 3 * b; CR[q] = r; CW[q] = w; });
  const pinN = [...fixedY.keys()].map(k => 3 * k + 1), pinY = [...fixedY.values()];
  const fullN = [...fixed.keys()].map(k => 3 * k), fullP = [...fixed.values()];
  for (let step = 0; step < TUNE.steps; step++) {
    // Verlet with heavy damping: we want the resting shape, not the flapping
    for (let i = 0; i < nP * 3; i++) {
      const v = (x[i] - prev[i]) * 0.86;
      prev[i] = x[i];
      x[i] += v + force[i] * dt * dt;
    }
    for (let it = 0; it < TUNE.iters; it++) {
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
      if (!a.pole) return { name: a.name, role: a.role, side: a.side, pole: null, rope: a.rope, at };
      // the foot: inboard of the top, along the pull -- the ridge for a main pole, the line from the
      // centre through the corner for a sub-pole
      let ux = 0, uz = a.name === "T" ? 1 : -1;
      if (a.role !== "tip") { const l = Math.hypot(at.x, at.z) || 1; ux = at.x / l; uz = at.z / l; }
      const off = a.pole * Math.sin(lean);
      return { name: a.name, role: a.role, side: a.side, pole: a.pole, rope: a.rope, at,
        foot: { x: at.x - ux * off, y: 0, z: at.z - uz * off } };
    }),
    ridgeLow, cornerLow, area_m2: Math.abs(area) / 2 / 1e6,
    span: { w: Math.max(...ox2) - Math.min(...ox2), d: Math.max(...oz2) - Math.min(...oz2) },
  };
  solveCache.set(key, res);
  return res;
}
