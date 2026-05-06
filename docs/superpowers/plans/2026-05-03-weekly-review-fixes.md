# WeeklyReview Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three P0s and the most impactful P1s in `frontend/src/modules/WeeklyReview/` identified by `docs/_wip/audits/2026-05-03-weekly-review-ui-audit.md` — restore keyboard navigation, restore the visible VU meter, and make the UI usable end-to-end.

**Architecture:** Pure-frontend changes inside one module. Listener relocation (container → document with active-screen guard), CSS deduplication, two `useReducer` consolidations, A11y/focus-trap additions, performance fix for the VU meter (state → ref + DOM update). No backend or API changes.

**Tech Stack:** React 18, SCSS, Vitest (`useAudioRecorder.test.js` pattern), Playwright (`tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs`), happy-dom + @testing-library/react.

**Out of scope (deferred to a separate cleanup plan):** P2 items 1-65 in the audit — utility extraction (WMO icons, time formatters), base64-vs-multipart finalize, AudioWorklet file separation, MediaRecorder fallback (mp4), dead `MiniVideoPlayer` transport, Plex thumb cache buster, error boundaries, IndexedDB wrapper choice. Those add up to a large code-quality pass that should land independently.

**Test commands** (verify these resolve before starting):
- Vitest: `npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js`
- Playwright: `npx playwright test tests/live/flow/weekly-review/ --reporter=line`
- Dev server: `lsof -i :3112` (kckern-server) — start with `node backend/index.js` if not running

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/modules/WeeklyReview/WeeklyReview.scss` | Modify | Strip duplicate `.vu-meter` rule; add focus-visible; reduced-motion; z-index fix |
| `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` | Modify | Listener → document; reducers for view+modal state; ARIA; remove duplicate Stop button; new keymap |
| `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx` | Modify | Drop the inline Stop button; ref-driven VU meter; aria-labels |
| `frontend/src/modules/WeeklyReview/components/DayColumn.jsx` | Modify | Add role/tabIndex/onKeyDown |
| `frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx` | Modify | role=dialog, aria-modal, aria-labelledby |
| `frontend/src/modules/WeeklyReview/state/viewReducer.js` | Create | Pure reducer for `{viewLevel, dayIndex, imageIndex, focusRow}` |
| `frontend/src/modules/WeeklyReview/state/viewReducer.test.js` | Create | Vitest unit tests for the reducer |
| `frontend/src/modules/WeeklyReview/state/modalReducer.js` | Create | Pure reducer for `currentModal` state |
| `frontend/src/modules/WeeklyReview/state/modalReducer.test.js` | Create | Vitest unit tests for the modal reducer |
| `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js` | Modify | `getUserMedia` voice constraints |
| `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs` | Modify | Update keymap expectations (Enter opens day; ArrowLeft/Right moves selection without entering) |
| `tests/live/flow/weekly-review/weekly-review-vu-meter.runtime.test.mjs` | Create | Asserts `.vu-bar` elements lay out horizontally |
| `tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs` | Create | Asserts overlays have role=dialog, focus-trap behavior |

---

## Task 1: Fix the VU Meter (P0-2)

The duplicate `.vu-meter { display: inline-block }` rule at line 1166 overrides `display: flex` at line 453. Children (`.vu-bar`) stack vertically and the meter visually collapses.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss:1166-1170` and `:453-458`
- Create: `tests/live/flow/weekly-review/weekly-review-vu-meter.runtime.test.mjs`

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/live/flow/weekly-review/weekly-review-vu-meter.runtime.test.mjs`:

```javascript
// Asserts the recording-bar VU meter renders horizontally — the failure mode
// is `display: inline-block` from a later SCSS rule causing children to stack.
import { test, expect } from '@playwright/test';
import { APP_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Weekly Review VU meter', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class FakeWS {
        constructor() {
          this.binaryType = 'arraybuffer';
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ sampleRate: 48000 }) });
            const buf = new ArrayBuffer(2048);
            const view = new Int16Array(buf);
            for (let i = 0; i < view.length; i++) view[i] = (i % 2) ? 8000 : -8000;
            this.onmessage?.({ data: buf });
          }, 50);
        }
        send() {}
        close() {}
      }
      window.WebSocket = FakeWS;
    });
  });

  test('VU meter children lay out horizontally and are wider than tall', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    const meter = page.locator('.vu-meter');
    await expect(meter).toBeVisible();

    // The meter must be a flex container — inline-block is the failure mode.
    const display = await meter.evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('flex');

    // Children must lay out side-by-side: meter width must be much greater than its height.
    const meterBox = await meter.boundingBox();
    expect(meterBox.width).toBeGreaterThan(meterBox.height * 3);

    // At least one bar must have non-zero width.
    const bars = page.locator('.vu-bar');
    expect(await bars.count()).toBe(20);
    const firstBar = await bars.first().boundingBox();
    expect(firstBar.width).toBeGreaterThan(0);
    expect(firstBar.height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-vu-meter.runtime.test.mjs --reporter=line`

Expected: FAIL — `display` is `'inline-block'` not `'flex'`, OR meter width is not >3× its height.

- [ ] **Step 3: Fix the SCSS**

In `frontend/src/modules/WeeklyReview/WeeklyReview.scss`, replace the Task 18 block at lines 1166-1170:

```scss
.vu-meter {
  display: inline-block;
  width: 8rem;
  flex-shrink: 0;
}
```

with:

```scss
.vu-meter {
  // Width pinned for stable layout; do NOT redeclare display (see :453).
  width: 8rem;
  flex-shrink: 0;
}
```

(Keeping `width: 8rem; flex-shrink: 0` while leaving `display: flex` from the original rule intact.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-vu-meter.runtime.test.mjs --reporter=line`

Expected: PASS.

- [ ] **Step 5: Manual visual check**

Open the dev server in a browser (`http://localhost:3112/app/weekly-review` on kckern-server). Once preflight clears, the VU meter at the bottom should render as 20 thin vertical bars side-by-side (4px each, 2px gap, 20px tall), filling green when voice is detected. If it looks like a single thin column or empty space, the fix didn't take.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.scss \
        tests/live/flow/weekly-review/weekly-review-vu-meter.runtime.test.mjs
git commit -m "fix(weekly-review): restore VU meter layout — drop duplicate display:inline-block"
```

---

## Task 2: Move Keydown Listener to Document (P0-1)

Bind keydown to `document` instead of the container `<div>`, so arrow keys work regardless of which child has focus.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx:339-540`

- [ ] **Step 1: Write the failing Playwright test**

Append to `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs` (inside the `describe`):

```javascript
test('arrow keys still work after a child element receives focus', async ({ page }) => {
  await page.goto(`${APP_URL}/app/weekly-review`);
  await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
  await expect(page.locator('.weekly-review-grid')).toBeVisible();

  // Steal focus by clicking somewhere inside the widget that ISN'T the container.
  // The Save Recording button is always present in the bar.
  await page.locator('.recording-bar__save').click({ trial: false }).catch(() => {});
  // (Click may activate the button via onClick — that's fine; we're testing keydown
  // routing, not the click outcome. Dismiss any modal that opens.)
  await page.keyboard.press('Escape').catch(() => {});

  // Arrow Right must still navigate to a day, even though focus is no longer on
  // the .weekly-review container.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs --reporter=line --grep "arrow keys still work"`

Expected: FAIL — arrow press has no effect after focus moves.

- [ ] **Step 3: Update the listener attachment**

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`, replace lines 531-535:

```jsx
    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
```

with:

```jsx
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
```

Also delete lines 538-540:

```jsx
  useEffect(() => {
    containerRef.current?.focus();
  }, [loading]);
```

— it's no longer needed. (Container focus handling is replaced by ARIA dialog focus management in Task 9.)

And remove `tabIndex={0}` and `ref={containerRef}` from the root div at line 599 if they're no longer used elsewhere. But **check first** — `menuNav.setPopGuard` and other code may still reference `containerRef`. Search for `containerRef` in the file; if it's only used by the deleted effect, delete the ref declaration at line 42 too. Otherwise leave it.

Run: `grep -n containerRef frontend/src/modules/WeeklyReview/WeeklyReview.jsx`. If the only matches are the declaration (line 42), the JSX `ref={containerRef}` (line 599), and the deleted effect, then drop all three.

- [ ] **Step 4: Add a screen-active guard**

The listener now fires globally. We must ignore events when WeeklyReview isn't the active screen. At the top of `handleKeyDown`, before any logic, add:

```jsx
const handleKeyDown = (e) => {
  // Ignore keys when an input/textarea has focus, or when this widget isn't
  // the active screen (preflight not cleared and bootstrap done).
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!data?.days) return;
  // ... rest of existing handler
};
```

(The existing `if (!data?.days) return;` at line 341 stays — both checks compose.)

- [ ] **Step 5: Add a visible :focus-visible style**

The container's `outline: none` (line 9 of SCSS) was masking focus loss. Since we no longer rely on container focus, remove the `outline: none` and add `:focus-visible` styling for buttons. In `frontend/src/modules/WeeklyReview/WeeklyReview.scss` at line 9:

```scss
.weekly-review {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  color: #e0e0e0;
  overflow: hidden;
  // outline removed — see button :focus-visible rules below
}
```

Add a global `:focus-visible` rule near the top of the file (after the `.weekly-review` block):

```scss
.weekly-review button:focus-visible,
.weekly-review [role="button"]:focus-visible {
  outline: 3px solid #ffeb3b;
  outline-offset: 2px;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs --reporter=line`

Expected: All tests pass, including the new "arrow keys still work after focus" test.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx \
        frontend/src/modules/WeeklyReview/WeeklyReview.scss \
        tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs
git commit -m "fix(weekly-review): bind keydown to document so arrow keys survive focus changes"
```

---

## Task 3: Remove the Duplicate Stop Button and Save-Pulse (P0-3, part 1)

The bar has two competing stop affordances: a small grey `■ Stop` and a giant pulsing yellow `■ Save Recording`. Keep the latter; drop the former. Also kill the `save-pulse` animation — visual noise during a meditative review.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx:73-83`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss:480-507` (delete `.recording-start-btn`, `.recording-stop-btn`)
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss:994-1010` (delete `save-pulse`)

- [ ] **Step 1: Write the failing Playwright test**

Append to `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs`:

```javascript
test('recording bar shows exactly one stop affordance during recording', async ({ page }) => {
  await page.goto(`${APP_URL}/app/weekly-review`);
  await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

  // While recording: the small Stop button must NOT be present; only the Save Recording button.
  await expect(page.locator('.recording-stop-btn')).toHaveCount(0);
  await expect(page.locator('.recording-bar__save')).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs --reporter=line --grep "exactly one stop"`

Expected: FAIL — `.recording-stop-btn` still rendered while recording.

- [ ] **Step 3: Remove the duplicate button from RecordingBar.jsx**

In `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`, delete lines 73-83:

```jsx
        {uploading ? (
          <span className="uploading-status">Transcribing...</span>
        ) : isRecording ? (
          <button className="recording-stop-btn" onClick={onStop}>
            ■ Stop
          </button>
        ) : (
          <button className="recording-start-btn" onClick={onStart}>
            ● Record
          </button>
        )}
```

Replace with:

```jsx
        {uploading && <span className="uploading-status">Transcribing...</span>}
```

Also remove the now-unused `onStart` and `onStop` props from the destructured signature (lines 18-19) and from the parent JSX in `WeeklyReview.jsx:726-727`.

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx:715-737`, remove these props from `<RecordingBar ...>`:

```jsx
        onStart={() => { logger.info('recording.manual-start'); startRecording(); }}
        onStop={() => { logger.info('recording.manual-stop'); setShowStopConfirm(true); }}
```

- [ ] **Step 4: Remove the dead SCSS**

In `frontend/src/modules/WeeklyReview/WeeklyReview.scss`, delete lines 480-507 (`.recording-start-btn`, `.recording-stop-btn` and their hover rules).

- [ ] **Step 5: Kill save-pulse**

In `frontend/src/modules/WeeklyReview/WeeklyReview.scss`, delete lines 994-997:

```scss
  &.can-save:not(.focused) {
    box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.8);
    animation: save-pulse 2.5s ease-in-out infinite;
  }
```

And delete the `@keyframes save-pulse` block at lines 1007-1010:

```scss
@keyframes save-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.4); }
  50%      { box-shadow: 0 0 0 8px rgba(46, 125, 50, 0); }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs --reporter=line`

Expected: All tests pass.

- [ ] **Step 7: Manual visual check**

Reload the dev server. The bar should show: week label, mic indicator, recording dot, timer, VU meter, sync badge, then the green Save Recording button. The button should NOT pulse when idle. No second small "Stop" button anywhere.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/RecordingBar.jsx \
        frontend/src/modules/WeeklyReview/WeeklyReview.jsx \
        frontend/src/modules/WeeklyReview/WeeklyReview.scss \
        tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs
git commit -m "fix(weekly-review): one stop affordance — drop duplicate Stop button and save-pulse"
```

---

## Task 4: Fix Enter Semantics (P0-3, part 2)

Currently Enter at TOC = "upload finalize while recording continues". Users expect Enter = "open the focused day". Re-bind Enter accordingly. Move the upload affordance to a dedicated key (PageDown — never used elsewhere in this app per the audit) or move it behind the existing Save Recording button only.

Decision: **Enter at TOC opens the focused day. Upload-while-recording is removed entirely** (the user can finalize via the Save Recording button at any time, which already does the right thing for "I'm done"). The audit calls Enter-as-upload "an opaque server upload"; nobody asked for it.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx:84-117` (delete `onEnterUpload`), `:425-431` (rebind Enter)
- Modify: `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs` (existing test asserts `ArrowRight → day-detail`; no change needed there, but add a new assertion)

- [ ] **Step 1: Write the failing Playwright test**

Append to `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs`:

```javascript
test('Enter at TOC opens the focused day', async ({ page }) => {
  await page.goto(`${APP_URL}/app/weekly-review`);
  await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
  await expect(page.locator('.weekly-review-grid')).toBeVisible();

  // Move selection without entering (this requires the keymap fix in Task 7;
  // for now ArrowRight may already enter day view — that's fine for THIS test).
  // Press Enter on whatever day is currently focused.
  await page.keyboard.press('Enter');
  await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Run the test to verify it fails (or trace why it doesn't)**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs --reporter=line --grep "Enter at TOC opens"`

Expected: FAIL — Enter currently triggers `onEnterUpload`, no day-detail.

- [ ] **Step 3: Delete `onEnterUpload` from WeeklyReview.jsx**

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`, delete the entire `onEnterUpload` callback at lines 84-117 (the `useCallback` block ending with `}, [data?.week, recordingDuration, ...])`).

Also delete the related state at line 28 (`const [uploadInFlight, setUploadInFlight] = useState(false);`) and the ref at line 29 (`const lastUploadAtRef = useRef(0);`) IF a grep confirms they're only referenced inside the deleted block.

Run: `grep -n -E '(uploadInFlight|lastUploadAtRef|onEnterUpload)' frontend/src/modules/WeeklyReview/WeeklyReview.jsx`. Anything outside the deleted block must be cleaned up too — likely the `<RecordingBar uploadInFlight={uploadInFlight} />` prop at line 722 (delete that line) and the pop-guard at line 553 and 566 (replace `uploadInFlight` references with hardcoded `false` for now; Task 5 will revisit). Specifically:
- Line 553: `if (!isRecording && !uploadInFlight)` → `if (!isRecording)`
- Line 566: `if (uploadInFlight) return false;` → delete this whole line.

Also remove `uploadInFlight` from the dependency array at line 577.

- [ ] **Step 4: Rebind Enter at TOC level to "open focused day"**

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`, locate the main hierarchy block around line 425. Replace lines 425-431:

```jsx
      // ---- Main hierarchy: Enter = upload, Back = climb ----
      if (isEnter) {
        e.preventDefault();
        e.stopPropagation();
        onEnterUpload();
        return;
      }
```

with:

```jsx
      // ---- Main hierarchy: Enter = activate focused item, Back = climb ----
      if (isEnter) {
        if (viewLevel === 'toc') {
          e.preventDefault();
          e.stopPropagation();
          setViewLevel('day');
          return;
        }
        if (viewLevel === 'day') {
          // Enter at day view: open fullscreen if photos exist; otherwise no-op.
          const photos = data.days[dayIndex]?.photos || [];
          if (photos.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            setImageIndex(0);
            setViewLevel('fullscreen');
          }
          return;
        }
        // Fullscreen: Enter is a no-op (use Esc to back out, arrows to navigate).
        return;
      }
```

- [ ] **Step 5: Remove `uploadInFlight` from RecordingBar.jsx**

In `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`, remove `uploadInFlight` from the destructured props (line 27) and delete the JSX that renders the `Uploading…` flash (line 95):

```jsx
        {uploadInFlight && <span className="upload-flash">Uploading…</span>}
```

Delete `.upload-flash` and `@keyframes upload-flash-fade` from `WeeklyReview.scss:1117-1127`. Delete the Task 18 `.upload-flash` rule at lines 1160-1164.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs --reporter=line`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx \
        frontend/src/modules/WeeklyReview/components/RecordingBar.jsx \
        frontend/src/modules/WeeklyReview/WeeklyReview.scss \
        tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs
git commit -m "fix(weekly-review): Enter opens day; remove opaque upload-while-recording path"
```

---

## Task 5: Extract a Modal Reducer (P1-1)

Replace eight independent overlay flags (`showStopConfirm`, `confirmFocus`, `resumeDraft`, `finalizeError`, `errorFocus`, `disconnectModal`, `preflightFailed`, `preflightFocus`) with a single `currentModal: { type, focusIndex, payload }` reducer.

**Files:**
- Create: `frontend/src/modules/WeeklyReview/state/modalReducer.js`
- Create: `frontend/src/modules/WeeklyReview/state/modalReducer.test.js`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (consume reducer)

- [ ] **Step 1: Write failing reducer tests**

Create `frontend/src/modules/WeeklyReview/state/modalReducer.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { modalReducer, initialModalState, OVERLAY_PRIORITY } from './modalReducer.js';

describe('modalReducer', () => {
  it('starts with no modal', () => {
    expect(initialModalState).toEqual({ type: null, focusIndex: 0, payload: null });
  });

  it('opens stop-confirm modal', () => {
    const next = modalReducer(initialModalState, { type: 'OPEN', modal: 'stopConfirm' });
    expect(next.type).toBe('stopConfirm');
    expect(next.focusIndex).toBe(0);
  });

  it('closes any modal back to null', () => {
    const open = { type: 'finalizeError', focusIndex: 1, payload: 'oops' };
    expect(modalReducer(open, { type: 'CLOSE' })).toEqual(initialModalState);
  });

  it('toggles focus index 0 ↔ 1', () => {
    const a = { type: 'stopConfirm', focusIndex: 0, payload: null };
    const b = modalReducer(a, { type: 'TOGGLE_FOCUS' });
    expect(b.focusIndex).toBe(1);
    const c = modalReducer(b, { type: 'TOGGLE_FOCUS' });
    expect(c.focusIndex).toBe(0);
  });

  it('refuses to open a lower-priority modal over a higher-priority one', () => {
    // Priority order: preflightFailed > disconnect > finalizeError > stopConfirm > resumeDraft
    expect(OVERLAY_PRIORITY.preflightFailed).toBeGreaterThan(OVERLAY_PRIORITY.stopConfirm);
    const high = { type: 'preflightFailed', focusIndex: 0, payload: null };
    const next = modalReducer(high, { type: 'OPEN', modal: 'stopConfirm' });
    expect(next.type).toBe('preflightFailed'); // unchanged
  });

  it('allows higher-priority modal to replace lower-priority one', () => {
    const low = { type: 'stopConfirm', focusIndex: 0, payload: null };
    const next = modalReducer(low, { type: 'OPEN', modal: 'preflightFailed' });
    expect(next.type).toBe('preflightFailed');
  });

  it('OPEN with payload sets payload', () => {
    const next = modalReducer(initialModalState, {
      type: 'OPEN', modal: 'finalizeError', payload: 'network down',
    });
    expect(next.payload).toBe('network down');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/modalReducer.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the reducer**

Create `frontend/src/modules/WeeklyReview/state/modalReducer.js`:

```javascript
// Priority: higher = more blocking. A higher-priority modal cannot be displaced
// by an OPEN of a lower-priority one (the existing flag-based code relied on the
// keyboard handler's order; making it explicit here removes the foot-gun).
export const OVERLAY_PRIORITY = {
  preflightFailed: 100,
  disconnect:      90,
  finalizeError:   80,
  stopConfirm:     70,
  resumeDraft:     60,
};

export const initialModalState = { type: null, focusIndex: 0, payload: null };

export function modalReducer(state, action) {
  switch (action.type) {
    case 'OPEN': {
      const incoming = action.modal;
      const incomingPriority = OVERLAY_PRIORITY[incoming] ?? 0;
      const currentPriority = OVERLAY_PRIORITY[state.type] ?? 0;
      if (state.type && incomingPriority < currentPriority) return state;
      return {
        type: incoming,
        focusIndex: 0,
        payload: action.payload ?? null,
      };
    }
    case 'CLOSE':
      return initialModalState;
    case 'TOGGLE_FOCUS':
      return { ...state, focusIndex: state.focusIndex === 0 ? 1 : 0 };
    case 'SET_FOCUS':
      return { ...state, focusIndex: action.index };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/modalReducer.test.js`

Expected: 7 tests passing.

- [ ] **Step 5: Wire the reducer into WeeklyReview.jsx**

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`:

1. Add the import at the top (after existing imports):

```jsx
import { modalReducer, initialModalState } from './state/modalReducer.js';
```

2. Replace the eight modal-related useState calls (lines 23-27, 36-40) with one reducer:

```jsx
const [modal, dispatchModal] = React.useReducer(modalReducer, initialModalState);
```

3. Replace **every read** of the old flags with reads of `modal.type` and `modal.focusIndex`:

| Old | New |
|---|---|
| `showStopConfirm` | `modal.type === 'stopConfirm'` |
| `confirmFocus` | `modal.focusIndex` (when type === 'stopConfirm') |
| `resumeDraft` | `modal.type === 'resumeDraft' ? modal.payload : null` |
| `finalizeError` | `modal.type === 'finalizeError' ? modal.payload : null` |
| `errorFocus` | `modal.focusIndex` (when type === 'finalizeError') |
| `disconnectModal` | `modal.type === 'disconnect' ? modal.payload : null` |
| `preflightFailed` | `modal.type === 'preflightFailed'` |
| `preflightFocus` | `modal.focusIndex` (when type === 'preflightFailed') |

4. Replace **every write** with reducer dispatches:

| Old | New |
|---|---|
| `setShowStopConfirm(true)` | `dispatchModal({ type: 'OPEN', modal: 'stopConfirm' })` |
| `setShowStopConfirm(false)` | `dispatchModal({ type: 'CLOSE' })` |
| `setConfirmFocus(prev => ...)` | `dispatchModal({ type: 'TOGGLE_FOCUS' })` (if 0↔1) |
| `setConfirmFocus(0)` | `dispatchModal({ type: 'SET_FOCUS', index: 0 })` |
| `setResumeDraft({...})` | `dispatchModal({ type: 'OPEN', modal: 'resumeDraft', payload: {...} })` |
| `setResumeDraft(null)` | `dispatchModal({ type: 'CLOSE' })` |
| `setFinalizeError(msg)` | `dispatchModal({ type: 'OPEN', modal: 'finalizeError', payload: msg })` |
| `setFinalizeError(null)` | `dispatchModal({ type: 'CLOSE' })` |
| `setErrorFocus(prev => ...)` | `dispatchModal({ type: 'TOGGLE_FOCUS' })` |
| `setDisconnectModal({phase})` | `dispatchModal({ type: 'OPEN', modal: 'disconnect', payload: {phase} })` |
| `setDisconnectModal(null)` | `dispatchModal({ type: 'CLOSE' })` |
| `setPreflightFailed(true)` | `dispatchModal({ type: 'OPEN', modal: 'preflightFailed' })` |
| `setPreflightFailed(false)` | `dispatchModal({ type: 'CLOSE' })` |
| `setPreflightFocus(prev => ...)` | `dispatchModal({ type: 'TOGGLE_FOCUS' })` |

5. The keyboard handler had eight overlay branches. Collapse them to one switch:

Replace the block at lines 348-412 (the six `if (overlayFlag)` blocks) with:

```jsx
      // ---- Modal handling: any open modal swallows main keys ----
      if (modal.type) {
        if (modal.type === 'disconnect') { e.preventDefault(); return; }
        if (isBack) {
          e.preventDefault();
          if (modal.type === 'resumeDraft') return;       // resume requires explicit action
          if (modal.type === 'preflightFailed') { onExitWidget(); return; }
          dispatchModal({ type: 'CLOSE' });
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          // resumeDraft has only one button; no toggle.
          if (modal.type !== 'resumeDraft') dispatchModal({ type: 'TOGGLE_FOCUS' });
          return;
        }
        if (isEnter) {
          e.preventDefault();
          if (modal.type === 'stopConfirm') {
            if (modal.focusIndex === 0) dispatchModal({ type: 'CLOSE' });
            else { dispatchModal({ type: 'CLOSE' }); onSaveAndExit(); }
            return;
          }
          if (modal.type === 'finalizeError') {
            if (modal.focusIndex === 0) { dispatchModal({ type: 'CLOSE' }); /* retry handled by caller */ }
            else { dispatchModal({ type: 'CLOSE' }); onExitWidget(); }
            return;
          }
          if (modal.type === 'preflightFailed') {
            if (modal.focusIndex === 0) onPreflightRetry();
            else onPreflightExit();
            return;
          }
          if (modal.type === 'resumeDraft') {
            finalizePriorDraft();
            return;
          }
        }
        return;
      }

      // (preflight 'acquiring' is handled differently — see below)
      if (preflightStatus === 'acquiring') {
        if (isBack) { e.preventDefault(); onExitWidget(); }
        return;
      }
```

(The `preflightStatus === 'acquiring'` branch stays separate because it's a transient pre-modal gate, not a modal in the reducer.)

6. Update the dependency array at line 536 to drop the eight individual flags and add `modal`. The new deps should be:

```jsx
}, [data, viewLevel, dayIndex, imageIndex, focusRow, modal,
    finalizePriorDraft, onExitWidget, onSaveAndExit,
    onPreflightRetry, onPreflightExit, onBackPressed, preflightStatus]);
```

7. Update the JSX overlay rendering (lines 600-701) to read from `modal`:

```jsx
{modal.type === 'resumeDraft' && !isRecording && (
  <div className="weekly-review-confirm-overlay">
    {/* ...same content, replace `resumeDraft.X` with `modal.payload.X` */}
  </div>
)}

{modal.type === 'finalizeError' && !isRecording && (
  <div className="weekly-review-confirm-overlay">
    {/* ... `errorFocus === 0` → `modal.focusIndex === 0`, `finalizeError` → `modal.payload` */}
  </div>
)}

{modal.type === 'stopConfirm' && (
  <div className="weekly-review-confirm-overlay">
    {/* ... `confirmFocus === 0` → `modal.focusIndex === 0` */}
  </div>
)}

{modal.type === 'disconnect' && (
  <div className="weekly-review-confirm-overlay">
    {modal.payload?.phase === 'reconnecting' && /* ... */}
  </div>
)}
```

The `<PreFlightOverlay>` at line 703 should now read `status` from a memoized derivation:

```jsx
const preflightStatus = modal.type === 'preflightFailed'
  ? 'failed'
  : (firstAudibleFrameSeen ? 'ok' : 'acquiring');
```

(Replaces the existing derivation at lines 66-68.)

- [ ] **Step 6: Run all WeeklyReview tests to verify nothing regressed**

Run:
```bash
npx vitest run frontend/src/modules/WeeklyReview/
npx playwright test tests/live/flow/weekly-review/ --reporter=line
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/state/modalReducer.js \
        frontend/src/modules/WeeklyReview/state/modalReducer.test.js \
        frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "refactor(weekly-review): consolidate 8 overlay flags into modalReducer"
```

---

## Task 6: Extract a View Reducer (P1-2)

Replace `viewLevel + dayIndex + imageIndex + focusRow` with a single reducer that owns view-state transitions.

**Files:**
- Create: `frontend/src/modules/WeeklyReview/state/viewReducer.js`
- Create: `frontend/src/modules/WeeklyReview/state/viewReducer.test.js`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

- [ ] **Step 1: Write failing reducer tests**

Create `frontend/src/modules/WeeklyReview/state/viewReducer.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { viewReducer, initialViewState, makeInitialView } from './viewReducer.js';

describe('viewReducer', () => {
  it('default state is TOC, focus on main, day 0, image 0', () => {
    expect(initialViewState).toEqual({
      level: 'toc', dayIndex: 0, imageIndex: 0, focusRow: 'main',
    });
  });

  it('makeInitialView clamps dayIndex to last day', () => {
    expect(makeInitialView(7)).toEqual({
      level: 'toc', dayIndex: 6, imageIndex: 0, focusRow: 'main',
    });
    expect(makeInitialView(0)).toEqual(initialViewState);
  });

  describe('SELECT_DAY', () => {
    it('moves selection within TOC without changing level', () => {
      const next = viewReducer(initialViewState, { type: 'SELECT_DAY', index: 3 });
      expect(next).toEqual({ level: 'toc', dayIndex: 3, imageIndex: 0, focusRow: 'main' });
    });

    it('clamps within [0, totalDays-1]', () => {
      const next = viewReducer(initialViewState, { type: 'SELECT_DAY', index: 99, totalDays: 7 });
      expect(next.dayIndex).toBe(6);
      const back = viewReducer(initialViewState, { type: 'SELECT_DAY', index: -5, totalDays: 7 });
      expect(back.dayIndex).toBe(0);
    });
  });

  describe('OPEN_DAY', () => {
    it('moves to day level at the current dayIndex', () => {
      const start = { level: 'toc', dayIndex: 4, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'OPEN_DAY' }))
        .toEqual({ level: 'day', dayIndex: 4, imageIndex: 0, focusRow: 'main' });
    });

    it('OPEN_DAY with index moves AND opens', () => {
      const start = { level: 'toc', dayIndex: 0, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'OPEN_DAY', index: 2 }))
        .toEqual({ level: 'day', dayIndex: 2, imageIndex: 0, focusRow: 'main' });
    });
  });

  describe('OPEN_PHOTO', () => {
    it('moves to fullscreen at index 0', () => {
      const start = { level: 'day', dayIndex: 2, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'OPEN_PHOTO' }).level).toBe('fullscreen');
      expect(viewReducer(start, { type: 'OPEN_PHOTO' }).imageIndex).toBe(0);
    });
  });

  describe('CYCLE_PHOTO', () => {
    it('cycles forward modulo totalPhotos', () => {
      const start = { level: 'fullscreen', dayIndex: 1, imageIndex: 4, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_PHOTO', delta: 1, totalPhotos: 5 }).imageIndex).toBe(0);
    });

    it('cycles backward modulo totalPhotos', () => {
      const start = { level: 'fullscreen', dayIndex: 1, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_PHOTO', delta: -1, totalPhotos: 5 }).imageIndex).toBe(4);
    });

    it('no-op when totalPhotos is 0', () => {
      const start = { level: 'fullscreen', dayIndex: 1, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_PHOTO', delta: 1, totalPhotos: 0 })).toEqual(start);
    });
  });

  describe('BACK', () => {
    it('fullscreen → day', () => {
      const start = { level: 'fullscreen', dayIndex: 2, imageIndex: 3, focusRow: 'main' };
      expect(viewReducer(start, { type: 'BACK' }).level).toBe('day');
    });
    it('day → toc', () => {
      const start = { level: 'day', dayIndex: 2, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'BACK' }).level).toBe('toc');
    });
    it('toc → toc (no-op; caller decides what to do)', () => {
      expect(viewReducer(initialViewState, { type: 'BACK' })).toEqual(initialViewState);
    });
    it('focusRow=bar → focusRow=main', () => {
      const start = { level: 'toc', dayIndex: 0, imageIndex: 0, focusRow: 'bar' };
      expect(viewReducer(start, { type: 'BACK' }).focusRow).toBe('main');
    });
  });

  describe('FOCUS_BAR / FOCUS_MAIN', () => {
    it('FOCUS_BAR sets focusRow=bar', () => {
      expect(viewReducer(initialViewState, { type: 'FOCUS_BAR' }).focusRow).toBe('bar');
    });
    it('FOCUS_MAIN sets focusRow=main', () => {
      const start = { ...initialViewState, focusRow: 'bar' };
      expect(viewReducer(start, { type: 'FOCUS_MAIN' }).focusRow).toBe('main');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/viewReducer.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the reducer**

Create `frontend/src/modules/WeeklyReview/state/viewReducer.js`:

```javascript
export const initialViewState = {
  level: 'toc',       // 'toc' | 'day' | 'fullscreen'
  dayIndex: 0,
  imageIndex: 0,
  focusRow: 'main',   // 'main' | 'bar'
};

export function makeInitialView(totalDays) {
  if (!totalDays || totalDays <= 0) return initialViewState;
  return { ...initialViewState, dayIndex: totalDays - 1 };
}

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function viewReducer(state, action) {
  switch (action.type) {
    case 'SELECT_DAY': {
      const totalDays = action.totalDays ?? Infinity;
      const dayIndex = clamp(action.index, 0, Math.max(0, totalDays - 1));
      return { ...state, dayIndex };
    }
    case 'OPEN_DAY': {
      const dayIndex = action.index !== undefined
        ? clamp(action.index, 0, Math.max(0, (action.totalDays ?? Infinity) - 1))
        : state.dayIndex;
      return { ...state, level: 'day', dayIndex, imageIndex: 0, focusRow: 'main' };
    }
    case 'OPEN_PHOTO':
      return { ...state, level: 'fullscreen', imageIndex: action.index ?? 0 };
    case 'CYCLE_PHOTO': {
      if (!action.totalPhotos || action.totalPhotos <= 0) return state;
      const next = (state.imageIndex + action.delta + action.totalPhotos) % action.totalPhotos;
      return { ...state, imageIndex: next };
    }
    case 'CYCLE_DAY': {
      const totalDays = action.totalDays ?? Infinity;
      const next = clamp(state.dayIndex + action.delta, 0, Math.max(0, totalDays - 1));
      return { ...state, dayIndex: next, imageIndex: 0 };
    }
    case 'BACK': {
      if (state.focusRow === 'bar') return { ...state, focusRow: 'main' };
      if (state.level === 'fullscreen') return { ...state, level: 'day' };
      if (state.level === 'day') return { ...state, level: 'toc' };
      return state;
    }
    case 'FOCUS_BAR':
      return { ...state, focusRow: 'bar' };
    case 'FOCUS_MAIN':
      return { ...state, focusRow: 'main' };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/viewReducer.test.js`

Expected: All ~14 tests passing.

- [ ] **Step 5: Wire the reducer into WeeklyReview.jsx**

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`:

1. Add import:

```jsx
import { viewReducer, initialViewState, makeInitialView } from './state/viewReducer.js';
```

2. Replace the four useState calls (lines 32-34, 37) with one reducer:

```jsx
const [view, dispatchView] = React.useReducer(viewReducer, initialViewState);
```

3. Update the bootstrap effect (line 156) — when data loads, initialize the view to the last day:

```jsx
const result = await DaylightAPI('/api/v1/weekly-review/bootstrap');
setData(result);
dispatchView({ type: 'SELECT_DAY', index: (result.days?.length || 1) - 1, totalDays: result.days?.length });
```

(Drop `setDayIndex(...)` from line 162.)

4. Replace every read of `viewLevel`, `dayIndex`, `imageIndex`, `focusRow` with `view.level`, `view.dayIndex`, `view.imageIndex`, `view.focusRow`. There are roughly 30 references; grep helps:

```bash
grep -n -E '\b(viewLevel|dayIndex|imageIndex|focusRow)\b' frontend/src/modules/WeeklyReview/WeeklyReview.jsx
```

5. Replace every write:

| Old | New |
|---|---|
| `setViewLevel('toc')` | `dispatchView({ type: 'BACK' })` (when transitioning from day) — **read carefully**: only use BACK for back-navigation. For "go to TOC" from arbitrary state use a new `RESET_TO_TOC` action or just `dispatch BACK` enough times. Easier: use the explicit OPEN paths instead. |
| `setViewLevel('day')` | `dispatchView({ type: 'OPEN_DAY' })` |
| `setViewLevel('fullscreen')` | `dispatchView({ type: 'OPEN_PHOTO', index: 0 })` |
| `setDayIndex(i)` | `dispatchView({ type: 'SELECT_DAY', index: i, totalDays: data.days?.length })` |
| `setDayIndex(prev => prev - 1)` | `dispatchView({ type: 'CYCLE_DAY', delta: -1, totalDays: data.days?.length })` |
| `setImageIndex(prev => (prev + 1) % photos.length)` | `dispatchView({ type: 'CYCLE_PHOTO', delta: 1, totalPhotos: photos.length })` |
| `setFocusRow('bar')` | `dispatchView({ type: 'FOCUS_BAR' })` |
| `setFocusRow('main')` | `dispatchView({ type: 'FOCUS_MAIN' })` |

6. The keyboard handler's main hierarchy logic (lines 425-528) collapses dramatically. Re-read after the rewrite to make sure each branch dispatches a single action where possible.

7. The pop-guard at lines 568-573 was using `viewLevelRef`. Replace it with reading from `view`:

```jsx
useEffect(() => {
  if (!menuNav?.setPopGuard) return;
  if (!isRecording) {
    menuNav.clearPopGuard();
    return;
  }
  menuNav.setPopGuard(() => {
    if (modal.type) { dispatchModal({ type: 'CLOSE' }); return false; }
    if (view.level === 'fullscreen') { dispatchView({ type: 'BACK' }); return false; }
    if (view.level === 'day')        { dispatchView({ type: 'BACK' }); return false; }
    dispatchModal({ type: 'OPEN', modal: 'stopConfirm' });
    return false;
  });
  return () => menuNav.clearPopGuard();
}, [isRecording, menuNav, modal.type, view.level]);
```

(Drop the three `useRef` mirrors at lines 544-549; they're no longer needed.)

- [ ] **Step 6: Run all tests**

Run:
```bash
npx vitest run frontend/src/modules/WeeklyReview/
npx playwright test tests/live/flow/weekly-review/ --reporter=line
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/state/viewReducer.js \
        frontend/src/modules/WeeklyReview/state/viewReducer.test.js \
        frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "refactor(weekly-review): viewReducer replaces 4-tuple of useStates"
```

---

## Task 7: Sane Keymap (P1-3)

Drop `Space === Enter` and `Backspace === Escape`. Make ArrowLeft/Right at TOC move selection (without entering). Standard idioms only.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (handler)
- Modify: `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs` (existing test asserts ArrowRight at TOC opens day; that becomes wrong)

- [ ] **Step 1: Update the existing Playwright test**

The current test at line 47-49 asserts `ArrowRight` at TOC opens day-detail. After the keymap change, ArrowRight only moves selection. The test must press Enter after to open the day. In `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs`, change:

```javascript
// Right arrow → opens day detail.
await page.keyboard.press('ArrowRight');
await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });
```

to:

```javascript
// Right arrow → moves selection within TOC (highlight changes; view stays TOC).
await page.keyboard.press('ArrowRight');
await expect(page.locator('.weekly-review-grid')).toBeVisible();
// Enter → opens the focused day's detail view.
await page.keyboard.press('Enter');
await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });
```

Add a new test asserting the dropped behaviors:

```javascript
test('Space and Backspace are no longer aliased to Enter and Escape', async ({ page }) => {
  await page.goto(`${APP_URL}/app/weekly-review`);
  await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
  await expect(page.locator('.weekly-review-grid')).toBeVisible();

  // Space at TOC must NOT open a day (it would have under the old Space==Enter aliasing).
  await page.keyboard.press(' ');
  await expect(page.locator('.weekly-review-grid')).toBeVisible();
  await expect(page.locator('.day-detail')).toBeHidden();

  // Backspace at TOC must NOT open the stop-confirm modal (it would have under old Backspace==Esc).
  await page.keyboard.press('Backspace');
  await expect(page.locator('.weekly-review-confirm-overlay')).toBeHidden();
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs --reporter=line`

Expected: The original test still passes (because ArrowRight currently does open day-detail, before our keymap change). The new "Space and Backspace" test FAILS — Space currently opens because of the alias.

- [ ] **Step 3: Update the keymap**

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`, change line 343-344:

```jsx
const isEnter = e.key === 'Enter' || e.key === ' ';
const isBack  = e.key === 'Escape' || e.key === 'Backspace';
```

to:

```jsx
const isEnter = e.key === 'Enter';
const isBack  = e.key === 'Escape';
```

Then change the TOC arrow handlers (around lines 513-526) so Left/Right move the selection without entering day view:

```jsx
      // viewLevel === 'toc' (post-Task-6: view.level === 'toc')
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          onExitWidget();
          return;
        case 'ArrowDown':
          e.preventDefault();
          dispatchView({ type: 'FOCUS_BAR' });
          return;
        case 'ArrowLeft':
          e.preventDefault();
          dispatchView({ type: 'CYCLE_DAY', delta: -1, totalDays: total });
          return;
        case 'ArrowRight':
          e.preventDefault();
          dispatchView({ type: 'CYCLE_DAY', delta: 1, totalDays: total });
          return;
        default: return;
      }
```

(Removed: `setViewLevel('day')` on ArrowLeft/Right.)

Similarly, in the `view.level === 'fullscreen'` branch (around line 446-473), change ArrowLeft/Right to cycle photos within the same day, NOT jump to a different day:

```jsx
      if (view.level === 'fullscreen') {
        const photos = data.days[view.dayIndex]?.photos || [];
        if (photos.length === 0) {
          dispatchView({ type: 'BACK' });
          return;
        }
        switch (e.key) {
          case 'ArrowUp':
          case 'ArrowRight':
            e.preventDefault();
            dispatchView({ type: 'CYCLE_PHOTO', delta: 1, totalPhotos: photos.length });
            return;
          case 'ArrowDown':
          case 'ArrowLeft':
            e.preventDefault();
            dispatchView({ type: 'CYCLE_PHOTO', delta: -1, totalPhotos: photos.length });
            return;
          default: return;
        }
      }
```

(Both axes now cycle photos. The "ArrowLeft jumps to another day" behavior is gone — Esc returns to day view, then ArrowLeft cycles days.)

- [ ] **Step 4: Update the existing fullscreen Playwright test**

The original test at lines 80-87 asserts `ArrowDown` at fullscreen stays in fullscreen and `ArrowLeft` drops to a previous day's day-detail. Under the new keymap, ArrowLeft also stays in fullscreen (cycling photos backward). Update:

```javascript
// Down at fullscreen cycles backward (still in fullscreen).
await page.keyboard.press('ArrowDown');
await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

// Left at fullscreen drops to previous day's L2 detail (or no-op at first day).
await page.keyboard.press('ArrowLeft');
await expect(page.locator('.day-detail')).toBeVisible();
```

becomes:

```javascript
// Down at fullscreen cycles photos (still in fullscreen).
await page.keyboard.press('ArrowDown');
await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

// Left at fullscreen ALSO cycles photos (no longer jumps to a different day).
await page.keyboard.press('ArrowLeft');
await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

// Escape drops back to day detail.
await page.keyboard.press('Escape');
await expect(page.locator('.day-detail')).toBeVisible();
```

- [ ] **Step 5: Run all tests to verify**

Run: `npx playwright test tests/live/flow/weekly-review/ --reporter=line`

Expected: All tests pass.

- [ ] **Step 6: Manual sanity check**

In a browser, verify the keymap end-to-end:
- Page loads → preflight clears → TOC visible.
- ArrowLeft/Right move the focused day highlight, no view change.
- Enter opens the focused day.
- ArrowLeft/Right cycles days within day-detail.
- ArrowUp at day-detail → fullscreen image.
- ArrowLeft/Right/Up/Down at fullscreen all cycle photos.
- Esc at fullscreen → day-detail. Esc at day-detail → TOC. Esc at TOC → save-confirm modal.
- Space and Backspace do nothing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx \
        tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs
git commit -m "fix(weekly-review): keymap — drop Space=Enter & Backspace=Escape; arrows cycle within level"
```

---

## Task 8: Make DayColumn Keyboard-Reachable (P1-4)

Add `role="button"`, `tabIndex={0}`, and `onKeyDown` so each day cell can be focused via Tab and activated via Enter. This composes with Task 2's document listener; per-cell focus is the long-term shape.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/components/DayColumn.jsx`

- [ ] **Step 1: Write a failing Playwright test**

Append to `tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs` (create the file):

```javascript
import { test, expect } from '@playwright/test';
import { APP_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Weekly Review accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class FakeWS {
        constructor() {
          this.binaryType = 'arraybuffer';
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ sampleRate: 48000 }) });
            const buf = new ArrayBuffer(2048);
            const view = new Int16Array(buf);
            for (let i = 0; i < view.length; i++) view[i] = (i % 2) ? 8000 : -8000;
            this.onmessage?.({ data: buf });
          }, 50);
        }
        send() {}
        close() {}
      }
      window.WebSocket = FakeWS;
    });
  });

  test('day columns are keyboard-reachable buttons', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    const firstDay = page.locator('.day-column').first();
    const role = await firstDay.getAttribute('role');
    expect(role).toBe('button');
    const tab = await firstDay.getAttribute('tabindex');
    expect(tab).toBe('0');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs --reporter=line`

Expected: FAIL — `role` is null and `tabindex` is null.

- [ ] **Step 3: Add ARIA + keyboard handlers to DayColumn**

In `frontend/src/modules/WeeklyReview/components/DayColumn.jsx`, replace lines 32-37:

```jsx
    <div
      className={columnClass}
      style={{ flex: day.columnWeight }}
      onClick={onClick}
    >
```

with:

```jsx
    <div
      className={columnClass}
      style={{ flex: day.columnWeight ?? 1 }}
      role="button"
      tabIndex={0}
      aria-label={`${day.label} ${dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, ${day.photoCount || 0} photos`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onClick();
        }
      }}
    >
```

(Note: also added `?? 1` fallback for `flex` per audit P2-5.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs --reporter=line`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/DayColumn.jsx \
        tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs
git commit -m "a11y(weekly-review): DayColumn is a real button (role, tabindex, keyboard)"
```

---

## Task 9: A11y Overlays — role=dialog, aria-modal, focus management (P1-7)

Mark every overlay as a dialog with proper ARIA. Restore focus to the launcher on close.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (overlay JSX)
- Modify: `frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx`

- [ ] **Step 1: Write a failing Playwright test**

Append to `tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs`:

```javascript
test('stop-confirm overlay has dialog ARIA', async ({ page }) => {
  await page.goto(`${APP_URL}/app/weekly-review`);
  await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
  await page.keyboard.press('Escape');

  const dialog = page.locator('.weekly-review-confirm-overlay [role="dialog"]');
  await expect(dialog).toBeVisible();
  expect(await dialog.getAttribute('aria-modal')).toBe('true');
  expect(await dialog.getAttribute('aria-labelledby')).not.toBeNull();
});

test('preflight overlay has dialog ARIA when failed', async ({ page }) => {
  // Stub out FakeWS so it NEVER sends audible audio — preflight failure path
  await page.addInitScript(() => {
    class SilentWS {
      constructor() {
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify({ sampleRate: 48000 }) });
        }, 50);
      }
      send() {} close() {}
    }
    window.WebSocket = SilentWS;
  });
  await page.goto(`${APP_URL}/app/weekly-review`);

  // Wait the 10s timeout so preflight fails.
  const failedOverlay = page.locator('.weekly-review-preflight-overlay [role="dialog"]');
  await expect(failedOverlay).toBeVisible({ timeout: 15000 });
  expect(await failedOverlay.getAttribute('aria-modal')).toBe('true');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs --reporter=line`

Expected: FAIL — no `[role="dialog"]` selector matches.

- [ ] **Step 3: Add ARIA to all overlays in WeeklyReview.jsx**

For each overlay's `.confirm-dialog` div, add `role="dialog" aria-modal="true" aria-labelledby="<unique-id>"` and ensure the message element has the matching id.

Stop-confirm (around line 666):

```jsx
{modal.type === 'stopConfirm' && (
  <div className="weekly-review-confirm-overlay">
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-review-stop-confirm-label">
      <div className="confirm-message" id="weekly-review-stop-confirm-label">End weekly review recording?</div>
      <div className="confirm-actions">
        {/* unchanged buttons */}
      </div>
    </div>
  </div>
)}
```

Resume-draft (around line 601):

```jsx
{modal.type === 'resumeDraft' && !isRecording && (
  <div className="weekly-review-confirm-overlay">
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-review-resume-label">
      <div className="confirm-message" id="weekly-review-resume-label">
        A previous recording was not finalized.<br/>
        <small>{/* same content */}</small>
      </div>
      {/* ... */}
    </div>
  </div>
)}
```

Finalize-error (around line 648):

```jsx
{modal.type === 'finalizeError' && !isRecording && (
  <div className="weekly-review-confirm-overlay">
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-review-error-label">
      <div className="confirm-message" id="weekly-review-error-label">
        Save failed: {modal.payload}
        <br/><small>Your recording is safe — stored locally and on the server.</small>
      </div>
      {/* ... */}
    </div>
  </div>
)}
```

Disconnect (around line 689):

```jsx
{modal.type === 'disconnect' && (
  <div className="weekly-review-confirm-overlay">
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-review-disconnect-label" aria-live="polite">
      <div className="confirm-message" id="weekly-review-disconnect-label">
        {/* ... */}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Add ARIA to PreFlightOverlay.jsx**

In `frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx`, replace the wrapper at line 15:

```jsx
<div className="weekly-review-preflight-overlay">
```

with:

```jsx
<div
  className="weekly-review-preflight-overlay"
  role="dialog"
  aria-modal="true"
  aria-labelledby="weekly-review-preflight-label"
>
```

And add `id="weekly-review-preflight-label"` to the `.preflight-title` element. Also add `aria-live="polite"` so screen readers announce status changes.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs --reporter=line`

Expected: All a11y tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx \
        frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx \
        tests/live/flow/weekly-review/weekly-review-a11y.runtime.test.mjs
git commit -m "a11y(weekly-review): role=dialog/aria-modal/aria-labelledby on every overlay"
```

---

## Task 10: VU Meter Off the Render Hot Path (P1-9)

The VU meter currently rerenders the whole module 20×/sec via `setMicLevel`. Replace with a ref + direct DOM update.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`

- [ ] **Step 1: Write a failing Vitest test for the new API**

Append to `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js`:

```javascript
  it('exposes micLevelRef whose .current updates without React re-render', async () => {
    global.AudioContext = class {
      state = 'running';
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 128,
          getByteTimeDomainData: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = 200; },
        };
      }
      createMediaStreamSource() { return { connect: () => {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    };

    const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
    expect(result.current.micLevelRef).toBeDefined();
    expect(result.current.micLevelRef.current).toBe(0);

    await act(async () => { await result.current.startRecording(); });
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    expect(result.current.micLevelRef.current).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js`

Expected: FAIL — `micLevelRef` is undefined.

- [ ] **Step 3: Replace `setMicLevel` with a ref**

In `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`:

1. Delete `const [micLevel, setMicLevel] = useState(0);` (line 84).
2. Add `const micLevelRef = useRef(0);` after the other refs (around line 95).
3. In the `sample` function (around line 154), replace `setMicLevel(normalized);` with `micLevelRef.current = normalized;`.
4. In `recorder.onstop` (around line 242) and reconnect's onstop (around line 323), replace `setMicLevel(0);` with `micLevelRef.current = 0;`.
5. Update the return value (line 336) — replace `micLevel` with `micLevelRef`:

```jsx
return {
  isRecording, duration, micLevelRef, silenceWarning,
  firstAudibleFrameSeen, disconnected, error,
  startRecording, stopRecording, reconnect,
};
```

- [ ] **Step 4: Update RecordingBar.jsx to read from ref via rAF**

In `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`, replace the `vuBars` useMemo (lines 29-33) with a ref-driven approach. Replace the entire `RecordingBar` body's VU meter section.

First, change the props destructure (lines 9-28). Replace `micLevel` with `micLevelRef`:

```jsx
export default function RecordingBar({
  weekLabel, isRecording, duration, micLevelRef, silenceWarning,
  uploading, existingRecording, error,
  syncStatus, pendingCount, lastAckedAt,
  isFocused, canSave, onSave, micConnected,
}) {
```

(Removed `onStart`, `onStop` per Task 3, `uploadInFlight` per Task 4. Replaced `micLevel` with `micLevelRef`.)

Replace the VU meter JSX (lines 54-58) with a static set of 20 bars whose className is updated via direct DOM:

```jsx
import React, { useEffect, useRef } from 'react';
// ...

const vuMeterRef = useRef(null);

useEffect(() => {
  if (!isRecording || !micLevelRef) return;
  let raf;
  const tick = () => {
    const meter = vuMeterRef.current;
    if (meter) {
      const level = micLevelRef.current;
      const filled = Math.round(level * 20);
      // Only mutate classes that actually changed.
      const bars = meter.children;
      for (let i = 0; i < bars.length; i++) {
        const shouldFill = i < filled;
        const isFilled = bars[i].classList.contains('filled');
        if (shouldFill && !isFilled) bars[i].classList.add('filled');
        else if (!shouldFill && isFilled) bars[i].classList.remove('filled');
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [isRecording, micLevelRef]);

// In the JSX:
<div className="vu-meter" ref={vuMeterRef} aria-label="Microphone level">
  {Array.from({ length: 20 }, (_, i) => <div key={i} className="vu-bar" />)}
</div>
```

(The 20 child divs are stable — DOM-mutation only flips the `filled` class. No React render.)

- [ ] **Step 5: Update WeeklyReview.jsx to pass `micLevelRef`**

In `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`, update the destructure of `useAudioRecorder` (around line 60-64):

```jsx
const {
  isRecording, duration: recordingDuration, micLevelRef, silenceWarning,
  error: recorderError, startRecording, stopRecording,
  firstAudibleFrameSeen, disconnected, reconnect,
} = useAudioRecorder({ onChunk: handleChunk });
```

And in the `<RecordingBar>` JSX (around line 715), replace `micLevel={micLevel}` with `micLevelRef={micLevelRef}`.

- [ ] **Step 6: Run all tests**

Run:
```bash
npx vitest run frontend/src/modules/WeeklyReview/
npx playwright test tests/live/flow/weekly-review/ --reporter=line
```

Expected: All tests pass.

- [ ] **Step 7: Manual perf check**

Open the dev server, open Chrome DevTools → Performance, record 3 seconds while preflight is clearing and audio is flowing. Inspect the flame graph: there should be no React render activity in the WeeklyReview tree at the meter's update rate. Compare against baseline (this is a sanity check, not an assertion).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js \
        frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js \
        frontend/src/modules/WeeklyReview/components/RecordingBar.jsx \
        frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "perf(weekly-review): VU meter via ref+DOM, off the React render hot path"
```

---

## Task 11: Voice Constraints + prefers-reduced-motion + Z-Index Stack (P1-8, P1-10, P2-10)

Three small fixes, one commit.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js:193`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss` (z-index, prefers-reduced-motion)

- [ ] **Step 1: Add voice constraints to getUserMedia**

In `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`, change line 193:

```jsx
stream = await navigator.mediaDevices.getUserMedia({ audio: true });
```

to:

```jsx
stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
});
```

Same change in `reconnect` (line 294).

- [ ] **Step 2: Fix the z-index stack**

In `frontend/src/modules/WeeklyReview/WeeklyReview.scss`, change the preflight overlay z-index (line 1036) from `50` to `70` so it sits above the confirm overlay (which is z-index 60). The mini-video overlay (100) stays on top.

```scss
.weekly-review-preflight-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 12, 18, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 70;   // was 50
  // ...
}
```

- [ ] **Step 3: Add prefers-reduced-motion guards**

At the bottom of `frontend/src/modules/WeeklyReview/WeeklyReview.scss`, add:

```scss
@media (prefers-reduced-motion: reduce) {
  .recording-dot,
  .preflight-mic-pulse,
  .mic-indicator--lost {
    animation: none !important;
  }
  // upload-flash and save-pulse are deleted by Task 3/4; nothing else to mute.
}
```

- [ ] **Step 4: Run all tests as a regression sweep**

Run:
```bash
npx vitest run frontend/src/modules/WeeklyReview/
npx playwright test tests/live/flow/weekly-review/ --reporter=line
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js \
        frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "polish(weekly-review): voice constraints, z-index stack, prefers-reduced-motion"
```

---

## Task 12: Final Verification

Catch-all sweep before declaring done.

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run frontend/src/modules/WeeklyReview/
npx playwright test tests/live/flow/weekly-review/ --reporter=line
```

Expected: 100% pass.

- [ ] **Step 2: Manual end-to-end on the dev server**

Visit `http://localhost:3112/app/weekly-review` (or whichever app port is in `.claude/settings.local.json`). Verify:

- [ ] Preflight overlay clears within ~1 second once audio is detected.
- [ ] VU meter shows 20 horizontal bars; bars fill green/amber/red as you speak.
- [ ] Arrow keys navigate after clicking the Save Recording button (focus-loss-recovery test).
- [ ] Tab moves focus between day columns; Enter on a focused column opens its day-detail.
- [ ] Yellow `:focus-visible` outline appears on the focused day column / button.
- [ ] Esc at TOC opens save-confirm modal. ArrowLeft/Right toggles "Continue Recording" ↔ "Save & Close". Enter activates the focused button.
- [ ] No save-pulse animation; only one stop affordance (the Save Recording button).
- [ ] Backspace and Space do nothing.
- [ ] Inside a day-detail with photos, ArrowUp opens fullscreen. ArrowLeft/Right/Up/Down inside fullscreen all cycle photos. Esc returns to day-detail.
- [ ] System-level "reduce motion" (macOS Accessibility setting) disables the recording-dot pulse and mic-pulse animations.
- [ ] Browser DevTools "Performance" recording during recording shows no React renders firing every 50ms.

- [ ] **Step 3: Lint / typecheck**

```bash
# (whichever the project uses — check package.json scripts)
cd /opt/Code/DaylightStation
node --check frontend/src/modules/WeeklyReview/WeeklyReview.jsx
node --check frontend/src/modules/WeeklyReview/state/viewReducer.js
node --check frontend/src/modules/WeeklyReview/state/modalReducer.js
```

Expected: no syntax errors.

- [ ] **Step 4: Confirm audit's P0/P1 closures**

Open `docs/_wip/audits/2026-05-03-weekly-review-ui-audit.md` and check off:

- [x] P0-1 (arrow keys) — Task 2
- [x] P0-2 (VU meter) — Task 1
- [x] P0-3 (UX, two CTAs, Enter semantics) — Tasks 3, 4
- [x] P1-1 (modal flag soup) — Task 5
- [x] P1-2 (4-tuple view state) — Task 6
- [x] P1-3 (keymap) — Task 7
- [x] P1-4 (DayColumn keyboard) — Task 8
- [x] P1-5 (`outline: none`) — Task 2
- [x] P1-7 (overlay ARIA) — Task 9
- [x] P1-8 (z-index stack) — Task 11
- [x] P1-9 (VU meter perf) — Task 10
- [x] P1-10 (voice constraints) — Task 11
- [ ] P1-6 (hover-vs-focus conflation) — partial; the `:focus-visible` rules in Task 2 + the existing `&.focused` classes coexist OK for now, but a follow-up cleanup should remove `&.focused` in favor of `:focus-visible` everywhere. Document in the follow-up plan.

- [ ] **Step 5: Final commit summary**

If any uncommitted scratch changes remain, decide whether to commit or discard. There should be 11 commits from Tasks 1-11. Run `git log --oneline -15` to verify.

- [ ] **Step 6: Notify the user**

The plan is done. P0s + most P1s are closed. Suggest a follow-up plan for the ~50 P2 items (utility extraction, finalize encoding, AudioWorklet file, etc.) as a code-quality pass — those don't block usability and shouldn't gate this fix from shipping.

---

## Notes for the Implementer

- **Don't batch the SCSS changes.** Each is small, easy to review per-commit, easy to revert. Per the project memory rule "Reference docs are endstate, not status" — keep commit messages focused on the fix, not the journey.
- **The Playwright tests run against the live dev server** (`tests/live/flow/`). If `lsof -i :3112` shows nothing, start it: `node backend/index.js` from project root.
- **The Vitest reducer tests run in-process** with happy-dom. No server needed.
- **The user has explicitly told us "no waiting between batches"** (memory: feedback_no_wait_between_batches.md). Keep the cadence; don't pause to confirm intermediate steps unless a test fails unexpectedly.
- **If a step's expected outcome doesn't happen, stop and diagnose.** Don't keep going. Per memory: "Never say 'should be' when logs are available — verify post-action state."
- **You will hit react-react-dom version mismatches if you run vitest from the worktree without `frontend/node_modules`.** The vitest config (line 7-9) handles this via fallback path; if it complains, run from `/opt/Code/DaylightStation` directly.

---

## Self-Review Notes (post-write)

**Spec coverage:**
- P0-1 → Task 2 ✓
- P0-2 → Task 1 ✓
- P0-3 → Tasks 3 + 4 ✓
- P1-1 → Task 5 ✓
- P1-2 → Task 6 ✓
- P1-3 → Task 7 ✓
- P1-4 → Task 8 ✓
- P1-5 → Task 2 (outline: none removed) ✓
- P1-6 → Partial; noted as follow-up.
- P1-7 → Task 9 ✓
- P1-8 → Task 11 ✓
- P1-9 → Task 10 ✓
- P1-10 → Task 11 ✓
- P2 items 1-65 → explicitly out of scope (deferred plan).

**Type/name consistency check:**
- `dispatchView`/`dispatchModal` — used consistently across Tasks 5-9 ✓
- `viewReducer.SELECT_DAY/OPEN_DAY/CYCLE_DAY/CYCLE_PHOTO/BACK/FOCUS_BAR/FOCUS_MAIN/OPEN_PHOTO` — defined in Task 6, used in Task 7 ✓
- `modalReducer.OPEN/CLOSE/TOGGLE_FOCUS/SET_FOCUS` — defined in Task 5, used in Task 7 ✓
- `micLevelRef` — defined in Task 10 step 3, consumed in step 4 ✓
- The deletion of `onStart/onStop` props in Task 3 must propagate to RecordingBar's destructure in Task 10 step 4 — both reflect the deletion ✓.
- The `uploadInFlight` cleanup in Task 4 step 3 mentions the pop-guard at lines 553/566; Task 6 step 5 sub-bullet 7 also rewrites the pop-guard. These touch the same code; Task 6 is the final shape. Implementer should treat Task 4's edit as a temporary state that Task 6 supersedes — keep it as-is since each task must work standalone.

**Placeholder scan:** No "TBD", "implement later", or "similar to Task N" instances. All test code is concrete; all replacement code is shown verbatim.

**Note on Task 5's bulk JSX rewrite:** The "find every read/write" tables are a fair description of the work, but the implementer may produce diff-style edits per call site — acceptable as long as final state matches. If counts surprise (more refs than expected), run `grep -n` to confirm before declaring complete.
