# Piano Lessons Cursor Scroll (Teleprompter + Touch Scrub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Lessons follow-along cursor scroll like a teleprompter — the active note rests ~10% from the left edge with the upcoming notes visible ahead of it — and let the player swipe/drag horizontally to scrub through past (and slightly future) notes, snapping back to the cursor after a short idle.

**Architecture:** The drill staff is rendered by abcjs, which today wraps the engraving into multiple stacked staff lines and the cursor scroll is a vertical `scrollIntoView({block:'center'})` minimal nudge. We switch the engraving to a single long **horizontal** line (large `staffwidth`, no wrap) inside the existing `overflow-x:auto` `.lesson-drill__staff` container, then drive the container's `scrollLeft` explicitly so the active notehead lands at ~10% of the container width. A small pure helper computes the target `scrollLeft` from measured geometry (unit-tested). A pointer-drag handler lets the player scrub; releasing arms an inactivity timer that animates back to the cursor's resting position. All motion uses `scrollLeft` animation (compositor-friendly; no layout thrash), per the Shield/SM-T590 paint guidelines.

**Tech Stack:** React (hooks), abcjs (engraving + per-note SVG elements via `collectStaffNotes`), Vitest + @testing-library/react (jsdom) for tests, SCSS for the staff container.

---

## Background / Code Pointers (read before starting)

- **Feedback:** `docs/_wip/bugs/2026-06-24-piano-lessons-cursor-scroll-minimal.md` — verbatim user request and acceptance criteria.
- **Component to change:** `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx`
  - `applyHighlight(s, isWrong)` (around lines 71–82) paints notehead classes and ends with `cur.scrollIntoView({ behavior: 'smooth', block: 'center' })` — **this is the scroll to replace**.
  - `staffNotesRef.current` holds `[staffIdx] → [{ midi, els: SVGElement[] }]` from `AbcRenderer`'s `onRender`. Staff 0 is the right hand (treble) — the followed voice. `rh[s].els[0]` is the current notehead SVG node.
  - The staff is rendered by `<AbcRenderer abc={abc} scale={1.5} className="abc-renderer lesson-drill__abc" onRender={onRender} />` inside `<div className="lesson-drill__staff">`.
- **Renderer:** `frontend/src/modules/MusicNotation/renderers/AbcRenderer.jsx`
  - `abcjs.renderAbc(...)` currently sets `staffwidth: Math.max(120, containerWidth - sidePad*2)` (lines ~67–77), which makes abcjs **wrap** the music to the container width. We add an opt-in to render a single non-wrapped line by passing a large `staffwidth`.
  - `collectStaffNotes(tune)` returns the per-note SVG elements we measure.
- **Container CSS:** `frontend/src/Apps/PianoApp.scss` — `.lesson-drill__staff` (around lines 440–458) has `overflow-x: auto`. We add `scroll-behavior` control and keep the SVG on a single line.
- **Reference pattern (do NOT edit):** `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` — has a `flow: 'horizontal'` mode, tap-to-scroll, and native scroll scrubbing. Useful as a style reference for horizontal flow; its "swipe" is just native `overflow:auto` scroll, not explicit pointer handlers.
- **Paint perf:** `docs/reference/core/webview-paint-performance.md` — animate compositor-only properties; avoid `box-shadow`/`filter` on scrolling content; cache layout reads. We read geometry once per advance (not per frame) and animate `scrollLeft`.
- **Existing tests:** `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/Lessons.test.jsx` (stubs `AbcRenderer`), `frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.test.js` (fake-timer pattern to copy).

## Key Design Decisions

1. **Single horizontal line.** The teleprompter "10% from left" model only makes sense with one long line. abcjs wraps by default. We force one line via a large fixed `staffwidth` and let `.lesson-drill__staff` scroll horizontally. This is the load-bearing change — without it, "scroll left to ~10%" is undefined because notes are stacked vertically.
2. **Explicit `scrollLeft`, not `scrollIntoView`.** `scrollIntoView` only does the minimum nudge. We compute the desired `scrollLeft` so the notehead's left edge sits at `0.10 * container.clientWidth` and assign it (smooth where the platform supports it; otherwise a rAF tween).
3. **Pure target-math helper** so the geometry math is unit-testable without a real browser layout engine (jsdom returns 0 for layout, so we must not depend on live `getBoundingClientRect` in tests).
4. **Drag = user override; idle = snap back.** While the user is dragging or within `SNAP_BACK_MS` of releasing, the auto-scroll-on-advance is suppressed. After idle, we animate back to the cursor's resting position.
5. **Reuse the inactivity *idea* but not the existing hook.** `useInactivityReturn` is about navigating away from the kiosk; this snap-back is a local ~1.2s scrub timeout. Keep them separate.

## File Structure

- **Create:** `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.js` — pure helpers: `computeTargetScrollLeft(...)` and `clampScrollLeft(...)`. One responsibility: scroll-position math. No DOM, no React.
- **Create:** `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.test.js` — unit tests for the helpers.
- **Modify:** `frontend/src/modules/MusicNotation/renderers/AbcRenderer.jsx` — add a `singleLine` prop that forces a wide `staffwidth` so the engraving renders on one horizontal line.
- **Modify:** `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx` — replace `scrollIntoView` with explicit teleprompter scroll; add pointer-drag scrubbing + idle snap-back; pass `singleLine` to `AbcRenderer`.
- **Modify:** `frontend/src/Apps/PianoApp.scss` — ensure `.lesson-drill__staff` holds a single non-wrapping line and scrubs smoothly (touch-action, no text selection during drag).
- **(Optional) Modify:** `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/Lessons.test.jsx` — only if a new prop on the stubbed `AbcRenderer` needs accommodating (it is already a no-op stub, so likely no change).

---

## Task 1: Pure scroll-target math helper (`lessonScroll.js`)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.test.js`

This isolates the only non-trivial math (where to scroll) into a pure, testable unit. The component will gather geometry from the DOM and feed it here.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.test.js
import { describe, it, expect } from 'vitest';
import { computeTargetScrollLeft, clampScrollLeft } from './lessonScroll.js';

describe('clampScrollLeft', () => {
  it('clamps to the [0, maxScroll] range', () => {
    expect(clampScrollLeft(-50, 1000)).toBe(0);
    expect(clampScrollLeft(2000, 1000)).toBe(1000);
    expect(clampScrollLeft(300, 1000)).toBe(300);
  });
  it('never returns negative when content is narrower than the viewport (maxScroll <= 0)', () => {
    expect(clampScrollLeft(300, 0)).toBe(0);
    expect(clampScrollLeft(300, -10)).toBe(0);
  });
});

describe('computeTargetScrollLeft', () => {
  // Given a note whose left edge is at noteLeft within the scroll content,
  // we want that note pinned restFraction (e.g. 0.10) from the left of the viewport.
  const base = { viewportWidth: 1000, contentWidth: 5000, restFraction: 0.1 };

  it('positions the note restFraction from the left edge', () => {
    // note at content-x 600, want it at 100px from left => scrollLeft 500
    expect(computeTargetScrollLeft({ ...base, noteLeft: 600 })).toBe(500);
  });

  it('clamps at the start (cannot scroll past 0)', () => {
    // note near the very start: desired scrollLeft would be negative
    expect(computeTargetScrollLeft({ ...base, noteLeft: 50 })).toBe(0);
  });

  it('clamps at the end (cannot scroll past maxScroll = contentWidth - viewportWidth)', () => {
    // note near the very end: desired scrollLeft exceeds maxScroll (4000)
    expect(computeTargetScrollLeft({ ...base, noteLeft: 4990 })).toBe(4000);
  });

  it('returns 0 for degenerate geometry (zero viewport)', () => {
    expect(computeTargetScrollLeft({ ...base, viewportWidth: 0, noteLeft: 600 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.test.js`
Expected: FAIL — "Failed to resolve import './lessonScroll.js'" / functions not defined.

- [ ] **Step 3: Write the minimal implementation**

```js
// frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.js
//
// Pure scroll-position math for the Lessons follow-along teleprompter. The
// component measures geometry from the DOM and delegates the "where should the
// container scroll to?" decision here so it can be unit-tested without a live
// layout engine (jsdom reports 0-size boxes).

/** Clamp a desired scrollLeft into the valid [0, maxScroll] range. */
export function clampScrollLeft(desired, maxScroll) {
  const max = maxScroll > 0 ? maxScroll : 0;
  if (desired < 0) return 0;
  if (desired > max) return max;
  return desired;
}

/**
 * Target scrollLeft so the active notehead rests `restFraction` of the viewport
 * width from the left edge (teleprompter lookahead).
 *
 * @param {object} g
 * @param {number} g.noteLeft      - note's left edge in CONTENT coordinates (px from content start)
 * @param {number} g.viewportWidth - scroll container's clientWidth
 * @param {number} g.contentWidth  - scroll container's scrollWidth
 * @param {number} g.restFraction  - 0..1, where the note should sit (e.g. 0.10)
 * @returns {number} clamped scrollLeft
 */
export function computeTargetScrollLeft({ noteLeft, viewportWidth, contentWidth, restFraction }) {
  if (!viewportWidth || viewportWidth <= 0) return 0;
  const restPx = viewportWidth * restFraction;
  const desired = noteLeft - restPx;
  const maxScroll = contentWidth - viewportWidth;
  return clampScrollLeft(desired, maxScroll);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.test.js`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.js \
        frontend/src/modules/Piano/PianoKiosk/modes/Lessons/lessonScroll.test.js
git commit -m "feat(piano): pure scroll-target math for Lessons teleprompter cursor"
```

---

## Task 2: Single-line engraving option on AbcRenderer

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/AbcRenderer.jsx`
- Test: `frontend/src/modules/MusicNotation/renderers/abc.test.js` already covers the pure ABC string; this change is render-config only, so verify via the existing suite rather than a new assertion (abcjs render is not exercised in jsdom).

abcjs wraps the music to `staffwidth`. To get one long horizontal line we pass a deliberately large `staffwidth` when `singleLine` is set. This keeps the existing wrapped behavior the default (other callers unaffected).

- [ ] **Step 1: Add the `singleLine` prop and widen `staffwidth`**

In `AbcRenderer.jsx`, change the signature (around line 53) to accept `singleLine`:

```jsx
export function AbcRenderer({ notes, abc, keySignature = 'C', scale = 1.5, className = 'abc-renderer', singleLine = false, onRender }) {
```

Then in the `useEffect` (around lines 63–87), replace the `staffwidth` computation and add `singleLine` to the dependency array:

```jsx
  useEffect(() => {
    if (!containerRef.current) return;
    try {
      const tune = abc ?? generateAbc(notes, keySignature);
      const containerWidth = containerRef.current.parentElement?.offsetWidth || 600;
      const sidePad = 12;
      // singleLine: force one long horizontal staff line (no wrapping) so a
      // follow-along cursor can scroll it like a teleprompter. A very wide
      // staffwidth makes abcjs lay the whole voice on one line; the parent
      // container scrolls horizontally to reveal it.
      const staffwidth = singleLine
        ? 100000
        : Math.max(120, containerWidth - sidePad * 2);
      const result = abcjs.renderAbc(containerRef.current, tune, {
        staffwidth,
        wrap: singleLine ? { minSpacing: 1, maxSpacing: 1.4, preferredMeasuresPerLine: 1000 } : undefined,
        paddingtop: 0,
        paddingbottom: 0,
        paddingleft: sidePad,
        paddingright: sidePad,
        add_classes: true,
        scale,
      });
      const tuneObject = Array.isArray(result) ? result[0] : result;
      if (onRenderRef.current && tuneObject) {
        onRenderRef.current(tuneObject, collectStaffNotes(tuneObject));
      }
    } catch (e) {
      console.error('abcjs render error:', e.message);
      setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature, scale, singleLine]);
```

> Note on `wrap`: abcjs respects `staffwidth` as the hard wrap boundary; a huge `staffwidth` is sufficient on its own to keep one line, and the `wrap` object is a belt-and-suspenders hint. If a future abcjs version changes wrap semantics, the large `staffwidth` remains the primary mechanism.

Also update the JSDoc block above the function to document the new prop:

```jsx
 * @param {boolean} [singleLine=false] - render the whole voice on one horizontal
 *   line (no wrapping) for a teleprompter-style scrolling follow-along
```

- [ ] **Step 2: Run the existing notation + lessons suites to confirm no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/MusicNotation/renderers/abc.test.js frontend/src/modules/Piano/PianoKiosk/modes/Lessons/Lessons.test.jsx`
Expected: PASS (no new failures; `Lessons.test.jsx` stubs `AbcRenderer`, so the prop is inert there).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/MusicNotation/renderers/AbcRenderer.jsx
git commit -m "feat(notation): AbcRenderer singleLine prop for horizontal scrolling staff"
```

---

## Task 3: Teleprompter scroll in LessonDrill (replace scrollIntoView)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx`

Replace the minimal `scrollIntoView` with explicit `scrollLeft` math from Task 1, reading the active notehead's position relative to the scroll container, and render the staff single-line.

- [ ] **Step 1: Import the helper and add refs/constants**

At the top of `LessonDrill.jsx`, add the import (next to the other imports):

```jsx
import { computeTargetScrollLeft } from './lessonScroll.js';
```

Inside the component, add constants near the top of the function body (after `const kb = ...`):

```jsx
  const REST_FRACTION = 0.10; // active note rests ~10% from the left edge
```

Add a ref for the scroll container (next to the existing refs around line 63):

```jsx
  const scrollRef = useRef(null); // .lesson-drill__staff (overflow-x scroll container)
```

- [ ] **Step 2: Add a scroll-to-cursor function**

Add this `useCallback` below `applyHighlight` (after line 82). It measures the active notehead relative to the scroll container and animates `scrollLeft` to the teleprompter target:

```jsx
  // Scroll the staff so the active notehead rests ~REST_FRACTION from the left.
  // Reads geometry once (not per frame); the actual motion is a CSS-smooth
  // scrollLeft assignment (compositor-friendly — see webview-paint-performance.md).
  const scrollCursorToRest = useCallback((s) => {
    const container = scrollRef.current;
    const note = staffNotesRef.current?.[0]?.[s]?.els?.[0];
    if (!container || !note?.getBoundingClientRect) return;
    const cRect = container.getBoundingClientRect();
    const nRect = note.getBoundingClientRect();
    // note's left edge in content coordinates = its viewport-left minus the
    // container's viewport-left, plus how far we're already scrolled.
    const noteLeft = (nRect.left - cRect.left) + container.scrollLeft;
    const target = computeTargetScrollLeft({
      noteLeft,
      viewportWidth: container.clientWidth,
      contentWidth: container.scrollWidth,
      restFraction: REST_FRACTION,
    });
    container.scrollTo({ left: target, behavior: 'smooth' });
  }, []);
```

- [ ] **Step 3: Replace the `scrollIntoView` call in `applyHighlight`**

In `applyHighlight` (lines ~80–81), remove:

```jsx
    const cur = rh[s]?.els?.[0];
    if (cur?.scrollIntoView) cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
```

Leave `applyHighlight` doing only class painting (no scrolling). Scrolling now happens in a dedicated effect (next step) so user-drag can suppress it.

- [ ] **Step 4: Drive scroll from a step-change effect, not from paint**

Replace the existing combined effect at line 92:

```jsx
  useEffect(() => { applyHighlight(step, wrong); }, [step, wrong, applyHighlight]);
```

with two effects — one that paints (unchanged), one that scrolls (new), where the scroll is gated by a `userScrubbingRef` flag (added in Task 4; declare it now as `const userScrubbingRef = useRef(false);` next to the other refs):

```jsx
  // Repaint notehead classes on every step / wrong change.
  useEffect(() => { applyHighlight(step, wrong); }, [step, wrong, applyHighlight]);

  // Teleprompter scroll on advance — unless the user is actively scrubbing.
  useEffect(() => {
    if (userScrubbingRef.current) return;
    scrollCursorToRest(step);
  }, [step, scrollCursorToRest]);
```

Also call `scrollCursorToRest(stepRef.current)` at the end of `onRender` (replacing the existing `applyHighlight(stepRef.current, false);` tail with both calls) so the staff starts pinned correctly after the first engraving paint:

```jsx
    applyHighlight(stepRef.current, false);
    scrollCursorToRest(stepRef.current);
```

- [ ] **Step 5: Wire the scroll ref + single-line render into the JSX**

Change the staff block (lines 127–129) from:

```jsx
      <div className="lesson-drill__staff">
        {abc && <AbcRenderer abc={abc} scale={1.5} className="abc-renderer lesson-drill__abc" onRender={onRender} />}
      </div>
```

to:

```jsx
      <div className="lesson-drill__staff" ref={scrollRef}>
        {abc && <AbcRenderer abc={abc} scale={1.5} singleLine className="abc-renderer lesson-drill__abc" onRender={onRender} />}
      </div>
```

- [ ] **Step 6: Add a structured log on the first scroll (per CLAUDE.md logging rule)**

In `scrollCursorToRest`, after computing `target`, add a debug log (high-frequency → `debug`):

```jsx
    logger.debug('piano.drill-scroll', { step: s, target, viewport: container.clientWidth, content: container.scrollWidth });
```

(`logger` is already in scope from line 28.)

- [ ] **Step 7: Verify the existing Lessons suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Lessons/Lessons.test.jsx`
Expected: PASS. `AbcRenderer` is stubbed there, so `onRender` is never called and the scroll code is dormant — the test asserts content/routing only and must remain green.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx
git commit -m "feat(piano): Lessons cursor scrolls teleprompter-style (~10% from left)"
```

---

## Task 4: Touch drag scrubbing + idle snap-back

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss`

Let the player drag the staff horizontally to scrub through past/future notes; suppress auto-scroll while dragging and for a short window after release; then animate back to the cursor's resting position.

- [ ] **Step 1: Add scrub constants and the snap-back timer ref**

Near the constants in Task 3 add:

```jsx
  const SNAP_BACK_MS = 1500; // idle delay after a scrub before returning to the cursor
```

Add a timer ref next to the others:

```jsx
  const snapBackTimer = useRef(null);
  useEffect(() => () => clearTimeout(snapBackTimer.current), []);
```

(`userScrubbingRef` was already declared in Task 3 Step 4.)

- [ ] **Step 2: Add pointer-drag handlers**

Add these `useCallback`s in the component body (after `scrollCursorToRest`). They implement a pointer-capture drag that adjusts `scrollLeft` directly (no React state per move → no re-render storm), then arm the snap-back on release:

```jsx
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0, pointerId: null });

  const onScrubStart = useCallback((e) => {
    const container = scrollRef.current;
    if (!container) return;
    userScrubbingRef.current = true;
    clearTimeout(snapBackTimer.current);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScroll: container.scrollLeft,
      pointerId: e.pointerId,
    };
    container.setPointerCapture?.(e.pointerId);
  }, []);

  const onScrubMove = useCallback((e) => {
    const d = dragRef.current;
    const container = scrollRef.current;
    if (!d.active || !container) return;
    // Direct, non-animated scrollLeft tracking: instantly follows the finger.
    container.scrollLeft = d.startScroll - (e.clientX - d.startX);
  }, []);

  const onScrubEnd = useCallback((e) => {
    const d = dragRef.current;
    const container = scrollRef.current;
    if (!d.active) return;
    d.active = false;
    container?.releasePointerCapture?.(d.pointerId);
    // Arm the snap-back: after SNAP_BACK_MS idle, smooth-scroll back to the cursor.
    clearTimeout(snapBackTimer.current);
    snapBackTimer.current = setTimeout(() => {
      userScrubbingRef.current = false;
      scrollCursorToRest(stepRef.current);
      logger.debug('piano.drill-snap-back', { step: stepRef.current });
    }, SNAP_BACK_MS);
  }, [scrollCursorToRest, logger]);
```

- [ ] **Step 3: Wire the handlers onto the scroll container**

Update the staff `<div>` (from Task 3 Step 5) to attach the pointer handlers:

```jsx
      <div
        className="lesson-drill__staff"
        ref={scrollRef}
        onPointerDown={onScrubStart}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubEnd}
        onPointerCancel={onScrubEnd}
      >
        {abc && <AbcRenderer abc={abc} scale={1.5} singleLine className="abc-renderer lesson-drill__abc" onRender={onRender} />}
      </div>
```

- [ ] **Step 4: Make sure a fresh MIDI advance cancels a pending scrub**

So that playing a note immediately re-engages the teleprompter (rather than waiting out `SNAP_BACK_MS`), clear the scrub state when `step` increments via MIDI. Update the follow effect's advance branch is overkill; instead, in the step-driven scroll effect (Task 3 Step 4) clear scrubbing when the step actually changes:

```jsx
  // Teleprompter scroll on advance — playing a note overrides an in-progress scrub.
  useEffect(() => {
    if (dragRef.current.active) return; // mid-drag: don't fight the finger
    userScrubbingRef.current = false;   // a new step means resume following
    clearTimeout(snapBackTimer.current);
    scrollCursorToRest(step);
  }, [step, scrollCursorToRest]);
```

(Replace the simpler version from Task 3 Step 4 with this.)

- [ ] **Step 5: SCSS — smooth, drag-friendly scroll container**

In `frontend/src/Apps/PianoApp.scss`, update `.lesson-drill__staff` (around lines 440–458). Keep the existing white background / ink rules; add single-line + drag affordances:

```scss
  &__staff {
    background: #fff;
    border: 1px solid var(--piano-border);
    border-radius: var(--r-md);
    padding: 1rem;
    margin-bottom: 1.25rem;
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;            // keep the single engraved line on one row
    touch-action: pan-x;           // let our pointer-drag own horizontal panning
    user-select: none;             // dragging shouldn't select the SVG/text
    -webkit-user-select: none;
    overscroll-behavior-x: contain;
    cursor: grab;
    &:active { cursor: grabbing; }
    // abcjs emits a block-level <svg>; keep it inline so white-space:nowrap holds.
    svg { display: inline-block; }

    svg { color: #111; }
    svg path { fill: #111; stroke: #111; }
    svg text { fill: #111; stroke: none; }

    .note-played path, path.note-played { fill: #9aa0a8 !important; stroke: #9aa0a8 !important; }
    .note-current path, path.note-current { fill: #2ec46f !important; stroke: #2ec46f !important; }
    .note-wrong path, path.note-wrong { fill: #ff4d4d !important; stroke: #ff4d4d !important; }
  }
```

(If the two `svg { ... }` blocks read awkwardly, merge them into one — the split above is only to show the added `display: inline-block` near the layout rules.)

- [ ] **Step 6: Verify the Lessons suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Lessons/Lessons.test.jsx`
Expected: PASS (pointer handlers are inert without a real `AbcRenderer`/pointer events in these tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): touch-drag scrub + idle snap-back on Lessons staff"
```

---

## Task 5: Manual verification on the kiosk + docs

**Files:**
- (No code changes unless verification surfaces a bug.)
- Modify (if any user-facing behavior doc exists): none required; the feedback doc is the record. Optionally move the feedback bug doc to `_archive/` once shipped.

- [ ] **Step 1: Build + deploy** (this host is prod — confirm no active fitness session and no Player video *playing* per `CLAUDE.local.md` gates first)

```bash
docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Reload the piano kiosk** so it picks up the new bundle (FKB serves old JS until reloaded — see CLAUDE.local.md "Reloading the living room kiosk" if the piano is on the Shield, otherwise reload the piano display directly).

- [ ] **Step 3: Eyes-on acceptance check** at `/piano/lessons/01` (Hanon exercise 1):
  - Play through several notes — the green active note should ride at ~10% from the left with upcoming notes visible ahead of it (NOT pinned to the right edge).
  - Drag the staff left — past (grey) notes scroll into view; drag right — a little lookahead appears.
  - Release and wait ~1.5s — the view smoothly returns to the active note at ~10% from left.
  - Confirm scrolling is smooth on the SM-T590 (no visible jank). If janky, capture `media/logs/piano` and check for paint stalls; the muted keep-alive `<video>` vsync trick (see MEMORY: piano tablet frame-clock stall) may already be active app-wide.

- [ ] **Step 4: Confirm the scroll log fires**

```bash
sudo docker logs --since 2m daylight-station 2>&1 | grep -E 'piano.drill-scroll|piano.drill-snap-back' | head
```

Expected: `piano.drill-scroll` lines on advance with sane `target`/`viewport`/`content`; `piano.drill-snap-back` after a scrub.

- [ ] **Step 5: Archive the feedback bug doc**

```bash
git mv docs/_wip/bugs/2026-06-24-piano-lessons-cursor-scroll-minimal.md docs/_archive/
git commit -m "docs: archive Lessons cursor-scroll feedback (shipped)"
```

---

## Risks & Open Questions

1. **abcjs single-line width.** A `staffwidth` of 100000 should force one line, but very long Hanon expansions could exceed what abcjs lays out cleanly, or produce a very wide SVG. **Mitigation:** if abcjs still wraps or mis-sizes, fall back to abcjs's `wrap`/`responsive` options or compute `staffwidth` from note count × per-note px. Verify with the longest configured drill, not just exercise 1.
2. **Geometry in jsdom is zero.** All `getBoundingClientRect`/`scrollWidth` reads return 0 under jsdom, so the scroll behavior cannot be asserted in a unit test — that is exactly why Task 1 extracts the math into a pure helper that *is* tested. The DOM-reading glue is verified manually in Task 5. Do not add a jsdom test that asserts on real scroll positions; it will be vacuously green and violate the test-discipline rule.
3. **`scrollTo({behavior:'smooth'})` support on the kiosk WebView.** Older WebViews may ignore smooth scrolling and jump. **Mitigation:** acceptable (still lands at the right place); if a smooth tween is required, add a small rAF interpolation of `scrollLeft` in `scrollCursorToRest` — keep it compositor-only (assign `scrollLeft`, no layout reads inside the loop).
4. **Pointer vs. native scroll conflict.** `touch-action: pan-x` plus our pointer-drag both try to pan. Using pointer capture + setting `scrollLeft` directly (and `touch-action: pan-x`) should coexist; if the native scroll fights the drag, set `touch-action: none` and rely solely on the pointer handlers. Verify on the actual touchscreen.
5. **Restart button.** `setStep(0)` will fire the scroll effect and pin back to note 0 at ~10% (i.e. scrollLeft 0). Confirm the staff returns to the start visually after Restart.
6. **Multi-system vs single-line.** This changes the drill from a wrapped multi-line view to a single scrolling line. Confirm that is acceptable for the lesson UX (the feedback explicitly asks for left-pinned scrolling, which implies single-line). If wrapped view is still wanted elsewhere, it remains the AbcRenderer default; only LessonDrill opts into `singleLine`.

## Self-Review Notes

- **Spec coverage:** ~10%-from-left teleprompter scroll → Tasks 2+3; touch drag scrub back (and a little forward) → Task 4; idle snap-back → Task 4; smoothness/paint discipline → Task 3 (single geometry read, `scrollLeft` animation) + Task 4 SCSS + Risk 3. All acceptance criteria mapped.
- **Type/name consistency:** `computeTargetScrollLeft`/`clampScrollLeft` (Task 1) used identically in Task 3; `scrollRef`, `userScrubbingRef`, `snapBackTimer`, `dragRef`, `scrollCursorToRest`, `REST_FRACTION`, `SNAP_BACK_MS` named consistently across Tasks 3–4; `singleLine` prop consistent between Tasks 2 and 3.
- **No placeholders:** every code step shows the actual code.
