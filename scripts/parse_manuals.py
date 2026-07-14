#!/usr/bin/env python3
"""Read the assembly manuals. They are the only place Snow Peak documents how it fits.

Everything the catalog knows about attachment so far was mined from marketing copy and
measured off photographs. Both are indirect. The manual is the primary source, and it was
sitting behind one link on every JP product page the whole time.

CK-119TR's, read by hand, immediately paid for the whole exercise:

  セット内容    天板x1, レールジョイントx2         <- the two grey clamps in the studio shot
  使用方法 (4)  レールジョイントを使用する場合は
                IGTフレームの長辺のレールに挿入します
                                                  <- a bamboo table can hook onto the frame's
                                                     LONG SIDE, via a rail joint. Nothing in
                                                     the copy or the photographs says this,
                                                     and the planner forbids it.
  使用方法 (2)  フックを引き出し回転させます        <- the hooks FOLD AWAY and swing out
  対応品番      CK-149/CK-150/CK-080/LV-210/LV-310 <- an explicit whitelist, and a short one
  脚            別売りのセット CK-109/112/113/114   <- which leg sets, by SKU

The fields below are the ones that carry rules the planner can enforce. Everything else is
kept as raw text: a manual is a document, not a schema, and pretending otherwise is how you
lose the sentence that mattered.

Usage:
  python parse_manuals.py            # -> catalog/manuals.json + manuals/<SKU>.pdf
"""

import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import fitz  # pymupdf

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
PDFS = ROOT / "data" / "manuals"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

SKU = re.compile(r"\b([A-Z]{2}-\d{3}[A-Z]{0,3})\b")

# A PDF's text layer comes out in DRAWING order, not reading order. In CK-119TR's manual the
# five numbered steps are emitted BEFORE the title, and the headings are set on black bars
# that get drawn later still. Splitting on "where does the heading appear" therefore
# recovered exactly one section out of eight -- and did it silently.
#
# So do not read the layout. Read the PATTERNS. A manual is written to a house style and the
# style is what is stable: contents are `<thing>x<n>`, steps are prefixed with circled
# digits, the whitelist follows one fixed sentence. None of that cares where on the page it
# landed.

CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"
FLAT = str.maketrans({"　": " ", "　": " "})


def clean(s):
    return re.sub(r"\s+", " ", s.translate(FLAT)).strip()


def steps(text):
    """The numbered steps -- where the mechanisms are actually named, and the only place
    レールジョイント appears at all."""
    hits = [(text.index(c), c) for c in CIRCLED if c in text]
    hits.sort(key=lambda h: CIRCLED.index(h[1]))     # by step number, not by position
    out = []
    for i, c in hits:
        # a step runs to the next newline that starts a new drawing run
        seg = text[i + 1:]
        end = min([seg.index(d) for d in CIRCLED if d in seg] + [len(seg)])
        # ...but the next circled digit may be far away in draw order, so cut at 2 blank-ish
        # lines instead when that happens
        seg = seg[:end]
        cut = re.split(r"\n(?=[^\s　])(?![^\n]*[。）])", seg, maxsplit=1)[0]
        out.append(clean(cut if len(cut) < len(seg) else seg)[:160])
    return [s for s in out if s]


def set_contents(text):
    """`天板×1  レールジョイント×2` -- the house style is <thing>x<n>.

    But so is `●サイズ：496×496×25mm`, which is not a thing you get in the box. A spec line
    announces itself: it starts with a bullet and carries a colon."""
    out = []
    for a, n in re.findall(r"([^\s\n×]+)×(\d+)", text):
        a = clean(a)
        if a.startswith("●") or "：" in a or a.isdigit():
            continue
        out.append(f"{a}x{n}")
    return out or None


def compatible(text):
    """The whitelist. One fixed sentence introduces it, and the note markers that follow it
    are exceptions, not targets -- so cut at the first one.

    This is a HARDER fact than anything the copy gives us: `そのほかの製品には対応して
    おりません` -- nothing else is supported. The planner should be enforcing it.

    MIND THE HEADING. `対応品番` appears in manuals that then say `以下の製品に取り付ける
    ことはできません` -- these products CANNOT be attached -- and list a BLACKLIST under it.
    The first version of this parser split on the heading and read those lists as targets,
    so it had the Connection Table attaching to the two things its own manual forbids, in
    bold, next to a warning about the table falling over. Match the SENTENCE, not the
    heading. Then go and parse the blacklist on purpose.
    """
    m = re.search(r"本製品は以下の品番に取り付けることができます。(.*?)(?:※|$)", text, re.S)
    if not m:
        return None
    return sorted(set(SKU.findall(m.group(1)))) or None


def incompatible(text):
    """`非対応品番` -- what this must NOT be attached to, and why. Snow Peak spells the
    reason out (転倒のおそれ: risk of tipping; 寸法不適合: dimensions do not fit), which is
    exactly the sort of rule a planner exists to enforce.

    Bound this by SHAPE, not by position. In draw order there is no such thing as "the text
    after the heading" -- the first attempt took everything downstream of the marker and
    swept the whole compatible list into the blacklist, so the Connection Table came out
    forbidden from the boards it is FOR. In a document where you cannot trust where a run
    landed, only match what the run looks like:

      prose  a consecutive run of `・<SKU><name>` bullets
      table  triples of <SKU> / <name> / <reason>, which is the 品番/品名/理由 header

    Anything looser is not conservative, it is inverted -- and getting a compatibility rule
    backwards is worse than not having it.
    """
    out = {}

    # Prose form: "...以下の製品に取り付けることはできません", a sentence or two of warning,
    # then a run of bullets. `[^・]*?` cannot run away: it stops at the first bullet.
    #
    # Match on a FLATTENED copy. Justified Japanese wraps mid-word -- LV-381's manual reads
    # `以下の製品に取\nり付けることはできません` -- so the phrase you are looking for is not
    # in the text as a string, only as a shape. (The same wrap hid every load limit.)
    #
    # And anchor the SKU to the bullet. LV-381's manual is bilingual on one page, and the
    # English half carries no bullets at all -- so a bullet allowed to run to the next one
    # ran to the END OF THE DOCUMENT, and the "blacklist" came back holding four thousand
    # words of warranty text with whatever SKU happened to be first in it.
    flat = re.sub(r"\n(?!・)", "", text)
    m = re.search(r"取り付けることはできません。[^・]*?((?:・[^\n]+\n?){1,8})", flat)
    if m:
        for sku_, name in re.findall(r"・\s*([A-Z]{2}-\d{3}[A-Z]{0,3})([^\n]{0,40})", m.group(1)):
            out[sku_] = clean(name) or None

    # Table form, introduced by the 品番/品名/理由 header, then triples.
    tab = re.search(r"品番\s*\n\s*品名\s*\n\s*理由(.*)", text, re.S)
    if tab:
        rows = re.findall(r"([A-Z]{2}-\d{3}[A-Z]{0,3})\s*\n([^\n]+)\n([^\n]+)", tab.group(1))
        for sku_, name, why in rows:
            out[sku_] = clean(f"{name} — {why}")

    return out or None


def leg_sets(text):
    """`※脚は付属しておりません。別売りのセットCK-109/112/113/114が必要です。`
    Only the first SKU is written in full; the rest are bare numbers."""
    m = re.search(r"別売りのセット\s*([A-Z]{2}-[\d/]+)", text.translate(FLAT))
    if not m:
        return None
    raw = m.group(1)
    prefix = raw.split("-")[0]
    return [f"{prefix}-{n}" for n in re.findall(r"\d{3}", raw)] or None


def spec(text):
    m = re.search(r"(●サイズ.*?)(?:対応品番|この度は|$)", text, re.S)
    return clean(m.group(1))[:400] if m else None


def max_load_kg(text):
    # Justified Japanese wraps mid-sentence, so the phrase arrives as `上に載せ\nる重量は30kg`.
    # Flatten before matching, or every load limit in the file goes missing.
    m = re.search(r"上に載せる重量は(\d+)kg", clean(text).replace(" ", ""))
    return int(m.group(1)) if m else None


def one(job):
    sku, url = job
    pdf = PDFS / f"{sku}.pdf"
    try:
        if not pdf.exists():
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            pdf.write_bytes(urllib.request.urlopen(req, timeout=40).read())
        with fitz.open(pdf) as d:
            text = "".join(pg.get_text() for pg in d)
            pages = d.page_count
    except Exception as e:  # noqa: BLE001
        return sku, {"url": url, "error": str(e)}

    bad = incompatible(text) or {}
    bad.pop(sku, None)          # a manual does not forbid its own product; that is the header

    rec = {
        "url": url,
        "pdf": f"data/manuals/{sku}.pdf",
        "pages": pages,
        "compatible_with": compatible(text),
        "incompatible_with": bad or None,
        "set_contents": set_contents(text),
        "spec": spec(text),
        "leg_sets": leg_sets(text),
        "max_load_kg": max_load_kg(text),
        "steps": steps(text),
        "rail_joint": "レールジョイント" in text,
    }
    return sku, {k: v for k, v in rec.items() if v not in (None, [], "", False)}


def main():
    imgs = json.loads((CATALOG / "images.json").read_text(encoding="utf-8"))["images"]
    jobs = [(sku, r["manual"]) for sku, r in imgs.items() if r.get("manual")]
    PDFS.mkdir(parents=True, exist_ok=True)

    with ThreadPoolExecutor(max_workers=6) as ex:
        recs = dict(ex.map(one, jobs))

    (CATALOG / "manuals.json").write_text(json.dumps({
        "_comment": "Parsed assembly manuals -- the PRIMARY source for how the system fits "
                    "together, as against copy (marketing) and photographs (indirect). "
                    "`compatible_with` is Snow Peak's own whitelist and it is exhaustive: "
                    "the manuals say in terms that nothing else is supported.",
        "manuals": recs,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    ok = [s for s, r in recs.items() if "error" not in r]
    comp = [s for s in ok if recs[s].get("compatible_with")]
    rail = [s for s in ok if recs[s].get("rail_joint")]

    # Windows consoles are cp1252 and will not print a katakana. Say it in ASCII.
    print(f"{len(ok)}/{len(jobs)} manuals read")
    print(f"  {len(comp)} carry an explicit compatibility whitelist")
    print(f"  {len(rail)} mention the RAIL JOINT (hooking onto the frame's LONG rail)")
    for s in comp:
        print(f"    {s:10} -> {', '.join(recs[s]['compatible_with'])}")
    bad = {s: recs[s]["incompatible_with"] for s in ok if recs[s].get("incompatible_with")}
    if bad:
        print(f"\n  BLACKLISTS ({len(bad)}) -- the manual says these must NOT be attached:")
        for s, v in bad.items():
            print(f"    {s:10} -/-> {', '.join(v)}")
    if rail:
        print(f"\n  rail-joint parts: {', '.join(rail)}")
    legs = {s: recs[s]["leg_sets"] for s in ok if recs[s].get("leg_sets")}
    if legs:
        print(f"\n  leg sets named by the manual:")
        for s, v in legs.items():
            print(f"    {s:10} -> {', '.join(v)}")


if __name__ == "__main__":
    sys.exit(main())
