/* agentviz-screen.js: screen-space helpers shared by the HUD and the pages.

   - icon(action): the action glyph as an <svg> element (built, never parsed).
   - dot(state): a coloured state dot (class av-dot av-s-<state>).
   - labels(container): a keyed pool of world labels for StrataKit.placeLabels.
     set(key, {cls, state, action, text}) builds or updates one label with
     textContent only and touches the DOM only when its content changed;
     end() drops the labels not set since begin().
   - pick(project, candidates, x, y, radius): the candidate whose projected
     points come nearest (x, y), within radius CSS pixels.

   Phone helpers (pure maths, no DOM; the HUD measures and calls them):
   - keepClear(items, area, o): before StrataKit.placeLabels, keeps world
     labels on screen and out from under the HUD. area = {W, H, top, avoid}
     (canvas pixels: the top band's foot and rectangles {x0, y0, x1, y1}).
   - strataAvoid(area): the same area as {topInset, avoid} for a placeLabels
     that takes them itself (Strata kit 1.4, not yet merged).
   - projectWith(cam, x, y, z, W, H, fovDeg): Strata's orbit camera as maths,
     so a view can be fitted before it is drawn.
   - aim(cam, x, y, z, sx, sy, W, H): moves cam's target so (x, y, z) lands
     on screen point (sx, sy).
   - freeArea({W, H, top, panel}): the part of the canvas nothing covers.
   - reveal(cam, point, free, o): the camera that brings point into the free
     area, or null when it is in view already.
   - fitPoints(cam, points, free, o): the camera that frames every point in
     the free area, as large as it fits.
   - sameView(a, b): two cameras alike (a resized page refits only when the
     view was not moved since the last fit).

   Classic script (window.AgentvizScreen) that also loads under Node
   (module.exports) for the unit tests. No dependencies. MIT. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgentvizScreen = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SVG = "http://www.w3.org/2000/svg";

  // [tag, attributes] per glyph part, on a 16 x 16 grid; fill/stroke use currentColor.
  const FILL = {fill: "currentColor"};
  const LINE = {fill: "none", stroke: "currentColor", "stroke-width": "1.5"};
  const GLYPHS = {
    edit: [["path", Object.assign({d: "M3 13l1-4 7-7 3 3-7 7z"}, FILL)]],
    run: [["path", Object.assign({d: "M2 3h12v10H2z"}, LINE)], ["path", Object.assign({d: "M4 6l2 2-2 2M7 10h4"}, LINE)]],
    read: [["path", Object.assign({d: "M2 3c2-1 4-1 6 1 2-2 4-2 6-1v10c-2-1-4-1-6 1-2-2-4-2-6-1z"}, FILL)]],
    web: [["circle", Object.assign({cx: "8", cy: "8", r: "6"}, LINE)],
      ["path", Object.assign({d: "M2 8h12M8 2c-3 3-3 9 0 12M8 2c3 3 3 9 0 12"}, LINE, {"stroke-width": "1"})]],
    delegate: [["circle", Object.assign({cx: "8", cy: "4", r: "2.5"}, FILL)],
      ["path", Object.assign({d: "M8 7v3M8 10l-5 3M8 10l5 3"}, LINE)]],
    think: [["circle", Object.assign({cx: "9", cy: "6", r: "4"}, FILL)], ["circle", Object.assign({cx: "4", cy: "12", r: "1.6"}, FILL)],
      ["circle", Object.assign({cx: "2", cy: "15", r: "0.9"}, FILL)]],
    other: [["circle", Object.assign({cx: "8", cy: "8", r: "2.5"}, FILL)],
      ["path", Object.assign({d: "M8 1v3M8 12v3M1 8h3M12 8h3"}, LINE)]],
    none: [["path", Object.assign({d: "M4 8h8"}, LINE, {"stroke-width": "2"})]],
    home: [["path", Object.assign({d: "M8 2 2 7h2v6h3V9h2v4h3V7h2z"}, FILL)]],
    followers: [["circle", Object.assign({cx: "8", cy: "5", r: "2.5"}, FILL)], ["circle", Object.assign({cx: "3", cy: "11", r: "2"}, FILL)],
      ["circle", Object.assign({cx: "13", cy: "11", r: "2"}, FILL)]],
  };

  function icon(name) {
    const key = GLYPHS[name] ? name : "none";
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "av-ic av-a-" + key);
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of GLYPHS[key]) {
      const part = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, v);
      svg.appendChild(part);
    }
    return svg;
  }

  function dot(state) {
    const el = document.createElement("span");
    el.className = "av-dot av-s-" + (state || "idle");
    return el;
  }

  function text(value) { return document.createTextNode(value == null ? "" : String(value)); }

  function labels(container) {
    const pool = new Map();
    let live = new Set();
    return {
      begin() { live = new Set(); },
      set(key, {cls = "", state = null, action = null, text: words = ""}) {
        let el = pool.get(key);
        if (!el) { el = document.createElement("div"); container.appendChild(el); pool.set(key, el); }
        live.add(key);
        const className = "av-label " + cls;
        if (el.className !== className) el.className = className;
        const content = JSON.stringify([state, action, words]);
        if (el._avContent !== content) {
          el._avContent = content;
          el.replaceChildren(...[state && dot(state), action && icon(action), text(words)].filter(Boolean));
        }
        return el;
      },
      end() {
        for (const [key, el] of pool) if (!live.has(key)) { el.remove(); pool.delete(key); }
      },
      get size() { return pool.size; },
    };
  }

  // candidates: [{item, points: [[x, y, z], ...]}]; project(x, y, z) -> {x, y} | null.
  function pick(project, candidates, x, y, radius) {
    let best = null, bestD = radius * radius;
    for (const candidate of candidates) {
      for (const p of candidate.points) {
        const s = project(p[0], p[1], p[2]);
        if (!s) continue;
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bestD) { bestD = d; best = candidate.item; }
      }
    }
    return best;
  }

  /* ------------------------------------------------------------ keep-clear labels */
  // StrataKit.placeLabels' default upward tries per rank (strata-kit.js).
  const defaultTries = (rank) => (rank <= 0 ? 6 : rank === 1 ? 2 : 1);
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

  // items: placeLabels' items ({el, q, rank, tries}); area: {W, H, top, avoid}.
  // In order, for each item with a q:
  // - x is clamped so the label stays inside the screen's sides (once
  //   placeLabels has measured it: el._skW). A rank > 0 label whose anchor is
  //   off the side is left alone (it falls off as before); a rank <= 0 one
  //   (waiting, selected) is pulled in, so "needs you" is never cut off.
  // - one under an avoid rectangle (the panel, the legend) hides; rank <= 0
  //   stays (the "needs you" chip names it, and a tap reveals it).
  // - one reaching into the top band hides; rank <= 0 is pinned just under
  //   it instead, stacked downwards clear of other pinned labels.
  // - the rest may not step up (placeLabels' tries) far enough to reach it.
  // q is replaced, never mutated. o: {margin = 4, gap = 2, labelH = 18}.
  function keepClear(items, area, o = {}) {
    const margin = o.margin != null ? o.margin : 4, gap = o.gap != null ? o.gap : 2;
    const labelH = o.labelH || 18, W = area.W, top = area.top != null ? area.top : -Infinity;
    const avoid = area.avoid || [], pinned = [];
    for (const it of items) {
      if (!it.q) continue;
      const el = it.el || {}, w = el._skW, h = el._skH || labelH, must = it.rank <= 0;
      let x = it.q.x, y = it.q.y;
      if (w != null && W != null && (must || (x >= 0 && x <= W))) {
        const lo = w / 2 + margin, hi = W - w / 2 - margin;
        x = lo > hi ? W / 2 : Math.min(Math.max(x, lo), hi);
      }
      const half = w != null ? w / 2 : 0;
      const box = {x0: x - half, x1: x + half, y0: y - h, y1: y};
      if (avoid.some((r) => overlaps(box, r))) {
        if (!must) { it.q = null; continue; }
      } else if (y - h < top) {
        if (!must) { it.q = null; continue; }
        y = top + h;
        for (let guard = 0; guard < 50; guard++) {
          const at = {x0: x - half, x1: x + half, y0: y - h, y1: y};
          if (!pinned.some((r) => overlaps(at, r))) break;
          y += h + gap;
        }
        pinned.push({x0: x - half, x1: x + half, y0: y - h, y1: y});
        it.tries = 1;
      } else if (top > -Infinity) {
        const room = 1 + Math.floor((y - h - top) / (h + gap));
        it.tries = Math.max(1, Math.min(it.tries != null ? it.tries : defaultTries(it.rank), room));
      }
      if (x !== it.q.x || y !== it.q.y) it.q = Object.assign({}, it.q, {x, y});
    }
    return items;
  }

  // The area in the shape the Strata kit 1.4 PRs (#122/#123) propose for
  // placeLabels(items, {topInset, avoid: [{left, top, right, bottom}]}).
  // Check it against the merged API before switching a page over.
  function strataAvoid(area) {
    return {topInset: Math.max(0, area.top || 0),
      avoid: (area.avoid || []).map((r) => ({left: r.x0, top: r.y0, right: r.x1, bottom: r.y1}))};
  }

  /* ------------------------------------------------------------ camera maths */
  // Strata kit's sk_frame camera: an orbit about the target (tx, ty, tz) at
  // yaw, pitch and dist, 50 degree vertical field of view. Keep in step with
  // strata_kit.h if the kit changes; a page test can compare it with
  // kit.project. Returns {x, y, w} in pixels of a W x H canvas, or null.
  const FOV_DEG = 50;
  function projectWith(c, x, y, z, W, H, fovDeg = FOV_DEG) {
    const tan = Math.tan(fovDeg * Math.PI / 360), cp = Math.cos(c.pitch);
    const ex = c.tx + c.dist * cp * Math.cos(c.yaw), ey = c.ty + c.dist * Math.sin(c.pitch);
    const ez = c.tz + c.dist * cp * Math.sin(c.yaw);
    let fx = c.tx - ex, fy = c.ty - ey, fz = c.tz - ez;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    const rl = Math.hypot(fz, fx), rx = -fz / rl, rz = fx / rl;            // forward x up
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;             // right x forward
    const px = x - ex, py = y - ey, pz = z - ez;
    const depth = px * fx + py * fy + pz * fz;
    if (depth <= 0.01) return null;
    const sx = (px * rx + pz * rz) / (depth * tan * (W / H)), sy = (px * ux + py * uy + pz * uz) / (depth * tan);
    return {x: (sx * 0.5 + 0.5) * W, y: (0.5 - sy * 0.5) * H, w: depth};
  }

  // Moves c's target (tx, tz) so world point (x, y, z) lands on screen point
  // (sx, sy): a few Newton steps on the ground-plane Jacobian. Mutates and
  // returns c; leaves it be when the point is behind the camera.
  function aim(c, x, y, z, sx, sy, W, H, fovDeg = FOV_DEG) {
    for (let i = 0; i < 6; i++) {
      const q = projectWith(c, x, y, z, W, H, fovDeg);
      const qx = projectWith(Object.assign({}, c, {tx: c.tx + 1}), x, y, z, W, H, fovDeg);
      const qz = projectWith(Object.assign({}, c, {tz: c.tz + 1}), x, y, z, W, H, fovDeg);
      if (!q || !qx || !qz) return c;
      const a = qx.x - q.x, b = qz.x - q.x, d = qx.y - q.y, e = qz.y - q.y, det = a * e - b * d;
      if (Math.abs(det) < 1e-6) return c;
      const dx = sx - q.x, dy = sy - q.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return c;
      c.tx += (e * dx - b * dy) / det;
      c.tz += (a * dy - d * dx) / det;
    }
    return c;
  }

  // The part of a W x H canvas nothing covers: below the top band (`top`)
  // and clear of the panel {x0, y0, x1, y1} when one is given. The panel
  // costs either the height under its top (a bottom sheet, a low card) or
  // the width left of its right edge (a tall card), whichever leaves more.
  function freeArea({W, H, top = 0, panel = null, margin = 8}) {
    const r = {x0: margin, y0: top + margin, x1: W - margin, y1: H - margin, W, H};
    if (panel) {
      const above = {x0: r.x0, y0: r.y0, x1: r.x1, y1: Math.min(r.y1, panel.y0 - margin)};
      const beside = {x0: Math.max(r.x0, panel.x1 + margin), y0: r.y0, x1: r.x1, y1: r.y1};
      const size = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
      Object.assign(r, size(above) >= size(beside) ? above : beside);
    }
    return r;
  }

  // The camera that brings world point p ([x, y, z] or {x, y, z}) into the
  // free area, aimed a little below its middle (o.dy, default 20 px). Null
  // when p is already clear of every edge by o.pad (a number or {top, right,
  // bottom, left}; default 40), unless o.force. o.set overrides camera
  // fields first (a zoom: {dist: 16}). cam is not changed.
  function reveal(cam, p, free, o = {}) {
    const [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z];
    const c = Object.assign({}, cam, o.set || {}), fov = o.fov || FOV_DEG;
    const pad = typeof o.pad === "object" && o.pad ? o.pad : {};
    const n = typeof o.pad === "number" ? o.pad : 40;
    const pt = pad.top != null ? pad.top : n, pr = pad.right != null ? pad.right : n;
    const pb = pad.bottom != null ? pad.bottom : n, pl = pad.left != null ? pad.left : n;
    const q = projectWith(c, x, y, z, free.W, free.H, fov);
    if (!o.force && q && q.x > free.x0 + pl && q.x < free.x1 - pr && q.y > free.y0 + pt && q.y < free.y1 - pb) return null;
    const dy = o.dy != null ? o.dy : 20;
    return aim(c, x, y, z, (free.x0 + free.x1) / 2, (free.y0 + free.y1) / 2 + dy, free.W, free.H, fov);
  }

  // The camera (from cam's yaw and pitch) that frames every world point in
  // the free area, as large as it fits: dist steps towards the fit and the
  // target slides so the points' box sits in the area's middle. o: {mid
  // (the point the target slides by; default cam's target), minDist = 4,
  // maxDist = 400, inset = 0 (px kept spare inside the area), iterations = 40}.
  function fitPoints(cam, points, free, o = {}) {
    const c = Object.assign({}, cam), fov = o.fov || FOV_DEG, W = free.W, H = free.H;
    const mid = o.mid || [c.tx, c.ty, c.tz], inset = o.inset || 0;
    const minDist = o.minDist != null ? o.minDist : 4, maxDist = o.maxDist != null ? o.maxDist : 400;
    const fw = Math.max(1, free.x1 - free.x0 - inset), fh = Math.max(1, free.y1 - free.y0 - inset);
    for (let i = 0; i < (o.iterations || 40); i++) {
      const qs = points.map((p) => projectWith(c, p[0], p[1], p[2], W, H, fov));
      if (qs.some((q) => !q)) { c.dist = Math.min(maxDist, c.dist * 1.3); continue; }
      const bx0 = Math.min(...qs.map((q) => q.x)), bx1 = Math.max(...qs.map((q) => q.x));
      const by0 = Math.min(...qs.map((q) => q.y)), by1 = Math.max(...qs.map((q) => q.y));
      const k = Math.max((bx1 - bx0) / fw, (by1 - by0) / fh);
      c.dist = Math.min(maxDist, Math.max(minDist, c.dist * Math.pow(k, 0.7)));
      const m = projectWith(c, mid[0], mid[1], mid[2], W, H, fov);
      if (m) aim(c, mid[0], mid[1], mid[2], m.x + (free.x0 + free.x1) / 2 - (bx0 + bx1) / 2,
        m.y + (free.y0 + free.y1) / 2 - (by0 + by1) / 2, W, H, fov);
    }
    return c;
  }

  const VIEW_KEYS = ["yaw", "pitch", "dist", "tx", "ty", "tz"];
  function sameView(a, b, eps = 1e-3) {
    return !!a && !!b && VIEW_KEYS.every((k) => a[k] == null || b[k] == null || Math.abs(a[k] - b[k]) < eps);
  }

  return {icon, dot, text, labels, pick, keepClear, strataAvoid, FOV_DEG, projectWith, aim, freeArea, reveal,
    fitPoints, sameView};
});
