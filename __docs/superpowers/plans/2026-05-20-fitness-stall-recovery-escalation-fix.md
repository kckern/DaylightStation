# Fitness Stall-Recovery Escalation Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fitness video player's stall recovery actually escalate (nudge → reload → terminal) instead of nudge-looping forever, and prove it with an integration test plus live-log verification.

**Architecture:** The active recovery system is `useCommonMediaController.js`. Its `markProgress()` previously treated *every* `timeupdate` as progress, so the recovery nudge's own micro-seek (`currentTime -= 0.001`) and DASH buffer pokes were misread as "recovered" — clearing the stall and resetting the escalation counter before `reload` could run. The fix gates progress on genuine forward motion via a new pure helper `evaluatePlayheadProgress()`. A second, never-firing detector (`usePlayheadStallDetection`) is retired, and the governance "pause penalty timers during a stall" signal it was supposed to emit is rewired off the live resilience state.

**Tech Stack:** React hooks, vitest (`*.test.jsx` co-located, run via `npx vitest run`), `@testing-library/react`, structured logging framework (`frontend/src/lib/logging/Logger.js`).

---

## Background: changes already in the working tree (verified at unit level)

These edits are **already applied and unit-tested** (the `playheadProgress` predicate test is green; full frontend suite passes with 0 test failures). They are documented here so the plan stands alone. Tasks 1–3 below are the remaining hardening/verification work.

**1. New pure helper — `frontend/src/modules/Player/lib/playheadProgress.js`:**

```js
export const PROGRESS_EPSILON = 0.05;

export function evaluatePlayheadProgress(pos, lastAdvancePos, epsilon = PROGRESS_EPSILON) {
  if (pos == null || Number.isNaN(pos)) {
    return { advanced: false, nextPos: lastAdvancePos ?? null };
  }
  if (lastAdvancePos == null) {
    return { advanced: true, nextPos: pos };
  }
  if (pos > lastAdvancePos + epsilon) {
    return { advanced: true, nextPos: pos };
  }
  if (pos < lastAdvancePos) {
    return { advanced: false, nextPos: pos };
  }
  return { advanced: false, nextPos: lastAdvancePos };
}
```

Its unit test lives at `frontend/src/modules/Player/lib/playheadProgress.test.js` (7 cases: first tick, forward, nudge-backward, frozen, sub-epsilon jitter, reload-seekback-then-advance, null/NaN).

**2. `frontend/src/modules/Player/hooks/useCommonMediaController.js`:**
- Imports the helper: `import { evaluatePlayheadProgress } from '../lib/playheadProgress.js';`
- Adds `lastAdvancePos: null` to the `stallStateRef` initial object.
- `markProgress()` now reads the media position, calls `evaluatePlayheadProgress(pos, s.lastAdvancePos)`, stores `nextPos`, and **returns early when `!advanced`** — so the heartbeat (`lastProgressTs`) and the stall-clear/`recovery-resolved`/counter-reset block only run on genuine forward progress.
- The media-load reset block (near "Reset ended flag for new media") sets `stallStateRef.current.lastAdvancePos = null` so each new item re-baselines.

**3. `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`:**
- Removed the import and call of `usePlayheadStallDetection` (dead hook — emitted nothing in any session).
- Added an effect that emits `playback:stalled` / `playback:recovered` app events on the `resilienceState?.stalled` edge, so `GovernanceEngine._pauseTimers/_resumeTimers` engage during real stalls (previously the only emitter never fired):

```jsx
const prevResilienceStalledRef = useRef(false);
useEffect(() => {
  const stalled = Boolean(resilienceState?.stalled);
  if (stalled === prevResilienceStalledRef.current) return;
  prevResilienceStalledRef.current = stalled;
  const info = {
    mediaKey: resolveContentId(resilienceState?.meta || currentItem),
    status: resilienceState?.status || null
  };
  emitAppEvent?.(stalled ? 'playback:stalled' : 'playback:recovered', info, 'fitness-player');
}, [resilienceState?.stalled, resilienceState?.status, currentItem, emitAppEvent]);
```

**4. Deleted `frontend/src/modules/Player/hooks/usePlayheadStallDetection.js`** (504 lines, no remaining importers).

---

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `frontend/src/modules/Player/lib/playheadProgress.js` | Pure progress predicate | Done |
| `frontend/src/modules/Player/lib/playheadProgress.test.js` | Predicate unit tests | Done |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | Gate `markProgress` on real advance | Done |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Retire dead hook, rewire governance signal | Done |
| `frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx` | **Integration test: escalation + resolve gating through the real hook** | **Task 1 (NEW)** |

---

### Task 1: Integration test — escalation wiring + resolve gating

Proves through the **real `useCommonMediaController` hook** (rendered via a harness with a stubbed media element) that: (a) recovery escalates `nudge → reload → terminal`, and (b) `playback.recovery-resolved` fires **only** on genuine forward advance, never on a frozen/non-advancing `timeupdate`. This is the regression guard the unit predicate test cannot cover (it exercises the hook's counter + timers, not just the decision).

The harness mechanics below are **verified working** (spiked green before this plan was written): the hook returns `containerRef`, which the harness attaches to a stub video; `getMediaEl()` then returns that stub because it has no `shadowRoot`. Recovery is driven deterministically via the `onController` recovery API (`recovery.attemptNext()`); the soft-stall path uses fake timers.

**Files:**
- Create: `frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx`

- [ ] **Step 1: Write the test file**

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../lib/logging/Logger.js';

// A stubbed media element getMediaEl() will accept: no shadowRoot, so the hook
// treats the container itself as the media element.
function makeFakeVideo({ currentTime = 100, duration = 1000 } = {}) {
  const listeners = {};
  const el = {
    _ct: currentTime,
    duration,
    paused: false,
    ended: false,
    readyState: 4,
    networkState: 2,
    shadowRoot: null,
    buffered: { length: 1, start: () => 0, end: () => duration },
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(),
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
    removeEventListener: (t, cb) => { listeners[t] = (listeners[t] || []).filter(f => f !== cb); },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 }),
    fire: (t) => { (listeners[t] || []).forEach(cb => cb({ type: t })); }
  };
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

function Harness({ ctrlRef, video, stallConfig }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:1', title: 'T' },
    isVideo: true,
    stallConfig,
    onController: (c) => { ctrlRef.current = c; }
  });
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

describe('useCommonMediaController stall escalation', () => {
  let events;
  beforeEach(() => {
    events = [];
    const child = {
      info: (e, d) => events.push([e, d]),
      warn: (e, d) => events.push([e, d]),
      error: (e, d) => events.push([e, d]),
      debug: () => {},
      sampled: () => {}
    };
    vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...child, child: () => child, sampled: () => {} });
  });
  afterEach(() => vi.restoreAllMocks());

  it('escalates nudge -> reload -> terminal (no infinite nudge loop)', () => {
    const ctrlRef = { current: null };
    const video = makeFakeVideo();
    render(<Harness ctrlRef={ctrlRef} video={video} stallConfig={{ recoveryStrategies: ['nudge', 'reload'] }} />);
    expect(ctrlRef.current).toBeTruthy();
    expect(ctrlRef.current.getMediaEl()).toBe(video);

    act(() => { ctrlRef.current.recovery.attemptNext(); });
    act(() => { ctrlRef.current.recovery.attemptNext(); });

    const strategies = events.filter(([e]) => e === 'playback.recovery-strategy').map(([, d]) => d.strategy);
    const terminal = events.filter(([e]) => e === 'playback.recovery-terminal');
    expect(strategies).toEqual(['nudge', 'reload']);
    expect(terminal.length).toBe(1);
  });

  it('resolves only on genuine forward advance, never on a frozen timeupdate', () => {
    vi.useFakeTimers();
    try {
      const ctrlRef = { current: null };
      const video = makeFakeVideo({ currentTime: 100 });
      render(<Harness ctrlRef={ctrlRef} video={video} stallConfig={{ softMs: 1200, hardMs: 8000, mode: 'manual' }} />);

      // Arm detection + establish a progress baseline, then freeze and elapse softMs.
      act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });
      act(() => { vi.advanceTimersByTime(1500); });
      expect(ctrlRef.current.readStallState().status).toBe('stalled');

      // Non-advancing timeupdate (nudge / buffer poke) must NOT resolve.
      events.length = 0;
      act(() => { video._ct = 100.5; video.fire('timeupdate'); });
      expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(0);

      // Genuine forward advance must resolve exactly once.
      act(() => { video._ct = 102.0; video.fire('timeupdate'); });
      expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run the test, expect PASS**

Run: `npx vitest run frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx`
Expected: `Test Files 1 passed (1)`, `Tests 2 passed (2)`.

If the first test shows `strategies` empty or `terminal.length` 0, the escalation regressed (counter not advancing). If the second test's `resolvedNoAdvance` is 1, the `markProgress` gating regressed.

- [ ] **Step 3: Commit just the test (will be folded into the bundle commit in Task 2 if preferred)**

No separate commit — proceed to Task 2 to commit the whole bundle together.

---

### Task 2: Full-suite verification + commit

**Files:** none (verification + git).

- [ ] **Step 1: Run the new test plus the predicate test**

Run: `npx vitest run frontend/src/modules/Player/lib/playheadProgress.test.js frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx`
Expected: all pass (7 + 2 = 9 tests).

- [ ] **Step 2: Run the Player module suite (main repo only — exclude unrelated worktrees)**

Run: `npx vitest run frontend/src/modules/Player --exclude '**/.claude/worktrees/**'`
Expected: all test files pass, 0 test failures. (A `dash-video-element` import error only appears if worktrees are NOT excluded — that's an unrelated worktree, not this change.)

- [ ] **Step 3: Stage exactly the files in this change**

```bash
git add \
  frontend/src/modules/Player/lib/playheadProgress.js \
  frontend/src/modules/Player/lib/playheadProgress.test.js \
  frontend/src/modules/Player/hooks/useCommonMediaController.js \
  frontend/src/modules/Player/hooks/useCommonMediaController.stallEscalation.test.jsx \
  frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git rm frontend/src/modules/Player/hooks/usePlayheadStallDetection.js
```

- [ ] **Step 4: Verify the staged set is exactly these 6 paths (5 add/modify + 1 delete)**

Run: `git status --short`
Expected: `A`/`M` for the five listed files, `D` for `usePlayheadStallDetection.js`, and nothing else unexpected staged.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(fitness-player): gate stall recovery on genuine playhead progress

markProgress() treated every timeupdate as progress, so the recovery
nudge's own micro-seek and DASH buffer pokes were read as "recovered" —
resetting the escalation counter so reload never ran and the player
nudge-looped on a collapsed transcode buffer forever. Gate progress on
real forward motion (evaluatePlayheadProgress) so escalation reaches
nudge -> reload -> terminal. Retire the never-firing usePlayheadStallDetection
hook and rewire its governance stall signal off the live resilience state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Confirm the commit landed**

Run: `git log --oneline -1 && git status --short`
Expected: the new commit is HEAD; working tree clean for these files.

---

### Task 3: Deploy to kiosk + live-log verification

> Per `CLAUDE.local.md`, deploying on `kckern-server` after a committed change is allowed without further approval. Do NOT deploy if Task 2 did not commit cleanly.

**Files:** none (deploy + log inspection).

- [ ] **Step 1: Build the image**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```
Expected: build completes; frontend `vite build` succeeds (this is the real syntax/type gate for the JSX changes).

- [ ] **Step 2: Replace the running container**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```
Expected: new container running. Verify: `sudo docker ps --filter name=daylight-station`.

- [ ] **Step 3: Run a fitness session that stalls, then inspect the newest session log**

The cycling content `plex:674284` ("Diddy Kong Racing" / Game Cycling) reproduced the collapse on 2026-05-19. Start a session on it (or any AV1 cycling content) and let it run until a stall occurs. Logs are at `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness/` (newest `*.jsonl`).

Run (after a stall occurs):
```bash
cd /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness
LOG=$(ls -t *.jsonl | head -1)
grep -oE '"event":"playback\.recovery-strategy"[^}]*"strategy":"[^"]*"' "$LOG" | grep -oE '"strategy":"[^"]*"' | sort | uniq -c
grep -c '"event":"playback.recovery-terminal"' "$LOG"
```

- [ ] **Step 4: Confirm escalation actually engaged**

Expected (the success criteria for the whole fix):
- `playback.recovery-strategy` now includes `"strategy":"reload"` (not only `nudge`) when a stall persists past the nudge.
- `playback.recovery-resolved` no longer appears at a frozen position immediately after a nudge (spot-check a few: the `currentTime` on a `recovery-resolved` should be greater than the `currentTime` on the preceding `playback.stalled`).
- A genuinely unrecoverable stall now reaches `playback.recovery-terminal` instead of nudge-looping silently.

If `reload` still never appears while stalls persist, the fix did not take effect in the build — re-check that the deployed `COMMIT_HASH` matches HEAD (`sudo docker exec daylight-station sh -c 'cat /build.txt'`).

---

## Self-Review

- **Spec coverage:** Integration test (Task 1) covers both the escalation-reaches-reload claim and the resolve-only-on-advance claim. Commit (Task 2) lands the bundle. Live verification (Task 3) confirms the wild behavior. The unit predicate + retire/rewire are already in the tree (Background).
- **Placeholder scan:** No TBD/TODO; all code blocks are complete and the Task 1 code was spiked green.
- **Type/name consistency:** `evaluatePlayheadProgress(pos, lastAdvancePos, epsilon)` and `PROGRESS_EPSILON` match between helper, predicate test, and hook usage. Event names (`playback.recovery-strategy`, `playback.recovery-resolved`, `playback.recovery-terminal`, `playback.stalled`) match the controller's `mcLog`/logger emissions. `recovery.attemptNext` and `readStallState` match the `onController` surface.
