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
| `slot_module`     | consumes `span` half-slots                           | CK-225, GS-355 |
| `full_top`        | rests on the whole frame, covers `covers_units`      | CK-116TR       |
| `extension`       | bolts to the frame's outside; adds space, takes none | CK-090, CK-118TR|
| `rail_accessory`  | clamps to a rail, consumes no slot                   | CK-301 (TTA)   |
| `hanger`          | hangs off an edge, consumes no slot                  | CK-020, DB-005 |
| `connector`       | joins two frames (L / U kitchens)                    | LV-312         |
| `case`            | pack target; has an inner volume                     | UG-903         |
| `set`             | bundle; `contains` other SKUs                        | CK-148S        |
| `standalone`      | integrated frame+legs, not extensible                | CK-180 IGT Slim|
| `accessory`       | no grid interaction; may belong to another system    | S-029HA (Takibi)|

`full_top` deserves its own role rather than a very wide `slot_module`. A top's width
is the frame's **outer** width, overhead included (846 / 1096), because it rests on
the frame instead of dropping between the rails — so it is not a multiple of the unit
and never packs like one. The arithmetic that falls out of this is the classic IGT
setup: a Regular top (846) on a 4-unit frame (1096) leaves `1096 − 846 = 250`, exactly
one unit, for the burner.

## Set decomposition

A bundle's components come from, in order:

1. **`jp-set-contents`** — the JP spec table's セット内容 names components by SKU. Authoritative, but only exists for parts sold in Japan; 15 of the US sets are US-only SKUs with no JP page.
2. **`name-derived`** — a foundation set *is* its name: "IGT 3 Unit Sitting Set" is the 3-unit frame plus the 660mm legs. Deterministic, and needed because CK-145's description names its frame and legs without linking either.
3. **`us-description-includes`** — links inside a sentence that claims inclusion.

Step 3 has to be sentence-scoped, because a set description does two jobs at once:

> "The set **includes** the aluminum IGT Three Unit Frame and four 400mm Legs.
>  **Pair** the IGT 3 Unit Low Set with the Double Unit BBQ Box."

Both sentences link products. Flattened to a bag of links, the BBQ box lands inside
every set in the catalog — which is exactly what happened before the split.

**Known gap: quantities are not modelled.** "The set also includes *two* Stainless Half
Box" records one CK-025. Set-vs-parts pricing is therefore a lower bound on the saving.

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

The unit pitch is **not published**. It is recovered by differencing frames of
known unit count *within one family*:

    pitch = W(4-unit) − W(3-unit)          # end overhead cancels

Families are kept apart deliberately. The standard frame and the collapsible
(セパレート) frame are built differently at the ends, so requiring them to share an
end overhead would be inventing a constraint that does not exist.

The check that **is** kept is a physical one: modules are interchangeable between
frame types, and that is only possible if every family shares the same pitch. End
overhead may differ between families; pitch may not. `derive_grid.py` fails loudly
if they disagree, rather than averaging its way to a plausible wrong number.

## Span: why the label alone is not enough

`span` is a discrete truth — the number of half-slots a module claims — and where
Snow Peak states it ("1 Unit", "Half Unit") that statement wins outright.

But only **9 of 35** slot-capable parts carry such a label, and the silent ones are
the ones that matter: every burner (GS-355, GS-450R, GS-230) and every bamboo table
(CK-116TR, CK-117TR). So width has to fill the gap — carefully.

Width must **not** be rounded to the nearest half-unit. A module is dropped *into*
its slots, so it is built narrower than the space it claims, and that slack is
designed in, not error:

    (span − 1) × half  <  width  ≤  span × half        ⟹   span = ceil(width / half)

This is a containment test, not a rounding. Clearance is what the inequality
*expects*, so tolerance stops being noise the model has to survive.

The leftover slack is then a free diagnostic. Real designed-in clearance is small
and consistent; a part that implies 40mm of slack is not sitting in a slot at all —
it is a rail clamp or a hanger that was misclassified. Parts carry `clearance_mm`
and `span_source` (`label` | `width`) so this stays auditable rather than baked in.

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
