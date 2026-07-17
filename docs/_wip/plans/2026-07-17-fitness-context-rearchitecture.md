# Fitness Context Re-architecture — Ending the Render-Storm Incident Class

**Date:** 2026-07-17
**Status:** Proposed — staged execution (TDD). **Stages 1, 2a, 3-core committed (tests green, NOT yet deployed — deploy held while a Player video was in use). Stage 2b deferred into Stage 4; Stage 3 hygiene + Stages 4–7 pending.**

## Progress log
- **2026-07-17 — Stage 1 (roster cache) implemented, not yet deployed.** Version stamps added to `DeviceManager.mutationVersion` (registerDevice/removeDevice/pruneStaleDevices) and `UserManager.mutationVersion` (ledger change / registerUser via _rebuildOwnershipIndex / setRoster). `ParticipantRoster.getRoster()` now caches on `${deviceVersion}:${userVersion}` + a 1000ms TTL backstop (`ROSTER_CACHE_TTL_MS`); `_buildRoster()` extracted; cached array frozen in dev/test; `getFullRoster()` copies before pushing ghosts. Deviation from design: ZoneProfileStore is NOT version-stamped — its commits are packet-driven (already covered by the DeviceManager per-packet bump) and idle changes are TTL-bounded ≤1s. Tests: `FitnessSession.rosterCache.test.js` (3), `ParticipantRoster.cacheSafety.test.js` (5, incl. empty-roster-after-removal → `endSession('empty_roster')`, getFullRoster non-poisoning, historical-participant preservation, TTL expiry). Full suite: hooks/fitness 300/300, modules/Fitness 1086/1086. Live verification (post-deploy) still owed: `participant.roster.build` aggregate rate on a single-rider workout. Commit `ecfb70897`.
- **2026-07-17 — Stage 2a (vibration throttle) committed, not deployed.** `FitnessContext.jsx`: vibration state moved from a per-packet `useState` to `vibrationStateRef` published via `batchedForceUpdate` (was the primary unthrottled per-packet render driver); `getEquipmentVibration`/`value.vibrationState` read the ref keyed on `version`. Deviation: did NOT route the discrete `forceUpdate` mutation-callback sites through the throttle — `batchedForceUpdate` can drop updates (circuit breaker), which would silently swallow a one-off guest-assign/governance render. Stage 2b (memoize the `value` object) DEFERRED into Stage 4 — near-zero standalone benefit (`version` stays in deps) and unsafe to ship blind (no test mounts the real provider). Test: `FitnessContext.vibrationThrottle.test.jsx` (proven teeth: unthrottled=40 renders, throttled≤8). Commit `5b4ee3b8a`.
- **2026-07-17 — Stage 3 CORE (provisional persistence) committed, not deployed.** Client `PersistenceManager.js`: floor 300000→60000ms; payload gets `provisional = !finalized && durationMs < 300000`. Backend `Session.mjs` entity persists `provisional` (mirrors `finalized`, round-trips). Resume works with no `findResumable` change (provisional = non-finalized = already resumable). Tests: `PersistenceManager.provisional.test.js` (5); backend Session `node --test` 12 pass. Commit `b5e8d9670`. **Stage 3 REMAINING (not done):** (1) filter `provisional` out of the user-facing history list (`QuerySessions.execute` + add `provisional` to the `YamlSessionDatastore` day-summary projection, bump `INDEX_VERSION`) so short crash-orphans don't clutter history; (2) GC stale (≥48h, never-matured) provisionals via `sessionConsolidationPolicy`; (3) confirm recap/receipt/stats consumers skip `provisional`. Until (1) lands, a crash-orphaned 1–5min session would appear in history (rare; usually reclaimed by resume maturing past 5min).

### Deploy state
Image `kckern/daylight-station:latest` built at commit `5b4ee3b8a` (**Stages 1 + 2a only** — Stage 3 committed after the build, so it is NOT in the staged image). Deploy HELD at user request while a Player video ("Mum - Your Turn", SM-T590) was playing. Next deploy ships 1+2a; Stage 3 needs a rebuild once its hygiene items land. Post-deploy: reload garage Firefox (Fitness module changed) + capture 30s `__fitnessRenderStats` / `participant.roster.build` baseline.
**Trigger:** 3rd–4th render-storm incident (2026-07-17 garage kiosk crash mid-workout + frozen exit)
**Scope:** `frontend/src/context/FitnessContext.jsx`, `frontend/src/hooks/fitness/*`, `frontend/src/modules/Fitness/*`, plus a narrow backend change for durability (`backend/src/3_applications/fitness/services/SessionService.mjs`, `PersistenceManager.js`)

---

## 0. Problem model (why mitigations keep failing)

Every prior fix (250ms `batchedForceUpdate` throttle FitnessContext.jsx:321-386, circuit breaker :304-311, roster JSON-signature dedup :1637-1665, `getPresentParticipantIds` cheap path ParticipantRoster.js:228) treats **symptoms of one architecture flaw**: a single monolithic context whose value object (FitnessContext.jsx:2415-2627) is rebuilt un-memoized every provider render and fans out to ~38 consumer sites. Any state change anywhere = every consumer re-renders = per-render costs (uncached roster rebuild, JSON.stringify signatures) multiply.

Two orthogonal multiplied factors:

- **Render COUNT** — unthrottled `useState` setters bypass the throttle: `setVibrationState` per vibration packet (:1227, :1261), `setFitnessToast` (:1278, :1282), `setConnected` (:1368), raw `forceUpdate` in voiceMemoManager mutation callback (:782), `assignGuestToDevice` (:811), `setGovernanceMedia`/`setGovernanceSuspended` (:1182, :1193), plus the `updateSnapshot` effect re-running per render (:2323-2342).
- **Render COST** — `FitnessSession.get roster()` (FitnessSession.js:1405) → `ParticipantRoster.getRoster()` (ParticipantRoster.js:134-216) is uncached (`_cachedRoster`/`_cacheVersion`/`_invalidateCache()` at :63-65/:123-126 are write-only dead code). Read sites: FitnessContext memos (:1638, :1675), FitnessPlayer.jsx:368 (render body), sessionDataAdapter, governance pulse (`GovernanceEngine._triggerPulse` :1422 → `session.getActiveParticipantState()` FitnessSession.js:1384 → full `getRoster()`), tick timer (FitnessSession.js:2201 + :2205), `_checkEmptyRosterTimeout` (:2471). ≈34 rebuilds/sec for one rider.

The fix is to end **both** factors structurally: cache the roster behind explicit invalidation (COST), and replace the monolithic context with a selector-subscription store so a state change re-renders only components that selected it (COUNT). Plus: make session-domain work (HR series, governance) run on session timers, not React render cadence; make persistence survive crashes < 5 min; and give the post-video idle session an owner.

---

## 1. Target architecture

### 1.1 Boundaries

FitnessSession (via `fitnessSessionRef`, FitnessContext.jsx:267) **remains the domain SSoT** — this design does not move domain state, it changes how React observes it.

```
FitnessProvider
├── FitnessConfigContext        (static; changes only when fitnessConfiguration prop changes)
├── FitnessCommandsContext      (stable imperative API; value memoized once, never re-renders consumers)
├── FitnessSessionUiContext     (low-frequency UI state: overlays, apps, queue, music, sidebar)
└── fitnessTelemetryStore       (high-frequency; useSyncExternalStore + selectors; NOT a context value)
        ▲ markDirty(slice) from: WS ingest, TreasureBox mutation cb, governance cbs,
          ledger onChange, vibration events, tick timer, ws status
```

`useFitnessContext()` is kept during migration as a compatibility facade (merges the three context values + store snapshot) so all 38 consumer sites keep working; consumers migrate incrementally to the narrow hooks, then the facade is deleted (Stage 7).

### 1.2 State inventory — what moves where

**FitnessConfigContext** (all already `useMemo`-derived from the `fitnessConfiguration` prop; effectively immutable per load):
- The config extraction block :461-533 (`fitnessRoot, contentSource, contentConfig/plexConfig, musicPlaylists, ant_devices, usersConfig, coinTimeUnitMs, zoneConfig, governanceConfig, equipmentConfig, nomusicLabels, governedLabels, governedTypes, sessionsConfig, cycleGameConfig, dancePartyConfig, voiceMemoEligibleUsers`)
- `primaryConfigByName` :616, `groupLabelLookup` :631, `configurationInputs` :655
- `zoneMetadata/zoneRankMap/zoneInfoMap` :1612-1617, `colorToZoneId` :1619, `governedLabelSet/governedTypeSet` :1632-1633
- `ambientLedEnabled` :1713, `equipmentFanEnabled` :1736

**FitnessCommandsContext** (all `useCallback` with stable deps; one `useMemo` value):
- App bus: `launchApp/closeApp/launchOverlayApp/dismissOverlayApp` :183-212, `emitAppEvent/subscribeToAppEvent` :215-232, `reportGovernanceMetric` :248
- `registerVideoPlayer` :234, `trackRecentlyPlayed` :238
- `requestEndSession` :558, `assignGuestToDevice` :803, `clearGuestAssignment` :814, `suppressDeviceUntilNextReading` :823
- Voice memos: `addVoiceMemoToSession/removeVoiceMemoFromSession/replaceVoiceMemoInSession` :891-951, `closeVoiceMemoOverlay/openVoiceMemoReview/openVoiceMemoList/openVoiceMemoCapture` :953-1090
- Music: `pauseMusicPlayer/resumeMusicPlayer` :1138-1144, `setMusicAutoEnabled/setMusicOverride` :1124-1135
- `setGovernanceMedia/setGovernanceSuspended` :1172-1194, `triggerChallengeNow` :2411
- `pushFitnessToast/dismissFitnessToast` :1276-1283, `reconnectFitnessWebSocket` :1404, `pairController/forgetController` :1413-1430
- Session-instance passthroughs (bind once): `registerSessionScreenshot`, `configureSessionScreenshotPlan`, `getUserByName`, `resetAllUserSessions` (today inline closures at :2560-2561, :2612-2625, :2476 — new object every render; must become `useCallback`)

**FitnessSessionUiContext** (human-cadence `useState`, stays React state):
- `activeApp/overlayApp/appHistory` :177-179, `voiceMemoOverlayState` :144, `voiceMemos`/`voiceMemoVersion` :154/:857, `feedbackRecordingActive` :150
- `fitnessPlayQueue/setFitnessPlayQueue` :1150-1151, `currentMedia/recentlyPlayed` :173-174
- `sidebarSizeMode/sidebarCollapsed` :142-143, `videoPlayerPaused` :141, `selectedPlaylistId`/music enablement :137-140, `preferredMicrophoneId` :157
- `btInventory/controllerPairing` :160-161 (event-driven but rare)

**fitnessTelemetryStore** (high-frequency; moves OUT of React state entirely):

| Slice | Replaces (current state/line) | Written by |
|---|---|---|
| `vitals` | `participantRoster` memo :1637, `activeHeartRateParticipants` :1697, `userVitalsMap` :1839, `userHeartRateMap` :1982, `participantDisplayMap` :1672, `zoneProfiles` :1937, per-user zone progress :2092 | WS ingest → `session.ingestData` (:1347) |
| `vibration` | `vibrationState` useState :158 (set :1227/:1261) | `handleVibrationEvent` :1201 |
| `connection` | `connected` useState :155 (set :1368) | `wsService.onStatusChange` :1353 |
| `governance` | `governanceState/governanceChallenge` :2347-2348 (currently raw engine reads per render) | engine callbacks :702-706 |
| `treasure` | `treasureBox` summary :2400, live snapshot accessors :2404-2409 | TreasureBox mutation callback :761 |
| `timeline` | `timelineSelectors` :2147-2286 (`version`-keyed rebuild) | tick timer commit |
| `session` | `sessionId/isSessionActive/summary` (:2554-2557), `deviceAssignments` :1763, `userCollections` :1879, `deviceOwnership` :1888, `guestCandidates` :1933 | session lifecycle + ledger onChange :582 |
| `toast` | `fitnessToast` useState :151 | `pushFitnessToast` |
| `devices` | `allDevices*`/`heartRateDevices`/`rpmDevices`/`equipmentDevices` memos :1493-1563 | ingest + prune interval :1392 |

The `version` useState (:296), `forceUpdate`/`batchedForceUpdate` (:313-386), `ledgerVersion` (:171), `transferVersion` (:172) all disappear — their job (telling React "session data changed") is exactly what `store.markDirty()` does, with per-slice granularity.

### 1.3 Store design

New files: `frontend/src/context/fitness/fitnessTelemetryStore.js`, `frontend/src/context/fitness/useFitnessTelemetry.js`. Pattern precedent: `frontend/src/modules/Media/session/sessionStore.js` and `frontend/src/modules/Piano/PianoKiosk/noteStore.js` (both already use `useSyncExternalStore`; React is 18.3).

```js
// fitnessTelemetryStore.js — created once per provider, owns NO domain state
export function createFitnessTelemetryStore({ getSession }) {
  let snapshot = EMPTY_SNAPSHOT;          // { vitals, vibration, connection, ... } immutable per commit
  const dirty = new Set();                // slice names
  const subscribers = new Set();
  let commitScheduled = false;
  let lastCommitAt = 0;

  function markDirty(slice) {            // called from ingest paths — cheap, no projection here
    dirty.add(slice);
    scheduleCommit();                     // rAF + 250ms min interval (reuses today's throttle policy,
  }                                       // FitnessContext.jsx:356-384) + circuit breaker (:304-354 moves here)

  function commit() {                     // projects ONLY dirty slices; clean slices keep identity
    const next = { ...snapshot };
    if (dirty.has('vitals'))   next.vitals   = projectVitals(getSession());   // reads session.roster (cached, Stage 1)
    if (dirty.has('vibration')) next.vibration = projectVibration(...);
    // ...
    dirty.clear(); snapshot = next;
    subscribers.forEach(fn => fn());
  }

  return { getSnapshot: () => snapshot, subscribe, markDirty, commitNow: commit };
}
```

Consumer API (`useFitnessTelemetry.js`):

```js
// Re-renders ONLY when the selected value changes (isEqual, default Object.is).
const heartRate = useFitnessTelemetry(t => t.vitals.byUser.get(userId)?.heartRate);
const roster    = useFitnessTelemetry(t => t.vitals.roster);          // stable ref between rebuilds
const vibration = useFitnessTelemetry(t => t.vibration.byEquipment[id], shallowEqual);
```

Implementation: add the official `use-sync-external-store` shim package (`useSyncExternalStoreWithSelector`) — 2 KB, what react-redux/zustand use — rather than hand-rolling selector caching (tearing-prone). If a new dep is vetoed, the fallback is the cached-`getSnapshot` wrapper pattern; but prefer the shim.

Key properties:
- A vibration packet dirties only `vibration` → only `VibrationApp`/`getEquipmentVibration` consumers re-render. HR packets dirty `vitals`/`treasure` → chart/users/footer re-render. Toast changes touch only the toast slot. Provider itself **does not re-render** for any of these.
- The 250ms throttle and circuit breaker live in exactly one place (the store's `scheduleCommit`), instead of being a convention each setter can forget (which is precisely how :1227/:1278/:1368 bypassed it).
- Projections read the Stage-1-cached roster, so a commit is cheap even at the 4Hz ceiling.

---

## 2. Stage plan

Ordering: risk-adjusted value; each stage independently shippable to the live kiosk and independently revertible. Stages 1–2 end the crash class; Stage 3 ends the data-loss class; 4–7 remove the architecture that breeds regressions. Deploys follow CLAUDE.local.md gates (no deploy during active session/playing video; reload garage Firefox after).

### Stage 1 — Roster cache (COST fix; satisfies the existing RED test)

**The single highest value/risk ratio change.** Makes every roster read ~free, which also de-fangs any residual render storms.

**Design — hybrid version-stamp + TTL backstop.** Pure hand-wired invalidation across the ≥7 foreign owners (DeviceManager incl. `pruneStaleDevices`, UserManager, assignment ledger, TreasureBox zone snapshot, ZoneProfileStore, ActivityMonitor, entity registry) rots — the landmine list says so. Pure short-TTL alone would still rebuild ~N×/sec on hot paths and can serve a stale roster at exactly the wrong moment. Hybrid:

1. **Version stamps on the three owners the roster reads structurally:**
   - `DeviceManager.mutationVersion` — bump in `registerDevice` (DeviceManager.js:200), `removeDevice` (:220), and `pruneStaleDevices` (:260) *when it actually marks/removes something*. (Every ANT+ packet calls `registerDevice`, so worst case the cache invalidates at packet rate ~4Hz/device — still a ~10× cut from 34/sec, and correctness-safe.)
   - `UserManager.mutationVersion` — bump in `updateFromDevice`, `assignGuest`, `configure`, `setRoster`, and from the ledger `onChange` already wired at FitnessContext.jsx:582.
   - `ZoneProfileStore.version` — bump wherever zone state commits (`_syncZoneProfiles` path, FitnessSession.js:619/:2004).
2. **Cache in `ParticipantRoster`** (revive the dead fields :63-65): on `getRoster()`, compute `key = ${dm.mutationVersion}:${um.mutationVersion}:${zps.version}`; if `key === _cachedKey && (now - _cachedAt) < 1000` return `_cachedRoster`; else rebuild, stamp, return. `configure()`/`reset()` keep calling `_invalidateCache()` (:100, :108).
3. **TTL = 1000ms backstop** covers the un-instrumented owners (TreasureBox `getUserZoneSnapshot`, ActivityMonitor status transitions): worst-case staleness 1s — invisible for zone color, and 2+ orders of magnitude under the empty-roster window.

**Landmines, addressed explicitly:**
- `_historicalParticipants` mutation (ParticipantRoster.js:201, :211): first appearance of any participant implies a new device/user → version bump → rebuild → the add runs. Cache hits can only occur for already-recorded participants. Pinned by test.
- `getFullRoster()` pushes ghost entries into the returned array (:409): change `const deviceRoster = this.getRoster()` (:381) to `const deviceRoster = [...this.getRoster()]`. Additionally `Object.freeze(_cachedRoster)` under `import.meta.env.DEV`/test so any other in-place mutator throws loudly instead of poisoning the cache.
- `_checkEmptyRosterTimeout` (FitnessSession.js:2470) staleness → zombie sessions: `pruneStaleDevices` bumps `DeviceManager.mutationVersion`, so the tick's `this.roster` read (:2471) rebuilds and sees empty. TTL bounds even a missed path at 1s vs. a multi-minute window. Pinned by test.

**TDD:**
- Existing RED test `frontend/src/hooks/fitness/FitnessSession.rosterCache.test.js` (≤1 build across 6 reads; fresh after device add; fresh after HR change) goes green.
- New `frontend/src/hooks/fitness/ParticipantRoster.cacheSafety.test.js`:
  1. `getFullRoster()` twice with a ledger ghost → second `getRoster()` does NOT contain the ghost, cached array length unchanged.
  2. Warm 2 devices → advance fake timers past `remove` timeout → `pruneStaleDevices` → `session.roster` is empty on the next read → `_checkEmptyRosterTimeout` ends the session with reason `empty_roster` (extend the pattern in `FitnessSession.tickStorm.test.js`).
  3. `_historicalParticipants` contains a participant after their first cached-era appearance; `getHistoricalParticipants()` (:358) stable across cache hits.
  4. TTL expiry (fake timers +1100ms, no version bump) forces one rebuild.

**Change points:** `ParticipantRoster.js:59-78` (fields), `:91-101` (configure), `:134` (getRoster), `:380-382` (getFullRoster copy); `DeviceManager.js:200/:220/:260`; `UserManager.js` mutators; `ZoneProfileStore.js` commit path. No FitnessContext changes in this stage (keeps blast radius session-layer only).

**Verification:** during a live single-rider workout, `participant.roster.build` (ParticipantRoster.js:179, sampled+aggregate) aggregate count drops from ~34/sec-equivalent to ≤ ~4/sec. `fitness.tick_timer.health` (FitnessSession.js:2848) continues; no `empty_roster` regressions in `media/logs` session JSONL.

**Regression risks:** stale roster hiding a *new* participant (guarded by version bumps + RED test 2); frozen-array throw in dev surfacing an unknown mutator (that's a find, not a regression — fix the mutator).

### Stage 2 — Provider render-count fixes (shippable without the split)

**2a. Route every write through the throttle.** Change points, all FitnessContext.jsx:
- `setVibrationState` per packet (:1227) — vibration state moves to a ref (`vibrationStateRef`) mutated in `handleVibrationEvent`, with `batchedForceUpdate()` to publish (Stage 4 moves it to the store's `vibration` slice; this is the interim). The decay timeout write (:1261) likewise.
- `setFitnessToast` (:1278/:1282) — keep as `useState` (discrete, human-triggered) but audit callers; the storm contributor is rider/challenge toasts during ingest (:1919-1931, :2375-2398) — these already fire from effects at throttled cadence; acceptable.
- `setConnected` (:1368) — wrap in a `prev === next` guard (status callbacks can repeat the same value during reconnect churn).
- `forceUpdate` → `batchedForceUpdate` at: voiceMemoManager mutation callback (:782), `assignGuestToDevice` (:811), `clearGuestAssignment` (:820), `suppressDeviceUntilNextReading` (:850), `setGovernanceMedia` (:1182), `setGovernanceSuspended` (:1193), config effect (:738). (`requestEndSession` :562 already batched.)

**2b. Memoize the provider `value`.** Wrap :2415-2627 in `React.useMemo`. Deps analysis:
- Already-stable (memo/useCallback-backed): the ~60 fields listed in §1.2 under config/commands.
- Per-render-fresh objects that must be fixed first: `userHeartRates: new Map()` (:2579 → module-level `EMPTY_MAP` constant), inline closures `resetAllUserSessions` (:2476), `registerSessionScreenshot` (:2560), `configureSessionScreenshotPlan` (:2561), `getUserByName` (:2612) → `useCallback`.
- Raw engine reads `governanceState`/`governanceChallenge` (:2347-2348) and `session?.governanceEngine?.activePolicy` (:2492) — capture via memos keyed on `version` so identity is stable between publishes.
- Resulting dep list ≈ the union of state hooks + memo outputs; `version` remains a dep (by design: one publish per throttled batch).

**Quantified expectation:** provider renders become hard-capped by the 250ms throttle at ~4/sec + rare discrete UI state changes ⇒ observed `FitnessChart` ~12/sec sustained → ≤ ~4-5/sec (~65% count cut), and each render is ~10× cheaper post-Stage-1. This does NOT yet fix "all consumers render together" — that's Stage 4. Also delete the roster JSON-signature dedup (:1637-1665, and `rosterCacheRef` :295): with Stage 1 the session returns a stable array reference, so the memo becomes `const participantRoster = React.useMemo(() => fitnessSessionRef.current?.roster || emptyRosterRef.current, [version])` — killing the 4×/sec `JSON.stringify`.

**TDD (write first):** new `frontend/src/context/FitnessContext.renderStorm.test.jsx` (jsdom + fake timers):
1. Mount provider with a probe consumer that counts renders. Fire 40 simulated vibration events + 40 `session.ingestData` HR packets inside 1000ms → probe renders ≤ 6.
2. Re-render the provider's parent with identical props → context value identity unchanged (probe render count +1 only for the parent pass, no cascaded value change).
3. `setConnected(true)` twice → one publish.

**Verification:** `window.__fitnessRenderStats()` (:393) over 30s during live workout: `renderCount ≤ ~150`; `fitness.render_thrashing` (useRenderProfiler.js:112) never fires; `fitness.circuit_breaker.tripped` (:348) never fires.

**Regression risks:** a memo dep omission → stale UI (mitigate: keep `version` in deps so every publish rebuilds value; exhaustive-deps lint on the new memo); vibration ref migration changing `getEquipmentVibration` (:2067) identity — keep it keyed on the publish counter.

### Stage 3 — Durability: server-side provisional persistence (chosen over client checkpoint)

**Decision: (a) server-side provisional persistence.** Rationale:
- `/resumable` (backend/src/4_api/v1/routers/fitness.mjs:528 → `SessionService.findResumable` SessionService.mjs:329) already reads persisted sessions and already excludes only `finalized` (:362). Making early saves *exist* makes resume correct with **zero new query surface**.
- The client autosave pipeline already produces payloads every 15s (`_startAutosaveTimer` FitnessSession.js:2967, `autosaveIntervalMs: 15000` :336) — **only the validation gate discards them**. Option (b) would build a second persistence system to work around a one-line gate.
- (b) requires kiosk-identity gating (the Mac-tab landmine), a merge protocol between localStorage and server state after crash, and doesn't survive device swap/browser profile wipe. (a) needs no kiosk gate at all: sessions only auto-start in kiosk mode (`setKioskMode` FitnessSession.js:518, `ensureStarted` :1743), so non-kiosk tabs never generate saves.

**Change points:**
1. `PersistenceManager.js:882` — replace `if (sessionData.durationMs < 300000) reject` with:
   ```js
   if (sessionData.durationMs < 60000) return { ok:false, reason:'session-too-short', durationMs };
   sessionData.provisional = !sessionData.finalized && sessionData.durationMs < 300000;
   ```
   Keep the `no-meaningful-data` HR gate (:901) and `roster-required`/`no-participants` gates (:865/:879) — they are what prevents the historical rosterless-ghost-session spam class. Keep `tickCount < 3` (:892) as belt-and-braces (unreachable at ≥60s but cheap). This automatically fixes the **deliberate-short-end** case: `endSession` → `_persistSession(force:true)` (FitnessSession.js:2376) now persists any ≥60s session; <60s deliberate ends remain discarded by design (documented noise floor).
2. `backend/src/3_applications/fitness/services/SessionService.mjs:256 saveSession` — explicitly carry `provisional` through the serializer; clear it (`provisional: false`) when a later save of the same sessionId arrives with `durationMs ≥ 300000` or `finalized: true` (same-id overwrite already self-heals this if the flag is just payload-derived — verify and pin with test).
3. GC: extend `backend/src/3_applications/fitness/sessionConsolidationPolicy.mjs` — provisional sessions with no update for 48h are deleted (they are crash orphans of <5-min workouts). Session-list endpoints (`/sessions` fitness.mjs:325) filter `provisional` out of user-facing history unless `?includeProvisional=1`.
4. `findResumable` (SessionService.mjs:358-362): no change needed — provisional sessions are non-finalized and therefore already resumable. Add a log field so resume-from-provisional is observable.

**TDD:**
- `PersistenceManager.provisional.test.js`: 90s autosave → `ok:true, provisional:true`; 45s → rejected `session-too-short`; 61s `force` (deliberate end) → persists; 6-min save → `provisional` false/absent; second save of same id at 6 min clears the flag.
- Backend (pattern-match existing `sessionConsolidationPolicy` tests): findResumable returns a provisional session within the merge window; GC deletes a 49h-stale provisional and spares a finalized one.
- Existing suite `FitnessSession.resumable.test.js` / `PersistenceManager.savePromise.test.js` must stay green.

**Verification:** kiosk manual drill: start riding, at ~2 min hard-reload Firefox → `fitness.session.resume_check.result` (FitnessSession.js:1642) logs `resumable:true` and the session resumes instead of forking. `fitness.persistence.validation_skipped` with `reason:'session-too-short'` (PersistenceManager.js:970) disappears for sessions >60s. `fitness.session.save_health_warning` (FitnessSession.js:2860) stops firing at the 5-min mark.

**Regression risks:** provisional spam from sensor flap — bounded by the 60s floor + `no-meaningful-data` HR gate + GC; session-list pollution — filtered; double-count in stats — recap/receipt paths must skip `provisional` (grep consumers of the session YAML before shipping; guard in `/sessions` router).

### Stage 4 — Telemetry store (`useSyncExternalStore`) + migrate hot consumers

Build `fitnessTelemetryStore` + `useFitnessTelemetry` per §1.3. Wire `markDirty` at:
- WS ingest handler (FitnessContext.jsx:1347-1348): `session.ingestData(data); store.markDirty('vitals'); store.markDirty('devices')` — replacing `batchedForceUpdate()`.
- `handleVibrationEvent` (:1201): `markDirty('vibration')` — replacing the two `setVibrationState` calls.
- TreasureBox mutation callback (:761): `markDirty('treasure'); markDirty('vitals')`.
- Governance callbacks (:702-706): `markDirty('governance')`.
- Ledger onChange (:582): `markDirty('session')`.
- WS status (:1368): `markDirty('connection')`.
- Prune interval (:1396): `markDirty('devices','vitals')`.
- Tick timer: session exposes `onTick(cb)`; provider subscribes → `markDirty('timeline','session')`.

Migrate in order of measured render frequency (these five accounted for the storm): **FitnessChart** (via `useFitnessModule.js` — swap its `fitnessCtx` reads for selectors), **FitnessUsers.jsx**, **SidebarFooter.jsx**, **FullscreenVitalsOverlay.jsx**, **VibrationApp.jsx**, then **CycleGameContainer.jsx**. Everything else keeps reading the legacy facade until Stage 7.

Snapshot projections reuse the existing pure builders — `buildParticipantDisplayMap` (participantDisplayMap.js), `ParticipantFactory.fromRoster` (:1700), the vitals mapping (:1839-1877) — moved verbatim from context memos into `projectVitals()`.

**TDD:**
- `fitnessTelemetryStore.test.js`: (1) vibration commit does not change `vitals` slice identity nor notify a vitals selector subscriber; (2) two `markDirty` in one frame → one commit; (3) commits respect 250ms min interval; (4) circuit breaker trips/resets (port the thresholds :304-311); (5) selector equality: `t => t.vitals.byUser.get('u1')?.heartRate` subscriber not notified when a different user's HR changes.
- Component test: FitnessUsers rendered against the store — HR change re-renders it, vibration event does not (render-count probe).

**Verification:** add `fitness.telemetry.commit` sampled log `{ dirtySlices, commitMs, subscribersNotified }`; live workout shows chart render counter (useRenderProfiler) at ≤4/sec while VibrationApp renders only on vibration events; `window.__fitnessRenderStats` provider renderCount drops to near-static.

**Regression risks:** tearing (mitigated by the official shim); dual-source drift while facade and store coexist (mitigated: facade fields for migrated slices are *derived from the store snapshot*, not computed twice).

### Stage 5 — Session-domain work off render cadence

Kill the inversion where React renders drive domain sampling (`updateSnapshot` effect FitnessContext.jsx:2323-2342, keyed on `version`, calling FitnessSession.js:1895 which appends HR series :1948-1994 and runs `governanceEngine.evaluate` :2125).

- **HR series append + snapshot bookkeeping** → the session tick timer (`_collectTimelineTick` FitnessSession.js:2194, 5s cadence). The series write is interval-indexed (`series[intervalIndex] = hr` :1983) so per-render calls were pure overwrite waste; once per interval is exactly equivalent. Move the usersMeta/deviceSeries maintenance (:1946-2028) into a session-internal `_sampleSnapshot()` called from the tick.
- **Governance evaluate** → already has render-independent paths: `notifyZoneChange` from ingest (FitnessSession.js:620) and the engine's self-evaluating `_triggerPulse` (GovernanceEngine.js:1422-1427, reads `session.getActiveParticipantState()` — cheap after Stage 1). Remove the evaluate call and the `effectiveRoster` merge hack (FitnessSession.js:2048-2066) from `updateSnapshot`; the engine evaluates on (a) zone change events, (b) its own timers, (c) the 5s tick. If lock-release latency needs sub-5s, add a 1s session-owned evaluator interval — config'd, not render-coupled.
- **What React still feeds the session** (narrow effects remain): play queue head → `setPendingContentId` (:2310-2321, already exists) plus a new `session.setPlayQueue(queue)` for snapshot.playQueue; zoneConfig via the existing configure effect (:686-706). Then **delete the `updateSnapshot` effect** and `updateSnapshot`'s roster/users/devices params (they were session-owned state passed back in a circle: `users`/`fitnessDevices` at :567-568 ARE `session.userManager.users`/`session.deviceManager.devices`).
- The effect-populated caches (`_userCollectionsCache` etc. FitnessSession.js:2041-2046) become on-demand getters with the same version-stamp caching as the roster.

**TDD:** `FitnessSession.snapshotCadence.test.js`: (1) with fake timers and zero `updateSnapshot` calls, HR ingest + tick advance produces populated `snapshot.participantSeries` and timeline series; (2) governance locks/unlocks from ingest+tick alone (no React) — reuse scenarios from `GovernanceEngine.kioskGate.test.js` / `GovernanceEngine.playbackPause.test.js`; (3) `pendingContentId` still resolves for resume checks (existing `FitnessSession.resumeContentRace.test.js` green).

**Verification:** live workout with DevTools profiler idle (no interaction): scripting time per 10s window drops; `fitness.tick_timer.health` seriesCount/points grow at exactly tick rate; governance lock latency ≤5s observed on strap removal.

**Risk:** governance evaluation frequency drop changes challenge timing — the engine's own timers (:1477, :2427) drive challenges, not the render loop; pinned by the existing governance test suite (12 files).

### Stage 6 — Session-lifecycle idle coordinator (video closed, roster present)

**Owner:** a new provider-level hook `frontend/src/context/fitness/useSessionIdleCoordinator.js` — NOT the player, and NOT `endSession` coupling (which would regress multi-video workouts, the sidebar End path FitnessSidebar.jsx:56-74, and auto-end paths — established fact #4).

**Behavior:** when `sessionActive && rosterPresent && !contentActive` (contentActive = queue head or `currentMedia` present; all available in the store's `session` slice) continuously for `sessionsConfig.idle_prompt_minutes` (default 5, from fitness.yml `sessions:` block :523):
1. Push a toast via `pushFitnessToast` — "Workout still recording — Continue / End session", End wired to `requestEndSession` (:558, the same path as the sidebar button, so finalize semantics are identical).
2. Log `fitness.session.idle_prompt` with sessionId/idleMs.
3. No auto-end. The session stays alive **because idle is now cheap** (post Stages 1/4/5: 0.2Hz tick + zero render churn). The existing safety nets stay untouched: `_checkEmptyRosterTimeout` (strap removed, FitnessSession.js:2470), inactivity end (`maybeEnd` :2317), `force_break` (FitnessContext.jsx:1332).

`executeClose` (FitnessPlayer.jsx:1095-1154) gets exactly one addition: `session.logEvent('content_closed', {...})` so idle windows are visible in the timeline — no lifecycle behavior change.

**TDD:** `useSessionIdleCoordinator.test.jsx`: fires prompt after threshold; does NOT fire when a new video starts within the window (multi-video); does NOT fire when roster empties (empty-roster path owns that); End action calls `requestEndSession` once; prompt re-arms after continue.

**Verification:** garage drill — finish a video, keep the strap on, wait: toast appears at 5 min, `endSession` NOT called; session JSONL shows `content_closed` → `idle_prompt` sequence.

### Stage 7 — Split completion + mitigation-layer cleanup

- Introduce `FitnessConfigContext` / `FitnessCommandsContext` / `FitnessSessionUiContext` per §1.2; migrate remaining ~30 consumer sites (mechanical: `useFitnessContext().pushFitnessToast` → `useFitnessCommands().pushFitnessToast`); delete the facade last.
- Delete dead/superseded layers: `batchedForceUpdate`/`forceUpdate`/`version` (:296-386, superseded by store commit), the dev `allDevices` deprecation Proxy (:1498-1517), `userHeartRates: new Map()` placeholder (:2579), `updateGovernancePhase` no-op (:1196), legacy compat constants (:610-613).
- **Keep** the circuit breaker (inside the store) and `useRenderProfiler`/`__fitnessRenderStats` permanently — they are the observability that proves the class stays dead.
- TDD: the full existing fitness test suite (60+ files under hooks/fitness + modules/Fitness) is the regression net; add one `FitnessProviders.contract.test.jsx` asserting each context value's identity is stable across unrelated state changes.

---

## 3. What we will NOT do, and why

1. **No state library (Redux/Zustand/Jotai).** React 18's `useSyncExternalStore` + the in-repo store pattern (Media sessionStore, Piano noteStore) covers the need; a library adds a migration surface and a second idiom to a codebase that already has this one.
2. **No Web Worker / OffscreenCanvas offload for the chart.** The storm was render count × uncached roster cost, not intrinsic paint cost. Re-evaluate only if post-Stage-4 profiling shows paint-bound frames.
3. **No FitnessSession rewrite.** It's big but test-covered (60+ test files) and its domain logic is not the incident class. We instrument (version counters, onTick) and relocate call sites; we don't restructure entities/timeline/governance internals.
4. **No blanket `React.memo` on all 38 consumers.** Memoizing against a monolithic context is exactly the mitigation-layer pattern that failed 3 times; selector subscription makes it unnecessary.
5. **No server-push of roster/vitals** (moving roster computation backend-side). The sensors' WS fan-out and offline behavior make client-side assembly correct; the cost problem dies with the cache.
6. **No shortening of the empty-roster window and no close→endSession coupling** (regresses multi-video; established fact #4).
7. **No localStorage session checkpoint** (Stage 3 rationale: kiosk-gating landmine, dual-SSoT merge complexity, server-side option is a one-line gate change on an existing 15s autosave pipeline).
8. **No removal of the circuit breaker or render profiler** until the class has been dead for months — they're cheap insurance and the verification instrument for this plan.

---

## 4. Execution notes

- TDD per stage: write the named failing test(s) first (`npx vitest run frontend/src/hooks/fitness/FitnessSession.rosterCache.test.js` etc.), implement to green, then run the fitness suites: `npx vitest run frontend/src/hooks/fitness frontend/src/context frontend/src/modules/Fitness`.
- Deploy per stage (kckern-server rules): check the in-use gates in CLAUDE.local.md, `--no-cache` awareness for backend-touching stages (Stage 3), then hard-reload the garage kiosk Firefox (`ssh garage ... xdotool ... ctrl+shift+r`).
- After each stage, capture a 30-second live baseline: `window.__fitnessRenderStats()`, `participant.roster.build` aggregates, `fitness.telemetry.commit` (once it exists) — append the numbers to this doc so the next incident review has the curve.
