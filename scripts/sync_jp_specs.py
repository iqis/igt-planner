#!/usr/bin/env python3
"""Build jp_specs_latest.json from the snowpeak-sale-watch daily snapshot.

snowpeak-sale-watch already crawls all ~2,100 JP product pages every day for price
and stock. It was throwing the spec table away; it now keeps it (`specs` on each raw
row). So the dimensional data this project runs on is a *parse*, not a crawl -- no
network, no second pass over someone else's servers, and it refreshes daily for free.

`fetch_jp_specs.py` remains as the bootstrap crawler for the case where the newest
snapshot predates that change. It should not be needed again.

Usage:
  python sync_jp_specs.py      # -> data/jp_specs_latest.json
"""

import glob
import gzip
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_jp_specs import parse_dims, parse_weight  # noqa: E402  (shared interpreters)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"
SNAPSHOTS = Path(os.environ.get(
    "IGT_JP_SNAPSHOTS",
    "V:/projects/tools/snowpeak-sale-watch/data/catalog-history/jp",
))


def main():
    snaps = sorted(glob.glob(str(SNAPSHOTS / "raw_*.json.gz")))
    if not snaps:
        sys.exit(f"no JP snapshots under {SNAPSHOTS}")

    latest = snaps[-1]
    payload = json.loads(gzip.open(latest).read().decode("utf-8"))
    rows = payload.get("raw") or []

    if not any(r.get("specs") for r in rows):
        sys.exit(
            f"{Path(latest).name} has no `specs` -- it predates the snapshot_regions.py\n"
            "change that keeps the JP spec table. Either wait for tonight's snapshot or\n"
            "bootstrap once with:  py scripts/fetch_jp_specs.py"
        )

    items = []
    for r in rows:
        specs = r.get("specs") or {}
        sku = r.get("sku") or ""
        if not sku:
            m = re.match(r"([A-Z]{1,3}-?[0-9]{2,4}[A-Z0-9-]*)", specs.get("メーカー品番", ""))
            sku = m.group(1) if m else ""
        if not sku:
            continue

        size_raw = specs.get("サイズ", "")
        assembled, packed = parse_dims(size_raw)
        items.append({
            "sku": sku,
            "jp_title": (r.get("ld") or {}).get("name", "") or r.get("handle", ""),
            "jp_url": r.get("url", ""),
            "jp_category": specs.get("カテゴリ", ""),
            "assembled_mm": assembled,
            "packed_mm": packed,
            "size_raw": size_raw,
            "weight_g": parse_weight(specs.get("重量", "")),
            "weight_raw": specs.get("重量", ""),
            "material": specs.get("素材", ""),
            "set_contents": specs.get("セット内容", ""),
            "price_jpy": r.get("html_price"),
            "images": r.get("images") or [],
            # Every product links its manual PDF. That is the only place Snow Peak
            # documents assembly and compatibility -- heat clearances, what may sit
            # beside a burner, and very likely GP-040's unit count. Carried through
            # so those open questions have somewhere to go.
            "manuals": r.get("manuals") or [],
            "related": r.get("related") or [],
        })

    items.sort(key=lambda r: r["sku"])
    out = {
        "source": f"snowpeak-sale-watch snapshot {Path(latest).name}",
        "captured_at": payload.get("captured_at", ""),
        "count": len(items),
        "with_dims": sum(1 for r in items if r["assembled_mm"]),
        "failed": [],
        "items": items,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "jp_specs_latest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"from {Path(latest).name}: {len(items)} items, {out['with_dims']} with dimensions")
    print("wrote data/jp_specs_latest.json  (no network)")


if __name__ == "__main__":
    sys.exit(main())
