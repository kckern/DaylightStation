# State Gates state as JSON — design

Status: approved in conversation 2026-09-25, revised after a Fable review. Spec
for review.
Context: `docs/_wip/audits/2026-09-25-backend-event-loop-stalls.md`.

## Problem

Every State Gates commit rewrites the whole state file,
`data/household[-{hid}]/state-gates/current.yml`. It is 765 KB: a 229 KB
projection plus a 497-entry journal (410 KB). Commits come with each
producer re-assertion, about 255 corrections a day, and 2–3 a minute during
a workout. A commit that emits envelopes writes twice, because `#deliver`
then calls `markPublished`.

Measured on the live file, the write
(`plain` → `mapKeys(snake)` → `yaml.dump` → write + rename) costs:

- 69–126 ms in the container;
- about 85% of an isolated `observeAssertion` commit.

The event loop is worse in the minutes that have commits:

| Minutes | Worst lag |
|---|---|
| With fitness commits | 550–1175 ms |
| With no commit | about 180–270 ms |

The 5–8× gap between the isolated write and the live stall is not explained.
The candidates are GC pressure from `yaml.dump`'s string churn, concurrent
work, and profiler overhead. The ~600 ms peak about every 5 minutes is **not**
State Gates: it contains no commit. It is the entropy report, a separate item
in the audit.

Reads are already served from an in-memory copy (2026-09-02). Only writes
remain.

## Decision

Store the same state as JSON, with the in-memory (camelCase) keys, in
`state-gates/current.json`, schema `daylight.state-gates-state/v2`. A write
becomes one `JSON.stringify` of the cached state plus one `writeFileAtomic`.

| | Write cost in the container |
|---|---|
| Today (YAML path) | 69–126 ms |
| JSON | 5–8.5 ms |

End to end, a commit goes from 68–122 ms to 18–38 ms.

Rejected or deferred:

- **Split the journal into an append-only log.** A commit would touch two
  files, which breaks the one-atomic-write contract. The stringify is 4 ms, so
  there is nothing left to win.
- **Skip no-op commits.** Identical re-asserts with the same `sourceRevision`
  are already skipped (`StateGatesEngine.mjs:260`). A same-value re-assert with
  a new `sourceRevision` must stay durable, or the `STALE_SOURCE_REVISION`
  check weakens across restarts.
- **Off-thread serialisation, smaller journal retention, fsync.** None is
  worth it at 4 ms. Durability is unchanged: neither path fsyncs today, and
  ext4 `auto_da_alloc` flushes on rename-over-existing.

## Behaviour

### Write

- `#write` serialises `{ ...state, schema: 'daylight.state-gates-state/v2' }`
  with `JSON.stringify` (compact) and passes the resulting string to the
  injected `save(jsonPath, content)`. The default `save` is `writeFileAtomic`.
- No `plain()` or `mapKeys()` runs on the write path. This was verified on
  the live state:
  - `commit()` already runs `plain()` on caller input (`:148-149`);
  - `markPublished` and compaction only spread and filter;
  - there are no `Date`, `undefined`, `NaN`, `Infinity`, `Map` or `Set`
    values;
  - timestamps are epoch ms.
- Behaviour flip, guarded by a test: js-yaml throws on `undefined`, while
  JSON silently drops the key and turns `NaN` into `null`. The matrix test's
  injected `save` asserts that `JSON.parse(content)` deep-equals the cached
  state, so any future non-plain value fails loudly in tests.
- Failure path unchanged. A failed save drops the cached copy, logs
  `state-gates.cache-dropped-after-failed-write`, and throws
  `STATE_GATES_STATE_UNAVAILABLE`.
- **Timing event.** Each write logs `state-gates.state.written`
  `{ householdId, durationMs, bytes, journalEntries }` at debug. It is
  rate-sampled at info, so the log store can show the effect.

### Read (first access per household)

Explicit injectables, with no sniffing of file extensions:

- `load(jsonPath)` returns the parsed v2 object or null (a missing file).
  The default is JSON parse of the file.
- `loadLegacy(ymlPath)` returns the parsed v1 object or null. The default is
  today's `readYamlFromPath`.

Order:

1. **`current.json` exists:**
   - require schema `v2` and use it as is;
   - **guard:** if `current.yml` also exists and its mtime is newer than
     `current.json`'s, fail with `STATE_GATES_STATE_UNAVAILABLE` (code
     `LEGACY_STATE_NEWER`). That means an older build ran after the switch.
     Silently preferring JSON would discard that window: a double loss.
     Composition already tolerates a State Gates startup failure
     (`stateGates.mjs:224`).
2. **Else `current.yml` exists:** read it through the v1 path (require
   schema `v1`, `mapKeys(camel)`, verified byte-stable on the live state).
   Log `state-gates.state.migrated` `{ householdId, householdRevision }` once.
   The next commit writes `current.json`.
3. **Else:** empty state.

Other failures:

- An unknown schema in either file fails with `UNSUPPORTED_STATE_SCHEMA`.
- A JSON parse error is a read failure (`STATE_GATES_STATE_UNAVAILABLE`),
  never a YAML fallback: the YAML is stale by definition.

### Migration and rollback

- The engine never modifies or deletes `current.yml`.
- **Rollback** to an older build reads the stale `current.yml`:
  - the household revision regresses;
  - changes since the switch are lost;
  - subscribers holding a newer replay cursor get `INVALID_REPLAY_CURSOR`
    (400) and must resubscribe.
- **Roll-forward** after such a rollback trips the mtime guard. The operator
  then either:
  - keeps the newer YAML (delete or move `current.json`, which re-migrates);
    or
  - restores `current.json` and moves the YAML aside.
- **Converter.** An exported, tested `toLegacyV1Yaml(state)` (reusing
  `mapKeys(snake)`) and a one-line CLI turn `current.json` back into a v1
  `current.yml`. That makes a deliberate rollback lossless.
- Recovery of a lost `current.json` is from Dropbox version history on the
  data tree. The runbook documents this.

### Unchanged

- Retention: 500 entries, 7 days.
- Compaction.
- Per-household serialisation.
- The replay cursor contract.
- The repositories that sit on top of the engine.

## Interface changes

Constructor: `resolveFilePath` (JSON), `resolveLegacyFilePath` (YAML),
`load`, `loadLegacy`, `save(path, string)`, retention and `logger`.

Composition passes
`…/state-gates/current.json` and `…/state-gates/current.yml`.

The class name `YamlStateGatesStateEngine` stays. The honest reason is to
avoid churning blame in a performance fix; a comment says so. A rename of the
engine and both repositories together can follow separately.

## Tests

- **Matrix** (`tests/isolated/adapter/state-gates/stateGatesPersistence.matrix.test.mjs`):
  - the interrupted-write and CAS cases run against the JSON store;
  - the injected `save` receives a string;
  - that string round-trips (`JSON.parse` deep-equals the cached state).
- **Cache and adapters** (`stateGatesStateEngineCache.test.mjs`,
  `stateGatesAdapters.test.mjs`): their injected saves are updated for the
  string content; behaviour is otherwise unchanged.
- **Migration:**
  - a v1 YAML fixture is read, commits, and produces v2 JSON with the same
    projection, journal and checkpoints;
  - `current.yml` is left unchanged;
  - it also drives `markPublished`, so `published` flags and
    `deliveryCheckpoint` survive v1 → v2.
- **Precedence and guards:**
  - when both files exist and the JSON is newer, the JSON wins;
  - when the YAML is newer, the read fails with `LEGACY_STATE_NEWER`;
  - corrupt JSON is a read failure, never a YAML fallback;
  - an unknown schema is `UNSUPPORTED_STATE_SCHEMA`.
- **Converter:** `toLegacyV1Yaml` then the v1 read round-trips the live-shaped
  fixture.
- **Composition expectations to update:**
  - `backend/src/5_composition/composition-contract-registry.test.mjs:94`;
  - `backend/src/5_composition/modules/stateGates.retry.test.mjs:205-206`;
  - both expect `current.json` now.
- **No wall-clock ceiling in the gate.** It would flake under gate swap
  pressure, and the old path is only about 1.3× over it. A structural
  assertion covers it instead: one `save` per commit, string content. A
  production-sized timing bench lives outside the gate
  (`scripts/bench/state-gates-write.mjs`).

## Verification after deploy

- `current.json` exists; its `householdRevision` advances; `state-gates.state.migrated` logged once.
- `state-gates.state.written` `durationMs` is single-digit to low-tens of ms.
- Compare worst lag in minutes with a State Gates commit
  (`state-gates.assertion.corrected` timestamps) against minutes without one.
  Commit-minutes should fall toward the ~200 ms floor. The 5-minute peak is
  out of scope: that is the entropy report.

## Docs and tooling to update

- `docs/reference/state-gates/integration-and-operations.md`: the persistence
  section and journal retention (lines ~142, 145, 192), the migration, the
  mtime guard, the converter CLI, rollback and cursor effects, and Dropbox
  recovery.
- `docs/reference/state-gates/README.md` (~89, 108, 110) and
  `architecture.md` (~991, 1003): the path and schema.
- The engine's comment (`:54`) and composition's (`stateGates.mjs:54`).
- `tests/preimplementation/application-modules/tooling/review-storage-consumers.mjs:219`:
  adjudicate `writeFileAtomic` as the engine's default save.
- `docs/_wip/audits/2026-09-25-backend-event-loop-stalls.md`:
  - move this item to "Fixed" once verified;
  - correct the attribution: the 5-minute peak is the entropy report.
