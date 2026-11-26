/* wartable-model.js: lays the campaign out on the parchment from a feed
   document and eases every banner and scout towards its place between
   snapshots.

     regions  one per place (repo), in a grid wider than deep
     banners  one per session, planted round its region's centre
     scouts   one per subagent, riding a dotted path out from its banner to
              an ink cross, and camping at the cross while resting

   Everything is keyed by id: sessions by theirs, subagents by
   "<session id>/<follower id>" (AgentvizFeed.followerKey). Nothing touches
   the engine here; wartable-frame.js packs what step() leaves behind.

   Classic script: window.Wartable. Needs AgentvizFeed. */
(function () {
  "use strict";
  const {ease, seedOf, followerKey} = window.AgentvizFeed;

  const TAU = Math.PI * 2;
  const MOVE_RATE = 3, APPEAR_RATE = 2.5, MAP_RATE = 2;
  const MIN_REGION_RADIUS = 2.4, MAP_MARGIN = 2.2;
  const SCOUT_START = 0.9;  // a scout's path starts this far from its banner

  // A repeatable pseudo-random number in 0..1 from a seed and a channel.
  function rand(seed, channel) { const v = Math.sin(seed * 127.1 + channel * 311.7) * 43758.5453; return v - Math.floor(v); }
  const seedOfSession = (s) => (s.seed != null ? s.seed : seedOf(s.id));

  /* ------------------------------------------------------------ layout */

  function groupByPlace(doc) {
    const byPlace = new Map();
    for (const s of doc.sessions || []) {
      const key = s.place || "~";
      if (!byPlace.has(key)) byPlace.set(key, []);
      byPlace.get(key).push(s);
    }
    return byPlace;
  }

  // Where each of a banner's scouts rides to, relative to the region centre:
  // fanned all the way round a lone banner, in an arc pointing outwards otherwise.
  function scoutPoints(s, bx, bz, out, alone) {
    const fl = s.followers || [];
    const spread = alone ? TAU : Math.min(2.8, 0.55 * Math.max(fl.length, 1));
    return fl.map((f, j) => {
      const angle = alone ? out + (j / Math.max(fl.length, 1)) * spread
        : out + (fl.length === 1 ? 0 : (j / (fl.length - 1) - 0.5) * spread);
      const reach = 2.6 + 0.9 * rand(f.seed != null ? f.seed : seedOf(f.id), 3);
      return {id: f.id, x: bx + Math.cos(angle) * reach, z: bz + Math.sin(angle) * reach};
    });
  }

  // One region: banners on a ring round its centre (a lone banner sits in
  // the middle), and the radius that holds them and their scouts' points.
  function layRegion(id, list, info) {
    const seed = info.seed != null ? info.seed : seedOf(id);
    const k = list.length, ring = k === 1 ? 0 : Math.max(2.2, 0.9 + 0.75 * k);
    const local = list.map((s, i) => {
      const angle = (i / k) * TAU + seed * TAU;
      const bx = Math.cos(angle) * ring, bz = Math.sin(angle) * ring;
      return {s, x: bx, z: bz, dests: scoutPoints(s, bx, bz, k === 1 ? seed * TAU : angle, k === 1)};
    });
    let R = MIN_REGION_RADIUS;
    for (const b of local) {
      R = Math.max(R, Math.hypot(b.x, b.z) + 1.9);
      for (const d of b.dests) R = Math.max(R, Math.hypot(d.x, d.z) + 1.0);
    }
    return {id, label: id === "~" ? "Home Shire" : info.label || id, seed, R, local, toolCount: info.toolCount || 0,
      sessions: list.length, waiting: list.filter((s) => s.state === "waiting").length,
      busy: list.filter((s) => s.state === "busy").length};
  }

  // Regions on a grid, each cell sized to the largest region, the last row
  // centred, each region nudged inside its cell by its seed. The grid is
  // wider than deep, or deeper than wide on a portrait screen (`tall`), so
  // the map fills a phone held upright instead of a thin strip of it.
  function placeOnGrid(regions, tall) {
    const n = Math.max(regions.length, 1);
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * (tall ? 0.45 : 1.6)))), rows = Math.ceil(n / cols);
    const cell = Math.max(4, ...regions.map((r) => r.R)) * 2 + 1.4;
    const w = cols * cell, d = rows * cell;
    regions.forEach((r, i) => {
      const c = i % cols, row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? n - row * cols : cols;
      const slack = (cell - 2 * r.R) * 0.8;
      r.x = -w / 2 + (cols - inRow) * cell * 0.5 + (c + 0.5) * cell + (rand(r.seed, 7) - 0.5) * slack;
      r.z = -d / 2 + (row + 0.5) * cell + (rand(r.seed, 8) - 0.5) * slack;
    });
    return [-w / 2 - MAP_MARGIN, -d / 2 - MAP_MARGIN - 0.6, w / 2 + MAP_MARGIN, d / 2 + MAP_MARGIN + 1.2];
  }

  // Target positions for one document. Pure: the same document (and the
  // same `tall`) always lays out the same way.
  function layout(doc, tall) {
    const byPlace = groupByPlace(doc);
    const meta = new Map((doc.places || []).map((p) => [p.id, p]));
    const regions = [...byPlace.keys()].sort().map((id) => layRegion(id, byPlace.get(id), meta.get(id) || {}));
    const map = placeOnGrid(regions, !!tall);
    const banners = new Map(), dests = new Map();
    for (const r of regions) {
      for (const b of r.local) {
        banners.set(b.s.id, {x: r.x + b.x, z: r.z + b.z});
        for (const d of b.dests) dests.set(b.s.id + "/" + d.id, {x: r.x + d.x, z: r.z + d.z});
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

  // A banner's pole height: lowered when offline, short while it appears.
  const poleTop = (b) => (0.9 + 2.3 * b.raise) * (0.3 + 0.7 * b.appear);

  /* ------------------------------------------------------------ the table */

  class Table {
    constructor() {
      this.doc = null;
      this.map = null;              // eased [x0, z0, x1, z1]
      this.mapTarget = null;
      this.regions = [];            // this snapshot's regions, with eased ex, ez, eR
      this.bannerById = new Map();  // session id -> eased banner
      this.scoutById = new Map();   // "session/follower" -> eased scout
      this.regionEase = new Map();  // place id -> {x, z, R}
      this.banners = [];            // this frame's visible banners (frame, labels, picking)
      this.scouts = [];             // this frame's visible scouts
      this.seen = false;            // a first snapshot appears at once; later arrivals grow in
      this.tall = false;            // portrait screen: lay the regions out deeper than wide
    }

    // A turned phone re-lays the map; banners and scouts ease to their new places.
    setTall(tall) {
      if (this.tall === !!tall) return false;
      this.tall = !!tall;
      if (this.doc) this.update(this.doc);
      return true;
    }

    update(doc) {
      this.doc = doc;
      const target = layout(doc, this.tall);
      this.mapTarget = target.map;
      if (!this.map) this.map = target.map.slice();
      this.regions = target.regions;
      const live = new Set(), liveScouts = new Set();
      for (const s of doc.sessions || []) {
        live.add(s.id);
        const b = this._banner(s, target.banners.get(s.id));
        for (const f of s.followers || []) {
          const key = followerKey(s, f);
          liveScouts.add(key);
          this._scout(key, f, b, target.dests.get(key));
        }
      }
      for (const [id, b] of this.bannerById) if (!live.has(id)) b.gone = true;
      for (const [id, sc] of this.scoutById) if (!liveScouts.has(id)) sc.gone = true;
      this.seen = true;
    }

    _banner(s, pos) {
      let b = this.bannerById.get(s.id);
      if (!b) {
        b = {id: s.id, x: pos.x, z: pos.z, raise: s.state === "offline" ? 0 : 1, beacon: 0, furl: 0, wave: 0,
          appear: this.seen ? 0 : 1};
        this.bannerById.set(s.id, b);
      }
      Object.assign(b, {session: s, tx: pos.x, tz: pos.z, gone: false});
      return b;
    }

    // A new scout rides out from its banner.
    _scout(key, f, b, dest) {
      let sc = this.scoutById.get(key);
      if (!sc) {
        sc = {id: key, phase: rand(seedOf(key), 1) * TAU, u: 0, camped: 0, gallop: 0, heading: 0, appear: 0,
          dx: dest.x, dz: dest.z, x: b.x, z: b.z};
        this.scoutById.set(key, sc);
      }
      Object.assign(sc, {follower: f, owner: b, tdx: dest.x, tdz: dest.z, gone: false});
    }

    // Advance every easing by dt seconds and rebuild this frame's lists.
    step(dt) {
      if (!this.doc) return;
      for (let i = 0; i < 4; i++) this.map[i] = ease(this.map[i], this.mapTarget[i], dt, MAP_RATE);
      this._stepRegions(dt);
      this.banners = this._stepBanners(dt);
      this.scouts = this._stepScouts(dt);
    }

    _stepRegions(dt) {
      for (const r of this.regions) {
        let e = this.regionEase.get(r.id);
        if (!e) { e = {x: r.x, z: r.z, R: r.R}; this.regionEase.set(r.id, e); }
        e.x = ease(e.x, r.x, dt, MOVE_RATE); e.z = ease(e.z, r.z, dt, MOVE_RATE); e.R = ease(e.R, r.R, dt, MOVE_RATE);
        Object.assign(r, {ex: e.x, ez: e.z, eR: e.R});
      }
    }

    _stepBanners(dt) {
      const out = [];
      for (const [id, b] of this.bannerById) {
        const s = b.session, busy = s.state === "busy";
        b.appear = ease(b.appear, b.gone ? 0 : 1, dt, APPEAR_RATE);
        if (b.gone && b.appear < 0.02) { this.bannerById.delete(id); continue; }
        b.x = ease(b.x, b.tx, dt, MOVE_RATE); b.z = ease(b.z, b.tz, dt, MOVE_RATE);
        b.raise = ease(b.raise, s.state === "offline" ? 0 : 1, dt, 2);
        b.beacon = ease(b.beacon, s.state === "waiting" ? 1 : 0, dt, 3);
        b.furl = ease(b.furl, busy && s.action === "think" ? 1 : 0, dt, 2);
        b.wave = ease(b.wave, busy ? 1 : s.state === "waiting" ? 0.45 : 0, dt, 2);
        b.edge = edgeRay(this.map, b.x, b.z);
        b.top = poleTop(b);
        out.push(b);
      }
      return out;
    }

    _stepScouts(dt) {
      const out = [];
      for (const [id, sc] of this.scoutById) {
        if (!this.bannerById.has(sc.owner.id)) sc.gone = true;
        sc.appear = ease(sc.appear, sc.gone ? 0 : 1, dt, APPEAR_RATE);
        if (sc.gone && sc.appear < 0.02) { this.scoutById.delete(id); continue; }
        sc.dx = ease(sc.dx, sc.tdx, dt, MOVE_RATE); sc.dz = ease(sc.dz, sc.tdz, dt, MOVE_RATE);
        this._ride(sc, dt);
        out.push(sc);
      }
      return out;
    }

    // u runs 0 at the banner's edge to 1 at the cross. An active scout rides a
    // slow loop out and back; a resting one is pulled to the cross and camps
    // there facing home.
    _ride(sc, dt) {
      const b = sc.owner, active = sc.follower.state === "active";
      sc.camped = ease(sc.camped, active ? 0 : 1, dt, 1.2);
      sc.phase += dt * (0.35 + 0.15 * rand(seedOf(sc.id), 2)) * (active ? 1 : 0.2);
      const target = active ? 0.15 + 0.85 * (0.5 - 0.5 * Math.cos(sc.phase)) : 1;
      const before = sc.u;
      sc.u = ease(sc.u, target, dt, 4);
      const lx = sc.dx - b.x, lz = sc.dz - b.z, len = Math.hypot(lx, lz) || 1;
      const ux = lx / len, uz = lz / len, along = SCOUT_START + (len - SCOUT_START) * sc.u;
      sc.x = b.x + ux * along; sc.z = b.z + uz * along;
      const moved = sc.u - before;
      const moving = Math.abs(moved) * len > 0.004 * Math.max(dt * 60, 1) ? 1 : 0;
      sc.gallop = ease(sc.gallop, moving, dt, 6);
      if (moving) sc.heading = moved >= 0 ? Math.atan2(uz, ux) : Math.atan2(-uz, -ux);
      else if (sc.camped > 0.5) sc.heading = Math.atan2(-uz, -ux);
    }

    // The map's extent for the camera: the target, not the eased one.
    bounds() { return this.mapTarget || [-20, -14, 20, 14]; }
  }

  window.Wartable = {Table, layout, edgeRay, SCOUT_START};
})();
