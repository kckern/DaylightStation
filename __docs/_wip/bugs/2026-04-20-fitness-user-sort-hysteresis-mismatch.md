# Fitness User Card Sort / Progress-Bar Hysteresis Mismatch

**Date:** 2026-04-20
**Reported by:** user (FRD Q2 item 5.3)
**Status:** RESOLVED via option 1 — card display switched to live (raw) zone.

## Symptom

User progress bars in the Fitness sidebar don't always match the user's
actual heart rate. The user originally framed this as a sort issue
(Primary = zone, Secondary = HR-within-zone %) but on closer look
suspected it might not be HR — "maybe hysteresis".

## Finding

The sort logic at `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx`
already reads LIVE (non-hysteresis-smoothed) values for both primary and
secondary keys, so the sort ordering matches live HR. The FRD's sort
requirement is effectively already satisfied.

**The real mismatch is between card COLOR and progress BAR:**

- `ZoneProfileStore.#applyHysteresis` (`frontend/src/hooks/fitness/ZoneProfileStore.js:237`)
  computes a smoothed `committedZoneId` + `rawZoneId` per user. The
  committed zone only advances when the raw zone has been stable for
  a dwell window, preventing zone thrash around boundaries.
- `calculateZoneProgress` in `frontend/src/hooks/fitness/types.js:290-331`
  picks `currentZoneIndex` from the LIVE HR and computes `progress =
  (liveHR - liveZone.min) / (liveZone.max - liveZone.min)`.
- UserManager (`frontend/src/hooks/fitness/UserManager.js:76,98`) then
  stores `progressToNextZone = zoneSnapshot.progress` — live-based.
- The user card's color class, however, is driven by the COMMITTED
  zoneId. So briefly (at zone transitions) the card is colored for the
  committed zone but the bar fill is computed against the live zone's
  range. Visually, a "warm" card can show a bar that's 10% full from
  the "hot" perspective, and the sort puts the user among the hot group
  while the color says warm.

## Fix applied

Option 1 — card display now uses the LIVE (raw) zone everywhere. File
changes:

- `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx`:
  - Rewrote `getRawZoneId` with an explicit live-only fallback chain:
    `participantEntry.rawZoneId` → `zoneProfile.zoneSnapshot.currentZoneId`
    (live, from `calculateZoneProgress`) → `deriveZoneFromProfile(profile, HR)`.
    Explicitly does NOT fall back to committed-zone sources.
  - `zoneClass` (the card color / progress-bar color class) now calls
    `getRawZoneId(device)` directly, matching the sort's primary key.
  - `zoneBadgeColor` prefers `participantEntry.rawZoneColor` (live) over
    the committed `zoneColor`.
  - Deleted the now-unused `getDeviceZoneId` helper (which read committed).

Hysteresis remains in effect in `ZoneProfileStore` for governance
stability — those decisions are unchanged. Only the UI surface was
switched to live state.

## Why this works

The user's three visual signals now all read the same source:

| Signal | Source (after fix) |
|--------|-------------------|
| Card color | `getRawZoneId(device)` → CSS `.zone-{id}` |
| Progress-bar fill | `zoneSnapshot.progress` (live, from `types.js:calculateZoneProgress`) |
| Progress-bar color | inherited from card's `zoneClass` (raw) |
| Sort primary | `getRawZoneId(device)` |
| Sort secondary | `zoneSnapshot.progress` (live) |

## Verification

Existing fitness unit tests still pass (46). Manual verification on a
live session: start in one zone, HR crosses a boundary — card color,
bar fill, bar color, and sort position all update together on the next
sample.
