# Fitness Footer Zoom-Navigation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make footer zoom-navigation behave per the intended UX — selections no longer bounce the user back to the root timeline early; the X→Back button remains the explicit return-to-root; and the zoom state machine finally has test coverage.

**Architecture:** The state machine lives in `useZoomState.js`; the footer controls are a dumb view. The reported bug ("selections lose state early") is the unconditional 800 ms post-seek `scheduleZoomReset`. We replace that magic number with a generous, configurable **selection grace** and re-arm it on every zoom interaction, so adjacent selections keep their place. The Back button stays wired to `zoomOut` (root) per the product decision. We also document the intended lifecycle and add the missing hook tests.

**Tech Stack:** React hooks, vitest + `@testing-library/react` `renderHook` with fake timers.

**Audit reference:** `docs/_wip/audits/2026-06-08-bug-bash-fitness-multi-issue-audit.md` (Item 2).

**Product decisions locked for this plan:**
- The X button becomes a **Back** button when zoomed, and Back returns to **root** (this is correct, not a bug to "pop one level").
- The fix target is the **selection grace period** so secondary/adjacent selections don't lose state.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `docs/reference/fitness/footer-zoom-navigation.md` | Endstate spec of the footer zoom/seek lifecycle | Create |
| `frontend/src/modules/Fitness/player/footer/hooks/useZoomState.js` | Configurable selection grace; re-arm on interaction | Modify |
| `frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js` | Hook tests for zoom in/out/step/grace | Create |
| `frontend/src/modules/Fitness/player/footer/FitnessPlayerFooterSeekThumbnails.jsx` | Use the grace default; re-arm grace on zoom change | Modify |

---

## Task 1: Document the intended footer-zoom lifecycle (target spec)

The product report asks for the target spec to be written first so the implementation can be audited against it. Capture it as an endstate reference doc (present tense, no class names in the body — per the docs-style convention).

**Files:**
- Create: `docs/reference/fitness/footer-zoom-navigation.md`

- [ ] **Step 1: Write the reference doc**

Create `docs/reference/fitness/footer-zoom-navigation.md`:

```markdown
# Footer Zoom Navigation

The fitness player footer lets a viewer scrub a long video by zooming the seek
strip into progressively smaller time windows, then selecting a moment to jump
to. Zoom is navigation only — it never moves the playhead by itself.

## States

- **Root** — the full timeline is shown as ten evenly-spaced thumbnails.
- **Zoomed** — one of the ten segments has been opened into its own ten
  thumbnails. Zooming again drills further. The left controls expose ⏪/⏩ to pan
  the window within the current level; the X button becomes a Back button.

## Selecting a moment

Tapping a thumbnail seeks the playhead to that segment's start. Selecting does
not immediately collapse the zoom: a **grace window** keeps the current zoom
level open so the viewer can pick an adjacent segment without losing their
place. Each new interaction (another selection, a pan, or a deeper zoom) extends
the grace window. After the viewer goes idle for the grace window, the strip
returns to root on its own.

## Returning to root

The Back button (the X, while zoomed) returns to the full timeline immediately,
discarding the zoom history. This is the explicit way out; the grace window is
the implicit one.
```

- [ ] **Step 2: Commit**

```bash
git add docs/reference/fitness/footer-zoom-navigation.md
git commit -m "docs(fitness): endstate spec for footer zoom navigation lifecycle"
```

---

## Task 2: Add hook tests for the current zoom state machine

`useZoomState` has zero tests. Lock in current correct behaviors (zoom in/out, step) before changing the grace.

**Files:**
- Create: `frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js`

- [ ] **Step 1: Write the tests for existing behavior**

Create `frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useZoomState from './useZoomState.js';

const setup = (overrides = {}) =>
  renderHook(() => useZoomState({ baseDuration: 1000, ...overrides }));

describe('useZoomState — core navigation', () => {
  it('starts at root (not zoomed)', () => {
    const { result } = setup();
    expect(result.current.isZoomed).toBe(false);
    expect(result.current.zoomRange).toBeNull();
  });

  it('zoomIn enters a zoomed range; zoomOut returns to root immediately', () => {
    const { result } = setup();
    act(() => result.current.zoomIn([100, 200]));
    expect(result.current.isZoomed).toBe(true);
    expect(result.current.zoomRange).toEqual([100, 200]);
    act(() => result.current.zoomOut());
    expect(result.current.isZoomed).toBe(false);
    expect(result.current.zoomRange).toBeNull();
  });

  it('ignores a disabled zoomIn', () => {
    const { result } = setup({ disabled: true });
    act(() => result.current.zoomIn([100, 200]));
    expect(result.current.isZoomed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it passes (these assert current behavior)**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js`
Expected: PASS — `Tests 3 passed`. (If a test fails, the current behavior differs from the assertion — read the hook and correct the test to match real current behavior before proceeding.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js
git commit -m "test(fitness): cover useZoomState core navigation before grace change"
```

---

## Task 3: Configurable selection grace + reset-after-grace test

Replace the magic `800` with a configurable, generous grace and prove it resets only after the grace elapses.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/footer/hooks/useZoomState.js:34` (signature), `:291` (`scheduleZoomReset`)
- Modify: `frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js`

- [ ] **Step 1: Write the failing grace test**

Append to `useZoomState.test.js`:

```javascript
describe('useZoomState — selection grace', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does NOT reset before the grace window elapses', () => {
    const { result } = renderHook(() => useZoomState({ baseDuration: 1000, selectionGraceMs: 12000 }));
    act(() => result.current.zoomIn([100, 200]));
    act(() => result.current.scheduleZoomReset());
    act(() => { vi.advanceTimersByTime(800); }); // the OLD reset point
    expect(result.current.isZoomed).toBe(true);   // still zoomed — grace not elapsed
  });

  it('resets to root once the grace window elapses', () => {
    const { result } = renderHook(() => useZoomState({ baseDuration: 1000, selectionGraceMs: 12000 }));
    act(() => result.current.zoomIn([100, 200]));
    act(() => result.current.scheduleZoomReset());
    act(() => { vi.advanceTimersByTime(12000); });
    expect(result.current.isZoomed).toBe(false);
  });

  it('cancelZoomReset keeps the zoom alive past the grace window', () => {
    const { result } = renderHook(() => useZoomState({ baseDuration: 1000, selectionGraceMs: 12000 }));
    act(() => result.current.zoomIn([100, 200]));
    act(() => result.current.scheduleZoomReset());
    act(() => result.current.cancelZoomReset());
    act(() => { vi.advanceTimersByTime(12000); });
    expect(result.current.isZoomed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify the grace tests fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js`
Expected: FAIL — the first grace test fails because the current default delay is `800`, so the hook resets at 800 ms and `isZoomed` is already false.

- [ ] **Step 3: Make the grace configurable**

In `useZoomState.js`, add `selectionGraceMs` to the options (`:34`):

```javascript
export default function useZoomState({
  baseDuration,
  baseRange = null,
  playerRef,
  onZoomChange,
  disabled = false,
  selectionGraceMs = 12000
}) {
```

Change `scheduleZoomReset`'s default delay (`:291`) from `800` to the configured grace:

```javascript
  const scheduleZoomReset = useCallback((delayMs = selectionGraceMs) => {
    if (!zoomRange) return; // Already at base level
    cancelZoomReset();
    logger.info('zoom-reset-scheduled', { delayMs, currentZoom: zoomRange });
    pendingResetRef.current = setTimeout(() => {
      logger.info('zoom-reset-executing');
      zoomStackRef.current = [];
      setZoomRange(null);
      pendingResetRef.current = null;
    }, delayMs);
  }, [zoomRange, cancelZoomReset, selectionGraceMs]);
```

- [ ] **Step 4: Run to verify the grace tests pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/footer/hooks/useZoomState.js \
        frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js
git commit -m "fix(fitness): configurable selection grace (default 12s) replaces 800ms reset"
```

---

## Task 4: Stop early reset & re-arm grace on every interaction

The consumer currently calls `scheduleZoomReset(800)` on playback resume. Switch it to the grace default and add a re-arm so zoom/step interactions also extend the grace — implementing "adjacent selections without losing place."

**Files:**
- Modify: `frontend/src/modules/Fitness/player/footer/FitnessPlayerFooterSeekThumbnails.jsx:130-139` (lifecycle effect), and add a zoom-change re-arm effect

- [ ] **Step 1: Switch the post-seek reset to the grace default**

In `FitnessPlayerFooterSeekThumbnails.jsx`, in the lifecycle effect (`:130`), change the hard-coded `800`:

```javascript
    // Reset zoom when playback resumes after seek (not just when seek intent clears)
    if (prevLifecycle !== 'playing' && lifecycle === 'playing' && isZoomed) {
      logger.info('playback-resumed-arming-selection-grace', { isZoomed, zoomRange, lifecycle });
      scheduleZoomReset(); // uses the configurable selection grace, not 800ms
    }
```

- [ ] **Step 2: Re-arm the grace whenever the zoom window changes (zoom in / pan)**

Add this effect right after the lifecycle effect (after `:139`), so a zoom-in or a pan also keeps the strip alive for the full grace window:

```javascript
  // Keep the zoom alive while the user is actively navigating (zoom in / pan).
  // Each zoom-window change re-arms the selection grace; going idle for the
  // grace window then returns to root on its own.
  useEffect(() => {
    if (isZoomed) {
      scheduleZoomReset();
    }
  }, [zoomRange, isZoomed, scheduleZoomReset]);
```

> Note: `scheduleZoomReset` cancels any pending timer before scheduling (see hook `:293`), so repeated re-arming is safe and simply restarts the grace clock.

- [ ] **Step 3: Verify the existing footer tests + new hook tests still pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/footer`
Expected: PASS for the hook test; other footer files without specs report "no test files" which is acceptable.

- [ ] **Step 4: Manual verification on the dev server**

The seeking↔playing lifecycle re-arm is integration-level. Verify on a running dev server:

```bash
ss -tlnp | grep 3112 || node backend/index.js &   # ensure backend up (CLAUDE.local.md)
```
In the fitness player: zoom into a segment, tap a thumbnail to seek, then within a few seconds tap an adjacent thumbnail. Confirm the strip stays zoomed for the second selection (does not snap back to the full timeline), and that pressing the Back (X) button returns to root immediately.

Expected: zoom persists across adjacent selections; Back returns to root at once.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/footer/FitnessPlayerFooterSeekThumbnails.jsx
git commit -m "fix(fitness): re-arm zoom selection grace on every interaction"
```

---

## Final Verification

- [ ] Run the full zoom-state suite:

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/footer/hooks/useZoomState.test.js
```
Expected: all tests pass, 0 failed.

- [ ] Deploy and reload the garage fitness kiosk; confirm: adjacent thumbnail selections no longer bounce to root, and Back (X) returns to the full timeline.
