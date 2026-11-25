// agentviz-wartable: Claude Code sessions as a candle-lit campaign war table,
// on the Strata web kit.
//
// The page (web/wartable-*.js) owns the feed, the layout and the easing.
// Every frame it packs the scene in the agentviz wire format
// (vendor/agentviz-kit, docs/KIT.md in the agentviz repo) and calls
// agentviz_frame(); this file only draws what the frame says:
//   scene floats  the parchment's extent and the camera yaw (table.h)
//   zones         one region per place, with its keep (table.h)
//   agents        a banner per session (banner.h, props.h) and a mounted
//                 scout per subagent (scout.h)
//   links         each scout's dotted path to its cross (scout.h)
// Everything animated is a function of the scene time the kit passes to
// strata_kit_build, so ?drive=1 captures repeat.
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include "banner.h"
#include "scout.h"
#include "table.h"

namespace {

agentviz::Frame frame;

}  // namespace

AGENTVIZ_FRAME_EXPORT(frame)

void strata_kit_configure(strata_kit::Options& o) {
    o.name = "agentviz-wartable";
    o.fog = false;
}

void strata_kit_engine_ready(strata_kit::Host&) {}

// A room at night: no sky, the sun turned down to a faint moonlit window;
// the candles do the rest.
static void lightTheRoom(strata_kit::Host& h) {
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
}

void strata_kit_build(strata_kit::Host& h, double seconds) {
    lightTheRoom(h);
    if (!frame.ok) return;
    const float t = h.reducedMotion ? 0.0f : static_cast<float>(seconds);
    const wartable::MapRect map{frame.scene[0], frame.scene[1], frame.scene[2], frame.scene[3]};
    const float cameraYaw = frame.scene[4];
    wartable::drawTable(h, map, t);
    for (const auto& zone : frame.zones) wartable::drawRegion(h, zone, t);
    for (const auto& link : frame.links) wartable::drawScoutPath(h, link);
    for (const auto& agent : frame.agents)
        if (!agent.lead()) wartable::drawScout(h, agent, t);
    for (const auto& agent : frame.agents)
        if (agent.lead()) wartable::drawBanner(h, agent, t, cameraYaw);
}
