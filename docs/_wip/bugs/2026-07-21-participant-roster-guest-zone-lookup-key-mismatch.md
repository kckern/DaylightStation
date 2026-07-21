# ParticipantRoster misses guest zones — trackingId vs profileId key mismatch

**Date:** 2026-07-21
**Status:** OPEN — found during the participant-sort SSOT work, deliberately NOT fixed
**Severity:** Medium (currently masked at every known read site)
**Component:** `frontend/src/hooks/fitness/ParticipantRoster.js`, `frontend/src/hooks/fitness/TreasureBox.js`

## Summary

`ParticipantRoster._buildZoneLookup` and `_buildRosterEntry` disagree with `TreasureBox`
about what key identifies a participant. Participants carrying an `entityId` — in
practice, **guests** — look an `entityId` up against a `profileId`-keyed map and miss.

**Consequence: guests get both `zoneId` and `rawZoneId` null in the roster today.**

This was discovered while fixing the sidebar sort order (see the "Participant Sort Order"
section in `docs/reference/fitness/fitness-system-architecture.md`). It is a *separate,
pre-existing* defect and was left alone deliberately — fixing it changes guest zone
rendering and coin attribution, which needs its own change and its own on-kiosk verification.

## Mechanism

**Read side** — `_buildRosterEntry` keys by `entityId` first:

```js
// ParticipantRoster.js:595
const trackingId = entityId || userId;
// ParticipantRoster.js:602
const zoneInfo = zoneLookup.get(trackingId) || null;
```

**Write side** — `TreasureBox.perUser` is keyed strictly by `profileId`:

- `recordUserHeartRate` sets `const accKey = profileId;` (`TreasureBox.js:531`)
- the snapshot hardcodes `entityId: null` (`TreasureBox.js:722`)
- the Phase-4 migration shim (`TreasureBox.js:331-341`) actively *deletes* legacy
  `entity-`-prefixed keys after remapping them onto `profileId`

So no `entityId` key can survive in `perUser`. A participant with an `entityId` misses.

Note the seeding order compounds it: `_buildZoneLookup` seeds with
`entry.trackingId || entry.userId || entry.entityId` (`ParticipantRoster.js:508`) —
`userId` **before** `entityId` — while `_buildRosterEntry` reads `entityId` **before**
`userId`. The two ends prefer opposite keys for the same participant.

**No rescue path.** The ZoneProfileStore override loop only iterates keys TreasureBox
already seeded:

```js
// ParticipantRoster.js:521
for (const [trackingId] of zoneLookup) {
  const committed = this._zoneProfileStore.getZoneState(trackingId);
  ...
}
```

Because it iterates `zoneLookup` rather than the participant list, a participant absent
from `zoneLookup` can never be added by the committed zone either.

## Why it is currently masked

Nothing user-visible is obviously broken, which is why this has survived:

- `FitnessUsers`' display chain falls through to other zone/color sources.
- `ParticipantFactory`'s `rawZoneId` resolution has a **vitals-zone rung** (rung 2) that
  covers exactly this case — `userVitalsMap` resolves guests by `profileId`, so the live
  zone is recovered there even when the roster's rung 1 is null.

**But anything reading `rosterEntry.zoneId` directly for a guest reads null.** Any new
consumer that trusts the roster field without the factory's fallback chain will be wrong
for guests, silently.

## Suggested fix (not applied)

Make the two ends agree on one key scheme. `profileId` is the better canon — TreasureBox
already migrated to it, and the migration shim shows the intended direction of travel.
That means changing `_buildRosterEntry`'s `entityId || userId` to prefer the profile ID,
and aligning `_buildZoneLookup`'s seeding order to match.

Verify with a session that has at least one guest and one registered rider, and confirm
`rosterEntry.zoneId` is non-null for the guest.

## Line references

All verified against the tree as of 2026-07-21. If they have drifted, re-locate by symbol
name (`_buildZoneLookup`, `_buildRosterEntry`, `recordUserHeartRate`) rather than by line.
