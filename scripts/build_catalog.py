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
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOG = ROOT / "catalog"

# The US storefront suffixes some SKUs by region -- GS-450R-US is the JP GS-450R.
# Joining on the raw string drops the Flat Burner and everything like it.
REGION_SUFFIX_RE = re.compile(r"-(US|INT|EC)$", re.I)


def sku_keys(sku):
    """The SKU as written, then the region-stripped form, in join-preference order."""
    keys = [sku]
    base = REGION_SUFFIX_RE.sub("", sku)
    if base != sku:
        keys.append(base)
    return keys


# Titles are the only signal for some roles. Ordered: first match wins.
TITLE_RULES = [
    (r"\brails?\b", "rails"),
    # A corner turns the layout 90 degrees; it is a node in the layout graph, not a
    # part of any one frame. CK-118TR is 496mm square -- the frame's depth both ways.
    (r"corner|angle", "corner"),
    (r"extension|sliding", "extension"),
    (r"carrying case|\bcase\b", "case"),
    # NOT a leg modifier, despite the English name. The Japanese one is IGT段差ジョイント
    # -- 段差 is "level difference". It is a 320mm post that joins two tables standing at
    # DIFFERENT heights: standing-height cooking beside seated-height dining.
    (r"height adjuster", "joint"),
    (r"connection hook", "joint"),
    (r"leg set|\bleg\b", "leg"),
    (r"frame connector|connector", "connector"),
    (r"\bset\b", "set"),
    # The ^ anchor binds only to the first alternative: "^tta |...|unit frame" also
    # matches "IGT Three Unit Frame", which quietly filed every frame in the system
    # as a rail clamp. Anchor the TTA family explicitly instead.
    (r"^tta\b|windscreen|cylinder stand|cup holder|clamp tool", "rail_accessory"),
    (r"hanging rack|hanging shelf|box hanger|garbage frame", "hanger"),
    (r"entry igt|igt slim|shogi", "standalone"),
    (r"\bframe\b", "frame"),
]

# A slot module's span is stated in its own name more often than not.
SPAN_RE_HALF = re.compile(r"half[ -]?unit", re.I)
SPAN_RE_UNIT = re.compile(r"(\d)\s*unit", re.I)


# A foundation set IS its name: "IGT 3 Unit Sitting Set" is a 3-unit frame and the
# 660mm legs, and nothing else. That is deterministic, so it does not need prose --
# which is just as well, because CK-145's description names its frame and legs
# without linking either of them.
LEG_BY_HEIGHT = {"ground": "CK-109", "low": "CK-112", "sitting": "CK-113", "standing": "CK-114"}
FRAME_BY_UNITS = {3: "CK-149", 4: "CK-150"}
COLLAPSIBLE_FRAME_BY_UNITS = {2: "CK-902", 3: "CK-903", 4: "CK-904"}
FOUNDATION_RE = re.compile(
    r"igt\s+(\d)\s+unit\s+(ground|low|sitting|standing)\s+set", re.I)

# "The set includes X and Y" is contents. "Pair the set with Z" is an upsell. Both
# link products, so a flat list of links puts the BBQ box inside all six sets.
INCLUDE_VERBS = re.compile(r"\b(includes?|features?|comes with|consists of|contains?)\b", re.I)
SUGGEST_VERBS = re.compile(r"\b(pair|build upon|add|shop|combine|use with|integrat\w+)\b", re.I)
MARK_RE = re.compile(r"\[\[([a-z0-9-]+)\]\]", re.I)


def set_contents(title, marked_desc, handle_to_sku):
    """(skus, source, evidence) for a bundle."""
    m = FOUNDATION_RE.search(title)
    if m:
        units, height = int(m.group(1)), m.group(2).lower()
        collapsible = "collapsible" in title.lower()
        frame = (COLLAPSIBLE_FRAME_BY_UNITS if collapsible else FRAME_BY_UNITS).get(units)
        leg = LEG_BY_HEIGHT[height]
        got = [s for s in (frame, leg) if s]
        if got:
            return sorted(got), "name-derived", f"{units}-unit frame + {height} legs, from the set name"

    # Otherwise: links, but only those inside a sentence that claims inclusion. A
    # composite set spreads its contents over several sentences -- "The set features
    # the IGT 4 Unit Standing Set... The set ALSO INCLUDES two Stainless Half Box" --
    # so stopping at the first hit understates the parts and makes the bundle look
    # more expensive than buying the pieces.
    out, evidence = [], []
    for sentence in re.split(r"(?<=[.!?])\s+", marked_desc or ""):
        if SUGGEST_VERBS.search(sentence) or not INCLUDE_VERBS.search(sentence):
            continue
        hits = [handle_to_sku[h] for h in MARK_RE.findall(sentence) if h in handle_to_sku]
        if hits:
            out.extend(hits)
            evidence.append(sentence.strip())
    if out:
        return sorted(set(out)), "us-description-includes", " ".join(evidence)[:300]
    return None, None, None


# Systems that live in an IGT collection without being IGT parts. Snow Peak's own
# taxonomy is porous in BOTH directions: the US files Takibi grill plates under
# `cookers`, and the JP files the TUGUCA wooden shelving line under IGT&キッチン.
# Neither can enter a unit slot.
FOREIGN_SYSTEMS = re.compile(r"TUGUCA", re.I)


def region_prices(sku, price_usd, regions):
    """Minor units per region. UK and JP are joined on SKU; TW/KR are absent because
    their SPA rows carry no SKU to join on."""
    out = {"us": int(round(price_usd * 100)) if price_usd else None, "jp": None, "uk": None}
    for key in sku_keys(sku):
        out["jp"] = out["jp"] or regions.get("jp", {}).get(key)
        out["uk"] = out["uk"] or regions.get("uk", {}).get(key)
    return out


def load(name):
    p = DATA / name
    if not p.exists():
        sys.exit(f"missing {p} -- run the fetch scripts first")
    return json.loads(p.read_text(encoding="utf-8"))


UNITS_RE = re.compile(r"\b(one|two|three|four|\d)\s+unit\b", re.I)


def infer_units(title):
    """Frames only: how many unit slots does it offer.

    The frames spell the count out -- "IGT Four Unit Frame" -- while the modules use
    digits ("1 Unit"). A digits-only pattern silently leaves every frame with no
    unit count, which is the one field the whole grid hangs off.
    """
    m = UNITS_RE.search(title)
    if not m:
        return None
    tok = m.group(1).lower()
    return WORD_UNITS.get(tok) or int(tok)


# Every IGT module is ~356-410mm deep, because that is the span between the two
# long rails it bridges. The frame has no internal dividers: a "unit" is a 250mm
# notion along the run, not a compartment. So the along-rail axis is simply the
# one that is neither the rail span nor the height.
RAIL_SPAN_MM = (330.0, 420.0)


def along_rail_mm(box):
    """The dimension that runs along the frame, in mm.

    The JP spec table writes a product's dimensions in its own orientation, longest
    first -- so the along-rail axis is not always listed first:

        CK-225  1 Unit      245 x 356      along-rail first
        CK-226  Half Unit   356 x 120      along-rail SECOND; 120 is the half unit

    Reading position 0 as "width" turns a 120mm half-unit tray into a 356mm one.
    Identify the axis by elimination instead: drop the one that looks like the rail
    span, and take the smaller of what is left (height is usually the smallest, but
    the (h) marker already put it in `h`).
    """
    if not box:
        return None
    w, d = box.get("w"), box.get("d")
    w_is_rail = w and RAIL_SPAN_MM[0] <= w <= RAIL_SPAN_MM[1]
    d_is_rail = d and RAIL_SPAN_MM[0] <= d <= RAIL_SPAN_MM[1]
    if d_is_rail and not w_is_rail:
        return w
    if w_is_rail and not d_is_rail:
        return d
    # Both or neither look like the rail span (full-frame tops, oddballs): the
    # along-rail axis is the longer one for a top that covers the frame.
    return w


WORD_UNITS = {"single": 1, "one": 1, "double": 2, "two": 2, "three": 3, "four": 4}

# Snow Peak states the unit count in the copy when the name omits it -- but only
# when it modifies the product's OWN noun. "Pair the Bamboo Table Long with the IGT
# Four Unit Frame" describes the frame, not the table, and reading "four unit" out
# of that sentence would give the table a span of 8.
DESC_SPAN_RE = re.compile(
    r"\b(single|double|half|one|two|three|four)[- ]unit\s+(?:\w+\s+){0,2}?"
    r"(insert|box|tray|size|burner|stove|grill|plate|griddle|shelf)\b",
    re.I,
)


def span_from_label(title, description):
    """Resolve span in half-units. Returns (span, source, evidence).

    Millimetres cannot decide this, and the catalog proves it in both directions:

        CK-225  "1 Unit"    245mm wide  -- 5mm NARROWER than its 250mm unit (drops in)
        GS-450R Flat Burner 270mm wide  -- 20mm WIDER than a unit; its rim rests on
                                           the rails, the way a drop-in cooktop does

    A module can be smaller *or* larger than the space it claims, so no inequality on
    width recovers the claim. Sources, most authoritative first:

      title       "1 Unit" / "Half Unit" in the product name
      description "The single-unit insert...", anchored to the product's own noun
      mm-exact    the along-rail dimension is an exact multiple of 125mm; unambiguous
                  because a part cannot land on the grid by accident
      (none)      left unknown and reported, rather than guessed
    """
    if SPAN_RE_HALF.search(title):
        return 1, "title", title.strip()
    m = SPAN_RE_UNIT.search(title)
    if m:
        return int(m.group(1)) * 2, "title", title.strip()

    m = DESC_SPAN_RE.search(description or "")
    if m:
        word = m.group(1).lower()
        span = 1 if word == "half" else WORD_UNITS[word] * 2
        return span, "description", m.group(0)

    return None, None, None


def span_from_mm(box):
    """Fallback: an exact multiple of the half-unit is not a coincidence."""
    ar = along_rail_mm(box)
    if not ar:
        return None, None
    if abs(ar % 125.0) < 0.5:
        return int(round(ar / 125.0)), f"{ar:.0f}mm = {ar/125:.0f} x 125mm"
    return None, None


# A top that spans the whole frame is not a slot module: its width equals the
# frame's OUTER width (846 / 1096), overhead included, because it rests on the
# frame rather than dropping between the rails.
FRAME_OUTER_MM = {596.0, 846.0, 1096.0}


def classify(us, jp, pitch):
    title = (us.get("us_title") or "").lower()
    colls = set(us.get("collections", []))
    box = jp.get("assembled_mm") if jp else None

    for pat, role in TITLE_RULES:
        if re.search(pat, title):
            return role

    if box and box.get("w") in FRAME_OUTER_MM and "table" in title:
        return "full_top"

    # Snow Peak's functional buckets, but only for real IGT members.
    if colls & {"cookers", "surfaces"} or "tray" in title or "box" in title:
        return "slot_module"
    if "storage" in colls and "iron-grill-table" in colls:
        return "slot_module"

    span, _, _ = span_from_label(title, us.get("description", ""))
    if span:
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
    # Components are linked by handle; the whole US catalog is the lookup, since a
    # set can include a part that is not itself in the IGT collection.
    handle_to_sku = {r["handle"]: r["sku"] for r in us["items"] if r.get("sku")}

    reg_path = DATA / "regions_latest.json"
    regions = json.loads(reg_path.read_text(encoding="utf-8")) if reg_path.exists() else {"jp": {}, "uk": {}}

    parts, unmatched = [], []
    for u in igt:
        sku = u["sku"]
        j = next((jp_by_sku[k] for k in sku_keys(sku) if k in jp_by_sku), {})
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
            "price": region_prices(sku, u.get("price_usd"), regions),
            "available": {"us": u.get("available", False)},
            "image": (u.get("images") or [None])[0],
            "images_jp": j.get("images") or [],
            "manuals": j.get("manuals") or [],   # the only source of assembly/clearance rules
            "url": {"us": u["us_url"], "jp": j.get("jp_url")},
        }

        if role == "frame":
            rec["units"] = infer_units(title)
        elif role == "full_top":
            # A regular top (846) leaves exactly one unit exposed on a 4-unit frame:
            # 1096 - 846 = 250. That is the classic "bamboo table + burner" setup.
            rec["covers_units"] = int(((asm or {}).get("w", 0) - 96) / 250) or None
        elif role == "slot_module":
            span, src, ev = span_from_label(title, u.get("description", ""))
            if span is None:
                span, ev = span_from_mm(asm)
                src = "mm-exact" if span else None
            rec["span"] = span
            rec["span_source"] = src        # title > description > mm-exact; None = unknown
            rec["span_evidence"] = ev       # the exact phrase or measurement it came from

            # Width never decides span, but it should not contradict it either.
            ar = along_rail_mm(asm)
            if span and ar:
                rec["along_rail_mm"] = ar
                rec["fit_delta_mm"] = round(ar - span * 125.0, 1)  # <0 drops in, >0 rim on rails
        elif role == "leg":
            m = re.search(r"(\d{3})\s*mm", title)
            rec["height_mm"] = int(m.group(1)) if m else None

        # How a bundle decomposes, best source first.
        contents = j.get("set_contents", "")
        skus_in = re.findall(r"\b([A-Z]{2,3}-\d{3}[A-Z0-9-]*)\b", contents)
        if skus_in:
            rec["contains"] = sorted(set(skus_in))
            rec["contains_source"] = "jp-set-contents"
            rec["contains_evidence"] = contents
        elif role == "set":
            got, src, ev = set_contents(title, u.get("description_marked", ""), handle_to_sku)
            if got:
                rec["contains"] = got
                rec["contains_source"] = src
                rec["contains_evidence"] = ev

        parts.append(rec)

    # Neither region is a superset. The US has 83 IGT products (Renewed/TR lines,
    # US-only sets); the JP category has 70, of which 20 exist nowhere in the US.
    # Taking either storefront as "the" catalog silently drops real parts, so the
    # universe is the union -- minus the systems that are only filed here by accident.
    seen = {p["sku"] for p in parts}
    jp_only = 0
    for j in jp["items"]:
        sku = j.get("sku")
        if not sku or sku in seen or "IGT" not in j.get("jp_category", ""):
            continue
        if FOREIGN_SYSTEMS.search(j.get("jp_title", "")):
            continue
        parts.append({
            "sku": sku,
            "handle": None,
            "title_en": j.get("jp_title", ""),   # no English name exists for these
            "title_jp": j.get("jp_title", ""),
            "barcode": "",
            "role": "set" if re.match(r"(FK|SET)-", sku) else "accessory",
            "collections": [],
            "region_exclusive": "jp",
            "assembled_mm": j.get("assembled_mm"),
            "packed_mm": j.get("packed_mm"),
            "weight_g": j.get("weight_g"),
            "material": j.get("material", ""),
            "price": region_prices(sku, None, regions),
            "available": {},
            "image": None,
            "url": {"us": None, "jp": j.get("jp_url")},
        })
        seen.add(sku)
        jp_only += 1

    # The rest of the Layout System. These are full tables, not IGT parts, and none of
    # them sits in an IGT collection -- but the vendor's copy says they connect to a
    # frame, and their dimensions agree: they all stand 400mm tall (the IGT Low leg is
    # 400mm) and the shallow ones are 496mm deep (the frame's depth).
    lay_path = CATALOG / "layout.json"
    layout = json.loads(lay_path.read_text(encoding="utf-8")) if lay_path.exists() else {}
    us_by_sku = {r["sku"]: r for r in us["items"] if r.get("sku")}

    # layout.json is the AUTHORITY for these roles, not a supplement to the title rules.
    # Otherwise LV-310 stays an "accessory" because it happens to sit in an IGT
    # collection, and CK-175 stays one because its title is in Japanese.
    by_sku = {p["sku"]: p for p in parts}
    for sku in (layout.get("joints") or {}):
        if sku in by_sku:
            by_sku[sku]["role"] = "joint"
    for sku in (layout.get("corners") or {}):
        if sku in by_sku:
            by_sku[sku]["role"] = "corner"
    for sku, t in (layout.get("tables") or {}).items():
        if sku in by_sku:
            p = by_sku[sku]
            p["role"] = "layout_table"
            p["height_mm"] = (t.get("size_mm") or {}).get("h") or p.get("height_mm")
            p["connects_to"] = t.get("connects_to", [])
            p["requires_connector"] = t.get("requires_connector")
            p["evidence"] = t.get("evidence")
            if t.get("excluded"):
                p["excluded"] = True
                p["excluded_reason"] = t.get("excluded_reason")

    for sku, t in (layout.get("tables") or {}).items():
        if sku in by_sku:
            continue
        u = us_by_sku.get(sku)
        j = next((jp_by_sku[k] for k in sku_keys(sku) if k in jp_by_sku), {})
        parts.append({
            "sku": sku,
            "handle": t.get("handle"),
            "title_en": t["name"],
            "title_jp": j.get("jp_title", ""),
            "role": "layout_table",
            "collections": [],
            "assembled_mm": j.get("assembled_mm") or (
                {"w": t["size_mm"]["w"], "d": t["size_mm"]["d"], "h": t["size_mm"]["h"]}
                if t.get("size_mm") else None),
            "packed_mm": j.get("packed_mm"),
            "weight_g": j.get("weight_g"),
            "material": j.get("material", ""),
            "height_mm": (t.get("size_mm") or {}).get("h"),
            "connects_to": t.get("connects_to", []),
            "requires_leg": t.get("requires_leg"),
            "requires_connector": t.get("requires_connector"),
            "evidence": t.get("evidence"),
            "price": region_prices(sku, (u or {}).get("price_usd"), regions),
            "available": {"us": (u or {}).get("available", False)},
            "image": ((u or {}).get("images") or [None])[0],
            "url": {"us": (u or {}).get("us_url"), "jp": j.get("jp_url")},
            **({"excluded": True, "excluded_reason": t.get("excluded_reason")}
               if t.get("excluded") else {}),
        })

    # TTA is its own ecosystem. It clamps to ANY table edge -- IGT frame, bamboo
    # extension, Takibi table, a table Snow Peak did not make -- and consumes no unit.
    # Filing it as an "IGT rail accessory" quietly asserted a dependency that is not there.
    tta = (layout.get("ecosystems") or {}).get("tta") or {}
    for sku in tta.get("members", []):
        if sku in by_sku:
            by_sku[sku]["system"] = "tta"
            by_sku[sku]["role"] = "edge_clamp"
            by_sku[sku]["attaches_to"] = tta.get("attaches_to")

    # How each part ATTACHES. This is not derivable from a name or a dimension, and
    # trying was the mistake: the Bamboo IGT Table is 846x496 -- exactly a 3-unit frame's
    # footprint -- so "a lid covering the frame" and "a table the same size as the frame,
    # standing beside it" fit the numbers equally well. Only the copy settles it, and the
    # copy says it hooks onto the frame's edge and takes its own legs. It is a table.
    att_path = CATALOG / "attachments_mined.json"
    attach = (json.loads(att_path.read_text(encoding="utf-8"))["attachments"]
              if att_path.exists() else {})
    for p in parts:
        a = attach.get(p["sku"])
        if not a:
            # Definitional, not a guess: a slot module is a thing that goes in a slot.
            # The copy not restating it for every burner is not a gap in what we know.
            if p["role"] == "slot_module":
                p["attach"] = "slot_in"
            continue
        p["attach"] = a["attach"]
        p["needs_legs"] = a["needs_legs"]
        p["attach_evidence"] = a["evidence"]
        # A part that hooks onto the frame's edge and stands on its own legs is a table
        # in the layout, not a surface belonging to the frame. `full_top` was a role I
        # invented to explain a dimension, and it never existed.
        if a["attach"] == "hook_on" and p["role"] in ("full_top", "extension", "corner"):
            p["role"] = "corner" if p["role"] == "corner" else "extension_table"

    # Curated corrections come last, and say who made them and why.
    ov_path = CATALOG / "overrides.json"
    overrides = json.loads(ov_path.read_text(encoding="utf-8")) if ov_path.exists() else {}

    # Parts that exist and that no sweep can reach. The rail joint (XCK-128-01) is filed
    # under SPARE PARTS -- it is in none of the six IGT collections and its JP category is
    # not IGT, so both halves of the universe miss it. It took reading a manual to find out
    # it exists, and it unlocks the frame's entire long side. A catalog built only from
    # what the taxonomy hands you has holes exactly where the taxonomy has them.
    known = {p["sku"] for p in parts}
    for sku, add in (overrides.get("_add") or {}).items():
        if sku in known:
            continue
        j = jp_by_sku.get(sku, {})
        parts.append({
            "sku": sku,
            "handle": None,
            "title_en": add.get("title_en") or j.get("jp_title", ""),
            "title_jp": j.get("jp_title", ""),
            "barcode": "",
            "role": add.get("role", "accessory"),
            "collections": [],
            "region_exclusive": "jp",
            "assembled_mm": j.get("assembled_mm"),
            "packed_mm": j.get("packed_mm"),
            "weight_g": j.get("weight_g"),
            "material": j.get("material", ""),
            "price": region_prices(sku, None, regions),
            "available": {},
            "image": None,
            "url": {"us": None, "jp": j.get("jp_url")},
            "curated_reason": add.get("reason"),
        })

    applied = 0
    for rec in parts:
        for key in sku_keys(rec["sku"]):
            ov = overrides.get(key)
            if not isinstance(ov, dict):
                continue
            if "role" in ov:
                rec["role"] = ov["role"]
            if ov.get("excluded"):
                # Exclude is not delete. The Takibi Garden tables and the Garden Unit Table
                # are real Snow Peak products; they are just not part of a system you carry
                # to a campsite -- they are fixed garden furniture, assembled in place. So
                # they stay in the catalog, flagged, with the reason written down, and the
                # planner leaves them out. Pretending a real part does not exist is the same
                # error as inventing one, run backwards.
                rec["excluded"] = True
                rec["excluded_reason"] = ov.get("reason")
            if "attach" in ov:
                rec["attach"] = ov["attach"]
                rec["attach_evidence"] = ov.get("reason")
            # Relationship fields, curated with evidence. `mounts` = what this carries;
            # `mounted_by` = what carries this; `attaches_to` = the surfaces it will go on.
            for rel in ("mounts", "mounted_by", "attaches_to", "needs_legs",
                        "one_per_frame", "tiers", "has_surface", "mounts_over"):
                if rel in ov:
                    rec[rel] = ov[rel]
            # CK-220's assembled size is derived (only the packed size is published), so say
            # so on the record rather than let it read as measured.
            if "assembled_mm" in ov and rec.get("assembled_mm") and not rec.get("packed_mm"):
                pass
            if ov.get("assembled_mm") and rec["sku"] == "CK-220":
                rec["assembled_estimated"] = True
            if "weight_g" in ov:
                rec["published_weight_g"] = rec.get("weight_g")
                rec["weight_g"] = ov["weight_g"]
            if "assembled_mm" in ov:
                # THE PLAN VIEW WINS. It is the only orthographic, in-system, checkable
                # record of a part's shape, and where it disagrees with the spec table the
                # spec table is what gets corrected. `published_mm` keeps the vendor's
                # number visible so the disagreement stays on the record instead of being
                # quietly overwritten.
                rec["published_mm"] = rec.get("assembled_mm")
                rec["assembled_mm"] = ov["assembled_mm"]
            if "span" in ov:
                rec["span"] = ov["span"]
                rec["span_source"] = "curated" if ov["span"] else None
                rec["span_evidence"] = ov.get("reason")
                if rec["span"]:
                    ar = along_rail_mm(rec.get("assembled_mm"))
                    if ar:
                        rec["fit_delta_mm"] = round(ar - rec["span"] * 125.0, 1)
            if "system" in ov:
                rec["system"] = ov["system"]
            rec["curated_reason"] = ov.get("reason")
            applied += 1
            break

    # The manuals. Snow Peak documents assembly in exactly one place and it is not the shop
    # page: `対応品番` is an explicit whitelist and it says so ("そのほかの製品には対応して
    # おりません" -- nothing else is supported), `非対応品番` is a blacklist with a reason
    # against each entry, and the load limit is a number. All of it is harder than anything
    # the marketing copy gives us, and all of it was one link away the whole time.
    man_path = CATALOG / "manuals.json"
    manuals = (json.loads(man_path.read_text(encoding="utf-8"))["manuals"]
               if man_path.exists() else {})
    for rec in parts:
        m = manuals.get(rec["sku"])
        if not m:
            continue
        rec["manual"] = m.get("url")
        for k in ("compatible_with", "incompatible_with", "max_load_kg", "set_contents"):
            if m.get(k):
                rec[f"manual_{k}"] = m[k]

    parts.sort(key=lambda r: (r["role"], r["sku"]))

    payload = {
        "generated_from": {
            "us": us["captured_at"],
            "jp": jp["captured_at"],
        },
        "grid": grid,
        "layout": layout,      # the Layout System: datum height, shared depth, joints
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

    print(f"parts: {len(parts)}   unit pitch: {pitch}mm  (half = {pitch/2}mm)")
    for r, n in roles.most_common():
        print(f"  {n:3d}  {r}")
    print(f"\nno JP spec match: {len(unmatched)}  {unmatched[:8]}")
    print(f"no dimensions:    {len(no_dims)}  {no_dims[:8]}")

    # Every span must be traceable to who said it. The fit delta is the cross-check:
    # negative = the module drops between the rails, positive = its rim rests on them.
    # Either is fine; what would not be fine is a delta of half a unit.
    mods = [p for p in parts if p["role"] == "slot_module"]
    src = C.Counter(p.get("span_source") or "UNKNOWN" for p in mods)
    print(f"\nslot modules: {len(mods)}   span source: "
          + "  ".join(f"{k}={v}" for k, v in src.most_common()))

    print("\n  span  fit    source       part")
    for p in sorted(mods, key=lambda p: (p.get("span") or 99, p["sku"])):
        d = p.get("fit_delta_mm")
        fit = f"{d:+5.0f}" if d is not None else "   . "
        sp = str(p.get("span") or "?")
        print(f"    {sp:>2s} {fit}  {(p.get('span_source') or 'unknown'):11s}  "
              f"{p['sku']:10s} {p['title_en'][:30]}")

    unknown = [p for p in mods if not p.get("span")]
    if unknown:
        print(f"\n  UNRESOLVED span ({len(unknown)}) -- needs a human or a manual PDF:")
        for p in unknown:
            ar = along_rail_mm(p.get("assembled_mm"))
            hint = f"along-rail {ar:.0f}mm = {ar/125:.2f} half-units" if ar else "no dimensions"
            print(f"    {p['sku']:10s} {p['title_en'][:32]:34s} {hint}")

    print(f"\nwrote {CATALOG / 'igt-catalog.json'}")


if __name__ == "__main__":
    sys.exit(main())
