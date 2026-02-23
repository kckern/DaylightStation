# Fitness Session Silent Failures Audit

**Date:** 2026-02-23
**Scope:** Voice memo persistence, watchTime tracking, media event timestamps, governance log spam
**Trigger:** Audit of session `20260217124549` (Feb 17) revealed `voiceMemos: []` and `watchTime: 0` despite active usage; prod logs confirmed ongoing silent failures

---

## Executive Summary

Four interrelated silent failures affect fitness session data quality:

1. **Voice memos never persist** — recorded and uploaded, but dropped during event consolidation; zero audio files on disk
2. **watchTime always zero since ~Jan 29** — play router expects `watched_duration` param the frontend never sends
3. **Media event timestamps sourced from Plex `lastPlayed`** — records end-of-playback time, not start
4. **Governance warn floods logs (46K+ lines)** — `media_not_governed` fires on every 5s tick, not rate-limited

---

## Issue 1: Voice Memos — Complete Data Loss

### Severity: **Critical** — every voice memo since launch is lost

### Evidence

- All saved sessions (Feb 14–17) have `voiceMemos: []`
- Current live session (Feb 23) shows `voiceMemoCount: 2` in `fitness-profile` samples
- Full lifecycle completes in logs: `memo-add-request` → `memo-added` → `recording-upload-complete` → `overlay-accept`
- **Zero voice memo audio files on disk** (`find` returned nothing)
- `recording-upload-complete` has `memoId: null` — upload finishes but ID isn't linked

### Root Cause

The event consolidation pipeline drops voice memos with no replacement:

1. `VoiceMemoManager.addMemo()` logs a `voice_memo_start` event to the timeline
   **File:** `frontend/src/hooks/fitness/VoiceMemoManager.js:55`

2. `_consolidateEvents()` **drops all `voice_memo_start` events**:
   ```javascript
   if (type === 'voice_memo_start') continue;  // Line 310
   ```
   **File:** `frontend/src/hooks/fitness/PersistenceManager.js:310`
   Comment says: *"voice_memo_start dropped (voice_memo is the consolidated version)"*

3. **But nothing ever creates a consolidated `voice_memo` event.** The consolidation pairs `challenge_start`+`challenge_end` and `media_start`+`media_end`, but there is no `voice_memo_end` event and no consolidation logic for voice memos.

4. The orphan-merge fallback (lines 773–795) reads `sessionData.voiceMemos`, but `voice_memo_start` was already dropped from the timeline and the `voiceMemos` array from VoiceMemoManager may not be populated in the session data passed to the persistence layer.

5. Line 827: `delete persistSessionData.voiceMemos` removes the last reference.

**Result:** Voice memos enter the pipeline via `voice_memo_start`, get dropped by consolidation, and the fallback merge has nothing to recover.

### Fix Recommendation

**Option A (minimal):** Don't drop `voice_memo_start` in consolidation — pass it through as-is:

```javascript
// PersistenceManager.js:310 — REMOVE this line:
if (type === 'voice_memo_start') continue;
```

Then update `SessionSerializerV3.js:147` (already handles both types):
```javascript
} else if (type === 'voice_memo_start' || type === 'voice_memo') {
```

**Option B (proper):** Add a `voice_memo_end` event when recording completes and consolidate the pair like challenges/media. This would give accurate start/end timestamps and duration.

**Also needed:** Fix the audio file persistence — `recording-upload-complete` fires with `memoId: null` and no files land on disk. The upload endpoint or blob storage path needs investigation.

---

## Issue 2: watchTime Always Zero Since ~Late January

### Severity: **High** — cumulative watch analytics broken for ~4 weeks

### Evidence

| Media Entry | playCount | percent | watchTime | lastPlayed |
|-------------|-----------|---------|-----------|------------|
| plex:11048 | 112 | 42% | 64167.809 | 2026-01-09 |
| plex:11043 | 17 | 5% | 1563.9 | 2026-01-08 |
| plex:11260 | 120 | 87% | **0** | 2026-01-29 |
| plex:11282 | 125 | 83% | **0** | 2026-01-30 |
| plex:599485 | 75 | 100% | **0** | 2026-02-17 |

55 entries in `plex/14_fitness.yml` have `watchTime: 0`. The breakpoint is ~Jan 29.

### Root Cause

Two different code paths handle media progress, with different watchTime logic:

**Content router** (`backend/src/4_api/v1/routers/content.mjs:175`):
```javascript
watchTime: (existing?.watchTime || 0) + Math.max(0, seconds - (existing?.playhead || 0))
```
Auto-calculates delta from playhead movement. **This path works.**

**Play router** (`backend/src/4_api/v1/routers/play.mjs:96`):
```javascript
const sessionWatchTime = Number.isFinite(watched_duration) ? parseFloat(watched_duration) : 0;
```
Requires explicit `watched_duration` parameter in request body. **The frontend never sends this field.**

The fitness player posts to `/api/v1/play/log` (play router) with:
```javascript
// FitnessPlayer.jsx:817-827
{ title, type, assetId, seconds, percent, status, naturalEnd, duration, reason }
```
No `watched_duration` field. `Number.isFinite(undefined)` = `false`, so `sessionWatchTime` = 0, and watchTime never grows.

The switchover to the play router around late January broke watchTime accumulation.

### Secondary Issue: playCount Inflation

The play router increments `playCount` on **every progress update call** (line 111):
```javascript
playCount: (existingState?.playCount ?? 0) + 1
```
A 739s video with 10s update intervals generates ~74 progress calls = playCount of 75. This should be per-session, not per-update.

### Fix Recommendation

**Option A (minimal — frontend sends watchTime):**

In `FitnessPlayer.jsx`, track cumulative watch time and send it:
```javascript
await DaylightAPI('api/v1/play/log', {
  ...payload,
  watched_duration: cumulativeWatchSeconds  // Add this
}, 'POST');
```

**Option B (backend auto-calculates like content router):**

In `play.mjs:95-98`, use the same delta formula as the content router when `watched_duration` is missing:
```javascript
const sessionWatchTime = Number.isFinite(watched_duration)
  ? parseFloat(watched_duration)
  : Math.max(0, normalizedSeconds - (existingState?.playhead || 0));
```

**Option B is preferred** — it's backward-compatible and doesn't require frontend changes.

**playCount fix:** Only increment when the playhead resets or on first call per asset:
```javascript
const isNewSession = !existingState || normalizedSeconds < (existingState.playhead || 0);
playCount: (existingState?.playCount ?? 0) + (isNewSession ? 1 : 0)
```

### Backfill

The `watchTime: 0` entries from Jan 29 onward need backfill. Sessions since then have accurate `playhead` and `duration` data. A script could compute `watchTime = playhead` for entries at 100%, or estimate from `playhead / duration * estimatedDuration` for partial plays. Alternatively, re-derive from session history YAML files which have full timeline data.

---

## Issue 3: Media Event Timestamp from Plex `lastPlayed`

### Severity: **Low** — `offsetMs` is correct; only absolute timestamp is wrong

### Evidence

Session `20260217124549`:
- `media_start` event: `timestamp: 1771361920000` = **12:58:40 PST**
- Session start: **12:45:49 PST**
- `offsetMs: 0` (correct — media started at session beginning)
- `plex:599485.lastPlayed` in media_memory: `'2026-02-17 12:58:40'` — **exact match**

The event's Unix timestamp matches Plex's `lastPlayed` field (end of playback), not the actual media start time.

### Root Cause

`FitnessTimeline.logEvent()` uses `Date.now()` as the default timestamp (`FitnessTimeline.js:105`):
```javascript
logEvent(type, data = {}, timestamp = Date.now())
```

This is correct for events logged in real-time. However, the `media_start` event logged at `FitnessPlayer.jsx:1015` fires when playback begins. The discrepancy suggests the media_start event is not being logged at the actual start of playback, but rather reconstructed or backfilled from Plex data after playback completes.

### Fix Recommendation

Verify that `session.logEvent('media_start', ...)` is called synchronously when the video starts playing (in the `onPlay` handler), not in a deferred callback or Plex webhook. If it's called at the right time, `Date.now()` will be correct.

---

## Issue 4: Governance `media_not_governed` Log Spam

### Severity: **Medium** — 46,854 warn lines polluting logs; no functional impact

### Evidence

```
docker logs daylight-station 2>&1 | grep -c "governance.evaluate.media_not_governed"
# → 46854
```

Fires every ~1-2 seconds for `mediaId: 674375`. `governancePhase` stuck at `"pending"` across all profile samples.

### Root Cause

1. `GovernanceEngine.evaluate()` runs on every tick pulse (~5s) and on every zone/state change
   **File:** `GovernanceEngine.js:789`

2. When `_mediaIsGoverned()` returns false, it emits a raw `getLogger().warn()` — **NOT rate-limited**
   **File:** `GovernanceEngine.js:1347`

3. Other governance warnings in the same file use `logger.sampled()` for rate-limiting (e.g., zone changes at line 301). This one does not.

4. The tick timer restart/stop cycle (~every 4-6 seconds) triggers evaluate() multiple times per cycle, amplifying the spam.

### Fix Recommendation

Use `logger.sampled()` like other governance warnings:
```javascript
// GovernanceEngine.js:1347 — CHANGE FROM:
getLogger().warn('governance.evaluate.media_not_governed', { mediaId: this.media?.id });

// TO:
getLogger().sampled('governance.evaluate.media_not_governed', {
  mediaId: this.media?.id
}, { maxPerMinute: 2, aggregate: true });
```

Apply the same fix to `governance.evaluate.no_media_or_rules` (line 1337) and `governance.evaluate.no_participants` (line 1360).

---

## Cross-Reference: Feb 17 Session Data Integrity

All internal data consistency checks **passed** for `20260217124549.yml`:

| Check | Status |
|-------|--------|
| Duration (912s) matches start/end timestamps | Pass |
| Tick count (183) × interval (5s) ≈ duration | Pass (915 vs 912, 3s rounding) |
| HR min/max (68/152) match series data | Pass |
| Zone classifications match HR thresholds (cool <100, active 100-119, warm 120-139, hot ≥140) | Pass (all 183 ticks verified) |
| Zone minutes match tick counts | Pass |
| Coin accumulation matches zone rewards (cool=0, active=1, warm=2, hot=3 per tick) | Pass |
| Bucket sum (0+83+70+18+0) = totalCoins (171) | Pass |
| kckern:coins = global:coins (single participant) | Pass |

---

## Files Referenced

| File | Lines | Issue |
|------|-------|-------|
| `frontend/src/hooks/fitness/VoiceMemoManager.js` | 50-68 | Logs `voice_memo_start` |
| `frontend/src/hooks/fitness/PersistenceManager.js` | 310, 773-827 | Drops `voice_memo_start`, orphan merge, deletes `voiceMemos` |
| `frontend/src/hooks/fitness/SessionSerializerV3.js` | 147-155, 209-217 | Serializes voice memo events (if they exist) |
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | 817-827 | Play log POST missing `watched_duration` |
| `backend/src/4_api/v1/routers/play.mjs` | 95-98, 111 | watchTime requires param; playCount inflated |
| `backend/src/4_api/v1/routers/content.mjs` | 175 | Working watchTime auto-calculation (reference) |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | 789, 1347-1349 | evaluate() on every tick; warn not sampled |
| `frontend/src/hooks/fitness/FitnessTimeline.js` | 105 | Event timestamp = Date.now() |

---

## Priority Order

1. **Voice memo persistence** — active data loss on every session
2. **watchTime accumulation** — 4 weeks of broken analytics, needs backfill
3. **Governance log spam** — 46K lines, easy one-line fix
4. **Event timestamp** — cosmetic, offsetMs is correct
5. **playCount inflation** — lower priority, but easy to fix alongside watchTime
