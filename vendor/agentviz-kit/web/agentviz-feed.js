/* agentviz-feed.js: the feed client every agentviz page shares.

   Polls /api/agents (docs/FEED.md), keys sessions and their followers by id,
   and tells the page what was added, removed or changed, and which agents
   made a new tool call. A failed poll is never silent: after `unreachableAfter`
   failures in a row the status turns "unreachable" (the HUD shows a banner)
   and polling backs off, up to `maxBackoffMs`.

     const feed = AgentvizFeed.create({
       onUpdate(doc, diff) {},   // after every snapshot that parsed
       onStatus(status, info) {}, // "connecting" | "live" | "unreachable"
       transform(doc) {},         // optional: rewrite each snapshot first (a page's scripted demo)
     });
     feed.start();               // feed.push(doc) hands it a snapshot directly (captures)

   Also the small helpers every scene needs: fnv1a / seedOf (identical to
   agentfeed's Python seed_of), ease, lerp, smoothstep.

   A classic script (window.AgentvizFeed) that also loads under Node
   (module.exports) for the unit tests. No dependencies. MIT. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AgentvizFeed = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const POLL_MS = 2000;
  const MAX_BACKOFF_MS = 30000;
  const UNREACHABLE_AFTER = 2;
  const PULSE_SEC = 1.2;

  /* ------------------------------------------------------------ hashing */

  // FNV-1a 32-bit over the string's code points, exactly as Python's
  // labels.seed_of (which iterates characters, i.e. code points).
  function fnv1a(text) {
    let hash = 2166136261;
    for (const character of String(text)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }
  const seedOf = (text) => (fnv1a(text) % 10000) / 10000;

  /* ------------------------------------------------------------ easing */

  const lerp = (a, b, k) => a + (b - a) * k;
  // Frame-rate independent approach: `rate` is 1/seconds.
  const ease = (current, target, dt, rate) => current + (target - current) * (1 - Math.exp(-rate * dt));
  const smoothstep = (k) => { const c = Math.min(1, Math.max(0, k)); return c * c * (3 - 2 * c); };

  /* ------------------------------------------------------------ diffing */

  // Ages tick every poll; they are not a change in what the agent is doing.
  const VOLATILE = /(Sec|^serverTime)$/;
  function signature(record, skip) {
    return JSON.stringify(record, (key, value) => (VOLATILE.test(key) || key === skip ? undefined : value));
  }

  const followerKey = (session, follower) => session.id + "/" + follower.id;

  // Every agent in a document, keyed: sessions by id, followers by "lead/follower".
  function index(doc) {
    const sessions = new Map(), followers = new Map();
    for (const session of (doc && doc.sessions) || []) {
      sessions.set(session.id, session);
      for (const follower of session.followers || []) {
        followers.set(followerKey(session, follower), {session, follower});
      }
    }
    return {sessions, followers};
  }

  function diffMaps(before, after, sign) {
    const out = {added: [], removed: [], changed: []};
    for (const [id, value] of after) {
      if (!before.has(id)) out.added.push(id);
      else if (sign(before.get(id)) !== sign(value)) out.changed.push(id);
    }
    for (const id of before.keys()) if (!after.has(id)) out.removed.push(id);
    return out;
  }

  // What changed between two documents. toolCalls lists session ids whose
  // lastToolAt moved (a new tool call) and follower keys whose toolCount rose.
  function diff(previous, next) {
    const a = index(previous), b = index(next);
    const toolCalls = [];
    for (const [id, session] of b.sessions) {
      const old = a.sessions.get(id);
      if (old && session.lastToolAt != null && session.lastToolAt !== old.lastToolAt) toolCalls.push(id);
    }
    for (const [key, entry] of b.followers) {
      const old = a.followers.get(key);
      if (old && (entry.follower.toolCount || 0) > (old.follower.toolCount || 0)) toolCalls.push(key);
    }
    return {
      sessions: diffMaps(a.sessions, b.sessions, (s) => signature(s, "followers")),
      followers: diffMaps(a.followers, b.followers, (e) => signature(e.follower)),
      toolCalls,
    };
  }

  /* ------------------------------------------------------------ client */

  function feedUrl(base, fixture) { return base + (fixture ? "?fixture=1" : ""); }

  function fixtureFromLocation() {
    if (typeof location === "undefined") return false;
    const query = new URLSearchParams(location.search);
    return query.get("fixture") === "1" || query.get("demo") === "1";
  }

  function create(options = {}) {
    const intervalMs = options.intervalMs || POLL_MS;
    const maxBackoffMs = options.maxBackoffMs || MAX_BACKOFF_MS;
    const unreachableAfter = options.unreachableAfter || UNREACHABLE_AFTER;
    const fixture = options.fixture != null ? options.fixture : fixtureFromLocation();
    const url = feedUrl(options.url || "/api/agents", fixture);
    const fetcher = options.fetch || ((u) => fetch(u, {cache: "no-store"}));
    const clock = options.now || (() => Date.now() / 1000);
    const feed = {doc: null, status: "connecting", failures: 0, lastError: null, fixture, polls: 0};
    const toolSeenAt = new Map();
    let timer = null, running = false;

    function setStatus(status) {
      if (status === feed.status) return;
      feed.status = status;
      if (options.onStatus) options.onStatus(status, {failures: feed.failures, error: feed.lastError});
    }

    function accept(raw) {
      const doc = options.transform ? options.transform(raw, feed.polls) : raw;
      const changes = diff(feed.doc, doc);
      const now = clock();
      for (const id of changes.toolCalls) toolSeenAt.set(id, now);
      feed.doc = doc;
      feed.polls++;
      feed.failures = 0;
      feed.lastError = null;
      setStatus("live");
      if (options.onUpdate) options.onUpdate(doc, changes);
      return changes;
    }

    function reject(error) {
      feed.failures++;
      feed.lastError = String(error && error.message ? error.message : error);
      if (feed.failures >= unreachableAfter) setStatus("unreachable");
    }

    function nextDelay() {
      if (!feed.failures) return intervalMs;
      return Math.min(maxBackoffMs, intervalMs * Math.pow(2, feed.failures - 1));
    }

    async function pollOnce() {
      try {
        const response = await fetcher(url);
        if (!response.ok) throw new Error("HTTP " + response.status);
        return accept(await response.json());
      } catch (error) {
        reject(error);
        return null;
      }
    }

    async function loop() {
      timer = null;
      await pollOnce();
      if (running) timer = setTimeout(loop, nextDelay());
    }

    feed.pollOnce = pollOnce;
    feed.start = () => { if (running) return feed; running = true; loop(); return feed; };
    feed.stop = () => { running = false; if (timer) clearTimeout(timer); timer = null; return feed; };
    feed.push = (doc) => accept(doc);
    feed.nextDelay = nextDelay;
    // 1 just after an agent's new tool call, easing to 0 over PULSE_SEC.
    feed.pulse = (id) => {
      const at = toolSeenAt.get(id);
      return at == null ? 0 : Math.max(0, 1 - (clock() - at) / PULSE_SEC);
    };
    return feed;
  }

  return {create, diff, index, followerKey, signature, fnv1a, seedOf, ease, lerp, smoothstep};
});
