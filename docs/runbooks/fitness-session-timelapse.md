# Fitness Session Time-Lapse — Runbook

A silent, motion-forward recap MP4 rendered automatically at the end of each fitness
session: camera hero (4:3, native aspect) + a right rail (live player picture-in-picture →
show poster) + a header (show — episode title · animated coin counter · elapsed) + a
bottom stat strip (avatars + HR + zone + rpm).

## How it works

1. **Capture (frontend, realtime).** While the player is up, two image streams are captured
   at the time-lapse cadence and uploaded via `POST /api/v1/fitness/save_screenshot`:
   - the **webcam** (`CameraViewApp`, `role: 'camera'`)
   - the **player `<video>`** (`usePlayerFrameCapture` in `FitnessPlayer`, `role: 'player'`)
     — a same-origin canvas grab, so pixels are readable.
   Both land in `media/apps/fitness/sessions/{date}/{sessionId}/screenshots/` and are recorded
   in the session YAML under `snapshots.captures[]` (each with a `role`).
2. **Trigger (backend).** On `POST /api/v1/fitness/sessions/:id/end` the
   `GenerateSessionTimelapse` use case is fired in the background (the end request returns
   immediately). It is also runnable on demand (see below).
3. **Render.** For each output frame the mapper picks the nearest camera AND player capture by
   timestamp; the renderer composites a 1080p frame (node-canvas, Roboto Condensed); ffmpeg
   stitches the frames into a silent H.264 MP4 (`-an`).
4. **Store + clean up.** The MP4 is written to `media/video/fitness/{date}_{sessionId}_{slug}.mp4`
   and recorded on the session YAML under `timelapse:`. Raw frames are deleted (or archived if
   `archive_frames: true`).

## Manually (re)generate

```bash
curl -X POST {backend}/api/v1/fitness/sessions/{sessionId}/timelapse \
  -H 'Content-Type: application/json' -d '{"household":"{hid}"}'
# 202 Accepted; runs in background. Watch dev.log for fitness.timelapse.* events.
```

## Session YAML record

```yaml
timelapse:
  status: ready          # processing | ready | skipped | failed
  videoPath: media/video/fitness/2026-06-12_20260612180809_game-cycling.mp4
  durationSeconds: 180
  fps: 10
  frameCount: 1800
  createdAt: <ts>
```
- `skipped` — the session had no camera captures (the camera widget wasn't open).
- `failed` — see `error`; raw frames are kept so a manual re-run can retry.

## Config (`fitness.yml` → `timelapse:`)

```yaml
timelapse:
  enabled: true
  speedup: 10              # 30 min -> 3 min
  output_fps: 10           # smoothness
  capture_interval_ms: 1000  # frontend camera + player cadence (≈ speedup/fps * 1000)
  resolution: [1920, 1080]
  crf: 20                  # x264 quality (lower = better/larger)
  pip: { enabled: true, size: [480, 270] }
  title_bar: true
  stat_strip: true
  archive_frames: false    # false = delete raw frames on success; true = move to archive/
```
Defaults live in `FitnessConfigService` (`TIMELAPSE_DEFAULTS`); config changes need a backend restart.

## Dependencies & assets

- **ffmpeg** must be on `$PATH` (encode only).
- **Roboto Condensed** TTFs are bundled at `backend/assets/fonts/roboto-condensed/` and
  registered by the renderer (canonical app font; node-canvas can't use the frontend `.woff2`).
- **Poster** is fetched best-effort from Plex (show/grandparent thumbnail) — absent → rail shows
  only the player PiP. **Avatars** load from `{img}/users/{slug}.{ext}` — absent → name only.

## Troubleshooting

- No video, `status: skipped` → no `role: camera` captures; confirm the camera widget was open
  and `save_screenshot` uploads succeeded.
- No player PiP → no `role: player` captures (player video element absent / tainted canvas) or
  the player frame timestamps don't overlap the camera window.
- `status: failed` → check `fitness.timelapse.failed` log + the `error` field; re-run manually.

## Code map (DDD)

| Layer | File |
|-------|------|
| value object | `2_domains/fitness/value-objects/FrameDescriptor.mjs` |
| domain service | `2_domains/fitness/services/TimelapseFrameMapper.mjs` |
| aggregate | `2_domains/fitness/entities/Session.mjs` (`markTimelapse*` / `attachTimelapse`) |
| renderer (pure) | `1_rendering/fitness/TimelapseFrameRenderer.mjs` |
| ports | `3_applications/fitness/ports/{IVideoEncoder,IRecapSnapshotStore}.mjs` |
| encoder adapter | `1_adapters/video/FfmpegVideoAdapter.mjs` |
| snapshot store | `1_adapters/persistence/yaml/YamlRecapSnapshotStore.mjs` |
| use case | `3_applications/fitness/usecases/GenerateSessionTimelapse.mjs` |
| API + wiring | `4_api/v1/routers/fitness.mjs`, `0_system/bootstrap.mjs` |
| frontend capture | `hooks/fitness/usePlayerFrameCapture.js`, `modules/Fitness/widgets/CameraViewApp` |
