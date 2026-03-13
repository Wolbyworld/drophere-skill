#!/usr/bin/env bash
# drophere.cc skill installer
# Installs the drophere skill to ~/.claude/skills/drophere/
# Usage: curl -fsSL https://drophere.cc/install.sh | bash
set -euo pipefail

SKILL_DIR="$HOME/.claude/skills/drophere"
BASE_URL="https://drophere.cc/skill"

log()   { echo "[drophere] $*"; }
err()   { echo "[drophere] ERROR: $*" >&2; }

# Download a file with error reporting
download() {
  local url="$1" dest="$2"
  if curl -fsSL "$url" -o "$dest" 2>/dev/null; then
    log "  $(basename "$dest")"
  else
    err "Failed to download: $url"
    exit 1
  fi
}

# --- Cowork environment detection ---

# Case A: Already installed as a Cowork plugin
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  log "drophere is already installed as a Cowork plugin."
  log "  Publish: node \"\$CLAUDE_PLUGIN_ROOT/skills/drophere/scripts/publish.mjs\" ./your-files/"
  exit 0
fi

# Case B: Cowork VM detected (has /sessions dir), plugin not yet installed
if [ -d "/sessions" ]; then
  log "Cowork environment detected — building plugin..."

  # Find outputs dir (try known patterns, fallback to /tmp)
  OUTPUTS_DIR=""
  for d in /sessions/*/mnt/outputs /sessions/*/outputs; do
    [ -d "$d" ] && OUTPUTS_DIR="$d" && break
  done
  OUTPUTS_DIR="${OUTPUTS_DIR:-/tmp}"

  # Check for zip (needed to build .plugin file)
  if ! command -v zip &>/dev/null; then
    err "zip is required to build the plugin file."
    exit 1
  fi

  # Check for curl
  if ! command -v curl &>/dev/null; then
    err "curl is required to download files."
    exit 1
  fi

  BUILD_DIR=$(mktemp -d)
  trap 'rm -rf "$BUILD_DIR"' EXIT

  # Plugin manifest
  mkdir -p "$BUILD_DIR/.claude-plugin"
  download "$BASE_URL/.claude-plugin/plugin.json"      "$BUILD_DIR/.claude-plugin/plugin.json"
  download "$BASE_URL/.claude-plugin/marketplace.json"  "$BUILD_DIR/.claude-plugin/marketplace.json"

  # Commands
  mkdir -p "$BUILD_DIR/commands"
  download "$BASE_URL/commands/publish.md"  "$BUILD_DIR/commands/publish.md"

  # Skill files
  mkdir -p "$BUILD_DIR/skills/drophere/scripts" "$BUILD_DIR/skills/drophere/references"
  download "$BASE_URL/skills/drophere/SKILL.md"             "$BUILD_DIR/skills/drophere/SKILL.md"
  download "$BASE_URL/skills/drophere/scripts/publish.mjs"  "$BUILD_DIR/skills/drophere/scripts/publish.mjs"
  download "$BASE_URL/skills/drophere/scripts/publish.sh"   "$BUILD_DIR/skills/drophere/scripts/publish.sh"
  download "$BASE_URL/skills/drophere/references/API.md"    "$BUILD_DIR/skills/drophere/references/API.md"

  chmod +x "$BUILD_DIR/skills/drophere/scripts/publish.sh"

  # Build .plugin zip — write to /tmp first, then move to outputs.
  # Avoids "Operation not permitted" when a stale drophere.plugin exists
  # from a previous Cowork session (different Linux user).
  PLUGIN_TMP="/tmp/drophere-$$.plugin"
  PLUGIN_OUT="$OUTPUTS_DIR/drophere.plugin"
  (cd "$BUILD_DIR" && zip -qr "$PLUGIN_TMP" .)
  rm -f "$PLUGIN_OUT" 2>/dev/null || true
  if mv "$PLUGIN_TMP" "$PLUGIN_OUT" 2>/dev/null; then
    : # moved successfully, temp file is gone
  elif cp "$PLUGIN_TMP" "$PLUGIN_OUT" 2>/dev/null; then
    rm -f "$PLUGIN_TMP" 2>/dev/null || true
  else
    # Can't write to outputs dir at all — serve from temp path directly
    PLUGIN_OUT="$PLUGIN_TMP"
  fi

  log "Plugin saved: $PLUGIN_OUT"
  log "Run: present_files $PLUGIN_OUT"
  exit 0
fi

# --- Standard CLI install ---

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

download "$BASE_URL/skills/drophere/SKILL.md"              "$SKILL_DIR/SKILL.md"
download "$BASE_URL/skills/drophere/scripts/publish.mjs"   "$SKILL_DIR/scripts/publish.mjs"
download "$BASE_URL/skills/drophere/scripts/publish.sh"    "$SKILL_DIR/scripts/publish.sh"
download "$BASE_URL/skills/drophere/references/API.md"     "$SKILL_DIR/references/API.md"

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
