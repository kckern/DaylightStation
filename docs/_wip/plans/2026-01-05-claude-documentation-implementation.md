# Claude-Ready Documentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a comprehensive AI context system with lean CLAUDE.md navigation hub and specialized ai-context files.

**Architecture:** Environment-specific values live in `.claude/settings.local.json`. CLAUDE.md provides navigation. Domain docs follow consistent template. All version-controlled except settings.

**Tech Stack:** Markdown documentation, JSON configuration

---

## Task 1: Expand settings.local.json with Environment Values

**Files:**
- Modify: `.claude/settings.local.json`

**Step 1: Read current settings file**

Read `.claude/settings.local.json` to understand current structure.

**Step 2: Add environment configuration section**

Add new `env` key with all environment-specific values:

```json
{
  "permissions": {
    // ... existing permissions ...
  },
  "env": {
    "mounts": {
      "data": "/path/to/your/data/mount",
      "media": "/path/to/your/media/mount"
    },
    "hosts": {
      "prod": "your-prod-hostname",
      "fitness": "your-fitness-client-hostname"
    },
    "ports": {
      "frontend": 3111,
      "backend": 3112,
      "api": 3119
    },
    "docker": {
      "container": "daylight-station"
    },
    "ssh": {
      "user": "your-ssh-user"
    },
    "clickup": {
      "listIds": {
        "tvView": "LIST_ID",
        "finances": "LIST_ID",
        "homeOffice": "LIST_ID",
        "journalist": "LIST_ID",
        "nutribot": "LIST_ID",
        "fitness": "LIST_ID",
        "admin": "LIST_ID"
      }
    }
  }
}
```

**Step 3: Verify JSON is valid**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/settings.local.json')).env ? 'Valid' : 'Missing env')"`

Expected: `Valid`

**Step 4: Commit**

```bash
git add .claude/settings.local.json
git commit -m "chore: add environment config to settings.local.json"
```

---

## Task 2: Create ai-context Directory

**Files:**
- Create: `docs/ai-context/.gitkeep`

**Step 1: Create directory**

```bash
mkdir -p docs/ai-context
touch docs/ai-context/.gitkeep
```

**Step 2: Verify directory exists**

Run: `ls -la docs/ai-context/`

Expected: Shows `.gitkeep` file

**Step 3: Commit**

```bash
git add docs/ai-context/.gitkeep
git commit -m "chore: create ai-context directory"
```

---

## Task 3: Write architecture.md

**Files:**
- Create: `docs/ai-context/architecture.md`

**Step 1: Create architecture.md with full content**

Write the following content to `docs/ai-context/architecture.md`:

```markdown
# Architecture Context

## Project Structure

```
DaylightStation/
├── frontend/                    # React frontend (Vite)
│   └── src/
│       ├── Apps/                # Top-level app entry points
│       │   ├── FitnessApp.jsx   # Fitness tracking
│       │   ├── OfficeApp.jsx    # Office dashboard (includes piano)
│       │   ├── TVApp.jsx        # TV/media interface
│       │   ├── FinanceApp.jsx   # Finance dashboard
│       │   ├── HomeApp.jsx      # Home automation
│       │   ├── HealthApp.jsx    # Health/nutrition
│       │   └── LifelogApp.jsx   # Life logging
│       ├── modules/             # Reusable UI modules
│       │   ├── Player/          # Media player (foundation)
│       │   ├── ContentScroller/ # Scrolling content (foundation)
│       │   ├── Fitness/         # Fitness-specific components
│       │   ├── Piano/           # MIDI piano (part of Office)
│       │   ├── Menu/            # Navigation menus
│       │   └── Finance/         # Finance widgets
│       ├── hooks/               # Custom React hooks
│       │   └── fitness/         # Fitness domain hooks
│       ├── context/             # React contexts
│       ├── lib/                 # Frontend utilities
│       │   ├── api.mjs          # API client
│       │   └── logging/         # Frontend logging
│       └── main.jsx             # App entry point
├── backend/                     # Node.js backend (Express)
│   ├── api.mjs                  # Main Express server
│   ├── routers/                 # Route handlers
│   │   ├── fitness.mjs          # Fitness API
│   │   ├── media.mjs            # Media/Plex API
│   │   ├── fetch.mjs            # Proxy/fetch endpoints
│   │   ├── exe.mjs              # Command execution (foundation)
│   │   ├── cron.mjs             # Scheduled tasks
│   │   ├── websocket.mjs        # WebSocket handlers
│   │   └── harvest.mjs          # Data harvesters
│   ├── lib/                     # Backend services
│   │   ├── config/              # ConfigService, pathResolver
│   │   ├── logging/             # DaylightLogger
│   │   ├── io.mjs               # YAML data access
│   │   ├── plex.mjs             # Plex integration
│   │   ├── homeassistant.mjs    # Home Assistant
│   │   ├── buxfer.mjs           # Finance API
│   │   └── fitsync.mjs          # Fitness sync
│   ├── chatbots/                # Bot framework
│   │   ├── bots/                # Individual bots
│   │   │   ├── journalist/      # Lifelog bot
│   │   │   └── nutribot/        # Nutrition bot
│   │   └── adapters/            # HTTP, Canvas adapters
│   └── jobs/                    # Background jobs
├── cli/                         # CLI tools
│   ├── clickup.cli.mjs          # ClickUp integration
│   ├── auth-validator.cli.mjs   # Auth validation
│   └── fitsync-auth.cli.mjs     # Fitness auth
├── config/                      # Config templates
├── data/                        # Runtime data (gitignored)
│   └── households/
│       └── {hid}/
│           ├── apps/{app}/config.yml
│           └── users/{userId}.yml
└── docs/                        # Documentation
    ├── ai-context/              # Claude context files
    └── plans/                   # Implementation plans
```

## Data Flow Patterns

### Frontend ↔ Backend Communication

**REST API:**
- Frontend uses `lib/api.mjs` for HTTP requests
- Backend Express routes in `routers/*.mjs`
- Standard pattern: `await api.get('/fitness/session')` or `await api.post('/fitness/session/start', data)`

**WebSocket:**
- Real-time updates via WebSocket connection
- Backend: `routers/websocket.mjs` handles messages
- Frontend: `useWebSocket` hook or direct WebSocket connection
- Message bus pattern for broadcasting events

**State Management:**
- React Context for app-level state (e.g., `FitnessContext`)
- Custom hooks for domain logic (e.g., `hooks/fitness/`)
- No Redux - contexts + hooks pattern

### Backend Data Access

**ConfigService (preferred):**
```javascript
import { ConfigService } from './lib/config/ConfigService.mjs';
const config = await ConfigService.getAppConfig('fitness');
```

**io.mjs (legacy, for YAML paths):**
```javascript
import { readYaml, writeYaml } from './lib/io.mjs';
const data = await readYaml('path/to/file.yml');
```

## Code Conventions

### File Extensions
- `.mjs` - ES modules (backend)
- `.jsx` - React components (frontend)
- `.js` - Plain JavaScript (frontend hooks, utilities)
- `.scss` - Styles

### Naming
- **PascalCase:** React components, classes (`FitnessApp.jsx`, `GovernanceEngine.js`)
- **camelCase:** Utilities, services (`pathResolver.mjs`, `configService.mjs`)
- **kebab-case:** Documentation (`architecture.md`, `fitness-design.md`)

### Import Patterns
```javascript
// Backend - always include extension
import { something } from './lib/something.mjs';

// Frontend - Vite resolves extensions
import SomeComponent from './components/SomeComponent';
import { useHook } from './hooks/useHook';
```

## Config System

### Hierarchy (later overrides earlier)
1. Default configs (in code)
2. Household config: `data/households/{hid}/config.yml`
3. App config: `data/households/{hid}/apps/{app}/config.yml`
4. User config: `data/households/{hid}/users/{userId}.yml`
5. Environment variables

### Environment Variables
- Multi-dimensional: `process.env.path.data`
- Cannot set directly - use spread pattern
- Loaded via `loadAllConfig` / `ConfigService`

### Runtime Paths
- **Dev:** Paths from `.claude/settings.local.json` → `env.mounts.*`
- **Prod (Docker):** `/usr/src/app/data`, `/usr/src/app/media`

## See Also

- `foundations.md` - Shared components (Player, WebSocket, logging)
- Domain files for app-specific context
- `cli-tools.md` - CLI tool reference
```

**Step 2: Verify file created**

Run: `head -20 docs/ai-context/architecture.md`

Expected: Shows markdown header and structure

**Step 3: Commit**

```bash
git add docs/ai-context/architecture.md
git commit -m "docs: add architecture.md ai-context"
```

---

## Task 4: Write foundations.md

**Files:**
- Create: `docs/ai-context/foundations.md`

**Step 1: Create foundations.md with full content**

Write the following content to `docs/ai-context/foundations.md`:

```markdown
# Foundations Context

Shared components and services used across multiple apps.

## Player.jsx

**Location:** `frontend/src/modules/Player/`

**Purpose:** Media playback system - video, audio, streaming content.

**Key Features:**
- Shaka Player integration for streaming
- Plex media playback
- Playback state management
- Event callbacks (onPlay, onPause, onEnd)
- Resilience/error recovery

**Backend Dependencies:**
- `routers/media.mjs` - Media endpoints
- `lib/plex.mjs` - Plex API integration
- `routers/plexProxy.mjs` - Plex stream proxy

**Usage:**
```jsx
import Player from '../modules/Player/Player';

<Player
  src={mediaUrl}
  onEnded={handleNext}
  autoPlay={true}
/>
```

**Used By:** TVApp, FitnessApp, OfficeApp

---

## WebSocket / MessageBus

**Location:**
- Backend: `backend/routers/websocket.mjs`
- Frontend: `frontend/src/lib/` or direct WebSocket

**Purpose:** Real-time bidirectional communication.

**Message Types:**
- Fitness updates (heart rate, zones, session state)
- Media control commands
- Home automation events
- Log forwarding

**Backend Pattern:**
```javascript
// Broadcasting
wss.clients.forEach(client => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type: 'fitness.update', data }));
  }
});
```

**Frontend Pattern:**
```javascript
const ws = new WebSocket(`ws://${host}:${port}`);
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  // Handle message by type
};
```

**Used By:** All apps for real-time updates

---

## ContentScroller

**Location:** `frontend/src/modules/ContentScroller/`

**Purpose:** Scrolling content display with configurable behavior.

**Key Features:**
- Horizontal/vertical scrolling
- Auto-scroll with configurable speed
- Content item rendering
- Navigation controls

**Used By:** TVApp, OfficeApp

---

## DaylightLogger

**Location:**
- Backend: `backend/lib/logging/`
- Frontend: `frontend/src/lib/logging/`

**Purpose:** Structured event-based logging with WebSocket transport.

**Pattern:**
```javascript
import { getLogger } from './lib/logging';

const logger = getLogger('fitness');

// Event-based (preferred)
logger.info('session.started', { sessionId, participants });

// Error logging
logger.error('device.connection_failed', { deviceId, error: err.message });
```

**Key Concepts:**
- Event names, not message strings
- Contextual metadata objects
- Frontend logs forward to backend via WebSocket
- All logs tee to `dev.log` in development

**Log Analysis:**
```bash
# View recent logs
tail -200 dev.log

# Filter by event pattern
tail -500 dev.log | grep "fitness."

# Pretty print JSON
tail -50 dev.log | jq '.'
```

---

## API Client (lib/api.mjs)

**Location:** `frontend/src/lib/api.mjs`

**Purpose:** HTTP client for backend communication.

**Pattern:**
```javascript
import api from '../lib/api';

// GET request
const sessions = await api.get('/fitness/sessions');

// POST request
const result = await api.post('/fitness/session/start', {
  participants: ['user1', 'user2']
});

// With query params
const data = await api.get('/media/search', { q: 'query' });
```

**Error Handling:** Throws on non-2xx responses, catch and handle appropriately.

---

## Auth / UserService

**Location:** `backend/lib/config/UserService.mjs`

**Purpose:** User identity and household context.

**Key Concepts:**
- **Household:** Container for users, configs, data
- **User/Profile:** Persistent identity (`userId` like "kckern")
- **Entity:** Session participation instance (for fitness)

**Pattern:**
```javascript
import { UserService } from './lib/config/UserService.mjs';

const user = await UserService.getUser(householdId, userId);
const allUsers = await UserService.getUsers(householdId);
```

---

## exe.mjs

**Location:** `backend/routers/exe.mjs`

**Purpose:** Command execution router - runs system commands safely.

**Key Features:**
- Executes predefined command types
- Parameter validation
- Output streaming
- Timeout handling

**Safety:** Only exposes specific command patterns, not arbitrary shell execution.

---

## Home Assistant Integration

**Location:** `backend/lib/homeassistant.mjs`

**Purpose:** Smart home control via Home Assistant API.

**Key Features:**
- Entity state queries
- Service calls (turn on/off, set values)
- Event subscription
- Light/switch/sensor control

**Pattern:**
```javascript
import { HomeAssistant } from './lib/homeassistant.mjs';

// Get entity state
const state = await HomeAssistant.getState('light.living_room');

// Call service
await HomeAssistant.callService('light', 'turn_on', {
  entity_id: 'light.living_room',
  brightness: 255
});
```

**Used By:** HomeApp, OfficeApp, FitnessApp (ambient lighting)

---

## io.mjs

**Location:** `backend/lib/io.mjs`

**Purpose:** YAML data file access with path resolution.

**Status:** Legacy - prefer ConfigService for config reads.

**Pattern:**
```javascript
import { readYaml, writeYaml, pathFor } from './lib/io.mjs';

// Read YAML file
const data = await readYaml(pathFor('households', hid, 'apps', 'fitness', 'config.yml'));

// Write YAML file
await writeYaml(path, data);
```

**Note:** When writing files, use SSH if on macOS due to mount permission issues.
```

**Step 2: Verify file created**

Run: `wc -l docs/ai-context/foundations.md`

Expected: Shows line count (should be ~180+ lines)

**Step 3: Commit**

```bash
git add docs/ai-context/foundations.md
git commit -m "docs: add foundations.md ai-context"
```

---

## Task 5: Write fitness.md

**Files:**
- Create: `docs/ai-context/fitness.md`

**Step 1: Create fitness.md with full content**

Write the following content to `docs/ai-context/fitness.md`:

```markdown
# Fitness Context

## Purpose

Heart rate-based fitness tracking with gamification. Users wear heart rate monitors, earn coins based on zone intensity, and video playback is governed by participation requirements.

## Key Concepts

| Term | Definition |
|------|------------|
| **Session** | A workout period with participants, devices, and timeline |
| **Profile** | Persistent user identity (e.g., "kckern") |
| **Entity** | A participation instance in a session - allows same profile to rejoin |
| **Zone** | Heart rate intensity level (cool, active, warm, hot, fire) |
| **TreasureBox** | Coin accumulation system - higher zones earn more coins |
| **Governance** | Policy engine that locks video until requirements met |
| **Ledger** | Device-to-participant assignment tracking |
| **Roster** | Current session participants with their states |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| FitnessContext | `context/FitnessContext.jsx` | FitnessApp internal |
| Fitness modules | `modules/Fitness/*` | FitnessApp |
| useFitness hooks | `hooks/fitness/*` | FitnessApp |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Player | `modules/Player/` | Video playback |
| ContentScroller | `modules/ContentScroller/` | Content display |
| WebSocket | foundations | Real-time HR data |
| DaylightLogger | foundations | Event logging |

## File Locations

### Frontend
- `frontend/src/Apps/FitnessApp.jsx` - Main app entry
- `frontend/src/modules/Fitness/` - UI components (36 files)
- `frontend/src/hooks/fitness/` - Domain hooks
  - `FitnessSession.js` - Session management
  - `TreasureBox.js` - Coin accumulation
  - `GovernanceEngine.js` - Policy enforcement
  - `ParticipantRoster.js` - Participant tracking
  - `DeviceManager.js` - Device management
- `frontend/src/context/FitnessContext.jsx` - State management

### Backend
- `backend/routers/fitness.mjs` - API endpoints (~45KB)
- `backend/lib/fitsync.mjs` - Fitness data sync

### Config
- `data/households/{hid}/apps/fitness/config.yml`
  - `governance.policies` - Video lock policies
  - `governance.grace_period_seconds` - Time before enforcement
  - `treasure_box.zones` - Zone definitions with coin rates
  - `devices` - Heart rate monitor definitions

## Identifier Rules

**CRITICAL:** Always use `userId` as dictionary keys, never `name`.

```javascript
// ✅ CORRECT
const userZoneMap = {};
roster.forEach(entry => {
  userZoneMap[entry.userId] = entry.zoneId;
});

// ❌ WRONG - names are not unique, case-sensitive
const userZoneMap = {};
roster.forEach(entry => {
  userZoneMap[entry.name] = entry.zoneId;
});
```

| Identifier | Format | Example | Use For |
|------------|--------|---------|---------|
| userId | lowercase string | "kckern", "milo" | Dictionary keys, lookups |
| entityId | entity-{ts}-{hash} | "entity-1735689600000-abc" | Session participation instance |
| deviceId | string | "42" | Physical device reference |
| name | any case string | "KC Kern" | Display ONLY |

## Common Tasks

- **Debug governance not triggering:** Check `dev.log` for `governance.evaluate` events, verify `userZoneMap` keys match `activeParticipants`
- **Add new zone:** Update config YAML `treasure_box.zones`, ensure `zoneRankMap` is rebuilt
- **Fix coin accumulation:** Check TreasureBox.js `processTick`, verify zone lookup uses userId
- **Session restart issues:** Check entity ID generation, grace period transfer logic

## Related Docs

- `docs/design/session-entity-justification.md`
- `docs/design/fitness-identifier-contract.md`
- `docs/postmortem-governance-entityid-failure.md`
```

**Step 2: Verify file created**

Run: `head -30 docs/ai-context/fitness.md`

Expected: Shows markdown header and purpose

**Step 3: Commit**

```bash
git add docs/ai-context/fitness.md
git commit -m "docs: add fitness.md ai-context"
```

---

## Task 6: Write home-office.md

**Files:**
- Create: `docs/ai-context/home-office.md`

**Step 1: Create home-office.md with full content**

Write the following content to `docs/ai-context/home-office.md`:

```markdown
# Home/Office Context

## Purpose

Dashboard applications for home automation control and office productivity. Includes smart home integration, ambient controls, piano/MIDI, and widget-based interfaces.

## Key Concepts

| Term | Definition |
|------|------------|
| **Widget** | Self-contained UI component displaying specific data/control |
| **Ambient** | Background elements (lighting, music, atmosphere) |
| **Home Assistant** | Smart home platform integration |
| **MIDI** | Musical instrument digital interface for piano |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Piano module | `modules/Piano/` | OfficeApp |
| Finance widgets | `modules/Finance/` | OfficeApp, FinanceApp |
| Weather module | `modules/Weather/` | OfficeApp, HomeApp |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Home Assistant | foundations | Smart home control |
| Player | foundations | Background audio |
| ContentScroller | foundations | Widget scrolling |
| Finance widgets | finance domain | Budget display |

## File Locations

### Frontend
- `frontend/src/Apps/OfficeApp.jsx` - Office dashboard (~12KB)
- `frontend/src/Apps/HomeApp.jsx` - Home automation entry
- `frontend/src/modules/Piano/` - MIDI piano components
- `frontend/src/modules/Weather/` - Weather display
- `frontend/src/modules/Entropy/` - Randomization display

### Backend
- `backend/routers/home.mjs` - Home API endpoints
- `backend/lib/homeassistant.mjs` - Home Assistant integration

### Config
- `data/households/{hid}/apps/home/config.yml`
- `data/households/{hid}/apps/office/config.yml`

## Piano / MIDI Integration

**Location:** `frontend/src/modules/Piano/`

**Features:**
- MIDI keyboard input
- Chord detection
- Staff notation display
- Key signature detection

**Related Docs:**
- `docs/plans/2026-01-03-piano-chord-staff-design.md`
- `docs/plans/2026-01-03-key-detection-design.md`

## Home Assistant Integration

Uses foundation `homeassistant.mjs` for:
- Light control (brightness, color)
- Switch toggling
- Sensor reading
- Scene activation

## Common Tasks

- **Add new widget to Office:** Create component in `modules/`, import in `OfficeApp.jsx`
- **Control HA entity:** Use `HomeAssistant.callService()` from backend lib
- **Debug MIDI:** Check browser console for MIDI events, verify device permissions
- **Ambient lighting:** Uses fitness zones to control colors via HA
```

**Step 2: Commit**

```bash
git add docs/ai-context/home-office.md
git commit -m "docs: add home-office.md ai-context"
```

---

## Task 7: Write tv.md

**Files:**
- Create: `docs/ai-context/tv.md`

**Step 1: Create tv.md with full content**

Write the following content to `docs/ai-context/tv.md`:

```markdown
# TV Context

## Purpose

Media browsing and playback interface. Integrates with Plex for library access, manages playlists/stories, and provides TV-optimized navigation.

## Key Concepts

| Term | Definition |
|------|------------|
| **Plex** | Media server providing library, metadata, streaming |
| **Story** | Curated playlist/sequence of media items |
| **Season View** | Episode grid for TV series |
| **Menu** | Hierarchical navigation system |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Menu module | `modules/Menu/` | TVApp, other apps |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Player | foundations | Video playback |
| ContentScroller | foundations | Content browsing |
| Plex lib | backend | Media library access |

## File Locations

### Frontend
- `frontend/src/Apps/TVApp.jsx` - Main TV interface (~5KB)
- `frontend/src/modules/Menu/` - Navigation menus
- `frontend/src/modules/Player/` - Media playback

### Backend
- `backend/routers/media.mjs` - Media API (~39KB)
- `backend/routers/plexProxy.mjs` - Plex stream proxy
- `backend/lib/plex.mjs` - Plex API integration (~36KB)
- `backend/story/` - Story/playlist management

### Config
- `data/households/{hid}/apps/tv/config.yml`

## Plex Integration

**Backend:** `lib/plex.mjs`

**Key Operations:**
- Library browsing (movies, shows, music)
- Metadata retrieval
- Stream URL generation
- Watch status tracking

**Pattern:**
```javascript
import { Plex } from './lib/plex.mjs';

const libraries = await Plex.getLibraries();
const items = await Plex.getLibraryItems(libraryId);
const streamUrl = Plex.getStreamUrl(itemKey);
```

## Menu Navigation

**Location:** `modules/Menu/`

**Features:**
- Keyboard navigation (arrow keys, enter, back)
- Nested menu support
- Selection persistence
- Focus management

**Related Docs:**
- `docs/design/tv-menu-navigation-refactor.md`
- `docs/bugs/nested-menu-keyboard-handler.md`

## Common Tasks

- **Add media source:** Update Plex library config, verify lib/plex.mjs connection
- **Debug playback:** Check Player component, verify stream URL, check plexProxy
- **Menu navigation issues:** Check Menu module keyboard handlers
- **Story/playlist:** Work in `backend/story/` directory
```

**Step 2: Commit**

```bash
git add docs/ai-context/tv.md
git commit -m "docs: add tv.md ai-context"
```

---

## Task 8: Write finance.md

**Files:**
- Create: `docs/ai-context/finance.md`

**Step 1: Create finance.md with full content**

Write the following content to `docs/ai-context/finance.md`:

```markdown
# Finance Context

## Purpose

Financial tracking and budgeting. Integrates with Buxfer for transaction data, displays budgets, and syncs payroll information.

## Key Concepts

| Term | Definition |
|------|------------|
| **Buxfer** | External finance API for transactions/budgets |
| **Payroll** | Salary/income tracking and sync |
| **Budget** | Spending category with limits |
| **Transaction** | Individual financial entry |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Finance module | `modules/Finance/` | FinanceApp, OfficeApp |
| Finances module | `modules/Finances/` | FinanceApp |
| Finance widgets | `modules/Finance/` | OfficeApp (embedded) |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Buxfer lib | backend | Transaction data |
| API client | foundations | HTTP requests |

## File Locations

### Frontend
- `frontend/src/Apps/FinanceApp.jsx` - Main finance dashboard (~9KB)
- `frontend/src/modules/Finance/` - Shared finance components
- `frontend/src/modules/Finances/` - Finance-specific views

### Backend
- `backend/lib/buxfer.mjs` - Buxfer API integration (~10KB)
- `backend/lib/budget.mjs` - Budget calculations (~11KB)
- `backend/routers/cron.mjs` - Payroll sync scheduled task

### Config
- `data/households/{hid}/apps/finance/config.yml`
- Config maps payroll accounts, budget categories

## Buxfer Integration

**Backend:** `lib/buxfer.mjs`

**Key Operations:**
- Fetch transactions by date range
- Get budget status
- Account balances

**Authentication:** Uses credentials from config/secrets.

## Payroll Sync

**Location:** `backend/routers/cron.mjs`

**Purpose:** Syncs payroll data on schedule.

**Related:** Recent commits added payroll sync test infrastructure.

## Common Tasks

- **Debug transaction fetch:** Check Buxfer credentials, verify lib/buxfer.mjs connection
- **Update budget display:** Work in `modules/Finance/` or `modules/Finances/`
- **Embed in OfficeApp:** Import Finance widgets into OfficeApp.jsx
- **Payroll sync issues:** Check cron.mjs, verify payroll config mapping
```

**Step 2: Commit**

```bash
git add docs/ai-context/finance.md
git commit -m "docs: add finance.md ai-context"
```

---

## Task 9: Write bots.md

**Files:**
- Create: `docs/ai-context/bots.md`

**Step 1: Create bots.md with full content**

Write the following content to `docs/ai-context/bots.md`:

```markdown
# Bots Context

## Purpose

Chatbot framework for conversational interfaces. Includes journalist (lifelog), nutribot (nutrition), and extensible bot architecture.

## Key Concepts

| Term | Definition |
|------|------------|
| **Bot** | Conversational agent with specific domain focus |
| **Adapter** | Protocol translator (HTTP, Canvas, Telegram) |
| **Message Builder** | Formats bot responses for different platforms |
| **ConfigProvider** | Manages bot-specific configuration |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Bot framework | `chatbots/` | All bots |
| Journalist bot | `chatbots/bots/journalist/` | LifelogApp |
| Nutribot | `chatbots/bots/nutribot/` | HealthApp |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| AI/GPT lib | `lib/ai/`, `lib/gpt.mjs` | LLM integration |
| Lifelog extractors | `lib/lifelog-extractors/` | Data extraction |
| API client | foundations | External services |

## File Locations

### Backend
- `backend/chatbots/` - Bot framework root
  - `bots/journalist/` - Lifelog/journaling bot
  - `bots/nutribot/` - Nutrition tracking bot
  - `adapters/` - HTTP, Canvas adapters
  - `_lib/config/` - Bot configuration infrastructure
- `backend/routers/journalist.mjs` - Journalist API endpoints
- `backend/lib/lifelog-extractors/` - Data extraction modules (19 files)
- `backend/lib/gpt.mjs` - GPT/LLM integration

### Frontend
- `frontend/src/Apps/LifelogApp.jsx` - Lifelog interface
- `frontend/src/Apps/HealthApp.jsx` - Health/nutrition interface

### Config
- `data/households/{hid}/apps/lifelog/config.yml`
- `data/households/{hid}/apps/health/config.yml`

## Bot Architecture

**Pattern:** Adapter-based architecture

```
User Input → Adapter → Bot Logic → Message Builder → Adapter → Response
```

**Adapters:**
- HTTP adapter for web requests
- Canvas adapter for rich displays
- Telegram adapter for messaging

**Bots extend base class:**
```javascript
class JournalistBot extends BaseBot {
  async handleMessage(input, context) {
    // Process input, return response
  }
}
```

## Journalist Bot (Lifelog)

**Purpose:** Daily journaling, life event tracking, debrief conversations.

**Features:**
- Daily entry prompts
- Gratitude tracking
- Event extraction from conversation
- Context-aware follow-ups

**Related Docs:**
- `docs/bugs/change-subject-loses-debrief-context.md`
- `docs/design/lifelog-extractors.md`

## Nutribot

**Purpose:** Nutrition tracking, meal logging, health goals.

**Related Docs:**
- `docs/design/nutrition-goals-source-of-truth.md`
- `docs/ops/nutribot-data-migration.md`

## Common Tasks

- **Add new bot:** Create in `chatbots/bots/`, register adapter
- **Modify response format:** Update message builder
- **Add data extractor:** Create in `lib/lifelog-extractors/`
- **Debug conversation:** Check bot logs, verify context passing
```

**Step 2: Commit**

```bash
git add docs/ai-context/bots.md
git commit -m "docs: add bots.md ai-context"
```

---

## Task 10: Write cli-tools.md

**Files:**
- Create: `docs/ai-context/cli-tools.md`

**Step 1: Create cli-tools.md with full content**

Write the following content to `docs/ai-context/cli-tools.md`:

```markdown
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
```

**Step 2: Commit**

```bash
git add docs/ai-context/cli-tools.md
git commit -m "docs: add cli-tools.md ai-context"
```

---

## Task 11: Write testing.md

**Files:**
- Create: `docs/ai-context/testing.md`

**Step 1: Create testing.md with full content**

Write the following content to `docs/ai-context/testing.md`:

```markdown
# Testing Context

## Test Infrastructure

### Test Types

| Type | Tool | Location | Command |
|------|------|----------|---------|
| Smoke | Playwright | `tests/smoke/` | `npm run test:smoke` |
| Assembly | Jest/Node | `tests/assembly/` | `npm run test:assembly` |
| E2E | Playwright | `tests/e2e/` | `npx playwright test` |

### Running Tests

```bash
# Smoke tests
npm run test:smoke

# Assembly tests
npm run test:assembly

# E2E tests (requires dev server running)
npx playwright test

# Specific test file
npx playwright test tests/e2e/specific.spec.js

# With headed browser (visible)
npx playwright test --headed
```

### Test Configuration

- `jest.config.js` - Jest configuration
- `playwright.config.js` - Playwright configuration (if exists)

### Test Context Utilities

Located in test setup files, provides:
- Test household data
- Mock services
- Fixture loading

## Test Household

**Location:** `data/households/test/` (if configured)

**Purpose:** Isolated data for testing without affecting production.

**Structure:**
```
data/households/test/
├── apps/
│   ├── fitness/config.yml
│   └── ...
└── users/
    ├── test-user-1.yml
    └── ...
```

## Writing Tests

### Playwright E2E Pattern

```javascript
import { test, expect } from '@playwright/test';

test('description', async ({ page }) => {
  await page.goto('/app');
  await page.click('[data-testid="button"]');
  await expect(page.locator('.result')).toBeVisible();
});
```

### Jest Unit Pattern

```javascript
import { functionToTest } from '../src/module';

describe('Module', () => {
  test('does something', () => {
    const result = functionToTest(input);
    expect(result).toBe(expected);
  });
});
```

## Related Docs

- `docs/plans/2026-01-04-testing-strategy-design.md`
- `docs/plans/2026-01-04-testing-infrastructure.md`
- `docs/HARVESTER_TESTS_QUICKSTART.md`
```

**Step 2: Commit**

```bash
git add docs/ai-context/testing.md
git commit -m "docs: add testing.md ai-context"
```

---

## Task 12: Refactor CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Read current CLAUDE.md**

Read `CLAUDE.md` to understand current content.

**Step 2: Rewrite CLAUDE.md with generic content and navigation**

Replace entire contents with:

```markdown
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
ssh {user}@{hosts.prod}

# View prod logs
ssh {user}@{hosts.prod} 'docker logs {docker.container} -f'
```

### Mount Permissions

When writing data files from macOS, use SSH due to mount permission issues:
```bash
ssh {user}@{hosts.prod} 'echo "content" > /path/to/file'
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
```

**Step 3: Verify CLAUDE.md has no hard-coded values**

Run: `grep -E "homeserver|localhost:[0-9]|/Users/" CLAUDE.md`

Expected: No output (no matches)

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "refactor: make CLAUDE.md generic with ai-context navigation"
```

---

## Task 13: Update .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Check if settings.local.json is already ignored**

Run: `git check-ignore -v .claude/settings.local.json`

**Step 2: If not ignored, add to .gitignore**

Add line to `.gitignore`:
```
.claude/settings.local.json
```

**Step 3: Commit if changed**

```bash
git add .gitignore
git commit -m "chore: ensure settings.local.json is gitignored"
```

---

## Task 14: Create CLAUDE.local.example.md

**Files:**
- Create: `CLAUDE.local.example.md`

**Step 1: Create example settings documentation**

Write to `CLAUDE.local.example.md`:

```markdown
# Local Settings Example

Copy this structure to `.claude/settings.local.json` under an `env` key:

```json
{
  "permissions": { ... },
  "env": {
    "mounts": {
      "data": "/path/to/your/data/mount",
      "media": "/path/to/your/media/mount"
    },
    "hosts": {
      "prod": "your-production-hostname",
      "fitness": "your-fitness-client-hostname"
    },
    "ports": {
      "frontend": 3111,
      "backend": 3112,
      "api": 3119
    },
    "docker": {
      "container": "daylight-station"
    },
    "ssh": {
      "user": "your-username"
    },
    "clickup": {
      "listIds": {
        "tvView": "your-list-id",
        "finances": "your-list-id",
        "homeOffice": "your-list-id",
        "journalist": "your-list-id",
        "nutribot": "your-list-id",
        "fitness": "your-list-id",
        "admin": "your-list-id"
      }
    }
  }
}
```

## Required Values

| Key | Description |
|-----|-------------|
| `mounts.data` | Path to data directory with YAML files |
| `mounts.media` | Path to media directory |
| `hosts.prod` | Production server hostname |
| `ports.frontend` | Frontend dev server port |
| `ports.backend` | Backend HTTP/WS port |
| `docker.container` | Docker container name |
```

**Step 2: Commit**

```bash
git add CLAUDE.local.example.md
git commit -m "docs: add CLAUDE.local.example.md for settings reference"
```

---

## Task 15: Final Verification

**Step 1: List all ai-context files**

Run: `ls -la docs/ai-context/`

Expected: 8 .md files + .gitkeep

**Step 2: Verify CLAUDE.md is generic**

Run: `grep -c "settings.local.json" CLAUDE.md`

Expected: At least 1 (references settings file)

Run: `grep -E "homeserver|localhost:[0-9]|/Users/" CLAUDE.md`

Expected: No output

**Step 3: Test fresh Claude context**

Start new Claude session in this directory and verify:
- CLAUDE.md loads
- Navigation table is visible
- Can read ai-context files when referenced

---

## Summary

**Files Created:**
- `docs/ai-context/architecture.md`
- `docs/ai-context/foundations.md`
- `docs/ai-context/fitness.md`
- `docs/ai-context/home-office.md`
- `docs/ai-context/tv.md`
- `docs/ai-context/finance.md`
- `docs/ai-context/bots.md`
- `docs/ai-context/cli-tools.md`
- `docs/ai-context/testing.md`
- `CLAUDE.local.example.md`

**Files Modified:**
- `.claude/settings.local.json` (add env section)
- `CLAUDE.md` (generic + navigation)
- `.gitignore` (if needed)

**Total Commits:** ~15 small, focused commits
