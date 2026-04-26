# Pre-existing Test Failures Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the entire vitest suite (backend + frontend + isolated) back to green by fixing 731 pre-existing failures, with high-leverage infrastructure fixes first to cascade-resolve hundreds of dependent failures before tackling domain-specific work.

**Architecture:** Six phases, ordered by leverage. Phase 1 fixes test-env infrastructure (jest-dom, localStorage, @jest/globals migration, jsdom, package exports) — expected to convert hundreds of failures from "throws during setup" to either "pass" or "asserts on real behavior". Phases 2–5 fix specific domain bugs surfaced after Phase 1 lands. Phase 6 is a forensic re-baseline of any residual failures the prior phases didn't reach. Each phase commits independently and is fully revertable.

**Tech Stack:** vitest 4.0.18, @testing-library/react, @testing-library/jest-dom, happy-dom (frontend), Node ESM (backend `.mjs`), jsdom (where required).

**Branch / worktree:** Recommended new branch off `main` (or off `fix/trigger-sequence-2026-04-25` if that hasn't merged yet — the dependencies are minimal). From repo root:
```bash
git worktree add ../DaylightStation-suite-greening -b fix/test-suite-greening
cd ../DaylightStation-suite-greening
```

**Source of truth:** `docs/_wip/audits/2026-04-25-pre-existing-test-failures-audit.md` (initial 24-test audit) and the comprehensive 731-test inventory captured in this plan's research phase.

---

## Test commands cheat-sheet

- **Backend suite:** `npx vitest run backend/tests/unit/suite/ 2>&1 | tail -50`
- **Frontend suite:** `npx vitest run frontend/src/ 2>&1 | tail -50`
- **Isolated suite:** `npx vitest run tests/isolated/ 2>&1 | tail -50`
- **Single file:** `npx vitest run <path>`
- **Watch single file:** `npx vitest <path>`
- **Failure summary across suites (after each phase):** `npx vitest run 2>&1 | grep -E "^(Test Files|Tests)" | tail -10`

**Parsing tip:** vitest output has a final summary like `Tests  N failed | M passed (K)` — that's the headline number. Track it after every phase to verify the leverage hypothesis.

---

## Re-baseline checkpoints

After **every phase**, capture the failure count and append to a running ledger at the bottom of this plan (or just to the commit message):

```
Pre-Phase-1:  731 failed
Post-Phase-1: ??? failed   # expected: ~150 (most are cascade-cured)
Post-Phase-2: ???
...
Post-Phase-6: 0
```

This is your sanity check. If a phase doesn't move the needle, **stop and re-investigate** — the inventory may have a wrong root cause.

---

## Phase 1 — Test environment infrastructure (HIGH LEVERAGE)

**Why first:** Six categories of failure are config/env-level — they cascade across hundreds of tests. Fixing them first either makes those tests pass outright, OR converts them from "throws during setup" to "asserts on real behavior" (so the remaining bugs become visible and isolated).

### Task 1.1: Migrate `WebSocketContentAdapter.test.mjs` from `@jest/globals` to vitest

**Files:**
- Modify: `backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs`

**Step 1.1.1: Read current imports**

```bash
head -10 backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs
```

Confirm the file imports `from '@jest/globals'`.

**Step 1.1.2: Replace the import**

Change:
```js
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
```
to:
```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

Then `grep -n "jest\." backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs` — every `jest.fn()` / `jest.spyOn()` etc. needs renaming to `vi.fn()` / `vi.spyOn()` etc. Vitest's `vi` is API-compatible with jest's `jest` for the common cases.

**Step 1.1.3: Run the file**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs
```

Expected: file no longer errors during load. Tests may now pass, or may surface real failures — record either result.

**Step 1.1.4: Commit**

```bash
git add backend/tests/unit/suite/1_adapters/devices/WebSocketContentAdapter.test.mjs
git commit -m "test(devices): migrate WebSocketContentAdapter test from @jest/globals to vitest"
```

### Task 1.2: Configure `@testing-library/jest-dom` globally for frontend vitest

**Why:** ~80 frontend tests fail with `Invalid Chai property: toBeInTheDocument` because the jest-dom matchers aren't extending vitest's expect.

**Files:**
- Modify: `frontend/vite.config.js` (or `frontend/vitest.config.js` if separate)
- Modify or create: `frontend/src/test-setup.js` (per the existing reference in vitest config — verify it exists and is loaded)

**Step 1.2.1: Inspect current vitest config**

```bash
cat frontend/vite.config.js | grep -A 20 "test:"
ls -la frontend/src/test-setup.js
```

Confirm:
- `vite.config.js` has a `test:` block with `setupFiles: './src/test-setup.js'` (or similar)
- `test-setup.js` exists

**Step 1.2.2: Read setup file**

```bash
cat frontend/src/test-setup.js
```

If it doesn't already do `import '@testing-library/jest-dom';`, add that line at the top.

**Step 1.2.3: If `setupFiles` is missing from vitest config**

Add to `frontend/vite.config.js`:
```js
test: {
  environment: 'happy-dom',
  globals: true,
  setupFiles: ['./src/test-setup.js'],
  // …existing config
},
```

**Step 1.2.4: Sanity-test one previously-failing file**

```bash
npx vitest run frontend/src/screen-framework/layouts/GridLayout.test.jsx
```

Expected: `toBeInTheDocument` errors gone. Tests may now pass or reveal real assertion failures — either is progress.

**Step 1.2.5: Commit**

```bash
git add frontend/src/test-setup.js frontend/vite.config.js
git commit -m "test(frontend): configure @testing-library/jest-dom globally via vitest setupFiles"
```

### Task 1.3: Add `localStorage` polyfill to frontend test environment

**Why:** ~20 frontend tests fail with `ReferenceError: localStorage is not defined`. happy-dom doesn't provide localStorage by default.

**Files:**
- Modify: `frontend/src/test-setup.js`

**Step 1.3.1: Confirm happy-dom doesn't expose localStorage**

```bash
npx vitest run frontend/src/modules/Media/session/persistence.test.js 2>&1 | grep -A 2 "ReferenceError"
```

Expected: at least one `ReferenceError: localStorage is not defined`.

**Step 1.3.2: Add a minimal in-memory polyfill**

In `frontend/src/test-setup.js`, after the jest-dom import:

```js
// happy-dom doesn't provide localStorage — add a simple in-memory polyfill
// so persistence tests work consistently across runs.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
}
```

**Step 1.3.3: Verify the polyfill is loaded fresh per test file**

happy-dom isolates per test file (a new global per file). The polyfill above only adds if `localStorage` isn't already defined — so it persists across tests *within* a file. That matches browser semantics. Tests that need a clean slate should call `localStorage.clear()` in `beforeEach` (existing practice).

**Step 1.3.4: Re-run a failing test**

```bash
npx vitest run frontend/src/modules/Media/session/persistence.test.js
```

Expected: `ReferenceError` gone. Tests may now pass.

**Step 1.3.5: Commit**

```bash
git add frontend/src/test-setup.js
git commit -m "test(frontend): add in-memory localStorage polyfill for happy-dom"
```

### Task 1.4: Install jsdom for tests that need a real DOM environment

**Why:** `tests/isolated/modules/Admin/shimmerAvatar.test.mjs` errors at startup with `Cannot find package 'jsdom'`. happy-dom isn't a drop-in replacement for everything; some tests genuinely need jsdom.

**Files:**
- Modify: `package.json` (root)
- Modify (likely): `tests/isolated/_infra/vitest.config.mjs` or wherever the isolated suite's vitest config lives

**Step 1.4.1: Verify the import**

```bash
grep -rn "jsdom" tests/isolated/modules/Admin/shimmerAvatar.test.mjs tests/isolated/_infra/ 2>/dev/null
```

**Step 1.4.2: Add jsdom as a devDependency**

```bash
npm install --save-dev jsdom
```

(This will modify `package.json` and `package-lock.json`.)

**Step 1.4.3: Run the failing test**

```bash
npx vitest run tests/isolated/modules/Admin/shimmerAvatar.test.mjs
```

Expected: file no longer errors at startup.

**Step 1.4.4: Commit**

```bash
git add package.json package-lock.json
git commit -m "test(deps): install jsdom for tests requiring real DOM environment"
```

### Task 1.5: Fix cost adapter module resolution

**Why:** Two cost adapter test files fail at setup with `Missing "#applications/cost/ports/ICostRepository.mjs" specifier in "daylight-station-backend" package`. Tests use `#applications/cost/ports/...` but `package.json` `imports` doesn't expose that subpath.

**Files:**
- Modify: `backend/package.json` (the `imports` block)

**Step 1.5.1: Inspect current `imports` block**

```bash
cat backend/package.json | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("imports", {}), indent=2))'
```

Look for `#applications/*` mapping. The mapping likely is:
```json
"#applications/*": "./src/3_applications/*"
```

That should resolve `#applications/cost/ports/ICostRepository.mjs` → `./src/3_applications/cost/ports/ICostRepository.mjs`. Confirm the file exists:

```bash
ls -la backend/src/3_applications/cost/ports/ICostRepository.mjs
```

**Step 1.5.2: If file exists but resolution fails**

The issue may be that vitest's resolver doesn't fully honor Node's `imports` field for nested wildcards. Two options:
- (a) Add an explicit subpath: `"#applications/cost/ports/*": "./src/3_applications/cost/ports/*"`
- (b) Add a vitest alias in `backend/vitest.config.mjs` (or wherever the backend test config lives) that mirrors the `imports`.

Pick (a) — it's the smaller change and keeps Node/vitest in sync.

**Step 1.5.3: Run the cost tests**

```bash
npx vitest run backend/tests/unit/suite/2_adapters/cost/
```

Expected: setup error gone. Tests may pass or reveal real failures.

**Step 1.5.4: Commit**

```bash
git add backend/package.json
git commit -m "fix(backend): expose cost adapter ports via package.json imports"
```

### Task 1.6: Verify `scripture-guide` package availability for isolated tests

**Why:** `tests/isolated/adapter/content/readalong/resolvers/scripture-version.test.mjs` errors at startup with `Cannot find package 'scripture-guide'`. The package may not be installed in the workspace root used by isolated tests, OR the import path is wrong.

**Files:**
- Possibly: `package.json` (root) and/or `backend/package.json`

**Step 1.6.1: Check where `scripture-guide` should be installed**

```bash
grep -rln "scripture-guide" backend/package.json package.json frontend/package.json 2>/dev/null
```

**Step 1.6.2: Check if it's actually installed**

```bash
ls -la node_modules/scripture-guide 2>/dev/null && echo "INSTALLED" || echo "MISSING"
```

**Step 1.6.3: If missing, install in the right workspace**

If it's listed in `backend/package.json` but not installed at the root `node_modules/`:
```bash
npm install scripture-guide --workspace=daylight-station-backend
```

If it's listed but version-pinned wrong, sync:
```bash
npm install
```

**Step 1.6.4: Re-run the test**

```bash
npx vitest run tests/isolated/adapter/content/readalong/resolvers/scripture-version.test.mjs
```

**Step 1.6.5: Commit (only if package.json changed)**

```bash
git add package.json package-lock.json backend/package.json
git commit -m "test(deps): ensure scripture-guide is installed for isolated readalong tests"
```

### Task 1.7: Re-baseline after Phase 1

**Step 1.7.1: Run full suite, capture counts**

```bash
echo "=== BACKEND ==="
npx vitest run backend/tests/unit/suite/ 2>&1 | grep -E "^Tests" | tail -3
echo "=== FRONTEND ==="
npx vitest run frontend/src/ 2>&1 | grep -E "^Tests" | tail -3
echo "=== ISOLATED ==="
npx vitest run tests/isolated/ 2>&1 | grep -E "^Tests" | tail -3
```

**Step 1.7.2: Append the result to this plan's "Re-baseline ledger" at the bottom.**

**Expected:** failure count drops from 731 to roughly 100–200. The exact number is data, not a target.

**If failure count didn't drop meaningfully (less than 30% reduction):** STOP and investigate. The hypothesis that infrastructure issues cascade was wrong; re-categorize before continuing.

---

## Phase 2 — Backend domain entity fixes

After Phase 1, MediaProgress + YamlMediaProgressMemory failures should still be present (they're real bugs, not config). Fix them.

### Task 2.1: Implement `MediaProgress.toJSON()` method

**Files:**
- Modify: `backend/src/2_domains/content/entities/MediaProgress.mjs`
- Test: `backend/tests/unit/suite/1_domains/content/entities/MediaProgress.test.mjs` (already exists; tests fail because `toJSON` is undefined)

**Step 2.1.1: Read the failing tests to understand the contract**

```bash
sed -n '270,360p' backend/tests/unit/suite/1_domains/content/entities/MediaProgress.test.mjs
```

Note exactly what fields the tests expect in serialization, what the canonical names are, what legacy names must be excluded.

**Step 2.1.2: Read the current MediaProgress entity**

```bash
cat backend/src/2_domains/content/entities/MediaProgress.mjs
```

Identify all instance fields, all getters (especially `percent`), and the constructor.

**Step 2.1.3: Run the failing tests first to capture FAIL output**

```bash
npx vitest run backend/tests/unit/suite/1_domains/content/entities/MediaProgress.test.mjs
```

Expected: 7 fails citing `toJSON is not a function`.

**Step 2.1.4: Implement `toJSON()`**

Add a `toJSON()` method to `MediaProgress` that returns a plain object with:
- All canonical fields (per the test expectations)
- The computed `percent` getter materialized
- `lastPlayed` serialized as ISO string OR null (per tests)
- NO legacy fields (`seconds`, `mediaDuration`, `time` etc.)
- All defaults emit cleanly

The exact shape comes from the tests — read them carefully and implement to match.

**Step 2.1.5: Run tests, expect PASS**

```bash
npx vitest run backend/tests/unit/suite/1_domains/content/entities/MediaProgress.test.mjs
```

Expected: 7/7 pass (or original count of `toJSON` describe block tests).

**Step 2.1.6: Commit**

```bash
git add backend/src/2_domains/content/entities/MediaProgress.mjs
git commit -m "feat(domain): add MediaProgress.toJSON() for canonical serialization"
```

### Task 2.2: Fix `YamlMediaProgressMemory` persistence

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`
- Test: `backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs` (4 failing assertions at lines 109, 143, 231, 312)

**Step 2.2.1: Read all 4 failing tests + surrounding setup**

```bash
sed -n '100,135p' backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs
sed -n '135,170p' backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs
sed -n '220,250p' backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs
sed -n '300,330p' backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs
```

Identify the four divergences:
1. Legacy field write — should warn (currently warns 0 times)
2. Legacy field write — should still write (currently writes nothing)
3. Read with missing optional fields — should hydrate to MediaProgress (currently returns null)
4. Empty path — should default to `default.yml` (currently doesn't append `.yml`)

**Step 2.2.2: Read the adapter**

```bash
cat backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
```

Identify each broken code path.

**Step 2.2.3: Note the related memory entry**

The user's memory file `MEMORY.md` references a `DataService.ensureExtension()` bug for files with dots in names — the same root cause may apply here. Check by reading `memory/MEMORY.md` (if accessible) or by inspecting `DataService.ensureExtension()` directly:

```bash
grep -rn "ensureExtension" backend/src/ | head
```

If the empty-path / `.yml` issue is the documented DataService bug, follow the same fix pattern (explicitly add `.yml` to the path before passing to DataService).

**Step 2.2.4: Implement fixes — one test at a time, TDD-style**

For each of the 4 tests:
1. Run just that test: `npx vitest run backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs -t "<test name>"`
2. Verify FAIL
3. Implement minimal fix
4. Re-run, verify PASS
5. Move to next

**Step 2.2.5: Run the full file**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/persistence/yaml/YamlMediaProgressMemory.test.mjs
```

Expected: full file PASSes (no regressions in other tests in the file).

**Step 2.2.6: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
git commit -m "fix(persistence): YamlMediaProgressMemory legacy field warnings, hydration defaults, and yml extension"
```

### Task 2.3: Re-baseline after Phase 2

**Step 2.3.1: Run backend suite**

```bash
npx vitest run backend/tests/unit/suite/ 2>&1 | grep -E "^Tests" | tail -3
```

Append to ledger.

**Expected:** Backend failure count drops by 11+ (the 7 MediaProgress + 4 Yaml + cascade effects).

---

## Phase 3 — Trivial UI fixes (quick wins)

### Task 3.1: Update Player Format Registry test count

**Files:**
- Modify: `frontend/src/modules/Player/lib/registry.test.js`

**Step 3.1.1: Confirm current failure**

```bash
npx vitest run frontend/src/modules/Player/lib/registry.test.js
```

Look for "expected 5, got 7" message.

**Step 3.1.2: Read the test and the registry**

```bash
grep -n "should return all registered" frontend/src/modules/Player/lib/registry.test.js
cat frontend/src/modules/Player/lib/registry.js  # or wherever the registry lives
```

Decide: is the test asserting the wrong count (update test), or did the registry over-register (revert registry)? If 7 is the intended set, update the test count.

**Step 3.1.3: Update the assertion**

Change the `expect(formats).toHaveLength(5)` (or equivalent) to the actual current count.

**Step 3.1.4: Run + commit**

```bash
npx vitest run frontend/src/modules/Player/lib/registry.test.js
git add frontend/src/modules/Player/lib/registry.test.js
git commit -m "test(player): update registry test to reflect current registered format count"
```

### Task 3.2: Fix manifest naming "Local Media" vs "Local Filesystem"

**Files:**
- Either modify the manifest (likely `tests/isolated/...` finds two duplicate tests) OR update the tests

**Step 3.2.1: Find the manifest and the test**

```bash
grep -rln "Local Filesystem\|Local Media" backend/src tests/isolated 2>/dev/null
```

**Step 3.2.2: Decide which is right**

If the manifest currently says "Local Media" but the test (and external API contract) wants "Local Filesystem", update the manifest. If the test is just stale, update the test. Read both before deciding.

**Step 3.2.3: Apply fix + run + commit**

```bash
npx vitest run tests/isolated/.../manifest-test-files
git add <files-changed>
git commit -m "fix(adapter): manifest displayName matches contract (Local Filesystem)"
# or "test(adapter): align test expectation with adapter manifest displayName"
```

### Task 3.3: InputManager null-config no-op

**Files:**
- Modify: `frontend/src/screen-framework/input/InputManager.js` (or `.jsx`)
- Test: `frontend/src/screen-framework/input/InputManager.test.js:67`

**Step 3.3.1: Read the failing test**

```bash
sed -n '60,80p' frontend/src/screen-framework/input/InputManager.test.js
```

**Step 3.3.2: Read InputManager constructor / factory**

```bash
cat frontend/src/screen-framework/input/InputManager.js
```

Identify where adapters are constructed and the missing null-config guard. Typical fix: at the top of the constructor (or factory), `if (!config) return /* no-op handle */;`.

**Step 3.3.3: Implement fix + test + commit**

```bash
npx vitest run frontend/src/screen-framework/input/InputManager.test.js
git add frontend/src/screen-framework/input/InputManager.js
git commit -m "fix(input): InputManager returns no-op handle for null config without constructing adapters"
```

### Task 3.4: Re-baseline after Phase 3

```bash
npx vitest run frontend/src/ 2>&1 | grep -E "^Tests" | tail -3
```

Append to ledger.

---

## Phase 4 — Component logic fixes

### Task 4.1: Fix GridLayout CSS grid generation

**Files:**
- Modify: `frontend/src/screen-framework/layouts/GridLayout.jsx`
- Test: `frontend/src/screen-framework/layouts/GridLayout.test.jsx` (4 tests fail)

**Step 4.1.1: Read all 4 tests**

```bash
cat frontend/src/screen-framework/layouts/GridLayout.test.jsx
```

Note what each test expects (grid container element, grid template style, row/col positioning, colspan/rowspan handling).

**Step 4.1.2: Read the component**

```bash
cat frontend/src/screen-framework/layouts/GridLayout.jsx
```

Identify what's missing or wrong in the CSS grid output.

**Step 4.1.3: Implement TDD-style — one test at a time**

For each failing test:
1. Run just that test
2. Verify FAIL
3. Minimal implementation
4. Re-run, PASS
5. Next

**Step 4.1.4: Run all 4 + commit**

```bash
npx vitest run frontend/src/screen-framework/layouts/GridLayout.test.jsx
git add frontend/src/screen-framework/layouts/GridLayout.jsx
git commit -m "fix(layouts): GridLayout generates correct CSS grid template, positioning, and span"
```

### Task 4.2: Fix Tetris engine grid dimensions

**Files:**
- Modify: `frontend/src/modules/Piano/PianoTetris/tetrisEngine.js` (or `.mjs`)
- Test: `frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js` (3 tests fail)

**Step 4.2.1: Read tests**

```bash
cat frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js
```

The 3 failing tests describe: 20×10 grid (rows × cols), spawn at x=3 y=0 rotation=0, bounds check.

**Step 4.2.2: Read the engine — find `createBoard`, `spawn`, bounds check**

```bash
grep -n "createBoard\|spawn\|bounds\|inBounds" frontend/src/modules/Piano/PianoTetris/tetrisEngine.js
```

The current code has dimensions inverted (10×20 instead of 20×10) and spawn x at 8 instead of 3.

**Step 4.2.3: Fix dimensions, fix spawn, fix bounds check**

Bounds check failure ("rejects piece out of bounds (right) — expected false, got true") suggests the right-edge bound check uses the wrong dimension. Inspect.

**Step 4.2.4: Run + commit**

```bash
npx vitest run frontend/src/modules/Piano/PianoTetris/tetrisEngine.test.js
git add frontend/src/modules/Piano/PianoTetris/tetrisEngine.js
git commit -m "fix(tetris): correct 20x10 grid dimensions and spawn position"
```

### Task 4.3: Fix NavProvider pop logic

**Files:**
- Modify: `frontend/src/modules/Media/shell/NavProvider.jsx` (or wherever the nav stack lives)
- Test: `frontend/src/modules/Media/shell/NavProvider.test.jsx` (1 test fails)

**Step 4.3.1: Read the failing test**

```bash
grep -A 20 "pop returns to the previous view" frontend/src/modules/Media/shell/NavProvider.test.jsx
```

The failure: after push(detail) then pop(), expected "home" but got "detail".

**Step 4.3.2: Read the NavProvider**

```bash
cat frontend/src/modules/Media/shell/NavProvider.jsx
```

Look at the push/pop reducer or state update logic. Likely culprits:
- Pop returns the *current* view instead of the previous view
- Pop doesn't actually mutate the stack
- Push appends to the wrong end (LIFO vs FIFO confusion)

**Step 4.3.3: Fix + test + commit**

```bash
npx vitest run frontend/src/modules/Media/shell/NavProvider.test.jsx
git add frontend/src/modules/Media/shell/NavProvider.jsx
git commit -m "fix(shell): NavProvider pop returns the previous view, not the current one"
```

### Task 4.4: PanelRenderer widget rendering (if still failing after Phase 1)

**Files:**
- Modify: `frontend/src/screen-framework/PanelRenderer.jsx` (likely)
- Test: `frontend/src/screen-framework/PanelRenderer.test.jsx` (2 tests fail per audit)

**Step 4.4.1: Re-check whether this test was already cured by Phase 1's jest-dom config**

```bash
npx vitest run frontend/src/screen-framework/PanelRenderer.test.jsx
```

If both pass now, **skip this task**. The failure pattern was DOM-assertion-related, so Phase 1's jest-dom fix may have been the cure.

**Step 4.4.2: If still failing, follow the same pattern as Task 4.1**

Read tests → read component → identify missing widget registration or wrapper-style application → fix → test.

**Step 4.4.3: Commit (if changes made)**

```bash
git add frontend/src/screen-framework/PanelRenderer.jsx
git commit -m "fix(panel-renderer): correct widget mount + flex wrapper styling"
```

### Task 4.5: Re-baseline after Phase 4

```bash
npx vitest run frontend/src/ 2>&1 | grep -E "^Tests" | tail -3
```

Append to ledger.

---

## Phase 5 — Phase 4 PiP overlay slot

**Why last among the planned categories:** This is medium-large scope (a real feature implementation, not a fix). It needs the underlying design. There is an existing design plan at `docs/_wip/plans/2026-04-21-pip-panel-takeover-design.md` — read it first.

### Task 5.1: Verify the PiP design is current

**Step 5.1.1: Read the design plan**

```bash
cat docs/_wip/plans/2026-04-21-pip-panel-takeover-design.md
```

Confirm the PiP slot design and acceptance criteria. If the design has shifted since the test was authored, **stop and ask the human** whether to update the design or update the tests.

### Task 5.2: Implement the PiP slot in `ScreenOverlayProvider`

**Files:**
- Modify: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx`
- Modify (likely): `frontend/src/screen-framework/overlays/ScreenOverlayProvider.scss`
- Tests: `frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx` (4 tests fail at lines 164, 208, 292, 321)

**Step 5.2.1: Read all 4 failing tests carefully**

```bash
sed -n '155,200p' frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx
sed -n '200,240p' frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx
sed -n '285,335p' frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx
```

Tests expect:
- A second DOM slot `[data-testid="pip-content"]` rendered when `state.pip` is non-null
- `dismissOverlay({ mode: 'pip' | 'fullscreen' | 'toast' })` only clears that mode
- `hasOverlay` reflects only fullscreen state (NOT pip state — tests assert this explicitly)
- `dismissOverlay` for fullscreen leaves pip + toasts alone

**Step 5.2.2: Read current ScreenOverlayProvider**

```bash
cat frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx
```

Likely already has `state.pip` in the reducer state shape but no rendering side or no targeted dismissal.

**Step 5.2.3: Implement piece by piece**

For each of the 4 tests:
1. Run just that test
2. Identify the minimal change needed
3. Implement
4. Re-run, PASS
5. Next

**Step 5.2.4: Verify the existing 28 passing tests in this file still pass**

```bash
npx vitest run frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx
```

Expected: 32+/32+ pass (the original 28 + the 4 newly-fixed). If anything regressed, debug before continuing.

**Step 5.2.5: Sanity-check the Phase 1 (trigger-sequence branch) `screen:overlay-mounted` event still fires**

The trigger-sequence branch added a `useEffect` that emits `screen:overlay-mounted` when `state.fullscreen` becomes truthy (`ScreenOverlayProvider.jsx:75-81`). After your Phase 5 PiP work, verify that emit still happens correctly for fullscreen overlays AND consider whether pip overlays should also emit it. (Likely: no — pip is non-blocking and shouldn't release the menu-suppression gate. Leave fullscreen-only.)

**Step 5.2.6: Commit**

```bash
git add frontend/src/screen-framework/overlays/ScreenOverlayProvider.jsx frontend/src/screen-framework/overlays/ScreenOverlayProvider.scss
git commit -m "feat(overlays): implement PiP slot with targeted dismissOverlay (Phase 4 of pip-panel-takeover design)"
```

### Task 5.3: Re-baseline after Phase 5

```bash
npx vitest run frontend/src/screen-framework/overlays/ 2>&1 | grep -E "^Tests" | tail -3
```

Append to ledger.

---

## Phase 6 — Residual investigation + fixes

After Phases 1–5, the suite should be down to ~50 failures or fewer (estimate). Most should now be one of:
- Domain-specific bugs that need real fixes
- Tests testing dead code that should be deleted
- Tests with bad assumptions that should be updated

This phase is forensic, not pre-planned.

### Task 6.1: Capture the residual inventory

**Step 6.1.1: Run the full suite, save raw output**

```bash
npx vitest run 2>&1 | tee /tmp/residual-failures.txt
```

**Step 6.1.2: Extract just the failures**

```bash
grep -E "(FAIL|✗|×)" /tmp/residual-failures.txt | head -100 > /tmp/residual-list.txt
cat /tmp/residual-list.txt
```

### Task 6.2: Categorize the residuals

For each unique remaining failure:
- File + test name
- Read the test
- Read the production code
- Decide: fix the test, fix the code, delete the test (dead code), or punt to a follow-up issue

Group by category — same root cause = same category. Append the categorized list to this plan as "Phase 6 Residual Inventory".

### Task 6.3: Fix in TDD batches by category

For each category from Task 6.2:
- One subagent / one commit per category (or split into 2-3 if a category has many tests)
- TDD per test
- Commit after each category passes

### Task 6.4: Final green suite

When the full suite reports `Tests <total> passed`:

```bash
npx vitest run 2>&1 | grep -E "^Tests" | tail -3
```

Append `Final: 0 failed` to the ledger.

### Task 6.5: Final commit

If any docs / READMEs / CLAUDE.md test discipline references reference the old "known failures" pattern, update them. Then:

```bash
git commit -m "docs: suite is green — remove obsolete known-failure caveats"
```

---

## Re-baseline ledger

Track failure counts after each phase. Update IN this file as you go.

```
Pre-Phase-1:  279 failed individual tests across 3 suites
              backend  : 11 failed /  775 passed   (786 total, 5 files failed)
              frontend : 94 failed /  640 passed   (734 total, 29 files failed)
              isolated : 174 failed / 1667 passed (1844 total, 326 files failed)
              (note: plan's 731 estimate counted file-load failures as multiple
              tests; vitest reports them as "no tests" for the file)

Post-Phase-1: 207 failed individual tests across 3 suites
              backend  : 12 failed /  835 passed  (847 total,   3 files failed)  +61 tests now run
              frontend : 21 failed /  713 passed  (734 total,   6 files failed)  -73 fails
              isolated : 174 failed / 1667 passed (1844 total, 327 files failed) flat
              Δ frontend: -73 fails (~78% reduction). Backend gained tests (cost adapter
              now loads). Isolated unchanged: dominant residual is widespread
              `@jest/globals` imports across hundreds of isolated test files (same
              pattern as Task 1.1, but at scale not anticipated by the plan) plus
              the .mjs+JSX transform issue. Both are infrastructure but exceed
              Phase 1 scope; Phase 6 forensic sweep will need to address them.

Post-Phase-2: backend  : 1 failed /  846 passed  (847 total,   1 file failed)  -11 fails
              (frontend + isolated unchanged this phase — Phase 2 is backend-only)
              Δ backend: -11 fails (7 MediaProgress.toJSON + 4 YamlMediaProgressMemory).
              Residual backend failure: OpenAICostSource expects 'gpt-4o' but current
              model registry returns 'gpt-4.1' — unrelated to Phase 2 scope.
Post-Phase-3: backend  : 1 failed /  846 passed  (847 total,   1 file failed)  flat
              frontend : 19 failed /  715 passed  (734 total,   4 files failed)  -2 fails
              isolated : 173 failed / 1668 passed (1844 total, 324 files failed)  -1 fail
              Δ frontend: -2 fails (registry count + InputManager null-config).
              Δ isolated: -1 fail (filesystem manifest displayName test).
              Plan estimated -4 frontend; the manifest fix lives under
              tests/isolated/ not frontend/src/, so it lands in the isolated
              ledger instead. Net = 3 fixes for 4 originally-failing tests
              (the plan's "2 manifest tests" was actually 1 — the second
              "Local Media" reference in AdapterRegistry.test.mjs was already
              correct; that file fails for unrelated @jest/globals reasons).
Post-Phase-4: ??? failed   # frontend logic fixes
Post-Phase-5: ??? failed   # PiP implementation
Post-Phase-6: 0 failed     # GOAL
```

### Phase 1 deviations from plan

- **Task 1.2:** plan predicted only `Invalid Chai property: toBeInTheDocument`. Actual
  failures included `React is not defined` because the root `vitest.config.mjs` had no
  React plugin. Fix added `@vitejs/plugin-react` (loaded via dynamic import from
  `frontend/node_modules`) alongside the `setupFiles` directive.
- **Task 1.4:** plan said "install jsdom". jsdom 27.0.1 was already installed but
  failed because it `require()`s parse5 8 (ESM-only) on Node 20.17 (which lacks
  `require(esm)`). Fix downgraded to `jsdom@^24` (which uses parse5 7 CJS). Install
  went into `frontend/` (where the test environment loads from), not the root.
- **Task 1.6:** `scripture-guide` is already installed in all three node_modules
  trees and the target test passes. No commit needed — task skipped.
- **Isolated suite stays at 174 fails:** the dominant remaining failure mode is
  hundreds of isolated test files importing from `@jest/globals` (same pattern as
  Task 1.1 but not enumerated in the plan). Plus a smaller cluster of `.mjs` files
  containing JSX (which the React plugin only transforms for `.jsx`/`.tsx`). Both
  are infrastructure issues but at a scale Phase 1 didn't anticipate. Recommend
  surfacing as a Phase 6 sweep.

---

## Out-of-scope reminders

- **Trigger-sequence branch merge:** the `fix/trigger-sequence-2026-04-25` branch is awaiting a merge decision (main has diverged with concurrent work). This plan can land before OR after that merge — only Phase 1 Task 1.2's vitest config change *might* conflict with concurrent work (low risk). If you run this in a worktree off `main` after the trigger-sequence branch merges, no overlap.
- **Pre-existing test-failure audit doc:** at `docs/_wip/audits/2026-04-25-pre-existing-test-failures-audit.md` — read it for category context but trust this plan's inventory (it's based on a fuller sweep).

## Skill references

- **Executing this plan:** `superpowers:executing-plans` or `superpowers:subagent-driven-development`
- **Per-task TDD discipline:** `superpowers:test-driven-development`
- **Verifying before claiming done:** `superpowers:verification-before-completion`
- **Final review:** `superpowers:requesting-code-review`
