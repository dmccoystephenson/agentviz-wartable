// scout.h: a subagent as a mounted scout in its lead's colours, riding a
// dotted ink path out to a cross and back while active, camped by a tent
// and a small fire at the cross while resting. Strata primitives have no
// rotation, so the horse is built from spheres along its heading.
#pragma once

#include <cmath>

#include "draw_util.h"

namespace wartable {

struct Scout {
    float x, z, seed, t;
    float fx, fz, px, pz;  // heading (forward) and its left-hand perpendicular
    float gallop, camped, k;  // k: figure scale (grows in as it appears)
    Action action;
    agentviz::Highlight highlight;
    bool stalled;
    float pulse;
    Rgb owner, coat;

    bool resting() const { return camped > 0.5f; }
    float bob() const { return gallop * std::fabs(std::sin(t * 9.0f + seed * 20.0f)) * 0.07f * k; }
};

// Agent extras (web/wartable-frame.js): 0 galloping, 1 camped, 2 its lead is offline.
inline Scout scoutOf(const agentviz::Agent& a, float t) {
    Scout s{};
    s.x = a.x; s.z = a.z; s.seed = a.seed; s.t = t;
    s.fx = std::cos(a.facing); s.fz = std::sin(a.facing); s.px = -s.fz; s.pz = s.fx;
    s.gallop = a.extra[0]; s.camped = a.extra[1]; s.k = 0.85f * clamp01(a.appear);
    s.action = a.action; s.highlight = a.highlight; s.stalled = a.stalled; s.pulse = a.pulse;
    s.owner = grey(kField[idx8(a.parentSeed)], a.extra[2] > 0.5f ? 0.8f : 0.0f);
    s.coat = mix({0.30f, 0.16f, 0.07f}, {0.12f, 0.08f, 0.05f}, hash(a.seed, 1.0f));
    return s;
}

// Link kind 0 (1: its lead is offline): the dotted path from the banner to
// the scout's point, and the ink cross that marks the point.
inline void drawScoutPath(Host& h, const agentviz::Link& l) {
    const Rgb path = mix(kInk, grey(kField[idx8(l.seed)], l.kind == 1 ? 0.8f : 0.0f), 0.45f);
    const float lx = l.x1 - l.x0, lz = l.z1 - l.z0, len = std::sqrt(lx * lx + lz * lz);
    const float ux = len > 0.0f ? lx / len : 0.0f, uz = len > 0.0f ? lz / len : 0.0f;
    for (float d = 0.8f; d < len; d += 0.28f) h.point(l.x0 + ux * d, 0.03f, l.z0 + uz * d, 3.0f, 0.07f, path, 0.85f * l.alpha, 0);
    h.wideLine(l.x1 - 0.18f, 0.03f, l.z1 - 0.18f, l.x1 + 0.18f, 0.03f, l.z1 + 0.18f, path, 2.0f, 0.0f, 0.85f, kRound);
    h.wideLine(l.x1 - 0.18f, 0.03f, l.z1 + 0.18f, l.x1 + 0.18f, 0.03f, l.z1 - 0.18f, path, 2.0f, 0.0f, 0.85f, kRound);
}

// Body, neck and head along the heading (grazing when camped), legs that
// swing at the gallop, and a saddle cloth in the lead's colours.
inline void drawHorse(Host& h, const Scout& s) {
    const float k = s.k, bob = s.bob(), hy = 0.42f * k + bob;
    for (int i = -1; i <= 1; ++i) ball(h, s.x + s.fx * i * 0.15f * k, hy, s.z + s.fz * i * 0.15f * k, 0.3f * k, 0.25f * k, 0.3f * k, s.coat);
    const float neck = s.resting() ? -0.12f : 0.0f;
    ball(h, s.x + s.fx * 0.3f * k, hy + (0.14f + neck) * k, s.z + s.fz * 0.3f * k, 0.15f * k, 0.17f * k, 0.15f * k, s.coat);
    ball(h, s.x + s.fx * 0.42f * k, hy + (0.24f + neck * 2.0f) * k, s.z + s.fz * 0.42f * k, 0.16f * k, 0.13f * k, 0.16f * k,
         s.coat);
    for (int leg = 0; leg < 4; ++leg) {
        const float fwd = (leg < 2 ? 0.17f : -0.17f) * k, side = ((leg & 1) ? 0.08f : -0.08f) * k;
        const float swing = s.gallop * std::sin(s.t * 9.0f + s.seed * 20.0f + (leg < 2 ? 0.0f : kPi) + (leg & 1) * 0.6f) * 0.1f * k;
        const float lx = s.x + s.fx * (fwd + swing) + s.px * side, lz = s.z + s.fz * (fwd + swing) + s.pz * side;
        h.add(STRATA_PRIMITIVE_CYLINDER, lx, 0.15f * k + bob * 0.5f, lz, 0.06f * k, 0.15f * k, 0.06f * k, s.coat);
    }
    ball(h, s.x, hy + 0.1f * k, s.z, 0.3f * k, 0.08f * k, 0.3f * k, s.owner);
}

// A small cue of the action above an active rider.
inline void drawActionCue(Host& h, const Scout& s, float cy) {
    switch (s.action) {
        case Action::Edit:
            for (int j = 0; j < 4; ++j) {
                const float q = fract(s.t * 1.8f + j * 0.25f + s.seed);
                h.point(s.x + std::cos(j * 1.7f) * q * 0.3f, cy - 0.2f + q * 0.25f - q * q * 0.3f, s.z + std::sin(j * 1.7f) * q * 0.3f,
                        3.0f, 0.04f, {1.0f, 0.7f, 0.2f}, 1.0f - q);
            }
            break;
        case Action::Run:
            for (int j = 0; j < 4; ++j) {
                const float q = fract(s.t * 1.2f + j * 0.25f + s.seed), back = (0.3f + q * 0.4f) * s.k;
                h.point(s.x - s.fx * back, 0.06f + q * 0.18f, s.z - s.fz * back, 3.0f, 0.15f + q * 0.2f, {0.45f, 0.36f, 0.24f},
                        0.55f * (1.0f - q));
            }
            break;
        case Action::Web: {
            const float a = s.t * 2.5f + s.seed * 10.0f;
            ball(h, s.x + std::cos(a) * 0.4f, cy + 0.1f, s.z + std::sin(a) * 0.4f, 0.12f, 0.06f, 0.12f, {0.02f, 0.02f, 0.03f});
            break;
        }
        case Action::Delegate: {
            const float q = fract(s.t * 0.9f + s.seed);
            circle(h, s.x, 0.04f, s.z, 0.3f + 0.6f * q, kGold, 2.0f, 0.8f * (1.0f - q), kRound, 20);
            break;
        }
        case Action::Think: h.point(s.x, cy + 0.05f * std::sin(s.t * 2.0f), s.z, 4.0f, 0.1f, {0.6f, 0.75f, 1.0f}, 0.8f); break;
        default: break;
    }
}

// The rider, cloaked in the lead's colour, helmed, with a lance and a
// pennant in the action's colour (it flashes gold at a new tool call).
inline void drawRider(Host& h, const Scout& s) {
    const float k = s.k, ry = 0.42f * k + s.bob() + 0.32f * k;
    h.add(STRATA_PRIMITIVE_CAPSULE, s.x - s.fx * 0.03f * k, ry, s.z - s.fz * 0.03f * k, 0.18f * k, 0.12f * k, 0.18f * k, s.owner);
    ball(h, s.x, ry + 0.26f * k, s.z, 0.15f * k, 0.15f * k, 0.15f * k, kSkin);
    ball(h, s.x, ry + 0.32f * k, s.z, 0.15f * k, 0.07f * k, 0.15f * k, kIron);  // helm
    const float lx = s.x + s.px * 0.14f * k, lz = s.z + s.pz * 0.14f * k;
    cyl(h, lx, ry + 0.25f * k, lz, 0.03f * k, 0.5f * k, kWood);
    const float wave = std::sin(s.t * 8.0f + s.seed * 10.0f) * 0.04f * k;
    const Rgb pennant = mix(kAction[static_cast<int>(s.action)], {1.0f, 0.85f, 0.35f}, s.pulse);
    ball(h, lx - s.fx * 0.14f * k, ry + 0.65f * k + wave, lz - s.fz * 0.14f * k, 0.26f * k, 0.14f * k, 0.26f * k, pennant);
    if (s.pulse > 0.01f)
        h.point(lx, ry + 0.7f * k, lz, 10.0f + 12.0f * s.pulse, 0.4f, {1.0f, 0.8f, 0.3f}, 0.7f * s.pulse, STRATA_POINT_SOFT);
    if (s.action == Action::Read)
        box(h, s.x + s.fx * 0.15f * k, ry + 0.12f * k, s.z + s.fz * 0.15f * k, 0.18f * k, 0.12f * k, 0.18f * k, {0.92f, 0.84f, 0.62f});
    drawActionCue(h, s, ry + 0.95f * k);
}

// Camped: a tent in the lead's colour, the rider seated by a small fire,
// the pennant planted beside the tent.
inline void drawCamp(Host& h, const Scout& s) {
    const float k = s.k, tx = s.x + s.px * 0.5f, tz = s.z + s.pz * 0.5f;
    for (int j = 0; j < 4; ++j) {
        const float w = (0.55f - j * 0.13f) * k;
        box(h, tx, (0.07f + j * 0.12f) * k, tz, w, 0.12f * k, w * 0.9f, mix(s.owner, kInk, j * 0.08f));
    }
    const float ffx = s.x - s.px * 0.35f + s.fx * 0.25f, ffz = s.z - s.pz * 0.35f + s.fz * 0.25f;
    box(h, ffx, 0.03f, ffz, 0.22f * k, 0.04f, 0.05f, kDarkWood);
    box(h, ffx, 0.05f, ffz, 0.05f, 0.04f, 0.22f * k, kDarkWood);
    fire(h, ffx, 0.08f, ffz, 0.16f, s.t, s.seed, 6, 1, 0.7f);
    const float sx = ffx - s.px * 0.25f, sz = ffz - s.pz * 0.25f;
    h.add(STRATA_PRIMITIVE_CAPSULE, sx, 0.16f * k, sz, 0.18f * k, 0.1f * k, 0.18f * k, s.owner);
    ball(h, sx, 0.4f * k, sz, 0.14f * k, 0.14f * k, 0.14f * k, kSkin);
    cyl(h, tx + s.fx * 0.4f * k, 0.35f * k, tz + s.fz * 0.4f * k, 0.03f * k, 0.35f * k, kWood);
    ball(h, tx + s.fx * 0.5f * k, 0.64f * k, tz + s.fz * 0.5f * k, 0.2f * k, 0.1f * k, 0.2f * k, kAction[static_cast<int>(s.action)]);
}

inline void drawScout(Host& h, const agentviz::Agent& agent, float t) {
    if (agent.appear < 0.02f) return;
    const Scout s = scoutOf(agent, t);
    selectionRing(h, s.x, s.z, 0.6f, s.highlight, t, 0.8f, 24);
    drawHorse(h, s);
    if (s.resting()) drawCamp(h, s);
    else drawRider(h, s);
    // Stalled: quiet for five minutes without finishing; grey smoke over it.
    if (s.stalled) smoke(h, s.x, 0.5f, s.z, t, s.seed, 14, 2.4f, 1.0f);
}

}  // namespace wartable
