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
py scripts/fetch_us.py          # the 6 IGT collections       -> data/us_products_latest.json
py scripts/sync_jp_specs.py     # JP specs, from the snapshot -> data/jp_specs_latest.json
py scripts/fetch_regions.py     # JP + UK prices, from snaps  -> data/regions_latest.json
py scripts/derive_grid.py       # recover the unit pitch      -> catalog/grid.json
py scripts/build_catalog.py     # join + classify             -> catalog/igt-catalog.json
```

### It does not crawl what is already being crawled

[`snowpeak-sale-watch`](../tools/snowpeak-sale-watch) already fetches all ~2,100 JP
product pages, plus the US and UK catalogs, **every day** — and was throwing the JP spec
table away. It now keeps it (`specs` on each raw row), so this project *parses* the
dimensional data instead of re-crawling for it:

- **JP specs** — read from the daily snapshot. No network, and they refresh for free.
- **JP / UK prices** — read from the same snapshots.
- **US** — the only live fetch, and only the 6 IGT collection handles, because
  `/products.json` does not carry collection membership and the planner's whole taxonomy
  hangs off it. Six requests.

`fetch_jp_specs.py` is the bootstrap crawler, kept for the case where the newest snapshot
predates that change. `--reparse` re-derives dimensions from the stored `size_raw` with no
network, so a parser bug costs a second rather than another pass over 2,100 pages — which
is how four of them were found and fixed.

`fetch_jp_specs.py` crawls the entire JP catalog (~2,100 items), not just IGT — the
spec table has the same shape for every product, so this doubles as a full
dimensional database for Snow Peak gear.

## Layout

```
scripts/     the four build steps above
catalog/     committed output: grid.json + igt-catalog.json (the knowledge base)
data/        raw fetches and timestamped archives (gitignored)
```

## The planner (phase 2)

```sh
py serve.py            # -> http://localhost:8795/web/
```

Vanilla three.js, vendored — no build step, no CDN, works offline. It reads
`catalog/igt-catalog.json` directly, so a scraper fix shows up on reload.

- **Frame** and **legs** are chips; **tabletops** and **modules** click to drop into the
  first free run of half-slots. Drag a placed module along the rail — it snaps to the
  125mm grid and refuses to overlap.
- The occupancy bar under the table is the grid itself: one cell per half-slot.
- The BOM prices the build in **US / JP / UK** and shows the delta. The reference build
  (4-unit frame + Bamboo Regular + Flat Burner + 830mm legs) comes out **11.8 kg,
  $570 US, $392 JP (−31%)** — matching what the catalog computes on the command line.

Modules are drawn at their **own width, centred in the slots they claim**, never
stretched to fill them. That is the whole point: a tray built 5mm narrower than its unit
shows a real gap, and the Flat Burner's 20mm-wider rim really does sit on the rails.
Stretching parts to their allocation would hide the one thing worth seeing.
