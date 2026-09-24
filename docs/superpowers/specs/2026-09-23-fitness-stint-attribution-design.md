# Fitness Stint Attribution — Design

**Date:** 2026-09-23
**Status:** Implemented (branch feat/fitness-stint-attribution, 2026-09-23)
**Area:** `frontend/src/hooks/fitness/` (live reassignment, stint records, save-time
reconciliation), `backend/src/2_domains/fitness/services/SessionIdentityHealer.mjs`
(retroactive heal), `frontend/src/modules/Fitness/widgets/FitnessChart/` (verification only)
**Amends:** [2026-07-16 Fitness Session Identity Reconciliation](./2026-07-16-fitness-identity-reconciliation-design.md)

---

## Problem

When an HR strap is reassigned to a different person mid-session, the session splits
that person's workout across two ledgers that do not move together:

- the **timeline series** (HR, zone, rings, beats history) is moved to the new person,
  back to the start of the session;
- the **running counters** (TreasureBox ring accumulator, TimelineRecorder cumulative
  beats) stay with the previous person and keep following them onto whatever strap
  they wear next.

Because the timeline copies the counters into `user:X:rings_total` / `heart_beats`
every tick, the moved history is overwritten on the very next tick. The result is a
cumulative line that **falls** for one person and **jumps** for another, wrong ring
totals in the saved `summary`, and ghost participants.

### Motivating case — session `20260923183528`

Six riders, three reassignments (placeholder names):

| Strap | Sequence | Physical truth (device HR trace) |
|---|---|---|
| D1 | auto `kid-d` → 12 s later assigned `guest-c` | `guest-c` wore it; no HR before the handoff |
| D2 | auto `kid-a` → 4 s later assigned `kid-b` → 4 min later back to `kid-a` | **continuous HR trace across both relabels** — one body (`kid-a`) throughout |
| D3 | auto `kid-e` → 11 s later assigned `kid-b` | `kid-b` wore it |

Saved result:

- `kid-a:rings` climbs to 88 then **drops to 1** (tick 191); `kid-b:rings` jumps **1 → 89**
  (tick 192). `kid-a:beats` 586 → 20; `kid-b:beats` 20 → 596.
- `kid-a` credited 293 rings (should be ≈381); `kid-b` 179 (should be ≈91).
- `kid-a` saved `is_guest: true`; `guest-c` and `kid-b` saved `is_primary: true`.
- `kid-d` (0 rings) and `kid-e` (1 ring, no HR) persisted as participants.
- The history chart draws `kid-a`'s line sloping **down** 87 → 6 and `kid-b`'s as a
  vertical spike; the live chart additionally stranded a dropout badge on `kid-a`'s line.
- `entities: []` — no stint records at all, so the July save-time reconciliation had
  nothing to reconcile.

### Root causes (verified in code)

1. `TreasureBox.transferAccumulator` is a stub (`transfer_disabled`, returns `false`) —
   "strict userId mode" disabled entity accounting and took user-to-user ring transfer
   with it.
2. `FitnessSession.transferUserSeries` sends the cumulative-beats transfer to
   `MetricsRecorder`, which does not write ticks; `TimelineRecorder` (which does) is
   never told.
3. `FitnessTimeline.transferUserSeries` moves the source's **whole-session** series and
   **overwrites** the destination rather than moving the stint and merging.
4. Absorbed user-to-user reassignments skip entity creation
   (`GuestAssignmentService.js:246`) and auto-assigned members never get one, so the
   July design's guarantee ("an entity record for every assignment") does not hold.
   Only 8 of 218 sessions (Jun–Sep 2026) carry any entity; none has a closed one.
5. Persisted participant flags are path-derived: `is_guest` from the ledger's
   `occupantType`, `is_primary` defaults to true because the roster never sets it,
   `base_user` is a member's own name.

### Frequency

Of 218 sessions Jun–Sep 2026, 93 had more than one participant and ~5 show
reassignment artifacts. Rare but recurring — the same strap (`kid-d`'s) is repeatedly
lent out and leaves a ghost each time (2026-07-18, 2026-09-18, 2026-09-23).

---

## Decisions

- **Finish the July design; do not redesign the model.** Stint records + a save-time
  reconciliation pass remain the architecture. No per-stint counters, no entity-keyed
  live accounting (YAGNI at ~2% of sessions).
- **Amendment to July — an explicit relabel within the usage window is a correction.**
  The sidebar already promises "{name}'s last N min on this strap will transfer to
  whoever you pick". A reassignment inside `governance.usage_threshold_seconds` moves
  the stint to the picked person **regardless of effort**. July's effort gate
  (Rule A) now applies only to stints nobody relabelled. This removes a live/save
  contradiction: live absorbed `kid-a`'s stint by duration, while July's save-time
  rules would have kept an 88-ring stint as `kid-b`'s.
- **No HR-pattern identity inference** (unchanged July non-goal). The continuous-trace
  observation above is evidence for this design, not an input to it.

## Non-goals

- Fitness UI render performance (`fitness.render_thrashing`, excessive renders,
  video FPS degradation) — real, but independent of attribution; separate initiative.
- Pressure-mat per-user totals — credited by equipment rider, not HR strap.
- Deleting dead code beyond what this work touches (`ParticipantIdentityResolver`,
  `Device.assignedUser`, `SessionSerializerV3.serialize`,
  `MetricsRecorder.collectMetrics`).
- Changing ring / zone-minute scoring math.

---

## Design

### 1 — Live reassignment moves one stint, completely

New `FitnessSession.reassignStint(deviceId, toUserId, { mode })`, called by
`GuestAssignmentService` after it classifies the reassignment
(`correction` inside the usage window, `handover` outside).

**Handover:** nothing moves; the open stint closes (§2) and a new one opens now.

**Correction:** the window is `[stint.startTick, currentTick]` for that device only.

| Store | Behaviour |
|---|---|
| Timeline point series (`hr`, `zone_id`, `rpm`, `power`, …) | Cells in the window move from → to. Destination-wins only on true overlap (to on two straps at once). |
| Timeline cumulative series (`rings_total`, `heart_beats`) | Source flattens at its `startTick` value for the rest of the window; destination adds the window's **increments** on top of its own running total. |
| TreasureBox accumulator | `delta = from.totalRings(now) − from.totalRings(startTick)`; `from −= delta`, `to += delta`. The in-flight interval state (`highestZone`, `currentIntervalStart`, `lastHR`, colour) moves with the strap. |
| TimelineRecorder `_cumulativeBeats` | Same delta rule (fixes the MetricsRecorder misdirect). |
| ActivityMonitor | Activity periods inside the window move. |
| ZoneProfileStore | Nothing copied; destination's zone config applies from now, its hysteresis state resets. |

Invariant: **every transfer is a stint delta, never a copy of a total.** Per-person
cumulative series are non-decreasing and the sum of `totalRings` across people is
unchanged by any reassignment.

Removed: `TreasureBox.transferAccumulator` stub, the whole-series
`FitnessTimeline.transferUserSeries`, the entity-series transfer branch
(`transferEntitySeries` / `transferSessionEntity` path — no `entity:*` series is ever
written), `MetricsRecorder.transferCumulativeMetrics` call site.

### 2 — Every assignment is a stint record; a correction relabels it

`SessionEntity` is kept and narrowed to one meaning: a **stint** — one occupant on one
strap over a time span. It has no live-accounting role.

| Event | Stint effect |
|---|---|
| Strap first mapped to a person (including member auto-assign in `recordDeviceActivity`) | open |
| Unknown strap starts broadcasting | open for `device:<id>` |
| Correction | **relabel open stint in place** — occupant becomes the new person, prior occupant appended to `relabeledFrom` |
| Handover | close (`endReason: 'handover'`), open new |
| HR dropout | no change (dropouts are routine; the strap usually returns) |
| Device pruned / session end | close (`'dropped'` / `'session-end'`) |

Fields added: `startTick`, `endReason`, `relabeledFrom: string[]`. Removed: `rings`
(always 0; stint totals are derived from series at save time).

`ensureStarted` opens stints for **every** ledger entry, not only guests. The ledger's
`entityId` always names the device's open stint. `ParticipantRoster` stops using
`entityId` as its zone tracking key (fixes the `trackingId` lookup miss) and the
unassigned `this._session` read at `ParticipantRoster.js:606` is fixed or removed.

The motivating session would have recorded:

```
D1  18:45:31 → end  guest-c  relabeledFrom [kid-d]
D2  18:47:01 → end  kid-a    relabeledFrom [kid-a, kid-b]
D3  18:51:09 → end  kid-b    relabeledFrom [kid-e]
D4  18:35:19 → end  parent
```

`entities[]` is already persisted and passed through by the backend; sessions without
the new fields are handled as today.

### 3 — Save-time reconciliation honours relabels; effort rules sweep leftovers

Changes to `runSessionBackfill` (`sessionBackfill.js`) and `PersistenceManager`:

1. **Relabelled stints are authoritative.** A stint with non-empty `relabeledFrom` is
   exempt from effort absorb and cycling detection; only its final occupant counts.
2. **Existing July rules apply only to un-relabelled stints:** effort absorb
   (≤1 ring, ≤5 s active zone, <3 HR samples → fold forward), known-user
   cross-device merge, late-tag placeholder merge, OI-2 cycling honour.
3. **Participants come from surviving stints.** `_augmentRosterFromSeries` no longer
   promotes series-only names when stints exist. Legacy sessions with no stints keep
   the series-derived `buildOccupancySegments` fallback.
4. **Participant flags describe the person, not the assignment path:**
   - `is_guest` — friends, generic guests and unknown straps true; household members
     false (a member given their own strap back is not a guest).
   - `is_primary` — from the config `primary` list, not defaulted.
   - `base_user` — guests only (the strap's owner); never a member's own name.
   - `display_name` — the configured name, not the slug.
5. **Summary from reconciled series, with a cumulative guard.** `buildSessionSummary`
   already runs after the backfill. Add: any cumulative series (`rings`, `beats`,
   `rotations`) that decreases logs `fitness.persistence.cumulative_regressed`
   (participant, tick, drop) and is persisted flattened across the dip.

Expected result for the motivating session: `kid-a` ≈381 rings (member), `kid-b` ≈91,
`guest-c` 508 (guest), `parent` unchanged, `kid-d` / `kid-e` gone.

### 4 — Retroactive heal of past sessions

Past sessions have no stints and reassignment logs are past retention, so the healer
works from the saved series. The HR/zone series were already moved correctly live;
only cumulative series are broken, and they break detectably: a drop in one person
paired with an equal jump in another within a tick or two (ring conservation).

Added to `SessionIdentityHealer` (`cli/fitness.cli.mjs session heal`):

1. **Split repair.** For `rings` and `beats`: pair a drop of D in person P with a jump
   of D′ (|D − D′| ≤ 2) in person Q within 3 ticks; cancel both steps. The rings stay
   with whoever's HR series covers the pre-drop ticks. An unpaired drop is reported,
   never guessed.
2. **Reconcile as §3:** effort-absorb ghosts, recompute participant flags from config,
   rebuild `summary`, re-stamp integrity.

Run: `--sweep --since 120d` dry-run reports per-session, per-person before/after;
`--apply` on reviewed sessions only, first `20260923183528`. Originals go to the
existing `_backups/`. Weekly ring totals and the session list read `summary`, so they
self-correct once the file is rewritten; Strava links are untouched.

### 5 — Testing

All unit suites run under the vitest gate (`npm run test:unit:vitest`).

1. **Live reassignment** — `FitnessSession.reassignStint.test.js` (new):
   correction into a person who already has rings (only the delta moves; nothing
   drops or jumps; total rings conserved); correction when the source also rode
   another strap earlier (earlier data stays put); handover (nothing moves, stint
   closed); ten ticks after a correction (no source resurrection, no destination
   overwrite); the motivating sequence replayed tick-by-tick (≈381 / ≈91 / 508, no
   cumulative series ever decreases).
2. **Stint records** — extend `GuestAssignmentService.closeOnReassign.test.js`:
   member auto-assign opens a stint; correction relabels in place with ordered
   `relabeledFrom`; dropout does not close; persisted `entities[]` equals §2's table.
3. **Save-time** — extend `sessionBackfill.golden.test.js` and
   `PersistenceManager.symmetricTransitions.test.js`: relabelled 88-ring stint exempt
   from effort absorb; 12-second ghost and stray-strap session absorbed; flags per
   §3.4; `cumulative_regressed` logged and flattened; `20260627195941` golden
   unchanged.
4. **Healer** — extend `SessionIdentityHealer.golden.test.mjs` with the motivating
   session as a second shared golden fixture (scrubbed): split paired and cancelled,
   ghosts removed, output equal to the live-path result from (1) — the
   frontend/backend parity check. Unpaired drop reported, unchanged.
5. **Rendered chart** — `tests/live/flow/fitness/guest-reassign-chart.runtime.test.mjs`
   drives three simulated straps through the motivating sequence via
   `window.__fitnessSession`, screenshots the live chart after each reassignment and
   the history chart after save. Assertions on chart data **and** a visual check: all
   lines non-decreasing, no stray guest avatar, no stranded dropout badge.
6. **Production** — dry-run sweep reviewed before `--apply`; after deploy, the next
   real guest session shows zero `cumulative_regressed` and zero `transfer_disabled`
   in the log store, and its persisted stints match what happened.

---

## Reference docs to update on implementation

- `docs/reference/fitness/assign-guest.md` — correction vs handover, stint relabel.
- `docs/reference/fitness/guest-mode.md` — persisted participant flags.
- `docs/reference/fitness/fitness-system-architecture.md` — stint model, removal of
  entity-keyed live paths.
- July spec — status line pointing here for the Rule A amendment.
