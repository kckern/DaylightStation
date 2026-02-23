# Launchable Content — Design

**Date:** 2026-02-23
**Status:** Draft

---

## Context

DaylightStation has five content action types: `play`, `queue`, `list`, `open`, and `display`. All execute within the browser — either rendering media in the Player, browsing containers in TVMenu, or displaying images. There is no mechanism to launch a native application on a target device from the DaylightStation UI.

The primary use case is launching retro games on the NVIDIA Shield TV. The Shield runs Fully Kiosk Browser as a kiosk, displaying DaylightStation's TV interface. RetroArch is installed on the device with ~30 games across 8 consoles (N64, SNES, NES, Genesis, GB, GBC, GBA, GameCube). Games can be launched via ADB intent:

```bash
adb shell am start \
  -n com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture \
  --es ROM '/storage/emulated/0/Games/N64/Mario Kart 64 (USA).n64' \
  --es LIBRETRO '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so'
```

RetroArch's `.lpl` playlist files (JSON) already contain structured mappings of ROM path → core path → display label → CRC32. Boxart thumbnails are pre-downloaded on-device. X-plore WiFi File Manager is running on the Shield (`http://10.0.0.11:1111/`) and can serve both playlists and thumbnails over HTTP.

This design introduces a sixth action type — `launch` — and the infrastructure to support it, starting with RetroArch as the first adapter.

---

## Architecture Overview

The feature spans all DDD layers:

```
Domain (2_domains/content/)
  └── LaunchableItem              ← new entity

Port (3_applications/devices/ports/)
  └── IDeviceLauncher             ← new interface

Port (3_applications/content/ports/)
  └── ISyncSource                 ← new interface

Application (3_applications/content/services/)
  ├── LaunchService               ← orchestrates launch execution
  └── SyncService                 ← generic sync orchestration

Content Adapter (1_adapters/content/retroarch/)
  ├── RetroArchAdapter            ← IContentSource (list, item, search, siblings)
  └── RetroArchSyncAdapter        ← sync from X-plore

Device Adapter (1_adapters/devices/)
  └── AdbLauncher                 ← IDeviceLauncher via ADB

API (4_api/v1/routers/)
  ├── launch.mjs                  ← POST /api/v1/launch
  └── sync.mjs                    ← POST /api/v1/sync/:source

Frontend
  ├── LaunchCard                  ← "Launching..." overlay
  ├── TVMenu CSS arcade variant   ← grid layout for game browsing
  └── Admin Games section         ← sync + overrides
```

Key principle: **the domain knows nothing about ADB, Android, or RetroArch.** The domain defines `LaunchableItem` (an entity with a structured `launchIntent`). Ports (`IDeviceLauncher`, `ISyncSource`) define abstract capabilities. Infrastructure details live entirely in adapters.

---

## Domain Layer

### LaunchableItem

**File:** `2_domains/content/entities/LaunchableItem.mjs`

Extends `Item` (same base as `PlayableItem`, `ListableItem`, `DisplayableItem`):

```javascript
class LaunchableItem extends Item {
  constructor(props) {
    super(props);
    this.launchIntent = props.launchIntent;       // { target, params }
    this.deviceConstraint = props.deviceConstraint; // 'android' | null
    this.console = props.console;                  // 'n64', 'snes', etc.
  }
}
```

**`launchIntent` structure** — abstract, adapter-agnostic:

```javascript
launchIntent: {
  target: 'com.retroarch.aarch64/...RetroActivityFuture',
  params: {
    ROM: '/storage/emulated/0/Games/N64/Mario Kart 64.n64',
    LIBRETRO: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so'
  }
}
```

The domain knows `target` + `params` (key-value). The device adapter translates: `target` → `-n` flag, `params` → `--es` extras for Android; or `target` → SSH command, `params` → arguments for future adapters. The structure is generic enough for Android intents, SSH commands, HTTP calls, etc.

### IDeviceLauncher Port

**File:** `3_applications/devices/ports/IDeviceLauncher.mjs`

Launching is a **device capability**, not a content concept. The port lives under `devices/ports/` — content merely produces the intent; the device executes it.

```javascript
export class IDeviceLauncher {
  async launch(deviceId, launchIntent) {
    throw new Error('IDeviceLauncher.launch must be implemented');
  }
  async canLaunch(deviceId) {
    throw new Error('IDeviceLauncher.canLaunch must be implemented');
  }
}

export function isDeviceLauncher(obj) {
  return obj &&
    typeof obj.launch === 'function' &&
    typeof obj.canLaunch === 'function';
}
```

No mention of ADB, intents, or Android. Tomorrow a `SshLauncher` or `HttpLauncher` could implement the same port.

---

## Content Adapter — RetroArchAdapter

**File:** `1_adapters/content/retroarch/RetroArchAdapter.mjs`

Implements `IContentSource`. Reads **only from local cache** (`retroarch.yml` + cached thumbnails). Never talks to X-plore or ADB directly.

### IContentSource Compliance

| Method | Required | Behavior |
|--------|----------|----------|
| `source` | Yes | `'retroarch'` |
| `prefixes` | Yes | `[{ prefix: 'retroarch' }]` |
| `getList()` (root) | Yes | Returns console containers from `retroarch.yml` |
| `getList(consoleId)` | Yes | Returns games for that console as `LaunchableItem[]` |
| `getItem(gameId)` | Yes | Single game as `LaunchableItem` with `launchIntent` populated |
| `resolvePlayables(id)` | Yes | Returns `[]` — games are not playable |
| `resolveSiblings(compoundId)` | Yes | Parent console + sibling games (for combobox) |
| `search(query)` | Yes | Text search across all games in all consoles |
| `getSearchCapabilities()` | Yes | `{ canonical: ['text'], specific: ['console'] }` |
| `getThumbnail(localId)` | Yes | Serves cached boxart PNG from local data directory |

### Content ID Scheme

```
retroarch:n64              → container (Nintendo 64 console)
retroarch:n64/mario-kart-64 → leaf (specific game)
retroarch:mario-kart-64     → flat alias (resolves to full path if unambiguous)
```

Console-prefixed is canonical. Flat aliases work as long as there are no slug collisions across consoles.

### Item Metadata Shape

For `/info` and `/siblings` endpoint compliance, `getItem()` returns:

```javascript
{
  id: 'retroarch:n64/mario-kart-64',
  source: 'retroarch',
  title: 'Mario Kart 64',
  thumbnail: '/api/v1/proxy/retroarch/thumbnail/n64/mario-kart-64',
  type: 'game',
  metadata: {
    type: 'game',
    console: 'n64',
    parentTitle: 'Nintendo 64'
  },
  launchIntent: {
    target: 'com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture',
    params: {
      ROM: '/storage/emulated/0/Games/N64/Mario Kart 64 (USA).n64',
      LIBRETRO: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so'
    }
  },
  deviceConstraint: 'android',
  console: 'n64'
}
```

### Siblings Response

For `resolveSiblings('retroarch:n64/mario-kart-64')`:

```javascript
{
  parent: {
    id: 'retroarch:n64',
    title: 'Nintendo 64',
    source: 'retroarch',
    thumbnail: null
  },
  items: [ /* all N64 games as ListableItems */ ]
}
```

This enables the admin combobox to show sibling games when editing a list item with `input: retroarch:n64/mario-kart-64`.

---

## Content Adapter — RetroArchSyncAdapter

**File:** `1_adapters/content/retroarch/RetroArchSyncAdapter.mjs`

Handles sync from the device. Talks to X-plore WiFi File Manager over HTTP.

### Sync Process

1. **Fetch playlist index** — `GET http://{host}:{port}/storage/emulated/0/RetroArch/playlists?cmd=list` → list of `.lpl` files
2. **Fetch each playlist** — `GET http://{host}:{port}/storage/emulated/0/RetroArch/playlists/{name}.lpl` → JSON with ROM paths, core paths, labels, CRC32s
3. **Parse and normalize** — Convert `.lpl` JSON entries to canonical YAML structure. Generate slugs from titles. Map core paths to console IDs.
4. **Sync thumbnails** — For each game, download boxart from `http://{host}:{port}/storage/emulated/0/RetroArch/thumbnails/{System}/Named_Boxarts/{label}.png`. Save to `data/household/shared/retroarch/thumbnails/{console}/{slug}.png`. Skip if already cached.
5. **Merge with overrides** — Read existing `overrides` block from `catalog.yml` and preserve any manual entries (custom titles, hidden flags, custom thumbnails).
6. **Write `catalog.yml`** — Atomic write to `data/household/shared/retroarch/catalog.yml`. Config file is never touched by sync.

### X-plore HTTP API

| Endpoint | Purpose |
|----------|---------|
| `GET /{path}?cmd=list` | List directory (JSON response with `files` array) |
| `GET /{path}?cmd=list&filter=dirs` | List directories only |
| `GET /{path}` | Download file content |

### Thumbnail Naming

RetroArch thumbnails use the playlist `label` field (not the ROM filename), with colons replaced by underscores:
- Playlist label: `Mario Kart: Double Dash!! (USA)`
- Thumbnail file: `Mario Kart_ Double Dash!! (USA).png`

The sync adapter handles this mapping when downloading.

---

## Device Adapter — AdbLauncher

**File:** `1_adapters/devices/AdbLauncher.mjs`

Implements `IDeviceLauncher`. Uses the existing `AdbAdapter` internally — does not duplicate ADB connection logic.

```javascript
class AdbLauncher extends IDeviceLauncher {
  #deviceFactory;   // resolves deviceId → AdbAdapter instance
  #logger;

  async canLaunch(deviceId) {
    // Check if device has ADB config in devices.yml
    const device = this.#deviceFactory.getDevice(deviceId);
    return device?.hasAdbConfig() ?? false;
  }

  async launch(deviceId, launchIntent) {
    const adb = this.#deviceFactory.getAdbAdapter(deviceId);
    await adb.connect();

    // Translate abstract intent → ADB command args (array form, never interpolated into a shell string)
    const args = ['start', '-n', launchIntent.target];
    for (const [key, val] of Object.entries(launchIntent.params)) {
      this.#validateIntentParam(key, val);
      args.push('--es', key, val);
    }

    await adb.amStart(args);
  }

  // Guard against injection — intent keys and values must not contain shell metacharacters
  #validateIntentParam(key, val) {
    const shellMeta = /[;|&`$(){}[\]<>!\\]/;
    if (shellMeta.test(key) || shellMeta.test(val)) {
      throw new ValidationError(`Intent param contains disallowed characters`, { field: key, value: val });
    }
  }
}
```

**Security:** Intent parameters are passed as an **array of arguments**, never interpolated into a shell string. This prevents command injection from ROM filenames containing quotes or shell metacharacters (e.g., `Kirby's Adventure.nes`). An additional `#validateIntentParam()` guard rejects values with shell metacharacters as defense-in-depth — even though array-form execution doesn't interpret them, the validation catches obviously malicious input before it reaches ADB.

The `adb.amStart(args)` method is a thin wrapper on the existing `AdbAdapter` that passes args as an array to the underlying exec call (same pattern as `child_process.execFile` vs `exec`). If the existing `AdbAdapter.shell()` only supports string commands, it must be extended with an array-safe execution path — do not fall back to string interpolation.

The translation from abstract `{ target, params }` to `am start -n ... --es ...` happens entirely in this adapter. The domain and application layers never see ADB vocabulary.

---

## Application Layer

### LaunchService

**File:** `3_applications/content/services/LaunchService.mjs`

Orchestrates the launch flow:

```javascript
class LaunchService {
  #contentRegistry;    // ContentSourceRegistry — resolve content
  #deviceLauncher;     // IDeviceLauncher — execute launch
  #logger;

  async launch({ contentId, targetDeviceId }) {
    // 1. Resolve content → LaunchableItem
    const { source, localId } = parseCompoundId(contentId);
    const adapter = this.#contentRegistry.getBySource(source);
    const item = await adapter.getItem(localId);

    if (!item?.launchIntent) {
      throw new ValidationError('Content is not launchable');
    }

    // 2. Validate target device can launch
    const canLaunch = await this.#deviceLauncher.canLaunch(targetDeviceId);
    if (!canLaunch) {
      throw new ValidationError('Target device does not support launch');
    }

    // 3. Execute launch
    await this.#deviceLauncher.launch(targetDeviceId, item.launchIntent);

    return { success: true, contentId, targetDeviceId, title: item.title };
  }
}
```

### ISyncSource Port

**File:** `3_applications/content/ports/ISyncSource.mjs`

Defines the contract for any syncable content source. SyncService depends on this port — adapters implement it.

```javascript
export class ISyncSource {
  /** Perform a full sync from the external source. Returns sync result summary. */
  async sync() {
    throw new Error('ISyncSource.sync must be implemented');
  }

  /** Return current sync status (last sync time, item count, errors). */
  async getStatus() {
    throw new Error('ISyncSource.getStatus must be implemented');
  }
}

export function isSyncSource(obj) {
  return obj &&
    typeof obj.sync === 'function' &&
    typeof obj.getStatus === 'function';
}
```

`RetroArchSyncAdapter` implements `ISyncSource`. Future syncable sources (e.g., a Spotify playlist importer) implement the same port.

### SyncService

**File:** `3_applications/content/services/SyncService.mjs`

Generic sync orchestration — not RetroArch-specific. Any `ISyncSource` can register.

```javascript
import { isSyncSource } from '../ports/ISyncSource.mjs';

class SyncService {
  #syncSources;   // Map<source, ISyncSource>

  registerSyncSource(source, adapter) {
    if (!isSyncSource(adapter)) {
      throw new ValidationError(`Adapter for '${source}' does not implement ISyncSource`);
    }
    this.#syncSources.set(source, adapter);
  }

  async sync(source) {
    const adapter = this.#syncSources.get(source);
    if (!adapter) throw new EntityNotFoundError('SyncSource', source);
    return adapter.sync();
  }

  async getStatus(source) {
    const adapter = this.#syncSources.get(source);
    if (!adapter) throw new EntityNotFoundError('SyncSource', source);
    return adapter.getStatus();
  }
}
```

---

## API Layer

All routes are vendor-agnostic. The source name only appears as a route parameter.

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/v1/launch` | POST | Execute launch: `{ contentId, targetDeviceId }` |
| `POST /api/v1/sync/:source` | POST | Trigger sync for any syncable source |
| `GET /api/v1/sync/:source/status` | GET | Sync status (last sync time, game count) |

Existing routes handle browsing and metadata — no new routes needed:

| Route | Purpose |
|-------|---------|
| `GET /api/v1/list/retroarch` | List consoles |
| `GET /api/v1/list/retroarch:n64` | List N64 games |
| `GET /api/v1/info/retroarch/n64/mario-kart-64` | Game metadata |
| `GET /api/v1/siblings/retroarch/n64/mario-kart-64` | Sibling games in same console |
| `GET /api/v1/content/query/search/stream?text=mario` | Cross-source search (includes RetroArch) |

---

## Frontend — TV Interface

### New Action Type: `launch`

**MenuStack dispatch** — add to `handleSelect()` in `MenuStack.jsx`:

```javascript
if (selection.launch) {
  push({ type: 'launch', props: selection });
}
```

**LaunchCard component** — `modules/Menu/LaunchCard.jsx`

Renders when `type === 'launch'` is on the stack:
- Shows game boxart (large), title, console name
- "Launching..." indicator with brief animation
- Fires `POST /api/v1/launch` with `{ contentId, targetDeviceId }`
- On success, holds the card for 2-3 seconds while RetroArch takes over the screen
- On error, shows error message with retry option

**Remote launch** — when browsing games from a non-launchable device (phone, admin app), the UI shows a "Launch on [device]" button. The `targetDeviceId` is set to the capable device rather than the requesting device. This turns the phone into a game picker remote control.

### Arcade Menu Style

**TVMenu CSS variant** — when the list metadata includes `menuStyle: 'arcade'`, `TVMenu` applies a grid/card layout CSS class. Same component, different styling.

- Large boxart tiles in a responsive grid
- Console name as section header
- Game title below each tile
- Keyboard/D-pad navigation adapts to grid layout

**URL param** — `?launch=retroarch:n64/mario-kart-64` triggers the launch flow from a URL, following the same pattern as `?play=`, `?queue=`, `?list=`, etc. Added to `TVApp.jsx` mappings.

### Normalizer Update

`listConfigNormalizer.mjs` gets a new `Launch` action branch:

```yaml
# YAML config format
- title: Mario Kart 64
  launch: { contentId: retroarch:n64/mario-kart-64 }

# Legacy format
- label: Mario Kart 64
  input: retroarch:n64/mario-kart-64
  action: Launch
```

---

## Frontend — Admin App

### New Section: Games

**Routes:**

| Route | Component | Purpose |
|-------|-----------|---------|
| `/admin/content/games` | `GamesIndex.jsx` | Console list, sync button, last sync time, game count |
| `/admin/content/games/:consoleId` | `ConsoleDetail.jsx` | Game grid with per-game override toggles |

**Sync button:**
- Shows last sync timestamp and game count from `GET /api/v1/sync/retroarch/status`
- Click triggers `POST /api/v1/sync/retroarch`
- Shows progress/spinner, then refreshes the catalog view

**Per-game overrides** (inline in console detail view):
- `title` — custom display name (overrides `.lpl` import)
- `hidden` — toggle to exclude from menus
- `thumbnail` — upload custom boxart (overrides synced one)

Overrides are written to the `overrides` block in `catalog.yml`. Sync preserves overrides — merges new game data without clobbering manual edits.

**Navigation:** "Games" added to admin sidebar under the Content section, alongside "Lists."

### ListsItemRow Integration

When building custom menus with game items:

| Change | File | Detail |
|--------|------|--------|
| `ACTION_OPTIONS` | `ListsItemRow.jsx` | Add `{ value: 'Launch', label: 'Launch' }` |
| `TYPE_ICONS` | `ListsItemRow.jsx` | Add `game: IconGamepad` (or similar) |
| `CONTAINER_TYPES` | `ListsItemRow.jsx` | Add `'console'` for drill-down chevron |

The `ContentSearchCombobox` will surface RetroArch games in search results and support sibling browsing — no changes needed to the combobox component itself, as long as the adapter implements the full `IContentSource` interface.

---

## Config & Data Structure

Configuration and catalog data are **separate files** to respect separation of concerns. Config is static and hand-edited; catalog data is machine-written by sync and should never require manual edits (overrides excepted).

### retroarch.yml (config)

**Location:** `data/household/apps/retroarch/config.yml`

Static configuration — source connection details, launch template, console-to-core mappings. Edited by hand or admin UI. Never written by sync.

```yaml
source:
  host: 10.0.0.11
  port: 1111
  playlists_path: /storage/emulated/0/RetroArch/playlists
  thumbnails_path: /storage/emulated/0/RetroArch/thumbnails
  games_path: /storage/emulated/0/Games

launch:
  package: com.retroarch.aarch64
  activity: com.retroarch.browser.retroactivity.RetroActivityFuture
  device_constraint: android

consoles:
  n64:
    label: Nintendo 64
    core: /data/local/tmp/mupen64plus_next_gles3_libretro_android.so
    menuStyle: arcade
  snes:
    label: Super Nintendo
    core: /data/local/tmp/snes9x_libretro_android.so
    menuStyle: arcade
  genesis:
    label: Sega Genesis
    core: /data/local/tmp/genesis_plus_gx_libretro_android.so
    menuStyle: arcade

thumbnails:
  base_path: data/household/shared/retroarch/thumbnails
```

The `thumbnails.base_path` is the **single source of truth** for where thumbnails live. Both RetroArchAdapter (serving) and RetroArchSyncAdapter (writing) read this value from config rather than relying on implicit convention.

### catalog.yml (sync output)

**Location:** `data/household/shared/retroarch/catalog.yml`

Machine-written by sync. Contains the game catalog and sync metadata. Sync owns this file entirely — it merges overrides on each run but is the sole writer.

```yaml
sync:
  last_synced: 2026-02-23T10:30:00Z
  game_count: 30

games:
  n64:
    - id: mario-kart-64
      title: Mario Kart 64
      rom: /storage/emulated/0/Games/N64/Mario Kart 64 (USA).n64
      thumbnail: n64/mario-kart-64.png
    - id: star-fox-64
      title: Star Fox 64
      rom: /storage/emulated/0/Games/N64/Star Fox 64 (USA).n64
      thumbnail: n64/star-fox-64.png

  snes:
    - id: zelda-alttp
      title: The Legend of Zelda - A Link to the Past
      rom: /storage/emulated/0/Games/SNES/Legend of Zelda, The...smc
      thumbnail: snes/zelda-alttp.png

  genesis:
    - id: sonic-the-hedgehog
      title: Sonic the Hedgehog
      rom: /storage/emulated/0/Games/Genesis/Sonic the Hedgehog (JUE) [!].bin
      thumbnail: genesis/sonic-the-hedgehog.png

overrides:
  n64/mario-kart-64:
    title: Mario Kart 64 (Custom Name)
  snes/zelda-alttp:
    hidden: true
```

The `overrides` block preserves manual edits across syncs. During sync, new game entries are merged into `games`; existing `overrides` entries are never touched. RetroArchAdapter reads both `games` and `overrides`, applying overrides on top at read time.

The adapter combines config's `launch.package + launch.activity` → `launchIntent.target`, and config's `console.core + catalog game.rom` → `launchIntent.params`. The domain entity never sees Android vocabulary.

### Cached Thumbnails

**Location:** Resolved from `config.yml` → `thumbnails.base_path` (default: `data/household/shared/retroarch/thumbnails/{console}/{game-slug}.png`)

Downloaded during sync from X-plore. ~30 games × ~500KB boxart = ~15MB total.

---

## Logging

All components use the structured logging framework. No raw `console.log`.

### Event Prefixes

| Component | Prefix | Key Events |
|-----------|--------|------------|
| RetroArchAdapter | `retroarch.list.*` | `list.consoles`, `list.games`, `item.resolved`, `item.notFound` |
| RetroArchSyncAdapter | `retroarch.sync.*` | `sync.start`, `sync.playlistFetched`, `sync.playlistParsed`, `sync.thumbnailDownloaded`, `sync.thumbnailFailed`, `sync.complete`, `sync.failed` |
| LaunchService | `launch.service.*` | `service.requested`, `service.contentResolved`, `service.deviceValidated`, `service.deviceNotCapable`, `service.success`, `service.failed` |
| AdbLauncher | `launch.adb.*` | `adb.intentBuilt`, `adb.executing`, `adb.success`, `adb.failed`, `adb.timeout` |
| X-plore HTTP | `xplore.*` | `xplore.request`, `xplore.response`, `xplore.timeout`, `xplore.unreachable` |
| Admin sync UI | `admin.sync.*` | `admin.sync.triggered`, `admin.sync.complete` |

### Error Scenarios

| Scenario | Logged As | User Sees |
|----------|-----------|-----------|
| X-plore unreachable during sync | `xplore.unreachable` (error) | "Sync failed — X-plore not running on device" |
| ADB connection failed during launch | `launch.adb.failed` (error) | "Could not reach device — check ADB connection" |
| Game not found in catalog | `retroarch.item.notFound` (warn) | 404 from list/item API |
| Target device has no launch capability | `launch.service.deviceNotCapable` (warn) | "Device does not support launch" |
| Thumbnail download fails for one game | `retroarch.sync.thumbnailFailed` (warn) | Sync continues, game shows without boxart |

All errors include `deviceId`, `contentId`, or `source` context in the log payload for traceability.

---

## File Inventory

### New Files

| Layer | File | Purpose |
|-------|------|---------|
| Domain | `2_domains/content/entities/LaunchableItem.mjs` | Entity |
| Port | `3_applications/devices/ports/IDeviceLauncher.mjs` | Device launch interface |
| Port | `3_applications/content/ports/ISyncSource.mjs` | Sync source interface |
| App | `3_applications/content/services/LaunchService.mjs` | Launch orchestration |
| App | `3_applications/content/services/SyncService.mjs` | Generic sync orchestration |
| Adapter | `1_adapters/content/retroarch/RetroArchAdapter.mjs` | Content source |
| Adapter | `1_adapters/content/retroarch/RetroArchSyncAdapter.mjs` | Sync via X-plore |
| Adapter | `1_adapters/devices/AdbLauncher.mjs` | IDeviceLauncher via ADB |
| API | `4_api/v1/routers/launch.mjs` | Launch route |
| API | `4_api/v1/routers/sync.mjs` | Sync routes |
| Frontend | `modules/Menu/LaunchCard.jsx` | Launch overlay |
| Frontend | `modules/Admin/Games/GamesIndex.jsx` | Admin console list |
| Frontend | `modules/Admin/Games/ConsoleDetail.jsx` | Admin game grid |
| Docs | `docs/reference/integrations/retroarch.md` | Integration reference |
| Config | `data/household/apps/retroarch/config.yml` | Static configuration (source, launch, consoles) |
| Data | `data/household/shared/retroarch/catalog.yml` | Synced game catalog + overrides |
| Data | `data/household/shared/retroarch/thumbnails/` | Cached boxart |

### Modified Files

| File | Change |
|------|--------|
| `1_adapters/content/list/listConfigNormalizer.mjs` | Add `Launch` action branch |
| `frontend/src/modules/Menu/MenuStack.jsx` | Add `launch` case in `handleSelect` + render `LaunchCard` |
| `frontend/src/modules/Menu/TVMenu` CSS | Add `arcade` menuStyle variant (grid layout) |
| `frontend/src/Apps/TVApp.jsx` | Add `?launch=` URL param mapping |
| `frontend/src/Apps/AdminApp.jsx` | Add `/content/games` routes |
| `frontend/src/modules/Admin/AdminLayout.jsx` | Add "Games" to sidebar nav |
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` | Add `Launch` to `ACTION_OPTIONS`, `game` to `TYPE_ICONS`, `console` to `CONTAINER_TYPES` |
| `4_api/v1/utils/actionRouteParser.mjs` | Register `retroarch` source prefix |
| Bootstrap / wiring | Register RetroArchAdapter + AdbLauncher + SyncService |

---

## Existing Games on Device

Reference data from the Shield TV as of 2026-02-23:

| Console | Games | Core |
|---------|-------|------|
| N64 | Mario Kart 64, Bomberman 64, Mario Party, Mario Tennis, Paper Mario, Pilotwings 64, Star Fox 64, Wave Race 64, Diddy Kong Racing | mupen64plus_next_gles3 |
| SNES | DKC, Goof Troop, Zelda ALttP, Mega Man Soccer, Super Bomberman 2, Mario All-Stars+World, Super Mario Kart, Tetris & Dr. Mario, DKC2, Mario Paint | snes9x |
| Genesis | Sonic the Hedgehog, Mega Bomberman | genesis_plus_gx |
| GB | Pokemon Red, Mario Land, Mario Land 2, Wario Land | gambatte |
| GBC | Pokemon Yellow, Pokemon Crystal | gambatte |
| GBA | Mario Kart Super Circuit | mgba |
| NES | Bubble Bobble | fceumm |
| GameCube | Mario Kart Double Dash | dolphin |

---

## Open Questions

None — all design decisions resolved during brainstorming.
