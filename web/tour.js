// The guided tour: "click here, then here", on the real planner. Each step points at one thing and
// WAITS for the person to do it -- the step's `done` reads the design, so the tour advances because the
// frame is really there, not because a Next button was pressed. Steps with nothing to do (look at the
// view, read the bill) have a Next button instead.
//
// Nothing is blocked: the spotlight is a hole drawn with a box-shadow and takes no pointer events, so
// the whole app stays usable underneath. The tour runs on a page of its own -- a new empty page called
// "Tutorial" -- so it never touches the person's own designs.
//
// app.js hands in what the tour may read and do (initTour); the tour keeps no copy of the design.
import { t } from "./i18n.js";

const LS_SEEN = "igt.tour";
let api = null;
let step = -1, raf = 0;
let root, ring, card, dot;
let scrolledTo = null;          // the palette row last scrolled into view (once per target)

const frames = () => api.nodes().filter(n => n.kind === "frame");
const isFrame = n => !!n && n.kind === "frame";
const hooked = () => api.nodes().some(n => n.kind === "ext" && n.host != null);
const BURNERS = /^(GS-|GP-040|CK-160)/;

/** The steps. `at` returns the element (or a {x, y} point, client px) to point at; null = no spotlight.
 *  `sheet` says which phone sheet should be open (the parts list lives in a sheet there). `text` may
 *  pick its words from the state, so a step can say "select the frame first" when it has to. */
const STEPS = [
  { id: "hello", next: true },
  {
    id: "frame", sheet: "parts",
    at: () => row("#add", "CK-150"),
    done: () => frames().length > 0,
    then: () => api.fit(),             // a new frame lands in front of the layout; bring it to the middle
  },
  {
    id: "burner", sheet: "parts",
    at: () => isFrame(api.sel()) ? row("#cooking", "GS-450R-US") : frameAnchor(),
    key: () => isFrame(api.sel()) ? "tour.burner" : "tour.selframe",
    done: () => frames().some(n => (n.placements || []).some(p => BURNERS.test(p.sku))),
  },
  {
    id: "tray", sheet: "parts",
    at: () => isFrame(api.sel()) ? $("trays") : frameAnchor(),
    key: () => isFrame(api.sel()) ? "tour.tray" : "tour.selframe",
    done: () => frames().some(n => (n.placements || []).some(p => !BURNERS.test(p.sku))),
  },
  {
    id: "hook", sheet: null,
    // The hook menu once it is open; before that, the blue dot at the frame's end.
    at: () => visible($("edgemenu")) ? $("edgemenu")
      : isFrame(api.sel()) ? api.endDot() : frameAnchor(),
    key: () => visible($("edgemenu")) ? "tour.hook.pick"
      : isFrame(api.sel()) ? (api.coarse ? "tour.hook.touch" : "tour.hook") : "tour.selframe",
    done: hooked,
    then: () => api.fit(),             // the board doubles the length: show all of it
  },
  {
    id: "height", sheet: null,
    at: () => isFrame(api.sel()) || api.sel()?.kind === "ext"
      ? (visible($("toolpop")) ? $("toolpop") : document.querySelector("#seltools [data-act=height]"))
      : frameAnchor(),
    key: () => isFrame(api.sel()) || api.sel()?.kind === "ext" ? "tour.height" : "tour.selframe",
    done: () => frames().some(n => n.leg && n.leg !== "CK-114"),
  },
  { id: "view", sheet: null, at: () => $("viewnav"), next: true },
  { id: "bill", sheet: "build", at: () => $("bom"), next: true },
  { id: "share", sheet: null, at: () => document.querySelector(".filebar"), next: true, last: true },
];

const $ = id => document.getElementById(id);
const visible = e => !!e && !e.hidden && e.offsetParent !== null && e.getBoundingClientRect().width > 0;
function row(list, sku) {
  const l = document.querySelector(list);
  return l?.querySelector(`[data-sku="${sku}"]`) || l;
}
// When the frame is not selected: point at it in the view (its centre), so "click the frame" has a place.
function frameAnchor() { return api.frameCentre() || $("canvas"); }

export function initTour(a) {
  api = a;
  root = document.createElement("div"); root.id = "tour"; root.hidden = true;
  ring = document.createElement("div"); ring.className = "tring";
  dot = document.createElement("div"); dot.className = "tdot";
  card = document.createElement("div"); card.className = "tcard"; card.setAttribute("role", "dialog");
  root.append(ring, dot, card);
  document.body.append(root);
  addEventListener("keydown", e => { if (e.key === "Escape" && step >= 0 && !document.querySelector("dialog[open]")) stop(); });
}

export const tourActive = () => step >= 0;
export function tourSeen() { try { return !!localStorage.getItem(LS_SEEN); } catch { return true; } }
function markSeen() { try { localStorage.setItem(LS_SEEN, "1"); } catch {} }

/** Start from the top: the hello card, whose "not now" ends it (and counts as seen). `how` says who
 *  opened it -- "auto" on a first visit, otherwise a button -- for the anonymous counts. */
export function startTour(how = "button") {
  api.count(`tour.offer.${how}`);
  step = 0;
  root.hidden = false;
  paintCard();
  loop();
}
// How far people get: one count per step reached, and where they stopped.
function stop() {
  if (step >= 0) api.count(step === 0 ? "tour.later" : `tour.end.${step}`);
  step = -1; root.hidden = true; cancelAnimationFrame(raf); raf = 0; markSeen();
}
function go(i) {
  step = i;
  if (step >= STEPS.length) { api.count("tour.done"); step = -1; stop(); return; }
  api.count(`tour.step.${step}`);
  const s = STEPS[step];
  // The tour's own page, made when the person says go -- not before, so "not now" leaves no trace.
  if (s.id === "frame" && api.nodes().length) api.newPage(t("tour.page"));
  if (api.phone() && s.sheet !== undefined) api.setSheet(s.sheet);
  paintCard();
  tick();
}

/** Called by app.js after every paint: the design changed, so a waiting step may be done. */
export function tourTick() {
  if (step < 0) return;
  const s = STEPS[step];
  if (s.done && s.done()) { s.then?.(); go(step + 1); return; }
  paintCard(true);
}

let lastKey = "";
function paintCard(soft = false) {
  const s = STEPS[step];
  const key = s.key ? s.key() : `tour.${s.id}`;
  if (soft && key === lastKey) return;
  lastKey = key;
  const n = STEPS.length - 1;          // the hello card is step 0, not counted
  card.innerHTML = "";
  if (step > 0) card.append(el("div", "tcount", t("tour.count", { i: step, n })));
  card.append(el("div", "ttext", t(key)));
  const row = el("div", "tbtns");
  if (s.id === "hello") {
    row.append(btn(t("tour.go"), () => go(1), "primary"), btn(t("tour.later"), stop, "link"));
  } else {
    if (s.next) row.append(btn(t(s.last ? "tour.finish" : "tour.next"), () => go(step + 1), "primary"));
    else row.append(el("span", "twait", t("tour.wait")));
    row.append(btn(t("tour.skip"), () => go(step + 1), "link"), btn(t("tour.end"), stop, "link"));
  }
  card.append(row);
}
const el = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; if (html != null) e.innerHTML = html; return e; };
function btn(label, fn, cls) { const b = el("button", `cbtn ${cls}`, label); b.onclick = fn; return b; }

// Follow the target every frame: the camera moves, panels scroll, menus open.
function loop() { cancelAnimationFrame(raf); const f = () => { tick(); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); }
function tick() {
  if (step < 0) return;
  const s = STEPS[step];
  if (s.done && s.done()) { s.then?.(); go(step + 1); return; }   // done before the app repainted
  paintCard(true);                     // a menu opening changes the words without any repaint of the app
  let target = s.at ? s.at() : null;
  let r = null, point = false;
  if (target && target.nodeType === 1) {
    target.closest(".cat.collapsed")?.classList.remove("collapsed");   // a folded category hides its rows
    if (!visible(target)) target = null;
    else {
      // A palette row below the fold: bring it into view once, gently.
      if (target.closest("#palette") && scrolledTo !== target) {
        scrolledTo = target;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      r = target.getBoundingClientRect();
    }
  } else if (target && typeof target.x === "number") {
    point = true;
    r = { left: target.x - 22, top: target.y - 22, width: 44, height: 44, right: target.x + 22, bottom: target.y + 22 };
  }
  // A whole-canvas target is not worth a spotlight: it would dim nothing useful.
  if (r && target === $("canvas")) r = null;
  ring.hidden = !r || point; dot.hidden = !point;
  if (r && !point) {
    const pad = 6;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`,
      width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
  }
  if (point) Object.assign(dot.style, { left: `${r.left + 22}px`, top: `${r.top + 22}px` });
  placeCard(r);
}

// The card goes beside its target -- right, left, below, above, whichever fits -- and to the bottom
// centre when there is nothing to point at. On a phone it docks at the top: the sheets own the bottom.
function placeCard(r) {
  const W = innerWidth, H = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, g = 14, m = 8;
  let x, y;
  if (api.phone()) { x = (W - cw) / 2; y = 58; }
  else if (!r) { x = (W - cw) / 2; y = H - ch - 90; }
  else if (r.right + g + cw < W - m) { x = r.right + g; y = r.top + r.height / 2 - ch / 2; }
  else if (r.left - g - cw > m) { x = r.left - g - cw; y = r.top + r.height / 2 - ch / 2; }
  else if (r.bottom + g + ch < H - m) { x = r.left + r.width / 2 - cw / 2; y = r.bottom + g; }
  else { x = r.left + r.width / 2 - cw / 2; y = r.top - g - ch; }
  card.style.left = `${Math.round(Math.max(m, Math.min(W - cw - m, x)))}px`;
  card.style.top = `${Math.round(Math.max(m, Math.min(H - ch - m, y)))}px`;
}
