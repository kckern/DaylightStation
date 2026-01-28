# Watch State Single Source of Truth Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Consolidate watch state management so play/log writes are visible to fitness and all other consumers.

**Problem:** Two parallel systems exist - WatchStore writes to `dataBasePath/history/media_memory/plex.yml` with prefixed keys, while adapters read from `householdDir/history/media_memory/plex/*.yml` with bare keys. They never intersect.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Single Source of Truth | WatchStore (YamlWatchStateDatastore) |
| Key format | Prefixed: `plex:664036`, `filesystem:intro` |
| Household scoping | WatchStore uses `householdDir`, not `dataBasePath` |
| File organization | Single file per source, except Plex (library-specific) |
| Plex storage path | Adapter provides via `getStoragePath()` |
| Adapter access | Inject WatchStore into adapters |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        API Layer                             │
│  play.mjs (/log)          fitness.mjs           content.mjs  │
└──────────┬────────────────────┬─────────────────────┬───────┘
           │                    │                     │
           ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      WatchStore (SSOT)                       │
│  • get(itemId, storagePath)                                  │
│  • set(state, storagePath)                                   │
│  • getAll(storagePath)                                       │
│  basePath: ${householdDir}/history/media_memory/             │
└──────────┬────────────────────┬─────────────────────┬───────┘
           │                    │                     │
           ▼                    ▼                     ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│   plex/      │    │    media.yml     │    │  talks.yml   │
│ 14_fitness.yml│   │                  │    │              │
│ 5_music.yml  │    │                  │    │              │
└──────────────┘    └──────────────────┘    └──────────────┘
```

---

## Storage Path Convention

| Source | Storage Path | File Location | Example Key |
|--------|--------------|---------------|-------------|
| Plex | `plex/{libraryId}_{libraryName}` | `plex/14_fitness.yml` | `plex:664036` |
| Filesystem | `media` | `media.yml` | `filesystem:sfx/intro` |
| Talks | `talks` | `talks.yml` | `talk:conference/2024/smith` |
| Scripture | `scripture` | `scripture.yml` | `scripture:bofm/1-nephi/1` |
| Hymns | `hymns` | `hymns.yml` | `hymn:primary/123` |
| Poetry | `poetry` | `poetry.yml` | `poem:frost/road-not-taken` |

**Plex library resolution:** PlexAdapter's `getStoragePath(id)` queries item metadata for `librarySectionID` and `librarySectionTitle`, returns `plex/{id}_{sanitized-name}`.

---

## Code Changes

### 1. app.mjs - Fix watchStatePath

```javascript
// Before (line 260)
const watchStatePath = configService.getPath('watchState')
  || `${dataBasePath}/history/media_memory`;

// After
const watchStatePath = configService.getPath('watchState')
  || `${householdDir}/history/media_memory`;
```

### 2. YamlWatchStateDatastore - Support nested paths

```javascript
// Before
_getBasePath(storagePath) {
  const safePath = storagePath.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(this.basePath, safePath);
}

// After
_getBasePath(storagePath) {
  const safePath = storagePath
    .split('/')
    .map(segment => segment.replace(/[^a-zA-Z0-9-_]/g, '_'))
    .join('/');
  return path.join(this.basePath, `${safePath}.yml`);
}
```

### 3. PlexAdapter - Inject watchStore, implement getStoragePath

```javascript
// Constructor accepts watchStore
constructor(config, deps = {}) {
  // ...
  this.watchStore = config.watchStore || null;
}

// Returns library-specific path
async getStoragePath(id) {
  const localId = id.replace(/^plex:/, '');
  const item = await this.getItem(`plex:${localId}`);
  if (item?.metadata?.librarySectionID) {
    const libraryId = item.metadata.librarySectionID;
    const libraryName = (item.metadata.librarySectionTitle || 'media')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `plex/${libraryId}_${libraryName}`;
  }
  return 'plex';
}

// Updated to use watchStore
async _loadViewingHistory(storagePath = 'plex') {
  if (!this.watchStore) return {};
  const states = await this.watchStore.getAll(storagePath);
  return Object.fromEntries(
    states.map(s => [s.itemId.replace('plex:', ''), {
      playhead: s.playhead,
      percent: s.percent,
      lastPlayed: s.lastPlayed
    }])
  );
}
```

### 4. bootstrap.mjs - Wire watchStore to adapters

```javascript
export function createContentRegistry(config, deps = {}) {
  const { httpClient, watchStore } = deps;

  if (config.plex?.host && httpClient) {
    registry.register(new PlexAdapter({
      host: config.plex.host,
      token: config.plex.token,
      watchStore
    }, { httpClient }));
  }
  // Similar for other adapters...
}
```

### 5. app.mjs - Pass watchStore to registry

```javascript
const watchStore = createWatchStore({ watchStatePath });
const contentRegistry = createContentRegistry({
  // ... existing config
}, { httpClient: axios, watchStore });
```

---

## Data Migration

**One-time migration script** (run before deploying):

1. Read legacy files from both locations
2. Normalize to prefixed key format (`664036` → `plex:664036`)
3. Write to new household-scoped structure
4. If same key in both, prefer more recent `lastPlayed`
5. Keep old files as backup

---

## Implementation Phases

**Phase 1: Core fix (this PR)**
- Update `watchStatePath` to use `householdDir`
- Update WatchStore `_getBasePath()` for nested paths
- Update PlexAdapter to accept `watchStore`, implement `getStoragePath()`
- Update bootstrap wiring
- Run data migration

**Phase 2: Full cleanup (future)**
- Remove legacy `_loadHistoryFromFiles()` from all adapters
- Remove `historyPath` config from all adapters
- Update remaining adapters (Filesystem, LocalContent, Folder)
- Remove `setHistoryLoader()` pattern entirely

---

## Testing

- Verify play/log writes appear in fitness endpoint response
- Verify existing watch history is preserved after migration
- Verify Plex items write to correct library-specific files
- Verify household isolation (if multiple households exist)
