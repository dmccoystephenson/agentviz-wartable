/* page.js: boots the war table. The feed client, HUD, labels, picking and
   wire come from the agentviz kit (agentviz-*.js); this file wires them to
   the table model (wartable-model.js), packs frames (wartable-frame.js) and
   owns the camera. */
(function () {
  "use strict";
  const {Table} = window.Wartable;
  const REASON = {question: "has a question", permission: "needs permission"};
  const DEFAULT_YAW = Math.PI / 2, DEFAULT_PITCH = 0.95;
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
  function fitView() {
    const m = table.bounds(), w = m[2] - m[0], d = m[3] - m[1];
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const span = Math.max(w / Math.min(aspect, 1.8) * 1.15, d * 1.25);
    return {yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, dist: Math.max(18, span * 1.05),
      tx: (m[0] + m[2]) / 2, ty: 0, tz: (m[1] + m[3]) / 2 + d * 0.06};
  }
  function fit(instant) {
    if (!kit || !table.doc) return;
    const view = fitView();
    kit.limits.maxDist = Math.max(kit.limits.maxDist || 0, view.dist * 1.6);
    flyTo(view, instant);
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
  // A waiting banner is framed with its beacon hill (drawn to its west).
  function focusOn(o) {
    const beacon = o.session && !o.follower && o.session.state === "waiting" ? -0.6 : 0;
    flyTo({tx: o.x + beacon, ty: 0.6, tz: o.z, dist: Math.min(kit.cam.dist, 16)});
  }

  /* ------------------------------------------------------------ labels */
  function bannerLabel(b, items) {
    const s = b.session, waiting = s.state === "waiting", offline = s.state === "offline";
    const text = waiting ? (s.name || s.id) + " " + (REASON[s.waitingReason] || "needs you") : s.name || s.id.slice(0, 8);
    const el = labels.set("b:" + b.id, {cls: "banner" + (waiting ? " waiting" : "") + (offline ? " offline" : ""),
      state: s.stalled ? "stalled" : s.state, action: s.state === "busy" ? s.action : null, text});
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
      state: f.stalled ? "stalled" : null, action: resting ? "none" : f.action, text: f.label || f.id});
    items.push({el, q: kit.project(sc.x, 1.45, sc.z), rank: mine ? 1 : 4});
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
    StrataKit.placeLabels(items);
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
    if (o && (how === "list" || how === "waiting")) focusOn(o);
  }

  const hud = AgentvizHud.create({
    title: "War Table",
    legend: document.getElementById("legend"),
    buttons: [{icon: "home", label: "Recentre the view", onClick: () => fit(false)}],
    onSelect,
  });

  function accept(doc) {
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
    window.__page = {kit, table, hud, fit, flyTo, byId,
      select: (id, focus) => hud.select(targetOf(byId(id)), focus ? "list" : "api"),
      get doc() { return feed.doc; }, get polls() { return feed.polls; },
      feedClient: feed, stopPolling: () => feed.stop(), pollOnce: () => feed.pollOnce(), feed: (d) => feed.push(d)};
    kit.setSun(Date.UTC(2026, 5, 21, 15, 0, 0) / 1000, 40, -105);
    feed.start();
    kit.start();
    if (kit.driven) kit.drive(0);
    StrataLoader.done();
    canvas.focus({preventScroll: true});
  }

  boot();
})();
