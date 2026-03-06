# Audit: Fitness Session Data Loss — 2026-03-06

## Incident

Session `fs_20260306053853` (March 6, 05:38–06:15 PST) lost all data. 36 minutes of valid fitness data — 420 ticks, 20 series, 8440 data points, voice memo, P90X3 CVX workout — completely gone. No session YAML written to disk. Strava webhook enrichment failed with `session_scan.miss` because there was nothing to match against.

## Timeline

| Time (UTC) | Event |
|---|---|
| 13:38:53 | Session started (`buffer_threshold_met`), HR device 40475, user kckern |
| 13:38:53 | Tick timer + autosave timer started (15s interval) |
| 13:39:04 | P90X3 CVX video selected and started |
| 14:03:53 | Health check: 300 ticks, 20 series, 6040 points — session healthy |
| 14:08:53 | Health check: 360 ticks, 7240 points |
| 14:13:53 | Health check: 420 ticks, 8440 points |
| 14:14:04 | Video ended, voice memo capture started |
| 14:14:52 | Voice memo transcribed and accepted |
| 14:17:48 | Session ended: `empty_roster` (HR device disconnected ~2 min after cooldown) |
| **Total saves to backend: 0** | |

Strava webhook arrived at 06:16:40 UTC for activity `17624884199` ("Morning Workout"). Two enrichment attempts (06:16, 06:21) both got `session_scan.miss`.

## Root Cause Analysis

### Three bugs conspired to lose the data

---

### Bug 1: Debug log counters are per-instance, not per-session

**Files:** `PersistenceManager.js:804,814,1016,1026`

The PersistenceManager uses throttled debug counters (`_debugBlockedCount`, `_debugValidationCount`, `_debugSaveCount`, `_debugSaveSuccessCount`) that increment on the **instance** and never reset between sessions.

Yesterday evening's session (`20260305181653`) exhausted these counters:
- `_debugValidationCount` hit 3/3 (three `session-too-short` failures at session start)
- `_debugSaveCount` hit 5/5 (five successful save attempts)
- `_debugSaveSuccessCount` hit 3/3

Today's session reused the same PersistenceManager instance. **All validation failures and save attempts were completely silent** — no `console.error` output, no evidence in logs. The session appeared healthy from the health-check logs but was secretly failing every autosave for 36 minutes.

**Evidence:** Yesterday's evening session shows `VALIDATION_FAIL [1/3]`, `[2/3]`, `[3/3]` and `SESSION_SAVE [1/5]`...`[5/5]`. Today's session shows zero of these logs despite running for 36 minutes with 15-second autosave intervals (~144 attempts).

---

### Bug 2: Autosave and session-end both read LIVE roster, not a snapshot

**Files:**
- `FitnessSession.js:2397` — `_maybeAutosave()` calls `this.summary`
- `FitnessSession.js:1806` — `endSession()` calls `this.summary`
- `FitnessSession.js:2461` — `summary` getter reads `this.roster` (live)
- `FitnessSession.js:1179-1180` — `get roster()` returns `this._participantRoster?.getRoster() ?? []`

The `summary` getter reads the **current** roster state, not a snapshot from when the session was last known-good. When the HR device disconnects:
1. Device pruning removes it from the device manager
2. `ParticipantRoster.getRoster()` returns `[]`
3. Every subsequent autosave generates a summary with `roster: []`
4. Validation rejects with `no-participants` (PersistenceManager.js:740-741)
5. The final `endSession('empty_roster')` force-save also reads the empty roster and fails

**There is no "last known good roster" preserved anywhere.** Once the roster empties, all saves fail — retroactively dooming data that was valid seconds ago.

---

### Bug 3: Autosave errors are silently swallowed

**File:** `FitnessSession.js:2365-2371`

```javascript
this._autosaveTimer = setInterval(() => {
  try {
    this._maybeAutosave();
  } catch (err) {
    // console.error('Autosave failed', err);  // <-- COMMENTED OUT
  }
}, this._autosaveIntervalMs);
```

If `_maybeAutosave()` or anything in its call chain throws, the error is swallowed. Combined with Bug 1 (exhausted debug counters), there is **zero observability** into autosave failures after the first session on a given PersistenceManager instance.

---

### Why yesterday worked and today didn't

Both sessions ran on the **same build** (deployed 2026-03-05T22:13Z). Both ended via `empty_roster`.

**Yesterday evening (`20260305181653`):**
1. Fresh PersistenceManager instance (debug counters at 0)
2. First ~5 minutes: validation fails with `session-too-short` (logged as `VALIDATION_FAIL [1-3/3]`)
3. After 5 minutes: saves succeed (logged as `SESSION_SAVE [1-5/5]`)
4. Session ended at 02:33 via `empty_roster` — but data was already saved to disk
5. Final force-save at end probably also failed (empty roster) but didn't matter

**Today morning (`20260306053853`):**
1. Same PersistenceManager instance (debug counters already exhausted)
2. First ~5 minutes: validation fails with `session-too-short` — **SILENT** (counter already at 3/3)
3. After 5 minutes: validation SHOULD pass, but... (see below)
4. Something prevents saves from succeeding for the remaining 31 minutes — **SILENT** (save counter at 5/5)
5. Session ends via `empty_roster` — force-save fails on empty roster — **SILENT**

**The remaining mystery:** Why did autosave fail after the 5-minute mark? The health checks show valid data (420 ticks, 20 series, roster size 1). Possible causes:
- `isSaveInProgress()` stuck true from a hung promise (Plex enrichment timeout)
- `summary` getter throws on some edge case (caught by swallowed try/catch)
- Validation gate we haven't identified yet

Without observable logs (Bug 1), we cannot determine the exact blocking mechanism. **This is the core problem: the system has no way to tell us what went wrong.**

---

## Systemic Issues

### 1. No roster watermark / high-water-mark pattern

The system has no concept of "this session had N participants at its peak." When the last device disconnects, ALL historical context is lost. A 36-minute session with continuous HR data from one participant is treated as if it never had any participants.

**Fix needed:** Preserve a `_lastKnownGoodRoster` snapshot that autosave and end-save can fall back to when the live roster is empty.

### 2. Validation gates designed for "should I start saving?" applied to "should I keep saving?"

The validation in `PersistenceManager.validateSessionPayload()` conflates two concerns:
- **Start-of-session gates** (session-too-short, insufficient-ticks, no-meaningful-data) — appropriate for preventing noise
- **Ongoing-session gates** (no-participants, roster-required) — catastrophic when applied to a session that WAS valid

A session that has been saving for 30 minutes should NEVER be rejected by `no-participants`. The incremental save should use the last-known-good roster.

### 3. Silent failure accumulation

The combination of:
- Throttled debug counters that don't reset per session
- Swallowed autosave exceptions
- No structured logging for validation failures (only `console.error`)
- No alerting on "session active but 0 saves in last N minutes"

...means data loss is invisible until after the fact.

### 4. Session end doesn't snapshot before teardown

`endSession()` at line 1806 reads `this.summary` (live roster) and at line 1824 calls `this.reset()`. If the roster is already empty at end time, the final save fails and then `reset()` destroys all remaining data.

---

## Data to Reconstruct

The lost session can be partially reconstructed from:

### Available data sources

| Source | Data | Location |
|---|---|---|
| Strava activity | HR stream (per-second), duration, start/end, type | Activity 17624884199 via Strava API |
| Voice memo transcript | Workout description | Backend log at 06:14:50-06:14:52 UTC |
| Prod logs | Session metadata, media events, tick counts | Docker logs |
| Zone profile | HR zone thresholds for kckern | `data/household/apps/fitness/config.yml` or zone profile store |
| Media memory | Plex content played (P90X3 CVX, plex:53324) | `data/household/history/media_memory/plex/14_fitness.yml` |

### Reconstruction script

Existing: `cli/reconstruct-fitness-sessions.mjs` — reads Strava activity archives and rebuilds session YAMLs. Can be run with `--write` to produce files.

### Session details from logs

- Session ID: `20260306053853`
- Date: `2026-03-06`
- Start: `2026-03-06 05:38:53` PST (13:38:53 UTC)
- End: ~`2026-03-06 06:14:04` PST (video ended) or `06:17:48` PST (session ended)
- Duration: ~2111s (35 min)
- Participant: kckern, HR device 40475
- Media: P90X3 CVX (plex:53324 show, specific episode TBD from Plex)
- Strava activity: 17624884199, "Morning Workout", 05:38:58–06:15:32 PST
- Voice memo: "The press jacks at the beginning really got things warmed up. It felt like a pretty intense cardio burn, above average intensity. I used 7.5 pounds for most of the weighted cardio, 10s on a few. The twist moves helped loosen up my back. My hips are still a little inflamed, but overall this was a pretty good cardio burn."

### Reference format

Yesterday's session at `/usr/src/app/data/household/history/fitness/2026-03-05/20260305053724.yml` — v3 format with RLE-encoded series, participants block with strava metadata, timeline events, treasureBox, summary.

---

## Salvage Procedure

### Data sources and what each provides

| Source | What it has | What it lacks |
|---|---|---|
| **Strava API** (activity 17624884199) | Per-second HR stream, start/end timestamps, elapsed_time, device_name, suffer_score, activity type | Zone thresholds, coins, media, voice memo |
| **Fitness session log** (`media/logs/fitness/2026-03-06T02-16-49.jsonl`) | Session start/end, media events (plex:53327 = CVX), tick health checks (every 5 min), voice memo memoId, zone profile config | Raw HR series (not logged per-tick) |
| **Docker logs** (backend) | Voice memo transcript (raw + cleaned), Strava enrichment attempts, media content queries | HR data |
| **Tautulli** | Plex play history with timestamps and rating_keys | HR, zones, coins |
| **Media memory** (`data/household/history/media_memory/plex/14_fitness.yml`) | lastPlayed timestamps for Plex content | HR, zones, coins |

### Key data already extracted from logs

**Session metadata:**
- Session ID: `20260306053853`
- Start: `2026-03-06 05:38:53.000` PST (13:38:53 UTC)
- End: ~`2026-03-06 06:14:04` PST (video ended) or `06:17:48` PST (session ended by empty_roster)
- Participant: kckern, HR device 40475
- Timezone: America/Los_Angeles

**Media:**
- Content: plex:53327 (CVX, P90X3), grandparentId: 53324
- Autoplay started at 13:39:08 UTC
- Video duration: 2094.72s (from `playback.started` log)
- Video ended ~14:14:04 UTC (voice memo capture triggered by `fromFitnessVideoEnd`)

**Voice memo** (from backend docker log at 06:14:50-06:14:52 UTC):
- Raw transcript: "The press jacks at the beginning really got things warmed up. It felt like a pretty intense cardio burn, I think above average intensity. I used 7.5 pounds for most of the weighted cardio, 10s on a few of them. The twist moves I think did a lot of good in loosening up my back. My hips still feeling a little inflamed, but overall this was a pretty good cardio burn."
- Cleaned transcript: "The press jacks at the beginning really got things warmed up. It felt like a pretty intense cardio burn, above average intensity. I used 7.5 pounds for most of the weighted cardio, 10s on a few. The twist moves helped loosen up my back. My hips are still a little inflamed, but overall this was a pretty good cardio burn."
- Duration: ~42.6s (from `recording-upload-complete` durationMs: 42625)
- Memo ID: `memo_1772806492810_nrzfb34ca`

**Health checks** (from fitness session log, every 5 min):

| Time (UTC) | Ticks | Series | Points | Roster | TreasureBox coins |
|---|---|---|---|---|---|
| 13:43:53 | 60 | 20 | 1,240 | 1 | 161 |
| 13:48:53 | 120 | 20 | 2,440 | 1 | 353 |
| 13:53:53 | 180 | 20 | 3,640 | 1 | 494 |
| 13:58:53 | 240 | 20 | 4,840 | 1 | 767 |
| 14:03:53 | 300 | 20 | 6,040 | 1 | 1,002 |
| 14:08:53 | 360 | 20 | 7,240 | 1 | 1,123 |
| 14:13:53 | 420 | 20 | 8,440 | 1 | 1,895 |

**Strava activity** (from enrichment logs):
- Activity ID: 17624884199
- Name: "Morning Workout"
- Start: 2026-03-06T05:38:58-08:00
- End: 2026-03-06T06:15:32-08:00
- Owner: 14872916

### Reconstruction steps

**Step 1: Create Strava archive**

The Strava harvester needs to fetch and archive activity 17624884199. Either:
- Wait for next hourly harvest cycle (it should pick it up since it's within 90 days)
- Or manually trigger: `node cli/reconstruct-fitness-sessions.mjs --write 1`

But the reconstruction script reads from the Strava summary (`strava.yml`), and today's activity isn't in the summary yet because the harvester only adds `homeSessionId`-matched entries. The activity IS in the Strava API but needs to be archived first.

**Preferred approach:** Run the Strava harvester to create the archive, then run the reconstruction script:

```bash
# On prod (inside container):
# 1. Trigger harvest to create archive for today's activity
#    (The hourly cron should do this, or trigger manually via API)

# 2. Run reconstruction script for today
node cli/reconstruct-fitness-sessions.mjs --write 1
```

**Step 2: Enrich the reconstructed session**

After the session YAML exists on disk, re-trigger Strava enrichment:
- The enrichment job for activity 17624884199 already ran 2 attempts and gave up
- Need to either re-queue the job or manually add strava metadata to the session YAML

**Step 3: Add voice memo and media metadata**

The reconstruction script gets HR/zones/coins from Strava and media from Tautulli. But the voice memo transcript needs to be manually added to the session YAML under `timeline.events`:

```yaml
- timestamp: 1772806492810
  type: voice_memo
  data:
    memoId: memo_1772806492810_nrzfb34ca
    transcript: >-
      The press jacks at the beginning really got things warmed up.
      It felt like a pretty intense cardio burn, above average intensity.
      I used 7.5 pounds for most of the weighted cardio, 10s on a few.
      The twist moves helped loosen up my back. My hips are still a
      little inflamed, but overall this was a pretty good cardio burn.
    duration_seconds: 43
    elapsedSeconds: null
    videoTimeSeconds: null
    author: null
```

And the media event:

```yaml
- timestamp: 1772804348001
  type: media
  data:
    contentId: plex:53327
    title: CVX
    grandparentTitle: P90X3
    parentTitle: P90X3
    grandparentId: 53324
    parentId: null
    labels: []
    contentType: episode
    artist: null
    governed: false
    description: null
    durationSeconds: 2095
    start: 1772804348001
    end: 1772806444000
```

### What can't be recovered

- **Per-tick HR series from the frontend** — the 5-second interval HR readings were only in browser memory. The Strava archive has per-second HR which is actually higher resolution, so the reconstructed session will have equivalent or better HR data.
- **Exact zone/coin calculations** — the frontend used real-time hysteresis-based zone transitions. The reconstruction script uses simple threshold-based zones. Coin totals will be close but not identical to what the live session would have produced.
- **TreasureBox bucket breakdown** — the health checks show the total coins at each 5-min mark (last was 1,895). The reconstruction will recalculate from HR data.
- **Governance events, challenge events** — none occurred in this session (solo workout).

### Fitness session log file

The full session log is at:
```
/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/logs/fitness/2026-03-06T02-16-49.jsonl
```

This 14,773-line JSONL file covers from the fitness app mount (02:16:49 UTC, yesterday evening) through today's session end. It contains both sessions on this PersistenceManager instance. Key event types for reconstruction:

- `fitness.session.started` / `fitness.session.buffer.threshold_met` — session start
- `fitness.tick_timer.health` — 5-minute health snapshots with tick/series/point counts
- `fitness.media_start.autoplay` — media content started
- `playback.started` / `playback.video-ready` — media metadata (title, grandparentTitle, duration)
- `playback.voice-memo` — voice memo lifecycle events
- `fitness.zone_led.activated` — zone LED changes (can reconstruct zone transitions)
- `treasurebox.record_heart_rate` — individual HR readings with zone assignments (sampled/aggregated)

---

## Fix Plan

### Immediate (prevent future data loss)

1. **Preserve last-known-good roster snapshot**
   - In `FitnessSession`, maintain `_lastKnownGoodRoster` updated on every successful tick where roster is non-empty
   - `summary` getter falls back to `_lastKnownGoodRoster` when live roster is empty
   - Same for `deviceAssignments`

2. **Reset debug counters per session**
   - In `PersistenceManager`, add a `resetDebugCounters()` method
   - Call it from `FitnessSession.startSession()` alongside `_lastAutosaveAt = 0`

3. **Un-swallow autosave errors**
   - Uncomment the `console.error` in `_startAutosaveTimer` catch block
   - Better: use structured logger so it's visible in prod logs

4. **Remove `no-participants` as a hard gate for incremental saves**
   - Move to a "first save requires roster; subsequent saves use last-known-good" model
   - The `force: true` path at session end should bypass roster validation entirely

### Backfill (recover today's data)

5. **Run reconstruction script** for today's session using Strava HR data
6. **Re-trigger Strava enrichment** after session file is written

### Hardening (prevent silent failures)

7. **Add "save health" monitoring** — if session is active for > 5 minutes with zero successful saves, emit a warning-level structured log
8. **Add `_lastSuccessfulSaveAt` tracking** — visible in tick_timer.health logs
9. **Log validation failures at warn level via structured logger** (not just throttled console.error)

---

## Files to Modify

| File | Changes |
|---|---|
| `frontend/src/hooks/fitness/FitnessSession.js` | Add `_lastKnownGoodRoster`, update on tick, fallback in `summary` getter. Un-swallow autosave errors. Reset PM counters on session start. |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Add `resetDebugCounters()`. Remove hard `no-participants` gate for sessions with prior saves. Add structured logging for validation failures. |
| Backend: session reconstruction | Run `cli/reconstruct-fitness-sessions.mjs` or manual YAML write for today's session |
| Backend: Strava re-enrichment | Re-trigger enrichment job for activity 17624884199 after session file exists |
