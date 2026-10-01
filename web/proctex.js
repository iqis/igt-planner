// Wood surfaces drawn on a canvas, for the PUBLIC build.
//
// The repo's own planner wears grain cropped out of Snow Peak's product photographs (web/tex/*_grain,
// *_top, CK-180_teak). Those are someone else's pictures, so the public build ships none of them and
// draws these instead -- the same approach as the ground textures in app.js: generated, so there is
// nothing to source and nothing to license. Each one is aimed at the MEAN colour of the photo it
// replaces (measured at build time, see scripts/build_public.py), because grainMaterial multiplies
// the map by the part's sampled colour: a map with the wrong mean would shift every board's tone.
//
// Seeded, so a board looks the same on every load and in every screenshot.

import * as THREE from "three";

const S = 512;

function rng(seed) {                                   // mulberry32
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const rgb = (c, k = 1, a = 1) =>
  `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

// Anything drawn near an edge is drawn again one tile over, so the texture repeats without a seam.
function wrapped(fn, x, y, r) {
  for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) {
    if (x + dx < -r || x + dx > S + r || y + dy < -r || y + dy > S + r) continue;
    fn(x + dx, y + dy);
  }
}

/** Laminated bamboo: strips running along u, fine fibre lines, and the staggered dark knuckles of
 *  the culm's nodes. A near-grey mean is a stainless lid, not bamboo -- it gets the fibres (they
 *  read as brushing) and no nodes. */
function drawBamboo(ctx, mean, rand) {
  ctx.fillStyle = rgb(mean); ctx.fillRect(0, 0, S, S);
  const sat = Math.max(...mean) - Math.min(...mean);
  // Strips: bands of slightly different tone, laid top to bottom so they tile in v.
  for (let y = 0; y < S;) {
    const h = 26 + rand() * 40, k = 0.94 + rand() * 0.12;
    ctx.fillStyle = rgb(mean, k, 0.55);
    ctx.fillRect(0, y, S, Math.min(h, S - y));
    y += h;
  }
  // Fibres: full-width hairlines, so they tile in u for free.
  for (let i = 0; i < 520; i++) {
    const y = rand() * S, k = 0.84 + rand() * 0.3;
    ctx.fillStyle = rgb(mean, k, 0.18 + rand() * 0.22);
    ctx.fillRect(0, y, S, 0.6 + rand() * 1.2);
  }
  if (sat < 20) return;
  // Nodes: a short dark smudge across the strip with a pale halo, staggered strip to strip.
  for (let i = 0; i < 10; i++) {
    const x = rand() * S, y = rand() * S, w = 9 + rand() * 8, h = 7 + rand() * 7;
    wrapped((px, py) => {
      ctx.fillStyle = rgb(mean, 1.06, 0.22);
      ctx.beginPath(); ctx.ellipse(px, py, w * 1.8, h * 1.3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = rgb(mean, 0.86, 0.22);
      ctx.beginPath(); ctx.ellipse(px, py, w * 0.5, h, 0, 0, 7); ctx.fill();
      for (let j = 0; j < 5; j++) {                    // the knuckle's fine cross-lines
        ctx.fillStyle = rgb(mean, 0.8, 0.25);
        ctx.fillRect(px - w * 0.6 + rand() * w * 1.2, py - h * 0.9, 0.8, h * 1.8);
      }
    }, x, y, 40);
  }
}

/** Teak decking: planks along u with a dark groove between them, wavy grain inside each. */
function drawTeak(ctx, mean, rand) {
  const planks = 5, ph = S / planks;
  for (let p = 0; p < planks; p++) {
    const k = 0.93 + rand() * 0.14, y0 = p * ph;
    ctx.fillStyle = rgb(mean, k); ctx.fillRect(0, y0, S, ph);
    for (let i = 0; i < 70; i++) {                     // grain: long low waves, one full period across
      const y = y0 + 4 + rand() * (ph - 8), amp = 1 + rand() * 4, ph0 = rand() * 7, kk = 0.8 + rand() * 0.35;
      ctx.strokeStyle = rgb(mean, kk * k, 0.25 + rand() * 0.25);
      ctx.lineWidth = 0.6 + rand() * 1.4;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const yy = y + amp * Math.sin(ph0 + x / S * Math.PI * 2);
        x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.fillStyle = rgb(mean, 0.42, 0.85);             // the groove
    ctx.fillRect(0, y0 + ph - 3, S, 3);
  }
}

const canvases = {};
function canvasFor(kind, mean) {
  const key = `${kind}:${mean.join(",")}`;
  if (canvases[key]) return canvases[key];
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const rand = rng(mean[0] * 65536 + mean[1] * 256 + mean[2] + (kind === "teak" ? 7 : 0));
  (kind === "teak" ? drawTeak : drawBamboo)(c.getContext("2d"), mean, rand);
  return (canvases[key] = c);
}

/** A fresh texture over a shared canvas: callers set their own repeat on what they get back. */
export function proceduralGrain(kind, mean) {
  const t = new THREE.CanvasTexture(canvasFor(kind, mean || (kind === "teak" ? [190, 157, 123] : [194, 149, 112])));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
