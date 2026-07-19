# Search Honors Cast Target — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a selection from the Media dock's search bar cast to the cast-target chip's configured device(s) instead of always playing locally.

**Architecture:** `useContentDispatch` is the single routing seam between the search bar and the playback surfaces. Today it consults only `useNav()`, so it has exactly two outcomes: cast-to-peeked-device (in `peek` view) or play-locally (everywhere else). We add a third branch between them that reads `useCastTarget()` — the same context `CastButton`/`useDispatchTargetPicker` already honor — and dispatches to the chip's `targetIds` with the chip's `mode`. The hook also starts returning which branch it took, so the search bar can log the destination (the absence of that field is why the original incident was ambiguous in the logs).

**Tech Stack:** React 18 (hooks + context), Vitest + @testing-library/react, ESM `.jsx`/`.js` frontend modules.

## Background — the defect this fixes

On 2026-07-19 02:19 UTC a user with `livingroom-tv` selected in the cast chip searched "FIFA", picked Episode 3 (`plex:685088`), and the episode began playing in their **Mac browser tab**. The living room TV was never contacted. Container logs show:

```
02:19:02.082  select   {"contentId":"plex:685088","title":"Episode 3"}   ← Mac UA
02:19:02.084  dispatch {"contentId":"plex:685088"}                        ← no target, no dispatchId
02:19:02.300  dash.api-ready /api/v1/proxy/plex/stream/685088             ← Mac UA
```

No `wake-and-load`, no `device.router.load`, no `commands.queue`. The first request that reached `livingroom-tv` was at 02:21:18 — a manual API fallback.

Root cause: `frontend/src/modules/Media/search/useContentDispatch.js:19-31` never reads `useCastTarget()`, even though `CastTargetChip` sits beside the search box in the same `Dock` (`shell/Dock.jsx:23-26`).

**Out of scope:** the separate local-playback failure that followed (six `startup-deadline-exceeded` remounts, `[HTTPLoader] Request timeout`, `stall_threshold_exceeded`). That is a Player/Plex-transcode issue with its own root cause and is not addressed here.

## Global Constraints

- Routing precedence is exactly: **peek-view device → cast-chip targets → local**. A `peek` view with a `deviceId` always wins, even when the chip has targets.
- Cast dispatches from search use the chip's `mode` verbatim (`'transfer'` or `'fork'`). Do not hardcode a mode; do not override the user's choice.
- The `peek` branch keeps its existing hardcoded `mode: 'fork'` — peek is a remote control and must never stop the peeked device's session.
- `useContentDispatch` must keep returning a **referentially stable** callback across re-renders (there is an existing test asserting this).
- Never log or display a raw content id where a human title is available — existing module copy rule.
- Use the logging framework (`getLogger`/`mediaLog`), never raw `console.*`.
- All new tests are Vitest, run with `npx vitest run <path>` from the repo root.

---

### Task 1: Route search selections to the cast target

**Files:**
- Modify: `frontend/src/modules/Media/search/useContentDispatch.js` (whole file, currently 35 lines)
- Test: `frontend/src/modules/Media/search/useContentDispatch.test.jsx` (add mock + 6 tests)
- Modify: `docs/reference/media/media-app.md:197-209` (dock bullet list)

**Interfaces:**
- Consumes: `useCastTarget()` from `frontend/src/modules/Media/cast/useCastTarget.js`, returning `{ mode: 'transfer' | 'fork', targetIds: string[], setMode, toggleTarget, clearTargets }`. `CastTargetProvider` wraps `DispatchProvider` in `frontend/src/Apps/MediaApp.jsx:44-52`, so the provider is guaranteed present above `Dock`.
- Consumes: `dispatchToTarget({ targetIds, play, mode, title })` from `frontend/src/modules/Media/cast/DispatchProvider.jsx:53`.
- Produces: `useContentDispatch()` returns `(id: string, item?: object) => 'peek' | 'cast' | 'local'` — the branch taken. Task 2 consumes this return value.

- [ ] **Step 1: Add the cast-target mock to the test file**

Insert this block into `frontend/src/modules/Media/search/useContentDispatch.test.jsx` immediately after the `useSessionController` mock (currently ends at line 21), before the `import { useContentDispatch }` line:

```jsx
// Mutable holder — the factory closes over it but only reads at render time.
// Default is "no preferred target", which is what the pre-existing local-playback
// tests below assume.
let castTargetState = { targetIds: [], mode: 'transfer' };
vi.mock('../cast/useCastTarget.js', () => ({
  useCastTarget: () => castTargetState,
}));
```

Then add the reset to the existing `beforeEach` (currently lines 25-29), so it reads:

```jsx
beforeEach(() => {
  dispatchToTarget.mockClear();
  playNow.mockClear();
  navState = { view: 'home', params: {} };
  castTargetState = { targetIds: [], mode: 'transfer' };
});
```

- [ ] **Step 2: Write the failing tests**

Append these six tests inside the existing `describe('useContentDispatch', ...)` block, after the `defaults missing title/thumbnail to null` test:

```jsx
  it('a configured cast target routes a selection to that device', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith({
      targetIds: ['livingroom-tv'],
      play: 'plex:685088',
      mode: 'transfer',
      title: 'Episode 3',
    });
    expect(playNow).not.toHaveBeenCalled();
  });

  it('passes the chip mode through verbatim (fork)', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'fork' };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'fork' })
    );
  });

  it('fans out to every configured target', () => {
    castTargetState = { targetIds: ['livingroom-tv', 'office-tv'], mode: 'transfer' };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetIds: ['livingroom-tv', 'office-tv'] })
    );
  });

  it('peek view wins over a configured cast target', () => {
    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:99', { title: 'Lonesome Dove' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith({
      targetIds: ['shield-tv'],
      play: 'plex:99',
      mode: 'fork',
      title: 'Lonesome Dove',
    });
  });

  it('returns the branch it took', () => {
    const { result, rerender } = renderHook(() => useContentDispatch());
    let route;
    act(() => { route = result.current('plex:1', { title: 'A' }); });
    expect(route).toBe('local');

    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    rerender();
    act(() => { route = result.current('plex:2', { title: 'B' }); });
    expect(route).toBe('cast');

    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    rerender();
    act(() => { route = result.current('plex:3', { title: 'C' }); });
    expect(route).toBe('peek');
  });

  it('stays stable across renders when the cast target is unchanged', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { result, rerender } = renderHook(() => useContentDispatch());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Media/search/useContentDispatch.test.jsx`

Expected: FAIL. The four cast tests fail with `dispatchToTarget` not called (the hook still calls `playNow`); `returns the branch it took` fails with `expected undefined to be 'local'`. The five pre-existing tests still PASS.

- [ ] **Step 4: Implement the routing**

Replace the entire contents of `frontend/src/modules/Media/search/useContentDispatch.js` with:

```js
// frontend/src/modules/Media/search/useContentDispatch.js
// Routes a selected content id to the right playback surface. Precedence:
//   1. `peek` (remote-control) view → cast to the peeked device, mode:'fork'
//      (a remote control must never stop the device it is driving),
//   2. a cast target configured in the dock's chip → cast there in the chip's
//      mode — the chip is a promise about where content goes, and the search
//      bar sits beside it,
//   3. otherwise → play locally, replacing the queue.
// Returns which branch it took so callers can log the destination.
import { useCallback } from 'react';
import { useNav } from '../shell/NavProvider.jsx';
import { useDispatch } from '../cast/DispatchProvider.jsx';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useSessionController } from '../controller/useSessionController.js';

export function useContentDispatch() {
  const { view, params } = useNav();
  const { dispatchToTarget } = useDispatch();
  const { targetIds, mode } = useCastTarget();
  const { queue } = useSessionController('local');

  return useCallback((id, item) => {
    const title = item?.title ?? null;
    if (view === 'peek' && params?.deviceId) {
      dispatchToTarget({
        targetIds: [params.deviceId],
        play: id,
        mode: 'fork',
        title,
      });
      return 'peek';
    }
    if (targetIds.length > 0) {
      dispatchToTarget({ targetIds, play: id, mode, title });
      return 'cast';
    }
    queue.playNow(
      { contentId: id, title, thumbnail: item?.thumbnail ?? null },
      { clearRest: true }
    );
    return 'local';
  }, [view, params, dispatchToTarget, targetIds, mode, queue]);
}

export default useContentDispatch;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Media/search/useContentDispatch.test.jsx`

Expected: PASS — `Tests 11 passed (11)`.

- [ ] **Step 6: Run the surrounding suites for regressions**

Run: `npx vitest run frontend/src/modules/Media/`

Expected: PASS, no failures. These exercise the cast/dispatch/fleet neighbors that share the providers touched here.

- [ ] **Step 7: Update the dock documentation**

In `docs/reference/media/media-app.md`, replace the cast-target-chip bullet (line 204):

```markdown
- the **cast target chip** — the currently-preferred dispatch target,
```

with:

```markdown
- the **cast target chip** — the currently-preferred dispatch target. It
  governs the search bar too: with a target configured, picking a search
  result casts there in the chip's mode rather than playing locally. Peek
  view is the one exception — while remote-controlling a device, selections
  always go to that device (forked, never transferred),
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Media/search/useContentDispatch.js \
        frontend/src/modules/Media/search/useContentDispatch.test.jsx \
        docs/reference/media/media-app.md
git commit -m "fix(media): search selections honor the cast target chip

Picking a search result always played locally, ignoring the cast target
configured in the chip beside the search box. A user with livingroom-tv
selected got playback in their own browser tab and no signal that the TV
was never contacted.

useContentDispatch now routes peek-device > chip targets > local, and
returns the branch taken so the destination can be logged."
```

---

### Task 2: Log where a search selection was sent

**Files:**
- Modify: `frontend/src/modules/Media/search/MediaContentSearch.jsx:23-28`
- Create: `frontend/src/modules/Media/search/MediaContentSearch.test.jsx`

**Interfaces:**
- Consumes: `useContentDispatch()` returning `(id, item) => 'peek' | 'cast' | 'local'` (Task 1).
- Produces: nothing consumed by later tasks.

**Why:** the incident log line was `dispatch {"contentId":"plex:685088"}` — no destination. Cast dispatches are traceable downstream via `dispatch.initiated` (which carries `deviceId`), but a *local* route logs nothing distinguishing, so "it played in the wrong place" is invisible until you correlate user agents across dozens of lines. Recording the branch makes the routing decision self-evident in one line.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Media/search/MediaContentSearch.test.jsx`:

```jsx
// frontend/src/modules/Media/search/MediaContentSearch.test.jsx
// The dock's transient content picker: a selection is handed to
// useContentDispatch and the destination it chose is logged.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable holders — factories close over these but only read at render time.
const dispatch = vi.fn();
const info = vi.fn();

vi.mock('./useContentDispatch.js', () => ({
  useContentDispatch: () => dispatch,
}));

vi.mock('./SearchProvider.jsx', () => ({
  useSearchContext: () => ({
    scopes: [{ key: 'all', label: 'All' }],
    currentScopeKey: 'all',
    currentScope: { params: '' },
    scopeError: null,
    setScopeKey: vi.fn(),
  }),
}));

// Stand-in for the real combobox: one button that fires the same onChange
// contract (id, item) the combobox uses when a leaf is picked.
vi.mock('../../Content/combobox/ContentCombobox.jsx', () => ({
  ContentCombobox: ({ onChange }) => (
    <button
      data-testid="pick-episode"
      onClick={() => onChange('plex:685088', { title: 'Episode 3', type: 'episode' })}
    >
      pick
    </button>
  ),
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info }) }),
}));

import { MediaContentSearch } from './MediaContentSearch.jsx';

beforeEach(() => {
  dispatch.mockReset();
  info.mockReset();
});

describe('MediaContentSearch', () => {
  it('logs the destination a selection was routed to', () => {
    dispatch.mockReturnValue('cast');
    render(<MediaContentSearch />);
    fireEvent.click(screen.getByTestId('pick-episode'));

    expect(dispatch).toHaveBeenCalledWith(
      'plex:685088',
      { title: 'Episode 3', type: 'episode' }
    );
    expect(info).toHaveBeenCalledWith('dispatch', {
      contentId: 'plex:685088',
      route: 'cast',
    });
  });

  it('records a local route distinctly from a cast', () => {
    dispatch.mockReturnValue('local');
    render(<MediaContentSearch />);
    fireEvent.click(screen.getByTestId('pick-episode'));

    expect(info).toHaveBeenCalledWith('dispatch', {
      contentId: 'plex:685088',
      route: 'local',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/Media/search/MediaContentSearch.test.jsx`

Expected: FAIL on both tests — the logger is called with `{ contentId: 'plex:685088' }`, missing the `route` key.

- [ ] **Step 3: Capture and log the route**

In `frontend/src/modules/Media/search/MediaContentSearch.jsx`, replace the `handleChange` callback (lines 23-28):

```jsx
  const handleChange = useCallback((id, item) => {
    if (!id) return; // clear/empty commits are no-ops for a transient picker
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null });
    dispatch(id, item);
    log.info('dispatch', { contentId: id });
  }, [dispatch, log]);
```

with:

```jsx
  const handleChange = useCallback((id, item) => {
    if (!id) return; // clear/empty commits are no-ops for a transient picker
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null });
    // `route` is 'peek' | 'cast' | 'local' — without it, a selection that went
    // to the wrong surface is invisible in the logs.
    const route = dispatch(id, item);
    log.info('dispatch', { contentId: id, route });
  }, [dispatch, log]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/Media/search/MediaContentSearch.test.jsx`

Expected: PASS — `Tests 2 passed (2)`.

- [ ] **Step 5: Run the full Media suite**

Run: `npx vitest run frontend/src/modules/Media/`

Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Media/search/MediaContentSearch.jsx \
        frontend/src/modules/Media/search/MediaContentSearch.test.jsx
git commit -m "feat(media): log the destination a search selection routed to

The dispatch log line carried only a contentId, so a selection that played
on the wrong surface left no direct evidence. It now records route:
peek | cast | local."
```

---

## Regression surface (already checked — do not re-derive)

- `useContentDispatch` has exactly one consumer: `MediaContentSearch.jsx:18`. Nothing else changes behavior.
- `CastTargetProvider` wraps `DispatchProvider` in `MediaApp.jsx:44-52`, above `MediaAppShell` → `Dock` → `MediaContentSearch`, so `useCastTarget()` (which **throws** outside its provider) is always inside one.
- The three live flow tests that touch the dock (`tests/live/flow/media/media-app-cast.runtime.test.mjs`, `media-app-autoplay.runtime.test.mjs`, `media-app-now-playing-exit.runtime.test.mjs`) never tick a `cast-target-checkbox-*` before searching, so `targetIds` stays empty and they keep taking the local branch. No live-test updates needed. (An earlier draft of this plan justified that with "each `localStorage.clear()` in `beforeEach`" — that is **wrong** for `media-app-autoplay.runtime.test.mjs:11-14`, which selectively `removeItem`s instead. The conclusion holds for the stronger reason that no live test ever persists a cast target at all.)

## Verification

After both tasks, confirm the fix end-to-end rather than by tests alone:

1. Build and deploy per `CLAUDE.local.md` (check the deploy gates first — no active fitness session, no playing Player video).
2. Open the Media app, click the cast chip, check **Living Room TV**, leave mode on "Move playback to the device".
3. Type "FIFA", drill to Season 2026 → Episode 3, select it.
4. Expected: the TV wakes and plays; nothing starts in the browser tab.
5. Confirm in the logs — a cast route and a real device dispatch, which is exactly what was absent on 2026-07-19:

```bash
sudo docker logs --since 5m daylight-station 2>&1 \
  | grep -E '"event":"(dispatch|dispatch\.initiated|device\.router\.load\.start|wake-and-load\.complete)"'
```

Expected to see `"event":"dispatch"` with `"route":"cast"`, followed by `dispatch.initiated` carrying `"deviceId":"livingroom-tv"`, `device.router.load.start`, and `wake-and-load.complete`.
