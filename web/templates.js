// Starter layouts: a few complete, buildable designs to open instead of a bare frame. Each is an
// ordinary layout document (the same intent-only JSON a share link carries), so opening one is
// opening a file -- and every one is checked buildable by the smoke test, against the rules.
// Names and blurbs are i18n keys: tpl.<id> and tpl.<id>.sub. Optional view (camera direction) and
// zoom (< 1 = closer) set the thumbnail's camera.
const doc = (scene, nodes) => ({ app: "igt-planner", v: 1, scene, nodes });

export const TEMPLATES = [
  {
    // The smallest real setup: one three-unit frame at sitting height, a burner and three trays, two
    // chairs. Nothing hooked on -- the frame and its slots, which is where every design starts.
    id: "first",
    doc: doc("meadow", [
      { i: 1, sku: "CK-149", leg: "CK-113", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-450R-US", span: 2, start: 0 }, { sku: "CK-085", span: 2, start: 2 },
        { sku: "CK-026", span: 1, start: 4 }, { sku: "CK-251", span: 1, start: 5 }] },
      { i: 2, sku: "LV-077GY", x: -300, z: -700, rot: 0 },
      { i: 3, sku: "LV-077RD", x: 300, z: -700, rot: 0 },
    ]),
  },
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
    // An L: a cooking frame, a corner, and a second frame off the corner's bracket (on its own
    // four legs), with a long bamboo board to finish the run.
    id: "lshape",
    doc: doc("meadow", [
      { i: 1, sku: "CK-150", leg: "CK-114", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-450R-US", span: 2, start: 0 }, { sku: "CK-160", span: 4, start: 2 },
        { sku: "CK-026", span: 1, start: 6 }, { sku: "CK-025", span: 1, start: 7 }] },
      { i: 2, sku: "CK-119TR", host: 1, edge: "end+x" },
      { i: 3, sku: "CK-149", leg: "CK-114", host: 2, edge: "bracket", placements: [
        { sku: "CK-085", span: 2, start: 0 }, { sku: "CK-126TR", span: 4, start: 2 }] },
      { i: 4, sku: "CK-117TR", host: 3, edge: "end+x" },
    ]),
  },
  {
    // Stand to cook, sit to eat: a standing frame joined one rung down to a sitting-height frame.
    // The planner adds the Height Adjuster (CK-151) that makes the step.
    id: "step",
    doc: doc("forest", [
      { i: 1, sku: "CK-150", leg: "CK-114", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-230", span: 4, start: 0 }, { sku: "CK-025", span: 1, start: 4 },
        { sku: "CK-026", span: 1, start: 5 }, { sku: "CK-085", span: 2, start: 6 }] },
      { i: 2, sku: "CK-149", leg: "CK-113", host: 1, edge: "end+x", step: 1, placements: [
        { sku: "CK-126TR", span: 4, start: 0 }, { sku: "CK-125TR", span: 2, start: 4 }] },
      { i: 3, sku: "LV-077GY", x: 800, z: -700, rot: 0 },
      { i: 4, sku: "LV-077GY", x: 1150, z: -700, rot: 0 },
    ]),
  },
  {
    // A slide-in board along the long rail: more table without more length.
    id: "slide",
    doc: doc("beach", [
      { i: 1, sku: "CK-149", leg: "CK-113", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-450R-US", span: 2, start: 0 }, { sku: "CK-085", span: 2, start: 2 },
        { sku: "CK-226", span: 1, start: 4 }, { sku: "CK-251", span: 1, start: 5 }] },
      { i: 2, sku: "CK-153TR", host: 1, edge: "rail+z" },
    ]),
  },
  {
    // Solo and light: the collapsible two-unit frame on 400mm legs, a grill burner, a low chair.
    id: "solo",
    doc: doc("forest", [
      { i: 1, sku: "CK-902", leg: "CK-112", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-355", span: 2, start: 0 }, { sku: "CK-226", span: 1, start: 2 },
        { sku: "CK-251", span: 1, start: 3 }] },
      { i: 2, sku: "LV-091", x: 0, z: -650, rot: 0 },
    ]),
  },
  {
    // A family kitchen under a Takibi Tarp Hexa M: the tarp is drawn to size, so you can see
    // the table, the chairs and the people fit under it.
    id: "tarp",
    // Its guy ropes reach metres out, so "all of it" would leave the table a speck: frame in close,
    // low enough to see under the roof.
    view: [.8, .3, 1], zoom: .4,
    doc: doc("meadow", [
      { i: 1, sku: "TP-440", x: 0, z: 0, rot: 0 },
      { i: 2, sku: "CK-150", leg: "CK-113", x: 0, z: 0, rot: 0, placements: [
        { sku: "GS-450R-US", span: 2, start: 0 }, { sku: "CK-126TR", span: 4, start: 2 },
        { sku: "CK-085", span: 2, start: 6 }] },
      { i: 3, sku: "CK-116TR", host: 2, edge: "end+x" },
      { i: 4, sku: "LV-077GY", x: -300, z: -700, rot: 0 },
      { i: 5, sku: "LV-077RD", x: 300, z: -700, rot: 0 },
      { i: 6, sku: "FIG-ADULT", x: -1100, z: 150, rot: Math.PI / 2 },
      { i: 7, sku: "FIG-CHILD", x: -1050, z: -350, rot: Math.PI / 2 },
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
