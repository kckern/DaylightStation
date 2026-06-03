# Cycle Challenge Overlay — Polish & Fixes (design)

**Date:** 2026-06-02
**Status:** Approved design, ready for implementation plan
**Supersedes/extends:** `docs/plans/2026-04-17-cycle-challenge.md` (original feature plan) and the 2026-05-03 overlay redesign already in the codebase.

## Background

The cycle challenge feature (RPM-based, single-rider, multi-phase, with progressive video
dimming and an HR-driven social boost) is functionally built and shipped. A round of visual
polish and bug-fix requests was given verbally but the written plan was lost; this spec
re-captures those requests, grounded in the current code and a real session log
(`media/logs/fitness/2026-06-03T02-32-44.jsonl`, a 4-phase success run by rider `felix`
that exercised ramp-timeout and health locks).

Five work items, plus one cleanup. Most of the underlying data and plumbing already exist;
the work is surfacing it correctly, redesigning a few elements, and fixing lock/fail routing.

---

## 1. Health bar — segmented, relocated

**Today:** A smooth fill bar (`__health-meter` / `__health-fill`) lives *inside* the circular
widget's bottom `__stack`, above the phase blocks and RPM readout.

**Target:** A horizontal **segmented** bar (Mega-Man pip style), relocated to sit **below the
circular widget as the lowest element**, full overlay width.

- Default **10 discrete segments**; lit count = `ceil(cycleHealthPct × N)`.
- Depletes **right → left** as health drains below `loRpm`.
- Color trends green → red as it empties (segment fill color driven by remaining fraction).
- **0 lit segments = health-locked** (empty bar is the visual signal that the video is locked).
- Preserve accessibility: `role="meter"`, `aria-valuemin/max/now`.

Remove the old smooth meter markup from `__stack`. The new bar is its own row outside the
circular SVG/stack region.

## 2. Phase counter — flashing active block

**Today:** `CompletionCountBlocks` (shared by the HR challenge and the cycle overlay) renders
rounded-square pips with only two states: complete / incomplete. There is no "active" state.

**Target:** The currently in-progress phase square **flashes black ↔ white**.

- Add an **optional `activeIndex` prop** to `CompletionCountBlocks`. The cycle overlay passes
  `currentPhaseIndex`; the HR challenge omits it (so HR behavior is unchanged — "Cycle only"
  scope per decision).
- The block at `activeIndex` receives an `--active` modifier class that animates a
  black↔white flash via CSS keyframes. Completed blocks stay lit; future blocks stay dim.

## 3. Multiplier — on HR tiles + cycle total

**Decision:** The boost multiplier surfaces both on the per-participant heart-rate tiles and
as a combined total on the cycle overlay. The boost pool is **rider + all other
participants** (the rider's own HR zone self-boosts).

**Today:** `GovernanceEngine._computeBoostMultiplier` (≈ line 2871) already sums every
`activeParticipant`'s `zoneMultipliers[zone]` (rider included) into `boostMultiplier`, and the
snapshot already carries `boostMultiplier` + `boostingUsers` (contributor ids). The cycle
overlay's `__boost-badge` only renders when `boostMultiplier > 1`, so with a solo rider in a
non-boosting zone it never appears. The HR tiles (`FullscreenVitalsOverlay`) show no
multiplier at all.

**Target:**

- **Engine:** add a `boostContributions` map to the snapshot — `{ userId → contribution }`,
  where contribution is `zoneMultipliers[userZone]` for that participant (0 / absent when
  their zone doesn't boost). This lets the UI show each person's share without recomputing.
- **HR tiles (`FullscreenVitalsOverlay`):** when a cycle challenge is active, render a small
  `×N` boost badge on **each** participant's tile (rider included) reflecting their
  contribution.
- **Cycle overlay:** reposition the existing `__boost-badge` so the combined **`×total`** is
  reliably visible whenever `total > 1.0`.

> Display-format note: per-tile badge shows that participant's contribution; cycle badge shows
> the combined total (`1.0 + Σ contributions`, capped at `maxTotalMultiplier`). Exact glyph
> (`×` vs `+`) finalized in implementation to match the existing badge styling.

## 4. Lock / fail — always the cycle overlay, never the generic panel

**Today (confirmed by logs):** `resolveLockScreen.js` promotes the cycle overlay as the lock
screen **only when `lockReason === 'health'`**. Every other lock reason (`init`, `ramp`,
`maintain`) falls through to the generic `GovernanceStateOverlay`, which has no cycle-aware
content → the **blank/empty box**. Returning to green can leave that panel up for a tick → the
**lingering empty box**.

**Target:** A cycle challenge **never** renders the generic governance panel. It owns its own
lock and fail presentation.

- `resolveLockScreen.js`: promote the cycle overlay for **any** cycle lock
  (`cycleState === 'locked'`, regardless of `lockReason`) **and** for a terminal fail
  (`status === 'failed'` / `'abandoned'`). Set `showGovernanceOverlay: false`,
  `showCycleOverlay: true`, `promoteCycle: true`, `videoLocked: true`, `audioTrack: 'locked'`.
- Add an explicit guard: when `activeChallenge.type === 'cycle'` and the challenge is **not**
  locked/failed, return `variety: 'none'` / `showGovernanceOverlay: false` — so the generic
  panel can never appear for a cycle challenge in any state. This fixes both the
  blank-first-time box (was the routing miss) and the lingering-after-green box.
- **Fail treatment** lives inside the promoted cycle overlay: red ring + a brief
  "Challenge failed" message, auto-clearing via a hold analogous to `useCycleSuccessHold`
  (new `useCycleFailHold`, or extend the existing hold to cover terminal outcomes).

> Note: today the only observed cycle terminal outcomes are `success` and recoverable locks;
> a dedicated terminal `failed`/`abandoned` path may need to be confirmed/added in the engine.
> The routing change above applies regardless and is the substantive fix.

## 5. Success toast — make it fire (benchmark the HR challenge)

**HR benchmark:** On success the HR challenge shows a 🏆 "Challenge complete!" toast
(`buildChallengeToast` `event: 'end'`) **and** a ✅ green-ring hold in the overlay
(`CHALLENGE_SUCCESS_HOLD_MS = 2000`).

**Today:** The cycle overlay already does the ✅ / green-ring hold via `useCycleSuccessHold`.
The toast plumbing exists too — `FitnessContext.jsx:2240` feeds the governance challenge
snapshot through `nextChallengeToast` → `buildChallengeToast`, and `buildChallengeToast`
already has a `type === 'cycle'` contributor branch. The logs show
`governance.cycle.completed status:success`, yet no toast appears.

**Target:**

- Diagnose and fix why the `end` toast doesn't emit. Most likely cause: the success snapshot
  (with a stable `id` and `status: 'success'`) does not survive even one `FitnessContext`
  evaluation before the challenge is cleared (cooldown nulls `activeChallenge`), so the toast
  tracker never observes `status: 'success'` for that id. Ensure the success snapshot is
  emitted for at least one evaluation tick before clearing.
- Give `buildChallengeToast` a **cycle-specific subtitle** (e.g. "Felix completed 4 phases")
  instead of the HR "X of Y people reached zone" text, which is meaningless for a cycle.

## 6. Cleanup — delete the stale overlay test

`tests/unit/fitness/CycleChallengeOverlay.test.mjs` (Apr 18) imports the removed
`getBoosterAvatarSlots` helper and contributes the 12 currently-failing tests. The colocated
`frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx` covers the
redesigned overlay. Delete the stale `.mjs`.

---

## Components touched

| File | Change |
|------|--------|
| `CycleChallengeOverlay.jsx` / `.scss` | Remove inline smooth health meter; add segmented health bar below widget; pass `activeIndex` to counter; reposition boost badge; wire fail treatment + hold |
| `CompletionCountBlocks.jsx` | Optional `activeIndex` prop + `--active` flashing modifier (cycle-only) |
| `FullscreenVitalsOverlay.jsx` / `.scss` | Per-tile `×N` boost badge when a cycle challenge is active |
| `resolveLockScreen.js` | Promote cycle overlay for all lock reasons + fail; suppress generic panel for any cycle challenge |
| `GovernanceEngine.js` | Add `boostContributions` map to snapshot; ensure success snapshot survives one eval tick; confirm/define terminal fail path |
| `buildChallengeToast.js` | Cycle-specific success subtitle |
| `useCycleSuccessHold.js` (or new `useCycleFailHold.js`) | Fail-outcome hold so the failed cycle overlay shows briefly then clears |
| `tests/unit/fitness/CycleChallengeOverlay.test.mjs` | Delete (stale) |

## Testing

- **Unit:** segmented health bar (segment count vs `cycleHealthPct`, 0-lit = locked);
  `CompletionCountBlocks` active-index flashing (and HR unaffected when omitted);
  `resolveLockScreen` matrix (each lock reason → cycle promoted, generic suppressed; recovered
  → none; fail → cycle promoted); engine `boostContributions` shape; `buildChallengeToast`
  cycle subtitle; fail hold timing.
- **Live flow (Playwright):** lock/fail routing renders the speedometer overlay (never a blank
  box) and clears cleanly on return to green; cycle success fires the 🏆 toast.

## Out of scope

- Changes to the cycle *game* (racing feature: `CycleGameContainer`, `CycleRaceScreen`,
  `RaceRecap`) — a separate feature with its own in-flight work.
- The original plan's integration tests (`tests/integrated/governance/cycle-challenge.*`),
  which were never created; tracked separately.
