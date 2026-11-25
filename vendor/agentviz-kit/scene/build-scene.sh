#!/usr/bin/env bash
# build-scene.sh: builds an agentviz scene with the pinned Strata web kit.
#
#   EMSDK=/path/to/emsdk vendor/agentviz-kit/scene/build-scene.sh scene/kit.conf
#
# Downloads the Strata 0.10.0 wasm tarball from its public release (once, into
# <repo>/.strata/, which is gitignored), checks its SHA-256, activates emsdk
# from $EMSDK and runs the tarball's kit/build-kit.sh with the repo's kit.conf.
# The scene's .cpp can include agentviz.h from vendor/agentviz-kit/scene/.
set -euo pipefail
conf="${1:?usage: build-scene.sh <scene/kit.conf>}"
conf="$(cd "$(dirname "$conf")" && pwd)/$(basename "$conf")"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$(dirname "$conf")/.." && pwd)"

STRATA_VERSION=0.10.0
STRATA_SHA256=bb86b974c7e0309db91625ba5ee157273704c77d93f4338c8a63ee625e3d56de
name="strata-$STRATA_VERSION-wasm32-emscripten.tar.gz"
url="https://github.com/Preponderous-Software/strata/releases/download/v$STRATA_VERSION/$name"
work="$repo/.strata"
tarball="$work/$name"

mkdir -p "$work"
if [ ! -f "$tarball" ]; then
  curl -fsSL -o "$tarball.part" "$url"
  mv "$tarball.part" "$tarball"
fi
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
if [ "$(sha256_of "$tarball")" != "$STRATA_SHA256" ]; then
  echo "build-scene: $tarball does not match the pinned SHA-256; delete it and retry" >&2
  exit 1
fi
rm -rf "$work/kit"
tar -xzf "$tarball" -C "$work"

if ! command -v emcc >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  . "$here/emsdk-env.sh"
fi

STRATA_TARBALL="$tarball" STRATA_SHA256="$STRATA_SHA256" KIT_WORK="${KIT_WORK:-$work/work}" \
  "$work/kit/build-kit.sh" "$conf"
