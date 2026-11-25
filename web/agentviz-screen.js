/* agentviz-screen.js: screen-space helpers shared by the HUD and the pages.

   - icon(action): the action glyph as an <svg> element (built, never parsed).
   - dot(state): a coloured state dot (class av-dot av-s-<state>).
   - labels(container): a keyed pool of world labels for StrataKit.placeLabels.
     set(key, {cls, state, action, text}) builds or updates one label with
     textContent only and touches the DOM only when its content changed;
     end() drops the labels not set since begin().
   - pick(project, candidates, x, y, radius): the candidate whose projected
     points come nearest (x, y), within radius CSS pixels.

   Classic script: window.AgentvizScreen. No dependencies. MIT. */
(function () {
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

  window.AgentvizScreen = {icon, dot, text, labels, pick};
})();
