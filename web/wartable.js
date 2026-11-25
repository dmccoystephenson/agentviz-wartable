"use strict";
/* The war table's page side: polls /api/agents, lays the campaign out on the
   parchment, eases between snapshots and writes rows into the engine
   (scene/main.cpp). Everything is keyed by id; nothing is rebuilt per poll.

     regions  one per place (repo)        x, z, radius, seed, ...
     banners  one per session             planted in its place's region
     scouts   one per subagent (follower) riding between its banner and a point */

const REGION_STRIDE = 8, BANNER_STRIDE = 16, SCOUT_STRIDE = 16;
const STATE_CODE = {dim: 0, idle: 1, busy: 2, waiting: 3, offline: 4};
const ACTION_CODE = {none: 0, edit: 1, run: 2, read: 3, web: 4, delegate: 5, think: 6, other: 7};
const POLL_MS = 2000;

/* Names and colours shared with the panel and legend (kAction / kField in main.cpp, in sRGB). */
const ACTIONS = {
  edit: {word: "Smithing", what: "editing files", color: "#f7a540"},
  run: {word: "Siege engine", what: "running commands", color: "#c0352f"},
  read: {word: "Reading a scroll", what: "reading files", color: "#f3eedb"},
  web: {word: "Raven sent", what: "on the web", color: "#222"},
  delegate: {word: "Horn sounded", what: "dispatching subagents", color: "#f6d15e"},
  think: {word: "Banner furled", what: "thinking", color: "#93b9f6"},
  other: {word: "War drum", what: "another tool", color: "#b98ad9"},
  none: {word: "At rest", what: "no tool now", color: "#a89f95"},
};
const FIELD = ["#c33f2a", "#3f5fb5", "#448a4a", "#94449f", "#dcae3a", "#262628", "#c3742a", "#3f9aa1"];
const STATES = {
  busy: {word: "On campaign", icon: "⚑"},
  idle: {word: "Encamped (idle)", icon: "🕯"},
  waiting: {word: "Beacon lit: needs you", icon: "🔥"},
  offline: {word: "Banner lowered (offline)", icon: "⚐"},
  dim: {word: "Dim", icon: "·"},
  active: {word: "Riding", icon: "🐎"},
  resting: {word: "Camped", icon: "⛺"},
};

function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
function rand(seed, i) { const v = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453; return v - Math.floor(v); }
const fieldColour = (seed) => FIELD[Math.min(7, Math.floor((seed || 0) * 7.999))];
const ease = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/* ---------------------------------------------------------------- layout */

/* Positions for every place, banner and scout destination. Pure: the same
   document always lays out the same way. */
function layout(doc) {
  const sessions = doc.sessions || [];
  const byPlace = new Map();
  for (const s of sessions) {
    const key = s.place || "~";
    if (!byPlace.has(key)) byPlace.set(key, []);
    byPlace.get(key).push(s);
  }
  const placeInfo = new Map((doc.places || []).map((p) => [p.id, p]));
  const ids = [...byPlace.keys()].sort();
  const regions = [];
  for (const id of ids) {
    const list = byPlace.get(id);
    const p = placeInfo.get(id) || {id, label: id, seed: hashSeed(id)};
    const seed = p.seed != null ? p.seed : hashSeed(id);
    // Banners round the region's centre; leads with scouts get more room.
    const k = list.length, local = [];
    const ring = k === 1 ? 0 : Math.max(2.2, 0.9 + 0.75 * k);
    list.forEach((s, i) => {
      const a = (i / k) * Math.PI * 2 + seed * 6.28;
      const bx = Math.cos(a) * ring, bz = Math.sin(a) * ring;
      const out = k === 1 ? seed * 6.28 : a;
      const fl = s.followers || [];
      const spread = k === 1 ? Math.PI * 2 : Math.min(2.8, 0.55 * Math.max(fl.length, 1));
      const dests = fl.map((f, j) => {
        const fa = k === 1 ? out + (j / Math.max(fl.length, 1)) * spread
          : out + (fl.length === 1 ? 0 : (j / (fl.length - 1) - 0.5) * spread);
        const d = 2.6 + 0.9 * rand(hashSeed(f.id || String(j)), 3);
        return {id: f.id, x: bx + Math.cos(fa) * d, z: bz + Math.sin(fa) * d};
      });
      local.push({s, x: bx, z: bz, dests});
    });
    let R = 2.4;
    for (const b of local) {
      R = Math.max(R, Math.hypot(b.x, b.z) + 1.9);
      for (const d of b.dests) R = Math.max(R, Math.hypot(d.x, d.z) + 1.0);
    }
    regions.push({id, label: p.label || id, seed, R, local, sessions: list,
      waiting: list.filter((s) => s.state === "waiting").length,
      busy: list.filter((s) => s.state === "busy").length});
  }
  // A grid of regions, wider than deep (the table is), each cell sized to the largest.
  const n = Math.max(regions.length, 1);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
  const rows = Math.ceil(n / cols);
  const maxR = Math.max(4, ...regions.map((r) => r.R));
  const cell = maxR * 2 + 1.4;
  const w = cols * cell, d = rows * cell;
  regions.forEach((r, i) => {
    const c = i % cols, row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;  // centre the last row
    const off = (cols - inRow) * cell * 0.5;
    r.x = -w / 2 + off + (c + 0.5) * cell + (rand(r.seed, 7) - 0.5) * (cell - 2 * r.R) * 0.8;
    r.z = -d / 2 + (row + 0.5) * cell + (rand(r.seed, 8) - 0.5) * (cell - 2 * r.R) * 0.8;
  });
  const margin = 2.2;
  const map = [-w / 2 - margin, -d / 2 - margin - 0.6, w / 2 + margin, d / 2 + margin + 1.2];
  const banners = new Map(), dests = new Map();
  for (const r of regions) {
    for (const b of r.local) {
      banners.set(b.s.id, {x: r.x + b.x, z: r.z + b.z, region: r});
      for (const dd of b.dests) dests.set(b.s.id + "/" + dd.id, {x: r.x + dd.x, z: r.z + dd.z});
    }
  }
  return {regions, map, banners, dests};
}

/* Unit vector from the map centre out through (x, z), and the distance from
   (x, z) to the map's edge along it: where a raven flies. */
function edgeRay(map, x, z) {
  const cx = (map[0] + map[2]) / 2, cz = (map[1] + map[3]) / 2;
  let dx = x - cx, dz = z - cz;
  const l = Math.hypot(dx, dz);
  if (l < 0.5) { dx = 0; dz = -1; } else { dx /= l; dz /= l; }
  const tx = dx > 0 ? (map[2] - x) / dx : dx < 0 ? (map[0] - x) / dx : 1e9;
  const tz = dz > 0 ? (map[3] - z) / dz : dz < 0 ? (map[1] - z) / dz : 1e9;
  return {dx, dz, dist: Math.max(1, Math.min(tx, tz))};
}

/* ---------------------------------------------------------------- scene */

class WarTable {
  constructor(mod) {
    this.mod = mod;
    this.doc = null;
    this.lay = null;
    this.banners = new Map();  // id -> eased banner state
    this.scouts = new Map();   // sessionId/followerId -> eased scout state
    this.map = [-20, -14, 20, 14];
    this.mapTarget = null;
    this.ptr = {regions: [0, 0], banners: [0, 0], scouts: [0, 0]};
  }

  setDoc(doc) {
    this.doc = doc;
    this.lay = layout(doc);
    this.mapTarget = this.lay.map;
    if (!this.seenMap) { this.map = this.lay.map.slice(); this.seenMap = true; }
    const seenB = new Set(), seenS = new Set();
    for (const s of doc.sessions || []) {
      seenB.add(s.id);
      const pos = this.lay.banners.get(s.id);
      let b = this.banners.get(s.id);
      if (!b) {
        b = {id: s.id, x: pos.x, z: pos.z, raise: s.state === "offline" ? 0 : 1, beacon: 0, furl: 0, wave: 0,
          appear: this.first ? 1 : 0};
        this.banners.set(s.id, b);
      }
      b.s = s; b.tx = pos.x; b.tz = pos.z; b.region = pos.region; b.gone = false;
      for (const f of s.followers || []) {
        const key = s.id + "/" + f.id;
        seenS.add(key);
        const dest = this.lay.dests.get(key);
        let sc = this.scouts.get(key);
        if (!sc) {
          // A new scout rides out from its banner.
          sc = {id: key, phase: rand(hashSeed(key), 1) * 6.28, u: 0, camped: f.state === "resting" ? 0.0 : 0,
            appear: 0, dx: dest.x, dz: dest.z, x: b.x, z: b.z, heading: 0};
          this.scouts.set(key, sc);
        }
        sc.f = f; sc.owner = b; sc.tdx = dest.x; sc.tdz = dest.z; sc.gone = false;
      }
    }
    for (const [id, b] of this.banners) if (!seenB.has(id)) b.gone = true;
    for (const [id, sc] of this.scouts) if (!seenS.has(id)) sc.gone = true;
    this.first = true;
  }

  /* Advance easing by dt seconds and write this frame's rows. */
  frame(t, dt, sel, hover) {
    if (!this.doc) return;
    const mod = this.mod;
    if (this.mapTarget) for (let i = 0; i < 4; i++) this.map[i] = ease(this.map[i], this.mapTarget[i], 2, dt);
    mod._wt_set_map(...this.map);

    // Regions (layout already eases through the banners; regions jump only
    // when the set of places changes, and then ease too).
    const regs = this.lay.regions;
    this._ease = this._ease || new Map();
    const rrows = new Float32Array(regs.length * REGION_STRIDE);
    regs.forEach((r, i) => {
      let e = this._ease.get(r.id);
      if (!e) { e = {x: r.x, z: r.z, R: r.R}; this._ease.set(r.id, e); }
      e.x = ease(e.x, r.x, 3, dt); e.z = ease(e.z, r.z, 3, dt); e.R = ease(e.R, r.R, 3, dt);
      r.ex = e.x; r.ez = e.z;
      rrows.set([e.x, e.z, e.R, r.seed, r.waiting, r.busy, r.sessions.length, 0], i * REGION_STRIDE);
    });
    this._write("regions", rrows, regs.length, mod._wt_set_regions);

    // Banners.
    const brows = [];
    this.visibleBanners = [];
    for (const [id, b] of this.banners) {
      const s = b.s, st = s.state;
      b.x = ease(b.x, b.tx, 3, dt); b.z = ease(b.z, b.tz, 3, dt);
      b.appear = ease(b.appear, b.gone ? 0 : 1, 2.5, dt);
      if (b.gone && b.appear < 0.02) { this.banners.delete(id); continue; }
      const busy = st === "busy";
      b.raise = ease(b.raise, st === "offline" ? 0 : 1, 2, dt);
      b.beacon = ease(b.beacon, st === "waiting" ? 1 : 0, 3, dt);
      b.furl = ease(b.furl, busy && s.action === "think" ? 1 : 0, 2, dt);
      b.wave = ease(b.wave, busy ? 1 : st === "waiting" ? 0.45 : 0, 2, dt);
      const ray = edgeRay(this.map, b.x, b.z);
      const riding = (s.followers || []).filter((f) => f.state === "active").length;
      brows.push(b.x, b.z, s.seed || 0, STATE_CODE[st] != null ? STATE_CODE[st] : 0,
        busy ? (ACTION_CODE[s.action] || 0) : 0, s.stalled ? 1 : 0,
        id === sel ? 2 : id === hover ? 1 : 0, b.raise, b.beacon, b.furl, b.wave, ray.dx, ray.dz, ray.dist,
        b.appear, riding);
      b.top = (0.9 + 2.3 * b.raise) * (0.3 + 0.7 * b.appear);
      this.visibleBanners.push(b);
    }
    this._write("banners", new Float32Array(brows), brows.length / BANNER_STRIDE, mod._wt_set_banners);

    // Scouts: riding out and back along the path while active, camped at
    // the far point while resting.
    const srows = [];
    this.visibleScouts = [];
    for (const [id, sc] of this.scouts) {
      const f = sc.f, b = sc.owner;
      if (!this.banners.has(b.id)) sc.gone = true;
      sc.appear = ease(sc.appear, sc.gone ? 0 : 1, 2.5, dt);
      if (sc.gone && sc.appear < 0.02) { this.scouts.delete(id); continue; }
      sc.dx = ease(sc.dx, sc.tdx, 3, dt); sc.dz = ease(sc.dz, sc.tdz, 3, dt);
      const active = f.state === "active";
      sc.camped = ease(sc.camped, active ? 0 : 1, 1.2, dt);
      // u: 0 at the banner's edge, 1 at the point. Active scouts ride a slow
      // loop out and back; the camped blend pulls them to the point.
      const speed = 0.35 + 0.15 * rand(hashSeed(id), 2);
      sc.phase += dt * speed * (active ? 1 : 0.2);
      const ride = 0.5 - 0.5 * Math.cos(sc.phase);
      const target = active ? 0.15 + 0.85 * ride : 1;
      const prevU = sc.u;
      sc.u = sc.u + (target - sc.u) * (1 - Math.exp(-4 * dt));
      const camp = sc.camped;
      const lx = sc.dx - b.x, lz = sc.dz - b.z, len = Math.hypot(lx, lz) || 1;
      const ux = lx / len, uz = lz / len;
      const startD = 0.9;
      const d = startD + (len - startD) * sc.u;
      sc.x = b.x + ux * d; sc.z = b.z + uz * d;
      const du = sc.u - prevU;
      const moving = Math.abs(du) * len > 0.004 * Math.max(dt * 60, 1) ? 1 : 0;
      sc.gallop = ease(sc.gallop || 0, moving, 6, dt);
      const want = du >= 0 ? Math.atan2(uz, ux) : Math.atan2(-uz, -ux);
      if (moving) sc.heading = want;
      else if (camp > 0.5) sc.heading = Math.atan2(-uz, -ux);  // camped facing home
      srows.push(sc.x, sc.z, sc.heading, sc.gallop, camp, ACTION_CODE[f.action] || 0,
        b.s.seed || 0, f.seed != null ? f.seed : hashSeed(id), id === sel ? 2 : id === hover ? 1 : 0,
        sc.dx, sc.dz, b.x, b.z, sc.appear * b.appear, b.s.state === "offline" ? 1 : 0, 0);
      this.visibleScouts.push(sc);
    }
    this._write("scouts", new Float32Array(srows), srows.length / SCOUT_STRIDE, mod._wt_set_scouts);
  }

  _write(name, rows, n, fn) {
    const mod = this.mod, slot = this.ptr[name];
    const need = Math.max(rows.length, 1);
    if (need > slot[1]) {
      if (slot[0]) mod._free(slot[0]);
      slot[1] = need + 256;
      slot[0] = mod._malloc(slot[1] * 4);
    }
    mod.HEAPF32.set(rows, slot[0] >> 2);
    fn.call(mod, slot[0], n);
  }

  /* The banner or scout nearest (x, y) in CSS pixels, within radius. */
  pick(x, y, radius, project) {
    let best = null, bestD = radius * radius;
    const test = (obj, px, py, pz) => {
      const q = project(px, py, pz);
      if (!q) return;
      const dd = (q.x - x) ** 2 + (q.y - y) ** 2;
      if (dd < bestD) { bestD = dd; best = obj; }
    };
    for (const sc of this.visibleScouts || []) { test(sc, sc.x, 0.45, sc.z); test(sc, sc.x, 0.9, sc.z); }
    for (const b of this.visibleBanners || []) {
      for (const yy of [0.3, b.top * 0.5, b.top - 0.4]) test(b, b.x, yy, b.z);
      test(b, b.x + 0.6, b.top - 0.5, b.z);
      if (b.beacon > 0.5) test(b, b.x - 1.25, 1.0, b.z - 0.55);
    }
    return best;
  }
}

/* ---------------------------------------------------------------- page */

(function main() {
  const q = new URLSearchParams(location.search);
  const fixture = q.get("fixture") === "1";
  const api = "/api/agents" + (fixture ? "?fixture=1" : "");
  const canvas = document.getElementById("view");
  const labelsEl = document.getElementById("labels");
  const sheet = document.getElementById("sheet");
  const beaconChip = document.getElementById("beacons");
  let table = null, kit = null, selected = null, hovered = null, lastT = null, lastDoc = null;
  const labelEls = new Map();

  function labelFor(key, cls) {
    let el = labelEls.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "lbl " + cls;
      labelsEl.appendChild(el);
      labelEls.set(key, el);
    }
    el._used = true;
    return el;
  }

  function placeAllLabels() {
    if (!table || !table.lay) return;
    for (const el of labelEls.values()) el._used = false;
    const items = [];
    for (const r of table.lay.regions) {
      const el = labelFor("r:" + r.id, "region" + (r.waiting ? " alarm" : ""));
      const txt = r.label === "~" ? "Home Shire" : r.label;
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle("alarm", r.waiting > 0);
      items.push({el, q: kit.project(r.ex, 0.05, r.ez + r.R * 0.98), rank: 1});
    }
    for (const b of table.visibleBanners || []) {
      const s = b.s;
      const el = labelFor("b:" + b.id, "banner");
      const txt = s.name || s.id.slice(0, 8);
      if (el.textContent !== txt) el.textContent = txt;
      el.dataset.state = s.state;
      el.style.setProperty("--field", fieldColour(s.seed));
      const isSel = selected && selected.id === b.id;
      items.push({el, q: kit.project(b.x + 0.5, b.top + 0.45, b.z),
        rank: isSel || s.state === "waiting" ? 0 : s.state === "offline" ? 3 : 1});
    }
    for (const sc of table.visibleScouts || []) {
      const el = labelFor("s:" + sc.id, "scout");
      const txt = sc.f.label || "scout";
      if (el.textContent !== txt) el.textContent = txt;
      const isSel = selected && (selected.id === sc.id || selected.id === sc.owner.id);
      items.push({el, q: kit.project(sc.x, 1.45, sc.z), rank: isSel ? 1 : 4});
    }
    for (const [k, el] of labelEls) if (!el._used) { el.remove(); labelEls.delete(k); }
    StrataKit.placeLabels(items);
  }

  /* ------------------------------------------------------- the panel */
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function chip(action) {
    const a = ACTIONS[action] || ACTIONS.none;
    return `<span class="chip" style="--c:${a.color}"><i></i>${esc(a.word)}<small>${esc(a.what)}</small></span>`;
  }
  function stateChip(state) {
    const s = STATES[state] || {word: state, icon: "·"};
    return `<span class="state" data-state="${esc(state)}">${s.icon} ${esc(s.word)}</span>`;
  }

  function renderSheet() {
    if (!selected) { sheet.hidden = true; document.body.classList.remove("sheet-open"); return; }
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
    let html = "";
    if (selected.kind === "banner") {
      const b = table.banners.get(selected.id);
      if (!b) { selected = null; return renderSheet(); }
      const s = b.s, fl = s.followers || [];
      const act = s.activity || {};
      html = `<div class="head"><span class="flag" style="--field:${fieldColour(s.seed)}"></span>
        <div><h2>${esc(s.name || s.id.slice(0, 8))}</h2><div class="sub">${esc(s.placeLabel === "~" ? "Home Shire" : s.placeLabel || s.place)}${s.branch ? ` · <code>${esc(s.branch)}</code>` : ""}</div></div>
        <button class="close" aria-label="Close">×</button></div>
        <div class="row">${stateChip(s.state)}${s.stalled ? '<span class="state" data-state="stalled">💨 Stalled</span>' : ""}</div>
        <div class="row">${chip(s.state === "busy" ? s.action : "none")}</div>
        ${act.label ? `<div class="kv"><span>Last order</span>${esc(act.tool || "")} · ${esc(act.label)}</div>` : ""}
        <div class="kv"><span>Scouts</span>${fl.length ? `${fl.filter((f) => f.state === "active").length} riding · ${fl.filter((f) => f.state !== "active").length} camped` : "none sent"}</div>
        ${fl.length ? `<ul class="scouts">${fl.map((f) => `<li data-id="${esc(s.id + "/" + f.id)}"><span class="dot" style="--c:${(ACTIONS[f.action] || ACTIONS.none).color}"></span>${f.state === "active" ? "🐎" : "⛺"} ${esc(f.label || f.id)}<small>${esc((ACTIONS[f.action] || ACTIONS.none).word)}</small></li>`).join("")}</ul>` : ""}`;
    } else {
      const sc = table.scouts.get(selected.id);
      if (!sc) { selected = null; return renderSheet(); }
      const f = sc.f, s = sc.owner.s;
      html = `<div class="head"><span class="flag small" style="--field:${fieldColour(s.seed)}"></span>
        <div><h2>${esc(f.label || f.id)}</h2><div class="sub">Scout of <a href="#" data-lead="${esc(s.id)}">${esc(s.name || s.id.slice(0, 8))}</a>${s.branch ? ` · <code>${esc(s.branch)}</code>` : ""}</div></div>
        <button class="close" aria-label="Close">×</button></div>
        <div class="row">${stateChip(f.state)}</div>
        <div class="row">${chip(f.state === "active" ? f.action : (f.action || "none"))}</div>
        <div class="kv"><span>Last tool</span>${esc(f.tool || "–")}${f.toolLabel ? " · " + esc(f.toolLabel) : ""}</div>
        <div class="kv"><span>Orders carried</span>${esc(f.toolCount != null ? f.toolCount : "–")} tool calls · quiet ${Math.round(f.quietSec || 0)} s</div>`;
    }
    if (sheet._html !== html) { sheet.innerHTML = html; sheet._html = html; }
  }

  function select(obj) {
    selected = obj ? {kind: obj.s ? "banner" : "scout", id: obj.id} : null;
    if (kit) kit.selected = selected;
    renderSheet();
  }
  sheet.addEventListener("click", (e) => {
    if (e.target.closest(".close")) { select(null); return; }
    const li = e.target.closest("li[data-id]");
    if (li) { const sc = table.scouts.get(li.dataset.id); if (sc) select(sc); return; }
    const lead = e.target.closest("[data-lead]");
    if (lead) { e.preventDefault(); const b = table.banners.get(lead.dataset.lead); if (b) select(b); }
  });
  beaconChip.addEventListener("click", () => {
    const w = [...table.banners.values()].filter((b) => b.s.state === "waiting");
    if (!w.length) return;
    const cur = w.findIndex((b) => selected && b.id === selected.id);
    const b = w[(cur + 1) % w.length];
    select(b);
    if (kit) { kit.cam.tx = b.x; kit.cam.tz = b.z; kit.cam.dist = Math.min(kit.cam.dist, 16); }
  });
  document.getElementById("legend-btn").addEventListener("click", () => {
    const lg = document.getElementById("legend");
    lg.hidden = !lg.hidden;
  });

  function updateHud(doc) {
    const c = doc.counts || {};
    const waiting = (doc.sessions || []).filter((s) => s.state === "waiting");
    beaconChip.hidden = !waiting.length;
    beaconChip.querySelector("b").textContent = waiting.length;
    beaconChip.title = waiting.map((s) => s.name).join(", ");
    document.getElementById("count-banners").textContent = (doc.sessions || []).filter((s) => s.state !== "offline").length;
    document.getElementById("count-scouts").textContent = c.activeFollowers != null ? c.activeFollowers : 0;
    document.getElementById("fixture-tag").hidden = !doc.fixture;
  }

  async function poll() {
    try {
      const r = await fetch(api, {cache: "no-store"});
      if (!r.ok) throw new Error(r.status);
      const doc = await r.json();
      lastDoc = doc;
      if (table) { table.setDoc(doc); renderSheet(); }
      updateHud(doc);
      document.body.classList.remove("feed-down");
    } catch (e) {
      document.body.classList.add("feed-down");
    }
  }

  (async () => {
    let mod;
    try {
      mod = await StrataLoader.load({script: "wartable-engine.js", factory: "createWartableEngine",
        wasm: "wartable-engine.wasm", title: "the war table"});
    } catch (e) { return; }
    table = new WarTable(mod);
    window.__wartable = table;
    await poll();
    if (lastDoc) table.setDoc(lastDoc);
    const m = table.map, span = Math.max(m[2] - m[0], (m[3] - m[1]) * 1.4);
    try {
      kit = StrataKit.create({
        module: mod, canvas,
        camera: {yaw: Math.PI / 2, pitch: 0.95, dist: Math.max(18, span * 0.82), tx: 0, ty: 0, tz: 1.0},
        limits: {maxDist: 140, minDist: 4, maxPitch: 1.45},
        idleOrbit: false,
        frame(t, now, dt) {
          const step = lastT == null ? 0 : Math.min(Math.max(t - lastT, 0), 0.25);
          lastT = t;
          table.frame(t, step, selected && selected.id, hovered && hovered.id);
        },
        pick: (x, y, r) => table.pick(x, y, r, kit.project),
        idOf: (o) => o.id,
        onTap: (o) => select(o),
        onHover: (o) => { hovered = o; canvas.style.cursor = o ? "pointer" : ""; },
        onSlow: () => StrataLoader.slow(),
        onFatal: (code, msg) => StrataLoader.fallback(code, msg),
        after: placeAllLabels,
        targets: () => {
          const r = canvas.getBoundingClientRect(), out = [];
          for (const b of table.visibleBanners || []) {
            const s = kit.project(b.x, b.top * 0.5, b.z);
            if (s) out.push({id: b.id, x: s.x + r.left, y: s.y + r.top});
          }
          return out;
        },
      });
    } catch (e) {
      return StrataLoader.fallback(e.code === "no-webgl2" ? "no-webgl2" : "engine");
    }
    window.__wartableKit = kit;
    // For tools (tests/screenshots.cjs): select a banner or scout by id.
    window.__wartableSelect = (id) => select(id ? (table.banners.get(id) || table.scouts.get(id) || null) : null);
    kit.setSun(Date.UTC(2026, 5, 21, 15, 0, 0) / 1000, 40, -105);
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    canvas.focus({preventScroll: true});
    setInterval(poll, POLL_MS);
  })();
})();
