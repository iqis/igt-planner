// Which planner this is. As checked in it is the full one: photo grain, plan-view decals, hover
// thumbnails -- for the owner, over the tailnet. scripts/build_public.py overwrites this file in
// dist/ with PUBLIC = true and the mean colour of every photo texture it leaves behind, and the app
// then draws its wood on a canvas (proctex.js) and ships no Snow Peak photograph at all.
export const PUBLIC = false;
export const GRAIN_MEANS = {};
