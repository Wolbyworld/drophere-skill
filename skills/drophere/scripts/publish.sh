#!/usr/bin/env bash
echo "[drophere] publish.sh has been replaced by publish.mjs" >&2
echo "[drophere] Run: node \"$(dirname "$0")/publish.mjs\" $*" >&2
echo "[drophere] To upgrade: curl -fsSL https://drophere.cc/install.sh | bash" >&2
exit 1
