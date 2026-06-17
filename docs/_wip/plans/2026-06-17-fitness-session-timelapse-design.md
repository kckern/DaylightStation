# Fitness Session Time-Lapse — Design

> Validated design from a brainstorming session on 2026-06-17. Companion to the
> implementation plan: `2026-06-17-fitness-session-timelapse-plan.md`.

## Goal

At the end of a fitness session, automatically produce a **silent, fun, motion-forward
time-lapse MP4** — a watchable/shareable recap of the workout. The camera (the people
working out) is the star; what was playing on the screen is a corner picture-in-picture;
a title bar and a bottom-third stat strip (avatars + live HR / RPM / zone) provide flavor.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Primary purpose | Fun keepsake / share — motion-forward, stats as flavor |
| Player capture | **Backend pulls frames from the Plex source** at the right offsets (no kiosk cost, no canvas-tainting) |
| Pacing | **Config-driven**, default ~10× compression (30 min → 3 min) |
| Layout | **Camera hero + corner PiP**, title bar top, bottom-third stat strip with avatars |
| Audio | None (silent) |
| Trigger | Background job at session-end; also manually re-runnable |

## What already exists (do not rebuild)

- `CameraViewApp` (frontend) captures webcam JPEGs (640×480 @ 0.92) and uploads them via
  `POST /api/v1/fitness/save_screenshot`.
- `ScreenshotService` + `YamlSessionDatastore.getStoragePaths()` write frames to
  `media/apps/fitness/sessions/{date}/{sessionId}/screenshots/{date}_{index}.jpg` and record
  each in the session YAML under `snapshots.captures[]` (`{index, filename, path, timestamp, size}`).
- The session YAML already records everything needed as metadata:
  - `timeline.series` — per-tick HR/RPM/zone, RLE-encoded; decode via `decodeSeries()` in
    `TimelineService.mjs`. Timebase fields: `interval_seconds`, `tick_count`.
  - `timeline.events` — media-change events (`{timestamp, type:'media', data:{contentId, title}}`),
    challenges, etc.
  - `roster` / `participants`, `startTime`/`endTime`, `timezone`.
- `node-canvas` (`canvas` ^3.2.1) + `0_system/canvas/` toolkit (`CanvasRenderer`, `CanvasFactory`,
  `compositeHero.mjs`) — already registers Roboto Condensed (the canonical font).
- `ffmpeg` is already spawned elsewhere (`local.mjs` thumbnail, `HlsStreamManager`); assumed on `$PATH`.
- Plex source file path is reachable: `adapter.getItem(localId)` → `item.Media[0].Part[0].file`.

## The four gaps this feature fills

1. Capture **what was on the player** — backend ffmpeg-extracts source frames at offsets.
2. **Composite** camera + player PiP + title + stat strip into a 1080p frame.
3. The **session-end job** that stitches frames → silent MP4 → stores it named for the session.
4. **Archive/delete** the raw frames afterward.

## Composite layout (1920×1080)

```
+----------------------------------------+
| > Daytona USA 2001     18:08 · 14:32   |   title bar (top): content title + clock + elapsed
+----------------------------------------+
|                            +---------+ |
|                            | PLAYER  | |   player PiP (top-right, 480×270, 16:9)
|        CAMERA (hero)       +---------+ |
|                                        |   camera = cover-fit hero (fills frame)
|                                        |
+----------------------------------------+
| (KC)142v (Gst)128v   HOT     86 rpm    |   bottom-third strip: avatar + name + HR + zone + rpm
+----------------------------------------+
```

## Pacing math (config-driven)

- `outputDuration = sessionDurationSec / speedup` (default `speedup: 10`)
- `frameCount = ceil(outputDuration × outputFps)` (default `outputFps: 10`)
- For a watchable result the **camera** must capture ~every `speedup / outputFps` seconds
  (≈1s for 10×/10fps), vs. the current 5s timeline tick. This is a frontend config knob
  (`timelapse.capture_interval_ms`); player frames are free to make dense (ffmpeg offsets).
- For each output frame `i`: `elapsedReal = (i / outputFps) × speedup`,
  `wallClock = startMs + elapsedReal × 1000`, `tickIndex = floor(elapsedReal / interval_seconds)`.

## Config block (`fitness.yml`)

```yaml
timelapse:
  enabled: true
  speedup: 10              # 30 min -> 3 min
  output_fps: 10           # smoothness of final video
  capture_interval_ms: 1000  # frontend camera cadence (~ speedup/fps * 1000)
  resolution: [1920, 1080]
  crf: 20                  # x264 quality (lower = better/larger)
  pip:
    enabled: true
    size: [480, 270]       # top-right
  title_bar: true
  stat_strip: true
  archive_frames: false    # false = delete raw frames on success; true = move to archive/
```

## Output & session record

- File: `media/video/fitness/{date}_{sessionId}_{slug}.mp4` (`slug` = session title, prefers
  show/video name over generic Strava name).
- Recorded on the session via aggregate methods, persisted in YAML:

```yaml
timelapse:
  status: ready            # processing | ready | failed | skipped
  videoPath: media/video/fitness/2026-06-12_20260612180809_daytona-usa.mp4
  durationSeconds: 180
  frameCount: 1800
  fps: 10
  createdAt: <ts>
```

## DDD module map (compliant with `ddd-reference.md`)

Dependencies point inward; `1_rendering` imports only `2_domains`/`0_system`; ffmpeg & disk
sit behind ports in `1_adapters`; orchestration is a **use case**; status mutates only through
the `Session` aggregate root.

| Artifact | Layer | Responsibility |
|----------|-------|----------------|
| `FrameDescriptor` (value object) | `2_domains/fitness/value-objects/` | Immutable per-frame spec |
| `TimelapseFrameMapper` (domain service) | `2_domains/fitness/services/` | **Pure**: session data → `FrameDescriptor[]` (uses `decodeSeries`) |
| `Session` entity additions | `2_domains/fitness/entities/Session.mjs` | `markTimelapseProcessing()`, `attachTimelapse()`, `markTimelapseFailed()`, serialize `timelapse` |
| `TimelapseFrameRenderer` | `1_rendering/fitness/` | **Pure**: buffers + descriptor → composite JPEG buffer |
| `IVideoFrameExtractor`, `IVideoEncoder`, `IRecapSnapshotStore` (ports) | `3_applications/fitness/ports/` | What the app needs |
| `FfmpegVideoAdapter` | `1_adapters/video/` | Implements both video ports via `spawn('ffmpeg')`; throws `InfrastructureError` |
| `YamlRecapSnapshotStore` | `1_adapters/persistence/yaml/` | List/read/archive raw frames (reuses `getStoragePaths`) |
| `GenerateSessionTimelapse` (use case) | `3_applications/fitness/usecases/` | Orchestrates everything; catches adapter errors → `markTimelapseFailed()` |
| `/end` hook + manual re-run | `4_api/v1/routers/fitness.mjs` | Fires use case in background |
| Wiring | `0_system/bootstrap.mjs:1059` | Construct adapters + use case, inject into `createFitnessRouter` |

## Edge cases

- **No camera frames** → `status: skipped`, no video (time-lapse is opt-in via having captured).
- **Player source unresolvable** → render frames *without* the PiP rather than fail the whole job.
- **Merged sessions** (30-min-gap merge rule) → regenerate from merged session's unified data.
- **Avatars** from participant profile image (baseline JPEG); fall back to a colored initial chip.
- **Concurrency** → one job at a time, runs on prod server (homeserver), not the kiosk.
- **Idempotency** → re-running overwrites the existing MP4; on failure nothing is deleted so a
  manual re-run can retry.
