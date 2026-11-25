/* agentviz-wire.js: the one page -> engine data format (docs/KIT.md, "Wire").

   Each frame the page lays out its scene (where every agent stands, how far
   it has eased in) and packs it into one Float32Array:

     header [HEADER]                   magic, format version, counts, 16 scene floats
     zones  [nZones  x ZONE_STRIDE]    areas on the ground: places, pods, regions
     agents [nAgents x AGENT_STRIDE]   one per session or follower (subagent)
     links  [nLinks  x LINK_STRIDE]    lines between things: trails, delegation, routes

   Every record has a fixed common part, decoded by kit/scene/agentviz.h, and
   a few "extra" floats whose meaning the scene chooses. Ids are FNV-1a hashes
   cut to 24 bits (exact in a float); states and actions are indices into
   agentfeed/vocabulary.py's STATES and ACTIONS.

     const wire = AgentvizWire.create();
     wire.begin({doc, scene: [..16 floats]});
     wire.zone({id, kind, seed, x0, z0, x1, z1, appear, extra: [...]});
     wire.agent({session, follower, x, y, z, facing, appear, highlight, pulse, extra: [...]});
     wire.link({kind, from, to, x0, y0, z0, x1, y1, z1, phase, seed, alpha});
     wire.send(module);   // copies into the wasm heap, calls _agentviz_frame(ptr, count)

   Classic script (window.AgentvizWire) or Node module. Needs AgentvizFeed. MIT. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./agentviz-feed.js"));
  else root.AgentvizWire = factory(root.AgentvizFeed);
})(typeof self !== "undefined" ? self : this, function (Feed) {
  "use strict";

  const FORMAT_VERSION = 1;
  const MAGIC = 42727;  // 0xA6E7: "this buffer is agentviz wire"
  const HEADER = 24, SCENE_FLOATS = 16;
  const ZONE_STRIDE = 16, ZONE_EXTRAS = 8;
  const AGENT_STRIDE = 36, AGENT_EXTRAS = 16;
  const LINK_STRIDE = 12;

  // Same order as agentfeed/vocabulary.py (tests/test_kit_vocabulary.py checks).
  const STATES = ["offline", "dim", "idle", "busy", "waiting"];
  const ACTIONS = ["none", "edit", "run", "read", "web", "delegate", "think", "other"];
  const WAITING_REASONS = ["none", "question", "permission"];
  const KIND = {session: 0, follower: 1};
  const HIGHLIGHT = {none: 0, selected: 1, hovered: 2};
  // A follower has its own two states; on the wire they read as busy / idle.
  const FOLLOWER_STATE = {active: "busy", resting: "idle"};

  const id24 = (text) => Feed.fnv1a(text) & 0xffffff;
  const indexOr = (list, value, fallback) => { const i = list.indexOf(value); return i < 0 ? fallback : i; };
  const flag = (value) => (value ? 1 : 0);

  function sessionFields(session) {
    const seed = session.seed != null ? session.seed : Feed.seedOf(session.id);
    const followers = session.followers || [];
    return {
      id: id24(session.id), parent: id24(session.id), kind: KIND.session,
      state: indexOr(STATES, session.state, 1), action: indexOr(ACTIONS, session.action, 0),
      waitingReason: session.state === "waiting" ? indexOr(WAITING_REASONS, session.waitingReason, 0) : 0,
      stalled: flag(session.stalled), finished: 0, seed, parentSeed: seed,
      toolCount: session.toolCount || 0,
      followers: followers.filter((f) => f.state === "active").length,
    };
  }

  function followerFields(session, follower) {
    const parent = sessionFields(session);
    const resting = follower.state !== "active";
    return {
      id: id24(Feed.followerKey(session, follower)), parent: parent.id, kind: KIND.follower,
      state: STATES.indexOf(FOLLOWER_STATE[follower.state] || "idle"),
      action: resting ? 0 : indexOr(ACTIONS, follower.action, 0), waitingReason: 0,
      stalled: flag(follower.stalled), finished: flag(follower.finished),
      seed: follower.seed != null ? follower.seed : Feed.seedOf(follower.id), parentSeed: parent.seed,
      toolCount: follower.toolCount || 0, followers: 0,
    };
  }

  function writeExtras(out, offset, extra, count) {
    for (let i = 0; i < count; i++) out[offset + i] = extra && extra[i] != null ? extra[i] : 0;
  }

  function create() {
    let data = new Float32Array(HEADER + 64 * AGENT_STRIDE);
    let length = 0, zones = 0, agents = 0, links = 0, section = 0;
    let ptr = 0, capacity = 0;

    function reserve(count) {
      if (length + count <= data.length) return;
      const bigger = new Float32Array(Math.max(data.length * 2, length + count));
      bigger.set(data.subarray(0, length));
      data = bigger;
    }
    // The decoder reads records by count in this order, so they must arrive grouped.
    function enter(next) {
      if (next < section) throw new Error("agentviz wire: write zones, then agents, then links");
      section = next;
    }
    function put(values) {
      reserve(values.length);
      data.set(values, length);
      length += values.length;
    }

    const wire = {};
    wire.begin = ({doc = null, scene = [], waitingCount = null} = {}) => {
      zones = agents = links = section = 0;
      length = HEADER;
      data.fill(0, 0, HEADER);
      const sessions = (doc && doc.sessions) || [];
      data[5] = waitingCount != null ? waitingCount : sessions.filter((s) => s.state === "waiting").length;
      data[6] = flag(doc && doc.fixture);
      writeExtras(data, 8, scene, SCENE_FLOATS);
      return wire;
    };
    wire.zone = (z) => {
      enter(0);
      const row = new Array(ZONE_STRIDE).fill(0);
      row.splice(0, 8, id24(z.id), z.kind || 0, z.seed != null ? z.seed : Feed.seedOf(z.id),
        z.x0, z.z0, z.x1, z.z1, z.appear != null ? z.appear : 1);
      writeExtras(row, 8, z.extra, ZONE_EXTRAS);
      put(row);
      zones++;
      return wire;
    };
    wire.agent = (a) => {
      enter(1);
      const f = a.follower ? followerFields(a.session, a.follower) : sessionFields(a.session);
      const row = new Array(AGENT_STRIDE).fill(0);
      row.splice(0, 20, f.id, f.parent, f.kind, f.state, f.action, f.waitingReason, f.stalled, f.finished,
        f.seed, f.parentSeed, a.x || 0, a.y || 0, a.z || 0, a.facing || 0, a.appear != null ? a.appear : 1,
        a.highlight || 0, a.pulse || 0, f.toolCount, f.followers, 0);
      writeExtras(row, 20, a.extra, AGENT_EXTRAS);
      put(row);
      agents++;
      return wire;
    };
    wire.link = (l) => {
      enter(2);
      put([l.kind || 0, l.from != null ? id24(l.from) : 0, l.to != null ? id24(l.to) : 0,
        l.x0, l.y0 || 0, l.z0, l.x1, l.y1 || 0, l.z1, l.phase || 0, l.seed || 0, l.alpha != null ? l.alpha : 1]);
      links++;
      return wire;
    };
    wire.finish = () => {
      data[0] = MAGIC; data[1] = FORMAT_VERSION; data[2] = zones; data[3] = agents; data[4] = links;
      return data.subarray(0, length);
    };
    wire.send = (mod) => {
      const packed = wire.finish();
      if (packed.length > capacity) {
        if (ptr) mod._free(ptr);
        capacity = packed.length + 64 * AGENT_STRIDE;
        ptr = mod._malloc(capacity * 4);
      }
      mod.HEAPF32.set(packed, ptr >> 2);
      mod._agentviz_frame(ptr, packed.length);
    };
    return wire;
  }

  return {create, id24, FORMAT_VERSION, MAGIC, HEADER, SCENE_FLOATS, ZONE_STRIDE, ZONE_EXTRAS, AGENT_STRIDE,
    AGENT_EXTRAS, LINK_STRIDE, STATES, ACTIONS, WAITING_REASONS, KIND, HIGHLIGHT};
});
