"""Build the PUBLIC planner into dist/ -- the copy that goes on the open internet.

The repo is the owner's planner: it wears grain cropped from Snow Peak's product photographs, lays
the plan-view photo on every board, shows a product thumbnail on hover, and carries the part bench
(an internal measuring tool with a gallery of those photos). None of that is ours to publish. The
facts are -- dimensions, the 250mm grid, the attachment rules, the shapes we model ourselves -- so
the public build is the same app with the photographs taken out:

  - web/img/ and the bench (part.html/js/css) are not copied at all;
  - of web/tex/ only the textures we GENERATED ship (brushed steel, canvas weave, chair mesh);
  - build.js is rewritten with PUBLIC = true and the mean colour of each photo grain left behind,
    so proctex.js can draw a canvas grain of the same tone (grainMaterial tints the map by the
    part's colour, so a map with a different mean would shift every board).

Only the four catalog files the app fetches are copied. Plus Cloudflare Pages' _redirects (bare
/ lands on the app, as serve.py does) and _headers (serve.py's caching, for the same reasons).

    py scripts/build_public.py            # -> dist/
    py serve.py --root dist --port 8818   # look at it before deploying
    npx wrangler pages deploy dist --project-name igt-planner
"""
import json
import re
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DIST = ROOT / "dist"

# Ours: generated, not cropped out of anyone's photograph. Keep in step with PHOTO_FREE in app.js.
PHOTO_FREE = {"brushed_steel.jpg", "canvas.jpg", "chair_mesh.png"}
BENCH = {"part.html", "part.js", "part.css"}
CATALOG = ["igt-catalog.json", "colors.json", "textures.json", "frame_fittings.json"]

HEADERS = """\
/catalog/*
  Cache-Control: no-cache
/web/vendor/*
  Cache-Control: public, max-age=86400
/web/tex/*
  Cache-Control: public, max-age=86400
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
"""
REDIRECTS = "/  /web/  302\n"


def mean_rgb(path):
    with Image.open(path) as im:
        return list(im.convert("RGB").resize((1, 1), Image.BOX).getpixel((0, 0)))


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "web" / "tex").mkdir(parents=True)
    (DIST / "catalog").mkdir()

    for f in WEB.iterdir():
        if f.is_file() and f.name not in BENCH:
            shutil.copy2(f, DIST / "web" / f.name)
    shutil.copytree(WEB / "vendor", DIST / "web" / "vendor")

    means = {}
    for f in sorted((WEB / "tex").iterdir()):
        if f.name in PHOTO_FREE:
            shutil.copy2(f, DIST / "web" / "tex" / f.name)
        elif f.suffix.lower() == ".jpg":             # a grain -- keep only its colour
            means[f"tex/{f.name}"] = mean_rgb(f)
        # *.png plan-view decals: dropped; textureOf() returns null for them under PUBLIC

    for name in CATALOG:
        shutil.copy2(ROOT / "catalog" / name, DIST / "catalog" / name)

    build = (DIST / "web" / "build.js").read_text(encoding="utf-8")
    build, n1 = re.subn(r"export const PUBLIC = false;", "export const PUBLIC = true;", build)
    build, n2 = re.subn(r"export const GRAIN_MEANS = \{\};",
                        "export const GRAIN_MEANS = " + json.dumps(means) + ";", build)
    if n1 != 1 or n2 != 1:
        raise SystemExit("build.js no longer has the lines this script rewrites")
    (DIST / "web" / "build.js").write_text(build, encoding="utf-8")

    (DIST / "_headers").write_text(HEADERS, encoding="utf-8")
    (DIST / "_redirects").write_text(REDIRECTS, encoding="utf-8")

    # The point of the exercise, checked rather than trusted.
    leaked = [p for p in DIST.rglob("*") if p.is_file() and (
        p.parent.name == "img" or p.name in BENCH
        or (p.parent.name == "tex" and p.name not in PHOTO_FREE))]
    if leaked:
        raise SystemExit(f"photographs in dist/: {leaked}")
    files = [p for p in DIST.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print(f"dist/: {len(files)} files, {size / 1e6:.1f} MB; {len(means)} grains drawn procedurally")


if __name__ == "__main__":
    main()
