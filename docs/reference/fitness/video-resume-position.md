# Video Resume Position — Recovery Pipeline Reference

How the fitness media player preserves and restores video playback position during stalls, and the fixes applied after a critical position-loss incident on 2026-03-07.

**Key file:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`

---

## Problem Context

Fitness sessions use long videos (up to ~5 hours) that users watch across multiple sessions. The player must resume at the saved position and maintain it through any buffering stalls. DASH streaming (via dash.js) adds complexity — the DASH player manages its own SourceBuffer and manifest state independently of the HTML5 `<video>` element.

When a stall occurs mid-playback, the recovery pipeline attempts increasingly aggressive strategies to restore playback. If any strategy corrupts the position state, the user loses their place in a multi-hour recording.

---

## Recovery Pipeline

Stall recovery escalates through four strategies in order:

```
Stall detected
    ↓
1. nudge  — pause, seek back 0.001s, play
    ↓ (fails)
2. seekback — seek back N seconds (configurable)
    ↓ (fails)
3. reload — tear down and reload the media source
    ↓ (fails)
4. softReinit — React remount via elementKey increment
```

Each strategy has a max-attempts limit. Failure means escalation to the next.

### Strategy Details

| Strategy | Mechanism | Risk |
|----------|-----------|------|
| `nudge` | `mediaEl.currentTime -= 0.001; play()` | Death loop if buffer is empty at current position |
| `seekback` | `mediaEl.currentTime -= seekBackSeconds` | May land in another empty buffer zone |
| `reload` | Remove `src`, `load()`, reattach, seek | Destroys DASH SourceBuffer/manifest state |
| `softReinit` | `setElementKey(prev + 1)` (React remount) | New hook instance loses refs; start-time guard may block |

---

## Bugs Fixed (2026-03-07)

These fixes were identified by auditing a session where 13 minutes of playback were lost during stall recovery on a 4.6-hour video. See `docs/_wip/audits/2026-03-07-video-resume-position-loss-audit.md` for the full timeline.

### 1. `__appliedStartByKey` blocking remount start time (P0)

**Commit:** `52862fe8`

`softReinit` increments `elementKey` to force a React remount, but the static guard `__appliedStartByKey[assetId]` persisted from the original load. The new component instance saw the guard as `true` and skipped applying the start time, causing playback from t=0.

**Fix:** Delete `__appliedStartByKey[assetId]` inside `softReinit` before the remount, so the new instance re-applies the resume position.

### 2. Seek intent cleared before confirmation (P0)

**Commit:** `ec7b440c`

`reloadRecovery` cleared `lastSeekIntentRef.current = null` immediately after `mediaEl.currentTime = target`. For DASH streams, this assignment can silently fail (SourceBuffer not ready). If the next recovery cycle fires, there's no position fallback.

**Fix:** Only clear `lastSeekIntentRef` after a `seeked` event confirms the position. A 5-second timeout preserves the seek intent if `seeked` never fires.

### 3. Nudge death loop on empty buffer (P1)

**Commit:** `8b911470`

Nudging back by 0.001s when the buffer is empty at the current position creates an infinite loop (6+ cycles observed: `4876.909 → 4876.908 → 4876.907 → ...`). The stall re-detects after each nudge, and the cycle repeats.

**Fix:** Check `mediaEl.buffered` ranges before nudging. If `currentTime` is outside all buffered ranges, return `false` immediately so the pipeline escalates to the next strategy.

### 4. Reload destroys DASH state (P1)

**Commit:** `6dfc9747`

`removeAttribute('src') + load()` destroys the DASH player's SourceBuffer and manifest state. The 50ms `setTimeout` before reattaching is a race condition — if DASH hasn't fully torn down, re-initialization fails, and `duration` becomes `null`.

**Fix:** For DASH streams, use `dashjsPlayer.reset()` + `dashjsPlayer.initialize()` instead of raw DOM manipulation. Falls back to DOM-based reload for non-DASH sources.

### 5. Position watchdog (P2)

**Commit:** `aba10bda`

No code verified that a recovery seek landed at the expected position. A stall was observed at `currentTime=9533s` (2h38m) — completely wrong vs the expected ~4876s (~81min). The DASH player seeked to the wrong segment boundary.

**Fix:** A watchdog fires 2 seconds after recovery completion. If `|currentTime - expectedTime| > 30s`, it seeks to the expected position. Wired into both `reloadRecovery` and `softReinit` completion paths.

### 6. Duration loss escalation (P2)

**Commit:** `503a1108`

When `duration` becomes `null`/`NaN`, the media source is broken. Nudge and seekback strategies cannot help a broken source, but the pipeline continued trying them anyway, wasting time.

**Fix:** In the stall detection hard timer, check `Number.isFinite(mediaEl.duration)` before calling `attemptRecovery()`. If duration is lost, escalate directly to `softReinit`.

### 7. `__appliedStartByKey` blocking resilience remount start time (P0)

**Commit:** `bdbf08ba`

The P0 fix (item 1) only cleared `__appliedStartByKey` in `softReinit`. The resilience recovery system (`useMediaResilience.js`) triggers a different remount path via `Player.jsx:forceSinglePlayerRemount` → `remountState.nonce++`. This remount didn't clear the guard, causing the same position-loss symptom.

**Fix:** Changed `__appliedStartByKey` from a boolean to a per-mount-instance Symbol. Each hook instance creates `mountIdRef = useRef(Symbol('mount'))`. The guard check compares `__appliedStartByKey[assetId] === mountIdRef.current` instead of a truthy check, so new mounts (regardless of which path created them) always get a chance to apply start time. The `softReinit` delete still works as before (clears the entry entirely).

### 8. Seek event log spam and stale drift (P2)

**Commits:** `4a621624`, `755ffa07`

The `clearSeeking` handler fired on both `seeked` and `playing` events, and DASH streams fire multiple `seeked` events per seek (audio+video tracks). This produced ~30 duplicate `playback.seek` log entries per seek. Additionally, `lastSeekIntentRef` was never cleared after start-time application, causing growing fake "drift" values (104s, 707s) in subsequent seek logs.

**Fix:** Added 200ms debounce to `clearSeeking` to collapse burst events into one log entry. Added `lastSeekIntentRef.current = null` after both DASH deferred and non-DASH direct start-time application paths.

---

## Failure Chain (Pre-Fix)

The 2026-03-07 incident followed this cascade:

```
Normal playback at ~4876s (81 min into a 4.6-hour video)
    ↓ buffer exhaustion at segment boundary
Nudge × 6 (0.001s back each — ineffective, empty buffer)
    ↓ max attempts exceeded
Seekback (5s back — still in empty buffer zone)
    ↓ no progress
Reload (src removal + reattach)
    ↓ DASH SourceBuffer destroyed
duration → null, currentTime → 0
    ↓ nudge/seekback tried again (useless with null duration)
softReinit (React remount)
    ↓ __appliedStartByKey blocks start time
Starts playing from t=0 (beginning of 4.6-hour video)
    ↓ sticky-resume eventually fires
Seeks to ~4935s (stale value from corrupted recovery)
    ↓ stall at wrong position
2nd reload cycle → position lost again → t=0
    ↓ 3rd reload
Finally recovers to ~4912s after 13 minutes total
```

---

## Diagnostic Logging

**Commit:** `b82a0d78` added structured position diagnostics to the media controller.

Key log events during recovery:

| Event | Fields | When |
|-------|--------|------|
| `[Stall Recovery] nudge: currentTime not in any buffered range` | `t`, `ranges` | Nudge skipped (buffer-aware) |
| `[Stall Recovery] reload: begin` | `priorTime`, `intent`, `hasDash` | Reload starting |
| `[Stall Recovery] reload: seeked confirmed` | `currentTime` | Seek verified after reload |
| `[Stall Recovery] reload: seeked timeout` | — | 5s timeout, seek not confirmed |
| `[Stall Recovery] duration lost, escalating to softReinit` | — | Duration null/NaN detected |
| `[Stall Recovery] position watchdog: drift detected` | `expected`, `actual`, `drift` | Post-recovery position wrong |

---

## Key Refs and State

| Ref / State | Purpose |
|-------------|---------|
| `lastSeekIntentRef` | Position safety net — target time for the next seek attempt |
| `lastPlaybackPosRef` | Last known good playback position |
| `isRecoveringRef` | Whether a recovery strategy is in progress |
| `__appliedStartByKey[assetId]` | Static guard: Symbol of the mount instance that applied start time (per-instance, not boolean) |
| `mountIdRef` | Per-instance Symbol that identifies this hook mount — used to scope `__appliedStartByKey` |
| `__lastSeekByKey[assetId]` | Static: last seek target for sticky-resume fallback |
| `recoverySnapshotRef` | Snapshot of position/state for softReinit to restore |
| `stallStateRef` | Stall detection state machine (attempt counts, pending flags) |

---

## Related Documents

| Document | Relevance |
|----------|-----------|
| `docs/_wip/audits/2026-03-07-video-resume-position-loss-audit.md` | Full incident timeline and root cause analysis |
| `docs/plans/2026-03-07-video-resume-position-loss-fix.md` | Implementation plan (6 tasks) |
| `docs/_wip/audits/2026-02-27-video-playback-failure-audit.md` | Earlier audit: `seeked` at t=0 terminal state, SourceBuffer orphans |
| `docs/_wip/audits/2026-03-05-media-player-ux-design-audit.md` | Infinite seek-retry loop (200+ retries) |
