# IGT knowledge base — schema

The Iron Grill Table is a **linear grid at half-unit granularity**, not a 3D
packing problem. A frame is a run of N unit slots; every module claims a whole
number of half-slots. That single fact is what makes a planner tractable: slot
assignment is 1D interval packing, and the rest is layers stacked on top.

Everything below is designed to be consumed directly by a three.js scene — the
layer list *is* the scene graph, and every part carries a real bounding box in
millimetres, so no geometry has to be invented at render time.

## Units

- All lengths are **millimetres**, all weights **grams**, all prices **minor units**
  (cents/yen) as integers. No floats in money.
- Boxes are `{w, d, h}` — width along the frame run, depth front-to-back, height up.
  This matches Snow Peak's own `W×D×H(h)mm` convention on the JP spec table.
- **half-unit** is the atom of the grid. A "1 unit" module has `span: 2`.

## The six layers

A build is a frame plus a set of placements, one list per layer.

| layer    | what lives here                          | positioning                      |
|----------|------------------------------------------|----------------------------------|
| `frame`  | the grid itself; collapsible frames + rails | root of the scene              |
| `leg`    | height: 300 / 400 / 660 / 830 mm, + adjuster | attaches to frame corners     |
| `slot`   | cookers, surfaces, trays, boxes           | half-slot index + span           |
| `rail`   | TTA clamp-ons (windscreen, lantern hanger) | continuous offset along a rail  |
| `hang`   | racks, shelves, box hangers, garbage frame | edge + offset, occupies below   |
| `link`   | frame connectors, extensions              | joins two frames at an angle     |

`slot` is the only layer with discrete packing. `rail` and `hang` are continuous
along an edge, which is why they can't be modelled as slots — a windscreen does
not consume a unit.

## Part record

Every SKU in the catalog is one record. Fields marked ¹ come from the US Shopify
storefront, ² from the JP spec table (joined on SKU), ³ are derived or curated.

```jsonc
{
  "sku": "CK-149",                    // ¹² the join key across all five regions
  "handle": "igt-three-unit-frame",   // ¹
  "title_en": "IGT Three Unit Frame", // ¹
  "title_jp": "アイアングリルテーブル フレーム", // ²
  "barcode": "4960589141340",         // ¹ JAN, secondary join key

  "role": "frame",                    // ³ see role list below — drives planner behaviour
  "collections": ["iron-grill-table", "frames"],  // ¹ Snow Peak's own buckets, kept raw

  "assembled_mm": {"w": 846, "d": 496, "h": 28},  // ² real geometry, for three.js
  "packed_mm":    {"w": 764, "d": 86, "h": 106},  // ² drives the pack check
  "weight_g": 3500,                   // ² authoritative; ¹ grams is shipping weight, not part weight
  "material": "アルミニウム合金、ステンレス鋼", // ²

  // --- grid semantics: only the fields its role needs ---
  "units": 3,                         // ³ frame only: how many unit slots it offers
  "span": 2,                          // ³ slot module only: width in HALF-units (2 = one unit)
  "height_mm": 830,                   // ³ leg only
  "requires": ["CK-903-1"],           // ³ collapsible frame is useless without its rails
  "contains": ["CK-149", "CK-112"],   // ³ sets decompose into component SKUs (from JP セット内容)

  "price": {"us": 16995, "jp": 25300, "uk": null, "tw": null, "kr": null},  // ¹ + snapshots
  "available": {"us": true, "jp": true},
  "image": "https://cdn.shopify.com/...",  // ¹
  "url": {"us": "...", "jp": "..."}
}
```

## Roles

Snow Peak's five collections (`frames` `legs` `cookers` `surfaces` `storage`) are
kept verbatim but are **not sufficient** — 31 of the 83 IGT products fall in none
of them, and the `storage` collection is a general one that also holds 24 buckets
and coolers that cannot enter a slot. `role` is the curated field the planner
actually reads.

| role              | grid meaning                                        | example        |
|-------------------|-----------------------------------------------------|----------------|
| `frame`           | offers `units` slots                                 | CK-149 (3 unit)|
| `rails`           | mandatory partner for a collapsible frame            | CK-903-1       |
| `leg`             | sets build height; 4 discrete heights                | CK-114 (830mm) |
| `height_adjuster` | modifies leg height                                  | CK-151         |
| `slot_module`     | consumes `span` half-slots                           | CK-225, bamboo |
| `rail_accessory`  | clamps to a rail, consumes no slot                   | CK-301 (TTA)   |
| `hanger`          | hangs off an edge, consumes no slot                  | CK-020, DB-005 |
| `connector`       | joins two frames (L / U kitchens)                    | LV-312         |
| `case`            | pack target; has an inner volume                     | UG-903         |
| `set`             | bundle; `contains` other SKUs                        | CK-904SET      |
| `standalone`      | integrated frame+legs, not extensible                | CK-180 IGT Slim|
| `accessory`       | sits on a surface, no grid interaction               | CS-208         |

## Constraints the planner must enforce

1. **Slot packing** — the sum of `span` over slot modules must not exceed `2 × units`,
   and placements may not overlap. Half-unit offsets are legal.
2. **Collapsible frames require rails** — CK-902/903/904 are inert without
   CK-902-1/903-1/904-1. A build that omits them is not buildable.
3. **Legs are a set, not a per-corner choice** — one leg SKU per build; mixing
   heights is not a supported configuration.
4. **Pack check** — every part's `packed_mm` must fit the chosen `case`. This is a
   3D bin-fit, but with ≤15 parts and a soft case it is a volume + longest-edge
   check, not a real packing solve.
5. **Heat clearance** — bamboo surfaces adjacent to a burner. Snow Peak states this
   in the manuals; the rule is *not yet sourced* and is left unenforced rather than
   guessed. See "Open questions".

## Derived grid constants

The unit pitch is **not published** — it is recovered from frame dimensions by
differencing frames of known unit count:

    pitch = (W of the 4-unit frame − W of the 3-unit frame)
    end_overhead = W_3unit − 3 × pitch

`scripts/derive_grid.py` computes this and asserts it holds across the whole frame
family (standard, collapsible, and the sets). If a frame disagrees, the assertion
fails loudly rather than silently corrupting every downstream placement.

## Open questions

- **Heat clearance rules.** Manuals are linked as PDFs from the JP pages
  (`取扱方法`). Parsing them is the only sourced way to get this right.
- **Rail accessory positioning.** TTA clamps slide continuously; whether they
  collide with slot modules depends on module height above the rail. Needs the
  rail cross-section, which no spec table gives — likely measured off product
  photos or the manual PDFs.
- **Region SKU divergence.** JP has IGT items the US does not (and vice versa).
  The catalog is a union keyed by SKU; region-missing parts carry `null` prices
  rather than being dropped.
