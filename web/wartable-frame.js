/* wartable-frame.js: packs the war table for the scene, once a frame, in the
   agentviz wire format (vendor/agentviz-kit, docs/KIT.md in agentviz).
   scene/main.cpp and its headers read what is written here.

     scene floats  0-3 the parchment's extent x0, z0, x1, z1; 4 the camera yaw
                   (world glyphs such as the beacon's "?" turn to face it)
     zones         kind 0 a region (a place): its bounding square;
                     extras: 0 radius, 1 sessions waiting, 2 busy, 3 sessions, 4 the place's tool count
     agents        a session (banner): facing 0;
                     extras: 0 raise, 1 beacon, 2 furl, 3 wave (each 0..1, eased),
                             4, 5 the raven's direction to the map edge, 6 the distance along it
                   a follower (scout): facing = heading;
                     extras: 0 galloping, 1 camped (0..1), 2 its lead is offline (0/1)
     links         kind 0 a scout's dotted path, from its banner (x0, z0) to its cross (x1, z1);
                     kind 1 the same for an offline lead; seed = the lead's seed; alpha = appear

   Classic script: window.WartableFrame. Needs Wartable (wartable-model.js). */
(function () {
  "use strict";
  const ZONE = {region: 0};
  const LINK = {path: 0, pathOffline: 1};

  const sessionSeed = (s) => (s.seed != null ? s.seed : window.AgentvizFeed.seedOf(s.id));
  const offline = (b) => b.session.state === "offline";

  function regions(wire, table) {
    for (const r of table.regions) {
      wire.zone({id: "place:" + r.id, kind: ZONE.region, seed: r.seed,
        x0: r.ex - r.eR, z0: r.ez - r.eR, x1: r.ex + r.eR, z1: r.ez + r.eR,
        extra: [r.eR, r.waiting, r.busy, r.sessions, r.toolCount]});
    }
  }

  function banners(wire, table, highlightOf, pulseOf) {
    for (const b of table.banners) {
      wire.agent({session: b.session, x: b.x, y: 0, z: b.z, appear: b.appear,
        highlight: highlightOf(b.id), pulse: pulseOf(b.id),
        extra: [b.raise, b.beacon, b.furl, b.wave, b.edge.dx, b.edge.dz, b.edge.dist]});
    }
  }

  function scouts(wire, table, highlightOf, pulseOf) {
    for (const sc of table.scouts) {
      wire.agent({session: sc.owner.session, follower: sc.follower, x: sc.x, y: 0, z: sc.z, facing: sc.heading,
        appear: sc.appear * sc.owner.appear, highlight: highlightOf(sc.id), pulse: pulseOf(sc.id),
        extra: [sc.gallop, sc.camped, offline(sc.owner) ? 1 : 0]});
    }
  }

  function paths(wire, table) {
    for (const sc of table.scouts) {
      const b = sc.owner;
      wire.link({kind: offline(b) ? LINK.pathOffline : LINK.path, from: b.id, to: sc.id,
        x0: b.x, z0: b.z, x1: sc.dx, z1: sc.dz, seed: sessionSeed(b.session), alpha: sc.appear * b.appear});
    }
  }

  // highlightOf(id) -> 0 none, 1 selected, 2 hovered; pulseOf(id) -> 0..1 after a new tool call.
  function write(wire, table, cameraYaw, highlightOf, pulseOf) {
    wire.begin({doc: table.doc, scene: table.map.concat([cameraYaw])});
    regions(wire, table);
    banners(wire, table, highlightOf, pulseOf);
    scouts(wire, table, highlightOf, pulseOf);
    paths(wire, table);
    return wire;
  }

  window.WartableFrame = {write, ZONE, LINK};
})();
