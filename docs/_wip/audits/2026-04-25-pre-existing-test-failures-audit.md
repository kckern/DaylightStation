---
date: 2026-04-25
scope: backend + frontend test suites at branch `fix/trigger-sequence-2026-04-25` HEAD `982bfe538`
sibling: docs/_wip/audits/2026-04-25-nfc-to-playback-trigger-sequence-audit.md
trigger: surfaced during cross-cutting review of the trigger-sequence branch
---

# Pre-existing Test Failures Audit

While completing the `fix/trigger-sequence-2026-04-25` branch, multiple
review passes surfaced test failures that **predate** the branch.
Several reviewers reported them as "out of scope, not introduced by this
work" — accurate, but the rolling debt obscures real regressions in
future PRs (a contributor sees red and can't tell what they broke vs
what was already broken). This audit names every failure, its root
cause, and the recommended fix so the suite can be brought back to
green and we stop normalizing the noise.

**Counts:** 24 unique failing tests across 8 test files (13 backend, 11
frontend). All four FKB `load` tests previously flagged were fixed
in-branch (commit `982bfe538` improved their mocks); the failures below
are everything else.

---

## Failure inventory (categorized)

### Category A — CommandEnvelope shape migration drift (2 tests, BACKEND)

**File:** `backend/tests/unit/suite/3_applications/devices/WakeAndLoadService.test.mjs`

| Line | Test name | Failure |
|-----:|-----------|---------|
| 87  | `should use WebSocket fallback when URL load fails with content query` | `expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ queue: 'morning-program' }))` |
| 164 | `should use WS delivery when warm prepare and subscribers exist`         | Same matcher shape |

**Root cause.** Both tests assert against the legacy *flat* envelope
shape that pre-dated the CommandEnvelope migration. The production code
(`backend/src/3_applications/devices/services/WakeAndLoadService.mjs:420-428`
and the WS-fallback path at `498-509`) now broadcasts the canonical
envelope:

```js
buildCommandEnvelope({
  targetDevice: deviceId,
  command: 'queue',
  commandId: dispatchId,
  params: { ...opts, op: 'play-now', contentId: resolvedContentId },
});
```

The `queue` key is *consumed* (it's the `resolvedKey` deleted from
`opts`) and the contentId moves into `params.contentId`. The flat
`{ queue: 'morning-program' }` shape no longer appears anywhere in the
broadcast. Drift originates from the WS-first / CommandEnvelope refactor
in `0099b3d95` / `8c6294602` — those commits updated production but
missed the test assertions.

**Fix difficulty:** small (~5 lines per test). Update both matchers to
match the new envelope:

```js
expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
  topic: 'homeline:living-room',
  type: 'command',
  command: 'queue',
  params: expect.objectContaining({ op: 'play-now', contentId: 'morning-program' }),
}));
```

**Validity:** the tests cover real, important behavior (warm WS-first
delivery and URL-failure WS-fallback). Fix, don't delete.

**Status:** addressed in the trigger-sequence branch fixup commit
(see Phase 4 fixup section of the implementation report). If you're
reading this audit on `main` after merge, this category should be
empty.

---

### Category B — MediaProgress refactor incompleteness (11 tests, BACKEND)

**Files:**
- `backend/tests/.../entities/MediaProgress.test.mjs` (7 failures, lines 280–356, all in the `toJSON` describe block)
- `backend/tests/.../adapters/YamlMediaProgressMemory.test.mjs` (4 failures, lines 109, 143, 231, 312)

**Root cause.**
- `MediaProgress.toJSON()` is missing entirely — the test calls
  `progress.toJSON()` and gets "is not a function". The entity was
  refactored to use canonical field names but the serialization method
  was never re-added.
- `YamlMediaProgressMemory` failures (legacy-field detection, write,
  default-fields-on-read, empty-path → `default.yml`) all cascade from
  `MediaProgress` not round-tripping through serialization correctly,
  plus a separate `.yml` extension bug in path construction.

**Fix difficulty:** small-to-medium per test, but coupled — fixing
`MediaProgress.toJSON()` first will unblock most of the
`YamlMediaProgressMemory` cases. The `.yml`-extension issue in
`YamlMediaProgressMemory` is a known pattern (see memory note
`reference_dataservice_extension_bug.md` if it exists — DataService's
`ensureExtension()` mishandles dotted file names).

**Validity:** persistence is critical. Fix all 11.

**Owner / suggested follow-up branch:** `fix/media-progress-serialization`.

---

### Category C — Phase 4 PiP overlay slots not implemented (4 tests, FRONTEND)

**File:** `frontend/src/screen-framework/overlays/ScreenOverlayProvider.test.jsx`

| Line | Test name |
|-----:|-----------|
| 164  | `renders pip alongside fullscreen` |
| 208  | `dismissOverlay targets specific mode` |
| 292  | `hasOverlay reflects only fullscreen state` |
| 321  | `dismissOverlay for fullscreen does not affect pip or toasts` |

**Root cause.** All four tests query for `[data-testid="pip-content"]`
which is never rendered. The `ScreenOverlayProvider` exposes the API
surface for picture-in-picture overlays (the `pip` slot is in the state
shape) but the actual render-tree slot for `pip-content` was never
added. The tests were authored ahead of the implementation as a
forward-looking spec for what is documented as Phase 4 of the overlay
work in `docs/_wip/plans/2026-04-21-pip-panel-takeover-design.md`.

**Fix difficulty:** medium (implement the PiP DOM slot in
`ScreenOverlayProvider.jsx`). Roughly: render a sibling `<div data-testid="pip-content">` next to the fullscreen slot when `state.pip` is non-null,
positioned per the YAML's `pip:` block.

**Validity:** PiP is a real product feature on the homeline / videocall
flow. Tests are valuable; finishing the slot implementation lands
in scope of the existing PiP design plan.

**Owner / suggested follow-up branch:** continuation of the existing
pip-panel-takeover work — `feat/screen-pip-content-slot`.

---

### Category D — Missing React import in JSX test (4 tests, FRONTEND)

**File:** `frontend/src/screen-framework/layouts/GridLayout.test.jsx`

All four `it` blocks fail because the file uses JSX without
`import React from 'react';` at the top. Vitest's React 18 + automatic
JSX runtime configuration may have changed; or the file was authored
with an older config and never updated.

| Line | Test name |
|-----:|-----------|
| 8    | `should render a grid container` |
| 19   | `should apply correct grid template` |
| 33   | `should position widgets according to row/col props` |
| 46   | `should handle colspan and rowspan` |

**Fix difficulty:** trivial. Add `import React from 'react';` at the
top of the file. (Alternatively, audit `vite.config.js` to confirm the
automatic JSX runtime is configured — if so, the React import shouldn't
be needed and there's a different root cause.)

**Validity:** GridLayout is widely used; tests should run.

**Owner / suggested follow-up:** roll into the next frontend cleanup
commit. ~30 seconds of work.

---

### Category E — PanelRenderer widget rendering broken (2 tests, FRONTEND)

**File:** `frontend/src/screen-framework/PanelRenderer.test.jsx`

| Line | Test name | Failure |
|-----:|-----------|---------|
| 31   | `renders a single widget leaf node` | `[data-testid="widget-clock"]` not found — screen-root renders empty |
| 68   | `applies flex-grow/shrink/basis to widget wrapper` | `flexGrow` style is empty string, not `'0'` |

**Root cause.** Two related symptoms. Widget rendering layer is silently
no-op'ing in the test environment — likely (a) widget registry not
populated for tests, or (b) PanelRenderer changed its widget-resolution
path and the tests didn't get updated. The flex-style assertion failure
suggests the wrapper element shape changed (probably from a
`<div style={...}>` to a `<div className={...}>` with CSS).

**Fix difficulty:** medium. Needs investigation of recent PanelRenderer
edits (`git log -p -- frontend/src/screen-framework/PanelRenderer.jsx`)
to identify the divergence point.

**Validity:** core to the screen-framework. Fix.

**Owner / suggested follow-up branch:** `fix/panel-renderer-widget-rendering`.

---

### Category F — InputManager null-config no-op leaks adapter init (1 test, FRONTEND)

**File:** `frontend/src/screen-framework/input/InputManager.test.js:67`

`should return no-op handle for null config` — test asserts that with a
null config, no adapters are initialized. Failure: `KeyboardAdapter`
constructor is still called once.

**Root cause.** Either the InputManager's null-guard fires *after*
adapter construction instead of before, OR a test-env mock for
`KeyboardAdapter` is leaking from a sibling test in the same file.

**Fix difficulty:** small. One of (a) move the null-config check to the
top of the InputManager constructor, (b) reset the spy in `beforeEach`,
or (c) document if the leak is intentional (e.g. KeyboardAdapter is
always constructed for keyboard fallback even when no config drives it).

**Validity:** null-config safety is a real contract. Fix.

**Owner:** roll into next frontend cleanup commit.

---

## Aggregate fix budget

| Category | Tests | Fix size | Owner branch |
|----------|------:|----------|--------------|
| A — CommandEnvelope drift | 2 | small | landed in trigger-sequence branch |
| B — MediaProgress refactor | 11 | small/medium | new branch |
| C — PiP overlay slot | 4 | medium | existing PiP design work |
| D — Missing React import | 4 | trivial | roll into cleanup |
| E — PanelRenderer widget | 2 | medium | new branch |
| F — InputManager null-config | 1 | small | roll into cleanup |
| **Total** | **24** | | |

**Recommended landing order:** D (trivial) → A (already done) →
F (small) → B (medium) → E (medium) → C (medium, gated on PiP design).

---

## Why this matters

Per CLAUDE.md's testing philosophy ("Skipping is NOT passing... fail
fast on infrastructure issues... no fallback to 'it works anyway'"),
known-failing tests in the suite are a discipline regression. Every
contributor either:

- Memorizes the list of "expected failures" (impossible at scale and
  hostile to new contributors), or
- Runs the suite, sees red, decides nothing they broke is in there,
  and moves on (the *exact* mode that lets a real regression slip
  through), or
- Adds new functionality without test coverage because writing tests
  in a red suite is dispiriting.

24 known-failing tests is the "normalization of red" tipping point.
Bring the suite back to green and the next regression has only itself
to hide behind.

---

## Out-of-scope reminder

This audit is **NOT** about the trigger-sequence fixes — those are
covered by `2026-04-25-nfc-to-playback-trigger-sequence-audit.md` and
implemented in the `fix/trigger-sequence-2026-04-25` branch. This
audit covers debt that branch incidentally exposed but did not cause.
