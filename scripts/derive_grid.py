#!/usr/bin/env python3
"""Recover the IGT unit pitch from published frame dimensions.

Snow Peak never publishes "one unit = N mm". It publishes whole-frame sizes:

    3 unit frame   846 x 496 mm
    4 unit frame     ? x 496 mm

A frame is a run of identical slots plus fixed end rails, so within one frame
*family*:

    W(n) = pitch * n + end_overhead

Differencing two frames of the same family cancels the end overhead and leaves
the pitch. Families are kept apart on purpose: the standard frame and the
collapsible (セパレート) frame have different end structures, so demanding one
shared overhead across all of them would be inventing a constraint that does not
exist.

The check we DO keep is a real physical one. Modules are interchangeable between
frame types -- a bamboo table that fits a standard frame fits a collapsible one.
That is only possible if **every family shares the same pitch**. End overhead may
differ; pitch may not. If the families disagree on pitch, interchangeability is
false and the whole planner model is wrong, so we fail loudly instead of picking
a number.

Usage:
  python derive_grid.py            # reads data/jp_specs_latest.json
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPECS = ROOT / "data" / "jp_specs_latest.json"
OUT = ROOT / "catalog" / "grid.json"

UNIT_RE = re.compile(r"(\d)\s*ユニット")
# The standard frames do not say "N unit" in Japanese -- CK-150 is just
# "フレームロング". The English storefront names them properly, so unit counts come
# from there, joined on SKU.
EN_UNITS = {"one": 1, "two": 2, "three": 3, "four": 4}
EN_UNIT_RE = re.compile(r"\b(one|two|three|four|\d)\s+unit\b", re.I)

# A pitch outside this range is not a mis-measurement, it is a parse failure.
PITCH_RANGE_MM = (100.0, 500.0)
MAX_RESIDUAL_MM = 2.0

# Two frame families ship today. They differ in how the ends are built, which is
# exactly why their overheads are allowed to differ and their pitches are not.
FAMILIES = {
    "collapsible": lambda t: "セパレート" in t,
    "standard": lambda t: "セパレート" not in t,
}

PITCH_TOLERANCE_MM = 2.0


def us_unit_counts():
    """SKU -> unit count, read off the English product names."""
    p = ROOT / "data" / "us_products_latest.json"
    if not p.exists():
        return {}
    out = {}
    for r in json.loads(p.read_text(encoding="utf-8"))["items"]:
        m = EN_UNIT_RE.search(r.get("us_title", ""))
        if m and r.get("sku"):
            tok = m.group(1).lower()
            out[r["sku"]] = EN_UNITS.get(tok) or int(tok)
    return out


def frames_with_units(items):
    """[(sku, family, units, width_mm, title)] for every frame we can pin down."""
    en_units = us_unit_counts()
    found = []
    for r in items:
        if "IGT" not in r.get("jp_category", ""):
            continue
        title = r.get("jp_title", "")
        asm = r.get("assembled_mm")
        if not asm or "フレーム" not in title:
            continue
        # Rails, cases, hanging racks and bundles carry "フレーム" in their names too.
        if any(w in title for w in ("レール", "ケース", "セット", "ラック", "アーキテクト")):
            continue

        m = UNIT_RE.search(title)
        units = int(m.group(1)) if m else en_units.get(r["sku"])
        if not units:
            continue
        fam = next(f for f, test in FAMILIES.items() if test(title))
        found.append((r["sku"], fam, units, asm["w"], title))
    return sorted(found, key=lambda t: (t[1], t[2]))


def fit(points):
    """Least-squares W = pitch*n + overhead. Two points -> exact difference."""
    n = len(points)
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxx = sum(p[0] ** 2 for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    denom = n * sxx - sx * sx
    if denom == 0:
        return None, None
    pitch = (n * sxy - sx * sy) / denom
    return pitch, (sy - pitch * sx) / n


def main():
    if not SPECS.exists():
        sys.exit(f"missing {SPECS} -- run fetch_jp_specs.py first")

    frames = frames_with_units(json.loads(SPECS.read_text(encoding="utf-8"))["items"])
    if not frames:
        sys.exit("no frames with a recoverable unit count")

    by_family = {}
    for sku, fam, units, w, title in frames:
        by_family.setdefault(fam, []).append((sku, units, w, title))

    print("frames found:")
    for fam, rows in by_family.items():
        print(f"  [{fam}]")
        for sku, units, w, title in rows:
            print(f"    {sku:10s} {units} unit  W={w:6.0f}mm   {title}")

    results, rejected = {}, []
    for fam, rows in by_family.items():
        if len(rows) < 2:
            print(f"\n  [{fam}] only {len(rows)} frame -- cannot difference, skipping")
            continue
        pitch, overhead = fit([(u, w) for _, u, w, _ in rows])
        worst = max(abs(pitch * u + overhead - w) for _, u, w, _ in rows)
        print(f"\n  [{fam}] W(n) = {pitch:.1f}*n + {overhead:.1f}   "
              f"(worst residual {worst:.1f}mm over {len(rows)} frames)")

        # Each family has to stand on its own before it is allowed to vote. A
        # negative or absurd pitch means a width was misparsed, not that the
        # frames are unusual -- and a fit that misses a frame by 333mm is not a
        # fit. Guarding only the cross-family spread let exactly this through.
        if not (PITCH_RANGE_MM[0] <= pitch <= PITCH_RANGE_MM[1]):
            rejected.append(f"[{fam}] pitch {pitch:.1f}mm is outside {PITCH_RANGE_MM} -- "
                            "a width was misparsed")
            continue
        if worst > MAX_RESIDUAL_MM:
            rejected.append(f"[{fam}] worst residual {worst:.1f}mm > {MAX_RESIDUAL_MM}mm -- "
                            "these frames are not a straight line")
            continue

        results[fam] = {"pitch": pitch, "overhead": overhead, "worst_mm": worst,
                        "frames": [{"sku": s, "units": u, "width_mm": w} for s, u, w, _ in rows]}

    if rejected:
        sys.exit("\nFAIL:\n  " + "\n  ".join(rejected) +
                 "\n\nRefusing to emit a pitch. Slot placement built on this would be "
                 "silently wrong everywhere.")
    if not results:
        sys.exit("\nno family had >=2 frames -- cannot derive a pitch")

    pitches = {f: r["pitch"] for f, r in results.items()}
    spread = max(pitches.values()) - min(pitches.values())

    if len(pitches) > 1:
        print(f"\ncross-family pitch check: {', '.join(f'{f}={p:.1f}mm' for f, p in pitches.items())}"
              f"  spread={spread:.1f}mm")
        if spread > PITCH_TOLERANCE_MM:
            sys.exit(
                f"\nFAIL: families disagree on pitch by {spread:.1f}mm (> {PITCH_TOLERANCE_MM}mm).\n"
                "Modules are supposed to be interchangeable across frames, which requires a\n"
                "shared pitch. Either the model is wrong or a frame's units are misread --\n"
                "do NOT build slot placement on this."
            )

    pitch = sum(pitches.values()) / len(pitches)
    grid = {
        "unit_pitch_mm": round(pitch, 1),
        "half_unit_mm": round(pitch / 2, 1),
        "cross_family_spread_mm": round(spread, 2),
        "families": {
            f: {
                "end_overhead_mm": round(r["overhead"], 1),
                "pitch_mm": round(r["pitch"], 1),
                "worst_residual_mm": round(r["worst_mm"], 2),
                "frames": r["frames"],
            }
            for f, r in results.items()
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(grid, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\nOK: unit pitch = {pitch:.1f}mm   half unit = {pitch/2:.1f}mm")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    sys.exit(main())
