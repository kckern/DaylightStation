# Media Key Resolver Design

## Problem Statement

Media keys are stored and retrieved inconsistently across the codebase:
- **Write path** (`play.mjs`): Stores with compound keys (`plex:11282`)
- **Read path** (`PlexAdapter`, `FolderAdapter`): Looks up with bare keys (`11282`)
- **Result**: Data written as `plex:11282` is not found when searching for `11282`

Evidence from production:
```yaml
# Same episode stored twice with different key formats
'11282':
  playhead: 31
plex:11282:
  playhead: 1248  # Correct value, but not being read
```

## Solution Overview

A `MediaKeyResolver` that normalizes keys at the application service boundary:
- APIs accept bare keys for convenience (`/fitness/show/11253/playable`)
- Storage always uses compound keys (`plex:11282`)
- Resolver bridges the gap with context-aware heuristics

```
API Request (/fitness/show/11253)
         │
         ▼
Application Service (FitnessService)
    resolver.resolve('11253', 'fitness')
         │
         ▼
    'plex:11253' (normalized)
         │
         ▼
Adapter Layer (YamlMediaProgressMemory)
    Always uses compound keys
```

## Configuration

### File Location

```
/data/system/config/media.yml           # System defaults
/data/household/apps/{app}/config.yml   # Per-household overrides
```

### Configuration Structure

```yaml
# /data/system/config/media.yml
mediaKeyResolution:
  knownSources: [plex, folder, filesystem, immich, youtube, audiobookshelf]

  defaults:
    patterns:
      - match: '^\d+$'
        source: plex
      - match: '^[a-f0-9-]{36}$'
        source: immich
      - match: '^[A-Za-z0-9_-]{11}$'
        source: youtube
      - match: '/'
        source: filesystem
    fallbackChain: [plex, folder, filesystem]

  apps:
    fitness:
      defaultSource: plex
    media:
      patterns:
        - match: '^\d+$'
          source: plex
        - match: '^[a-z][a-z0-9-]*$'
          source: folder
      fallbackChain: [plex, folder]
    content:
      # inherits defaults
```

### Resolution Order

1. Household app config (`mediaKeyResolution` key)
2. System app config (`mediaKeyResolution.apps.{appName}`)
3. System defaults (`mediaKeyResolution.defaults`)

## MediaKeyResolver API

### Location

```
backend/src/1_domains/media/MediaKeyResolver.mjs
```

### Class Interface

```javascript
class MediaKeyResolver {
  constructor(config) // Config from media.yml

  // Main method - returns normalized compound key
  resolve(key, appContext = null) → string

  // Soft resolve - returns null instead of throwing
  tryResolve(key, appContext = null) → string | null

  // Resolve with explicit source hint
  resolveAs(key, source) → string

  // Parse compound key to parts
  parse(compoundKey) → { source: string, id: string }

  // Check if already compound
  isCompound(key) → boolean
}
```

### Resolution Logic

```javascript
resolve(key, appContext = null) {
  // 1. Already compound? Return as-is
  if (this.isCompound(key)) return key;

  // 2. Compound but unknown source? Throw
  if (key.includes(':')) {
    const [source] = key.split(':');
    throw new UnknownMediaSourceError(source);
  }

  // 3. Get rules for app (or defaults)
  const rules = this.getRulesForApp(appContext);

  // 4. App has defaultSource? Use it
  if (rules.defaultSource) {
    return `${rules.defaultSource}:${key}`;
  }

  // 5. Pattern match
  for (const { match, source } of rules.patterns) {
    if (new RegExp(match).test(key)) {
      return `${source}:${key}`;
    }
  }

  // 6. Fallback chain
  return `${rules.fallbackChain[0]}:${key}`;
}
```

### Error Classes

```javascript
// backend/src/1_domains/media/errors.mjs

class UnknownMediaSourceError extends Error {
  constructor(source, knownSources) {
    super(`Unknown media source: '${source}'. Known: ${knownSources.join(', ')}`);
    this.source = source;
    this.knownSources = knownSources;
  }
}

class UnresolvableMediaKeyError extends Error {
  constructor(key, appContext) {
    super(`Cannot resolve media key: '${key}' in context '${appContext}'`);
    this.key = key;
    this.appContext = appContext;
  }
}
```

## Integration

### Bootstrap

```javascript
// backend/src/0_system/bootstrap.mjs

const mediaConfig = await configService.get('system', 'media');
const mediaKeyResolver = new MediaKeyResolver(mediaConfig.mediaKeyResolution);

// Inject into adapters
const mediaProgressMemory = new YamlMediaProgressMemory(dataService, mediaKeyResolver);

// Inject into application services
const fitnessService = new FitnessService({
  mediaKeyResolver,
  appContext: 'fitness',
  ...
});
```

### Application Service Usage (DDD Pattern)

Resolution happens at the application service boundary:

```javascript
// backend/src/3_applications/fitness/FitnessService.mjs

class FitnessService {
  constructor({ mediaKeyResolver, appContext, ... }) {
    this.resolver = mediaKeyResolver;
    this.appContext = appContext;
  }

  async getShowPlayable(showId) {
    const compoundId = this.resolver.resolve(showId, this.appContext);
    // '11253' → 'plex:11253'

    // All downstream code uses compound key
    const watchState = await this.mediaProgressMemory.get(compoundId, storagePath);
    ...
  }
}
```

### Storage Layer

`YamlMediaProgressMemory` always expects compound keys after migration:

```javascript
// backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs

async get(itemId, storagePath) {
  // itemId must be compound (e.g., 'plex:11282')
  const data = this._readFile(storagePath);
  return data[itemId] || null;
}

async set(state, storagePath) {
  // state.itemId must be compound
  const data = this._readFile(storagePath);
  data[state.itemId] = { ...state };
  this._writeFile(storagePath, data);
}
```

## Migration

### Strategy

One-time migration script with backup:

1. Backup existing data
2. Scan all media_memory YAML files
3. Transform bare keys to compound keys
4. Merge duplicates
5. Write normalized files

### Backup Location

```
/data/household/history/media_memory.bak.20260130/
```

### Migration Script

```
cli/scripts/migrate-media-keys.mjs
```

### Merge Rules for Duplicates

When both `'11282'` and `plex:11282` exist:

| Field | Rule |
|-------|------|
| `playhead` | Take max |
| `percent` | Take max |
| `playCount` | Sum both |
| `lastPlayed` | Take most recent |
| `title`, `parent`, `grandparent` | Keep if present |
| `watchTime` | Sum both |

### Example Transformation

```yaml
# Before
'11282':
  title: Burn
  playhead: 31
  playCount: 1
plex:11282:
  playhead: 1248
  percent: 83
  playCount: 124

# After
plex:11282:
  title: Burn
  playhead: 1248
  percent: 83
  playCount: 125
  lastPlayed: '2026-01-30 05:42:15'
```

## Files to Change

### Create

| File | Purpose |
|------|---------|
| `backend/src/1_domains/media/MediaKeyResolver.mjs` | Core resolver class |
| `backend/src/1_domains/media/MediaKeyResolver.test.mjs` | Unit tests |
| `backend/src/1_domains/media/errors.mjs` | Error classes |
| `data/system/config/media.yml` | System configuration |
| `cli/scripts/migrate-media-keys.mjs` | Migration script |

### Modify

| File | Change |
|------|--------|
| `backend/src/0_system/bootstrap.mjs` | Instantiate resolver, inject into services |
| `backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` | Remove legacy key handling |
| `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs` | Use resolver, stop stripping prefixes |
| `backend/src/2_adapters/content/folder/FolderAdapter.mjs` | Use resolver for lookups |
| `backend/src/3_applications/fitness/FitnessService.mjs` | Resolve keys at boundary |
| `backend/src/3_applications/media/MediaService.mjs` | Resolve keys at boundary |
| `backend/src/4_api/v1/routers/play.mjs` | Verify consistency |
| `backend/src/4_api/v1/routers/fitness.mjs` | Pass app context |

## Rollout Plan

```
1. [ ] Write MediaKeyResolver + unit tests
2. [ ] Create /data/system/config/media.yml
3. [ ] Write migration script
4. [ ] Test migration on backup copy, verify output
5. [ ] Deploy resolver code (not wired in yet)
6. [ ] Backup production media_memory/
7. [ ] Run migration on production
8. [ ] Wire resolver into bootstrap + services
9. [ ] Deploy full change
10. [ ] Verify: curl fitness/show/11253/playable shows correct watch state
```

## Rollback Plan

- Restore `media_memory.bak.YYYYMMDD/` if migration causes issues
- Resolver code is additive - can revert service wiring without data loss

## Testing

### Unit Tests

```javascript
describe('MediaKeyResolver', () => {
  describe('resolve()', () => {
    it('passes through compound keys');
    it('uses app defaultSource when configured');
    it('matches numeric pattern to plex');
    it('matches slug pattern to folder');
    it('throws on unknown source prefix');
    it('uses fallback chain when no pattern matches');
  });

  describe('parse()', () => {
    it('splits source and id');
    it('handles ids containing colons');
  });

  describe('isCompound()', () => {
    it('returns true for known source prefixes');
    it('returns false for bare keys');
    it('returns false for unknown prefixes');
  });
});
```

### Integration Verification

After deployment:
```bash
# Should return watch state for episode 11282
curl https://daylightlocal.kckern.net/api/v1/fitness/show/11253/playable \
  | jq '.items[] | select(.key == 11282) | {title, playhead: .resumeSeconds, percent: .watchProgress}'

# Expected output:
# { "title": "Burn", "playhead": 1248, "percent": 83 }
```
