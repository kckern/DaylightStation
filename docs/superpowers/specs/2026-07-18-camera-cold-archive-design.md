# Camera Cold Archive — Design

**Date:** 2026-07-18
**Status:** Implemented as `scripts/camera-archive/`. Not yet run against live hardware —
Pipeline C (ledger) is ready to schedule; Pipelines A and B are dry-run validated only.

## Problem

Two Reolink cameras (`driveway-camera`, `doorbell`, both in `data/household/config/devices.yml`)
record motion-triggered clips to onboard SD cards, and a Reolink RLN36 NVR records both of them
continuously. None of it is retained long-term: the SD cards cycle within weeks, and the NVR's
history began only when it was installed.

We want a durable archive of the moments that matter — kids playing in the front yard, who
visited the house — at a cost of a few hundred megabytes per day, with audio preserved well
enough that it can be transcribed later by a local ASR model (Whisper, Parakeet) if needed.

## Constraints

- **Budget:** a few hundred MB/day. Raw motion-clip capture is ~1.6 GB/day; the NVR's continuous
  sub-stream is ~5.4 GB/day; main-stream is ~22 GB/day. All far over budget.
- **No Dropbox for the archive.** The `data/` tree is Dropbox-synced and unsuitable for this
  volume. The NAS is the durable destination.
- **No automated transcription.** Transcription is done manually, locally, later. The pipeline
  stores audio only.
- **Everything config-driven.** Thresholds, weights, encoder settings, paths, and schedules are
  all externalized; no behavior is hardcoded.
- **Unattended operation.** This eventually runs nightly for years without supervision; an
  anomalous day must not blow the budget.
- **Execution deferred.** The deliverable is a reusable script, tested offline. No run against
  live hardware or the NAS is part of this work.

## Key findings from exploration

These measurements drove the design and are worth preserving — see Appendix for method.

### The hardware already does the hard part

Both cameras record motion-triggered clips to onboard storage, searchable and downloadable over
the Reolink HTTP API (`cmd=Search`, `cmd=Download`), and the NVR records both continuously and
exposes the same search API plus `cmd=NvrDownload`. All verified working against live hardware.

**No 24/7 RTSP capture is needed** — we harvest recordings the hardware already made. This is the
single most important structural finding: it removes any always-on capture process, and means the
archiver is a batch job that can run, fail, and re-run without losing anything.

### Measured volume (2026-07-17, a representative day)

| Camera | Clips | Motion time | Sub-stream | Main-stream |
|---|---|---|---|---|
| driveway | 573 | 593 min | 1287 MB | 22 GB |
| doorbell | 147 | 119 min | 302 MB | — |

Sub-stream clip format: 640x480 @ ~10fps h264 264kbps + AAC 16kHz mono 31kbps.

The driveway's 573 clips / ~10 hours of daily "motion" reflects heavy triggering on street
traffic and night-time noise, not 10 hours of meaningful activity.

### There are three storage sources, with very different properties

A Reolink **RLN36 NVR** exists on the network (not present in `devices.yml`; discovered during
exploration). It records **both cameras continuously, 24/7**, in 1-hour segments — not
motion-triggered clips.

| Source | Storage | Free | Coverage as of 2026-07-18 | Recording mode |
|---|---|---|---|---|
| driveway SD | 244 GB | 1.35 GB (99.4% full) | Jul 5 - Jul 18 (~14 d) | motion clips |
| doorbell SD | 244 GB | 50 GB | ~Apr 15 - Jul 18 (~95 d) | motion clips |
| **NVR** (ch0 doorbell, ch1 driveway) | 14.9 TB | **5.8 TB** | ~Apr 15 - Jul 18 (~95 d) | **continuous 24/7** |

The NVR is not cycling: at ~5.4 GB/day for both cameras against 5.8 TB free it has roughly 1,000
days of headroom. Its history begins in April because that is when it was installed, not because
older data was purged. **Footage is therefore not currently being lost.**

### What *is* perishable is the trigger metadata, not the footage

| Source | Trigger tags | Footage | Depth |
|---|---|---|---|
| HA history | person / vehicle / pet, both cameras | none | **10 days** (HA `recorder` default; no `recorder:` block configured) |
| driveway SD | AI filename bits, strongly discriminating | motion clips | **14 days** |
| doorbell SD | filename bits, weakly discriminating | motion clips | ~95 days |
| NVR | **none** — see below | continuous | ~95 days |

The NVR exposes no historical AI metadata: `SearchAiFile` and `GetAlarm` return "not support",
`GetAiState` reports only *live* alarm state, and NVR search records omit the `name` field
entirely, so there are no filename bits to parse. It preserves the video indefinitely but not the
"was that a person" signal.

**This inverts the urgency.** The time-critical work is not bulk footage rescue — it is capturing
a **daily trigger-metadata index** (clip times, filename bits, HA history; a few hundred KB/day of
JSON). Every day that index is not running costs a day of classification quality on footage that
will otherwise still be available years from now. It should ship first, ahead of any encoding.

### Naive "longest continuous activity" ranking fails

The longest driveway sessions on the sample day were at 00:00, 01:24, 03:03 and 04:07 — 86 and
70 minutes of sustained "activity" in the middle of the night, almost certainly rain, insects at
the floodlight, or vegetation moving. A duration-only ranking fills the archive with these and
crowds out real activity.

### Encoded bitrate density separates real activity from noise

Bitrate per minute, available directly in the `Search` metadata with no decoding:

| Session | Duration | MB/min |
|---|---|---|
| 01:37 (night) | 85.8 min | 0.90 |
| 00:00 (night) | 69.6 min | 0.88 |
| 18:01 (evening) | 28.4 min | 3.18 |
| 19:30 (evening) | 15.2 min | 3.42 |

A static night scene compresses to nearly nothing; bodies moving in daylight do not. ~3.5x
separation, free.

### Filename trigger bits work but must not be load-bearing

Reolink encodes trigger flags in a hex field in the recording filename. On the driveway these
discriminate strongly:

| Bit | Clips | MB/min | % daytime | Likely meaning |
|---|---|---|---|---|
| 35 | 90 | 3.37 | 98% | person |
| 38 | 190 | 3.19 | 89% | vehicle |
| 36 | 367 | 1.87 | 32% | plain motion |
| 32 | 75 | 1.28 | 9% | night/IR |

**However** the doorbell uses a different encoding entirely (10 hex chars vs the driveway's 14)
and its bits barely discriminate. This field is undocumented and model/firmware-specific — it
could change silently on a firmware update and corrupt the archive's selection quality for
months before anyone noticed.

**Decision:** classification comes from Home Assistant, which already exposes
`binary_sensor.driveway_camera_person` / `_vehicle` / `_animal` and the doorbell's `_visitor` /
`_pet`. `HomeAssistantAdapter.getHistory(entityIds, { sinceIso })` already exists. Filename bits
are a *fallback* signal only, used when HA history has a gap.

## Budget

| Tier | Per day | Per year |
|---|---|---|
| Full clips (video + audio) | 200 MB (hard cap) | 73 GB |
| Daily timelapse, both cameras | ~50 MB | 18 GB |
| Audio sidecars (daylight-gated, AAC copy) | ~96 MB | 35 GB |
| **Total** | **~345 MB** | **~126 GB** |

The 200 MB clip cap is the only hard limit. The other two tiers are naturally bounded by the
length of the day. The cap is what makes unattended operation safe: a party, a storm, or a stuck
floodlight cannot blow the budget.

## Architecture — Pipeline A (tagged)

This is the pipeline for days where trigger metadata exists: the last ~14 days, and every future
day once the detection ledger (Pipeline C) is running. Pipelines B and C are described below.

Run per camera, per day — eventually nightly at ~3 AM, once the day is closed:

### 1. Discover

`reolink.lib.mjs` `search(source, cameraId, day, 'sub')` returns the day's clip list with start
time, end time, size, and (camera source only) filename. Metadata only — nothing is downloaded
yet.

### 2. Classify

Fetch HA history for the camera's trigger sensors across the day. Join clip time ranges against
sensor-on intervals to label each clip `person` / `visitor` / `pet` / `vehicle` / `motion`.
Compute `density = sizeMB / durationMin` from the search metadata. Parse filename bits as a
fallback label source.

### 3. Sessionize

Cluster clips into activity sessions: consecutive clips with an inter-clip gap of <=120s belong
to the same session. A session carries its constituent clips, total duration, total size,
aggregate density, and the union of its clips' trigger labels.

### 4. Score and select

```
score = duration * trigger_weight * density_gate

trigger_weight:  person | visitor | pet   -> 3.0
                 vehicle                  -> 1.0
                 motion-only              -> 0.6

density_gate:    density < 2.0 MB/min     -> x 0.1
                 otherwise                -> x 1.0
```

Rank sessions by score descending. Select until the encoded-output budget (default 200 MB) is
projected to be exhausted. Selected sessions become full clips; everything else appears only in
the timelapse.

Validated against the sample day: this promotes the 18:00-19:30 evening block and drives the
86-minute 01:37 session to near-zero.

### 5. Fetch and encode

Only selected material is downloaded.

- **Full clips:** download the session's sub-stream clips, concatenate, re-encode video to hit
  the size target, **stream-copy audio** (`-c:a copy`).
- **Timelapse:** one per camera per day covering all motion including unselected sessions.
  Frame-sampled and sped up. No audio (meaningless when sped up).
- **Audio sidecars:** for daylight-gated events not already covered by a full clip, extract
  audio only with `-c:a copy` into `.m4a`.

### 6. Write, mirror, prune

Write to the hot tier, mirror to the NAS, verify the mirror, then prune hot entries older than
the retention window.

## Timelapse: sun-aware day/night profiles

Daytime and night-time footage have very different value density, so they get different treatment.
Night is a mostly-static dark frame that compresses to nothing and shows nothing; daytime is where
the yard activity is.

### Sun times are computed locally, not fetched

Sunrise and sunset are derived from a **NOAA solar-position calculation** over the configured
`weather.lat` / `weather.lng` (already present in `data/system/config/system.yml`:
47.4095, -122.1693, `America/Los_Angeles`).

This is deliberate over an API or HA's `sun.sun` entity. The backfill spans ~95 **historical**
dates, and live sources only report today: HA's `sun.sun` carries current state, and historical
sun data from weather APIs is generally a paid tier. The solar calculation is ~40 lines of pure
arithmetic with no network dependency, exact for any past or future date, and fully unit-testable
against known values. It also keeps the whole script runnable offline.

Fixed clock hours were rejected for the same reason they would be wrong in practice: sunset here
moves by roughly five hours between June and December, so a fixed 21:00 boundary would mislabel
most of the year.

### Separate outputs per lighting phase

**A single video file cannot change resolution mid-stream**, so differing day/night resolutions
cannot be concatenated into one timelapse. Rather than force a uniform resolution and waste bits
on darkness, each phase gets its **own file**:

```
timelapse-day.mp4     sunrise -> sunset, higher resolution, denser sampling
timelapse-night.mp4   sunset -> sunrise, low resolution, sparse sampling (or omitted)
```

This is also better to use: the day reel is the one anyone actually watches, and it is no longer
padded with hours of black frames. Setting `night.enabled: false` drops night entirely.

An optional `twilight` phase (civil twilight either side of sunrise/sunset) can be enabled for a
middle profile; it is off by default, since two phases cover the real distinction.

### Configuration

```yaml
timelapse:
  phases:
    day:
      enabled: true
      sampleEveryNthFrame: 30
      outputFps: 30
      scale: 1280x720
      crf: 28
    night:
      enabled: true
      sampleEveryNthFrame: 120    # 4x sparser — less to see
      outputFps: 30
      scale: 640x360              # quarter the pixels
      crf: 34
    twilight:
      enabled: false
      inherits: day
  sun:
    source: computed              # 'computed' | 'fixed'
    latitude: null                # null = inherit system.yml weather.lat/lng
    longitude: null
    offsetMinutes: { sunrise: -20, sunset: 20 }   # grace either side
    fixed: { dayStart: 7, dayEnd: 21 }            # only when source: fixed
```

`offsetMinutes` extends the day window slightly past true sunrise/sunset, since usable light and
activity both outlast the geometric event.

Pipeline B (untagged) inherits this structure with harsher values throughout — see its config
block below.

## Audio policy

**Store, never transcribe.** Transcription happens manually and locally, outside this system.

**Codec: AAC stream-copy (`-c:a copy`) into `.m4a`.** The source is already AAC 16kHz mono
31kbps — below most definitions of lo-fi. Re-encoding to Opus 16kbps would save ~17 GB/year
against 16 TB of free space (about 0.1% of the volume) while costing CPU on every clip and
stacking a second lossy codec on an already-lossy source. Distant outdoor speech is exactly the
case where ASR is most sensitive to compounded codec artifacts, and it is the case we care about.

Stream-copy is simultaneously cheapest, highest quality, and simplest. Whisper and Parakeet both
resample to 16kHz mono internally and ingest `.m4a` natively via ffmpeg.

An Opus re-encode path remains available as a config flag, off by default.

**Daylight gating:** audio sidecars are produced only for events within the active-hours window
(default 07:00-21:00). On the sample day this halved driveway audio (593 -> 294 min, 138 -> 68 MB)
while discarding only night-time rain and insect noise, which carries no speech.

Both cameras are treated symmetrically. An earlier draft gated the driveway's audio more
aggressively on the assumption that it was a pure motion surface while the doorbell was the
conversation surface; this was wrong — much of the front-yard play happens in the driveway
camera's field of view.

## Storage layout

```
Hot   media/archives/camera/<camera>/<YYYY-MM-DD>/
NAS   Archives/CameraArchive/<camera>/<YYYY>/<MM>/<DD>/
        day.json                manifest / index
        timelapse-day.mp4       sunrise->sunset, day profile, no audio
        timelapse-night.mp4     sunset->sunrise, night profile, no audio
        s01-1801-yard.mp4       selected sessions, with audio (Pipeline A only)
        audio/*.m4a             sidecars, AAC stream-copy

Ledger  media/logs/camera-archive/<camera>/<YYYY-MM-DD>.jsonl   (hot + NAS + Dropbox)
```

**Two tiers:**

- **Hot** — under `media/` (Dropbox-synced), retains the most recent N days (default 7) for
  convenient lookup. A pure cache.
- **NAS** — the durable backbone, authoritative, retained indefinitely.

Because hot is a cache and NAS is authoritative, pruning hot is always safe.

`day.json` is the lookup index. Per session it records time range, trigger labels, score,
density, whether it was selected, and output filenames.

## Backfill

Everything currently on the cameras' storage should be archived before it cycles out. This is
time-critical for the driveway, which has ~14 days of headroom and a full card.

### Source: the NVR, not the SD cards

The NVR is the preferred backfill source for both cameras. It holds ~95 days of **continuous**
footage for each, including ~81 days of driveway footage that the driveway's own card has already
cycled out. The SD cards are used only for their *trigger metadata*, which the NVR lacks.

### Sizing

Continuous 24/7 recording is far bulkier than motion clips (~2.7 GB/day/camera sub-stream):

| Backfill scope | Download volume | Wall clock @ ~20 MB/s |
|---|---|---|
| Full 24h, both cameras, 95 days | ~500 GB | ~7 h |
| Daylight window only (07-21), 95 days | ~290 GB | ~4 h |
| Selected sessions only (no timelapse) | ~30 GB | ~25 min |

Archived output is ~29 GB either way — negligible against 16 TB. **The binding constraint is
download volume and time, not storage.** Backfill timelapse scope is therefore configurable
(`full` / `daylight` / `none`).

### Design

**Backfill is the same script run over a date range** (`--range`), not a parallel implementation.
This matters: a separate backfill path would drift from the per-day path and produce an archive
whose older entries were selected by different rules than its newer ones.

`--range` enumerates the target dates, skips days already complete in the manifest, and runs the
same per-day pipeline for each.

### Execution policy

- **Discover real coverage first.** Use `cmd=Search` with `action:1` / `onlyStatus:1` to get the
  per-month day table from each camera rather than assuming a range. Only days the camera reports
  as having recordings are attempted.
- **Oldest-first.** Sourcing from the NVR removes the cycle-out race entirely, so ordering is a
  simple preference rather than a risk decision.
- **Sequential — one segment at a time.** Default `downloadConcurrency: 1`. The house is on wired
  gigabit, so bandwidth is not the constraint; the concern is the NVR, which is simultaneously
  recording both cameras live. One-at-a-time keeps the pull well clear of that and makes progress
  and failures easy to reason about. Downloading the full ~500 GB is explicitly acceptable.
- **Overnight.** Intended to run when nobody is using the network. A configurable inter-segment
  pause and an optional run window keep it out of the way.
- **Transient source files.** Each downloaded segment is extracted (audio out, frames sampled for
  timelapse) and then deleted before the next is fetched, so peak local disk stays near one
  segment rather than 500 GB.
- **Resumable and idempotent.** The per-day manifest is the ledger. An interrupted backfill
  resumes at the first day lacking a complete manifest; a completed day is never re-fetched.
- **Runs off-peak.** Default to a window that avoids competing with the nightly job.

### Configuration

```yaml
backfill:
  enabled: false             # opt-in; run explicitly
  order: oldest-first        # NVR is not cycling, so no race to win
  interSegmentPauseMs: 1000
  maxDaysPerRun: null        # null = until exhausted
  runWindow: { start: 23, end: 7 }   # overnight; null disables the guard

  # Pipeline B — the untagged range, where no trigger data survives
  untagged:
    range: 2026-04-15..2026-07-04
    timelapse:
      phases:                      # same shape as Pipeline A, harsher throughout
        day:
          enabled: true
          sampleEveryNthFrame: 120 # 4x sparser than Pipeline A's day profile
          outputFps: 30
          scale: 854x480
          crf: 32
        night:
          enabled: true
          sampleEveryNthFrame: 300 # 10x sparser; near-contact-sheet
          outputFps: 30
          scale: 480x270
          crf: 36
    audio:
      hours: 24                    # keep everything, not daylight-gated
      audioCodec: copy             # 'copy' | 'opus'
      opusBitrateKbps: 16
      silenceRemove: false         # risks clipping speech onsets; opt-in only
```

Note the deliberate asymmetry in Pipeline B: video settings are harsher than Pipeline A's in every
dimension, while audio is *more* complete (24h rather than daylight-gated). That is the whole
point of the split — without trigger data the video is low-value and the audio is not.

Ordering no longer needs to be per-camera: with the NVR as the source and ~1,000 days of headroom,
nothing is racing a cycle-out, so plain `oldest-first` is fine.

### Three pipelines

Selection quality depends entirely on trigger metadata, and that metadata does not exist beyond
~14 days. Rather than one pipeline that silently degrades, there are **three explicit pipelines**:

| | **C — detection ledger** | **A — tagged** | **B — untagged** |
|---|---|---|---|
| Range | daily, forever | last ~14 d + nightly | ~Apr 15 - Jul 4 |
| Trigger data | *is* the trigger data | HA history / SD bits | none |
| Video | none | selected sessions + timelapse | **timelapse only, hard-compressed** |
| Audio | none | sidecars, daylight-gated | **as complete as possible, 24/7** |
| Downloads | **none** | selected only | full source (transient) |
| Size | ~300 KB/day | ~345 MB/day | ~360 MB/day/camera |

## Pipeline C — the detection ledger

**An independent, append-only, text-only record of what the cameras detected, stored separately
from any video.**

Its purpose is threefold: it is the trigger index Pipeline A selects against; it is a durable
secondary attestation of what happened if video is lost, corrupted, or never archived; and it
makes future re-selection possible without re-downloading anything.

### Why it ships first

It is the only part of this system that is **actively losing data every day**. HA history holds
10 days; the driveway's AI filename bits hold 14. The NVR preserves video for years but records
no detections at all. Every day the ledger is not running is a day whose classification is gone
permanently — while the footage it describes will still be sitting there.

It also has no dependencies: no downloads, no ffmpeg, no NAS mount, no encoding decisions. It can
run correctly long before any of the archiving questions are settled.

### Sources

| Source | Contributes | Cadence |
|---|---|---|
| HA history (`getHistory`) | person / vehicle / pet / visitor state changes, both cameras | daily (10-day window = 10x safety margin) |
| Camera SD `Search` | clip times, sizes, parsed AI filename bits | daily (14-day window) |
| NVR `Search` | continuous hourly segments + sizes -> density timeline | daily (~95-day window) |

Daily capture against a 10-day floor is a deliberately large margin: the ledger can miss a week
of runs — a container restart, a holiday, a broken HA token — and lose nothing.

### Format

Append-only **JSONL, one file per camera per day**, written to *both* tiers and safe for Dropbox:

```
media/logs/camera-archive/<camera>/<YYYY-MM-DD>.jsonl
```

One record per detection interval or clip:

```json
{
  "ts": "2026-07-17T18:01:03-07:00",
  "endTs": "2026-07-17T18:01:41-07:00",
  "camera": "driveway-camera",
  "labels": ["person"],
  "source": "ha",
  "confidence": "high",
  "clip": { "name": "RecS0A_DST20260717_180103_180141_...", "sizeBytes": 2118451 },
  "densityMBPerMin": 3.18
}
```

`source` (`ha` | `filename-bits` | `density`) and `confidence` are recorded per record rather than
inferred, so a future consumer can tell a real HA person-detection from a density guess — and so
the weaker records can be upgraded later without touching the stronger ones.

The schema is intentionally open to richer detections (bounding boxes, object counts, per-object
confidence) should a local detector be added in phase 2. Records are never rewritten, only
appended; a re-run of a day writes a new file version rather than mutating history, preserving the
attestation property.

### Storage

Unlike the video, the ledger is small enough (~300 KB/day, ~110 MB/year) to keep **everywhere**:
hot tier, NAS, and Dropbox-synced `media/` all at once. That inverts the video's storage
asymmetry — the cheapest artifact gets the most redundancy, which is correct, because it is the
one that cannot be regenerated.

The reasoning behind Pipeline B: with no way to tell a person from a passing car, any clip
selection is guesswork, and keeping "probably interesting" video at watchable quality would spend
the budget on noise. Audio is the opposite — it stays valuable without tags, because it can be
turned into searchable text later. So Pipeline B spends almost nothing on video and as much as
needed on audio.

#### Pipeline B sizing (95 days, both cameras)

Audio is muxed into the video, so the full source must be downloaded once regardless; it is
extracted and then discarded.

| Item | Per day/camera | 95 days, 2 cameras |
|---|---|---|
| Source download (transient) | ~2.7 GB | **~500 GB** |
| Timelapse, hard-compressed | ~25 MB | ~4.8 GB |
| Audio 24/7, AAC stream-copy | ~335 MB | ~64 GB |
| Audio 24/7, Opus 16k *(alternative)* | ~173 MB | ~33 GB |
| **Retained total (AAC copy)** | **~360 MB** | **~69 GB** |

69 GB against 16 TB free is a non-issue; the download time (~7 h) is the only real cost.

Recommendation: **AAC stream-copy here too.** It is zero-CPU and lossless-relative-to-source, and
the 31 GB saved by Opus is irrelevant at this scale — but the codec is configurable, per the
requirement to keep audio compression tunable.

A `silenceremove` / VAD pass would cut the audio dramatically, since most of 24/7 outdoor
recording is dead air. It is **not** enabled by default: trimming risks clipping the onset of
speech, which is exactly what this tier exists to preserve. Available as a config flag.

### Reconstructing trigger classification for the backfill

Trigger metadata does not reach as far back as the footage, so classification degrades with age
and the pipeline must layer its sources and record which one it used:

| Age | Best available signal |
|---|---|
| 0-10 days | HA history (person / vehicle / pet) |
| 10-14 days | driveway SD filename AI bits; doorbell SD bits |
| 14-95 days | **none survives** — must be derived |

For the 14-95 day range, derivation uses **bitrate density from NVR search metadata**, which
requires no download and already demonstrates ~3.5x separation between real daytime activity and
night-time noise, combined with the daylight-hours window.

A local ONNX person detector over sampled frames would classify this range properly, but it is a
material scope increase (model, runtime, per-frame cost over ~500 GB). **Deferred to a phase 2**;
the manifest records `classificationSource` per session so anything derived by the weaker method
can be re-classified later without re-downloading.

### NVR extraction mechanics

The NVR does **not** support the cameras' single-call `cmd=Download&source=<name>` path, because
its search results omit `name`. Extraction is two steps, both verified working:

1. `cmd=NvrDownload` with `{channel, streamType, StartTime, EndTime}` -> returns a generated
   `fileName` (e.g. `fragment_02_2_20260717110000.mp4`) and its size.
2. `cmd=Download&source=<fileName>&output=<name>` -> the bytes.

Notes:
- **Query-parameter auth (`user`/`password`) is required.** Token auth via `cmd=Login` returns
  "please login first" on `NvrDownload`, and `cmd=Playback` returns 403 regardless. Do not
  attempt the token path.
- **NVR fragment filenames are UTC**, while `StartTime` / `EndTime` in the request are local. An
  18:00 local request yields `...20260717110000` (UTC-7). Filenames must never be parsed as local
  time.
- Arbitrary time ranges are accepted — extraction is not limited to the stored 1-hour segment
  boundaries, so sessions can be cut to exact bounds server-side.

`ReolinkRecordingAdapter` therefore needs two source profiles — `camera` (single-call download,
`channel: 0`) and `nvr` (two-step, per-camera `channel`) — behind one interface, selected by
config.

## Failure handling

- **Idempotent per day.** The manifest is the ledger; a re-run resumes rather than duplicating.
- **NAS unavailable** — fail loudly and **never prune hot**. Losing the cache while the backbone
  is unreachable would lose data.
- **Camera unreachable** — record a partial day in the manifest and retry on the next run.
- **HA history gap** — fall back to filename trigger bits, and record in the manifest that the
  fallback was used, so selection quality is auditable after the fact.

## Deliverable: a reusable script, not yet a backend service

The first deliverable is a **standalone, reusable script under `scripts/camera-archive/`** — not
a wired-in nightly job. Rationale: the selection heuristics are derived from a single sample day
and will need iteration against real output. A script can be run repeatedly against arbitrary date
ranges, with its config tweaked between runs, without touching the running container or the
scheduler. Once the heuristics are proven, promoting it to a scheduled job is a thin wrapper.

**Execution is deliberately deferred.** Nothing is run against the cameras, the NVR, or the NAS as
part of building this. The script is written and unit-tested against captured fixtures; the first
real run is a separate, explicit decision.

### Structure

| Path | Responsibility |
|---|---|
| `scripts/camera-archive/index.mjs` | CLI entry: arg parsing, config load, orchestration |
| `scripts/camera-archive/reolink.lib.mjs` | `Search` / `Download` / `NvrDownload`; camera + NVR profiles |
| `scripts/camera-archive/encode.lib.mjs` | ffmpeg: concat, timelapse, sidecar extraction |
| `scripts/camera-archive/select.lib.mjs` | **pure**: sessionize, score, select |
| `scripts/camera-archive/manifest.lib.mjs` | `day.json` read/write, resumption ledger |
| `scripts/camera-archive/*.test.mjs` | unit tests against captured fixtures |
| `scripts/camera-archive/config.yml` | all behavior (see Configuration) |

This mirrors the existing `cli/backfill-media-durations.{mjs,lib.mjs,test.mjs}` convention — thin
entry point, logic in `.lib.mjs`, tests alongside. (If it later reads better under `cli/` with the
`_bootstrap.mjs` / `_argv.mjs` helpers, that is a move, not a rewrite.)

The `.lib.mjs` split matters most for `select.lib.mjs`: sessionization, scoring, and selection are
the parts that will need the most tuning, and keeping them pure means they are testable against
real captured clip metadata with no camera, no NVR, and no ffmpeg in the loop.

### Modes

```
# Pipeline C — detection ledger (no downloads; run daily, ships first)
scripts/camera-archive ledger --day today
scripts/camera-archive ledger --range 2026-07-08..2026-07-18

# Pipeline A — tagged: selected sessions + timelapse + daylight audio
scripts/camera-archive archive --day 2026-07-17 [--camera driveway-camera]

# Pipeline B — untagged: hard timelapse + full 24/7 audio
scripts/camera-archive backfill-untagged --range 2026-04-15..2026-07-04

# Any mode, planning only
scripts/camera-archive <mode> ... --dry-run
```

`--dry-run` is the primary tuning tool: it prints the sessions, their scores, what would be
selected against the budget, and projected download and output sizes — without fetching anything.
Given that a real Pipeline B run is a ~7-hour, ~500 GB operation, being able to inspect the full
plan first is not a convenience but a requirement.

Every mode is resumable and idempotent against the manifest, so an interrupted overnight run
continues where it stopped.

### Later: promotion to a scheduled service

Once proven, the same libs move behind `1_adapters/camera/ReolinkRecordingAdapter.mjs`,
`1_adapters/camera/ArchiveEncoder.mjs`, `2_domains/camera/` (the pure selector), and
`3_applications/camera/usecases/ArchiveCameraDay.mjs`, with config relocating to
`data/household/config/camera-archive.yml`. Writing the libs dependency-light and config-driven
from the start is what makes that a move rather than a rewrite. **Out of scope for now.**

The existing `ReolinkCameraAdapter` stays snapshot/stream-only; recording search and download go
in a sibling adapter so neither file grows into a grab-bag.

Keeping the domain layer pure is deliberate: sessionization, scoring, and selection are the parts
most likely to need tuning, and they are testable against real clip metadata with no camera and
no ffmpeg in the loop.

## Configuration

**Everything is externalized.** No thresholds, weights, encoding parameters, paths, or schedules
are hardcoded. The pipeline reads its entire behavior from
`data/household/config/camera-archive.yml`, loaded via
`ConfigService.getHouseholdAppConfig(null, 'camera-archive')`.

This is a deliberate requirement, not a convenience. The selection heuristics are derived from a
single sample day and *will* need retuning against accumulated real data; the encoding settings
trade quality against a budget that may shift. Both must be adjustable without a code change or
redeploy.

```yaml
cameras:
  - id: driveway-camera
    activeHours: { start: 7, end: 21 }
  - id: doorbell
    activeHours: { start: 7, end: 21 }

schedule: "0 3 * * *"

sources:
  nvr:
    kind: nvr                # two-step NvrDownload -> Download
    host_ref: reolink-nvr    # host from devices.yml, credentials from auth_ref
    channels: { doorbell: 0, driveway-camera: 1 }
  camera:
    kind: camera             # single-call Download by filename
    channel: 0

source:
  footageFrom: nvr           # continuous, deepest history
  metadataFrom: camera       # trigger bits live only on the cameras
  streamType: sub            # 'sub' or 'main'
  downloadConcurrency: 1     # sequential; gigabit wired, NVR is the constraint
  downloadTimeoutMs: 60000
  retries: 3
  deleteSourceAfterExtract: true   # keeps peak disk ~1 segment, not ~500 GB

budget:
  fullClipsMB: 200           # hard cap per camera per day

sessionize:
  maxGapSeconds: 120

scoring:
  triggerWeights:
    person: 3.0
    visitor: 3.0
    pet: 3.0
    vehicle: 1.0
    motion: 0.6
  densityFloorMBPerMin: 2.0
  densityPenalty: 0.1

encoding:
  fullClip:
    videoCodec: libx264
    crf: 28
    preset: veryfast
    scale: null              # null = keep source resolution
    fps: null                # null = keep source fps
    audioCodec: copy         # 'copy' | 'opus'
    opusBitrateKbps: 16      # only when audioCodec: opus
    container: mp4
    extraArgs: []
  timelapse:
    videoCodec: libx264
    container: mp4
    extraArgs: []
    # per-phase sampling/scale/crf live under the top-level `timelapse.phases`
    # block (see "Timelapse: sun-aware day/night profiles")
  audioSidecar:
    audioCodec: copy
    container: m4a
    extraArgs: []

classification:
  source: homeassistant      # 'homeassistant' | 'filename' | 'auto'
  sensorsByCamera:
    driveway-camera:
      person:  binary_sensor.driveway_camera_person
      vehicle: binary_sensor.driveway_camera_vehicle
      pet:     binary_sensor.driveway_camera_animal
    doorbell:
      visitor: binary_sensor.front_door_visitor
      person:  binary_sensor.front_door_person
      vehicle: binary_sensor.front_door_vehicle
      pet:     binary_sensor.front_door_pet
  matchToleranceSeconds: 15

storage:
  hotPath: media/archives/camera
  nasPath: /archives/CameraArchive    # container-side mount point
  requireNasForPrune: true

retention:
  hotDays: 7
  nasDays: null              # indefinite
```

`extraArgs` on each encoder profile is an intentional escape hatch: ffmpeg tuning is exactly the
kind of thing that needs adjusting in production without a code change.

`classification.source: auto` prefers Home Assistant and falls back to filename bits on gaps.

## Testing

Because execution is deferred, the entire test suite must run offline against captured fixtures.
The `Search` responses for both cameras and the NVR for 2026-07-17, and one downloaded clip from
each source, should be committed as fixtures — they are the evidence this design was derived from
and the only way to test selection without hitting hardware.

- **Unit (primary):** `select.lib.mjs` — sessionizer, scorer, selector — against the captured
  clip metadata. Pure functions over data; no camera, no NVR, no ffmpeg, no network. Assert
  specifically that the 01:37 night session ranks **below** the 18:01 evening session, since that
  inversion is the entire point of the density gate.
- **Adapter (offline):** `reolink.lib.mjs` request construction and response parsing against
  recorded fixtures — including the NVR's `name`-less schema and the UTC fragment-filename
  parsing, both of which are easy to get wrong and impossible to notice without a test.
- **Encoder:** ffmpeg invocations against a small fixture clip, asserting output size, duration,
  and audio stream presence/codec. Assert that encoder settings actually come from config — a
  test that passes a non-default CRF and verifies it reaches the ffmpeg argv catches the most
  likely form of config regression.
- **Backfill:** range enumeration, skip-already-archived, and ordering, against a fake datastore.
  Assert resumption skips complete days and retries incomplete ones.

## Phasing

Ordered by perishability, not by size — the smallest piece is the urgent one.

**Phase 1 — detection ledger (Pipeline C).** No downloads, no ffmpeg, no NAS, no encoding
decisions. Ships first because it is the only component losing data daily. Once running, the
10-day HA and 14-day SD windows stop being deadlines and everything else can be built calmly.

**Phase 2 — tagged archive (Pipeline A).** The per-day pipeline and its selection heuristics,
tuned via `--dry-run` against the ledger and captured fixtures. Small downloads, fast iteration.

**Phase 3 — untagged backfill (Pipeline B).** Only after A's encoder settings are proven, since
this is a single ~7-hour, ~500 GB pass and re-running it because of a bad CRF is expensive.

**Phase 4 (deferred) — promotion and enrichment.** Move the libs behind the DDD layers and
schedule them; optionally add a local ONNX detector to retroactively classify the untagged range,
upgrading ledger records in place.

## Known risks

- **AAC concat timestamp gaps.** Concatenating AAC across clip boundaries with `-c:a copy` may
  leave timestamp discontinuities where the camera's recordings butt against each other. Must be
  verified against real multi-clip sessions during implementation; the fallback is a single
  re-encode at the session level.
- **Trigger-weight tuning is speculative.** The 3.0 / 1.0 / 0.6 weights and the 2.0 MB/min floor
  are derived from one sample day. They are config, and the manifest records each session's score
  and selection outcome so they can be retuned against accumulated real data.
- **Sub-stream resolution ceiling.** The archive is 640x480-class footage. Sufficient for "who
  visited" and "kids playing," insufficient for reading a licence plate. Preserving main-stream
  quality for selected sessions would be a future extension, at roughly 17x the per-clip cost.

## Ops notes

Because the first deliverable is a **host script rather than a container service, no Docker bind
mount is needed yet.** The script reaches both destinations directly on the host. The bind mount
into `deploy-daylight` only becomes a prerequisite if and when this is promoted to a scheduled
in-container job.

**Write permissions differ by destination** (observed 2026-07-18):

| Path | Owner / mode | Writable by `claude`? |
|---|---|---|
| `/media/kckern/Media/Archives` (NAS) | `root:root 0777` | yes |
| `.../DaylightStation/media/archives` (hot) | `kckern:kckern 0755` | **no** |

So the script must run as `kckern` (or root) to write the hot tier. Running as `claude` can
populate the NAS backbone but not the Dropbox cache. The script should check both destinations
for writability up front and fail with a clear message rather than partway through a multi-hour
backfill.

Reolink credentials come from `data/household/auth/reolink.yml` (the same `auth_ref: reolink`
both cameras already use, and which the NVR accepts). The NVR itself is **not** in `devices.yml`
and should be added there so its host is configured rather than hardcoded.

## Out of scope

- Automated transcription (explicitly excluded — done manually and locally).
- A browsing UI. `day.json` plus the directory layout is the interface for now.
- Main-stream / high-resolution retention.
- Live viewing, which the existing `HlsStreamManager` already handles.

## Appendix: method

Measurements were taken by calling `cmd=Search` against both cameras for 2026-07-17, clustering
the returned clip list by inter-clip gap, and computing per-session duration, size, and bitrate
density. A single clip was downloaded via `cmd=Download` and probed with `ffprobe` to confirm the
container format, codecs, and bitrates cited above. Trigger-bit meanings were inferred by
correlating each varying bit against time-of-day distribution and bitrate density across the
day's 573 driveway clips — an empirical correlation, not documented vendor behavior, which is why
the design does not rely on it.
