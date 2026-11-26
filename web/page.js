/* page.js: boots the war table. The feed client, HUD, labels, picking and
   wire come from the agentviz kit (agentviz-*.js); this file wires them to
   the table model (wartable-model.js), packs frames (wartable-frame.js) and
   owns the camera. */
(function () {
  "use strict";
  const {Table} = window.Wartable;
  const REASON = {question: "has a question", permission: "needs permission"};
  const DEFAULT_YAW = Math.PI / 2, DEFAULT_PITCH = 0.95, PORTRAIT_PITCH = 1.08;
  // Heraldic field colours (kField in scene/draw_util.h, in sRGB): the banner labels' edge.
  const FIELD = ["#c33f2a", "#3f5fb5", "#448a4a", "#94449f", "#dcae3a", "#262628", "#c3742a", "#3f9aa1"];
  const fieldColour = (seed) => FIELD[Math.min(7, Math.floor((seed || 0) * 7.999))];
  const canvas = document.getElementById("view");
  const table = new Table();
  const wire = AgentvizWire.create();
  const labels = AgentvizScreen.labels(document.getElementById("labels"));
  let kit = null, mod = null, feed = null, selectedId = null, hoveredId = null, camAnim = null, fitted = false;
  let sceneTime = 0, lastT = 0;

  /* ------------------------------------------------------------ camera */
  // The camera the engine builds (Strata kit sk_frame: an orbit about the
  // target, 50 degree vertical field of view), here so a view can be fitted
  // before it is drawn. Keep in step with strata_kit.h if the kit changes.
  const FOV_TAN = Math.tan(25 * Math.PI / 180);
  function projectWith(c, x, y, z, W, H) {
    const cp = Math.cos(c.pitch);
    const ex = c.tx + c.dist * cp * Math.cos(c.yaw), ey = c.ty + c.dist * Math.sin(c.pitch), ez = c.tz + c.dist * cp * Math.sin(c.yaw);
    let fx = c.tx - ex, fy = c.ty - ey, fz = c.tz - ez;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    const rl = Math.hypot(fz, fx), rx = -fz / rl, rz = fx / rl;            // forward x up
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;             // right x forward
    const px = x - ex, py = y - ey, pz = z - ez;
    const depth = px * fx + py * fy + pz * fz;
    if (depth <= 0.01) return null;
    const sx = (px * rx + pz * rz) / (depth * FOV_TAN * (W / H)), sy = (px * ux + py * uy + pz * uz) / (depth * FOV_TAN);
    return {x: (sx * 0.5 + 0.5) * W, y: (0.5 - sy * 0.5) * H};
  }

  // The part of the canvas nothing covers: below the top bar and, with
  // `panel`, above the bottom sheet (phone) or right of the card (desktop).
  function freeRect(panel) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const bar = document.querySelector(".av-bar");
    const r = {x0: 8, y0: (bar ? bar.getBoundingClientRect().bottom : 0) + 8, x1: W - 8, y1: H - 8, W, H};
    const p = panel && hud.panel;
    if (p && !p.hidden) {
      if (p.offsetWidth >= W - 40) r.y1 = Math.min(r.y1, H - p.offsetHeight - 8);
      else r.x0 = Math.max(r.x0, p.offsetLeft + p.offsetWidth + 8);
    }
    return r;
  }

  // Moves the camera target so world point (x, y, z) lands on screen (sx, sy):
  // a few Newton steps on the ground-plane Jacobian.
  function aim(c, x, y, z, sx, sy, W, H) {
    for (let i = 0; i < 6; i++) {
      const q = projectWith(c, x, y, z, W, H);
      const qx = projectWith(Object.assign({}, c, {tx: c.tx + 1}), x, y, z, W, H);
      const qz = projectWith(Object.assign({}, c, {tz: c.tz + 1}), x, y, z, W, H);
      if (!q || !qx || !qz) return c;
      const a = qx.x - q.x, b = qz.x - q.x, d = qx.y - q.y, e = qz.y - q.y, det = a * e - b * d;
      if (Math.abs(det) < 1e-6) return c;
      const dx = sx - q.x, dy = sy - q.y;
      c.tx += (e * dx - b * dy) / det;
      c.tz += (a * dy - d * dx) / det;
    }
    return c;
  }

  const isTall = () => canvas.clientWidth / Math.max(1, canvas.clientHeight) < 0.8;

  // The whole parchment, banners standing on its far edge included, as large
  // as it fits below the top bar. Portrait screens look down more steeply.
  function fitView() {
    const m = table.bounds(), fr = freeRect(false), W = fr.W, H = fr.H;
    const pts = [];
    for (const x of [m[0], m[2]]) for (const z of [m[1], m[3]]) pts.push([x, 0, z]);
    for (const x of [m[0], m[2]]) pts.push([x, 3.2, m[1] + 2]);
    const c = {yaw: DEFAULT_YAW, pitch: isTall() ? PORTRAIT_PITCH : DEFAULT_PITCH, dist: 40, ty: 0,
      tx: (m[0] + m[2]) / 2, tz: (m[1] + m[3]) / 2};
    const mid = [c.tx, 0, c.tz];
    for (let i = 0; i < 40; i++) {
      const qs = pts.map((p) => projectWith(c, p[0], p[1], p[2], W, H));
      if (qs.some((q) => !q)) { c.dist *= 1.3; continue; }
      const bx0 = Math.min(...qs.map((q) => q.x)), bx1 = Math.max(...qs.map((q) => q.x));
      const by0 = Math.min(...qs.map((q) => q.y)), by1 = Math.max(...qs.map((q) => q.y));
      const k = Math.max((bx1 - bx0) / (fr.x1 - fr.x0), (by1 - by0) / (fr.y1 - fr.y0));
      c.dist = Math.min(150, Math.max(12, c.dist * Math.pow(k, 0.7)));
      const q = projectWith(c, mid[0], mid[1], mid[2], W, H);
      if (q) aim(c, mid[0], mid[1], mid[2], q.x + (fr.x0 + fr.x1) / 2 - (bx0 + bx1) / 2, q.y + (fr.y0 + fr.y1) / 2 - (by0 + by1) / 2, W, H);
    }
    return c;
  }
  let lastFit = null;
  function fit(instant) {
    if (!kit || !table.doc) return;
    lastFit = fitView();
    kit.limits.maxDist = Math.max(kit.limits.maxDist || 0, lastFit.dist * 1.6);
    flyTo(lastFit, instant);
  }
  // A turned phone re-lays the map (deeper than wide when upright) and
  // refits, unless the view was moved since the last fit.
  function onResize() {
    const relaid = table.setTall(isTall());
    const c = kit && kit.cam;
    if (!c || !lastFit) return;
    const untouched = ["yaw", "pitch", "dist", "tx", "tz"].every((k) => Math.abs(c[k] - lastFit[k]) < 1e-3);
    if (relaid || (untouched && !camAnim)) fit(!relaid);
  }
  function flyTo(to, instant) {
    if (instant || kit.driven) { Object.assign(kit.cam, to); camAnim = null; return; }
    camAnim = {from: Object.assign({}, kit.cam), to, t0: performance.now(), ms: 700};
  }
  function stepCam() {
    if (!camAnim) return;
    const k = Math.min(1, (performance.now() - camAnim.t0) / camAnim.ms), e = AgentvizFeed.smoothstep(k);
    for (const key of Object.keys(camAnim.to)) kit.cam[key] = AgentvizFeed.lerp(camAnim.from[key], camAnim.to[key], e);
    if (k >= 1) camAnim = null;
  }
  // Brings a banner or scout into the clear band (below the top bar, above
  // the bottom sheet or beside the card). With `zoom` it also moves in close;
  // otherwise the camera only pans, and only when it is covered or off screen.
  // A waiting banner is framed with its beacon hill (drawn to its west).
  function reveal(o, zoom) {
    const beacon = o.session && !o.follower && o.session.state === "waiting" ? -0.6 : 0;
    const x = o.x + beacon, y = o.follower ? 0.6 : o.top * 0.5, z = o.z;
    const fr = freeRect(true), base = camAnim ? camAnim.to : kit.cam;
    const c = Object.assign({}, base, zoom ? {dist: Math.min(base.dist, 16), ty: 0.6} : {});
    const q = projectWith(c, x, y, z, fr.W, fr.H), pad = 36;
    // Its foot (horse, cairn, beacon hill) hangs below the anchor, so the bottom edge keeps a wider margin.
    if (!zoom && q && q.x > fr.x0 + pad && q.x < fr.x1 - pad && q.y > fr.y0 + pad * 2 && q.y < fr.y1 - pad * 2) return;
    flyTo(aim(c, x, y, z, (fr.x0 + fr.x1) / 2, (fr.y0 + fr.y1) / 2 + 16, fr.W, fr.H));
  }

  /* ------------------------------------------------------------ labels */
  // A banner's label: who, and at a glance what state. A waiting one says
  // why and outranks everything; a stalled one says so; idle ones fade back.
  function bannerLabel(b, items) {
    const s = b.session, waiting = s.state === "waiting", offline = s.state === "offline";
    const idle = s.state === "idle" || s.state === "dim", stalled = !!s.stalled && !waiting;
    const name = s.name || s.id.slice(0, 8);
    const text = waiting ? name + " " + (REASON[s.waitingReason] || "needs you") : name + (stalled ? " \u00b7 stalled" : "");
    const el = labels.set("b:" + b.id, {cls: "banner" + (waiting ? " waiting" : "") + (offline ? " offline" : "") +
      (idle ? " idle" : "") + (stalled ? " stalled" : ""),
      state: stalled ? "stalled" : s.state, action: s.state === "busy" ? s.action : null, text});
    el.style.setProperty("--field", fieldColour(s.seed));
    items.push({el, q: kit.project(b.x + 0.5, b.top + 0.45, b.z),
      rank: b.id === selectedId || waiting ? 0 : offline ? 3 : 1});
  }
  // A scout's label rides above it; one on its own git branch also carries
  // that branch on a small plate (unless its label already says it).
  function scoutLabel(sc, items) {
    const f = sc.follower, resting = f.state !== "active";
    const mine = sc.id === selectedId || sc.owner.id === selectedId;
    const el = labels.set("s:" + sc.id, {cls: "scout" + (resting ? " resting" : "") + (f.stalled ? " stalled" : ""),
      state: f.stalled ? "stalled" : null, action: resting ? "none" : f.action,
      text: (f.label || f.id) + (f.stalled ? " \u00b7 stalled" : "")});
    // A stalled scout outranks its quiet neighbours, so the warning is not the label that hides.
    items.push({el, q: kit.project(sc.x, 1.45, sc.z), rank: mine ? 1 : f.stalled ? 2 : 4});
    if (f.branch && f.branch !== sc.owner.session.branch && f.branch !== f.label) {
      const plate = labels.set("sb:" + sc.id, {cls: "branch", text: f.branch});
      items.push({el: plate, q: kit.project(sc.x, 0.15, sc.z + 0.5), rank: mine ? 2 : 5});
    }
  }
  function placeLabels() {
    const items = [];
    labels.begin();
    for (const r of table.regions) {
      const el = labels.set("r:" + r.id, {cls: "region" + (r.waiting ? " alarm" : ""), text: r.label});
      items.push({el, q: kit.project(r.ex, 0.05, r.ez + r.eR * 0.98), rank: 1});
    }
    for (const b of table.banners) bannerLabel(b, items);
    for (const sc of table.scouts) scoutLabel(sc, items);
    labels.end();
    StrataKit.placeLabels(keepClear(items));
  }
  // Labels stay on screen and out from under the top bar: one that would sit
  // under it hides, unless it must show (waiting, selected), then it drops
  // just below the bar.
  function keepClear(items) {
    const fr = freeRect(false), top = fr.y0 - 4;
    for (const it of items) {
      if (!it.q || it.el._skW == null) continue;
      const half = it.el._skW / 2 + 4, h = it.el._skH || 18;
      it.q = {x: Math.min(Math.max(it.q.x, half), Math.max(half, fr.W - half)), y: it.q.y, w: it.q.w};
      if (it.q.y - h < top) {
        if (it.rank <= 0) { it.q = {x: it.q.x, y: top + h, w: it.q.w}; it.tries = 1; } else it.q = null;
      }
    }
    return items;
  }

  /* ------------------------------------------------------------ picking + selection */
  // Points up the pole, on the flag and at the beacon, so any part of a banner taps.
  function pickPoints(o) {
    if (o.follower) return [[o.x, 0.45, o.z], [o.x, 0.9, o.z]];
    const pts = [[o.x, 0.3, o.z], [o.x, o.top * 0.5, o.z], [o.x, o.top - 0.4, o.z], [o.x + 0.6, o.top - 0.5, o.z]];
    if (o.beacon > 0.5) pts.push([o.x - 1.25, 1.0, o.z - 0.55]);
    return pts;
  }
  function pick(x, y, radius) {
    const candidates = table.scouts.concat(table.banners).map((o) => ({item: o, points: pickPoints(o)}));
    return AgentvizScreen.pick(kit.project, candidates, x, y, radius);
  }
  const byId = (id) => (id && (table.bannerById.get(id) || table.scoutById.get(id))) || null;
  const targetOf = (o) => (o ? {session: o.owner ? o.owner.session : o.session, follower: o.follower || null} : null);
  const idOf = (target) => (target ? (target.follower ? AgentvizFeed.followerKey(target.session, target.follower)
    : target.session.id) : null);

  function onSelect(target, how) {
    selectedId = idOf(target);
    const o = byId(selectedId);
    if (kit) kit.selected = o;
    // The HUD has drawn the card or sheet already, so its size is known.
    if (o && kit) reveal(o, how === "list" || how === "waiting");
  }

  const hud = AgentvizHud.create({
    title: "War Table",
    legend: document.getElementById("legend"),
    buttons: [{icon: "home", label: "Recentre the view", onClick: () => fit(false)}],
    onSelect,
  });

  function accept(doc) {
    if (!table.doc) table.tall = isTall();
    table.update(doc);
    if (!table.banners.length) table.step(0);  // first snapshot: banners exist before the first frame
    hud.update(doc);
    if (!fitted && table.doc) { fitted = true; fit(true); }
  }

  /* ------------------------------------------------------------ boot */
  function frame(t) {
    const dt = Math.min(kit.driven ? 1 : 0.1, Math.max(0, t - lastT));
    lastT = sceneTime = t;
    stepCam();
    if (!table.doc) return;  // nothing to draw before the first snapshot
    table.step(dt);
    const highlight = (id) => (id === selectedId ? 1 : id === hoveredId ? 2 : 0);
    window.WartableFrame.write(wire, table, kit.cam.yaw, highlight, feed.pulse).send(mod);
  }

  function screenTargets() {
    const r = canvas.getBoundingClientRect();
    return table.banners.map((b) => {
      const q = kit.project(b.x, b.top * 0.5, b.z);
      return q && {id: b.id, x: q.x + r.left, y: q.y + r.top};
    }).filter(Boolean);
  }

  function createKit() {
    return StrataKit.create({
      module: mod, canvas,
      camera: {yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, dist: 40, tx: 0, ty: 0, tz: 1},
      limits: {maxDist: 160, minDist: 4, maxPitch: 1.45},
      idleOrbit: false,
      frame,
      after: placeLabels,
      pick,
      idOf: (o) => o.id,
      onTap: (o) => hud.select(targetOf(o), "tap"),
      onHover(o) { hoveredId = o ? o.id : null; canvas.style.cursor = o ? "pointer" : ""; },
      onSlow: () => StrataLoader.slow(),
      onFatal: (code, msg) => StrataLoader.fallback(code, msg),
      targets: screenTargets,
    });
  }

  async function boot() {
    try {
      mod = await StrataLoader.load({script: "wartable-engine.js", factory: "createWartableEngine",
        wasm: "wartable-engine.wasm", title: "the war table"});
    } catch (error) {
      console.error("wartable: the engine did not load", error);
      return;  // StrataLoader has already shown its fallback
    }
    try {
      kit = createKit();
    } catch (error) {
      StrataLoader.fallback(error.code === "no-webgl2" ? "no-webgl2" : "engine");
      return;
    }
    // Under ?drive=1 tool-call pulses follow scene time, so captures repeat.
    const now = () => (kit.driven ? sceneTime : Date.now() / 1000);
    feed = AgentvizFeed.create({onUpdate: accept, onStatus: hud.setStatus, now});
    window.__table = table;
    window.__page = {kit, table, hud, fit, flyTo, byId, projectWith,
      select: (id, focus) => hud.select(targetOf(byId(id)), focus ? "list" : "api"),
      get doc() { return feed.doc; }, get polls() { return feed.polls; },
      feedClient: feed, stopPolling: () => feed.stop(), pollOnce: () => feed.pollOnce(), feed: (d) => feed.push(d)};
    kit.setSun(Date.UTC(2026, 5, 21, 15, 0, 0) / 1000, 40, -105);
    addEventListener("resize", () => requestAnimationFrame(onResize));
    feed.start();
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    canvas.focus({preventScroll: true});
  }

  boot();
})();
