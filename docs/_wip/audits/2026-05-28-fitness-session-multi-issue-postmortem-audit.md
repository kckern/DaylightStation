# Fitness Session Multi-Issue Postmortem — 2026-05-28

**Session:** `fs_20260528194117` (2026-05-29 02:41:17 → 03:19:22 UTC ≈ 19:41–20:19 local; ~38 min)
**Evidence sources:**
- Per-session structured log: `media/logs/fitness/2026-05-29T02-41-17.jsonl` (6,340 events; survived the post-session redeploy because the media volume is bind-mounted). Staged copy used during analysis.
- Session data: `data/household/history/fitness/2026-05-28/20260528194117.yml`.
- Garage ANT+ publisher logs (`ssh root@10.0.0.101 'docker logs daylight-fitness'`).
- Code at `main` HEAD `fad1a9f2a` (the build deployed *after* this session ended).

> ⚠️ The container was redeployed (`stop`+`rm`) right after this session, so `docker logs daylight-station` no longer contains it. All evidence below comes from the persisted per-session JSONL + history YAML, which do survive.

## Issues at a glance

| # | Issue | Verdict | Status of fix |
|---|-------|---------|---------------|
| 1 | Lock-screen background music keeps playing during a voice memo | Confirmed bug | Not fixed — clear fix identified |
| 2 | Just-saved voice memo missing from session entry until re-navigation | Confirmed bug (frontend staleness/race) | Not fixed — clear fix identified |
| 3 | Cadence stuck ~129 RPM long after pedaling stopped | Confirmed; engine root-cause **already fixed** in deployed build | Residual display-layer gap remains |
| 4 | Cycle challenge round 4 "went under, pop-up then gone" + didn't pause video | Not a failure — recoverable lock; design gap | Behavioral/design decisions needed |
| 5 | `fitness.persistence.validation_failed: session-too-short` ×1155 (incidental) | Log spam | Low priority |

A cross-cutting fact ties #1 and #4 together: **a governance/HR challenge failure pauses the video and plays lock-screen music; a cycle-challenge lock does neither.** See the note at the end.

---

## Issue 1 — Lock-screen background music does not pause during a voice memo

**Confidence: High.**

### What happened
At end-of-video the session entered a governance lock (HR challenge failed), which paused the video and started looping lock-screen ambient music. The end-of-video voice memo then opened and recorded — pausing the video, but **not** the lock-screen music — so the memo recorded over music.

### Log evidence
```
03:12:37.206  governance.phase_change  {from:"unlocked", to:"locked", reason:"challenge_failed"}
03:12:37.384  playback.paused          {source:"dom-event"}        ← governance lock paused the video
03:12:41.518  playback.voice-memo      {event:"overlay-open-capture", autoAccept:true, fromFitnessVideoEnd:true}
03:12:41.556  playback.voice-memo      {event:"recording-started", trackCount:1}
   … 03:12:41–03:13:00: zero audio-shader / mute / volume / governance-audio events …
03:13:00.981  playback.resumed         {source:"dom-event"}
```
The lock-screen music source (`GovernanceAudioPlayer`, track `audio/sfx/bgmusic/fitness/locked`) emits no logs, but the absence of any mute/duck event through the whole 19-second memo window confirms it played uninterrupted.

### Root cause
Voice-memo open pauses exactly two sources and is blind to a third:
- `FitnessPlayerOverlay.jsx:122–134` — on `voiceMemoOverlayOpen`, calls `video.pause()` + `fitnessCtx.pauseMusicPlayer()`.
- `useVoiceMemoRecorder.js:432–436` — `pauseMediaIfNeeded(playerRef)` + `onPauseMusic()`.
- `FitnessContext.jsx:1077–1083` — `pauseMusicPlayer/resumeMusicPlayer` only reach `musicPlayerRef` (the **`FitnessMusicPlayer`**).

The **lock-screen music** is a separate, self-contained `<audio>` element: `GovernanceAudioPlayer.jsx:15–110`, rendered by `GovernanceStateOverlay.jsx` (6 render sites incl. lines 601, 634, 691, 701, 715, 726) as `<GovernanceAudioPlayer trackKey={audioTrackKey} />` with **no ref, no mute/pause prop, and no subscription to the voice-memo overlay state**. Nothing in the voice-memo pause path can reach it.

### Recommended fix (do not implement yet)
Add a `muted` (or `paused`) prop to `GovernanceAudioPlayer` (pause without resetting `currentTime`; resume when false). In `GovernanceStateOverlay`, read `voiceMemoOverlayState` from `FitnessContext` and pass `muted={Boolean(voiceMemoOverlayState?.open)}` to every `<GovernanceAudioPlayer>`. Drive it off the overlay-open state (mirrors how music resume already keys off `closeVoiceMemoOverlay` in `FitnessContext.jsx:906`), **not** off the recorder start/stop — note `useVoiceMemoRecorder.js:504–522` has its `onResumeMusic()` calls commented out, so resume already relies on the overlay-close path.

---

## Issue 2 — Just-saved voice memo missing from the session entry until re-navigation

**Confidence: High.** The memo *is* on disk (confirmed: `memo_1780024379626_tk4kx2z3j`, "We did the first part of the secret level…", present in `timeline.events` of `20260528194117.yml`). This is purely a frontend staleness/race.

### Root cause (three converging problems)
1. **The sessions list is a fetch-once-then-poll store, never invalidated on session end.** `FitnessSessionsWidget.jsx:288` reads `useScreenData('sessions')`; `ScreenDataProvider.jsx:35–46` fetches `GET /api/v1/fitness/sessions` once and re-polls only every **300 s**. Each row renders `s.voiceMemos` inline (line 200–201). `FitnessPlayer.executeClose()` never calls `refetchScreenData('sessions')`.
2. **The detail widget fetches only on mount, and mounts before the save lands.** `FitnessSessionDetailWidget.jsx:197–199` runs `fetchSession()` once per `sessionId`. `FitnessPlayer.executeClose()` (`FitnessPlayer.jsx:968`) fires the redirect immediately while session persistence (`FitnessSession._persistSession`, line 2189) is **fire-and-forget** → the detail widget reads a YAML snapshot that predates the final flush with the memo.
3. Navigating away + back unmounts/remounts the detail widget → fresh `fetchSession()` long after the save completed → the memo appears.

Timing for this session: `recording-upload-complete` at 03:12:59, `overlay-accept` at 03:13:00 (Whisper transcription upload takes seconds), so the race is effectively deterministic here.

### Recommended fix (do not implement yet)
- **Fix A (list staleness):** call `refetchScreenData('sessions')` in `FitnessPlayer.executeClose()` (around `FitnessPlayer.jsx:993`) after the save resolves (use `useScreenDataRefetch()`).
- **Fix C (detail race):** ensure `FitnessSessionDetailWidget.fetchSession()` runs **after** `save_session` acknowledges, not on bare mount — e.g., chain it off the persist completion, mirroring the retroactive-memo path that already does `onComplete: () => fetchSession()` at `FitnessSessionDetailWidget.jsx:183`. The post-session `openVoiceMemoCapture` `onComplete` (`FitnessPlayer.jsx:1049`) should likewise trigger a refetch after persistence resolves rather than only redirecting.

---

## Issue 3 — Cadence stuck ~129 RPM after pedaling stopped

**Confidence: High.** Root cause already documented in `docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md`; the **engine fix already landed and is in the deployed build** (`fbdbe74a9` "track cadence freshness from payload"). A display-layer residual remains.

### Root cause (pre-fix)
ANT+ sensors keep broadcasting non-cadence pages (battery/manufacturer/common 80–82) for 60–120 s after the cranks stop. Pre-fix, `Device.update()` computed `hasCadence` from the **persisted** value (`this.cadence > 0`) instead of the **payload** (`data.cadence`), so every battery packet refreshed `lastSignificantActivity`, the 3 s `rpmZero` sweep in `pruneStaleDevices` never tripped, and `getEquipmentCadence()` kept returning the last peak (e.g. 129) with an advancing `ts` → the `CadenceFilter` EMA held it. Garage logs confirm device `7183` legitimately hit `CAD:129` at 02:59:24 during real pedaling; the "stuck" reading is the same peak held after stop.

### Freshness contract (post-fix)
- **Garage publisher** (`_extensions/fitness/src/ant.mjs:208–214`): no timeout-to-zero — forwards frames as they arrive; simply stops sending cadence frames when the sensor goes silent. (Gap: it never emits an explicit zero on stop.)
- **`CadenceFilter.js:5–6,63–65`:** decay starts at `STALE_THRESHOLD_MS=1500`, reaches 0 by `LOST_SIGNAL_MS=4000`. Hard contract "zero within 5 s."
- **`GovernanceEngine._filteredCadenceFor` (516–543)** + **`FitnessSession.getEquipmentCadence` (1103–1136):** once `now - lastSignificantActivity > rpmZero(3000)`, returns `{rpm:0, connected:false}` (no `ts`) → filter ticks toward zero.

### Residual gaps (not yet fixed)
1. **Display widgets still read raw `device.cadence`**, bypassing the staleness-aware path: `FullscreenVitalsOverlay.jsx:184`, `FitnessUsers.jsx:504,509`. The `useEquipmentCadence` hook intended to fix this (`docs/superpowers/plans/2026-05-16-fitness-rpm-freeze-fix.md`) is **unexecuted** (hook file doesn't exist). Net worst-case visible freeze is now ~6–7 s (3 s rpmZero gate + ≤3 s prune interval + filter decay) instead of 60–125 s — better, but not the ~250 ms target.
2. **`getEquipmentCadence` uses `ts: device.lastSeen`** (`FitnessSession.js:1135`), which advances on *all* ANT+ packets; using `lastSignificantActivity` would make the filter's freshness watermark track cadence-bearing packets only.
3. **Telemetry gap:** `governance.cycle.state_transition` events carry `cadenceFlags: null` (flag computed but not logged); no `device.update` debug log records `hadCadenceInPayload=false, persistedCadence=129` during a freeze. Garage logs only record cadence-bearing frames (`ant.mjs:199–203`), so battery-packet frequency during a freeze can't be counted from logs. Recommend adding both to make stop-behavior self-evident next time.

### Recommended fix (do not implement yet)
Execute the `useEquipmentCadence` hook plan and convert the three raw `device.cadence` reads; optionally switch the `getEquipmentCadence` `ts` to `lastSignificantActivity`; add the two telemetry breadcrumbs above. **Verify on the next real session** that the freeze is ≤ a few seconds.

---

## Issue 4 — Cycle challenge round 4: recoverable lock, and the video never paused

**Confidence: High.** The 4th round did **not** fail — it succeeded after two recoverable locks.

### What actually happened (phase index 3 = "round 4")
```
02:57:37  ramp→maintain   phase 3
02:57:51  maintain→locked phase 3  rpm 47.6  reason=below_lo_grace_expired   ← pop-up appears
02:58:11  locked→maintain phase 3  reason=recovered_from_maintain_lock        ← pop-up disappears
02:58:33  maintain→locked phase 3  rpm 61.8  below_lo_grace_expired           ← 2nd lock
02:58:36  locked→maintain          recovered_from_maintain_lock
02:58:36  maintain→success phase 3 rpm 91.9                                   ← challenge SUCCEEDED
```
The vanishing "pop-up" was the cycle-lock panel in `GovernanceStateOverlay` (`computeCycleLockPanelData`, lines 621–680), shown while `cycleState==='locked'` and dismissed on recovery to `maintain` (the inline `CycleChallengeOverlay` hides itself when locked — `FitnessPlayerOverlay.jsx:193`).

### Why the video didn't pause (by design)
`_evaluateChallenges` sets `challengeState.videoLocked=true` on a cycle lock (`GovernanceEngine.js:3379–3382`), but `_composeState` gates it:
```js
// GovernanceEngine.js:1724–1725
videoLocked: (this.challengeState?.videoLocked || this._mediaIsGoverned())
  && this.phase !== 'unlocked' && this.phase !== 'warning',
```
A cycle challenge only runs while `phase === 'unlocked'`, so the gate forces `videoLocked=false`. `useGovernanceDisplay.js:36–44` likewise hard-returns `videoLocked:false` for the cycle-locked path. `resolvePause` (`pauseArbiter.js:18–24`) only pauses on `governance.locked`. → **cycle lock = overlay only, video keeps playing.** By contrast a governance/HR lock sets `phase='locked'`, so `videoLocked=true` and the video pauses (exactly what happened at 03:12:37, Issue 1).

### The design gaps
1. **No terminal-failure path for cycle challenges.** There is no `status='failed'` anywhere in `_evaluateCycleChallenge`; `init`/`ramp`/`maintain` locks recover unconditionally (recover when RPM ≥ `hiRpm`, or ≥ `init.minRpm` for init-locks). `totalLockEventsCount` is incremented (2672/2711/2749) but **never read**. A rider who abandons the bike mid-challenge stays in `locked` forever and the challenge never ends.
2. **Cycle lock doesn't gate the video** (above) — intentional today, but undocumented as a product decision, and weaker than a governance lock.
3. **Maintain-lock recovery requires `hiRpm`, not `loRpm`** (`GovernanceEngine.js:2847`) — a deliberately punishing "sprint back up" mechanic, undocumented.

### Recommended decisions (design, do not implement yet)
- Decide a **terminal-fail policy**: e.g. fail after N lock events (use the existing `totalLockEventsCount`) or after sustained time in `locked`; make `init`-lock terminal (the snapshot already treats it as `fatal` at `GovernanceEngine.js:682–683`). On fail, emit `governance.cycle.failed`, clear the active challenge, and decide playback consequence.
- Decide whether a cycle lock / cycle fail should **pause the video**. If yes, add a cycle-specific `videoLocked` path that bypasses the `phase !== 'unlocked'` gate. If no, document the "video keeps playing as motivation" decision next to the `_composeState` formula and `useGovernanceDisplay.js:29–35`.
- Document/expose the `hiRpm` recovery threshold (config `lock_recovery_rpm_ratio`?).

---

## Issue 5 (incidental) — `fitness.persistence.validation_failed: session-too-short` ×1155

Repeated warn-level rejections early in the session: `{reason:"session-too-short", rosterLength:5, hasPriorSave:false}`. Almost certainly benign (the session hadn't accumulated enough duration to persist), but 1,155 occurrences is significant log spam in a 6,340-line session log. Recommend rate-limiting/aggregating this event (the framework supports `logger.sampled`) or only emitting it on state change, not every tick.

---

## Cross-cutting note: governance fail vs cycle lock

This session shows both lock types within minutes:
- **03:12:37 governance lock** (`challenge_failed`, an HR/zone challenge) → `phase='locked'` → **video paused** + lock-screen music. This is the "screen lock" in Issue 1.
- **02:57:51 / 02:58:33 cycle locks** → `cycleState='locked'` while `phase='unlocked'` → **video kept playing**, only the cycle overlay shown; both recovered.

So the user's instinct in #4 ("if it failed it didn't pause the video") reflects a real architectural asymmetry: governance failures gate playback; cycle-challenge outcomes (including the *absent* fail path) do not. Aligning these is the core product decision behind Issue 4.

---

## Suggested priority

1. **Issue 1** (memo records over lock music) — small, self-contained, clear fix; high user-visible quality win.
2. **Issue 2** (memo not showing on entry) — small frontend fix (refetch on save); high-visibility.
3. **Issue 4** (cycle fail/exit semantics) — needs product decisions first (terminal-fail policy + video-pause behavior), then implementation; this is the substantive one.
4. **Issue 3 residual** (display widgets read raw cadence + telemetry) — engine already fixed; finish the display hook + add breadcrumbs; verify next session.
5. **Issue 5** — log-spam cleanup, opportunistic.

## Files referenced
- `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx`, `GovernanceStateOverlay.jsx`
- `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx`, `FitnessPlayer.jsx`
- `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js`
- `frontend/src/context/FitnessContext.jsx`
- `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx`, `FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx`
- `frontend/src/screen-framework/data/ScreenDataProvider.jsx`
- `frontend/src/hooks/fitness/GovernanceEngine.js`, `CadenceFilter.js`, `FitnessSession.js`, `DeviceManager.js`
- `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js`
- `_extensions/fitness/src/ant.mjs`
- Related: `docs/_wip/bugs/2026-05-28-fitness-rpm-cadence-freeze-and-ghost-devices.md`, `docs/superpowers/plans/2026-05-16-fitness-rpm-freeze-fix.md`
