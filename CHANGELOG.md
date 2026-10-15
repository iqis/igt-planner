# Changelog

All notable changes to Siqi's IGT Planner. Versions follow [Semantic Versioning](https://semver.org):
a new feature bumps the minor number, a fix the patch. Released versions are on
[igt.iqis.app](https://igt.iqis.app); what is coming next runs on [igt-dev.iqis.app](https://igt-dev.iqis.app).

## [Unreleased]

- **The examples open at once.** Their pictures are drawn when the site is built, not in your browser
  each time: opening **examples** went from about 3.5 seconds of a frozen page to instant.

- **Click a board, it goes on.** With a table selected, clicking a bamboo board (or a slide-in) in the
  library hooks it straight onto a free edge of that table -- an end before a long rail, the end nearer
  you first. Hovering shows it there before you click. Nothing selected and only one frame on the
  page: onto that frame. Nowhere for it: it floats as before, to be dragged onto an edge.

## [1.3.2] — 2026-10-15

- **https only.** Plain http now always forwards to https, and browsers are told (HSTS) to use https
  from then on.

## [1.3.1] — 2026-10-14

- **A frame from the library is set down straight away**, not left as a see-through ghost waiting for
  **lock** -- the step newcomers stumbled on. Tables and chairs too. Only a board still lands floating,
  until you hook it onto an edge. The guided tour is one step shorter for it.
- **The "Under the tarp" example's picture** is framed in close, so the table under the roof shows.

## [1.3.0] — 2026-10-13

- **A guided tour.** "Click here, then here", on the real planner: nine short steps build a small camp
  kitchen (a frame, setting it down, a burner, a tray, a bamboo board on the blue dot, the height, the
  view, the bill, sharing). Each step waits until you have done it. It runs on a page of its own, is
  offered once on a first visit, and lives in the header (**tour**), in About, on any empty page, and at
  `#tour`.
- **Ten examples, one click away.** Six new starter layouts -- a first table, an L-shaped kitchen, stand &
  sit (a height adjuster between two heights), a slide-in board, solo & light, and a family kitchen under
  a tarp -- and an **examples** button in the header that shows them all as pictures.
- **Ridge: how the ropes were tightened.** Every tarp now has a "Ridge" row: taut (mains first, the
  ridge pulled straight -- as before), or wings first, the way both Snow Peak manuals say to pitch, with
  the mains taken up soft, medium or firm. Wings first, the ridge is free: it curves, and the pole tips
  stand up out of it like horns. Pitched the manual's way the HD Hexa L pegs out within 3% of Snow
  Peak's published footprint (taut was 8% short across).
- **Tarps pitch the manual's way by default**: wings first, then the mains, every rope alike. "Taut" is
  still one tap away in the Ridge row.
- **Fix: a symmetric pitch hung lopsided** (up to 23 cm on the Octa) -- the new cloth mesh had its bias
  running one way. Now mirror corners agree to within millimetres.
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
