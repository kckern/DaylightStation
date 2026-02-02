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
- **Docker container:** Container name (`env.docker.container`)
- **Prod commands:** Access/Login (`env.production.*`)

### Port Configuration

Dev ports for this environment are in `settings.local.json`:
- **App port:** `env.ports.app` (3111 on kckern-macbook)
- **Backend port:** `env.ports.backend` (3112 on kckern-macbook)

Runtime port config comes from `data/system/config/system.yml` based on `DAYLIGHT_ENV`.

In dev mode, Vite runs on the app port and proxies `/api/*` to backend.

**Never assume port 5173** - that's Vite's default, but this project configures it via system.yml.

### Dev Workflow

- `npm run dev` starts frontend + backend with nodemon (auto-restart)
- Logs tee to `dev.log` - tail this for real-time feedback
- Check if dev server is already running before starting new one

### Dev Server Ports (Multi-Environment)

The backend uses hostname-based config to avoid port conflicts with Docker:

| Environment | App Port | Backend Port | Check with |
|-------------|----------|--------------|------------|
| Docker (prod) | 3111 | 3111 | `lsof -i :3111` |
| kckern-macbook (dev) | 3111 | 3112 | `lsof -i :3111` |
| kckern-server (dev) | 3112 | 3113 | `lsof -i :3112` |

**Before starting dev server**, check if it's already running:
```bash
lsof -i :3111  # on kckern-macbook
```

**Start dev server** (on kckern-server):
```bash
node backend/index.js
# Or background: nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

**Stop dev server**:
```bash
pkill -f 'node backend/index.js'
```

**Full runbook**: `docs/runbooks/dev-server-multi-environment.md`

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
- **Check dev server before starting** - Run `ss -tlnp | grep 3112` first; if running, don't start another

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
├── ai-context/       # Claude primers (agents.md, testing.md)
├── reference/
│   └── core/         # Backend architecture, DDD layer guidelines, coding standards
│       └── layers-of-abstraction/  # Per-layer guidelines
├── runbooks/         # Operational procedures
├── _wip/             # Work in progress
│   ├── plans/        # Implementation plans (date-prefixed)
│   ├── audits/       # Code audits
│   └── bugs/         # Bug investigations
└── _archive/         # Obsolete docs (preserved for reference)
```

### Reference Structure
The `reference/core/` folder contains DDD architecture documentation:
- `backend-architecture.md` - Overall backend structure
- `configuration.md` - Config system documentation
- `coding-standards.md` - Code conventions
- `layers-of-abstraction/` - Per-layer guidelines (system, domain, application, adapter, API)

### When to Update Docs
When modifying code, check if related docs need updating:
- Changed DDD layer structure? Check `docs/reference/core/`
- Changed config system? Check `docs/reference/core/configuration.md`
- Added new patterns? Check `docs/reference/core/coding-standards.md`

### Freshness Audit
```bash
# See code changes since last docs review
git diff $(cat docs/docs-last-updated.txt)..HEAD --name-only

# After updating docs, update the marker
git rev-parse HEAD > docs/docs-last-updated.txt
```

### Rules

1. **New work goes to `_wip/`** - Bug investigations, audits, plans, temporary analysis
2. **Use appropriate subfolder** - `_wip/plans/`, `_wip/bugs/`, `_wip/audits/`
3. **Always date-prefix** - Format: `YYYY-MM-DD-topic-name.md`
4. **Archive when obsolete** - Move to `_archive/` when superseded or no longer relevant
5. **Keep reference docs current** - Update existing docs rather than creating new point-in-time snapshots
6. **No instance-specific data** - Never include paths, hostnames, ports, or environment-specific values. Use placeholders like `{hosts.prod}` or reference `.claude/settings.local.json`

---

## Navigation - Documentation

| Working On | Read |
|------------|------|
| AI Agents (autonomous LLM agents) | `docs/ai-context/agents.md` |
| Testing infrastructure | `docs/ai-context/testing.md` |
| Backend architecture (DDD layers) | `docs/reference/core/backend-architecture.md` |
| Config system | `docs/reference/core/configuration.md` |
| Coding standards | `docs/reference/core/coding-standards.md` |
| Layer guidelines | `docs/reference/core/layers-of-abstraction/*.md` |

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
- `backend/src/0_system/` - Bootstrap, config loading
- `backend/src/1_domains/` - Domain entities and logic
- `backend/src/2_adapters/` - External service integrations (Plex, HA, etc.)
- `backend/src/3_applications/` - Use cases, orchestration
- `backend/src/4_api/` - Express routers, HTTP layer
- `cli/` - CLI tools

### Config System
- Household configs: `data/household[-{hid}]/apps/{app}/config.yml`
- Use ConfigService for reads (preferred over io.mjs)
- Multi-dimensional process.env (use spread pattern to set)

---

## Testing

### Test Architecture

Tests are organized in `tests/` with infrastructure in `tests/_infrastructure/`:

| Location | Purpose |
|----------|---------|
| `tests/live/flow/` | Playwright UI tests (`.runtime.test.mjs`) |
| `tests/live/api/` | API integration tests |
| `tests/live/adapter/` | Adapter tests |
| `tests/_infrastructure/harnesses/` | Test harness scripts |
| `tests/_lib/` | Test utilities and helpers |
| `tests/_fixtures/` | Test data and URLs |

### Port Configuration (SSOT)

Test URLs come from system config - **NOT hardcoded**. The port is determined by:

1. `tests/_lib/configHelper.mjs` reads from `system.yml` in the data path
2. Default fallback is 3111 if no config found
3. `playwright.config.mjs` uses `getAppPort()` from configHelper

**This means tests use the same port as the running dev server.** If Vite is on 3111, tests connect to 3111.

### Running Playwright Tests

```bash
# Run all flow tests (headless)
npx playwright test tests/live/flow/

# Run specific test
npx playwright test tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs

# Run headed (visible browser)
npx playwright test tests/live/flow/ --headed

# Run with line reporter for cleaner output
npx playwright test tests/live/flow/ --reporter=line
```

### Dev Server Handling

Playwright's `webServer` config (in `playwright.config.mjs`) automatically:
1. Checks if a server is running on the configured port
2. If `reuseExistingServer: true`, uses existing server
3. If no server running, starts `npm run dev`

**The test harness ensures the dev server is running.** If the test reports "server not responding":
- Check if `npm run dev` is running (`ps aux | grep vite`)
- Check the port with `lsof -i :3111` (or whatever port)
- The dev server consists of Vite (frontend) AND nodemon (backend) running together

### Test Harness Scripts

```bash
# Run live tests via harness (recommended)
npm run test:live              # All live tests
npm run test:live:flow         # Playwright flow tests only
npm run test:live:api          # API tests only

# These harnesses check backend health before running
```

### Troubleshooting Test Failures

**"Server not responding" or "Vite not running":**
1. Check what's on the expected port: `lsof -i :3111`
2. Start dev server if needed: `npm run dev`
3. Verify both Vite and backend are running: `ps aux | grep -E 'vite|nodemon'`

**DASH video "Not supported" in headless:**
- Normal behavior - headless Chrome lacks some codecs
- Tests skip gracefully when video can't play
- Run `--headed` for full video playback testing

**Test passes locally but fails in CI:**
- Check port configuration matches CI environment
- CI may need different system.yml or env vars

### No Excuses Policy

When running tests:
- **Don't complain about ports** - Use configHelper SSOT
- **Don't blame Docker** - Check what's actually running on ports
- **Don't skip server setup** - Playwright config handles it
- **Don't guess URLs** - Read from `tests/_fixtures/runtime/urls.mjs`

The test infrastructure is designed to work. If tests fail, debug the actual issue.
