#!/usr/bin/env bash
# drophere.cc skill installer
# Installs the drophere skill to ~/.claude/skills/drophere/
# Usage: curl -fsSL https://drophere.cc/install.sh | bash
set -euo pipefail

SKILL_DIR="$HOME/.claude/skills/drophere"
BASE_URL="https://drophere.cc/skill"

log()   { echo "[drophere] $*"; }
err()   { echo "[drophere] ERROR: $*" >&2; }

# Check for Node.js 18+
if ! command -v node &>/dev/null; then
  err "Node.js is required but not installed."
  err "Install from: https://nodejs.org/ (version 18 or later)"
  exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [[ "$NODE_VERSION" -lt 18 ]]; then
  err "Node.js 18+ is required (found v$(node -v))"
  err "Install from: https://nodejs.org/"
  exit 1
fi

# Check for curl (needed for installer itself)
if ! command -v curl &>/dev/null; then
  err "curl is required to download files."
  exit 1
fi

# Detect upgrade
UPGRADING=false
if [[ -f "$SKILL_DIR/scripts/publish.sh" ]] && [[ ! -f "$SKILL_DIR/scripts/publish.mjs" ]]; then
  UPGRADING=true
  log "Upgrading existing installation..."
fi

# Create directory structure
log "Installing to $SKILL_DIR..."
mkdir -p "$SKILL_DIR/scripts" "$SKILL_DIR/references"

# Download files
download() {
  local url="$1" dest="$2"
  if curl -fsSL "$url" -o "$dest" 2>/dev/null; then
    log "  $(basename "$dest")"
  else
    err "Failed to download: $url"
    exit 1
  fi
}

download "$BASE_URL/SKILL.md"              "$SKILL_DIR/SKILL.md"
download "$BASE_URL/scripts/publish.mjs"   "$SKILL_DIR/scripts/publish.mjs"
download "$BASE_URL/scripts/publish.sh"    "$SKILL_DIR/scripts/publish.sh"
download "$BASE_URL/references/API.md"     "$SKILL_DIR/references/API.md"

# Make shim executable (publish.mjs doesn't need chmod)
chmod +x "$SKILL_DIR/scripts/publish.sh"

log ""
if [[ "$UPGRADING" == "true" ]]; then
  log "Upgrade complete! publish.sh has been replaced by publish.mjs"
else
  log "Installed successfully!"
fi
log ""
log "Quick start:"
log "  node ~/.claude/skills/drophere/scripts/publish.mjs ./your-files/"
log ""
log "The skill is now available to Claude Code and other AI agents."
