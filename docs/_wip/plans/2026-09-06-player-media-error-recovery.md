# Player Media-Error Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Player's recovery ladder fire when the media element hard-errors mid-playback, not just when it starves.

**Architecture:** `usePlaybackHealth` gains an `error` listener and exposes a `hasMediaError` signal; `useMediaResilience` (which already calls `usePlaybackHealth` at line 148) adds that signal as a fourth cause in its `isStuck` predicate. No new hooks, no new wiring between components — the signal rides the pipe that already exists.

**Tech Stack:** React hooks, Vitest 4 + `@testing-library/react` (`renderHook`/`act`), the shared `makeFakeEl` test double.

---

## Background: the incident this fixes

2026-09-03. A proxied audio item (`plex:<id>`) stopped 17:17 into a 23:19 track and never resumed. The app container (`{env.docker_container}`) was recreated mid-stream about 35 seconds earlier (a deploy); since `mediaUrl` is a **proxied** URL served by that container (`Playable.mjs:18`, `PlayResponseService.mjs:95-121`), the HTTP body feeding the `<audio>` element died. Chromium raised `PIPELINE_ERROR_READ: FFmpegDemuxer: data source error` (`MEDIA_ERR_NETWORK`, code 2) and paused the element.

The backend was back 9 seconds later. Nothing tried again for 5 minutes, until a human re-dispatched from the Shield.

**Verified root cause** — `useMediaResilience.js:613`:

```js
const isStuck = hasEverPlayedRef.current && !isUserPaused && !clockAdvancing && !atEnd
  && (isStalled || isBuffering || effectiveSeeking);
```

Four of the five conjuncts were satisfied. The fifth never came: `isStalled`, `isBuffering` and `effectiveSeeking` are all **starvation** signals, meaning "the element wants more data and is waiting". A dead pipeline is not waiting — Chromium fires `error` + `pause`, and does **not** fire `waiting` or `stalled`. Grepping all 878 lines of `useMediaResilience.js` for `el.error` / `MEDIA_ERR` / `.error` returns zero hits: the hook is structurally blind to media errors.

Three other detectors missed it for three unrelated reasons, which is why nothing else caught it either:

| Detector | Why it missed |
|---|---|
| `useMediaErrorReporter` — the only `'error'` listener in Player | Inert: line 40 returns before attaching because `onError` is undefined on this path (only `DancePartyWidget.jsx` passes it, at both its call sites) |
| `usePlaybackHealth` | Listens for `waiting`/`playing`/`pause`/`stalled`/`ended` (lines 419-424) — no `error` listener |
| `useCommonMediaController` stall detector | `if (mediaEl.paused) return; // Don't stall-check while paused` (line 585) — an errored element is paused |

Evidence the silence was real, not dropped telemetry: the client emitted `menu-perf.snapshot` every 5s with no gap across the whole window, and its WebSocket reconnected ~40s after the pause.

---

## Design decisions (and their rationale)

**1. The signal lives in `usePlaybackHealth`, not a new hook.**
`useMediaResilience.js:148` already calls `usePlaybackHealth`. Adding the signal there means it reaches the ladder with no prop threading and covers audio *and* video in one change.

**2. Only transient error codes arm the ladder: `MEDIA_ERR_NETWORK` (2) and `MEDIA_ERR_DECODE` (3).**
Excluded on purpose:
- `MEDIA_ERR_ABORTED` (1) — raised by our *own* teardown and `load()` calls (`useMediaReporter.hardResetMedia` calls `mediaEl.load()`). Jolting on our own abort is a feedback loop.
- `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) — an unplayable file. Re-minting the URL cannot help; it would just burn the ledger cap.

The incident was code 2.

**3. We deliberately do NOT wire `onError` through `ScreenPlayer`.**
`onError` is consumed by `useQueueController` (`Player.jsx:161`), where it means *"this content is unplayable, give up"* — the `empty-queue` branch calls `clear()` (`useQueueController.js:253-259`). Firing that on a transient proxy blip would **abandon the book** rather than resume it — strictly worse than today's silence. Telemetry instead comes from `logHealthEvent` inside the health hook, which we already have.

`useMediaErrorReporter` stays dead code for now. Deleting it is out of scope; note it and move on.

**4. The error signal MUST clear, or the ladder stays armed forever.**
If `hasMediaError` latches true, `isStuck` never goes false, the ladder burns both rungs plus the ledger cap, and the player lands in `exhausted`. It clears on `playing` (the element recovered) and on element re-attach (a remount gave us a fresh element).

**4a. Task 3 GATES Task 4. Do not reorder them.** (Established during Task 1 review, 2026-09-06.)
Task 1's re-seed clearing covers only the *remount* rung. Ladder rung 0 — `stall-jolt-refresh-url` (`stallJolt.js:32`, `forceRemount: false`) — does an **in-place** `hardReset`: it appends `?_refresh=<ts>` to the src on the *same* element, and `Player.jsx:1024` short-circuits before any React remount on purpose, so Firefox does not lose the gesture chain after 3-4 cycles. Same element, same `waitKey`, no `elementGeneration` bump, therefore **no re-seed** — a latched `errorCode` survives a rung-0 recovery that actually worked. `handlePlaying` clearing (Task 3) is the only thing that catches that path. It is a hard prerequisite, not a nicety.

**4c. Rung 0 forks by media type, and each branch is closed by a different task.** (Traced during Task 3 review, 2026-09-06.)
- **Video / dash** takes the in-place branch. `VideoPlayer.jsx:363-378` registers `hardReset`, so `Player.jsx:989` finds it, and the `hardResetInvoked && !forceRemount` short-circuit at `Player.jsx:1024` returns before any remount. No re-seed. **Task 3's `handlePlaying` clearing is the only thing that closes this.** `playing` is guaranteed on success: `VideoPlayer.jsx:351-353` calls `load()` unconditionally, which forces `readyState` to `HAVE_NOTHING`, so any resumption must climb back through `HAVE_FUTURE_DATA` and queue `playing`. The "already playing, only the src changed" hazard cannot arise.
- **Audio** never takes it. `AudioPlayer.jsx:89-93` registers only `{ getMediaEl, fetchVideoInfo }` — no `hardReset` — so rung 0 falls through to `scheduleSinglePlayerRemount`, `elementGeneration` bumps, and **Task 1's re-seed** clears the code.

Note the irony worth remembering: the incident's own media type (an audiobook) does not take the in-place path at all. Both branches are covered, one per task, with no gap between them.

The one case where `playing` never fires is `play()` rejecting with `NotAllowedError` (`VideoPlayer.jsx:355-359`) — the garage Firefox kiosk autoplay gate. There the code stays latched, but playback did not resume, so keeping the ladder armed is correct behavior rather than a defect.

**4b. `hasMediaError` goes INSIDE the `!clockAdvancing` conjunct.**
In Task 4 it must be added as another disjunct in the `(isStalled || isBuffering || effectiveSeeking)` group — never as a standalone top-level term. Keeping it under `!clockAdvancing` means a moving clock always wins over a latched code, whatever else is true.

**Honest status: this is a convention, not a demonstrated fix.** The final review's mutation battery killed 7 of 8 mutants; hoisting `hasMediaError` out of the conjunct was the one **survivor** — 589/589 still green. That reviewer then argued the failure it guards against is unreachable, and the argument holds: `clockAdvancing` requires the advance poll to see `currentTime` move on a non-paused element, which requires playback to have resumed, which fires `playing` — and `playing` clears `errorCode` in the same listener effect on the same element. One event settles both conditions, so there is no window where the code is latched while the clock advances.

Keep the placement anyway: it is defence in depth and it costs nothing. But do not write a test for it — that would mean fabricating a state the system cannot enter, which is worse than the gap. An earlier draft of this entry claimed the hoist "parks the player in `exhausted`"; no test can express that, and it should not be restated as a proven consequence.

**4d. The fix must not depend on `isPaused` being stale. Guard the user-intent classification with the error.** (Found in Task 4 review, confirmed 2026-09-06.)

> **Superseded in detail by Task 5's narrowing — read this whole entry before acting on it.** The guard shipped as `&& !mediaErrorStoppedPlayback`, NOT the `&& !hasMediaError` this entry first prescribed. The broad form was implemented, then found to restart a track the user had paused when a deploy killed the stream (for audio, rung 0 remounts onto `<audio autoPlay>`). Applying the broad form today fails three tests. See the narrowing note at the end of this entry.

`useMediaResilience.js:340-343` hard-returns from the whole monitoring effect when `userIntent === paused`, and `isUserPaused` also kills `isStuck`. That intent is set at line 178 by `isPaused && pauseIntent !== 'system'`.

A Task 4 review probe established the consequence exactly:

| `isPaused` | `pauseIntent` | jolts? |
|---|---|---|
| `true` | `'system'` | yes |
| `true` | `null` | **no** |
| `true` | `'user'` | **no** |
| `false` | `null` | yes |

Now trace what the audio/video path actually supplies. `pauseIntent` is set **only** by `useMediaReporter`'s `classifyPauseIntent` — the one function that maps `mediaEl.error` to `'system'` — and `useMediaReporter` is imported by `ContentScroller` alone. `AudioPlayer` and `VideoPlayer` report through `SinglePlayer.jsx:166-173`, which forwards `isPaused` and **never sets `pauseIntent`**. So on the path that actually broke, `pauseIntent` is permanently `null`.

The fix therefore works today only because of the second half: `SinglePlayer`'s metrics come from `handleProgress`, whose sole emit site is `onTimeUpdate` (`useCommonMediaController.js:874-889`). `timeupdate` stops when the element errors and pauses, so the last reported value is `isPaused: false` from while it was still playing. Stale-false is what keeps `isStuck` reachable.

That is a browser-timing accident, not a design. If a `timeupdate` lands after `el.paused` flips true, or if someone later wires pause-driven metrics for Audio/Video — an obviously reasonable-looking improvement — `isPaused` becomes `true`, `pauseIntent` is still `null`, and the ladder silently stops arming. We would be back to the original bug with all the tests still green, because the existing test pins `isPaused: false`.

Close it at the source: the classification at line 178 must not call a pause "the user's" when the element is sitting on a media error.

```js
} else if (isPaused && pauseIntent !== 'system' && !mediaErrorStoppedPlayback) {
```

**The narrowing, and why the flag is `mediaErrorStoppedPlayback` and not `hasMediaError`.**

The first implementation used the broad `!hasMediaError`. It was wrong, and the test that caught it is now in the suite: if the element errors while the user *already had it paused*, `userIntent` flips `paused → playing`, the ladder arms, and for audio rung 0 remounts onto `<audio autoPlay>` — a paused bedtime story restarts itself the next time a deploy kills the proxy. In this household deploys land every few minutes during an active session, so that is a routine event, and it is a worse failure than the bug being fixed.

So `usePlaybackHealth` distinguishes two things:

| Flag | Means | Consumed by |
|---|---|---|
| `hasMediaError` | a recoverable code (2 or 3) is latched | `isStuck` — so recovery still arms when the user presses play |
| `mediaErrorStoppedPlayback` | recoverable code **and** the error interrupted playback | the user-intent guard — so a track the user paused is never self-resumed |

`errorWhilePlaying` is captured in `handleError` and classified by the pause's **age**, not by event order: `mediaEl.paused !== true || parkedForMs <= ERROR_PAUSE_COINCIDENCE_MS` (500ms). Order was rejected deliberately — the browser dispatch order of `error` vs `pause` is unverified, and an order-based check would invert the whole of 4d on a pause-first browser with every test still green. The age uses a monotonic clock: with `Date.now()`, a backwards NTP step makes `parkedForMs` negative, satisfies the window, and resumes a long-paused track — exactly the regression this narrowing exists to prevent. All three properties are pinned by tests.

This makes the recovery path independent of which renderer reports metrics and of when `timeupdate` last fired. It is the same insight `classifyPauseIntent` already encodes (`mediaErrorPresent` → `'system'`), applied where every renderer benefits rather than only the scrollers.

**5. `hasEverPlayedRef.current` stays in the predicate.**
An error *during startup* is already owned by the startup-deadline path (`useMediaResilience.js:378-388`). Keeping the two paths separate avoids double-triggering.

---

## Risks to watch

- **DASH / transcode paths — OPEN, deliberately not closed by this work.** dash.js segment 404s are handled by the existing stale-transcode recovery. Whether dash.js sets `el.error` on such a 404 was **not determined**, and Task 5 shipped no DASH assertion — an earlier draft of this line claimed it did, which was wrong. What *is* established: the shared `recoveryLedger` gates every actor through one cooldown and one session cap (`useMediaResilience.js:687-717`), and a denied request re-checks the same rung rather than advancing it, so a concurrent stale-transcode recovery and a media-error jolt would serialise rather than double-fire. That bounds the blast radius; it does not prove the trigger never doubles. Left open on purpose rather than papered over with a test that would only restate our assumptions about a library we did not measure.
- **Do NOT write a test asserting "rung 1 never fires."** (Established in Task 3 review.) During an in-place rung-0 recovery the window between `load()` and `playing` holds `hasMediaError` true with `clockAdvancing` false, so `isStuck` stays true across `STALL_JOLT_STEP_MS` (6s) and rung 1 legitimately fires if the fresh transcode takes longer than that to start. This is identical to existing stall behavior — `isBuffering` also only clears at `playing` — so it is not a regression this signal introduces. Task 5's exhaustion test asserts that the ladder *terminates*, which is true; asserting that it never escalates would be asserting something false.
- **Unbounded retry.** Already bounded: `recoveryLedger` caps total recoveries per session and `STALL_JOLT_LADDER` has only two rungs (`stallJolt.js:31-34`).
- **Base branch.** Verified 2026-09-06: the `{env.prod_host}` deploy tree is 5 commits ahead of `origin/main`, but **none of those 42 changed files touch `modules/Player` or `lib/Player`**. Local `main` is a safe base.

## Before you start

```bash
cd <repo root>
git checkout -b fix/player-media-error-recovery
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.test.jsx
```

Expected: `Test Files 1 passed (1)` / `Tests 7 passed (7)`. That is your green baseline.

---

### Task 1: `usePlaybackHealth` observes the `error` event

**Files:**
- Create: `frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx`
- Modify: `frontend/src/modules/Player/hooks/usePlaybackHealth.js` (`DEFAULT_SIGNALS` line 38; handlers ~line 400; listeners ~line 419; cleanup ~line 443)

**Step 1: Write the failing test**

Create `frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../lib/playbackLogger.js', () => ({
  playbackLog: vi.fn(),
  default: vi.fn()
}));

vi.mock('../../../lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: function () { return this; }
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

import { usePlaybackHealth } from './usePlaybackHealth.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';

describe('usePlaybackHealth — media errors', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('surfaces the error code when the element hard-errors mid-playback', () => {
    // The 2026-09-03 shape: healthy buffer, playing fine, then the proxy dies.
    const el = makeFakeEl({ currentTime: 1037.93, duration: 1399.11, paused: false });
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 1037.93, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    expect(result.current.elementSignals.errorCode).toBe(null);

    // Chromium sets el.error, then fires 'error'. It does NOT fire waiting/stalled.
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });

    expect(result.current.elementSignals.errorCode).toBe(2);
  });

  it('removes the error listener on cleanup', () => {
    const el = makeFakeEl();
    const { unmount } = renderHook(() =>
      usePlaybackHealth({ seconds: 0, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );
    expect(el._count('error')).toBe(1);
    unmount();
    expect(el._count('error')).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
```

Expected: FAIL — `expected undefined to be null` (there is no `errorCode` key yet) and `expected 0 to be 1` for the listener count.

**Step 3: Write minimal implementation**

In `usePlaybackHealth.js`, add `errorCode` to `DEFAULT_SIGNALS` (line 38-47):

```js
const DEFAULT_SIGNALS = Object.freeze({
  waiting: false,
  stalled: false,
  playing: false,
  paused: false,
  ended: false,
  buffering: false,
  readyState: null,
  networkState: null,
  // MediaError.code from the last 'error' event, or null when healthy. A dead
  // pipeline fires 'error' + 'pause' and NOTHING else — no waiting, no stalled —
  // so this is the only signal that distinguishes it from a deliberate pause.
  errorCode: null
});
```

Add the handler next to `handleEnded` (~line 409):

```js
    const handleError = () => {
      // Read from the element, not the event: that is where the spec puts it,
      // and it is what Chromium leaves behind for a mid-playback pipeline error.
      const code = mediaEl?.error?.code ?? null;
      safeUpdate({ errorCode: code, playing: false });
      logHealthEvent('media-error', {
        errorCode: code,
        errorMessage: mediaEl?.error?.message ?? null,
        currentTime: sampleCurrentTime()
      }, { level: 'warn' });
    };
```

Register it alongside the others (~line 419) and remove it in the cleanup (~line 443):

```js
    mediaEl.addEventListener('error', handleError);
```
```js
      mediaEl.removeEventListener('error', handleError);
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
```

Expected: PASS — `Tests 2 passed (2)`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/usePlaybackHealth.js \
        frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
git commit -m "feat(player): usePlaybackHealth observes the media error event

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017g9Y7bFoRjMfKvsEVL1YAR"
```

---

### Task 2: `hasMediaError` exposes only the *transient* codes

**Files:**
- Modify: `frontend/src/modules/Player/hooks/usePlaybackHealth.js` (return block ~line 510-526)
- Modify: `frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx`

**Step 1: Write the failing test**

Append inside the existing `describe` block:

```jsx
  it.each([
    [2, true,  'MEDIA_ERR_NETWORK — the proxy died, re-minting can fix it'],
    [3, true,  'MEDIA_ERR_DECODE — a corrupt read, a fresh stream can fix it'],
    [1, false, 'MEDIA_ERR_ABORTED — WE aborted it (hardReset calls load())'],
    [4, false, 'MEDIA_ERR_SRC_NOT_SUPPORTED — unplayable, retrying is pointless'],
  ])('code %i -> hasMediaError %s (%s)', (code, expected) => {
    const el = makeFakeEl({ currentTime: 10, paused: false });
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 10, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    act(() => { el.error = { code }; el._fire('error'); });

    expect(result.current.hasMediaError).toBe(expected);
  });
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
```

Expected: FAIL on all four rows — `expected undefined to be true` / `expected undefined to be false` (`hasMediaError` does not exist).

**Step 3: Write minimal implementation**

Above the hook (near `DEFAULT_SIGNALS`) add:

```js
/**
 * MediaError codes worth a recovery attempt. 1 (ABORTED) is raised by our own
 * teardown/`load()` calls, and 4 (SRC_NOT_SUPPORTED) means the media is simply
 * unplayable — jolting either one only burns the recovery ledger.
 */
const RECOVERABLE_MEDIA_ERROR_CODES = Object.freeze([2, 3]);
```

In the return block (~line 519), add the derived flag:

```js
    isWaiting: Boolean(elementSignals.waiting || elementSignals.buffering),
    isStalledEvent: Boolean(elementSignals.stalled),
    // A fatal, retryable pipeline error. Distinct from isWaiting/isStalledEvent:
    // those mean "starved and waiting for data", this means "the pipeline is dead".
    hasMediaError: RECOVERABLE_MEDIA_ERROR_CODES.includes(elementSignals.errorCode),
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
```

Expected: PASS — `Tests 6 passed (6)`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/usePlaybackHealth.js \
        frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
git commit -m "feat(player): hasMediaError exposes only retryable media error codes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017g9Y7bFoRjMfKvsEVL1YAR"
```

---

### Task 3: the error signal clears on recovery

Without this, `isStuck` latches true forever, the ladder burns both rungs plus the ledger cap, and the player parks in `exhausted`. This task is not optional.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/usePlaybackHealth.js` (`handlePlaying` ~line 401)
- Modify: `frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx`

**Step 1: Write the failing test**

Append inside the existing `describe` block:

```jsx
  it('clears the error once the element plays again', () => {
    const el = makeFakeEl({ currentTime: 10, paused: false });
    const { result } = renderHook(() =>
      usePlaybackHealth({ seconds: 10, getMediaEl: () => el, waitKey: 'k1', mediaType: 'audio' })
    );

    act(() => { el.error = { code: 2 }; el._fire('error'); });
    expect(result.current.hasMediaError).toBe(true);

    // A jolt re-minted the URL and the element started playing again.
    act(() => { el.error = null; el._fire('playing'); });

    expect(result.current.hasMediaError).toBe(false);
    expect(result.current.elementSignals.errorCode).toBe(null);
  });

  it('clears the error when a remount swaps in a fresh element', () => {
    const el1 = makeFakeEl({ currentTime: 10, paused: false });
    const el2 = makeFakeEl({ currentTime: 10, paused: false });
    const holder = { current: el1 };
    const { result } = renderHook(() =>
      usePlaybackHealth({
        seconds: 10, getMediaEl: () => holder.current, waitKey: 'k1', mediaType: 'audio'
      })
    );

    act(() => { el1.error = { code: 2 }; el1._fire('error'); });
    expect(result.current.hasMediaError).toBe(true);

    // The element-generation watcher re-binds to the new element.
    act(() => { holder.current = el2; vi.advanceTimersByTime(400); });

    expect(result.current.hasMediaError).toBe(false);
  });
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
```

Expected: FAIL — `expected true to be false` on both new tests; `errorCode` stays `2`.

**Step 3: Write minimal implementation**

In `handlePlaying` (~line 401), add `errorCode: null` to the patch:

```js
    const handlePlaying = () => {
      const sampledSeconds = sampleCurrentTime();
      safeUpdate({
        playing: true, waiting: false, stalled: false, buffering: false, paused: false,
        // The pipeline is alive again — a stale code would keep isStuck latched.
        errorCode: null
      });
      recordProgress('event', { details: 'playing', seconds: sampledSeconds });
      logHealthEvent('media-playing', { currentTime: sampledSeconds }, { level: 'debug' });
      updateBufferRunway();
    };
```

For the re-attach case, add `errorCode` to the initial-sync `safeUpdate` (~line 433) so binding to a new element resets it:

```js
    safeUpdate({
      paused: mediaEl.paused,
      playing: !mediaEl.paused && !mediaEl.ended,
      waiting: initialWaiting,
      stalled: false,
      // Adopt the NEW element's error state (normally none) rather than
      // inheriting the dead element's.
      errorCode: mediaEl.error?.code ?? null,
      ...readReadyNetworkState()
    });
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
npx vitest run frontend/src/modules/Player/hooks/usePlaybackHealth.test.jsx
```

Expected: `Tests 8 passed (8)` for the new file, and the original file still `Tests 7 passed (7)`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/usePlaybackHealth.js \
        frontend/src/modules/Player/hooks/usePlaybackHealth.mediaError.test.jsx
git commit -m "fix(player): clear the media-error signal on play and on element swap

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017g9Y7bFoRjMfKvsEVL1YAR"
```

---

### Task 4: `isStuck` treats a media error as a stuck cause

**Files:**
- Create: `frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx`
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:613`

**Step 1: Write the failing test**

This is the regression test for the incident. Create `frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { STALL_JOLT_GRACE_MS } from '../lib/stallJolt.js';

let fakeNow;

const installLedger = (opts = {}) => {
  fakeNow = 1_000_000;
  _setSharedLedgerForTests(createRecoveryLedger({ now: () => fakeNow, ...opts }));
};

const advance = (ms) => {
  fakeNow += ms;
  act(() => { vi.advanceTimersByTime(ms); });
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); _setSharedLedgerForTests(null); });

describe('useMediaResilience — a mid-playback media error is a stuck cause', () => {
  it('jolts when the pipeline dies with a healthy buffer and no waiting/stalled event', () => {
    // Reproduces the incident: 1037.93s of 1399.11s, 284.92s still
    // buffered ahead, MEDIA_ERR_NETWORK. Chromium fired error + pause and
    // nothing else, so every starvation signal stayed false.
    installLedger();
    const el = makeFakeEl({ currentTime: 1037.93, duration: 1399.11, paused: false });
    const onReload = vi.fn();

    const args = {
      onReload,
      onExhausted: vi.fn(),
      meta: { src: 'https://example.test/proxy/plex/stream/1', mediaKey: 'plex:1' },
      waitKey: 'test:media-error',
      playbackSessionKey: 'session-media-error',
      disabled: false,
      getMediaEl: () => el,
      seconds: 1037.93,
      isPaused: false,
      isSeeking: false,
      pauseIntent: null
    };

    const { rerender } = renderHook(() => useMediaResilience(args));

    // Establish "has ever played" — the ladder only arms mid-playback.
    act(() => { el._fire('playing'); });
    advance(1000);

    // The proxy dies. Note: NO 'waiting', NO 'stalled' — that is the whole point.
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });
    el.paused = true;
    rerender();

    expect(onReload).not.toHaveBeenCalled(); // ladder waits out its grace period

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(onReload).toHaveBeenCalled();
    // Rung 0 re-mints the stream URL — exactly right for a dead proxy connection.
    expect(onReload.mock.calls[0][0]).toMatchObject({ refreshUrl: true, forceRemount: false });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx
```

Expected: FAIL — `expected "spy" to be called at least once` after the grace period. `isStuck` is false because no starvation signal fired.

**Step 3: Write minimal implementation**

In `useMediaResilience.js`, just above `isStuck` (line 613), add the derived flag, then extend the disjunction:

```js
  // A fatal pipeline error is a FOURTH way to be stuck, and the only one that
  // produces no starvation signal at all: Chromium fires error + pause and never
  // fires waiting or stalled, so the three flags above all stay false. Without
  // this term the ladder sits idle while a dead proxy stream never resumes
  // (2026-09-03: a container redeploy killed the proxy mid-audiobook and the
  // player went silent for 5 minutes with 284s still buffered).
  const hasMediaError = playbackHealth.hasMediaError === true;

  const isStuck = hasEverPlayedRef.current && !isUserPaused && !clockAdvancing && !atEnd
    && (isStalled || isBuffering || effectiveSeeking || hasMediaError);
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx
```

Expected: PASS — `Tests 1 passed (1)`.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js \
        frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx
git commit -m "fix(player): a dead pipeline is stuck, not just a starved one

A fatal media error fires error+pause and nothing else, so isStuck's three
starvation signals all stayed false and the jolt ladder never armed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017g9Y7bFoRjMfKvsEVL1YAR"
```

---

### Task 5: prove the ladder terminates and DASH is unaffected

Guards the two risks named at the top: an unrecoverable error must not loop, and the transcode path must not double-trigger.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx`

**Step 1: Write the failing test**

Append inside the existing `describe` block:

```jsx
  it('does not jolt on MEDIA_ERR_SRC_NOT_SUPPORTED (retrying cannot help)', () => {
    installLedger();
    const el = makeFakeEl({ currentTime: 10, duration: 100, paused: false });
    const onReload = vi.fn();
    const args = {
      onReload, onExhausted: vi.fn(),
      meta: { src: 'https://example.test/stream/x', mediaKey: 'plex:x' },
      waitKey: 'test:unsupported', playbackSessionKey: 'session-unsupported',
      disabled: false, getMediaEl: () => el, seconds: 10,
      isPaused: false, isSeeking: false, pauseIntent: null
    };
    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);
    act(() => { el.error = { code: 4 }; el._fire('error'); });
    el.paused = true;
    rerender();
    advance(STALL_JOLT_GRACE_MS + 100);

    expect(onReload).not.toHaveBeenCalled();
  });

  it('stops after the ladder is exhausted when the error persists', () => {
    installLedger();
    const el = makeFakeEl({ currentTime: 10, duration: 100, paused: false });
    const onExhausted = vi.fn();
    const args = {
      onReload: vi.fn(), onExhausted,
      meta: { src: 'https://example.test/stream/y', mediaKey: 'plex:y' },
      waitKey: 'test:persistent', playbackSessionKey: 'session-persistent',
      disabled: false, getMediaEl: () => el, seconds: 10,
      isPaused: false, isSeeking: false, pauseIntent: null
    };
    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);
    act(() => { el.error = { code: 2 }; el._fire('error'); });
    el.paused = true;
    rerender();

    // Let the whole ladder + ledger cap play out; the error never clears.
    for (let i = 0; i < 12; i += 1) { advance(STALL_JOLT_GRACE_MS + 1000); rerender(); }

    expect(onExhausted).toHaveBeenCalled();
  });
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx
```

Expected: the code-4 test should already PASS (Task 2 excluded it). The exhaustion test may fail on iteration count or the `onExhausted` payload shape — tune the loop count / assertion against the real ledger cap, do not weaken it to `expect(true)`.

**Step 3: Adjust only if needed**

No production change is expected here. If the exhaustion test fails, the fix belongs in the test's timing, not in the hook. If it reveals the ladder never exhausts, STOP — that is a real bug and needs its own investigation before proceeding.

**Step 4: Run the whole Player hook suite**

```bash
npx vitest run frontend/src/modules/Player/hooks/
```

Expected: all files pass, including the pre-existing `useMediaResilience.*`, `useCommonMediaController.*` and `usePlaybackHealth.test.jsx` suites. Any pre-existing test that now fails is a real regression — investigate, do not skip.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.mediaError.test.jsx
git commit -m "test(player): media-error recovery terminates and ignores unplayable media

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017g9Y7bFoRjMfKvsEVL1YAR"
```

---

### Task 6: document it

**Files:**
- Modify: `frontend/src/modules/Player/README.media-resilience.md`

**Step 1: Add a section**

Append after the existing "Stale Transcode Session Recovery" section:

```markdown
## Fatal Media-Error Recovery

A dead pipeline is not a stall. When the HTTP body behind `mediaUrl` dies —
the proxy that serves `/proxy/plex/stream/` going away mid-playback, say —
Chromium raises `PIPELINE_ERROR_READ`, sets `MediaError.code = 2`, fires
`error` and `pause`, and fires **nothing else**. No `waiting`. No `stalled`.
The buffer can still report hundreds of seconds cached ahead.

That made the failure invisible to `isStuck`, whose other three causes
(`isStalled`, `isBuffering`, `effectiveSeeking`) are all starvation signals.
On 2026-09-03 a container redeploy killed the proxy 17 minutes into an
audiobook; the player sat silent for five minutes with 284s buffered until a
human re-dispatched it. The backend had been back after 9 seconds.

`usePlaybackHealth` now listens for `error` and exposes `hasMediaError`, and
that is the fourth cause in `isStuck`. Rung 0 of the jolt ladder re-mints the
stream URL, which is the correct response to a dead proxy connection.

Only codes 2 (`NETWORK`) and 3 (`DECODE`) arm it. Code 1 (`ABORTED`) is raised
by our own `hardResetMedia`'s `load()` call and would feed back on itself;
code 4 (`SRC_NOT_SUPPORTED`) means retrying cannot help.

The signal clears on `playing` and on element re-attach. It must — a latched
`hasMediaError` would hold `isStuck` true, burn both rungs and the ledger cap,
and park the player in `exhausted`.

**Known gap, deliberately left:** `useMediaErrorReporter` is the only `'error'`
listener in `Player.jsx` and it is inert — it returns before attaching unless an
`onError` prop is supplied, and the only caller that supplies one is
`DancePartyWidget.jsx:200`. Wiring it through `ScreenPlayer` would be wrong as
things stand: `onError` feeds `useQueueController`, where it means "this content
is unplayable, give up" and calls `clear()`. Firing that on a transient blip
would abandon the item instead of resuming it.
```

**Step 2: Verify the docs marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/README.media-resilience.md docs/docs-last-updated.txt
git commit -m "docs(player): record fatal media-error recovery and the onError gap

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017g9Y7bFoRjMfKvsEVL1YAR"
```

---

## Verification before calling it done

REQUIRED SUB-SKILL: use `superpowers:verification-before-completion`.

```bash
npx vitest run frontend/src/modules/Player/
npm run check:parse
```

Both must pass. Then, because this is a kiosk path that cannot be unit-tested end to end, do one live check — **stop the running dev server first; never start a second backend** (see `CLAUDE.local.md`: a second instance makes real Home Assistant calls and fights for device authority):

1. Start one stack from this branch.
2. Play any Plex audio item in the browser.
3. Restart the backend mid-playback.
4. Expect a `resilience-*` jolt in the log store within ~`STALL_JOLT_GRACE_MS` and playback resuming on its own:

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_time:10m AND data.event:("media-error" OR "stall-jolt-refresh-url")' -d 'limit=20'
```

That query returning rows is the proof this plan was worth writing — today it returns nothing, because the event was never emitted.

**Note the field.** `logHealthEvent` routes through `playbackLog('playback-health', { event })`, so the log store's `_msg` is `playback.playback-health` for every health event and the discriminator is `data.event`. A bare-word LogsQL term searches `_msg` only, so the obvious `query="media-error"` matches nothing — an earlier draft of this section had exactly that bug, which would have made the verification step look like a failed fix.

## Named follow-up: retire the pause-age heuristic by plumbing pause provenance

**The durable fix for two separate weaknesses this plan leaves behind.** (Identified in the Task 4b review, 2026-09-06.)

Decision 4d's guard has to answer "did this error stop playback, or was it already stopped?", and it currently answers by *timing*: `ERROR_PAUSE_COINCIDENCE_MS = 500`, because the dispatch order of `error` vs `pause` is not verified in any browser. That works and is tested, but it is an inference.

The repo already has the non-inferential signal. `playbackToggleSource.js:50`'s `readAndClearPauseSource(el)` tags pause provenance, and `useCommonMediaController.js:1252` already consumes it. A pause our own transport initiated is *knowable*, with no window.

Plumbing it into `usePlaybackHealth` would:
1. **Retire the heuristic** — no window, no clock, no ordering assumption.
2. **Close the audio-path recovery gap** (below), because a play *intent* is observable even when playback cannot start.

It touches `useCommonMediaController` and `SinglePlayer`, so it was correctly out of scope here. It is the right next piece of work on this seam.

### The audio-path gap this plan does not close

`useMediaResilience` reads `isPaused` from `playbackMetrics`, written for audio/video only by `SinglePlayer.jsx:167` ← `handleProgress` ← `onTimeUpdate` (`useCommonMediaController.js:874-889`, the sole emit site — the `play`/`pause` listeners at `:1249`/`:1270` are pure telemetry). A dead pipeline cannot fire `timeupdate`.

Consequence: if the user pauses and *then* the stream dies, `isPaused` freezes at `true`. Pressing play cannot unfreeze it, because unfreezing requires the playback that is broken. `userIntent` stays `paused`, the monitoring effect hard-returns at `useMediaResilience.js:340-343`, and the ladder never arms — the item must be re-dispatched.

This is the status quo for that narrow case rather than a regression, and it is the deliberate cost of not self-resuming a paused track (which for audio would remount onto `<audio autoPlay>` and restart a bedtime story after a deploy). It does **not** apply to ContentScroller, where `useMediaReporter.js:423-424` emits metrics from the `play`/`pause` listeners and `isPaused` flips correctly.

Recorded because an earlier draft of decision 4d claimed recovery here was merely "deferred, not lost." On the audio path — the path the incident happened on — it is lost until re-dispatch. Do not let that claim back into the tree without the pause-provenance work above.

## Out of scope

- Deleting or rewiring `useMediaErrorReporter` (documented in Task 6 instead).
- `AudioPlayer.jsx` never calling `resilienceBridge.onPlaybackMetrics` despite declaring it in PropTypes (line 325), which leaves `seconds`/`isPaused`/`isSeeking`/`pauseIntent` frozen at defaults for all audio. It did not cause this outage — `isPaused` staying false actually kept `isUserPaused` false, which helped — but the resilience hook runs half-blind on every audiobook. Worth its own plan.
- Draining the container before a deploy so playback is never cut mid-stream. That is the other half of the 2026-09-03 incident and belongs to the deploy pipeline, not the Player.
