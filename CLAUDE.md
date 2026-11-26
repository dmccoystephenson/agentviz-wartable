# CLAUDE.md

agentviz-wartable: Claude Code sessions drawn as a candle-lit campaign war table
(Strata web kit). Sessions are banners on a parchment map; subagents are
mounted scouts riding out from them. Part of the agentviz family:
https://github.com/dmccoystephenson/agentviz

- Data comes only from `/api/agents` (vendor/agentfeed; schema in the agentviz repo's docs/FEED.md).
- Shared pieces come from the agentviz kit (docs/KIT.md there): `vendor/agentviz-kit/` and the
  `web/agentviz-*` copies. Never edit `vendor/` or `web/agentviz-*`; re-vendor from an agentviz
  checkout with `tools/vendor-kit.sh <this repo>`. `tests/test_serve.py` checks the PINs.
- Page: `web/wartable-model.js` lays out regions, banners and scout points and eases them;
  `web/wartable-frame.js` packs each frame in the agentviz wire format; `web/page.js` boots the
  feed client, HUD, labels, picking and camera; `web/index.html` holds the theme and legend.
- Scene: `scene/main.cpp` decodes the wire (`agentviz.h`) and calls `table.h` (table, candles,
  regions, keeps), `banner.h` (banners, beacons), `props.h` (action props) and `scout.h`.
  Build: `EMSDK=/path/to/emsdk vendor/agentviz-kit/scene/build-scene.sh scene/kit.conf`
  (emsdk 6.0.11, Strata 0.10.0). The built `web/wartable-engine.*` are committed.
- Run: `python3 -m vendor.agentfeed serve --web web --port 8850 [--fixture]`.
- Tests: `python3 -m unittest discover -s tests`; browser tests after `npm ci` and
  `npx playwright install chromium`: `npm run smoke`, `npm run screenshots` (Pillow from
  requirements-dev.txt for the GIF). Tests use port 9134 (`WARTABLE_TEST_PORT` overrides).
- Page scripts never use `innerHTML` or empty `catch` blocks, and tracked files hold no machine
  paths: `tests/test_serve.py` checks both.
- Screenshots come from the FIXTURE feed only, never live sessions.
