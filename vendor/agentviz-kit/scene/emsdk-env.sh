# Source this before building a scene:  EMSDK=/path/to/emsdk . kit/scene/emsdk-env.sh
# emsdk_env.sh needs Python >= 3.10 and resets EMSDK_PYTHON, so this script
# sets EMSDK_PYTHON before and after sourcing it.
: "${EMSDK:?set EMSDK to your emsdk checkout (emsdk 6.0.11)}"
if [ -z "${EMSDK_PYTHON:-}" ]; then
  for candidate in python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1; then EMSDK_PYTHON="$(command -v "$candidate")"; break; fi
  done
fi
if [ -z "${EMSDK_PYTHON:-}" ]; then
  echo "emsdk-env.sh: no Python 3.10+ found (emsdk needs one); set EMSDK_PYTHON" >&2
  return 1 2>/dev/null || exit 1
fi
export EMSDK_PYTHON
_keep="$EMSDK_PYTHON"
# shellcheck disable=SC1091
. "$EMSDK/emsdk_env.sh" >/dev/null
export EMSDK_PYTHON="$_keep"
unset _keep
