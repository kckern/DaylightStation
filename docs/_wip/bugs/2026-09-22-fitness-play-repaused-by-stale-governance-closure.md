# Fitness: play presses re-paused by a stale governance closure

**Date:** 2026-09-22
**Status:** Fixed on branch `fix/fitness-play-means-play`
**Where:** garage fitness kiosk, governed workout video
**Plan:** `docs/_wip/plans/2026-09-22-fitness-play-means-play.md`

## The rule

> If the play button is offered, pressing it plays. When governance locks, the
> button becomes a lock, and pausing is governance's alone.

Implementation: callbacks handed to `<Player>` read governance through
`useGovernanceProgressEnforcer`
(`frontend/src/modules/Fitness/player/governanceProgressEnforcer.js`), never a
captured value. The rule is also recorded in
`docs/reference/fitness/governance-system-architecture.md` ("Enforcement
invariant: play means play").

## Symptom

2026-09-22, 19:35–19:44 PDT. 47 play presses on the kiosk:

- **41** were re-paused within 1 s. Most came back paused in 5–26 ms; the rest at
  about 200–377 ms (the first or second `timeupdate` after resume). During all
  of these the governance engine had logged `phase=unlocked`,
  `videoLocked=false`.
- **5** landed during a real lock. Those pauses were legitimate.

Each failing press left the same three log rows:

```
playback.resumed  source=controller-toggle      the user's press
playback.seek     phase=seeked       (+1 ms)    no real seek happened
playback.paused   source=controller  (+5-26 ms) the stale closure pausing
```

## Caller chain

1. **Leaked `playing` listener** in `useCommonMediaController`. The element-setup
   effect added a `playing` listener on every run and never removed it. It had
   been harmless because the handler only cleared seek state, until `18d032ae5`
   made that path call `onProgress`. That explains the `playback.seek
   phase=seeked` row with no seek behind it.
2. **Dead `FitnessPlayer.handlePlayerProgress` closure.** Each leaked listener held
   the `onProgress` of the render that bound it. Copies bound during the startup
   lock had captured `governancePaused = true`.
3. That closure called `pausePlayback()`, producing `playback.paused
   source=controller`.
4. The same closure called `setVideoPlayerPaused(true)`. `FitnessContext` treats
   that as a user pause and runs `freezeGovernanceForPause`, which pauses the
   engine timers (`governance.timers_paused` logged 0.3 s after the unlock). With
   its timers frozen, governance never re-evaluated, so nothing corrected the
   state.

**Why there were so many leaked copies.** `FitnessPlayer`'s `handleClose` and
`handleNext` were not memoized. They reach the controller as `onEnd`, which was a
dependency of the element-setup effect. So that effect re-ran, and added another
`playing` listener, on every `FitnessPlayer` render: every HR sample and every
governance tick.

## Misleading telemetry during the investigation

- **`fitness-profile` and `fitness.render_thrashing` reported
  `phase: pending` while the live engine was unlocked.** `FitnessProvider` built
  its session with an eager `useRef(new FitnessSession())`, which constructs a
  throwaway `FitnessSession` and `GovernanceEngine` on every render (7 in one
  short test). Each throwaway wrote `phase: 'pending'` into
  `window.__fitnessGovernance`, which is what those two events read.
- **A second fitness client was open 19:38–19:40** (another browser), and its
  governance events are mixed into the log store. When investigating, filter by
  client (`context.userAgent`) before drawing conclusions from governance rows.

## When it was introduced, and why it first showed up on 9/22

- The listener leak dates from `1b2569d67` (2025-11-24).
- `18d032ae5` (2026-09-20) armed it by routing that listener into `onProgress`.
  First shipped in the prod image built 2026-09-20 21:01 PDT.
- The kiosk browser stays open and loads new frontend code only on a page reload.
  It had loaded at 9/20 16:09 PDT (before the bad build) and did not reload until
  9/22 15:21 PDT, so the 9/21 workout ran the old code. The 9/22 workout page
  loaded at 19:02 PDT from the 18:29 build. That was the first governed garage
  session on the broken code.

**Lesson:** a kiosk can run a stale bundle for days. "It worked yesterday" says
nothing about the build that is deployed now. Check when the kiosk page last
loaded before trusting a previous session as a baseline.

## Why the tests missed it

- The test added with `18d032ae5` covered the `seeked` path only. Nothing
  exercised the `playing` path, and nothing checked that listeners are removed
  when the effect re-runs.
- No test covered "governance unlocks, then a play press keeps playing".

## Fix (branch `fix/fitness-play-means-play`)

| Commit | Change |
|--------|--------|
| `772bea4ba` | Remove the leaked `playing` listener; `onProgress` always reads the live callback through a ref |
| `bdfecf612`, `85789aa8b` | Remove the leaked `playbackRate` / start-seek listeners on cleanup; live `isSeeking` in progress; harness fixes |
| `bc39a344d` | Read `onEnd` through a ref, so parent re-renders no longer re-bind media listeners |
| `f3c2a6a60` | Read `masterVolume` live in `loadedmetadata` |
| `24771739e`, `a28858a8e`, `323f36f0f` | Governance enforcement reads live state through `useGovernanceProgressEnforcer`; no-op after unmount; informative `pause-enforced` telemetry |
| `e9858ab10` | Construct `FitnessSession` once per provider, not per render |
| `458c627e4` | Restore `animationPlayState` in ProgressBar / ContentScroller, mangled by `b20273b9a` |

Plus a revert of other identifiers mangled by `b20273b9a`.

## Detecting a regression

New event: **`fitness.governance.pause-enforced`** means governance paused the
video. Payload: `branch` (`'seek-intent'` or `'tick'`), `currentTime`,
`governanceStatus`, `videoLocked`. It is sampled (10/min, aggregated).

**Rule:** a `playback.paused source=controller` on the fitness kiosk with no
`pause-enforced` beside it, while governance is unlocked, is a regression of
this bug.

```bash
# Governance-enforced pauses in the last hour
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="fitness.governance.pause-enforced" AND _time:1h' -d 'limit=50'

# Controller pauses in the same window, to line up against the above
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query="playback.paused" AND _time:1h' -d 'limit=100'
```

Match the two by timestamp and by `context.userAgent`, so a second browser's
events are not mistaken for the kiosk's.
