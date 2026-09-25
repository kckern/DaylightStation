# State Gates state as JSON — design

Status: approved in conversation 2026-09-25; spec for review.
Context: `docs/_wip/audits/2026-09-25-backend-event-loop-stalls.md`.

## Problem

`YamlStateGatesStateEngine.#write` blocks the backend event loop for 0.6–0.9 s
per commit, and commits arrive every few minutes. Producers re-assert values
often (the kiosk friction score; fitness weekly rings during a session). Every
commit rewrites the whole state file, `data/household[-{hid}]/state-gates/current.yml`.
It is 765 KB: a 229 KB projection plus a 497-entry journal (410 KB). The write
cost has four parts:

1. `plain(state)`: a deep copy walk;
2. `mapKeys(..., snake)`: a second deep walk renaming keys;
3. `yaml.dump(..., { sortKeys: true })`;
4. the atomic write.

Reads are already served from an in-memory copy (2026-09-02). Only writes
remain expensive.

## Decision

Store the same state as JSON, with the in-memory (camelCase) keys, in
`state-gates/current.json`, schema `daylight.state-gates-state/v2`. A write
becomes one `JSON.stringify` of the cached state plus one atomic file write.

Rejected:

- **Split journal into an append-only log.** A commit would touch two files.
  That breaks the one-atomic-write-per-commit contract and needs new
  crash-recovery ordering. It is more risk for less gain.
- **Skip no-op commits.** This is complementary, not an alternative: it cuts
  write frequency, not write cost. Revisit only if commit frequency still
  matters after this change.

## Behaviour

### Write

- `#write(householdId, state)` serialises `{ ...state, schema: 'daylight.state-gates-state/v2' }`
  with `JSON.stringify` (no indentation) and writes it atomically to
  `current.json` through FileIO's atomic write (`writeFileAtomic`; temp file +
  rename).
- The state is plain by construction: `commit()` passes caller input through
  `plain()` before it touches the cached copy. So neither `plain()` nor
  `mapKeys()` runs on the write path.
- The failure path is unchanged. A failed save drops the cached copy, logs
  `state-gates.cache-dropped-after-failed-write`, and throws
  `STATE_GATES_STATE_UNAVAILABLE`.

### Read (first access per household)

1. If `current.json` exists: parse it, require schema `v2`, use it as is (no
   key mapping).
2. Else if `current.yml` exists: read it through today's v1 path (require
   schema `v1`, `mapKeys(camel)`). The next commit writes `current.json`.
3. Else: empty state.

When both files exist, JSON wins. An unknown schema in either file fails with
`UNSUPPORTED_STATE_SCHEMA`, as today. A JSON parse error is a read failure
(`STATE_GATES_STATE_UNAVAILABLE`). It never falls back to the YAML file,
because that file is stale by definition once JSON exists.

### Migration and rollback

- The engine never modifies or deletes `current.yml`. After the first commit
  it is a stale snapshot of the pre-switch state.
- Rolling back to a build without this change reads that stale `current.yml`.
  The household revision goes backwards and every change since the switch is
  lost. This is recoverable, but not silent. Documented in the operations
  runbook along with the manual path: convert `current.json` back to the v1
  YAML shape.

### Unchanged

- Retention: `maxEntries` 500 and `maxAgeMs` 7 days.
- Compaction.
- Per-household serialisation.
- Replay cursor semantics.
- The repositories that sit on top of the engine.

## Interface changes

- The `YamlStateGatesStateEngine` constructor keeps `filePath` /
  `resolveFilePath`, now naming the `.json` path.
- A new optional `resolveLegacyFilePath` names the `.yml` path to migrate
  from.
- `load` / `save` injectables keep their role for tests. The default `load`
  dispatches on the file extension.
- Composition (`5_composition/modules/stateGates.mjs`) passes
  `…/state-gates/current.json` and the legacy `…/state-gates/current.yml`.
- The class name stays. Renaming it would ripple through composition and
  tests for no behavioural gain; a comment records that the storage is JSON.

## Tests

- `tests/isolated/adapter/state-gates/stateGatesPersistence.matrix.test.mjs`: the interrupted-write and CAS cases
  run against the JSON store.
- `stateGatesStateEngineCache.test.mjs` and `stateGatesAdapters.test.mjs`
  (same folder) keep passing: cache and repository behaviour does not change.
- Migration: a v1 YAML fixture on disk is read, commits, and produces v2 JSON
  with the same projection, journal and checkpoints; `current.yml` is
  unchanged.
- Precedence: when both files exist, the JSON content is served.
- A corrupt JSON file is a read failure, never a YAML fallback.
- An unknown schema in JSON or YAML is `UNSUPPORTED_STATE_SCHEMA`.
- Cost: a fixture the size of production (about 130 assertions, 260
  evaluations, 500 journal entries) commits in under 50 ms on the dev host.
  This is a loose ceiling that catches a regression to YAML-class cost.

## Verification after deploy

- `system.event-loop.lag` no longer shows the ~600 ms peak every 5 minutes.
- `current.json` exists and its household revision advances.
- `state-gates.assertion.corrected` keeps flowing; replay and entitlement
  reads are unchanged.

## Docs

- `docs/reference/state-gates/integration-and-operations.md`: the persistence
  section (file, format, migration, rollback).
- `docs/_wip/audits/2026-09-25-backend-event-loop-stalls.md`: move this item
  to "Fixed" once verified.
