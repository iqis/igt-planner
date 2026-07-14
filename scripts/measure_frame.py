#!/usr/bin/env python3
"""Measure the frame's underside: where the legs go in, and where the extensions hook on.

Snow Peak photographs the frame from below, flat, on white. The picture tells you two
things the spec table never will, and it labels them by colour:

    silver corner plates   a big centre hole each -> the LEG sockets
    black end pieces       two round holes each   -> where an extension's hooks go

That second one is the whole reason the layout works, and it is why an extension attaches
to the frame's SHORT end and runs the length out: the holes are only there.

It also sets up a real cross-check. The bamboo table's hooks were measured off its own
plan view at z = +/-145mm. If the frame's end-piece holes land on the same z, two
independent photographs of two different products agree -- and the model is not just
self-consistent, it is right.

Usage:
  python measure_frame.py            # -> catalog/frame_fittings.json
"""

import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

# The underside plan view. Not in the Shopify gallery we scrape -- Snow Peak keeps it as an
# alt image -- so it is named here, with the SKU it belongs to.
PLAN_VIEWS = {
    "CK-149": "https://www.snowpeak.com/cdn/shop/products/CK-149_alt02.jpg?v=1630023553",
}

BG_TOL = 30


def fetch(url, px=1400):
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(f"{url}{sep}width={px}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def blobs(mask, min_area):
    lab, n = ndimage.label(mask)
    out = []
    for i in range(1, n + 1):
        m = lab == i
        a = int(m.sum())
        if a < min_area:
            continue
        yy, xx = np.nonzero(m)
        out.append({"area": a, "x": float(xx.mean()), "y": float(yy.mean()),
                    "w": int(xx.max() - xx.min() + 1), "h": int(yy.max() - yy.min() + 1)})
    return sorted(out, key=lambda b: -b["area"])


def measure(img, box):
    a = np.asarray(img, dtype=np.int16)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]).reshape(-1, 3)
    bg = np.median(border, axis=0)
    obj = np.abs(a - bg).sum(axis=2) > BG_TOL

    ys, xs = np.nonzero(obj)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    mmx = box["w"] / (x1 - x0 + 1)
    mmy = box["d"] / (y1 - y0 + 1)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    to_mm = lambda x, y: (round(float((x - cx) * mmx), 1), round(float((y - cy) * mmy), 1))

    lum = a.mean(axis=2)
    area = obj.sum()

    # The end pieces are the black bars. Colour is the label Snow Peak already put on this.
    #
    # A hole is a GAP in the bar, so it must survive as a gap: closing the mask first
    # welds every hole shut and the detector then finds none, which is exactly what an
    # earlier "improvement" here did. Threshold generously, open lightly, never close.
    dark = ndimage.binary_opening(obj & (lum < 130), structure=np.ones((3, 3)))
    ends = blobs(dark, area * 0.008)[:2]

    hook_holes = []
    lab, _ = ndimage.label(dark)
    for e in ends:
        bar = lab == lab[int(e["y"]), int(e["x"])]
        inner = ndimage.binary_fill_holes(bar) & ~bar
        # A hook hole is round and big; the little screw dots are neither.
        for b in blobs(inner, 15):
            if 0.5 < b["w"] / max(b["h"], 1) < 2.0:
                hook_holes.append(to_mm(b["x"], b["y"]))

    # The leg socket is a dark eye on a light corner plate. Asking for holes ENCLOSED by
    # the bright mask finds nothing -- the socket's rim is mid-grey and breaks the ring.
    # Look for the eye directly instead: a dark round blob that is not part of an end bar.
    end_mask = np.zeros_like(dark)
    for e in ends:
        end_mask |= lab == lab[int(e["y"]), int(e["x"])]

    dots = ndimage.binary_opening(obj & (lum < 145) & ~end_mask, structure=np.ones((3, 3)))
    cand = [b for b in blobs(dots, 30) if 0.55 < b["w"] / max(b["h"], 1) < 1.8]
    # Four corners, four sockets: the screw dots around each are markedly smaller, so the
    # four biggest round blobs are the sockets.
    sockets = [to_mm(b["x"], b["y"]) for b in cand[:4]]

    return {
        "scale_mm_per_px": [round(mmx, 3), round(mmy, 3)],
        "end_pieces": len(ends),
        "hook_holes_mm": sorted(hook_holes),
        "leg_sockets_mm": sorted(sockets),
    }


def main():
    cat = json.loads((CATALOG / "igt-catalog.json").read_text(encoding="utf-8"))
    parts = {p["sku"]: p for p in cat["parts"]}
    tex = json.loads((CATALOG / "textures.json").read_text(encoding="utf-8"))["textures"]

    out = {}
    for sku, url in PLAN_VIEWS.items():
        box = parts[sku]["assembled_mm"]
        m = measure(fetch(url), box)
        out[sku] = {**m, "source": url}

        print(f"{sku}  ({box['w']:.0f}x{box['d']:.0f}mm, {m['scale_mm_per_px'][0]:.3f}mm/px)")
        print(f"  end pieces found : {m['end_pieces']}")
        print(f"  hook holes       : {m['hook_holes_mm']}")
        print(f"  leg sockets      : {m['leg_sockets_mm']}")

        # The cross-check. Two products, two photographs, one number.
        ext = tex.get("CK-117TR", {}).get("hooks_mm") or []
        if ext and m["hook_holes_mm"]:
            ez = sorted({abs(z) for _, z in ext})
            fz = sorted({abs(z) for _, z in m["hook_holes_mm"]})
            print(f"\n  CROSS-CHECK  bamboo table's hooks sit at |z| = {ez}")
            print(f"               frame's hook holes at        |z| = {fz}")
            if ez and fz:
                err = min(abs(a - b) for a in ez for b in fz)
                print(f"               closest agreement: {err:.1f}mm apart"
                      f"{'   <-- they line up' if err < 15 else '   <-- THEY DO NOT'}")

    (CATALOG / "frame_fittings.json").write_text(json.dumps({
        "_comment": "Measured off the frame's underside plan view. Silver corner plates "
                    "carry the leg sockets; the black end pieces carry the holes an "
                    "extension's hooks drop into -- which is why extensions attach to the "
                    "frame's SHORT end and run the length out.",
        "frames": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {CATALOG / 'frame_fittings.json'}")


if __name__ == "__main__":
    sys.exit(main())
