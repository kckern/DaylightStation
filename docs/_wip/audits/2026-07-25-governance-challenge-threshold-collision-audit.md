# Governance Audit: Active Challenge × Threshold Warning/Lock Collision

**Date:** 2026-07-25
**Scope:** `frontend/src/hooks/fitness/GovernanceEngine.js`, `frontend/src/modules/Fitness/player/hooks/useGovernanceAudioDuck.js`, `frontend/src/modules/Fitness/player/overlays/ChallengeOverlay.jsx`
**Primary evidence:** session log `media/logs/fitness/2026-07-25T18-05-18.jsonl` (6 challenges, 15 warnings, 8 locks in one session); corroborated by `2026-07-24T03-25-14.jsonl`
**Reported symptoms:** (1) "hurry up" sound plays while the video is paused under the lock overlay; (2) after users recover above the threshold, the challenge timer appears to reset.

> **Resolution (2026-07-25):** All four defects fixed — pause-aware `remainingSeconds` in `_buildChallengeSnapshot`, `locked`/`paused` cue gates in `_computeAudioDuck`, a stricter `satisfied` fallback, and per-token replay memory in `useGovernanceAudioDuck`. See `docs/_wip/plans/2026-07-25-governance-challenge-audio-collision-fixes.md`. Verify in production via `fitness.audio_duck.start/end` events: no cue may start between a `warning→locked` transition and the next `locked→unlocked`, and no repeated `challenge_start` for the same challenge id.

---

## TL;DR

**The challenge clock itself pauses correctly.** Freeze-resume bookkeeping (`pausedAt` / `pausedRemainingMs`) is arithmetically exact — verified below to the second across three warning/lock episodes inside a single challenge.

**The audio-cue layer does not know the challenge is paused.** Three independent defects in cue computation make the collision audibly chaotic, and together they produce both reported symptoms:

1. Cue selection is gated for the `warning` phase but **not for `locked`** — challenge cues fire under the lock overlay.
2. The snapshot's `remainingSeconds` is computed from the **frozen absolute `expiresAt`**, so it keeps decaying in real time while the challenge is paused — reaching 0 mid-lock and triggering the hurry cue.
3. The cue player dedupes only against the **immediately previous token**, so the `challenge_start` sound replays every time a warning/lock episode ends — which reads as "the challenge restarted."

A fourth, smaller defect: the first snapshot of a new challenge reports `satisfied=true` (empty `missingUsers` before the summary is built), firing a spurious `challenge_complete` blip at challenge start.

---

## 1. How the two systems are supposed to interact

Two independent state machines share the engine:

- **Base requirement** (always-on): `phase` = `pending → unlocked → warning → locked`. Falling below the required zone starts a 30 s grace (`warning`, screen blur + warning sound), then `locked` (lock overlay, video paused).
- **Zone challenge** (interval-scheduled): `challengeState.activeChallenge` with `status` = `pending → success | failed` and its own countdown (`startedAt`/`expiresAt`).

The intended collision behavior is freeze-resume, implemented in the pending-challenge branch of `evaluate()` (`GovernanceEngine.js:3934-3952`):

```js
if (!isGreenPhase) {                       // phase !== 'unlocked' → warning OR locked
  if (!challenge.pausedAt) {
    challenge.pausedAt = now;
    challenge.pausedRemainingMs = Math.max(0, challenge.expiresAt - now);
  }
  ...return;                               // no expiry check while paused
}
if (challenge.pausedAt) {                  // back in green → resume
  challenge.expiresAt = now + resumeRemainingMs;
  challenge.pausedAt = null; ...
}
```

Key detail: **while paused, `expiresAt` is left at its old absolute value.** The true remaining time lives only in `pausedRemainingMs`. Expiry cannot fire while paused (the branch returns before the expiry check), so the engine-side clock is safe — but anything that *reads* `expiresAt` during the pause sees a countdown that is still running.

### Verification that the pause itself is correct (log arithmetic)

Challenge `default_challenge_0_1785003209596` (zone downgraded hot→warm, so it kept the hot selection's `time_allowed: 90`):

| Event | Time | Remaining at event |
|---|---|---|
| STARTED | 18:13:29.6 | 90.0 s (expire 18:14:59.6) |
| warning → paused | 18:13:42.8 | 76.8 s captured |
| unlocked → resumed | 18:13:54.6 | expire = 18:15:11.4 |
| warning → paused | 18:14:24.9 | 46.5 s captured |
| locked 18:14:54.9, unlocked → resumed | 18:15:03.6 | expire = 18:15:50.2 |
| warning → paused | 18:15:34.0 | 16.2 s captured |
| locked 18:16:04.0, unlocked → resumed | 18:16:15.8 | expire = 18:16:32.1 |
| **FAILED** | **18:16:32.5** | ✓ matches to ~0.4 s |

Wall time 183 s for a 90 s challenge, with ~93 s of warning/lock spans — the freeze-resume ledger balances exactly. **Answer to "does the challenge pause?": yes, and correctly.** The same arithmetic holds for challenge `...892826` (45 s budget, paused 30.5 s in with 14.5 s left, failed 15 s after resume) and `...113800`.

---

## 2. Bug 1 — Challenge cues are not gated during `locked`

`_computeAudioDuck()` (`GovernanceEngine.js:1845-1916`) suppresses challenge cues only during the grace phase:

```js
if (this.phase === 'warning') {
  // governance_warning cue takes precedence → early return
}
// ← NO equivalent gate for phase === 'locked'
...
const hurry = this._audioCues.find(c => c.trigger === 'challenge_remaining'
  && remainingSeconds <= c.thresholdSeconds);   // fires under the lock overlay
```

Once the phase advances from `warning` to `locked`, the function falls straight through to the challenge-cue logic. The challenge is paused (`pausedAt` set), its overlay is inert, the video is frozen under the lock scrim — and the engine emits `challenge_start` / `challenge_hurry` / `challenge_complete` descriptors anyway.

### Log evidence (consumer-side `fitness.audio_duck.start` = actual sound playback)

```
18:14:54.878 PHASE warning→locked
18:14:54.988   ♪ PLAY challenge_start      ← start sound, under the lock overlay
18:14:58.965   ♪ PLAY challenge_hurry      ← hurry sound, under the lock overlay

18:16:03.993 PHASE warning→locked
18:16:04.166   ♪ PLAY challenge_hurry      ← 170 ms after the lock lands

18:21:56.104 PHASE warning→locked
18:21:56.319   ♪ PLAY challenge_start
18:21:56.843   ♪ PLAY challenge_hurry
18:22:01.914   ♪ PLAY challenge_complete   ← "complete!" while still locked (unlock at 18:22:07)

18:25:53.268 PHASE warning→locked
18:25:53.484   ♪ PLAY challenge_hurry      ← engine log shows remainingSeconds=0
```

The `challenge_start`-right-at-lock instances are the same gate defect from the other side: during `warning` the warning cue held the token; at the `warning→locked` transition the warning gate stops applying, the challenge cue is recomputed, and whichever stage matches (start or hurry) plays *at the moment of lock*.

The 18:22:01 case adds a wrinkle: `buildChallengeSummary` keeps running while paused (`:3940`), so `satisfied` can flip true mid-lock — the *complete* fanfare plays under the lock overlay, ~5 s before the actual unlock and the `COMPLETED` event (18:22:07.349). Kids hear "you did it!" while the screen still says locked.

---

## 3. Bug 2 — `remainingSeconds` keeps decaying while the challenge is paused

`_buildChallengeSnapshot()` (`:773-777`) computes:

```js
const remainingSeconds = expiresAt != null
  ? Math.max(0, Math.round((expiresAt - now) / 1000))
  : null;
```

During a pause, `expiresAt` is intentionally frozen at its stale absolute value (§1), so `expiresAt - now` continues shrinking in real time even though the challenge clock is stopped. The snapshot *does* carry `paused: Boolean(activeChallenge.pausedAt)` (`:806`), but `remainingSeconds` ignores it — and so does `_computeAudioDuck`, which never checks `challengeSnapshot.paused`.

Consequences, all visible in the log for challenge `...892826` (45 s, paused at 18:25:23 with ~14.5 s left):

- By 18:25:37 (mid-warning) the *computed* remaining hits 0 and pegs there.
- 18:25:53, phase→locked: the hurry cue fires with `remainingSeconds: 0` (engine log `governance.audio_cue.fired` at 18:25:53.744) — a "time's almost up!" sound for a clock that is stopped with 14.5 s banked.
- 18:25:55, phase→unlocked: resume rewrites `expiresAt = now + 14.5s`; computed remaining jumps **0 → 14**. Since 14 > the 12 s hurry threshold, the cue selector drops back a stage and replays `challenge_start` (18:25:55.642). Then remaining decays through 12 again and **hurry plays a second time** (18:25:57.781).

That sequence — *hurry (time's up!) → lock → unlock → start-sound → timer showing 14 s → hurry again* — is precisely the reported "the hurry sound plays, then when they get back above the threshold the challenge time resets." The engine clock never reset; the *presentation* of it did.

Note: `ChallengeOverlay.jsx` protects itself from this with its own freeze snapshot (`:211-216, :258-288` — it holds the displayed time while `challenge.paused`/warning is active), which is why the *ring display* mostly looks right. The audio layer has no such protection, and the audible story contradicts the visual one.

---

## 4. Bug 3 — Last-token-only dedupe makes stage cues replay after every interruption

`useGovernanceAudioDuck` (`useGovernanceAudioDuck.js:166-172`) plays a sound whenever the token **changes**:

```js
useEffect(() => {
  if (!token) return;
  stopSession(sessionRef.current, 'superseded');
  sessionRef.current = startSession(latestRef.current);
}, [token]);
```

Stage tokens are stable within a stage (`${chId}:challenge_start`, `${chId}:challenge_hurry`), which correctly prevents repeats *while the stage persists*. But there is no memory beyond the previous token. Every warning episode injects a `challenge_warning:<ts>` token; when it ends, the challenge's stage token comes back, differs from the last token, and **replays**.

Every green-phase re-entry with a live challenge replays the start sound:

```
18:13:54.644 PHASE warning→unlocked   → 18:13:54.902 ♪ PLAY challenge_start   (replay)
18:15:03.647 PHASE locked→unlocked    → 18:15:03.704 ♪ PLAY challenge_start   (replay)
18:16:15.798 PHASE locked→unlocked    → 18:16:16.073 ♪ PLAY challenge_start   (replay)
                                        18:16:20.048 ♪ PLAY challenge_hurry   (replay)
18:25:55.564 PHASE locked→unlocked    → 18:25:55.642 ♪ PLAY challenge_start   (replay)
18:29:01.458 PHASE warning→unlocked   → 18:29:01.503 ♪ PLAY challenge_start   (replay)
```

Challenge `...209596` played the start sound **four times** and the hurry sound **three times** during its 3-minute life. The start-sound replay is the strongest driver of the "challenge time resets" perception: the same fanfare that announced the challenge plays again, the overlay (hidden during warning by design, `ChallengeOverlay.jsx:305-309`) re-appears, and the ring shows a value that just jumped up from the decayed cue-side value (§3).

---

## 5. Bug 4 — Spurious `challenge_complete` blip at challenge start

`_computeAudioDuck` (`:1891-1893`) treats "no data" as "satisfied":

```js
const satisfied = Number.isFinite(requiredCount) && Number.isFinite(actualCount)
  ? actualCount >= requiredCount
  : (Array.isArray(missingUsers) ? missingUsers.length === 0 : false);
```

On the first compose after a challenge starts, `challenge.summary` is null, so the snapshot carries `actualCount: null, missingUsers: []` (`:798-800`) → `satisfied = true` → the complete cue fires, then is superseded ~10 ms later once the summary is built:

```
18:21:24.078 STARTED id=684077
18:21:24.185   ♪ PLAY challenge_complete   ← spurious
18:21:24.194   ♪ end  challenge_complete reason=superseded
18:21:24.194   ♪ PLAY challenge_start
```

Same pattern at 18:24:52.882 and 18:28:33.885. It's short enough to be a click/duck-bounce rather than a full fanfare, but it also poisons the token history (complete → start), and the duck engages/releases audibly.

---

## 6. Secondary observations

1. **Unlock-edge double pause (~100–500 ms).** On every `locked→unlocked` transition, `freezeGovernanceForPause` (`FitnessContext.jsx:2408-2412`) goes momentarily true — the video is still paused while `videoLocked` has already cleared — so `setPlaybackPaused(true/false)` fires a `TIMERS_PAUSED`/`TIMERS_RESUMED` pair (log: every unlock, `pauseMs` 115–476). `_shiftDeadlinesBy` then nudges `expiresAt` by that span. Harmless today, but it's a second, independent pause-accounting path layered on the challenge's own `pausedRemainingMs` — a latent double-accounting hazard if either side changes.
2. **Engine cue log is rate-limited into blindness.** `governance.audio_cue.fired` is `sampled(..., maxPerMinute: 12)` shared across all cues; during warning-heavy minutes the budget is consumed by the repeating warning-cue emissions and real hurry/start firings go unlogged (the 18:14:58 hurry playback has no engine-side emission record). The consumer-side `fitness.audio_duck.start/end` events are the reliable record — use those for future audio forensics.
3. **Zone downgrade keeps the original time budget.** `...209596` was downgraded hot→warm but kept `time_allowed: 90` from the hot selection — a 90 s warm challenge alongside 45 s warm selections. Not a bug per se, but surprising.
4. **Post-failure recovery inflates duration stats.** A failed challenge that later "recovers" logs `durationMs` spanning the whole lock (`232860` ms for a 45 s challenge at 18:17:22). Anyone consuming `governance.challenge.completed/recovered` durations should know they include lock time.

---

## 7. Recommended fixes (in priority order)

1. **Pause-aware `remainingSeconds`** — in `_buildChallengeSnapshot`, when `activeChallenge.pausedAt` is set, derive remaining from `pausedRemainingMs` instead of `expiresAt - now`. This single change stops the decay-to-zero, the mid-lock hurry trigger, and the 0→14 jump on resume; the overlay's defensive freeze snapshot becomes redundant rather than load-bearing.
2. **Gate challenge cues on pause state** — in `_computeAudioDuck`, return null (or only the warning/lock-appropriate cue) whenever `challengeSnapshot.paused` is true, and add an explicit `phase === 'locked'` gate parallel to the `warning` one. No challenge-stage sound should play while the challenge clock is stopped.
3. **Per-stage cue memory** — track fired stage tokens per challenge id (a small Set on the challenge or in the consumer) so `challenge_start`/`challenge_hurry` fire at most once per challenge regardless of interruptions. The existing "supersede on token change" behavior can stay for duck lifecycle; only the *replay* needs suppressing.
4. **Fix the `satisfied` fallback** — treat a missing summary (`actualCount == null` and no populated `metUsers`) as *not* satisfied so the complete cue can't fire before the first real evaluation.

Items 1+2 eliminate symptom "hurry sound during lock"; items 1+3 eliminate symptom "challenge time resets." All four are small, local changes with existing log events (`fitness.audio_duck.*`, `governance.audio_cue.fired`) available to verify behavior after deploy.
