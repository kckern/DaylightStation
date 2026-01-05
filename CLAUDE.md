# General Workspace Instructions

- This project runs both in dev and prod
- The FitnessApp client runs on an ssh box at `homeserver.local`
- For prod logs: `ssh homeserver.local 'docker logs daylight-station -f'`
- There are two main mount points (configure paths in `.claude/settings.local.json`):
  - **Data mount** for yml data, accessed via io.mjs
    - Mounted in docker at `/usr/src/app/data`
    - Dev mount path: `mounts.data` in settings
  - **Media mount** for media files
    - Mounted in docker at `/usr/src/app/media`
    - Dev mount path: `mounts.media` in settings
- When writing to data files, use ssh, as mounts often have permission issues from macOS side. Careful to chown files back to the correct user if you create them manually.
- process.env is multi-dimensional, eg process.env.path.data. However, you cannot set process.env.path.data directly. It must be done via {...spread} pattern, and ideally handled via ConfigService.

- npm run dev uses nodemon for frontend and backend, so changes auto-restart servers. In dev, logs for frontend and backend are tee'd to `tail ./dev.log` file. This means you can get instant feedback on errors and crashes without asking the user to paste logs or refresh repeatedly. You may run it manually in another terminal if it is not running.
- The localhost dev server runs on http://localhost:3111/. If you open it via cli, you can check the logs in dev.log

Rules:
 - Do not commit to git automatically. User must review changes before committing.
 - Do not run deploy.sh automatically. User must run it manually.
 - Keep all md files in the /docs folder, in the appropriate subfolder.
 - Always check if dev server is already running before starting a new one.

### Environment & Config Quick Facts
- Runtime config is mounted outside the repo. These feed process.env via loadAllConfig/ConfigService.
- Data/media mounts: prod containers use /usr/src/app/data and /usr/src/app/media; dev uses paths from settings.
- Household app configs (including fitness equipment) live at data/households/{hid}/apps/{app}/config.yml; legacy templates are under config/apps/*.yml.
- Dev servers: frontend dev at http://localhost:3111, primary backend HTTP+WS at :3112, secondary API at :3119. npm run dev uses nodemon and tees combined logs to dev.log.
- Prefer ConfigService for reads; io.mjs is legacy for YAML paths and will log deprecation warnings on old paths.

---

## Environment Reference

| Resource | Value |
|----------|-------|
| Prod SSH host | `homeserver.local` |
| Docker container | `daylight-station` |
| Prod logs | `ssh homeserver.local 'docker logs daylight-station -f'` |

---

## ClickUp Workflow Integration

This project uses ClickUp for task management. See [docs/ops/clickup-workflow.md](docs/ops/clickup-workflow.md) for full details.

### "Get to Work!" Command

When the user says **"get to work!"** (or variations like "gtw", "start working", "check clickup"):

1. **Query ClickUp** using the CLI with list IDs from your local settings:
   ```bash
   node cli/clickup.cli.mjs tasks $LIST_ID
   ```

2. **Filter for actionable tasks**:
   - Status: `on deck` (needs PRD), `in progress` (continue coding), or `ready` (PR needs attention)
   - Prioritize by: current file context -> priority field -> date created

3. **Present a summary**:
   ```
   Pending Tasks:

   IN PROGRESS (continue implementation):
   - [Task Name] (ID) - List Name

   ON DECK (needs design/PRD):
   - [Task Name] (ID) - List Name

   READY (PR ready for review):
   - [Task Name] (ID) - List Name
   ```

4. **Ask user which to work on** (or auto-select if only one)

5. **Follow the lifecycle**:
   - For `ready` tasks: Write PRD first, then ask for approval
   - For `in progress` tasks: Check task comments for context, continue implementation

### Task Lifecycle

| Status | Action |
|--------|--------|
| `on deck` | Write PRD as comment, wait for approval |
| `in progress` | Implement, test, commit -> move to `ready` when done |
| `ready` | PR ready - address any review feedback |
| Approved | Help user with deploy, move to `done` |

### ClickUp List -> Code Mapping

| List | Code Area |
|------|-----------|
| TV View | `frontend/src/apps/tv/`, `backend/story/` |
| Finances | `frontend/src/apps/finances/`, `backend/jobs/finance/` |
| Home/Office | `frontend/src/apps/home/`, `backend/lib/homeassistant.mjs` |
| Journalist/Lifelog | `backend/chatbots/bots/journalist/` |
| Nutribot/Health | `backend/chatbots/bots/nutribot/`, `frontend/src/apps/health/` |
| Fitness | `_extentions/fitness/`, `backend/lib/fitsync.mjs` |
| Admin/Config | `backend/lib/config/`, `config/` |
