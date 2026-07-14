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

/** The IGT rail is an extruded aluminium channel, not a bar -- the lip along its inner
 *  edge is the thing every module hangs from, and it is most of what makes the frame
 *  legible as an IGT frame rather than as a rectangle. */
export function railProfile(length, thickness, width) {
  const t = thickness, w = width;

  // Profile drawn in XY: x runs across the rail, y is its thickness. The step is the
  // lip -- the inner edge a module's rim rests on.
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -t / 2);
  s.lineTo(w / 2, -t / 2);
  s.lineTo(w / 2, t / 2);
  s.lineTo(-w / 2 + w * 0.62, t / 2);
  s.lineTo(-w / 2 + w * 0.62, -t / 2 + t * 0.45);
  s.lineTo(-w / 2, -t / 2 + t * 0.45);
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
  // ExtrudeGeometry runs from z=0 to z=+depth, so it must be centred BEFORE the axis
  // swap -- otherwise the rail hangs off one end of the frame by its whole length,
  // which is exactly what it did.
  g.translate(0, 0, -length / 2);
  g.rotateY(Math.PI / 2);           // extrusion axis z -> x, the run of the frame
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
  texture.repeat.set(1 / w, -1 / d);
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

  const g = new THREE.ExtrudeGeometry(s, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: thickness * 0.15, bevelSize: thickness * 0.15,
    bevelSegments: 2, curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
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
    const px = x * mm, pz = z * mm;
    if (i === 0) s.moveTo(px, pz);
    else s.lineTo(px, pz);
  });
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: thickness * 0.14, bevelSize: thickness * 0.14, bevelSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
}
