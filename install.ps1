# drophere.cc skill installer (Windows)
# Installs the drophere skill to ~/.claude/skills/drophere/
# Usage: irm https://drophere.cc/install.ps1 | iex
$ErrorActionPreference = "Stop"

$SKILL_DIR = Join-Path $HOME ".claude\skills\drophere"
$BASE_URL = "https://drophere.cc/skill"

function Log($msg) { Write-Host "[drophere] $msg" }
function Err($msg) { Write-Host "[drophere] ERROR: $msg" -ForegroundColor Red }

# Check for Node.js 18+
try {
    $nodeVersion = (node -e "process.stdout.write(String(process.versions.node.split('.')[0]))") 2>$null
    if ([int]$nodeVersion -lt 18) {
        Err "Node.js 18+ is required (found v$(node -v))"
        Err "Install from: https://nodejs.org/"
        exit 1
    }
} catch {
    Err "Node.js is required but not installed."
    Err "Install from: https://nodejs.org/ (version 18 or later)"
    exit 1
}

# Detect upgrade
$upgrading = (Test-Path "$SKILL_DIR\scripts\publish.sh") -and -not (Test-Path "$SKILL_DIR\scripts\publish.mjs")
if ($upgrading) { Log "Upgrading existing installation..." }

# Create directory structure
Log "Installing to $SKILL_DIR..."
New-Item -ItemType Directory -Force -Path "$SKILL_DIR\scripts" | Out-Null
New-Item -ItemType Directory -Force -Path "$SKILL_DIR\references" | Out-Null

# Download files
function Download($url, $dest) {
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        Log "  $(Split-Path $dest -Leaf)"
    } catch {
        Err "Failed to download: $url"
        exit 1
    }
}

Download "$BASE_URL/skills/drophere/SKILL.md"              "$SKILL_DIR\SKILL.md"
Download "$BASE_URL/skills/drophere/scripts/publish.mjs"   "$SKILL_DIR\scripts\publish.mjs"
Download "$BASE_URL/skills/drophere/scripts/publish.sh"    "$SKILL_DIR\scripts\publish.sh"
Download "$BASE_URL/skills/drophere/references/API.md"     "$SKILL_DIR\references\API.md"

Write-Host ""
if ($upgrading) {
    Log "Upgrade complete! publish.sh has been replaced by publish.mjs"
} else {
    Log "Installed successfully!"
}
Write-Host ""
Log "Quick start:"
Log "  node ~/.claude/skills/drophere/scripts/publish.mjs ./your-files/"
Write-Host ""
Log "The skill is now available to Claude Code and other AI agents."
