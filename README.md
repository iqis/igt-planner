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

No storefront has everything, so the catalog is a join on SKU (`CK-149`), which every
region carries. What each one is actually good for, measured rather than assumed:

| region | good for | not good for |
|---|---|---|
| **US** `snowpeak.com` | SKU, JAN, USD price, stock, images, collections, and descriptions (which state unit counts the product names omit, and link set components) | weight is *shipping* weight — 74–1200g heavier than the part |
| **JP** `ec.snowpeak.co.jp` | **the only source of geometry**: mm dimensions, 収納サイズ (packed size), true weight, material, set contents | — |
| **UK** `snowpeak.co.uk` | GBP price (Shopify, so the SKU join is clean) | **publishes no dimensions at all**, and its variant weights are duplicated: CK-149 and CK-150 are both listed at 4900g, though the 4-unit frame is 700g heavier |
| TW / KR | — | SPA storefronts whose scraped rows carry no SKU; nothing to join on, so they are left out rather than guessed at |

**Neither the US nor the JP catalog is a superset.** The US has 83 IGT products (the
Renewed/TR lines, US-only sets); the JP category has 70, of which 20 exist nowhere in the
US. The universe is the union.

And neither storefront's taxonomy is clean, in *both* directions: the US files Takibi
grill plates under `cookers` and 24 buckets and coolers under `storage`; the JP files the
TUGUCA wooden shelving line under IGT&キッチン. None of them can enter a unit slot, so
membership is gated on rules rather than on either vendor's own tree.

Two facts make the rest work:

- The JP spec table publishes **収納サイズ** (packed size), so "will this build fit in the
  carrying case / the car" is a data question, not a guess.
- The JP **セット内容** field lists a bundle's components *by SKU*, so official sets
  decompose into parts.

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
py scripts/fetch_regions.py     # JP + UK prices              -> data/regions_latest.json
py scripts/derive_grid.py       # recover the unit pitch      -> catalog/grid.json
py scripts/build_catalog.py     # join + classify             -> catalog/igt-catalog.json
```

`fetch_jp_specs.py --reparse` re-derives dimensions from the stored `size_raw` with no
network, so a parser bug costs a second rather than another crawl of 2,100 pages.

`fetch_jp_specs.py` crawls the entire JP catalog (~2,100 items), not just IGT — the
spec table has the same shape for every product, so this doubles as a full
dimensional database for Snow Peak gear.

## Layout

```
scripts/     the four build steps above
catalog/     committed output: grid.json + igt-catalog.json (the knowledge base)
data/        raw fetches and timestamped archives (gitignored)
```
