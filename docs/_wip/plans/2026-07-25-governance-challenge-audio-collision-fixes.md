# Governance Challenge × Threshold Collision — Audio Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four audio-cue defects documented in `docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md` so no challenge sound plays while the challenge clock is paused (warning/lock), the presented remaining time never decays during a pause, and stage cues never replay after an interruption.

**Architecture:** All four fixes are small, local changes in two files. Three land in `GovernanceEngine.js` (the snapshot builder `_buildChallengeSnapshot` and the cue selector `_computeAudioDuck`); one lands in the consumer hook `useGovernanceAudioDuck.js` (token replay memory). The engine's freeze-resume clock (`pausedAt`/`pausedRemainingMs`) is already correct and is NOT touched — we make the presentation layer read it properly.

**Tech Stack:** React frontend, vitest unit tests (colocated `*.test.js(x)` files, run via root `vitest.config.mjs` which resolves `frontend/node_modules`).

## Global Constraints

- Run vitest **from the repo root**: `npx vitest run <path>` (the root config aliases `@` → `frontend/src` and borrows the React plugin from `frontend/node_modules`). Do NOT `cd frontend`.
- Commit message style: `fix(fitness): <imperative summary>` (matches repo history), ending with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Never use raw `console.*` for diagnostics — the structured logging framework (`getLogger()`) is already imported in both files; reuse existing patterns.
- **Do NOT touch** `ChallengeOverlay.jsx` — its defensive freeze snapshot (audit §3, lines 211-216/258-288) becomes redundant after Task 1 but stays as-is.
- **Do NOT touch** the engine's freeze-resume logic in `evaluate()` (`GovernanceEngine.js:3934-3952`) — the audit verified it is arithmetically correct.
- Out of scope (audit §6 "secondary observations"): the unlock-edge double pause, the rate-limited engine cue log, zone-downgrade time budgets, and duration-stat inflation. Do not fix these here.
- Task order matters once: Task 3 (satisfied fallback) MUST land before Task 4 (token memory), otherwise the spurious `challenge_complete` at challenge start would "burn" the complete token in the memory Set and silence the real completion fanfare.
- This host is prod (`kckern-server`): deploy autonomously after all tasks pass, but ONLY after the garage-in-use gate check in Task 5 comes back clear.

---

### Task 1: Pause-aware `remainingSeconds` in `_buildChallengeSnapshot` (audit Bug 2, fix priority 1)

While a challenge is paused, `expiresAt` is intentionally frozen at a stale absolute timestamp — the true remaining time lives in `pausedRemainingMs`. The snapshot currently computes `remainingSeconds` from `expiresAt - now`, so the published countdown keeps decaying in real time during warning/lock, hits 0 mid-lock (triggering the hurry cue), then jumps back up on resume ("the timer reset").

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:773-777` (remaining-time computation) and `:806` (`paused` field)
- Test: Create `frontend/src/hooks/fitness/GovernanceEngine.challengePause.test.js`

**Interfaces:**
- Consumes: `activeChallenge.pausedAt` / `activeChallenge.pausedRemainingMs` (set by `evaluate()`'s freeze-resume branch — already exists).
- Produces: snapshot `remainingSeconds` (number|null) that is stable across ticks while `paused === true`. Task 2's gate reads the snapshot's existing `paused` boolean.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/GovernanceEngine.challengePause.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';

// Silence the structured logger (same rationale as GovernanceEngine.audioDuck.test.js:
// we assert on return values, never on logs).
vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from './GovernanceEngine.js';

// A zone (non-cycle) challenge frozen mid-pause. expiresAt is deliberately STALE:
// evaluate()'s freeze-resume leaves it at its old absolute value while the real
// remaining time is banked in pausedRemainingMs (audit §1).
const pausedChallenge = (overrides = {}) => ({
  id: 'ch1',
  status: 'pending',
  zone: 'active',
  requiredCount: 2,
  startedAt: 60000,
  timeLimitSeconds: 45,
  expiresAt: 100000,
  pausedAt: 85500,
  pausedRemainingMs: 14500,
  summary: null,
  ...overrides
});

describe('GovernanceEngine — _buildChallengeSnapshot pause-aware remaining time', () => {
  it('derives remainingSeconds from pausedRemainingMs while paused, not from stale expiresAt', () => {
    // 5 s past the stale expiresAt: expiresAt-now math would report 0.
    const engine = new GovernanceEngine(null, { now: () => 105000 });
    engine.challengeState.activeChallenge = pausedChallenge();
    const snap = engine._buildChallengeSnapshot(engine._now());
    expect(snap.paused).toBe(true);
    expect(snap.remainingSeconds).toBe(15); // round(14500 / 1000), banked clock
  });

  it('does not decay across ticks while paused', () => {
    let t = 90000;
    const engine = new GovernanceEngine(null, { now: () => t });
    engine.challengeState.activeChallenge = pausedChallenge();
    const first = engine._buildChallengeSnapshot(t).remainingSeconds;
    t = 130000; // 40 s later, still paused
    const second = engine._buildChallengeSnapshot(t).remainingSeconds;
    expect(second).toBe(first);
  });

  it('uses expiresAt - now when not paused', () => {
    const engine = new GovernanceEngine(null, { now: () => 90000 });
    engine.challengeState.activeChallenge = pausedChallenge({ pausedAt: null, pausedRemainingMs: null });
    const snap = engine._buildChallengeSnapshot(engine._now());
    expect(snap.paused).toBe(false);
    expect(snap.remainingSeconds).toBe(10); // (100000 - 90000) / 1000
  });

  it('falls back to expiresAt math when pausedAt is set but pausedRemainingMs is not finite', () => {
    const engine = new GovernanceEngine(null, { now: () => 95000 });
    engine.challengeState.activeChallenge = pausedChallenge({ pausedRemainingMs: null });
    const snap = engine._buildChallengeSnapshot(engine._now());
    expect(snap.paused).toBe(true);
    expect(snap.remainingSeconds).toBe(5); // defensive fallback, same as today
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.challengePause.test.js`
Expected: FAIL — first test gets `remainingSeconds: 0` (stale-expiry math), second gets `second !== first`. Tests 3 and 4 pass (current behavior).

- [ ] **Step 3: Implement the pause-aware computation**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, replace lines 773-777:

```js
    const expiresAt = Number.isFinite(activeChallenge.expiresAt) ? activeChallenge.expiresAt : null;
    const startedAt = Number.isFinite(activeChallenge.startedAt) ? activeChallenge.startedAt : null;
    const remainingSeconds = expiresAt != null
      ? Math.max(0, Math.round((expiresAt - now) / 1000))
      : null;
```

with:

```js
    const expiresAt = Number.isFinite(activeChallenge.expiresAt) ? activeChallenge.expiresAt : null;
    const startedAt = Number.isFinite(activeChallenge.startedAt) ? activeChallenge.startedAt : null;
    const paused = Boolean(activeChallenge.pausedAt);
    // While paused, expiresAt is frozen at a stale absolute value — the real
    // remaining time is banked in pausedRemainingMs (see the freeze-resume
    // branch in evaluate()). Reading expiresAt - now here would keep counting
    // down in real time against a stopped clock.
    let remainingSeconds = null;
    if (paused && Number.isFinite(activeChallenge.pausedRemainingMs)) {
      remainingSeconds = Math.max(0, Math.round(activeChallenge.pausedRemainingMs / 1000));
    } else if (expiresAt != null) {
      remainingSeconds = Math.max(0, Math.round((expiresAt - now) / 1000));
    }
```

Then at line 806 (end of the returned snapshot object), replace:

```js
      paused: Boolean(activeChallenge.pausedAt)
```

with:

```js
      paused
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.challengePause.test.js`
Expected: PASS (4 tests)

Also run the neighboring engine suites to catch regressions:
Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js frontend/src/hooks/fitness/GovernanceEngine.playbackPause.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.challengePause.test.js
git commit -m "fix(fitness): challenge snapshot remainingSeconds honors the paused clock

While a zone challenge is frozen (warning/lock), derive remainingSeconds
from the banked pausedRemainingMs instead of the intentionally stale
expiresAt, so the published countdown stops decaying mid-pause.
Audit: docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md (§3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Gate challenge cues during `locked` phase and while paused (audit Bug 1, fix priority 2)

`_computeAudioDuck` suppresses challenge cues during the `warning` phase (the warning cue takes precedence) but has no gate for `locked` — so start/hurry/complete sounds play under the lock overlay while the video is frozen. Add two gates: a hard `phase === 'locked'` gate (no cue of any kind under the lock overlay), and a `challengeSnapshot.paused` gate in the zone-challenge branch (no stage cue while the challenge clock is stopped, e.g. warning phase with no warning cue configured).

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1860-1901` (`_computeAudioDuck`)
- Test: Modify `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` (append a describe block)

**Interfaces:**
- Consumes: snapshot `paused` boolean (exists today at `:806`; made accurate by Task 1) and `this.phase`.
- Produces: `_computeAudioDuck` returns `null` whenever `this.phase === 'locked'`, and `null` for zone-challenge cues whenever `challengeSnapshot.paused` is true. Behavior in `unlocked` phase with `paused: false` is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` (uses the file's existing `baseConfig` helper):

```js
describe('GovernanceEngine — cue gating under lock and pause', () => {
  const cues = [
    { id: 'c_start', trigger: 'challenge_start', sound: 'a.mp3', duckTo: 0.2, volume: 1 },
    { id: 'c_hurry', trigger: 'challenge_remaining', thresholdSeconds: 12, sound: 'b.mp3', duckTo: 0.1, volume: 1 },
    { id: 'c_done', trigger: 'challenge_complete', sound: 'c.mp3', duckTo: 0.2, volume: 1 }
  ];
  const makeEngine = (phase) => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine._audioCues = cues;
    engine.phase = phase;
    return engine;
  };

  it('emits no challenge cue while phase is locked', () => {
    const engine = makeEngine('locked');
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: 2, actualCount: 1, paused: true };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('suppresses the complete cue while locked even if the challenge becomes satisfied mid-lock', () => {
    // Audit §2, 18:22:01 case: buildChallengeSummary keeps running while paused,
    // so satisfied can flip true under the lock overlay. The fanfare must wait
    // for the unlock.
    const engine = makeEngine('locked');
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: 2, actualCount: 2, paused: true };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('locked phase suppresses cycle cues as well (video is frozen under the lock overlay)', () => {
    const engine = new GovernanceEngine(null, { now: () => 1000 });
    engine.configure(baseConfig([{ id: 'cyc_fail', trigger: 'cycle_fail', sound: 'cf.mp3' }]));
    engine.phase = 'locked';
    expect(engine._computeAudioDuck({ type: 'cycle', id: 'c1', cycleAudioCue: 'cycle_locked' })).toBeNull();
  });

  it('emits no stage cue while the challenge is paused (warning phase, no warning cue configured)', () => {
    const engine = makeEngine('warning');
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: 2, actualCount: 1, paused: true };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });

  it('still emits stage cues when unlocked and not paused', () => {
    const engine = makeEngine('unlocked');
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: 2, actualCount: 1, paused: false };
    expect(engine._computeAudioDuck(snapshot)).toMatchObject({ cueId: 'c_hurry' });
  });

  it('warning cue still fires during warning phase (precedence unchanged)', () => {
    const engine = makeEngine('warning');
    engine._audioCues = [...cues, { id: 'c_warn', trigger: 'governance_warning', sound: 'w.mp3', duckTo: 0.15, volume: 1 }];
    engine._warningStartTime = 5000;
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: 2, actualCount: 1, paused: true };
    expect(engine._computeAudioDuck(snapshot)).toMatchObject({ cueId: 'c_warn', token: 'c_warn:5000' });
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: FAIL — the four gating tests get a cue descriptor instead of `null`. The `unlocked` and `warning-precedence` tests pass (current behavior).

- [ ] **Step 3: Implement the gates**

In `frontend/src/hooks/fitness/GovernanceEngine.js` `_computeAudioDuck`, immediately after the `phase === 'warning'` block (after line 1867), insert:

```js
    // Hard lock: the lock overlay owns the screen and the video is paused —
    // no cue of any kind (zone or cycle) should sound underneath it. Cues
    // resume once the phase leaves 'locked'.
    if (this.phase === 'locked') return null;
```

Then in the zone-challenge branch, immediately after the destructuring line (currently `:1889-1890`):

```js
    const { id: challengeId, status, remainingSeconds, requiredCount, actualCount, missingUsers } = challengeSnapshot;
    const chId = challengeId || 'challenge';
```

insert:

```js
    // The challenge clock is frozen during a warning/lock collision — stage
    // cues (start/hurry/complete) must not fire against a stopped clock.
    if (challengeSnapshot.paused) return null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS — all pre-existing tests in the file must also still pass (their snapshots have no `paused` field → `undefined` → falsy → ungated; their engines default to `phase` set by `makeEngine`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js
git commit -m "fix(fitness): no challenge audio cues under the lock overlay or while paused

Add a phase==='locked' gate parallel to the existing warning gate, plus a
challengeSnapshot.paused gate for zone stage cues, so start/hurry/complete
sounds can no longer fire while the video is frozen.
Audit: docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md (§2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `satisfied` fallback must not treat a missing summary as satisfied (audit Bug 4, fix priority 4)

On the first compose after a challenge starts, `challenge.summary` is null, so the snapshot carries `actualCount: null, metUsers: [], missingUsers: []`. The current fallback (`missingUsers.length === 0`) reads that as "satisfied" and fires a spurious `challenge_complete` blip. Require a populated `metUsers` before declaring satisfaction from the list fallback.

**This task MUST land before Task 4** — otherwise the spurious complete would burn the `ch1:c_done` token in Task 4's replay memory and silence the real completion fanfare.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:1889-1893` (destructure + `satisfied` computation)
- Test: Modify `frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js` (update one existing test whose expectation encodes the bug; add two)

**Interfaces:**
- Consumes: snapshot `metUsers` array (already produced at `GovernanceEngine.js:799` — no snapshot change needed).
- Produces: `satisfied` is true only from real counts (`actualCount >= requiredCount`) or from a populated `metUsers` with empty `missingUsers`.

- [ ] **Step 1: Update the existing test that encodes the buggy semantics**

In `GovernanceEngine.audioDuck.test.js`, the `_computeAudioDuck` describe block has (currently lines 167-171):

```js
  it('treats an empty missingUsers list (no counts) as satisfied → null', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: null, actualCount: null, missingUsers: [] };
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });
```

Replace it with:

```js
  it('does not treat a missing summary (no counts, empty user lists) as satisfied — stage cues still apply', () => {
    // First compose after challenge start: summary is null → actualCount null,
    // metUsers [] , missingUsers []. That is "no data yet", not "satisfied".
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: null, actualCount: null, metUsers: [], missingUsers: [] };
    expect(engine._computeAudioDuck(snapshot)).toMatchObject({ cueId: 'challenge_hurry', token: 'ch1:challenge_hurry' });
  });

  it('treats populated metUsers with empty missingUsers as satisfied (no counts)', () => {
    const engine = makeEngine();
    const snapshot = { id: 'ch1', status: 'pending', remainingSeconds: 8, requiredCount: null, actualCount: null, metUsers: ['alice'], missingUsers: [] };
    // Only the hurry cue is configured in this suite; satisfied → looks for a
    // challenge_complete cue → none → null (and crucially NOT the hurry cue).
    expect(engine._computeAudioDuck(snapshot)).toBeNull();
  });
```

Also append to the "start / complete / warning triggers" describe block (which configures a `challenge_complete` cue):

```js
  it('does not fire challenge_complete on the first snapshot of a new challenge (no summary yet)', () => {
    const engine = makeEngine();
    const duck = engine._computeAudioDuck({ id: 'ch1', status: 'pending', remainingSeconds: 40, requiredCount: null, actualCount: null, metUsers: [], missingUsers: [] });
    expect(duck).toMatchObject({ cueId: 'c_start' }); // start, not the spurious complete
  });
```

- [ ] **Step 2: Run tests to verify the new/updated ones fail**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: FAIL — the "does not treat a missing summary" test gets `null` (satisfied short-circuit) and the "first snapshot of a new challenge" test gets `cueId: 'c_done'`. The `metUsers: ['alice']` test passes already (empty `missingUsers` → satisfied today too).

- [ ] **Step 3: Implement the fallback fix**

In `_computeAudioDuck`, replace (currently lines 1889-1893):

```js
    const { id: challengeId, status, remainingSeconds, requiredCount, actualCount, missingUsers } = challengeSnapshot;
    const chId = challengeId || 'challenge';
    const satisfied = Number.isFinite(requiredCount) && Number.isFinite(actualCount)
      ? actualCount >= requiredCount
      : (Array.isArray(missingUsers) ? missingUsers.length === 0 : false);
```

with:

```js
    const { id: challengeId, status, remainingSeconds, requiredCount, actualCount, metUsers, missingUsers } = challengeSnapshot;
    const chId = challengeId || 'challenge';
    // A brand-new challenge has no summary yet (actualCount null, empty user
    // lists) — that is "no data", not "satisfied". The list fallback therefore
    // requires at least one met user alongside an empty missing list.
    const satisfied = Number.isFinite(requiredCount) && Number.isFinite(actualCount)
      ? actualCount >= requiredCount
      : (Array.isArray(metUsers) && metUsers.length > 0
        && Array.isArray(missingUsers) && missingUsers.length === 0);
```

(Note: Task 2's `paused` gate sits between the `chId` line and this computation — keep it there.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js`
Expected: PASS — including every pre-existing test. (The pre-existing `fires when missingUsers is non-empty (no counts)` test is unaffected: non-empty `missingUsers` → unsatisfied either way.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/GovernanceEngine.audioDuck.test.js
git commit -m "fix(fitness): missing challenge summary no longer reads as satisfied

The pre-summary snapshot (actualCount null, empty user lists) fired a
spurious challenge_complete blip at every challenge start. The satisfied
fallback now requires a populated metUsers list.
Audit: docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md (§5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Per-token replay memory in `useGovernanceAudioDuck` (audit Bug 3, fix priority 3)

The hook plays a sound whenever the token *changes*, with no memory beyond the previous token. A warning episode interposes its own token (`c_warn:<ts>`); when it ends, the challenge's stable stage token (`ch1:c_start`) comes back, differs from the last token, and replays — the strongest driver of the "challenge restarted" perception. Track every fired token in a Set so each distinct token plays at most once per mount. Episode-scoped tokens (warning `c_warn:<ts>`, cycle hurry `<id>:cycle_hurry:<ts>`) embed a timestamp, so they remain replayable by construction; stage tokens are stable per challenge and therefore fire once.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js:161-172` (hook body + doc comment)
- Test: Modify `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx` (append tests)

**Interfaces:**
- Consumes: `audioDuck.token` descriptors from the engine (unchanged engine contract; the engine keeps emitting the stable stage token every tick while the stage holds).
- Produces: no observable API change — `useGovernanceAudioDuck({ videoVolume, audioDuck })` signature is untouched. Behavioral contract: a token value that has already started a session in this mount never starts another one.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('useGovernanceAudioDuck', ...)` block in `useGovernanceAudioDuck.test.jsx` (reuses the file's `render`, `descriptor`, `FakeAudio` helpers):

```js
  it('does not replay a stage token after an interposed warning token (A → B → A)', () => {
    const start = descriptor({ token: 'ch1:c_start', cueId: 'challenge_start', duckTo: 0.2 });
    const { rerender } = render(start);
    const sfx = FakeAudio.instances[0];
    expect(sfx.playCalls).toBe(1);
    rerender({ audioDuck: descriptor({ token: 'c_warn:5000', cueId: 'governance_warning', duckTo: 0.15 }) });
    expect(sfx.playCalls).toBe(2);          // warning episode plays
    rerender({ audioDuck: start });         // back to green: same stage token returns
    expect(sfx.playCalls).toBe(2);          // no start-sound replay
  });

  it('does not replay after a token → null → same-token round trip (lock gap)', () => {
    const start = descriptor({ token: 'ch1:c_start', cueId: 'challenge_start' });
    const { rerender } = render(start);
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null });          // engine emits nothing while locked
    rerender({ audioDuck: start });         // unlock: stage token returns
    expect(sfx.playCalls).toBe(1);
  });

  it('still plays a genuinely new token after suppressed replays', () => {
    const { rerender } = render(descriptor({ token: 'ch1:c_start', cueId: 'challenge_start' }));
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null });
    rerender({ audioDuck: descriptor({ token: 'ch1:c_start', cueId: 'challenge_start' }) }); // suppressed
    rerender({ audioDuck: descriptor({ token: 'ch1:c_hurry', cueId: 'challenge_hurry' }) }); // new stage
    expect(sfx.playCalls).toBe(2);
  });

  it('warning episodes with distinct timestamps still replay (episode tokens stay unique)', () => {
    const { rerender } = render(descriptor({ token: 'c_warn:5000', cueId: 'governance_warning' }));
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: null });
    rerender({ audioDuck: descriptor({ token: 'c_warn:9000', cueId: 'governance_warning' }) });
    expect(sfx.playCalls).toBe(2);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: FAIL — the first two replay tests see an extra `playCalls` (3 and 2 respectively); the last two pass (current behavior).

- [ ] **Step 3: Implement the replay memory**

In `useGovernanceAudioDuck.js`, replace the hook body (currently lines 161-178):

```js
export function useGovernanceAudioDuck({ videoVolume, audioDuck }) {
  const latestRef = useRef({ videoVolume, audioDuck });
  useEffect(() => { latestRef.current = { videoVolume, audioDuck }; });

  const sessionRef = useRef(null);
  const token = audioDuck?.token || null;

  useEffect(() => {
    if (!token) return;
    stopSession(sessionRef.current, 'superseded');
    sessionRef.current = startSession(latestRef.current);
  }, [token]);
```

with:

```js
export function useGovernanceAudioDuck({ videoVolume, audioDuck }) {
  const latestRef = useRef({ videoVolume, audioDuck });
  useEffect(() => { latestRef.current = { videoVolume, audioDuck }; });

  const sessionRef = useRef(null);
  // Every token that has ever started a session this mount. Warning/lock
  // episodes interleave their own (timestamped, unique) tokens between a
  // challenge's stable stage tokens; when a stage token comes back after the
  // interruption it must not re-announce the stage. Episode-scoped cues stay
  // replayable because their tokens embed a timestamp.
  const firedTokensRef = useRef(new Set());
  const token = audioDuck?.token || null;

  useEffect(() => {
    if (!token) return;
    if (firedTokensRef.current.has(token)) return;
    firedTokensRef.current.add(token);
    if (firedTokensRef.current.size > 200) {
      // Bounded memory: drop the oldest entry (Sets iterate in insertion order).
      firedTokensRef.current.delete(firedTokensRef.current.values().next().value);
    }
    stopSession(sessionRef.current, 'superseded');
    sessionRef.current = startSession(latestRef.current);
  }, [token]);
```

(The unmount-cleanup effect below it is unchanged.)

Also update the hook's JSDoc paragraph (lines 150-156) — replace:

```js
/**
 * Plays a one-shot SFX and ducks the video (via the volume system) when the
 * GovernanceEngine emits an `audioDuck` descriptor, lifting the duck when the SFX
 * ends. Reacts to `audioDuck.token` ONLY — the engine rebuilds the descriptor
 * object every tick, so keying on the object would tear the session down each
 * tick (cutting the SFX and bouncing the volume).
 */
```

with:

```js
/**
 * Plays a one-shot SFX and ducks the video (via the volume system) when the
 * GovernanceEngine emits an `audioDuck` descriptor, lifting the duck when the SFX
 * ends. Reacts to `audioDuck.token` ONLY — the engine rebuilds the descriptor
 * object every tick, so keying on the object would tear the session down each
 * tick (cutting the SFX and bouncing the volume). Each distinct token plays at
 * most once per mount (see firedTokensRef), so stable stage tokens survive
 * warning/lock interruptions without replaying.
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx`
Expected: PASS — all pre-existing tests too (they use distinct tokens per play, or same-token rerenders that were already deduped by the effect dependency).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.test.jsx
git commit -m "fix(fitness): audio-duck stage cues fire at most once per token

Track fired tokens in a Set so challenge_start/hurry/complete no longer
replay after every warning/lock interruption. Episode-scoped cues
(governance warning, cycle hurry) keep replaying via timestamped tokens.
Audit: docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md (§4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full-suite verification, audit doc closeout, deploy

**Files:**
- Modify: `docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md` (resolution note at top)

**Interfaces:**
- Consumes: all four fixes committed.
- Produces: green fitness-related vitest run, updated audit doc, deployed container, reloaded garage kiosk.

- [ ] **Step 1: Run the full colocated fitness + player-hook suites**

Run:
```bash
npx vitest run frontend/src/hooks/fitness/ frontend/src/modules/Fitness/player/hooks/
```
Expected: PASS (no new failures vs. a pre-change baseline; per project memory, ignore only failures that already exist on `main` — verify by `git stash`-free comparison if anything unexpected fails).

- [ ] **Step 2: Add a resolution note to the audit doc**

At the top of `docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md`, directly under the `**Reported symptoms:**` line, insert:

```markdown
> **Resolution (2026-07-25):** All four defects fixed — pause-aware `remainingSeconds` in `_buildChallengeSnapshot`, `locked`/`paused` cue gates in `_computeAudioDuck`, a stricter `satisfied` fallback, and per-token replay memory in `useGovernanceAudioDuck`. See `docs/_wip/plans/2026-07-25-governance-challenge-audio-collision-fixes.md`. Verify in production via `fitness.audio_duck.start/end` events: no cue may start between a `warning→locked` transition and the next `locked→unlocked`, and no repeated `challenge_start` for the same challenge id.
```

- [ ] **Step 3: Commit the doc update**

```bash
git add docs/_wip/audits/2026-07-25-governance-challenge-threshold-collision-audit.md docs/_wip/plans/2026-07-25-governance-challenge-audio-collision-fixes.md
git commit -m "docs(fitness): close out governance challenge audio collision audit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Deploy gate — confirm the garage is idle (MUST halt if not clear)**

Run each check as its own step and STOP if either gate is active (per CLAUDE.local.md — never chain the gate with the deploy):

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```

Clear means: count 0 recurring render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If not clear, wait and re-check — do not deploy.

- [ ] **Step 5: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

Re-run the Step 4 gate check (a session may have started during the build). Only if still clear:

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 6: Reload the garage fitness kiosk** (required after any `frontend/src/modules/Fitness/` change)

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```

Expected: exit 0 (the `XGetWindowProperty[_NET_WM_DESKTOP] failed` warning is benign).

- [ ] **Step 7: Post-deploy verification via logs**

Confirm the new bundle is live and no error storm:

```bash
sudo docker exec daylight-station sh -c 'cat /build.txt'
sudo docker logs --since 120s daylight-station 2>&1 | grep -ciE 'error' || true
```

Expected: `/build.txt` shows the new `COMMIT_HASH`; no new error spike. Full behavioral verification (cue timing during a real warning/lock collision) happens on the next fitness session — the per-session JSONL under `media/logs/fitness/` records `fitness.audio_duck.start/end` and phase transitions; check the next session's log for: no `audio_duck.start` between `warning→locked` and `locked→unlocked`, and at most one `challenge_start` play per challenge id.

---

## Self-Review (completed at plan time)

- **Spec coverage:** Audit rec 1 → Task 1; rec 2 → Task 2; rec 4 → Task 3; rec 3 → Task 4. Audit §6 secondary observations explicitly declared out of scope in Global Constraints.
- **Ordering hazard covered:** Task 3 before Task 4 (spurious complete would burn the complete token in the replay Set).
- **Type consistency:** snapshot `paused` (Task 1) is the field Task 2 gates on; `metUsers` consumed in Task 3 already exists at `GovernanceEngine.js:799`; the hook's public signature is unchanged in Task 4.
- **Known test-semantics change:** one existing test (`treats an empty missingUsers list (no counts) as satisfied → null`) intentionally flips in Task 3 — it encoded Bug 4.
