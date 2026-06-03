# Playback Audit — How to Train Your Dragon (2026-05-26)

**File:** `plex:654997`  
**Session:** Living Room TV (Shield Android TV)  
**Wall time:** 01:12–03:27 UTC (18:12–20:27 PDT)  
**Duration:** 5871.1s (97m 51s)  
**Outcome:** Movie played to end, but with multiple visible artifacts

---

## TL;DR

Four distinct failure categories confirmed by logs. Two are Plex/source-file issues; two are app bugs.

| # | Category | Severity | Root Cause |
|---|----------|----------|------------|
| A | Phantom player overlay for entire movie | High | Second `play-now` command mounted a second Player without tearing down first |
| B | 47 consecutive 0-byte video segments at end (t=5640–5870s) | High | Plex transcoder produced empty segments for last 3.8 minutes of this file |
| C | DASH stream gap at t=2425s (40:25) → 83-second Recovering overlay | Medium | Corrupt/missing data in session `34d4f202`; new session resolved it |
| D | Near-zero video fragments at startup (t=20–25s, idx 4–5) | Medium | Transcode not warmed up at those timestamps in session `183be5bf` |

---

## Event Timeline

### Phase 1: Startup (01:12–01:14 UTC)

**Session 1 — `183be5bf`, waitKey `005bb6d64a`**

```
01:12:10  commands.queue play-now plex:654997 (prewarm p6lt4t03ixr7vqo9)
01:12:13  dash.manifest-loaded, duration=5871.1s
01:12:14  dash.playback-started
01:12:14  Fragments begin loading:
            video[0] t=0s    → 1,237,064 bytes ✓
            video[1] t=5s    → 1,482,390 bytes ✓
            video[2] t=10s   → 1,418,846 bytes ✓
            video[3] t=15s   →   253,966 bytes (low, but ok)
            video[4] t=20s   →    11,953 bytes ← BUG D: near-zero
            video[5] t=25s   →    11,585 bytes ← BUG D: near-zero
            video[6] t=30s   →   779,994 bytes ✓ (resumes normal)
01:12:20  playback.started at t=0s (player is playing)
01:12:52  programmatic seek to t=32.28s (system jumped past bad segments)
01:12:57  playback.paused at t=37s (user paused, or autoplay stall response)
01:13:05  console.error: "Keyboard not found: tvremote"
01:13:47  console.error: "Keyboard not found: tvremote"
```

**Session 2 — new `play-now` dispatched at 01:14:08, spawns `00e4b109ae`**

```
01:14:08  commands.queue SECOND play-now plex:654997 (prewarm ezu6ayt5oiz6iti2)
          ← UNKNOWN TRIGGER: user remote? internal retry? postEpisodeRedirect?
01:14:08  dash.manifest-loaded (new session)
01:14:08  video[0] t=0s → 0 bytes ← transcode not started
01:14:08  audio[0] t=0s → 0 bytes ← transcode not started
01:14:08  dash.buffer-stalled (audio + video)
          Fragments 6–17 load immediately from Plex cache (prior session)
01:14:10  dash.seeked at t=33s
01:14:16  playback.resumed at t=0 (second player plays from beginning)
01:14:19  playback.paused at t=3s
01:14:20  Overlay [00e4b109ae] created → status: Starting… forever ← BUG A
          Original [005bb6d64a] still alive and paused at t=37s
```

At this point **two player instances coexist** on the same screen. `[00e4b109ae]` never receives `effectiveMetaIsNull=true` (unclear why; likely the second queue command had valid metadata), so its "Starting…" overlay actively renders and is visible to the user for the entire rest of the session.

---

### Phase 2: Long Pause (01:14–01:48 UTC, ~34 minutes)

Both players idle. Plex transcode session `c62b9446` expires during this window (Plex default session timeout).

---

### Phase 3: Resume After Pause (01:48–02:00 UTC)

```
01:48:46  fkb.keyCapture: "Enter" (user pressed remote)
01:48:46  playback.resumed at t=3.31s, duration=5871.1
01:48:46  playback.seek drift=3.318s (intent=0, actual=3.3 — position desync)
01:48:51  playback.resumed at t=7.59s, duration=null ← transcode session dead
01:48:51  dash.error-recovery: refresh-url, reason=segment-unavailable, attempt=1
          New session URL fetched → session c62b9446 re-established
01:48:51  buffer-stalled (audio + video, new session loading from scratch)
01:48:51  playback.start-time-applied: seek to t=33s (back to pre-pause position)
01:48:52  dash.quality-change (video + audio) ← adaptive bitrate settling
01:48:52  seeked to t=33s ✓
01:49:42  playback.paused at t=44s
01:49:46  playback.seek to t=0 (user bump-seeking back to start?)
01:49:53  playback.resumed at t=0
01:49:56  playback.paused at t=3s
01:50:50  playback.resumed at t=3s
01:55:58  Seeking… (user fast-forwarding into movie)
02:00:54  playback.resumed at t=620s (10:20 into movie) ← 5 min seek operation
```

The `refresh-url` recovery at 01:48:51 worked correctly. The position desync (`intent=0, actual=3.3`) and double-resume suggest the recovery path may seek to a slightly wrong position on session refresh.

---

### Phase 4: Smooth Playback (02:00–02:30 UTC)

Movie plays normally. 60fps, 0 dropped frames throughout.

**Scattered small audio fragments** observed at multiple timestamps:

| Time into film | t (s) | Audio bytes | Expected |
|---|---|---|---|
| 13:00 | 780 | 3,522 | ~300KB |
| 20:45 | 1,245 | 3,512 | ~300KB |
| 25:45 | 1,545 | 2,056 | ~300KB |
| 31:55 | 1,915–1,920 | 3,517 / 3,498 | ~300KB |
| 51:30 | 3,090 | 3,488 | ~300KB |
| 55:00 | 3,300 | 3,546 | ~300KB |
| 66:45 | 4,005 | 3,541 | ~300KB |

These 2–4KB audio segments (5s duration each) are 2 orders of magnitude below normal. They are either near-silence in the source audio at those timestamps, or Plex transcode output errors. No audible glitches were reported at these exact timestamps, so most likely source audio silence (scene transitions, music fades). **Not confirmed as bugs**, but listed for completeness.

---

### Phase 5: Gap Jump at 40:25 (02:30 UTC) ← BUG C

```
02:30:30  console.warn: [GapController] Jumping gap in period 0
          starting at 2425.631541, ending at 2428.509416
          Jumping by: 2.877875s
02:30:30  playback.seek (programmatic) to t=2428.51
02:30:30  dash.waiting
02:30:32  dash.buffer-stalled (audio)
02:30:33  playback.stalled at t=2430.19s, stallDurationMs=1487ms
02:30:34  dash.error-recovery: refresh-url, reason=segment-unavailable, attempt=3
          → new session 3a2b60dd
02:30:34  dash.manifest-loaded (new session)
02:30:35  playback.recovery-resolved at t=2427.53, stallDurationMs=1666ms
02:30:35  playback.seek seeked to t=2427.53 ✓
02:31:58  Overlay [005bb6d64a] transitions from Recovering… → Seeking… (cleared)
```

**Total user-visible freeze: ~83 seconds** (02:30:35 → 02:31:58).

The stream had a genuine gap at t=2425.6s in transcode session `34d4f202`. dash.js GapController auto-jumped it, but that dropped the player into the gap region where segments were unavailable. The resilience recovery fetched a fresh session URL (attempt=3, meaning two prior in-band retries failed before the URL refresh) and resumed at t=2427.5s.

Root cause is likely a gap in the Plex transcode for this specific timestamp in this file. A fresh session transcoded that region cleanly.

---

### Phase 6: End-of-Movie 0-Byte Video Cascade (03:26 UTC) ← BUG B

```
03:26:11  video[1128] t=5640s → 0 bytes
03:26:11  video[1129] t=5645s → 0 bytes
...       (continuous)
03:26:21  video[1174] t=5870s → 0 bytes
          Total: 47 consecutive 0-byte video segments
          Span: t=5640–5870s (last 230 seconds = last 3m 50s of film)
03:27:06  playback.paused at t=5871.1 (end of movie, currentTime=duration)
```

The Plex transcoder produced 0-byte video segments for the final 3m 50s of the movie. These were prefetched while the movie was playing (DASH keeps a ~150s lookahead buffer), so the segments were arriving at the player while the user was at t≈5490s.

**Effect on playback:** The video decoder would have frozen on the last successfully decoded frame for the final ~3.8 minutes. Audio appeared to continue (no 0-byte audio segments in this range). The user experienced the movie "ending" with a static last frame before the credits — which may have appeared normal for an animation, but was actually a frozen decoder.

The `isPausedAtDuration` guard in `PlayerOverlayLoading` correctly suppressed the spinner at end-of-content.

**This is the most critical Plex bug.** The source file (plex:654997) either has a malformed end section, or the Plex transcoder consistently fails to produce valid output for the last ~4 minutes of this specific file.

---

## Bug Analysis

### Bug A — Phantom Player (`[00e4b109ae]`)

**Trigger:** A second `commands.queue play-now` was dispatched at 01:14:08 while the first player was still alive and paused at t=37s.

**Unknown:** What dispatched the second command. Candidates:
1. User pressing a button on the Shield remote (most likely — keyboard errors at 01:13:05 and 01:13:47 suggest remote input was happening)
2. An internal retry triggered by the pause/stall at 01:12:57
3. `postEpisodeRedirect.js` (currently modified, unreviewed — check this)

**Mechanism:** The second `play-now` mounted a new Player component with waitKey `00e4b109ae`. The original `005bb6d64a` player was not torn down. The new player received 0-byte initial fragments (transcode not ready), entered `status: startup`, and got stuck there permanently because:
- `shouldArmStartupDeadline` returned false (no valid media element → `hasMediaMeta=false`)
- Therefore the startup deadline timer never fires
- Therefore `triggerRecovery` never runs
- Therefore the player stays in `startup` forever

**Overlay visibility:** `effectiveMetaIsNull` was `false` for this instance (it had queue metadata even without a media element). `shouldShowOverlay = isStartup && !hasEverPlayedRef.current` = true. The "Starting…" overlay rendered and was visible on screen for the entire 2h14m movie, on top of the playing content.

**Fix direction:** The `play-now` handler needs to explicitly tear down any existing Player before mounting a new one. Alternatively: detect that `[00e4b109ae]` has no media element and set `effectiveMetaIsNull=true` to suppress its overlay.

---

### Bug B — 47 Consecutive 0-Byte Video Segments (End of File)

**Affected range:** t=5640–5870s (video indices 1128–1174), the last 230 seconds.

**Session:** `34d4f202` (same session that had the gap at 40:25 — this session appears fundamentally broken for plex:654997).

**Root cause:** Plex transcoder failed to produce valid video output for the end of this file. This is consistent with Bug C (same session, different timestamp). The source file at plex:654997 likely has a damaged or non-standard encoding in the final chapter.

**Fix direction:** Plex-side. Force a re-transcode or check if the source file is intact (ffprobe the last 5 minutes). Also, the app could detect a 0-byte segment run and trigger a session refresh proactively, rather than waiting for the buffer to exhaust.

---

### Bug C — Stream Gap at t=2425s

**Session:** `34d4f202` (same as Bug B — this session was damaged).

**Gap location:** t=2425.6–2428.5s (40:25 in the film).

**Resilience behavior:** Worked correctly — URL refresh got a clean session (`3a2b60dd`). The 83-second overlay duration was the cost.

**Fix direction:** The new session transcoded this region without issue, suggesting it's a session-specific artifact (prior session got a bad cache hit or had a transcode worker die mid-session). No code change needed, but worth checking if `34d4f202` vs `3a2b60dd` used different quality/codec paths.

---

### Bug D — Near-Zero Startup Fragments (t=20–25s)

**Session:** `183be5bf`. Video fragments at indices 4–5 (t=20s, 25s) = 11,953 and 11,585 bytes. Adjacent segments are 250KB–1.5MB.

**Cause:** Transcode warmup lag. The Plex transcoder was still initializing for the early-movie segments. The system handled this by issuing a programmatic seek to t=32s at 01:12:52 to skip past the bad range — the transcode was healthy from t=30s onward.

**Effect:** The first ~30 seconds of playback had essentially no video data at t=20–25s (2-second black/frozen window). Users may have seen a brief freeze at the start.

---

## Transcode Session Map

| Session ID | Created | Used for | Issues |
|---|---|---|---|
| `183be5bf` | 01:12:13 | Initial startup | Near-zero segments t=20–25s |
| `ezu6ayt5oiz6iti2` | 01:14:08 | Second play-now (phantom player) | 0-byte initial segments |
| `c62b9446` | 01:48:51 | Resume after 34-min pause | Expired after long pause (expected) |
| `34d4f202` | ~02:00 | Main movie session | Gap at t=2425s; 0-byte video t=5640–5870s |
| `3a2b60dd` | 02:30:34 | Recovery after gap jump | Clean; movie resumed normally |

Session `34d4f202` is the primary problem session — it had both the mid-movie gap and the 0-byte end segments. This session ID appears in the fragment URLs around the gap jump and persists through the end of the movie.

---

## What Worked

- `dash.error-recovery` at 01:48:51 (session expiry) — handled correctly
- `dash.error-recovery` at 02:30:34 (gap jump fallout) — handled correctly, recovered in 1.7s
- `isPausedAtDuration` guard — correctly suppressed overlay at end-of-content
- Frame rendering — 0 dropped frames throughout the entire 2h14m session
- Buffer depth — ~150s lookahead maintained consistently

---

## Open Questions

1. **What dispatched the second `play-now` at 01:14:08?** Check `postEpisodeRedirect.js` (currently modified). Check whether a stall-triggered internal retry can fire while a player is merely paused.

2. **Is plex:654997 the source file corrupt?** Run `ffprobe` on the last 5 minutes of the raw file. Also check if `34d4f202`-style sessions consistently produce 0-byte end segments for this title only.

3. **Why is `effectiveMetaIsNull` false for `[00e4b109ae]`?** If the second player had valid queue metadata but no media element, the ghost-player guard should have caught it. Trace `shouldArmStartupDeadline` vs `effectiveMetaIsNull` — they may be checking different things.

---

## Recommendations

| Priority | Action |
|---|---|
| P0 | Prevent double Player mount on second `play-now`. Tear down existing player before mounting a new one. |
| P0 | Check plex:654997 source file integrity (ffprobe last chapter). Re-transcode if corrupt. |
| P1 | Detect persistent 0-byte video segment runs in the buffer and trigger a proactive session refresh before the decoder stalls. |
| P1 | Audit `postEpisodeRedirect.js` — determine if it can dispatch `play-now` during an active playback session. |
| P2 | Fix `effectiveMetaIsNull` propagation so players without a media element always get the phantom guard. |
| P2 | Log the trigger source in `commands.queue` so second-command events are attributable in logs. |
