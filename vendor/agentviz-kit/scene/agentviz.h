// agentviz.h: the engine half of the agentviz wire (docs/KIT.md, "Wire").
//
// The page packs one Float32Array per frame with kit/web/agentviz-wire.js and
// calls the scene's `agentviz_frame(ptr, count)`. This header decodes it,
// and carries the shared vocabulary (states, actions, waiting reasons, in
// agentfeed/vocabulary.py's order), seed_of (FNV-1a, identical to Python's)
// and easing helpers. Header-only, standard C++17, no Strata dependency, so
// it also builds natively for tests.
//
//   #include "strata_kit.h"
//   #include "agentviz.h"
//   agentviz::Frame frame;
//   AGENTVIZ_FRAME_EXPORT(frame)          // defines agentviz_frame(); KIT_EXPORTS=_agentviz_frame
//   ... in strata_kit_build: for (const agentviz::Agent& a : frame.agents) { ... }
//
// MIT licensed.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace agentviz {

constexpr int kFormatVersion = 1;
constexpr float kMagic = 42727.0f;
constexpr int kHeader = 24, kSceneFloats = 16;
constexpr int kZoneStride = 16, kZoneExtras = 8;
constexpr int kAgentStride = 36, kAgentExtras = 16;
constexpr int kLinkStride = 12;

// agentfeed/vocabulary.py STATES / ACTIONS, same order.
enum class State { Offline = 0, Dim = 1, Idle = 2, Busy = 3, Waiting = 4 };
enum class Action { None = 0, Edit = 1, Run = 2, Read = 3, Web = 4, Delegate = 5, Think = 6, Other = 7 };
enum class WaitingReason { None = 0, Question = 1, Permission = 2 };
enum class Kind { Session = 0, Follower = 1 };
enum class Highlight { None = 0, Selected = 1, Hovered = 2 };

struct Zone {
    uint32_t id;
    int kind;
    float seed, x0, z0, x1, z1, appear;
    float extra[kZoneExtras];
};

struct Agent {
    uint32_t id, parent;  // 24-bit FNV-1a; a session is its own parent
    Kind kind;
    State state;          // followers: active = Busy, resting = Idle
    Action action;
    WaitingReason waitingReason;
    bool stalled, finished;
    float seed, parentSeed;
    float x, y, z, facing, appear;
    Highlight highlight;
    float pulse;          // 1 just after a new tool call, easing to 0
    int toolCount, activeFollowers;
    float extra[kAgentExtras];

    bool lead() const { return kind == Kind::Session; }
    bool waiting() const { return state == State::Waiting; }
};

struct Link {
    int kind;
    uint32_t from, to;
    float x0, y0, z0, x1, y1, z1, phase, seed, alpha;
};

// ---------------------------------------------------------------- decoding

inline int toInt(float v) { return static_cast<int>(std::lround(v)); }
inline uint32_t toId(float v) { return static_cast<uint32_t>(std::max(0L, std::lround(v))); }
template <typename E>
E toEnum(float v, int count, E fallback) {
    const int i = toInt(v);
    return i >= 0 && i < count ? static_cast<E>(i) : fallback;
}

inline Zone decodeZone(const float* r) {
    Zone z{};
    z.id = toId(r[0]);
    z.kind = toInt(r[1]);
    z.seed = r[2]; z.x0 = r[3]; z.z0 = r[4]; z.x1 = r[5]; z.z1 = r[6]; z.appear = r[7];
    std::copy(r + 8, r + 8 + kZoneExtras, z.extra);
    return z;
}

inline Agent decodeAgent(const float* r) {
    Agent a{};
    a.id = toId(r[0]);
    a.parent = toId(r[1]);
    a.kind = toEnum(r[2], 2, Kind::Session);
    a.state = toEnum(r[3], 5, State::Dim);
    a.action = toEnum(r[4], 8, Action::None);
    a.waitingReason = toEnum(r[5], 3, WaitingReason::None);
    a.stalled = r[6] > 0.5f;
    a.finished = r[7] > 0.5f;
    a.seed = r[8]; a.parentSeed = r[9];
    a.x = r[10]; a.y = r[11]; a.z = r[12]; a.facing = r[13]; a.appear = r[14];
    a.highlight = toEnum(r[15], 3, Highlight::None);
    a.pulse = r[16];
    a.toolCount = toInt(r[17]);
    a.activeFollowers = toInt(r[18]);
    std::copy(r + 20, r + 20 + kAgentExtras, a.extra);
    return a;
}

inline Link decodeLink(const float* r) {
    Link l{};
    l.kind = toInt(r[0]);
    l.from = toId(r[1]); l.to = toId(r[2]);
    l.x0 = r[3]; l.y0 = r[4]; l.z0 = r[5]; l.x1 = r[6]; l.y1 = r[7]; l.z1 = r[8];
    l.phase = r[9]; l.seed = r[10]; l.alpha = r[11];
    return l;
}

// One decoded frame. `ok` is false until a well-formed buffer arrives; a
// malformed one (wrong magic, version or length) leaves the last good frame
// in place and sets `error`.
struct Frame {
    bool ok = false;
    std::string error;
    int waitingCount = 0;
    bool fixture = false;
    float scene[kSceneFloats] = {};
    std::vector<Zone> zones;
    std::vector<Agent> agents;
    std::vector<Link> links;

    bool assign(const float* data, size_t count) {
        if (count < static_cast<size_t>(kHeader)) return fail("short buffer");
        if (data[0] != kMagic) return fail("not an agentviz wire buffer");
        if (toInt(data[1]) != kFormatVersion) return fail("wire format version mismatch");
        const size_t nZones = toId(data[2]), nAgents = toId(data[3]), nLinks = toId(data[4]);
        const size_t want = kHeader + nZones * kZoneStride + nAgents * kAgentStride + nLinks * kLinkStride;
        if (want != count) return fail("record counts do not match the buffer length");
        waitingCount = toInt(data[5]);
        fixture = data[6] > 0.5f;
        std::copy(data + 8, data + 8 + kSceneFloats, scene);
        const float* p = data + kHeader;
        zones.resize(nZones);
        for (auto& z : zones) { z = decodeZone(p); p += kZoneStride; }
        agents.resize(nAgents);
        for (auto& a : agents) { a = decodeAgent(p); p += kAgentStride; }
        links.resize(nLinks);
        for (auto& l : links) { l = decodeLink(p); p += kLinkStride; }
        ok = true;
        error.clear();
        return true;
    }

private:
    bool fail(const char* why) {
        error = why;
        return false;
    }
};

// ---------------------------------------------------------------- seeds

// Next code point of a UTF-8 string (Python's seed_of hashes code points).
// Malformed bytes read as U+FFFD, one byte at a time.
inline uint32_t nextCodePoint(const unsigned char*& s) {
    const unsigned char c = *s++;
    int extra = c < 0x80 ? 0 : (c >> 5) == 0x6 ? 1 : (c >> 4) == 0xE ? 2 : (c >> 3) == 0x1E ? 3 : -1;
    if (extra < 0) return 0xFFFD;
    uint32_t cp = extra == 0 ? c : (c & (0x3F >> extra));
    for (int i = 0; i < extra; ++i) {
        if ((*s & 0xC0) != 0x80) return 0xFFFD;
        cp = (cp << 6) | (*s++ & 0x3F);
    }
    return cp;
}

inline uint32_t fnv1a(const char* utf8) {
    uint32_t hash = 2166136261u;
    const unsigned char* s = reinterpret_cast<const unsigned char*>(utf8);
    while (*s) {
        hash ^= nextCodePoint(s);
        hash *= 16777619u;
    }
    return hash;
}

inline uint32_t id24(const char* utf8) { return fnv1a(utf8) & 0xFFFFFFu; }
inline float seed_of(const char* utf8) { return static_cast<float>(fnv1a(utf8) % 10000u) / 10000.0f; }

// ---------------------------------------------------------------- easing

inline float clamp01(float v) { return std::clamp(v, 0.0f, 1.0f); }
inline float lerp(float a, float b, float k) { return a + (b - a) * k; }
inline float ease(float current, float target, float dt, float rate) {
    return current + (target - current) * (1.0f - std::exp(-rate * dt));
}
inline float smoothstep(float k) {
    const float c = clamp01(k);
    return c * c * (3.0f - 2.0f * c);
}
// 0..1..0 at `hz` cycles a second: the "look at me" beat for waiting agents.
inline float pulse(float t, float hz) { return 0.5f + 0.5f * std::sin(t * hz * 6.2831853f); }

}  // namespace agentviz

// Defines the scene's one setter, `agentviz_frame`, decoding into `frame`.
// Add `_agentviz_frame` to KIT_EXPORTS in scene/kit.conf.
#define AGENTVIZ_FRAME_EXPORT(frame) \
    STRATA_KIT_EXPORT void agentviz_frame(const float* data, int count) { \
        (frame).assign(data, static_cast<size_t>(std::max(count, 0))); \
    }
