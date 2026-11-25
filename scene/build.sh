#!/usr/bin/env bash
# Builds scene/main.cpp into web/wartable-engine.{js,wasm} with the Strata
# web kit, and copies the kit's page scripts beside them. Downloads Strata's
# pinned wasm release into the gitignored .strata/ once. Needs emsdk 6.0.11
# (/root/agentviz/tools/emsdk-env.sh activates it here).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
STRATA_VERSION=0.10.0
export STRATA_SHA256=bb86b974c7e0309db91625ba5ee157273704c77d93f4338c8a63ee625e3d56de
tarball="$repo/.strata/strata-$STRATA_VERSION-wasm32-emscripten.tar.gz"
if ! command -v emcc >/dev/null 2>&1 && [ -f /root/agentviz/tools/emsdk-env.sh ]; then
  # shellcheck disable=SC1091
  . /root/agentviz/tools/emsdk-env.sh >/dev/null
fi
mkdir -p "$repo/.strata"
if [ ! -f "$tarball" ]; then
  gh release download "v$STRATA_VERSION" -R Preponderous-Software/strata \
    -p "strata-$STRATA_VERSION-wasm32-emscripten.tar.gz" -D "$repo/.strata"
fi
echo "$STRATA_SHA256  $tarball" | sha256sum -c --quiet -
rm -rf "$repo/.strata/kit" && tar -xzf "$tarball" -C "$repo/.strata"
export STRATA_TARBALL="$tarball"
"$repo/.strata/kit/build-kit.sh" "$here/kit.conf"
