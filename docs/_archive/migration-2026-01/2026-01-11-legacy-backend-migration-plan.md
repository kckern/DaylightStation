# Legacy Backend Migration Plan

**Created:** 2026-01-11
**Status:** Draft
**Related code:** `backend/_legacy/`

## Overview

Full migration plan for consolidating `backend/_legacy/` into the clean architecture under `backend/src/`.

## Architecture Overview

```
backend/src/
├── 0_infrastructure/
│   ├── eventbus/
│   │   ├── IEventBus.mjs              # Port interface
│   │   └── WebSocketEventBus.mjs      # WebSocket implementation
│   ├── proxy/
│   │   ├── IProxyAdapter.mjs          # Interface
│   │   └── ProxyService.mjs           # Generic proxy with retry
│   ├── scheduling/
│   │   ├── TaskRegistry.mjs           # Cron task registration
│   │   └── index.mjs
│   └── logging/                        # (existing)
│
├── 1_domains/
│   ├── gratitude/                      # NEW
│   │   ├── entities/
│   │   │   └── Selection.mjs
│   │   ├── ports/
│   │   │   └── IGratitudeStore.mjs
│   │   └── services/
│   │       └── GratitudeService.mjs
│   └── home-automation/                # (existing, expand)
│
├── 2_adapters/
│   ├── external-services/              # NEW - 40+ service integrations
│   │   ├── garmin/
│   │   ├── strava/
│   │   ├── lastfm/
│   │   └── ...
│   ├── home-automation/                # (existing, expand)
│   │   ├── homeassistant/             # (done)
│   │   ├── tv/                        # (done)
│   │   ├── kiosk/                     # NEW
│   │   ├── tasker/                    # NEW
│   │   └── remote-exec/               # NEW
│   ├── hardware/                       # NEW
│   │   ├── thermal-printer/
│   │   └── tts/
│   ├── proxy/                          # NEW
│   │   ├── PlexProxyAdapter.mjs
│   │   ├── ImmichProxyAdapter.mjs
│   │   ├── AudiobookshelfProxyAdapter.mjs
│   │   └── FreshRSSProxyAdapter.mjs
│   └── persistence/yaml/               # (existing)
│       └── YamlGratitudeStore.mjs     # NEW
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| External services | Adapters + scheduling infrastructure | No harvester domain - scheduling is infrastructure, adapters do the work |
| Hardware (Kiosk, Tasker, SSH) | All under `home-automation/` | They're all about controlling physical devices in the home |
| Proxy | Infrastructure, not domain | No business logic - pure auth injection + retry + pass-through |
| Gratitude | Full domain migration | Complete app with entities, rules, use cases |
| Printer/TTS | Infrastructure adapters only | I/O operations, no business logic |
| WebSocket | Extract `IEventBus` interface | Future-proofs for MQTT or other transports |
| Harvesters/Cron | Scheduling as infrastructure | `TaskRegistry` in `0_infrastructure/scheduling/` |

## Migration Phases

### Phase 1: Infrastructure Foundation
*Do first - others depend on it*

| Item | From | To | Effort |
|------|------|-----|--------|
| EventBus | `_legacy/routers/websocket.mjs` | `0_infrastructure/eventbus/` | Medium |
| ProxyService | `_legacy/routers/plexProxy.mjs` | `0_infrastructure/proxy/` | Low |
| TaskRegistry | `_legacy/routers/cron.mjs` | `0_infrastructure/scheduling/` | Medium |

### Phase 2: Home Automation Adapters
*Extend existing pattern*

| Item | From | To | Effort |
|------|------|-----|--------|
| KioskAdapter | `_legacy/routers/exe.mjs` (Kiosk class) | `2_adapters/home-automation/kiosk/` | Low |
| TaskerAdapter | `_legacy/routers/exe.mjs` (Tasker class) | `2_adapters/home-automation/tasker/` | Low |
| RemoteExecAdapter | `_legacy/routers/exe.mjs` (execmd) | `2_adapters/home-automation/remote-exec/` | Low |

### Phase 3: Hardware Adapters
*Standalone, no domain*

| Item | From | To | Effort |
|------|------|-----|--------|
| ThermalPrinterAdapter | `_legacy/lib/thermalprint.mjs` | `2_adapters/hardware/thermal-printer/` | Medium |
| TTSAdapter | `_legacy/routers/tts.mjs` + `lib/gpt.mjs` | `2_adapters/hardware/tts/` | Low |

### Phase 4: Proxy Adapters
*After infrastructure*

| Item | From | To | Effort |
|------|------|-----|--------|
| PlexProxyAdapter | `_legacy/routers/plexProxy.mjs` | `2_adapters/proxy/` | Low |
| ImmichProxyAdapter | (new) | `2_adapters/proxy/` | Low |
| AudiobookshelfProxyAdapter | (new) | `2_adapters/proxy/` | Low |
| FreshRSSProxyAdapter | (new) | `2_adapters/proxy/` | Low |

### Phase 5: Gratitude Domain
*Full app migration*

| Item | From | To | Effort |
|------|------|-----|--------|
| GratitudeService | `_legacy/routers/gratitude.mjs` | `1_domains/gratitude/` | Medium |
| YamlGratitudeStore | `_legacy/routers/gratitude.mjs` | `2_adapters/persistence/yaml/` | Low |
| gratitude router | `_legacy/routers/gratitude.mjs` | `4_api/routers/gratitude.mjs` | Medium |

### Phase 6: External Service Adapters
*Large, incremental*

| Item | From | To | Effort |
|------|------|-----|--------|
| 40+ service adapters | `_legacy/lib/*.mjs` | `2_adapters/external-services/` | High (incremental) |

## Interface Definitions

### IEventBus

```javascript
// 0_infrastructure/eventbus/IEventBus.mjs

/**
 * @interface IEventBus
 *
 * publish(topic: string, payload: object): void
 *   Broadcast payload to all subscribers of topic.
 *
 * subscribe(clientId: string, topics: string[]): void
 *   Subscribe client to topics. Supports '*' wildcard.
 *
 * unsubscribe(clientId: string, topics: string[]): void
 *   Unsubscribe client from topics.
 *
 * onConnection(callback: (clientId, meta) => void): void
 *   Register connection handler.
 *
 * onDisconnection(callback: (clientId) => void): void
 *   Register disconnection handler.
 *
 * onMessage(callback: (clientId, message) => void): void
 *   Register incoming message handler.
 *
 * getSubscribers(topic: string): string[]
 *   Get list of client IDs subscribed to topic.
 *
 * getClientCount(): number
 *   Get total connected clients.
 */
```

### IProxyAdapter

```javascript
// 0_infrastructure/proxy/IProxyAdapter.mjs

/**
 * @interface IProxyAdapter
 *
 * getServiceName(): string
 *   Return service identifier ('plex', 'immich', etc.)
 *
 * getBaseUrl(): string
 *   Return target service base URL.
 *
 * getAuthHeaders(): Promise<object>
 *   Return headers for authentication (token injection).
 *
 * transformPath(path: string): string
 *   Transform incoming path to target path (optional rewriting).
 *
 * getRetryConfig(): { maxRetries: number, delayMs: number }
 *   Return retry configuration for this service.
 *
 * shouldRetry(statusCode: number): boolean
 *   Determine if request should be retried for given status.
 *
 * isConfigured(): boolean
 *   Check if adapter has valid configuration.
 */
```

### IGratitudeStore

```javascript
// 1_domains/gratitude/ports/IGratitudeStore.mjs

/**
 * @interface IGratitudeStore
 *
 * getOptions(householdId: string, category: string): Promise<Item[]>
 *   Get available options for selection.
 *
 * setOptions(householdId: string, category: string, items: Item[]): Promise<void>
 *   Replace options list.
 *
 * getSelections(householdId: string, category: string): Promise<Selection[]>
 *   Get all selections for category.
 *
 * addSelection(householdId: string, category: string, selection: Selection): Promise<Selection>
 *   Add a new selection, returns with server-assigned ID.
 *
 * removeSelection(householdId: string, category: string, selectionId: string): Promise<void>
 *   Remove a selection by ID.
 *
 * getDiscarded(householdId: string, category: string): Promise<Item[]>
 *   Get discarded items.
 *
 * addDiscarded(householdId: string, category: string, item: Item): Promise<void>
 *   Add item to discarded list.
 *
 * getSnapshot(householdId: string, snapshotId?: string): Promise<Snapshot>
 *   Get snapshot by ID, or latest if not specified.
 *
 * saveSnapshot(householdId: string): Promise<Snapshot>
 *   Create and save a new snapshot.
 *
 * listSnapshots(householdId: string): Promise<SnapshotMeta[]>
 *   List available snapshots.
 */

/**
 * @typedef {Object} Item
 * @property {string} id - UUID
 * @property {string} text - Item text
 */

/**
 * @typedef {Object} Selection
 * @property {string} id - Selection entry UUID
 * @property {string} userId - Username
 * @property {Item} item - The selected item
 * @property {string} datetime - ISO timestamp
 * @property {string[]} [printed] - Array of print timestamps
 */
```

### IExternalServiceAdapter

```javascript
// 2_adapters/external-services/IExternalServiceAdapter.mjs

/**
 * @interface IExternalServiceAdapter
 *
 * getServiceName(): string
 *   Return service identifier ('garmin', 'strava', 'lastfm', etc.)
 *
 * isConfigured(): boolean
 *   Check if adapter has valid credentials/configuration.
 *
 * fetch(options?: FetchOptions): Promise<FetchResult>
 *   Pull latest data from service.
 *
 * getLastFetchTime(): Date | null
 *   Return timestamp of last successful fetch.
 *
 * getMetrics(): AdapterMetrics
 *   Return adapter health/usage metrics.
 */

/**
 * @typedef {Object} FetchOptions
 * @property {Date} [since] - Fetch data since this date
 * @property {boolean} [force] - Force refresh even if recently fetched
 */

/**
 * @typedef {Object} FetchResult
 * @property {boolean} ok - Whether fetch succeeded
 * @property {number} itemCount - Number of items fetched
 * @property {string} [error] - Error message if failed
 */
```

## Legacy Files Inventory

### Routers (`_legacy/routers/`)

| File | Size | Status | Target |
|------|------|--------|--------|
| `cron.mjs` | 13KB | Migrate | `0_infrastructure/scheduling/` |
| `exe.mjs` | 21KB | Migrate | `2_adapters/home-automation/` (split) |
| `fetch.mjs` | 36KB | Migrate | `2_adapters/external-services/` + router |
| `fitness.mjs` | 40KB | Already migrated | `4_api/routers/fitness.mjs` |
| `gratitude.mjs` | 26KB | Migrate | `1_domains/gratitude/` + router |
| `harvest.mjs` | 14KB | Migrate | `0_infrastructure/scheduling/` |
| `health.mjs` | 13KB | Migrate | `2_adapters/external-services/health/` |
| `home.mjs` | 1KB | Migrate | `4_api/routers/home.mjs` |
| `journalist.mjs` | 2KB | Already migrated | `4_api/routers/journalist.mjs` |
| `lifelog.mjs` | 0.5KB | Evaluate | May be dead code |
| `media.mjs` | 40KB | Evaluate | Partially in content domain |
| `plexProxy.mjs` | 2KB | Migrate | `2_adapters/proxy/` |
| `printer.mjs` | 38KB | Migrate | `2_adapters/hardware/thermal-printer/` |
| `tts.mjs` | 5KB | Migrate | `2_adapters/hardware/tts/` |
| `websocket.mjs` | 6KB | Migrate | `0_infrastructure/eventbus/` |

### Libs (`_legacy/lib/`)

| File | Size | Status | Target |
|------|------|--------|--------|
| `buxfer.mjs` | 10KB | Migrate | `2_adapters/external-services/buxfer/` |
| `clickup.mjs` | 9KB | Migrate | `2_adapters/external-services/clickup/` |
| `foursquare.mjs` | 10KB | Migrate | `2_adapters/external-services/foursquare/` |
| `garmin.mjs` | 11KB | Migrate | `2_adapters/external-services/garmin/` |
| `gcal.mjs` | 6KB | Migrate | `2_adapters/external-services/gcal/` |
| `github.mjs` | 8KB | Migrate | `2_adapters/external-services/github/` |
| `gmail.mjs` | 7KB | Migrate | `2_adapters/external-services/gmail/` |
| `goodreads.mjs` | 1KB | Migrate | `2_adapters/external-services/goodreads/` |
| `homeassistant.mjs` | 4KB | Already migrated | `2_adapters/home-automation/homeassistant/` |
| `lastfm.mjs` | 30KB | Migrate | `2_adapters/external-services/lastfm/` |
| `letterboxd.mjs` | 3KB | Migrate | `2_adapters/external-services/letterboxd/` |
| `plex.mjs` | 36KB | Partially migrated | `2_adapters/content/media/plex/` |
| `reddit.mjs` | 8KB | Migrate | `2_adapters/external-services/reddit/` |
| `shopping.mjs` | 22KB | Migrate | `2_adapters/external-services/shopping/` |
| `strava.mjs` | 18KB | Migrate | `2_adapters/external-services/strava/` |
| `thermalprint.mjs` | 42KB | Migrate | `2_adapters/hardware/thermal-printer/` |
| `todoist.mjs` | 6KB | Migrate | `2_adapters/external-services/todoist/` |
| `weather.mjs` | 3KB | Migrate | `2_adapters/external-services/weather/` |
| `withings.mjs` | 13KB | Migrate | `2_adapters/external-services/withings/` |
| `youtube.mjs` | 11KB | Migrate | `2_adapters/external-services/youtube/` |

### Already Migrated (reference)

| Legacy | New Location |
|--------|--------------|
| `lib/homeassistant.mjs` | `2_adapters/home-automation/homeassistant/` |
| `routers/fitness.mjs` | `4_api/routers/fitness.mjs` |
| `routers/journalist.mjs` | `4_api/routers/journalist.mjs` |
| Plex content | `2_adapters/content/media/plex/` |

## Next Steps

1. **Create infrastructure stubs** - Set up folder structure and interface files
2. **Migrate EventBus** - Critical path, used by multiple systems
3. **Migrate home-automation adapters** - Low effort, extends existing pattern
4. **Migrate Gratitude** - Full domain migration as reference implementation
5. **Incremental service adapters** - As needed, no rush

## Notes

- Frontend (`Gratitude.jsx`) doesn't need changes if API contracts are preserved
- WebSocket topics remain stable during EventBus migration
- External service adapters can be migrated incrementally as they're touched
- `_legacy/` folder can be deleted once all imports are updated
