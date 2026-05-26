# HTTYD — Recurring Micro-Stalls Throughout Playback (2026-05-26)

**Severity:** Medium-High (degrades all long-form Plex playback, not just this title)
**Symptom user reported:** "Small stalls and skips nearly every 5–10 minutes through the movie."
**Window:** 2026-05-26 01:12–03:27 UTC, `plex:654997` (*How to Train Your Dragon (2010)*), Living Room TV (Shield).

## TL;DR

Across 2h14m of playback the player executed **81 GapController jumps and 7 user-visible stalls** (≥1.2s). This pattern was absent from the original audit (`docs/_wip/audits/2026-05-26-httyd-movie-playback-audit.md`) and from the first second-opinion (`docs/_wip/bugs/2026-05-26-httyd-movie-playback-second-opinion.md`) — both treated the body of the movie as "smooth playback."

Working root cause: **dash.js's prefetch races Plex's stream-copy transcoder.** When the prefetcher requests a segment before the transcoder has finished writing it to disk, Plex serves the partial bytes that exist at that moment (e.g. 5.9KB or 97KB instead of ~1MB). Those partial segments land in dash.js's buffer; when the playhead later reaches that time, dash.js can't decode through them and `GapController` skips over the affected slice.

This is independent of (and underneath) the named Bugs A/B/C/D in the prior audit. Fixing it would eliminate the steady hum of small stalls users notice through any long Plex stream, not just HTTYD.

---

## Symptoms — full inventory from the logs

Across the 2h14m HTTYD session:

| Event | Count |
|---|---|
| `GapController` timeline jumps | **81** |
| `dash.buffer-stalled` | 23 |
| `dash.waiting` | 88 |
| `playback.stalled` (≥1.2s, user-visible) | **7** |
| `dash.quality-change` (adaptive flips) | 10 |
| `dash.error` | 3 |
| `dash.error-recovery` | 3 |
| Programmatic seeks | 92 |

### Gap-size distribution (all 81 jumps)

| Jump size | Count | Cause class |
|---|---|---|
| < 0.5 s | 17 | timestamp drift / micro-stutter |
| 0.5 – 1 s | 28 | perceptible stutter |
| 1 – 2 s | 19 | visible hiccup |
| 2 – 5 s | 9 | clear stall |
| **≥ 5 s** | **8** | whole-segment skip |

### User-visible stalls (≥1.2s freezes), all on `plex:654997`

| Wall time (UTC) | Current time | Stall ms |
|---|---|---|
| 02:00:55.104 | 616.49 s | 1319 |
| 02:13:31.582 | 1391.26 s | 1202 |
| 02:13:54.809 | 1411.87 s | 1201 |
| 02:30:33.850 | 2430.19 s | 1487 *(Bug C — different mechanism)* |
| 02:32:55.461 | 2573.07 s | 1201 |
| 02:41:33.818 | 3106.31 s | 1200 |
| 02:57:43.834 | 4106.31 s | 1200 |

Six of seven cluster around the 1200ms mark — that's dash.js's default stall-recovery threshold firing, then jumping past the bad spot.

### The decode counter says "0 dropped frames" — why nothing seemed wrong in the audit

The audit reported "0 dropped frames throughout the entire 2h14m session" as evidence of smooth playback. That's literally true at the decoder layer, but misleading: **`GapController` skips over un-decodable regions before the decoder ever sees them**, so they don't show up as drops. The decoder happily decodes what it gets; it just doesn't get the skipped portions.

---

## Phase 1: Investigation log (per systematic-debugging)

### What I checked and what it told me

**1. Are the gaps caused by source-file discontinuities?**
ffprobe-checked 6 of the gap locations directly (t=615, 705, 1241, 1255, 1386, 1406). At each location the source `pts_time` sequence is continuous at the expected 0.0417 s/frame interval. **Source is clean.** Hypothesis falsified.

**2. Are the gaps caused by Plex's transcoder being throttled (`-window_size 5` throttle oscillation)?**
Plex log shows the throttle/unthrottle cycle running constantly (e.g., 19:10:27.212 throttling → 19:10:27.813 unthrottling → 19:10:28.214 throttling — ~400 ms cycle). But each cycle is sub-second, far shorter than the observed stalls.

Decisive evidence against the simple throttle hypothesis came from buffer-level traces around the 02:11:24 stall:

```
02:11:20.903  buffer-level video: 4.28 s
02:11:22.236  buffer-level audio: 9.35 s
02:11:23.293  buffer-level video: 1.89 s   ← draining
02:11:24.889  dash.buffer-stalled (video)
02:11:24.913  GapController jumps t=1255.13 → 1261.51 (6.38 s)
02:11:26.458  buffer-level video: 124.36 s ← INSTANTLY 2 minutes of buffer
02:11:27.083  buffer-level audio: 93.38 s
```

If the transcoder had simply fallen behind, the buffer would refill *gradually* after recovery. Instead, immediately after the gap-jump, dash.js had **124 seconds of video already buffered.** Segments *after* the gap were already loaded. The problem wasn't throughput — it was that one specific segment (or its time region) was unplayable.

**3. So what is in those un-playable regions?**
Histogram of video segment sizes across all 1,476 fetches during the session:

| Bytes range | Count | Interpretation |
|---|---|---|
| 0 | 49 | Plex "blank segment / overestimated" (Bug B end-of-movie) |
| < 1 KB | 13 | partial — basically just `moof` header |
| 1 – 10 KB | 4 | severely truncated |
| 10 – 100 KB | 30 | partial (~5–50% of normal) |
| 100 – 500 KB | 273 | smaller than typical but plausible for low-motion content |
| > 500 KB | 1107 | normal |

**47 video segments (1B–100KB) came back partial**, plus the 49 zero-byte blanks. The 47 partial-segment count is in the same order of magnitude as the 81 GapController jumps. Plus the ~28 sub-second jumps look like timestamp jitter at segment boundaries — a separate, smaller effect.

**4. What's special about those partial segments?**
Looking at the burst-fetch around 02:01:35 (right after the user's seek to t=620s finished and dash.js refilled its buffer):

```
02:01:35.078  idx 245 t=1225 bytes=1464274   normal
02:01:35.117  idx 246 t=1230 bytes=463811    smaller
02:01:35.157  idx 247 t=1235 bytes=617608    smaller
02:01:35.185  idx 248 t=1240 bytes=97797     ← partial
02:01:35.212  idx 249 t=1245 bytes=5985      ← severely truncated
02:01:35.264  idx 250 t=1250 bytes=1020902   normal
02:01:35.328  idx 251 t=1255 bytes=1530336   normal
02:01:35.382  idx 252 t=1260 bytes=937185    normal
02:01:35.640  idx 254 t=1270 bytes=889087    normal
```

Pattern: a *single contiguous run of 2–3 segments* comes back partial-then-tiny-then-normal, in the middle of a burst fetch. The bytes get monotonically smaller as the fetcher catches up to (and overtakes) the transcoder, then snap back to normal once the transcoder gets ahead again.

The 35-segment burst (idx 220–254, t=1100 → 1275) was completed in **2.6 wall-clock seconds** — dash.js's prefetcher was sustaining ~140 Mbps of segment requests. Plex's stream-copy transcoder can write segments to disk faster than that for most content, but not when the source has a high-bitrate scene or when ffmpeg is doing an `-skip_to_segment` warmup.

**5. Why does the playhead actually stall later, instead of dash.js abandoning the partial segments?**
dash.js's HTTP layer received a `200 OK` with a partial body and treated it as success. There's no client-side validation that the bytes form a complete `moof+mdat` box pair. dash.js's MSE buffer accepts the appended bytes; the decoder can decode whatever frames are present and stops at the first incomplete one. Then 5–10 minutes later, when the playhead reaches that timestamp, the decoder hits EOF mid-segment, the buffer goes empty, `dash.waiting` fires, `GapController` decides the timeline has a gap, and skips ahead to the next decodable presentation time.

### Hypothesis (working, not yet fully proven)

**Plex's stream-copy DASH transcoder serves HTTP 200 with whatever segment bytes have been written to disk at the moment of the request — including incomplete writes. dash.js's prefetcher runs fast enough to race the writer, ingests the partial bytes as if they were complete, then stalls 5–10 minutes later when the playhead reaches the bad region.**

What this hypothesis predicts and what I observed (✓ = matches):

- ✓ Partial-byte segments cluster in contiguous runs of 2–3, not random.
- ✓ Segments after the cluster are normal-sized (transcoder caught up).
- ✓ Stalls happen at the *timestamp* of the partial segment, not at fetch time (10-minute lag matches).
- ✓ Source file is clean; gaps are introduced downstream.
- ✓ Buffer is full after the GapController jump (segments past the bad region were fine).
- ✓ Behavior is independent of any specific Plex session — happened in `34d4f202`, `c62b9446`, and `3a2b60dd`.

What it does NOT yet explain:

- Are the partial segments **always** at I/O race-condition boundaries, or do some come from genuinely-corrupt transcoder output (encoder NAL boundary bug)? A repro test (seek to t=1240 in a fresh session, fetch idx 248 immediately) would disambiguate.

### What was NOT verified

- I did not run a repro to confirm the race window. Would need a clean Plex restart + targeted segment fetch test.
- I did not check whether other Plex titles in this library show the same pattern. Almost certainly yes, but anecdotal.

---

## Phase 2: Pattern analysis

This is the same shape as `docs/_wip/bugs/2026-02-28-playback-stall-recovery-reuses-broken-session.md` (already in the bugs folder) — a generalized "stale/partial segment lives in the buffer until the playhead reaches it" failure. That earlier bug was scoped to recovery sessions; this one extends the failure mode to *every* DASH playback that uses stream-copy + aggressive client prefetch.

It is NOT the same shape as Bug B (Plex's intentional `Sending back blank segment for X, we overestimated the number of segments` at end-of-stream) — those are explicit 0-byte responses Plex announces in its log. The partial segments here are 1B–100KB and Plex's log shows them being served normally (with `200 OK` and a smaller content-length than the file's eventual final size).

---

## Phase 3: Proposed fixes (in order of cost/benefit)

| Pri | Fix | Confidence | Notes |
|---|---|---|---|
| **P0** | **Backend: detect and re-fetch partial video segments in the proxy.** Add a `Content-Length` plausibility check in the Plex proxy: if a video segment under `/transcode/universal/session/.../0/.m4s` returns < N bytes (configurable, e.g. 50 KB) AND the source content at that timestamp shouldn't be near-zero, retry after a short delay (e.g. 250 ms × 3). | High | Cheap. The proxy already has retry-on-5xx; this adds retry-on-implausible-size. The retry will hit Plex when the transcoder has had time to finish writing the segment to disk. |
| **P0** | **Client: cap dash.js prefetch lookahead.** Set `MediaPlayerSettings.streaming.buffer.bufferTimeAtTopQuality` lower than the current default (it appears to be allowing ~150 s lookahead, plus seek-driven bursts of 600+ s ahead). Reducing to ~30 s removes the race window since the transcoder runs faster than realtime. | High | Trade-off: less buffer = more vulnerable to network blips. But the current "fetch 35 segments in 2.6s" burst clearly outruns the transcoder. |
| **P1** | **Backend: pass a `transcodeWaitMs` query param to Plex** (`maxToBuffer=N`) on the start.mpd URL to ask Plex to wait for segments to be complete before serving them. Plex has this knob; we don't currently set it. | Medium | Need to verify the parameter name/availability in this Plex version. |
| **P1** | **Client: filter `GapController` jumps tied to partial segments.** When dash.js's MSE buffer reports a sudden timeline gap and the most recently-loaded segment for that timestamp was anomalously small, trigger a `refresh-url` instead of jumping. The user gets one visible reload instead of an unnoticed skipped 5 seconds of content. | Medium | The current behavior — silent skip — is arguably *worse* because the user doesn't know they missed something. |
| **P2** | **Client: validate `moof+mdat` box integrity on segment receive.** Reject partial m4s segments at the dash.js layer (an `XHRLoader` interceptor that parses the box list before handoff to MSE). On reject, treat as `dash.error segment-unavailable` so the existing recovery path kicks in. | Low | Heavier engineering work. Belt-and-suspenders. |
| **P2** | **Diagnostics: count partial segments and report in player telemetry.** Add a `dash.fragment-loaded` annotation `{ anomalousSize: true }` when bytes < expected threshold for the segment's duration × expected bitrate. Surface in `playback.fps_stats` or similar. | High | This bug went unreported in two prior audits because partial segments don't trigger any visible counter; only the indirect `GapController` jumps. Adding a direct signal makes it self-evident next time. |

---

## Why both prior reports missed this

- The original audit (`docs/_wip/audits/2026-05-26-httyd-movie-playback-audit.md`) framed the story around four named bugs (A/B/C/D) and called Phase 4 "smooth playback — 0 dropped frames throughout." The decode-frame counter is the wrong metric: `GapController` skips don't show up as drops.
- My first second-opinion (`docs/_wip/bugs/2026-05-26-httyd-movie-playback-second-opinion.md`) was anchored to the audit's named bugs. I corrected the audit's diagnoses but didn't audit beyond them. The total population of `GapController` jumps (~81) is not mentioned anywhere in either document.
- The decisive log signals — partial-byte segments and the buffer-level snap-back after a gap — required *specifically looking for* either. Neither doc did.

Lesson: **enumerate event populations across the full session window before naming bugs.** A grep for `GapController` would have surfaced this in a minute.

---

## Evidence inventory

- DaylightStation backend logs, full HTTYD window: `sudo docker logs daylight-station --since 24h`
- Plex internal logs: `/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log` (PDT timestamps; rotated daily)
  - Throttle/unthrottle oscillation in session `34d4f202`
  - ffmpeg invocation showing `-codec copy -f dash -seg_duration 5 -window_size 5 -delete_removed false`
- Source file: `/media/kckern/Media/Movies/How to Train Your Dragon (2010)/How to Train Your Dragon (2010).mp4`
  - ffprobe confirms continuous `pts_time` at all gap locations
  - Stream-copy means the source's good packets should pass through; partial segments are introduced downstream
- Fragment-level histograms via `dash.fragment-loaded` event `bytes` field, n=1476 video segments

## Related bugs

- `2026-02-28-playback-stall-recovery-reuses-broken-session.md` — same partial-segment-in-buffer pattern, but for recovery sessions specifically
- `2026-05-26-httyd-movie-playback-second-opinion.md` — same playback session, different named bugs (A/B/C/D)
- `docs/_wip/audits/2026-05-26-httyd-movie-playback-audit.md` — original audit
