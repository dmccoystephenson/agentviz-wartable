// table.h: the oak table, the parchment map on it, the four candles that
// light the room, and the regions (one per place) inked on the map.
#pragma once

#include <algorithm>
#include <cmath>

#include "draw_util.h"

namespace wartable {

struct MapRect {
    float x0, z0, x1, z1;
    float cx() const { return 0.5f * (x0 + x1); }
    float cz() const { return 0.5f * (z0 + z1); }
    float w() const { return x1 - x0; }
    float d() const { return z1 - z0; }
};

constexpr float kInkY = 0.012f;  // ink lines sit just above the parchment

// A thick oak top on a dark floor far below, with plank seams.
inline void drawTableTop(Host& h, const MapRect& m) {
    box(h, m.cx(), -0.35f, m.cz(), m.w() + 9.0f, 0.6f, m.d() + 9.0f, kWood);
    box(h, m.cx(), -0.75f, m.cz(), m.w() + 9.6f, 0.3f, m.d() + 9.6f, kDarkWood);
    for (int k = 0; k < 6; ++k) {
        const float zz = m.z0 - 4.5f + (k + 0.5f) * (m.d() + 9.0f) / 6.0f;
        h.line(m.x0 - 4.5f, -0.049f, zz, m.x1 + 4.5f, -0.049f, zz, {0.04f, 0.02f, 0.01f}, 0.6f);
    }
}

// The parchment, a little proud of the wood, with darker scorched edges,
// rolled ends along the short sides and a double ink border.
inline void drawParchment(Host& h, const MapRect& m) {
    box(h, m.cx(), -0.03f, m.cz(), m.w() + 1.2f, 0.04f, m.d() + 1.2f, scale(kParchment, 0.62f));
    box(h, m.cx(), -0.02f, m.cz(), m.w() + 0.6f, 0.04f, m.d() + 0.6f, scale(kParchment, 0.85f));
    box(h, m.cx(), -0.012f, m.cz(), m.w(), 0.04f, m.d(), kParchment);
    for (int side = 0; side < 2; ++side) {
        const float xr = side ? m.x1 + 0.75f : m.x0 - 0.75f;
        for (float zz = m.z0 - 0.4f; zz <= m.z1 + 0.4f; zz += 0.12f) ball(h, xr, 0.1f, zz, 0.45f, 0.45f, 0.45f, scale(kParchment, 0.7f));
    }
    for (int k = 0; k < 2; ++k) {
        const float inset = k ? 0.35f : 0.15f, px = k ? 1.0f : 2.0f;
        const float a0 = m.x0 + inset, b0 = m.z0 + inset, a1 = m.x1 - inset, b1 = m.z1 - inset;
        h.wideLine(a0, kInkY, b0, a1, kInkY, b0, kInk, px, 0.0f, 0.85f, kRound);
        h.wideLine(a1, kInkY, b0, a1, kInkY, b1, kInk, px, 0.0f, 0.85f, kRound);
        h.wideLine(a1, kInkY, b1, a0, kInkY, b1, kInk, px, 0.0f, 0.85f, kRound);
        h.wideLine(a0, kInkY, b1, a0, kInkY, b0, kInk, px, 0.0f, 0.85f, kRound);
    }
}

// A compass rose in the far corner at (x1, z0); its north point is red.
inline void drawCompassRose(Host& h, const MapRect& m) {
    const float rx = m.x1 - 2.0f, rz = m.z0 + 2.0f;
    circle(h, rx, kInkY, rz, 1.1f, kInk, 1.2f, 0.7f, kRound, 28);
    circle(h, rx, kInkY, rz, 0.4f, kInk, 1.0f, 0.6f, kRound, 16);
    for (int k = 0; k < 8; ++k) {
        const float a = k * kPi / 4.0f, r = (k & 1) ? 0.8f : 1.5f;
        const float px = -std::sin(a) * 0.18f, pz = std::cos(a) * 0.18f;
        const float tx = rx + std::cos(a) * r, tz = rz + std::sin(a) * r;
        const Rgb c = k == 6 ? Rgb{0.5f, 0.06f, 0.04f} : kInk;
        h.wideLine(rx + px, kInkY, rz + pz, tx, kInkY, tz, c, 1.6f, 0.0f, 0.85f, kRound);
        h.wideLine(rx - px, kInkY, rz - pz, tx, kInkY, tz, c, 1.6f, 0.0f, 0.85f, kRound);
    }
}

// Ink waves along the near margin: the sea the scouts never reach.
inline void drawSea(Host& h, const MapRect& m) {
    const float zz = m.z1 - 0.9f;
    for (float xx = m.x0 + 1.5f; xx < m.x1 - 4.0f; xx += 1.4f) {
        for (int k = 0; k < 6; ++k) {
            const float a0 = kPi + k * kPi / 6.0f, a1 = kPi + (k + 1) * kPi / 6.0f;
            h.wideLine(xx + 0.3f * std::cos(a0), kInkY, zz + 0.3f * std::sin(a0) * 0.6f, xx + 0.3f * std::cos(a1), kInkY,
                       zz + 0.3f * std::sin(a1) * 0.6f, {0.12f, 0.16f, 0.2f}, 1.2f, 0.0f, 0.6f, kRound);
        }
    }
}

// Four candles at the corners of the table: the only light in the room.
inline void drawCandles(Host& h, const MapRect& m, float t) {
    const float xs[4] = {m.x0 - 2.6f, m.x1 + 2.6f, m.x1 + 2.6f, m.x0 - 2.6f};
    const float zs[4] = {m.z0 - 2.4f, m.z0 - 2.4f, m.z1 + 2.4f, m.z1 + 2.4f};
    for (int k = 0; k < 4; ++k) {
        const float tall = 1.2f + 0.35f * static_cast<float>(k % 2);
        cyl(h, xs[k], 0.1f, zs[k], 0.9f, 0.1f, {0.32f, 0.2f, 0.07f});  // holder
        cyl(h, xs[k], 0.2f + tall * 0.5f, zs[k], 0.36f, tall * 0.5f, {0.85f, 0.80f, 0.65f});
        box(h, xs[k], 0.2f + tall + 0.06f, zs[k], 0.02f, 0.12f, 0.02f, kInk);  // wick
        const float flicker = 0.9f + 0.1f * std::sin(t * 9.0f + k * 2.1f) * std::sin(t * 5.3f + k);
        const float fy = 0.2f + tall + 0.22f;
        h.point(xs[k], fy, zs[k], 6.0f, 0.22f * flicker, {1.0f, 0.85f, 0.45f}, 1.0f, STRATA_POINT_SOFT);
        h.point(xs[k], fy + 0.05f, zs[k], 10.0f, 0.75f * flicker, kFlame, 0.35f, STRATA_POINT_SOFT);
        StrataPointLight light{};
        light.position[0] = xs[k];
        light.position[1] = fy + 0.6f;
        light.position[2] = zs[k];
        light.range = 26.0f + 0.5f * std::fmax(m.w(), m.d());
        light.color[0] = 1.0f;
        light.color[1] = 0.72f;
        light.color[2] = 0.42f;
        light.intensity = 2.4f * flicker;
        h.fill(light, {0.06f, 0.045f, 0.03f}, 20);
    }
}

inline void drawTable(Host& h, const MapRect& m, float t) {
    drawTableTop(h, m);
    drawParchment(h, m);
    drawCompassRose(h, m);
    drawSea(h, m);
    drawCandles(h, m, t);
}

/* ------------------------------------------------------------- regions */

struct Region {
    float x, z, R, seed;
    bool waiting;
    int toolCount;
};

// Zone extras (web/wartable-frame.js): 0 radius, 1 waiting, 2 busy, 3 sessions, 4 tool count.
inline Region regionOf(const agentviz::Zone& zone) {
    return {0.5f * (zone.x0 + zone.x1), 0.5f * (zone.z0 + zone.z1), zone.extra[0], zone.seed, zone.extra[1] > 0.0f,
            static_cast<int>(zone.extra[4])};
}

constexpr int kOutlinePoints = 11;

// The region's jittered outline radius at angle a, smoothed with a cosine blend.
inline float outlineRadius(const float* rad, float a) {
    const float u = a / (2.0f * kPi) * kOutlinePoints;
    const int i0 = static_cast<int>(std::floor(u)) % kOutlinePoints, i1 = (i0 + 1) % kOutlinePoints;
    const float f = u - std::floor(u), s = 0.5f - 0.5f * std::cos(f * kPi);
    return rad[i0] + (rad[i1] - rad[i0]) * s;
}

// Wash (overlapping flat discs) and an ink border that pulses ember when a banner there waits.
inline void drawRegionWash(Host& h, const Region& r, float t) {
    const Rgb tint = kRegion[idx8(r.seed)];
    float rad[kOutlinePoints];
    for (int k = 0; k < kOutlinePoints; ++k) rad[k] = r.R * (0.98f + 0.24f * hash(r.seed, k));
    cyl(h, r.x, 0.004f, r.z, r.R * 1.5f, 0.006f, tint);
    for (int k = 0; k < kOutlinePoints; ++k) {
        const float a = (k + 0.5f) * 2.0f * kPi / kOutlinePoints, rr = 0.5f * (rad[k] + rad[(k + 1) % kOutlinePoints]);
        cyl(h, r.x + std::cos(a) * rr * 0.55f, 0.004f, r.z + std::sin(a) * rr * 0.55f, rr * 0.95f, 0.006f, tint);
    }
    const Rgb border = r.waiting ? mix(kInk, {0.7f, 0.2f, 0.03f}, 0.5f + 0.5f * std::sin(t * 4.0f)) : kInk;
    const int segments = 66;
    for (int k = 0; k < segments; ++k) {
        const float a0 = k * 2.0f * kPi / segments, a1 = (k + 1) * 2.0f * kPi / segments;
        const float r0 = outlineRadius(rad, a0) * 1.04f, r1 = outlineRadius(rad, std::fmod(a1, 2.0f * kPi)) * 1.04f;
        h.wideLine(r.x + std::cos(a0) * r0, 0.02f, r.z + std::sin(a0) * r0, r.x + std::cos(a1) * r1, 0.02f,
                   r.z + std::sin(a1) * r1, border, r.waiting ? 3.0f : 2.0f, 0.0f, 0.8f, kRound);
    }
}

// Hills and copses from the seed, kept to the rim so banners stay clear.
inline void drawRegionTerrain(Host& h, const Region& r) {
    const Rgb tint = kRegion[idx8(r.seed)];
    for (int k = 0; k < 5; ++k) {
        const float a = hash(r.seed, k + 100.0f) * 2.0f * kPi, rr = r.R * (0.72f + 0.2f * hash(r.seed, k + 120.0f));
        const float hx = r.x + std::cos(a) * rr, hz = r.z + std::sin(a) * rr;
        if (k < 2) {
            ball(h, hx, 0.0f, hz, 1.1f, 0.45f, 0.8f, scale(tint, 0.7f));
            ball(h, hx + 0.5f, 0.0f, hz + 0.2f, 0.8f, 0.32f, 0.6f, scale(tint, 0.75f));
            continue;
        }
        for (int j = 0; j < 3; ++j) {
            const float tx = hx + (hash(r.seed, k * 7.0f + j) - 0.5f) * 0.9f;
            const float tz = hz + (hash(r.seed, k * 9.0f + j) - 0.5f) * 0.9f;
            cyl(h, tx, 0.1f, tz, 0.05f, 0.1f, kDarkWood);
            ball(h, tx, 0.32f, tz, 0.3f, 0.36f, 0.3f, {0.06f, 0.16f, 0.06f});
        }
    }
}

// The region's keep: a stone hall that grows a tower for every doubling of
// the place's tool calls (none below 10 calls, up to four).
inline int keepTowers(int toolCount) {
    if (toolCount < 10) return 0;
    return std::min(4, 1 + static_cast<int>(std::floor(std::log2(toolCount / 10.0f) / 1.5f)));
}

inline void drawKeep(Host& h, const Region& r) {
    const int towers = keepTowers(r.toolCount);
    if (!towers) return;
    const float a = hash(r.seed, 140.0f) * 2.0f * kPi + kPi;  // opposite side of the rim from the first hill
    const float kx = r.x + std::cos(a) * r.R * 0.8f, kz = r.z + std::sin(a) * r.R * 0.8f;
    box(h, kx, 0.18f, kz, 0.9f, 0.36f, 0.9f, kStone);
    const float corners[4][2] = {{-0.45f, -0.45f}, {0.45f, 0.45f}, {0.45f, -0.45f}, {-0.45f, 0.45f}};
    for (int k = 0; k < towers; ++k) {
        const float tx = kx + corners[k][0], tz = kz + corners[k][1], tall = 0.55f + 0.1f * k;
        cyl(h, tx, tall * 0.5f, tz, 0.34f, tall * 0.5f, scale(kStone, 0.9f));
        ball(h, tx, tall + 0.04f, tz, 0.4f, 0.32f, 0.4f, {0.38f, 0.10f, 0.06f});  // a red domed roof
    }
}

inline void drawRegion(Host& h, const agentviz::Zone& zone, float t) {
    const Region r = regionOf(zone);
    drawRegionWash(h, r, t);
    drawRegionTerrain(h, r);
    drawKeep(h, r);
}

}  // namespace wartable
