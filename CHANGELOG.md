# Changelog

All notable changes to Siqi's IGT Planner. Versions follow [Semantic Versioning](https://semver.org):
a new feature bumps the minor number, a fix the patch. Released versions are on
[igt.iqis.app](https://igt.iqis.app); what is coming next runs on [igt-dev.iqis.app](https://igt-dev.iqis.app).

## [Unreleased]

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
