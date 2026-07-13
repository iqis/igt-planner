#!/usr/bin/env python3
"""Recover the IGT unit pitch from published frame dimensions.

Snow Peak never publishes "one unit = N mm". They publish whole-frame sizes:

    3 unit frame   846 x 496 mm
    4 unit frame     ? x 496 mm

If the frame is a linear run of identical slots plus fixed end rails, then

    W(n) = pitch * n + end_overhead

which is a straight line through the frame family. Two frames determine it; the
rest of the family tests it. If the family is not collinear, the linear-grid
assumption is wrong and every slot placement downstream would be quietly bogus --
so this script refuses to emit a constant it cannot corroborate.

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

# Frames whose unit count is unambiguous from the product name. The JP names use
# 2/3/4 ユニット; the classic frames encode it in the English name instead.
UNIT_RE = re.compile(r"(\d)\s*ユニット")


def frames_with_units(items):
    """Return [(sku, units, width_mm, title)] for every frame we can pin down."""
    found = []
    for r in items:
        cat = r.get("jp_category", "")
        if "IGT" not in cat:
            continue
        title = r.get("jp_title", "")
        asm = r.get("assembled_mm")
        if not asm:
            continue

        # A frame is a frame if it says so and is not a rail/case/set.
        is_frame = "フレーム" in title
        if not is_frame or any(w in title for w in ("レール", "ケース", "セット")):
            continue

        m = UNIT_RE.search(title)
        if not m:
            continue
        found.append((r["sku"], int(m.group(1)), asm["w"], title))
    return sorted(found, key=lambda t: t[1])


def fit(points):
    """Least-squares line W = pitch*n + overhead over (units, width)."""
    n = len(points)
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    denom = n * sxx - sx * sx
    if denom == 0:
        return None, None
    pitch = (n * sxy - sx * sy) / denom
    overhead = (sy - pitch * sx) / n
    return pitch, overhead


def main():
    if not SPECS.exists():
        sys.exit(f"missing {SPECS} -- run fetch_jp_specs.py first")

    items = json.loads(SPECS.read_text(encoding="utf-8"))["items"]
    frames = frames_with_units(items)

    if len(frames) < 2:
        sys.exit(f"need >=2 frames with known unit counts, found {len(frames)}:\n"
                 + "\n".join(f"  {f}" for f in frames))

    print("frames used:")
    for sku, units, w, title in frames:
        print(f"  {sku:10s} {units} unit  W={w:6.0f}mm   {title}")

    pts = [(units, w) for _, units, w, _ in frames]
    pitch, overhead = fit(pts)

    # Every frame must sit on the line, or the grid model is wrong.
    print(f"\nfit: W(n) = {pitch:.1f} * n + {overhead:.1f}")
    worst = 0.0
    for sku, units, w, _ in frames:
        pred = pitch * units + overhead
        err = abs(pred - w)
        worst = max(worst, err)
        flag = "  <-- OFF" if err > 2.0 else ""
        print(f"  {sku:10s} n={units}  actual={w:6.0f}  predicted={pred:7.1f}  err={err:4.1f}mm{flag}")

    if worst > 2.0:
        sys.exit(f"\nFAIL: frame family is not collinear (worst error {worst:.1f}mm > 2mm).\n"
                 "The linear-grid assumption does not hold -- do NOT build slot placement on it.")

    grid = {
        "unit_pitch_mm": round(pitch, 1),
        "end_overhead_mm": round(overhead, 1),
        "half_unit_mm": round(pitch / 2, 1),
        "worst_residual_mm": round(worst, 2),
        "frames_used": [{"sku": s, "units": u, "width_mm": w} for s, u, w, _ in frames],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(grid, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\nOK: unit pitch = {pitch:.1f}mm  (half unit = {pitch/2:.1f}mm), "
          f"worst residual {worst:.2f}mm")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    sys.exit(main())
