# Fitness Session Identity Reconciliation — Design

**Date:** 2026-07-16
**Status:** Approved shape (Approach 1, effort-based absorb) — pending spec review
**Area:** `frontend/src/hooks/fitness/` (session-end backfill + in-session guest assignment)

---

## Problem

A single HR strap shuffled between roster names at session start crystallizes
into multiple "ghost" participants, and a known user who swaps HR devices
mid-session is recorded as two separate people. The session data model captures
the raw device signal correctly, but the **identity layer** does not reconcile
these cases.

### Motivating case — session `20260627195941` (2026-06-27)

- One ANT+ HR strap (device `29413`). At startup the roster was fumbled:
  attributed to **soren** (ticks 1–2), then **elizabeth** (tick 3), then settled
  on **grannie** (tick 4 onward), who wore it for the whole ~53-minute Jane Fonda
  "Complete Workout (1988)" session.
- The raw `device:29413:heart-rate` series is **one continuous trace with no
  dropout** across those handoffs — proof it was one body the whole time (a
  label fix, not a physical strap handoff).
- Result: **grannie** (966 coins, full trace) plus two ghost participants —
  **soren** (1 coin, 2 HR samples) and **elizabeth** (0 coins, 1 HR sample).

### Why today's machinery missed it

There are already two mechanisms — an in-session threshold absorption
(`GuestAssignmentService` → `SEGMENT_ABSORBED`, gated on
`governance.usage_threshold_seconds`, ~300s) and a session-end backfill
(`sessionBackfill.js`). Three independent failures let the ghosts through:

1. **Superseded entity never closed.** The elizabeth entity stayed
   `status: active, endTime: null` after the device moved to grannie. The
   segment builder fills a null `endTime` with *session end*, so a 4-second
   sliver is measured as a **53-minute** segment → not sub-threshold → not
   absorbed.
2. **Series-only names are invisible to the backfill.** `soren` has no entity
   record at all — he exists only as a per-name timeline series
   (`soren:hr`, `soren:coins`, …). `sessionBackfill.js` reads *only*
   `entities`, so soren can never be reconciled.
3. **Absorption keyed on wall-clock, not effort.** Even with the plumbing
   fixed, the duration-only gate would keep a strap that sat idle (long
   duration, zero effort).

Separately, **cross-device merge for a known user is not implemented at all** —
the existing absorption keys on `deviceId` (same device, different occupant),
so the same person on two devices is never unified.

---

## Goals

- **A — Known-user device-swap merge:** the same *configured* user attributed
  across ≥2 devices in one session is unified into one participant.
- **B — Effort-based absorption:** an accidental assignment with no significant
  usage is folded into the real occupant, regardless of wall-clock duration.
- **Retroactive repair + sweep:** because raw device series are intact, stored
  sessions can be losslessly re-reconciled. A **sweep** scans all historical
  sessions, reports which ones need healing (ghost participants or mergeable
  known-user device swaps), and heals them (dry-run / apply). First target:
  `20260627195941`.

## Non-goals

- Auto-merging **anonymous guests** across devices (no identity basis).
- Changing coin / zone-minute scoring math.
- Inferring participant identity from HR patterns.
- Preserving the exact `usage_threshold_seconds` duration gate as the absorb
  criterion (it is demoted; see Assumptions).

---

## Design

### Overview

The session-end reconciliation pass becomes the **single source of truth** for
final participant identity. The in-session path is hardened only enough to keep
the live roster honest and to stop producing entity-less / never-closed
segments.

```
[in-session]  assign device → occupant
                 └─ close-on-reassign: stamp prior entity endTime + status
                 └─ ensure every assignment has an entity record
[save]        session persisted with clean, closed segments
[reconcile]   identity-reconciliation pass (pure) → final participants/summary
[retroactive] stored YAML → same pass → rewritten participants/summary
```

### Component 1 — Identity reconciliation pass (extends `sessionBackfill.js`)

A **pure function**: `(sessionData) → { plan, participants, summary }`. No side
effects; the caller applies the plan via the session's existing
`transferUserSeries` / participant-rebuild path.

**Segment model.** Build occupancy segments from **both** sources so no
attributed name is invisible:

- **Entity-backed** segments: `{ occupantId, deviceId, start, end }` from
  `entities` (with null `end` normalized to session end).
- **Series-only** segments: for each per-name series
  (`<name>:hr` / `:beats` / `:zone` / `:coins`), derive the tick span where the
  name has non-null data. Attribute a device by matching the name's non-null HR
  ticks to a `device:<id>:heart-rate` series over the same ticks; if no match is
  found, fall back to the device of the **immediate successor** entity (a
  series-only ghost almost always originates from the same reassignment chain).

Each segment carries an **effort** summary computed from its series:
`{ coins, activeWarmZoneSeconds, hrSampleCount }`.

**Rule A — Insignificant absorb (effort-based).** A segment is *insignificant*
iff `coins ≤ max_coins` **AND** `activeWarmZoneSeconds ≤ max_active_zone_seconds`
**AND** `hrSampleCount < max_hr_samples` (all configurable; see below).
An insignificant segment is absorbed **forward** into the successor occupant on
the same device; if there is no successor, **backward** into the prior
substantial occupant on that device (OI-1 style). The absorbed occupant is
removed from `summary.participants`; its scraps merge into the target.

**Rule M — Known-user device-swap merge.** Group segments by `occupantId`. If a
**configured/known** occupant (a real household profile — *not* a synthetic
`guest-*` / `#*` id) has segments on ≥2 distinct devices, **union** them into
one participant: sum coins, recompute HR stats and zone-minutes over the union
of ticks. Applies **regardless of duration or effort** (a real mid-workout
strap swap has significant usage on both segments). On a genuinely overlapping
window (both devices producing real HR at once) prefer the successor device's
samples.

**Rule keep (retained).** If neither A nor M applies, keep the segment as a
distinct participant. The existing OI-2 cycling detection (3+ alternating
substantial segments = shared-strap turn-taking) is preserved so real
turn-taking is never merged.

**Precedence.** Compute effort → **Rule A** (drop insignificant ghosts) →
**Rule M** (union known-user cross-device segments) → emit final participant set.

**Config (`fitness.yml` → `governance`).**
- `usage_threshold_seconds` — retained for back-compat but **no longer the
  absorb gate**.
- `insignificant_usage: { max_coins: 1, max_active_zone_seconds: 5,
  max_hr_samples: 3 }` — new effort gate for Rule A (starting values; tunable).

### Component 2 — In-session close-on-reassign (`GuestAssignmentService`)

- When a device moves to a new occupant, **stamp the previous entity**
  `endTime = now`, `status = 'transferred'` (or `'superseded'`) **even when the
  segment is not absorbed**, so segments are clean, closed, and sequential.
- **Guarantee an entity record for every assignment**, so no attributed name is
  entity-less (fixes the soren case at the source; the reconciliation pass still
  covers any that slip through).
- The live roster drops the prior ghost immediately, so the on-screen
  participant list matches the reconciled save.

### Component 3 — Retroactive heal + sweep (in scope)

A backend CLI (`cli/heal-fitness-sessions.cli.mjs`, following
`merge-fitness-sessions.cli.mjs`) with a pure backend healer
(`SessionIdentityHealer.mjs`) that mirrors the frontend rules against the
**on-disk** representation (RLE `<name>:<metric>` series, decoded via
`TimelineService`). Modes:

- **Single heal:** `heal <date> <sessionId> [--apply]` — dry-run reports the
  plan; `--apply` rewrites `participants` / `summary` and re-encodes series.
- **Sweep:** `--sweep [--since Nd] [--apply]` — scans all historical session
  YAML, reports every session needing healing (ghost participants or mergeable
  known-user device swaps), and heals them with `--apply`.

**Frontend/backend parity:** the live path (frontend `sessionBackfill.js`) and
the healer (backend `SessionIdentityHealer.mjs`) are parallel implementations
of the same rules — a deliberate choice matching the existing frontend/backend
split (cf. `merge-fitness-sessions.cli.mjs` reimplementing summary logic).
Behavioral parity is guaranteed by a **shared golden fixture** (the
`20260627195941` session) asserted on both sides.

---

## Data flow summary

| Path | Trigger | Effect |
|------|---------|--------|
| Live | device reassigned | prior entity closed + stamped; entity guaranteed |
| Save | session end | reconciliation pass writes final participants/summary |
| Retro | maintenance run | same pass rewrites a stored session |

---

## Testing

Unit tests (mirroring the existing `sessionBackfill` / `GuestAssignmentService`
suites), each a fixture → expected participant set:

- **Known-user 2-device swap** → one participant, coins summed. *(Rule M)*
- **Idle strap** (long duration, ~0 effort) → absorbed. *(Rule A; duration-only
  would keep it — regression guard.)*
- **Series-only ghost** (no entity, the soren case) → absorbed.
- **Unclosed superseded entity** measured with real duration after
  close-on-reassign.
- **Real shared-strap turn-taking** (3+ alternating substantial segments) →
  NOT merged/absorbed. *(OI-2 retained.)*
- **Brief-but-real hard burst** (short, but coins > 0) → NOT absorbed.
  *(Effort keeps it.)*
- **Two guest blips on two devices** → NOT cross-merged. *(No identity basis.)*
- **Golden replay** of the `20260627195941` fixture → grannie sole participant;
  soren + elizabeth gone; coins/zone-minutes unchanged for grannie.

---

## Risks & open items

- **Device attribution for series-only names is heuristic** (HR-tick matching
  with successor-device fallback). Acceptable because such names are, by
  definition, insignificant and about to be absorbed; the fallback only affects
  *which* successor they fold into.
- **Effort thresholds need tuning** — hence configurable, with conservative
  starting values.
- **Simultaneous two-device usage by one known user** (true overlap) is rare;
  Rule M documents the successor-preference tiebreak.

## Assumptions (please confirm during spec review)

1. **Effort-based absorb** replaces wall-clock duration as the Rule A gate
   (your "no significant usage" framing). Duration is no longer the criterion.
2. **"Known user" = a configured household profile** (non-synthetic id). Merge
   (Rule M) applies only to these; guests are never cross-device merged.
3. **Retroactive heal + sweep are in scope** as a backend CLI, delivered
   alongside the frontend live fix (parallel implementations, shared golden
   fixture).
