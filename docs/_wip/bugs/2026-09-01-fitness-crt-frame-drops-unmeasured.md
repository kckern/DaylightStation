# Fitness: "video dropping frames from the start" — the decoder says no, the CRT canvas is unmeasured, and the chart was re-rendering 13×/s the whole time

**Date:** 2026-09-01
**Found by:** field observation — a parent watched the garage kiosk during a session and saw judder from the first seconds of playback
**Status:** investigated, **not confirmed**. Every measured signal says the decoder was fine; the surface that was actually on screen has no instrumentation. Two concrete next steps below, one of them a five-line logging change.
**Severity:** low-medium as a symptom (playback continued), but the diagnostic gap is the finding: we cannot currently tell a decoder drop from a presentation drop, and the CRT path makes those two different things.
**Reference:** `docs/reference/player/surround/classical/README.md` (upscale/CRT chrome), `docs/_wip/bugs/2026-07-20-fitness-frontend-freeze-and-firefox-oom.md`, `docs/_wip/bugs/2026-02-02-fps-degradation-governance-warning.md`

---

## Session

`fs_20260901100054`, garage Firefox kiosk, Insanity Max:30 · *Modified—Cardio Challenge* (`plex:370720`), video from 17:01:37.7 UTC. The garage box is an Intel Alder Lake-P iGPU, 16 threads, load ≈ 2.7 (`ssh garage`, 17:12). `glxinfo` is not installed there, so Firefox's WebGL acceleration status was not verified.

---

## What was measured (and says "fine")

| Signal | Value | Source |
|---|---|---|
| `droppedVideoFrames` delta | **0** in every 30 s sample | `FitnessApp.jsx:198-247` (`getVideoPlaybackQuality`) |
| `fitness.video_fps_degraded fps=14.5 dropRate=0` | fired **once**, at 17:01:55, never again | profiler |
| rAF loop (`playback.render_fps`) | 56–60 throughout | player |
| `playback.fps_stats currentTime` | advances 10.0 s per 10 s sample | player |

The one sub-20 fps sample is a window artifact, not a drop. The profiler samples every 30 s; the video started 18.2 s before the 17:01:55 sample. 18.2 / 30 × 23.976 = **14.5**. The formula at `FitnessApp.jsx:224` divides frames by wall-clock elapsed, not by playing time, so a video that starts mid-window always reads low once. That warning should either use the video's own `currentTime` delta as the denominator or skip the first sample after `playback.started`.

## What was not measured (and is what was on screen)

The stream is a **480p DASH transcode** (`crt.mounted sourceWidth=720→853 sourceHeight=480`), which is exactly the `CRT_MAX_HEIGHT = 480` cutoff in `useUpscaleEffects.js:11`, so under the default `auto` preset the CRT shader is **on**. In that mode:

- the `<video>` is hidden; what the eye sees is a WebGL canvas (`crtRenderer.js`);
- the canvas repaints once per `requestVideoFrameCallback` (`crtRenderer.js:375-384`, `driver=requestVideoFrameCallback` confirmed in the log), i.e. on the **main thread**, doing a `texImage2D` upload of the frame, a pre-blur pass, and the crt-geom pass at display resolution;
- a late or coalesced rVFC callback is a frame the viewer never sees — and it is invisible to `getVideoPlaybackQuality`, which only counts what the decoder dropped.

And the main thread was not idle. From 17:01:43 for at least 2 minutes:

```
fitness.render_thrashing component=FitnessChart renderRate=13.2 rendersInWindow=66 sustainedMs=2023 … governancePhase=pending
fitness.render_thrashing … renderRate=13   sustainedMs=32202
fitness.render_thrashing … renderRate=13.2 sustainedMs=62433
fitness.render_thrashing … renderRate=14.4 sustainedMs=92668
fitness.render_thrashing … renderRate=13.8 sustainedMs=122734
```

`FitnessChart` re-rendered 13–14 times per second continuously (`useRenderProfiler.js:113`, threshold-tripped and sustained). Chart renders and rVFC draws share one thread. A 24 fps video needs a rVFC slot every ~42 ms; the chart was taking one every ~75 ms.

That is the inference: **decoder clean, presentation starved**. It is consistent with "from the get-go" (the thrash started 6 s after playback), and with the 2026-02-02 and 2026-07-20 reports where the same chart churn degraded the same kiosk. It is not proven, because nothing counts presented-vs-missed frames on the canvas.

---

## How to settle it

1. **Instrument the CRT renderer (recommended first, ~5 lines).** rVFC hands the callback `metadata.presentedFrames`. Keep the previous value; when the delta is > 1, the canvas skipped `delta − 1` frames. Emit `crt.frames-skipped { skipped, mediaTime }` sampled, and roll a per-minute total into the existing `playback.fps_stats`. After that, "dropped frames" on a CRT session is a number, not a feeling.
2. **A/B by config.** Run one comparable session with the fitness player's upscale preset forced to `blur-only` (`useUpscaleEffects.js:19`) and compare by eye. If the judder disappears, the CRT pass is the cost; if it stays, it is the chart.
3. **Fix the chart thrash regardless.** 13 renders/s with no participants active and governance `pending` is not doing anything for anyone; it has been flagged in three separate reports now.

---

## Non-findings

- The DASH `quality-change` at 17:01:37 (720×480 → 853×480) is the transcode settling on its aspect, not a bitrate step-down; it happened once.
- The 3 startup remounts (17:01:05 / :20 / :35, `startup-deadline-exceeded`) are the stream taking ~45 s to first frame — the same slow-start pattern seen on the living-room TV at 16:49 (see `2026-09-01-story-time-second-book-stall-and-post-success-remount.md`, Incident A). They ended before playback began and are not the judder.
- `audio_cue.unlock_failed AbortError` at 17:00:50 is the cue unlock racing a media swap; the retry `audio_cue.unlocked` succeeded first. Unrelated.
