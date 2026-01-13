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
│           ├── users/{userId}.yml
│           └── history/
│               └── media_memory/
│                   └── plex/
│                       ├── fitness.yml   # Watch history per library
│                       ├── movies.yml
│                       └── tv.yml
└── docs/                        # Documentation
    ├── ai-context/              # Claude context files
    └── plans/                   # Implementation plans
```

## DDD Architecture (New)

The backend uses Domain-Driven Design with layered architecture:

```
backend/src/
├── 0_infrastructure/       # Bootstrap, config, scheduling
│   ├── bootstrap.mjs       # Dependency injection setup
│   └── scheduling/         # Cron/job infrastructure
├── 1_domains/              # Domain layer (entities, services, ports)
│   ├── content/            # Media content domain
│   ├── fitness/            # Fitness tracking domain
│   ├── gratitude/          # Gratitude items domain
│   ├── health/             # Health metrics domain
│   ├── lifelog/            # Lifelog extractors (15 extractors)
│   ├── messaging/          # Conversation state, notifications
│   ├── nutrition/          # Nutrition tracking domain
│   └── scheduling/         # Job scheduling domain
├── 2_adapters/             # External service adapters
│   ├── content/            # Plex, filesystem adapters
│   ├── harvester/          # 15+ data harvesters (Withings, Strava, etc.)
│   ├── messaging/          # Telegram, Gmail adapters
│   └── scheduling/         # YamlJobStore, YamlStateStore
├── 3_applications/         # Application layer (use cases)
│   ├── homebot/            # Gratitude bot (4 use cases)
│   ├── journalist/         # Lifelog bot
│   └── nutribot/           # Nutrition bot (31 use cases)
├── 4_api/                  # API layer (routers)
│   └── routers/            # Express routers
└── server.mjs              # Express server with DI wiring
```

### Key Patterns

- **Ports & Adapters:** Interfaces in `ports/`, implementations in `adapters/`
- **Dependency Injection:** Via bootstrap.mjs, containers, and server.mjs
- **Use Cases:** Single-responsibility handlers in `applications/{app}/usecases/`
- **Event Routing:** EventRouter classes route incoming events to use cases

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

**Multi-dimensional structure** (nested objects, not flat strings):

```javascript
// Path objects - access via process.env.path.*
process.env.path.data    // Data mount: YAML files, configs
process.env.path.media   // Media mount: video, audio, images
process.env.path.img     // Images subdirectory

// Service configs - access via process.env.<service>.*
process.env.plex.host    // Plex server URL
process.env.plex.port    // Plex port (optional)
```

**Cannot set directly** - use spread pattern:
```javascript
process.env = {
    ...process.env,
    path: { ...process.env.path, data: '/new/path' }
};
```

**Loaded via:** `hydrateProcessEnvFromConfigs()` in bootstrap

### Runtime Paths
- **Dev:** Paths from `.claude/settings.local.json` → `env.mounts.*`
- **Prod (Docker):** `/usr/src/app/data`, `/usr/src/app/media`

## See Also

- `foundations.md` - Shared components (Player, WebSocket, logging)
- Domain files for app-specific context
- `cli-tools.md` - CLI tool reference
