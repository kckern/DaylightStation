# Fitness Session Persistence Nerf Audit (2026-02-06)

## Scope
Audit the regression (“nerfing”) of persisted fitness session data between a pre‑regression session file and the current persistence path. Compare:
- Pre‑regression example: 2026‑01‑23 session file (v3 with readable timestamps and rich events)
  - Data path: /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/apps/fitness/sessions/2026-01-23/20260123051939.yml
- Current observed output: 2026‑02‑06 session file (numeric timestamps, no events)
  - Data path: /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/apps/fitness/sessions/2026-02-06/20260206182302.yml

## Executive summary
The persistence pipeline now **drops readable timestamps** and **loses media/challenge/voice events** at save time. The loss is caused by a **frontend/backend contract break** introduced during DDD migration and payload optimization:
1) Frontend moves/discards `timeline.events` and emits root‐level `events`.
2) Backend only reads `timeline.events` and ignores root `events` when normalizing the payload.
3) Backend persists `startTime`/`endTime` as unix ms rather than readable strings.

Result: modern session YAML files are materially degraded versus Jan 23 format.

## Evidence comparison (Jan 23 vs Feb 6)
### Jan 23 session (pre‑regression)
- Contains **human‑readable times**:
  - `session.start`, `session.end` (YYYY‑MM‑DD HH:mm:ss)
  - `events[*].at` timestamps
- Contains **rich root `events`**:
  - `media_start` entries with music metadata
  - `voice_memo` entries with transcripts
- Uses **v3 block** (`version: 3`, `session`, `participants`)

### Feb 6 session (regressed)
- **Numeric `startTime`/`endTime` only** (unix ms)
- **`events` empty or absent**
- `timeline.events` removed prior to persistence
- No `session.start`/`session.end` human‑readable fields

## Root causes
### 1) Events lost due to contract mismatch
- Frontend: `PersistenceManager.persistSession()` removes `timeline.events` and writes root `events`.
- Backend: `SessionService.normalizePayload()` only uses `timeline.events` (and never merges root `events`).
- Outcome: events are discarded before persistence.

### 2) Human‑readable timestamps dropped
- Backend normalizes/serializes to unix ms for storage.
- Legacy path preserved readable strings (either persisted or converted back on read).
- Current YAML storage is numeric‑only even when readable strings were sent.

### 3) v3 serializer exists but unused
- `SessionSerializerV3` can produce v3 output with readable timestamps and events blocks.
- `persistSession()` does not use it; instead it crafts a mixed v2/v3‑ish payload and relies on backend normalization.

## Timeline (regression window)
### Key commits
- 2026‑01‑20 — `ad51f3ecc73e8fac5dc4fe9cc64b81de43ab7815`
  - Optimize fitness session persistence payload
  - Moves events to root, removes `timeline.events`, compacts series keys, removes duplicate fields.
- 2026‑01‑26 — `4191bfee4af30912a478b08cf3cafad1d0b192e2`
  - Remove legacy backend (including legacy session normalizer that preserved readable timestamps).
- 2026‑01‑28 — `6cc1e2c8584c3912d7f9cf9478582805d8b611ea`
  - Fix PersistenceManager save endpoint path to `/api/v1/fitness/save_session`.

### Timeline summary
- 2026‑01‑20: Payload optimization in `PersistenceManager` (event relocation, series compaction, field removals).
- 2026‑01‑26: Legacy backend removed, new DDD backend became sole persistence path.
- 2026‑01‑28: Endpoint path updated to `/api/v1/fitness/save_session`.

## Impact assessment
- **Loss of music history** in sessions → impacts post‑workout review and governance correlation.
- **Loss of challenge/voice memo context** → undermines analytics and recall features.
- **Human‑readable timestamps removed** → worsens legibility in raw YAML and manual inspection.
- **Inconsistent schema** across date range → complicates tooling and analysis.

## Recommended fixes (choose one path)
### Option A — Restore v2‑style storage compatibility (minimal change)
- Backend: merge root `events` into `timeline.events` when normalizing payloads.
- Backend: preserve readable timestamps (store both numeric and readable, or convert back on save).
- Frontend: keep current payload shaping.

### Option B — End‑to‑end v3 persistence (cleaner schema)
- Frontend: use `SessionSerializerV3.serialize()` for save payload.
- Backend: accept v3 events structure and store v3 format without converting to unix ms.
- Result: stable human‑readable timestamps and explicit `events` sections.

### Option C — Dual‑write for compatibility (migration‑safe)
- Store both readable and numeric time fields.
- Store events in both `events` and `timeline.events` (or add a legacy copy).

## Open questions
- Desired canonical storage format: v2-ish (timeline.events) vs v3 (session/events blocks)?
- Is it acceptable to store redundant fields during migration for stability?

## Next steps
1) Pick Option A/B/C.
2) Implement backend normalization fix (if A/C) and/or v3 persistence (if B).
3) Add a migration/compatibility note in fitness reference docs.
4) Add regression test: save session with `events` and verify stored YAML includes them.

## Related code
- frontend/src/hooks/fitness/PersistenceManager.js
- frontend/src/hooks/fitness/SessionSerializerV3.js
- backend/src/2_domains/fitness/services/SessionService.mjs
- backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs
