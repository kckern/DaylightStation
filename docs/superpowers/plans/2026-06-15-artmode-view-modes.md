# ArtMode View-Mode Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tab key that cycles ArtMode through five framing modes (museum → immersive), plus image-width-clamped placards with balanced two-line titles.

**Architecture:** A pure descriptor table (`artModes.js`) defines the five modes and the per-panel object-fit window geometry. ArtMode keeps the existing `artLayout` geometry for the Gallery mode and switches to a CSS `object-fit` render path for modes 2-5. A pure `titleLayout.js` splits placard titles into balanced lines using an injected text measurer (canvas in the browser, a fake in tests).

**Tech Stack:** React (`.jsx`), Vitest + Testing Library, plain CSS. No backend changes.

**Test command (all tasks):**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs <file ...>
```

---

## File Structure

- **Create** `frontend/src/screen-framework/widgets/artModes.js` — pure: the 5-mode descriptor table, `nextMode`/`prevMode`, and `objectFitWindows` geometry for modes 2-5.
- **Create** `frontend/src/screen-framework/widgets/titleLayout.js` — pure: `layoutTitle(title, maxWidthPx, measure)` → 1-2 balanced lines.
- **Modify** `frontend/src/screen-framework/widgets/artLayout.js` — add `widthPct` (% of stage) to each panel in the output.
- **Modify** `frontend/src/screen-framework/widgets/ArtMode.jsx` — consume the mode descriptor (frame toggle, render path, placard gating), Tab/Shift+Tab handling, canvas measurement + `layoutTitle`, per-panel placard `max-width`.
- **Modify** `frontend/src/screen-framework/widgets/ArtMode.css` — object-fit window/image rules and per-line title truncation.
- **Create** `tests/unit/art/artModes.test.mjs`, `tests/unit/art/titleLayout.test.mjs` — pure tests.
- **Modify** `tests/unit/art/artLayout.test.mjs`, `frontend/src/screen-framework/widgets/ArtMode.test.jsx` — extend coverage.

Config note: `screensaver.props.defaultViewMode` is supported via a new prop (default `gallery`). Screen YAML `screensaver.props` already spreads into the widget, so no extra wiring is needed; omitting it keeps current behavior. No YAML change is required (default is Gallery).

---

### Task 1: View-mode descriptors + object-fit geometry

**Files:**
- Create: `frontend/src/screen-framework/widgets/artModes.js`
- Test: `tests/unit/art/artModes.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/artModes.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { VIEW_MODES, modeIndexByName, nextMode, prevMode, objectFitWindows }
  from '../../../frontend/src/screen-framework/widgets/artModes.js';

describe('VIEW_MODES', () => {
  it('has five modes in museum→immersive order', () => {
    expect(VIEW_MODES.map((m) => m.name)).toEqual([
      'gallery', 'framed-contain', 'framed-cover', 'bare-contain', 'bare-cover',
    ]);
  });
  it('frame on for 1-3, off for 4-5', () => {
    expect(VIEW_MODES.map((m) => m.frame)).toEqual([true, true, true, false, false]);
  });
  it('placard on for 1-3, off for 4-5', () => {
    expect(VIEW_MODES.map((m) => m.placard)).toEqual([true, true, true, false, false]);
  });
  it('fit per mode', () => {
    expect(VIEW_MODES.map((m) => m.fit)).toEqual([
      'gallery', 'contain', 'cover', 'contain', 'cover',
    ]);
  });
});

describe('modeIndexByName', () => {
  it('finds a mode index', () => { expect(modeIndexByName('bare-cover')).toBe(4); });
  it('defaults to 0 for unknown', () => { expect(modeIndexByName('nope')).toBe(0); });
});

describe('nextMode / prevMode', () => {
  it('advances and wraps', () => {
    expect(nextMode(0)).toBe(1);
    expect(nextMode(4)).toBe(0);
  });
  it('reverses and wraps', () => {
    expect(prevMode(1)).toBe(0);
    expect(prevMode(0)).toBe(4);
  });
});

describe('objectFitWindows', () => {
  const frame = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
  it('single full-window spans the whole stage', () => {
    const [w] = objectFitWindows({ count: 1, frame, fullWindow: true });
    expect(w).toMatchObject({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(w.widthPct).toBe(100);
    expect(w.centerXPct).toBe(50);
  });
  it('single framed uses the frame insets', () => {
    const [w] = objectFitWindows({ count: 1, frame, fullWindow: false });
    expect(w).toMatchObject({ top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 });
    expect(w.widthPct).toBeCloseTo(86.5);
    expect(w.centerXPct).toBeCloseTo(50.25);
  });
  it('diptych splits the opening into two equal halves', () => {
    const [a, b] = objectFitWindows({ count: 2, frame, fullWindow: true });
    expect(a.widthPct).toBeCloseTo(50);
    expect(b.widthPct).toBeCloseTo(50);
    expect(a.left).toBe(0);
    expect(b.right).toBe(0);
    expect(a.right).toBeCloseTo(50);
    expect(b.left).toBeCloseTo(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artModes.test.mjs`
Expected: FAIL — cannot resolve `artModes.js`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/screen-framework/widgets/artModes.js`:

```js
// artModes.js — pure view-mode model + object-fit geometry for ArtMode. No DOM.
// Five modes cycle museum → immersive.

export const VIEW_MODES = [
  { name: 'gallery',        frame: true,  fullWindow: false, fit: 'gallery', placard: true  },
  { name: 'framed-contain', frame: true,  fullWindow: false, fit: 'contain', placard: true  },
  { name: 'framed-cover',   frame: true,  fullWindow: false, fit: 'cover',   placard: true  },
  { name: 'bare-contain',   frame: false, fullWindow: true,  fit: 'contain', placard: false },
  { name: 'bare-cover',     frame: false, fullWindow: true,  fit: 'cover',   placard: false },
];

export function modeIndexByName(name) {
  const i = VIEW_MODES.findIndex((m) => m.name === name);
  return i === -1 ? 0 : i;
}

export const nextMode = (i) => (i + 1) % VIEW_MODES.length;
export const prevMode = (i) => (i - 1 + VIEW_MODES.length) % VIEW_MODES.length;

// Per-panel window insets (% of stage) for the object-fit modes (2-5).
// count: 1 single | 2 diptych. fullWindow: true → full stage, else frame insets.
export function objectFitWindows({ count, frame, fullWindow }) {
  const win = fullWindow ? { top: 0, right: 0, bottom: 0, left: 0 } : frame;
  const openLeft = win.left;
  const openRight = 100 - win.right;
  const openWidth = openRight - openLeft;
  if (count === 2) {
    const mid = openLeft + openWidth / 2;
    return [
      { top: win.top, bottom: win.bottom, left: win.left, right: 100 - mid,
        centerXPct: (openLeft + mid) / 2, widthPct: openWidth / 2 },
      { top: win.top, bottom: win.bottom, left: mid, right: win.right,
        centerXPct: (mid + openRight) / 2, widthPct: openWidth / 2 },
    ];
  }
  return [
    { top: win.top, bottom: win.bottom, left: win.left, right: win.right,
      centerXPct: openLeft + openWidth / 2, widthPct: openWidth },
  ];
}

export default VIEW_MODES;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artModes.test.mjs`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/artModes.js tests/unit/art/artModes.test.mjs
git commit -m "feat(artmode): view-mode descriptors + object-fit window geometry"
```

---

### Task 2: Balanced title line splitting

**Files:**
- Create: `frontend/src/screen-framework/widgets/titleLayout.js`
- Test: `tests/unit/art/titleLayout.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art/titleLayout.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { layoutTitle } from '../../../frontend/src/screen-framework/widgets/titleLayout.js';

// fake measurer: width = character count
const measure = (s) => s.length;

describe('layoutTitle', () => {
  it('returns one line when it fits', () => {
    expect(layoutTitle('Short', 100, measure)).toEqual(['Short']);
  });
  it('returns [] for empty/blank', () => {
    expect(layoutTitle('', 100, measure)).toEqual([]);
    expect(layoutTitle('   ', 100, measure)).toEqual([]);
  });
  it('one line when no measurer or no width', () => {
    expect(layoutTitle('A very long title here', 0, measure)).toEqual(['A very long title here']);
    expect(layoutTitle('A very long title here', 100, null)).toEqual(['A very long title here']);
  });
  it('splits into two balanced lines when too wide', () => {
    const lines = layoutTitle('one two three four', 10, measure);
    expect(lines).toHaveLength(2);
    expect(Math.abs(measure(lines[0]) - measure(lines[1]))).toBeLessThanOrEqual(3);
    expect(`${lines[0]} ${lines[1]}`).toBe('one two three four');
  });
  it('single unsplittable word stays one line', () => {
    expect(layoutTitle('Supercalifragilistic', 5, measure)).toEqual(['Supercalifragilistic']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/titleLayout.test.mjs`
Expected: FAIL — cannot resolve `titleLayout.js`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/screen-framework/widgets/titleLayout.js`:

```js
// titleLayout.js — pure balanced line splitting for placard titles. No DOM.
// Returns 1 or 2 lines; per-line truncation (…) is left to CSS.

export function layoutTitle(title, maxWidthPx, measure) {
  const text = String(title ?? '').trim();
  if (!text) return [];
  if (typeof measure !== 'function' || !(maxWidthPx > 0)) return [text];
  if (measure(text) <= maxWidthPx) return [text];

  const words = text.split(/\s+/);
  if (words.length < 2) return [text];

  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const diff = Math.abs(measure(a) - measure(b));
    if (best === null || diff < best.diff) best = { diff, a, b };
  }
  return [best.a, best.b];
}

export default layoutTitle;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/titleLayout.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/titleLayout.js tests/unit/art/titleLayout.test.mjs
git commit -m "feat(artmode): balanced two-line title splitting"
```

---

### Task 3: `artLayout` reports panel width

**Files:**
- Modify: `frontend/src/screen-framework/widgets/artLayout.js`
- Test: `tests/unit/art/artLayout.test.mjs`

- [ ] **Step 1: Write the failing test**

Append these two `it` blocks inside the existing top-level `describe` in `tests/unit/art/artLayout.test.mjs` (place them before the file's final closing `});`):

```js
  it('single panel reports widthPct (% of stage)', () => {
    const out = artLayout({ mode: 'single', ratios: [1.6], ...CFG });
    expect(out.panels[0].widthPct).toBeGreaterThan(0);
    expect(out.panels[0].widthPct).toBeLessThanOrEqual(100);
  });

  it('diptych panels report widthPct', () => {
    const out = artLayout({ mode: 'diptych', ratios: [0.75, 0.7], ...CFG });
    expect(out.panels[0].widthPct).toBeGreaterThan(0);
    expect(out.panels[1].widthPct).toBeGreaterThan(0);
  });
```

Note: the existing file already defines `CFG = { frame: FRAME, matMargin: 4, crop: 0.08 }`. If the two new `it` blocks cannot be placed in the same `describe` as `CFG`, wrap them in their own `describe('artLayout widthPct', () => { ... })` and repeat the constants:

```js
const FRAME2 = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const CFG2 = { frame: FRAME2, matMargin: 4, crop: 0.08 };
```

and use `...CFG2` instead of `...CFG`.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artLayout.test.mjs`
Expected: FAIL — `out.panels[0].widthPct` is `undefined` (not `> 0`).

- [ ] **Step 3: Write the implementation**

In `frontend/src/screen-framework/widgets/artLayout.js`, add `widthPct` to both return blocks.

Diptych return (currently lines ~51-54) — change the `panels` array to:

```js
      panels: [
        { boxAspect: b1, heightPct, centerXPct: (c1 / SW) * 100, widthPct: (w1 / SW) * 100 },
        { boxAspect: b2, heightPct, centerXPct: (c2 / SW) * 100, widthPct: (w2 / SW) * 100 },
      ],
```

Single return (currently lines ~74-76) — change the `panels` array to:

```js
    panels: [
      { boxAspect: bAR, heightPct: (hpx / openHpx) * 100, centerXPct: (centerX / SW) * 100, widthPct: (wpx / SW) * 100 },
    ],
```

(`w1`, `w2`, and `wpx` are already computed earlier in each branch.)

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/art/artLayout.test.mjs`
Expected: PASS (existing tests still green; two new ones pass).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/widgets/artLayout.js tests/unit/art/artLayout.test.mjs
git commit -m "feat(artmode): artLayout reports per-panel widthPct"
```

---

### Task 4: ArtMode integration — Tab cycle, render paths, placard refinements

**Files:**
- Modify: `frontend/src/screen-framework/widgets/ArtMode.jsx`
- Modify: `frontend/src/screen-framework/widgets/ArtMode.css`
- Test: `frontend/src/screen-framework/widgets/ArtMode.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add these helpers and `it` blocks to `frontend/src/screen-framework/widgets/ArtMode.test.jsx`.

First, just below the existing `press` helper (near the top of the file), add a Shift variant:

```js
const pressShift = (key) =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true })); });
```

Then add the following `it` blocks inside the existing `describe('ArtMode', ...)` block (before its closing `});`):

```js
  it('Tab cycles view modes (wraps); Shift+Tab reverses', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    const modeOf = () => getByTestId('artmode').getAttribute('data-mode');
    expect(modeOf()).toBe('gallery');
    press('Tab'); expect(modeOf()).toBe('framed-contain');
    press('Tab'); expect(modeOf()).toBe('framed-cover');
    press('Tab'); expect(modeOf()).toBe('bare-contain');
    press('Tab'); expect(modeOf()).toBe('bare-cover');
    press('Tab'); expect(modeOf()).toBe('gallery');         // wrap forward
    pressShift('Tab'); expect(modeOf()).toBe('bare-cover');  // reverse wrap
  });

  it('hides the frame in bare modes, shows it in framed modes', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-frame')).toBeTruthy();          // gallery
    press('Tab'); press('Tab'); press('Tab');                   // bare-contain
    expect(queryByTestId('artmode-frame')).toBeNull();
  });

  it('hides placards in bare modes', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId, queryByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    expect(getByTestId('artmode-placard')).toBeTruthy();
    press('Tab'); press('Tab'); press('Tab'); press('Tab');     // bare-cover
    expect(queryByTestId('artmode-placard')).toBeNull();
  });

  it('applies object-fit per mode (contain then cover)', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    press('Tab');  // framed-contain
    expect(getByTestId('artmode-image').className).toContain('artmode__fitimage--contain');
    press('Tab');  // framed-cover
    expect(getByTestId('artmode-image').className).toContain('artmode__fitimage--cover');
  });

  it('keeps diptych two-up in object-fit modes', async () => {
    DaylightAPI.mockResolvedValue(diptych());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    press('Tab');  // framed-contain
    expect(getByTestId('artmode-image')).toBeTruthy();
    expect(getByTestId('artmode-image-1')).toBeTruthy();
  });

  it('preserves the mode across a shuffle', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    press('Tab'); press('Tab');  // framed-cover
    expect(getByTestId('artmode').getAttribute('data-mode')).toBe('framed-cover');
    press('ArrowRight');         // shuffle
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledTimes(2));
    expect(getByTestId('artmode').getAttribute('data-mode')).toBe('framed-cover');
  });

  it('Tab is preventDefaulted (kiosk focus never moves)', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-image')).toBeTruthy());
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('placard max-width tracks the panel width', async () => {
    DaylightAPI.mockResolvedValue(single());
    const { getByTestId } = render(<ArtMode />);
    await waitFor(() => expect(getByTestId('artmode-placard')).toBeTruthy());
    expect(getByTestId('artmode-placard').style.maxWidth).toMatch(/%$/);
  });

  it('splits a long title into two balanced placard lines', async () => {
    DaylightAPI.mockResolvedValue(single({
      panels: [{ image: '/a.jpg', meta: { title: 'one two three four', artist: 'X', date: '1', width: 1600, height: 1000 } }],
    }));
    const measureText = (s) => s.length * 1000;  // force a split
    const { getByTestId, container } = render(<ArtMode measureText={measureText} />);
    await waitFor(() => expect(getByTestId('artmode-placard')).toBeTruthy());
    expect(container.querySelectorAll('.artmode__placard-title').length).toBe(2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: FAIL — `data-mode` attribute missing, no `artmode__fitimage--*`, `measureText` prop ignored, etc.

- [ ] **Step 3: Replace ArtMode.jsx with the integrated component**

Overwrite `frontend/src/screen-framework/widgets/ArtMode.jsx` with:

```jsx
// frontend/src/screen-framework/widgets/ArtMode.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';
import smartquotes from 'smartquotes';
import { artLayout } from './artLayout.js';
import { VIEW_MODES, modeIndexByName, nextMode, prevMode, objectFitWindows } from './artModes.js';
import { layoutTitle } from './titleLayout.js';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import { luxToDim } from './luxToDim.js';
import './ArtMode.css';

const DIM_STEP = 0.1;
const DIM_MAX = 0.85;
const EXIT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'Esc']);
const NEXT_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
const BRIGHTER_KEYS = new Set(['ArrowUp']);
const DIMMER_KEYS = new Set(['ArrowDown']);
const round2 = (n) => Math.round(n * 100) / 100;
const DEFAULT_FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };

// Typographic quotes/apostrophes via the smartquotes library (no hand-rolled regex).
const smartQuotes = (s) => (s == null ? s : smartquotes.string(String(s)));

/**
 * ArtMode — single landscape or portrait diptych, matted + framed, with engraved
 * brass nameplate(s). Home screensaver.
 *
 * Tab / Shift+Tab cycle five view modes (Gallery → Framed·Contain → Framed·Cover
 * → Bare·Contain → Bare·Cover); the mode persists across shuffles, resets on remount.
 *
 * Props (from screen YAML screensaver.props):
 *   placard         show nameplate(s) (default true)
 *   onExit/dismiss  close the screensaver
 *   frame           frame PNG window insets {top,right,bottom,left} % (default DEFAULT_FRAME)
 *   matMargin       mat band % of height (default 4)
 *   cropMaxPerSide  max cover-crop per side, % (default 8)
 *   ambient         { defaultLux, curve } for auto-dim (optional)
 *   defaultViewMode initial view mode name (default 'gallery')
 *   measureText     optional (s)=>px text measurer (test seam; canvas in browser)
 */
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8, ambient = null,
  defaultViewMode = 'gallery', measureText = null,
}) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const ambientCurve = ambient?.curve ?? null;
  const [autoDim, setAutoDim] = useState(() => (ambientCurve ? luxToDim(ambient?.defaultLux ?? 0, ambientCurve) : 0));
  const [manualBias, setManualBias] = useState(0);
  const dim = round2(Math.max(0, Math.min(DIM_MAX, autoDim + manualBias)));
  const [revealed, setRevealed] = useState(false);   // curtain open?
  const loadedRef = useRef(0);                        // how many panel images have loaded
  const [modeIdx, setModeIdx] = useState(() => modeIndexByName(defaultViewMode));
  const mode = VIEW_MODES[modeIdx];
  const isGallery = mode.fit === 'gallery';
  const logger = useMemo(() => getChildLogger({ widget: 'art' }), []);
  const frameSrc = useMemo(() => DaylightMediaPath('media/img/ui/frame.png'), []);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Stage size — drives placard width + title measurement.
  const stageRef = useRef(null);
  const [stage, setStage] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 720,
  }));
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const update = () => setStage((p) => ({ w: el.clientWidth || p.w, h: el.clientHeight || p.h }));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(() => {
    // Drop the curtain immediately (covers the swap), then fetch + reveal on load.
    loadedRef.current = 0;
    setRevealed(false);
    DaylightAPI('api/v1/art/featured')
      .then((data) => {
        if (!mountedRef.current) return;
        setFailed(false);
        setArt(data);
        logger.info('artmode.loaded', { mode: data?.mode ?? null, count: data?.panels?.length ?? 0 });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setFailed(true);
        logger.error('artmode.load-failed', { error: err.message });
      });
  }, [logger]);

  // If the fetch fails there are no images to wait on — part the curtain anyway.
  useEffect(() => { if (failed) setRevealed(true); }, [failed]);
  useEffect(() => { logger.info('artmode.mount', { placard }); load(); }, [logger, load, placard]);

  const exit = useCallback(() => { (onExit || dismiss)?.(); }, [onExit, dismiss]);
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      const isTab = k === 'Tab';
      if (!(EXIT_KEYS.has(k) || NEXT_KEYS.has(k) || BRIGHTER_KEYS.has(k) || DIMMER_KEYS.has(k) || isTab)) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (isTab) {
        setModeIdx((i) => (e.shiftKey ? prevMode(i) : nextMode(i)));
        logger.info('artmode.viewmode', { dir: e.shiftKey ? 'prev' : 'next' });
      } else if (EXIT_KEYS.has(k)) { logger.info('artmode.exit', { key: k }); exit(); }
      else if (NEXT_KEYS.has(k)) { logger.info('artmode.shuffle', { key: k }); load(); }
      else if (BRIGHTER_KEYS.has(k)) setManualBias((b) => round2(b - DIM_STEP));
      else setManualBias((b) => round2(b + DIM_STEP));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit, load, logger]);

  useWebSocketSubscription(['ambient'], (msg) => {
    if (!ambientCurve || !msg) return;
    setAutoDim(luxToDim(Number(msg.lux), ambientCurve));
  }, [ambientCurve]);

  const matteVars = useMemo(() => {
    const m = art?.matte;
    if (!m) return undefined;
    return {
      '--matte-base': m.base, '--matte-glow': m.glow, '--matte-edge': m.edge,
      '--cut-top': m.bevelTop, '--cut-left': m.bevelLeft, '--cut-right': m.bevelRight, '--cut-bottom': m.bevelBottom,
    };
  }, [art]);

  const panels = (!failed && art?.panels) ? art.panels : [];
  const layout = useMemo(() => {
    if (!panels.length) return null;
    const ratios = panels.map((p) =>
      (p.meta?.width > 0 && p.meta?.height > 0) ? p.meta.width / p.meta.height : 1);
    return artLayout({ mode: art.mode, ratios, frame, matMargin, crop: cropMaxPerSide / 100 });
  }, [panels, art, frame, matMargin, cropMaxPerSide]);

  const fitWindows = useMemo(
    () => (panels.length ? objectFitWindows({ count: panels.length, frame, fullWindow: mode.fullWindow }) : []),
    [panels.length, frame, mode.fullWindow]);

  // Title measurement — canvas in the browser, injectable for tests. The
  // splitting itself is pure (titleLayout.js).
  const fontPx = Math.max(15.2, Math.min(27.2, 0.021 * stage.h));
  const measure = useMemo(() => {
    if (measureText) return measureText;
    if (typeof document === 'undefined') return null;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.font = `italic 600 ${fontPx}px "Cormorant Garamond", Georgia, serif`;
    return (s) => ctx.measureText(s).width;
  }, [measureText, fontPx]);

  const titleLinesFor = (title, widthPct) => {
    const panelPx = (widthPct / 100) * stage.w;
    const textPx = Math.max(0, panelPx - 3.4 * fontPx); // minus ~horizontal padding
    return layoutTitle(smartQuotes(title), textPx, measure);
  };

  const placardGeom = isGallery ? (layout?.panels ?? []) : fitWindows;
  const testid = (base, i) => (i === 0 ? base : `${base}-${i}`);

  const onLoaded = () => {
    loadedRef.current += 1;
    if (loadedRef.current >= panels.length) setRevealed(true);
  };

  return (
    <div className="artmode" data-testid="artmode" data-mode={mode.name} style={matteVars} ref={stageRef}>
      <div className="artmode__stage">
        <div className="artmode__matte" aria-hidden="true" />

        {isGallery && layout && (
          <div className="artmode__opening" style={{
            top: `${layout.opening.top}%`, bottom: `${layout.opening.bottom}%`,
            left: `${layout.opening.left}%`, right: `${layout.opening.right}%`,
            justifyContent: layout.justify,
          }}>
            {panels.map((p, i) => (
              <div key={p.image} className="artmode__window" data-testid={testid('artmode-window', i)}
                   style={{ height: `${layout.panels[i].heightPct}%`, aspectRatio: String(layout.panels[i].boxAspect) }}>
                <img className="artmode__image" data-testid={testid('artmode-image', i)}
                     src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'}
                     onLoad={onLoaded} onError={onLoaded} />
                <span className="artmode__cut" aria-hidden="true" />
              </div>
            ))}
          </div>
        )}

        {!isGallery && panels.map((p, i) => {
          const win = fitWindows[i];
          return (
            <div key={p.image} className="artmode__fitwindow" data-testid={testid('artmode-window', i)}
                 style={{ top: `${win.top}%`, left: `${win.left}%`, right: `${win.right}%`, bottom: `${win.bottom}%` }}>
              <img className={`artmode__fitimage artmode__fitimage--${mode.fit}`}
                   data-testid={testid('artmode-image', i)}
                   src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'}
                   onLoad={onLoaded} onError={onLoaded} />
            </div>
          );
        })}

        {/* Curtain: down by default, parts once the artwork has loaded. */}
        <div className={`artmode__curtain${revealed ? ' artmode__curtain--open' : ''}`}
             data-testid="artmode-curtain" aria-hidden="true">
          <div className="artmode__curtain-panel artmode__curtain-panel--l" />
          <div className="artmode__curtain-panel artmode__curtain-panel--r" />
        </div>

        {mode.frame && (
          <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
        )}

        {placard && mode.placard && placardGeom.map((g, i) => {
          const p = panels[i];
          if (!p || !(p.meta && (p.meta.title || p.meta.artist))) return null;
          const lines = p.meta.title ? titleLinesFor(p.meta.title, g.widthPct) : [];
          return (
            <div key={i} className="artmode__placard" data-testid={testid('artmode-placard', i)}
                 style={{ left: `${g.centerXPct}%`, maxWidth: `${g.widthPct}%` }}>
              {lines.map((ln, j) => (
                <span key={j} className="artmode__placard-title artmode__placard-line">{ln}</span>
              ))}
              {(p.meta.artist || p.meta.date) && (
                <span className="artmode__placard-artist artmode__placard-line">
                  {smartQuotes([p.meta.artist, p.meta.date].filter(Boolean).join(' · '))}
                </span>
              )}
            </div>
          );
        })}

        <div className="artmode__dim" data-testid="artmode-dim" aria-hidden="true" style={{ opacity: dim }} />
      </div>
    </div>
  );
}

export default ArtMode;
```

- [ ] **Step 4: Add the CSS for object-fit windows and per-line title truncation**

Append to the end of `frontend/src/screen-framework/widgets/ArtMode.css`:

```css
/* ---- Object-fit windows (view modes 2-5) ----
   Absolute window keyed off inline inset %; matte shows through any contain-box. */
.artmode__fitwindow {
  position: absolute;
  overflow: hidden;
  line-height: 0;
}
.artmode__fitimage {
  display: block;
  width: 100%;
  height: 100%;
}
.artmode__fitimage--contain { object-fit: contain; }
.artmode__fitimage--cover { object-fit: cover; }

/* ---- Placard title may render as 1-2 balanced lines; truncate each with … ---- */
.artmode__placard-line {
  display: block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: Run the ArtMode tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/widgets/ArtMode.test.jsx`
Expected: PASS — all prior tests plus the nine new ones green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/widgets/ArtMode.jsx \
        frontend/src/screen-framework/widgets/ArtMode.css \
        frontend/src/screen-framework/widgets/ArtMode.test.jsx
git commit -m "feat(artmode): Tab view-mode cycle + image-width balanced placards"
```

---

### Task 5: Full art-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run every art + widget test together**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/unit/art/artModes.test.mjs \
  tests/unit/art/titleLayout.test.mjs \
  tests/unit/art/artLayout.test.mjs \
  tests/unit/art/luxToDim.test.mjs \
  tests/unit/art/deriveMatte.test.mjs \
  frontend/src/screen-framework/widgets/ArtMode.test.jsx
```
Expected: PASS — all test files green, zero failures.

- [ ] **Step 2: Manual QA notes (post-merge, on the kiosk)**

After deploy + kiosk reload, on the living-room ArtMode:
- Press **Tab** five times → cycles Gallery → Framed·Contain → Framed·Cover → Bare·Contain → Bare·Cover → back to Gallery.
- **Shift+Tab** steps backward.
- Contain modes show matte (not black) in the letter/pillarbox gaps; cover modes fill the window (Bare·Cover is full-bleed).
- Frame + placards present in modes 1-3, gone in 4-5.
- A long title wraps to two balanced lines clamped to the artwork width; an over-long line ends with `…`.
- **←/→** shuffles art and keeps the current mode; reopening the screensaver returns to Gallery.

(Deploy is the operator's call per the standing workflow; this plan ends at green tests.)

---

## Notes for the implementer

- Run tests with the exact command shown; `npm run test:isolated` routes these specs to the wrong runner.
- Keep the existing ArtMode tests passing — the Task 4 rewrite preserves all current test IDs and the `placard` prop gate (now combined with `mode.placard`).
- In jsdom there is no canvas 2D context, so `measure` is `null` and titles render as a single line unless a `measureText` prop is injected — that is expected and the split test injects a fake measurer.
