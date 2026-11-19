# Changelog

All notable changes to Siqi's IGT Planner. Versions follow [Semantic Versioning](https://semver.org):
a new feature bumps the minor number, a fix the patch. Released versions are on
[igt.iqis.app](https://igt.iqis.app); what is coming next runs on [igt-dev.iqis.app](https://igt-dev.iqis.app).

## [Unreleased]

## [1.4.5] — 2026-11-18

- **Stainless lid-trays read as silver.** At most angles they came out gunmetal, darker than the
  frame they sit in.

## [1.4.4] — 2026-11-18

- **Small things.** The Light bamboo boards show their finer strips. The lounge cushion has the
  seam it folds along, and a finer weave. The grill plate on the BBQ box and the Takibi is a pan
  with its two handle tabs.

## [1.4.3] — 2026-11-18

- **Burners.** The Flat Burner is a burner: an open bowl with the head in it under a wire grate,
  on a one-unit plate (its published 270 x 410 is the stove standing on its own wire legs). The
  Grill Burner sits level with the table, its water tray and stand hanging below; it had floated on
  four posts. The Double Burner has wire racks over its well and, in a frame, no windscreen, as in
  Snow Peak's own pictures. The LI Stove, its joint frame and the BBQ box are redrawn from the photos.
- **Collapsible frames have silver end bars** with black corner blocks; they were an all-black ring.
- **Two frames joined end to end share the legs at the joint.** That is what Snow Peak's photo of
  the Connection Hook shows: two legs under the joint, not four. A joined pair now stands on six
  legs and the bill carries one leg set fewer; "4 legs" is still a choice on the joined frame. A
  design saved before this with joined frames now shows the shared joint.
- **Bamboo boards are their real thickness** (14 mm; 9 on the Light boards) with their brackets,
  wire hooks and leg blocks. Corner boards are whole (two bites were missing from each). Boards no
  longer sink into the board they hook onto: they sit 11.5 mm apart, 7.5 from a frame's end.
  Slide-in extensions carry their brackets underneath, where they are.
- **Extension IGT's legs stay on its stand** and the two tops overhang them when it is opened.
  **Entry IGT** has its wide aluminium frame, filled by the boards. **IGT Slim** is 824 long over
  its top (940 over the feet) in brown teak slats.
- **Takibi My Table** is the folding table it is. **Takibi Fire & Grill** stands on its real legs
  in bright steel. The **Jikaro**'s wire legs hang along the slant sides of each panel. The
  **Connection Table** and the **Grill Bridge** are redrawn.
- **Chairs on their real frames**: the Take! chair's deep canvas tub, the Folding Bench with its
  tubes along the cloth, the Folding Chair's raked back and floor skids, the Low Beach Chairs'
  scissor frames, the Campfield sofa's thin deck and tall back.
- **Hanging Rack 2 Frame** is solid and its measured size (555 x 354 x 450); the Hanging Shelf
  passes between the rails.
- **HD Tarp Recta L** is 550 x 440 cm (it was 549 x 427, feet turned back into centimetres).

## [1.4.2] — 2026-11-15

- **The frame is drawn as it is.** The seat a module's rim rests in is on the inside of each rail; it
  had been cut into the outside, which left a step down the outer edge of every table. The black end
  pieces are solid blocks the height of the rail, the frame is its published length (it was 16 mm
  over), and the rivets and leg socket sit in the rail, where the leg stands.
- **Bamboo is bamboo-coloured.** Every bamboo top on this site was orange-brown: the wood's colour was
  being applied twice. Boards, inserts, the slide-in extensions and the Entry and Extension IGT tops
  are pale honey now.
- **Mesh trays stay in their own slot.** The one-unit trays have straight rims at the published
  245 x 356 (they bulged, and overlapped the tray beside them). The half-unit trays no longer hang
  loose wires under their neighbours, and are the real basket: 110 x 288 under black end panels.
- **Takibi My Table is a table**, not a solid block.
- **Hanging Rack 2 Frame shows both its sides.** The near one was not being drawn.
- **HD Tarp Hexa Evo Pro is its real size**, about 6.4 x 5.65 m. It was drawn at 11.6 x 9.2 m, the
  space its ropes take up.
- **Sizes that ran over**: gear bags (40 mm long), the cooler (24 mm wide and tall) and the bamboo
  boards (5 mm each way) are now the size Snow Peak publishes.
- **Entry IGT, Extension IGT and IGT Slim stand on the ground** (their feet stopped 10-20 mm above
  it), and the black Entry IGT is black.

## [1.4.1] — 2026-10-15

- **Opting out of the counts.** Open the site once with `?notrack=1` and this browser sends neither the
  anonymous counts nor page views; `?notrack=0` turns them back on. Page views now load only on
  igt.iqis.app, from the page itself, instead of being injected by Cloudflare into every page.

## [1.4.0] — 2026-10-15

- **Anonymous counts.** The site now counts how far people get through the tour and which examples
  they open -- an event name and nothing else: no cookie, no address, no id.
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
