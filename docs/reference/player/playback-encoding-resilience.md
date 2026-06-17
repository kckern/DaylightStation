# Playback Encoding Resilience

How the backend decides whether Plex should **copy** a video stream or **re-encode**
it, and why that decision is the difference between buttery native-framerate
playback and a video that stalls every few seconds. This is the nuanced part of
playback resilience: most stalls people blame on "the network" are actually a Plex
encoder falling behind realtime because we asked it to re-encode something it
could have copied.

**The governing constraint:** Chromium/Firefox MSE (Media Source Extensions, which
dash.js feeds) can only append fMP4 segments whose codec the SourceBuffer was
opened with. We advertise **h264 and hevc only**. AV1/VP9 fMP4 appends are
rejected outright. So every decision below exists to land on an h264/hevc stream
the client can actually play, as cheaply as possible.

---

## The three transcode modes

Plex's `/video/:/transcode/universal/decision` endpoint resolves a request into
one of three outcomes. Which one you get depends on the client profile and caps we
send:

| Mode | What Plex does | Cost | When it's right |
|------|----------------|------|-----------------|
| **directPlay** | Serves the original file byte-for-byte, no processing | Free | Source is already h264 + aac in mp4 — playable as-is |
| **directStream** | Copies streams that match the profile, transcodes only the ones that don't (and remuxes the container) | Cheap — a video *copy* plus maybe an audio transcode | Video is h264/hevc but audio or container don't match |
| **directStream=0** (re-encode) | Re-encodes **everything**, even tracks that already matched | Expensive — full software libx264 encode in realtime | Source codec the client can't play (av1/vp9), or we forced it |

The trap is the gap between directStream and re-encode. A 60fps h264 source whose
only "problem" is opus audio in an mp4 should land on **directStream**: copy the
video untouched, transcode the audio to aac, remux. Instead, a misplaced cap can
knock it down to a full re-encode of the 60fps video — and a software libx264
encode of 1080p60 routinely falls behind realtime, producing the stall.

---

## Caps disqualify the copy, not just the play

This is the subtle, costly insight (the 2026-06-16 "Game Cycling" incident):

> A Plex **profile limitation** — e.g. a 30fps frame-rate upper bound, a max
> bitrate, or a max resolution — disqualifies stream **copy**, not just
> direct-play. If the source is 60fps and you send a 30fps cap, Plex cannot copy
> the 60fps track (it violates the cap), so it falls back to re-encoding the video
> down to 30fps.

So a cap meant only to keep a *forced re-encode* from running away (cap the
encoder's output so it stays ahead of realtime) leaks onto the copy path and
*forces* the very re-encode it was trying to bound — at half the source framerate,
and stalling anyway because even 30fps realtime libx264 is marginal here.

### The fix: gate caps on direct-stream eligibility

The caps (frame-rate limitation, max bitrate, max resolution) must only be sent
when the stream is **not** direct-streamable — i.e. when a re-encode is genuinely
unavoidable. The gate is direct-stream eligibility, not direct-play eligibility:

- **directPlay-eligible** (h264 + aac + mp4): send no caps — serve as-is.
- **directStream-eligible** (video codec is h264 or hevc): send **no caps** — let
  Plex copy the video track at its native framerate/bitrate/resolution and only
  transcode audio + remux. This is the path that keeps **native 60fps**.
- **neither** (av1/vp9/etc.): send the caps — a re-encode is forced anyway, and
  the caps keep that encode ahead of realtime.

The codec advertisement (`h264,hevc` only) already prevents an av1/vp9 source from
being direct-streamed as something MSE can't append, so opening up directStream for
h264/hevc is safe.

### Why this delivers 60fps and not a 30fps cap

When the copy path is taken, the bytes are the **source** bytes: source framerate,
source bitrate, source codec level. For a 1080p60 h264 source that means the MPD
advertises `avc1.64002a` — H.264 High @ **Level 4.2**, which is mandatory for
1080p60. A 30fps re-encode would have shown up as Level 4.0 (`avc1.640028`). The
bandwidth in the manifest equals the exact source bitrate (passthrough), and
in-browser segment fetches drop from ~1.5s each (live-edge, encode-bound) to
~150ms (copy). That is the proof the stream is copied, not re-encoded — and the
reason 60fps content plays at 60fps.

---

## Decision gates (backend)

The adapter computes two booleans from the item's media metadata and feeds them
through the decision request and the transcode-URL builder:

| Gate | True when | Effect |
|------|-----------|--------|
| `allowDirectPlay` | h264 video **and** aac audio **and** mp4 container | Plex may serve the file as-is |
| `allowDirectStream` | video codec is h264 **or** hevc (regardless of audio/container) | Plex may copy the video track; caps are **omitted** |

`allowDirectStream` is the superset (`allowDirectPlay || canDirectStreamVideo`).
Both the client-profile-extra (which carries the frame-rate limitation) and the
`maxVideoBitrate` / `maxVideoResolution` query caps are gated on
`!allowDirectStream`. When the stream can be copied, none of them are sent.

The caps that apply only on the forced re-encode path:

| Cap | Default | Purpose |
|-----|---------|---------|
| max video bitrate | 8000 kbps | Was uncapped (~20 Mbit from source) — keeps the encoder ahead of realtime |
| max resolution | 1080p | Never upscale |
| max frame rate | 30 | Halves encoder load on a genuine re-encode |

These are **ceilings, never amplifiers** — an explicit request can lower them but
never raise them above the defaults, and a null/0 request resolves to the default
(not to "uncapped", which Plex reads as CRF-quality 20 Mbit encodes).

---

## Encode-bound stall signature

When a stream is wrongly re-encoded and the encoder can't keep up, the failure has
a recognizable shape — distinct from a network stall or a dead session:

- **Sawtooth playback:** plays ~4–5s, stalls ~1–1.5s, repeats (roughly a ~6s cycle).
- **Buffer never exceeds ~one segment (~3s)** — it can't get ahead because segments
  are generated just-in-time at the live edge.
- **Audio and video drain to zero together** (a source audio gap, by contrast,
  freezes audio's buffer level while video keeps draining).
- **Segment fetches ~1.5s each** in the browser (encode-bound) vs ~150ms when
  copied vs ~12ms for a pre-generated/cached segment.

If you see this, check the decision and the MPD before touching the network: was
the stream re-encoded when it could have been copied? Confirm via the codec level
(`avc1.64002a` = copied 1080p60) and the manifest bandwidth (source bitrate =
passthrough).

---

## Related failure modes (not encoding)

Encoding is one cause of stalls; the resilience layers handle the others. Don't
conflate them:

- **Dead transcode session** — `dash.error` 27/28, MPD points at a stale UUID;
  fixed by URL refresh, not by re-deciding the encode.
- **Transcode warmup** — 0-byte segments while the encoder spins up; transient,
  the overlay rides it out.
- **Source audio gap** — DASH stalls at one exact timestamp because the source has
  a gap and Plex remuxes with `-copyts`; not an encoding decision at all.
- **Codec mismatch** — VP9/AV1 fMP4 rejected by the SourceBuffer; prevented
  upstream by advertising only h264/hevc.

See the resilience runbook for diagnosing each.

---

## Where this lives

| Concern | File |
|---------|------|
| Decision request + transcode-URL builder + gate wiring | `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` |
| Caps, codec advertisement, direct-play / direct-stream gates | `backend/src/1_adapters/content/media/plex/transcodeProfile.mjs` |
| Regression tests for the caps-gating contract | `tests/isolated/adapter/content/media/plex/PlexAdapter.loadMediaUrl.test.mjs` |
| Client-side renderer + dash diagnostics | `frontend/src/modules/Player/renderers/VideoPlayer.jsx` |

## Related docs

- `docs/reference/player/README.md` — the Player subsystem and its resilience layers
- `docs/reference/player/lessons-and-gotchas.md` — encoding/transcode failure modes & history (AV1/VP9 advertise revert, force-re-encode revert, idle-reap, warmup)
- `docs/reference/media/dash-video-resilience.md` — stall/seek troubleshooting runbook
- `docs/reference/content/content-playback.md` — content → playable → stream URL
