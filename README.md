# igt-planner

A configurator for the Snow Peak **Iron Grill Table** (IGT) system — the camp-kitchen
equivalent of IKEA's PAX planner. Drag modules into a frame, get a 3D preview, a
bill of materials, a packed weight, and a five-region price comparison.

**Status:** knowledge base (phase 1). The three.js planner is phase 2 and consumes
`catalog/igt-catalog.json` directly.

## Why this is tractable

IGT looks like a 3D packing problem and isn't. A frame is a **linear run of unit
slots**, and every module claims a whole number of half-slots. Slot assignment is
1D interval packing; everything else is a layer stacked on top (legs, rail clamps,
hangers). See [SCHEMA.md](SCHEMA.md) for the model.

## Where the data comes from

Neither storefront has everything, so the catalog is a join:

| source | gives us |
|---|---|
| `snowpeak.com` (Shopify) | SKU, JAN barcode, USD price, stock, images, and Snow Peak's own collection tree |
| `ec.snowpeak.co.jp` | the engineering data the US site omits: **mm dimensions, packed size, weight, material, and set contents** |

They join on SKU (`CK-149`), which both sides carry — coverage is 100% on the US side.

Two facts make the rest work:

- The JP spec table publishes **収納サイズ** (packed size), so "will this build fit
  in the carrying case / the car" is a data question, not a guess.
- The JP **セット内容** field lists a bundle's components *by SKU*, so official sets
  decompose into parts — the planner can start you from a set, and tell you whether
  the set is cheaper than buying the pieces.

The unit pitch is never published. `derive_grid.py` recovers it by differencing
frames of known unit count and **refuses to emit a constant it cannot corroborate**
across the whole frame family.

## Build the catalog

```sh
py scripts/fetch_us.py          # US Shopify collections      -> data/us_products_latest.json
py scripts/fetch_jp_specs.py    # JP spec tables (whole site) -> data/jp_specs_latest.json
py scripts/derive_grid.py       # recover the unit pitch      -> catalog/grid.json
py scripts/build_catalog.py     # join + classify             -> catalog/igt-catalog.json
```

`fetch_jp_specs.py` crawls the entire JP catalog (~2,100 items), not just IGT — the
spec table has the same shape for every product, so this doubles as a full
dimensional database for Snow Peak gear.

## Layout

```
scripts/     the four build steps above
catalog/     committed output: grid.json + igt-catalog.json (the knowledge base)
data/        raw fetches and timestamped archives (gitignored)
```
