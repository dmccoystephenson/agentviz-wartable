/* agentviz-hud.js: the HTML around every agentviz canvas.

   Top bar (title, "needs you" chip, counts, demo-feed badge, the page's own
   buttons, legend toggle), the unreachable banner, the empty-state hint and
   the selected agent's panel (a card on desktop, a bottom sheet on phones).
   Every feed string goes in with textContent; nothing is parsed as HTML.
   Parts re-render only when what they show changed, so a button is never
   swapped out from under a finger between polls.

     const hud = AgentvizHud.create({
       title: "Agent Office",
       legend: document.getElementById("legend"),      // optional <aside>, moved into place
       buttons: [{icon: "home", label: "Recentre", onClick() {}}],
       onSelect(target, how) {},   // target {session, follower|null} or null; how: "tap" | "list" | "waiting"
       rows(target) { return [["desk", "3"]]; },       // optional extra panel rows
     });
     hud.update(doc); hud.setStatus(status, info); hud.select(target);

   Classic script: window.AgentvizHud. Needs AgentvizScreen and AgentvizFeed. MIT. */
(function () {
  "use strict";
  const {icon, dot, text} = window.AgentvizScreen;
  const {signature} = window.AgentvizFeed;
  const REASON = {question: "has a question", permission: "needs permission"};
  const COUNTS = [["busy", "busy", (ss) => ss.filter((s) => s.state === "busy").length],
    ["followers", "subagents", (ss) => ss.reduce((n, s) => n + (s.followers || []).filter((f) => f.state === "active").length, 0)],
    ["idle", "idle", (ss) => ss.filter((s) => s.state === "idle" || s.state === "dim").length],
    ["offline", "away", (ss) => ss.filter((s) => s.state === "offline").length]];

  function el(tag, className, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const child of children) node.appendChild(typeof child === "string" ? text(child) : child);
    return node;
  }
  function button(className, children, onClick, label) {
    const node = el("button", className, children);
    node.type = "button";
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", onClick);
    return node;
  }
  function setText(node, value) { const v = String(value); if (node.textContent !== v) node.textContent = v; }
  const reasonOf = (s) => REASON[s.waitingReason] || "needs you";
  const sameTarget = (a, b) => !!a && !!b && a.session.id === b.session.id &&
    (a.follower ? a.follower.id : null) === (b.follower ? b.follower.id : null);

  function create(opts = {}) {
    const root = opts.root || document.body;
    const hud = {doc: null, selected: null};
    let waitIndex = -1, panelKey = null;

    /* ------------------------------------------------------------ top bar */
    const counts = {};
    const waitCount = el("b", "", ["0"]), waitWho = el("span", "av-wait-who");
    const waitChip = button("av-chip av-wait", [dot("waiting"), waitCount, " need you", waitWho], cycleWaiting,
      "Show the next agent waiting on you");
    waitChip.hidden = true;
    const badge = el("span", "av-chip av-badge", ["demo feed"]);
    badge.hidden = true;
    const bar = el("div", "av-bar", [el("span", "av-chip av-title", [opts.title || "agentviz"]), waitChip]);
    for (const [key, word] of COUNTS) {
      counts[key] = el("b", "", ["0"]);
      const glyph = key === "followers" ? icon("followers") : dot(key);
      const chip = el("span", "av-chip", [glyph, counts[key], el("span", "av-wide", [" " + word])]);
      chip.title = word;
      bar.appendChild(chip);
    }
    bar.appendChild(badge);
    bar.appendChild(el("span", "av-spacer"));
    for (const b of opts.buttons || []) bar.appendChild(button("av-chip", [icon(b.icon)], b.onClick, b.label));
    const legend = opts.legend || null;
    let legendButton = null;
    if (legend) {
      legend.classList.add("av-legend");
      legend.hidden = true;
      legendButton = button("av-chip", ["?"], () => toggleLegend(), "What you are looking at");
      legendButton.setAttribute("aria-expanded", "false");
      bar.appendChild(legendButton);
    }

    const banner = el("div", "av-banner");
    banner.setAttribute("role", "status");
    banner.hidden = true;
    const empty = el("div", "av-empty", ["No Claude Code sessions on this machine right now. ",
      "Start one and it appears here, or add ?fixture=1 to the address for the demo feed."]);
    empty.hidden = true;

    /* ------------------------------------------------------------ panel */
    const panelBody = el("div", "av-panel-body");
    const grab = el("div", "av-grab");
    const panel = el("section", "av-panel", [grab,
      button("av-close", ["×"], () => select(null, "tap"), "Close"), panelBody]);
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    swipeToClose(grab);

    root.append(bar, banner, empty, panel);
    if (legend) root.appendChild(legend);

    function toggleLegend(force) {
      legend.hidden = force != null ? !force : !legend.hidden;
      legendButton.setAttribute("aria-expanded", String(!legend.hidden));
    }

    function swipeToClose(handle) {
      let startY = null;
      handle.addEventListener("pointerdown", (e) => { startY = e.clientY; });
      addEventListener("pointerup", (e) => {
        if (startY != null && e.clientY - startY > 60) select(null, "tap");
        startY = null;
      });
    }

    function waitingSessions() {
      return ((hud.doc && hud.doc.sessions) || []).filter((s) => s.state === "waiting");
    }

    function cycleWaiting() {
      const waiting = waitingSessions();
      if (!waiting.length) return;
      waitIndex = (waitIndex + 1) % waiting.length;
      select({session: waiting[waitIndex], follower: null}, "waiting");
    }

    function renderBar(doc) {
      const sessions = doc.sessions || [];
      for (const [key, , count] of COUNTS) setText(counts[key], count(sessions));
      const waiting = waitingSessions();
      setText(waitCount, waiting.length);
      waitChip.hidden = waiting.length === 0;
      const next = waiting[(waitIndex + 1) % Math.max(1, waiting.length)];
      setText(waitWho, next ? " · " + (next.name || next.id) + " " + reasonOf(next) : "");
      badge.hidden = !doc.fixture;
      empty.hidden = sessions.length > 0;
      document.title = (waiting.length ? "(" + waiting.length + ") " : "") + (opts.title || "agentviz");
    }

    /* ------------------------------------------------------------ panel content */
    function chip(children, className = "") { return el("span", "av-chip " + className, children); }
    function kv(rows) {
      const list = el("dl", "av-kv");
      for (const [term, value] of rows) {
        if (value == null || value === "") continue;
        list.append(el("dt", "", [term]), el("dd", "", [String(value)]));
      }
      return list;
    }
    function jump(target, label, action) {
      return button("av-chip", [icon(action), label], () => select(target, "list"));
    }

    function sessionPanel(s) {
      const activeFollowers = (s.followers || []).filter((f) => f.state === "active").length;
      const state = s.state === "waiting" ? chip([dot("waiting"), el("b", "", [reasonOf(s)])], "av-needs")
        : chip([dot(s.state), s.state]);
      const nodes = [el("h2", "", [dot(s.state), s.name || s.id]),
        el("div", "av-sub", ["session · " + (s.placeLabel || s.place || "")]),
        el("div", "av-row", [state, s.state === "busy" ? chip([icon(s.action), s.action]) : null,
          s.stalled ? chip([dot("stalled"), el("b", "", ["stalled"])]) : null].filter(Boolean)),
        kv([["doing", s.activity && s.activity.label], ["tool", s.activity && s.activity.tool],
          ["branch", s.branch || "—"], ["place", s.placeLabel || s.place],
          ["subagents", activeFollowers + " active of " + (s.followers || []).length]].concat(extraRows(s, null)))];
      const lanes = (s.followers || []).map((f) =>
        jump({session: s, follower: f}, f.label || f.id, f.state === "active" ? f.action : "none"));
      if (lanes.length) nodes.push(el("div", "av-lanes", lanes));
      return nodes;
    }

    function followerPanel(s, f) {
      const active = f.state === "active";
      return [el("h2", "", [icon(active ? f.action : "none"), f.label || f.id]),
        el("div", "av-sub", ["subagent of ", jump({session: s, follower: null}, s.name || s.id, s.action)]),
        el("div", "av-row", [chip([dot(active ? "busy" : "idle"), f.state]), active ? chip([icon(f.action), f.action]) : null,
          f.stalled ? chip([dot("stalled"), el("b", "", ["stalled"])]) : null,
          f.finished ? chip(["finished"]) : null].filter(Boolean)),
        kv([["tool", f.tool ? f.tool + (f.toolLabel ? " · " + f.toolLabel : "") : null],
          ["tool calls", f.toolCount != null ? f.toolCount : "—"], ["branch", f.branch || s.branch || "—"],
          ["place", s.placeLabel || s.place]].concat(extraRows(s, f)))];
    }

    function extraRows(session, follower) { return opts.rows ? opts.rows({session, follower}) || [] : []; }

    // The selection, re-found in the current document (it may have changed or gone).
    function refresh(target) {
      if (!target || !hud.doc) return null;
      const session = (hud.doc.sessions || []).find((s) => s.id === target.session.id);
      if (!session) return null;
      if (!target.follower) return {session, follower: null};
      const follower = (session.followers || []).find((f) => f.id === target.follower.id);
      return follower ? {session, follower} : null;
    }

    function renderPanel() {
      const target = refresh(hud.selected);
      hud.selected = target;
      panel.hidden = !target;
      if (!target) { panelKey = null; return; }
      const key = signature([target.session, target.follower, extraRows(target.session, target.follower)]);
      if (key === panelKey) return;
      panelKey = key;
      panelBody.replaceChildren(...(target.follower ? followerPanel(target.session, target.follower)
        : sessionPanel(target.session)));
    }

    function select(target, how = "api") {
      const changed = !sameTarget(target, hud.selected);
      hud.selected = target || null;
      renderPanel();
      if ((changed || how === "waiting") && opts.onSelect) opts.onSelect(hud.selected, how);
    }

    addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      select(null, "tap");
      if (legend) toggleLegend(false);
    });

    hud.update = (doc) => { hud.doc = doc; renderBar(doc); renderPanel(); };
    hud.select = select;
    hud.setStatus = (status, info = {}) => {
      banner.hidden = status !== "unreachable";
      setText(banner, status === "unreachable"
        ? "Can't reach the agent feed" + (info.error ? " (" + info.error + ")" : "") +
          (hud.doc ? ". Showing the last snapshot; retrying." : ". Retrying.")
        : "");
    };
    hud.panel = panel;
    return hud;
  }

  window.AgentvizHud = {create};
})();
