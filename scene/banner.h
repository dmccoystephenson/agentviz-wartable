// banner.h: a session's banner: cairn, pole and flag; the idle candle; the
// stalled smoke; the beacon fire lit when it waits on you, with a "?" or a
// padlock over it saying why; the gold flash of a new tool call.
#pragma once

#include <cmath>

#include "draw_util.h"
#include "props.h"

namespace wartable {

struct Banner {
    float x, z, seed, t;
    State state;
    Action action;
    agentviz::WaitingReason reason;
    agentviz::Highlight highlight;
    bool stalled;
    float raise, beacon, furl, wave, appear, pulse;
    float edgeX, edgeZ, edgeDist;
    float top;  // the pole's height
    Rgb field, metal;

    bool offline() const { return state == State::Offline; }
};

// Agent extras (web/wartable-frame.js): 0 raise, 1 beacon, 2 furl, 3 wave, 4-5 raven direction, 6 its distance.
inline Banner bannerOf(const agentviz::Agent& a, float t) {
    Banner b{};
    b.x = a.x; b.z = a.z; b.seed = a.seed; b.t = t;
    b.state = a.state; b.action = a.action; b.reason = a.waitingReason; b.highlight = a.highlight; b.stalled = a.stalled;
    b.raise = a.extra[0]; b.beacon = a.extra[1]; b.furl = a.extra[2]; b.wave = a.extra[3];
    b.edgeX = a.extra[4]; b.edgeZ = a.extra[5]; b.edgeDist = a.extra[6];
    b.appear = clamp01(a.appear); b.pulse = a.pulse;
    b.top = (0.9f + 2.3f * b.raise) * (0.3f + 0.7f * b.appear);
    const float dull = b.offline() ? 0.85f : (b.state == State::Dim ? 0.5f : 0.0f);
    b.field = grey(kField[idx8(b.seed)], dull);
    b.metal = grey(kMetal[idx8(b.seed)], dull);
    return b;
}

// Ground ring in the banner's colour, the cairn, and the pole (a stump when offline).
inline void drawPole(Host& h, const Banner& b) {
    circle(h, b.x, 0.025f, b.z, 0.75f, mix(b.field, kInk, 0.3f), 2.5f, b.offline() ? 0.35f : 0.8f, kRound, 28);
    ball(h, b.x, 0.02f, b.z, 0.62f, 0.3f, 0.62f, {0.22f, 0.20f, 0.18f});
    ball(h, b.x + 0.15f, 0.08f, b.z - 0.1f, 0.3f, 0.22f, 0.3f, {0.28f, 0.26f, 0.23f});
    cyl(h, b.x, b.top * 0.5f, b.z, 0.09f, b.top * 0.5f, b.offline() ? Rgb{0.12f, 0.1f, 0.09f} : kWood);
    ball(h, b.x, b.top + 0.08f, b.z, 0.18f, 0.18f, 0.18f, b.offline() ? Rgb{0.3f, 0.3f, 0.28f} : kGold);
    box(h, b.x + 0.42f * (1.0f - b.furl * 0.6f), b.top - 0.04f, b.z, 0.9f * (1.0f - b.furl * 0.6f) + 0.1f, 0.04f, 0.04f,
        kWood);  // the crossbar the flag hangs from
}

// The flag: strips that wave in z (busy), hang still (idle), droop (offline)
// or wrap tight round the pole (thinking: furled), with a swallowtail.
inline void drawFlag(Host& h, const Banner& b) {
    const int strips = 7;
    const float W = 1.05f * (1.0f - 0.72f * b.furl), H = 1.0f * (1.0f - 0.15f * b.furl);
    const float speed = 2.5f + 2.0f * b.wave, hMain = H * 0.62f, hBand = H * 0.38f;
    for (int i = 0; i < strips; ++i) {
        const float u = (i + 0.5f) / strips;
        const float sx = b.x + 0.06f + u * W;
        const float amp = (0.04f + 0.16f * b.wave) * u * (1.0f - b.furl * 0.8f);
        const float sz = b.z + amp * std::sin(b.t * speed - i * 0.9f + b.seed * 30.0f);
        const float yTop = b.top - 0.08f - (b.offline() ? u * 0.25f : 0.0f);
        box(h, sx, yTop - hMain * 0.5f, sz, W / strips + 0.01f, hMain, 0.035f, b.field);
        box(h, sx, yTop - hMain - hBand * 0.5f, sz, W / strips + 0.01f, hBand, 0.035f,
            (i == strips - 1 && !b.offline()) ? b.field : b.metal);
    }
    if (b.furl < 0.5f) {
        const float tx = b.x + 0.06f + W * 0.9f;
        box(h, tx, b.top - 0.08f - H - 0.12f - (b.offline() ? 0.25f : 0.0f),
            b.z + 0.12f * b.wave * std::sin(b.t * speed - 6.0f), W / strips, 0.24f, 0.035f, b.metal);
    }
}

// Idle: a low candle stub burns beside the still banner.
inline void drawIdleCandle(Host& h, const Banner& b) {
    const float cx = b.x + 0.45f, cz = b.z + 0.42f;
    cyl(h, cx, 0.03f, cz, 0.3f, 0.03f, kGold);
    cyl(h, cx, 0.12f, cz, 0.14f, 0.07f, {0.85f, 0.80f, 0.65f});
    const float flicker = 0.8f + 0.2f * std::sin(b.t * 8.0f + b.seed * 9.0f);
    h.point(cx, 0.27f, cz, 3.0f, 0.1f * flicker, {1.0f, 0.8f, 0.4f}, 0.9f);
    h.point(cx, 0.3f, cz, 5.0f, 0.35f, kFlame, 0.25f);
    h.light(cx, 0.6f, cz, 2.2f, {1.0f, 0.65f, 0.3f}, 0.5f * flicker, 2);
}

// A new tool call: a gold burst from the finial and a quick ring at the foot.
inline void drawToolCallFlash(Host& h, const Banner& b) {
    if (b.pulse <= 0.01f) return;
    const float p = 1.0f - b.pulse;
    for (int k = 0; k < 10; ++k) {
        const float a = k * 2.0f * kPi / 10.0f + b.seed * 7.0f;
        h.point(b.x + std::cos(a) * p * 0.8f, b.top + 0.1f + p * 0.5f - p * p * 0.6f, b.z + std::sin(a) * p * 0.8f, 4.0f,
                0.07f, {1.0f, 0.85f, 0.35f}, b.pulse, STRATA_POINT_SOFT);
    }
    h.point(b.x, b.top + 0.08f, b.z, 12.0f + 18.0f * b.pulse, 0.6f, {1.0f, 0.8f, 0.3f}, 0.7f * b.pulse, STRATA_POINT_SOFT);
    circle(h, b.x, 0.04f, b.z, 0.8f + 1.4f * p, kGold, 3.0f, 0.9f * b.pulse, kRound, 32);
}

/* ------------------------------------------------------------- the beacon */

// A polyline in the camera-facing vertical plane through (x, y, z): (u, v)
// are glyph units, u along screen-right (rx, rz), v up.
inline void glyphLine(Host& h, float x, float y, float z, float rx, float rz, const float (*pts)[2], int n, float size,
                      Rgb c, float px, float a) {
    for (int i = 0; i + 1 < n; ++i) {
        h.wideLine(x + rx * pts[i][0] * size, y + pts[i][1] * size, z + rz * pts[i][0] * size,
                   x + rx * pts[i + 1][0] * size, y + pts[i + 1][1] * size, z + rz * pts[i + 1][0] * size, c, px, 0.0f, a,
                   kRound | STRATA_LINES_ON_TOP);
    }
}

// Why it waits, floating over the beacon and turned to the camera: a "?"
// for a question, a padlock for a permission prompt.
inline void drawWaitingReason(Host& h, const Banner& b, float x, float y, float z, float cameraYaw) {
    if (b.reason == agentviz::WaitingReason::None) return;
    const float rx = -std::sin(cameraYaw), rz = std::cos(cameraYaw);  // screen-right in world (strata-kit.js)
    const Rgb ink{1.0f, 0.85f, 0.45f};
    const float a = b.beacon, bob = 0.08f * std::sin(b.t * 2.0f);
    if (b.reason == agentviz::WaitingReason::Question) {
        static const float hook[][2] = {{-0.28f, 0.62f}, {-0.2f, 0.8f}, {0.0f, 0.88f}, {0.2f, 0.8f}, {0.28f, 0.62f},
                                        {0.18f, 0.46f}, {0.0f, 0.36f}, {0.0f, 0.18f}};
        glyphLine(h, x, y + bob, z, rx, rz, hook, 8, 0.7f, ink, 5.0f, a);
        h.point(x, y + bob, z, 9.0f, 0.0f, ink, a, STRATA_POINT_ON_TOP);
        return;
    }
    static const float shackle[][2] = {{-0.2f, 0.3f}, {-0.2f, 0.5f}, {-0.12f, 0.64f}, {0.0f, 0.68f},
                                       {0.12f, 0.64f}, {0.2f, 0.5f}, {0.2f, 0.3f}};
    glyphLine(h, x, y + bob, z, rx, rz, shackle, 7, 0.7f, ink, 4.0f, a);
    static const float body[][2] = {{-0.3f, 0.3f}, {0.3f, 0.3f}, {0.3f, -0.05f}, {-0.3f, -0.05f}, {-0.3f, 0.3f}};
    glyphLine(h, x, y + bob, z, rx, rz, body, 5, 0.7f, ink, 4.0f, a);
    static const float slab[][2] = {{-0.27f, 0.12f}, {0.27f, 0.12f}};
    glyphLine(h, x, y + bob, z, rx, rz, slab, 2, 0.7f, ink, 14.0f, a);
    h.point(x, y + bob + 0.09f, z, 5.0f, 0.0f, kInk, a, STRATA_POINT_ON_TOP);  // the keyhole
}

// The hill and the brazier with its fire and light.
inline void drawBrazier(Host& h, const Banner& b, float bx, float bz) {
    const float k = b.beacon, hy = 0.35f * k;
    ball(h, bx, -0.1f, bz, 1.6f, 0.9f * k, 1.6f, {0.30f, 0.26f, 0.16f});
    cyl(h, bx, hy + 0.15f, bz, 0.08f, 0.15f, kIron);  // the brazier's post
    cyl(h, bx, hy + 0.38f, bz, 0.55f, 0.09f, kIron);  // its bowl
    for (int j = 0; j < 3; ++j)
        box(h, bx, hy + 0.5f + j * 0.06f, bz, j == 1 ? 0.08f : 0.45f, 0.06f, j == 1 ? 0.45f : 0.08f, kDarkWood);
    fire(h, bx, hy + 0.55f, bz, 0.55f * k, b.t, b.seed + 3.0f, 22, -1, 0.0f);
    const float flicker = 0.8f + 0.2f * std::sin(b.t * 11.0f) * std::sin(b.t * 4.3f + 1.0f);
    h.light(bx, hy + 1.6f, bz, 11.0f, {1.0f, 0.5f, 0.15f}, 3.5f * flicker * k, 100);
}

// Seen from anywhere: a glow over everything, rings pulsing out across the
// map round the banner, and sparks thrown high.
inline void drawBeaconSignal(Host& h, const Banner& b, float bx, float bz) {
    const float k = b.beacon, hy = 0.35f * k, pulse = 0.5f + 0.5f * std::sin(b.t * 5.0f);
    const uint32_t onTop = STRATA_POINT_SOFT | STRATA_POINT_ON_TOP;
    h.point(bx, hy + 1.0f, bz, 26.0f + 14.0f * pulse, 1.6f, {1.0f, 0.55f, 0.15f}, 0.45f * k, onTop);
    h.point(bx, hy + 0.9f, bz, 10.0f, 0.4f, {1.0f, 0.9f, 0.5f}, 0.9f * k, onTop);
    for (int j = 0; j < 2; ++j) {
        const float p = fract(b.t * 0.6f + j * 0.5f);
        circle(h, b.x - 0.4f, 0.04f, b.z - 0.2f, 1.2f + 2.4f * p, kEmber, 4.0f, 0.9f * (1.0f - p) * k,
               kRound | STRATA_LINES_ON_TOP, 40);
    }
    for (int j = 0; j < 10; ++j) {
        const float p = fract(b.t * 0.5f + hash(b.seed, j + 200.0f));
        h.point(bx + std::sin(j * 2.3f + b.t) * 0.4f * p, hy + 1.2f + p * 3.5f, bz + std::cos(j * 1.7f) * 0.3f * p, 3.0f,
                0.06f, {1.0f, 0.75f, 0.3f}, (1.0f - p) * k, STRATA_POINT_SOFT);
    }
}

inline void drawBeacon(Host& h, const Banner& b, float cameraYaw) {
    if (b.beacon <= 0.01f) return;
    const float bx = b.x - 1.25f, bz = b.z - 0.55f;
    drawBrazier(h, b, bx, bz);
    drawBeaconSignal(h, b, bx, bz);
    drawWaitingReason(h, b, bx, 0.35f * b.beacon + 2.3f, bz, cameraYaw);
}

inline void drawBanner(Host& h, const agentviz::Agent& agent, float t, float cameraYaw) {
    const Banner b = bannerOf(agent, t);
    drawPole(h, b);
    drawFlag(h, b);
    selectionRing(h, b.x, b.z, 1.15f, b.highlight, t, 0.5f, 36);
    if (b.state == State::Idle || b.state == State::Dim) drawIdleCandle(h, b);
    if (b.stalled) smoke(h, b.x + 0.3f, b.top * 0.6f, b.z, t, b.seed, 12, 2.6f, 1.0f);
    drawBeacon(h, b, cameraYaw);
    drawToolCallFlash(h, b);
    if (b.state == State::Busy) drawActionProp(h, {b.x, b.z, b.seed, b.t, b.top, b.edgeX, b.edgeZ, b.edgeDist}, b.action);
}

}  // namespace wartable
