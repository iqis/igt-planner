#!/usr/bin/env python3
"""Crawl ec.snowpeak.co.jp and extract the Japanese spec table for every item.

The JP product page carries the authoritative engineering data that the US
Shopify storefront omits:

    メーカー品番   CK-903              -> SKU, the join key to every other region
    サイズ         846x496x28(h)mm     -> assembled bounding box
                   収納サイズ 764x86x106(h)mm  -> packed bounding box
    重量           3.5kg
    素材           アルミニウム合金、ステンレス鋼
    セット内容     連結フレーム(x2)、アルミレール(x2)
    カテゴリ       ギア > IGT&キッチン

Output is keyed by SKU so the US/UK/TW/KR catalogs can be joined onto it.
Covers the whole JP catalog, not just IGT -- the spec table is the same shape
for every product, and a full dimensional database is useful beyond this project.

Usage:
  python fetch_jp_specs.py                  # full crawl -> data/jp_specs_<ts>.json
  python fetch_jp_specs.py --limit 40       # smoke test
  python fetch_jp_specs.py --delay 0.6      # be gentler
"""

import argparse
import concurrent.futures as cf
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://ec.snowpeak.co.jp"
SITEMAP = f"{BASE}/sitemap_item/sitemap_item_0.xml"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

OUT = Path(__file__).resolve().parent.parent / "data"

# The spec table is a <dl class="definition-list-2cols"> of dt/dd pairs.
DL_RE = re.compile(r'<dl class="definition-list-2cols.*?</dl>', re.S)
DT_RE = re.compile(r"<dt.*?>(.*?)</dt>", re.S)
DD_RE = re.compile(r"<dd.*?>(.*?)</dd>", re.S)
TAG_RE = re.compile(r"<[^>]+>")

# "846×496×28(h)mm" / "846x496x28mm" / "φ100×250(h)mm"
DIM_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*\(?h?\)?\s*mm",
    re.I,
)
WEIGHT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|g)\b", re.I)


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))
    return ""


def clean(s):
    return re.sub(r"\s+", " ", TAG_RE.sub("", s)).replace("&gt;", ">").replace("&amp;", "&").strip()


def parse_specs(html):
    """Pull the dt/dd spec pairs out of a JP product page."""
    pairs = {}
    for dl in DL_RE.findall(html):
        for k, v in zip(DT_RE.findall(dl), DD_RE.findall(dl)):
            k, v = clean(k), clean(v)
            if k and v:
                pairs[k] = v
    return pairs


def parse_dims(size_text):
    """Split サイズ into assembled + packed boxes, both in mm.

    The field routinely packs two boxes into one string:
        "846×496×28(h)mm※収納サイズ：764×86×106(h)mm"
    Anything after 収納 is the packed size; before it, the assembled size.
    """
    if not size_text:
        return None, None
    idx = size_text.find("収納")
    head = size_text[:idx] if idx != -1 else size_text
    tail = size_text[idx:] if idx != -1 else ""

    def first_box(t):
        m = DIM_RE.search(t)
        if not m:
            return None
        # JP convention is W x D x H(h).
        return {"w": float(m.group(1)), "d": float(m.group(2)), "h": float(m.group(3))}

    return first_box(head), first_box(tail)


def parse_weight(w_text):
    """Return grams. '3.5kg' -> 3500, '250g' -> 250."""
    if not w_text:
        return None
    m = WEIGHT_RE.search(w_text)
    if not m:
        return None
    val = float(m.group(1))
    return round(val * 1000) if m.group(2).lower() == "kg" else round(val)


def record_for(url, html):
    specs = parse_specs(html)
    if not specs:
        return None

    sku = specs.get("メーカー品番", "")
    # "CK-903 (店舗でお問い合わせの際には、上記品番をお伝え下さい。)" -> "CK-903"
    m = re.match(r"([A-Z]{1,3}-?[0-9]{2,4}[A-Z0-9-]*)", sku)
    sku = m.group(1) if m else (sku.split()[0] if sku else "")

    title = ""
    tm = re.search(r"<title>(.*?)</title>", html, re.S)
    if tm:
        title = clean(tm.group(1)).split("|")[0].strip()

    size_text = specs.get("サイズ", "")
    assembled, packed = parse_dims(size_text)

    return {
        "sku": sku,
        "jp_title": title,
        "jp_url": url,
        "jp_category": specs.get("カテゴリ", ""),
        "assembled_mm": assembled,
        "packed_mm": packed,
        "size_raw": size_text,
        "weight_g": parse_weight(specs.get("重量", "")),
        "weight_raw": specs.get("重量", ""),
        "material": specs.get("素材", ""),
        "set_contents": specs.get("セット内容", ""),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N items (smoke test)")
    ap.add_argument("--delay", type=float, default=0.15, help="per-worker pause between requests")
    ap.add_argument("--workers", type=int, default=6, help="concurrent fetchers")
    args = ap.parse_args()

    urls = re.findall(r"<loc>([^<]+)</loc>", fetch(SITEMAP))
    urls = [u for u in urls if "/item/" in u]
    if args.limit:
        urls = urls[: args.limit]
    print(f"sitemap: {len(urls)} item pages, {args.workers} workers", flush=True)

    out, failed = [], []
    done = 0

    def work(u):
        # Pages are ~265KB each; serial fetching puts the whole-catalog crawl at
        # ~85min. A small pool keeps it under 15 without hammering the origin.
        time.sleep(args.delay)
        return u, record_for(u, fetch(u))

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for fut in cf.as_completed([ex.submit(work, u) for u in urls]):
            done += 1
            try:
                u, rec = fut.result()
                if rec and rec["sku"]:
                    out.append(rec)
            except Exception as e:  # noqa: BLE001 - crawl must survive a bad page
                failed.append({"error": str(e)})
            if done % 200 == 0:
                got = sum(1 for r in out if r.get("assembled_mm"))
                print(f"  {done}/{len(urls)}  parsed={len(out)}  with_dims={got}  "
                      f"failed={len(failed)}", flush=True)

    out.sort(key=lambda r: r["sku"])

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"jp_specs_{ts}.json"
    payload = {
        "source": BASE,
        "captured_at": ts,
        "count": len(out),
        "with_dims": sum(1 for r in out if r.get("assembled_mm")),
        "failed": failed,
        "items": out,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    # Stable pointer for downstream scripts; the timestamped file is the archive.
    (OUT / "jp_specs_latest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"\nwrote {path}\n  items={len(out)}  with_dims={payload['with_dims']}  failed={len(failed)}")


if __name__ == "__main__":
    sys.exit(main())
