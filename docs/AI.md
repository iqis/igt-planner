# Use the IGT Planner with your own AI

The planner's rules are open, and they run without a browser. Bring whatever agent you
already use — Claude, ChatGPT, a local model, Claude Code, Codex — and let it design a Snow
Peak IGT layout with you. You describe what you want; the agent writes a layout; the
planner's own rules say whether it can actually be built, and you open the result in 3D.

There is no AI on our side, no account and no key. The agent does the talking; the rules
engine does the geometry.

## The idea in one paragraph

A layout is a small JSON document that records **intent only**: which part, hooked to which
other part's which edge, and which slots a module takes. It never needs coordinates for
anything that hooks on — the planner works those out from the measured hooks and brackets,
exactly as it does when you click. So a language model only has to get the *what* right, and
the part it is worst at, the spatial *where*, is done for it.

## Option A — no tools: your agent writes a link

Paste this to your agent (and describe your setup underneath):

> Design a Snow Peak IGT layout for me. The parts catalog is at
> https://igt.iqis.app/catalog/igt-catalog.json and the layout format is described at
> https://igt.iqis.app/llms.txt. Write the layout JSON, then give me the link
> `https://igt.iqis.app/web/#layout=` followed by the URL-encoded JSON.

Open the link: the design lands as a new page in the planner, where any problem shows in the
warnings panel.

## Option B — an agent that can run commands

Clone the repository and use the CLI. It runs the same rules engine as the web app, and its
output is JSON, made for an agent to read:

```sh
git clone https://github.com/iqis/igt-planner && cd igt-planner
node scripts/igt.mjs parts burner             # find parts: sku, name, size, span, weight
node scripts/igt.mjs example > my.json        # a small valid layout to start from
node scripts/igt.mjs evaluate my.json         # buildable? problems, bill, weight, what fits next
node scripts/igt.mjs link my.json             # a planner link that opens it
```

`evaluate` is the loop: write a layout, evaluate it, read `problems` and each node's `next`
(the parts that fit every open edge and free slot run), revise, repeat. When `buildable` is
true, make the link.

## Option C — in your own code

`web/core.js` has no DOM and no three.js; it imports in Node, Deno, Bun or a Worker:

```js
import * as core from "./web/core.js";
core.loadCatalog({ catalog, colors, textures, fittings });   // the four catalog/*.json files
const report = core.evaluate(layout);
// report.buildable, report.problems, report.bill, report.nodes[i].next
core.listParts({ query: "bamboo", role: "extension_table" });
```

## The layout format

```json
{
  "app": "igt-planner", "v": 1,
  "nodes": [
    { "i": 1, "sku": "CK-150", "leg": "CK-114", "x": 0, "z": 0, "rot": 0,
      "placements": [{ "sku": "GS-450R-US", "span": 2, "start": 0 }] },
    { "i": 2, "sku": "CK-116TR", "host": 1, "edge": "end+x" }
  ]
}
```

That is a four-unit frame on 830mm legs with a Flat Burner in its first unit, and a bamboo
table hooked onto its right-hand end.

**Nodes.** Every node has an id `i` (any unique integer) and a `sku` from the catalog.

- A **free** node (a frame, a standalone table, a chair, a shelter footprint) stands on the
  ground: give it `x`, `z` in millimetres and `rot` in radians. The ground plane is x/z;
  +x is right, +z is toward the viewer.
- A **hooked** node gives `host` (the id it hangs from) and `edge` instead, and no position.
  Its place, rotation and legs are derived.
- A frame takes `leg`: `CK-114` 830mm (standing), `CK-113` 660mm, `CK-112` 400mm (the low
  datum every Snow Peak low table shares), `CK-109` 300mm.

**Edges.** What a host offers:

| host | edges |
|---|---|
| IGT frame, Entry/Slim IGT | `end+x`, `end-x` (the short ends) · `rail+z`, `rail-z` (the long sides, via rail joints) |
| a hooked board | `bracket` (its far edge — where the next board hooks on and its legs stand) |
| Connection Table LV-381 | `end+x`, `end-x`, `side+z`, `side-z` |
| Jikaro ST-050 | `jik+x`, `jik-x`, `jik+z`, `jik-z` (+ chamfers in the spread form) · `opening` (the fire hole) |

Corners and angle extensions turn the run on their own (±90°, ±60°): chain their `bracket`
edges and the shape closes by itself.

**Modules** go in a frame's `placements`. The bay is measured in **half-units** (125mm): a
four-unit frame has 8 half-slots, numbered 0–7 from the `end-x` end. `span` is the part's
`span` in the catalog (a one-unit burner is 2); `start` is the first half-slot it covers.
Modules must not overlap or run off the end.

**Scene** (optional, top level): `"scene": "meadow"` sets the page in a place — `meadow`,
`forest`, `beach`, `desert`, `night` — or on a plain ground — `grass`, `wood`, `gravel`,
`sand`. Leave it out for the bare measuring grid. It changes nothing about what is buildable.

**You do not add** leg sets for hooked boards, rail joints, connection hooks or height
adjusters — the bill adds them, because they follow from the layout.

## Rules worth knowing before you start

- **Span comes from the unit label, never from millimetres.** Some parts are a few mm wider
  than their slot and rest on the rails; trust `span`.
- **400mm is the datum.** Every Snow Peak low table is 400mm tall, and so is the IGT on
  `CK-112` legs. Tables that meet flush must be at the same height; one step apart needs a
  Height Adjuster (added for you); two steps apart cannot be bridged.
- **Gas needs a way out.** A burner's hose leaves through a long-rail side; boards on both
  long rails over a burner block it.
- **The manuals win.** Where a part's manual forbids a pairing, the layout is not buildable;
  where it merely doesn't list one, `evaluate` says so as information.

## What `evaluate` returns

```
buildable   true when no problem is a "warn"
problems    [{level: "warn" | "info", text}] — warn = will not stand / will not fit / forbidden
extent      overall width and depth in mm
bill        {lines: [{sku, name, qty, weight_g, auto}], total_weight_kg} — auto = added by the rules
nodes       per node: resolved x/z/rotation, top height, footprint, modules, and
            next: {edges: [{edge, fits: [sku…]}], slots: [{start, half_units, fits: [sku…]}]}
```

## Data

The catalog (dimensions, weights, the 250mm unit grid, attachment rules) is compiled from
Snow Peak's public product pages and manuals; every derived rule cites its source in
`catalog/`. This is an unofficial, independent project — not affiliated with Snow Peak.
