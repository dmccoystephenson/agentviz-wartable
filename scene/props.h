// props.h: what a busy session is doing, as a prop beside its banner: the
// smith's anvil (edit), a catapult (run), a scroll on a lectern (read), a
// raven to the map edge (web), a war horn (delegate), pale motes round the
// furled flag (think), a war drum (other). Flat lists of shapes, one
// function per action.
#pragma once

#include <cmath>

#include "draw_util.h"

namespace wartable {

struct PropSite {
    float x, z, seed, t, top;     // the banner
    float edgeX, edgeZ, edgeDist; // towards the map edge, for the raven
    float ax() const { return x + 1.0f; }  // where the prop stands
    float az() const { return z + 0.6f; }
};

// The forge beside the anvil: a stone hearth of glowing coals.
inline void drawForge(Host& h, const PropSite& p) {
    const float fx = p.ax() + 0.15f, fz = p.az() + 0.45f;
    cyl(h, fx, 0.1f, fz, 0.42f, 0.1f, {0.25f, 0.23f, 0.21f});
    for (int k = 0; k < 6; ++k) {
        const float glow = 0.6f + 0.4f * std::sin(p.t * 3.0f + k * 1.9f);
        h.point(fx + 0.1f * std::cos(k * 1.05f), 0.22f, fz + 0.1f * std::sin(k * 1.05f), 3.0f, 0.14f,
                {1.0f, 0.35f + 0.2f * glow, 0.05f}, 0.9f * glow);
    }
    h.light(fx, 0.6f, fz, 2.5f, {1.0f, 0.45f, 0.12f}, 0.9f, 3);
}

// Edit: a hammer falls on the anvil and sparks fly.
inline void drawAnvil(Host& h, const PropSite& p) {
    const float ax = p.ax(), az = p.az();
    box(h, ax, 0.12f, az, 0.26f, 0.24f, 0.2f, kIron);
    box(h, ax, 0.29f, az, 0.5f, 0.1f, 0.22f, {0.2f, 0.2f, 0.22f});
    ball(h, ax + 0.3f, 0.29f, az, 0.18f, 0.08f, 0.12f, {0.2f, 0.2f, 0.22f});
    box(h, ax, 0.02f, az, 0.4f, 0.04f, 0.3f, kDarkWood);
    drawForge(h, p);
    const float beat = fract(p.t * 1.4f + p.seed);
    const float lift = beat < 0.8f ? std::sin(beat / 0.8f * kPi) * 0.4f : 0.0f;
    box(h, ax - 0.05f, 0.42f + lift, az, 0.14f, 0.1f, 0.1f, kIron);
    box(h, ax - 0.25f, 0.42f + lift, az, 0.32f, 0.035f, 0.035f, kWood);
    if (beat < 0.8f && beat >= 0.15f) return;
    const float spread = beat >= 0.8f ? (beat - 0.8f) / 0.2f : 1.0f + beat / 0.15f * 0.3f;
    const float q = std::fmin(spread, 1.3f);
    for (int k = 0; k < 12; ++k) {
        const float a = k * 0.52f + hash(p.seed, k) * 0.5f, v = 0.4f + 0.5f * hash(p.seed, k + 9.0f);
        h.point(ax - 0.05f + std::cos(a) * q * v, 0.36f + q * 0.55f - q * q * 0.45f, az + std::sin(a) * q * v, 4.0f, 0.05f,
                {1.0f, 0.7f, 0.2f}, 1.0f - q / 1.3f);
    }
    h.light(ax, 0.6f, az, 3.0f, {1.0f, 0.55f, 0.15f}, 1.2f * (1.0f - std::fmin(spread, 1.0f)), 3);
}

// Run: a catapult rolls back and forth, winds and throws a stone.
inline void drawCatapult(Host& h, const PropSite& p) {
    const float ox = p.ax() + 0.25f * std::sin(p.t * 0.6f + p.seed * 5.0f), az = p.az();
    box(h, ox, 0.12f, az, 0.85f, 0.08f, 0.42f, kWood);
    for (int k = 0; k < 4; ++k)
        ball(h, ox + ((k & 1) ? 0.3f : -0.3f), 0.1f, az + ((k & 2) ? 0.24f : -0.24f), 0.2f, 0.2f, 0.06f, kDarkWood);
    box(h, ox, 0.32f, az - 0.17f, 0.06f, 0.36f, 0.06f, kWood);
    box(h, ox, 0.32f, az + 0.17f, 0.06f, 0.36f, 0.06f, kWood);
    const float cycle = fract(p.t * 0.45f + p.seed);
    const float th = cycle < 0.75f ? 0.3f - 0.85f * (cycle / 0.75f) : -0.55f + 2.0f * std::fmin((cycle - 0.75f) / 0.06f, 1.0f);
    const float dx = -std::cos(th), dy = std::sin(th), py = 0.48f;
    for (int k = -2; k <= 6; ++k) box(h, ox + dx * k * 0.1f, py + dy * k * 0.1f, az, 0.07f, 0.07f, 0.07f, kWood);
    ball(h, ox + dx * 0.68f, py + dy * 0.68f, az, 0.16f, 0.1f, 0.16f, kDarkWood);
    const Rgb stone{0.4f, 0.38f, 0.35f};
    if (cycle > 0.81f) {
        const float q = (cycle - 0.81f) / 0.19f;
        ball(h, ox + 0.5f + q * 2.2f, py + 0.7f + q * 1.4f - q * q * 2.0f, az, 0.14f, 0.14f, 0.14f, stone);
    } else if (cycle < 0.75f) {
        ball(h, ox + dx * 0.68f, py + dy * 0.68f + 0.08f, az, 0.12f, 0.12f, 0.12f, stone);
    }
    for (int k = 0; k < 4; ++k) {  // dust from the wheels
        const float q = fract(p.t * 0.8f + k * 0.25f);
        h.point(ox - 0.4f - q * 0.3f, 0.05f + q * 0.2f, az + (k - 1.5f) * 0.15f, 3.0f, 0.18f + q * 0.2f,
                {0.45f, 0.36f, 0.24f}, 0.5f * (1.0f - q));
    }
}

// Read: a scroll unrolls on a lectern.
inline void drawScroll(Host& h, const PropSite& p) {
    const float ax = p.ax(), az = p.az();
    box(h, ax, 0.2f, az, 0.24f, 0.4f, 0.2f, kWood);
    box(h, ax, 0.41f, az, 0.5f, 0.03f, 0.38f, kWood);
    const float L = 0.2f + 0.7f * (0.5f - 0.5f * std::cos(p.t * 0.9f + p.seed * 7.0f));
    box(h, ax, 0.44f, az, L, 0.02f, 0.32f, {0.92f, 0.84f, 0.62f});
    box(h, ax - L * 0.5f, 0.47f, az, 0.07f, 0.07f, 0.4f, kDarkWood);
    box(h, ax + L * 0.5f, 0.47f, az, 0.07f, 0.07f, 0.4f, kDarkWood);
    for (int k = 0; k < 4; ++k) {
        const float lz = az - 0.1f + k * 0.065f, lw = (L - 0.15f) * (0.5f + 0.4f * hash(p.seed, k));
        if (lw > 0.02f) h.line(ax - lw * 0.5f, 0.452f, lz, ax + lw * 0.5f, 0.452f, lz, kInk, 0.9f);
    }
    h.point(ax, 0.55f, az, 4.0f, 0.5f, {1.0f, 0.95f, 0.75f}, 0.25f);
}

// Web: a raven flies out to the map edge and back over a dotted ink line.
inline void drawRaven(Host& h, const PropSite& p) {
    const float cycle = fract(p.t / 7.0f + p.seed);
    const float u0 = cycle < 0.5f ? cycle * 2.0f : 2.0f - cycle * 2.0f, u = u0 * u0 * (3.0f - 2.0f * u0);
    const float far = std::fmax(p.edgeDist - 0.4f, 1.0f), reach = 0.5f + (far - 0.5f) * u;
    const float rx = p.x + p.edgeX * reach, rz = p.z + p.edgeZ * reach, ry = 1.4f + 1.4f * std::sin(u * kPi);
    const float fx = cycle < 0.5f ? p.edgeX : -p.edgeX, fz = cycle < 0.5f ? p.edgeZ : -p.edgeZ;
    const Rgb black{0.02f, 0.02f, 0.03f};
    ball(h, rx, ry, rz, 0.26f, 0.16f, 0.26f, black);
    ball(h, rx + fx * 0.18f, ry + 0.05f, rz + fz * 0.18f, 0.13f, 0.13f, 0.13f, black);
    ball(h, rx + fx * 0.27f, ry + 0.04f, rz + fz * 0.27f, 0.06f, 0.05f, 0.06f, {0.3f, 0.25f, 0.1f});
    ball(h, rx - fx * 0.2f, ry, rz - fz * 0.2f, 0.16f, 0.05f, 0.16f, black);
    const float flap = std::sin(p.t * 12.0f + p.seed * 9.0f);
    for (int side = -1; side <= 1; side += 2)
        for (int k = 1; k <= 3; ++k)
            ball(h, rx - fz * side * 0.12f * k, ry + flap * 0.06f * k, rz + fx * side * 0.12f * k, 0.16f, 0.04f, 0.16f, black);
    for (float s = 0.6f; s < reach; s += 0.45f) h.point(p.x + p.edgeX * s, 0.03f, p.z + p.edgeZ * s, 3.0f, 0.06f, kInk, 0.55f, 0);
}

// Delegate: a war horn on a stand, its blast rippling out over the map.
inline void drawHorn(Host& h, const PropSite& p) {
    const float ax = p.ax(), az = p.az();
    cyl(h, ax, 0.4f, az, 0.06f, 0.4f, kWood);
    for (int k = 0; k < 7; ++k) {
        const float s = k / 6.0f, r = 0.06f + 0.17f * s * s;
        ball(h, ax - 0.25f + s * 0.55f, 0.82f + 0.18f * s * s, az, r, r, r, k == 6 ? Rgb{0.6f, 0.42f, 0.1f} : kGold);
    }
    for (int k = 0; k < 3; ++k) {
        const float q = fract(p.t * 0.6f + k / 3.0f);
        circle(h, p.x, 0.04f, p.z, 0.9f + 3.0f * q, kGold, 3.0f, 0.85f * (1.0f - q), kRound, 40);
        h.point(ax + 0.4f + q * 0.8f, 1.0f + q * 0.3f, az, 3.0f, 0.1f + 0.3f * q, {1.0f, 0.85f, 0.4f}, 0.6f * (1.0f - q));
    }
}

// Think: pale motes drift round the furled flag's top.
inline void drawThoughtMotes(Host& h, const PropSite& p) {
    for (int k = 0; k < 5; ++k) {
        const float a = p.t * 0.6f + k * 2.0f * kPi / 5.0f;
        h.point(p.x + std::cos(a) * 0.6f, p.top - 0.3f + 0.15f * std::sin(p.t + k), p.z + std::sin(a) * 0.6f, 4.0f, 0.1f,
                {0.6f, 0.75f, 1.0f}, 0.75f);
    }
}

// Other: a war drum, beaten.
inline void drawDrum(Host& h, const PropSite& p) {
    const float ax = p.ax(), az = p.az();
    cyl(h, ax, 0.2f, az, 0.5f, 0.2f, {0.45f, 0.10f, 0.06f});
    cyl(h, ax, 0.41f, az, 0.48f, 0.01f, {0.85f, 0.78f, 0.6f});
    const float beat = std::fabs(std::sin(p.t * 4.0f + p.seed));
    ball(h, ax + 0.1f, 0.45f + beat * 0.3f, az, 0.08f, 0.08f, 0.08f, kWood);
    box(h, ax + 0.25f, 0.5f + beat * 0.3f, az, 0.3f, 0.03f, 0.03f, kWood);
    const float q = fract(p.t * 4.0f / kPi + p.seed / kPi);
    circle(h, ax, 0.43f, az, 0.25f + 0.4f * q, {0.85f, 0.78f, 0.6f}, 2.0f, 0.8f * (1.0f - q), kRound, 20);
}

inline void drawActionProp(Host& h, const PropSite& p, Action action) {
    switch (action) {
        case Action::Edit: drawAnvil(h, p); break;
        case Action::Run: drawCatapult(h, p); break;
        case Action::Read: drawScroll(h, p); break;
        case Action::Web: drawRaven(h, p); break;
        case Action::Delegate: drawHorn(h, p); break;
        case Action::Think: drawThoughtMotes(h, p); break;
        case Action::Other: drawDrum(h, p); break;
        default: break;
    }
}

}  // namespace wartable
