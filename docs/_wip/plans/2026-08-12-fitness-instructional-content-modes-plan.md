# Fitness Instructional Content Modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two Plex label lists in `fitness.yml` switch the fitness player between its
workout interaction model and a study model — suppressing all frame capture, and replacing
the pause/scrub UX with one built for learning choreography.

**Architecture:** A pure resolver maps an item's labels to `{ captureDisabled, studyUx }`.
A hook wraps it with an async backstop that fetches show labels when an item arrives without
them (the menu-queue path), and **capture stays off until the mode is resolved** — so an
unresolvable item fails safe. Those two flags then gate capture surfaces, overlay
suppression, layout, and a loop engine.

**Tech Stack:** React 18, Vitest 4 + @testing-library/react, SCSS, Express (read-only here),
js-yaml config.

**Design spec:** `docs/_wip/plans/2026-08-12-fitness-instructional-content-modes-design.md`

## Global Constraints

- **Worktree:** work in `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3` on
  branch `fitness/instructional-content-modes`. Never `cd` to the main repo.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared with other
  worktrees. Use a WIP commit instead.
- **Run tests with** `npx vitest run <path>` from the worktree root. `--reporter=basic` does
  **not** exist in vitest 4 — omit the flag and use the default reporter.
- **Logging:** never use raw `console.*` for diagnostics. Use
  `getLogger().child({ component })` per `CLAUDE.md`. Module-level loggers use the lazy
  `let _logger; function logger() {...}` pattern.
- **Config keys are snake_case** (`no_capture_labels`), matching the existing `*_labels` keys.
- **All label comparison is lowercase on both sides.** Plex labels reach the frontend
  lowercased on some paths and raw on others — never assume.
- **Unlabelled content must take a byte-identical path to today's behaviour.** Every gate is
  additive: `existingCondition && !newFlag`.
- **Do not modify the shared list serializer** (`backend/src/4_api/v1/routers/list.mjs`).
  Label resolution is fixed in the Fitness consumer by explicit decision.
- **Commit after every task.** Do not batch commits across tasks.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `frontend/src/hooks/fitness/resolveContentMode.js` | Pure label → flags resolver | Create |
| `frontend/src/hooks/fitness/resolveContentMode.test.js` | Resolver unit tests | Create |
| `frontend/src/hooks/fitness/useContentMode.js` | Hook: resolver + async show-label backstop | Create |
| `frontend/src/hooks/fitness/useContentMode.test.jsx` | Hook tests | Create |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Wire mode; gate capture; layout; tap; loop | Modify |
| `frontend/src/modules/Fitness/widgets/CameraViewApp/CameraViewApp.jsx` | Self-teardown when capture disabled | Modify |
| `frontend/src/modules/Fitness/nav/FitnessModuleMenu.jsx` | Filter `camera_view` when capture disabled | Modify |
| `frontend/src/context/FitnessContext.jsx` | Publish `contentMode` for out-of-player consumers | Modify |
| `frontend/src/modules/Player/Player.jsx` | Thread `suppressPauseOverlay`; carry `wasPaused` through remount | Modify |
| `frontend/src/modules/Player/components/PlayerOverlayPaused.jsx` | Honour `suppressPauseOverlay` | Modify |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | Don't autoplay a remount that was paused | Modify |
| `frontend/src/modules/Fitness/player/footer/StudyControls.jsx` | Jog + loop + mirror controls | Create |
| `frontend/src/modules/Fitness/player/footer/StudyControls.scss` | Study control styling | Create |
| `frontend/src/modules/Fitness/player/hooks/useLoopWindow.js` | Loop engine | Create |
| `frontend/src/modules/Fitness/player/hooks/useLoopWindow.test.jsx` | Loop engine tests | Create |

---

## Task 1: Content-mode resolver

**Files:**
- Create: `frontend/src/hooks/fitness/resolveContentMode.js`
- Test: `frontend/src/hooks/fitness/resolveContentMode.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveContentMode(item, plexConfig) -> { captureDisabled: boolean, studyUx: boolean }`
  and `hasResolvableLabels(item) -> boolean`.

**Context:** The existing precedent is `FitnessPlayer.jsx:608-612`, which lowercases both the
config list and the item labels before intersecting. Copy that discipline. `item.labels` may
be `undefined`, an array of strings, or (from some Plex shapes) an array of `{ tag }` objects.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/hooks/fitness/resolveContentMode.test.js
import { describe, it, expect } from 'vitest';
import { resolveContentMode, hasResolvableLabels } from './resolveContentMode.js';

const CFG = {
  no_capture_labels: ['Instructional', 'Private'],
  study_ux_labels: ['Instructional', 'Tutorial'],
};

describe('resolveContentMode', () => {
  it('sets both flags for a label in both lists', () => {
    expect(resolveContentMode({ labels: ['instructional'] }, CFG))
      .toEqual({ captureDisabled: true, studyUx: true });
  });

  it('is case-insensitive on both sides', () => {
    expect(resolveContentMode({ labels: ['INSTRUCTIONAL'] }, CFG).studyUx).toBe(true);
  });

  it('keeps the lists independent — no_capture only', () => {
    expect(resolveContentMode({ labels: ['private'] }, CFG))
      .toEqual({ captureDisabled: true, studyUx: false });
  });

  it('keeps the lists independent — study_ux only', () => {
    expect(resolveContentMode({ labels: ['tutorial'] }, CFG))
      .toEqual({ captureDisabled: false, studyUx: true });
  });

  it('returns all-false for unlabelled content', () => {
    expect(resolveContentMode({ labels: ['cardio'] }, CFG))
      .toEqual({ captureDisabled: false, studyUx: false });
  });

  it('returns all-false for absent labels, null item, and empty config', () => {
    expect(resolveContentMode({}, CFG)).toEqual({ captureDisabled: false, studyUx: false });
    expect(resolveContentMode(null, CFG)).toEqual({ captureDisabled: false, studyUx: false });
    expect(resolveContentMode({ labels: ['instructional'] }, {}))
      .toEqual({ captureDisabled: false, studyUx: false });
    expect(resolveContentMode({ labels: ['instructional'] }, null))
      .toEqual({ captureDisabled: false, studyUx: false });
  });

  it('accepts Plex tag-object label shapes', () => {
    expect(resolveContentMode({ labels: [{ tag: 'Instructional' }] }, CFG).studyUx).toBe(true);
  });
});

describe('hasResolvableLabels', () => {
  it('is true when the item carries a non-empty label array', () => {
    expect(hasResolvableLabels({ labels: ['cardio'] })).toBe(true);
  });

  it('is false for absent or empty labels — these need the async backstop', () => {
    expect(hasResolvableLabels({})).toBe(false);
    expect(hasResolvableLabels({ labels: [] })).toBe(false);
    expect(hasResolvableLabels(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/resolveContentMode.test.js`
Expected: FAIL — cannot resolve `./resolveContentMode.js`.

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/hooks/fitness/resolveContentMode.js
/**
 * Maps an item's Plex labels to the two independent content-mode flags.
 *
 * `captureDisabled` suppresses all session frame capture; `studyUx` swaps the player
 * to the study interaction model. They are deliberately independent — a show can be
 * privacy-sensitive without being instructional, and vice versa.
 *
 * Labels reach the frontend lowercased on some paths and raw on others, so both sides
 * are normalized here rather than trusted.
 */

const normalizeLabels = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.tag === 'string') return entry.tag;
      return null;
    })
    .filter(Boolean)
    .map((s) => s.toLowerCase());
};

const intersects = (itemLabels, configList) => {
  if (!Array.isArray(configList) || configList.length === 0) return false;
  const wanted = configList
    .filter((l) => typeof l === 'string')
    .map((l) => l.toLowerCase());
  return itemLabels.some((l) => wanted.includes(l));
};

/**
 * @param {object|null} item - playable item; `labels` may be absent
 * @param {object|null} plexConfig - the `plex` block from fitness.yml
 * @returns {{captureDisabled: boolean, studyUx: boolean}}
 */
export function resolveContentMode(item, plexConfig) {
  const labels = normalizeLabels(item?.labels);
  return {
    captureDisabled: intersects(labels, plexConfig?.no_capture_labels),
    studyUx: intersects(labels, plexConfig?.study_ux_labels),
  };
}

/**
 * Whether an item carries labels at all. False means the caller must resolve them
 * asynchronously before trusting a negative result — some playback paths deliver
 * items with no labels field, and treating that as "not instructional" would
 * silently record content that should never be recorded.
 */
export function hasResolvableLabels(item) {
  return Array.isArray(item?.labels) && item.labels.length > 0;
}

export default resolveContentMode;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run frontend/src/hooks/fitness/resolveContentMode.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/resolveContentMode.js frontend/src/hooks/fitness/resolveContentMode.test.js
git commit -m "feat(fitness): add content-mode label resolver"
```

---

## Task 2: `useContentMode` hook with fail-safe async backstop

**Files:**
- Create: `frontend/src/hooks/fitness/useContentMode.js`
- Test: `frontend/src/hooks/fitness/useContentMode.test.jsx`

**Interfaces:**
- Consumes: `resolveContentMode`, `hasResolvableLabels` from Task 1.
- Produces: `useContentMode(item, plexConfig) -> { captureDisabled, studyUx, resolved }`.

**Context — this task closes the privacy hole.** Items reaching the player from the
FitnessMenu queue path carry `labels: undefined`, because the shared list serializer emits no
`labels` field. Treating that as "not instructional" would record content that must never be
recorded. So:

- If the item already has labels, resolve synchronously and set `resolved: true`.
- If not, fetch `api/v1/fitness/show/:id` (which returns `info.labels` via the adapter's
  container-info path) using the item's show id, and resolve from that.
- **Until resolution completes, `resolved` is `false` and callers must not start capture.**

Show id preference order: `item.grandparentId` (episode → show), then `item.parentId`, then
`item.id`. Cache results by show id in a module-level `Map` so repeated items don't refetch.
`DaylightAPI` is imported from `@/lib/api.mjs` (same import the capture component uses).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/hooks/fitness/useContentMode.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockApi = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => mockApi(...args) }));
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) })
}));

const { useContentMode, __clearContentModeCache } = await import('./useContentMode.js');

const CFG = { no_capture_labels: ['Instructional'], study_ux_labels: ['Instructional'] };

beforeEach(() => {
  mockApi.mockReset();
  __clearContentModeCache();
});

describe('useContentMode', () => {
  it('resolves synchronously when the item already carries labels', () => {
    const { result } = renderHook(() => useContentMode({ labels: ['instructional'] }, CFG));
    expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('reports unresolved before the backstop fetch settles', () => {
    mockApi.mockReturnValue(new Promise(() => {})); // never settles
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    expect(result.current.resolved).toBe(false);
    expect(result.current.captureDisabled).toBe(false);
  });

  it('resolves from fetched show labels when the item has none', async () => {
    mockApi.mockResolvedValue({ info: { labels: ['instructional'] } });
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
    expect(mockApi).toHaveBeenCalledWith('api/v1/fitness/show/696065');
  });

  it('stays unresolved when the backstop fetch fails — capture must not start', async () => {
    mockApi.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(result.current.resolved).toBe(false);
  });

  it('caches by show id — a second item from the same show does not refetch', async () => {
    mockApi.mockResolvedValue({ info: { labels: ['instructional'] } });
    const { result: r1 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r1.current.resolved).toBe(true));
    const { result: r2 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r2.current.resolved).toBe(true));
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately when there is no item at all', () => {
    const { result } = renderHook(() => useContentMode(null, CFG));
    expect(result.current).toEqual({ captureDisabled: false, studyUx: false, resolved: true });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/useContentMode.test.jsx`
Expected: FAIL — cannot resolve `./useContentMode.js`.

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/hooks/fitness/useContentMode.js
import { useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import { resolveContentMode, hasResolvableLabels } from './resolveContentMode.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'content-mode' });
  return _logger;
}

// Show id -> labels array. Module-level so it survives player remounts.
const showLabelCache = new Map();

/** Test-only cache reset. */
export function __clearContentModeCache() {
  showLabelCache.clear();
}

const showIdFor = (item) => item?.grandparentId || item?.parentId || item?.id || null;

/**
 * Resolves the content mode for the currently-playing item.
 *
 * Some playback paths (notably queueing straight from the fitness menu) deliver items
 * with no `labels` field, because the shared list serializer does not emit one. Treating
 * that absence as "not instructional" would record content that must never be recorded,
 * so this hook falls back to fetching the show's labels and reports `resolved: false`
 * until it knows. Callers MUST gate capture on `resolved`.
 *
 * @returns {{captureDisabled: boolean, studyUx: boolean, resolved: boolean}}
 */
export function useContentMode(item, plexConfig) {
  const [fetchedLabels, setFetchedLabels] = useState(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  const inline = hasResolvableLabels(item);
  const showId = showIdFor(item);
  const needsFetch = Boolean(item) && !inline && Boolean(showId);

  useEffect(() => {
    if (!needsFetch) return undefined;
    if (showLabelCache.has(showId)) {
      setFetchedLabels(showLabelCache.get(showId));
      return undefined;
    }
    let cancelled = false;
    setFetchedLabels(null);
    setFetchFailed(false);
    DaylightAPI(`api/v1/fitness/show/${showId}`)
      .then((res) => {
        const labels = Array.isArray(res?.info?.labels) ? res.info.labels : [];
        showLabelCache.set(showId, labels);
        if (!cancelled) setFetchedLabels(labels);
      })
      .catch((err) => {
        // Deliberately NOT cached and NOT resolved: an unresolvable item keeps capture
        // off rather than defaulting to recording.
        logger().warn('show-label-fetch-failed', { showId, error: err?.message || String(err) });
        if (!cancelled) setFetchFailed(true);
      });
    return () => { cancelled = true; };
  }, [needsFetch, showId]);

  return useMemo(() => {
    if (!item) return { captureDisabled: false, studyUx: false, resolved: true };
    if (inline) return { ...resolveContentMode(item, plexConfig), resolved: true };
    if (!showId) {
      // Nothing to fetch against. Unresolvable — keep capture off.
      return { captureDisabled: false, studyUx: false, resolved: false };
    }
    if (fetchedLabels) {
      return { ...resolveContentMode({ labels: fetchedLabels }, plexConfig), resolved: true };
    }
    return { captureDisabled: false, studyUx: false, resolved: false };
  }, [item, inline, showId, fetchedLabels, fetchFailed, plexConfig]);
}

export default useContentMode;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run frontend/src/hooks/fitness/useContentMode.test.jsx`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/useContentMode.js frontend/src/hooks/fitness/useContentMode.test.jsx
git commit -m "feat(fitness): resolve content mode with fail-safe label backstop"
```

---

## Task 3: Gate the two frame-capture surfaces

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` (lines ~199-204, ~1986-1990)
- Test: `frontend/src/modules/Fitness/player/SessionCameraCapture.test.jsx` (create)

**Interfaces:**
- Consumes: `useContentMode` from Task 2.
- Produces: `contentMode` in `FitnessPlayer` scope — `{ captureDisabled, studyUx, resolved }`
  — used by every later task in this file.

**Context:** Both capture surfaces are currently gated only on `timelapseCfg.enabled !== false`.
`SessionCameraCapture` returns `null` **before** rendering `FitnessWebcam` (line 83), so
gating it means `getUserMedia` is never called — that is the actual privacy guarantee.
`captureAllowed` requires `resolved`, so an unresolved item does not record.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/player/SessionCameraCapture.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const webcamSpy = vi.fn();
vi.mock('@/modules/Fitness/components/FitnessWebcam.jsx', () => ({
  Webcam: (props) => { webcamSpy(props); return <div data-testid="webcam" />; }
}));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() }) })
}));

const SessionCameraCapture = (await import('./SessionCameraCapture.jsx')).default;

describe('SessionCameraCapture', () => {
  it('mounts the webcam when enabled', () => {
    const { queryByTestId } = render(<SessionCameraCapture sessionId="s1" enabled />);
    expect(queryByTestId('webcam')).not.toBeNull();
  });

  it('never mounts the webcam when disabled — getUserMedia is never reached', () => {
    webcamSpy.mockClear();
    const { queryByTestId } = render(<SessionCameraCapture sessionId="s1" enabled={false} />);
    expect(queryByTestId('webcam')).toBeNull();
    expect(webcamSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails or passes for the right reason**

Run: `npx vitest run frontend/src/modules/Fitness/player/SessionCameraCapture.test.jsx`
Expected: PASS — this characterizes existing behaviour so the gate wiring in Step 3 has a
safety net. If it FAILS, the component's early-return contract has changed and Task 3 must be
re-planned before proceeding.

- [ ] **Step 3: Wire the content mode and gate both capture surfaces**

In `FitnessPlayer.jsx`, add the import beside the other fitness hooks:

```javascript
import useContentMode from '@/hooks/fitness/useContentMode.js';
```

Replace the block at lines ~199-204 with:

```javascript
  const timelapseCfg = (fitnessConfiguration?.fitness || fitnessConfiguration || {})?.timelapse || {};

  // Content mode drives capture suppression and the study UX. `resolved` is false while
  // labels are still being fetched for items that arrived without them — capture stays
  // off until then, so an unresolvable item fails safe rather than recording.
  const contentMode = useContentMode(currentItem, plexConfig);
  const captureAllowed = timelapseCfg.enabled !== false
    && contentMode.resolved
    && !contentMode.captureDisabled;

  usePlayerFrameCapture({
    sessionId: fitnessSessionInstance?.sessionId ?? null,
    intervalMs: Number.isFinite(timelapseCfg.capture_interval_ms) ? timelapseCfg.capture_interval_ms : 1000,
    enabled: captureAllowed
  });
```

Then at the `<SessionCameraCapture>` render (~line 1986), change `enabled`:

```jsx
      <SessionCameraCapture
        sessionId={fitnessSessionInstance?.sessionId ?? null}
        intervalMs={Number.isFinite(timelapseCfg.capture_interval_ms) ? timelapseCfg.capture_interval_ms : 1000}
        enabled={captureAllowed}
      />
```

**Ordering note:** `currentItem` and `plexConfig` must both be declared above this block. If
either is declared later in the component, move this block below them rather than hoisting
their declarations.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/ frontend/src/hooks/fitness/`
Expected: PASS — the new file plus all existing fitness player/hook suites still green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx frontend/src/modules/Fitness/player/SessionCameraCapture.test.jsx
git commit -m "feat(fitness): gate frame capture on resolved content mode"
```

---

## Task 4: Gate the CameraViewApp widget

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (near the config-extraction memo, ~line 507-541)
- Modify: `frontend/src/modules/Fitness/nav/FitnessModuleMenu.jsx` (~line 109-116)
- Modify: `frontend/src/modules/Fitness/widgets/CameraViewApp/CameraViewApp.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CameraViewApp/CameraViewApp.test.jsx` (create)

**Interfaces:**
- Consumes: `contentMode` from Task 3.
- Produces: `captureDisabled` on fitness context, read via `useFitness()`.

**Context — `manifest.requires` is decorative.** It has **zero consumers** anywhere in the
codebase; `CameraViewApp` already declares `requires.sessionActive` and it has never been
enforced. Do **not** try to gate via `requires`, and do **not** build a general requires
evaluator — build this one gate.

Two places must change, because menu filtering alone does not stop an already-open webcam:

1. The module menu drops `camera_view` from its item list.
2. The widget itself renders a disabled state and tears down its stream.

The player publishes `captureDisabled` to context via the existing current-media publication
path so the menu (outside the player) can read it.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/widgets/CameraViewApp/CameraViewApp.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const webcamSpy = vi.fn();
vi.mock('@/modules/Fitness/components/FitnessWebcam.jsx', () => ({
  Webcam: (props) => { webcamSpy(props); return <div data-testid="webcam" />; }
}));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() }) })
}));

let mockCtx = { captureDisabled: false };
vi.mock('@/context/FitnessContext.jsx', () => ({ useFitness: () => mockCtx }));

vi.mock('@/modules/Fitness/hooks/useFitnessModule.js', () => ({
  default: () => ({ sessionId: 's1', isActive: true })
}));

const CameraViewApp = (await import('./CameraViewApp.jsx')).default;

describe('CameraViewApp capture gate', () => {
  it('renders the webcam normally', () => {
    mockCtx = { captureDisabled: false };
    webcamSpy.mockClear();
    const { queryByTestId } = render(<CameraViewApp />);
    expect(queryByTestId('webcam')).not.toBeNull();
  });

  it('tears down the stream and shows a disabled notice when capture is disabled', () => {
    mockCtx = { captureDisabled: true };
    webcamSpy.mockClear();
    const { queryByTestId, getByText } = render(<CameraViewApp />);
    expect(queryByTestId('webcam')).toBeNull();
    expect(webcamSpy).not.toHaveBeenCalled();
    expect(getByText(/camera is off/i)).toBeTruthy();
  });
});
```

**Adapt the mocks to the real module.** Before writing this file, open
`CameraViewApp.jsx` and confirm the actual hook import path used on line 18
(`useFitnessModule('camera_view')`) and the webcam import. Mock exactly those specifiers —
a `vi.mock` of a path the component does not import silently does nothing.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CameraViewApp/CameraViewApp.test.jsx`
Expected: FAIL — the disabled case still renders the webcam, and `/camera is off/i` is not found.

- [ ] **Step 3: Publish `captureDisabled` on context**

In `FitnessPlayer.jsx`, after `contentMode` is computed, publish it. Use the existing
context setter used for current media (`setCurrentMedia` is already imported from
`useFitness()`); add a dedicated effect rather than overloading that call:

```javascript
  // Publish capture suppression so consumers OUTSIDE the player (the module menu, the
  // camera widget) can honour it. manifest.requires is decorative — it gates nothing —
  // so this is the actual mechanism.
  const { setCaptureDisabled } = useFitness() || {};
  useEffect(() => {
    setCaptureDisabled?.(contentMode.resolved ? contentMode.captureDisabled : true);
  }, [contentMode.resolved, contentMode.captureDisabled, setCaptureDisabled]);
```

In `FitnessContext.jsx`, add the state and expose both the value and setter on the context
value object, alongside the existing exported fields:

```javascript
  // Capture suppression for the currently-playing item, published by FitnessPlayer.
  // Defaults to false so nothing changes when no player is mounted.
  const [captureDisabled, setCaptureDisabled] = useState(false);
```

Add `captureDisabled` and `setCaptureDisabled` to the context provider's value object.

- [ ] **Step 4: Filter the menu and gate the widget**

In `FitnessModuleMenu.jsx`, extend the `availableModules` memo:

```javascript
  const { captureDisabled } = useFitness() || {};

  const availableModules = useMemo(() => {
    // The menu is fully config-driven: items come from fitness.yml's
    // `plex.app_menus[].items` (SSoT). Each id is resolved to its registered
    // manifest; items without a manifest are dropped. Nothing is injected here.
    // Camera view is additionally withheld while capture is suppressed for the
    // playing item — manifest.requires is decorative and gates nothing.
    return (menuConfig?.items || [])
      .map(item => ({ ...item, manifest: getModuleManifest(item.id) }))
      .filter(item => item.manifest)
      .filter(item => !(captureDisabled && item.id === 'camera_view'));
  }, [menuConfig, captureDisabled]);
```

In `CameraViewApp.jsx`, add an early return above the main render (after existing hooks, so
hook order stays stable):

```jsx
  const { captureDisabled } = useFitness() || {};

  // Menu filtering cannot help an already-open panel — the widget must drop its own
  // stream when an instructional item starts playing.
  if (captureDisabled) {
    return (
      <div className="camera-view-app camera-view-app--disabled">
        <p>The camera is off for this content.</p>
      </div>
    );
  }
```

Import `useFitness` from `@/context/FitnessContext.jsx` if not already imported.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/`
Expected: PASS — new CameraViewApp tests green, all existing fitness suites still green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx frontend/src/modules/Fitness/nav/FitnessModuleMenu.jsx frontend/src/modules/Fitness/widgets/CameraViewApp/ frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): withhold camera widget when capture is suppressed"
```

---

## Task 5: Suppress the pause scrim in study mode

**Files:**
- Modify: `frontend/src/modules/Player/components/PlayerOverlayPaused.jsx`
- Modify: `frontend/src/modules/Player/Player.jsx` (~line 1051-1066, plus prop passthrough)
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` (`<Player>` render, ~line 1840)
- Test: `frontend/src/modules/Player/components/PlayerOverlayPaused.test.jsx` (create)

**Interfaces:**
- Consumes: `contentMode.studyUx` from Task 3.
- Produces: `suppressPauseOverlay` prop on `<Player>`.

**Context — use the new prop, not the existing `showPauseOverlay` state.** That internal
state also hides the overlay, but it drives `isVisible` false and suppresses stall feedback
with it. The new prop keeps `pauseOverlayActive` **true**, which is what keeps
`PlayerOverlayLoading` correctly suppressed (`PlayerOverlayLoading.jsx:58`:
`!pauseOverlayActive || stalled`). Getting this wrong swaps a pause glyph for a spinner.

**Stated exception:** because that condition is `|| stalled`, a paused jog into an unbuffered
region **will** briefly show the loading spinner. That is intended feedback, and the test
below locks it in.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Player/components/PlayerOverlayPaused.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../lib/playbackLogger.js', () => ({ playbackLog: vi.fn() }));
vi.mock('../../../assets/icons/pause.svg', () => ({ default: 'pause.svg' }));

const { PlayerOverlayPaused } = await import('./PlayerOverlayPaused.jsx');

const BASE = {
  shouldRender: true,
  isVisible: true,
  pauseOverlayActive: true,
  seconds: 42,
  stalled: false,
  waitingToPlay: false,
  togglePauseOverlay: () => {},
};

describe('PlayerOverlayPaused', () => {
  it('renders the pause scrim by default', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} />);
    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();
  });

  it('renders nothing when suppressPauseOverlay is set', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} suppressPauseOverlay />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });

  it('still renders nothing when suppressed during a stall', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} stalled suppressPauseOverlay />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/modules/Player/components/PlayerOverlayPaused.test.jsx`
Expected: FAIL — the suppressed cases still render `.loading-overlay.paused`.

- [ ] **Step 3: Implement the suppression**

In `PlayerOverlayPaused.jsx`, add the prop and extend the existing blackout early-return.
Place it immediately beside the blackout check so the two suppression reasons read together:

```jsx
export function PlayerOverlayPaused({
  shouldRender,
  isVisible,
  pauseOverlayActive = false,
  seconds = 0,
  stalled = false,
  waitingToPlay = false,
  togglePauseOverlay,
  playerPositionDisplay,
  suppressForBlackout = false,
  suppressPauseOverlay = false
}) {
  // In blackout mode, keep screen completely dark (TV appears off)
  if (suppressForBlackout) {
    return null;
  }
  // Study mode (instructional content): the paused frame is the thing the viewer
  // paused to look at, so nothing may cover it. Note this suppresses the SCRIM only —
  // `pauseOverlayActive` stays true upstream, which keeps PlayerOverlayLoading
  // suppressed too (see PlayerOverlayLoading.jsx). Stall feedback still surfaces.
  if (suppressPauseOverlay) {
    return null;
  }
```

Add to `propTypes`:

```javascript
  suppressPauseOverlay: PropTypes.bool,
```

In `Player.jsx`, accept the prop and pass it through. At the `overlayElements` block
(~line 1058):

```jsx
      <PlayerOverlayPaused
        {...overlayProps}
        suppressForBlackout={suppressOverlaysForBlackout}
        suppressPauseOverlay={props.suppressPauseOverlay}
      />
```

In `FitnessPlayer.jsx`, pass it from content mode at the `<Player>` render (~line 1840):

```jsx
            suppressPauseOverlay={contentMode.studyUx}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run frontend/src/modules/Player/ frontend/src/modules/Fitness/player/`
Expected: PASS — 3 new tests plus all existing Player and fitness player suites green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayPaused.jsx frontend/src/modules/Player/components/PlayerOverlayPaused.test.jsx frontend/src/modules/Player/Player.jsx frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(player): suppress pause scrim for study-mode content"
```

---

## Task 6: Preserve pause intent across resilience recovery

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx` (`forceSinglePlayerRemount`, ~line 459-522)
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` (~line 1016)
- Test: `frontend/src/modules/Player/hooks/pauseSurvivesRemount.test.jsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `wasPaused` on the remount diagnostics context consumed by
  `useCommonMediaController`.

**Context — this is the highest-risk behaviour in the whole plan.** Verified chain:

1. During any seek, user intent flips `paused → seeking`, so `isUserPaused` is false
   (`useMediaResilience.js:152-160`).
2. `isStuck` = has-played ∧ **not-user-paused** ∧ clock-not-advancing ∧ (stalled ∨ buffering ∨
   seeking) (`useMediaResilience.js:576`). A paused seek that wedges satisfies all of it.
3. After ~9.5s stuck the jolt ladder escalates to remount.
4. The rebuilt element sets `mediaEl.autoplay = true` **unconditionally**
   (`useCommonMediaController.js:1016`). The `snapshot.wasPaused` restore at `:1049-1059`
   exists only on the controller's soft-reinit path, not this one.

Net: a paused forward-jog into untranscoded territory resumes playback ~10s later on its own.
Study mode's signature gestures seed exactly this. **Acceptance criterion: a paused player
that goes through a resilience remount comes back paused.**

**Test-scope note — read this before starting.** The spec asks for an explicit test of this
behaviour. Driving the real jolt ladder end to end (wedged seek → 9.5s → remount) requires
booting the whole media stack with fake timers and is disproportionately brittle. This task
instead extracts the decision into a pure `shouldArmAutoplay` rule and tests that
exhaustively, then wires it at the single site that made the wrong decision. The residual
risk — that the value never reaches the rule — is covered by manual acceptance step 3 in
"Verification Before Deploy". If you can write a reliable integration test cheaply, add it;
do not spend more than one attempt before falling back to this decomposition.

`forceSinglePlayerRemount` already reads `playbackMetrics?.isPaused` — it logs it at line 505.
Carry that same value into the remount context instead of only logging it.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Player/hooks/pauseSurvivesRemount.test.jsx
import { describe, it, expect } from 'vitest';

// The rule under test, extracted so it can be asserted without booting the whole
// media stack: a remount that was paused must NOT arm autoplay.
import { shouldArmAutoplay } from './shouldArmAutoplay.js';

describe('shouldArmAutoplay', () => {
  it('arms autoplay for a normal (non-remount) load', () => {
    expect(shouldArmAutoplay(null)).toBe(true);
    expect(shouldArmAutoplay({})).toBe(true);
  });

  it('arms autoplay for a remount that was playing', () => {
    expect(shouldArmAutoplay({ wasPaused: false })).toBe(true);
  });

  it('does NOT arm autoplay for a remount that was paused', () => {
    expect(shouldArmAutoplay({ wasPaused: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/modules/Player/hooks/pauseSurvivesRemount.test.jsx`
Expected: FAIL — cannot resolve `./shouldArmAutoplay.js`.

- [ ] **Step 3: Implement the rule and wire it**

Create `frontend/src/modules/Player/hooks/shouldArmAutoplay.js`:

```javascript
/**
 * Whether a freshly-built media element should arm `autoplay`.
 *
 * A resilience remount rebuilds the element from scratch and previously armed autoplay
 * unconditionally, which silently resumed a player the user had deliberately paused —
 * a paused seek that wedges trips the jolt ladder (isStuck requires !isUserPaused, and
 * seeking clears that flag), and ~9.5s later the rebuilt element just started playing.
 *
 * @param {object|null} remountDiagnostics - remount context; `wasPaused` set by the remount
 * @returns {boolean}
 */
export function shouldArmAutoplay(remountDiagnostics) {
  return !remountDiagnostics?.wasPaused;
}

export default shouldArmAutoplay;
```

In `Player.jsx`, inside `forceSinglePlayerRemount`, add `wasPaused` to the `diagnostics`
object (which becomes the remount context passed to the renderer as `remountDiagnostics`):

```javascript
    const diagnostics = {
      reason,
      source,
      seekSeconds: normalized,
      trigger,
      conditions,
      waitKey: resolvedWaitKey,
      remountNonce: currentRemountNonce + 1,
      timestamp: Date.now(),
      scheduledDelayMs,
      attempt,
      // Carried so the rebuilt element does not autoplay over a deliberate pause.
      wasPaused: playbackMetrics?.isPaused === true
    };
```

In `useCommonMediaController.js`, import the rule and replace the unconditional assignment at
line ~1016:

```javascript
import { shouldArmAutoplay } from './shouldArmAutoplay.js';
```

```javascript
      mediaEl.autoplay = shouldArmAutoplay(remountDiagnostics);
```

**Verify the binding name.** `remountDiagnostics` is passed into the renderer via
`playerProps` (`Player.jsx:1101`). Confirm how `useCommonMediaController` receives it — if it
arrives under a different parameter name, use that name. Do **not** invent a new prop chain;
the value already flows.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run frontend/src/modules/Player/`
Expected: PASS — 3 new tests plus all existing Player suites green. Pay attention to any
resilience/ledger suite: if one asserts autoplay behaviour, reconcile it deliberately rather
than editing the assertion to match.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/shouldArmAutoplay.js frontend/src/modules/Player/hooks/pauseSurvivesRemount.test.jsx frontend/src/modules/Player/Player.jsx frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "fix(player): keep a paused player paused across resilience remount"
```

---

## Task 7: Study-mode layout — no sidebar, clamped video, no tap-to-fullscreen

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` (sizing effect ~886-975;
  fullscreen tap handlers ~1691-1753; sidebar width ~1651; footer/sidebar render ~1884-1925)
- Test: `frontend/src/modules/Fitness/player/studyLayout.test.js` (create)

**Interfaces:**
- Consumes: `contentMode.studyUx` from Task 3.
- Produces: `computeStudyDims({ totalW, totalH, footerRatio })
  -> { videoW, videoH, footerHeight }`.

**Context — the existing layout derives the footer as leftover space.** Video is sized from
width first (available width minus sidebar, at 16:9); the footer gets whatever height
remains. There is no ratio to set, so study mode needs a different sizing rule: clamp height
first, derive width from it, centre horizontally.

**Correction to a common misreading:** the sub-5% fullscreen auto-snap (line ~928) is *not*
what strands the footer. With the sidebar present, normal mode on a 16:9 display already
leaves roughly a 13% footer, so the snap cannot fire. Fullscreen comes from the
**tap-to-toggle gesture** — that is what must be disabled. Both handlers matter: the
content-level one (~1691) and the root-capture one (~1725).

Extract the arithmetic into a pure function so it can be tested without a DOM.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Fitness/player/studyLayout.test.js
import { describe, it, expect } from 'vitest';
import { computeStudyDims } from './studyLayout.js';

describe('computeStudyDims', () => {
  it('reserves the configured footer share and clamps video height', () => {
    const { videoH, footerHeight } = computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: 0.2 });
    expect(videoH).toBe(864);        // 1080 * 0.8
    expect(footerHeight).toBe(216);  // 1080 * 0.2
  });

  it('derives width from the clamped height at 16:9', () => {
    const { videoW } = computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: 0.2 });
    expect(videoW).toBe(1536);       // 864 * 16/9
  });

  it('clamps width to the viewport when height-derived width would overflow', () => {
    // A tall/narrow viewport: 864*16/9 = 1536 exceeds 1000, so width wins and
    // height is re-derived from it.
    const { videoW, videoH } = computeStudyDims({ totalW: 1000, totalH: 1080, footerRatio: 0.2 });
    expect(videoW).toBe(1000);
    expect(videoH).toBe(563);        // round(1000 * 9/16)
  });

  it('uses the full width — no sidebar is reserved in study mode', () => {
    const { videoW } = computeStudyDims({ totalW: 1280, totalH: 720, footerRatio: 0.2 });
    expect(videoW).toBe(1024);       // 576 * 16/9, well under 1280
  });

  it('falls back to a 0.2 ratio when given a nonsense value', () => {
    expect(computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: null }).footerHeight).toBe(216);
    expect(computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: 5 }).footerHeight).toBe(216);
  });

  it('returns zeros for a zero-sized viewport rather than NaN', () => {
    expect(computeStudyDims({ totalW: 0, totalH: 0, footerRatio: 0.2 }))
      .toEqual({ videoW: 0, videoH: 0, footerHeight: 0 });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/studyLayout.test.js`
Expected: FAIL — cannot resolve `./studyLayout.js`.

- [ ] **Step 3: Write the layout helper**

Create `frontend/src/modules/Fitness/player/studyLayout.js`:

```javascript
/**
 * Study-mode video sizing.
 *
 * Workout mode sizes video from WIDTH first (viewport minus sidebar, at 16:9) and gives
 * the footer whatever height is left over — which on a 16:9 display is nearly nothing.
 * Study mode inverts that: reserve the footer band first, clamp video height to what
 * remains, then derive width. The sidebar is not reserved at all (there is no workout to
 * monitor), so the video gets the full width budget.
 */
const DEFAULT_FOOTER_RATIO = 0.2;

export function computeStudyDims({ totalW, totalH, footerRatio }) {
  const w = Number.isFinite(totalW) && totalW > 0 ? totalW : 0;
  const h = Number.isFinite(totalH) && totalH > 0 ? totalH : 0;
  if (w === 0 || h === 0) return { videoW: 0, videoH: 0, footerHeight: 0 };

  const ratio = Number.isFinite(footerRatio) && footerRatio > 0 && footerRatio < 1
    ? footerRatio
    : DEFAULT_FOOTER_RATIO;

  const footerHeight = Math.round(h * ratio);
  let videoH = h - footerHeight;
  let videoW = Math.round(videoH * 16 / 9);

  // Narrow viewport: width binds instead, so re-derive height from it.
  if (videoW > w) {
    videoW = w;
    videoH = Math.round(videoW * 9 / 16);
  }

  return { videoW: Math.max(0, videoW), videoH: Math.max(0, Math.round(videoH)), footerHeight };
}

export default computeStudyDims;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/studyLayout.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Wire it into the player**

In `FitnessPlayer.jsx`:

1. Import the helper and read the config:

```javascript
import { computeStudyDims } from './studyLayout.js';
```

```javascript
  const studyCfg = (fitnessConfiguration?.fitness || fitnessConfiguration || {})?.study_mode || {};
```

2. In the sizing effect (~line 886), branch before the existing width-first math. When
   `contentMode.studyUx` is true, use the helper, force `hideFooter: false`, and **skip the
   fullscreen auto-snap entirely**:

```javascript
        if (contentMode.studyUx) {
          const { videoW: sw, videoH: sh, footerHeight: sf } =
            computeStudyDims({ totalW, totalH, footerRatio: studyCfg.footer_height_ratio });
          hasInitializedLayoutRef.current = true;
          setVideoDims(prev => (prev.width === sw && prev.height === sh
            && prev.hideFooter === false && prev.footerHeight === sf)
            ? prev
            : { width: sw, height: sh, hideFooter: false, footerHeight: sf });
          return;
        }
```

3. Force the player out of fullscreen while study mode is active:

```javascript
  // Study mode never uses fullscreen — the footer must stay reachable.
  useEffect(() => {
    if (contentMode.studyUx && playerMode === 'fullscreen') setPlayerMode('normal');
  }, [contentMode.studyUx, playerMode]);
```

4. Zero the sidebar width (~line 1651):

```javascript
  if (playerMode === 'fullscreen' || contentMode.studyUx) sidebarRenderWidth = 0;
  else sidebarRenderWidth = (sidebarSizeMode === 'large' ? Math.round(viewportW * 0.45) : DEFAULT_SIDEBAR);
```

5. Withhold the sidebar content (~line 1884):

```javascript
  const sidebarContent = (hasActiveItem && !contentMode.studyUx) ? (
```

6. Neutralise **both** fullscreen tap handlers. In each of
   `handleVideoContainerPointerDown` (~1691) and the root pointer-down capture handler
   (~1725), return early:

```javascript
    // Study mode: taps must never toggle fullscreen — losing the footer mid-scrub is
    // the exact failure this mode exists to prevent. Suppressing the pause scrim also
    // removed the shield that used to block paused taps from reaching this handler.
    if (contentMode.studyUx) return;
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/`
Expected: PASS — all fitness suites green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/studyLayout.js frontend/src/modules/Fitness/player/studyLayout.test.js frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): study-mode layout with reachable footer, no tap-to-fullscreen"
```

---

## Task 8: Loop engine

**Files:**
- Create: `frontend/src/modules/Fitness/player/hooks/useLoopWindow.js`
- Test: `frontend/src/modules/Fitness/player/hooks/useLoopWindow.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useLoopWindow({ getMediaElement, onSeek })` returning
  `{ loop, armLoop(direction, seconds, position, duration), releaseLoop(), isBoundarySeek() }`
  where `loop` is `{ start, end, direction, seconds } | null` and `direction` is
  `'back' | 'forward'`.

**Context:** Two failure modes the design calls out explicitly.

1. **The loop's own boundary seek must not release the loop.** "Any manual seek releases" is
   ambiguous because the boundary seek *is* a seek, and recovery seeks use the same
   machinery. The hook marks its own seeks with a ref flag the caller checks.
2. **The `timeupdate` listener must re-attach when the media element is replaced.** A
   resilience remount swaps the element; a once-bound listener dies silently mid-loop. Poll
   for element identity the same way `FitnessPlayer` already tracks `mediaElement` (a 500ms
   interval, `FitnessPlayer.jsx:219`), and re-bind on change.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/player/hooks/useLoopWindow.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useLoopWindow, { computeLoopWindow } from './useLoopWindow.js';

vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) })
}));

describe('computeLoopWindow', () => {
  it('loops backward, ending at the pause point', () => {
    expect(computeLoopWindow('back', 10, 252, 1110)).toEqual({ start: 242, end: 252 });
  });

  it('loops forward, starting at the pause point', () => {
    expect(computeLoopWindow('forward', 30, 252, 1110)).toEqual({ start: 252, end: 282 });
  });

  it('clamps the backward start at 0', () => {
    expect(computeLoopWindow('back', 30, 10, 1110)).toEqual({ start: 0, end: 10 });
  });

  it('clamps the forward end at duration', () => {
    expect(computeLoopWindow('forward', 30, 1100, 1110)).toEqual({ start: 1100, end: 1110 });
  });

  it('returns null for a degenerate window', () => {
    expect(computeLoopWindow('back', 10, 0, 1110)).toBeNull();
    expect(computeLoopWindow('forward', 10, 1110, 1110)).toBeNull();
  });

  it('returns null for a nonsense duration', () => {
    expect(computeLoopWindow('back', 10, 252, null)).toBeNull();
  });
});
```

Add hook-level tests in the same file:

```jsx
const makeEl = (t = 0) => ({
  currentTime: t,
  paused: false,
  _handlers: {},
  addEventListener(ev, fn) { this._handlers[ev] = fn; },
  removeEventListener(ev) { delete this._handlers[ev]; },
  fireTimeUpdate() { this._handlers.timeupdate?.(); },
});

describe('useLoopWindow', () => {
  it('seeks back to start when playback passes the loop end', () => {
    const el = makeEl(0);
    const onSeek = vi.fn();
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    act(() => { result.current.armLoop('forward', 10, 100, 1000); });
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });

    expect(onSeek).toHaveBeenCalledWith(100);
  });

  it('marks its own boundary seek so the loop does not self-release', () => {
    const el = makeEl(0);
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek: () => {} }));

    act(() => { result.current.armLoop('forward', 10, 100, 1000); });
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });

    expect(result.current.isBoundarySeek()).toBe(true);
    expect(result.current.loop).not.toBeNull();
  });

  it('releaseLoop clears the window', () => {
    const el = makeEl(0);
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek: () => {} }));
    act(() => { result.current.armLoop('back', 10, 100, 1000); });
    expect(result.current.loop).not.toBeNull();
    act(() => { result.current.releaseLoop(); });
    expect(result.current.loop).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useLoopWindow.test.jsx`
Expected: FAIL — cannot resolve `./useLoopWindow.js`.

- [ ] **Step 3: Write the implementation**

```javascript
// frontend/src/modules/Fitness/player/hooks/useLoopWindow.js
import { useCallback, useEffect, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'study-loop' });
  return _logger;
}

/**
 * Computes a loop window anchored to the paused position.
 *
 * There is deliberately no endpoint marking: the paused position is one edge, and the
 * caller picks which side and how long. Backward means "I just watched that, run it
 * again"; forward means "run what comes next".
 *
 * @returns {{start: number, end: number}|null} null for degenerate/unknown windows
 */
export function computeLoopWindow(direction, seconds, position, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(position) || !Number.isFinite(seconds) || seconds <= 0) return null;
  const p = Math.min(Math.max(position, 0), duration);
  const start = direction === 'back' ? Math.max(0, p - seconds) : p;
  const end = direction === 'back' ? p : Math.min(duration, p + seconds);
  if (end - start <= 0) return null;
  return { start, end };
}

/**
 * Repeats a fixed window until released.
 *
 * Two subtleties this hook owns:
 *  - Its own boundary seek must NOT count as a user seek, or the loop would release
 *    itself on the first repetition. Callers check `isBoundarySeek()` before releasing.
 *  - A resilience remount REPLACES the media element, so a once-bound `timeupdate`
 *    listener would die silently mid-loop. The element is re-resolved on an interval
 *    and the listener re-bound whenever identity changes.
 */
export default function useLoopWindow({ getMediaElement, onSeek }) {
  const [loop, setLoop] = useState(null);
  const loopRef = useRef(null);
  const boundarySeekRef = useRef(false);
  const [element, setElement] = useState(null);

  // Track element replacement (resilience remounts swap it out from under us).
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      const next = getMediaElement?.() || null;
      if (!cancelled) setElement((prev) => (prev === next ? prev : next));
    };
    sync();
    const id = setInterval(sync, 500);
    return () => { cancelled = true; clearInterval(id); };
  }, [getMediaElement]);

  useEffect(() => {
    if (!element) return undefined;
    const onTimeUpdate = () => {
      const win = loopRef.current;
      if (!win) return;
      if (element.currentTime >= win.end || element.currentTime < win.start - 1) {
        boundarySeekRef.current = true;
        onSeek?.(win.start);
      }
    };
    element.addEventListener('timeupdate', onTimeUpdate);
    return () => element.removeEventListener('timeupdate', onTimeUpdate);
  }, [element, onSeek]);

  const armLoop = useCallback((direction, seconds, position, duration) => {
    const win = computeLoopWindow(direction, seconds, position, duration);
    if (!win) {
      logger().warn('loop-window-degenerate', { direction, seconds, position, duration });
      return;
    }
    const next = { ...win, direction, seconds };
    loopRef.current = next;
    setLoop(next);
    logger().info('loop-armed', next);
  }, []);

  const releaseLoop = useCallback(() => {
    if (!loopRef.current) return;
    logger().info('loop-released', loopRef.current);
    loopRef.current = null;
    setLoop(null);
  }, []);

  /** True (once) if the most recent seek was the loop's own boundary seek. */
  const isBoundarySeek = useCallback(() => {
    const was = boundarySeekRef.current;
    boundarySeekRef.current = false;
    return was;
  }, []);

  return { loop, armLoop, releaseLoop, isBoundarySeek };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useLoopWindow.test.jsx`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/useLoopWindow.js frontend/src/modules/Fitness/player/hooks/useLoopWindow.test.jsx
git commit -m "feat(fitness): loop engine anchored to the paused position"
```

---

## Task 9: Study controls — jog, loop, mirror

**Files:**
- Create: `frontend/src/modules/Fitness/player/footer/StudyControls.jsx`
- Create: `frontend/src/modules/Fitness/player/footer/StudyControls.scss`
- Modify: `frontend/src/modules/Fitness/player/footer/FitnessPlayerFooterView.jsx`
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`
- Test: `frontend/src/modules/Fitness/player/footer/StudyControls.test.jsx`

**Interfaces:**
- Consumes: `useLoopWindow` (Task 8); `contentMode.studyUx` (Task 3); the existing
  `videoMirrored` / `toggleVideoMirror` pair (`FitnessPlayer.jsx:1663-1670`).
- Produces: `<StudyControls />` rendered inside the footer.

**Context:** Loop options appear **only while paused**. Mirror reuses existing state — do not
add new mirror state; the corner hotspots stay for workout mode. Icons must be inline SVG or
plain text, **never unicode glyphs** (the kiosk WebView renders tofu for many of them).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/player/footer/StudyControls.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import StudyControls from './StudyControls.jsx';

const BASE = {
  isPaused: true,
  jogSteps: [5, 10],
  loopDurations: [10, 15, 20, 30],
  loop: null,
  onJog: vi.fn(),
  onArmLoop: vi.fn(),
  onReleaseLoop: vi.fn(),
  videoMirrored: false,
  onToggleMirror: vi.fn(),
};

describe('StudyControls', () => {
  it('renders a jog button per configured step, both directions', () => {
    const { getByLabelText } = render(<StudyControls {...BASE} />);
    expect(getByLabelText('Back 5 seconds')).toBeTruthy();
    expect(getByLabelText('Back 10 seconds')).toBeTruthy();
    expect(getByLabelText('Forward 5 seconds')).toBeTruthy();
    expect(getByLabelText('Forward 10 seconds')).toBeTruthy();
  });

  it('calls onJog with a signed delta', () => {
    const onJog = vi.fn();
    const { getByLabelText } = render(<StudyControls {...BASE} onJog={onJog} />);
    fireEvent.click(getByLabelText('Back 10 seconds'));
    expect(onJog).toHaveBeenCalledWith(-10);
    fireEvent.click(getByLabelText('Forward 5 seconds'));
    expect(onJog).toHaveBeenCalledWith(5);
  });

  it('shows loop options only while paused', () => {
    const { queryByLabelText, rerender } = render(<StudyControls {...BASE} />);
    expect(queryByLabelText('Loop back 15 seconds')).toBeTruthy();
    rerender(<StudyControls {...BASE} isPaused={false} />);
    expect(queryByLabelText('Loop back 15 seconds')).toBeNull();
  });

  it('arms a loop with direction and duration', () => {
    const onArmLoop = vi.fn();
    const { getByLabelText } = render(<StudyControls {...BASE} onArmLoop={onArmLoop} />);
    fireEvent.click(getByLabelText('Loop forward 20 seconds'));
    expect(onArmLoop).toHaveBeenCalledWith('forward', 20);
  });

  it('releases when the armed option is tapped again', () => {
    const onReleaseLoop = vi.fn();
    const { getByLabelText } = render(
      <StudyControls {...BASE} loop={{ direction: 'forward', seconds: 20 }} onReleaseLoop={onReleaseLoop} />
    );
    fireEvent.click(getByLabelText('Loop forward 20 seconds'));
    expect(onReleaseLoop).toHaveBeenCalled();
  });

  it('marks the armed option active', () => {
    const { getByLabelText } = render(
      <StudyControls {...BASE} loop={{ direction: 'back', seconds: 15 }} />
    );
    expect(getByLabelText('Loop back 15 seconds').className).toMatch(/is-active/);
  });

  it('exposes a mirror toggle reflecting current state', () => {
    const onToggleMirror = vi.fn();
    const { getByLabelText } = render(<StudyControls {...BASE} onToggleMirror={onToggleMirror} />);
    const btn = getByLabelText('Mirror video');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(onToggleMirror).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/player/footer/StudyControls.test.jsx`
Expected: FAIL — cannot resolve `./StudyControls.jsx`.

- [ ] **Step 3: Write the component**

```jsx
// frontend/src/modules/Fitness/player/footer/StudyControls.jsx
import React from 'react';
import PropTypes from 'prop-types';
import './StudyControls.scss';

/**
 * Study-mode transport: paused jogging, anchored loop windows, and a visible mirror
 * toggle.
 *
 * Loop options appear only while paused, so the window is always anchored to a position
 * the viewer deliberately chose and can see on screen. Icons are inline SVG or plain
 * text — the kiosk WebView renders tofu for many unicode glyphs.
 */
export default function StudyControls({
  isPaused,
  jogSteps,
  loopDurations,
  loop,
  onJog,
  onArmLoop,
  onReleaseLoop,
  videoMirrored,
  onToggleMirror,
}) {
  const loopRow = (direction, label) => (
    <div className="study-controls__row">
      <span className="study-controls__label">{label}</span>
      {loopDurations.map((secs) => {
        const armed = loop?.direction === direction && loop?.seconds === secs;
        return (
          <button
            key={`${direction}-${secs}`}
            type="button"
            className={`study-controls__chip${armed ? ' is-active' : ''}`}
            aria-label={`Loop ${direction} ${secs} seconds`}
            aria-pressed={armed}
            onClick={() => (armed ? onReleaseLoop() : onArmLoop(direction, secs))}
          >
            {secs}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="study-controls">
      <div className="study-controls__row">
        {[...jogSteps].reverse().map((secs) => (
          <button
            key={`back-${secs}`}
            type="button"
            className="study-controls__jog"
            aria-label={`Back ${secs} seconds`}
            onClick={() => onJog(-secs)}
          >
            {`- ${secs}s`}
          </button>
        ))}
        {jogSteps.map((secs) => (
          <button
            key={`fwd-${secs}`}
            type="button"
            className="study-controls__jog"
            aria-label={`Forward ${secs} seconds`}
            onClick={() => onJog(secs)}
          >
            {`+ ${secs}s`}
          </button>
        ))}
        <button
          type="button"
          className={`study-controls__mirror${videoMirrored ? ' is-active' : ''}`}
          aria-label="Mirror video"
          aria-pressed={videoMirrored}
          onClick={onToggleMirror}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 3v18" />
            <path d="M8 7 4 12l4 5z" />
            <path d="M16 7l4 5-4 5z" />
          </svg>
          <span>Mirror</span>
        </button>
      </div>

      {isPaused && (
        <>
          {loopRow('back', 'Loop back')}
          {loopRow('forward', 'Loop fwd')}
        </>
      )}
    </div>
  );
}

StudyControls.propTypes = {
  isPaused: PropTypes.bool,
  jogSteps: PropTypes.arrayOf(PropTypes.number).isRequired,
  loopDurations: PropTypes.arrayOf(PropTypes.number).isRequired,
  loop: PropTypes.shape({ direction: PropTypes.string, seconds: PropTypes.number }),
  onJog: PropTypes.func.isRequired,
  onArmLoop: PropTypes.func.isRequired,
  onReleaseLoop: PropTypes.func.isRequired,
  videoMirrored: PropTypes.bool,
  onToggleMirror: PropTypes.func.isRequired,
};
```

```scss
// frontend/src/modules/Fitness/player/footer/StudyControls.scss
.study-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 1rem;

  &__row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  &__label {
    min-width: 6.5rem;
    font-size: 0.85rem;
    color: #b8b8b8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  // Discrete tap targets — no sliders anywhere in the kiosk touch UI.
  &__jog,
  &__chip,
  &__mirror {
    min-width: 3.25rem;
    min-height: 2.75rem;
    padding: 0 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: #e8e8e8;
    font-size: 1rem;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    &:active { background: rgba(255, 255, 255, 0.16); }
    &.is-active {
      background: rgba(74, 163, 255, 0.22);
      border-color: #4aa3ff;
      color: #fff;
    }
  }

  &__mirror {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/player/footer/StudyControls.test.jsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Wire it into the footer and player**

In `FitnessPlayerFooterView.jsx`, accept a `studyControls` node prop and render it above the
existing controls when present. Add `studyControls = null` to the destructured props, add
`studyControls: PropTypes.node` to `propTypes`, and render it as the first child of the
footer's root element:

```jsx
      {studyControls}
```

Do not restructure the footer for the non-study case — when `studyControls` is `null` the
rendered output is byte-identical to today's.

In `FitnessPlayer.jsx`:

```javascript
  const loopApi = useLoopWindow({
    getMediaElement: () => playerRef.current?.getMediaElement?.() || null,
    onSeek: handleSeek,
  });
```

Release the loop on **user** seeks only — the loop's own boundary seek must not self-release.
Wrap the footer's seek handler rather than `handleSeek` itself (which the loop also calls):

```javascript
  const handleUserSeek = useCallback((seconds) => {
    if (!loopApi.isBoundarySeek()) loopApi.releaseLoop();
    handleSeek(seconds);
  }, [loopApi, handleSeek]);
```

Build the study controls node and pass it to the footer:

```jsx
  const studyControlsNode = contentMode.studyUx ? (
    <StudyControls
      isPaused={isPaused}
      jogSteps={Array.isArray(studyCfg.jog_steps) ? studyCfg.jog_steps : [5, 10]}
      loopDurations={Array.isArray(studyCfg.loop_durations) ? studyCfg.loop_durations : [10, 15, 20, 30]}
      loop={loopApi.loop}
      onJog={(delta) => handleUserSeek((getPlayerTime?.() || 0) + delta)}
      onArmLoop={(direction, secs) =>
        loopApi.armLoop(direction, secs, getPlayerTime?.() || 0, getPlayerDuration?.() || 0)}
      onReleaseLoop={loopApi.releaseLoop}
      videoMirrored={videoMirrored}
      onToggleMirror={toggleVideoMirror}
    />
  ) : null;
```

Pass `studyControls={studyControlsNode}` in the `<FitnessPlayerFooter ... />` render, and
switch that render's `onSeek` to `handleUserSeek`.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/`
Expected: PASS — all fitness suites green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/footer/StudyControls.jsx frontend/src/modules/Fitness/player/footer/StudyControls.scss frontend/src/modules/Fitness/player/footer/StudyControls.test.jsx frontend/src/modules/Fitness/player/footer/FitnessPlayerFooterView.jsx frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): study controls for jog, loop, and mirror"
```

---

## Task 10: Config, Plex label, and documentation

**Files:**
- Modify: `data/household/config/fitness.yml` (**inside the Docker volume — see below**)
- Create: `docs/reference/fitness/content-modes.md`
- Modify: `frontend/src/modules/Admin/Apps/FitnessConfig.jsx` (~line 206-226)

**Interfaces:**
- Consumes: everything above.
- Produces: live configuration.

**Context:** `fitness.yml` lives in the Docker data volume and is **not** readable/writable
directly by the `claude` user. Read with `sudo docker exec`, and write the **complete file**
with a heredoc. **Never use `sed -i`** on YAML in the container — it mangles multi-line
structure. Config is cached in memory at startup, so changes need a restart to take effect.

- [ ] **Step 1: Read the current config and confirm the insertion point**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml' > /tmp/claude-1001/fitness.yml.bak
grep -n "resumable_labels\|sequential_labels\|governed_labels" /tmp/claude-1001/fitness.yml.bak
```

Expected: the existing `*_labels` keys under `plex:`, confirming where the new keys go.

- [ ] **Step 2: Add the config keys**

Write the complete file back with the two label lists added under `plex:` beside the other
`*_labels` keys, and a new top-level `study_mode:` block:

```yaml
  # Content whose session must never be recorded — no webcam, no player frames,
  # no recap. Independent of study_ux_labels.
  no_capture_labels:
    - Instructional
  # Content that gets the study interaction model: no pause scrim, a permanently
  # reachable scrub footer, paused jogging, loop windows, visible mirror toggle.
  study_ux_labels:
    - Instructional
```

```yaml
study_mode:
  loop_durations: [10, 15, 20, 30]
  jog_steps: [5, 10]
  footer_height_ratio: 0.20
```

Verify the write round-trips as valid YAML:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml' | head -40
node -e "const y=require('js-yaml');const {execSync}=require('child_process');const s=execSync(\"sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml'\",{encoding:'utf8'});const c=y.load(s);console.log('no_capture:',c.plex.no_capture_labels,'study_ux:',c.plex.study_ux_labels,'study_mode:',c.study_mode);"
```

Expected: both arrays and the `study_mode` block print with the values above.

- [ ] **Step 3: Confirm the Plex label is already applied**

```bash
node cli/plex.cli.mjs info 696065 --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).Label))"
```

Expected: `[ { ..., tag: 'Instructional' } ]`. If absent, apply it:
`node cli/plex.cli.mjs set 696065 --labels "Instructional" --lock`

- [ ] **Step 4: Surface the new lists in the admin config UI**

In `FitnessConfig.jsx`, add two entries mirroring the existing label editors at lines
206-226 — same component, same `update('plex.<key>', vals)` shape — for
`plex.no_capture_labels` and `plex.study_ux_labels`.

- [ ] **Step 5: Write the reference doc**

Create `docs/reference/fitness/content-modes.md` describing, in present tense (reference docs
describe the endstate, not the change): the two label lists and their independence; what each
suppresses or swaps; the fail-safe rule that capture stays off until the mode resolves; the
stated scope boundary that frame capture stops but session telemetry does not; and the
`study_mode` tunables.

- [ ] **Step 6: Run the full frontend suite**

Run: `npx vitest run frontend/src/modules/Fitness/ frontend/src/modules/Player/ frontend/src/hooks/fitness/`
Expected: PASS — everything green.

- [ ] **Step 7: Commit**

```bash
git add docs/reference/fitness/content-modes.md frontend/src/modules/Admin/Apps/FitnessConfig.jsx
git commit -m "docs(fitness): document content modes; expose label lists in admin"
```

---

## Verification Before Deploy

Deploying restarts the container. **Confirm the garage is idle first** — both gates must be
clear, per `CLAUDE.local.md`:

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```

Clear means: zero recurring render lines, no `videoState:"playing"`, `sessionActive:false`,
`rosterSize:0`. **If either gate is active, stop and wait** — do not chain the deploy behind
this check.

After deploying, reload the garage kiosk (it serves the old bundle until refreshed):

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```

**Manual acceptance on the garage display**, playing an episode of show `696065`:

1. No webcam indicator; `camera_view` absent from the module menu.
2. Pause — the frame stays crisp. No dim, no full-screen glyph.
3. Jog back and forward while paused — the frame steps and **stays paused**.
4. Arm a forward 30s loop — it repeats hands-free; tapping the armed chip releases it.
5. Tap the video — nothing happens; the footer is still there.
6. Mirror button flips the video.
7. Play any *unlabelled* workout — camera records, pause scrim returns, fullscreen tap works.
   **This is the regression check that matters most.**

Confirm no recap frames were written for the instructional session (session logs live under
`media/logs/{app}/`).
