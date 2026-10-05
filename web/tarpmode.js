// TARP MODE: one tarp and nothing else -- its cloth, poles, ropes and pegs -- in 3D and in plan, with
// every peg a handle. The planner's scene is for arranging a camp; this is for pitching one tarp, and
// the furniture only gets in the way (it can come back as ghosts, to see what the tarp covers).
//
// A peg is where a rope is staked, so it is where the corner is PULLED: drag it out and the rope runs
// flatter and the corner rides up; drag it in and the corner comes down. The rope takes up on its
// adjuster -- never lets out past its length -- so a peg beyond reach turns red (tarp.js checks).
// While a peg moves the cloth is re-solved in tarp.js's fast mode (~50 ms); on release, in full.
//
// Everything here is in the TARP'S OWN frame (mm; ridge along z, A at +z) -- the frame solvePitch
// answers in and `pitch.pegs` is stored in -- so a pitch means the same thing wherever the tarp stands.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { solvePitch } from "./tarp.js";
import { clothTarpGroup } from "./parts3d.js";
import { t } from "./i18n.js";

const MM = 0.001;
const HIT_PX = 18;                 // how near (screen px) a press must land to pick up a peg

/** Open tarp mode on a tarp node.
 *  sku, name, color: the tarp; pitch: its current pitch (tarpPitch(n));
 *  fillPitch(box, pitch, set): the planner's own pole/corner rows (set(patch) -> a new pitch);
 *  ghosts(): the rest of the layout as Object3Ds already in this tarp's frame (metres), or [];
 *  onChange(pitch): a pitch is final (a chip, a released peg) -- the planner stores it, with undo;
 *  onClose(). */
export function openTarpMode({ sku, name, color, pitch, fillPitch, ghosts, onChange, onClose }) {
  let cur = pitch, sol = solvePitch(sku, cur), drag = null, ghostOn = false;

  // ---- the page
  const dlg = document.createElement("dialog");
  dlg.className = "tmodal";
  dlg.innerHTML = `
    <div class="tm-head">
      <div class="tm-title"><b></b><span>${t("tm.title")}</span></div>
      <label class="tm-tog"><input type="checkbox"> ${t("tm.furniture")}</label>
      <button class="cbtn tm-reset" title="${t("tm.reset.tip")}">${t("tm.reset")}</button>
      <button class="cbtn tm-fit">${t("tm.fit")}</button>
      <button class="cbtn primary tm-done">${t("tm.done")}</button>
    </div>
    <div class="tm-body">
      <div class="tm-view"><canvas class="tm-3d"></canvas><span class="tm-tag">${t("tm.view3d")}</span></div>
      <div class="tm-view"><canvas class="tm-plan"></canvas><span class="tm-tag">${t("tm.plan")}</span></div>
      <aside class="tm-side">
        <p class="tm-hint">${t("tm.hint")}</p>
        <div class="tm-out"></div>
        <h4>${t("tm.pegs")}</h4>
        <table class="tm-pegs"></table>
        <h4>${t("tm.pitch")}</h4>
        <div class="chips tm-pitch"></div>
      </aside>
    </div>`;
  dlg.querySelector(".tm-title b").textContent = name;
  document.body.append(dlg);
  const $ = sel => dlg.querySelector(sel);

  // ---- one scene, seen twice: orbiting in 3D, and straight down in plan
  const css = getComputedStyle(document.documentElement);
  const bg = new THREE.Color(css.getPropertyValue("--scene").trim() || "#14161a");
  const scene = new THREE.Scene();
  scene.background = bg;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(5, 9, 4);
  scene.add(sun);
  const grid = new THREE.GridHelper(30, 30, 0x5b6472, 0x343a44);
  grid.material.transparent = true; grid.material.opacity = 0.55;
  scene.add(grid);
  const ghostRoot = new THREE.Group(); ghostRoot.visible = false; scene.add(ghostRoot);
  let tarpRoot = new THREE.Group(); scene.add(tarpRoot);
  const handles = new THREE.Group(); scene.add(handles);

  const mk = cv => {
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    return r;
  };
  const cv3 = $(".tm-3d"), cvP = $(".tm-plan");
  const r3 = mk(cv3), rP = mk(cvP);
  const cam3 = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  cam3.position.set(7, 5.5, 8);
  const orbit = new OrbitControls(cam3, cv3);
  orbit.target.set(0, 1, 0);
  orbit.maxPolarAngle = Math.PI / 2 - 0.02;
  orbit.update();
  // plan: looking down, A (the front, +z) at the bottom of the screen
  const camP = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camP.position.set(0, 50, 0);
  camP.up.set(0, 0, -1);
  camP.lookAt(0, 0, 0);
  let half = 6;                       // plan half-height, metres (fit() sets it; the wheel zooms it)

  let raf = 0;
  const draw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; r3.render(scene, cam3); rP.render(scene, camP); }); };
  orbit.addEventListener("change", draw);

  const size = () => {
    for (const [cv, r] of [[cv3, r3], [cvP, rP]]) {
      const w = cv.parentElement.clientWidth, h = cv.parentElement.clientHeight;
      if (w && h) r.setSize(w, h, false);
    }
    const a3 = cv3.parentElement.clientWidth / Math.max(1, cv3.parentElement.clientHeight);
    cam3.aspect = a3; cam3.updateProjectionMatrix();
    planFrustum();
    draw();
  };
  const planFrustum = () => {
    const a = cvP.parentElement.clientWidth / Math.max(1, cvP.parentElement.clientHeight);
    camP.left = -half * a; camP.right = half * a; camP.top = half; camP.bottom = -half;
    camP.updateProjectionMatrix();
  };
  const fit = () => {
    const xs = [], zs = [];
    for (const i of sol.outline) { xs.push(sol.pts[i].x); zs.push(sol.pts[i].z); }
    for (const a of sol.anchors) for (const p of a.pegs) { xs.push(p.x); zs.push(p.z); }
    const w = (Math.max(...xs) - Math.min(...xs)) * MM, d = (Math.max(...zs) - Math.min(...zs)) * MM;
    const a = cvP.parentElement.clientWidth / Math.max(1, cvP.parentElement.clientHeight);
    half = Math.max(d / 2, w / 2 / a) * 1.12;
    // centre on what is there: one wing raised on its 二又 is not symmetric about the ridge
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2 * MM, cz = (Math.max(...zs) + Math.min(...zs)) / 2 * MM;
    camP.position.set(cx, 50, cz); camP.lookAt(cx, 0, cz); camP.updateMatrixWorld();
    planFrustum(); draw();
  };
  const ro = new ResizeObserver(size);
  ro.observe(cv3.parentElement); ro.observe(cvP.parentElement);
  cvP.addEventListener("wheel", e => {
    e.preventDefault();
    half = Math.min(30, Math.max(2, half * Math.exp(e.deltaY * 0.001)));
    planFrustum(); draw();
  }, { passive: false });

  // ---- the tarp and its peg handles, rebuilt from a solution
  const freeObj = o => o.traverse(c => {
    c.geometry?.dispose();
    for (const m of [c.material].flat().filter(Boolean)) { if (m.isSpriteMaterial) m.map?.dispose(); m.dispose(); }
  });
  const discGeo = new THREE.CircleGeometry(0.14, 24).rotateX(-Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(0.14, 0.19, 24).rotateX(-Math.PI / 2);
  const C_PEG = 0x5b8def, C_USER = 0xe0a040, C_SHORT = 0xe2635a;
  const pegList = () => {
    // one handle per peg KEY: an Octa end corner's peg and the main leg on it are one peg
    const seen = new Map();
    for (const a of sol.anchors) for (const p of a.pegs) {
      const e = seen.get(p.key) || { key: p.key, x: p.x, z: p.z, user: p.user, short: false, who: [] };
      e.short ||= p.short; e.who.push({ a, p });
      seen.set(p.key, e);
    }
    return [...seen.values()];
  };
  const showSolution = s => {
    sol = s;
    scene.remove(tarpRoot); freeObj(tarpRoot);
    tarpRoot = clothTarpGroup(sol, { color, letters: true }).group;
    scene.add(tarpRoot);
    for (const c of [...handles.children]) { handles.remove(c); c.material.dispose(); }
    for (const e of pegList()) {
      const col = e.short ? C_SHORT : e.user ? C_USER : C_PEG;
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthTest: false }));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: drag?.key === e.key ? 0.95 : 0.5, depthTest: false }));
      for (const m of [disc, ring]) { m.position.set(e.x * MM, 0.012, e.z * MM); m.renderOrder = 20; handles.add(m); }
    }
    draw();
  };

  // ---- the side: readouts, one row per peg, and the planner's own pitch rows
  const m2 = v => (v / 1000).toFixed(2);
  const paintSide = () => {
    const out = $(".tm-out");
    out.innerHTML = "";
    const line = (text, cls = "") => { const d = document.createElement("div"); d.className = "pnote " + cls; d.textContent = text; out.append(d); };
    if (sol.ok) {
      line(t("tarp.readout", { m2: sol.area_m2.toFixed(1), h: m2(sol.cornerLow), w: (sol.span.w / 1000).toFixed(1), d: (sol.span.d / 1000).toFixed(1) }));
      line(t("tarp.guyedsize", { w: (sol.guyed.w / 1000).toFixed(1), d: (sol.guyed.d / 1000).toFixed(1) }));
    } else line(t("tarp.short"), "warn");
    if (sol.short.length) line(t("tm.shortwarn", { list: sol.short.join(", ") }), "warn");

    const tbl = $(".tm-pegs");
    tbl.innerHTML = `<tr><th></th><th>${t("tm.col.height")}</th><th>${t("tm.col.rope")}</th><th></th></tr>`;
    const order = pegList().sort((u, v) => u.who[0].a.letter.localeCompare(v.who[0].a.letter));
    for (const e of order) {
      const tr = document.createElement("tr");
      if (e.short) tr.className = "bad";
      // who ties on here: "B" for a corner, "A·L" for a main leg; an Octa end peg is "B + A"
      const label = e.who.map(({ a, p }) => a.role === "corner" ? a.letter
        : `${a.letter}·${p.key.endsWith("-") ? "L" : p.key.endsWith("+") ? "R" : ""}`.replace(/·$/, "")).join(" + ");
      const ropes = e.who.map(({ p }) => p.have != null
        ? t("tm.rope", { need: m2(p.need), have: m2(p.have), deg: p.deg.toFixed(0) })
        : t("tm.rope.free", { need: m2(p.need), deg: p.deg.toFixed(0) })).join(" / ");
      const h = e.who.map(({ a }) => m2(a.at.y)).join(" / ");
      tr.innerHTML = `<td class="l"></td><td>${h}</td><td class="r"></td><td></td>`;
      tr.cells[0].textContent = label;
      tr.cells[2].textContent = ropes + (e.short ? ` — ${t("tm.short")}` : "");
      if (e.user) {
        const b = document.createElement("button");
        b.className = "tm-undo"; b.textContent = "↺"; b.title = t("tm.resetpeg");
        b.onclick = () => { const pegs = { ...cur.pegs }; delete pegs[e.key]; commit({ ...cur, pegs }); };
        tr.cells[3].append(b);
      }
      tbl.append(tr);
    }
    const box = $(".tm-pitch");
    box.innerHTML = "";
    fillPitch(box, cur, patch => commit({ ...cur, ...patch }));
  };

  const commit = next => {
    cur = next;
    if (cur.pegs && !Object.keys(cur.pegs).length) { cur = { ...cur }; delete cur.pegs; }
    showSolution(solvePitch(sku, cur));
    paintSide();
    onChange(cur);
  };

  // ---- dragging a peg, in plan
  const toPlan = e => {
    const r = cvP.getBoundingClientRect();
    const v = new THREE.Vector3(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0).unproject(camP);
    return { x: v.x / MM, z: v.z / MM, px: r.height / (2 * half) * MM };   // px: screen pixels per mm
  };
  cvP.addEventListener("pointerdown", e => {
    const q = toPlan(e);
    let best = null, bd = HIT_PX / q.px;
    for (const p of pegList()) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    drag = { key: best.key, dx: best.x - q.x, dz: best.z - q.z };
    cvP.setPointerCapture(e.pointerId);
    cvP.classList.add("dragging");
  });
  let pending = 0;
  cvP.addEventListener("pointermove", e => {
    if (!drag) {
      // say so when the pointer is over a peg
      const q = toPlan(e);
      cvP.classList.toggle("over", pegList().some(p => Math.hypot(p.x - q.x, p.z - q.z) < HIT_PX / q.px));
      return;
    }
    const q = toPlan(e);
    drag.at = { x: Math.round(q.x + drag.dx), z: Math.round(q.z + drag.dz) };
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!drag?.at) return;
      showSolution(solvePitch(sku, { ...cur, pegs: { ...cur.pegs, [drag.key]: drag.at } }, { fast: true }));
    });
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    cvP.classList.remove("dragging");
    if (d.at) commit({ ...cur, pegs: { ...cur.pegs, [d.key]: d.at } });
    else showSolution(sol);
  };
  cvP.addEventListener("pointerup", endDrag);
  cvP.addEventListener("pointercancel", endDrag);

  // ---- the header
  const tog = $(".tm-tog input");
  tog.onchange = () => {
    ghostOn = tog.checked;
    if (ghostOn && !ghostRoot.children.length) for (const o of ghosts()) ghostRoot.add(o);
    ghostRoot.visible = ghostOn; draw();
  };
  $(".tm-reset").onclick = () => { const next = { ...cur }; delete next.pegs; commit(next); };
  $(".tm-fit").onclick = fit;
  $(".tm-done").onclick = () => dlg.close();
  dlg.addEventListener("close", () => {
    ro.disconnect(); orbit.dispose();
    freeObj(tarpRoot);
    for (const c of handles.children) c.material.dispose();
    discGeo.dispose(); ringGeo.dispose();
    // the ghosts share the planner's geometry: free only the materials they were given
    ghostRoot.traverse(o => { for (const m of [o.material].flat().filter(Boolean)) m.dispose(); });
    r3.dispose(); rP.dispose();
    dlg.remove();
    onClose?.();
  });

  dlg.showModal();
  size();
  showSolution(sol);
  paintSide();
  fit();
  // for tests and the console: where each peg handle is on screen (client px)
  const pegsOnScreen = () => {
    const r = cvP.getBoundingClientRect();
    return pegList().map(e => {
      const v = new THREE.Vector3(e.x * MM, 0, e.z * MM).project(camP);
      return { key: e.key, x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    });
  };
  return { close: () => dlg.close(), pegsOnScreen, get pitch() { return cur; }, get solution() { return sol; } };
}
