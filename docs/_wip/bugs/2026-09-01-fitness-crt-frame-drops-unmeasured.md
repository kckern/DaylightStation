# Fitness: "video dropping frames from the start" — the decoder says no, the CRT canvas is unmeasured, and the chart was re-rendering 13×/s the whole time

**Date:** 2026-09-01
**Found by:** field observation — a parent watched the garage kiosk during a session and saw judder from the first seconds of playback
**Status:** **instrumented** on `fix/sept1-incident-remediation` (`041a5eedc`, `a75237a8b`) and the profiler's false positive fixed (`7634d9e17`, `c698a5ffa`); awaiting merge and deploy. **The cause is still unconfirmed** and stays that way until a garage session runs with the new counter. Step 1 below is now built; steps 2 and 3 are not.
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

**Fixed** in `frontend/src/hooks/fitness/videoFpsSample.js` (`7634d9e17`): frames are divided by the `video.currentTime` delta. Under a second of media played (paused, stalled, seeking back) reports `fps: null` rather than a fake 0, which the `fps < 20` gate already skips; `lastFpsCheck` uses an explicit `null` sentinel instead of `timestamp > 0`, which conflated "no previous sample" with a timestamp that is legitimately 0.

Dividing by media time introduced a **new** false positive the wall-clock arithmetic did not have, closed in `c698a5ffa`: media time can *outrun* wall clock on a forward seek, and the fitness footer performs one (`useSeekState.js:195` writes `media.currentTime` directly) — 720 frames across a 60 s skip reads 12 fps and trips the same gate. The already-carried, never-read `timestamp` is now the discriminator: media time cannot exceed wall clock × `playbackRate` during real playback, so anything past that is a seek and reports `fps: null`. `playbackRate` is part of it because `Player.jsx` cycles it — at 2× media time legitimately advances at twice wall clock, and a bare comparison would call every fast-forward sample a seek and blind the profiler for the whole run.

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

1. ~~**Instrument the CRT renderer**~~ — **BUILT** (`041a5eedc`, `a75237a8b`). `lib/crtFrameStats.js` keeps the previous `metadata.presentedFrames`; a gap > 1 means the canvas never drew `gap − 1` frames. `crt.frames-skipped { skipped, mediaTime, drawnTotal, skippedTotal }` is emitted sampled (6/min, aggregating) — `skipped` is *this* gap, `skippedTotal` the running total, kept as distinct keys so a snapshot spread can never overwrite the gap with the total — and `crt.stopped { driver, drawn, skipped }` carries the instance's totals. Read it with the four caveats below.
2. **A/B by config.** Run one comparable session with the fitness player's upscale preset forced to `blur-only` (`useUpscaleEffects.js:19`) and compare by eye. If the judder disappears, the CRT pass is the cost; if it stays, it is the chart. *(not done)*
3. **Fix the chart thrash regardless.** 13 renders/s with no participants active and governance `pending` is not doing anything for anyone; it has been flagged in three separate reports now. *(not done — cause still not located)*

---

## How to read `crt.frames-skipped` — four caveats

The counter detects skips. It does **not** explain them, and three of these will mislead a reader who does not know them.

1. **It cannot separate main-thread starvation from legitimate rate capping.** A gap means our rVFC callback did not run for those frames. Whether that is the chart hogging the thread or the browser deliberately throttling composition is not distinguishable from this number alone.
2. **Firefox's fidelity in populating `presentedFrames` is UNVERIFIED.** The field is specified, and the garage kiosk is Firefox, but nobody has confirmed Firefox populates it faithfully there. **The first read of these logs must sanity-check that the values are non-null and monotonic before anyone concludes anything from them.** A browser that omits the field yields `skipped: 0` forever, which reads identically to a healthy session.
3. **`drawn` counts real paints.** The first cut counted pump invocations; `drawFrame()` bails out on a lost context, a failed upload and `readyState < 2`, and the pump keeps re-arming through all three, so the counter climbed against a black canvas for up to the ~1 s `failWatch` poll. Fixed in `a75237a8b` — `drawFrame()` now reports whether it painted and only a real paint is observed, which also makes the frames composited during such a stall count as the skips they are. Read `drawn` / `drawnTotal` as paints, not as callbacks. A pass that fails to paint is not observed at all, so its frames surface as the skips they are on the next successful paint.
4. **The counters are PER RENDERER INSTANCE, not per session.** The hook remounts the renderer on a context restore, a source change or a resolution change, and each instance starts from zero. **Anyone totalling a session must sum every instance's `crt.stopped` or they will undercount.**

### Open question: the renderer was created twice, 2.25 s apart

In this very session `crt.renderer-created` fired at **17:01:36.971** and again at **17:01:39.225** — a second instance 2.25 s later, at the exact moment the parent was watching the judder. Nothing has explained that double-creation. It is a candidate cause in its own right (a remount drops the frame pump and mints a fresh GL context and texture), and it also means any session total from this incident is split across two instances. Whatever a future session's counters say, the first thing to check is whether `crt.renderer-created` fired once or twice.

---

## Non-findings

- The DASH `quality-change` at 17:01:37 (720×480 → 853×480) is the transcode settling on its aspect, not a bitrate step-down; it happened once.
- The 3 startup remounts (17:01:05 / :20 / :35, `startup-deadline-exceeded`) are the stream taking ~45 s to first frame — the same slow-start pattern seen on the living-room TV at 16:49 (see `2026-09-01-story-time-second-book-stall-and-post-success-remount.md`, Incident A). They ended before playback began and are not the judder. (They are, however, adjacent in time to the unexplained double `crt.renderer-created` above — 17:01:35 vs 17:01:36.971 — so the two may share a cause.)
- `audio_cue.unlock_failed AbortError` at 17:00:50 is the cue unlock racing a media swap; the retry `audio_cue.unlocked` succeeded first. Unrelated.
