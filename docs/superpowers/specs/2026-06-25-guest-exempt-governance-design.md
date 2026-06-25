# Guests & Exempt Users: Credit Without Consequence — Design Spec

**Date:** 2026-06-25
**Status:** Requirements locked (brainstorm) → ready for implementation plan
**Area:** `frontend/src/hooks/fitness/` (GovernanceEngine, ParticipantRoster, FitnessSession, TreasureBox/TimelineRecorder)

## Goal

Guests and `exempt` users should be **pure upside**: they earn coins and can complete challenges, but they **never** suffer a negative governance consequence (warning, lock, or failure) — in either a periodic challenge or the continuous steady-state requirement.

## Locked decisions

| Question | Decision |
|----------|----------|
| Challenge satisfaction by guest/exempt | **Group tally** — a guest/exempt in the target zone counts toward the challenge's required number and can clear the challenge for the group. |
| Steady-state base requirement | **Subjects-only for satisfaction.** Guests/exempt never trigger it and never satisfy it (preserves the anti-cheat invariant: a primary can't hand the strap to a guest to clear the always-on requirement). |
| Coins | **Yes** — guests/exempt earn coins for their zone work. |
| Negative consequences | **Never**, for guests or exempt, in challenge OR steady-state. |
| `exempt` source | The existing `GovernanceEngine` `config.exemptions` username list. No new tagging. |

## Core model: split one list into two roles

Today a single `activeParticipants` list does three jobs at once — decides who earns coins, who satisfies challenges, AND who is blamed for warnings/locks. Guests are dropped from it entirely (`ParticipantRoster.js:301`), and exempt users are filtered symmetrically inside the engine (numerator and denominator both exclude them). The fix separates two roles:

- **Eligible** = registered + exempt + guests (active, in-zone-capable). → earns coins; counts toward **challenge** achievement (numerator).
- **Subjects** = registered, non-exempt, non-guest. → the ONLY ids that can appear in `requiredCount` (denominator) or `missingUsers` (blame). The ONLY ids that satisfy **steady-state**.

The asymmetry vs. today: the numerator is split from the denominator. For **challenges**, the numerator counts *eligible*; for **steady-state**, everything stays *subjects*. Both gates' denominator/`missingUsers` are *subjects-only*.

## Change surface (verified)

1. **`ParticipantRoster.getActiveParticipantState()` (`:293`)** — stop dropping guests (`if (entry.isGuest) continue`). Return guest-inclusive data plus a way to distinguish roles: e.g. add `eligibleParticipants` (incl. guests) + `guestIds`, and extend `zoneMap` to cover guests. Keep the existing `participants` field meaning **non-guest** so current consumers (steady-state) are unaffected.

2. **`GovernanceEngine` challenge path — `buildChallengeSummary` (`:3488`/`:3512`)** — count **eligible** (subjects + guests + exempt) into `metUsers`/the numerator used by `satisfied`; keep `requiredCount` (`_normalizeRequiredCount`) and `missingUsers` computed from **subjects** only (drop guests, keep the existing exempt drop).

3. **`GovernanceEngine` steady-state path — `_evaluateZoneRequirement` (`:2488`)** — unchanged in spirit (subjects-only for numerator, denominator, and `missingUsers`); just ensure guests, now visible upstream, are excluded here exactly like exempt (no blame, no credit).

4. **`GovernanceEngine._normalizeRequiredCount` (`:2540`)** — denominator must exclude **both** exempt (already) **and** guests. Callers at `:2515`, `:3273`, `:3442`, `:3534` reviewed.

5. **Engine plumbing** — `evaluate()` payload / `_captureLatestInputs` / `_latestInputs` gain an `eligibleParticipants` (+ guest set) alongside `activeParticipants`, so the challenge numerator can read it.

6. **Governance input in `FitnessSession` (`:2041-2096`)** — the snapshot-path `activeParticipants`/`userZoneMap` builder must also produce the eligible set + guest flags and pass them through to `governanceEngine.evaluate()`. (Two governance input paths exist — snapshot here and the pulse path via `getActiveParticipantState`; both must agree.)

7. **Coins — `TimelineRecorder` `currentTickActiveHR` (`:381-395`) → `TreasureBox.processTick` (`:321`/`:352`)** — the per-tick coin-eligible set must include guests/exempt (it is currently built from the same guest-excluding roster). Confirm guests get a `perUser` accumulator (rename-on-assign exists at `TreasureBox.js:278`).

## Anti-cheat invariant to preserve

`ParticipantRoster.js:281` documents: *"a primary user can't escape governance by handing the strap to a guest."* This holds because **steady-state satisfaction stays subjects-only** — a guest's HR can never clear the always-on requirement. Challenges are explicitly group tallies (decision above), so guest credit there is intended.

## Testing focus

- Engine: challenge satisfied by a guest filling the count; steady-state NOT satisfied by a guest; guest/exempt never in `missingUsers`; `requiredCount` denominator excludes guests + exempt.
- Roster: `getActiveParticipantState` exposes guests as eligible but not as subjects.
- Coins: guest/exempt in-zone earns coins via `processTick`.
- Regression: existing GovernanceEngine + ParticipantRoster suites stay green (exempt behavior for steady-state unchanged).

## Open items for the plan phase (need a bit more tracing)

- Exact shape of `effectiveRoster` in `FitnessSession.js:2041` and how guests currently flow (or don't) into the snapshot path.
- Whether `currentTickActiveHR` already includes guests (it derives from per-tick HR; confirm the guest filter).
- The pulse vs snapshot path parity for the new eligible set.
