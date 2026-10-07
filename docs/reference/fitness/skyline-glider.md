# Skyline Glider

Skyline Glider is a single-rider Fitness game in which cadence controls a hang glider's target altitude. It is registered as `fitness:skyline-glider` and opens at `/fitness/module/skyline_glider`.

## Play contract

- The first claimed cadence-capable equipment and its rider are used.
- Equipment `rpm.min` and `rpm.max` calibrate the altitude range; the safe fallback is 30–100 RPM.
- Faster cadence climbs and slower cadence descends. Zero RPM coasts for one second before descending.
- A missing or stalled cadence transport is collision-protected for 0.75 seconds, then freezes the course behind a reconnect overlay.
- The rider has three lives. A third collision plays a two-second crash and restores three lives at the latest checkpoint.
- Mountain Pass lasts five minutes and has checkpoints near 25%, 50%, and 75%.
- Completion awards 10 rings plus one per unique collectible, capped at 30. Normal heart-rate rings continue independently.

## Persistence

The browser stores the current checkpoint under `fitness:skyline-glider:<userId>:<courseId>`. Reloading offers Resume or Start Over. Finished and abandoned runs are stored under the household Fitness log and projected into session activity history as `skyline-glider`.

Run saves are idempotent by run ID. Reusing an ID with different content returns HTTP 409. The reward key is `rpm-flight:<runId>:completion:<userId>`, so retrying a successful save cannot pay twice.

## Course configuration

The bundled `mountain-pass` course is always available. Optional household overrides belong in:

```text
fitness/skyline-glider/courses/*.yml
```

Malformed overrides are ignored individually and logged as `fitness.skyline_glider.course_override.invalid`; they never hide the bundled course.

The household Fitness menu is deployment-owned configuration and is not tracked in this repository. Add this tile to the production menu:

```yaml
- id: skyline-glider
  label: Skyline Glider
  icon: plane
  target:
    type: module
    module_id: skyline_glider
```

## API

- `GET /api/v1/fitness/skyline-glider/courses`
- `POST /api/v1/fitness/skyline-glider/runs` with `{ record, household? }`
- `GET /api/v1/fitness/skyline-glider/runs/:runId`

Terminal results embed `gaming-result/v1`; continuous flight simulation remains owned by Fitness.
