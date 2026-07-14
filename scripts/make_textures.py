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


def declared_plan(sku, views, images):
    """The image a HUMAN said is the plan view, if anyone has said.

    The aspect heuristic below is honest and it works, but it is still a guess: it cannot
    tell a top-down shot from an underside shot, and it cannot see an image it was never
    handed. A person who owns the part can do both in a second. When they have, use what
    they said -- and record that we did.
    """
    said = (views or {}).get(sku) or {}
    plan = [tag for tag, v in said.items() if v == "plan_top"]
    if not plan:
        return None
    for im in images:
        base = im["tag"].rsplit(".", 1)[0]
        if base in plan or im["tag"] in plan:
            return im["url"]
    return None


def main():
    cat = json.loads((CATALOG / "igt-catalog.json").read_text(encoding="utf-8"))

    # Every photograph Snow Peak publishes, not just the two the US store carries.
    imgs_path = CATALOG / "images.json"
    gallery = {}
    if imgs_path.exists():
        gallery = json.loads(imgs_path.read_text(encoding="utf-8"))["images"]
    else:
        us = json.loads((ROOT / "data" / "us_products_latest.json").read_text(encoding="utf-8"))
        gallery = {r["sku"]: {"images": [{"url": u, "tag": u.split("/")[-1], "source": "us"}]
                              for u in [r.get("images", [])]}  # pragma: no cover
                   for r in us["items"] if r.get("sku")}

    views_path = CATALOG / "views.json"
    views = json.loads(views_path.read_text(encoding="utf-8")).get("views", {}) \
        if views_path.exists() else {}

    TEX.mkdir(parents=True, exist_ok=True)
    out, skipped = {}, []

    for p in cat["parts"]:
        if p["role"] not in FLAT_ROLES and p["sku"] not in FLAT_EXTRA:
            continue
        box = p.get("assembled_mm")
        images = (gallery.get(p["sku"]) or {}).get("images", [])
        if not box or not images:
            skipped.append((p["sku"], "no dims or no photo"))
            continue

        want = box["w"] / box["d"]          # the aspect a plan view MUST have
        best, told = None, declared_plan(p["sku"], views, images)

        # If someone has SAID which image is the plan view, that is the image. No search.
        urls = [told] if told else [im["url"] for im in images]

        for url in urls:
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
        if not told and err > MAX_ASPECT_ERR:
            # Honest failure: nobody has said which image is the plan view, and no image in
            # the gallery has the aspect of one. Say so rather than stretching a
            # three-quarter hero shot onto a flat board. Point at the fix.
            skipped.append((p["sku"], f"best aspect {aspect:.2f} vs wanted {want:.2f} "
                                      f"(off by {err:.0%}) -- no plan view found. "
                                      f"{len(images)} images: name one in views.json"))
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
                         "source": url,
                         "picked_by": "declared" if told else "aspect",
                         "outline_mm": ring, **(fit or {})}
        nh, nb = (fit or {}).get("hooks_found", 0), (fit or {}).get("brackets_found", 0)
        how = "told " if told else "guess"
        flag = ""
        if nh not in (0, 2) or nb not in (0, 2):
            flag = f"   <-- {nh} hook / {nb} bracket blobs; look at the photo"
        print(f"  {p['sku']:11s} {how} aspect {aspect:5.2f} vs {want:5.2f} ({err:3.0%})   "
              f"hooks={len(fit['hooks_mm']) if fit else 0}  "
              f"legs={len(fit['legs_mm']) if fit else 0}{flag}")

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
    lab_m, n_m = ndimage.label(metal)
    plates = []
    for i in range(1, n_m + 1):
        m = lab_m == i
        s = int(m.sum())
        if s < area * 0.0006:
            continue
        yy, xx = np.nonzero(m)
        plates.append((s, i, float(xx.mean()), float(yy.mean())))
    plates.sort(reverse=True)
    legs = sorted(to_mm(x, y) for _, _, x, y in plates[:2])

    # Hooks: wire hooks that stand clear of the board's EDGE.
    #
    # Two blind spots, in order.
    #
    # The first version asked whether a spike lay outside the board's BOUNDING BOX -- which
    # is the same question only for a rectangle. CK-218 is a trapezoid: its hooks are on
    # the slanted edge, and the whole slanted edge sits well inside the bounding box, so
    # every hook failed and the angle extensions came back with none. Ask the real question
    # instead -- how far is this blob from the BOARD -- with a distance transform.
    #
    # But the BRACKET PLATES overhang the edge too, and by MORE than a hook does. Subtract
    # the metal blobs and the plate's stray fragments still outrank the real hooks: on the
    # corners this put both "hooks" on the bracket edge. So exclude a REGION, not a mask --
    # a plate is 58x44mm, so nothing within 45mm of a bracket's centre is a hook. That is a
    # statement about the hardware, and it does not care how the segmentation frayed.
    #
    # The crumbs an 11x11 opening leaves along the edge reach 7-9px out. A wire hook stands
    # 12mm proud, which is 16-22px at 1.5mm/px. The gap is not close, and 10px sits in it.
    BRACKET_R = 45.0
    dist = ndimage.distance_transform_edt(~board)
    lab_s, n_s = ndimage.label(alpha & ~board)
    cand = []
    for i in range(1, n_s + 1):
        m = lab_s == i
        if m.sum() < area * 0.00015:
            continue
        d = float(dist[m].max())
        if d < 10:                       # edge crumbs, not hardware
            continue
        yy, xx = np.nonzero(m)
        at = to_mm(xx.mean(), yy.mean())
        if any(np.hypot(at[0] - lx, at[1] - lz) < BRACKET_R for lx, lz in legs):
            continue                     # that is a bracket, not a hook
        cand.append((d, at))
    cand.sort(reverse=True)
    hooks = sorted(p for _, p in cand[:2])   # a pair of hooks, like a pair of legs

    # Where the BOARD sits inside the saved image, as fractions of it. The image is cropped
    # to the whole silhouette (hooks included) but every millimetre here is measured from
    # the BOARD's box, so the two frames differ by the length of a hook. Without this you
    # cannot draw a measurement back onto the photograph it came from -- and being able to
    # do exactly that is how you find out whether the model or the measurement is lying.
    # Fractions, not pixels: they survive the thumbnail.
    h_px, w_px = alpha.shape
    board_frac = [round(bx0 / w_px, 5), round(by0 / h_px, 5),
                  round((bx1 + 1) / w_px, 5), round((by1 + 1) / h_px, 5)]

    return {
        "scale_mm_per_px": [round(mmx, 3), round(mmy, 3)],
        "board_frac": board_frac,        # [x0, y0, x1, y1] of the board within the image
        "hooks_mm": hooks,
        "legs_mm": legs,                 # the legs screw into the brackets
        # Anything other than 2 of either means look at the photo before trusting it.
        "hooks_found": len(cand),
        "brackets_found": len(plates),
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
