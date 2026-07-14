#!/usr/bin/env python3
"""Collect every photograph Snow Peak publishes of each part, and the manual PDF.

The US Shopify gallery carries TWO images per product -- a hero and one alt -- and that is
all it has. The JP item page carries six or more, plus the assembly manual. Every
measurement in this project so far came out of the two US ones, which is not a choice,
it is what was reachable.

The reason this matters is not volume. It is that the flat, orthographic, on-white shot --
the one that is really a scale drawing -- is a DIFFERENT image on different products, and
sometimes there isn't one in the US gallery at all (CK-116TL, CK-117TL). make_textures.py
currently picks it by matching the silhouette's aspect to the published w:d, which is a
decent heuristic and an honest one, but it is still a guess, and it cannot find an image
it was never given.

So: gather everything, show it in the part bench, and let a human say which is which.
catalog/views.json records what they said. A declared view beats a guessed one.

Usage:
  python fetch_images.py                # -> catalog/images.json
  python fetch_images.py --sku CK-119TR
"""

import argparse
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

# JP item pages name their images <CODE>_<size>_<tag>.jpg. The sizes are s (thumb), l, x
# (largest); the tags are a001.. for the gallery, a099 for the studio shot on white, c1xx
# for whatever the category page wants. Take the x, keep the tag -- the tag is the only
# stable name an image has, and it is what a human will point at.
JP_IMG = re.compile(r'https://img\.snowpeak\.co\.jp/img/item/[^"\'\s]+?_(s|l|x)_([a-z]\d+)\.jpe?g', re.I)
JP_PDF = re.compile(r'https://[^"\'\s]+?\.pdf')


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def jp_images(jp_url):
    """This item's own images, largest size, plus the manual. Not the recommendation rail:
    a JP page links a dozen other products' thumbnails, and they all live on the same CDN.
    The item CODE in the path is what separates them."""
    code = jp_url.rstrip("/").split("/")[-1]              # SNP0119A0081
    try:
        html = get(jp_url).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return [], None, str(e)

    tags = {}
    for m in JP_IMG.finditer(html):
        url = m.group(0)
        if code not in url:
            continue                                       # someone else's product
        tag = m.group(2)
        # keep the largest available for each tag
        rank = {"s": 0, "l": 1, "x": 2}[m.group(1).lower()]
        if tag not in tags or rank > tags[tag][0]:
            tags[tag] = (rank, url)

    imgs = [{"url": u, "tag": t, "source": "jp"} for t, (_, u) in sorted(tags.items())]
    pdfs = [u for u in JP_PDF.findall(html) if "manual" in u.lower() or code[:3] in u]
    return imgs, (pdfs[0] if pdfs else None), None


def us_images(handle):
    """Shopify tells you everything if you ask it in .js -- but there is not much to tell."""
    try:
        d = json.loads(get(f"https://www.snowpeak.com/products/{handle}.js"))
    except Exception:  # noqa: BLE001
        return []
    out = []
    for u in d.get("images", []):
        url = "https:" + u if u.startswith("//") else u
        name = url.split("/")[-1].split("?")[0]
        out.append({"url": url, "tag": name, "source": "us"})
    return out


def one(p):
    sku = p["sku"]
    url = p.get("url") or {}
    rec = {"sku": sku, "images": [], "manual": None}

    if url.get("us") and p.get("handle"):
        rec["images"] += us_images(p["handle"])
    if url.get("jp"):
        imgs, manual, err = jp_images(url["jp"])
        rec["images"] += imgs
        rec["manual"] = manual
        if err:
            rec["error"] = err
    time.sleep(0.1)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sku", help="just this one")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()

    cat = json.loads((CATALOG / "igt-catalog.json").read_text(encoding="utf-8"))
    parts = [p for p in cat["parts"] if not a.sku or p["sku"] == a.sku]

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        recs = list(ex.map(one, parts))

    out = {r["sku"]: {k: v for k, v in r.items() if k != "sku"} for r in recs}
    n_us = sum(1 for r in recs for i in r["images"] if i["source"] == "us")
    n_jp = sum(1 for r in recs for i in r["images"] if i["source"] == "jp")
    n_man = sum(1 for r in recs if r["manual"])

    (CATALOG / "images.json").write_text(json.dumps({
        "_comment": "Every photograph Snow Peak publishes of each part, and the assembly "
                    "manual. The US gallery has two images; the JP item page has six or "
                    "more plus the PDF. Tags are Snow Peak's own (a001.., a099, c1xx) and "
                    "are how a human points at one. See views.json for what they said it was.",
        "images": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"{len(recs)} parts:  {n_us} US images, {n_jp} JP images, {n_man} manuals")
    thin = [r["sku"] for r in recs if len(r["images"]) < 2]
    if thin:
        print(f"\nfewer than 2 images ({len(thin)}): {', '.join(thin[:20])}")


if __name__ == "__main__":
    sys.exit(main())
