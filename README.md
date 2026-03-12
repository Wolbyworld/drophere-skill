# drophere

Publish static files to [drophere.cc](https://drophere.cc) — instant hosting with a URL. Zero dependencies, works with any AI agent.

## Install

### Skills CLI

```bash
npx skills add Wolbyworld/drophere-skill
```

### Direct install

```bash
curl -fsSL https://drophere.cc/install.sh | bash
```

### Cowork plugin

This repo is structured as a Claude Code Plugin. Clone or add it as a plugin to get `/publish` and the full skill automatically.

## What it does

- Publish HTML, images, PDFs, or entire directories to the web instantly
- Incremental deploys — only uploads changed files
- Anonymous publishing (24h TTL) or authenticated for permanent hosting
- Auto-viewer for rich previews of images, PDFs, and other media

## Usage

```bash
# Publish a directory
node ~/.claude/skills/drophere/scripts/publish.mjs ./dist/

# Publish specific files
node ~/.claude/skills/drophere/scripts/publish.mjs index.html style.css
```

See [skills/drophere/SKILL.md](skills/drophere/SKILL.md) for full documentation.

---

> This repo is auto-synced from [here-elcano-cc/skill/](https://github.com/Wolbyworld/here-elcano-cc/tree/main/skill). Do not edit directly.
