# Status — 2026-08-02, end of the launch/modeling phase
> **2026-08-02 post-wrap:** the parked queue's #1 shipped — **scale figures** (adult ~7.5-head
> / toddler ~4.5-head canons, standing/seated, height chips off published medians, BOM-exempt,
> pose in INTENT; smoke 18 checks). Also fixed: palette search had silently dropped every
> section added after the original id list (Cooking/trays/racks/freestanding). `41ca460`.

> **2026-09-30: PUBLIC at https://igt.iqis.app** (no login; igt.gardenplace.cc 301s there via a redirect rule in that zone). `py scripts/build_public.py &&
> npx wrangler deploy` -- Workers static assets (wrangler steered new Pages projects there), custom
> domain via `wrangler.jsonc`. The public build ships NO Snow Peak photo: grains drawn by
> `web/proctex.js` at each photo's mean colour, plan-view decals and hover thumbnails dropped, bench
> + `img/` excluded, "not affiliated" line in the header; `SMOKE_ROOT=dist npm run smoke` asserts
> no photo is requested. The repo/tailnet planner is unchanged (`web/build.js` PUBLIC=false).
> Redeploy after any catalog or app change -- nothing auto-deploys.

> **2026-10-01: short links.** `worker/index.js` (the site's only code; runs for `/api/*` and `/s/*`
> only): POST `/api/s` stores the `#d=` payload in KV `igt-short` under an 8-char hash of it (same
> design = same id; payload must gunzip to a real layout; 20 mints/min/IP), `/s/<id>` 302s to
> `/web/#d=…`, unknown ids to `/web/#missing=`. The share card mints one and falls back to the long
> link wherever there is no Worker (serve.py, tailnet) -- so short links exist only on the public site.
> "Copy the full link" stays in the card. Test locally: `npx wrangler dev --port 8830 --local`.

> **2026-10-01: part pages + starter templates.** `core.partInfo(sku)` = what a part fits onto /
> what fits onto it, grouped by place (end/rail/edge/opening/bay), derived by evaluating every part
> standing alone and reading its next moves -- the menus' own rules, no second list. In-app page:
> `openPartPage` (the (i) on a library row, the selection toolbar, a module's menu, `#part=SKU`),
> with the planner's own drawing (`docShot`: the live renderer on a one-part scene, synchronous).
> Public: `scripts/part_pages.mjs` (run by build_public) writes `dist/p/<SKU>/` -- English HTML +
> `shot.jpg` drawn by the built planner in headless Chrome -- plus sitemap.xml / robots.txt.
> Templates: `web/templates.js` (4 layout docs, smoke checks each buildable), in the layouts menu and
> as picture cards on any empty page.

> **2026-10-02: v1.0.0 released; channels.** prod = igt.iqis.app (`dist/`), dev = igt-dev.iqis.app
> (`dist-dev/`, wrangler env `dev`, own KV + rate limit, EXPERIMENTAL on: AI entry + tents; noindex,
> DEV badge). `web/build.js` stamps CHANNEL/EXPERIMENTAL/VERSION/COMMIT (`*` = dirty tree).
> RELEASE: bump `VERSION` + add `## [x.y.z]` to CHANGELOG.md, commit on main, `py scripts/deploy.py
> prod` (refuses dirty/non-main/already-tagged/no-entry; smokes repo + dist; deploys; tags + pushes).
> Dev any time: `py scripts/deploy.py dev`. Gate new experimental UI on `EXPERIMENTAL` from build.js.

> **2026-10-02: share links carry the page name + an optional author.** Share card has a "sign it"
> field (localStorage `igt.author`); links/exports carry `name` (not default "Page n") and `author`
> (signer, else the page's received author -- last sharer only, no chain). Landing names the new page
> after it and stores `author` on the page (tab tooltip, "by X" note); the snapshot plate's byline says
> "by X". Smoke round-trips both.

> **2026-10-02: AI entry = under development.** The header's AI link stays `hidden`; README and
> docs/AI.md (-> /llms.txt, /web/ai) now say so. The engine + `scripts/igt.mjs` are the working part.

> **2026-10-04: TAKIBI Octa = solved cloth (v1.2.0).** `tarp.js octa()`: cut from the manual's VECTOR plan
> (TP-430_manual_web.pdf p.4 path 477 -> `scripts/derive_octa_pattern.py`): along the ridge as drawn,
> across stretched to the published 450 (the plan is the pitched tarp, foreshortened across). New vertex
> role `mid` = wing centre: free cloth (no rope) or a 140 Wing Pole + 7 m 二又; stored in `pitch.corners`
> (null = down), billed as a MAIN pole (TP-140). End corners carry `peg: "main"`: their 3 m rope and the
> main 二又 leg share one peg (manual), which sets the main rope's reach. Calibration: along-ridge guyed
> 9.6 m vs published 8.8 (smoke 12%). ACROSS the published 750 is UNREACHABLE (450 cloth + 2 m ropes max
> 6.56 m, proof in the octa() comment) -- the 750 and the drawing are one schematic; only 450 is trusted.
> UI: wing-centre chips + the manual's fire rule (warn unless both mains are 280).

> **2026-10-02: tarps + poles on the bill.** Tarp weights in overrides `_add` (`weight_source` says
> which: the H/tarp-only listing). TP-440 / TP-851 are sold ONLY as sets with their own main poles
> (`poles_included: ["main"]`): weight = the set, the bill adds no main poles. TAKIBI's are aluminium Wing
> Poles; the Amenity's are STEEL (owner caught both, 2026-10-04).
> Poles are catalog parts, role `pole` (never a node, no library row, no part page): TP-001/002/003/140
> Wing Poles, TP-022 Alu 170 (main 170 AND sub 170 -- no 170 Wing Pole is listed), TP-080 / TP-161 sold
> as pairs (`per_set` 2). `core.bomLines` bills a footprint node only if it is a tarp: cloth +
> `tarpPoleSkus(n)` from `tarp.polesOf(sku, pitch)`. Tents/shells stay off the bill. Tarps without a
> cut (Octa, Evo Pro, Penta) bill the cloth only. Smoke holds the 8.8 kg example. Not billed yet: stakes.

> **2026-10-02: shelters = tarps only; tarps are solved cloth.** Tents/shells dropped from the library
> (models not good enough; still load from old layouts). The "layer lock" is gone -- `pickNode()`
> prefers anything that is not a footprint under the pointer, so a tarp never steals a click and can
> always be picked. `web/tarp.js`: flat pattern (curved cut) -> ring mesh -> position-based cloth
> relaxation, pitched TAUT: the ridge is pinned pole top to pole top with a gentle 2% dip (RIDGE_SAG;
> owner: taut = straight with a slight soft dip, not a free sag), the poles' plan spacing follows from the
> ridge length; links are TENSION-ONLY and the bias (quad diagonals) is soft -- rigid diagonals or
> compression-resisting links pleated the cloth under a dipping ridge; gravity is weighted by node AREA;
> guyed wings pull out+down along the centre line, sub-poles pin a corner's height; poles LEAN (0-15 deg,
> default 5): top = length x cos, foot inboard by length x sin. Guy ropes have LENGTHS (manual: 2 m / 3 m,
> 10 m 二又 mains) and pull along the straight rope to their peg, re-aimed as the corner settles; the
> pegs are solved too (`sol.anchors[].pegs`, `sol.guyed`), and CALIBRATION = Snow Peak's published
> guyed footprint (Hexa L 780 x 1220 -> solved 7.2 x 11.7, smoke holds 10%). The earlier photo-based
> 0.2h wing height was wrong: matching the footprint puts guyed wide wings ~1.0 m, Hexa L ~13 m2.
> Smoke also holds the gentle ridge dip, single-corner sub-pole, sub-poles adding area. Node state `n.pitch = {a, b, corners: {NR,WR,WL,NL | CR1..}, lean}` (each wing corner its own
> sub-pole or null=guyed; `left`/`right` still read as a side's default) (in INTENT; legacy numeric `config` = both
> poles). Patterns: TP-861/862 from the manual drawing (not to scale; narrow end 400 / wide end 500 --
> NOT symmetric end to end), TP-440/851 estimated from them, Rectas = published rectangle.
> Penta / Octa / Hexa Evo Pro still use the old fixed-footprint drawing. ~140 ms per solve, cached.

**Verdict: ready to share with family over the tailnet.** The code side of launch is done;
two operational steps remain, both the owner's (below).

## What this phase shipped (2026-07-29 → 08-02)

- **Launch hardening** — a 12-agent adversarial review (42 confirmed findings,
  `data/launch-review-2026-07-29.json`), then every P0/P1 fixed and the fixes re-reviewed:
  share links land as a NEW page instead of destroying the recipient's book; catalog boot
  fails loudly instead of dead-silent; `/anno` is 403 unless `--anno`; path-aware caching;
  multi-touch pinch safety; 44px touch targets; three-state hint; the works.
- **Visual polish** — word-button toolbar, 4.5:1 contrast, per-theme `color-scheme`,
  two radius tokens, focus rings.
- **Palette taxonomy** — categories follow the catalog's own attach mechanisms
  (hook / slide / slot / hang); frames joined the normal rows; slot modules are browsable.
- **Model fidelity, three rounds** — the 7-family audit (`data/model-audit-2026-07-29.json`)
  cleared: shadows/fog/clearcoat scene pass, procedural GS-450R, frame end caps, GP-040 wire
  frame, LV-310 A-stand, soft tubs, TTA hardware, hung-cloth chairs, Jikaro's four legs, the
  recess AO crease. Physics rules: the gas line needs a long-rail exit (from the manuals).
- **Shelters** — all 9 tarps STAND (hexa catenary, recta 6-pole roof, penta wedge, octa),
  each with a Wing Pole length option; the Land Lock stands with two-tone crown, faceted
  frames, huge windows, and openable front/rear awnings — the honest ceiling of
  measurement-plus-photo procedural modeling.
- **Engineering floor** — on-demand rendering (an idle scene draws ZERO frames; a phone
  stays cool) and a 15-check smoke test (`npm run smoke`) wired into a pre-push hook.
  Live-fire tested: a planted regression was caught by exactly its assertion and the push
  was blocked.

## Owner's two steps before sharing the link

1. Install the keepalive task (elevated PowerShell):
   `powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1`
   — then kill the hand-started `pythonw` on 8812 and let the task respawn it.
2. A phone dry-run over cellular (WiFi off): open the tailnet URL, place a frame, hook a
   board, round-trip a share link.

## Parked, in priority order

- ~~Human figure for scale~~ — DONE 2026-08-02 (`41ca460`), see note at top.
- ~~Layout → PNG export~~ — DONE 2026-08-02 (`26b7c47`): the "photo" button composes a plate
  (hero view + ortho plan with scale bar + grouped bill + carry weight); phone → share sheet,
  desktop → download. Smoke = 19 checks.
- **Heat-clearance rule** — MINED 2026-08-02/03, **implementation on hold by owner**. All seven
  burner/fire manuals read (scans → fitz → images); clauses + the 4-rule proposal live in
  `data/heat-clauses-2026-08-02.json` (local-only). The headline: clearance scales with output
  (GS-450R/355 = 1m up/30cm around; GS-1000 = 2m/1m; GS-230 & charcoal = never under anything
  flammable), tents are a CO red-line, CK-160 charcoal explicitly bans wood boards/gas devices
  as IGT neighbours. When the go comes, start from the JSON's `proposed_rules` block.
- **Heat-clearance rule** from the manuals (M) — the gas-exit rule's sibling.
- **Real campsite pads** from the campground data (M, cross-project design chat first).
- **Tents/shells bodies** — needs owner resources (photogrammetry of owned tents, or an
  image-to-3D account); procedural is at its ceiling.

## Standing references

- Full findings: `data/launch-review-2026-07-29.json`, `data/model-audit-2026-07-29.json`
- Smoke: `npm install` once, `npm run smoke` (+ `SMOKE_ROOT=dist` for the public build); hook at `scripts/hooks/pre-push`
- The bench (`/web/part.html`) is owner-only tooling; `/anno` writes need `serve.py --anno`
