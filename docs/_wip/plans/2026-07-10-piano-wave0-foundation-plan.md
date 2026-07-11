# Piano Kiosk Wave 0 Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the piano-kiosk design-system residue — a spacing scale, a consolidated touch-reset, a count-aware balanced tile grid (which also fixes the Games menu clumping), and a reusable skeleton-loader primitive proven on the course wall.

**Architecture:** All styling lives in the single kiosk stylesheet `frontend/src/Apps/PianoApp.scss` (token-driven `:root`). Layout math is a pure, unit-tested helper; components set a CSS custom property from it. The skeleton is a small React component + SCSS. No backend changes.

**Tech Stack:** React (JSX), SCSS, Vitest + @testing-library/react. Font is Roboto Condensed (canonical — do not add display fonts). Use the structured logger, never raw console.

---

## Conventions for the executing engineer

- **Branch:** `feat/piano-wave0-foundation` (already created). Commit per task.
- **Run one test file:** `npx vitest run <path>`
- **Run the Piano suite (guardrail):** `npx vitest run frontend/src/modules/Piano/PianoKiosk`
- **Build check (imports resolve):** `cd frontend && npx vite build` (~22s; `dist/` is gitignored).
- CSS-only tasks (F5, F1) are **not** unit-testable — they are verified by `vite build` staying clean and by a deferred screenshot pass (dev server is down at plan time). Do **not** invent brittle "does the SCSS contain this string" tests.
- Tokens already in `:root` of `PianoApp.scss`: color (`--piano-*`), type (`--t-*`), radius (`--r-*`). The spacing scale (`--sp-*`) is the missing sibling.

---

## Task 1: F5 — spacing scale tokens

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (`:root`, after the radius scale block ending ~`:38`)

**Step 1: Add the scale.** In `:root`, immediately after the `--r-pill: 999px;` line and its comment block, add:

```scss
  // --- spacing scale (4px ramp; the missing sibling of the type/radius scales) ---
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --sp-7: 48px;
```

**Step 2: Adopt opportunistically (only the tile grid gutter + mode padding).**
- `.piano-menu__tiles { gap: 1.5rem; }` (~`:265`) → `gap: var(--sp-5);`
- `.piano-menu__tiles` portrait override `gap: 0.75rem;` (~`:296`) → `gap: var(--sp-3);`
- `.piano-mode { padding: 1.5rem; }` (~`:314`) → `padding: var(--sp-5);`

Do **not** sweep the rest of the file — later waves migrate their own surfaces.

**Step 3: Verify build is clean.**
Run: `cd frontend && npx vite build`
Expected: `✓ built in …` with no errors.

**Step 4: Commit.**
```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): add --sp-* spacing scale; adopt in tile grid + mode padding (F5)"
```

---

## Task 2: F1 — consolidate touch-reset

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (the existing `.piano-app` block ~`:90-98` and the global `focus-visible` at ~`:1747`)

**Step 1: Read the current rules.** Inspect `.piano-app` (~`:90`) — it already has `touch-action: manipulation;`, `-webkit-tap-highlight-color: transparent;`, and `* { -webkit-tap-highlight-color: transparent; }`. Also read the block at `:1747` (`.piano-app :focus-visible { outline: none !important; }`).

**Step 2: Consolidate into one documented base-reset.** In the `.piano-app` block, keep `touch-action: manipulation;` and extend the reset so it reads:

```scss
  // Kiosk base-reset (touch-only surface): no text selection, no callout, no
  // tap-highlight flash, no focus rings. Consolidated here (was scattered).
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  user-select: none;
  -webkit-user-select: none;
  * { -webkit-tap-highlight-color: transparent; }
  :focus-visible { outline: none; }
```

Then add the **escape hatch** immediately after the `.piano-app` block so real text fields stay usable:

```scss
// Real text fields must remain selectable/editable despite the kiosk reset.
.piano-app input,
.piano-app textarea,
.piano-app [contenteditable] { user-select: text; -webkit-user-select: text; }
```

**Step 3: Remove the now-duplicated global `focus-visible`.** Delete the standalone `.piano-app :focus-visible { outline: none !important; }` block at ~`:1747` (now covered above). Keep any *element-specific* `focus-visible` accents (e.g. `.piano-course-tab:focus-visible`, `:1020`) — those are intentional.

**Step 4: Leave `touch-action` per-element.** Do not add `touch-action` to the global reset — surfaces that need `pan-x`/`none` (sliders, canvases, drag rows) set it themselves.

**Step 5: Verify build is clean.**
Run: `cd frontend && npx vite build` → `✓ built`.

**Step 6: Commit.**
```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "refactor(piano): consolidate kiosk touch-reset into one base block; kill user-select globally with text-field escape hatch (F1)"
```

---

## Task 3: F3 — `balancedColumns` helper (pure, TDD)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/tileGridLayout.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/tileGridLayout.test.js`

**Step 1: Write the failing test.**

```js
import { describe, it, expect } from 'vitest';
import { balancedColumns } from './tileGridLayout.js';

describe('balancedColumns', () => {
  it('keeps up to `max` on a single row', () => {
    expect(balancedColumns(4)).toBe(4);   // Games: 4 in one centered row
    expect(balancedColumns(5)).toBe(5);
  });
  it('keeps the 10-item home menu at 5×2 (unchanged)', () => {
    expect(balancedColumns(10)).toBe(5);
  });
  it('splits into the fewest-empty rectangle past `max`', () => {
    expect(balancedColumns(6)).toBe(3);   // 3+3
    expect(balancedColumns(7)).toBe(4);   // 4+3
    expect(balancedColumns(8)).toBe(4);   // 4×2
    expect(balancedColumns(9)).toBe(3);   // 3×3
  });
  it('handles degenerate counts', () => {
    expect(balancedColumns(0)).toBe(1);
    expect(balancedColumns(1)).toBe(1);
    expect(balancedColumns(-3)).toBe(1);
  });
  it('honors a custom max', () => {
    expect(balancedColumns(6, { max: 4 })).toBe(3); // rows=2 → 3 cols
    expect(balancedColumns(4, { max: 3 })).toBe(2); // rows=2 → 2 cols
  });
});
```

**Step 2: Run it — verify it fails.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/tileGridLayout.test.js`
Expected: FAIL — `balancedColumns is not a function` / module not found.

**Step 3: Implement the helper.**

```js
// tileGridLayout.js
// Pure layout helper for the kiosk tile menus: choose a column count that packs
// `count` tiles into the fewest-empty rectangle, capped at `max` columns, so any
// menu (10-item home, 4-item games) centers into balanced rows instead of
// clumping left in a fixed grid. Mirrors columnsForCount in whoIsPlayingLayout.js
// (that one caps at 4; the tile wall caps at 5).

export function balancedColumns(count, { max = 5 } = {}) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n <= 1) return 1;
  const cap = Math.max(1, Math.floor(max) || 1);
  const rows = Math.ceil(n / cap);
  return Math.ceil(n / rows);
}

export default balancedColumns;
```

**Step 4: Run the test — verify it passes.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/tileGridLayout.test.js`
Expected: PASS (all).

**Step 5: Commit.**
```bash
git add frontend/src/modules/Piano/PianoKiosk/tileGridLayout.js frontend/src/modules/Piano/PianoKiosk/tileGridLayout.test.js
git commit -m "feat(piano): balancedColumns tile-grid layout helper (F3)"
```

---

## Task 4: F3 — wire the count-aware grid into menu + games

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (`.piano-menu__tiles` ~`:257-266` and portrait override ~`:292-298`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx` (the `<ul className="piano-menu__tiles">`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx` (`GamePicker`'s `<ul className="piano-menu__tiles">`)
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js` (already exists — extend) and Games has coverage via the Piano suite.

**Step 1: Make the grid honor a `--tile-cols` var.** In `.piano-menu__tiles`:
- Change `grid-template-columns: repeat(5, minmax(8rem, 15rem));` → `grid-template-columns: repeat(var(--tile-cols, 5), minmax(8rem, 15rem));`
- Add `justify-content: center;` to the `&__tiles` rule.
In the portrait override (`@media (orientation: portrait) .piano-menu__tiles`), change `repeat(5, minmax(0, 1fr));` → `repeat(var(--tile-cols, 5), minmax(0, 1fr));`

**Step 2: Set the var in PianoMenu.** In `PianoMenu.jsx`, import the helper and compute columns from `PIANO_MODES.length`:

```jsx
import { balancedColumns } from './tileGridLayout.js';
// ...inside the component, before return:
const cols = balancedColumns(PIANO_MODES.length); // 10 → 5 (unchanged)
```
Then set the style on the `<ul>`:
```jsx
<ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
```

**Step 3: Set the var in Games' GamePicker.** In `Games.jsx`, import the helper and compute from the filtered `ids`:

```jsx
import { balancedColumns } from '../../tileGridLayout.js';
// ...inside GamePicker, after `const ids = ...`:
const cols = balancedColumns(ids.length); // 4 → 4 (centered, no empty column)
```
Then:
```jsx
<ul className="piano-menu__tiles" style={{ '--tile-cols': cols }}>
```

**Step 4: Extend the menu test.** In `PianoMenu.modes.test.js`, add an assertion that the tiles `<ul>` carries the expected `--tile-cols` for the current mode count. Example (adapt to the file's existing render/query style):

```js
it('sets --tile-cols from the balanced column count', () => {
  // render PianoMenu (as the existing tests do)
  const ul = document.querySelector('.piano-menu__tiles');
  expect(ul).toBeTruthy();
  expect(ul.style.getPropertyValue('--tile-cols')).toBe('5'); // 10 modes → 5
});
```

**Step 5: Run tests — verify pass.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js`
Expected: PASS. Then the Games coverage via `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Games` (if a test file exists there) — otherwise rely on the full-suite guardrail in Step 6.

**Step 6: Guardrail + build.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk` → all green.
Run: `cd frontend && npx vite build` → `✓ built`.

**Step 7: Commit.**
```bash
git add frontend/src/Apps/PianoApp.scss frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx frontend/src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js
git commit -m "feat(piano): count-aware centered tile grid via --tile-cols; fixes Games clumping (#3, F3)"
```

**Deferred (dev server down):** screenshot the Games menu to confirm 4 tiles are centered with no empty 5th column, and that the home menu is still 5×2.

---

## Task 5: F4 — skeleton primitive

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/Skeleton.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/Skeleton.test.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` (append a skeleton block; use `--sp-*` + `--r-*`)

**Step 1: Write the failing test.**

```jsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Skeleton, SkeletonPoster } from './Skeleton.jsx';

describe('Skeleton', () => {
  it('renders a shimmer block with the base class', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('.piano-skeleton');
    expect(el).toBeTruthy();
    expect(el.classList.contains('is-shimmer')).toBe(true);
  });
  it('drops the shimmer when animate={false} (reduced-motion callers)', () => {
    const { container } = render(<Skeleton animate={false} />);
    expect(container.querySelector('.piano-skeleton').classList.contains('is-shimmer')).toBe(false);
  });
  it('SkeletonPoster renders `count` poster placeholders', () => {
    const { container } = render(<SkeletonPoster count={6} />);
    expect(container.querySelectorAll('.piano-skeleton--poster').length).toBe(6);
  });
});
```

**Step 2: Run it — verify it fails.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/Skeleton.test.jsx`
Expected: FAIL — module not found.

**Step 3: Implement the component.**

```jsx
// Skeleton.jsx
// Reusable shimmer placeholders for kiosk loading states. Base <Skeleton> is a
// single shimmer block; the composed helpers shape common loading surfaces. The
// shimmer respects prefers-reduced-motion (callers pass animate={false}, or the
// CSS media query flattens it).

export function Skeleton({ className = '', animate = true, style }) {
  const cls = `piano-skeleton${animate ? ' is-shimmer' : ''}${className ? ` ${className}` : ''}`;
  return <div className={cls} style={style} aria-hidden="true" />;
}

/** A poster-shaped skeleton grid (2:3 tiles) for course/poster walls. */
export function SkeletonPoster({ count = 6, animate = true }) {
  return (
    <ul className="piano-skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <Skeleton className="piano-skeleton--poster" animate={animate} />
        </li>
      ))}
    </ul>
  );
}

export default Skeleton;
```

**Step 4: Add the SCSS.** Append to `frontend/src/Apps/PianoApp.scss`:

```scss
// ── Skeleton loaders ─────────────────────────────────────────────────────────
.piano-skeleton {
  background: var(--piano-surface-2);
  border-radius: var(--r-sm);
  width: 100%;
  &.is-shimmer {
    background: linear-gradient(90deg, var(--piano-surface) 25%, var(--piano-surface-2) 37%, var(--piano-surface) 63%);
    background-size: 400% 100%;
    animation: piano-skeleton-shimmer 1.4s ease infinite;
  }
}
.piano-skeleton--poster { aspect-ratio: 2 / 3; border-radius: var(--r-sm); }
.piano-skeleton-grid {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-wrap: wrap; gap: var(--sp-4); justify-content: center;
  li { flex: 0 0 12.75rem; width: 12.75rem; }
}
@keyframes piano-skeleton-shimmer {
  from { background-position: 100% 0; }
  to   { background-position: -100% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .piano-skeleton.is-shimmer { animation: none; background: var(--piano-surface-2); }
}
```

**Step 5: Run the test — verify it passes.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/Skeleton.test.jsx`
Expected: PASS.

**Step 6: Commit.**
```bash
git add frontend/src/modules/Piano/PianoKiosk/Skeleton.jsx frontend/src/modules/Piano/PianoKiosk/Skeleton.test.jsx frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): skeleton-loader primitive (Skeleton + SkeletonPoster, reduced-motion aware) (F4)"
```

---

## Task 6: F4 — prove the primitive on the course wall

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx` (the loading branch — currently `{loading && <PianoEmpty loading />}` ~`:135`)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.skeleton.test.jsx` (new)

**Step 1: Confirm the loading branch.** In `CourseGrid.jsx`, find the render around `:134-136`:
```jsx
{noGroups && <PianoEmpty message="No video library has been set up yet." />}
{loading && <PianoEmpty loading />}
{empty && <PianoEmpty message="No videos found." />}
```
Only the **loading** branch changes; empty/error keep `PianoEmpty`.

**Step 2: Write the failing test.** Mock what CourseGrid needs so it renders the loading state (adapt to how the file's existing tests, e.g. `Videos.test.jsx`, mock `usePianoList`). Assert poster skeletons render while loading:

```jsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Keep usePianoList permanently "loading" (data === null) so the wall is loading.
vi.mock('../../usePianoList.js', () => ({ default: () => ({ data: null }) }));
vi.mock('./CourseTile.jsx', () => ({ default: () => null }));

import CourseGrid from './CourseGrid.jsx';

describe('CourseGrid loading state', () => {
  it('renders poster skeletons while the wall is loading', () => {
    const groups = [{ label: 'Lessons', collections: ['plex:1'] }];
    const { container } = render(<CourseGrid groups={groups} onSelect={() => {}} />);
    expect(container.querySelectorAll('.piano-skeleton--poster').length).toBeGreaterThan(0);
  });
});
```

**Step 3: Run it — verify it fails.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.skeleton.test.jsx`
Expected: FAIL — no `.piano-skeleton--poster` (still bare `PianoEmpty` text).

**Step 4: Swap the loading branch to skeletons.** In `CourseGrid.jsx`:
- Add import: `import { SkeletonPoster } from '../../Skeleton.jsx';`
- Replace `{loading && <PianoEmpty loading />}` with `{loading && <SkeletonPoster count={8} />}`.
- Remove the now-unused `PianoEmpty` import **only if** no other branch uses it (the empty/error branches still do — so keep it).

**Step 5: Run the test — verify it passes.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.skeleton.test.jsx`
Expected: PASS.

**Step 6: Guardrail + build.**
Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk` → all green.
Run: `cd frontend && npx vite build` → `✓ built`.

**Step 7: Commit.**
```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseGrid.skeleton.test.jsx
git commit -m "feat(piano): course wall shows poster skeletons while loading (F4 proof surface)"
```

**Deferred (dev server down):** screenshot the course wall mid-load to confirm the skeleton grid matches the real poster layout.

---

## Task 7: Wrap-up

**Step 1: Update the audit + design docs.**
- In `docs/_wip/audits/2026-07-10-piano-kiosk-redesign-laundry-list-audit.md`: mark F1/F3/F4/F5 and #3/#4 status (F3+#3 done; F4 primitive done, #4 rollout → Wave 0b; F1/F5 done).
- In `docs/_wip/plans/2026-07-10-piano-wave0-foundation-design.md`: flip Status to "Implemented (Wave 0); Wave 0b pending".

**Step 2: Commit docs.**
```bash
git add docs/_wip
git commit -m "docs(piano): Wave 0 foundation implemented; #3/#4 + F1/F3/F4/F5 status"
```

**Step 3: Final verification before merge.**
- `npx vitest run frontend/src/modules/Piano/PianoKiosk` → all green.
- `cd frontend && npx vite build` → `✓ built`.
- List the deferred visual checks (Games centering, home 5×2, course-wall skeletons) for the screenshot pass when the dev server returns.

**Step 4: Merge decision.** Do **not** auto-merge to `main`. Present the branch, the passing tests/build, and the deferred visual checks; let KC decide when to merge (per repo policy: no auto-commit/merge to main).

---

## Definition of done

- [ ] `--sp-*` scale exists and is used by the tile grid + mode padding (F5).
- [ ] One consolidated `.piano-app` touch-reset; `user-select` killed globally with a text-field escape hatch (F1).
- [ ] `balancedColumns` helper unit-tested; menu + games set `--tile-cols`; Games no longer clumps; home still 5×2 (F3 / #3).
- [ ] `Skeleton` + `SkeletonPoster` primitive, reduced-motion aware, unit-tested (F4).
- [ ] Course wall renders poster skeletons while loading (F4 proof).
- [ ] Full PianoKiosk vitest suite green; `vite build` clean.
- [ ] Visual checks listed as pending-server (not claimed verified).
- [ ] Wave 0b (bespoke skeleton rollout + inline "Loading…" de-bypass) noted as follow-on.
