# Backend API Integration Test Suite

## Overview

Comprehensive integration tests for backend API endpoints using Supertest against Express with real data mounts. Tests validate schema correctness, data integrity, reference resolution, and metadata mapping.

## Architecture

```
tests/integration/api/
├── _baselines/                    # GITIGNORED - Generated golden data
│   ├── local-content/
│   ├── plex/
│   └── folder/
├── _utils/
│   ├── testServer.mjs             # Express app factory
│   ├── baselineCapture.mjs        # Captures from legacy API
│   ├── baselineLoader.mjs         # Loader with fail-loud enforcement
│   ├── schemaValidators.mjs       # JSON schema validators
│   ├── plexHealthCheck.mjs        # Plex connectivity gate
│   └── CAPTURE_MANIFEST.mjs       # Endpoint mapping (committed)
├── local-content.api.test.mjs
├── folder.api.test.mjs
├── plex.api.test.mjs              # Isolated, fails fast if offline
├── filesystem.api.test.mjs
├── list-router.api.test.mjs
├── play-router.api.test.mjs
├── content-router.api.test.mjs
└── proxy-router.api.test.mjs
```

## Test Data Management

**Gitignored (never committed):**
- `_baselines/` - Generated golden responses containing personal data
- `*.baseline.json` - Any baseline file
- `.test-env.json` - Local environment config

**Committed (safe):**
- `_utils/` - Test utilities and scripts
- `*.api.test.mjs` - Test files with invariant checks
- `CAPTURE_MANIFEST.mjs` - Endpoint paths only, no data

## Test Strategy

### Hybrid Approach
1. **Invariant tests** - Structural assertions (field exists, correct type, array not empty)
2. **Baseline tests** - Compare against captured golden responses

### Baseline Enforcement
Baselines are required, not optional. Missing baseline = loud failure with instructions:
```
MISSING BASELINE: local-content/scripture-1-nephi-1.json

Baselines are required for API integration tests.
Run: npm run test:capture-baselines

If this is a new endpoint, add it to CAPTURE_MANIFEST.mjs first.
```

### Plex Isolation
Plex tests in separate file with connectivity gate in `beforeAll`. If Plex offline, entire suite fails immediately rather than timing out per-test.

## Coverage Matrix

| Test File | Schema | Data Integrity | Reference Resolution | Metadata Mapping |
|-----------|--------|----------------|---------------------|------------------|
| `local-content.api.test.mjs` | Scripture, hymn, talk, poem | Items exist, verses populated | N/A | Author, speaker, reference |
| `folder.api.test.mjs` | List response shape | Folders resolve | Nested playlists, plex refs | Labels, thumbnails |
| `plex.api.test.mjs` | List/play shapes | Library items exist | Container → playables | Show/season/episode |
| `filesystem.api.test.mjs` | Play response shape | Files resolve | Path → media URL | Media type, duration |
| `list-router.api.test.mjs` | Modifiers work | N/A | Cross-source resolution | Unified item format |
| `play-router.api.test.mjs` | Play response shape | Watch state | Container first-item | Resume position |
| `content-router.api.test.mjs` | Generic CRUD | Progress saves/loads | N/A | Watch percentage |
| `proxy-router.api.test.mjs` | Stream headers | 404 handling | Source → file path | Content-Type, Range |

## NPM Scripts

```json
{
  "test:api": "NODE_OPTIONS=--experimental-vm-modules jest tests/integration/api --runInBand",
  "test:api:schema": "npm run test:api -- --testPathIgnorePatterns=plex",
  "test:api:plex": "npm run test:api -- --testNamePattern=Plex",
  "test:capture-baselines": "node tests/integration/api/_utils/captureBaselines.mjs",
  "test:verify-baselines": "node tests/integration/api/_utils/captureBaselines.mjs --verify"
}
```

## Developer Workflow

```bash
# First time setup (or after data changes)
npm run test:capture-baselines    # Captures from legacy API

# Regular development
npm run test:api                  # Full suite with baselines

# Quick schema-only check (no Plex required)
npm run test:api:schema

# Before legacy API teardown
npm run test:verify-baselines     # Confirms new API matches legacy
```

## Implementation Order

1. Test infrastructure utilities (`_utils/`)
2. Baseline capture script + manifest
3. Local-content tests (simplest, no external deps)
4. Folder tests (reference resolution)
5. Plex tests (external dependency)
6. Router-level tests (cross-cutting)

## Test Server Factory

```javascript
// testServer.mjs
export async function createTestServer(options = {}) {
  const config = await loadTestConfig();

  const registry = createContentRegistry({
    mediaBasePath: config.mounts.media,
    dataPath: config.mounts.data,
    watchlistPath: `${config.mounts.data}/lists.yml`,
    plex: options.includePlex ? {
      host: config.plex.host,
      token: config.plex.token
    } : null
  });

  const watchStore = createWatchStore({
    watchStatePath: `${config.mounts.data}/watch-state`
  });

  const app = express();
  const routers = createApiRouters({ registry, watchStore });

  app.use('/api/content', routers.content);
  app.use('/api/list', routers.list);
  app.use('/api/play', routers.play);
  app.use('/api/local-content', routers.localContent);
  app.use('/proxy', routers.proxy);

  return { app, registry, watchStore, config };
}
```

## Baseline Capture Manifest

```javascript
// CAPTURE_MANIFEST.mjs
export const CAPTURE_MANIFEST = {
  'local-content': [
    { legacy: '/data/scripture/cfm/1-nephi-1', new: '/api/local-content/scripture/cfm/1-nephi-1', name: 'scripture-1-nephi-1' },
    { legacy: '/data/hymn/113', new: '/api/local-content/hymn/113', name: 'hymn-113' },
    // Additional anchors...
  ],
  'plex': [
    { legacy: '/media/plex/list/81061', new: '/api/list/plex/81061', name: 'list-81061' },
    { legacy: '/media/plex/info/660440', new: '/api/play/plex/660440', name: 'play-660440' },
    // Additional anchors...
  ],
  'folder': [
    { legacy: '/data/list/morning-shows', new: '/api/list/folder/morning-shows', name: 'morning-shows' },
    { legacy: '/data/list/morning-shows/playable', new: '/api/list/folder/morning-shows/playable', name: 'morning-shows-playable' },
    // Additional anchors...
  ]
};
```

## Estimated Scope

- 8 test files
- ~15 tests per file
- ~120 integration tests total
- ~200 assertions including baseline comparisons
