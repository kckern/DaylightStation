# Vitest gate: population widened to include `backend/` — handoff

**Date:** 2026-08-23
**Status:** gate is GREEN and usable; 12 pre-existing failures baselined as debt
**Touches:** `scripts/gate-vitest.mjs`, `scripts/audit-baseline.vitest.txt`

---

## What was wrong

`scripts/gate-vitest.mjs` decided a test file's runner by its **path**: it walked
`tests/unit` and `tests/isolated` only, excluded `/backend/` wholesale on the
belief that the whole backend tree was node:test, and required an explicit
`from 'vitest'` import.

All three assumptions were false:

| Assumption | Reality |
|---|---|
| `backend/` is node:test | 92 backend files are node:test; ~350 colocated `backend/src` and `backend/tests/unit` files are **vitest** |
| A vitest file imports `vitest` | `globals: true` is set, so many files use bare `describe`/`it`/`expect` with no import at all |
| The population is the vitest world | ~400 files were run by **no npm script whatsoever** |

Anything inside that hole could rot silently. Two concrete cases found:

- **`backend/src/3_applications/quizzes/quizScanRecorder.test.mjs`** — every
  spec threw `createQuizScanRecorder: outRoot required`. The recorder moved to
  explicit `outRoot`/`historyRoot` parameters when the quizzes tree was folded
  under `school/`, and this test still passed `dataDir` alone. This is on the
  **live OMR grading path** and had been red for an unknown length of time.
- **`tests/isolated/assembly/system/config/configLoader.test.mjs`** — four specs
  asserted `config.systemAuth`, which `configLoader.mjs` deliberately removed
  ("now handled by SecretsHandler"). Dead specs testing a deleted API.

Both are fixed. `SecretsHandler` keeps its own coverage under `tests/unit/suite/secrets/`.

## What changed in the gate

1. **Ownership is decided by content, not path** (`isVitestOwned`): an explicit
   `from 'vitest'` import, or bare globals with no runner import at all. A
   `node:test` or `@jest/globals` import means another runner owns the file.
2. **`backend/` joined the roots**; the blanket `/backend/` exclude is gone,
   `node_modules/` is excluded instead.
3. **The walk no longer follows symlinks.** `backend/shared` and
   `backend/shared-contracts` both point up at `shared/`. Following them
   collected the same file twice under two paths, and the aliased copy could
   not even load — its own relative imports resolve against the real directory,
   not the link.
4. **Worker parallelism is capped** at half the machine's cores.

Population: **880 → 1261 files**, 10,851 → 15,176 tests.

## What is baselined, and why that is not "fixed"

Widening the population surfaced **12 pre-existing failures**. None were caused
by this change; all were simply never run by any gate. They are recorded in
`scripts/audit-baseline.vitest.txt` so the gate returns to catching *new*
regressions immediately. **Baselined means visible and owed, not acceptable.**

| File | Symptom |
|---|---|
| `1_adapters/chess/StockfishEngineAdapter.test.mjs` | passes alone; fails in the full run |
| `1_adapters/fitness/YamlWorkoutRepository.test.mjs` | several assertions false; a null `.title` read |
| `1_adapters/glossika/LegacyDumpReader.test.mjs` | `ReferenceError: two is not defined` — a genuine bug in the spec |
| `3_applications/gameshow/GameShowService.test.mjs` | one deep-equal mismatch on a learner record |
| `3_applications/school/documents/RenderPrintDocument.test.mjs` | 101/101 alone; fails in the full run |
| `4_api/v1/agents/mountAgentHttp.test.mjs` | two mock call-argument mismatches |
| `4_api/v1/agents/wireFormats/native.test.mjs` | payload shape drift (extra fields vs expected) |
| `4_api/v1/routers/piano.courses.test.mjs` | `createPianoRouter: pianoContainer required` — API drift, same class as quizScanRecorder |
| `4_api/v1/routers/piano.effect-audit.test.mjs` | same |
| `4_api/v1/routers/piano.loop-manifest.test.mjs` | same |
| `tests/isolated/.../resolvers/scripture.test.mjs` | 9/9 alone; fails in the full run |
| `tests/isolated/assembly/infrastructure/infrastructure-ownership.test.mjs` | fails only in the full run |

## Open item — cross-file pollution (do this first)

**Several of the above pass in isolation and fail only in the full run**, with a
*different* file taking the hit between runs — `quizScanRecorder`,
`RenderPrintDocument`, `curriculumPlanner` and `scripture` have each flaked at
least once. Capping workers made the set reproducible but did not eliminate it,
and running the affected files alone under the gate's own
`--config vitest.config.mjs` passes. So the cause is **state leaking between
test files**, not worker count.

Consequence to watch: a file that flakes *into* passing is fine (the ratchet
tolerates it), but a file that flakes *into* failing while not baselined reads
as a false regression. `curriculumPlanner.test.jsx` and `quizScanRecorder` are
the two known candidates — neither is baselined, both have flaked once.

Suggested starting points:
- The pool is `pool: 'threads'` (deliberate — see the config's own note about
  the forks pool crashing under load). Confirm `isolate` is on for it.
- Look for specs that mutate shared globals without restoring: prototype
  patches, `process.env` writes, module-registry mocks. One real instance of
  this class was already found and fixed in
  `tests/isolated/rendering/school/documentReceiptRenderer.test.mjs` (see below).
- Bisect by halving the file list until the poisoning pair is isolated.

## Related fix worth knowing about

The repo carries **two installs of `canvas`** — one at the root and one under
`backend/`. They are separate native modules with separate prototypes, and
renderers under `backend/src` resolve the backend copy.

`documentReceiptRenderer.test.mjs` patched the **root** copy's
`CanvasRenderingContext2D.prototype` to spy on draw calls. It intercepted
nothing: one spec failed on an empty array, and a second passed **vacuously**
(`[] toEqual []` reads as "no glyphs drawn" when it actually means "nothing was
observed"). `canvas` is now resolved via `createRequire` from the renderer's own
directory, and each spec asserts its spy caught *something*, so a future
duplication fails loudly rather than going quiet.

**Any test that spies by patching a native module's prototype is suspect for the
same reason.** Grep for `prototype.` in test files before trusting one.

## Unrelated, pre-existing: two layer-audit ratchet regressions

`node scripts/audit-layer-imports.mjs` reports two counters above baseline:

- `apps-success-false` — 60 vs baseline 49
- `domains-tojson` — 74 vs baseline 67

These are **not** from the print/OMR work: no `school` file matches either
counter. The `success: false` occurrences concentrate in `nutribot` (15),
`journalist` (7), `homebot` (3) and `agents` (3). They are left un-baselined
deliberately, so they stay visible until someone owns them. Do not `--update`
the layer-audit baseline to silence them.
