# DaylightStation - Claude Context

## First Action

Read `.claude/settings.local.json` and look at the `env` section for all environment-specific values (paths, hosts, ports).

---

## Environment Overview

> **Actual values:** Check `env` in `.claude/settings.local.json`

### Expected settings.local.json Structure

```json
{
  "env": {
    "mounts": {
      "data": "/path/to/data",
      "media": "/path/to/media"
    },
    "hosts": {
      "prod": "user@hostname"
    },
    "ports": {
      "frontend": 5173,
      "backend": 3112
    },
    "docker": {
      "container": "daylight"
    },
    "production": {
      "access_command": "ssh user@host ...",
      "logs_command": "ssh user@host ...",
      "mounts": {
        "data": "...",
        "media": "..."
      },
      "docker_compose_path": "..."
    }
  }
}
```

If `env` values show `[object Object]`, the file is corrupted and needs manual repair.

### Key Environment Values

- **Data mount:** YAML data files (`env.mounts.data`)
- **Media mount:** Media files (`env.mounts.media`)
- **Prod host:** SSH target (`env.hosts.prod`)
- **Dev ports:** Frontend, backend, API (`env.ports.*`)
- **Docker container:** Container name (`env.docker.container`)
- **Prod commands:** Access/Login (`env.production.*`)

### Dev Workflow

- `npm run dev` starts frontend + backend with nodemon (auto-restart)
- Logs tee to `dev.log` - tail this for real-time feedback
- Check if dev server is already running before starting new one

### Prod Access

```bash
# SSH to prod (use command from settings)
{env.production.access_command}

# View prod logs
{env.production.logs_command}
```

### Mount Permissions

When writing data files from macOS, use SSH due to mount permission issues:
```bash
ssh {hosts.prod} 'echo "content" > /path/to/file'
```

---

## Rules

- **Do NOT commit automatically** - User must review changes
- **Do NOT run deploy.sh automatically** - User must run manually
- **Keep docs in /docs folder** - In appropriate subfolder
- **Check dev server** - Before starting new one

---

## Branch Management

**Clean git branches is key.** Keep the branch list minimal and tidy.

### Workflow

1. **Use worktrees for feature work** - Prefer `git worktree` over regular branches for isolation
2. **Merge directly into main** - No pull requests; merge when work is complete and tested
3. **Delete branches after merge** - Don't let merged branches linger

### Deleting Stale Branches

Before deleting any branch, document it for potential restoration:

1. Record the branch name and commit hash in `docs/_archive/deleted-branches.md`
2. Format: `| YYYY-MM-DD | branch-name | commit-hash | brief description |`
3. Then delete: `git branch -d branch-name` (or `-D` if unmerged)

Example entry:
```markdown
| 2026-01-14 | feature/shader-redesign | a1b2c3d4 | Player shader system cleanup |
```

To restore a deleted branch:
```bash
git checkout -b branch-name <commit-hash>
```

---

## Documentation Management

IMPORTANT: Always update docs when changing code!

### Folder Structure
```
docs/
├── ai-context/       # Claude primers (quickstart docs)
├── reference/        # Domain reference documentation
│   ├── fitness/      # 1-use-cases, 2-architecture, 3-data-model, 4-codebase, 5-features
│   ├── tv/
│   ├── home/
│   ├── bots/
│   ├── finance/
│   └── core/
├── runbooks/         # Operational procedures
├── _wip/             # Work in progress (brainstorms, plans, bugs)
└── _archive/         # Obsolete docs
```

### Domain Reference Structure
Each domain in `reference/` follows a numbered 5-file structure:
- `1-use-cases.md` - Problem statements, requirements, UX flows
- `2-architecture.md` - System design, data flow diagrams
- `3-data-model.md` - Entities, schemas, YAML configs
- `4-codebase.md` - File locations, function reference
- `5-features.md` - Index of features/ subdirectory
- `features/` - Individual feature documentation

### Naming Convention
- Numbered files: `1-use-cases.md`, `2-architecture.md`, etc.
- Feature files: **kebab-case** in `features/` directory
- All reference docs have **Related code:** header

### When to Update Docs
When modifying code, check if related docs need updating:
- Changed `frontend/src/hooks/fitness/`? Check `docs/reference/fitness/`
- Changed `frontend/src/apps/tv/`? Check `docs/reference/tv/`
- Changed core infrastructure? Check `docs/reference/core/`

### Freshness Audit
```bash
# See code changes since last docs review
git diff $(cat docs/docs-last-updated.txt)..HEAD --name-only

# After updating docs, update the marker
git rev-parse HEAD > docs/docs-last-updated.txt
```

### Rules

1. **New work goes to `_wip/`** - All brainstorms, designs, plans, bug investigations, audits, incidents
2. **Always date-prefix WIP files** - Format: `YYYY-MM-DD-topic-name.md`
3. **Use appropriate subfolder** - `_wip/bugs/`, `_wip/plans/`, `_wip/audits/`, `_wip/incidents/`
4. **Graduate when stable** - Move to `reference/{domain}/` (without date prefix) when doc becomes permanent reference
5. **Archive when obsolete** - Move to `_archive/` when superseded or no longer relevant
6. **No loose files** - Everything belongs in a subfolder
7. **Keep reference docs current** - Update existing docs rather than creating new point-in-time snapshots
8. **No instance-specific data** - Never include paths, hostnames, ports, or environment-specific values. Use placeholders like `{hosts.prod}` or reference `.claude/settings.local.json`

---

## Navigation - AI Context Files

Read these based on what you're working on:

| Working On | Read |
|------------|------|
| Project structure, conventions, config | `docs/ai-context/architecture.md` |
| Shared components (Player, WebSocket, logging) | `docs/ai-context/foundations.md` |
| Fitness app (sessions, governance, zones) | `docs/ai-context/fitness.md` |
| Home/Office apps (piano, widgets, HA) | `docs/ai-context/home-office.md` |
| TV app (Plex, media, menus) | `docs/ai-context/tv.md` |
| Finance app (Buxfer, budgets) | `docs/ai-context/finance.md` |
| Chatbots (journalist, nutribot) | `docs/ai-context/bots.md` |
| CLI tools, ClickUp workflow | `docs/ai-context/cli-tools.md` |
| Testing infrastructure | `docs/ai-context/testing.md` |

---

## Quick Reference

### File Extensions
- `.mjs` - Backend ES modules
- `.jsx` - React components
- `.js` - Frontend utilities/hooks

### Key Directories
- `frontend/src/Apps/` - App entry points
- `frontend/src/modules/` - Reusable UI modules
- `frontend/src/hooks/` - Custom hooks
- `backend/routers/` - API routes
- `backend/lib/` - Backend services
- `backend/chatbots/` - Bot framework
- `cli/` - CLI tools
- `docs/ai-context/` - AI context files

### Config System
- Household configs: `data/households/{hid}/apps/{app}/config.yml`
- Use ConfigService for reads (preferred over io.mjs)
- Multi-dimensional process.env (use spread pattern to set)
