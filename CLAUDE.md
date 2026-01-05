# DaylightStation - Claude Context

## First Action

Read `.claude/settings.local.json` and look at the `env` section for all environment-specific values (paths, hosts, ports).

---

## Environment Overview

> **Actual values:** Check `env` in `.claude/settings.local.json`

- **Data mount:** YAML data files (`env.mounts.data`)
- **Media mount:** Media files (`env.mounts.media`)
- **Prod host:** SSH target (`env.hosts.prod`)
- **Dev ports:** Frontend, backend, API (`env.ports.*`)
- **Docker container:** Container name (`env.docker.container`)

### Dev Workflow

- `npm run dev` starts frontend + backend with nodemon (auto-restart)
- Logs tee to `dev.log` - tail this for real-time feedback
- Check if dev server is already running before starting new one

### Prod Access

```bash
# SSH to prod (use host from settings)
ssh {hosts.prod}

# View prod logs
ssh {hosts.prod} 'docker logs {docker.container} -f'
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
