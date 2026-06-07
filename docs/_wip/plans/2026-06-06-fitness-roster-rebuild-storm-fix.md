# Fitness Roster Rebuild-Storm Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop `ParticipantRoster.getRoster()` from doing full roster rebuilds ~55×/sec (137k+ per session), which saturates the garage Firefox kiosk's main thread and makes the cycle overlay stutter (the probable cause of the janky felix lock/unlock in session `20260606141443`).

**Architecture:** The two per-HR-packet hot-path callers (`FitnessSession.js:603` and `:1929`) call the *full* `getRoster()` only to extract the set of present participant IDs for zone-profile sync — they never use the live HR/zone/labels in the entries. We add a cheap `ParticipantRoster.getPresentParticipantIds()` that does device→user grouping ONLY (no zone lookup, no label resolution, no per-entry logging) and use it at those two sites. We deliberately do **NOT** memoize `getRoster()`'s result: roster entries carry live per-tick HR (`resolvedHeartRate`) and zone (`zoneInfo`), so caching would freeze the values the cards/charts display. After call-reduction, `getRoster()` runs only on the throttled render path (~4/sec) and the governance pulse (~0.2/sec), which is fine. A final task samples the remaining high-frequency debug logs that flood the session `.jsonl`.

**Tech Stack:** Vanilla JS classes (`ParticipantRoster`, `FitnessSession`), React (`FitnessUsers.jsx`), Vitest, structured logging framework (`frontend/src/lib/logging/`).

**Evidence base:** Session `20260606141443` log had **137,183** `participant.roster.build` events (~55/sec, uniform across the whole session). Both per-packet callers use the identical pattern `new Set(getRoster().map(e => e.id))` then `allUsers.filter(u => ids.has(u.id))`. Roster entry shape confirmed to include live HR/zone at `ParticipantRoster.js:475,487`.

---

## Why NOT memoization (read first)

An earlier idea was to memoize `getRoster()` on a structural signature. **Rejected:** `_buildRosterEntry` puts live `resolvedHeartRate` (line 487) and `zoneInfo` (line 475) into each entry, which change every packet by design. A structural cache would serve stale HR to the live cards/charts. The correct lever is reducing *unnecessary full-build calls*, not caching results. Do not add result-memoization to `getRoster()`.

---

## Task 1: Add a cheap `getPresentParticipantIds()` to ParticipantRoster

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js` (add a method near `getRoster()`, ~line 205)
- Test: `frontend/src/hooks/fitness/ParticipantRoster.presentIds.test.js` (new)

**Context for the implementer:** Read `getRoster()` (`ParticipantRoster.js:123-205`) and `_buildRosterEntry` (`:423+`) first. The expensive parts of a full build are `_buildZoneLookup()` (TreasureBox snapshot + per-user ZoneProfileStore queries), `resolveDisplayLabel`, ActivityMonitor status, and several `logger().debug(...)` calls per entry. The present-ID set only needs device→user grouping. For the consumers (zone sync), the IDs that matter are mapped-user IDs and ledger occupant IDs; truly-anonymous devices produce `device:<id>` entry IDs that never match a real user, so they're irrelevant to the `allUsers.filter(...)` downstream and can be omitted. Mapped users are NOT subject to the low-HR drop (that only applies to unregistered devices), so no HR filtering is needed here.

**Step 1: Write the failing test**

Mirror the stub-construction style of the existing `frontend/src/hooks/fitness/ParticipantRoster.hrFloor.test.js` and `ParticipantRoster.anonymousDevice.test.js` (read them for the exact `deviceManager`/`userManager` stub shapes). Create `ParticipantRoster.presentIds.test.js` with tests that:

1. Returns a `Set` of mapped-user IDs for present HR devices, plus ledger occupant IDs, and omits truly-anonymous `device:*` devices.
2. **Equivalence guard:** for a roster with mapped users + a ledger guest + an anonymous device, assert that
   `allUsers.filter(u => roster.getPresentParticipantIds().has(u.id))`
   equals
   `allUsers.filter(u => new Set(roster.getRoster().map(e => e.id)).has(u.id))`
   (i.e., the new path yields the same `usersForZones` the old code produced).
3. **Cheapness guard:** spy on `roster._buildZoneLookup` (e.g. `vi.spyOn`) and assert `getPresentParticipantIds()` does NOT call it, while `getRoster()` does.

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/ParticipantRoster.presentIds.test.js`
Expected: FAIL — `getPresentParticipantIds is not a function`.

**Step 3: Implement** (add to `ParticipantRoster.js`, right after `getRoster()`):

```js
  /**
   * Cheap presence query: the set of participant IDs that getRoster() would
   * emit for currently-present heart-rate devices, WITHOUT building full entries
   * (no zone lookup, no label resolution, no per-entry logging). Used by the
   * per-packet zone-sync path so it doesn't trigger a full roster rebuild on
   * every HR packet. Truly-anonymous devices (no user, no ledger) are omitted —
   * their getRoster() entry id is `device:<id>`, which never matches a real user.
   *
   * @returns {Set<string>} participant IDs (mapped user IDs + ledger occupant IDs)
   */
  getPresentParticipantIds() {
    const ids = new Set();
    if (!this._deviceManager || !this._userManager) return ids;
    const hrDevices = this._deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');
    for (const device of hrDevices) {
      const deviceId = String(device.id || device.deviceId);
      const mappedUser = this._userManager.resolveUserForDevice(deviceId);
      if (mappedUser?.id) { ids.add(mappedUser.id); continue; }
      const ledgerEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
      const ledgerId = ledgerEntry?.occupantId || ledgerEntry?.metadata?.profileId || null;
      if (ledgerId) ids.add(ledgerId);
      // else: truly anonymous → omitted (never matches a real user id)
    }
    return ids;
  }
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/hooks/fitness/ParticipantRoster.presentIds.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js \
        frontend/src/hooks/fitness/ParticipantRoster.presentIds.test.js
git commit -m "perf(fitness): add cheap ParticipantRoster.getPresentParticipantIds()"
```
End commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 2: Use the cheap query at the two per-packet zone-sync sites

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (the two blocks at ~`:601-611` inside `recordDeviceActivity`, and ~`:1926-1933`)
- Test: `frontend/src/hooks/fitness/FitnessSession.rosterStorm.test.js` (new)

**Step 1: Write the failing test**

Create `FitnessSession.rosterStorm.test.js`. Build a `FitnessSession` the way the existing `FitnessSession.*.test.js` files do (read `FitnessSession.cadenceTs.test.js` / `FitnessSession.equipmentRider.test.js` for setup). Then:

- Spy on `session._participantRoster.getRoster` and `session._participantRoster.getPresentParticipantIds`.
- Ingest several HR packets (drive `ingestData(...)` with HR payloads for a mapped device — mirror how the other FitnessSession tests feed data).
- Assert: after ingesting N HR packets, `getRoster` was **NOT** called by the ingest path (call count 0 from ingest), while `getPresentParticipantIds` WAS called. (If the harness makes a literal 0 impractical, assert `getPresentParticipantIds.callCount >= packets` and `getRoster.callCount` is 0 across the ingest window.)
- Assert zone-sync still happened (e.g. `_syncZoneProfiles` called, or the resulting zone-profile state matches the pre-change behavior for a present mapped user).

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/hooks/fitness/FitnessSession.rosterStorm.test.js`
Expected: FAIL — `getRoster` is still called on the ingest path.

**Step 3: Implement** — replace BOTH blocks.

At `recordDeviceActivity` (~:601-611), change:
```js
          const allUsers = this.userManager.getAllUsers();
          const currentRoster = this._participantRoster?.getRoster();
          const usersForZones = currentRoster
            ? (() => { const ids = new Set(currentRoster.map(e => e.id)); return allUsers.filter(u => ids.has(u.id)); })()
            : allUsers;
          const changed = this._syncZoneProfiles(usersForZones);
```
to:
```js
          const allUsers = this.userManager.getAllUsers();
          // Cheap presence query — avoids a full getRoster() rebuild per HR packet.
          const presentIds = this._participantRoster?.getPresentParticipantIds();
          const usersForZones = presentIds
            ? allUsers.filter(u => presentIds.has(u.id))
            : allUsers;
          const changed = this._syncZoneProfiles(usersForZones);
```

At the second site (~:1929-1933), apply the identical replacement:
```js
    const presentIds = this._participantRoster?.getPresentParticipantIds();
    const usersForZones = presentIds
      ? allUsers.filter(u => presentIds.has(u.id))
      : allUsers;
    this._syncZoneProfiles(usersForZones);
```
(Confirm `allUsers` is already in scope at the second site — it is, per `:1929` context. If the variable name differs, adapt.)

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/hooks/fitness/FitnessSession.rosterStorm.test.js`
Then the whole fitness hooks suite to confirm no regression:
Run: `npx vitest run frontend/src/hooks/fitness/`
Expected: all pass.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js \
        frontend/src/hooks/fitness/FitnessSession.rosterStorm.test.js
git commit -m "perf(fitness): use getPresentParticipantIds for per-packet zone sync"
```
End commit body with the Co-Authored-By trailer.

---

## Task 3: Sample the high-frequency roster debug logs

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js` (the `participant.roster.build` log ~:168 and `participant.roster.display_label_resolved` ~:510)
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` (the `fitness_users.device_name_resolved` log)

**Context:** Fitness sessions run at `level: 'debug'`, and these `debug` events are persisted to the session `.jsonl` and shipped over WebSocket — they accounted for the bulk of a 223 MB session log and add serialization/transport cost on the kiosk. After Tasks 1–2 they drop to render-path frequency (~4/sec) but are still noisy. Convert them from `logger().debug(event, data)` to the rate-limited `logger().sampled(event, data, { maxPerMinute: 6, aggregate: true })` so a trace survives without the flood. (See CLAUDE.md "Logging" → `logger.sampled`.) Do NOT delete them — sample them.

**Step 1:** No new unit test (logging-frequency is not meaningfully unit-testable here); rely on the existing suites staying green + the on-device log check in Task 4. If a `logger` is mocked in nearby tests, ensure `sampled` exists on the mock (the fitness test logger mocks already include `sampled: noop`).

**Step 2: Implement** — for each of the three call sites, replace `logger().debug('<event>', {...})` (or `getLogger().debug(...)`) with `…sampled('<event>', {...}, { maxPerMinute: 6, aggregate: true })`, preserving the same event name and payload. Keep the existing lazy `getLogger()`/child-logger pattern in each file.

**Step 3: Run the suites**

Run: `npx vitest run frontend/src/hooks/fitness/ frontend/src/modules/Fitness/`
Expected: all pass (no test asserts on these debug events; if one does, update it to expect `sampled`).

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js \
        frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "chore(fitness): rate-limit high-frequency roster debug logs"
```
End commit body with the Co-Authored-By trailer.

---

## Task 4: Verify (no excuses)

**Not a code task — required before claiming done (superpowers:verification-before-completion).**

1. Full affected suites green:
   `npx vitest run frontend/src/hooks/fitness/ frontend/src/modules/Fitness/`
2. **On-device / log check** (you deploy; per CLAUDE.md I don't): run one garage Firefox kiosk session, then count roster builds in its `.jsonl`:
   ```bash
   python3 - "<session>.jsonl" <<'PY'
   import json,sys,collections
   c=collections.Counter()
   for line in open(sys.argv[1]):
       try: e=json.loads(line)
       except: continue
       c[e.get('event','')]+=1
   for k in ['participant.roster.build','participant.roster.display_label_resolved','fitness_users.device_name_resolved']:
       print(k, c.get(k,0))
   PY
   ```
   **Success:** `participant.roster.build` drops from ~137k to a few hundred (render+governance only); the other two drop sharply (sampled). Spot-check that the cycle overlay no longer has multi-second tick gaps during a health-lock.
3. Confirm live HR still updates on the participant cards (sanity: we did NOT cache roster results, so HR must still refresh ~4/sec).

---

## Notes for the executor

- **Worktree:** create a dedicated worktree/branch (e.g. `fix/fitness-roster-rebuild-storm`) off `main` — see superpowers:using-git-worktrees. `main` is currently at the audio-fix HEAD (`a6328d7f`).
- **No result-memoization of `getRoster()`** — see the dedicated section above; roster carries live HR/zone.
- **Equivalence is the risk:** the only behavioral risk is `usersForZones` differing from before. Task 1's equivalence test is the guard — do not weaken it.
- **Structured logger only**, no raw `console.*` (CLAUDE.md).
- **No PII in tests** — use `test-user`-style IDs, never the real head-of-household identifier.
- **Do not deploy/push without the user** (CLAUDE.md).
- This fix is the probable resolution of the felix lock/unlock jank but that causation is correlational — Task 4 step 2 (no more overlay tick gaps) is the confirmation.
