# Media app: two Plex items would not play

**Date:** 2026-09-14
**Surface:** MediaApp on a desktop Chrome (the Player's DASH path)
**Sources:** log store (`dash.error`, `playback.fetch-media-failed`), the Plex Media Server
log, ffprobe on the source file, the Plex decision endpoint

Two unrelated failures in the same half hour. Neither was the proxy or the frontend.

---

## 1 — a film stalled at t=0 on every attempt: multichannel AAC with no channel layout

**Symptom.** A newly added movie loaded its manifest and both init segments, then
`dash.error` on the first appended audio segment:

```
MEDIA_ERR_SRC_NOT_SUPPORTED (PipelineStatus::CHUNK_DEMUXER_ERROR_APPEND_FAILED:
RunSegmentParserLoop: stream parsing failed.)
```

followed by `playback.stalled phase=startup` three times. Recovery reloaded the same URL
each time, which reproduced it.

**What each layer did.**

| Layer | Evidence | Verdict |
|---|---|---|
| Plex | Transcoder ran `-codec:0 copy -codec:1 copy -f dash`; segments 0–4 produced; init segments served at 785 and 856 bytes | did what it was asked |
| Proxy | the player received the same 785 / 856 bytes Plex logged serving | passed the bytes faithfully |
| Frontend | appended them; Chromium's MP4 parser rejected the audio | surfaced the error |
| **Source + our request** | AAC-LC, 6 channels, ADTS `channel_configuration 0`; ffprobe `channel_layout=unknown`; Plex "Unknown (AAC 5.1)" with no `audioChannelLayout` — and we allowed the audio to be stream-copied | **root cause** |

`channel_configuration 0` means the speaker layout is defined by a program config
element rather than a channel code. Chromium refuses it in MSE. A 5.1 AAC track with a
standard layout plays fine; this shape does not.

**Fix.** `needsAudioDownmix` (`transcodeProfile.mjs`) flags multichannel AAC with no
layout, and the Plex request then carries
`add-limitation(scope=videoAudioCodec&scopeName=aac&type=upperBound&name=audio.channels&value=2)`
on both the decision and the stream URL. Verified against the decision endpoint for the
same item: video `decision=copy`, audio `decision=transcode channels=2`. The scope has to be
`videoAudioCodec` — an `audioCodec`-scoped limitation is ignored inside a video session and
Plex kept copying.

## 2 — a finished season answered 404 "No playable items in container"

**Symptom.** `GET /api/v1/play/plex:<season>` → 404, retried four times by the Player.

**What each layer did.** Plex returned the season and its three episodes (200, logged).
`GET /api/v1/queue/<season>` listed all three. Every episode was at `percent: 100` in the
household watch memory. The play path resolves a container through the selection strategy,
which drops watched items — correct for "what's next" — and had no fallback, so a season
finished in full resolved to nothing.

**Fix.** `PlaybackReadService` passes `allowFallback: true` for container play and shuffle.
The strategy's own cascade relaxes the watched filter only when it leaves nothing, so an
unfinished season still starts at its next unwatched episode and a finished one starts again
at the first. Pinned by `PlaybackReadService.test.mjs` over the real `ItemSelectionService`.
