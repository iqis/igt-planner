#!/usr/bin/env python3
"""Regional prices for the IGT catalog.

What each region is actually good for, measured rather than assumed:

  US  snowpeak.com      Shopify. SKU, USD, stock, images, descriptions.
  JP  ec.snowpeak.co.jp The only source of dimensions and true product weight.
                        Prices come from the sale-watch snapshots, joined by URL
                        (those rows carry no SKU, but my JP crawl kept the URL).
  UK  snowpeak.co.uk    Shopify, so SKU + GBP are clean -- but it publishes NO
                        dimensions at all, and its weights are duplicated across
                        variants (CK-149 and CK-150 both listed at 4900g, though
                        the 4-unit frame is 700g heavier). Price only. Do not
                        take geometry from here.
  TW/KR                 SPA storefronts whose scraped rows carry no SKU, so there
                        is nothing to join on. Left out rather than guessed at.

UK also models the frames as ONE product with per-unit variants, where the US
splits them into separate products -- so prices must be read per VARIANT, not per
product, or the 4-unit frame silently inherits the 3-unit price.

Usage:
  python fetch_regions.py     # -> data/regions_latest.json  {sku: {jp: cents, uk: pence}}
"""

import glob
import gzip
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SALE_WATCH = Path("V:/projects/tools/snowpeak-sale-watch/data/catalog-history")

UK_BASE = "https://www.snowpeak.co.uk"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def fetch_json(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))
    return {}


def uk_prices():
    """{sku: pence}, from the sale-watch snapshot -- it already pulls the UK catalog
    daily, so re-fetching it here would be a second crawl for data we have.

    Read per VARIANT, not per product: the UK sells the 3-unit and 4-unit frames as
    two variants of one listing (the US splits them into separate products), so a
    per-product read prices the 4-unit frame at the 3-unit's price.
    """
    snaps = sorted(glob.glob(str(SALE_WATCH / "uk" / "raw_*.json.gz")))
    if not snaps:
        print("no UK snapshot; falling back to a live fetch", file=sys.stderr)
        return uk_prices_live()

    prods = json.loads(gzip.open(snaps[-1]).read().decode("utf-8"))["raw"]
    out = {}
    for p in prods:
        for v in p.get("variants", []):
            sku = (v.get("sku") or "").strip()
            if sku and v.get("price"):
                out[sku] = int(round(float(v["price"]) * 100))
    return out


def uk_prices_live():
    out, page = {}, 1
    while True:
        d = fetch_json(f"{UK_BASE}/products.json?limit=250&page={page}")
        batch = d.get("products", [])
        for p in batch:
            for v in p.get("variants", []):
                sku = (v.get("sku") or "").strip()
                if sku and v.get("price"):
                    out[sku] = int(round(float(v["price"]) * 100))
        if len(batch) < 250:
            break
        page += 1
        time.sleep(0.3)
    return out


def jp_prices():
    """{jp_url: yen} from the sale-watch snapshots -- those rows have no SKU, but my
    JP spec crawl kept each item's URL, which is join enough."""
    snaps = sorted(glob.glob(str(SALE_WATCH / "jp" / "catalog_2*.json.gz")))
    if not snaps:
        return {}
    rows = json.loads(gzip.open(snaps[-1]).read().decode("utf-8"))["products"]
    return {r["url"]: int(round(float(r["price"]))) for r in rows if r.get("url") and r.get("price")}


def main():
    specs = json.loads((DATA / "jp_specs_latest.json").read_text(encoding="utf-8"))["items"]
    url_to_sku = {r["jp_url"]: r["sku"] for r in specs if r.get("jp_url") and r.get("sku")}

    jp_by_url = jp_prices()
    jp = {url_to_sku[u]: y for u, y in jp_by_url.items() if u in url_to_sku}
    uk = uk_prices()
    print(f"JP prices: {len(jp)} SKUs   UK prices: {len(uk)} SKUs")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    payload = {
        "captured_at": ts,
        "currencies": {"jp": "JPY", "uk": "GBP"},
        "note": "UK is price-only: it publishes no dimensions and its variant weights "
                "are duplicated. Geometry always comes from JP.",
        "jp": jp,
        "uk": uk,
    }
    body = json.dumps(payload, ensure_ascii=False, indent=1)
    (DATA / f"regions_{ts}.json").write_text(body, encoding="utf-8")
    (DATA / "regions_latest.json").write_text(body, encoding="utf-8")
    print(f"wrote data/regions_{ts}.json")


if __name__ == "__main__":
    sys.exit(main())
