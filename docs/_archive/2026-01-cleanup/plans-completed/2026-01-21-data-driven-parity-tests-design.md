# Data-Driven Parity Tests Design

**Date:** 2026-01-21
**Status:** Approved
**Goal:** Create regression test baseline using real data from lists.yml

---

## Overview

Data-driven parity testing system that:
1. Reads real content references from `lists.yml`
2. Captures legacy endpoint responses as baseline expectations
3. Validates DDD endpoints match those baselines
4. Supports tweakable expectations based on frontend usage

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | All 9 backend-routable types | Comprehensive regression coverage |
| Failure handling | Dual mode (live + snapshot) | Live for migration, snapshot for regression |
| Snapshot storage | Committed fixtures | Visible in PRs, versioned baseline |
| Execution | Jest + standalone CLI | CI integration + interactive debugging |
| Snapshot format | YAML | Consistency with project conventions |

---

## Architecture

### Components

**1. Fixture Loader** (`tests/lib/fixture-loader.mjs`)
- Reads `lists.yml` from data mount at test time
- Parses each item's `input` field to extract type and parameters
- Filters to backend-routable types (excludes `app:`)
- Returns array of test cases with: `{ type, params, label, uid }`

**2. Parity Runner** (`tests/lib/parity-runner.mjs`)
- Core test execution engine used by both Jest and CLI
- Two modes:
  - **Live mode**: Fetches both legacy and DDD endpoints, compares responses
  - **Snapshot mode**: Compares DDD response against committed baseline
- Handles response normalization (strips volatile fields)
- Returns structured results: `{ passed, failed, results[] }`

**3. Entry Points**
- `tests/integration/api/parity-data-driven.test.mjs` - Jest integration
- `tests/parity-cli.mjs` - Standalone CLI

---

## Endpoint Mapping

```yaml
# tests/fixtures/parity-baselines/endpoint-map.yml

plex:
  legacy: /media/plex/info/{id}
  ddd: /api/content/plex/{id}
  extract: "plex: {id}"

scripture:
  legacy: /data/scripture/{path}
  ddd: /api/local-content/scripture/{path}
  extract: "scripture: {path}"

hymn:
  legacy: /data/hymn/{num}
  ddd: /api/local-content/hymn/{num}
  extract: "hymn: {num}"

primary:
  legacy: /data/primary/{num}
  ddd: /api/local-content/primary/{num}
  extract: "primary: {num}"

talk:
  legacy: /data/talk/{path}
  ddd: /api/local-content/talk/{path}
  extract: "talk: {path}"

poem:
  legacy: /data/poetry/{path}
  ddd: /api/local-content/poem/{path}
  extract: "poem: {path}"

media:
  legacy: /media/local/{path}
  ddd: /api/local-content/media/{path}
  extract: "media: {path}"

list:
  legacy: /data/list/{key}
  ddd: /api/list/folder/{key}
  extract: "list: {key}"

queue:
  legacy: /data/list/{key}
  ddd: /api/list/folder/{key}
  extract: "queue: {key}"
```

---

## Snapshot Workflow

### Capture Phase

Run once initially, or when legacy behavior changes intentionally:

```bash
npm run parity:update
```

1. Load all items from lists.yml
2. For each item, call legacy endpoint
3. Normalize response (strip volatile fields)
4. Write to `tests/fixtures/parity-baselines/{type}/{id}.yml`
5. Update `manifest.yml` with capture timestamp and item count

### Test Phase

Run in CI and during development:

```bash
npm run parity:snapshot
```

1. Load all items from lists.yml
2. For each item, call DDD endpoint
3. Normalize response
4. Load expected baseline from `tests/fixtures/parity-baselines/{type}/{id}.yml`
5. Deep compare - fail if differences found

---

## Baseline File Structure

```yaml
# tests/fixtures/parity-baselines/plex/663035.yml
_meta:
  captured_at: 2026-01-21T15:30:00Z
  legacy_endpoint: /media/plex/info/663035
  source_label: "Christmas"
  source_uid: 2511aaef-ed6a-4e34-b51c-1f77ceef407e

# What frontend destructures - these MUST match
required_fields:
  - id
  - title
  - type
  - media_url
  - duration
  - metadata.thumb

# Type checks only (value can differ)
type_checks:
  - duration: number
  - metadata: object
  - metadata.thumb: string

# Exact value matches
exact_matches:
  - id
  - type

# Ignored in comparison (volatile or internal)
ignore:
  - _cached
  - timestamp
  - fetchedAt

# Optional: custom tolerance
tolerances:
  duration: 5  # allow ±5 seconds difference

response:
  status: 200
  body:
    id: "663035"
    title: "Christmas Playlist"
    type: playlist
    duration: 3600
    media_url: "/media/plex/stream/663035"
    metadata:
      thumb: "/media/plex/img/663035"
```

### Comparison Priority

1. `required_fields` - must exist in DDD response
2. `exact_matches` - values must be identical
3. `type_checks` - type must match, value can differ
4. Everything else in `response.body` - compared if not in `ignore`

### Global Defaults

```yaml
# tests/fixtures/parity-baselines/config.yml
global_ignore:
  - _cached
  - timestamp
  - fetchedAt
  - _source
  - generatedAt

global_type_checks:
  - duration: number
  - items: array
```

---

## CLI Interface

### Commands

```bash
# Capture baselines from legacy
node tests/parity-cli.mjs --update
node tests/parity-cli.mjs --update --type=plex      # single type
node tests/parity-cli.mjs --update --id=663035      # single item

# Run snapshot tests against baselines
node tests/parity-cli.mjs --snapshot
node tests/parity-cli.mjs --snapshot --type=hymn    # single type
node tests/parity-cli.mjs --snapshot --bail         # stop on first failure

# Live parity (legacy vs DDD side-by-side)
node tests/parity-cli.mjs --live
node tests/parity-cli.mjs --live --verbose          # show response diffs

# Inspect a single baseline
node tests/parity-cli.mjs --show plex/663035

# List all baselines
node tests/parity-cli.mjs --list
```

### npm Scripts

```json
{
  "scripts": {
    "parity:update": "node tests/parity-cli.mjs --update",
    "parity:snapshot": "node tests/parity-cli.mjs --snapshot",
    "parity:live": "node tests/parity-cli.mjs --live",
    "parity:list": "node tests/parity-cli.mjs --list"
  }
}
```

---

## File Structure

```
tests/
├── parity-cli.mjs                    # Standalone CLI entry point
├── lib/
│   ├── fixture-loader.mjs            # Reads lists.yml, parses inputs
│   ├── parity-runner.mjs             # Core comparison engine
│   └── endpoint-map.mjs              # Type → URL mapping
├── fixtures/
│   └── parity-baselines/
│       ├── config.yml                # Global comparison settings
│       ├── manifest.yml              # Index of all baselines
│       ├── endpoint-map.yml          # Type → endpoint mapping
│       ├── plex/
│       │   ├── 663035.yml
│       │   └── ...
│       ├── scripture/
│       ├── hymn/
│       ├── primary/
│       ├── talk/
│       ├── poem/
│       ├── media/
│       └── list/
└── integration/
    └── api/
        └── parity-data-driven.test.mjs  # Jest integration

docs/
└── runbooks/
    └── parity-testing.md             # How to use the system
```

---

## Input Type Coverage

From lists.yml analysis:

| Input Type | Count | Legacy Endpoint | DDD Endpoint |
|------------|-------|-----------------|--------------|
| `plex:` | 132 | `/media/plex/info/{id}` | `/api/content/plex/{id}` |
| `scripture:` | 11 | `/data/scripture/{path}` | `/api/local-content/scripture/{path}` |
| `media:` | 10 | `/media/local/{path}` | `/api/local-content/media/{path}` |
| `talk:` | 5 | `/data/talk/{path}` | `/api/local-content/talk/{path}` |
| `hymn:` | 4 | `/data/hymn/{num}` | `/api/local-content/hymn/{num}` |
| `poem:` | 2 | `/data/poetry/{path}` | `/api/local-content/poem/{path}` |
| `list:` | 2 | `/data/list/{key}` | `/api/list/folder/{key}` |
| `queue:` | 1 | `/data/list/{key}` | `/api/list/folder/{key}` |
| `primary:` | 1 | `/data/primary/{num}` | `/api/local-content/primary/{num}` |
| `app:` | 8 | (excluded) | (frontend routing only) |

**Total testable items: 168**

---

## Implementation Plan

1. Create `tests/lib/` directory structure
2. Implement fixture-loader.mjs
3. Implement endpoint-map.mjs
4. Implement parity-runner.mjs
5. Implement parity-cli.mjs
6. Add npm scripts to package.json
7. Run `--update` to capture initial baselines
8. Create Jest integration test
9. Write runbook documentation

---

## Related Files

- `tests/integration/api/parity.test.mjs` - Existing manual parity tests
- `docs/_wip/audits/2026-01-21-parity-audit-results.md` - Current parity status
- Data source: `{data}/households/default/state/lists.yml`
