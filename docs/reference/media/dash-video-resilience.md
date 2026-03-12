# DASH Video Resilience

Troubleshooting guide for DASH video stall/seek issues, based on the Plex transcode warmup bug (March 2026).

---

## How Plex DASH streaming works

1. Backend builds a transcode URL with `?offset=N` (resume position in seconds)
2. Plex starts transcoding from the offset but declares the **full video timeline** in the MPD (0 to total duration)
3. Segments before the offset are empty/0-byte — Plex didn't transcode that range
4. The client **must** seek to the offset position so dash.js requests segments where real data exists

```
MPD timeline:  [0 ──────── offset ──────── duration]
Segment data:  [  empty/0-byte  |  real transcoded  ]
                                ^
                        client must seek here
```

### Key files

| File | Role |
|------|------|
| `PlexAdapter.mjs` (`_buildTranscodeUrl`) | Builds DASH URL with offset, profile, session IDs |
| `useCommonMediaController.js` (line ~1124) | DASH seek logic — extracts offset from URL, seeks on loadedmetadata |
| `useMediaResilience.js` (`triggerRecovery`) | Recovery seek fallback chain |
| `VideoPlayer.jsx` (`hardReset`) | In-place recovery — sets currentTime + load + play |
| `BufferResilienceManager.js` | Shaka-based 404/0-byte detection (used for non-DASH) |

---

## Common failure modes

### 1. 0-byte fragments on startup (most common)

**Symptom:** `dash.transcode-warming` fires with high `consecutiveEmpty` count. Video never starts.

**Cause:** Client didn't seek to the offset position. dash.js starts at segment 0 which is in the empty range.

**Check:** Look for `playback.start-time-applied` in logs. The `intent` field should match the offset. If `method: "direct"` and `intent: 0`, the DASH seek path wasn't triggered.

**Fix history:** The controller was skipping client-side seek when it saw `?offset=` in the URL, assuming Plex started the timeline at the offset. Fixed to always seek, using URL offset extraction as fallback when `startTime` prop is 0.

### 2. Recovery loop seeking to 0

**Symptom:** `playback.player-remount` logs show `seekSeconds: 0` repeatedly. Video restarts from beginning on each recovery attempt.

**Cause:** The seek fallback chain `(targetTimeSeconds || lastProgress || seconds || 0)` evaluated to 0 because the video never progressed.

**Fix:** Added `initialStart` to the chain: `(targetTimeSeconds || lastProgress || seconds || initialStart || 0)`.

### 3. Stale Plex transcode session

**Symptom:** New video returns 0-byte fragments even though the file is fine. Often happens after switching videos.

**Cause:** Plex has a single-transcoder limitation. A stale session from a previous video blocks the new one.

**Diagnose:**
```bash
# Check active transcode sessions
TOKEN=$(grep token data/household/auth/plex.yml | head -1 | sed 's/.*: *//')
curl -s "http://plex:32400/transcode/sessions?X-Plex-Token=$TOKEN" -H "Accept: application/json"

# Kill all transcode sessions
curl -s -X DELETE "http://plex:32400/transcode/sessions?X-Plex-Token=$TOKEN"
```

### 4. Plex returns 400 on transcode request

**Cause:** Missing required query parameters. Plex needs all of these:
- `X-Plex-Client-Identifier` (per-session UUID)
- `X-Plex-Session-Identifier` (per-request UUID)
- `X-Plex-Platform` (defaults to `Chrome`)
- `X-Plex-Client-Profile-Extra` (codec profile — URL-encoded)

These are all set by `PlexAdapter._buildTranscodeUrl()`. If testing manually with curl, include them.

### 5. moov atom at end of file (large files)

**Symptom:** Plex takes 60-90s to start transcoding a large file (10GB+).

**Cause:** The MP4 `moov` atom (seek index) is at the end of the file. Plex must scan the entire file before it can start transcoding.

**Fix:** Run faststart to move moov to the front:
```bash
ffmpeg -i input.mp4 -c copy -movflags +faststart output.mp4
```

**Check:** `ffprobe -v quiet -show_entries format_tags=compatible_brands input.mp4` or use `AtomicParsley input.mp4 -T` to see atom positions.

---

## Seek architecture

### Initial load seek

```
startTime (prop) > 0  →  seek to startTime
startTime = 0, URL has ?offset=N  →  seek to N (extracted from URL)
no offset  →  play from beginning
```

The seek is applied at the earliest reliable point:
1. `loadedmetadata` event (primary)
2. `timeupdate` with `currentTime >= 0.5` (fallback)
3. Immediate if `readyState >= 1` (e.g., after hardReset)

Uses `container.api.seek()` (dash.js API) over `mediaEl.currentTime` to avoid SourceBuffer corruption.

### Recovery seek

When resilience triggers recovery (stall, startup deadline exceeded):

```
seekToIntentMs = (targetTimeSeconds || lastProgressSeconds || seconds || initialStart || 0) * 1000
```

- `targetTimeSeconds` — explicit seek target from session store
- `lastProgressSeconds` — last known playback position
- `seconds` — current media element time
- `initialStart` — original resume offset passed to the resilience hook

### Exponential backoff

Recovery uses exponential cooldown: `base * multiplier^attempt`

| Attempt | Cooldown (default config) |
|---------|--------------------------|
| 0 | 4s |
| 1 | 12s |
| 2 | 36s |
| 3 | 108s |
| 4 | 324s |

Config: `recoveryCooldownMs: 4000`, `recoveryCooldownBackoffMultiplier: 3`, `maxAttempts: 5`

---

## Debugging checklist

1. **Check logs for `playback.start-time-applied`** — confirms seek target and method
2. **Check `dash.transcode-warming`** — high `consecutiveEmpty` means dash.js is in the empty segment range
3. **Check `playback.player-remount`** — `seekSeconds` should match the resume offset, not 0
4. **Check for stale transcode sessions** — kill them if present
5. **Check the MPD manifest** — verify `mediaPresentationDuration` and segment structure match expectations
6. **Test the stream URL directly** — `curl -s -o /dev/null -w "status=%{http_code} bytes=%{size_download}"` on the MPD URL with full Plex params

### Testing with governance bypass

Add `?nogovern` to any fitness URL to bypass governance lock and sequential show redirect. The flag is sticky for the session:
```
/fitness?nogovern              # persists as you navigate
/fitness/play/649319?nogovern  # direct play
```

---

## Related docs

- `docs/reference/content/content-playback.md` — DASH Video Playback section
- `docs/plans/2026-03-11-dash-transcode-warmup-resilience.md` — original implementation plan
- `docs/_wip/audits/2026-03-11-fitness-video-dash-playback-failure-audit.md` — root cause audit
