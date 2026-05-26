# HTTYD Movie Playback — Second-Opinion Investigation (2026-05-26)

**Status:** Investigation complete. Multiple findings overturn or correct the original audit (`docs/_wip/audits/2026-05-26-httyd-movie-playback-audit.md`). Plex Media Server's own logs (`/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log`) provided the definitive evidence for Bugs B and C.

**File:** `plex:654997` — *How to Train Your Dragon (2010)* — `How to Train Your Dragon (2010).mp4`
**Session window:** 2026-05-26 01:12–03:27 UTC (2026-05-25 18:12–20:27 PDT)
**Symptoms reported by audit:** phantom Starting… overlay all movie; 83-second freeze at 40:25; 47 zero-byte video segments at end.

---

## TL;DR — what changed vs. the audit

| Audit claim | Verdict after log + source verification |
|---|---|
| **Bug A trigger** = "second play-now mounted a second Player" | **Wrong target.** The `commands.queue play-now` at 01:14:08 hot-swapped into the existing player. The phantom mounted 12 seconds later at 01:14:20 from `nav.push type:'player'` in `MenuStack.jsx:124`, dispatched by `playback.intent source:menu-selection title:"Season 93387"`. |
| **Bug A fix direction** = "tear down existing player before play-now" | **Targets the wrong path.** The play-now path was fine. The missing guard is on `MenuStack`'s player push when a screen-level Player is already mounted. |
| **Bug B root cause** = "source file likely damaged in last 4 minutes" | **Falsified by ffprobe AND Plex's own log.** Source is intact (avg 7,094 bytes/packet at t=5640–5870, clean decode). Plex's log says it plainly: `Sending back blank segment for 1128, we overestimated the number of segments.` (repeated through 1174). This is **Plex's intentional behavior for a manifest-vs-output mismatch.** |
| **Bug B's affected session** = `34d4f202` | **Wrong session.** Plex log shows the blank segments are returned by session **`3a2b60dd`** (the post-gap recovery session), not `34d4f202`. The audit transposed sessions. |
| **Bug C root cause** = "corrupt/missing data in session 34d4f202" | **Wrong mechanism.** Plex log shows audio segment 488 returned **404 (not 0 bytes)** because Plex's idle-session cleanup killed session `34d4f202` (`Killed 1 idle sessions out of a total of 1` at 19:30:24 PDT, 10 seconds before dash.js asked for the segment). Not data corruption — session expiry race. |
| **Bug D root cause** = "transcode warmup lag" | **Falsified.** Two independent transcode sessions (`183be5bf`, `6e8323c8`) produced **byte-identical** outputs for segments 0–9 (idx 4 = 11,953, idx 5 = 11,585). Warmup wouldn't be deterministic. ffprobe shows the *source* packets at t=20–25 average ~3 KB — legitimately low-motion content. Heavy transcode compression on low-motion content; not a bug. |
| **`postEpisodeRedirect.js` may dispatch play-now** | **Dead lead.** Fitness-only module returning a navigation intent; cannot dispatch playback. Flagged because it was in `git status`. |
| **Transcode session map lists `ezu6ayt5oiz6iti2` as a session** | **Confusion of terms.** That string is a prewarm token (issued by backend `prewarm.success`). The Plex session for that startup is `6e8323c8-6ed9-4089-bddb-c5249776d7a8`. |
| **`PlexProxyAdapter.mjs` involvement** | **No.** Thin policy layer (auth, retry, timeout). Does not read/transform response bodies. A 0-byte 200 from Plex passes through unmodified. |

---

## Bug A — Phantom Player

### Symptom confirmed

Two waitKeys emit `playback.overlay-summary` concurrently from 01:14:20 onward:

- `005bb6d64a` — the HTTYD player; paused at t=3.2 by the menu-driven blur
- `00e4b109ae` — phantom, `status:Starting… el:t=0 startup:armed attempts=0` forever

The phantom was still emitting at 02:30:25 (`vis:4565004ms`). It survived the entire 2h14m movie.

### Actual trigger — the timeline that matters

```
01:14:16.650  fkb.keyCapture Enter      → nav.push type:season-view
01:14:16.652  ArrowLeft                  (navigating the season view)
01:14:16.677  dash.playback-started      (HTTYD player resumes at t=0 from a bump-seek)
01:14:19.967  fkb.keyCapture Enter       (second Enter)
01:14:19.969  playback.intent { title:"Season 93387", source:"menu-selection",
                                isQueue:false, queueLength:1 }
01:14:19.970  nav.push { type:"player" }              ← MenuStack.jsx:124
01:14:19.995  playback.paused mediaKey:plex:654997 currentTime:3.197052
01:14:20.037  NEW waitKey 00e4b109ae: status:Starting… el:t=0
```

The user selected a season-collection node (no playable `contentId` — note the missing `contentId` field in the intent) from the menu overlay. `MenuStack.handleSelect` reached the `selection.play || selection.queue` branch and called `push({ type: 'player', props: selection })`. The MenuStack's overlay tree mounted a Player; the screen-framework's HTTYD Player was unaffected and remained in the React tree.

### Why is this two Players? — feature vs. bug

This is a **feature without bounds**, not a pure bug.

The architecture is legitimate: `MenuStack` is an overlay that can mount its own Player when the user picks something playable from the menu (browse → select → play, without leaving the screen). It's the same mechanism that powers menu-launched music, slideshows, and one-shot playback during a screen session.

The legitimate cases all assume the screen below isn't already running a Player. There's no design contract for "screen Player + menu Player both alive." When that happens:

1. **Z-order is undefined** — the menu Player's overlay can paint on top of an active screen Player.
2. **The menu Player gets `selection.play` whose `contentId` may be `null`** (as here — season node, no episode picked). With no mediaKey there's no media to load → `effectiveMeta` never resolves to a media-bearing object → `shouldArmStartupDeadline` evaluates with `hasMediaMeta=false` → the startup deadline arms but the underlying timer condition never fires. Status stays `Starting…` indefinitely.
3. **The screen-level Player's input was stolen** — `playback.paused` fires on HTTYD at 01:14:19.995 because focus/visibility transferred to the menu.

So two issues compound:
- **Feature gap:** `MenuStack` push of `type:'player'` doesn't check whether a screen-level Player is already mounted.
- **Startup deadline gap:** A Player with `effectiveMeta` but no media element should fail-fast, not sit `armed` forever.

Both should be fixed. The first is the architectural fix; the second is the defense-in-depth.

### What `PlayerOverlayLoading` does in this case

For `00e4b109ae`: `effectiveMetaIsNull` is `false` (queue metadata existed; just no resolvable content), so the loading overlay renders. `hasEverPlayedRef.current` is `false`. `shouldShowOverlay = isStartup && !hasEverPlayedRef.current` ⇒ `true`. The "Starting…" overlay paints over whatever screen content is visible. The screen Player can keep playing HTTYD behind it.

---

## Bug B — 47 zero-byte video segments at end of movie

### Plex itself explains it

From Plex's main log (PDT timestamps), session `3a2b60dd-c630-472d-ac56-ad209418bdf5`:

```
20:26:14.314  Sending back blank segment for 1128, we overestimated the number of segments.
20:26:14.664  Sending back blank segment for 1129, we overestimated the number of segments.
20:26:15.033  Sending back blank segment for 1130, we overestimated the number of segments.
…             (continuous, one per ~200 ms)
20:26:21.127  Sending back blank segment for 1157, we overestimated the number of segments.
```

**Plex deliberately returns empty segments when the client requests segments past what the transcoder actually produced.** This is Plex's intentional behavior, not a bug in the source or a corrupted segment. The manifest declared more segments than the transcoder generated; Plex serves blanks to satisfy the requests rather than 404ing every one.

### Why did the transcoder produce fewer segments than its manifest declared?

The session that returned blanks is **`3a2b60dd`**, the recovery session that started mid-file after Bug C. Its ffmpeg invocation (also from Plex's log):

```
"Plex Transcoder" "-codec:#0x01" h264 -ss 2425 -noaccurate_seek
  -i ".../How to Train Your Dragon (2010).mp4" -start_at_zero -copyts
  -codec:0 copy -codec:1 copy -f dash -seg_duration 5
  -skip_to_segment 486 -window_size 5 -delete_removed false
  ...
```

Notes:
- This is **stream-copy** (`-codec copy`), not re-encoding. Bytes are passed through.
- `-skip_to_segment 486` numbers the first output segment as 486 (correlates with the seek to t=2425).
- The session continued from segment 486 (where Bug C left off) and ran to end-of-file.

When the transcoder reached EOF, the actual count of produced segments was lower than the manifest's `ceil(5871.104 / 5) = 1175`. Plex's segment math (which projects from total duration) ran past the transcoder's actual production cutoff at segment 1127, hence "we overestimated."

This is a Plex-internal accounting issue, likely related to `-skip_to_segment` + `-copyts` + `-window_size 5` interaction at EOF. It is not present in fresh-from-zero sessions of the same file.

### ffprobe confirms the source is intact

| Metric | Value |
|---|---|
| Format duration | 5871.104 s |
| Video stream duration | 5870.99 s |
| Total video frames | 140,763 (= 23.98 fps × 5870.99 s ✓) |
| Avg packet size t=0–10 (logos) | 4,256 bytes |
| Avg packet size t=20–30 (Bug D) | 6,093 bytes |
| Avg packet size t=40–50 | 5,657 bytes |
| **Avg packet size t=5640–5870 (Bug B)** | **7,094 bytes** |
| Packets in t=5640–5870 | 5,636 |
| Keyframes near boundary | 150KB @ 5634.96, 140KB @ 5644.97, 144KB @ 5654.98 |
| Decode test (`ffmpeg -ss 5640 -t 230 ... -f null -`) | Clean, no errors |

The minor 114ms gap between `format.duration` (5871.104) and `video stream duration` (5870.99) may be what trips Plex's segment-count math when combined with `-skip_to_segment`.

### Audio in same window

Audio drops dramatically rather than going to zero (idx 1126 = 11,581 bytes, idx 1127 = 15,441 bytes — vs ~600KB earlier). Audio doesn't request past idx 1127 — the player reached its natural end and `playback.paused at currentTime:5871.103999, duration:5871.103999` fires at 03:27:06 UTC.

### `PlexProxyAdapter` is not at fault

`backend/src/1_adapters/proxy/PlexProxyAdapter.mjs` provides only:
- Auth params (`X-Plex-Token`)
- Retry config (max 20 retries, 500ms delay) on `429` and `5xx`
- `shouldRetry(statusCode)` — does not retry `4xx`
- 60-second timeout
- Path transform (strips legacy `/plex_proxy` prefix)
- Optional thumbnail cache headers

It never reads or modifies the response body. A `200 OK` with `Content-Length: 0` from Plex passes through unchanged. The 0-byte segments are Plex's output, not the proxy's truncation.

### Proposed app-side mitigation (downgraded from P1)

Detect a run of strictly-zero-byte **video** fragments, **with the corresponding audio fragments still arriving normally**, as the proactive trigger for `dash.error-recovery → refresh-url`. The "audio still arriving" guard prevents false positives at legitimate end-of-content. Threshold: ≥3 consecutive zero-byte video segments.

This is a workaround. The real fix is on the Plex side (or by re-encoding the source's end with non-static content, which is not worth doing for one title).

---

## Bug C — gap at t=2425s

### Plex log shows: idle session cleanup race, not corrupt data

Plex's own log around 19:30 PDT:

```
19:21:14.503  GET .../34d4f202/0/488.m4s  → 200, 1305925 bytes  (video seg 488 served fine)
19:27:23.456  GET .../34d4f202/1/487.m4s  → 200, 290262 bytes   (audio seg 487 served fine)
19:30:24.651  Killing job.
19:30:24.651  Stopping transcode session 34d4f202-4447-4ade-850e-896c87682bc4
19:30:24.692  Killed 1 idle sessions out of a total of 1.
19:30:27.340  Terminated session 0x7b2fa52b0ff8:lvux4iw2tigzaqon8upwyg with reason "Client stopped playback"
19:30:34.103  GET .../34d4f202/1/488.m4s  → 404, 379 bytes      ← dash.js requests after kill
19:30:35.126  GET .../34d4f202/1/488.m4s  → 404, 379 bytes      ← dash.js retry
19:30:36.145  GET .../34d4f202/1/488.m4s  → 404, 379 bytes      ← dash.js retry
19:30:37.299  New ffmpeg job for session 3a2b60dd starting at -ss 33 -skip_to_segment 7
19:30:37.675  Killing job 3a2b60dd (the wrong one)
19:30:37.678  New ffmpeg job for session 3a2b60dd starting at -ss 2425 -skip_to_segment 486
```

The frontend's view of the same events:

```
02:30:30.593  GapController jumping gap 2425.631541 → 2428.509416 by 2.877875s
02:30:30.598  programmatic seek to 2428.509416, drift 0.021
02:30:32.184  dash.buffer-stalled type:audio
02:30:33.850  playback.stalled at 2430.18823, stallDurationMs=1487
02:30:34.488  dash.error: session/34d4f202.../1/488.m4s not available
02:30:34.498  dash.error-recovery refresh-url attempt=3
02:30:34.584  stream-url-refreshed → new session 3a2b60dd
02:30:34.892  start-time-applied actual=2427.509416 (sticky resume)
```

### Reconstructed sequence

1. User watched smoothly through ~t=2440 — Plex served video segments 487-492 (~t=2435-2460) at 19:21:14, audio segment 487 at 19:27:23.
2. dash.js had buffered ahead. The user-visible play position was somewhere short of t=2440.
3. **Long pause** — Plex didn't see any new segment requests for ~3 minutes (19:27:23 → 19:30:24). Plex's idle cleanup killed session `34d4f202` and terminated the client session `lvux4iw2tigzaqon8upwyg` with reason "Client stopped playback."
4. dash.js GapController at 19:30:30 detected a 2.88s timeline gap in its buffer between t=2425.6 and t=2428.5 — likely an artifact of how dash.js reconciles its decoder buffer when the playhead approaches the end of pre-pause buffered content.
5. After the auto-jump, dash.js requested audio segment 488 → Plex returns 404 (session is dead), retries 3 times.
6. App's `dash.error-recovery` kicks in (attempt=3 matches Plex's three 404s), refreshes the manifest URL with `_refresh=` cache-buster.
7. Plex starts a new session `3a2b60dd` with ffmpeg invoked at `-ss 33`, immediately killed because the manifest re-request actually wanted `-ss 2425 -skip_to_segment 486`.
8. Session `3a2b60dd` resumes cleanly. (It will later trip Bug B at end-of-file due to `-skip_to_segment` segment-count math.)

### The audit's diagnosis is partly wrong

- "Corrupt/missing data in session `34d4f202`" — **wrong**. Data wasn't corrupt; the session was killed for idleness.
- "URL refresh recovered" — **correct**, but the underlying mechanism is Plex returning 404 (not Plex returning a bad segment), and the app's existing `segment-unavailable` recovery handled it.
- "83-second user-visible freeze" — **correct**, but framed as the cost of corrupt-data recovery. It's actually the cost of Plex's idle cleanup colliding with dash.js's buffered-then-resumed playback.

### Implication

If the user pauses long enough for Plex's idle cleanup to fire (default ~60 seconds of no segment requests after the buffer is full), the next resume will trip this pattern. The app's recovery handles it but with a long visible stall. Mitigations:

- **Backend keep-alive ping** during pause: hit `/video/:/transcode/universal/session/<id>/0/<n>.m4s` periodically (with a HEAD request) to keep Plex from idle-killing the session.
- **Or** preemptively refresh-url on resume after a pause longer than N seconds, before dash.js asks for the next segment.

The audit didn't identify this as the mechanism, so its mitigation discussion missed the obvious lever.

---

## Bug D — small startup fragments at t=20–25s

### "Warmup lag" falsified by cross-session byte identity

Two independent transcode sessions produced **identical** video byte counts for indices 0–9:

| idx | startTime | session `183be5bf` bytes | session `6e8323c8` bytes |
|-----|-----------|---|---|
| 0 | 0 | 1,237,064 | 1,237,064 |
| 1 | 5 | 1,482,390 | 1,482,390 |
| 2 | 10 | 1,418,846 | 1,418,846 |
| 3 | 15 | 253,966 | 253,966 |
| 4 | 20 | **11,953** | **11,953** |
| 5 | 25 | **11,585** | **11,585** |
| 6 | 30 | 779,994 | 779,994 |
| 7 | 35 | 941,006 | 941,006 |
| 8 | 40 | 127,579 | 127,579 |
| 9 | 45 | 1,181,419 | 1,181,419 |

Warmup is not deterministic across sessions started two minutes apart. Either Plex is serving cached segment files for repeat-encodes, or the segmenter is purely a function of source content.

### Source has legitimately low-motion content at t=20-25

ffprobe shows source packets at t=20–25 average ~3KB each — well-encoded but very low motion (this is shortly after the studio logos in HTTYD, before the cold-open action). The transcode output of ~12KB / 5s is heavy compression of low-motion content, not a bug.

### Drop the "proactive refresh on small segments" recommendation

If Bug D segments are legitimately low-motion content, an app-side detector keyed on segment size will false-positive at every quiet shot in the film. Only the *strictly* zero-byte run from Bug B is a reliable signal — and even that needs the "audio still arriving" guard.

---

## Transcode session map — corrected

| Identifier | Type | Role | Notes |
|---|---|---|---|
| `p6lt4t03ixr7vqo9` | Prewarm token | First load (backend `prewarm.success`) | — |
| `183be5bf-…` | Plex session | First startup, t=0 → user pause at t=37 | — |
| `ezu6ayt5oiz6iti2` | Prewarm token | Second load (hot-swap into existing player) | Audit called this a "session ID" |
| `6e8323c8-…` | Plex session | Same player, new source URL with `&offset=33` | Byte-identical to `183be5bf` for idx 0–9 |
| `c62b9446-…` | Plex session | Post-pause resume at 01:48:51 | Recovered via `refresh-url` after `6e8323c8` expired |
| `34d4f202-…` | Plex session | Long-running mid-movie session | Gap at t=2425, zero-byte tail at t=5640+ |
| `3a2b60dd-…` | Plex session | Post-gap recovery to end of movie | Clean |

---

## Recommendations — revised

| Priority | Action | Why |
|---|---|---|
| **P0** | Add a guard in `MenuStack.handleSelect` (`MenuStack.jsx:103-124`) that detects an active screen-level Player and either rejects the new player push or unmounts the existing player first. | Root cause of Bug A. |
| **P0** | Reject `playback.intent` / `selection.play` payloads with no resolvable `contentId` *before* `nav.push type:'player'`. The "Season 93387" item didn't have one. | Prevents the "Starting… forever" trap regardless of Z-order. |
| **P1** | Pause-aware session keep-alive: when the player is paused for longer than N seconds, either (a) HEAD-ping a current segment to keep the Plex session warm, or (b) preemptively refresh-url on resume before dash.js's next segment request fails. | Eliminates Bug C entirely. Idle-kill race is the real cause, not data corruption. |
| **P1** | Audit `shouldArmStartupDeadline`: an `armed` deadline that never fires across 8000+ seconds is a bug independent of Bug A. The deadline should fire even when `hasMediaMeta=false` so phantom mounts self-destruct. | Defense in depth. |
| **P2** | Bug B specific: when a refresh-url session is created from mid-file (`-skip_to_segment` present in the new manifest URL), expect end-of-stream blank-segment behavior. Either (a) keep `isPausedAtDuration` guard tight so the user never sees a spinner at end-of-content (currently working), or (b) suppress the end-of-stream segment requests once the player crosses the last "known good" segment threshold. | Specific to Plex's `-skip_to_segment` segment-count miscalculation. The current guard already handles the user-visible side; this would just reduce wasted requests. |
| **P2** | Log a correlating `mountTrigger` field on every Player mount so waitKeys are attributable to either `commands.queue` (device-load) or `nav.push type:'player'` (menu-selection). The data exists in separate events — they just aren't joined. | Diagnostic. Original audit had to guess. |
| **DROP** | Audit's "Audit `postEpisodeRedirect.js`" recommendation. | Wrong file. |
| **DROP** | Audit's "Tear down existing player before mounting new one on play-now". | Wrong path. The play-now hot-swap worked correctly. |
| **DROP** | Audit's "Detect 0-byte segment runs, trigger session refresh". | Plex's blank segments are *intentional* — refreshing would just create another `-skip_to_segment` session with the same end-of-file behavior. |
| **DROP** | Audit's "Check source file integrity (ffprobe last chapter)". | Already done — source is clean. |
| **DROP** | Audit's hypothesis that session `34d4f202` is "fundamentally broken for plex:654997". | Session was idle-killed; not broken. |

---

## Open questions

1. **Why two `/api/v1/device/livingroom-tv/load?queue=plex:654997` calls** (18:11:42 and 18:14:06 PDT)? Backend access log will show source IP and User-Agent. Not a bug per se — the second call hot-swapped cleanly — but worth knowing whether it was a user retry, a kitchen-button double-press, an HA automation, or a stale tab somewhere.

2. **What menu state put a "Season 93387" item in front of the user at 01:14:19** while HTTYD was already playing? The screen-framework's MenuStack opened on top of an active Player. Was that triggered by a remote shortcut (e.g., the prior `nav.push type:season-view` at 01:14:16)? Investigating the menu-open trigger would close the loop on why this state was reachable.

3. **Plex transcoder repro:** can the zero-byte tail be reproduced with a fresh session targeted directly at `&offset=5640`? If yes, it's reproducible and worth a Plex bug report. If no, it's a long-session degradation specific to this title.

---

## Evidence inventory

- DaylightStation backend logs: `sudo docker logs daylight-station --since 24h` — full session 01:12–03:27 UTC available
- Plex main log: `/media/kckern/DockerDrive/Docker/Media/plex/Logs/Plex Media Server.log` (PDT timestamps)
  - "Sending back blank segment for X, we overestimated the number of segments" — Bug B in Plex's words
  - "Killing job. Stopping transcode session 34d4f202" / "Killed 1 idle sessions out of a total of 1" — Bug C root cause
  - 404 responses for audio segment 488 after the kill
  - ffmpeg invocation showing `-codec copy` (stream copy), `-skip_to_segment 486`, `-window_size 5`
- Plex docker logs: only 30 lines/day, just chapter-thumbnail chatter. Plex doesn't log streaming to stdout.
- Player overlay state confirmed via `playback.overlay-summary` events (per-waitKey heartbeats)
- DASH segment bytes from `dash.fragment-loaded` events with `index`, `startTime`, `bytes`
- DASH session IDs from `dash.fragment-loading` URLs (`session/<uuid>/<stream>/<idx>.m4s`)
- Menu navigation chain from `fkb.keyCapture` → `remote.key` → `nav.push` → `playback.intent` events
- Source file: `/media/kckern/Media/Movies/How to Train Your Dragon (2010)/How to Train Your Dragon (2010).mp4`
  - ffprobe duration, packet sizes, keyframe positions
  - ffmpeg null decode test through the Bug B range — clean
- `PlexProxyAdapter.mjs` source-code review — body-pass-through confirmed
- `MenuStack.jsx:103-124` — `selection.play` branch confirms `push({ type: 'player', props: selection })`
- `Player.jsx:414-418` — `resolvedWaitKey = ${mediaIdentity || effectiveMeta.waitKey}:${remountState.nonce}` — different waitKey implies different mount or remount-nonce bump
