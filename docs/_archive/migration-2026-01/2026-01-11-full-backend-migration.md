# Full Backend Migration Plan

## Overview

This document defines the complete migration strategy for moving all legacy backend code from `backend/_legacy/` into the new DDD-style `backend/src/` structure. It builds on the existing content domain migration (phases 1-7) and extends to cover all remaining infrastructure, domains, adapters, and applications.

**Current Status:** Phase 1 Complete, Content Domain Complete, Phases 2-6 Pending
**Test Status:** 866 tests passing (684 unit + 142 integration + 40 assembly)
**Progress Tracker:** See [migration-status.md](./2026-01-11-migration-status.md)

**Guiding Principles:**
- Domain is heaven (pure, testable, no external deps)
- Adapter is earth (concrete, messy reality)
- Golden master testing validates migration correctness
- Legacy compatibility layer allows gradual frontend migration

**Related Documents:**
- [Backend DDD Architecture](./2026-01-10-backend-ddd-architecture.md)
- [Content Domain Phase Plans](./2026-01-10-content-domain-phase1.md through phase7)
- [API Consumer Inventory](./2026-01-10-api-consumer-inventory.md)
- [Migration Status Tracker](./2026-01-11-migration-status.md)

---

## Architecture Decisions

### Chatbots
**Decision:** Integrate with AdapterRegistry (not move as-is)

The existing chatbots framework has good structure but uses direct imports. Refactor to receive dependencies via AdapterRegistry for consistency with the new architecture.

### Message Bus
**Decision:** Unified EventBus with multiple transports

Create a single `IEventBus` port with WebSocket and MQTT as transport adapters. This provides clean abstraction while maintaining the current MQTT→WebSocket broadcast pattern.

### Webhook Server
**Decision:** Keep on separate port (3119)

Webhooks remain isolated on port 3119 for security. External services (Telegram) connect to this port only, not the main application port.

### Lib Services Migration
**Decision:** Prioritize by domain

Migrate adapters incrementally as their consuming domain is migrated. No big-bang adapter migration.

### Scheduling
**Decision:** Keep TaskRegistry pattern

Move existing TaskRegistry to `0_infrastructure/scheduling/`. Proven system that works.

### Logging
**Decision:** Move as-is

Relocate to `0_infrastructure/logging/` with no changes. Already well-structured.

---

## Legacy Inventory

### Infrastructure Components
| Component | Location | Target |
|-----------|----------|--------|
| Express app setup | `index.js` | `src/server.mjs` |
| Config loading | `lib/config/` | `0_infrastructure/config/` |
| Logging | `lib/logging/` | `0_infrastructure/logging/` |
| MQTT subscriber | `lib/mqtt.mjs` | `0_infrastructure/eventbus/adapters/` |
| WebSocket server | `routers/websocket.mjs` | `0_infrastructure/eventbus/adapters/` |
| Cron scheduler | `routers/cron.mjs` | `0_infrastructure/scheduling/` |

### External API Adapters (lib/)
| Adapter | Domain | Priority |
|---------|--------|----------|
| plex.mjs | Content | Phase 3 (content) |
| buxfer.mjs | Finance | Phase 3b |
| garmin.mjs, strava.mjs | Fitness | Phase 3a |
| lastfm.mjs, letterboxd.mjs | Lifelog | Phase 3e |
| gcal.mjs, gmail.mjs | Calendar | Phase 3e |
| withings.mjs | Health | Phase 3e |
| homeassistant.mjs | Home | Phase 3a (fitness LED) |
| weather.mjs | Home | Phase 3e |
| github.mjs, clickup.mjs, todoist.mjs | Productivity | Phase 3e |
| gpt.mjs | AI | Phase 3d |

### Domain Services (lib/)
| Service | Target Domain |
|---------|---------------|
| budget.mjs, budgetlib/ | Finance |
| health.mjs, fitsync.mjs | Fitness |
| mediaMemory.mjs | Content (WatchState) |
| shopping.mjs | Home |
| entropy.mjs | Core utilities |

### Routers
| Router | Target | Notes |
|--------|--------|-------|
| fitness.mjs | `4_api/routers/fitness.mjs` | Major domain - see Phase 2a |
| media.mjs | Merge with content | Legacy compat |
| health.mjs | `4_api/routers/health.mjs` | Health metrics |
| cron.mjs | `4_api/routers/admin/cron.mjs` | Admin endpoints |
| fetch.mjs | `4_api/routers/data.mjs` | YAML data serving |
| websocket.mjs | EventBus | Move to infrastructure |

### Chatbots
Already DDD-structured. Migrate to `3_applications/` with registry integration.

### Jobs
| Job | Target Application |
|-----|--------------------|
| events.mjs | home |
| nav.mjs | home |
| weight.mjs | fitness |
| finance/budget.mjs | finance |
| finance/payroll.mjs | finance |

---

## Phase 1: Infrastructure Migration ✅ COMPLETE

**Summary:**
- 1a Logging: ✅ Migrated (legacy re-exports from src/)
- 1b Config: ⏭️ Skipped (DI pattern - no import needed)
- 1c Scheduling: ⏭️ Skipped (stays in legacy until Phase 5)
- 1d EventBus: ✅ Already migrated (strangler fig pattern)

### Phase 1a: Logging ✅

Move `_legacy/lib/logging/` → `src/0_infrastructure/logging/`:

```
src/0_infrastructure/logging/
├── dispatcher.js          # Central log dispatcher
├── logger.js              # Logger factory
├── config.js              # Logging configuration
├── ingestion.js           # Frontend log ingestion
├── utils.js               # Utilities
└── transports/
    ├── index.js
    ├── ConsoleTransport.js
    ├── FileTransport.js
    └── LogglyTransport.js
```

**Golden Master:** Capture current log output format and structure.

### Phase 1b: Config ⏭️ SKIPPED

**Decision:** Config migration is NOT needed.

The new DDD architecture uses dependency injection - `bootstrap.mjs` receives config as parameters rather than importing it. This means:
- Config system can stay in `_legacy/lib/config/`
- No re-export shims needed
- Entry point (`_legacy/index.js`) loads config and passes to new code
- Config migrates only when entry point (`server.mjs`) migrates in Phase 5

**Rationale:** The new src/ code doesn't import config directly:
```javascript
// bootstrap.mjs receives config via parameters:
export function createFitnessServices(config) {
  const { dataRoot, mediaRoot, defaultHouseholdId, ... } = config;
}
```

This is correct DDD - infrastructure doesn't depend on how config is loaded.

### Phase 1c: Scheduling ⏭️ SKIPPED

**Decision:** Scheduling migration is NOT needed at this time.

Similar to config, the scheduling system is self-contained in `_legacy/`:
- `_legacy/lib/cron/TaskRegistry.mjs` - loads job definitions from YAML
- `_legacy/routers/cron.mjs` - runs the cron loop and exposes HTTP endpoints

Nothing in `src/` imports from scheduling infrastructure. The stub `TaskRegistry.mjs` in `src/0_infrastructure/scheduling/` is a different design (in-memory task registration) that was created for future use but is not required for migration.

**Rationale:** The cron router is an entry point that:
1. Loads job definitions via TaskRegistry
2. Runs the scheduling loop (`cronContinuous`)
3. Exposes HTTP endpoints (`/status`, `/run/:jobId`)

This stays in legacy until Phase 5 when the main `server.mjs` entry point migrates.

**Dependencies:** None until Phase 5

### Phase 1d: EventBus ✅ COMPLETE

**Status:** Already migrated via strangler fig pattern.

The legacy `routers/websocket.mjs` is a re-export shim that delegates to the new `WebSocketEventBus`:
```javascript
import { createEventBus, getEventBus, broadcastEvent, restartEventBus }
  from '../../src/0_infrastructure/bootstrap.mjs';
```

The canonical implementation lives at:
- `src/0_infrastructure/eventbus/WebSocketEventBus.mjs` - Full implementation
- `src/0_infrastructure/eventbus/index.mjs` - Public exports
- `src/0_infrastructure/bootstrap.mjs` - Factory functions

MQTT adapter exists but is not yet integrated (planned for Phase 3).

---

**Original Plan (for reference):**

Create unified event bus:

```
src/0_infrastructure/eventbus/
├── index.mjs              # Public API
├── IEventBus.mjs          # Port interface
├── EventBusImpl.mjs       # Core implementation
└── adapters/
    ├── WebSocketAdapter.mjs
    └── MqttAdapter.mjs
```

**Port Interface:**
```javascript
// IEventBus.mjs
export const IEventBus = {
  publish(topic, payload) {},
  subscribe(topic, handler) {},
  unsubscribe(topic, handler) {}
};
```

**Dependencies:** Logging

---

## Phase 2: Domains Migration

### Phase 2a: Fitness Domain

Decompose `_legacy/routers/fitness.mjs`:

```
src/1_domains/fitness/
├── entities/
│   ├── Session.mjs        # Session data model
│   ├── Participant.mjs    # Person in session
│   └── Zone.mjs           # Heart rate zone
├── services/
│   ├── SessionService.mjs # Session CRUD, listing
│   └── ZoneService.mjs    # Zone resolution logic
├── ports/
│   ├── ISessionStore.mjs
│   ├── IZoneLedController.mjs
│   └── IVoiceMemoTranscriber.mjs
└── index.mjs
```

**Key Entities:**
- `Session`: id, startTime, endTime, roster, timeline, snapshots
- `Participant`: name, hrDeviceId, isGuest, isPrimary
- `Zone`: cool, active, warm, hot, fire (with priority ordering)

**Golden Master Tests:**
- Session list by date
- Session detail retrieval
- Zone resolution (ZONE_PRIORITY logic)
- Timeline series encoding/decoding

### Phase 2b: Finance Domain

Decompose `_legacy/lib/budget.mjs`, `budgetlib/`, `buxfer.mjs`:

```
src/1_domains/finance/
├── entities/
│   ├── Budget.mjs
│   ├── Transaction.mjs
│   ├── Account.mjs
│   └── Mortgage.mjs
├── services/
│   ├── BudgetService.mjs
│   └── MortgageService.mjs
├── ports/
│   └── ITransactionSource.mjs
└── index.mjs
```

### Phase 2c: Messaging Domain

Extract from `_legacy/chatbots/domain/`:

```
src/1_domains/messaging/
├── entities/
│   ├── Conversation.mjs
│   └── Message.mjs
├── ports/
│   └── IMessagingPlatform.mjs
└── index.mjs
```

### Phase 2d: Nutrition & Journaling

Extract from chatbots:

```
src/1_domains/nutrition/
├── entities/
│   ├── FoodLog.mjs
│   └── Meal.mjs
└── index.mjs

src/1_domains/journaling/
├── entities/
│   └── JournalEntry.mjs
└── index.mjs
```

---

## Phase 3: Adapters Migration

### Phase 3a: Fitness Adapters

```
src/2_adapters/fitness/
├── persistence/
│   └── YamlSessionStore.mjs    # Implements ISessionStore
├── home-automation/
│   └── ZoneLedController.mjs   # Implements IZoneLedController
└── ai/
    └── WhisperTranscriber.mjs  # Implements IVoiceMemoTranscriber
```

**YamlSessionStore:** From fitness router session CRUD logic
**ZoneLedController:** From zone_led endpoint (HA scene activation)
**WhisperTranscriber:** From voice_memo endpoint (OpenAI Whisper)

### Phase 3b: Finance Adapters

```
src/2_adapters/finance/
└── buxfer/
    └── BuxferAdapter.mjs       # Implements ITransactionSource
```

From `_legacy/lib/buxfer.mjs`

### Phase 3c: Messaging Adapters

Move from `_legacy/chatbots/infrastructure/messaging/`:

```
src/2_adapters/messaging/
└── telegram/
    └── TelegramGateway.mjs     # Implements IMessagingPlatform
```

### Phase 3d: AI Adapters

Move from `_legacy/chatbots/infrastructure/ai/`:

```
src/2_adapters/ai/
└── openai/
    └── OpenAIGateway.mjs       # Implements IAIProvider
```

### Phase 3e: External API Adapters (As Needed)

Migrate when consuming domain/job is migrated:

| Adapter | When |
|---------|------|
| garmin/, strava/ | Fitness jobs migration |
| lastfm/, letterboxd/ | Lifelog harvester migration |
| gcal/, gmail/ | Calendar integration |
| withings/ | Health metrics |
| weather/ | Home app |
| github/, clickup/, todoist/ | Productivity features |

---

## Phase 4: Applications Migration

### Phase 4a: Chatbots Integration

Migrate `_legacy/chatbots/` → `src/3_applications/`:

```
src/3_applications/
├── nutribot/
│   ├── bot/
│   │   ├── handlers/
│   │   ├── NutribotContainer.mjs  # Refactor for AdapterRegistry
│   │   └── ...
│   ├── jobs/
│   └── server.mjs
├── journalist/
│   ├── bot/
│   └── server.mjs
└── homebot/
    ├── bot/
    └── server.mjs
```

**Key Change:** Containers receive dependencies from AdapterRegistry:

```javascript
// Before (direct import)
import { TelegramGateway } from '../infrastructure/messaging/TelegramGateway.mjs';
const gateway = new TelegramGateway(config);

// After (registry injection)
export function createNutribot(registry, config) {
  const gateway = registry.messaging.get('telegram');
  return new NutribotContainer(config, { gateway, ... });
}
```

### Phase 4b: Fitness Application

```
src/3_applications/fitness/
├── FitnessApp.mjs         # Coordinates domain + adapters
└── jobs/
    ├── garmin-sync.mjs
    ├── strava-sync.mjs
    └── weight-import.mjs
```

### Phase 4c: Finance Application

```
src/3_applications/finance/
└── jobs/
    ├── budget-sync.mjs
    └── payroll.mjs
```

---

## Phase 5: API Layer & Entry Points

### Phase 5a: New Server Entry Point

Create `src/server.mjs`:

```javascript
import { createApp, createWebhookApp } from './0_infrastructure/bootstrap.mjs';
import { createAdapterRegistry } from './0_infrastructure/registry.mjs';
import { initializeLogging } from './0_infrastructure/logging/dispatcher.js';
import { initEventBus } from './0_infrastructure/eventbus/index.mjs';
import { initScheduler } from './0_infrastructure/scheduling/index.mjs';

async function main() {
  // 1. Logging
  const logger = initializeLogging(config);

  // 2. Registry
  const registry = createAdapterRegistry(config);

  // 3. EventBus (WebSocket + MQTT)
  const eventBus = initEventBus(config, { logger });

  // 4. HTTP server (port 3112)
  const app = createApp({ registry, eventBus, logger });
  app.listen(3112);

  // 5. Webhook server (port 3119 - separate for security)
  const webhookApp = createWebhookApp({ registry, logger });
  webhookApp.listen(3119);

  // 6. Scheduler
  initScheduler({ registry, logger });
}
```

### Phase 5b: Router Migration

```
src/4_api/routers/
├── content.mjs            # Already done
├── fitness.mjs            # Thin wrapper over FitnessApp
├── health.mjs             # Health metrics
├── data.mjs               # YAML data serving (from fetch.mjs)
├── admin/
│   └── cron.mjs           # Job status/trigger
└── webhooks/
    ├── nutribot.mjs
    ├── journalist.mjs
    └── homebot.mjs
```

### Phase 5c: Webhook Server

Create `src/4_api/webhook-server.mjs`:

```javascript
import express from 'express';
import cors from 'cors';

export function createWebhookApp({ registry, logger }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Mount chatbot webhooks
  app.use('/api/foodlog', createNutribotRouter(registry));
  app.use('/api/journalist', createJournalistRouter(registry));
  app.use('/api/homebot', createHomebotRouter(registry));

  return app;
}
```

### Phase 5d: Legacy Route Shim

Create `src/4_api/middleware/legacyRoutes.mjs`:

```javascript
import { Router } from 'express';

/**
 * Legacy route compatibility layer.
 * Maps old endpoint paths to new paths.
 *
 * DEPRECATION: Remove when frontend is fully migrated.
 * Monitor via /api/admin/legacy-usage
 */
export function createLegacyRoutes({ logger }) {
  const router = Router();
  const hitCounts = new Map();

  // Log every legacy route hit
  router.use((req, res, next) => {
    const key = req.path.split('/').slice(0, 2).join('/');
    hitCounts.set(key, (hitCounts.get(key) || 0) + 1);
    logger.warn('legacy.route.hit', {
      path: req.path,
      method: req.method
    });
    next();
  });

  // Content domain
  router.use('/media', redirectTo('/api/content'));
  router.use('/plex_proxy', redirectTo('/proxy/plex'));

  // Data fetching
  router.use('/data', forwardTo('/api/data'));

  // Expose metrics
  router.getHitCounts = () => Object.fromEntries(hitCounts);

  return router;
}

function redirectTo(newPath) {
  return (req, res) => res.redirect(308, `${newPath}${req.path}`);
}

function forwardTo(newPath) {
  return (req, res, next) => {
    req.url = `${newPath}${req.url}`;
    next('route');
  };
}
```

---

## Testing Strategy

### Golden Master Testing

Before migrating each component, capture legacy behavior:

```
tests/
├── golden-master/
│   ├── fitness/
│   │   ├── fixtures/
│   │   │   ├── sessions-list-2026-01-10.json
│   │   │   ├── session-detail-20260110120000.json
│   │   │   └── zone-led-scenarios.json
│   │   └── fitness.golden.test.mjs
│   ├── content/
│   │   └── ...
│   └── chatbots/
│       └── ...
```

**Test Pattern:**
```javascript
// fitness.golden.test.mjs
import { describe, it, expect } from 'vitest';
import sessionsListFixture from './fixtures/sessions-list-2026-01-10.json';

describe('Fitness API - Golden Master', () => {
  it('GET /api/fitness/sessions matches legacy response', async () => {
    const response = await fetch('/api/v2/fitness/sessions?date=2026-01-10');
    const data = await response.json();
    expect(data).toEqual(sessionsListFixture);
  });
});
```

### Contract Tests

Ensure API contracts match:
- Same endpoint paths (or documented aliases)
- Same request/response shapes
- Same error codes

### Integration Tests

Test wired-up stack:
- Registry resolves adapters correctly
- Bootstrap creates dependencies
- Domain services receive correct ports

### Migration Verification Script

Create `scripts/verify-migration.mjs`:

```javascript
// 1. Start legacy server on port 3112
// 2. Start new server on port 3113
// 3. Run identical requests to both
// 4. Compare responses
// 5. Report differences
```

---

## Phase 6: Cleanup

### 6a: Monitor Legacy Route Usage

Check `/api/admin/legacy-usage` for hit counts. Target: all routes at 0.

### 6b: Disable Legacy Routes

Set `ENABLE_LEGACY_ROUTES=false` to test without legacy compatibility.

### 6c: Delete Legacy Folder

Once all routes show 0 hits and tests pass without legacy:

```bash
rm -rf backend/_legacy/
```

### 6d: Update Documentation

- Remove legacy references from ai-context files
- Update architecture docs
- Archive this plan to `docs/_archive/`

---

## Success Criteria

Migration complete when:
- [ ] `backend/_legacy/` is empty and deleted
- [ ] All endpoints served from `backend/src/`
- [ ] No imports from `_legacy` anywhere
- [ ] Frontend fully migrated to new API paths
- [ ] All golden master tests pass
- [ ] Legacy route hit counts at 0

---

## Appendix: File Mapping Reference

| Legacy Location | New Location |
|-----------------|--------------|
| `lib/logging/` | `0_infrastructure/logging/` |
| `lib/config/` | `0_infrastructure/config/` |
| `lib/cron/` | `0_infrastructure/scheduling/` |
| `lib/mqtt.mjs` | `0_infrastructure/eventbus/adapters/MqttAdapter.mjs` |
| `routers/websocket.mjs` | `0_infrastructure/eventbus/adapters/WebSocketAdapter.mjs` |
| `lib/plex.mjs` | `2_adapters/content/media/plex/` |
| `lib/buxfer.mjs` | `2_adapters/finance/buxfer/` |
| `lib/garmin.mjs` | `2_adapters/fitness/garmin/` |
| `lib/homeassistant.mjs` | `2_adapters/home-automation/homeassistant/` |
| `lib/budget.mjs` | `1_domains/finance/services/BudgetService.mjs` |
| `lib/budgetlib/` | `1_domains/finance/services/` |
| `routers/fitness.mjs` | `4_api/routers/fitness.mjs` + domain decomposition |
| `routers/media.mjs` | Merged with content + legacy shim |
| `routers/cron.mjs` | `4_api/routers/admin/cron.mjs` |
| `routers/fetch.mjs` | `4_api/routers/data.mjs` |
| `chatbots/bots/nutribot/` | `3_applications/nutribot/bot/` |
| `chatbots/bots/journalist/` | `3_applications/journalist/bot/` |
| `chatbots/bots/homebot/` | `3_applications/homebot/bot/` |
| `jobs/finance/` | `3_applications/finance/jobs/` |
| `jobs/weight.mjs` | `3_applications/fitness/jobs/` |
| `jobs/events.mjs` | `3_applications/home/jobs/` |
| `api.mjs` | `4_api/webhook-server.mjs` |
| `index.js` | `server.mjs` |
