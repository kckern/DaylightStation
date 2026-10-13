# Fitness frontend freeze and Firefox OOM after session reload

**Date:** 2026-07-20  
**Status:** Root cause confirmed for the first crash; second fresh-process OOM remains under investigation  
**Severity:** Critical  
**Affected screen:** Garage Firefox kiosk, `/fitness?device=garage-tv`  
**Primary frontend areas:** `FitnessSession`, `FitnessTimeline`, `FitnessChart`, and fitness frame capture

## Executive summary

The garage fitness screen suffered two consecutive failures on 2026-07-20. They
must not be treated as one incident:

1. At 06:15 PDT, a mid-workout page reload auto-resumed session
   `fs_20260720060913`. Resume replaced `FitnessSession.timeline`, but
   `TimelineRecorder` retained a reference to the discarded pre-resume timeline.
   Sensor ingestion repeatedly attempted to backfill the same elapsed interval.
   The rate rose from an expected 0.2 timeline ticks/sec to more than 200
   ticks/sec. The broken rolling-window pruning then amplified this catch-up
   storm into heavy allocation and log traffic. Firefox restarted at 06:31.

2. The new Firefox process started a fresh session, `fs_20260720063117`. Its
   timeline remained healthy: no catch-up anomaly, no pruning storm, and normal
   five-second tick progression. Nevertheless, React rendering stopped at about
   06:36:41, explicit `out of memory` errors began at 06:37:43, and the Firefox
   content process reached about 12 GB RSS while consuming approximately one CPU
   core. This is the freeze the user reported while video initially continued to
   play. It is not explained by the timeline defect.

The initial diagnosis - that the January `FitnessTimeline` pruning defect alone
caused the reported freeze - was incomplete. Commit `d0addf977` fixes a real and
serious pruning defect, but it does not fix the resume catch-up storm and cannot
explain the second process's OOM.

The strongest unproven suspect for the second OOM is the always-on screenshot
pipeline. The failing process encoded and uploaded a webcam JPEG and a player
JPEG every second. The webcam path creates a new canvas for every snapshot, the
snapshot scheduler permits overlapping async encodes, and both paths convert
blobs to base64 before upload. These operations allocate largely outside the JS
heap in Firefox, matching the missing `performance.memory` data and very large
native content-process RSS. However, earlier sessions produced comparable frame
counts successfully, so this remains a hypothesis requiring an A/B soak test.

## User-visible symptom

- Severe frontend jank followed by a frozen UI.
- Video continued to render for part of the freeze even though React stopped
  rendering.
- Eventually video also stalled.
- Input and WebSocket callbacks began throwing `out of memory`.
- Restarting/reloading temporarily produced a working screen, followed by
  another failure.

## Runtime environment

| Item | Value |
|---|---|
| Display host | Garage Linux box (`ssh garage`) |
| Browser | Firefox 152, X11 kiosk |
| URL | `https://daylightlocal.kckern.net/fitness?device=garage-tv` |
| Prod host | `homeserver.local` |
| Container | `daylight-station` |
| Image tag | `kckern/daylight-station:latest` |
| Image embedded commit | `1fea403f0` |
| Image build start metadata | 2026-07-20 05:54:34 PDT |
| Image created | 2026-07-20 06:03:27 PDT |
| Container created/started | 2026-07-20 06:12:55 PDT |
| Firefox replacement process started | 2026-07-20 06:31:02 PDT |

Although the user did not intentionally redeploy, production was rebuilt and
the container was recreated that morning. The compose file mtime was
06:11:18 PDT. Host journal entries show the old container being deliberately
stopped (`hasBeenManuallyStopped=true`) at 06:12:50 and the new container starting
five seconds later. The available host logs do not identify the actor or script
that initiated the build/recreate.

This distinction matters: no fitness source commit was authored that morning,
but a production restart forced the kiosk through its reload and resume paths.

## Incident timeline

All times below are PDT on 2026-07-20.

| Time | Event |
|---|---|
| 05:54:34 | Docker image build metadata records commit `1fea403f0`. |
| 06:03:27 | New production image is created. |
| 06:09:13 | Fitness session `fs_20260720060913` starts. |
| 06:12:50 | Old production container is stopped. |
| 06:12:55 | New `daylight-station` container starts. |
| 06:12:51-06:12:56 | Existing kiosk page sees 502/Connecting responses while the service changes over. |
| 06:15:47 | Fitness profiler restarts at sample 1, proving a page reload. |
| 06:15:56 | Kiosk auto-resumes `fs_20260720060913`, restoring 61 ticks and 8 series with `gapTicks: 0`. |
| 06:16:26 | Catch-up telemetry reports 8.9 actual ticks/sec instead of 0.2. |
| 06:16:56 | Catch-up rises to 27.3 ticks/sec. |
| 06:17:16 | First `FitnessTimeline` prune warning appears. |
| 06:17:26 | Catch-up reaches 49.9 ticks/sec. |
| 06:20:57 | Catch-up reaches 190.5 ticks/sec. |
| 06:21:28 | Catch-up peaks in sampled telemetry at 214.9 ticks/sec. |
| 06:28-06:29 | Pruning storm has reached tens of thousands of synthesized indexes per pass. |
| 06:31:02 | Firefox starts a new browser process after the first failure. |
| 06:31:09 | New page profiler starts at sample 1. |
| 06:31:17 | Fresh session `fs_20260720063117` starts; no resume occurs because content did not register within the six-second wait. |
| 06:31:39 | `FitnessChart` reports sustained rendering at roughly 12 renders/sec. |
| 06:36:18 | Timeline telemetry remains healthy: tick count 61, no anomaly. |
| 06:36:21 | Playback position stops advancing at 984.7 seconds in periodic logs. |
| 06:36:41 | App profiler reports only 5 React renders in the preceding interval, down from about 80. |
| 06:37:11 | App profiler reports 0 React renders while video still reports 24 FPS and `playing`. |
| 06:37:43 | First explicit WebSocket subscriber `out of memory` error. |
| 06:37:53 | Repeated subscriber OOM and `window.onerror: uncaught exception: out of memory`. |
| 06:39-06:40 | Video degrades from playing to stalled, then 0 FPS. |
| After failure | Firefox content PID 2950 is observed at about 12,072,596 KB RSS, 75% memory, and approximately 98-107% CPU. |

## Failure 1: resume catch-up storm

### Confirmed root cause

`FitnessSession._startWithResumeCheck()` starts a temporary fresh session before
hydrating the saved session:

```js
this.ensureStarted({ reason: 'resumed', force: true });
this._hydrateFromSession(result.session);
```

`ensureStarted()` creates a timeline and correctly gives that object to the
recorder:

```js
this.timeline = new FitnessTimeline(now, this.timebase.intervalMs);
this._timelineRecorder.setTimeline(this.timeline);
```

`_hydrateFromSession()` then replaces `this.timeline` with another object:

```js
this.timeline = new FitnessTimeline(this.startTime, this.timebase.intervalMs || 5000);
```

It restores series and `tickCount`, but never runs:

```js
this._timelineRecorder.setTimeline(this.timeline);
```

The two objects then diverge:

```text
FitnessSession.timeline
  restored session object
  tickCount = 61
  lastTickTimestamp = null

TimelineRecorder._timeline
  discarded temporary object
  receives all new recordTick() calls
```

`_maybeTickTimeline()` reads the restored object's null `lastTickTimestamp` and
falls back to the original session start. It calls `_collectTimelineTick()` in a
catch-up loop. `_collectTimelineTick()` delegates to `TimelineRecorder`, which
writes to the other timeline. The restored object therefore still has no last
tick timestamp on the next sensor event, and the same gap is replayed again.

As wall time advances, the replay interval gets longer. This exactly matches the
monotonically increasing loop count in production.

### Smoking-gun telemetry

The restored timeline's `tickCount` remains fixed at 61 while `actualTicks`
accelerates:

| Time | Ingest rate | Actual tick rate | Average loop iterations | Reported tick count |
|---|---:|---:|---:|---:|
| 06:16:26 | 3.9/sec | 8.9/sec | 2.26 | 61 |
| 06:16:56 | 3.2/sec | 27.3/sec | 8.46 | 61 |
| 06:17:26 | 3.4/sec | 49.9/sec | 14.58 | 61 |
| 06:18:57 | 3.3/sec | 110.4/sec | 32.53 | 61 |
| 06:20:57 | 3.3/sec | 190.5/sec | 56.68 | 61 |
| 06:21:28 | 3.4/sec | 214.9/sec | 62.69 | 61 |

A functioning recorder cannot execute thousands of ticks while its owning
timeline remains at 61. The stale object reference is the only code path found
that explains both values simultaneously.

### Why pruning made it much worse

The recorder's discarded timeline eventually crossed the 2,000-point limit.
The old pruning implementation removed old array elements but left `tickCount`
as an absolute index. On the next tick, `_getOrCreateSeries()` padded the array
back to that absolute index, after which pruning removed the padding again.

The cycle became:

```text
catch-up replay
  -> pad series from 2,000 to absolute tick index
  -> splice back to 2,000
  -> console.warn
  -> repeat for the next replayed tick
```

The first warnings at 06:17:16 show removals of 1, 2, 3, and so on. Later
warnings remove tens of thousands of entries per tick. This is a secondary
amplifier, not the initiating defect.

### Commit history

| Commit | Date | Effect |
|---|---|---|
| `120263a9428880c9725e096ef7620b618bf7f224` | 2026-04-03 | Added session auto-resume and `_hydrateFromSession()`. Introduced the stale `TimelineRecorder` reference by replacing `this.timeline` without rebinding the recorder. |
| `c3bc32d5e267a1c477e625fe0c83494d2572d545` | 2026-04-03 | Added null padding for resumed gaps. Related to resume but not the stale-reference cause in this incident (`gapTicks` was zero). |
| `a7f6d393d5d687d7975de56d43d21fa34cad6e60` | 2026-06-22 | Made mid-workout reloads wait for content and then auto-resume reliably. Also added catch-up anomaly telemetry after a previous garage freeze. This exposed the April defect more consistently but did not create the stale reference. |
| `1c2d27f5f689728bbef5800801d368a2ced62695` | 2026-01-10 | Added the broken 2,000-point pruning implementation. Amplified the catch-up storm after it crossed the cap. |
| `b5e8d9670fef88e5a98be013cce0745786d025d4` | 2026-07-17 | Added provisional persistence for real sessions under five minutes. Not causal here: the resumed session was already more than six minutes old. |

The June 22 commit message explicitly records an earlier garage UI freeze and an
unexplained ingest-driven tick storm. The telemetry added then captured enough
data to identify the stale timeline reference in this incident.

### Current partial fix and its limitation

Commit `d0addf97790f71e39bae935876fec23f46720260` fixes rolling-window
pruning by tracking a retained-window offset (`prunedTickCount`) and indexing
series locally. Its isolated tests pass.

That commit is useful but insufficient:

- It prevents the pad/splice amplification.
- It removes the per-tick prune warning storm.
- It does not rebind `TimelineRecorder` after hydration.
- It does not restore a valid `lastTickTimestamp`.
- It does not bound pathological catch-up work.
- It does not explain or fix Failure 2.

It should not be described or deployed as the complete fix for the reported
frontend freeze.

## Failure 2: fresh-process native OOM

### What is confirmed

The Firefox process that failed at 06:37 was new. Its main process started at
06:31:02 and its content processes at 06:31:08. The app started a fresh session
at 06:31:17.

The fresh session's timeline remained normal:

| Time | Timeline tick count | Actual catch-up ticks | Max series length |
|---|---:|---:|---:|
| 06:31:47 | 7 | 1 | 6 |
| 06:34:18 | 38 | 0 | 36 |
| 06:36:18 | 61 | 1 | 60 |
| 06:37:19 | 74 | 0 | 72 |
| 06:37:49 | 79 | 0 | 78 |

There are no `FitnessTimeline` prune warnings and no `HIGH_TICK_RATE` anomaly
after the 06:31 restart. The second OOM therefore has a different immediate
cause.

The UI failure begins before the first explicit OOM:

- `FitnessChart` reports sustained 11-12.6 renders/sec.
- The app-level profiler reports approximately 80-100 renders per 30 seconds
  until 06:36.
- At 06:36:41, `renderCount` drops to 5.
- At 06:37:11 and 06:37:41, `renderCount` is 0 while sensor ingestion and
  profiler timers still run.
- Video reports 24 FPS and `playing`, consistent with Firefox's media/compositor
  thread continuing after the React/JS path becomes non-responsive.
- OOM exceptions begin at 06:37:43.
- The isolated web content process later measures roughly 12 GB RSS.

Firefox does not expose Chromium's `performance.memory`, so every
`heapMB`/`heapGrowthMB` field is null. The profiler could not see native canvas,
video, image encoder, compositor, or media allocations.

### Candidate: always-on frame capture

Two capture paths run for the entire active session:

1. `usePlayerFrameCapture` captures the workout video to JPEG every second.
2. `SessionCameraCapture` captures the webcam to JPEG every second.

For session `20260720063117`, the backend ultimately received 2,400+ screenshot
files totaling about 192 MB. The two filename sequences show approximately two
successful uploads per second.

The client-side cost is much larger than the stored JPEG total:

```text
decoded video frame
  -> canvas RGBA backing store
  -> JPEG encoder buffers
  -> Blob
  -> FileReader base64 string
  -> JSON request body
  -> upload
```

Specific risks in the implementation:

- `FitnessWebcam.makeSnapshot()` evaluates
  `canvasRef.current || document.createElement('canvas')`, but no JSX canvas is
  attached to `canvasRef`. It therefore creates a new canvas every second.
- `useWebcamSnapshots()` uses `setInterval()` with an async callback and has no
  in-flight guard around `makeSnapshot()`. If JPEG encoding takes longer than the
  interval, encodes can overlap.
- `useWebcamSnapshots()` invokes `onSnapshot()` without awaiting it. The outer
  scheduler considers the tick complete while upload/base64 work continues.
- `SessionCameraCapture`'s upload guard begins only after `makeSnapshot()` has
  already created the canvas and encoded a Blob.
- `usePlayerFrameCapture` reuses one canvas but assigns `canvas.width` and
  `canvas.height` on every tick, forcing backing-store reset/reallocation.
- Both paths convert binary JPEGs to base64, increasing payload size and creating
  additional large strings.
- The cadence defaults to one second and enables unless config is explicitly
  `false`; player and webcam capture cannot currently be disabled separately.

These behaviors are plausible sources of Firefox native memory growth. They are
not yet proven to be the source of the 12 GB RSS.

Counter-evidence must be retained: earlier sessions have completed with 2,174,
2,366, 2,884, and 3,634 screenshot files. The same feature can survive comparable
frame counts. Possible explanations include resolution changes, Firefox-specific
fragmentation, upload latency causing overlap, interaction with render thrashing,
or a different source entirely.

### Candidate: sustained FitnessChart render thrashing

The new process repeatedly reports:

```text
fitness.render_thrashing
component: FitnessChart
renderRate: 11-12.6/sec
sustainedMs: up to 122452
```

Commit `5b4ee3b8a` on 2026-07-17 moved vibration state from React state to a ref to
reduce full-provider renders. Production still shows sustained chart thrashing.
This is confirmed unnecessary work and may increase allocation pressure, but the
logs do not prove that React rendering alone accounts for 12 GB in six minutes.

### Candidate: interaction rather than one isolated leak

The likely failure shape may be cumulative:

- approximately 12 chart renders/sec;
- player video decode and DASH buffering;
- hidden webcam decode;
- two canvas/JPEG/base64 captures per second;
- frequent structured frontend logs;
- sensor updates at approximately 3/sec.

Any one path may survive in isolation while the combined workload causes Firefox
to retain native allocations faster than it releases them.

## Why the problem appeared today

No single source commit authored on July 20 introduced all observed behavior.
The immediate trigger was runtime state:

1. A new image was built and the production container was recreated.
2. The active kiosk page reloaded during a workout.
3. The reload successfully took the auto-resume path, exposing the stale timeline
   reference.
4. The first page/process entered a catch-up and pruning storm and failed.
5. Firefox restarted into a fresh session.
6. The fresh process then suffered a separate native OOM under the normal fitness
   workload.

The statement "it was working until today" is consistent with the evidence. The
resume defect is old but path-dependent. The second OOM was first observed today
and cannot currently be assigned to the old pruning bug.

The production image embedded commit `1fea403f0`, which includes the June
always-on frame-capture features and the July 17 render/persistence work. The old
image was removed during deployment, so its embedded commit could not be compared.
It is therefore not possible from retained Docker metadata to prove whether one
of those features first reached production in today's image.

## Required fixes

### P0: fix timeline ownership on resume

After hydration creates/restores the timeline, all collaborators must be rebound
to that same object. At minimum:

```js
this._timelineRecorder.setTimeline(this.timeline);
```

Hydration must also restore a coherent last tick timestamp. Candidate source:

```js
this.timeline.timebase.lastTickTimestamp = previousEndTime;
```

The exact value should be reconciled with `tickCount`, `startTime`, and any padded
gap so the first post-resume tick neither duplicates nor skips an interval.

Add a regression test that:

1. starts a temporary session;
2. hydrates a saved timeline;
3. ingests repeated sensor samples;
4. asserts `TimelineRecorder` writes to `session.timeline`;
5. asserts tick count and last timestamp advance together;
6. asserts catch-up work does not repeat on the next ingest.

### P0: bound catch-up work

`_maybeTickTimeline()` currently allows up to 1,000 synthesized ticks per call.
That turns a timestamp invariant failure into a main-thread denial of service.

Add a hard operational bound. For example:

- cap catch-up to a small number of ticks per call;
- detect gaps larger than a configured threshold;
- represent a long gap by moving the timebase/padding once instead of replaying
  every interval synchronously;
- stop processing and emit one structured error when the timeline fails to
  advance after a tick.

The critical invariant is:

```text
after _collectTimelineTick(timestamp),
session.timeline.timebase.lastTickTimestamp >= timestamp
```

If that invariant fails, the loop must break immediately.

### P0: retain the rolling-window pruning fix

Keep the `d0addf977` retained-window indexing fix, but integrate and test it with
resume hydration. Persisted payload compatibility for `prunedTickCount` must be
defined: either serialize it explicitly or reconstruct a safe offset from
`tickCount` and retained series length.

### P0 diagnostic mitigation: disable time-lapse capture for an A/B soak

Set the live fitness time-lapse config to `enabled: false`, restart Firefox, and
run the same workout flow for at least 30 minutes while sampling the Firefox
content process RSS. This disables both always-on capture paths without changing
playback or fitness session recording.

Interpretation:

- Stable RSS with capture disabled strongly implicates the capture pipeline.
- Continued RSS growth rules capture out as the primary cause and shifts focus to
  chart rendering, video/DASH, or another native allocation path.

This is a diagnostic mitigation, not a permanent fix.

### P1: make snapshot production single-flight

Add an in-flight guard inside `useWebcamSnapshots`, covering both JPEG encoding
and the returned `onSnapshot` promise. Use recursive `setTimeout` after completion
instead of `setInterval` so slow frames cannot queue overlapping work.

`onSnapshot` must be awaited:

```js
await onSnapshot(result.meta, result.blob);
```

### P1: reuse and release canvas resources

- Store one persistent webcam canvas in a ref.
- Do not create a new canvas for every snapshot.
- Avoid resetting width/height when dimensions are unchanged.
- After disabling/unmounting capture, set canvas width/height to zero to release
  native backing stores.
- Consider `ctx.reset()`/`clearRect()` as appropriate, but do not rely on it as a
  substitute for bounding concurrency.

### P1: stop base64 JSON uploads

Use `multipart/form-data` or a binary request body for JPEG blobs. This removes
the FileReader base64 string and its approximately 33% wire expansion, reducing
both JS and native allocation churn.

### P1: separate and lower capture cadence

- Add independent `player_enabled` and `camera_enabled` controls.
- Default capture cadence to at least 5 seconds until memory behavior is proven.
- Constrain webcam capture to an exact low resolution suitable for recap output.
- Record actual source dimensions and encoded byte size in sampled telemetry.

### P1: address FitnessChart render rate

The July 17 vibration throttle did not eliminate chart render thrashing. Profile
which context values change at 3-12 Hz and isolate chart data updates from the
entire fitness provider. A chart should not rerender multiple times per sensor
packet when the timeline itself records at 0.2 Hz.

## Verification plan

### Resume regression

1. Create a saved, non-finalized session with a known tick count and timestamp.
2. Reload while the same media is active.
3. Confirm `fitness.session.resumed` reports the expected session.
4. Confirm telemetry remains near 0.2 actual ticks/sec.
5. Confirm `tickCount` advances by approximately one every five seconds.
6. Confirm no `fitness.tick_catchup.anomaly` and no prune warning storm.
7. Repeat with a nonzero resume gap.

### Firefox memory A/B

For each run, restart Firefox and sample the isolated content process RSS every
10 seconds:

| Run | Player capture | Camera capture | Chart visible | Goal |
|---|---|---|---|---|
| A | Off | Off | Yes | Baseline playback/session memory |
| B | On | Off | Yes | Isolate player canvas/JPEG path |
| C | Off | On | Yes | Isolate webcam path |
| D | On | On | Yes | Reproduce production workload |
| E | On | On | No/minimal | Separate chart allocation from capture |

Record:

- content process RSS and CPU;
- actual webcam and player dimensions;
- encode duration;
- JPEG size;
- upload duration;
- skipped frames due to single-flight guard;
- React render rate;
- video FPS and dropped frames.

Success criteria for a 30-minute run:

- no sustained monotonic RSS growth;
- no OOM exceptions;
- responsive UI throughout;
- timeline rate near 0.2 ticks/sec;
- chart render rate bounded to the intended publish cadence;
- no queued/overlapping capture operations.

## Observability gaps

1. `performance.memory` is Chromium-only; every heap metric was null in Firefox.
2. There is no kiosk-side RSS sampler correlated with frontend session logs.
3. Capture logs do not include source dimensions, encoded bytes, encode time, or
   upload latency at info/sample level.
4. Production build/deploy provenance does not retain the previous image or an
   actor identifier.
5. The profiler's app `renderCount` and `FitnessChart` render profiler report
   different rates without documenting their counting scopes.
6. Catch-up telemetry reported the restored timeline's tick count but not the
   recorder timeline object's identity/tick count, delaying diagnosis.

Recommended additions:

- log a stable timeline instance ID for session and recorder in debug builds;
- log a fatal invariant event when recorder and session timelines differ;
- add a lightweight garage service that samples Firefox PID RSS/CPU and appends
  it to structured diagnostics;
- retain at least one previous production image with embedded commit metadata;
- include deployment actor/source in build metadata.

## Code locations

| File | Relevant behavior |
|---|---|
| `frontend/src/hooks/fitness/FitnessSession.js` | Resume hydration, recorder configuration, timeline collection, catch-up loop |
| `frontend/src/hooks/fitness/FitnessTimeline.js` | Series indexing and rolling-window pruning |
| `frontend/src/hooks/fitness/TimelineRecorder.js` | Owns the timeline reference used by `recordTick()` |
| `frontend/src/hooks/fitness/usePlayerFrameCapture.js` | Player canvas/JPEG/base64 capture every second |
| `frontend/src/modules/Fitness/player/SessionCameraCapture.jsx` | Always-on hidden webcam capture and upload |
| `frontend/src/modules/Fitness/components/FitnessWebcam.jsx` | Snapshot canvas creation and JPEG encoding |
| `frontend/src/modules/Fitness/components/useWebcamSnapshots.js` | Async interval scheduler without single-flight protection |
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` | Component reporting sustained render thrashing |
| `frontend/src/Apps/FitnessApp.jsx` | App profiler that showed render collapse and video continuation |

## Conclusion

There are at least two defects:

1. A confirmed resume ownership bug causes an ingest-driven catch-up storm. The
   January pruning bug magnifies it but is not the primary trigger.
2. A separate fresh-process native OOM freezes the UI even with a healthy
   timeline. Always-on frame capture is the leading hypothesis, with sustained
   chart rendering as a likely contributor, but causality requires the proposed
   A/B soak.

The production rebuild/recreate and resulting mid-workout reload explain why the
old resume defect became visible today. They do not, by themselves, explain the
second OOM. The pruning-only patch must therefore be treated as partial until the
resume reference is fixed and the fresh-process memory growth is isolated.
