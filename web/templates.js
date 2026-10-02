// Starter layouts: a few complete, buildable designs to open instead of a bare frame. Each is an
// ordinary layout document (the same intent-only JSON a share link carries), so opening one is
// opening a file -- and every one is checked buildable by the smoke test, against the rules.
// Names and blurbs are i18n keys: tpl.<id> and tpl.<id>.sub.
const doc = (scene, nodes) => ({ app: "igt-planner", v: 1, scene, nodes });

export const TEMPLATES = [
  {
    // One four-unit frame at standing height: a burner, the BBQ box, a box and a tray for the
    // things you reach for, and a bamboo board off the end to put a plate down.
    id: "cook",
    doc: doc("meadow", [
      { i: 1, sku: "CK-150", leg: "CK-114", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-450R-US", span: 2, start: 0 }, { sku: "CK-025", span: 1, start: 2 },
        { sku: "CK-026", span: 1, start: 3 }, { sku: "CK-160", span: 4, start: 4 }] },
      { i: 2, sku: "CK-116TL", host: 1, edge: "end+x" },
    ]),
  },
  {
    // Two frames end to end, long bamboo at one end and a corner at the other: a kitchen with a
    // double burner, the BBQ box, and a run of trays.
    id: "kitchen",
    doc: doc("forest", [
      { i: 1, sku: "CK-150", leg: "CK-114", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-230", span: 4, start: 0 }, { sku: "CK-160", span: 4, start: 4 }] },
      { i: 2, sku: "CK-149", leg: "CK-114", host: 1, edge: "end+x", placements: [
        { sku: "CK-225", span: 2, start: 0 }, { sku: "CK-085", span: 2, start: 2 },
        { sku: "CK-226", span: 1, start: 4 }, { sku: "CK-251", span: 1, start: 5 }] },
      { i: 3, sku: "CK-117TL", host: 1, edge: "end-x" },
      { i: 4, sku: "CK-118TR", host: 2, edge: "end+x" },
    ]),
  },
  {
    // The Jikaro around a Takibi, bamboo on two sides, two chairs at the fire.
    id: "fire",
    doc: doc("night", [
      { i: 1, sku: "ST-050", config: "long_in", bridge: false, x: 0, z: 0, rot: 0 },
      { i: 2, sku: "ST-032RS", host: 1, edge: "opening" },
      { i: 3, sku: "CK-116TL", host: 1, edge: "jik+x" },
      { i: 4, sku: "CK-116TL", host: 1, edge: "jik-x" },
      { i: 5, sku: "LV-085", x: -380, z: 1300, rot: Math.PI },
      { i: 6, sku: "LV-085", x: 380, z: 1300, rot: Math.PI },
    ]),
  },
  {
    // Low style: the frame on 400mm legs, a burner and a wide bamboo insert, cushions on the ground.
    id: "low",
    doc: doc("beach", [
      { i: 1, sku: "CK-150", leg: "CK-112", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-450R-US", span: 2, start: 0 }, { sku: "CK-126TR", span: 4, start: 2 },
        { sku: "CK-085", span: 2, start: 6 }] },
      { i: 2, sku: "CK-116TL", host: 1, edge: "end+x" },
      { i: 3, sku: "TM-096GR", x: -250, z: 650, rot: 0, config: "round" },
      { i: 4, sku: "TM-096OR", x: 450, z: 650, rot: 0, config: "round" },
      { i: 5, sku: "FIG-ADULT", x: -250, z: 680, rot: Math.PI, pose: "ground" },
    ]),
  },
];
