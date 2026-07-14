#!/usr/bin/env python3
"""Take each part's colour from its product photograph, not from a guess.

The planner was colouring parts by keyword -- /bamboo/ -> some tan I picked, /stainless/
-> some grey I picked. That is exactly the kind of invention this project spends its
effort avoiding everywhere else, and it is unnecessary: Snow Peak photographs every
product, and the catalog already carries the image URL.

Method, and why it is not just "average the pixels":

  1. Estimate the background from the border pixels. Shopify hero shots are on white,
     but some are lifestyle shots on grass or wood, and averaging those gives you the
     colour of a lawn.
  2. Mask out everything close to that background.
  3. Quantise what is left and take the MODE, not the mean. A mesh tray photographed on
     white averages to a washed-out grey that exists nowhere in the object; its most
     common colour is the steel it is made of.

Every part gets `color_confidence` = the fraction of the frame that survived masking.
A lifestyle shot with a busy background scores low, and the planner can fall back.

Usage:
  python extract_colors.py            # -> writes color_hex into catalog/colors.json
  python extract_colors.py --save-images   # also cache 256px copies under web/img/
"""

import argparse
import io
import json
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
IMGDIR = ROOT / "web" / "img"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

BG_TOLERANCE = 34      # how close to the background a pixel must be to be dropped
QUANT_LEVELS = 6       # bits kept per channel when quantising (6 -> steps of ~4)


def fetch_image(url, px=400):
    # Shopify resizes on demand; asking for 400px keeps this fast and is plenty for colour.
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(f"{url}{sep}width={px}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def dominant_color(img):
    """(hex, trust, coverage, openness).

    `trust` measures whether the SHOT is clean, not whether the object is big. Those are
    different things, and conflating them is a mistake: a 25mm-wide leg on a white sweep
    covers 1.5% of the frame and its colour is perfectly reliable, while a lifestyle shot
    on grass covers everything and will hand you the colour of a lawn. So trust comes
    from how uniform the background is, and coverage is reported separately.

    `openness` is the share of the object's bounding box that turned out to BE background
    -- how much of the thing you can see through. A wire mesh basket scores high, and that
    is a fact about its geometry, not a defect in its colour.
    """
    a = np.asarray(img, dtype=np.int16)

    # 1. What is the background? Ask the border, not the middle.
    border = np.concatenate([a[0, :, :], a[-1, :, :], a[:, 0, :], a[:, -1, :]]).reshape(-1, 3)
    bg = np.median(border, axis=0)
    bg_spread = float(np.mean(np.std(border, axis=0)))     # a clean sweep is uniform
    trust = round(float(max(0.0, 1.0 - bg_spread / 40.0)), 3)

    # 2. Drop everything that looks like it.
    flat = a.reshape(-1, 3)
    mask = np.abs(flat - bg).sum(axis=1) > BG_TOLERANCE
    keep = flat[mask]
    coverage = round(len(keep) / len(flat), 3)
    if len(keep) < 200:
        return None, trust, coverage, None

    # 3. How see-through is it? Background pixels *inside* the object's bounding box.
    m2 = mask.reshape(a.shape[:2])
    ys, xs = np.nonzero(m2)
    inside = m2[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    openness = round(1.0 - float(inside.mean()), 3)

    # 4. Mode, not mean. The mean of an object on white is a colour the object does not
    #    have; the mode is the material it is actually made of.
    step = 1 << (8 - QUANT_LEVELS)
    q = (keep // step) * step
    (r, g, b), _ = Counter(map(tuple, q)).most_common(1)[0]
    return f"#{int(r):02x}{int(g):02x}{int(b):02x}", trust, coverage, openness


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-images", action="store_true",
                    help="cache a 256px copy of each photo under web/img/")
    args = ap.parse_args()

    cat = json.loads((CATALOG / "igt-catalog.json").read_text(encoding="utf-8"))
    if args.save_images:
        IMGDIR.mkdir(parents=True, exist_ok=True)

    out, missing = {}, []
    for p in cat["parts"]:
        url = p.get("image")
        if not url:
            missing.append(p["sku"])
            continue
        try:
            img = fetch_image(url)
        except Exception as e:  # noqa: BLE001
            missing.append(p["sku"])
            print(f"  {p['sku']:11s} FETCH FAILED  {e}")
            continue

        hex_, trust, coverage, openness = dominant_color(img)
        if not hex_:
            missing.append(p["sku"])
            continue
        out[p["sku"]] = {"color_hex": hex_, "trust": trust, "coverage": coverage,
                         "openness": openness, "source": "product-photo"}

        if args.save_images:
            img.copy().resize((256, 256)).save(IMGDIR / f"{p['sku']}.jpg", quality=82)
        time.sleep(0.15)

    path = CATALOG / "colors.json"
    path.write_text(json.dumps({
        "_comment": "Colours sampled from Snow Peak's own product photography, not guessed "
                    "from a keyword. trust = how clean the shot is (uniform background), "
                    "NOT how big the object is -- a thin leg on a white sweep has tiny "
                    "coverage and a perfectly reliable colour. openness = the share of the "
                    "object's bounding box you can see through, which is how a wire mesh "
                    "basket announces itself as mostly air.",
        "colors": out,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    shaky = sorted([(s, c) for s, c in out.items() if c["trust"] < 0.7], key=lambda t: t[1]["trust"])
    airy = sorted([(s, c) for s, c in out.items() if (c["openness"] or 0) > 0.55],
                  key=lambda t: -(t[1]["openness"] or 0))

    print(f"\nsampled {len(out)} parts, {len(missing)} without a usable photo")
    print(f"\nbusy background, colour is shaky ({len(shaky)}):")
    for s, c in shaky[:6]:
        print(f"    {s:11s} {c['color_hex']}  trust={c['trust']:.2f}")
    print(f"\nmostly air -- should NOT be drawn as a solid block ({len(airy)}):")
    for s, c in airy[:8]:
        print(f"    {s:11s} {c['color_hex']}  openness={c['openness']:.2f}")
    print(f"\nwrote {path}")


if __name__ == "__main__":
    sys.exit(main())
