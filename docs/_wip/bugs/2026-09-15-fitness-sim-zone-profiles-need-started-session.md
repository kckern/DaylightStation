# Simulated HR never populates ZoneProfileStore without a started session

**Date:** 2026-09-15
**Status:** Diagnosed, not fixed. Pre-existing — predates the fire-toast work that surfaced it.
**Severity:** Test/simulator harness only. Production is unaffected.

## Symptom

Load `/fitness`, drive the simulator (`window.__fitnessSimController.setHR(...)`),
and `zoneProfileStore.getProfiles()` stays at **0** forever — no matter how long
HR flows, how high it goes, or whether `activateAll()` / `startAutoSessionAll()`
were called first. Anything reading the *stabilized* zone therefore sees nothing.

This makes `tests/live/flow/fitness/zone-propagation-fixed.runtime.test.mjs`
fail (both cases), and it is why a live test for the Fire-zone toast could not
be made to pass in this environment.

## Root cause

`ParticipantRoster` is constructed bare at `FitnessSession.js:214`
(`new ParticipantRoster()`), and its constructor leaves the external references
null — `_deviceManager`, `_userManager`, and the rest are "set via configure".

Those `configure({...})` calls live inside **`ensureStarted()`**
(`FitnessSession.js:1904`, wiring at 1999 and 2050). Until a session is actually
started, the roster is unwired, and:

```js
getPresentParticipantIds() {
  const ids = new Set();
  if (!this._deviceManager || !this._userManager) return ids;   // ← always here
  ...
}
```

returns an **empty Set** — not null. That matters, because the HR ingest path
filters on it:

```js
const presentIds = this._participantRoster?.getPresentParticipantIds();
const usersForZones = presentIds ? allUsers.filter(u => presentIds.has(u.id)) : allUsers;
this._syncZoneProfiles(usersForZones);
```

An empty Set is truthy, so `usersForZones` collapses to `[]`, and
`syncFromUsers([])` **replaces** `_profiles` with an empty map on every HR
packet. A profile map populated by any other means is wiped by the next packet.

## Evidence

Measured in-page (headless Chromium against the dev server, 2026-09-15):

| Reading | Value |
|---|---|
| `_participantRoster._deviceManager` / `_userManager` | `false` / `false` |
| `getPresentParticipantIds()` | `[]` |
| `getRoster().length` | `0` |
| `zoneProfileStore.getProfiles().length` | `0`, continuously |
| HR device `DEVICE-A` | exists, `type: "heart_rate"`, `hr: 150` |
| `userManager.resolveUserForDevice('DEVICE-A')` | `test-adult` |
| `userManager` users | 17, `test-adult.currentData` = `{hr: 150, zone: "hot"}` |
| `syncFromUsers(getAllUsers())` called manually | `changed: true`, **17 profiles**, `test-adult: hot` |

So every link except presence works; bypassing the presence filter builds
profiles correctly.

**Production is healthy** — `zoneprofilestore.exit_margin_suppressed` has fired
**3,015 times in 30 days** (e.g. 2026-09-16T03:06Z, `learner-two`, committed `warm`,
HR 139). That event only logs when `#applyHysteresis` runs against a populated
store, so real sessions wire the roster and stabilize zones normally.

## Fix direction

Either is defensible; neither was attempted here:

1. **Make live sim tests start a session** before driving HR, so `ensureStarted()`
   wires the roster — the smallest change, and it matches what a real workout does.
2. **Wire the roster at construction** (pass `deviceManager`/`userManager` into
   `new ParticipantRoster()` at `FitnessSession.js:214`), so presence is never
   silently empty. Closer to a real fix, but it changes startup ordering and
   wants its own regression pass.

A defensive third option: have `getPresentParticipantIds()` signal "unknown"
(return `null`) rather than an empty Set when unwired, so the ingest path falls
back to `allUsers` instead of wiping the store. Today an unwired roster is
indistinguishable from "nobody is here".

## Not related to

The Fire-zone toast (`fireZoneTracker` / `buildFireToast` / `fireToastQueue`).
That feature reads `currentZoneId` — the same stabilized value `GovernanceEngine`
uses and which production exercises thousands of times a month.
