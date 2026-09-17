# Zone Ladder Validation — Design

**Date:** 2026-09-16
**Status:** Implemented on `fitness/zone-ladder-validation`, merged to `main`
**Origin:** A false "ON FIRE" celebration during a live cycle race

---

## The incident

Three fire toasts fired during one race. Two were real. The middle one was not.

A rider was celebrated for reaching the Fire zone while holding a steady
132–134bpm against a warm threshold of 140. He was two zones below Fire. The
logged transition sequence:

```
governance.user_zone_change   hr=134  active -> fire
fitness.fire_toast.shown
treasurebox.record_heart_rate hr=134
governance.user_zone_change   hr=133  fire -> active
treasurebox.record_heart_rate hr=132
```

Active to Fire and back in 2.9 seconds, skipping warm and hot in both
directions, with no heart-rate excursion in any sample. Not a strap spike — a
spike would appear in the HR stream, and it does not. The zone LED array agrees:
no rider was in Fire at that moment, while for both genuine toasts it shows
`fire` as expected.

The same committed zone drives TreasureBox rings and coins, so a phantom Fire
does not only misfire a celebration. It pays out at Fire rates.

## Root cause

Two code paths combine.

**`buildZoneConfig` invents thresholds.** When a zone's threshold cannot be
resolved, it emits `0`:

```js
const fallbackMin = Number.isFinite(defaultZone?.min) ? defaultZone.min : 0;
...
min: Number.isFinite(overrideMin) ? overrideMin
   : (Number.isFinite(zone?.min) ? zone.min : fallbackMin)   // can be 0
```

`0` is finite, so every downstream `Number.isFinite` guard accepts it, and a
rung at threshold 0 is enterable by any rider with a pulse.

**`deriveZoneProgressSnapshot` climbs whatever it is given.** The classifier
walks upward while `hrValue >= threshold`, so a ladder containing 0-thresholds
carries the rider to the top rung: Fire.

`UserManager` reassigns `user.zoneConfig` at runtime on guest and device
re-resolution (`UserManager.js:630`). Device re-resolution for this rider is
logged seconds before the false toast. A rebuild landing on the 0-threshold path
produces exactly the observed shape: correct zone ids, unusable thresholds, one
tick of Fire, self-correcting on the next rebuild.

**Confidence.** The classifier demonstrably reported Fire at 134bpm under a
config whose warm threshold was 140, and the code path above produces precisely
that. The malformed build itself was never captured: the
`zoneprofilestore.build_profile` diagnostic is sampled at 5/min and reported
`skippedCount: 1016` in the relevant window, so every visible row showed the
config healthy. See *Field verification*.

## Decisions

| Question | Decision |
|---|---|
| Scope | Fix the zone ladder itself, at producer and consumer |
| Degenerate ladder mid-session | Keep the rider's last known-good ladder |
| Validity rule | Increasing in canonical zone order, every EARNED rung at or above the cool baseline |
| First ladder already invalid | No committed zone until one validates |

Rejected: guarding only the celebration (rings and coins would keep paying out
on the bad zone); a sort-only monotonicity check (see below); seeding bootstrap
from adult defaults (reaches Fire at a lower threshold than a child's config,
reopening a smaller version of this same bug for children).

## Architecture

Three changes at three layers. The invariant gets one definition and one
enforcement point.

**1. The producer stops inventing thresholds.** `buildZoneConfig` resolves an
unknown threshold against `DEFAULT_ZONE_LOOKUP` by zone id; when that misses it
emits no threshold rather than a fabricated one. New contract: every rung it
returns has a real threshold, or it is not a rung.

**2. One validator.** `validateZoneLadder(zones)` in `types.js` is the sole
definition of a trustworthy ladder:

- thresholds increase following canonical id order (`cool < active < warm < hot < fire`), not merely sortable into increasing order
- every EARNED rung at or above the 60bpm cool baseline
- at least two rungs

The floor applies to the rungs a rider has to earn, not to the bottom rung.
Everyone is at least cool, the classifier already anchors the first rung at
`MIN_COOL_BASELINE`, and the shipped global config genuinely has `cool: 0`. A
low rung anywhere *above* the bottom is the defect itself.

It returns a verdict and a reason.

The canonical-order requirement is what makes this work. A partial failure such
as `[cool:60, warm:0, hot:160]` sorts into a strictly increasing list and would
pass a structural check, while leaving a rung at 0 that any rider can enter.

**3. One enforcement point.** `ZoneProfileStore.#buildProfileFromUser` is the
only place a ladder becomes a rider's committed reality; every consumer (toast,
LEDs, TreasureBox, GovernanceEngine) reads the profile it produces. The
validator is called there and nowhere else, so `deriveZoneProgressSnapshot`
never receives an untrustworthy ladder and needs no defensive logic of its own.

## State and data flow

`_lastGoodLadder`, a per-user map on `ZoneProfileStore`, joins the existing
`_hysteresis` and `_profileCache`. One validated ladder per rider, replaced on
each successful validation, cleared by `clear()` so a rider's ladder from one
session never authorizes the next.

```
user.zoneConfig ──► buildZoneConfig ──► validateZoneLadder
                                             │
                    ┌────────────────────────┴───────────────┐
                  valid                                   invalid
                    │                                        │
         store as _lastGoodLadder              _lastGoodLadder.get(userId)
                    │                              │              │
                    │                          present          absent
                    │                              │              │
                    └──────────► classify ◄────────┘        no committed zone
                                    │                   (blank LED, no rings,
                            committed zone              no celebration)
                     (toast, LEDs, rings, coins)
```

The bootstrap case is the `absent` branch. `currentZoneId` is null, which
existing code tolerates: `#applyHysteresis` seeds a null zone without incident,
and `fireZoneTracker` treats a null zone as not-fire, so a zone-less rider
cannot be celebrated by construction.

**Ordering constraint.** `#userInputSignature` keys on `z?.min ?? ''`, so a
degenerate ladder produces a distinct signature and its own `_profileCache`
entry. Validation must run before the cache is consulted. Otherwise a rejected
ladder is memoized and replayed on every tick with identical inputs, turning a
one-tick glitch into a permanent one.

## Observability

Sampling is correct for a per-tick diagnostic and wrong for a rare fault. A
rejection is rare by definition, so it is logged unsampled at `warn` — but only
on entering the rejected state and on recovering from it, tracked per rider, so
a persistently broken config yields two lines rather than one per tick.

```
fitness.zone_ladder.rejected    warn   userId, reason, thresholds,
                                       fellBackTo: 'last-good' | 'none'
fitness.zone_ladder.recovered   info   userId, rejectedForMs, rejectedTicks
```

`reason` carries the validator verdict (`below-baseline`, `not-increasing`,
`too-few-rungs`), naming which invariant broke and on which rung.

Separately, `fitness.fire_toast.shown` gains the rider's resolved fire threshold
alongside the triggering HR. Not a guard — the field that makes the next
anomaly self-evident, since `hr: 134, fireThreshold: 175` is wrong on sight. The
current event carries only `userId`, and the HR had to be correlated from
`governance.user_zone_change`, which reads `session.roster` rather than the
source the classifier uses.

## Testing

- `validateZoneLadder` — the shapes above, including an explicit test that
  `[cool:60, warm:0, hot:160]` is rejected despite sorting into an increasing
  list. That case is the whole reason for the canonical-order rule.
- `buildZoneConfig` — no returned rung has a fabricated threshold; an unknown
  zone id resolves from `DEFAULT_ZONE_LOOKUP` or is dropped.
- `ZoneProfileStore` — the incident replayed as three ticks (valid, degenerate,
  valid) at a steady 134bpm, asserting the committed zone stays `active` and
  never reads `fire`.
- Bootstrap — first ladder invalid yields a null committed zone and no toast.
- Cache ordering — the same degenerate input twice rejects both times, proving
  no rejected ladder reached `_profileCache`.

Use generic rider ids in fixtures, never household member names.

## Rollout

1. Revert the interim consumer-side guard currently in the working tree
   (`types.js` ladder filter plus `types.zoneClassifierFailSafe.test.js`). It
   defends the consumer against a shape this design prevents at the producer,
   and two half-guards are worse than one whole one. Its incident scenario moves to
   the `ZoneProfileStore` test above.
2. Implement the three changes.
3. Full fitness suite against its current baseline (111 files, 769 tests).
4. Deploy. Local `main` is frequently behind the deployed tree; sync against the
   deploy source before building.

Two existing fixtures asserted behavior the new contract forbids and were
corrected rather than accommodated:

- the legacy hysteresis test exercised the exit-margin clamp with an *earned*
  rung at 2bpm. That ladder can no longer commit, and the clamp is now
  unreachable for any committed ladder, since every earned rung is at least 60
  and `min - EXIT_MARGIN_BPM` can never go negative. The test now asserts the
  rejection.
- the zone-profile memoization fixture had `warm: 100` sitting below
  `active: 120`, an inverted ladder. Ordering was incidental to what that file
  tests, so the fixture was put in canonical order.

**Every real config was checked against the shipped rule before merge** — the
global ladder and all five per-user overrides build and validate, so no rider
is left zone-less by this change.

## Field verification

This design rests on a hypothesis. What is proven: the classifier reported Fire
at 134bpm against a warm threshold of 140, and a code path exists that produces
exactly that. What is not proven: that this path is what actually ran, because
sampling dropped the malformed build.

`fitness.zone_ladder.rejected` closes that loop. After deploy, a few sessions of
logs either show it firing with a `below-baseline` reason on a rebuild, which
confirms the mechanism, or stay silent — meaning the real trigger is still out
there and this work has only made it harmless. Either outcome is worth knowing,
and the second is the one to keep watching for.
