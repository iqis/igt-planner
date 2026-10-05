# Changelog

All notable changes to Siqi's IGT Planner. Versions follow [Semantic Versioning](https://semver.org):
a new feature bumps the minor number, a fix the patch. Released versions are on
[igt.iqis.app](https://igt.iqis.app); what is coming next runs on [igt-dev.iqis.app](https://igt-dev.iqis.app).

## [Unreleased]

- **Ridge: how the ropes were tightened.** Every tarp now has a "Ridge" row: taut (mains first, the
  ridge pulled straight -- as before), or wings first, the way both Snow Peak manuals say to pitch, with
  the mains taken up soft, medium or firm. Wings first, the ridge is free: it curves, and the pole tips
  stand up out of it like horns. Pitched the manual's way the HD Hexa L pegs out within 3% of Snow
  Peak's published footprint (taut was 8% short across).
- **Better cloth.** Tarps are now woven: threads run along and across the ridge, as real cloth's do,
  instead of fanning out from the centre -- which had hung a free ridge off one point, as a V.

- **Tarp mode** (dev site for now): open a tarp on its own, full screen -- 3D beside a plan view, nothing
  else in the way (the rest of the layout can come back as see-through ghosts). Drag any peg in the plan:
  out, and its rope runs flatter and the corner rides up; in, and the corner comes down. The cloth
  re-pitches as you drag. Every rope shows how much of it the peg needs and at what angle, and turns red
  when the peg is out of its reach. Pegs are saved with the tarp, shared with the link, and undoable.

## [1.2.0] — 2026-10-04

- **The TAKIBI Tarp Octa pitches as cloth**: its cut is read from the vector plan in Snow Peak's manual
  and scaled to the published 510 × 450 cm. Choose its two main poles, guy or sub-pole each of its eight
  corners, and raise either wing centre on a 140 cm Wing Pole; the bill carries the poles. The end
  corners' ropes share the main poles' pegs, as the manual has it, and the planner says when a pitch
  breaks the manual's rule for a fire underneath (two 280s, inner roof on, one fire pit in the centre).
- **The Octa hangs the way its manual draws it**: every rope is pegged at the manual's ~45 degrees, the end
  corners rope to the main poles' pegs, and the corners now sit where the manual's side elevation puts
  them (side corners under a metre) -- so a raised wing centre stands out. The guyed length is within 1%
  of Snow Peak's 880 cm.
- **Tarp corners have letters**: the pitch menu names every pole point A, B, C... around the tarp, and a
  selected tarp shows the same letters in 3D (blue where a pole stands).

## [1.1.1] — 2026-10-04

- **Tarps sold with their own poles**: the TAKIBI Hexa M and the Amenity Hexa L come only as sets,
  poles included (the Amenity's are steel, not the Wing Poles sold apart). They now weigh what the set
  weighs and no longer add main poles to the bill a second time.
- **TAKIBI Tarp Octa** is sold without poles: its bill now carries the two 280cm Wing Poles its
  manual requires (the minimum pitch, and the only one allowed with a fire under it).

## [1.1.0] — 2026-10-04

- **Tarps weigh in, poles and all**: every tarp now has a weight, and a pitched tarp puts its poles
  on the bill -- the two main poles at the lengths you chose, and an upright for each wing corner
  you raised (sold-in-pairs poles bill as sets). Change a 280 to a 240 and the carry weight follows.

## [1.0.0] — 2026-10-02

The first numbered release: everything the public planner has done since it went up on
igt.iqis.app (2026-09-30).

- **Plan in 3D, to the millimetre**: frames, hook-on boards, corners, slide-in extensions, modules,
  the Jikaro fire ring, chairs and tarps, placed by their measured hooks and brackets. The rules say
  what doesn't fit, what the manuals forbid, and what the kit weighs.
- **Tarps as cloth**: HD Hexa and Recta tarps are solved as cloth that cannot stretch. You set the
  pole heights, a sub-pole on any wing corner, and the pole lean; the planner works out the covered
  ground, how low the wings come, and the footprint with ropes and pegs. It is calibrated against
  Snow Peak's published guyed footprint.
- **Part pages**: what each part fits onto and what fits onto it, from the same rules. In the app,
  and as public pages at `/p/<SKU>/`.
- **Starter templates**, pages with their own scenes, undo, blocks, and snapshots (a plate or a
  view).
- **Sharing**: short links, carrying the page's name and an optional signature; WeChat QR, RedNote
  caption, `#IGTLayout`.
- **Six languages**: English, 简体中文, 繁體中文, 日本語, 한국어, ไทย. Part names stay official.
- Phone layouts, portrait and landscape.
