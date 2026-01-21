# Parity Testing Runbook

## Overview

The parity test system validates that DDD (new) endpoints return responses compatible with legacy endpoints. It uses real data from `lists.yml` to generate test cases.

## Quick Reference

```bash
# Capture baselines from legacy (run once, or when legacy changes)
npm run parity:update

# Test DDD endpoints against baselines
npm run parity:snapshot

# Compare legacy vs DDD live (during migration)
npm run parity:live

# List baseline coverage
npm run parity:list
```

## When to Update Baselines

Update baselines when:
1. **Initial setup** - Run `npm run parity:update` to capture all baselines
2. **Intentional legacy changes** - If legacy behavior changes intentionally
3. **New content added** - If new items are added to lists.yml
4. **After fixing legacy bugs** - Capture the corrected response

```bash
# Update all baselines
npm run parity:update

# Update single type
node tests/parity-cli.mjs --update --type=plex

# Update single item (useful for debugging)
node tests/parity-cli.mjs --update --type=plex --id=663035
```

## Investigating Failures

### 1. Run with verbose output

```bash
node tests/parity-cli.mjs --snapshot --verbose
```

### 2. Check specific item

```bash
# Show the baseline
node tests/parity-cli.mjs --show plex/663035

# Compare manually
curl localhost:3112/media/plex/info/663035 | jq .
curl localhost:3112/api/content/plex/663035 | jq .
```

### 3. Check what frontend expects

Look at how frontend destructures the response. Only fields the frontend uses need to match exactly.

### 4. Tweak expectations

Edit the baseline file to add:
- `required_fields` - Fields that must exist
- `type_checks` - Fields where only type matters
- `ignore` - Additional fields to skip

Example:
```yaml
# tests/fixtures/parity-baselines/plex/663035.yml
_meta:
  captured_at: 2026-01-21T15:30:00Z

required_fields:
  - id
  - title
  - type

type_checks:
  - duration

ignore:
  - thumb_url  # Different CDN in legacy vs new

response:
  status: 200
  body:
    id: "663035"
    title: "Christmas"
    # ...
```

## CI Integration

The Jest test runs in CI:

```bash
npm test -- parity-data-driven
```

This runs all snapshot comparisons and fails if any DDD response differs from baseline.

## Input Types

| Type | Legacy Endpoint | DDD Endpoint |
|------|-----------------|--------------|
| plex | `/media/plex/info/{id}` | `/api/content/plex/{id}` |
| scripture | `/data/scripture/{path}` | `/api/local-content/scripture/{path}` |
| media | `/media/local/{path}` | `/api/local-content/media/{path}` |
| talk | `/data/talk/{path}` | `/api/local-content/talk/{path}` |
| hymn | `/data/hymn/{num}` | `/api/local-content/hymn/{num}` |
| poem | `/data/poetry/{path}` | `/api/local-content/poem/{path}` |
| list | `/data/list/{key}` | `/api/list/folder/{key}` |
| queue | `/data/list/{key}` | `/api/list/folder/{key}` |
| primary | `/data/primary/{num}` | `/api/local-content/primary/{num}` |

## File Structure

```
tests/
├── parity-cli.mjs                    # CLI entry point
├── lib/
│   ├── endpoint-map.mjs              # Type → URL mapping
│   ├── fixture-loader.mjs            # Reads lists.yml
│   └── parity-runner.mjs             # Comparison logic
├── fixtures/
│   └── parity-baselines/
│       ├── config.yml                # Global settings
│       ├── endpoint-map.yml          # Endpoint patterns
│       ├── plex/*.yml                # Plex baselines
│       ├── scripture/*.yml           # Scripture baselines
│       └── ...
└── integration/
    └── api/
        └── parity-data-driven.test.mjs
```

## Troubleshooting

### "No baseline found"

Run `npm run parity:update` to capture baselines.

### "Server not responding"

Start the dev server: `npm run dev`

### "Timeout" errors

- Check if Plex is online for plex type tests
- Increase timeout in `tests/fixtures/parity-baselines/config.yml`

### Many failures after DDD changes

If you intentionally changed DDD response structure:
1. Verify changes are correct
2. Update baselines: `npm run parity:update`
3. Review and commit baseline changes

## Global Configuration

Global ignore and type check settings are in `tests/fixtures/parity-baselines/config.yml`:

```yaml
global_ignore:
  - _cached
  - timestamp
  - fetchedAt
  - _source
  - generatedAt
  - lastUpdated
  - _meta

global_type_checks:
  duration: number
  items: array
  id: string
```

These apply to all comparisons automatically.
