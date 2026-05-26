# Plex Serves Partial DASH Segments Under Client Burst-Fetch (2026-05-26)

**Status:** Investigation — root cause located at Plex layer, our proxy ruled out as the truncator. Remediation deferred until the open questions below are answered.

**Related:** Follow-up to `2026-05-26-httyd-recurring-micro-stalls-throughout-playback.md` (which established the 81 GapController jumps / 7 user stalls during the HTTYD session). That report named our proxy as a candidate culprit for partial segments. **This report rules that out.**

---

## What's HARD-confirmed

### 1. Plex returns HTTP 200 with truncated bodies for in-progress DASH segments

Direct from Plex's main log (`/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.1.log`):

```
May 25 19:01:37.784  Completed: 200 GET .../session/34d4f202/0/248.m4s GZIP 0ms 97797 bytes  (pipelined: 116)
May 25 19:01:37.808  Completed: 200 GET .../session/34d4f202/0/249.m4s GZIP 0ms 5985 bytes   (pipelined: 117)
```

Three things to notice:
1. **`200`** status — not 206 Partial Content, not 416, not 503. Plex treats this as a successful complete response.
2. **`0ms`** processing time — Plex didn't wait for the transcoder to finish writing the segment; it served whatever bytes were on disk at request time.
3. **`pipelined: 116/117`** — dash.js (or Node's HTTP agent inside the proxy) is sending requests on an HTTP/1.1 pipeline. Burst depth ≥117 requests on one connection.

### 2. The source content at those timestamps is large, not legitimately small

ffprobe on `How to Train Your Dragon (2010).mp4`:

| Source range | Sum bytes (119 packets each) | Average packet |
|---|---|---|
| t=1240–1245 (= seg 248) | **750,114 bytes** (~733 KB) | 6,303 bytes |
| t=1245–1250 (= seg 249) | **1,511,679 bytes** (~1.45 MB) | 12,703 bytes |

Plex served 97,797 and 5,985 bytes for those segments respectively. Seg 249: **5,985 / 1,511,679 = 0.4% of source size delivered.** This isn't a stream-copy of the source's actual content — it's a partial write.

### 3. The transcode is stream-copy

ffmpeg invocation from Plex's log:

```
"Plex Transcoder" "-codec:#0x01" h264 -ss 33 -noaccurate_seek
  -i ".../How to Train Your Dragon (2010).mp4"
  -start_at_zero -copyts -y -nostats
  -codec:0 copy -codec:1 copy   ← STREAM COPY
  -f dash -seg_duration 5
  -dash_segment_type mp4
  -init_seg_name 'init-stream$RepresentationID$.m4s'
  -media_seg_name 'chunk-stream$RepresentationID$-$Number%05d$.m4s'
  -window_size 5 -delete_removed false
  -skip_to_segment 7
```

`-codec copy` means no re-encoding. Source bytes are remuxed into DASH segments. There's no encoder that could legitimately compress 1.5MB of source to 5.9KB.

### 4. Our proxy passes responses through byte-for-byte

`backend/src/0_system/proxy/ProxyService.mjs` is the actual proxy implementation (`PlexProxyAdapter.mjs` is just policy config — auth, retry, timeouts).

Critical lines:

```js
// line 190
res.writeHead(statusCode, responseHeaders);  // status + headers forwarded
// line 192
proxyRes.pipe(res);                            // body piped raw; no buffering, no length check
```

There is no body inspection, length validation, or transformation. Plex's `Content-Length` header is forwarded unchanged. The proxy logs no errors at the times in question.

### 5. The byte count Plex reported sending equals the byte count dash.js reported receiving

| Segment | Plex log "bytes sent" | dash.js `dash.fragment-loaded` `bytes` |
|---|---|---|
| 248 | 97,797 | **97,797** |
| 249 | 5,985 | **5,985** |

Exact match. **The proxy delivered every byte Plex sent.** The truncation is at the Plex layer or in the underlying segment file on disk.

### 6. The pattern is reproducible *within* the session, in deterministic bursts

The 02:01:33–35 UTC burst fetched segments 220–254 (35 segments, t=1100–1275) in 2.6 wall-clock seconds (~140 Mbps demand). Sizes (in order):

```
220: 405 KB   (normal lower end)
221: 1.34 MB  ✓
...
240: 602 KB
241: 465 KB
242: 2.27 MB  ✓
243: 644 KB
244: 2.33 MB  ✓
245: 1.46 MB  ✓
246: 464 KB   ← getting smaller
247: 618 KB
248: 97 KB    ← partial
249: 5.9 KB   ← severely truncated
250: 1.02 MB  ← snaps back to normal
251: 1.53 MB  ✓
252: 937 KB   ✓
```

The shape is: monotone decline as the fetcher catches up to the transcoder's write head, then a sharp recovery as the transcoder gets ahead again. This is consistent with a producer-consumer race.

### 7. Population scale: 47 anomalous video segments across the session

Out of 1,476 video fetches during the HTTYD window:

| Bytes range | Count | Class |
|---|---|---|
| 0 | 49 | Plex explicit "blank — overestimated" (Bug B, end-of-movie) |
| 1 – 100 KB | **47** | **Suspected race-condition truncation** |
| 100 – 500 KB | 273 | Smaller than typical but plausible |
| > 500 KB | 1,107 | Normal |

47 anomalous segments is roughly the same order of magnitude as the 81 observed `GapController` jumps.

---

## What's INFERRED but not yet proven

These all support the same hypothesis but each could have alternate explanations:

### A. That the small segments are actually truncated mid-write (not a deliberate Plex signal)

Plausible alternates I have NOT ruled out:
- Plex could deliberately send a small "stub" segment to indicate "not ready yet, ask again" — i.e. an undocumented signaling convention. (No evidence of this in Plex docs, and no `dash.error-recovery` was triggered, so the client treated them as valid.)
- Plex could be intentionally throttling response *body* size (not just response rate) when in "sloth mode."
- The on-disk segment file could already be 5985 bytes (a real, complete-but-tiny segment ffmpeg produced for some structural reason). Stream-copy doesn't *guarantee* segment size proportional to source bytes — segment boundaries are determined by keyframes and the `-seg_duration 5` setting; a segment ending mid-GOP could legitimately be smaller. I don't *think* this explains 5.9KB for 5 seconds at 24fps, but I haven't excluded it.

### B. That dash.js actually plays the partial bytes and the playhead-arrives-later effect causes the stall

I'm reasoning by elimination: gap times don't match source discontinuities (ruled out by ffprobe), don't match throttle events (sub-second cycles can't cause 1.2s stalls), and DO temporally align with prior fetches of partial segments (10 minutes earlier, matching playback rate). But I have not directly observed dash.js's MSE buffer state at the moment of decode failure — that data isn't in our logs.

### C. That the cause is HTTP pipelining of prefetch (vs. some other Plex bug)

The `pipelined: 116/117` log markers strongly suggest a pipelined HTTP/1.1 connection from one client. If dash.js issued requests serially with backpressure-aware delays, the transcoder would have time to finish writes. But the actual code in the dash.js fetch loop hasn't been audited yet to confirm pipelined behavior.

### D. That the underlying issue scales with content bitrate / disk write speed

If the segment file write speed is the limiting factor, this should be worse for higher-bitrate content and faster disks. We've only observed this for one title on one disk; we don't have data on whether other Plex content shows the same pattern at the same rate.

---

## What we DON'T know

1. **Does Plex declare an honest `Content-Length`?** I.e., does Plex set `Content-Length: 1500000` and then truncate the body to 5985 bytes, or does it set `Content-Length: 5985` to match the truncation? This determines whether a downstream length-check (in the proxy or in dash.js) could detect the problem.

2. **Are the on-disk segment files actually 5985 bytes at request time, or is Plex streaming-while-truncating?** The 0ms response time suggests an `open()/read()/close()` happens instantly, which implies the file *is* 5985 bytes when read. But Plex could also be sending a partial read of a larger file.

3. **What happens on a second fetch of the same segment a few seconds later?** Does Plex serve the complete file (because the transcoder has finished by then), or does it serve the same truncated bytes from cache?

4. **Does this happen on every Plex stream-copy session, or only under specific transcoder configurations?** The `-window_size 5 -delete_removed false` combination might be relevant, as might `-skip_to_segment`.

5. **Is there a Plex transcoder configuration that makes this go away?** Plex has internal settings around segment generation timing — we haven't tried any.

---

## Definitive verification plan (do BEFORE any code change)

These are the experiments that would conclusively answer the open questions. They require no fix — they are pure observation.

### Experiment 1: Re-run the race condition and capture wire-level data

```bash
# Start a fresh Plex DASH session for plex:654997 with offset=0
# Note the session ID from the URL

SESSION="<new-session-id>"

# Immediately burst-fetch 20 segments via curl in parallel
for i in $(seq 0 19); do
  curl -sS -D "/tmp/seg-${i}.headers" \
       -o "/tmp/seg-${i}.body" \
       "http://localhost:32400/video/:/transcode/universal/session/${SESSION}/0/${i}.m4s?X-Plex-Token=<token>" &
done
wait

# For each, record: HTTP status, Content-Length header, actual body size, then bytes-on-disk in Plex's transcode dir
for i in $(seq 0 19); do
  echo "--- seg ${i} ---"
  head -5 "/tmp/seg-${i}.headers"
  wc -c "/tmp/seg-${i}.body"
  # The corresponding on-disk file Plex serves from:
  sudo docker exec plex stat "/transcode/Transcode/Sessions/plex-transcode-${SESSION}-*/chunk-stream0-$(printf '%05d' $((i+1))).m4s"
done
```

This tells us:
- Whether `Content-Length` matches body size (or is honest about the truncation)
- Whether the on-disk file is the truncated size or full
- Whether Plex returns 200 even when the file is incomplete

### Experiment 2: Compare direct-from-Plex vs through-our-proxy for the same segment

```bash
# Direct
curl -sS -o /tmp/direct.bin "http://localhost:32400/video/:/transcode/universal/session/${SESSION}/0/5.m4s?X-Plex-Token=<token>"
# Through proxy
curl -sS -o /tmp/proxy.bin "http://localhost:3111/api/v1/proxy/plex/video/:/transcode/universal/session/${SESSION}/0/5.m4s"
diff /tmp/direct.bin /tmp/proxy.bin
md5sum /tmp/direct.bin /tmp/proxy.bin
```

If checksums match, proxy is definitively transparent. (Code review already strongly indicates this, but byte-for-byte hash is the gold standard.)

### Experiment 3: Re-fetch a known-truncated segment after a delay

```bash
# Trigger truncation via Experiment 1, find a segment that came back small
# Then wait 5s and fetch it again
sleep 5
curl -sS -o /tmp/refetch.bin "http://localhost:32400/video/:/transcode/universal/session/${SESSION}/0/<bad-idx>.m4s?X-Plex-Token=<token>"
wc -c /tmp/refetch.bin
```

If the refetch returns more bytes, this proves Plex is serving partial-write state and that a simple client-side retry would fix it. If the refetch still returns the same bytes, the segment is genuinely tiny on disk and we need a different approach.

### Experiment 4: Disable HTTP pipelining and re-observe

Set dash.js to use HTTP/1.0 or force `Connection: close` on segment requests; or set the Plex client agent to disable pipelining. Re-play HTTYD start-to-end and count `GapController` jumps. If the count drops dramatically, pipelining is the amplifier and disabling it (or limiting pipeline depth) is the fix lever.

### Experiment 5: Reduce dash.js lookahead and re-observe

Set `MediaPlayerSettings.streaming.buffer.bufferTimeAtTopQuality` to 30s, re-play, count jumps. Less aggressive prefetch ⇒ fewer races with the transcoder.

---

## What the report deliberately does NOT do

- **No fix recommendation yet.** The Phase-3 list in the predecessor report (`...-recurring-micro-stalls...`) suggested a proxy-side length-check, a client lookahead cap, and dash.js box-validation. None of those should be implemented until at least Experiments 1, 2, and 3 are run. The right remediation depends on the answers:
  - If `Content-Length` is honest → trivial proxy guard works (refetch on size < N).
  - If `Content-Length` lies → proxy guard needs to actually read the body and validate `moof+mdat` structure (much harder).
  - If on-disk file is the truncated size → no client retry will help; need Plex-side fix.
  - If pipelining is the amplifier → fix may be as simple as a Node `Agent` configuration on the proxy.

- **No claim that the proxy is "the bug."** The proxy is confirmed innocent of byte modification. The most that could be argued is that *because* the proxy is the right chokepoint between dash.js and Plex, it is the right *place* for a corrective measure — but that's a remediation decision, not a defect attribution.

---

## Evidence inventory

- Plex main log (current + rotated `.1`):
  `/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log`
  `/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.1.log`
  - 19:01:37.784 — 200 GET seg 248 → 97797 bytes (0ms)
  - 19:01:37.808 — 200 GET seg 249 → 5985 bytes (0ms)
  - 117-deep HTTP pipeline confirmed via `pipelined: N` markers
  - ffmpeg invocation: `-codec copy -f dash -seg_duration 5 -window_size 5 -skip_to_segment 7`
- DaylightStation backend log: `sudo docker logs daylight-station --since 24h`
  - `dash.fragment-loaded` events with `index`, `startTime`, `bytes` for all 1,476 video segments
  - 47 segments with `bytes` in (1, 100000)
- Source file ffprobe: `/media/kckern/Media/Movies/How to Train Your Dragon (2010)/How to Train Your Dragon (2010).mp4`
  - t=1240–1245 packets sum to 750,114 bytes (vs Plex's 97,797)
  - t=1245–1250 packets sum to 1,511,679 bytes (vs Plex's 5,985)
- Proxy source: `backend/src/0_system/proxy/ProxyService.mjs` lines 190–192 (writeHead + pipe)
- Proxy adapter: `backend/src/1_adapters/proxy/PlexProxyAdapter.mjs` (policy only)

## Related

- `docs/_wip/bugs/2026-05-26-httyd-recurring-micro-stalls-throughout-playback.md` — established the symptom
- `docs/_wip/bugs/2026-05-26-httyd-movie-playback-second-opinion.md` — covers Bug A (phantom Player), Bug B (end-of-movie blanks), Bug C (idle-kill race); different mechanisms
- `docs/_wip/bugs/2026-02-28-playback-stall-recovery-reuses-broken-session.md` — same shape (partial segment lives in buffer), narrower scope
