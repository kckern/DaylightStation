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

### plex.cli.mjs

**Purpose:** Search Plex libraries, verify IDs, debug media_memory issues.

**Usage:**
```bash
node cli/plex.cli.mjs libraries              # List library sections
node cli/plex.cli.mjs search "yoga"          # Search all libraries
node cli/plex.cli.mjs search "ninja" --deep  # Hub search (finds episodes)
node cli/plex.cli.mjs info 673634            # Get metadata for ID
node cli/plex.cli.mjs verify 606037 11570    # Check if IDs exist
```

---

## Creating New CLI Tools

New CLIs go in `cli/` directory. Use this bootstrap pattern:

### Bootstrap Template

```javascript
#!/usr/bin/env node

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { createLogger } from '../backend/lib/logging/logger.js';
import { configService } from '../backend/lib/config/ConfigService.mjs';
import { resolveConfigPaths } from '../backend/lib/config/pathResolver.mjs';
import { hydrateProcessEnvFromConfigs } from '../backend/lib/logging/config.js';

// Bootstrap config (required for ConfigService access)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDocker = existsSync('/.dockerenv');
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: path.join(__dirname, '..') });

if (configPaths.error) {
    console.error('Config error:', configPaths.error);
    process.exit(1);
}

hydrateProcessEnvFromConfigs(configPaths.configDir);
configService.init({ dataDir: configPaths.dataDir });

const logger = createLogger({ source: 'cli', app: 'your-cli-name' });
```

### Accessing Service Auth Tokens

```javascript
// Get auth for any configured service
const auth = configService.getHouseholdAuth('plex');
// Returns: { token: '...', server_url: '...' }

const fitnessAuth = configService.getHouseholdAuth('fitness');
// Returns: { client_id: '...', client_secret: '...' }
```

### Accessing Data Paths

After bootstrap, use `process.env.path.*`:
```javascript
process.env.path.data   // Data mount (YAML files)
process.env.path.media  // Media mount (video/audio files)
process.env.path.img    // Images directory
```

### CLI Argument Parsing Pattern

```javascript
const args = process.argv.slice(2);
const flags = {
    json: args.includes('--json'),
    verbose: args.includes('--verbose')
};

// Remove flags to get positional args
const positionalArgs = args.filter(arg => !arg.startsWith('--'));
const command = positionalArgs[0];
const commandArgs = positionalArgs.slice(1);
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
