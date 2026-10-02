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

    py scripts/build_public.py            # -> dist/      (prod: igt.iqis.app)
    py scripts/build_public.py dev        # -> dist-dev/  (dev:  igt-dev.iqis.app -- experimental on, noindex)
    py serve.py --root dist --port 8818   # look at it before deploying
    py scripts/deploy.py prod|dev         # build + smoke + deploy (+ tag a prod release)
"""
import json
import subprocess
import sys
import re
import shutil
from pathlib import Path

import markdown
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
CHANNEL = sys.argv[1] if len(sys.argv) > 1 else "prod"
if CHANNEL not in ("prod", "dev"):
    raise SystemExit("usage: build_public.py [prod|dev]")
DIST = ROOT / ("dist" if CHANNEL == "prod" else "dist-dev")
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def commit():
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True,
                               text=True, check=True).stdout.strip()
        return sha + ("*" if dirty else "")       # * = built from uncommitted changes
    except Exception:
        return ""

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

AI_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Siqi's IGT Planner — with AI</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-180.png">
<meta name="description" content="Design a Snow Peak IGT layout with your own AI agent; the planner's open rules check it.">
<style>
:root { color-scheme: light dark; --bg: #f7f8fa; --panel: #fff; --ink: #1b1e24; --dim: #5b6472;
  --line: #e2e5ea; --code: #f1f3f6; --accent: #2563eb;
  --sans: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Noto Sans", "Hiragino Sans", sans-serif;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #14161a; --panel: #1b1e24; --ink: #e6e8ec; --dim: #8b93a1;
  --line: #2b3038; --code: #22262d; --accent: #6b9cf0; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 var(--sans); }
nav { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; align-items: center; padding: .7rem 1rem;
  background: var(--panel); border-bottom: 1px solid var(--line); font-size: .9rem; }
nav b { font-weight: 650; } nav a { color: var(--dim); text-decoration: none; } nav a:hover { color: var(--ink); }
main { max-width: 760px; margin: 0 auto; padding: 2rem 1rem 4rem; }
h1 { font-size: 1.8rem; line-height: 1.2; letter-spacing: -.01em; margin: .5rem 0 1rem; }
h2 { font-size: 1.15rem; margin: 2.2rem 0 .6rem; }
a { color: var(--accent); }
code { font: .88em var(--mono); background: var(--code); padding: .1em .3em; border-radius: 4px; }
pre { background: var(--code); padding: .9rem 1rem; border-radius: 8px; overflow-x: auto; line-height: 1.45; }
pre code { background: none; padding: 0; }
blockquote { margin: 1rem 0; padding: .8rem 1rem; background: var(--panel); border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 8px; }
blockquote p { margin: .3rem 0; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; display: block; overflow-x: auto; }
th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
</style>
</head>
<body>
<nav><b>Siqi's IGT Planner</b><a href="./">Open the planner</a><a href="https://github.com/iqis/igt-planner">Source</a><a href="/llms.txt">llms.txt</a></nav>
<main>
{{BODY}}
</main>
</body>
</html>
"""


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
    shutil.copytree(WEB / "i18n", DIST / "web" / "i18n")          # the interface's languages

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
    stamps = {"CHANNEL": json.dumps(CHANNEL), "EXPERIMENTAL": "true" if CHANNEL == "dev" else "false",
              "VERSION": json.dumps(VERSION), "COMMIT": json.dumps(commit())}
    n3 = 0
    for k, v in stamps.items():
        build, n = re.subn(rf"export const {k} = [^;]*;", f"export const {k} = {v};", build)
        n3 += n
    if n1 != 1 or n2 != 1 or n3 != len(stamps):
        raise SystemExit("build.js no longer has the lines this script rewrites")
    (DIST / "web" / "build.js").write_text(build, encoding="utf-8")

    # The AI entry: ONE source (docs/AI.md), two forms -- llms.txt at the site root for agents, and a
    # rendered page for people, linked from the planner's header.
    ai_md = (ROOT / "docs" / "AI.md").read_text(encoding="utf-8")
    (DIST / "llms.txt").write_text(ai_md, encoding="utf-8")
    body = markdown.markdown(ai_md, extensions=["fenced_code", "tables"])
    (DIST / "web" / "ai.html").write_text(AI_PAGE.replace("{{BODY}}", body), encoding="utf-8")

    # One page per part (dist/p/<SKU>/), drawn by the built planner itself -- so it runs on dist/.
    subprocess.run(["node", str(ROOT / "scripts" / "part_pages.mjs"), str(DIST), CHANNEL], check=True)

    headers = HEADERS
    if CHANNEL == "dev":
        # the dev site is public but not for search: it must never outrank the real one
        headers += "/*\n  X-Robots-Tag: noindex, nofollow\n"
        (DIST / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
        (DIST / "sitemap.xml").unlink(missing_ok=True)
    (DIST / "_headers").write_text(headers, encoding="utf-8")
    (DIST / "_redirects").write_text(REDIRECTS, encoding="utf-8")

    # The point of the exercise, checked rather than trusted.
    leaked = [p for p in DIST.rglob("*") if p.is_file() and (
        p.parent.name == "img" or p.name in BENCH
        or (p.parent.name == "tex" and p.name not in PHOTO_FREE))]
    if leaked:
        raise SystemExit(f"photographs in dist/: {leaked}")
    files = [p for p in DIST.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print(f"{DIST.name}/ ({CHANNEL} v{VERSION}): {len(files)} files, {size / 1e6:.1f} MB; "
          f"{len(means)} grains drawn procedurally")


if __name__ == "__main__":
    main()
