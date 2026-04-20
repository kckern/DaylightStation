# Fitness FRD Q2 Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 10 discrete FRD items across voice memos, player UI, governance, date formatting, session management, and user list sorting in the Fitness App.

**Architecture:** Most changes are localized to existing Fitness modules under `frontend/src/modules/Fitness/`. Two items touch the backend (`/session/end` endpoint + merge guard). One item introduces a small shared utility (`frontend/src/modules/Fitness/lib/dateFormatter.js`). No new cross-cutting abstractions.

**Tech Stack:** React 18 + Mantine, Vite, SCSS, Node.js backend (ES modules), YAML config via `ConfigService`, Playwright for runtime tests.

**Scope & sequencing:** 10 items, grouped by theme. Recommended order: bug fixes first (1.2, 3.1, 4.2 investigation), then UX polish (2.1, 2.2, 5.1), then data/feature work (3.2, 4.1, 5.2, 5.3), then retroactive voice memo (1.1, depends on a known-good voice memo flow).

**Notes on testing:** The TV kiosk UI relies on `onPointerDown` not `onClick` (see `FitnessApp.jsx:31-35`). Timer-based behavior (auto-close, 15s inactivity) should be tested with `vi.useFakeTimers()` in unit tests where practical; some UI items (visual flash, pop-out collapse) are easier to verify via manual run + Playwright flow tests than pure unit tests — the plan calls this out per task.

**Commits:** One commit per task unless a task explicitly says otherwise.

---

## Pre-Flight

### Task 0: Worktree + baseline

**Step 1: Create a worktree for this work**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git worktree add -b feature/fitness-frd-q2 ../DaylightStation-fitness-frd-q2 main
cd ../DaylightStation-fitness-frd-q2
```

**Step 2: Confirm baseline**

```bash
npm install   # only if lockfile changed
npm run lint  # confirm starting from clean state
```

Expected: clean lint / green baseline. If lint is red on main, note the failures — do not try to fix them in this plan.

**Step 3: Verify dev server can start**

```bash
lsof -i :3111   # confirm no dev server running before starting one
# If nothing: `npm run dev` and leave it running in a separate terminal.
```

Expected: Vite on 3111 proxies `/api/*` to backend on 3112 (per `CLAUDE.md` "Dev Server Ports" table for kckern-macbook).

---

## Section 1 — Voice Memos

### Task 1.2 (done first): Fix memo cancel ghost-save bug

> **Why first?** Task 1.1 (retroactive memos from Session Details) reuses the same flow. Don't build on a broken flow.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js:310-418,460-540`
- Test: `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.test.js` (create if absent)

**Root cause (from exploration):**
`cancelUpload()` sets `cancelledRef.current = true` and calls `stopRecording()`. The `MediaRecorder.onstop` handler is `handleRecordingStop()`, which creates its abort controller *inside* itself at line 330. If the stop event fires before the async body has reached that line, there is no controller to abort, and the `cancelledRef` check may be stepped past by stale state — the blob is uploaded to `POST /api/v1/fitness/voice_memo` regardless.

**Fix approach:** Hoist the abort controller to a ref (`uploadAbortRef`) that is initialised/reset when recording starts and aborted inside `cancelUpload()`. Re-check `cancelledRef.current` immediately before the network call and short-circuit before any FormData/base64 work.

**Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useVoiceMemoRecorder from './useVoiceMemoRecorder.js';

// Minimal MediaRecorder/stream mocks — see existing fitness tests for pattern
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => new Promise(() => {})), // never resolves; assertion is that it's NEVER called
  DaylightMediaPath: (p) => p
}));

describe('useVoiceMemoRecorder cancel flow', () => {
  beforeEach(() => {
    global.MediaRecorder = class MockRecorder {
      constructor() { this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop?.(); }
      addEventListener(evt, cb) { this['on' + evt] = cb; }
    };
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
    };
  });

  it('does not upload audio when cancelUpload is called before stop completes', async () => {
    const { DaylightAPI } = await import('../../../../../lib/api.mjs');
    const { result } = renderHook(() => useVoiceMemoRecorder({ sessionId: 'abc', onMemoCaptured: vi.fn() }));

    await act(async () => { await result.current.startRecording(); });
    await act(async () => { result.current.cancelUpload(); });

    // Give any microtasks / chunk handlers a tick to run
    await new Promise(r => setTimeout(r, 10));

    expect(DaylightAPI).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
npx vitest run frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.test.js
```

Expected: FAIL — `DaylightAPI` was called (or test framework can't import the hook, fix the mock paths until the real behavior fails).

**Step 3: Implement the fix**

In `useVoiceMemoRecorder.js`:

1. Add a ref near the other refs:
   ```javascript
   const uploadAbortRef = useRef(null);
   ```
2. In `startRecording()`, reset:
   ```javascript
   cancelledRef.current = false;
   uploadAbortRef.current = new AbortController();
   ```
3. In `cancelUpload()`, *before* calling `stopRecording()`:
   ```javascript
   cancelledRef.current = true;
   uploadAbortRef.current?.abort();
   ```
4. In `handleRecordingStop()`, replace the local `new AbortController()` with `uploadAbortRef.current` and add an early guard at the very top:
   ```javascript
   if (cancelledRef.current) {
     logger.info('recording-upload-aborted', { stage: 'pre-blob' });
     return;
   }
   ```
5. Right before `DaylightAPI(...)`, re-check:
   ```javascript
   if (cancelledRef.current || uploadAbortRef.current?.signal.aborted) {
     logger.info('recording-upload-aborted', { stage: 'pre-request' });
     return;
   }
   ```

**Step 4: Run tests — expect pass**

```bash
npx vitest run frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.test.js
```

Expected: PASS.

**Step 5: Manual smoke test**

- Start dev server, open Fitness app, play any episode with voice memos enabled
- Trigger voice memo, wait ~1 second (so chunks accumulate), click X to cancel
- Check `dev.log` / backend logs: no `POST /api/v1/fitness/voice_memo` should appear
- Check session history in FitnessSessionsWidget: no ghost memo on the session

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.test.js
git commit -m "fix(fitness/voice-memo): prevent ghost upload when user cancels recording

Hoist abort controller to a ref so cancelUpload() can abort before the
onstop handler kicks off the blob/base64/upload chain. Guard the network
call with a final cancelledRef check."
```

---

### Task 1.1: Retroactive voice memo on Session Details

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx:321-363`
- Modify (if needed): `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.scss` (button styling)

**Approach:** FitnessSessionDetailWidget already has `header.voiceMemos` rendering at 321-336 and a button row at 346-363. Add an "Add Voice Memo" button in the button row that opens the existing overlay via `openVoiceMemoCapture(null, { sessionId, onComplete })` from FitnessContext. The overlay's existing `handleRecordingStop` already POSTs to `/api/v1/fitness/voice_memo` with a `sessionId` — passing the historical session's ID reuses that plumbing.

**Step 1: Read the context API to confirm signature**

Confirm in `frontend/src/context/FitnessContext.jsx` around line 959 that `openVoiceMemoCapture` accepts an options argument and that `sessionId` flows to the recorder hook's `sessionId` prop.

If it does not currently accept `sessionId`, extend the function signature:
```javascript
openVoiceMemoCapture: (initialBlob = null, opts = {}) => {
  setVoiceMemoOverlayState({ open: true, mode: 'redo', sessionId: opts.sessionId || null, onComplete: opts.onComplete || null });
}
```
and forward `overlayState.sessionId` to `useVoiceMemoRecorder` in `VoiceMemoOverlay.jsx`.

**Step 2: Write a Playwright flow test**

Create `tests/live/flow/fitness/fitness-session-detail-retroactive-memo.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';
import { fitnessAppURL } from '../../../_fixtures/runtime/urls.mjs';

test('adds a voice memo to a historical session', async ({ page }) => {
  await page.goto(fitnessAppURL());
  // Navigate to a completed session in the session detail widget
  // (exact navigation depends on which screen renders FitnessSessionDetailWidget)
  // ...
  const addBtn = page.getByRole('button', { name: /add voice memo/i });
  await expect(addBtn).toBeVisible();
  await addBtn.click();
  await expect(page.locator('.voice-memo-overlay')).toBeVisible();
});
```

Note: the initial test will fail because the button does not exist yet. If navigating to a historical session is non-trivial from Playwright, mark the test `.skip` with a TODO and rely on manual verification — but still add it to the tree.

**Step 3: Run the test — expect fail**

```bash
npx playwright test tests/live/flow/fitness/fitness-session-detail-retroactive-memo.runtime.test.mjs --reporter=line
```

Expected: FAIL with button-not-visible.

**Step 4: Add the button**

In `FitnessSessionDetailWidget.jsx` inside the button row (~line 346-363):

```jsx
<button
  type="button"
  className="session-detail__action session-detail__action--memo"
  onPointerDown={(e) => {
    e.preventDefault();
    ctx.openVoiceMemoCapture(null, {
      sessionId: header.sessionId,
      onComplete: () => refreshSession()   // use the widget's existing refresh handler
    });
  }}
>
  Add Voice Memo
</button>
```

Where `ctx` is the already-in-scope FitnessContext hook value (via `useFitnessContext`) and `refreshSession` is whatever the widget currently uses to refetch the detail payload. If no refresh hook exists, add one that re-runs the detail query.

**Step 5: Re-run the Playwright test — expect pass**

**Step 6: Manual verification**

- Open Fitness → Sessions → tap a completed session
- Tap "Add Voice Memo", record a 2-second memo, confirm
- Reload the session detail screen → new memo appears in `session-detail__memos` list
- Backend: inspect `data/household/apps/fitness/sessions/<sessionId>.yml` for the new memo entry

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx \
        frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.scss \
        frontend/src/context/FitnessContext.jsx \
        frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx \
        tests/live/flow/fitness/fitness-session-detail-retroactive-memo.runtime.test.mjs
git commit -m "feat(fitness/session-detail): add retroactive voice memo button"
```

---

## Section 2 — Settings & Player UI

### Task 2.1: Settings menu auto-close + acknowledgment flash

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx:256-371`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebar.jsx` (pass `onSelection` callback into menu)
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.scss` (flash animation)

**Approach:** The menu currently has no auto-close path — the parent `menuState` in `FitnessSidebar.jsx:19-20` closes only on overlay click. Add an `ackSelection` helper inside the menu that (a) flashes the selected control for 300ms, (b) calls `onClose` after ~400ms. This is the Fitness app not TVApp, so CSS transitions work here — a short keyframe animation is fine.

**Scope of affected controls:**
- Media Visibility toggles: Sidebar Webcam, Fitness Chart, Treasure Box, Music (lines 271-331)
- Video Controls: Video Volume slider, Volume Boost 1x/5x/10x/20x buttons (lines 339-364)

**Step 1: Write the failing test (unit)**

Create `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.test.jsx`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';

describe('FitnessSidebarMenu auto-close', () => {
  it('calls onClose ~400ms after a Media Visibility toggle is tapped', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<FitnessSidebarMenu mode="settings" onClose={onClose} {...requiredProps} />);
    await user.click(screen.getByLabelText(/sidebar webcam/i));
    expect(onClose).not.toHaveBeenCalled();   // not immediate
    act(() => { vi.advanceTimersByTime(500); });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

(`requiredProps` = whatever minimal props the menu needs. Check the current call site in `FitnessSidebar.jsx` for the prop shape.)

**Step 2: Run — expect fail** → `npx vitest run frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.test.jsx`

Expected: FAIL (`onClose` never called).

**Step 3: Implement**

In `FitnessSidebarMenu.jsx`:

1. Add a constant at module top: `const AUTO_CLOSE_MS = 400;`
2. Add an `ackSelection(id)` helper inside the component:
   ```jsx
   const [flashingId, setFlashingId] = useState(null);
   const ackSelection = useCallback((id) => {
     setFlashingId(id);
     setTimeout(() => {
       setFlashingId(null);
       onClose?.();
     }, AUTO_CLOSE_MS);
   }, [onClose]);
   ```
3. On each toggle's `onPointerDown` (Media Visibility 4 toggles + Video Volume Boost 4 buttons), after the existing state update call `ackSelection(thisId)`.
4. Volume slider: do NOT auto-close mid-drag; instead, call `ackSelection` on slider `onPointerUp`.
5. Pass `className={flashingId === thisId ? 'is-ack-flash' : ''}` to each control.

In `FitnessSidebarMenu.scss`:

```scss
@keyframes fitness-menu-ack-flash {
  0%   { background: rgba(255,255,255,0.15); }
  40%  { background: rgba(255,255,255,0.55); }
  100% { background: rgba(255,255,255,0.15); }
}
.fitness-sidebar-menu__control.is-ack-flash {
  animation: fitness-menu-ack-flash 300ms ease-out;
}
```

**Step 4: Run tests** → expect PASS.

**Step 5: Manual verification**

- Open Fitness, open the settings sidebar menu
- Tap each of: Sidebar Webcam, Fitness Chart, Treasure Box, Music → each flashes ~300ms then closes
- Tap 5x, 10x, 20x volume boost → same
- Drag video volume slider → does not close during drag; closes ~400ms after release

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx \
        frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.test.jsx \
        frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.scss
git commit -m "feat(fitness/settings-menu): auto-close with 300ms ack flash after selection"
```

---

### Task 2.2: Player pop-out 15-second inactivity auto-collapse

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx:48,361-373,449-600`

**Approach:** `controlsOpen` is a local boolean (line 48), toggled by `toggleControls()` at 361-373 using an existing `interactionLockRef` pattern. Add a `useRef` for a collapse timer, reset it on any interaction inside the expanded panel, and trigger `setControlsOpen(false)` when it fires. Clear on unmount and on manual close.

**Step 1: Write the failing test**

Add to `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.test.jsx` (create if missing):

```javascript
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FitnessMusicPlayer from './FitnessMusicPlayer.jsx';

describe('FitnessMusicPlayer pop-out inactivity timeout', () => {
  it('collapses the controls pop-out after 15s of inactivity', () => {
    vi.useFakeTimers();
    render(<FitnessMusicPlayer {...minimalProps} />);
    // Open the pop-out
    act(() => screen.getByTestId('music-player-info').click());
    expect(screen.queryByTestId('music-player-controls-expanded')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(14_000));
    expect(screen.queryByTestId('music-player-controls-expanded')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByTestId('music-player-controls-expanded')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
```

Add `data-testid="music-player-controls-expanded"` to the expanded-controls wrapper at ~line 540 and `data-testid="music-player-info"` to the info tap target.

**Step 2: Run — expect fail** (pop-out stays open past 15s).

**Step 3: Implement**

In `FitnessMusicPlayer.jsx`:

```javascript
const INACTIVITY_MS = 15_000;
const inactivityTimerRef = useRef(null);

const scheduleCollapse = useCallback(() => {
  if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
  inactivityTimerRef.current = setTimeout(() => {
    setControlsOpen(false);
    inactivityTimerRef.current = null;
  }, INACTIVITY_MS);
}, []);

const cancelCollapse = useCallback(() => {
  if (inactivityTimerRef.current) {
    clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = null;
  }
}, []);

useEffect(() => {
  if (controlsOpen) scheduleCollapse();
  else cancelCollapse();
  return cancelCollapse;
}, [controlsOpen, scheduleCollapse, cancelCollapse]);
```

Add `onPointerDown={scheduleCollapse}` (reset on interaction) to the expanded-controls wrapper at line 540. Also reset on slider drag events (`onChange` of video volume + music volume sliders) and on playlist button tap.

**Step 4: Run — expect pass**

**Step 5: Manual verification**

- Open music player pop-out, do nothing, watch wall clock — it collapses at 15s
- Re-open, move video volume slider, wait 14s, move again → does not collapse
- Move slider, wait 16s of no further interaction → collapses

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx \
        frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.test.jsx
git commit -m "feat(fitness/music-player): auto-collapse pop-out after 15s inactivity"
```

---

## Section 3 — Data Integrity & Governance

### Task 3.1: Lock icon — investigate before "fixing"

**Files (for investigation):**
- `frontend/src/modules/Fitness/player/FitnessShow.jsx:734-742,1113-1122`
- `frontend/src/context/FitnessContext.jsx:456-463`
- `data/household/apps/fitness/config.yml` (governance config)

**Situation:** Exploration showed the existing gate `isGovernedShow` already checks `governedTypeSet` and `governedLabelSet` correctly, and returns `false` when both sets are empty. So the reported "lock icon appears globally" bug is NOT a logic bug at this site. Candidates:

1. The lock icon is ALSO rendered elsewhere (e.g. on individual episode items), not just on the show header — and that second site is ungated.
2. `governedTypeSet` is being populated with something overly broad (e.g. contains `"episode"` or `"show"` types that match every item).
3. Governance config loaded in production is different from dev (check live config).

**Step 1: Audit all lock-icon renders**

Use Grep to list all occurrences in `frontend/src/modules/Fitness/`:
- `pattern: 🔒` (the literal lock emoji) — content mode
- `pattern: governed-lock-icon`
- `pattern: isGoverned` — all variants

Expected to find the known render at `FitnessShow.jsx:1113`. Confirm whether any OTHER render site exists and whether it is gated.

**Step 2: Audit governance config**

Read `data/household/apps/fitness/config.yml` governance section — check `governed_labels` + `governed_types` values.

If `governed_types` contains overly broad values, that is the bug. If `governed_labels` is empty but lock still appears, the bug is elsewhere.

**Step 3: Reproduce**

Open Fitness, tap into a show you expect to be un-governed. Take a screenshot or note whether lock shows up on the show header vs. individual episodes. Compare with a show you expect to BE governed.

**Step 4: Write the failing test (once root cause known)**

Depending on what Step 1-3 reveal, the test is one of:
- Unit test: given an ungoverned show + non-empty `governedLabelSet`, the lock should not render
- Unit test: given an episode item with no matching governance label, the episode-level lock should not render

**Step 5: Implement the fix**

One of:
- Gate the second lock-icon render site with the same `isGoverned` check
- Correct an overly broad governance config in `data/household/apps/fitness/config.yml`
- Fix the set-construction logic if it's swallowing label mismatches

**Step 6: Manual verification**

- Reload Fitness, confirm lock appears only on shows/items tagged for governance
- Verify a known-governed show still shows the lock (don't regress)

**Step 7: Commit**

```bash
git commit -m "fix(fitness/governance): restrict lock icon to items with governance tags

Root cause: <fill in once found>"
```

> If Step 1-3 reveal the reporter actually saw correct behavior (no bug), still commit a clarifying code comment at `FitnessShow.jsx:1113` documenting what drives the lock, and close the FRD item with that note in the PR description.

---

### Task 3.2: Centralized date formatter

**Files:**
- Create: `frontend/src/modules/Fitness/lib/dateFormatter.js`
- Create: `frontend/src/modules/Fitness/lib/dateFormatter.test.js`
- Modify call sites:
  - `frontend/src/modules/Fitness/player/FitnessShow.jsx:6-22,1215` (replace `formatWatchedDate`)
  - `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx:50-59`
  - `frontend/src/modules/Fitness/widgets/FitnessNutritionWidget/FitnessNutritionWidget.jsx:21-24`
  - `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx:42-45`
  - `frontend/src/modules/Fitness/widgets/FitnessCoachWidget/FitnessCoachWidget.jsx:90,105`
  - `frontend/src/modules/Fitness/widgets/FitnessCalendarWidget/FitnessCalendarWidget.jsx:25`

**Target format:** `"Mon, Apr 20"` using `Intl.DateTimeFormat` (no new dependency — removes `moment` from `FitnessShow.jsx`).

**Step 1: Write the failing test**

```javascript
// frontend/src/modules/Fitness/lib/dateFormatter.test.js
import { describe, it, expect } from 'vitest';
import { formatFitnessDate } from './dateFormatter.js';

describe('formatFitnessDate', () => {
  it('formats an ISO date as "<Short DOW>, <Short Month> <Day>"', () => {
    const d = new Date(Date.UTC(2026, 3, 20, 12, 0, 0));
    expect(formatFitnessDate(d)).toBe('Mon, Apr 20');
  });

  it('accepts ISO strings', () => {
    expect(formatFitnessDate('2026-04-20T12:00:00Z')).toBe('Mon, Apr 20');
  });

  it('returns an empty string for null/invalid input', () => {
    expect(formatFitnessDate(null)).toBe('');
    expect(formatFitnessDate('not-a-date')).toBe('');
  });
});
```

**Step 2: Run — expect fail (module does not exist).**

**Step 3: Implement**

```javascript
// frontend/src/modules/Fitness/lib/dateFormatter.js
const DEFAULT_FORMAT_OPTS = { weekday: 'short', month: 'short', day: 'numeric' };

export function formatFitnessDate(input, opts = DEFAULT_FORMAT_OPTS) {
  if (input == null) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', opts).format(d);
}
```

**Step 4: Run — expect pass**

**Step 5: Migrate call sites** — at each of the 6 call sites, replace the local formatter with an import from the new utility. Where `moment` is imported solely for this purpose (FitnessShow.jsx line 6-22), remove the import if nothing else in the file uses it.

**Step 6: Run all fitness tests** → `npx vitest run frontend/src/modules/Fitness` → PASS.

**Step 7: Commit**

```bash
git commit -m "refactor(fitness): centralize date formatting to formatFitnessDate"
```

---

## Section 4 — Session Management & Interaction

### Task 4.1: "End Session" button + Clean Split API

**Backend files:**
- Modify: `backend/src/3_applications/fitness/services/SessionService.mjs:268-284,299-352,364-435`
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:~554` (add new route)
- Modify: `backend/src/2_domains/fitness/entities/Session.mjs` (confirm `end(endTime)` sets `finalized`; extend if not)

**Frontend files:**
- Modify: session chart component — exact path TBD. Exploration says no component named `SessionChart` exists; the closest is `FitnessChart.jsx`. The button likely belongs on the active in-workout chart overlay, not the historical widget.

**Backend step 1: Confirm entity supports finalize**

Read `Session.mjs:28-70,130-145`. Confirm `end(endTime)` sets `this.finalized = true`. If not:

```javascript
end(endTime) {
  this.endTime = endTime;
  this.durationMs = endTime - this.startTime;
  this.finalized = true;
}
```

**Backend step 2: Failing test for merge guard**

```javascript
it('does not auto-merge when either candidate session is finalized', async () => {
  const finalized = await svc.createSession({ ..., finalized: true, endTime: Date.now() - 10_000 });
  const newSession = await svc.createSession({ ..., startTime: Date.now() });
  const merged = await svc.mergeSessions(finalized.id, newSession.id);
  expect(merged).toBeNull();
});
```

**Backend step 3: Guard merge + filter resumable**

In `SessionService.mjs:mergeSessions()` (line 364):
```javascript
if (sourceSession.finalized || targetSession.finalized) {
  this.logger?.info?.('session-merge-blocked-finalized', { sourceId, targetId });
  return null;
}
```

In `findResumable()` (line 299): `.filter(s => !s.finalized)`

**Backend step 4: Add endpoint**

In `backend/src/4_api/v1/routers/fitness.mjs`:
```javascript
router.post('/session/:sessionId/end', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const endTime = Number(req.body?.endTime) || Date.now();
    const session = await sessionService.endSession({ sessionId, endTime });
    if (!session) return res.status(404).json({ error: 'session_not_found' });
    res.json({ session: session.toJSON?.() ?? session });
  } catch (err) {
    req.log?.error({ err }, 'fitness-session-end-failed');
    res.status(500).json({ error: err.message });
  }
});
```

Extend `sessionService.endSession()` if needed so it calls `session.end()` (which sets `finalized: true`) and saves.

**Backend step 5: Integration test** → `tests/live/api/fitness-session-end.test.mjs` asserts YAML has `finalized: true` after POST.

**Frontend step 0: Find the right chart** — grep for the component rendered inside `FitnessModuleContainer moduleId="fitness_session"`. Read that module's root to find the chart area. Use `FitnessChart.jsx` as a reference only.

**Frontend step 1: Add the button (bottom-right)**

```jsx
<button
  type="button"
  className="fitness-session-chart__end-session"
  onPointerDown={async (e) => {
    e.preventDefault();
    const sid = fitnessSession?.sessionId;
    if (!sid) return;
    await fetch(`/api/v1/fitness/session/${sid}/end`, { method: 'POST' });
    ctx.startNewSession?.();
    logger.info('fitness-session-ended-manually', { sessionId: sid });
  }}
>
  End Session
</button>
```

Add confirm dialog (native `confirm()` or existing app-specific dialog pattern) so it can't be tapped by accident — the TV has a big touchscreen.

**Frontend step 2: SCSS position** → `bottom: 16px; right: 16px; position: absolute;` on the chart container. Must not overlap the in-progress HR readout.

**Frontend step 3: Manual verification**

- Start session, let HR data come in ~30s
- Tap "End Session" → confirm
- Within <1 minute, start new session → different `sessionId`
- Check `data/household/apps/fitness/sessions/<prev>.yml` for `finalized: true`

**Step 4: Commit (backend + frontend together)**

```bash
git commit -m "feat(fitness/session): end-session endpoint + clean-split UI button

Adds POST /api/v1/fitness/session/:id/end which sets finalized=true.
Guards mergeSessions() and findResumable() against finalized sessions.
Adds End Session button at bottom-right of active session chart."
```

---

### Task 4.2: Play vs. Scroll mutual exclusion — verify

**Files:**
- Inspect: `frontend/src/modules/Fitness/player/FitnessShow.jsx:448-520,542-548,1195-1196,1234-1240`

**Situation:** Exploration found this is already implemented — `scrollIntoViewIfNeeded` returns `{ didScroll }`, and `handlePlayEpisode` at 542-548 does `if (didScroll) return;` to suppress play on first tap. BEFORE writing any code, reproduce the bug.

**Step 1: Reproduction protocol**

- Open a show with enough episodes that some are off-screen
- Tap the bottom-most partially-visible episode — does play start, or does the list first scroll and require a second tap?

Document the observed behavior. If it already matches the FRD spec, close the item as "verified, no change needed" and add a regression test.

**Step 2: Playwright regression test**

`tests/live/flow/fitness/fitness-scroll-suppresses-play.runtime.test.mjs`:
```javascript
test('tapping an off-screen episode scrolls it into view without starting playback', async ({ page }) => {
  await page.goto(/* fitness show URL for a show with many episodes */);
  await page.locator('.episode-list').evaluate(el => el.scrollTop = 0);
  const off = page.locator('.episode-card').last();
  await off.tap();
  await expect(page.locator('video')).toBeHidden();
  await expect(off).toBeInViewport();
});
```

**Step 3: If reproducible:** Fix by tightening the `didScroll` threshold in `scrollIntoViewIfNeeded()`.

**Step 4: Commit** — `test(fitness): regression test for scroll-suppresses-play behavior` (or `fix(fitness/episode-list): ...` if code changed).

---

## Section 5 — Challenges & User List

### Task 5.1: Challenge Overlay completion squares — green → white

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/ChallengeOverlay.scss:98-112`

**Step 1: Update the SCSS**

Replace lines 109-111 (the `--complete` variant):
```diff
 &--complete {
-  background: #22c55e;
-  border-color: rgba(34, 197, 94, 0.7);
-  box-shadow: 0 6px 18px rgba(34, 197, 94, 0.35), inset 0 0 12px rgba(6, 78, 59, 0.4);
+  background: #ffffff;
+  border-color: rgba(255, 255, 255, 0.85);
+  box-shadow: 0 6px 18px rgba(255, 255, 255, 0.35), inset 0 0 12px rgba(203, 213, 225, 0.4);
 }
```

**Step 2: Manual verification**

- Trigger a governance challenge (or inject via `window.__fitnessGovernance.activeChallenge`)
- Confirm completed squares are white, not green
- Confirm HR zone "green" is now visually distinguishable from challenge completion

**Step 3: Commit**

```bash
git commit -m "style(fitness/challenge): white completion squares to avoid HR-zone color collision"
```

---

### Task 5.2: User Cards — compact class for 5+ users

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx:793,1008-1081`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebar.scss:1398-1428`

**Step 1: Add `compact` detection + class**

In `FitnessUsers.jsx`, near line 793:
```javascript
const isCompact = hrCounts.candidate >= 5;
// ...
className={[
  'fitness-device',
  layout === 'vertical' ? 'card-vertical' : 'card-horizontal',
  isCompact ? 'card-compact' : ''
].filter(Boolean).join(' ')}
```

**Step 2: SCSS compact variant**

In `FitnessSidebar.scss` after line 1428:
```scss
.fitness-device.card-compact {
  &.card-horizontal {
    height: 54px;
    gap: 8px;
    padding: 4px 8px;
    .fitness-device__avatar { width: 40px; height: 40px; }
    .fitness-device__hr    { font-size: 1.1rem; }
    .fitness-device__zone  { display: none; }
  }
  &.card-vertical {
    height: 128px;
    padding: 4px;
    .fitness-device__avatar { width: 44px; height: 44px; }
  }
}
```

(Tune values until all 5+ cards fit without scrolling.)

**Step 3: Manual verification at multiple counts**

- 3 users → `card-compact` NOT applied → normal size
- 5 users → `card-compact` applied → no scrollbar on users list container
- 7 users → still no scrollbar

**Step 4: Commit**

```bash
git commit -m "feat(fitness/users): compact card layout for lists of 5+ users"
```

---

### Task 5.3: Investigate zone progress hysteresis + sort

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx:628-656`
- Reference: `frontend/src/hooks/fitness/types.js:265-366`, `frontend/src/hooks/fitness/ZoneProfileStore.js`

**Key insight from exploration + user:** The current code already calls `lookupZoneProgress(name)?.progress` at line ~648 as the secondary sort. User reports that the rendered progress bars don't always match the current HR — this might not be a pure formula bug, but a **hysteresis / stale-state** issue. Candidates:

- `progress` is HR %, but the snapshot is updated on a slower cadence than the HR readout → bars lag by a tick
- There's a zone-edge hysteresis band (e.g. "don't change zone unless HR crosses boundary by N bpm for M seconds") that keeps the user visually "in" a zone they've already exited on the numeric HR readout
- `progress` is something different entirely (time-in-zone % rather than HR-in-zone %)

Investigation must look at BOTH the sort key AND the bar source data, since the FRD goal is "top-of-zone user = closest to next zone = fullest bar".

**Step 1: Audit `progress` + trace snapshot update cadence**

Read `types.js:265-366` (zone snapshot) and `ZoneProfileStore.js`. Identify:
1. The formula behind `progress` — is it HR-in-zone % or something else (time-in-zone %, averaged HR)?
2. The update cadence — is the snapshot recomputed on every HR sample, or throttled/debounced?
3. Any hysteresis logic — search `ZoneProfileStore.js` for `hysteresis`, `dwell`, `sticky`, `debounce`, `lastZone`, `previousZone` that might keep a user visually "in" a zone after HR has moved on.
4. Whether the sort reads a different data source than the bar renderer (if so, they will disagree).

Three outcomes:
- **A.** `progress` is correct HR-%, updates live, no hysteresis → confirm with a test; no code change.
- **B.** `progress` is time-based or otherwise not HR-% → compute HR-% locally in the sort AND in the bar renderer so both agree; prefer a single shared helper.
- **C.** Hysteresis is the culprit (bars lag / stick) → either remove the hysteresis, or expose both "displayed zone" (sticky) and "live HR %" and sort by the live one while bars render from live too.

**Step 2: Write the failing test**

```javascript
// frontend/src/modules/Fitness/player/panels/FitnessUsers.test.js
describe('FitnessUsers sorting', () => {
  it('sorts two users in the same zone by HR-within-zone %, not raw BPM', () => {
    // user A: HR=155, zone floor=150, ceiling=170  → pct = 0.25
    // user B: HR=152, zone floor=140, ceiling=160  → pct = 0.60
    const sorted = sortUsersByHrPct([userA, userB]);
    expect(sorted.map(u => u.id)).toEqual([userB.id, userA.id]);
  });
});
```

Refactor inline `.sort((a,b) => ...)` at line 628-656 into a named, exported helper so it is testable.

**Step 3: Run — expect fail if outcome B; pass if outcome A.**

**Step 4: Implement (outcomes B/C as determined in Step 1)**

Depending on outcome:
- **B:** Compute HR % in-line:
  ```javascript
  const hrPct = (user) => {
    const snap = lookupZoneProgress(user.name);
    if (!snap) return 0;
    const { hr, floor, ceiling } = snap;
    if (!(ceiling > floor)) return 0;
    return Math.max(0, Math.min(1, (hr - floor) / (ceiling - floor)));
  };
  ```
  Replace the secondary sort key to use `hrPct(a)` / `hrPct(b)`.
- **C:** Reduce or remove the hysteresis dwell time; or expose a `hrPctLive` alongside the sticky display. Update both sort AND bar renderer to read the live value.

**Step 5: Run — expect pass.**

**Step 6: Manual verification**

- With 2+ users in the same zone but different HRs relative to their personalized zone bands, confirm the user closer to jumping into the next zone renders at the top of the zone group
- Visual sanity: the ordering matches the progress-bar fill levels shown on each card (bars must match sort — they should be reading from the same source)

**Step 7: Commit**

```bash
git commit -m "feat(fitness/users): HR-within-zone % sort matches progress bars

Root cause: <fill in once found — hysteresis / wrong formula / etc>"
```

---

## Wrap-up

### Task 6: Merge back to main

**Step 1: Test sweep**

```bash
npm run lint
npx vitest run frontend/src/modules/Fitness
npx playwright test tests/live/flow/fitness/ --reporter=line
```

All green before merging.

**Step 2: Return to main and merge**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git merge --no-ff feature/fitness-frd-q2
```

(User preference per CLAUDE.md: direct merge into main, no PR. User reviews before committing the merge themselves.)

**Step 3: Clean up worktree**

```bash
git worktree remove ../DaylightStation-fitness-frd-q2
# Log deleted branch to docs/_archive/deleted-branches.md
git branch -d feature/fitness-frd-q2
```

---

## Checklist for the executing agent

- [ ] Task 0: Worktree created, baseline clean
- [ ] Task 1.2: Voice memo cancel bug fixed + test
- [ ] Task 1.1: Retroactive voice memo button on Session Details
- [ ] Task 2.1: Settings menu auto-close + ack flash
- [ ] Task 2.2: Player pop-out 15s inactivity collapse
- [ ] Task 3.1: Lock icon — investigated, fixed if needed
- [ ] Task 3.2: Centralized `formatFitnessDate` + 6 call sites migrated
- [ ] Task 4.1: Backend `/session/:id/end` + `mergeSessions` guard + End Session button
- [ ] Task 4.2: Play vs. Scroll — verified, regression test added
- [ ] Task 5.1: Challenge overlay squares white
- [ ] Task 5.2: User card `card-compact` at 5+
- [ ] Task 5.3: HR-within-zone % sort + hysteresis audit
- [ ] Full test sweep passes
- [ ] Merge to main (with user approval)
