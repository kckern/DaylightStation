# Cycle Challenge Overlay — As-Built Audit (against production session logs)

**Date:** 2026-06-19
**Scope:** `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
and its data path — `cycleOverlayVisuals.js`, `CycleHealthBar.jsx`,
`useCycleSuccessHold.js`, `ChallengeOverlayDeck.jsx`, `resolveLockScreen.js`,
`cycleDimStyle.js`, and the engine projection in
`frontend/src/hooks/fitness/GovernanceEngine.js`.
**Evidence:** production session log
`media/logs/fitness/2026-06-20T00-03-29.jsonl` (97 MB; 3 cycle challenges,
352 `cycle-challenge-overlay` events), cross-read against the current source.
**Reference docs reconciled:** `__docs/reference/core/cycle-challenge-design.md`
(the 2026-04-17 pre-implementation spec) and
`__docs/reference/fitness/cycing-challenge.md` (the maintained overlay reference).

This is a point-in-time audit. Nothing here is a confirmed crash or data-loss
regression — the overlay rendered and the challenges completed. The findings are
(a) **documentation drift**: three separate descriptions of this overlay
(the component's own docstring, the core design doc, and the fitness reference
doc) all describe affordances the current code does not render; and
(b) **mechanic drift**: the punishment model shipped is materially different from
the one the design doc specifies. The session evidence confirms the as-built
behavior and is captured here so the docs can be corrected.

---

## What the session showed (evidence the system works as built)

Three cycle challenges fired in one ~1h session:

| Challenge id | Phases | Outcome | Notes |
|---|---|---|---|
| `default_0_7_1781914121080` | 3 | **success** | Clean run: `init → ramp → maintain` ×3 → `success`. `cycle_phase_complete` cue at phase 1 and 2, `cycle_success` at the end. |
| `default_0_7_1781915182411` | 2 | **success** | Two **health-locks** during phase 1 (`lockReason: 'health'`, rpm 31 then 50, `loRpm = 60`), both recovered, then `cycle_success`. `totalLockEventsCount` reached 2. |
| `default_0_7_1781915926823` | 3 | **abandoned** | `lockReason: 'init'` at rpm 0 (threshold 30) — rider never started; session ended. |

So the state machine, audio-cue mapping, health-lock + recovery, and the
success hold all functioned. Notably, **`dimFactor` was `0` on every one of the
352 overlay state-change events** — see Finding 5.

---

## Finding 1 — The overlay renders neither booster pips nor countdown text, but every doc says it does

The current `CycleChallengeOverlay.jsx` render tree (lines ~250–440) draws:
ring track, RPM gauge (arc + ticks + hi/lo markers + needle + hub), the
lower-hemisphere phase-progress arc, the target-RPM sign, the rider avatar
(with `CycleBaseReqIndicator` dot and a `done` ✓), a bottom stack of
`CompletionCountBlocks` + a current-RPM readout, the `CycleHealthBar`, and a
boost-multiplier badge.

It does **not** render:

- **Booster corner avatars (NE/SE/SW/NW).** The helper `getBoosterAvatarSlots`
  no longer exists — `cycleOverlayVisuals.js` exports only
  `getCycleOverlayVisuals`, `rpmToAngle`, `polarToCartesian`,
  `CYCLE_OVERLAY_RING_COLORS`. There are no `booster`/`quadrant` classes in
  `CycleChallengeOverlay.scss`.
- **Init / ramp countdown text** ("Start in 8s" / "Reach target in 5s"). There
  is no countdown node in the JSX and no `__countdown` class in the SCSS.
- A persistent rider name (already dropped 2026-05-28; noted for completeness).

Yet all three documentation sources still describe these:

- The component's **own file docstring** (lines 26–27) claims "Up to 4 booster
  avatars at the corners (NE/SE/SW/NW)" and a "Boost multiplier pill … below the
  avatar". The pill is actually a corner badge, and there are no booster avatars.
- `__docs/reference/fitness/cycing-challenge.md` has a **"Booster pips"** section
  ("`getBoosterAvatarSlots` returns up to four corner pips…") and a **Countdown
  text** bullet — both for code that no longer renders.
- `__docs/reference/core/cycle-challenge-design.md` §UI Components item 8 lists
  "Booster avatars — up to 4 small circular avatars positioned in the four
  quadrants".

`boostingUsers` is the dead end that proves it: the engine still emits it
(`GovernanceEngine.js:751`) and the overlay still declares it in `propTypes`
(`:461`), but nothing consumes it in render. Boost is communicated **only** by
the `×N.N` badge.

**Recommendation:** decide intent, then make all four sources agree.
Either (a) restore booster pips + countdown if they are wanted, or (b) delete
the `boostingUsers` prop, fix the file docstring, and trim the two reference
docs. Given the 2026-05-28 "dial, not a status panel" simplification, (b) is the
likely intent — the overlay was deliberately thinned and the docs lagged.

---

## Finding 2 — The shipped punishment model is a health pool, not the design's dim-band/lo-floor model

The core design doc (`§State Machine`, `§Progress & Dim Math`) specifies:

- amber band (`lo ≤ rpm < hi`) → **progress paused + video dims** via `dimFactor`;
- below `lo` → **instant `locked` (maintain-lock)**.

The as-built engine (`GovernanceEngine.js:42-48, 2960-3011`) ships a **health
pool** instead:

- `CYCLE_HEALTH_MAX_MS = 3000` ms, reset to full on challenge start and on every
  `ramp → maintain` entry (`:2772, :3011`).
- Below `loRpm`: health **depletes** at 1 ms/ms; progress frozen. Lock fires
  **only when the pool empties**, with a new `lockReason: 'health'` (`:2965-2982`).
- Amber band (`lo..hi`): health **holds**, progress frozen, `dimFactor` computed
  for the video filter (`:593-596`).
- Green (`≥ hiRpm`): health **regenerates** at 1.5 ms/ms **and** phase progress
  accrues (`:2984-2999`).

This is a different game feel: a ~3 s grace buffer below the red line instead of
an instant lock. The new `lockReason: 'health'` is absent from the design doc's
transition table, which still lists only init/ramp/maintain locks. The log
confirms the health lock is real and the recovery path works (challenge 2
locked-and-recovered twice before succeeding).

**Recommendation:** the core design doc must be rewritten around the health pool
(see companion rewrite of `cycle-challenge-design.md`). The fitness reference doc
already describes the health pool correctly — it is the more current of the two.

---

## Finding 3 — The lock screen is the promoted cycle overlay, not a GovernanceStateOverlay RPM-pill row

Design doc `§Lock screen` specifies reusing `GovernanceStateOverlay` with a new
`&__pill--rpm` variant rendering a rider row (current-RPM pill + target-RPM pill
+ climb bar). That is not what shipped.

`resolveLockScreen.js` instead returns `variety: 'cycle-lock'` /
`'cycle-fail'` and **promotes the cycle overlay itself** to a centered position;
the generic governance panel is never shown while a cycle challenge is active
(it "has no cycle-aware content and previously rendered as a blank box for
non-health locks"). There is no `__pill--rpm` variant. The cycle overlay owns
its presentation in every state, including locked.

**Recommendation:** delete `§Lock screen`'s RPM-pill design from the core doc and
document the promote-overlay model.

---

## Finding 4 — The Engine→UI snapshot contract in the design doc no longer matches either side

The design doc's `§Engine → UI Contract` lists fields the overlay never reads and
omits fields it depends on:

| Design lists (UI does not consume) | UI actually consumes (design omits) |
|---|---|
| `rider.avatar`, `rider.hrZone`, `rider.hr` | `cycleHealthPct` (drives the health bar) |
| `generatedPhases`, `allPhasesProgress` | `lockReason: 'health'` |
| `rampTotalMs` / `initTotalMs` | `baseReqSatisfiedForRider`, `waitingForBaseReq` |
| `swapEligibleUsers` | `clockPaused` |
| lock reasons `init`/`ramp`/`maintain` only | `cadenceFlags.{lostSignal,stale}` |

The avatar is loaded by id (`/api/v1/static/img/users/{riderId}`), not from a
`rider.avatar` URL; HR is surfaced as the base-req **dot**, not as `rider.hr`/
`rider.hrZone` text.

**Recommendation:** regenerate the contract table from the projection in
`GovernanceEngine.js:725-755` and the props the overlay actually destructures.

---

## Finding 5 — `dimFactor` was 0 for the entire session: the orange dim-band ring is effectively dormant

Across all 352 overlay events, `dimFactor` was `0`. The overlay's
`maintainOrange` ring + `dimPulse` branch (`cycleOverlayVisuals.js:108-117`) and
the video dim filter (`cycleDimStyle.js` → `.fitness-player.cycle-dim`,
`FitnessPlayer.scss:1749+`) are wired and live, but never engaged in this
session. That is consistent with the as-built mechanic: riders either hold green
(progress) or drop below `lo` (health drain → hard lock). The amber band — the
only place `dimFactor > 0` — is a thin, transient strip that the health bar, not
the dim ring, is built to punish.

This is not a bug, but it means there are now **two parallel "you're slipping"
visual languages** (soft video-dim + orange ring vs. the health bar) where only
the health bar actually gates playback, and one of them is rarely seen.

**Recommendation:** confirm the dim-band ring/video-dim is still wanted as a soft
pre-warning. If yes, document it as a secondary cue and keep it. If the health
bar is meant to be the sole punishment affordance (as the fitness ref already
states under "Health meter"), consider removing the orange-ring branch and the
`cycle-dim` filter to kill the dead path and the redundant visual.

---

## Finding 6 — Minor footguns

- **`phaseProgressPct` is a fraction, not a percentage.** The engine computes
  `min(1, ms/total)`; the "Pct" suffix is historical. `cycleOverlayVisuals.js:90`
  documents this, but the name will keep tripping readers. Consider a rename or a
  contract note.
- **Overlay remounts at challenge boundaries.** `mounted` re-fires whenever
  `visuals.visible` flips false→true. The success hold (`useCycleSuccessHold`)
  keeps the overlay up via the `done` prop while `visible` is false, so a new
  challenge after a hold re-mounts and resets local state (`imgFailed`). Benign
  today, but worth knowing before adding mount-sensitive state.
- **Health threshold logged is `loRpm`, recovery target is `hiRpm`.** The
  `governance.cycle.locked` event logs `threshold: phase.loRpm` (the line you
  fell below), while recovery requires `≥ hiRpm`. Reading the log, don't mistake
  the logged threshold for the recovery target.

---

## Suggested follow-ups (priority order)

1. **Reconcile the three doc sources** with the trimmed render tree (Finding 1) —
   the rewritten `cycle-challenge-design.md` and a trim of
   `cycing-challenge.md`'s booster/countdown sections + the file docstring.
2. **Decide the dim-band's fate** (Finding 5) — keep-and-document or remove.
3. **Delete the dead `boostingUsers` prop** if booster pips are not coming back.
4. Regenerate the snapshot-contract table from source (Finding 4).

---

## Resolution (2026-06-19)

Actioned via `__docs/superpowers/plans/2026-06-19-cycle-challenge-audit-improvements.md`:

- **Finding 1 (vestiges):** Removed — dropped the dead `boostingUsers` /
  `initRemainingMs` / `rampRemainingMs` overlay props and fixed the docstring;
  booster pips + countdown are not restored. Reference docs resynced.
- **Finding 2 / 3 / 4 (mechanic / lock-screen / contract drift):** Resolved in
  docs — the core design reference was rewritten around the health pool, the
  promoted-overlay lock screen, and the real snapshot contract.
- **Finding 5 (dim band):** Kept as a documented soft pre-warning (no code change).
- **New (health bar):** The health bar is now hidden by default, shown only when
  the rider is below the red line or health-locked.
- **New (never-started failure):** A cycle stuck in the init lock past the grace
  window now fails (recorded, cooldown applied, cleared) instead of sitting in
  limbo — closing the "never start to avoid the work" gap.
- **New (boost badge):** Enlarged ~2× for legibility.
