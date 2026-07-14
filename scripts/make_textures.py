#!/usr/bin/env python3
"""Turn Snow Peak's own top-down product shots into textures for the flat boards.

The bamboo boards are photographed flat, from directly above, on a white sweep. That is
not just a picture of the part -- it is very nearly an orthographic texture map of it,
grain, hooks, brackets and all. No amount of procedural wood is going to beat it.

Which of a product's photos is the top-down one is decided by MEASURING, not by taking
image[0] and hoping: crop each candidate to its object, and keep the one whose silhouette
aspect is closest to the part's published w:d. CK-118TR is 496x496 (square), CK-117TR is
1096x496 (2.2:1) -- a three-quarter hero shot matches neither.

The white background becomes alpha, so the corner's quarter-round silhouette comes out of
the photograph instead of being modelled.

Usage:
  python make_textures.py            # -> web/tex/<SKU>.png + catalog/textures.json
"""

import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
TEX = ROOT / "web" / "tex"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

# Parts that are flat boards seen from above. Anything with a real 3D body (a burner, a
# box) would need a proper model, and a photo pasted on its top would just look wrong.
FLAT_ROLES = {"extension_table", "corner"}
FLAT_EXTRA = {"CK-125TR", "CK-126TR", "GF-010"}   # the wood inserts

BG_TOL = 30
MAX_ASPECT_ERR = 0.35     # beyond this the photo is not a plan view of anything


def fetch(url, px=1200):
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(f"{url}{sep}width={px}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def cut_out(img):
    """(RGBA cropped to the object, aspect). White sweep -> alpha."""
    a = np.asarray(img, dtype=np.int16)
    border = np.concatenate([a[0, :, :], a[-1, :, :], a[:, 0, :], a[:, -1, :]]).reshape(-1, 3)
    bg = np.median(border, axis=0)

    mask = (np.abs(a - bg).sum(axis=2) > BG_TOL)
    ys, xs = np.nonzero(mask)
    if len(xs) < 500:
        return None, None

    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = np.asarray(img, dtype=np.uint8)[y0:y1 + 1, x0:x1 + 1]
    m = mask[y0:y1 + 1, x0:x1 + 1]

    rgba = np.dstack([crop, (m * 255).astype(np.uint8)])
    w, h = x1 - x0 + 1, y1 - y0 + 1
    return Image.fromarray(rgba, "RGBA"), w / h


def main():
    cat = json.loads((CATALOG / "igt-catalog.json").read_text(encoding="utf-8"))
    us = json.loads((ROOT / "data" / "us_products_latest.json").read_text(encoding="utf-8"))
    gallery = {r["sku"]: r.get("images", []) for r in us["items"] if r.get("sku")}

    TEX.mkdir(parents=True, exist_ok=True)
    out, skipped = {}, []

    for p in cat["parts"]:
        if p["role"] not in FLAT_ROLES and p["sku"] not in FLAT_EXTRA:
            continue
        box = p.get("assembled_mm")
        imgs = gallery.get(p["sku"], [])
        if not box or not imgs:
            skipped.append((p["sku"], "no dims or no photo"))
            continue

        want = box["w"] / box["d"]          # the aspect a plan view MUST have
        best = None

        for url in imgs:
            try:
                cut, aspect = cut_out(fetch(url))
            except Exception:  # noqa: BLE001
                continue
            if not cut:
                continue
            err = abs(aspect - want) / want
            if best is None or err < best[0]:
                best = (err, cut, aspect, url)
            time.sleep(0.15)

        if not best:
            skipped.append((p["sku"], "no usable photo"))
            continue

        err, cut, aspect, url = best
        if err > MAX_ASPECT_ERR:
            # Honest failure: this product simply has no plan view in its gallery. Say so
            # rather than stretching a three-quarter hero shot onto a flat board.
            skipped.append((p["sku"], f"best aspect {aspect:.2f} vs wanted {want:.2f} "
                                      f"(off by {err:.0%}) -- no plan view in the gallery"))
            continue

        fit = measure_fittings(cut, box)
        ring = outline_mm(cut, box)

        grain_from(cut).save(TEX / f"{p['sku']}_grain.jpg", quality=88)

        cut.thumbnail((1024, 1024), Image.LANCZOS)
        cut.save(TEX / f"{p['sku']}.png")
        out[p["sku"]] = {"file": f"tex/{p['sku']}.png",
                         "grain": f"tex/{p['sku']}_grain.jpg",
                         "aspect": round(aspect, 3),
                         "wanted": round(want, 3), "aspect_error": round(err, 3),
                         "source": url, "outline_mm": ring, **(fit or {})}
        nh = len(fit["hooks_mm"]) if fit else 0
        nl = len(fit["legs_mm"]) if fit else 0
        nb = fit.get("brackets_found", 0) if fit else 0
        print(f"  {p['sku']:11s} aspect {aspect:5.2f} vs {want:5.2f} ({err:3.0%})   "
              f"hooks={nh}  legs={nl}{'  <-- ' + str(nb) + ' bracket blobs, not 2' if nb != 2 else ''}")

    (CATALOG / "textures.json").write_text(json.dumps({
        "_comment": "Top-down product photographs, cropped to the object with the white "
                    "background cut to alpha, used as the top surface of the flat boards. "
                    "The plan view is CHOSEN by matching the silhouette's aspect to the "
                    "part's published w:d -- image[0] is often a hero shot and would be "
                    "stretched into nonsense.",
        "textures": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\ntextured {len(out)} parts")
    if skipped:
        print(f"\nno plan view ({len(skipped)}):")
        for sku, why in skipped:
            print(f"    {sku:11s} {why}")




# ---------------------------------------------------------------------------
# Where the hooks and the legs actually are.
#
# The plan view is not just a picture -- once it is cropped to the board and the board's
# real width is known, it is a SCALE DRAWING. mm-per-pixel falls straight out, and the
# fittings can be measured instead of eyeballed:
#
#   hooks     thin pins that protrude BEYOND the board's edge. Opening the mask erodes
#             them away; whatever the opening removed is a hook.
#   brackets  bright, colourless metal ON the bamboo. Bamboo is warm and saturated;
#             stainless is not. That is the whole segmentation.
#
# The legs screw into the brackets, so bracket centres ARE leg positions.
# ---------------------------------------------------------------------------

from scipy import ndimage  # noqa: E402


def measure_fittings(img, box):
    """Hook and bracket positions in mm, relative to the board's centre.

    Two traps, both hit first time round:

      - An opening leaves a fringe of anti-aliased crumbs all along the board's edge, and
        counting those as hooks gives you eight of them. A hook is not merely "not the
        board" -- it PROTRUDES. So a candidate must lie clear OUTSIDE the board's bounding
        box, which the edge crumbs never do.
      - The brackets hang slightly over the board's edge, so looking for them only inside
        the opened board loses them entirely (the corners came back with zero legs). Look
        for metal across the whole silhouette.
    """
    a = np.asarray(img.convert("RGB"), dtype=np.int16)
    alpha = np.asarray(img)[:, :, 3] > 128

    board = ndimage.binary_opening(alpha, structure=np.ones((11, 11)))
    if board.sum() < 500:
        return None
    ys, xs = np.nonzero(board)
    bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw_px, bd_px = bx1 - bx0 + 1, by1 - by0 + 1
    area = board.sum()

    # Scale off the BOARD, not the silhouette: the silhouette includes the pins, and using
    # it would shrink every measurement by a couple of percent.
    mmx, mmy = box["w"] / bw_px, box["d"] / bd_px
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    to_mm = lambda x, y: (round((x - cx) * mmx, 1), round((y - cy) * mmy, 1))

    def blobs(mask, min_area):
        lab, n = ndimage.label(mask)
        out = []
        for i in range(1, n + 1):
            m = lab == i
            if m.sum() < min_area:
                continue
            yy, xx = np.nonzero(m)
            out.append((m.sum(), xx.mean(), yy.mean()))
        return sorted(out, reverse=True)

    # Hooks: pins that stick out PAST the board's edge.
    margin = 4
    spikes = alpha & ~board
    hooks = [to_mm(x, y) for s_, x, y in blobs(spikes, area * 0.00015)
             if x < bx0 - margin or x > bx1 + margin or y < by0 - margin or y > by1 + margin]

    # Brackets: bright and colourless, against warm saturated bamboo. That is the whole
    # segmentation -- stainless has no hue and bamboo has plenty.
    #
    # Then CLOSE. A bracket is a plate with a big screw hole through the middle and the
    # board showing through it, so at 1.5mm/px it arrives as rubble, and a 5x5 opening
    # finished the job: the left corner came back with no brackets at all, and the right
    # corner with two -- which were the two halves of ONE bracket, 34mm apart, with the
    # real second bracket missed entirely. Both its legs were drawn in the same place.
    #
    # This is the exact opposite of the rule in measure_frame.py, and deliberately so.
    # There the quarry is the HOLE, and closing welds it shut. Here the quarry is the
    # PLATE, and closing is what puts it back together. Ask first what you are looking
    # for -- the thing, or the absence of it.
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    metal = ndimage.binary_opening(alpha & (mx > 105) & (sat < 0.22), structure=np.ones((3, 3)))
    metal = ndimage.binary_closing(metal, structure=np.ones((5, 5)))

    # A leg SET is two legs, and an extension takes one set. So there are TWO brackets --
    # not "up to four". Taking the two biggest is a physical fact doing the filtering.
    found = blobs(metal, area * 0.0006)
    legs = sorted(to_mm(x, y) for s_, x, y in found[:2])

    return {
        "scale_mm_per_px": [round(mmx, 3), round(mmy, 3)],
        "hooks_mm": sorted(hooks)[:4],
        "legs_mm": legs,                 # the legs screw into the brackets
        "brackets_found": len(found),    # != 2 means look at the photo before trusting it
    }




def grain_from(img):
    """A clean patch of the board's own surface, for the TOP face.

    The plan view is of the UNDERSIDE -- brackets and hook pins are down there, which is
    why they show in it. Painting it on the tabletop put two leg brackets on the work
    surface. But dropping the photo entirely leaves a flat slab of colour, which is worse
    than a wrong texture in a different way.

    The middle of the board is neither: it is just bamboo. Crop it, tile it, and the top
    gets real grain from the same photograph that gives the underside its ironmongery.
    """
    w, h = img.size
    cw, ch = int(w * 0.30), int(h * 0.34)
    patch = img.convert("RGB").crop(((w - cw) // 2, (h - ch) // 2,
                                     (w + cw) // 2, (h + ch) // 2))
    return patch.resize((256, 256), Image.LANCZOS)


def outline_mm(img, box, samples=48):
    """The board's real silhouette, in mm, traced from the photograph's alpha.

    The corner came out as a leaf. Not because either the geometry or the texture was
    wrong -- because there were TWO of them. A hand-built quarter round and a photographic
    alpha mask are two independent claims about the same outline, and alphaTest renders
    their INTERSECTION. Two truths, disagreeing by a rotation, and the render shows the
    overlap.

    So there is one source now. The alpha already carries the outline; take the outline
    from the alpha. Geometry and texture then cannot disagree, because they are the same
    measurement.

    Row-scan, not a full contour trace: these boards are convex (quarter round, splayed
    trapezoid, rectangle), and the left/right extent of each row describes them exactly.
    Traced on the OPENED mask so the hook pins do not become bumps in the tabletop.
    """
    alpha = np.asarray(img)[:, :, 3] > 128
    board = ndimage.binary_opening(alpha, structure=np.ones((11, 11)))
    ys, xs = np.nonzero(board)
    if len(xs) < 500:
        return None

    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    mmx, mmy = box["w"] / (x1 - x0 + 1), box["d"] / (y1 - y0 + 1)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    left, right = [], []
    for i in range(samples + 1):
        y = int(round(y0 + (y1 - y0) * i / samples))
        row = np.nonzero(board[y])[0]
        if not len(row):
            continue
        left.append((round(float((row.min() - cx) * mmx), 1), round(float((y - cy) * mmy), 1)))
        right.append((round(float((row.max() - cx) * mmx), 1), round(float((y - cy) * mmy), 1)))

    # Down the left side, back up the right: a closed ring in the board's own mm frame.
    return left + right[::-1]


if __name__ == "__main__":
    sys.exit(main())
