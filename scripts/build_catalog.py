#!/usr/bin/env python3
"""Join US storefront + JP spec table into the IGT knowledge base.

    us_products_latest.json   handles, SKU, USD price, stock, images, collections
    jp_specs_latest.json      mm dimensions, packed size, weight, material, set contents
                              -> joined on SKU (CK-149 etc.), which both sides carry

and then assigns each part a `role` (see SCHEMA.md), because Snow Peak's own five
collections do not cover 31 of the 83 IGT products and its `storage` collection is
a general one that also holds buckets and coolers.

Role evidence, in order of trust:
  1. measured width vs the derived unit pitch  -- a module cannot lie about its size
  2. explicit title markers ("1 Unit", "Half Unit", "Rails", "Carrying Case")
  3. Snow Peak collection membership

Usage:
  python build_catalog.py     # -> catalog/igt-catalog.json
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOG = ROOT / "catalog"

# Titles are the only signal for some roles. Ordered: first match wins.
TITLE_RULES = [
    (r"\brails?\b", "rails"),
    (r"carrying case|\bcase\b", "case"),
    (r"height adjuster", "height_adjuster"),
    (r"leg set|\bleg\b", "leg"),
    (r"frame connector|connector", "connector"),
    (r"\bset\b", "set"),
    (r"^tta |hanger|windscreen|cylinder stand|cup holder|clamp tool|unit frame", "rail_accessory"),
    (r"hanging rack|hanging shelf|box hanger|garbage frame", "hanger"),
    (r"entry igt|igt slim|shogi", "standalone"),
    (r"\bframe\b", "frame"),
]

# A slot module's span is stated in its own name more often than not.
SPAN_RE_HALF = re.compile(r"half[ -]?unit", re.I)
SPAN_RE_UNIT = re.compile(r"(\d)\s*unit", re.I)


def load(name):
    p = DATA / name
    if not p.exists():
        sys.exit(f"missing {p} -- run the fetch scripts first")
    return json.loads(p.read_text(encoding="utf-8"))


def infer_units(title):
    """Frames only: how many unit slots does it offer."""
    m = SPAN_RE_UNIT.search(title)
    return int(m.group(1)) if m else None


def infer_span(title, width_mm, pitch):
    """Slot modules: width in HALF-units.

    The name usually says so. When it does not, the measured width does: a module
    must fit its slots, so span = round(width / half_pitch). We only trust the
    measurement when it lands close to a half-unit boundary; otherwise the part
    probably is not a slot module at all and we return None rather than guess.
    """
    if SPAN_RE_HALF.search(title):
        return 1
    m = SPAN_RE_UNIT.search(title)
    if m:
        return int(m.group(1)) * 2

    if not width_mm or not pitch:
        return None
    half = pitch / 2
    raw = width_mm / half
    span = round(raw)
    if span >= 1 and abs(raw - span) < 0.18:  # within ~18% of a clean half-unit
        return span
    return None


def classify(us, jp, pitch):
    title = (us.get("us_title") or "").lower()
    colls = set(us.get("collections", []))

    for pat, role in TITLE_RULES:
        if re.search(pat, title):
            return role

    # Snow Peak's functional buckets, but only for real IGT members.
    if colls & {"cookers", "surfaces"} or "tray" in title or "box" in title:
        return "slot_module"
    if "storage" in colls and "iron-grill-table" in colls:
        return "slot_module"

    # Last resort: does it measure like something that fits a slot?
    w = (jp.get("assembled_mm") or {}).get("w") if jp else None
    if infer_span(title, w, pitch):
        return "slot_module"
    return "accessory"


def main():
    us = load("us_products_latest.json")
    jp = load("jp_specs_latest.json")

    grid_path = CATALOG / "grid.json"
    if not grid_path.exists():
        sys.exit("missing catalog/grid.json -- run derive_grid.py first")
    grid = json.loads(grid_path.read_text(encoding="utf-8"))
    pitch = grid["unit_pitch_mm"]

    jp_by_sku = {r["sku"]: r for r in jp["items"] if r.get("sku")}

    # Only true IGT members. The `storage` collection alone would drag in 24
    # buckets and coolers that can never enter a unit slot.
    igt = [r for r in us["items"] if "iron-grill-table" in r["collections"]]

    parts, unmatched = [], []
    for u in igt:
        sku = u["sku"]
        j = jp_by_sku.get(sku, {})
        if not j:
            unmatched.append(sku)

        asm = j.get("assembled_mm")
        role = classify(u, j, pitch)
        title = u["us_title"]

        rec = {
            "sku": sku,
            "handle": u["handle"],
            "title_en": title,
            "title_jp": j.get("jp_title", ""),
            "barcode": u.get("barcode", ""),
            "role": role,
            "collections": u["collections"],
            "assembled_mm": asm,
            "packed_mm": j.get("packed_mm"),
            "weight_g": j.get("weight_g"),
            "material": j.get("material", ""),
            "price": {
                "us": int(round(u["price_usd"] * 100)) if u.get("price_usd") else None,
            },
            "available": {"us": u.get("available", False)},
            "image": (u.get("images") or [None])[0],
            "url": {"us": u["us_url"], "jp": j.get("jp_url")},
        }

        if role == "frame":
            rec["units"] = infer_units(title)
        elif role == "slot_module":
            rec["span"] = infer_span(title, (asm or {}).get("w"), pitch)
        elif role == "leg":
            m = re.search(r"(\d{3})\s*mm", title)
            rec["height_mm"] = int(m.group(1)) if m else None

        # Sets list their components by SKU in the JP セット内容 field.
        contents = j.get("set_contents", "")
        skus_in = re.findall(r"\b([A-Z]{2}-\d{3}[A-Z0-9-]*)\b", contents)
        if skus_in:
            rec["contains"] = sorted(set(skus_in))

        parts.append(rec)

    parts.sort(key=lambda r: (r["role"], r["sku"]))

    payload = {
        "generated_from": {
            "us": us["captured_at"],
            "jp": jp["captured_at"],
        },
        "grid": grid,
        "count": len(parts),
        "unmatched_sku": unmatched,
        "parts": parts,
    }
    CATALOG.mkdir(parents=True, exist_ok=True)
    (CATALOG / "igt-catalog.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    # Report: the parts that matter most are the ones we could not measure.
    import collections as C
    roles = C.Counter(p["role"] for p in parts)
    no_dims = [p["sku"] for p in parts if not p["assembled_mm"]]

    print(f"parts: {len(parts)}   unit pitch: {pitch}mm")
    for r, n in roles.most_common():
        print(f"  {n:3d}  {r}")
    print(f"\nno JP spec match: {len(unmatched)}  {unmatched[:8]}")
    print(f"no dimensions:    {len(no_dims)}  {no_dims[:8]}")
    print(f"\nwrote {CATALOG / 'igt-catalog.json'}")


if __name__ == "__main__":
    sys.exit(main())
