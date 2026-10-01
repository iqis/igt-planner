// The parts' DATA and plain maths -- no three.js, no DOM -- so the rules engine (core.js) can use
// them in a browser, in Node, or in a Worker. parts3d.js re-exports every name, so its importers
// are unchanged; the shapes that USE these stay in parts3d.

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


export const BBQ_SURFACE_SKUS = {
  nets:   [],
  halves: ["S-029HA", "S-029HA"],
  plate:  ["GR-006"],
};


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

