# Playback quality overrides

Plex video accepts explicit quality intent on device loads, play resolution and
stream minting. MediaApp exposes the same fields under **Quality…** in an item's
More menu and Details, and alongside the controls for current local or remote
playback. These are requested limits; the controls do not report measured output
resolution or guarantee smooth playback.

| Parameter | Values | Meaning |
| --- | --- | --- |
| `maxResolution` | `240`, `360`, `480`, `720`, `1080`, `1440`, `2160` (optional `p` suffix) | Maximum video resolution class. Plex currently clamps to its 1080p server ceiling. |
| `maxVideoBitrate` | Positive integer, in **kbps** | Maximum video bitrate. Plex clamps to its 8000 kbps server ceiling. `4000` means 4 Mbps. |
| `transcode` | `auto`, `force` | `force` disables video direct play and stream copy. `auto` uses the normal policy, subject to explicit caps. |
| `adaptive` | `true`, `false` | Controls Plex's `autoAdjustQuality` request. `false` sends `0`. This does not enable an application resolution fallback ladder. |

`maxVideoResolution` is an input alias for `maxResolution`. Conflicting aliases,
invalid classes, partial numbers, and invalid booleans return HTTP 400 before a
device load. Missing fields preserve the existing policy. Supplying either cap
forces video encoding even when the original would otherwise be copyable; this
makes explicit downscaling predictable. Audio keeps its existing delivery policy.
The current MediaApp UI exposes the supported server ceilings, up to 1080p and
8000 kbps. Unsupported sources and audio do not offer video quality controls.

For example, using installation-specific identifiers and origin:

```text
/api/v1/device/<device-id>/load?play=plex:<rating-key>&maxResolution=720&maxVideoBitrate=4000&transcode=force&adaptive=false
/api/v1/play/plex:<rating-key>?maxResolution=720&maxVideoBitrate=4000&transcode=force&adaptive=false
```

Screen autoplay URLs and MediaApp `?play=` / `?queue=` deep links preserve
the same fields, including `adaptive=false`; quality changes also distinguish
Media deep-link dedupe tokens. Links without quality fields retain the legacy
saved token, preventing an unchanged Play URL from replaying after an upgrade.

The same quality query is accepted by `/api/v1/proxy/plex/stream/<rating-key>`
and the legacy `/api/v1/play/plex/mpd/<rating-key>` endpoint. The proxy stream
path remains opaque to callers; Plex authentication stays on the server.

## Selected items and current playback

Selected-item overrides live in this browser tab's session storage, keyed by
content ID. Saving them starts no playback. Play and queue actions attach them
to that item's queue input, including remote item actions. Standalone Cast
and one-shot destination pickers capture the same preferences at dispatch; Retry
replays the original captured command even if saved preferences later change. Video containers pass
limits to their video children. Other items keep their own preferences. **Use
defaults** removes saved overrides for that item.

Current-playback overrides affect only the current queue visit on the selected
owner. They do not change the saved selected-item preferences or another queue
visit of the same content. Applying them replaces the decoder briefly, retaining
the owner's captured hot position, pause state, selected tracks, queue identity
and configuration. **Use defaults** removes the current visit's quality fields
and reloads using the ordinary policy.

Commands freeze the content ID plus available queue visit/session IDs when the
sheet opens. The playback owner rejects a command after that target changes;
the UI keeps the sheet open and explains the failure. Remote success means the
owner acknowledged applying the change, not proof of decoded dimensions or
sustained playback. Older owners can reject unsupported commands.

```text
POST /api/v1/device/<device-id>/session/quality
{
  "commandId": "<unique-id>",
  "contentId": "plex:<rating-key>",
  "queueItemId": "<current-visit-id>",
  "sessionId": "<current-session-id>",
  "quality": {"maxResolution": "720", "maxVideoBitrate": 4000, "adaptive": false}
}
```

The browser control channel uses a `session` envelope with `action: "set-quality"`
and the same target and quality fields. An empty `quality: {}` clears overrides.
The local, named-browser and screen adapters share target validation. Owner
entries carry an authoritative `qualityOverrides` object after replacement,
including an empty object on clear, so original launch props cannot restore
removed limits. Local quality replacement preserves the existing queue policy;
it does not freeze shuffle into a portability execution plan.

## Diagnose and remediate stalls

Use a ladder that preserves the movie and its timeline:

1. Inspect playback health, buffer, segment delivery and Plex's actual decision.
   Check CPU/GPU contention, but also whether the encoder is ahead and segment
   responses are being held. Free CPU alone does not explain every stall.
2. Use the existing player recovery actions for transient transport/decoder
   problems. A decoder retry can recover a dead stream; repeating the same
   expensive rendition cannot solve sustained throughput failure.
3. Apply a lower bitrate ceiling; if needed, request 720p/4000 kbps, then
   480p/2000 kbps. Retain position, pause intent and track choices. Do not skip
   the movie to hide a playback failure.
4. Verify advancing native time, buffer recovery and delivered dimensions. A
   successful manifest request or command acknowledgement proves neither.

Steps 3–4 currently require an explicit control action. A future automatic app
ladder still needs evidence classification and guarded quality execution. Shared
accounting now retains an owner/visit budget across short progress and quality
adoption: three incident actions, six per rolling ten minutes, four-second
minimum spacing, one action in flight, and a sixty-second continuous healthy
reset that preserves rolling history. Explicit Retry also preserves that history.
The future automatic ladder must respect explicit quality ceilings and `adaptive=false`. Parameter propagation
and Plex adjustment alone do not implement that app policy.

## Quality while a movie is held

Recovery exhaustion keeps finite video on the current visit, including Media's
60-second refused-source timeout. The held overlay exposes focusable Retry,
Quality and Skip controls. Quality uses the same form and owner adoption as the
normal controls, preserving queue, current position and deliberate pause. The
Media bridge opens its existing Quality sheet; direct/screen Players render the
shared form in place. The inline TV dialog has scoped D-pad navigation: arrows
move focus, OK enters/leaves native value editing, and Back exits editing then
closes the dialog. Apply and Close are reachable without a pointer; closing
restores the held Quality action's focus. The shared form's desktop behavior is
unchanged. An open direct/screen form rejects a superseded recovery
target before changing the queue. Retry remains bounded by the rolling action
cap and displays its remaining delay; it never replays a new Play command.
Audio, live and continuous terminal behavior is unchanged.

## Playback signal limits

The player exposes `recoveryHealth` alongside its existing health fields. It
samples native element observations every 500 ms using monotonic time; samples
expire after 2 seconds. `contiguousRunwayMs` measures only the buffered range
containing the playhead, divided by playback rate. A known gap yields zero;
an absent or unreadable observation yields `null`.

Clock progress and presentation progress are separate observations. Native
`requestVideoFrameCallback` supplies submitted-frame evidence when supported;
without that API, presentation progress remains `null`. Submitted frames do not
prove the physical display showed them. Decoded and dropped counters remain
available as diagnostics; increasing decoded counts alone cannot establish
presentation progress. Dropped-frame ratios use counter deltas and stay unknown
when either counter is unavailable or resets.

Hidden intervals, scheduling gaps of 2 seconds or more, and the first sample on
visibility return provide no progress or failure evidence. A subsequent fresh
visible interval can establish progress again. Seeking, pause and stop provide
no playing-progress credit. Consumers must check freshness and viewing intent
before using these observations for automatic recovery or sustained success;
the existing recovery ladder is still being migrated to this contract.

## HLS timeline and buffer units

Plex decision and start requests use `secondsPerSegment=3`, matching the
encoder's three-second segments. A synthetic five-second playlist over
three-second encoded segments can end playback early despite a full source
file. Verify the whole timeline and final segment, not just initial playback.
`mediaBufferSize=102400` is **KiB** (100 MiB), not a byte count.

Native HLS uses a full-timeline manifest at offset zero, then seeks after metadata.
Starting an offset manifest can require fetching many synthetic placeholder
segments before metadata becomes available. Preserve the existing renderer's
seek strategy when replacing a stream.

Catalog movie duration is preserved in `/play.contentTimeline.expectedEndSeconds`
with `provenance: catalog`, separately from observed renderer `duration`.
The provider's presentation descriptor supplies verified renderer and content
origins. The current Plex descriptor supplies zero origins for originals,
full-timeline DASH, and zero-offset HLS. A resume offset in a stream URL does
not establish a relative timeline. A verified relative renderer maps its time
as `nativeSeconds - rendererStartSeconds + contentStartSeconds`; these origins
belong to its renderer generation.

Native EOF, clip completion, and the at-duration watchdog pass one completion
gate before marking ended, clearing recovery timers, or advancing. Configured
clip ends use original content seconds and take precedence over catalog end.
A terminal signal more than three seconds early enters the shared bounded
recovery budget, then holds the movie with Retry, Quality, and explicit Skip.
Known catalog end with unknown mapping holds as `timeline-unverified`. Retry
is explicit; held playback does not spend more automatic recovery attempts.
Accepted terminal signals complete once per visit, including repeat-one.
Pause, play, and seek retain completion ownership for the current native node.
A renderer replacement claim retires the prior terminal target; old-node
callbacks stay rejected while a replacement resolves and after newer controls.
Stop supersedes pending terminal events without spending a recovery attempt.
Without a catalog or clip end, ordinary EOF remains available and records
`completion-unverified`; this does not validate the whole film.

Progress and durable play logs use mapped content seconds and catalog duration,
so a renderer ending at 4,370 seconds of a 5,895-second movie reports 74.1%,
not a completed watch. Video clip UI progress remains relative to the clip;
its `contentSeconds` and durable resume logs remain in original movie seconds.
Audio clips retain native track time for resume logs and use their configured
clip window for UI progress and completion.
Unknown mapping cannot publish a confirmed position or completed-watch log.
Media and screen capture/Quality adoption prefer mapped content time and retain
the prior confirmed position when mapping is unknown. The optional Player
`getContentTime()` exposes this clock; legacy `getCurrentTime()` remains native.
Provider-origin guarantees still require full-film verification on the target
device; unit descriptor tests do not establish external stream behavior.

A native-HLS workaround improved an incident where the encoder was ahead but
three-second segment responses were held for six seconds. Several request and
renderer variables changed together, so that observation does not establish
that resolution alone, native playback alone, or range requests alone caused
the improvement.

## Implementation and verification

The shared contract is `shared/contracts/media/playbackQuality.mjs`. Device and
play routes normalize once at their boundary; `PlaybackReadService`,
`PlayResponseService`, `RegistryContentCatalogGateway` and
`RegistryPlaybackStreamGateway` preserve intent through `PlexAdapter` decision
and start requests. Browser fetches, Player props and queue projections retain
all four fields, including explicit `false`.

MediaApp owns `PlaybackQualityProvider` and mounts its sheet inside the Media
dismiss stack. `useContentDispatch` attaches selected preferences. Active changes
use `controller.quality.setOverrides`, the browser command handler, or the screen
host's quality port; they reuse owner snapshot adoption rather than issuing a
new Play action.

Focused tests cover malformed inputs, the real Plex adapter decision/start
construction, copyable-source enforcement, selected local/remote dispatch,
receiver acknowledgements, stale targets, and a real PlayerBridge decoder
replacement retaining a paused full-timeline position. They do not constitute
production acceptance or measured stream-quality verification.
