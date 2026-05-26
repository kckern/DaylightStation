# HTTYD Source File Has Non-Uniform GOPs That Break Plex DASH Stream-Copy (2026-05-26)

**Status:** Root cause identified and isolated via direct experiments. Remediation choices laid out at the bottom.

**Supersedes:** `docs/_wip/bugs/2026-05-26-plex-serves-partial-dash-segments-under-burst-fetch.md` — that report named race-condition truncation as the cause; Experiment 1 falsified it.

**Related:** `docs/_wip/bugs/2026-05-26-httyd-recurring-micro-stalls-throughout-playback.md` — established the symptom (81 `GapController` jumps, 7 user-visible stalls during the HTTYD session).

---

## TL;DR

The HTTYD source file (`How to Train Your Dragon (2010).mp4`) has a pathological GOP structure: **52.7% of its 5,615 GOPs are shorter than 100 milliseconds** (sub-frame keyframe clusters), with a mean GOP of just 1.04 seconds. When Plex serves this via DASH with `-codec copy -f dash -seg_duration 5`, the muxer cannot produce segments whose actual content matches the MPD-declared `[N*5, (N+1)*5)` time slots. The result: ~1 in 30 segments contains only a few frames (or even a single keyframe) whose `pts_time` falls in the *next* segment's declared slot, leaving an undecodable hole at the segment boundary. dash.js's `GapController` jumps over each hole — that's the user-visible micro-stutters every 5–10 minutes.

The proxy is not at fault (Experiment 2: byte-perfect MD5 match through proxy vs direct from Plex). The transcoder is not race-truncating (Experiment 1: deterministic byte counts across sessions, all with honest `Content-Length`). The source file's GOP structure is the root cause.

---

## What was verified

### Experiment 1: Plex serves complete segments with honest Content-Length

Burst-fetched 20 segments from a fresh DASH session in 33ms (well under any race window). All 20 returned `200 OK` with `Content-Length` matching body byte count exactly. Then burst-fetched indices 240–260 (where production had "anomalously small" segments). Same result: every single response was complete and matched its declared length.

| seg | status | Content-Length | actual bytes | match |
|---|---|---|---|---|
| 0 | 200 | 1,237,064 | 1,237,064 | ✓ |
| 4 | 200 | 11,953 | 11,953 | ✓ |
| 5 | 200 | 11,585 | 11,585 | ✓ |
| 13 | 200 | 86,487 | 86,487 | ✓ |
| 246 | 200 | 97,797 | 97,797 | ✓ |
| 247 | 200 | 5,985 | 5,985 | ✓ |

The "tiny segments" reproduce *deterministically* across totally independent sessions — production sess `34d4f202` had `bytes=97797` at idx 248; fresh test sess `d1127cf1` had `bytes=97797` at idx 246 (shifted by 2 because production used `-skip_to_segment 7`). Same source content → same byte counts.

**The prior report's "race condition under burst-fetch" hypothesis is falsified by this.**

### Experiment 2: Proxy is byte-perfect

Fetched three segments (one normal, one tiny, one normal) directly from Plex and through the DaylightStation proxy. MD5 sums:

| seg | direct size | proxy size | direct md5 | proxy md5 | match |
|---|---|---|---|---|---|
| 0   | 1,237,064 | 1,237,064 | `ffef9ccbf566fb54aaae28e5002c8270` | `ffef9ccbf566fb54aaae28e5002c8270` | ✓ |
| 247 | 1,464,274 | 1,464,274 | `dcca64a03c306b9eb3bceb70f8b97783` | `dcca64a03c306b9eb3bceb70f8b97783` | ✓ |
| 248 |   463,811 |   463,811 | `ea05a1c162528bc177c32442d27914e0` | `ea05a1c162528bc177c32442d27914e0` | ✓ |

**Proxy passes responses byte-for-byte unchanged.** Combined with code review of `ProxyService.mjs` (`proxyRes.pipe(res)` with no body inspection), this conclusively rules out the proxy as a truncator.

### Experiment 3: What's actually *in* a small segment

ffprobe of segments (after concatenating the init segment for self-contained mp4):

| Segment | Bytes | Frames | First pts | Last pts | Content covered |
|---|---|---|---|---|---|
| 245 (normal) | 617,608 | **105 frames** | 1237.28 s | 1241.62 s | 4.34 s |
| 246 (small) | 97,797 | **4 frames** | 1241.66 s | 1241.78 s | **0.12 s** |
| 247 (tiny) | 5,985 | **1 frame (keyframe only)** | 1241.82 s | 1241.82 s | **single instant** |
| 248 (normal) | 1,019,110 | 97 frames | 1241.87 s | 1245.83 s | 3.96 s |

These segments are claimed by the MPD to each be exactly 5 seconds wide:
```xml
<SegmentTemplate timescale="1" duration="5"
  initialization="session/.../$RepresentationID$/header"
  media="session/.../$RepresentationID$/$Number$.m4s"
  startNumber="0">
```

So dash.js's player math says:
- segment 245 covers presentation time `[1225, 1230)`
- segment 246 covers `[1230, 1235)`
- segment 247 covers `[1235, 1240)`
- segment 248 covers `[1240, 1245)`

But the actual frame `pts_time` values:
- segment 245's frames are at t=1237.28–1241.62  → in the slots for segments 247–248
- segment 246's 4 frames are at t=1241.66–1241.78 → in segment 248's slot
- segment 247's 1 frame is at t=1241.82  → in segment 248's slot
- segment 248's frames are at t=1241.87–1245.83  → in segments 248–249's slots

The mismatch is dramatic. The MPD says "play segment 247 for time [1235, 1240)"; segment 247 has one frame at t=1241.82. When dash.js's playhead reaches t=1241.62 (end of segment 245's frames), it expects segment 246's content for the next moment — but segment 246's frames are at t=1241.66-1241.78, which dash.js's MSE timeline considers part of segment 248's slot. Buffer goes empty → `dash.buffer-stalled` → `GapController` jumps over the unreadable region.

### Experiment 4: The source's GOP structure is pathological

GOP analysis of `How to Train Your Dragon (2010).mp4` (5,615 total GOPs):

| GOP duration | Count | % |
|---|---|---|
| **< 0.1 s** (sub-frame keyframe cluster) | **2,959** | **52.7%** |
| 0.1 – 0.5 s | 637 | 11.3% |
| 0.5 – 1 s | 412 | 7.3% |
| 1 – 2 s | 620 | 11.0% |
| 2 – 3 s | 358 | 6.4% |
| 3 – 5 s | 332 | 5.9% |
| 5 – 7 s | 145 | 2.6% |
| 7 – 10 s | 82 | 1.5% |
| ≥ 10 s | 70 | 1.2% |
| **Min / Mean / Max** | **0.042 s / 1.045 s / 10.010 s** | |

Sample of keyframe positions from the source (showing the clustering pattern):
```
0.000   2.044   2.085   2.127   12.054   22.064   31.323   32.157   32.199
32.240  32.282  32.574  32.616  32.699   33.200   33.450   33.909   33.951
33.992  34.034  34.076  34.117  34.159   34.201   34.243   34.284   34.326
```
Look at t=33.909-34.326: **11 keyframes in 0.42 seconds** (essentially every frame is intra-coded). HTTYD is an animated movie with frequent scene cuts where the original encoder chose to insert keyframes aggressively — fine for direct decoding, terrible for fixed-duration DASH segmenting.

For comparison, *The Terminator (1984).mp4* (same library, same DASH config): 161 GOPs in the first 600 s, min=1.6 s, max=6.0 s, mean=3.7 s. Uniform. No reported stalls.

### Why the segments end up off-by-frames

ffmpeg's DASH muxer with `-codec copy -seg_duration 5` cannot split mid-GOP (it has to start each segment at a keyframe to be independently decodable). When source GOPs are sub-second and clustered irregularly, ffmpeg's segment-boundary chooser does its best to put each segment near a 5-second mark while respecting GOP boundaries. The result for HTTYD: most segments end up containing the last few frames of one GOP plus the first few of the next, with timestamps that don't line up with the MPD-declared per-segment slot.

This is a known property of ffmpeg's DASH muxer; the "fix" is either uniform-GOP source or transcode-with-re-encode (which forces ffmpeg to insert keyframes at exact 5-second marks).

---

## The chain of fault — corrected

1. **HTTYD source has irregular sub-second GOPs** (52.7% of GOPs < 0.1 s, mean 1.04 s). Likely how the original release was encoded; many animated movies have similar patterns. ⟵ root cause
2. **Plex uses `-codec copy` (stream-copy / Direct Stream) for this file.** Plex chose this because the source codec/container is already compatible with the client's DASH profile. Stream-copy is the right choice for CPU/quality but the wrong choice for *this source's GOP structure*.
3. **ffmpeg's DASH muxer with `-seg_duration 5 -copyts`** can't reconcile non-uniform GOPs with a fixed 5-second segment grid, so it produces segments whose content `pts_time` doesn't match the MPD-declared per-segment time slot.
4. **dash.js trusts the MPD's `[N*5, (N+1)*5)` math.** When the actual content `pts_time` falls outside the declared slot, the MSE buffer can't decode through the boundary and `GapController` skips. → User sees a 0.5-2 second stutter.

The proxy is innocent. The Plex HTTP layer is innocent (Content-Length is honest). The transcoder is not race-truncating. dash.js is doing what it's told. Even the segment files on disk are exactly what Plex claims they are — they're just numbered wrong relative to their content's timestamps.

---

## Remediation options

In order of effort and confidence:

### Option A — Re-encode the HTTYD source with a uniform GOP (recommended)

```bash
ffmpeg -i "How to Train Your Dragon (2010).mp4" \
  -c:v libx264 -preset slow -crf 18 \
  -g 120 -keyint_min 120 -sc_threshold 0 \
  -c:a copy \
  "How to Train Your Dragon (2010) [reGOP].mp4"
```

- `-g 120` = keyframe every 120 frames (= 5.005 s at 23.98 fps) — aligns with Plex's `-seg_duration 5`
- `-sc_threshold 0` disables scene-cut keyframes
- `-crf 18` = visually lossless for animation
- Plex will direct-stream the re-encoded file without producing fragmented segments

**Cost:** One-time CPU spend (~30 min on a modern machine), file size change (likely slightly smaller because we remove the sub-frame keyframe spam).
**Benefit:** Smooth playback for this title forever.
**Risk:** None — original is preserved separately if needed.

### Option B — Force Plex to transcode (re-encode) instead of stream-copy

Plex's "Direct Stream" decision is per-client based on the client's reported codec/profile/level capabilities. We could:
- Override the X-Plex-Client-Profile-Extra in our start.mpd URL to claim a profile/level/bitrate constraint the source doesn't meet, forcing Plex to re-encode.
- Or tell Plex to set a max bitrate that's lower than the source.

**Cost:** Plex CPU usage during every playback (animation re-encoding is moderate). User pause/resume causes new transcode sessions = more CPU.
**Benefit:** Works for *any* source with this problem, no per-file work.
**Risk:** Quality loss vs Direct Stream; transcode latency on start.

### Option C — Survey the library for other affected titles

```bash
for f in /media/kckern/Media/Movies/*.mp4 /media/kckern/Media/Movies/*.mkv; do
  pct=$(ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -of csv "$f" 2>&1 | \
    awk -F, '$3 ~ /K/ {
      if (prev != "") { gop = $2 - prev; total++; if (gop < 0.1) tiny++ }
      prev = $2
    } END { if (total>0) printf "%.1f", 100*tiny/total }')
  if [ -n "$pct" ] && [ "$(echo "$pct > 5" | bc -l)" = "1" ]; then
    echo "$pct% sub-frame GOPs : $f"
  fi
done
```

Any file with >5% sub-frame GOPs is a candidate for Option A re-encoding.

### Option D — Client-side workaround (NOT recommended)

dash.js does not currently provide a setting to "tolerate segment time mismatches" — the segment-time → presentation-time mapping is contractual in DASH. Trying to patch around it client-side would require either custom segment parsing (extract real `pts_time` from each fetched segment and override the timeline) or disabling `GapController` (which would create real holes in playback instead of jumping over them).

Don't go here. Fix the source.

---

## What's still open

1. **Are other titles in the library affected at similar rates?** Run Option C survey.
2. **Is Plex's `-window_size 5` exacerbating this?** Probably orthogonal — the segments would still be misaligned with any window_size — but worth a quick test.
3. **Does the same file play smoothly through Plex's own clients** (Plex web, Plex Android, etc.)? If yes, those clients are tolerating segment-time mismatches that dash.js isn't. Worth knowing because it would expand the "client-side workaround" surface to "talk to dash.js about supporting this."

---

## Evidence inventory

- Source file: `/media/kckern/Media/Movies/How to Train Your Dragon (2010)/How to Train Your Dragon (2010).mp4`
  - ffprobe GOP table: 5,615 GOPs, 52.7% < 100ms, mean 1.04 s, max 10.0 s
  - Sample keyframe positions: t=0, 2.044, 2.085, 2.127, 12.054, ... (irregular sub-second clusters)
- Comparison source: `/media/kckern/Media/Movies/The Terminator (1984).mp4`
  - 161 GOPs in first 600 s, min 1.6 s, max 6.0 s, mean 3.7 s — uniform
- Plex DASH manifest for `plex:654997`:
  - `<SegmentTemplate timescale="1" duration="5" startNumber="0">` — all segments declared exactly 5 s
- Fresh-session segment fetches (test session `d1127cf1...` and `56ac9fad...`):
  - All `Content-Length` honest (matched body byte count)
  - Byte-identical to production session output (proves deterministic, not racy)
- Proxy byte-equality (`/tmp/exp2/{d2,p2}-*.body`):
  - MD5 match for all tested segments through both paths
- Proxy source: `backend/src/0_system/proxy/ProxyService.mjs` lines 190–192 (`writeHead` + `pipe`, no body inspection)
- Per-segment frame analysis via ffprobe of `init + segment.m4s`:
  - Segments 245, 246, 247, 248 frame counts and pts_time ranges (table above)
- Decode test on the Bug B end-of-movie range: `ffmpeg -ss 5640 -t 230 ... -f null -` produced no errors — confirms the source is intact end-to-end.

## Related bugs

- `docs/_wip/bugs/2026-05-26-httyd-recurring-micro-stalls-throughout-playback.md` — established symptom population (81 jumps, 7 stalls)
- `docs/_wip/bugs/2026-05-26-plex-serves-partial-dash-segments-under-burst-fetch.md` — **superseded** by this report; the race-condition hypothesis was wrong
- `docs/_wip/bugs/2026-05-26-httyd-movie-playback-second-opinion.md` — covers Bug A (phantom Player), Bug C (idle-kill race), Bug B (end-of-movie blanks); independent of this issue
- `docs/_wip/audits/2026-05-26-httyd-movie-playback-audit.md` — original audit
