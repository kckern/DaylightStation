# Fitness Chart Voice Memo Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the existing voice-memo FAB on the post-episode FitnessChart overlay so users can record a follow-up memo when the auto-prompt does not re-open.

**Architecture:** The voice-memo FAB at `FitnessPlayer.jsx:1575-1588` is gated on `playerMode === 'fullscreen'`, so it disappears when the chart overlay (rendered just above it at `FitnessPlayer.jsx:1569-1574`) is shown. The fix is to also render an FAB inside the `fitness-chart-overlay` block, gated on `fitnessSessionInstance?.isActive` only (governance lock already excludes this block via the existing `govStatus !== 'locked'` guard). Reuse the existing `.fitness-player__voice-memo-fab` SCSS class — its `position: absolute` works inside the chart overlay just as it does inside the player.

**Tech Stack:** React, existing `FitnessContext.openVoiceMemoCapture`, vitest + @testing-library/react.

---

## File Structure

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — add an FAB inside the existing `fitness-chart-overlay` block
- Create: `tests/isolated/modules/Fitness/FitnessChartVoiceMemoFab.test.jsx` — render-test that asserts the FAB appears when chart is shown + active session, and that clicking it calls `openVoiceMemoCapture`

**Why no SCSS file:** the existing class `.fitness-player__voice-memo-fab` (defined at `FitnessPlayer.scss:1715-1741`) is already `position: absolute; bottom: 6rem; right: 2rem; z-index: 100` — it positions relative to the nearest positioned ancestor. The `.fitness-chart-overlay` is `position: absolute` (verified at `FitnessPlayer.scss:1663`), so the FAB will dock to the chart overlay's bottom-right with no style changes. Verify visually in Task 3.

---

## Task 1: Render-test asserting FAB exists when chart overlay is active

**Files:**
- Create: `tests/isolated/modules/Fitness/FitnessChartVoiceMemoFab.test.jsx`

This test mounts only the relevant slice of the FitnessPlayer. Since FitnessPlayer is huge, we test by rendering a stand-alone copy of the JSX block we plan to add. After the implementation lands in Task 2, we re-point the test to the actual export — but for now this drives the design.

Actually — simpler: write the test against `FitnessPlayer` directly using existing harness mocks. Look at `tests/isolated/modules/Fitness/FitnessSidebarMenuTimeout.test.jsx` for the established mocking pattern (it stubs `FitnessContext`, `api.mjs`, etc.). Mounting the full `FitnessPlayer` requires extensive mocking.

Pragmatic alternative: extract the chart overlay's FAB into a tiny dedicated component `FitnessChartVoiceMemoFab` so the test surface is small. Implementation will then import that component into `FitnessPlayer.jsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/modules/Fitness/FitnessChartVoiceMemoFab.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import FitnessChartVoiceMemoFab from '@/modules/Fitness/player/FitnessChartVoiceMemoFab.jsx';

afterEach(() => cleanup());

describe('FitnessChartVoiceMemoFab', () => {
  it('renders a button with an aria-label when sessionActive is true', () => {
    const { getByLabelText } = render(
      <FitnessChartVoiceMemoFab sessionActive onRecord={() => {}} />
    );
    expect(getByLabelText('Record voice memo')).toBeTruthy();
  });

  it('renders nothing when sessionActive is false', () => {
    const { queryByLabelText } = render(
      <FitnessChartVoiceMemoFab sessionActive={false} onRecord={() => {}} />
    );
    expect(queryByLabelText('Record voice memo')).toBeNull();
  });

  it('calls onRecord when the button is clicked', () => {
    const handler = vi.fn();
    const { getByLabelText } = render(
      <FitnessChartVoiceMemoFab sessionActive onRecord={handler} />
    );
    fireEvent.click(getByLabelText('Record voice memo'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (file does not yet exist)**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/FitnessChartVoiceMemoFab.test.jsx`

Expected: FAIL with module-not-found for `FitnessChartVoiceMemoFab.jsx`.

- [ ] **Step 3: Commit failing test**

```bash
git add tests/isolated/modules/Fitness/FitnessChartVoiceMemoFab.test.jsx
git commit -m "test(fitness): failing render test for chart-overlay voice memo FAB"
```

---

## Task 2: Implement the FAB component + wire into FitnessPlayer

**Files:**
- Create: `frontend/src/modules/Fitness/player/FitnessChartVoiceMemoFab.jsx`
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:1569-1574`

- [ ] **Step 1: Create the FAB component**

Create `frontend/src/modules/Fitness/player/FitnessChartVoiceMemoFab.jsx`:

```jsx
import React from 'react';

const FitnessChartVoiceMemoFab = ({ sessionActive, onRecord }) => {
  if (!sessionActive) return null;
  return (
    <button
      type="button"
      className="fitness-player__voice-memo-fab"
      onClick={onRecord}
      aria-label="Record voice memo"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  );
};

export default FitnessChartVoiceMemoFab;
```

The SVG matches the player's existing FAB icon at `FitnessPlayer.jsx:1582-1586` so the affordance is recognizable across both surfaces.

- [ ] **Step 2: Run test to confirm it passes**

Run: `./frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/FitnessChartVoiceMemoFab.test.jsx`

Expected: all 3 tests PASS.

- [ ] **Step 3: Wire the FAB into FitnessPlayer's chart overlay block**

Edit `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:1569-1574`. Replace:

```jsx
      {showChart && govStatus !== 'locked' && govStatus !== 'pending' && (
        <div className="fitness-chart-overlay">
          <FitnessChartBackButton onReturn={() => setShowChart(false)} />
          <FitnessChart mode="sidebar" onClose={() => {}} />
        </div>
      )}
```

with:

```jsx
      {showChart && govStatus !== 'locked' && govStatus !== 'pending' && (
        <div className="fitness-chart-overlay">
          <FitnessChartBackButton onReturn={() => setShowChart(false)} />
          <FitnessChart mode="sidebar" onClose={() => {}} />
          <FitnessChartVoiceMemoFab
            sessionActive={Boolean(fitnessSessionInstance?.isActive)}
            onRecord={() => openVoiceMemoCapture?.(null)}
          />
        </div>
      )}
```

Then add the import at the top of the file (near the other player-folder imports — find `import FitnessChartBackButton from './FitnessChartBackButton.jsx';` at L16 and add the new import directly below):

```jsx
import FitnessChartVoiceMemoFab from './FitnessChartVoiceMemoFab.jsx';
```

Both `fitnessSessionInstance` and `openVoiceMemoCapture` are already destructured from the context in this file — verify before committing by grepping:

```bash
grep -n "fitnessSessionInstance\|openVoiceMemoCapture" frontend/src/modules/Fitness/player/FitnessPlayer.jsx | head -10
```

Expected: both names already appear as destructured context values used by the existing fullscreen FAB at L1575-1588. **If either is missing**, add it to the existing context destructure (`const { ... } = useFitnessContext()` block) — do **not** introduce a new context call.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessChartVoiceMemoFab.jsx frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): show voice memo FAB on chart overlay"
```

---

## Task 3: Manual UI verification

**Files:** none (in-browser check)

Per CLAUDE.md ("For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete"), this task is mandatory.

- [ ] **Step 1: Confirm dev server is running**

```bash
ss -tlnp | grep -E '3111|3112' || npm run dev
```

If nothing listening on 3111/3112, start the dev server (kckern-server uses 3112; check `.claude/settings.local.json` env). Tail `dev.log` for errors.

- [ ] **Step 2: Open the fitness app and trigger the chart overlay**

Browser → `http://localhost:3112/fitness` (or whichever port `.claude/settings.local.json` shows).

Either:

(a) Wait for an episode to end naturally and the chart to appear, OR
(b) Use simulation: append `?simulate=...` per `useFitnessUrlParams.js` semantics, OR
(c) Manually click the chart toggle in the player (FitnessSidebar's chart button) to flip `showChart` true.

- [ ] **Step 3: Confirm the FAB is visible bottom-right of the chart overlay**

Visual check: small circular semi-transparent button with a microphone icon, positioned `bottom: 6rem; right: 2rem` over the chart.

If positioning looks wrong (clipped, overlapping the back button, behind the chart) — investigate `.fitness-chart-overlay`'s z-index stacking. **Do not** fix by patching the FAB component; instead add a `.fitness-chart-overlay .fitness-player__voice-memo-fab { ... }` selector in `FitnessPlayer.scss` near the existing `.fitness-chart-overlay` block to override the position only for the chart context. Document the override.

- [ ] **Step 4: Tap the FAB and confirm `VoiceMemoOverlay` opens in capture mode**

The capture overlay should appear (rendered globally via `FitnessApp.jsx:1336-1349`). Confirm the mic indicator activates.

- [ ] **Step 5: Record + save a memo, then verify it lands in the active session**

After save, the chart should still be visible. Inspect the active session's voice memo count via `window.__fitnessSession?.getMemoryStats?.()` in the browser console — the `voiceMemoCount` should have incremented.

If any of Steps 3-5 fail, do not mark the plan complete. Note the exact failure mode and pause.

- [ ] **Step 6: Commit any necessary CSS overrides surfaced in Step 3**

If no overrides were needed, skip this step. Otherwise:

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.scss
git commit -m "style(fitness): adjust chart-overlay voice memo FAB positioning"
```

---

## Self-review

- [x] **Spec coverage:** Bug write-up `2026-05-01-fitness-chart-missing-voice-memo-button.md` requires (a) a record button on the chart overlay, (b) calls `openVoiceMemoCapture(null)`, (c) gated only on session active. Tasks 2-3 deliver all three.
- [x] **Placeholder scan:** No TBDs, every step is concrete.
- [x] **Type consistency:** Component prop names (`sessionActive`, `onRecord`) used consistently in component, test, and call site.
- [x] **DRY:** SVG icon path is duplicated from `FitnessPlayer.jsx:1582-1586` rather than shared from a constant. The bug doc explicitly asks for the FAB to "use the same look as the existing player FAB so the user recognizes it" — keeping a literal copy is acceptable because they are deliberately twins. If a future task introduces a third surface, factor the SVG out at that point.
- [x] **YAGNI:** No counter, no tooltip, no "memo count" affordance — those are scope-creep and explicitly listed as stretch in the bug doc.
- [x] **Bug doc directly mentions an alternative implementation (option 2 — embedded in FitnessChart).** Plan picks option 1 (separate component used inside the overlay) because it's simpler, isolated, and doesn't bloat FitnessChart.
