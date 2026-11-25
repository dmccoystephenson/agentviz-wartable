// agentviz-wartable: Claude Code sessions as a candle-lit campaign war table.
//
// The page (web/wartable.js) owns the feed, the layout and the easing; this
// file only draws what it is handed each frame through four setters:
//
//   wt_set_map(x0, z0, x1, z1)       the parchment's extent
//   wt_set_regions(rows, n)          one region per place (REGION_STRIDE floats)
//   wt_set_banners(rows, n)          one banner per session (BANNER_STRIDE floats)
//   wt_set_scouts(rows, n)           one mounted scout per subagent (SCOUT_STRIDE floats)
//
// Everything animated is a function of the scene time t the kit passes to
// strata_kit_build, so ?drive=1 captures repeat. Strata primitives have no
// rotation, so anything that must face an arbitrary heading (horses, ravens)
// is built from spheres, which look the same from every side.
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include <cmath>
#include <vector>

namespace {

using strata_kit::Host;
using strata_kit::Rgb;

constexpr float kPi = 3.14159265f;
constexpr int REGION_STRIDE = 8;   // x, z, radius, seed, waiting, busy, sessions, selected
constexpr int BANNER_STRIDE = 16;  // see drawBanner
constexpr int SCOUT_STRIDE = 16;   // see drawScout

enum State { DIM = 0, IDLE = 1, BUSY = 2, WAITING = 3, OFFLINE = 4 };
enum Action { NONE = 0, EDIT = 1, RUN = 2, READ = 3, WEB = 4, DELEGATE = 5, THINK = 6, OTHER = 7 };

struct Scene {
    float map[4] = {-20.0f, -14.0f, 20.0f, 14.0f};
    std::vector<float> regions, banners, scouts;
} g;

float fract(float v) { return v - std::floor(v); }
float hash(float seed, float i) { return fract(std::sin(seed * 127.1f + i * 311.7f) * 43758.5453f); }
float clamp01(float v) { return std::fmin(1.0f, std::fmax(0.0f, v)); }
Rgb mix(Rgb a, Rgb b, float k) { return {a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k}; }
Rgb scale(Rgb a, float k) { return {a.r * k, a.g * k, a.b * k}; }
Rgb grey(Rgb a, float k) {  // toward a dull grey by k
    const float l = 0.3f * a.r + 0.59f * a.g + 0.11f * a.b;
    return mix(a, {l * 0.8f, l * 0.8f, l * 0.8f}, k);
}

// Heraldic field colours for banners (linear RGB), and the metal that goes
// with each. Picked by the session's seed.
const Rgb kField[8] = {{0.55f, 0.05f, 0.04f}, {0.05f, 0.12f, 0.45f}, {0.06f, 0.30f, 0.08f}, {0.30f, 0.06f, 0.36f},
                       {0.70f, 0.42f, 0.04f}, {0.04f, 0.04f, 0.05f}, {0.55f, 0.18f, 0.02f}, {0.05f, 0.32f, 0.36f}};
const Rgb kMetal[8] = {{0.85f, 0.65f, 0.15f}, {0.85f, 0.83f, 0.75f}, {0.85f, 0.65f, 0.15f}, {0.85f, 0.83f, 0.75f},
                       {0.45f, 0.04f, 0.03f}, {0.85f, 0.65f, 0.15f}, {0.85f, 0.83f, 0.75f}, {0.85f, 0.65f, 0.15f}};
// Map tints for regions: muted inks washed into the parchment.
const Rgb kRegion[8] = {{0.42f, 0.48f, 0.26f}, {0.56f, 0.42f, 0.20f}, {0.52f, 0.30f, 0.26f}, {0.30f, 0.40f, 0.46f},
                        {0.44f, 0.34f, 0.46f}, {0.50f, 0.50f, 0.30f}, {0.34f, 0.46f, 0.38f}, {0.58f, 0.36f, 0.30f}};
// Per-action colours: the scouts' pennants and the panel chips share them.
const Rgb kAction[8] = {{0.45f, 0.42f, 0.38f}, {0.95f, 0.42f, 0.06f}, {0.70f, 0.07f, 0.06f}, {0.92f, 0.88f, 0.72f},
                        {0.04f, 0.04f, 0.05f}, {0.95f, 0.72f, 0.12f}, {0.30f, 0.55f, 0.95f}, {0.50f, 0.26f, 0.72f}};

const Rgb kInk{0.10f, 0.06f, 0.03f};
const Rgb kParchment{0.78f, 0.64f, 0.42f};
const Rgb kWood{0.20f, 0.10f, 0.05f};
const Rgb kDarkWood{0.10f, 0.05f, 0.025f};
const Rgb kIron{0.10f, 0.10f, 0.11f};
const Rgb kGold{0.85f, 0.62f, 0.15f};
const Rgb kFlame{1.0f, 0.62f, 0.22f};

int idx8(float seed) { return static_cast<int>(clamp01(seed) * 7.999f); }

void circle(Host& h, float x, float y, float z, float r, Rgb c, float px, float a, uint32_t flags, int seg = 32,
            float dash = 0.0f, float spin = 0.0f) {
    for (int k = 0; k < seg; ++k) {
        if (dash > 0.0f && (k & 1)) continue;
        const float a0 = k * 2.0f * kPi / seg + spin, a1 = (k + 1) * 2.0f * kPi / seg + spin;
        h.wideLine(x + std::cos(a0) * r, y, z + std::sin(a0) * r, x + std::cos(a1) * r, y, z + std::sin(a1) * r, c, px,
                   0.0f, a, flags);
    }
}

// A small fire: a few rising soft points, and a light when asked.
void fire(Host& h, float x, float y, float z, float size, float t, float seed, int n, int lightPriority,
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

void smoke(Host& h, float x, float y, float z, float t, float seed, int n, float height, float a) {
    for (int k = 0; k < n; ++k) {
        const float p = fract(t * 0.25f + k / static_cast<float>(n) + hash(seed, k));
        const float drift = std::sin(t * 0.7f + k) * 0.25f * p;
        h.point(x + drift + p * 0.4f, y + p * height, z + drift * 0.5f, 4.0f, 0.35f + 0.8f * p, {0.55f, 0.53f, 0.5f},
                a * (1.0f - p) * 0.75f);
    }
}

/* ------------------------------------------------------------- the table */

void drawTable(Host& h, double tt) {
    const float t = static_cast<float>(tt);
    const float x0 = g.map[0], z0 = g.map[1], x1 = g.map[2], z1 = g.map[3];
    const float cx = 0.5f * (x0 + x1), cz = 0.5f * (z0 + z1), w = x1 - x0, d = z1 - z0;
    // The table: a thick oak top on a dark floor far below.
    h.add(STRATA_PRIMITIVE_CUBE, cx, -0.35f, cz, w + 9.0f, 0.6f, d + 9.0f, kWood);
    h.add(STRATA_PRIMITIVE_CUBE, cx, -0.75f, cz, w + 9.6f, 0.3f, d + 9.6f, kDarkWood);
    for (int k = 0; k < 6; ++k) {  // planks
        const float zz = z0 - 4.5f + (k + 0.5f) * (d + 9.0f) / 6.0f;
        h.line(x0 - 4.5f, -0.049f, zz, x1 + 4.5f, -0.049f, zz, {0.04f, 0.02f, 0.01f}, 0.6f);
    }
    // The parchment, a little proud of the wood, with darker scorched edges.
    h.add(STRATA_PRIMITIVE_CUBE, cx, -0.03f, cz, w + 1.2f, 0.04f, d + 1.2f, scale(kParchment, 0.62f));
    h.add(STRATA_PRIMITIVE_CUBE, cx, -0.02f, cz, w + 0.6f, 0.04f, d + 0.6f, scale(kParchment, 0.85f));
    h.add(STRATA_PRIMITIVE_CUBE, cx, -0.012f, cz, w, 0.04f, d, kParchment);
    // Rolled ends along the short sides, as chains of spheres.
    for (int side = 0; side < 2; ++side) {
        const float xr = side ? x1 + 0.75f : x0 - 0.75f;
        for (float zz = z0 - 0.4f; zz <= z1 + 0.4f; zz += 0.12f)
            h.add(STRATA_PRIMITIVE_SPHERE, xr, 0.1f, zz, 0.45f, 0.45f, 0.45f, scale(kParchment, 0.7f));
    }
    // A double ink border.
    const uint32_t round = STRATA_LINES_ROUND_CAPS;
    const float y = 0.012f;
    for (int k = 0; k < 2; ++k) {
        const float m = k ? 0.35f : 0.15f;
        const float a0 = x0 + m, b0 = z0 + m, a1 = x1 - m, b1 = z1 - m;
        h.wideLine(a0, y, b0, a1, y, b0, kInk, k ? 1.0f : 2.0f, 0.0f, 0.85f, round);
        h.wideLine(a1, y, b0, a1, y, b1, kInk, k ? 1.0f : 2.0f, 0.0f, 0.85f, round);
        h.wideLine(a1, y, b1, a0, y, b1, kInk, k ? 1.0f : 2.0f, 0.0f, 0.85f, round);
        h.wideLine(a0, y, b1, a0, y, b0, kInk, k ? 1.0f : 2.0f, 0.0f, 0.85f, round);
    }
    // A compass rose in the north-east corner.
    {
        const float rx = x1 - 2.0f, rz = z0 + 2.0f;
        circle(h, rx, y, rz, 1.1f, kInk, 1.2f, 0.7f, round, 28);
        circle(h, rx, y, rz, 0.4f, kInk, 1.0f, 0.6f, round, 16);
        for (int k = 0; k < 8; ++k) {
            const float a = k * kPi / 4.0f, r = (k & 1) ? 0.8f : 1.5f;
            const float px = -std::sin(a) * 0.18f, pz = std::cos(a) * 0.18f;
            const float tx = rx + std::cos(a) * r, tz = rz + std::sin(a) * r;
            h.wideLine(rx + px, y, rz + pz, tx, y, tz, k == 6 ? Rgb{0.5f, 0.06f, 0.04f} : kInk, 1.6f, 0.0f, 0.85f, round);
            h.wideLine(rx - px, y, rz - pz, tx, y, tz, k == 6 ? Rgb{0.5f, 0.06f, 0.04f} : kInk, 1.6f, 0.0f, 0.85f, round);
        }
    }
    // Ink waves along the south margin: the sea the scouts never reach.
    for (float xx = x0 + 1.5f; xx < x1 - 4.0f; xx += 1.4f) {
        const float zz = z1 - 0.9f;
        for (int k = 0; k < 6; ++k) {
            const float a0 = kPi + k * kPi / 6.0f, a1 = kPi + (k + 1) * kPi / 6.0f;
            h.wideLine(xx + 0.3f * std::cos(a0), y, zz + 0.3f * std::sin(a0) * 0.6f, xx + 0.3f * std::cos(a1), y,
                       zz + 0.3f * std::sin(a1) * 0.6f, {0.12f, 0.16f, 0.2f}, 1.2f, 0.0f, 0.6f, round);
        }
    }
    // Four candles at the corners of the table: the only light in the room.
    const float cxs[4] = {x0 - 2.6f, x1 + 2.6f, x1 + 2.6f, x0 - 2.6f};
    const float czs[4] = {z0 - 2.4f, z0 - 2.4f, z1 + 2.4f, z1 + 2.4f};
    for (int k = 0; k < 4; ++k) {
        const float hgt = 1.2f + 0.35f * static_cast<float>(k % 2);
        h.add(STRATA_PRIMITIVE_CYLINDER, cxs[k], 0.1f, czs[k], 0.9f, 0.1f, 0.9f, {0.32f, 0.2f, 0.07f});  // holder
        h.add(STRATA_PRIMITIVE_CYLINDER, cxs[k], 0.2f + hgt * 0.5f, czs[k], 0.36f, hgt * 0.5f, 0.36f,
              {0.85f, 0.80f, 0.65f});
        h.add(STRATA_PRIMITIVE_CUBE, cxs[k], 0.2f + hgt + 0.06f, czs[k], 0.02f, 0.12f, 0.02f, kInk);
        const float fl = 0.9f + 0.1f * std::sin(t * 9.0f + k * 2.1f) * std::sin(t * 5.3f + k);
        const float fy = 0.2f + hgt + 0.22f;
        h.point(cxs[k], fy, czs[k], 6.0f, 0.22f * fl, {1.0f, 0.85f, 0.45f}, 1.0f, STRATA_POINT_SOFT);
        h.point(cxs[k], fy + 0.05f, czs[k], 10.0f, 0.75f * fl, kFlame, 0.35f, STRATA_POINT_SOFT);
        StrataPointLight l{};
        l.position[0] = cxs[k];
        l.position[1] = fy + 0.6f;
        l.position[2] = czs[k];
        l.range = 26.0f + 0.5f * std::fmax(w, d);
        l.color[0] = 1.0f;
        l.color[1] = 0.72f;
        l.color[2] = 0.42f;
        l.intensity = 2.4f * fl;
        h.fill(l, {0.06f, 0.045f, 0.03f}, 20);
    }
}

/* ------------------------------------------------------------- regions */

void drawRegion(Host& h, const float* r, float t) {
    const float x = r[0], z = r[1], R = r[2], seed = r[3];
    const bool waiting = r[4] > 0.0f;
    const Rgb tint = kRegion[idx8(seed)];
    constexpr int N = 11;
    float rad[N];
    for (int k = 0; k < N; ++k) rad[k] = R * (0.98f + 0.24f * hash(seed, k));
    // Wash: overlapping flat discs, then the ink border through the jittered
    // outline (smoothed by sampling a cosine blend between vertices).
    h.add(STRATA_PRIMITIVE_CYLINDER, x, 0.004f, z, R * 1.5f, 0.006f, R * 1.5f, tint);
    for (int k = 0; k < N; ++k) {
        const float a = (k + 0.5f) * 2.0f * kPi / N, rr = 0.5f * (rad[k] + rad[(k + 1) % N]);
        h.add(STRATA_PRIMITIVE_CYLINDER, x + std::cos(a) * rr * 0.55f, 0.004f, z + std::sin(a) * rr * 0.55f,
              rr * 0.95f, 0.006f, rr * 0.95f, tint);
    }
    const int S = 66;
    auto radiusAt = [&](float a) {
        const float u = a / (2.0f * kPi) * N;
        const int i0 = static_cast<int>(std::floor(u)) % N, i1 = (i0 + 1) % N;
        const float f = u - std::floor(u), s = 0.5f - 0.5f * std::cos(f * kPi);
        return rad[i0] + (rad[i1] - rad[i0]) * s;
    };
    const Rgb border = waiting ? mix(kInk, {0.7f, 0.2f, 0.03f}, 0.5f + 0.5f * std::sin(t * 4.0f)) : kInk;
    for (int k = 0; k < S; ++k) {
        const float a0 = k * 2.0f * kPi / S, a1 = (k + 1) * 2.0f * kPi / S;
        const float r0 = radiusAt(a0) * 1.04f, r1 = radiusAt(std::fmod(a1, 2.0f * kPi)) * 1.04f;
        h.wideLine(x + std::cos(a0) * r0, 0.02f, z + std::sin(a0) * r0, x + std::cos(a1) * r1, 0.02f,
                   z + std::sin(a1) * r1, border, waiting ? 3.0f : 2.0f, 0.0f, 0.8f, STRATA_LINES_ROUND_CAPS);
    }
    // Hills and copses, from the seed, kept to the rim so banners stay clear.
    for (int k = 0; k < 5; ++k) {
        const float a = hash(seed, k + 100.0f) * 2.0f * kPi, rr = R * (0.72f + 0.2f * hash(seed, k + 120.0f));
        const float hx = x + std::cos(a) * rr, hz = z + std::sin(a) * rr;
        if (k < 2) {
            h.add(STRATA_PRIMITIVE_SPHERE, hx, 0.0f, hz, 1.1f, 0.45f, 0.8f, scale(tint, 0.7f));
            h.add(STRATA_PRIMITIVE_SPHERE, hx + 0.5f, 0.0f, hz + 0.2f, 0.8f, 0.32f, 0.6f, scale(tint, 0.75f));
        } else {
            for (int j = 0; j < 3; ++j) {
                const float tx = hx + (hash(seed, k * 7.0f + j) - 0.5f) * 0.9f;
                const float tz = hz + (hash(seed, k * 9.0f + j) - 0.5f) * 0.9f;
                h.add(STRATA_PRIMITIVE_CYLINDER, tx, 0.1f, tz, 0.05f, 0.1f, 0.05f, kDarkWood);
                h.add(STRATA_PRIMITIVE_SPHERE, tx, 0.32f, tz, 0.3f, 0.36f, 0.3f, {0.06f, 0.16f, 0.06f});
            }
        }
    }
}

/* ------------------------------------------------------------- banners */

// Row: 0 x, 1 z, 2 seed, 3 state, 4 action, 5 stalled, 6 selected (1 hover, 2 selected),
// 7 raise 0..1, 8 beacon 0..1, 9 furl 0..1, 10 wave 0..1, 11 web dir x, 12 web dir z,
// 13 distance to the map edge along it, 14 appear 0..1, 15 scouts riding.
void drawBanner(Host& h, const float* b, float t) {
    const float x = b[0], z = b[1], seed = b[2];
    const int state = static_cast<int>(b[3]), action = static_cast<int>(b[4]);
    const bool stalled = b[5] > 0.5f;
    const int sel = static_cast<int>(b[6]);
    const float raise = b[7], beacon = b[8], furl = b[9], wave = b[10];
    const float ex = b[11], ez = b[12], edge = b[13], appear = clamp01(b[14]);
    const bool offline = state == OFFLINE;
    const float dull = offline ? 0.85f : (state == DIM ? 0.5f : 0.0f);
    const Rgb field = grey(kField[idx8(seed)], dull), metal = grey(kMetal[idx8(seed)], dull);

    // Ground ring in the banner's colour, and a cairn the pole stands in.
    circle(h, x, 0.025f, z, 0.75f, mix(field, kInk, 0.3f), 2.5f, offline ? 0.35f : 0.8f, STRATA_LINES_ROUND_CAPS, 28);
    h.add(STRATA_PRIMITIVE_SPHERE, x, 0.02f, z, 0.62f, 0.3f, 0.62f, {0.22f, 0.20f, 0.18f});
    h.add(STRATA_PRIMITIVE_SPHERE, x + 0.15f, 0.08f, z - 0.1f, 0.3f, 0.22f, 0.3f, {0.28f, 0.26f, 0.23f});

    // Pole: lowered to a stump when offline.
    const float top = (0.9f + 2.3f * raise) * (0.3f + 0.7f * appear);
    h.add(STRATA_PRIMITIVE_CYLINDER, x, top * 0.5f, z, 0.09f, top * 0.5f, 0.09f, offline ? Rgb{0.12f, 0.1f, 0.09f} : kWood);
    h.add(STRATA_PRIMITIVE_SPHERE, x, top + 0.08f, z, 0.18f, 0.18f, 0.18f, offline ? Rgb{0.3f, 0.3f, 0.28f} : kGold);
    h.add(STRATA_PRIMITIVE_CUBE, x + 0.42f * (1.0f - furl * 0.6f), top - 0.04f, z, 0.9f * (1.0f - furl * 0.6f) + 0.1f,
          0.04f, 0.04f, kWood);  // the crossbar the flag hangs from

    // Flag: strips that wave in z (busy), hang still (idle), or wrap tight
    // round the pole (thinking: furled).
    const int N = 7;
    const float W = 1.05f * (1.0f - 0.72f * furl), H = 1.0f * (1.0f - 0.15f * furl);
    const float speed = 2.5f + 2.0f * wave;
    for (int i = 0; i < N; ++i) {
        const float u = (i + 0.5f) / N;
        const float sx = x + 0.06f + u * W;
        const float amp = (0.04f + 0.16f * wave) * u * (1.0f - furl * 0.8f);
        const float sz = z + amp * std::sin(t * speed - i * 0.9f + seed * 30.0f);
        // Offline: the flag droops and shortens (rows of a hanging cloth).
        const float droop = offline ? u * 0.25f : 0.0f;
        const float yTop = top - 0.08f - droop, hMain = H * 0.62f, hBand = H * 0.38f;
        h.add(STRATA_PRIMITIVE_CUBE, sx, yTop - hMain * 0.5f, sz, W / N + 0.01f, hMain, 0.035f, field);
        h.add(STRATA_PRIMITIVE_CUBE, sx, yTop - hMain - hBand * 0.5f, sz, W / N + 0.01f, hBand, 0.035f,
              (i == N - 1 && !offline) ? field : metal);
    }
    // A swallowtail notch: two short tails below the last strip.
    if (furl < 0.5f) {
        const float tx = x + 0.06f + W * 0.9f;
        h.add(STRATA_PRIMITIVE_CUBE, tx, top - 0.08f - H - 0.12f - (offline ? 0.25f : 0.0f),
              z + 0.12f * wave * std::sin(t * speed - 6.0f), W / N, 0.24f, 0.035f, metal);
    }

    // Selection: a slowly turning gold ring of dashes on the map.
    if (sel > 0) {
        circle(h, x, 0.05f, z, 1.15f, sel == 2 ? kGold : Rgb{0.8f, 0.75f, 0.6f}, sel == 2 ? 4.0f : 2.5f, 0.95f,
               STRATA_LINES_ROUND_CAPS | STRATA_LINES_ON_TOP, 36, 1.0f, t * 0.5f);
    }

    // Idle: the banner hangs still and a low candle stub burns beside it.
    if (state == IDLE || state == DIM) {
        const float cx = x + 0.45f, cz = z + 0.42f;
        h.add(STRATA_PRIMITIVE_CYLINDER, cx, 0.03f, cz, 0.3f, 0.03f, 0.3f, kGold);
        h.add(STRATA_PRIMITIVE_CYLINDER, cx, 0.12f, cz, 0.14f, 0.07f, 0.14f, {0.85f, 0.80f, 0.65f});
        const float fl = 0.8f + 0.2f * std::sin(t * 8.0f + seed * 9.0f);
        h.point(cx, 0.27f, cz, 3.0f, 0.1f * fl, {1.0f, 0.8f, 0.4f}, 0.9f);
        h.point(cx, 0.3f, cz, 5.0f, 0.35f, kFlame, 0.25f);
        h.light(cx, 0.6f, cz, 2.2f, {1.0f, 0.65f, 0.3f}, 0.5f * fl, 2);
    }

    // Stalled: grey smoke from the banner top.
    if (stalled) smoke(h, x + 0.3f, top * 0.6f, z, t, seed, 12, 2.6f, 1.0f);

    // Waiting on the owner: a beacon fire on a hill beside the banner.
    if (beacon > 0.01f) {
        const float bx = x - 1.25f, bz = z - 0.55f, k = beacon;
        h.add(STRATA_PRIMITIVE_SPHERE, bx, -0.1f, bz, 1.6f, 0.9f * k, 1.6f, {0.30f, 0.26f, 0.16f});
        const float hy = 0.35f * k;
        h.add(STRATA_PRIMITIVE_CYLINDER, bx, hy + 0.15f, bz, 0.08f, 0.15f, 0.08f, kIron);  // the brazier's post
        h.add(STRATA_PRIMITIVE_CYLINDER, bx, hy + 0.38f, bz, 0.55f, 0.09f, 0.55f, kIron);  // its bowl
        for (int j = 0; j < 3; ++j)
            h.add(STRATA_PRIMITIVE_CUBE, bx, hy + 0.5f + j * 0.06f, bz, j == 1 ? 0.08f : 0.45f, 0.06f, j == 1 ? 0.45f : 0.08f,
                  kDarkWood);
        fire(h, bx, hy + 0.55f, bz, 0.55f * k, t, seed + 3.0f, 22, -1, 0.0f);
        const float fl = 0.8f + 0.2f * std::sin(t * 11.0f) * std::sin(t * 4.3f + 1.0f);
        h.light(bx, hy + 1.6f, bz, 11.0f, {1.0f, 0.5f, 0.15f}, 3.5f * fl * k, 100);
        // Seen from anywhere: a glow drawn over everything, and a pulsing
        // ring round the banner on the map.
        const float pulse = 0.5f + 0.5f * std::sin(t * 5.0f);
        h.point(bx, hy + 1.0f, bz, 26.0f + 14.0f * pulse, 1.6f, {1.0f, 0.55f, 0.15f}, 0.45f * k,
                STRATA_POINT_SOFT | STRATA_POINT_ON_TOP);
        h.point(bx, hy + 0.9f, bz, 10.0f, 0.4f, {1.0f, 0.9f, 0.5f}, 0.9f * k, STRATA_POINT_SOFT | STRATA_POINT_ON_TOP);
        for (int j = 0; j < 2; ++j) {
            const float p = fract(t * 0.6f + j * 0.5f);
            circle(h, x - 0.4f, 0.04f, z - 0.2f, 1.2f + 2.4f * p, {1.0f, 0.45f, 0.08f}, 4.0f, 0.9f * (1.0f - p) * k,
                   STRATA_LINES_ROUND_CAPS | STRATA_LINES_ON_TOP, 40);
        }
        // Sparks thrown high, so the beacon reads at any zoom.
        for (int j = 0; j < 10; ++j) {
            const float p = fract(t * 0.5f + hash(seed, j + 200.0f));
            h.point(bx + std::sin(j * 2.3f + t) * 0.4f * p, hy + 1.2f + p * 3.5f, bz + std::cos(j * 1.7f) * 0.3f * p,
                    3.0f, 0.06f, {1.0f, 0.75f, 0.3f}, (1.0f - p) * k, STRATA_POINT_SOFT);
        }
    }

    if (offline || state != BUSY) return;

    // What the session is doing now, as a prop beside the banner.
    const float ax = x + 1.0f, az = z + 0.6f;
    switch (action) {
        case EDIT: {  // the smith's anvil: a hammer falls, sparks fly
            h.add(STRATA_PRIMITIVE_CUBE, ax, 0.12f, az, 0.26f, 0.24f, 0.2f, kIron);
            h.add(STRATA_PRIMITIVE_CUBE, ax, 0.29f, az, 0.5f, 0.1f, 0.22f, {0.2f, 0.2f, 0.22f});
            h.add(STRATA_PRIMITIVE_SPHERE, ax + 0.3f, 0.29f, az, 0.18f, 0.08f, 0.12f, {0.2f, 0.2f, 0.22f});
            h.add(STRATA_PRIMITIVE_CUBE, ax, 0.02f, az, 0.4f, 0.04f, 0.3f, kDarkWood);
            // The forge beside it: a stone hearth of glowing coals.
            h.add(STRATA_PRIMITIVE_CYLINDER, ax + 0.15f, 0.1f, az + 0.45f, 0.42f, 0.1f, 0.42f, {0.25f, 0.23f, 0.21f});
            for (int k = 0; k < 6; ++k) {
                const float glow = 0.6f + 0.4f * std::sin(t * 3.0f + k * 1.9f);
                h.point(ax + 0.15f + 0.1f * std::cos(k * 1.05f), 0.22f, az + 0.45f + 0.1f * std::sin(k * 1.05f), 3.0f,
                        0.14f, {1.0f, 0.35f + 0.2f * glow, 0.05f}, 0.9f * glow);
            }
            h.light(ax + 0.15f, 0.6f, az + 0.45f, 2.5f, {1.0f, 0.45f, 0.12f}, 0.9f, 3);
            const float p = fract(t * 1.4f + seed);
            const float lift = p < 0.8f ? std::sin(p / 0.8f * kPi) * 0.4f : 0.0f;
            h.add(STRATA_PRIMITIVE_CUBE, ax - 0.05f, 0.42f + lift, az, 0.14f, 0.1f, 0.1f, kIron);
            h.add(STRATA_PRIMITIVE_CUBE, ax - 0.25f, 0.42f + lift, az, 0.32f, 0.035f, 0.035f, kWood);
            if (p >= 0.8f || p < 0.15f) {
                const float ss = p >= 0.8f ? (p - 0.8f) / 0.2f : 1.0f + p / 0.15f * 0.3f;
                for (int k = 0; k < 12; ++k) {
                    const float a = k * 0.52f + hash(seed, k) * 0.5f, v = 0.4f + 0.5f * hash(seed, k + 9.0f);
                    const float q = std::fmin(ss, 1.3f);
                    h.point(ax - 0.05f + std::cos(a) * q * v, 0.36f + q * 0.55f - q * q * 0.45f,
                            az + std::sin(a) * q * v, 4.0f, 0.05f, {1.0f, 0.7f, 0.2f}, 1.0f - q / 1.3f);
                }
                h.light(ax, 0.6f, az, 3.0f, {1.0f, 0.55f, 0.15f}, 1.2f * (1.0f - std::fmin(ss, 1.0f)), 3);
            }
            break;
        }
        case RUN: {  // a catapult rolling back and forth, winding and throwing
            const float ox = ax + 0.25f * std::sin(t * 0.6f + seed * 5.0f);
            h.add(STRATA_PRIMITIVE_CUBE, ox, 0.12f, az, 0.85f, 0.08f, 0.42f, kWood);
            for (int k = 0; k < 4; ++k)
                h.add(STRATA_PRIMITIVE_SPHERE, ox + ((k & 1) ? 0.3f : -0.3f), 0.1f, az + ((k & 2) ? 0.24f : -0.24f), 0.2f,
                      0.2f, 0.06f, kDarkWood);
            h.add(STRATA_PRIMITIVE_CUBE, ox, 0.32f, az - 0.17f, 0.06f, 0.36f, 0.06f, kWood);
            h.add(STRATA_PRIMITIVE_CUBE, ox, 0.32f, az + 0.17f, 0.06f, 0.36f, 0.06f, kWood);
            const float p = fract(t * 0.45f + seed);
            const float th = p < 0.75f ? 0.3f - 0.85f * (p / 0.75f) : -0.55f + 2.0f * std::fmin((p - 0.75f) / 0.06f, 1.0f);
            const float dx = -std::cos(th), dy = std::sin(th);
            const float px = ox, py = 0.48f;
            for (int k = -2; k <= 6; ++k) {
                const float s = k * 0.1f;
                h.add(STRATA_PRIMITIVE_CUBE, px + dx * s, py + dy * s, az, 0.07f, 0.07f, 0.07f, kWood);
            }
            h.add(STRATA_PRIMITIVE_SPHERE, px + dx * 0.68f, py + dy * 0.68f, az, 0.16f, 0.1f, 0.16f, kDarkWood);
            if (p > 0.81f) {  // the stone in flight
                const float q = (p - 0.81f) / 0.19f;
                h.add(STRATA_PRIMITIVE_SPHERE, px + 0.5f + q * 2.2f, py + 0.7f + q * 1.4f - q * q * 2.0f, az, 0.14f, 0.14f,
                      0.14f, {0.4f, 0.38f, 0.35f});
            } else if (p < 0.75f) {
                h.add(STRATA_PRIMITIVE_SPHERE, px + dx * 0.68f, py + dy * 0.68f + 0.08f, az, 0.12f, 0.12f, 0.12f,
                      {0.4f, 0.38f, 0.35f});
            }
            // Dust from the wheels.
            for (int k = 0; k < 4; ++k) {
                const float q = fract(t * 0.8f + k * 0.25f);
                h.point(ox - 0.4f - q * 0.3f, 0.05f + q * 0.2f, az + (k - 1.5f) * 0.15f, 3.0f, 0.18f + q * 0.2f,
                        {0.45f, 0.36f, 0.24f}, 0.5f * (1.0f - q));
            }
            break;
        }
        case READ: {  // a scroll unrolling on a lectern
            h.add(STRATA_PRIMITIVE_CUBE, ax, 0.2f, az, 0.24f, 0.4f, 0.2f, kWood);
            h.add(STRATA_PRIMITIVE_CUBE, ax, 0.41f, az, 0.5f, 0.03f, 0.38f, kWood);
            const float L = 0.2f + 0.7f * (0.5f - 0.5f * std::cos(t * 0.9f + seed * 7.0f));
            h.add(STRATA_PRIMITIVE_CUBE, ax, 0.44f, az, L, 0.02f, 0.32f, {0.92f, 0.84f, 0.62f});
            h.add(STRATA_PRIMITIVE_CUBE, ax - L * 0.5f, 0.47f, az, 0.07f, 0.07f, 0.4f, kDarkWood);
            h.add(STRATA_PRIMITIVE_CUBE, ax + L * 0.5f, 0.47f, az, 0.07f, 0.07f, 0.4f, kDarkWood);
            for (int k = 0; k < 4; ++k) {
                const float lz = az - 0.1f + k * 0.065f, lw = (L - 0.15f) * (0.5f + 0.4f * hash(seed, k));
                if (lw > 0.02f) h.line(ax - lw * 0.5f, 0.452f, lz, ax + lw * 0.5f, 0.452f, lz, kInk, 0.9f);
            }
            h.point(ax, 0.55f, az, 4.0f, 0.5f, {1.0f, 0.95f, 0.75f}, 0.25f);
            break;
        }
        case WEB: {  // a raven flying out to the map edge and back
            const float cyc = fract(t / 7.0f + seed);
            const float u0 = cyc < 0.5f ? cyc * 2.0f : 2.0f - cyc * 2.0f, u = u0 * u0 * (3.0f - 2.0f * u0);
            const float far = std::fmax(edge - 0.4f, 1.0f);
            const float rx = x + ex * (0.5f + (far - 0.5f) * u), rz = z + ez * (0.5f + (far - 0.5f) * u);
            const float ry = 1.4f + 1.4f * std::sin(u * kPi);
            const float fx = cyc < 0.5f ? ex : -ex, fz = cyc < 0.5f ? ez : -ez;
            const Rgb black{0.02f, 0.02f, 0.03f};
            h.add(STRATA_PRIMITIVE_SPHERE, rx, ry, rz, 0.26f, 0.16f, 0.26f, black);
            h.add(STRATA_PRIMITIVE_SPHERE, rx + fx * 0.18f, ry + 0.05f, rz + fz * 0.18f, 0.13f, 0.13f, 0.13f, black);
            h.add(STRATA_PRIMITIVE_SPHERE, rx + fx * 0.27f, ry + 0.04f, rz + fz * 0.27f, 0.06f, 0.05f, 0.06f,
                  {0.3f, 0.25f, 0.1f});
            h.add(STRATA_PRIMITIVE_SPHERE, rx - fx * 0.2f, ry, rz - fz * 0.2f, 0.16f, 0.05f, 0.16f, black);
            const float flap = std::sin(t * 12.0f + seed * 9.0f);
            for (int side = -1; side <= 1; side += 2)
                for (int k = 1; k <= 3; ++k) {
                    const float px = -fz * side * 0.12f * k, pz = fx * side * 0.12f * k;
                    h.add(STRATA_PRIMITIVE_SPHERE, rx + px, ry + flap * 0.06f * k, rz + pz, 0.16f, 0.04f, 0.16f, black);
                }
            for (float s = 0.6f; s < 0.5f + (far - 0.5f) * u; s += 0.45f)  // its flight line, dotted in ink
                h.point(x + ex * s, 0.03f, z + ez * s, 3.0f, 0.06f, kInk, 0.55f, 0);
            break;
        }
        case DELEGATE: {  // a war horn on a stand, its blast rippling out over the map
            h.add(STRATA_PRIMITIVE_CYLINDER, ax, 0.4f, az, 0.06f, 0.4f, 0.06f, kWood);
            for (int k = 0; k < 7; ++k) {
                const float s = k / 6.0f;
                h.add(STRATA_PRIMITIVE_SPHERE, ax - 0.25f + s * 0.55f, 0.82f + 0.18f * s * s, az, 0.06f + 0.17f * s * s,
                      0.06f + 0.17f * s * s, 0.06f + 0.17f * s * s, k == 6 ? Rgb{0.6f, 0.42f, 0.1f} : kGold);
            }
            for (int k = 0; k < 3; ++k) {
                const float p = fract(t * 0.6f + k / 3.0f);
                circle(h, x, 0.04f, z, 0.9f + 3.0f * p, kGold, 3.0f, 0.85f * (1.0f - p), STRATA_LINES_ROUND_CAPS, 40);
                h.point(ax + 0.4f + p * 0.8f, 1.0f + p * 0.3f, az, 3.0f, 0.1f + 0.3f * p, {1.0f, 0.85f, 0.4f},
                        0.6f * (1.0f - p));
            }
            break;
        }
        case THINK: {  // the furled banner; pale motes drift round its top
            for (int k = 0; k < 5; ++k) {
                const float a = t * 0.6f + k * 2.0f * kPi / 5.0f;
                h.point(x + std::cos(a) * 0.6f, top - 0.3f + 0.15f * std::sin(t + k), z + std::sin(a) * 0.6f, 4.0f, 0.1f,
                        {0.6f, 0.75f, 1.0f}, 0.75f);
            }
            break;
        }
        case OTHER: {  // a war drum, beaten
            h.add(STRATA_PRIMITIVE_CYLINDER, ax, 0.2f, az, 0.5f, 0.2f, 0.5f, {0.45f, 0.10f, 0.06f});
            h.add(STRATA_PRIMITIVE_CYLINDER, ax, 0.41f, az, 0.48f, 0.01f, 0.48f, {0.85f, 0.78f, 0.6f});
            const float beat = std::fabs(std::sin(t * 4.0f + seed));
            h.add(STRATA_PRIMITIVE_SPHERE, ax + 0.1f, 0.45f + beat * 0.3f, az, 0.08f, 0.08f, 0.08f, kWood);
            h.add(STRATA_PRIMITIVE_CUBE, ax + 0.25f, 0.5f + beat * 0.3f, az, 0.3f, 0.03f, 0.03f, kWood);
            const float p = fract(t * 4.0f / kPi + seed / kPi);
            circle(h, ax, 0.43f, az, 0.25f + 0.4f * p, {0.85f, 0.78f, 0.6f}, 2.0f, 0.8f * (1.0f - p),
                   STRATA_LINES_ROUND_CAPS, 20);
            break;
        }
        default:
            break;
    }
}

/* ------------------------------------------------------------- scouts */

// Row: 0 x, 1 z, 2 heading (radians), 3 galloping 0..1, 4 camped 0..1, 5 action,
// 6 owner seed, 7 own seed, 8 selected, 9 dest x, 10 dest z, 11 banner x, 12 banner z,
// 13 appear 0..1, 14 owner offline, 15 unused.
void drawScout(Host& h, const float* s, float t) {
    const float x = s[0], z = s[1], head = s[2], gallop = s[3], camped = s[4];
    const int action = static_cast<int>(s[5]);
    const float oseed = s[6], seed = s[7];
    const int sel = static_cast<int>(s[8]);
    const float dx = s[9], dz = s[10], bx = s[11], bz = s[12], appear = clamp01(s[13]);
    const bool ownerOff = s[14] > 0.5f;
    const Rgb owner = grey(kField[idx8(oseed)], ownerOff ? 0.8f : 0.0f);
    const Rgb pathC = mix(kInk, owner, 0.45f);

    // The dotted path from the banner to the scout's point.
    {
        const float lx = dx - bx, lz = dz - bz, len = std::sqrt(lx * lx + lz * lz);
        const float ux = len > 0.0f ? lx / len : 0.0f, uz = len > 0.0f ? lz / len : 0.0f;
        for (float d = 0.8f; d < len; d += 0.28f)
            h.point(bx + ux * d, 0.03f, bz + uz * d, 3.0f, 0.07f, pathC, 0.85f * appear, 0);
        // An ink cross marks the point it rides to.
        h.wideLine(dx - 0.18f, 0.03f, dz - 0.18f, dx + 0.18f, 0.03f, dz + 0.18f, pathC, 2.0f, 0.0f, 0.85f,
                   STRATA_LINES_ROUND_CAPS);
        h.wideLine(dx - 0.18f, 0.03f, dz + 0.18f, dx + 0.18f, 0.03f, dz - 0.18f, pathC, 2.0f, 0.0f, 0.85f,
                   STRATA_LINES_ROUND_CAPS);
    }
    if (appear < 0.02f) return;

    const float k = 0.85f * appear;  // figure scale
    const float fx = std::cos(head), fz = std::sin(head), px = -fz, pz = fx;
    const Rgb coat = mix({0.30f, 0.16f, 0.07f}, {0.12f, 0.08f, 0.05f}, hash(seed, 1.0f));
    const bool resting = camped > 0.5f;
    const float bob = gallop * std::fabs(std::sin(t * 9.0f + seed * 20.0f)) * 0.07f * k;

    if (sel > 0)
        circle(h, x, 0.05f, z, 0.6f, sel == 2 ? kGold : Rgb{0.8f, 0.75f, 0.6f}, sel == 2 ? 3.5f : 2.0f, 0.95f,
               STRATA_LINES_ROUND_CAPS | STRATA_LINES_ON_TOP, 24, 1.0f, t * 0.8f);

    // The horse: body, neck and head as spheres along its heading.
    const float hy = 0.42f * k + bob;
    for (int i = -1; i <= 1; ++i)
        h.add(STRATA_PRIMITIVE_SPHERE, x + fx * i * 0.15f * k, hy, z + fz * i * 0.15f * k, 0.3f * k, 0.25f * k, 0.3f * k,
              coat);
    const float neckLift = resting ? -0.12f : 0.0f;  // grazing when camped
    h.add(STRATA_PRIMITIVE_SPHERE, x + fx * 0.3f * k, hy + (0.14f + neckLift) * k, z + fz * 0.3f * k, 0.15f * k,
          0.17f * k, 0.15f * k, coat);
    h.add(STRATA_PRIMITIVE_SPHERE, x + fx * 0.42f * k, hy + (0.24f + neckLift * 2.0f) * k, z + fz * 0.42f * k, 0.16f * k,
          0.13f * k, 0.16f * k, coat);
    for (int l = 0; l < 4; ++l) {
        const float fwd = (l < 2 ? 0.17f : -0.17f) * k, side = ((l & 1) ? 0.08f : -0.08f) * k;
        const float swing = gallop * std::sin(t * 9.0f + seed * 20.0f + (l < 2 ? 0.0f : kPi) + (l & 1) * 0.6f) * 0.1f * k;
        const float lx = x + fx * (fwd + swing) + px * side, lz = z + fz * (fwd + swing) + pz * side;
        const float legH = 0.3f * k;
        h.add(STRATA_PRIMITIVE_CYLINDER, lx, legH * 0.5f + bob * 0.5f, lz, 0.06f * k, legH * 0.5f, 0.06f * k, coat);
    }
    // Saddle cloth in the lead's colours: whose scout it is.
    h.add(STRATA_PRIMITIVE_SPHERE, x, hy + 0.1f * k, z, 0.3f * k, 0.08f * k, 0.3f * k, owner);

    const Rgb skin{0.7f, 0.5f, 0.36f};
    const Rgb pennant = kAction[action];
    if (!resting) {
        // The rider, cloaked in the lead's colour, with a lance and an
        // action-coloured pennant.
        const float ry = hy + 0.32f * k;
        h.add(STRATA_PRIMITIVE_CAPSULE, x - fx * 0.03f * k, ry, z - fz * 0.03f * k, 0.18f * k, 0.12f * k, 0.18f * k,
              owner);
        h.add(STRATA_PRIMITIVE_SPHERE, x, ry + 0.26f * k, z, 0.15f * k, 0.15f * k, 0.15f * k, skin);
        h.add(STRATA_PRIMITIVE_SPHERE, x, ry + 0.32f * k, z, 0.15f * k, 0.07f * k, 0.15f * k, kIron);  // helm
        const float lx = x + px * 0.14f * k, lz = z + pz * 0.14f * k;
        h.add(STRATA_PRIMITIVE_CYLINDER, lx, ry + 0.25f * k, lz, 0.03f * k, 0.5f * k, 0.03f * k, kWood);
        const float wav = std::sin(t * 8.0f + seed * 10.0f) * 0.04f * k;
        h.add(STRATA_PRIMITIVE_SPHERE, lx - fx * 0.14f * k, ry + 0.65f * k + wav, lz - fz * 0.14f * k, 0.26f * k,
              0.14f * k, 0.26f * k, pennant);
        // A small cue of the action above the rider.
        const float cy = ry + 0.95f * k;
        switch (action) {
            case EDIT:
                for (int j = 0; j < 4; ++j) {
                    const float q = fract(t * 1.8f + j * 0.25f + seed);
                    h.point(x + std::cos(j * 1.7f) * q * 0.3f, cy - 0.2f + q * 0.25f - q * q * 0.3f,
                            z + std::sin(j * 1.7f) * q * 0.3f, 3.0f, 0.04f, {1.0f, 0.7f, 0.2f}, 1.0f - q);
                }
                break;
            case RUN:
                for (int j = 0; j < 4; ++j) {
                    const float q = fract(t * 1.2f + j * 0.25f + seed);
                    h.point(x - fx * (0.3f + q * 0.4f) * k, 0.06f + q * 0.18f, z - fz * (0.3f + q * 0.4f) * k, 3.0f,
                            0.15f + q * 0.2f, {0.45f, 0.36f, 0.24f}, 0.55f * (1.0f - q));
                }
                break;
            case READ:
                h.add(STRATA_PRIMITIVE_CUBE, x + fx * 0.15f * k, ry + 0.12f * k, z + fz * 0.15f * k, 0.18f * k, 0.12f * k,
                      0.18f * k, {0.92f, 0.84f, 0.62f});
                break;
            case WEB: {
                const float a = t * 2.5f + seed * 10.0f;
                h.add(STRATA_PRIMITIVE_SPHERE, x + std::cos(a) * 0.4f, cy + 0.1f, z + std::sin(a) * 0.4f, 0.12f, 0.06f, 0.12f,
                      {0.02f, 0.02f, 0.03f});
                break;
            }
            case DELEGATE: {
                const float q = fract(t * 0.9f + seed);
                circle(h, x, 0.04f, z, 0.3f + 0.6f * q, kGold, 2.0f, 0.8f * (1.0f - q), STRATA_LINES_ROUND_CAPS, 20);
                break;
            }
            case THINK:
                h.point(x, cy + 0.05f * std::sin(t * 2.0f), z, 4.0f, 0.1f, {0.6f, 0.75f, 1.0f}, 0.8f);
                break;
            default:
                break;
        }
    } else {
        // Camped: the rider sits by a small fire, a tent in the lead's colour.
        const float tx = x + px * 0.5f, tz = z + pz * 0.5f;
        for (int j = 0; j < 4; ++j) {
            const float w = (0.55f - j * 0.13f) * k;
            h.add(STRATA_PRIMITIVE_CUBE, tx, (0.07f + j * 0.12f) * k, tz, w, 0.12f * k, w * 0.9f, mix(owner, kInk, j * 0.08f));
        }
        const float ffx = x - px * 0.35f + fx * 0.25f, ffz = z - pz * 0.35f + fz * 0.25f;
        h.add(STRATA_PRIMITIVE_CUBE, ffx, 0.03f, ffz, 0.22f * k, 0.04f, 0.05f, kDarkWood);
        h.add(STRATA_PRIMITIVE_CUBE, ffx, 0.05f, ffz, 0.05f, 0.04f, 0.22f * k, kDarkWood);
        fire(h, ffx, 0.08f, ffz, 0.16f, t, seed, 6, 1, 0.7f);
        const float sx = ffx - px * 0.25f, sz = ffz - pz * 0.25f;
        h.add(STRATA_PRIMITIVE_CAPSULE, sx, 0.16f * k, sz, 0.18f * k, 0.1f * k, 0.18f * k, owner);
        h.add(STRATA_PRIMITIVE_SPHERE, sx, 0.4f * k, sz, 0.14f * k, 0.14f * k, 0.14f * k, skin);
        // The pennant planted in the ground beside the tent.
        h.add(STRATA_PRIMITIVE_CYLINDER, tx + fx * 0.4f * k, 0.35f * k, tz + fz * 0.4f * k, 0.03f * k, 0.35f * k, 0.03f * k,
              kWood);
        h.add(STRATA_PRIMITIVE_SPHERE, tx + fx * 0.5f * k, 0.64f * k, tz + fz * 0.5f * k, 0.2f * k, 0.1f * k, 0.2f * k,
              pennant);
    }
}

}  // namespace

void strata_kit_configure(strata_kit::Options& o) {
    o.name = "agentviz-wartable";
    o.fog = false;
}

void strata_kit_engine_ready(strata_kit::Host&) {}

void strata_kit_build(strata_kit::Host& h, double tt) {
    const float t = h.reducedMotion ? 0.0f : static_cast<float>(tt);
    // A room at night: no sky, the sun turned down to a faint moonlit window,
    // the candles do the rest.
    h.clearFlags = STRATA_CLEAR_COLOR | STRATA_CLEAR_DEPTH;
    h.clearColor[0] = 0.018f;
    h.clearColor[1] = 0.012f;
    h.clearColor[2] = 0.008f;
    h.clearColor[3] = 1.0f;
#if STRATA_ABI_MINOR >= 16
    h.sunIntensity = 0.55f;
    h.sunTint = {1.0f, 0.82f, 0.62f};
    h.ambientTint = {0.75f, 0.62f, 0.48f};
#endif
    drawTable(h, t);
    for (size_t i = 0; i + REGION_STRIDE <= g.regions.size(); i += REGION_STRIDE) drawRegion(h, &g.regions[i], t);
    for (size_t i = 0; i + SCOUT_STRIDE <= g.scouts.size(); i += SCOUT_STRIDE) drawScout(h, &g.scouts[i], t);
    for (size_t i = 0; i + BANNER_STRIDE <= g.banners.size(); i += BANNER_STRIDE) drawBanner(h, &g.banners[i], t);
}

STRATA_KIT_EXPORT void wt_set_map(float x0, float z0, float x1, float z1) {
    g.map[0] = x0;
    g.map[1] = z0;
    g.map[2] = x1;
    g.map[3] = z1;
}
STRATA_KIT_EXPORT void wt_set_regions(const float* rows, int n) { g.regions.assign(rows, rows + n * REGION_STRIDE); }
STRATA_KIT_EXPORT void wt_set_banners(const float* rows, int n) { g.banners.assign(rows, rows + n * BANNER_STRIDE); }
STRATA_KIT_EXPORT void wt_set_scouts(const float* rows, int n) { g.scouts.assign(rows, rows + n * SCOUT_STRIDE); }
