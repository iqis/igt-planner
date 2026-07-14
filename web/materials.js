import * as THREE from "three";

// How a part looks is three separate questions, and it is worth keeping them separate:
//
//   colour     sampled from Snow Peak's own product photography (catalog/colors.json).
//              Not guessed from a keyword -- that was the old way and it was inventing
//              data in a project whose whole point is not inventing data.
//   response   how the surface answers light. This is what actually sells "metal":
//              anodised aluminium, brushed stainless and laminated bamboo differ far
//              more in roughness and metalness than they do in hue.
//   silhouette whether the thing is even solid. A wire mesh basket drawn as a block is
//              wrong in a way no colour can fix.

const RESPONSE = [
  // JP material strings are authoritative: they name the alloy.
  [/竹|bamboo/i,                 { metalness: 0.0,  roughness: 0.68 }],
  [/ステンレス|stainless/i,        { metalness: 0.85, roughness: 0.28 }],
  [/アルミ|alumin/i,              { metalness: 0.80, roughness: 0.42 }],  // anodised, not mirror
  [/鋳鉄|鉄|iron|steel/i,         { metalness: 0.55, roughness: 0.62 }],
  [/ポリエステル|ナイロン|polyester|nylon|EVA|生地/i,
                                 { metalness: 0.0,  roughness: 0.92 }],
  [/樹脂|resin|plastic/i,         { metalness: 0.0,  roughness: 0.55 }],
];

const DEFAULT_RESPONSE = { metalness: 0.5, roughness: 0.5 };
const FALLBACK_COLOR = 0x8a929c;

export function responseFor(material) {
  return (RESPONSE.find(([re]) => re.test(material || "")) || [null, DEFAULT_RESPONSE])[1];
}

/** Snow Peak names the mesh parts "Mesh Tray". The name is the authority, the same way
 *  it is for unit spans; the photo's measured openness only corroborates it (the mesh
 *  trays measure 0.62-0.74 see-through, the solid bamboo inserts 0.01). */
export const isMesh = p => /mesh/i.test(p.title_en || "");

/** Selection glows; it does not repaint. Swapping the colour for orange throws away the
 *  real colour we went and sampled -- the whole point is to see what the thing looks like. */
export function materialFor(p, colors, selected) {
  const hex = colors[p.sku]?.color_hex;
  const r = responseFor(p.material);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex || FALLBACK_COLOR),
    metalness: r.metalness,
    roughness: r.roughness,
    emissive: new THREE.Color(selected ? 0x2e1806 : 0x000000),
    ...(isMesh(p) ? { transparent: true, opacity: 0.3, side: THREE.DoubleSide } : {}),
  });
}

/** A box with its edges taken off. Every real part is extruded, stamped or folded metal;
 *  none of them has a mathematically sharp arris, and hard cubes are the single biggest
 *  reason a render reads as a diagram instead of an object. */
export function roundedBox(w, h, d, radius = 2) {
  const r = Math.min(radius, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
  if (r <= 0.01) return new THREE.BoxGeometry(w, h, d);

  const shape = new THREE.Shape();
  const x = w / 2, y = h / 2;
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);

  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - r * 2, bevelEnabled: true,
    bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, -(d - r * 2) / 2);
  return g;
}

/** The IGT rail, in its real cross-section -- MEASURED off CK-149's plan view, not sketched
 *  from the outside.
 *
 *      z -248.0 .. -241.7   aluminium    6.3mm   outer wall
 *      z -241.7 .. -181.1   OPEN        60.6mm   the CHANNEL
 *      z -181.1 .. -158.5   aluminium   22.5mm   the inner LIP
 *      z -158.5 .. +158.5   OPEN       317.0mm   the clear drop-through
 *
 *  Three things follow, and the model had all three wrong:
 *
 *  - The slot modules are 250x360 and 500x360, and the code took 360 as the GAP between
 *    the rails. It is not the gap; it is the SEAT. A 360mm module lands at z = +/-180,
 *    which is ON the 24mm inner lip. The real clear opening is 317mm and the rail is 89mm
 *    wide -- so the rails were being drawn 21mm too narrow on each side, throughout.
 *  - The channel is where the RAIL JOINT slides in: レールジョイントを使用する場合は
 *    IGTフレームの長辺のレールに挿入します.
 *  - And the leg sockets sit in the same groove (z = +/-207.5, and the channel runs
 *    182.5 .. 241.7).
 *
 *  One extrusion, and it accounts for the modules, the joints and the legs at once.
 *
 *  `section` is in scene units. `outward` says which way the outer wall faces (+1 = +z).
 */
export function railProfile(length, thickness, section, outward = 1) {
  const t = thickness;
  const { outerWall, channel, lip } = section;
  const w = outerWall + channel + lip;

  // Drawn in XY: x runs ACROSS the rail, from its outer face inward; y is its thickness.
  // The groove is cut DOWN from the top face and has a floor -- it is a channel, not a slot.
  const floor = t * 0.4;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -t / 2);
  s.lineTo(w / 2, -t / 2);
  s.lineTo(w / 2, t / 2);                              // the inner lip: the module's seat
  s.lineTo(w / 2 - lip, t / 2);
  s.lineTo(w / 2 - lip, -t / 2 + floor);               // down into the groove
  s.lineTo(-w / 2 + outerWall, -t / 2 + floor);
  s.lineTo(-w / 2 + outerWall, t / 2);                 // back up the outer wall
  s.lineTo(-w / 2, t / 2);
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
  // ExtrudeGeometry runs from z=0 to z=+depth, so it must be centred BEFORE the axis
  // swap -- otherwise the rail hangs off one end of the frame by its whole length,
  // which is exactly what it did.
  g.translate(0, 0, -length / 2);
  g.rotateY(Math.PI / 2);                              // extrusion axis z -> x, the frame's run
  if (outward > 0) g.rotateY(Math.PI);                 // outer wall faces +z
  return g;
}

/** Wire basket: the box tells you where it is, the wires tell you what it is.
 *
 *  Takes MILLIMETRES and scales itself, unlike everything else here. That is on purpose:
 *  the wire gauge and the spacing between wires are physical facts (3mm wire, ~26mm
 *  pitch), and expressing them in scene units invites exactly the mistake that was made
 *  first time round -- a 3 that meant millimetres, read as 3 metres.
 */
export function meshWires(wMM, hMM, dMM, color) {
  const g = new THREE.Group();
  g.scale.setScalar(0.001);
  const w = wMM, h = hMM, d = dMM;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.25 });
  const wire = 3;

  const vert = Math.max(3, Math.round(w / 26));
  for (let i = 0; i <= vert; i++) {
    const x = -w / 2 + (i * w) / vert;
    for (const z of [-d / 2, d / 2]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(wire, h, wire), mat);
      m.position.set(x, 0, z);
      g.add(m);
    }
  }
  const rings = Math.max(2, Math.round(h / 26));
  for (let i = 0; i <= rings; i++) {
    const y = -h / 2 + (i * h) / rings;
    const a = new THREE.Mesh(new THREE.BoxGeometry(w, wire, wire), mat);
    a.position.set(0, y, -d / 2); g.add(a);
    const b = a.clone(); b.position.z = d / 2; g.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(wire, wire, d), mat);
    c.position.set(-w / 2, y, 0); g.add(c);
    const e = c.clone(); e.position.x = w / 2; g.add(e);
  }
  return g;
}

/** The corner is a quarter round, not a square. Two straight edges meeting at 90 degrees,
 *  each carrying connection hooks, and a curved outer rim -- it is what turns a layout
 *  through a right angle. Its 496x496 spec is the bounding box of that fan, and reading
 *  the box as the shape is how it ended up drawn as a slab. */
export function quarterRound(radius, thickness, segments = 24) {
  const s = new THREE.Shape();
  s.moveTo(-radius / 2, -radius / 2);
  s.lineTo(radius / 2, -radius / 2);
  s.absarc(-radius / 2, -radius / 2, radius, 0, Math.PI / 2, false);
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: thickness * 0.12, bevelSize: thickness * 0.12,
    bevelSegments: 2, curveSegments: segments,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
}

/** The angle extension splays the layout by about 45 degrees: a long board whose ends are
 *  cut back at an angle. The hooked edge is the long one.
 *
 *  APPROXIMATE. The 990x496 bounding box is published; the setback of the cut is not, and
 *  is eyeballed from the product photograph. Flagged rather than presented as fact. */
export function angleBoard(length, depth, thickness, setback = 200) {
  const s = new THREE.Shape();
  const x = length / 2, z = depth / 2, c = setback;
  s.moveTo(-x, -z);       // the hooked edge, full length
  s.lineTo(x, -z);
  s.lineTo(x - c, z);     // 45-degree cut back
  s.lineTo(-x + c, z);
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: thickness * 0.12, bevelSize: thickness * 0.12, bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
}

/** Snow Peak's own plan view, mapped onto the board.
 *
 *  The shape's coordinates ARE the UVs on an ExtrudeGeometry cap, so the photo lands in
 *  register with the geometry as long as we tell the texture how big the board is. The
 *  alpha channel carries the silhouette, which is why the corner's quarter round does not
 *  have to be believed -- it can just be seen.
 */
export function boardMaterial(p, colors, texture, w, d, selected) {
  const r = responseFor(p.material);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  // Work the v out rather than guess at the sign, because the wrong one is a 180 degrees
  // that only a corner can show you:
  //
  //   ExtrudeGeometry's cap UVs are the shape's own coordinates, so UV.y = pz. rotateX
  //   puts the shape's +pz at world -z, hence UV.y = -world_z.
  //   three samples v = 1 at the image's TOP row, and the image's top row is the SMALLEST
  //   mm z (that is how outline_mm and hooks_mm were read out of it).
  //   So we need v = 0 at world_z = +d/2 and v = 1 at -d/2, i.e. v = 0.5 - world_z/d.
  //   v = UV.y * repeat.y + 0.5 = -world_z * repeat.y + 0.5   =>   repeat.y = +1/d.
  //
  // It was -1/d, so the photograph was laid on every board FLIPPED IN z. A bamboo table is
  // nearly symmetric and hid it completely; the corner is not, and it showed up there as
  // the arc of the painted photo running one way and the arc of the board the other.
  texture.repeat.set(1 / w, 1 / d);
  texture.offset.set(0.5, 0.5);
  texture.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    metalness: r.metalness,
    roughness: r.roughness,
    emissive: new THREE.Color(selected ? 0x2e1806 : 0x000000),
    transparent: true,
    alphaTest: 0.5,
  });
}

/** A flat board, extruded UPWARD from a shape lying in the ground plane.
 *
 *  This matters for texturing, not for looks. roundedBox() extrudes a (width x thickness)
 *  rectangle sideways, so its cap faces are the board's SIDES -- and an ExtrudeGeometry's
 *  cap UVs are its shape coordinates, which means the plan-view photo landed on the edge
 *  of the board instead of on top of it. Building the shape in the ground plane, the way
 *  quarterRound() already did, puts the caps where the photo belongs.
 */
export function flatRect(w, d, thickness, radius = 6) {
  const r = Math.min(radius, w / 2 - 0.001, d / 2 - 0.001);
  const s = new THREE.Shape();
  const x = w / 2, y = d / 2;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);

  return slab(s, thickness);   // top face at y = 0, exactly `thickness` thick
}

/** A board built from the outline traced off its own photograph.
 *
 *  This replaces the hand-built quarterRound/angleBoard for any part that has one, and it
 *  is not a refinement -- it is a fix. Modelling the silhouette AND alpha-cutting it with
 *  the photo meant two independent claims about the same outline, and alphaTest renders
 *  their intersection: the corner came out as a pointed leaf, the overlap of a quarter
 *  round I drew and a quarter round Snow Peak photographed, rotated apart.
 *
 *  One source. The alpha has the outline; the outline builds the shape; the same photo
 *  paints it. They cannot disagree, because they are the same measurement.
 */
export function boardFromOutline(points, thickness, mm = 0.001) {
  const s = new THREE.Shape();
  points.forEach(([x, z], i) => {
    // NEGATE z going in. slab() lays the shape down with rotateX(-PI/2), and that maps the
    // shape's +y to world -z -- so a shape built at the traced millimetres comes out
    // MIRRORED IN Z, and every board in this project was.
    //
    // On a bamboo rectangle it is invisible. On the corner it is fatal: the arc lands on
    // the same side as the hooks, and since the pins are drawn at their true measured
    // millimetres, one of the corner's two hook pins ended up hanging in mid-air, 280mm
    // clear of any board. The silhouette said one thing and the hardware said another.
    //
    // boardMaterial's `-1/d` was a patch ON TOP of this: it flipped the photo to match the
    // flipped geometry, so the alpha lined up and the bug hid behind it. Fixing the sign
    // alone just grew the leaf back. Fix the geometry; the texture then wants +1/d.
    const px = x * mm, pz = -z * mm;
    if (i === 0) s.moveTo(px, pz);
    else s.lineTo(px, pz);
  });
  s.closePath();
  return slab(s, thickness);
}

/** Extrude a ground-plane shape into a board of EXACTLY `thickness`, hanging below y = 0.
 *
 *  Two things, both of which were wrong and which together lifted every bamboo table 28mm
 *  into the air above the frame it was supposed to be flush with:
 *
 *  1. three's bevel is added OUTSIDE `depth`. Extruding a 25mm board at depth 25 with a
 *     14% bevel gives a 32mm board (25 + 2x3.5). Solve for the depth that lands on 25.
 *  2. The extrusion runs 0..depth, so it is NOT centred, and `translate(+t/2)` -- meant to
 *     centre it -- pushed it up by a whole thickness instead of pulling it down by half.
 *
 *  So: put the TOP FACE at y = 0. A tabletop is defined by its working surface, and now
 *  the caller sets `position.y = <the height of that surface>` and cannot get it wrong.
 */
function slab(shape, thickness, bevel = 0.14) {
  const depth = thickness / (1 + 2 * bevel);
  const bt = depth * bevel;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bt, bevelSize: bt,
    bevelSegments: 2, curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);        // shape lies in the ground plane, extruded up
  g.translate(0, -(depth + bt), 0);  // ...then hung from its top face
  return g;
}

/** The tabletop: real grain, cropped from the middle of the board's own photograph.
 *
 *  The plan view goes UNDERNEATH, where the brackets and hook pins actually are. The top
 *  gets the part of the same photo that is only bamboo, tiled. Both faces come from the
 *  one photograph; neither shows the other's hardware.
 */
export function grainMaterial(p, colors, grain, wMM, dMM, selected, tileMM = 320) {
  const r = responseFor(p.material);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.repeat.set(Math.max(1, wMM / tileMM), Math.max(1, dMM / tileMM));
  grain.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map: grain,
    color: new THREE.Color(colors[p.sku]?.color_hex || 0xb98b53),
    metalness: r.metalness,
    roughness: r.roughness,
    emissive: new THREE.Color(selected ? 0x2e1806 : 0x000000),
  });
}
