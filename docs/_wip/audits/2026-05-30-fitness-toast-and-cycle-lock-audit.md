# Fitness Toast + Cycle Challenge Lock — Audit

**Date:** 2026-05-30
**Trigger:** Live session feedback after deploying the rider/challenge toasts and the cycle-challenge overlay redesign.
**Scope:** Four areas — (A) toast countdown direction + tap-to-dismiss, (B) challenge toast wording, (C) cycle overlay UX clutter, (D) cycle health-lock pause/lock behavior (the big one).

> **Evidence caveat:** The most recent fitness session JSONL available at audit time
> (`media/logs/fitness/2026-05-30T03-20-10.jsonl`) was a **no-media session** — it never
> entered a real cycle health-lock (`governance.evaluate.no_media_or_rules`,
> `sessionActive:false` across all 13 profile samples). Area D root causes below are
> therefore derived from **code reading + the user's eyewitness account of the live
> session**, not from a replayed logged failure. The fix plan should add explicit
> health-lock logging so the next occurrence is observable.

---

## A. Toast countdown bar direction + tap-to-dismiss

**Files:** `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx`, `FitnessToast.scss`

### A1. Bar runs right-to-left; want left-to-right
`FitnessToast.scss:57-66` + keyframe `fitness-toast-countdown` (lines 69-72):
```scss
&__countdown-bar {
  transform-origin: left center;
  animation-name: fitness-toast-countdown;  /* scaleX(1) → scaleX(0) */
}
@keyframes fitness-toast-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
```
With `transform-origin: left center`, scaling X from 1→0 collapses the bar **toward the
left** — the filled portion recedes right→left. To make the depletion travel
**left→right**, change `transform-origin` to `right center` (the bar then collapses toward
the right edge). One-line CSS change; no JS.

### A2. Toast is not tappable
`FitnessToast.scss:7` sets `pointer-events: none` on the root (non-blocking by design), so
taps/clicks pass straight through. There is **no onClick/onTouch handler** in
`FitnessToast.jsx`. The mount (`FitnessApp.jsx:1403`) already wires
`onDone={fitnessCtx.dismissFitnessToast}`, and `dismissFitnessToast(id)` clears the slot
when the id matches (`FitnessContext.jsx:1216`). So tap-to-dismiss needs: (1) make the
toast capture pointer events, (2) on tap, run the same exit path as the timer (set
`exiting`, then call `onDone(id)` after `TOAST_EXIT_MS`) so the fade still plays.

---

## B. Challenge toast wording — "riders" is wrong

**File:** `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js:14,18,25`
```js
const riderWord = (n) => (n === 1 ? 'rider' : 'riders');
// start:  `Get ${requiredCount} ${riderWord(requiredCount)} to ${zoneLabel}`
// end:    `${actualCount} of ${requiredCount} ${riderWord(requiredCount)} reached ${zoneLabel}`
```
Zone challenges are HR-based and satisfied by anyone (jumping jacks, walking in place,
cycling), so "riders" is wrong. Replace with **"people"** (singular "person"):
"Get 3 people to Active" / "3 of 3 people reached Active" / "Get 1 person to Active".
Pure helper, fully unit-tested — a contained change to the word function + its tests.
(The **rider** toast, `buildRiderToast.js`, legitimately says "is riding the X" and is out
of scope — that one really is a bike assignment.)

---

## C. Cycle overlay UX clutter (layout jump + mystery badge)

**Files:** `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`, `.scss`, `cycleOverlayVisuals.js`

The lower content lives in a **bottom-anchored flex column** `__stack`
(`CycleChallengeOverlay.scss:179-191`: `position:absolute; bottom:…; flex-direction:column`).
Because it's anchored at the bottom and grows upward, **adding any flex child shoves
everything above it up**. Two conditional children cause the observed jumps:

### C1. Boost multiplier badge — keep, but float (don't reflow the stack)
`CycleChallengeOverlay.jsx:411-418` renders `__boost-badge` ("×2.5") as a flex child of
`__stack`, gated by `showBoostBadge = boostMultiplier > 1` (jsx:224-228). When boost kicks
in, this new flex child pushes the health meter / phase blocks / RPM readout upward.
**Desired:** keep the badge but take it out of the stack flow — render it
**absolutely-positioned, floating underneath** the overlay so its appearance doesn't
reflow anything. (CSS `&__boost-badge { position:absolute; … }` + move the JSX out of
`__stack`.)

### C2. Status label — remove entirely
`CycleChallengeOverlay.jsx:431-447` renders `__countdown` — the init/ramp status text
("Start in 23s" / "Paused — reach target in 7s"), gated on
`cycleState==='init'|'ramp'` with finite remaining ms. This is the "status label that
appeared and bumped things up." **Desired:** remove this element (and its `__countdown`
SCSS, lines 220-226) outright.
> ⚠️ Confirm in spec: the user said "remove the status, don't need that at all." The only
> stack child matching "a status label that appears" is `__countdown`. There is no other
> free-text status string in the overlay. Treating `__countdown` as the removable status.

### C3. Mystery top-right circle-with-a-letter — remove
The "little circle badge with a letter near the top right" that appears with the
multiplier is a **booster avatar**. `CycleChallengeOverlay.jsx:458-467` maps
`getBoosterAvatarSlots(challenge.boostingUsers)` to up-to-4 circular pips at the corners;
`cycleOverlayVisuals.js:218-239` positions slot 0 at **NE (top:16%, left:84%)** = top-right
and sets its label to the **first initial** of the booster's user id. SCSS `&__booster`
(309-326): `border-radius:50%`, single letter. Boosters appear exactly when there are
`boostingUsers`, which is also when `boostMultiplier > 1` — hence "appeared at the same
time as the multiplier badge." **Desired:** remove the booster avatars entirely (the JSX
map + the `getBoosterAvatarSlots` usage + `&__booster` SCSS).

### C4. What stays
Outer ring, RPM gauge (arc/ticks/needle/target sign), centered rider avatar + HR gate dot,
health meter, phase-count blocks, current-RPM readout, lower-hemisphere phase arc. Only the
three items above change.

---

## D. Cycle health-lock pause/lock — the broken behavior

**Observed (live):** when the cycle health meter hit zero, the video paused with the
*regular* pause; a governance lock screen **sometimes** appeared but was **blank**; when it
did, the **CycleChallengeOverlay vanished**. Not the intended experience.

**Intended:** on health-zero, the **CycleChallengeOverlay itself becomes the lock screen**
— moves to center, scales ~2×, plays the **same lock-screen music**, and is a **real lock**
(user can't press play to resume). It must be a **cycle-specific lock variety**, NOT the
standard governance lock screen.

### D1. Current control flow (health-zero → pause → overlay swap)
1. **Engine sets the lock** — `GovernanceEngine.js:2763-2780`: in `maintain`, when
   `equipmentRpm < phase.loRpm`, `cycleHealthMs` depletes; at `<= 0` it sets
   `active.cycleState='locked'`, `active.lockReason='health'` and logs
   `governance.cycle.locked`.
2. **Snapshot** — `_buildChallengeSnapshot` (`GovernanceEngine.js:707-736`) emits the cycle
   snapshot with `type:'cycle'`, `cycleState:'locked'`, `lockReason:'health'`,
   `cycleHealthPct:0`. The 500ms state-change debounce is **bypassed** for health locks
   (`GovernanceEngine.js:688-689`: `fatal = … || lockReason === 'health'`), so the locked
   state surfaces immediately.
3. **videoLocked** — `GovernanceEngine.js:1725-1729`: a dedicated second clause forces
   `videoLocked:true` for `type==='cycle' && cycleState==='locked' && lockReason==='health'`
   **independently of governance phase** (phase typically stays `'unlocked'` because HR base
   reqs are still met).
4. **Pause** — `FitnessPlayer.jsx:279-285` feeds `videoLocked` into `resolvePause`
   (`pauseArbiter.js`); `governancePaused` becomes true and the effect calls the **ordinary
   `pausePlayback()`**. There is **no distinct health-lock pause path** and **no music**
   tied to it here.
5. **Overlay routing** — `FitnessPlayerOverlay.jsx:196-216`:
   - `isHealthLock` guard (196-198) keeps `CycleChallengeOverlay` rendered for health locks.
   - `primaryOverlay` (211-216) renders `GovernanceStateOverlay` only when
     `governanceDisplay.show` is true.
   - `useGovernanceDisplay.js:42-53`: for `status==='unlocked'` + cycle + `cycleState==='locked'`
     + `lockReason==='health'`, it returns `{ show:false, rows:[], videoLocked:true }`.

### D2. Root cause — blank lock screen
The generic `GovernanceStateOverlay` is meant to be suppressed on health-lock (show:false).
The **blank** screen appears when governance momentarily computes `show:true` with **empty
rows** — i.e. when `status` is NOT `'unlocked'` at that tick (e.g. the rider also dropped HR
so base reqs lapsed → status `pending`/`locked`), OR during a stale-state transient (D4).
`GovernancePanelOverlay` then renders with `rows:[]` → "Waiting for participant data…" /
empty table = a **blank lock panel**. The lock UI and "should this lock UI show" decision are
coupled to governance phase, which is the wrong owner for a *cycle* health lock.

### D3. Root cause — CycleChallengeOverlay vanishing
On the same tick the generic lock renders, the cycle overlay can disappear because its
visibility (`FitnessPlayerOverlay.jsx:199-202`) reads `activeChallenge.cycleState`. If a
stale/transient snapshot briefly reports `cycleState!=='locked'` while *also* not being a
clean health-lock, the double-negative guard `!(cycleState==='locked' && !isHealthLock)`
evaluates such that the cycle overlay is dropped. There is **no single owner** deciding
"during a cycle health-lock, show exactly the cycle overlay (promoted) and nothing else" —
two independent conditionals can both lose.

### D4. Root cause — "only sometimes" (race)
`GovernanceEngine` throttles `state` via a 200ms cache (`_stateCacheThrottleMs`,
~line 1500) and notifies React via a **microtask** (`_invalidateStateCache` →
`queueMicrotask(onStateChange)`, ~1638-1649). Between the synchronous engine state change
and the microtask-driven re-render, a React render can read the **stale cached snapshot**
(pre-lock `cycleState`). For that ~5-10ms window both overlays' conditions can be
unsatisfied (cycle overlay sees not-locked; governance sees show:false or empty rows),
producing the intermittent blank/vanish. The intermittency is a **timing artifact of the
split decision**, not a logic constant.

### D5. Lock-screen music is not wired to the cycle lock
Lock music lives in `GovernanceAudioPlayer.jsx` (`AUDIO_TRACKS.locked =
'audio/sfx/bgmusic/fitness/locked'`) and is **only mounted inside `GovernanceStateOverlay`**
(`GovernanceStateOverlay.jsx:599/613/.../648`), with `audioTrackKey` (576-588) returning
`'locked'` for locked/failed/videoLocked states. Because the cycle health-lock **suppresses
GovernanceStateOverlay**, the audio player is never mounted → **no music plays** on the cycle
lock. The redesign must mount the locked track for the cycle lock independently.

### D6. Real-lock enforcement
Pause comes from `videoLocked` via the pause arbiter, which re-evaluates continuously, so as
long as `videoLocked` stays true the video should re-pause if the user hits play. Audit need:
confirm the pause arbiter actually **re-pauses on play attempts** while `videoLocked` (not
just once), and that the cycle lock keeps `videoLocked` asserted until the rider pedals back
above `loRpm` (recovery path: `GovernanceEngine.js` cycle maintain/recover logic, ~2760+,
and the `videoLocked=false` resets at 3105/3178/3271/3373/3390/3441).

### D7. Abstraction seam (why this is hard today)
There is **no "lock-screen variety" concept**. Lock UI = `GovernanceStateOverlay`; its
render decision (`governanceDisplay.show`), its audio, and the cycle overlay's visibility are
three separate booleans across two files. A cycle health-lock is conceptually "a different
kind of lock screen" but the code has only one. **Seam:** introduce a single resolver that,
given governance + challenge state, returns the **active lock descriptor**
`{ variety: 'none'|'governance'|'cycle-health', show, audioTrack, promote /*center+scale*/ }`,
and have `FitnessPlayerOverlay` render exactly one lock presentation + its audio from that
descriptor. That removes the split-brain (fixes D2/D3/D4), gives the cycle lock its music
(D5), and makes "promote the cycle overlay to center, 2×" a property of the descriptor.

---

## Proposed remediation shape (detail belongs in the spec/plan)

- **A1:** `transform-origin: right center` on `__countdown-bar`.
- **A2:** toast root `pointer-events:auto` + onClick/onTouch → exit-then-`onDone(id)`.
- **B:** `buildChallengeToast` "riders"→"people"/"person"; update tests.
- **C1:** boost badge → absolutely-positioned float, out of `__stack`.
- **C2:** remove `__countdown` element + SCSS.
- **C3:** remove booster avatars (JSX map + `getBoosterAvatarSlots` use + `__booster` SCSS).
- **D:** introduce a **lock-screen-variety resolver** (pure, testable) that is the single
  owner of "which lock shows, with what audio, promoted or not." Cycle health-lock →
  variety `cycle-health`: render the (promoted, centered, ~2× scaled) `CycleChallengeOverlay`
  as the lock, mount the `locked` audio track, suppress `GovernanceStateOverlay`, keep
  `videoLocked` asserted (real lock), and verify the pause arbiter re-pauses on play
  attempts. Add `governance.cycle.health_lock.*` logging so the next live occurrence is
  observable.

## Open questions for the spec
1. **C2 confirm:** is `__countdown` (init/ramp "Start in / Reach target in") definitely the
   "status label" to remove? (No other status text exists in the overlay.)
2. **D promote mechanics:** when promoted to lock, should the cycle overlay scale via a CSS
   class on a centered wrapper (simplest), and should the rest of the challenge deck / other
   overlays be fully hidden behind it?
3. **D music lifecycle:** start `locked` track on health-lock enter, stop on recover —
   confirm it should duck/stop the main media audio the same way the governance lock does.
