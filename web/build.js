// Which planner this is. As checked in it is the full one: photo grain, plan-view decals, hover
// thumbnails -- for the owner, over the tailnet. scripts/build_public.py overwrites this file in
// dist/ with PUBLIC = true and the mean colour of every photo texture it leaves behind, and the app
// then draws its wood on a canvas (proctex.js) and ships no Snow Peak photograph at all.
export const PUBLIC = false;
export const GRAIN_MEANS = {};
// The release channel and what it shows. "prod" = igt.iqis.app; "dev" = igt-dev.iqis.app, where
// EXPERIMENTAL features are switched on (the AI entry, tents) and the header wears a DEV badge;
// "local" = this checkout, which sees everything. VERSION comes from the repo's VERSION file and
// COMMIT from git, both stamped by build_public.py.
export const CHANNEL = "local";
export const EXPERIMENTAL = true;
export const VERSION = "";
export const COMMIT = "";
