---
name: publish
description: Publish static files to drophere.cc for instant public hosting
---

Publish the specified files or directory to drophere.cc using the drophere skill.

1. Resolve the publish script path:
```bash
PUBLISH="${CLAUDE_PLUGIN_ROOT:+${CLAUDE_PLUGIN_ROOT}/skills/drophere/scripts/publish.mjs}"
PUBLISH="${PUBLISH:-$HOME/.claude/skills/drophere/scripts/publish.mjs}"
```

2. Run `node "$PUBLISH" <target>` where `<target>` is the directory or files the user wants to publish.

3. Return the URL from stdout to the user.

If no target is specified, look for common build output directories (`./dist/`, `./build/`, `./out/`, `./public/`) or ask the user what to publish.
