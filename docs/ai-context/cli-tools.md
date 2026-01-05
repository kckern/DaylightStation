# CLI Tools Context

## Available CLI Tools

Located in `cli/` directory.

### clickup.cli.mjs

**Purpose:** ClickUp task management integration.

**Usage:**
```bash
node cli/clickup.cli.mjs tasks <LIST_ID>
node cli/clickup.cli.mjs task <TASK_ID>
node cli/clickup.cli.mjs update <TASK_ID> --status "in progress"
```

**List IDs:** Stored in `.claude/settings.local.json` under `env.clickup.listIds`

### auth-validator.cli.mjs

**Purpose:** Validate authentication tokens for various services.

**Usage:**
```bash
node cli/auth-validator.cli.mjs <service>
```

### fitsync-auth.cli.mjs

**Purpose:** Authenticate and manage fitness device sync.

**Usage:**
```bash
node cli/fitsync-auth.cli.mjs
```

---

## ClickUp Workflow

### "Get to Work!" Command

When user says "get to work!" (or "gtw", "start working", "check clickup"):

1. **Query ClickUp** using list IDs from settings:
   ```bash
   node cli/clickup.cli.mjs tasks <LIST_ID>
   ```

2. **Filter for actionable tasks:**
   - `on deck` - Needs PRD/design
   - `in progress` - Continue implementation
   - `ready` - PR needs attention

3. **Present summary:**
   ```
   Pending Tasks:

   IN PROGRESS (continue implementation):
   - [Task Name] (ID) - List Name

   ON DECK (needs design/PRD):
   - [Task Name] (ID) - List Name

   READY (PR ready for review):
   - [Task Name] (ID) - List Name
   ```

4. **Ask which to work on** (or auto-select if only one)

### Task Lifecycle

| Status | Action |
|--------|--------|
| `on deck` | Write PRD as comment, wait for approval |
| `in progress` | Implement, test, commit → move to `ready` |
| `ready` | PR ready - address review feedback |
| Approved | Deploy, move to `done` |

### ClickUp List → Code Mapping

| List | Code Area |
|------|-----------|
| TV View | `frontend/src/Apps/TVApp.jsx`, `backend/story/` |
| Finances | `frontend/src/Apps/FinanceApp.jsx`, `backend/lib/budget.mjs` |
| Home/Office | `frontend/src/Apps/OfficeApp.jsx`, `backend/lib/homeassistant.mjs` |
| Journalist/Lifelog | `backend/chatbots/bots/journalist/` |
| Nutribot/Health | `backend/chatbots/bots/nutribot/`, `frontend/src/Apps/HealthApp.jsx` |
| Fitness | `frontend/src/Apps/FitnessApp.jsx`, `backend/routers/fitness.mjs` |
| Admin/Config | `backend/lib/config/`, `config/` |

---

## npm Scripts

**Development:**
```bash
npm run dev          # Start dev servers (frontend + backend with nodemon)
./dev                # Alternative dev script
```

**Testing:**
```bash
npm run test:smoke   # Smoke tests
npm run test:assembly # Assembly tests
npx playwright test  # E2E tests
```

**Building:**
```bash
npm run build        # Production build
```

**Note:** Dev logs tee to `dev.log` - tail this for real-time feedback.
