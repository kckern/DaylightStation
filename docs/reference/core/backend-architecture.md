# Backend Architecture

**Last Updated:** 2026-01-12
**Status:** DDD Migration Complete (95%)

---

## Overview

The backend uses Domain-Driven Design (DDD) with a layered architecture. Code is organized into numbered layers that enforce dependency rules: higher layers can import from lower layers, but not vice versa.

```
backend/
├── src/                    # New DDD architecture (313 files)
│   ├── 0_infrastructure/   # Framework, cross-cutting concerns
│   ├── 1_domains/          # Business logic (pure, no I/O)
│   ├── 2_adapters/         # External integrations
│   ├── 3_applications/     # Use cases, orchestration
│   ├── 4_api/              # HTTP routes, handlers
│   └── server.mjs          # Entry point
└── _legacy/                # Legacy code (being phased out)
```

---

## Layer Details

### 0_infrastructure/ (26 files)

Cross-cutting concerns shared across all layers.

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `config/` | Configuration loading | ConfigService.mjs |
| `logging/` | Structured logging | dispatcher.js, logger.js, transports/ |
| `eventbus/` | Real-time messaging | WebSocketEventBus.mjs, MqttAdapter.mjs |
| `scheduling/` | Cron job management | TaskRegistry.mjs |
| `routing/` | Legacy/new route toggle | RoutingConfig.mjs, ShimMetrics.mjs |
| `proxy/` | External service proxy | ProxyService.mjs |
| `utils/` | Shared utilities | Various helpers |

**Key Pattern:** `bootstrap.mjs` contains factory functions for creating all domain services with proper dependency injection.

### 1_domains/ (111 files)

Pure business logic with no external dependencies. Each domain has:
- `entities/` - Data models with validation
- `services/` - Business logic
- `ports/` - Interfaces for external dependencies

| Domain | Purpose | Entities |
|--------|---------|----------|
| `content/` | Media browsing/playback | ContentItem, WatchState |
| `fitness/` | Workout sessions | Session, Participant, Zone |
| `finance/` | Budget tracking | Budget, Transaction, Account, Mortgage |
| `messaging/` | Notifications | Message, Conversation, Notification |
| `nutrition/` | Food logging | FoodLog, NutritionEntry |
| `journaling/` | Daily journaling | JournalEntry |
| `journalist/` | Journal chatbot logic | ConversationMessage, QuizQuestion |
| `health/` | Health metrics | Aggregated health data |
| `gratitude/` | Gratitude tracking | Selection |
| `entropy/` | Random content | Entropy reader |
| `home-automation/` | Smart home control | Device states |
| `ai/` | AI abstraction | IAIGateway port |
| `lifelog/` | Activity aggregation | Lifelog entries |
| `core/` | Shared value objects | Common types |

### 2_adapters/ (76 files)

Concrete implementations that connect domains to external systems.

| Category | Adapters | Purpose |
|----------|----------|---------|
| `persistence/yaml/` | 12 stores | YAML file persistence |
| `harvester/` | 16 harvesters | External API data collection |
| `ai/` | OpenAI, Anthropic | AI completions, transcription |
| `content/` | Plex, Filesystem, Folder | Media sources |
| `home-automation/` | HomeAssistant, TV, Kiosk | Smart home |
| `hardware/` | Printer, TTS, MQTT | Physical devices |
| `messaging/` | Telegram, Gmail | Messaging platforms |
| `finance/` | Buxfer | Transaction source |
| `proxy/` | Plex, Immich, etc. | Service proxying |

**Harvester Categories:**
- `fitness/` - Garmin, Strava, Withings
- `productivity/` - Todoist, ClickUp, GitHub
- `social/` - LastFM, Reddit, Letterboxd, Goodreads, Foursquare
- `communication/` - Gmail, GCal
- `finance/` - Shopping (receipt scanning)
- `other/` - Weather, Scripture

### 3_applications/ (60 files)

Use case orchestration and complex workflows.

| Application | Purpose | Key Components |
|-------------|---------|----------------|
| `nutribot/` | Food logging chatbot | 24 use cases, NutribotContainer |
| `journalist/` | Journal chatbot | 21 use cases, JournalistContainer |
| `finance/` | Budget workflows | BudgetCompilationService, HarvestService |
| `fitness/` | Session management | VoiceMemoTranscription |

### 4_api/ (39 files)

HTTP layer - Express routers and handlers.

| Directory | Purpose |
|-----------|---------|
| `routers/` | 20+ Express routers |
| `handlers/` | Request handlers for complex endpoints |
| `middleware/` | Auth, logging, legacy shims |
| `shims/` | Legacy compatibility wrappers |

**Key Routers:**
- `/api/content`, `/api/list`, `/api/play` - Content domain
- `/api/fitness` - Fitness sessions
- `/api/finance` - Budget data
- `/api/health`, `/api/gratitude` - Health/wellness
- `/api/nutribot`, `/api/journalist` - Chatbot webhooks
- `/admin/legacy`, `/admin/shims` - Admin endpoints

---

## Entry Points

| File | Port | Purpose |
|------|------|---------|
| `src/server.mjs` | 3112 | Main application server |
| `src/4_api/webhook-server.mjs` | 3119 | Telegram webhook server |

---

## Dependency Rules

```
4_api       → can import from → 3, 2, 1, 0
3_applications → can import from → 2, 1, 0
2_adapters  → can import from → 1, 0
1_domains   → can import from → 0 (minimal)
0_infrastructure → standalone (no upward imports)
```

**Key Principle:** Domains (1_domains/) should have NO imports from adapters. They define ports (interfaces) that adapters implement.

---

## Key Patterns

### Dependency Injection

Services receive dependencies via constructor, not imports:

```javascript
// Good - DI via bootstrap.mjs
export function createFitnessServices(config) {
  const sessionStore = new YamlSessionStore(config);
  return new SessionService({ sessionStore });
}

// Bad - Direct import
import { YamlSessionStore } from '../adapters/...';
```

### Port/Adapter Pattern

Domains define interfaces (ports), adapters implement them:

```javascript
// 1_domains/fitness/ports/ISessionStore.mjs
export const ISessionStore = {
  save(session) {},
  findById(id) {},
  listByDate(date) {}
};

// 2_adapters/persistence/yaml/YamlSessionStore.mjs
export class YamlSessionStore {
  save(session) { /* YAML file I/O */ }
  findById(id) { /* YAML file I/O */ }
}
```

### Strangler Fig Migration

Legacy code is gradually replaced:

1. Create new implementation in `src/`
2. Legacy file becomes thin wrapper that delegates to new code
3. Monitor usage via `/admin/legacy` endpoint
4. Delete legacy when usage drops to 0

---

## Related Documentation

- [DDD File Map](./ddd-file-map.md) - Complete file listing with legacy mapping
- [Migration Summary](./migration-summary.md) - What was migrated and current status
