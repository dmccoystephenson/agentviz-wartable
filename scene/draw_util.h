// draw_util.h: colours and small shapes shared by the war table's drawing.
#pragma once

#include <cmath>
#include <cstdint>

#include "strata_kit.h"
#include "../vendor/agentviz-kit/scene/agentviz.h"

namespace wartable {

using strata_kit::Host;
using strata_kit::Rgb;
using agentviz::Action;
using agentviz::State;

constexpr float kPi = 3.14159265f;

inline float fract(float v) { return v - std::floor(v); }
inline float hash(float seed, float i) { return fract(std::sin(seed * 127.1f + i * 311.7f) * 43758.5453f); }
inline float clamp01(float v) { return std::fmin(1.0f, std::fmax(0.0f, v)); }
inline Rgb mix(Rgb a, Rgb b, float k) { return {a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k}; }
inline Rgb scale(Rgb a, float k) { return {a.r * k, a.g * k, a.b * k}; }
// Toward a dull grey by k.
inline Rgb grey(Rgb a, float k) {
    const float l = 0.3f * a.r + 0.59f * a.g + 0.11f * a.b;
    return mix(a, {l * 0.8f, l * 0.8f, l * 0.8f}, k);
}

// Heraldic field colours for banners (linear RGB), and the metal that goes
// with each, picked by the session's seed (FIELD in web/page.js, in sRGB).
const Rgb kField[8] = {{0.55f, 0.05f, 0.04f}, {0.05f, 0.12f, 0.45f}, {0.06f, 0.30f, 0.08f}, {0.30f, 0.06f, 0.36f},
                       {0.70f, 0.42f, 0.04f}, {0.04f, 0.04f, 0.05f}, {0.55f, 0.18f, 0.02f}, {0.05f, 0.32f, 0.36f}};
const Rgb kMetal[8] = {{0.85f, 0.65f, 0.15f}, {0.85f, 0.83f, 0.75f}, {0.85f, 0.65f, 0.15f}, {0.85f, 0.83f, 0.75f},
                       {0.45f, 0.04f, 0.03f}, {0.85f, 0.65f, 0.15f}, {0.85f, 0.83f, 0.75f}, {0.85f, 0.65f, 0.15f}};
// Map tints for regions: muted inks washed into the parchment.
const Rgb kRegion[8] = {{0.42f, 0.48f, 0.26f}, {0.56f, 0.42f, 0.20f}, {0.52f, 0.30f, 0.26f}, {0.30f, 0.40f, 0.46f},
                        {0.44f, 0.34f, 0.46f}, {0.50f, 0.50f, 0.30f}, {0.34f, 0.46f, 0.38f}, {0.58f, 0.36f, 0.30f}};
// Per-action colours for the scouts' pennants, indexed by agentviz::Action.
const Rgb kAction[8] = {{0.45f, 0.42f, 0.38f}, {0.95f, 0.42f, 0.06f}, {0.70f, 0.07f, 0.06f}, {0.92f, 0.88f, 0.72f},
                        {0.04f, 0.04f, 0.05f}, {0.95f, 0.72f, 0.12f}, {0.30f, 0.55f, 0.95f}, {0.50f, 0.26f, 0.72f}};

const Rgb kInk{0.10f, 0.06f, 0.03f};
const Rgb kParchment{0.78f, 0.64f, 0.42f};
const Rgb kWood{0.20f, 0.10f, 0.05f};
const Rgb kDarkWood{0.10f, 0.05f, 0.025f};
const Rgb kIron{0.10f, 0.10f, 0.11f};
const Rgb kGold{0.85f, 0.62f, 0.15f};
const Rgb kFlame{1.0f, 0.62f, 0.22f};
const Rgb kStone{0.36f, 0.33f, 0.30f};
const Rgb kSmoke{0.55f, 0.53f, 0.5f};
const Rgb kEmber{1.0f, 0.45f, 0.08f};
const Rgb kSkin{0.7f, 0.5f, 0.36f};

constexpr uint32_t kRound = STRATA_LINES_ROUND_CAPS;

inline int idx8(float seed) { return static_cast<int>(clamp01(seed) * 7.999f); }

inline void box(Host& h, float x, float y, float z, float sx, float sy, float sz, Rgb c) {
    h.add(STRATA_PRIMITIVE_CUBE, x, y, z, sx, sy, sz, c);
}
inline void ball(Host& h, float x, float y, float z, float sx, float sy, float sz, Rgb c) {
    h.add(STRATA_PRIMITIVE_SPHERE, x, y, z, sx, sy, sz, c);
}
inline void cyl(Host& h, float x, float y, float z, float diameter, float halfH, Rgb c) {
    h.add(STRATA_PRIMITIVE_CYLINDER, x, y, z, diameter, halfH, diameter, c);
}

// A horizontal circle of wide lines; dash skips every other segment; spin turns it.
inline void circle(Host& h, float x, float y, float z, float r, Rgb c, float px, float a, uint32_t flags, int seg = 32,
                   bool dash = false, float spin = 0.0f) {
    for (int k = 0; k < seg; ++k) {
        if (dash && (k & 1)) continue;
        const float a0 = k * 2.0f * kPi / seg + spin, a1 = (k + 1) * 2.0f * kPi / seg + spin;
        h.wideLine(x + std::cos(a0) * r, y, z + std::sin(a0) * r, x + std::cos(a1) * r, y, z + std::sin(a1) * r, c, px,
                   0.0f, a, flags);
    }
}

// A small fire: a few rising soft points, and a light when lightPriority >= 0.
inline void fire(Host& h, float x, float y, float z, float size, float t, float seed, int n, int lightPriority,
                 float lightIntensity) {
    for (int k = 0; k < n; ++k) {
        const float p = fract(t * (1.1f + 0.4f * hash(seed, k)) + hash(seed, k + 20.0f));
        const float jx = (hash(seed, k + 40.0f) - 0.5f) * size * 0.6f, jz = (hash(seed, k + 60.0f) - 0.5f) * size * 0.6f;
        const Rgb c = mix({1.0f, 0.85f, 0.35f}, {0.85f, 0.18f, 0.04f}, p);
        h.point(x + jx * (1.0f - p), y + p * size * 2.2f, z + jz * (1.0f - p), 2.0f, size * (1.0f - 0.7f * p), c,
                0.95f * (1.0f - p));
    }
    if (lightPriority >= 0) {
        const float fl = 0.85f + 0.15f * std::sin(t * 13.0f + seed * 40.0f) * std::sin(t * 7.3f + seed);
        h.light(x, y + size * 1.5f, z, 2.0f + size * 8.0f, {1.0f, 0.55f, 0.22f}, lightIntensity * fl, lightPriority);
    }
}

// Grey smoke rising and drifting: a stalled banner or scout.
inline void smoke(Host& h, float x, float y, float z, float t, float seed, int n, float height, float a) {
    for (int k = 0; k < n; ++k) {
        const float p = fract(t * 0.25f + k / static_cast<float>(n) + hash(seed, k));
        const float drift = std::sin(t * 0.7f + k) * 0.25f * p;
        h.point(x + drift + p * 0.4f, y + p * height, z + drift * 0.5f, 4.0f, 0.35f + 0.8f * p, kSmoke,
                a * (1.0f - p) * 0.75f);
    }
}

// The gold selection ring of dashes (selected) or a pale one (hovered), turning slowly.
inline void selectionRing(Host& h, float x, float z, float r, agentviz::Highlight hl, float t, float spin, int seg) {
    if (hl == agentviz::Highlight::None) return;
    const bool selected = hl == agentviz::Highlight::Selected;
    circle(h, x, 0.05f, z, r, selected ? kGold : Rgb{0.8f, 0.75f, 0.6f}, selected ? 4.0f : 2.5f, 0.95f,
           kRound | STRATA_LINES_ON_TOP, seg, true, t * spin);
}

}  // namespace wartable
