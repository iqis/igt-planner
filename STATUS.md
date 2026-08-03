# Status — 2026-08-02, end of the launch/modeling phase
> **2026-08-02 post-wrap:** the parked queue's #1 shipped — **scale figures** (adult ~7.5-head
> / toddler ~4.5-head canons, standing/seated, height chips off published medians, BOM-exempt,
> pose in INTENT; smoke 18 checks). Also fixed: palette search had silently dropped every
> section added after the original id list (Cooking/trays/racks/freestanding). `41ca460`.

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
- **CF Pages + Access hosting** ($0, plan in memory) and the full-public IP cleanup trio.

## Standing references

- Full findings: `data/launch-review-2026-07-29.json`, `data/model-audit-2026-07-29.json`
- Smoke: `npm install` once, `npm run smoke`; hook at `scripts/hooks/pre-push`
- The bench (`/web/part.html`) is owner-only tooling; `/anno` writes need `serve.py --anno`
