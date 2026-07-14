#!/usr/bin/env python3
"""How does each part actually attach? Mine the product copy, and admit what it doesn't say.

Roles were being inferred from names and dimensions, and that gets attachment wrong,
because attachment is not in either. The Bamboo IGT Table is 846x496 -- exactly a 3-unit
frame's footprint -- so "a top that covers the frame" and "a table the same size as the
frame, standing beside it" fit the numbers equally well. Only the copy disambiguates:

    "Use it to EXTEND your Iron Grill Table ... attached to the IGT Frame or other
     extension with the already-attached connection hooks ... and add legs to stabilise."

It is a table. It hangs off the frame's edge on hooks and stands on its own legs. Reading
that off the dimensions was never possible.

So: mine the verbs, quote the sentence, and leave `unknown` where the copy is silent
rather than inventing a mechanism.

Usage:
  python mine_attachments.py            # -> catalog/attachments_mined.json + a review table
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOG = ROOT / "catalog"

# Each mechanism, with the phrases Snow Peak actually uses for it. Order matters: the
# more specific mechanism wins, because several sentences mention the frame.
MECHANISMS = [
    ("slide_in", [
        r"slips? into the ridges",
        r"slid(?:es|ing) into the (?:outer|outside)",
    ], "Slides into the ridges along the OUTSIDE of the frame rails. Needs no hook."),

    ("hook_on", [
        r"connection hooks?",
        r"attach(?:ed)? to the igt frame",
        r"use it to extend (?:your|the) iron grill table",
        r"extend the table 90 degrees",
    ], "Hangs off the frame's edge on connection hooks, extending the layout. Usually "
       "needs its own legs -- it is a table, not a lid."),

    ("slot_in", [
        r"fits? (?:easily )?into (?:three|four|\d)[- ]unit frames?",
        r"insert(?:s)? (?:easily )?into",
        r"within the (?:iron grill table|igt)",
        r"single-unit insert|double-unit insert|half-unit",
    ], "Drops into the unit slots, between the two rails."),

    ("rail_clamp", [
        r"clamps? (?:on|to)",
        r"^tta\b",
        r"table top architect",
    ], "Clamps onto a rail. Consumes no slot."),

    ("hang", [
        r"hang(?:s|ing)? (?:from|off|on|below)",
        r"hanging (?:rack|shelf)",
    ], "Hangs off an edge, below the surface."),

    ("step_joint", [
        r"different table heights",
        r"slide into the edge of the igt frame",
    ], "Joins two touching tables standing at DIFFERENT heights."),

    ("inline", [
        r"insertion of an igt .* frame within the length",
    ], "Drops a frame INTO the length of another table."),

    ("standalone", [
        r"does not require any connection tools",
        r"aluminum alloy stand",
    ], "A table in its own right; joins the layout as a node."),
]

NEEDS_LEGS = re.compile(r"add legs|legs? (?:are )?not included|leg set", re.I)


def classify(text):
    t = (text or "").lower()
    for name, pats, note in MECHANISMS:
        for pat in pats:
            m = re.search(pat, t)
            if m:
                # Quote the sentence it was found in -- a mechanism with no evidence is
                # just a guess wearing a label.
                start = t.rfind(".", 0, m.start()) + 1
                end = t.find(".", m.end())
                sent = (text[start:end + 1] if end != -1 else text[start:]).strip()
                return name, note, sent[:200]
    return None, None, None


def main():
    cat = json.loads((CATALOG / "igt-catalog.json").read_text(encoding="utf-8"))
    us = json.loads((DATA / "us_products_latest.json").read_text(encoding="utf-8"))
    desc = {r["sku"]: r.get("description", "") for r in us["items"] if r.get("sku")}

    out, unknown = {}, []
    for p in cat["parts"]:
        d = desc.get(p["sku"], "")
        mech, note, ev = classify(d)
        if not mech:
            unknown.append(p)
            continue
        out[p["sku"]] = {
            "attach": mech,
            "needs_legs": bool(NEEDS_LEGS.search(d)),
            "note": note,
            "evidence": ev,
        }

    (CATALOG / "attachments_mined.json").write_text(json.dumps({
        "_comment": "Attachment mechanisms mined from Snow Peak's own product copy. Every "
                    "entry quotes the sentence it came from. Parts the copy is silent about "
                    "are NOT here -- they are listed as unknown and need a human.",
        "attachments": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    import collections
    by = collections.Counter(v["attach"] for v in out.values())
    print(f"mined {len(out)} of {len(cat['parts'])} parts\n")
    for k, n in by.most_common():
        print(f"  {n:3d}  {k}")

    print(f"\n--- COPY IS SILENT ({len(unknown)}) -- these need a human, grouped by current role:")
    grouped = collections.defaultdict(list)
    for p in unknown:
        grouped[p["role"]].append(p)
    for role, ps in sorted(grouped.items()):
        print(f"\n  [{role}]")
        for p in ps:
            print(f"    {p['sku']:11s} {p['title_en'][:44]}")


if __name__ == "__main__":
    sys.exit(main())
