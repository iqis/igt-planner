#!/usr/bin/env python3
"""Pull the IGT catalog from the US Shopify storefront.

Snow Peak's own collection tree is already the taxonomy a planner needs, so we
take it rather than inventing one:

    frames    -> defines the unit grid a build sits on
    legs      -> the height layer (300 / 400 / 660 / 830 mm)
    cookers   -> slot-filling modules that make heat
    surfaces  -> slot-filling modules you work on
    storage   -> slot-filling modules that hold things

A product can sit in several collections; we keep every membership. The
`iron-grill-table` collection is the superset and catches sets, cases and TTA
rail accessories that live outside the five buckets above.

Shopify gives us SKU (CK-149), JAN barcode, grams, USD price, stock and images.
Physical dimensions are NOT exposed here -- those come from the JP site, joined
on SKU by build_catalog.py.

Usage:
  python fetch_us.py            # -> data/us_products_<ts>.json + us_products_latest.json
"""

import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TAG_RE = re.compile(r"<[^>]+>")
# Set descriptions name their contents in prose -- "features the Renewed Entry IGT,
# Flat Burner, and Stainless Tray 1 Unit" -- and every one of those names is a link
# to the component's own product page. Stripping tags throws the SKUs away.
LINK_RE = re.compile(r'href="[^"]*?/products/([a-z0-9-]+)', re.I)


def plain(html):
    """body_html -> text. The description is where Snow Peak states unit counts that
    the product name leaves out ("The single-unit insert...")."""
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", html or "")).strip()


def linked_handles(html):
    """Product handles the description links to, in order, deduped."""
    seen, out = set(), []
    for h in LINK_RE.findall(html or ""):
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out


ANCHOR_RE = re.compile(r'<a\b[^>]*href="[^"]*?/products/([a-z0-9-]+)"[^>]*>(.*?)</a>', re.I | re.S)


def marked(html):
    """Plain text with each product link kept inline as `Text[[handle]]`.

    A set's description both lists what is in the box and suggests what to buy next:

        "The set includes the aluminum IGT Three Unit Frame and four 400mm Legs."
        "Pair the IGT 3 Unit Low Set with the Double Unit BBQ Box."

    Both sentences link products. Flattening the description to a bag of links makes
    the BBQ box look like part of every set -- so the links have to survive sentence
    splitting, which means keeping them anchored where they appear in the text.
    """
    kept = ANCHOR_RE.sub(lambda m: f"{TAG_RE.sub('', m.group(2))}[[{m.group(1)}]]", html or "")
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", kept)).strip()

BASE = "https://www.snowpeak.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

OUT = Path(__file__).resolve().parent.parent / "data"

# The superset first, then the five functional buckets. Order matters only for
# readability of the membership lists.
COLLECTIONS = ["iron-grill-table", "frames", "legs", "cookers", "surfaces", "storage"]

# The other tables in Snow Peak's Layout System. They connect to IGT frames -- the
# vendor's own copy says so -- but none of them sit in an IGT collection, so no
# collection sweep will ever find them. Handles come from catalog/layout.json, which
# is where the connection rules and their sources live.
LAYOUT_HANDLES_FROM = "catalog/layout.json"


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


def fetch_collection(handle):
    """Shopify caps products.json at 250/page; page until short."""
    prods, page = [], 1
    while True:
        d = fetch_json(f"{BASE}/collections/{handle}/products.json?limit=250&page={page}")
        batch = d.get("products", [])
        prods.extend(batch)
        if len(batch) < 250:
            break
        page += 1
        time.sleep(0.3)
    return prods


def fetch_product(handle):
    d = fetch_json(f"{BASE}/products/{handle}.json")
    return d.get("product")


def layout_handles():
    p = OUT.parent / "catalog" / "layout.json"
    if not p.exists():
        return []
    lay = json.loads(p.read_text(encoding="utf-8"))
    return [t["handle"] for t in lay.get("tables", {}).values() if t.get("handle")]


def main():
    by_handle = {}

    sources = [(c, None) for c in COLLECTIONS] + [("layout-system", layout_handles())]

    for coll, handles in sources:
        if handles is None:
            prods = fetch_collection(coll)
        else:
            prods = [p for p in (fetch_product(h) for h in handles) if p]
        print(f"{coll:20s} {len(prods):3d} products", flush=True)

        for p in prods:
            h = p["handle"]
            if h not in by_handle:
                # One product can carry several variants (colors/sizes). For IGT
                # hardware that is rare; take the first as canonical and keep the
                # rest so a color-aware UI can use them later.
                variants = [
                    {
                        "sku": v.get("sku", ""),
                        "title": v.get("title", ""),
                        "price_usd": float(v["price"]) if v.get("price") else None,
                        "compare_at_usd": float(v["compare_at_price"]) if v.get("compare_at_price") else None,
                        "grams": v.get("grams"),
                        "available": v.get("available", False),
                        "barcode": v.get("barcode", ""),
                    }
                    for v in p.get("variants", [])
                ]
                by_handle[h] = {
                    "handle": h,
                    "us_title": p.get("title", ""),
                    "us_url": f"{BASE}/products/{h}",
                    "description": plain(p.get("body_html")),
                    "description_marked": marked(p.get("body_html")),
                    "linked_handles": linked_handles(p.get("body_html")),
                    "product_type": p.get("product_type", ""),
                    "tags": p.get("tags", []),
                    "collections": [],
                    "variants": variants,
                    "sku": variants[0]["sku"] if variants else "",
                    "barcode": variants[0]["barcode"] if variants else "",
                    "price_usd": variants[0]["price_usd"] if variants else None,
                    "available": any(v["available"] for v in variants),
                    # Keep the whole gallery: the top-down shot is in there somewhere, and which
                    # one it is gets decided by measuring, not by guessing at index 0.
                    "images": [im.get("src", "") for im in p.get("images", [])],
                }
            by_handle[h]["collections"].append(coll)
        time.sleep(0.3)

    items = sorted(by_handle.values(), key=lambda r: r["handle"])
    no_sku = [r["handle"] for r in items if not r["sku"]]

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": BASE,
        "captured_at": ts,
        "collections": COLLECTIONS,
        "count": len(items),
        "missing_sku": no_sku,
        "items": items,
    }
    body = json.dumps(payload, ensure_ascii=False, indent=1)
    (OUT / f"us_products_{ts}.json").write_text(body, encoding="utf-8")
    (OUT / "us_products_latest.json").write_text(body, encoding="utf-8")

    print(f"\nunique products: {len(items)}   missing SKU: {len(no_sku)}")
    print(f"wrote data/us_products_{ts}.json")


if __name__ == "__main__":
    sys.exit(main())
