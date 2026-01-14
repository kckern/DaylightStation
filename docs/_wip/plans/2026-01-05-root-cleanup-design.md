# Root Folder Cleanup Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up root folder by removing unused items, fixing typos, and organizing Docker files.

**Result:** Reduce root from 42 items to 31 items.

---

## Actions

### Delete (4 items)

| Item | Reason |
|------|--------|
| `apps/` | Legacy storybook.yml from May 2025, unused |
| `data/` | Empty placeholder, actual data on mounts |
| `.vscode/` | Empty folder |
| `.venv/` | Python not used |

### Rename (1 item)

| From | To | Reason |
|------|-----|--------|
| `_extentions/` | `_extensions/` | Fix typo |

### Update (1 item)

| File | Change |
|------|--------|
| `AGENTS.md` | Replace contents with reference to CLAUDE.md |

### Move to `docker/` (7 items)

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.remote.yml`
- `.dockerignore`
- `entrypoint.sh`
- `docker.config.sh`
- `docker.config.template.sh`

---

## Reference Updates

### `deploy.sh`

```bash
# Change from:
source "$(dirname "$0")/docker.config.sh"
# To:
source "$(dirname "$0")/docker/docker.config.sh"
```

### Docker commands

All docker-compose commands need `-f docker/docker-compose.yml`:

```bash
# Before:
docker-compose up -d

# After:
docker-compose -f docker/docker-compose.yml up -d
```

### `Readme.md`

- Update docker-compose commands (lines 139, 144, 344-350)
- Update file structure section (lines 256-257)

### Active docs to check

- `docs/fitness/vibration-sensors-fitness.md`
- `docs/runbooks/clickup-workflow.md`

---

## Final Root Structure

**Before (42 items) → After (31 items)**

```
.claude/              AGENTS.md             _extensions/          docker/
.env                  CLAUDE.local.example.md  backend/           docs/
.env.example          CLAUDE.md             babel.config.js       frontend/
.git/                 Readme.md             cli/                  jest.config.js
.github/              config/               deploy.sh             logs/
.gitignore            dev                   dev.log               node_modules/
                      package-lock.json     package.json          playwright.config.js
                      scripts/              tests/
```
