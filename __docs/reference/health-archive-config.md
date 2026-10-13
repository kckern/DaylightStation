# Health-Archive Ingestion Config

Per-user config consumed by `npm run ingest:health-archive --user <userId>`. The
real config lives at `data/users/<userId>/config/health-archive.yml` (gitignored).
Copy the template below to that location and fill in real source paths for your
machine, then invoke the CLI to mirror the relevant subset of an external health
archive into DaylightStation.

## Recognized categories

Only these keys are valid under `sources:`:

- `nutrition-history`
- `scans`
- `notes`
- `playbook`
- `weight`
- `workouts`

`enabled: false` skips a category without removing it from the config.

## Destination paths

Destinations are derived automatically from the category:

| Category | Destination |
|----------|-------------|
| `scans` | `media/archives/scans/<userId>/` (raw bulk binaries) |
| every other category | `data/users/<userId>/lifelog/archives/<category>/` (structured) |

## Sync behavior

Ingestion is read-only — the external archive remains source of truth and
DaylightStation maintains a clone for query/coaching purposes.

`sync.cadence` is currently informational. `manual` is the supported mode (only
ingests when the CLI is invoked by hand). `daily` is reserved for a future
scheduled job.

## Template

```yaml
# data/users/<userId>/config/health-archive.yml

sources:
  scans:
    path: /absolute/path/to/your/health-archive/scans
    enabled: true
  notes:
    path: /absolute/path/to/your/health-archive/notes
    enabled: true
  playbook:
    path: /absolute/path/to/your/health-archive/playbook
    enabled: true
  nutrition-history:
    path: /absolute/path/to/your/health-archive/nutrition
    enabled: false
  weight:
    path: /absolute/path/to/your/health-archive/weight
    enabled: false
  workouts:
    path: /absolute/path/to/your/health-archive/workouts
    enabled: false

sync:
  cadence: manual
```

## Privacy boundary

The ingestion service hard-fails when the source path matches any of these
keywords (case-insensitive): `email`, `chat`, `finance`, `journal`,
`search-history`, `calendar`, `social`, `banking`. Path-traversal and
read-scope enforcement are handled separately by `HealthArchiveScope`
(see Task 11 / F-106).
