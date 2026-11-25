# CLAUDE.md

agentviz-wartable: one visualization in the agentviz family
(https://github.com/dmccoystephenson/agentviz). Sessions are banners on a
parchment campaign map; subagents are mounted scouts riding out from them.

- Feed: `vendor/agentfeed/` is vendored from agentviz (`tools/vendor-feed.sh`).
  Never edit it here; change agentfeed upstream and re-vendor.
- Scene: `scene/main.cpp` (Strata web kit). `scene/build.sh` rebuilds
  `web/wartable-engine.{js,wasm}`; the built files are committed.
- Page: `web/index.html` + `web/wartable.js` poll `/api/agents` every 2 s.
- Run: `python3 -m vendor.agentfeed serve --web web --port 8850 [--fixture]`.
- Tests: `python3 -m unittest discover -s tests`; browser smoke test
  `NODE_PATH=/root/arcade-watch/node_modules node tests/smoke.cjs`.
- Screenshots come from the fixture feed only, never live sessions.
- Repo is PRIVATE; hosted Actions are refused (billing): run localci on PRs.
