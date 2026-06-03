# Fitness Playback Disaster — Diddy Kong Racing (AV1 Transcode Buffer Collapse)

**Date:** 2026-05-18
**Session log:** `media/logs/fitness/2026-05-19T02-30-31.jsonl` + `2026-05-19T03-27-34.jsonl`
**Content:** `plex:674284` — *Game Cycling - S02E04 - Diddy Kong Racing*
**Client:** Firefox 150 on Linux x86_64 (kiosk; living-room TV / Shield not involved — UA shows desktop FF, IP `172.18.0.82`)
**Verdict:** Plex was driven into a software AV1 → H.264 transcode at 1920×1440@60fps targeting 20 Mbit/s H.264, ran ~3× slower than realtime, exhausted its DASH window during a 17-minute idle pause, and could not recover. The DASH player thrashed through four transcode sessions, stuttering at ~1 second of content per ~3 seconds of wall-clock before being abandoned.

---

## 1. Symptoms Observed by the User

User reports playback was "a disaster." From the log:

| Phase | Wall clock (UTC) | What the user saw |
|-------|------------------|-------------------|
| Queue start | 03:00:43 | Diddy Kong loaded, resumed from `t=217s` (prior watch position), then immediately paused |
| Long idle | 03:00:46 → 03:17:41 | 16m 55s with player paused at `t=217.05s` (probably governance lockscreen / pre-ride) |
| Brief good playback | 03:17:41 → 03:18:42 | 60 seconds of playback (t=217s → t=277s) |
| First stall | 03:18:42 → 03:18:50 | `playback.stalled` at `t=277.0s`, then `paused` 8s later |
| Recovery thrash | 03:19:02 → 03:21:21 | 4 transcode sessions spawned. 17 separate `playback.stalled` events in a single minute (03:20). Playhead crawls forward in ~1s increments per 3s of wall clock |
| User seeks back / quits | 03:21:33 | Resume at `t=259s` — user seeked **backward 44s**, presumably to retry. Trace ends shortly after. |

---

## 2. Evidence Layer 1 — Frontend DASH Player

Event-count summary from the Diddy Kong window (`03:00–03:25 UTC`):

```
dash.buffer-stalled        66
dash.waiting               33
dash.fragment-abandoned    16
fitness.video_fps_degraded 30
playback.stalled           20
dash.error                  1
playback.player-no-source-timeout   3
dash.transcode-warming      2
dash.transcode-warmed       2
```

### The dash.error (smoking gun #1)

```
[2026-05-19T03:17:46Z] dash.error
  error: 27
  message: "https://daylightlocal.kckern.net/api/v1/proxy/plex/video/:/transcode/
            universal/session/9ae73c89-2be1-497c-8b98-09a2962fbcf0/0/277.m4s
            is not available"
  bytesLoaded: 78, bytesTotal: 78,
  bandwidth: 20000000
```

Translation: ~5 seconds after the user un-paused, the dash.js player asked the **same** transcode session that had been idle for 17 minutes for segment `0/277.m4s` (video segment 277, ≈ second 277). Plex returned a 78-byte stub instead of a real segment. The transcode session's producer had quit/timed-out during the idle window, so segments past what was already on disk simply didn't exist.

Notable: `bandwidth: 20000000` — the player negotiated a 20 Mbit/s variant. The source AV1 file is only 3.5 Mbit/s. Bitrate inflation is **5.7×**.

### Four transcode sessions in 20 minutes (smoking gun #2)

Every "recovery" attempt by dash.js spawned a brand-new Plex transcode session:

| Session UUID | Started (UTC) | Trigger |
|--------------|---------------|---------|
| `9ae73c89-2be1-497c-…` | 03:00:43 | Initial play |
| `aa026e23-4ac0-4106-…` | 03:18:59 | After first stall |
| `07ce3a91-41b7-467c-…` | 03:19:14 | After `no-source-timeout` |
| `8b763585-83d8-489f-…` | 03:19:43 | After third stall |

Each cold-start session has to begin transcoding from segment ~218 and warm up the buffer from zero. While they spin up, the player has nothing to play.

---

## 3. Evidence Layer 2 — Plex Transcoder

### File metadata via `ffprobe` (`Plex container path /data/media/...` → host `/media/kckern/Media/Fitness/Game Cycling/`)

```
codec_name:    av1               profile: Main
width × height: 1920 × 1440     (NOT 1080p — 4:3 source, displayed as 1.33:1)
r_frame_rate:  60/1              nb_frames: 779,942
bit_rate:      3,476,723 bps     duration: 12,999.03s (3h 36m 39s)
file size:     5,876,902,386 B   container: mp4 (YouTube/Google handler tag)
```

The file is a YouTube rip — likely a multi-hour real-cycling-camera-over-game-footage montage — encoded in AV1 60fps at modest bitrate.

### ffmpeg command line Plex actually ran (PMS log `20:00:43.425`)

```
/usr/lib/plexmediaserver/Plex Transcoder
  -codec:#0x01 libdav1d                  ← SOFTWARE AV1 decode
  -ss 217 -analyzeduration 20000000 -probesize 20000000
  -i /data/media/.../Diddy Kong Racing.mp4 -start_at_zero -copyts
  -filter_complex
    [0:#0x01]scale=w=1920:h=1440:force_divisible_by=4[0];
    [0]format=pix_fmts=yuv420p|nv12[1]
  -map [1]
  -codec:0 libx264                       ← SOFTWARE H.264 encode
    -crf:0 16                            ← visually-lossless quality target
    -maxrate:0 20000k                    ← 20 Mbit/s ceiling
    -bufsize:0 40000k
    -r:0 60                              ← keep 60fps
    -preset:0 veryfast
    -x264opts subme=0:me_range=4:rc_lookahead=10:me=hex:8x8dct=0:partitions=none
  -map 0:#0x02 -codec:1 copy             ← audio stream-copy (fine)
  -f dash -seg_duration 1 -dash_segment_type mp4
  -skip_to_segment 218
  …
```

And one line later:

```
20:00:43.894  Transcoder: session 9ae73c89-… indicated fallback to software decoding
```

### Transcode pace (from `Plex Transcoder Statistics.*.log`)

For session `8b763585-…`, segment 278 onward:

| Segment | Wall ms to transcode 1s of video | Realtime ratio |
|---------|----------------------------------|----------------|
| 278     | 14 178 ms (cold-start)           | 0.07×          |
| 279     | 3 328 ms                          | 0.30×          |
| 280     | 2 995 ms                          | 0.33×          |

Steady-state: **~0.3× realtime**. Producing 1 second of H.264 takes 3 seconds of CPU. The DASH buffer can only drain.

Why the encoder is so slow:
- AV1 SW decode (libdav1d) at 1440p60 ≈ 4–6 modern CPU cores worth of work.
- Then libx264 SW encode at 1440p60 with CRF 16 + maxrate 20 Mbit/s on `veryfast` preset is another 2–4 cores. CRF 16 is *higher* quality than the source.
- Total: ~10 cores worth of work for 1× realtime. The Plex host doesn't have that headroom.

### Why the 17-minute pause was lethal

Plex auto-kills idle transcoder processes (default ~5 min). When the user paused at `t=217.05s`, Plex pre-rolled some segments (segments 218–~230, ahead of playhead) then went idle. After ~5 minutes, the ffmpeg producer was reaped. The session **directory** stayed on disk (segments 218–230) but no producer remained.

When the user un-paused 17 minutes later, dash.js:
1. Asked for segments 218 → 277 (next 60s of buffer).
2. Got 218 → ~230 from cache (60s of playback ≈ what we observed).
3. Asked for 277 → got back a 78-byte empty body → `dash.error 27`.
4. Re-requested a "start" of the transcode session (cold), spawning new sessions.

---

## 4. Evidence Layer 3 — Backend Code Path

`backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:946-967` (and again at `1586-1610`):

```javascript
_buildTranscodeUrl(key, clientIdentifier, sessionIdentifier, maxVideoBitrate=null, maxResolution=null) {
  const mediaBufferSize = 5242880 * 20; // 100MB buffer
  const baseParams = [
    `path=%2Flibrary%2Fmetadata%2F${key}`,
    `protocol=${this.protocol}`,
    `X-Plex-Client-Identifier=${clientIdentifier}`,
    `X-Plex-Session-Identifier=${sessionIdentifier}`,
    `X-Plex-Platform=${this.platform}`,
    `autoAdjustQuality=1`,
    `fastSeek=1`,
    `mediaBufferSize=${mediaBufferSize}`,
    `X-Plex-Client-Profile-Extra=${encodeURIComponent(
      'append-transcode-target-codec(' +
        'type=videoProfile&context=streaming' +
        '&videoCodec=h264,hevc'        // ← BUG: AV1 not declared
        '&audioCodec=aac' +
        '&protocol=dash'
      + ')'
    )}`
  ];
  // …
}
```

The **client-profile extra** is the contract telling Plex what codecs the client can play. We declare only `h264` and `hevc`, so Plex correctly concludes that any AV1 (or VP9) source **must** be transcoded.

Combined with `directPlay=0` (line 848) and `directStream=1` (line 849), the decision matrix becomes:

| Source codec | Result |
|--------------|--------|
| h264/hevc    | DirectStream (remux only, free) |
| av1, vp9     | **Full transcode** — software AV1 decode + software H.264 encode |

No `maxVideoBitrate` is passed by the fitness app's play URL (`/api/v1/play/plex/674284` has no query params — see `play.mjs:202-210`). Plex therefore uses the server-side per-network maximum, which here is "20 Mbit/s" (visible in the targetBitrate field of the SessionReport).

---

## 5. The Library Has Several AV1/VP9 Episodes — Not a One-Off

Codec audit of `Game Cycling S02`:

| Episode | Codec | Res | Notes |
|---------|-------|-----|-------|
| S02E01 F-Zero                       | h264 | 412×360  | Trivial |
| S02E02 Daytona USA                  | h264 | 1080p60  | OK |
| S02E03 Wave Race 64                 | h264 | 1080p60  | OK |
| **S02E04 Diddy Kong Racing**        | **av1**  | **1440p60** | **This audit** |
| S02E05 Daytona USA 2                | h264 | 1080p60  | OK |
| S02E06 Looney Tunes Racing          | h264 | 720p60   | OK |
| **S02E07 Daytona USA 2001**         | **av1**  | **1080p60** | Will hit same bug |
| **S02E08 F-Zero GX**                | **av1**  | **1080p60** | Will hit same bug |
| **S02E09 Wii Sports Resort**        | **vp9**  | 720p30   | Will transcode (less painful at 720p30) |
| S02E10 Sonic & Sega All Stars       | h264 | 1080p60  | OK |
| **S02E11 Crash Team Racing**        | **av1**  | 1080p30  | Will transcode |
| S02E12 Forza Horizon 5              | h264 | 1080p60  | OK |
| S02E13 Fast & Furious Arcade        | h264 | 1080p60  | OK |
| **S02E14 Fast Fusion**              | **av1**  | **2160p60**| Will be catastrophic |

So **6 of 14** episodes (43%) trigger transcoding under the current client profile. E14 is AV1 4K60 — worse than Diddy Kong.

---

## 6. Root Cause

**The Plex client profile published by `PlexAdapter._buildTranscodeUrl` does not advertise AV1 (or VP9) support.** Plex consequently picks the most expensive available decision — software AV1 decode + software H.264 encode at the source resolution and 60fps, capped only by the server's 20 Mbit/s default. This pipeline runs at ≈0.3× realtime on this host; sustained playback is impossible. Idle pauses additionally let Plex's session reaper kill the producer, leaving the player with a cache hole when the user resumes.

The user-facing failure pattern (smooth-then-stall, multiple session restarts, 1-second-per-3-seconds crawl) is the **expected behavior** of a DASH client running on a transcoder that can't keep up. There is no frontend bug — the frontend is correctly reporting reality.

---

## 7. Contributing Factors

1. **No max-bitrate cap passed from the fitness app.** Server defaults to 20 Mbit/s for H.264 output even when the source was 3.5 Mbit/s AV1. Bitrate inflation amplifies encoder CPU cost.
2. **CRF 16 is wrong for live streaming.** Plex picked it because of "Original" quality bucket; visually-lossless CRF over a 60fps source is brutal on libx264 even at `veryfast`.
3. **`scale=1920:1440` rescales unnecessarily** (source is already 1920×1440). The filter chain runs `swscale` for nothing, and Plex labels the stream "1080p" though it's actually 1440p — confusing later analysis.
4. **No hardware AV1 decode available.** Container init script (`plex-amdgpu-fix.sh`) only patches `amdgpu.ids`. Whatever AMD GPU is here either lacks VCN 4+ AV1 decode or isn't being used by Plex's transcoder (log explicitly states "fallback to software decoding").
5. **Idle pause + session reaper combination.** A user pausing for >5 min on any transcoded title will hit the same cache-hole-on-resume problem regardless of CPU power.
6. **No client-side throttling on transcode-session restarts.** dash.js fired four cold-start sessions in 20 minutes. Each new session piles CPU load onto the still-running previous one, compounding the deficit.

---

## 8. Recommended Fixes (ordered by impact)

### A. Add `av1,vp9` to the client profile target codecs (PRIMARY FIX)

`backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:957` and `:1597`:

```diff
- '&videoCodec=h264,hevc'
+ '&videoCodec=h264,hevc,av1,vp9'
```

This tells Plex that the client (Firefox 150 + dash.js) can decode AV1 and VP9. Plex's decision will switch to **DirectStream** (remux only) for AV1/VP9 sources: ~0 CPU, instant, no transcode session, no idle-reaper hole. Firefox decodes AV1 natively via dav1d.

Caveats:
- Confirm the deployed client is always Firefox or another browser with AV1 support. Today, every meaningful client (modern Chrome, Firefox, Safari 17+) has AV1 software decode. The kiosk UA in this session log is FF 150 — fine.
- If older browsers ever target this endpoint, add a UA sniff before deciding which codec list to advertise.

### B. Cap `maxVideoBitrate` on the fitness play URL

When AV1 *does* need transcoding (e.g. if a future client is added that can't decode AV1), don't let Plex target 20 Mbit/s on a 3.5 Mbit/s source. Pass `maxVideoBitrate=6000` (or ~1.5× source bitrate) into `play.mjs` so the transcoder targets a sane H.264 bitrate. Easiest: make the fitness app append `?maxVideoBitrate=6000` to the play URL, or set a server default in the play router for video items.

### C. Cap `maxVideoResolution` too

Source is 1440p; the H.264 output doesn't need to be. `maxVideoResolution=1080p` (or `720p` for a kiosk TV streamed over Wi-Fi) eliminates the upscaled CPU cost and lets the encoder hit realtime even when transcode is unavoidable.

### D. Pre-roll / keep-alive on long pauses

When playback is paused for more than ~3 minutes, the frontend should either:
  - Send periodic `transcode/session/{id}/progress` pings to keep Plex from reaping the producer, or
  - Tear the session down on pause and rebuild it on resume (cheaper than the current "stale cache + 78-byte segments" failure mode).

Today the player blindly assumes the session still exists, asks for segment 277, and only learns it doesn't when it's already mid-playback.

### E. Throttle DASH session restarts

When dash.js receives `error 27` for a fragment, don't immediately spawn a new transcode session. Wait, retry the same session, fall back. Four cold-starts in 90 seconds is what made the recovery thrash so destructive.

### F. (Optional) Library hygiene

Some of these YouTube-rip AV1 files are unusual aspect (1440p 4:3) and very low bitrate for AV1. They could be re-encoded once to H.264 1080p so they direct-stream on every client. This is the brute-force fix and shouldn't be necessary once (A) is in.

---

## 9. Verification Plan

After applying (A):

1. Start a fresh fitness session, navigate to Diddy Kong Racing.
2. Confirm in `media/logs/fitness/<latest>.jsonl` that **no** `dash.transcode-warming` events fire, **no** `dash.fragment-abandoned`, **no** `playback.stalled` events.
3. Confirm in `/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log` that the session log shows `videoDecision="copy"` (or no transcode session is started at all — the URL pattern should switch to a direct file part path).
4. Pause for 10 minutes mid-playback, resume — playback should continue without buffering.
5. Repeat on S02E14 (AV1 4K60). If direct-streaming AV1 4K60 over Wi-Fi saturates the link, that's where (C) `maxVideoResolution=1080p` comes in.

---

## 10. Out-of-Scope Anomalies Worth Noting

The session log also surfaces several issues unrelated to playback but visible in the noise floor — flag for follow-up audit, don't conflate with this one:

- **2 011 × `fitness.persistence.validation_failed`** (warn) — persistence layer is rejecting state writes constantly.
- **46 × `fitness-profile-excessive-renders`** + **31 × `fitness.render_thrashing`** — separate UI perf issue.
- **30 × `fitness.video_fps_degraded`** — video FPS warnings; in this audit they're symptoms of the transcode collapse, but the same warning fires in other sessions for different reasons.
- **8 × `participant.zone.lookup_failed`** — HR zone resolver gap.

These are not the cause of the Diddy Kong failure and should be addressed independently.

---

## Appendix — Key File / Log References

| Thing | Path |
|-------|------|
| Fitness session logs | `media/logs/fitness/2026-05-19T02-30-31.jsonl`, `2026-05-19T03-27-34.jsonl` |
| Source media file | `/media/kckern/Media/Fitness/Game Cycling/Game Cycling - S02E04 - Diddy Kong Racing.mp4` |
| Inside-Plex path | `/data/media/video/fitness/Game Cycling/Game Cycling - S02E04 - Diddy Kong Racing.mp4` |
| Plex PMS log | `/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log` |
| Plex transcoder stats | `/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Transcoder Statistics.{1..5}.log` |
| Client-profile bug site | `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:957` and `:1597` |
| Play route | `backend/src/4_api/v1/routers/play.mjs:202-228` |
| Plex transcode session dirs (on host) | `/home/kckern/Videos/Plex/Transcode/Sessions/plex-transcode-<uuid>-<uuid>/` |
