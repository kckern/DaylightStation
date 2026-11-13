# Content Filter

**Status:** Implemented: model, API, player integration (default-on for certified titles) and
the preview surround (below). Bulk authoring is CLI (`cli/contentfilter.cli.mjs`); a
grown-up reviews and rules on a title from the preview surround while it plays. A subtitle
cue review queue (`srt-review`, below) gives a grown-up a model's second opinion on
word-list mutes; it never edits cues.

## Purpose

The content-filter subsystem applies optional, client-side filtering to owned video. A
title can have cues that are skipped, muted, bleeped, blurred, or shown with an overlay.
The video file is never rewritten or transcoded.

The canonical internal representation is a YAML **filter EDL** (edit-decision list),
keyed by the Plex rating key. External sources such as VidAngel, MCF/WebVTT, Whisper,
SRT word lists, and VideoSkip `.skp` files are producers of this representation; the
player is its consumer.

## Three-layer model

Filtering is resolved in three layers, in this order:

1. **Base EDL** — observations about what occurs and when. It is vendor-neutral and
   does not force a presentation choice.
2. **Profile** — household policy mapping categories to effects and presentation
   parameters (for example, profanity → mute, graphic violence → skip).
3. **Override** — title-specific changes: synchronization, disabled cues, added cues,
   blur rectangles, and explanatory cards.

This keeps regenerated imports from overwriting household policy or manual corrections.
Overrides bind to cue IDs and categories rather than to a particular import file.

## Base EDL format

EDLs live at `media/content-filter/edl/{ratingKey}.edl.yml`.

```yaml
contentId: plex:370578
precision: ms            # ms | second-approx | srt-line
source: vidangel         # vidangel | mcf | whisper | srt | manual
cues:
  - id: va123
    category: language/profanity/fuck
    channel: audio        # audio | video | both
    severity: medium      # low | medium | high
    in: 168.20            # seconds; numeric, may be fractional
    out: 168.55
    label: f-word
    suggestedType: mute   # hint only; profile may override it
```

Required practical invariants:

- `contentId` identifies the media item (`plex:{ratingKey}`).
- Every cue has a stable `id`, category and numeric `in`/`out`, and should carry a
  channel.
- `severity` is optional in practice: VidAngel EDLs never carry it; SRT word-list cues
  do, derived from the word-list tier (see below). The resolver does not read it.
- `out` is later than `in`; cues are sorted by start time when resolved.
- `precision` records timing confidence. Approximate cues receive effect-specific
  safety widening; millisecond cues do not.
- `suggestedType` is a source hint, not household policy.

## Profiles

Profiles live at `household/content-filter/profiles/{profileName}.yml`. They map the
hierarchical category path to an effect. Longest-prefix matching applies, so a rule for
`language/profanity` covers `language/profanity/fuck` unless a more-specific rule exists.

```yaml
categories:
  language/profanity: { effect: mute }
  violence/graphic: { effect: skip }
  sex_nudity: { effect: skip }
  violence/non_graphic: { effect: off }
treatments:
  mute: { padLeadMs: 200, padTrailMs: 150 }
theme:
  barColor: "#000"
```

`action` is accepted as a legacy alias for `effect`. An unmapped category is not
filtered when a profile contains category rules.

## Per-title overrides

Overrides live at `household/content-filter/overrides/{ratingKey}.yml`.

```yaml
sync: { scale: 1.0, offsetSec: 1.25 }
cueOverrides:
  va123: { disabled: true }
addCues:
  - { id: manual-1, category: sex_nudity, channel: video, in: 4512, out: 4518 }
cards:
  - { after: va456, text: "Skipped a long torture scene." }
```

Override effect/time values take precedence over the base cue. Manual `addCues` are
already in local playback time and are not globally synchronized. Per-cue precise times
also bypass global synchronization.

## Resolution and effects

`__app_modules/media/media/browser/content-filter/contentFilter.js` resolves the three layers into flat,
effective cues. Precedence is:

`cue override` → `cue effect` → `profile rule` → `cue type` fallback.

The effect registry currently supports transport skips, audio mute/bleep/duck, and
overlay effects including blur, censor bars, pixelation, full blur, and title cards.
Timing pads protect against playback-driver granularity and source drift. Approximate
mute cues are widened more than skips because a narrow window can leak a spoken word.

### Picture effects never stack

Overlapping picture effects (whole-frame blur under regional blurs, an identical pair, a blur under a
blackout) resolve to the strongest for each instant, in one pass that runs after the per-cue and
same-subject resolution and before scenes (`resolvePictureStacking` in `contentFilter.js`). The
strength order is defined once there (`pictureRank`): `skip`/`skip-card` > `blackout` >
whole-frame blur (`full-blur`, or any overlay with no rect) > regional (`censor-bar`, `pixelate`,
`blur` on a rect). It reuses the scene `HIDE_RANK` with a rectless overlay lifted to whole-frame;
ties between effects of one rank fall to `STRENGTH`. A weaker piece is trimmed to the time outside
every stronger one (`outsideSpans`, ids gain `#s<n>`; dropped when nothing remains). Same effect
over the same area (whole-frame, or the same rect) merges into one span. Two regional pieces over
different areas never trim one another, and a skip inside a scene's blackout is the scene's own
rule (it keeps the cues that hide more), not a stack. Audio effects are never touched.
`resolveEffectiveCues({ stackGuard: false })` skips the pass for the scan only.

### Hide picture, and long hides (`treatments`)

`effect: blackout` on a category rule (or a cue/override ruling) is **Hide picture**: a black
picture with a title card for its first seconds, sound untouched, never regional. It is built by
`hidePiece` in `contentFilter.js`, the same shape a scene blackout takes, so one renderer draws both;
a segmented cue cards once (only its first piece carries `firstPiece`). The card text is the approved
card, else `treatments.blackout.text` (default "Picture hidden."); the card holds
`treatments.blackout.cardSec`, else `treatments['skip-card'].holdSec`, else 2.5 s. Pads and minimum
widths for approximate cues are the full-blur ones.

A long whole-frame blur is not watchable, so it plays as the same card over the same sound
(`convertLongHides`, `longHide.js`). Every maximal run of whole-frame blur pieces (`full-blur` or an
overlay with no rect, gaps up to the resolver's 1 s bridge joined) lasting longer than
`treatments['full-blur'].maxSec` (default 5; `null` or `0` turns it off) becomes one blackout over
the run's union, bridged gaps included. Shorter runs stay blurs; regional pieces do not count.
A tracked cue in a category without `regional: true` resolves whole-frame, so it counts. An explicit
household ruling is never second-guessed, except that a ruled whole-frame blur (`full-blur`, or
`blur`/`pixelate`/`censor-bar` with no rect) counts like any other.
Hiding only grows: a conversion never replaces a blur with less.

Order inside `resolveEffectiveCues`: picture stacking, then the long-hide conversion, then stacking
again (drops regional pieces now under the blackout), then scenes. A skip inside a run still skips,
and a scene blackout covering the run leaves one card, not two. `stackGuard: false` (the
stacked-moments scan) skips the conversion with the stacking. A profile with no `treatments` uses
the defaults; the log event is `content-filter.long-hide.converted` (debug).

### Channel-matched effects (R1, R2)

Every cue has a modality (`cueModality`, `shared/contracts/content-filter/cueModality.mjs`):
`said` (VidAngel type `mute`, or refine judged it speech), `shown` (type `skip`/visual, or refine
judged it shown; credits), `heard` (a non-speech sound). An effect must fit the cue's channel:
audio effects (mute, bleep, duck) only on `said`, mute also on `heard`; visual effects (blur,
full-blur, censor-bar, pixelate, blackout) only on `shown`; skip and skip-card on any. A profile
effect that does not fit maps to the channel's equivalent (`fitEffectToChannel`): `shown` + audio
effect, blur or full-blur -> regional `blur` when the cue has a usable region track (at least one
sighting) **and its category rule says `regional: true`**, else `full-blur` (R2): regional blur is
opt-in per category, never the default. The flag survives a per-film settings patch and the household
"Everywhere" toggle (they change the effect, not the permission). A tracked cue that asked for `full-blur` (profile or a household
`cueOverrides` effect) plays the regional blur at the full-blur radius (`heavy: true`); a household
that wants more on a tracked cue picks `censor-bar`, `pixelate`, `blackout` or `skip`;
`said`/`heard` + a visual effect -> `mute`. The resolver logs the change as
`content-filter.effect.adjusted`. Cues with neither a type nor a refine kind (hand-added) are left
as authored. The refine kind comes from the refine stamp (`refine.kind`: speech, speech-line,
visual, credits), written by refine on refined and coarse-edge cues alike; it beats the VidAngel
type when both are present.

### Rules at a glance

| Rule | Where it lives |
|------|----------------|
| R1 channel matches modality, R2 regional when tracked | above |
| R3 tones are word-sized, R4 lines and exchanges | Audio effects |
| R5 cue-level cards | Scenes (Cue cards) |
| R6 same-subject tags, R7 refine is safe to re-run, R8 refine on the server | Refined EDLs |
| R9 language is five groups | Profiles and settings (Language groups) |

### Audit (`contentfilter audit <rk>`)

`contentfilter audit <ratingKey> [--profile <name>] [--part <id>] [--json]`
(`cli/contentfilter/auditCommand.mjs`) is the proof for a title. It loads the refined EDL (else
the raw one), the override with its `profilePatch` and the profile (default `family`) the way the
API does, runs the player's own `resolveEffectiveCues` and measures what would play. It writes
nothing. Output is a table on stderr; `--json` also prints the report on stdout. It exits 1 when a
hard check fails. (The frontend logger writes to stdout; the CLI sends it to stderr so `--json` stays parseable.)

- **Hard checks:** no bleep longer than 1.5 s (count and ids); no audio effect on a `shown` cue;
  no visual effect on a `said` cue (ids).
  `picture-overlap`: resolved picture pieces that stack (`pictureOverlaps`), one finding per overlapping
  group with its time span and source cue ids. The precedence pass keeps it empty; a failure means a
  stacking path the pass does not cover.
- **Region tracks:** `track data n/m` is the Proof metric: the share of `shown` cues (that
  resolve to an overlay) whose data carries a region track, target 70%, flagged PASS/FAIL but not
  fatal. `resolved regional n/m` is printed as information: the cues that actually play a
  regional piece. It sits below the data share only where a track never sighted its subject or
  the effect is stronger than a blur (blackout, skip). Coarse-edge tracks are counted separately.
- **Same-subject groups (R6):** groups of two or more `shown` cues, their members, and how many
  resolve to a single effect. A group nothing resolves for (profile off, or a scene covers it) is
  counted as "no effect" and does not fail the check.
- **R4:** lines muted, exchanges skipped, words treated as exchanges (a word label over 4 s, see below), and skip-cards with approved vs generic text.
- **Scenes and certification:** scenes whose edges leave a member uncovered (the check refine logs
  as `scene-edge-uncovered`) and the EDL's certification level.
- **Language (R9):** count per group (profanity, blasphemy, sexual, slurs, childish, and `unknown`
  for a language tag whose category names no group) with the effect each resolved to (`off` when
  the profile turns it off).

`contentfilter stack-scan [--profile <name>] [--json]` (`cli/contentfilter/stackScanCommand.mjs`) is the
read-only survey: for every film with a refined EDL it counts the overlapping picture groups the
resolver produces without the precedence pass (`before`) and with it (`after`, must be 0), and lists
only film ids and counts.

### Audio effects: holds, bleep tone, pauses

- **Tones are word-sized (R3).** A bleep sounds for one spoken word (a word label) for at
  most 1.5 s: on the word when ms-pinned, else centred on the tag instant (`tagIn`/`tagOut`
  mapped through the sync, window midpoint when absent) with mute filling the rest of the
  window (`toneRemainder` pieces, not counted as words). Tones under 0.3 s apart merge into
  one (`words` counts them), re-capped on the merged midpoint with mute for the remainder.
- **Lines and exchanges (R4).** A said cue whose label is not a word: up to 4 s -> `mute`
  (never a tone); over 4 s (tag span, or window when untagged) -> `skip-card` with the
  `treatments.skip-card.holdSec` hold and the approved card text, else "Scene skipped.".
  An explicit `skip`/`skip-card` effect is left alone.
- **Exchange by length.** A word label does not make a long cue a word: a said cue with an audio
  effect whose OWN tag span is over 4 s is an exchange whatever its label (`line: 'exchange'`,
  logged as `content-filter.word.as-exchange`). The span is `tagOut - tagIn`, else the VidAngel
  `out - in` before any widening; never a safe window (a 6.84 s safe-window word stays a word).

- **Overlapping word cues hold the mute together.** Padding makes neighbouring words
  overlap. Mute and bleep handlers count holds in the per-hook `mem`
  (`muteHolds`, `soundHolds`); only the last cue to exit unmutes or stops the sound,
  so an earlier cue's exit cannot release a later word.
- **Bleep defaults to a synthesized 1 kHz sine**, the broadcast censor tone
  (`bleepTone.js`, Web Audio, short gain ramps, one shared `AudioContext` per page).
  Its level follows the media element's volume. A cue or profile can name a sound in
  `profile.sounds` instead.
- **The video is muted first**, so a bleep that cannot sound still silences the word.
  That happens when Web Audio is missing, the context is not `running` (browsers hold
  it suspended until a user gesture), a named sound has no URL, or `Audio.play()`
  fails. Each case logs `content-filter.bleep.degraded` with a `reason`.
- **Pause or stall mid-bleep stops the tone** and keeps the mute; `playing` restarts
  it for any bleep still active.
- **Element swaps rebind.** The player re-keys its `<video>` on a stream re-mint,
  bitrate change or soft reinit. The hook compares the element `getMediaEl()` returns
  after every render with the one it is attached to and re-attaches when they differ
  (`content-filter.element.rebound`, info). `getMediaEl` and `transport` are read
  through refs, so their identity does not matter; an injected `sfx` player must be
  memoized.

## Viewer chrome: bumper and badge

Both render inside `FilterOverlay` (`FilterChrome.jsx`), so they appear wherever a
filtered title plays, including D-pad TVs.

- **Bumper.** On the first `playing` at or near the start (within 5 s, extended past an opening skip such as
  BTTF's 0–18 s credits, so not on a resume), a card shows for about 4 s over playback without pausing it: the clear logo
  (hidden if it fails to load), "Edited for content", and a summary built from the
  resolved cues by `filterSummary.js`, e.g. "152 words muted · 4 scenes blurred · credits
  skipped". Counts are of THINGS, not resolved pieces (`unitKey`): a scene, a subject group, or a base
  cue id (`va123#0@4` → `va123`) however many keyframe pieces a tracked blur was split into; a word
  once across its tone piece and mute remainders (a merged tone counts the `words` it carries).
  BTTF: 271 blur pieces → "37 scenes blurred". It yields to a skip-card. Logs `content-filter.bumper.shown`.
  To see it on a title with a saved resume, start from the top with
  `?play=plex:<id>&start=0` (see `content/content-playback.md`, start position params).
- **Badge.** A small shield bottom-right at about 40% opacity; it glows yellow while an
  effect is active (see [Preview surround](#preview-surround)). States:

  | State | Drawn as | When |
  |---|---|---|
  | `certified` | solid shield | the EDL carries a `certification.level` (`machine` from refine, or `parent`) |
  | `provisional` | outline | no certification block (`isProvisional`); `unrefinedWordCount` counts the approximate mutes/bleeps that could leak |
  | `failed` | crossed shield | filter data failed to load after one retry |

  With no `onOpen` the badge is display-only (no pointer events, `aria-hidden`); the
  player passes one, see [Preview surround](#preview-surround).
- **Loading.** `useFilterData` returns `{ data, status }` with status
  `idle | loading | ready | none | failed`. A `404` is `none` (no filter data, no
  chrome). A network error or `5xx` is retried once, then `failed`, logged as
  `content-filter.load.failed`. Changing titles clears the previous title's data before
  the new fetch, so one title's cues never apply to another.

## Persistence and API

(Scene review routes are under [Scenes](#scenes).)

`FilesystemContentFilterRepository` owns the YAML layout and reads fail-soft: missing or
malformed files return `null` and emit a structured warning.

The API is:

```text
GET /api/v1/content-filter/{ratingKey}?profile=family
→ { edl, profile, override }
```

If no EDL exists, the endpoint returns `404` with `no filter data`. The application port
is defined by `__app_modules/media/media/server/application/content-filter/ports/IContentFilterRepository.mjs`;
the filesystem adapter is replaceable without changing the use case.

```text
GET /api/v1/content-filter/{ratingKey}/art
→ { logo, background, poster, source }   source: selected | alternative | none
```

Card art. The logo is chosen by cascade (`ContentFilterArt`): Plex's selected clear logo if it is
at least 300 px wide; else the best entry of `/library/metadata/{rk}/clearLogos` (PNG first, at
least 300 px, English first when stated, then widest), which is also selected in Plex with
`PUT /library/metadata/{rk}/clearLogo?url=...` (best-effort, a failure only warns); else `null`
and the card uses the poster layout, or just the title text with no poster. Widths are read
from the image header (PNG IHDR / JPEG SOF) via a ranged fetch. The decision is cached per
rating key in memory and logged as `content-filter.art.logo`. The client falls back to the
proxy URLs if this call fails, and also treats any logo that loads narrower than 300 px (card
and bumper) as missing.

## Import sources and synchronization

- **VidAngel:** broad coverage, but integer-second timings can drift by several seconds;
  use `precision: second-approx` and validate against the local file.
- **MCF/WebVTT:** sparser but millisecond-oriented and suitable for round-trip import/export.
- **Whisper:** can align approximate speech cues to word-level timing.
- **VideoSkip `.skp`:** custom external format; convert it to the base EDL rather than
  making `.skp` canonical.

Always retain the source and precision metadata. A cue set must be checked against the
actual media release before being enabled, especially when the source is marked unsynced.

## Refined EDLs, safe windows and certification

A refined EDL (`media/content-filter/refined/<workId>-<tagSetId>.edl.yml`, built by
`buildRefinedEdl` in `server/domain/content-filter/refine/refinedEdl.mjs`) is a VidAngel
tag set on VidAngel's clock, with each cue refine could measure at `ms`/`frame`
precision. Every word the film transcript misses stays approximate — and VidAngel tags
drift from the spoken word by several seconds, so an approximate mute can let the word
play.

**Re-running refine is safe (R7).** `buildRefinedEdl` takes the file it replaces as
`previous` and keeps its `scenes`, `sceneCalibration`, `certification.parent` and any other
top-level key refine does not produce. A cue previous holds refined that this run did not
re-measure (a `--cues`/`--kinds`/`--limit` run, or a give-up) keeps its refined data, and a
partial run adds its anchors to previous's. Refine writes the household override only
through `mergeRefine`, which changes refine-measured keys of the cues it measured and
leaves `sceneOverrides`, `profilePatch`, cards and every other key as it was. The CLI
loads the existing refined EDL as `previous` before building.

**Refine on the server (R8).** `transcribe.py` uses mlx-whisper when it imports and otherwise
faster-whisper on CPU (int8); the choice is automatic and written as `backend` in the words JSON.
Hosts without `uv` set `CONTENT_FILTER_TRANSCRIBE_PY=python3` so the CLI runs `python3 transcribe.py`. Speech refine also forced-aligns each word (`align_words.py`, torch + torchaudio MMS): on such a host point `CONTENT_FILTER_ALIGN_PY` at a python that has them (a venv with the CPU wheels works); without it every speech cue ends `unknown` with `align_words failed: spawn uv ENOENT`.
ImageMagick 6 hosts work too (the renderer falls back from `magick` to `convert`).

**Where refine reads the film (2026-11-12).** Streaming the 1080p original through Plex cost
about 7.7 minutes per cue (Terminator 2: ~36 hours for 220 cues), almost all of it decoding.
`chooseVideoSource` (`cli/contentfilter/videoSource.mjs`) picks, in order: `--src`; the part's own
file mapped through `CONTENT_FILTER_PATH_MAP` (`plexPath=hostPath;…`, longest prefix first) when
this host can read it; a 240p Plex transcode when `CONTENT_FILTER_LOW_RES=1`; the original through
Plex. It logs `content-filter.source.chosen { kind, reason }`.

Pictures then come from a **low-res copy** (`videoProxy.mjs`): 480p, picture only, a keyframe
every second, no B-frames, every frame kept (measured on Terminator 2: the same 197,294 frames, the
same frame at every time checked). It is built without `-copyts`, so it starts at 0: `proxyFit`
compares it with the original (frame rate, length, frame count) and gives the offset (the original's
start time), and `ProxiedRefineMedia` reads the copy at `t − offset` and adds the offset back; a copy
that does not fit is refused (`content-filter.proxy.mismatch`) and refine reads the original. One
build per copy (a lock file; others wait; a 3 h old lock is taken over). It is built once per part
and file size into `CONTENT_FILTER_PROXY_DIR` (default `<tmp>/daylight-cf-proxy`, outside the
worker's per-run stage), pruned to `CONTENT_FILTER_PROXY_MAX_GB` (default 40) least recently used first,
about 13 minutes for a two-hour film, and it starts as soon as the source is known, so it runs
alongside transcription (`prepareCopy` `onSource`). `ProxiedRefineMedia` sends frames, shot cuts
and black detection to the copy and keeps sound and the probe on the original; region boxes are
fractions of the frame, so they need no change. `FrameChunkCache` (capped at 1,200 frames and 256 MB) decodes the next 48 frames on a
miss, so the ~90 frame requests around a cue cost a handful of ffmpeg runs. `cellCrop` runs
in-process (`@napi-rs/canvas`): as ImageMagick it was ~3,000 process starts per cue, and each start
blocked the event loop. Cues run 6 at a time (`--concurrency`); above 6 the decision model is the
ceiling. `--no-proxy` or `CONTENT_FILTER_PROXY=0` reads frames from the original. 240p was tried
and dropped: it lost a millisecond-refined cue that the original pinned.

| Terminator 2, visual cues | time |
|---|---|
| 1080p over HTTPS (before) | ~7.7 min per cue |
| 1080p local file, 3 at once | 6 cues in 706 s |
| 480p copy + chunk cache + in-process crops, 6 at once | 6 cues in 138 s; 12 in 168 s |
`refine --kinds visual` needs no transcript (clock sync comes from the override) and selects
`shown` cues, including `skip` cues under a language category. Every Jev request has a
timeout (`TimeoutDecisionGateway`, default 90 s, wrapped around the gateway by the CLI): on timeout the call abstains, a warn line
(`refine.jev.timeout`) goes to `log.jsonl`, and the cue ends `unknown` (`jev-timeout`).

**Region-only cues.** A `shown` cue whose edges stay unsure (edge-all-unsure, bracketed edges)
but which Jev sees in the probe frames is still region-tracked over the first to last frame it
was seen. It keeps its coarse VidAngel in/out and gains `regions` plus
`refine: { edges: coarse }` (status `region` in refine results, `coarse-edges` on the review
list). The player applies such a track over the synced coarse window, never over less time than
the cue would be hidden untracked: the window takes the full-blur pads and minimum width, the
first seen box is held back to its start and the last forward to its end, and an empty or unsure
keyframe between two sightings hides the box spanning both sightings when the next one comes within
1 s (a missed keyframe, not the subject leaving), else the whole picture. A whole-frame sliver under
0.1 s at a cut (frame snapping) takes the next box instead of flashing the whole picture. `refinedCount` counts
only cues measured at ms/frame, and a cue refined at ms/frame is never replaced by a coarse one.
When Jev sees the subject nowhere, or only judges it whole-frame, no track is written.

**Same-subject tags (R6).** After measurement, `shown` cues whose spans overlap are asked of Jev
pairwise (`subjectGroups.mjs`, both labels plus one frame from the overlap, "the same single
thing on screen?"). Only a confident yes groups; no, abstain, timeout and error leave the tags
separate. Grouped cues carry `subject: <id>` in the refined EDL; a re-run keeps the subjects
already there (`--resubject` asks again, `--no-subjects` skips the step). The resolver turns
cues sharing a `subject` into ONE effect (id = the subject id) over the union of their spans.
Each member's span is first widened as it would be alone (its own effect's pads and minimum
width), so the union never hides less time than any member untracked. With a usable track (the
best-tracked member's, most keyframes, at least one sighting) blur and full-blur members become ONE
regional blur along it (R2), at the full-blur radius when any member asked for full-blur; a
censor-bar or pixelate member outranks them and follows the track; blackout and skips outrank all.
Without a track every member counts as what it would play alone (an untracked blur is a full-blur)
and the strongest wins (blackout > full-blur > censor-bar/pixelate). An authored `rect` stays only
when there is no track and every member plays that same effect alone. The track is held at both
ends to cover the union, and a gap in it (empty or unsure keyframe) hides the box spanning the
sightings around it when it lasts 1 s or less, else the whole picture, so no instant of any
member's span is left uncovered. `said`/`heard` cues never group, so a word inside
the union still mutes on its own.

- **Safe windows** (`safeWindow.mjs`). A mute refine could not pin is widened to
  `tag.in − 3.5 s … tag.out + 3.0 s` with `precision: safe-window`; the tag span is
  kept as `tagIn`/`tagOut`, so applying it again is a no-op. The constants cover every
  word measured on two films (150 words: start drift −3.1…+2.7 s, end −3.8…+2.8 s). It
  mutes more dialogue, but no tagged word plays. Skips and visual cues are not widened;
  the player already pads those.
- **Certification** (`certification.mjs`), bar `every-mute-covered`. `machine`: every
  mute is pinned (`ms`/`frame`), a `safe-window`, or `pinned` (a person marked it and the
  span covers the word without ms edges). `parent`: a person signed off on a
  machine-certified EDL; it is kept only while the machine bar still holds. `none`:
  anything else, including every raw VidAngel EDL. The player's badge reads this level.
- **Pinning words** narrows a safe window back to the word, with a person's help, since
  automatic re-listening and query-by-example both failed on words the transcript missed:
  - `contentfilter pin-page <rk> --src <file>` cuts one clip per safe-window mute into
    `refine/<rk>/pin/index.html`. The person plays each clip, presses **Mark word** as the
    word starts (or **Not spoken here**), then **Copy results** (`<cueId>: <seconds>` per
    line).
  - `contentfilter pin <rk> --src <file> --marks <file> [--write]` transcribes 5 s around
    each mark with the word as the prompt, accepts a hit only inside the press's reaction
    window, and times it by forced alignment plus an energy snap (`precision: ms`). With no
    hit it keeps the span from just before the press to the next energy offset
    (`precision: pinned`). "Not spoken here" leaves the safe window and stamps
    `pinned: { none: true }`. It recomputes certification.
- `contentfilter certify <rk> [--parent --by <name>] [--write]` applies safe windows to an
  existing refined EDL, recomputes the level and prints pinned / safe-window / uncovered
  counts.

## Scenes

A VidAngel tag set marks moments ("A man is shot", "A man is shot in the back"),
so filtering tag by tag flickers. A **scene** is a run of tags that is one
situation, with edges on shot cuts. Each scene is judged by Jev and the household
profile decides what it gets: nothing, **blackout** (picture black, sound plays)
or **skip** (with a title card). Design: `ops:docs/superpowers/specs/2026-11-06-content-filter-scenes-design.md`.

**Building** — `contentfilter scenes <rk> --src <file> [--out f.json] [--write] [--trust situation,picture --evidence <ref>]`
(`SceneBuilder`, `scenes.mjs`, `sceneQuestions.mjs`):

1. Candidates: `groupScenes` (tags < 20 s apart; ≥ 15 s or ≥ 3 tags; not credits or word mutes).
   Only `violence_blood_gore`, `sex_nudity_immodesty` and `sex_any` form scene levels;
   a run with none of them is dropped.
2. Edges: the members' span (approximate tags widened 3 s) snapped outward to the
   nearest shot cut within 12 s, then **grown** a shot at a time while Jev scores the
   frame just past the edge picture ≥ 2 for any scene group, up to 60 s. VidAngel tags
   mark moments; a fight keeps going between them. Edges always cover every member
   (`scene-edge-uncovered` is logged if not).
3. Situation, per group (Jev, text: member labels + dialogue in and 15 s around),
   0 incidental · 1 peril / brief immodesty / flirting · 2 people hurt or killed /
   nudity / sexual situation implied · 3 torture or cruel killing / sexual content or assault.
4. Picture, per group (Jev, frames): `max(8, duration/10 s)` probes (cap 24), shot
   middles first; level = the second-highest frame score (one odd frame cannot set it;
   `scene-picture-outlier` when the max is 2+ above).
5. Optional `--same-scene` (Jev merges/splits candidates): **off** — on the two
   calibration films it did not beat the gap rule.

Every answer goes to `refine/<rk>/log.jsonl` (`step: scene-*`, question version).
Re-runs keep a scene's id when ≥ 50% of its members match (`scene-id-remap`); a
draft card survives only an unchanged member set.

**Refined EDL fields** — `scenes: [{ id: sc-<smallest member id>, in, out, edges: cut|approx,
grown?, cues, groups, level: { <group>: { situation, picture, confidence } }, card? }]`
and `sceneCalibration: { situation, picture: trusted|untrusted, at, evidence }`. The
player acts on a **trusted** axis only; with neither trusted, members play by their own
cue rules.

**Profile** — `scenes:` maps a group to thresholds; skip beats blackout:

```yaml
scenes:
  violence_blood_gore: { blackout: { picture: 2 } }
  sex_nudity_immodesty: { blackout: { picture: 2 } }   # nudity visible; immodesty keeps its per-tag blurs
  sex_any: { blackout: { picture: 1 }, skip: { situation: 3 } }
```

A scene with several groups takes the strongest effect any group earns, so a low
threshold on one group (immodesty at picture 1) can black out a long fight that
only blurred a few seconds before.

**Household rulings** — written atomically, one ruling per title at a time — `sceneOverrides.<id>` in the override: `effect: off|blackout|skip`,
`disabled: true` (members play by their own rules), and `card: { text, approvedBy, at }`.
The refined EDL's `card` is only a draft; **only an approved card is ever shown**.

**Cue cards (R5)** — a cue whose effect is a skip can carry a card too. Cues have no refined-EDL
home, so the AI draft lives in the household override at `cueOverrides.<id>.cardDraft`
(`{ text, at }`, written by `POST /{rk}/cues/{cueId}/card` through the same scoped card-writer
gateway as scene cards). Approving (`PUT /{rk}/cues/{cueId}` `{ card: { approve: true, text? } }`)
copies the draft, or the edited text, to `cueOverrides.<id>.card` (`{ text, approvedBy, at }`);
`card: null` withdraws it and keeps the cue's other rulings. The resolver plays only
`card.text`: any cue that resolves to a skip-card (a long said exchange, or a `skip` cue that
has an approved card, which then plays as a skip-card) shows it; without one the card reads
the generic "Scene skipped." (never the cue label). `cardDraft` never plays.

**Player** (`contentFilter.js` `applyScenes`, `sceneEffect.mjs` shared with the server):
- A scene with an effect drops the cues inside it that hide no more than it does
  (blur < full-blur < blackout < skip). Word mutes, credits and stronger cues stay;
  mutes are never clipped to a scene; cues of a scene a grown-up turned off stay
  even inside an overlapping scene. A member cue, or a same-subject piece with a member in
  the scene, that reaches outside the scene is clipped to its time outside the scene rather
  than dropped, so a group member outside the scene stays hidden.
- Neighbouring scenes sharing a group, with the same effect and ≤ 30 s apart, are
  **bridged** into one (one black, one card), at resolve time only.
- **skip** → one `skip-card` (profile `holdSec`), text = approved card or "Scene skipped.".
  A skip is remembered only while its seek is in flight: rewinding into a skipped
  scene skips it again (its blurs were dropped, so playing it would show it unfiltered),
  and a seek that never landed is redone before playback resumes.
- **blackout** → a `blackout` overlay per synced segment: opaque black, sound plays;
  approved card text or "Scene hidden." on the black for the first `holdSec`.
- Bumper counts a blackout scene once ("2 scenes hidden"). Logs:
  `content-filter.scene.resolved` (info), `content-filter.scene.fallback` (warn, an
  untrusted axis), `content-filter.scene.enter` (debug), `content-filter.blackout.shown` (info).

**Admin → Content → Content filter** (`/admin/content/filter`): titles with a refined
filter; per title, every scene with its levels, the profile's effect, **Play scene**
(filtered, at the copy's time), an effect picker, and the draft card with
**Approve / Edit / Withdraw**. **Draft missing cards** asks the shared AI gateway
(`app: media, feature: content-filter-cards`) for one child-safe sentence per scene that
hides something (≤ 90 characters, never describing what was hidden). API:

```text
GET  /api/v1/content-filter/                   -> { titles }
GET  /api/v1/content-filter/{rk}/scenes        -> { title, calibration, scenes }
POST /api/v1/content-filter/{rk}/scenes/cards  { all?, force? } -> { drafted, scenes }
PUT  /api/v1/content-filter/{rk}/scenes/{id}   { effect?, disabled?, card?: { approve, text? } | null, by? }
```

## Subtitle word-list cues and review

`contentfilter srt-mutes <ratingKey>` scans the title's English SRT (Plex, or
`--srt <file>`) for words in `household/content-filter/bad-words.yml` and, with
`--write`, stores one local-time mute per word as `addCues` (`source: srt`,
`precision: srt-line`) in the title's override. The matcher lives in
`__app_modules/media/media/server/domain/content-filter/subtitleWords.mjs`: whole-word forms only,
word *i* of a line placed at `start + i·0.33 s` (capped at the caption end),
and every listed word gets its own cue, even when two land at the same instant
(otherwise disabling one would unmute the other). Ids are
`srt<line start ms>_<token index>`: they depend on the SRT alone, so they stay
stable while the SRT is unchanged and survive word-list edits, and
`cueOverrides` keyed on them keep naming the same spoken word. Only a repeated
subtitle block (same start, index and word) is deduplicated. With `--write`,
any `srt*` key in `cueOverrides` that no longer matches an emitted cue is
printed as orphaned. Category is `language/<group>/<leaf>`; severity comes
from the word's tier (`tolerant → high`, `moderate → medium`, `strict → low`).
SRT cues carry a stamped `effect: mute` that is only a default: the profile's language group
and `languageWords` decide the effect (see Language groups); `cueOverrides.<id>.disabled` or
`.effect` still rule per cue.

`contentfilter srt-review <ratingKey>` is a second opinion for a grown-up.
For every word hit it asks the typed-decision model (`IDecisionGateway`, Jev)
two questions about the line, with the previous and next subtitle lines as
context: which word-list group the use belongs to, or `none` (an innocent use
such as a place, an animal, a prayer, a ghost), and how severe it is on
`low | medium | high`. It writes `household/content-filter/review/<ratingKey>.yml`
(`--out` to redirect): each item is the word-list cue unchanged plus Jev's
answer, `status: agree | review`, `reasons` (`not-offensive`,
`category-differs`, `severity-differs`, `low-confidence`, `model-failed`,
`model-unavailable`) and `decision: null` for the grown-up. **It never adds,
removes or edits a cue.** To act on a review, add
`cueOverrides: { <cueId>: { disabled: true } }` to the title's override.
With no model configured every item is listed as `model-unavailable`.
Re-running the review keeps any filled-in `decision` whose cue id still names the
same word. The command refuses an `--out` path inside the overrides folder.

Run offline; concurrency defaults to 4 (`--concurrency`), the confidence floor
to 0.7 (`--min-confidence`). The CLI's `content-filter.cue-review.summary` /
`.item` / `.failed` events print to the terminal and do not reach the log
store; the review file is the record. There is no review UI yet; the next
slice is an admin screen that reads the review file and writes `cueOverrides`.

## Preview surround

A grown-up reviews what the filter does while the film plays: a sidebar and a timeline
open around the video, which keeps playing. Design:
`ops:docs/superpowers/specs/2026-11-06-content-filter-preview-surround-design.md`.

**Default-on rule** (`filterMode.js`, `filterMode`). A Plex title is filtered with
no flag when the API reports `certification.ready === true` (the refined EDL level meets
the profile's `requiresCertification`). `?filter=0` forces off (no fetch); `?filter=1`
forces on, provisional EDLs included — but only when there is filter data to apply: a title with none (404) is not filtered even under `?filter=1`. A load that `failed` is on only under `?filter=1`;
either way the crossed shield shows. `content-filter.default.on|off` is logged once per
title with `reason`: `forced-off | forced-on | certified | uncertified | no-data | loading`.
There is no debug HUD and no `filter-debug` flag.

**The shield** (`FilterBadge`, `FilterChrome.jsx`): small (`clamp(16px, 1.5vw, 30px)`),
bottom-right, 40% opacity. It glows yellow and goes to full opacity while any filter
effect is active (`filterActive`; sampled `content-filter.badge.active`). A **mouse click**
on it opens the surround; it takes no focus (`tabIndex -1`), so a D-pad or remote cannot
land on it — a child on the TV cannot open the review tools by accident. Click
stops propagation so it does not toggle playback.

**Cue ids.** Measured cues carry `#i`/`@k` suffixes (`va123#0`). The rail and workshop send the base id (`baseId`, exported from `useContentFilter.js`); the cue and scene routes answer 400 for an id that is not `[a-z0-9_-]` rather than stripping it.

**Surround seam.** `videoPresentation.jsx` calls `useSurroundOverride()`
(`__capabilities/playback/browser/surround-override.mjs`, context set by `SurroundHost`),
whose `open(data)` shows an on-demand surround and `close()` removes it, without a surround
definition in the data volume. The content-filter surround is `FILTER_SURROUND` in
`videoPresentation.jsx`: rail `content-filter-rail` in the right region and
`content-filter-timeline` at the bottom, registered in
`__app_modules/media/media/browser/surround/builtins.js`. The surround closes when the host
replaces it (`by: host`) or the player unmounts. It closes with the rail's ✕ (or the shield) only: there is no Escape handler, because the player owns Escape. When the surround setting is `off`, `open()` is refused (returns `false`, `available` is false), nothing is marked open and the shield is not clickable; the shield is also not clickable when there is no `SurroundHost` or the load `failed`.

**Preview store** (`browser/content-filter/preview/previewStore.js`): the live state the
rail and timeline read, and their actions. `seekTo(t)`; `jumpToCue(cue)` takes a cue object and seeks 4 s before it; `replayLast()` replays the last fired cue; `peek(id)` plays a cue unfiltered once;
`refresh()` re-fetches filter data after a ruling; `close()`.

**Look.** `FILTER_SURROUND.definition.theme` is `content-filter`, so the frame wears
`contentFilterTheme.scss` rather than the concert-hall `classical` theme (see
`__docs/reference/player/surround/design.md`, Themes): a slate edit bay, no plate inset,
Atkinson Hyperlegible Next, sizes in `em` off the frame's measured `--label-floor`. Every
colour is a `--cf-*` property from `preview/_palette.scss`. Colour means one thing only,
the **kind** of change, shared by the timeline, legend, tooltip and rail through
`preview/effectKinds.js`:

| Kind | Effects | Colour | Timeline mark |
|---|---|---|---|
| Words | mute, bleep | amber | tick in the Sound lane |
| Blurred | blur, full-blur, pixelate, censor-bar | sky | bar in the Picture lane |
| Hidden | blackout, title-card | lavender | solid block in the Picture lane |
| Skipped | skip, skip-card | rose | hatched block across both lanes |

`effectKinds.js` also holds the plain words (`effectWord` "hidden", `effectChip` "Hidden",
`effectSentence` "The picture goes dark; the sound keeps playing."), `sourceOf` (Word /
Visual / Scene), `categoryText` ("Language: profanity", "Violence"), `clock` and the
certification sentence. Controls carry a short, opaque CSS hint from `data-cf-hint` (shown
after a beat on hover, at once on keyboard focus). Peek has a static line instead of a hint,
so nothing floats over the list.

**Rail** (`FilterRail.jsx`, two tabs). Header: "Filter preview", the film's title, the
certification with a sentence saying how far to trust it (`machine`: every flagged word is
covered, most to the millisecond, the rest with a safe margin; `parent`: signed off by a
grown-up; anything else: not checked yet, amber edge), and Close (✕). The rail thinks in
**moments** (`preview/railItems.js`): a cue's pieces fold by `unitKey` (from `filterSummary.js`),
so a tracked blur in 30 keyframe pieces is one moment and a scene is one, the same unit the
summary and the timeline legend count. Each moment is in one of three groups: *Words*
(muted, bleeped), *Picture* (blurred, pixelated, barred) and *Scenes* (anything hidden or
skipped, scene or lone moment).

*Review* opens with a kind switch, **All / Words / Picture / Scenes**, each with its count,
and a **Find** field. **All**: *Just filtered* (the moment just fired, with **Replay**) and
*Next of each kind*, one row per group with how many more follow ("Muted, 82 more after it"),
or "No more blurred moments from here." / "No blurred moments in this film."; one kind's
density can never hide another. **Words** / **Picture**: the next five of that kind ("in 42 s"
under a minute, else "in 1:12"), then **Show all N in film order** (past rows dimmed, clock
times). **Scenes**: *Skipped or hidden* lists every cut scene or moment with its span and
length, its judged levels in plain words per group ("Violence: people hurt or killed, mild on
screen", from the SITUATION/PICTURE scales in `sceneQuestions.mjs`), its title card's status
(*Card approved* / *Card drafted, not approved* / *No card yet*) with one-click **Approve card**
(PUTs the drafted text) or **Draft card**, and the card text; then *Flagged scenes that play*
(scenes with no scene effect, their own moments still filtered), each choosable so it can be
cut. **Find** searches the chosen group over the whole film: label, category and effect, and a
censored label by its letters ("hell" finds h\*ll). A kind with nothing in the film says so and
offers **Open settings**. Choosing any row jumps 4 s before it and selects it.

The **selection** (the store's `selected`, so a timeline click and a rail row are the same
selection; any piece of a moment selects the moment) shows in one block above the lists: its
name, effect chip, span and length, category or levels, what the viewer gets, **Jump there**,
**Peek unfiltered** (with a static line saying it plays once without the filter; absent for a
scene that plays) and **Clear selection** (✕), then the `WorkshopPanel`. *Settings*: one line of
explanation and the `SettingsPanel`. WorkshopPanel and SettingsPanel are styled only through
the `filter-rail__*` classes they already carry.

**Timeline** (`FilterTimeline.jsx`). Two lanes, Sound over Picture, with every cue drawn at
its real span (min widths keep a 0.3 s word visible). Pointing at the track: off a mark, a
line and a chip with the time under the pointer ("Click to go here"); on a mark (6 px reach,
the pointer's lane preferred, `markAt`), the other marks dim and a card rises over the
picture's lower edge with the effect chip, Word/Visual/Scene, the tag (or "Violence scene"),
its category, what the viewer gets, start to end with the length, "Click to jump here. It
plays from 4 s before." and how many more marks are close by. Click a mark: it is selected and
playback jumps 4 s before it (a scene to its first piece); click elsewhere: seek there. The
playhead carries the current time on the axis under it, the running time at the right end.
**Previous / Next** step one stop (a scene is one stop) and their hints name the target and
its time. The legend names each kind with its count — the same unit counting as the bumper summary
(`kindCounts` → `filterSummary.js` `uniqueUnits` / `wordUnits`); a kind with none is dimmed.

**Workshop actions** (`WorkshopPanel.jsx`, writes via `useFilterWrite.js`), on the cue or
scene selected in the rail. Cue ("For this word" / "For this moment"): *Off*, *Mute*, *Bleep*,
*Blur*, *Skip*, and *Use settings* (clear the ruling; shown only when the cue has one), written
to `cueOverrides` by `PUT /{rk}/cues/{cueId}`. Scene ("For this scene"): *Play it* (off),
*Hide picture* (blackout), *Skip*, *Use settings* (clear) via `PUT /{rk}/scenes/{id}`; once the
scene is cut (a scene piece is in the effective cues) or has a card, **Draft with AI / Regenerate** (one scene's card,
`POST /{rk}/scenes/{id}/card`), **Edit**, **Approve** and **Withdraw** (the same
`sceneOverrides` rulings as the admin screen). A selected cue whose effect is a skip shows the same card controls, via `POST /{rk}/cues/{cueId}/card` and `PUT /{rk}/cues/{cueId}` (see Cue cards). Each write refreshes the store so the change
applies to the next pass. The Settings tab has **This film / Everywhere** and **Reset this film**.

**Settings** (`shared/contracts/content-filter/filterSettings.mjs`). Plain choices:
`language`, an object of five groups (`profanity`, `blasphemy`, `sexual`, `slurs`, `childish`),
each `mute | bleep | off`, and `violence`, `nudity`, `sexual` (`off | blur | blackout | skip`).
The settings API also takes a partial `language` object (only the groups named change) or the
legacy single string (sets all five). `profilePatchFromSettings` turns them into `categories` and
`scenes` fragments; `mergeProfilePatch` lays a fragment over a profile (patch wins per key;
name, treatments, theme, `requiresCertification` untouched); `settingsFromProfile` reads
them back.

| Setting | Level | Categories owned | Scene rule (`scenes.<group>`) |
|---|---|---|---|
| language.\<group\> | mute / bleep / off | `language/<group>` -> that effect | none |
| violence | off | `violence_blood_gore`, `/graphic`, `/gore` -> off | `{}` |
| violence | blur | `/graphic`, `/gore` -> full-blur | `{}` |
| violence | blackout | as blur | `violence_blood_gore: { blackout: { picture: 2 } }` |
| violence | skip | as blur | `violence_blood_gore: { skip: { picture: 2 } }` |
| nudity | off / blur | `sex_nudity_immodesty`, `nudity` -> off / full-blur | `{}` |
| nudity | blackout | as blur | `sex_nudity_immodesty: { blackout: { picture: 2 } }` |
| nudity | skip | as blur | `sex_nudity_immodesty: { skip: { picture: 2 } }` |
| sexual | off / blur | `sex_any`, `sex_any/sexual_assault` -> off / full-blur | `{}` |
| sexual | blackout | as blur | `sex_any: { blackout: { picture: 2 } }` |
| sexual | skip | as blur | `sex_any: { blackout: { picture: 2 }, skip: { situation: 3 } }` |

**Language groups (R9)** (`shared/contracts/content-filter/languageGroups.mjs`). One alias table
maps both taxonomies onto five groups: Profanity (`profanity`, `profanity_captions`), Blasphemy
(`blasphemy`), Sexual (VidAngel `language_sexual`, word-list `vulgarity`), Slurs
(`language_racial`, `racial`), Childish (`language_childish`, `childish`). A cue's group is the first
segment of `language/<group>/<leaf>` the table knows; a language category with none (bare
`language`, `language/x`) counts as profanity. The cue's effect comes from the profile rule
`language/<group>`; a rule for a deeper path (`language/profanity/fuck`) beats the group, and the
old single `language` rule is the fallback. A level-2 key may use either taxonomy's name
(`language/language_racial` rules Slurs; the canonical `language/slurs` wins if both exist) (reading it as settings gives all five groups that
value). Defaults when settings are written without a group: Profanity, Blasphemy, Sexual, Slurs
mute; Childish off. **Per-word exceptions** (hand-edited YAML, no UI yet; values outside
`off|mute|bleep` are ignored with a warning; an empty value is invalid, so the group applies): `profile.languageWords: { <word>: off|mute|bleep }`
(also honoured in a film's `profilePatch`) beats the group; the word is the category leaf
(`language/childish/jerk` -> `jerk`) or an uncensored one-word label. The group rule chooses the
audio effect for *said* cues; the R3 tone caps, R4 line rules and the channel fit apply on top, so
a *shown* language tag (billboard) is still blurred, not muted. Word-list (SRT) cues (marked `source: srt` by the producer; the id shape is not consulted) are governed too: their stamped
`effect: mute` is only a default, so the group and `languageWords` decide (Childish off unmutes
"jerk"; Slurs bleep tones a racial word, R3-capped). A household `cueOverrides.<id>.effect` and a
hand-authored `addCues` effect still win. The preview Settings tab has five rows (Profanity, Blasphemy,
Sexual language, Slurs, Childish words), each This film / Everywhere.

An empty `{}` scene rule is explicit "none" so it overrides a base entry. Settings apply at
one of two scopes:

- **This film** — stored as `override.profilePatch` in the title's override;
  `GetContentFilter` and `ContentFilterScenes` merge it over the profile on every read.
- **Everywhere** — written into the profile file itself (`applySettingsToProfile`, which
  drops owned scene groups left empty).

Routes (all take partial `settings`; omitted keys are left as they are):

```text
PUT    /api/v1/content-filter/{rk}/settings?profile=   { settings } -> { profilePatch }   (profile defaults to `family`)
DELETE /api/v1/content-filter/{rk}/settings                         -> { cleared }
PUT    /api/v1/content-filter/profiles/{name}/settings  { settings } -> { profile }
PUT    /api/v1/content-filter/{rk}/cues/{cueId}         { effect?, disabled?, by? } -> { ruling }
POST   /api/v1/content-filter/{rk}/scenes/{sceneId}/card               -> draft one scene's card
```

(`400` on an invalid value, `404` for an unknown profile, cue or scene. Scene ruling and
card routes are under [Scenes](#scenes).)

**Logging.** `content-filter.default.on|off` (info, with `reason`),
`content-filter.surround.opened|closed` (info; `by: host` when the host closed it),
`content-filter.badge.active` (sampled), `content-filter.seek` / `.seek.play-refused` /
`.peek` / `.peek.unknown`, `content-filter.cue.ruled`, `content-filter.scene.ruled`,
`content-filter.setting.changed`, `content-filter.card.drafted|approved|withdrawn`,
`content-filter.workshop.failed` (warn), plus `filter-rail.jump|tab|kind|peek`,
`filter-timeline.seek|step|jump` (info) and `filter-timeline.hover` (debug).

**No remote access, by design.** The shield is a mouse click on the screen itself and the
rail's controls are plain pointer targets: nothing on the bus, no remote-control action and
no D-pad path opens the surround, seeks through it or writes a ruling. Rulings are made by
someone at the screen.

## Admin workshop

Admin → Content filter (`/admin/content/filter`, `frontend/src/modules/Admin/ContentFilter/`) is
where a grown-up builds a film's filter and checks it before it counts as safe. It reaches the
media module only through its public entries (`browser/content-filter/adminWorkspace.mjs` for the
preview store and effect words, `browser/playback.mjs` for the Player). Two jobs: **build it** (library and pipeline runs) and
**check it** (one film's review). The preview surround stays the in-film editable preview.

### Library and stages

`GET /api/v1/content-filter/library?stage=&q=` lists the films that have an EDL: every matched
movie with VidAngel tags (`media/content-filter/plex-vidangel-map.yml`) plus every title with an
override, kept only when a rough VidAngel EDL (`edl/<rk>.edl.yml`) or a refined one exists. Rough
EDLs come from VidAngel and cannot be made here; the household only refines them, so a mapped
film with no EDL yet is not listed (in no section, not counted, not found by search). It stays in
the map, and its EDL comes from an export. Each listed film has a
stage (`filmStage.mjs`): Rough → Running → Refined → Scenes built → Audited → Machine-certified →
Parent-certified. Machine and parent need a passing audit that is current (its digest matches the
refined EDL and the override, review marks excluded). A failed or interrupted run is a flag on the
film (step and error), not a stage. Facts are cached in memory and dropped when a run settles, an
audit lands or the film is written.

The index's `unmatched` entries (works the matcher could not place, see
[Matching EDLs to Plex](#matching-edls-to-plex)) are listed too, so they stay visible.

Plex is asked for one thing: the live movies (key, title, year, duration; movie library sections
only, never shows), once per 10 minutes. The response carries per-film `linked` (`true`, `false`
when the key is no longer in Plex, `null` when Plex could not be read; the list never fails for
it), a `year`/`title` filled from Plex when the EDL lacks them, and the match verdict
(`filmMatch` in `domain/content-filter/plexMatch.mjs`):

- `match: 'verified'`: the key is a live Plex film whose year is within one of the EDL's year
  (VidAngel's). A runtime more than 5 minutes from the EDL's `runtimeUnalteredSec` is still
  verified, with `runtimeWarning: { plexMin, edlMin }`: VidAngel's figure can differ from the file,
  and the sync step is what checks the cut.
- `match: 'unmatched'` with `unmatched: { reason, text }`: `not-in-plex` "no Plex film" (stale key,
  or no Plex film with the title), `year-mismatch` "Plex has the 1954 film", `ambiguous` "several
  Plex films", `contested` (several works claim one Plex film), `year-unknown`, or `duplicate`
  "another entry has this film" (an override key whose work the index holds at another key), or
  `runtime-mismatch` "Plex film is 29 min" (runtimes more than 25% of the longer apart).
  With Plex unreachable, the year stored in the index decides; with none stored the film stays
  verified.

`thumb` (the Plex poster through the proxy) is set only for a linked, verified film: a key holding
another year's film would show the wrong poster. `meta: { indexedAt, total, unlinked, verified,
unmatched }`.

The Admin library is compact 2:3 poster cards grouped by readiness in an accordion: Ready tonight
(parent + machine), Audited, Scenes built, Refined, Running, Rough. The stage groups hold verified
films only. Below them, set apart (dashed, muted), one **Not matched to Plex** section lists every
unmatched film as a plain row: title, year and the one-line reason, linking to the film's page.
It starts collapsed; open state of all sections is kept in `localStorage`. Ready tonight, Audited
and Running start open. A verified card with a runtime warning shows a small "Runtime 162 min (VidAngel 124)"
note (Plex file / VidAngel). A title search flattens the verified films into one grid with stage
chips and filters the Not matched section alike; the "N of M films" count covers both.

An unmatched film's page (`GET /:rk/review`) answers `200 { title, year, match: 'unmatched',
unmatched }` when there is nothing to review, and the page says why the film can't be reviewed
against a file. A key that still holds household work (a refined filter, an override, review
marks) returns its review as usual with `match: 'unmatched', unmatched` added: the page shows the
review with an orange "Not matched to Plex ... runs are blocked" line, and Rework and Send back are
disabled. `POST /:rk/jobs` refuses every unmatched film with `409` and the reason, so nothing is run
against a file that is not the film. An unmatched film whose EDL `map` set aside stays listed from
the parked copy (`getParkedEdl`, `edl/_rekeyed/<rk>.edl.yml`); the player never reads it. The stage vocabulary is `STAGES`/`STAGE_LABELS` from
`filmStage.mjs`, re-exported to the browser by `adminWorkspace.mjs`.

### Matching EDLs to Plex

`contentfilter map` builds the match index `media/content-filter/plex-vidangel-map.yml` from the
cached VidAngel catalog (`catalog-sync`), the exported EDLs and the live Plex movies
(`cli/contentfilter/mapCommand.mjs`, rules in `domain/content-filter/plexMatch.mjs`):

- **A Plex film matches a VidAngel work only when the normalized title AND the year (±1) agree,
  and the runtimes are not more than 25% of the longer apart** (an unknown runtime never blocks).
  Title alone maps a shared title ("Cinderella", "Robin Hood") onto every film of that name; the
  runtime rule keeps a 29-minute documentary of the same title and year off a 100-minute feature
  (`runtime-mismatch`), while an extended cut (182 vs 237 min) still matches.
- The catalog dump has no year. A work's year comes from its EDL (`year`), else from the old
  index, else from the VidAngel API, asked only for works whose title Plex has (`--offline` asks
  nothing; such works stay unmatched as `year-unknown`).
- **One work maps to at most one Plex film.** Several Plex films within the year window is
  `ambiguous`; one Plex film claimed by several works is `contested`; neither is guessed.
- Each verified entry stores the Plex `year` and `runtimeSec`, and the work's `vidangel.year` and
  `vidangel.runtimeSec`, with `confidence: title-year`. A work that has an EDL but no match is kept
  under `unmatched:` (one entry per work, keyed by one of its EDL keys, preferring a key with
  household data) with its `reason` and `plexYears`, `plexKeys` or `plexRuntimeMin`. Show entries are carried over
  unchanged (they have no EDLs and nothing reads them).
- **Re-key pass.** When a matched work's EDL sits at a key that is not its Plex film (a library
  rebuild re-keyed it, or the title-only matcher put it on another year's film), the EDL moves to
  the matched key with its `contentId` rewritten; the old file is kept in `edl/_rekeyed/`. A key
  that already holds the work stays; the work's other EDL keys are duplicates and are left out of
  the index. A key with household data is never moved or parked, and a key holding another work's
  EDL is never overwritten: both are reported as blocked. Household data is every per-key store:
  `overrides/<rk>.yml`, `jobs/<rk>.yml`, `review/<rk>.yml` and `<rk>.refine.yml`,
  `review-history/<rk>.yml`, and media `refine/<rk>/` (transcripts); refined EDLs are keyed by work
  and follow it. The report lists every household key that ends up a duplicate or not matched,
  with what it holds ("has household data: override, job, review"); moving such data is a person's
  call, never `map`'s.
- The new file is written before the old one is moved aside, so an interrupted re-key leaves a
  stale source next to its finished copy; the next run sets it aside as a stale duplicate. Nothing
  in `edl/_rekeyed/` is ever overwritten (a second copy gets `.1`, `.2` ...).
- **Wrong-film EDLs are set aside.** An EDL at a key that is a live Plex film but not the work's
  film (title, year or runtime disagree: a duplicate, or an unmatched work's EDL on another year's
  film such as a 2010 EDL at the 1973 film's key) would filter that film with another film's cues,
  so `map` moves it to `edl/_rekeyed/` (unless the key has household data). Stale duplicates (key
  gone from Plex) are set aside too. A not-matched work stays listed from its parked EDL.
- **Guards.** `map` reads every Plex movie section and refuses `--section`. It writes nothing when
  Plex returns 0 movies or when the verified count would drop by more than 20% from the current
  index, unless `--force` (a dry-run prints the refusal as a warning). VidAngel year lookups pause
  400 ms after each call and back off 1, 2, 4 s after a failure, giving up after three tries.
- `--dry-run` prints the plan (index counts and reasons, re-keys, set-aside EDLs, blocked,
  household keys left alone, dropped entries with why, the library films' fate before and after, every unmatched film) and writes nothing.
  `--json` prints the same as JSON. A second run on its own output changes nothing; the index file
  is not rewritten when it would be identical (its mtime is the library's "Index from" date).

A Plex film added later under the right title and year is picked up by the next `map`.

### Pipeline runs

`POST /:rk/jobs { kind: make | send-back | stage, cues?, stage? }` queues a run (202; 409 when the
film already has one queued or running). `GET /jobs` is the queue state (the deploy gate reads it);
`GET /:rk/jobs` one film's record. `POST /:rk/jobs/:runId/cancel { by? }` stops a queued or
running run: it settles `cancelled` at once (404 unknown, 409 already settled), so the queue and
the deploy gate drop it; the worker's next report is refused, it kills the step and keeps nothing
(`content-filter.job.cancelled`, `content-filter.worker.cancelled`). A **make** run's steps: `preflight` → `export` (only without an
EDL) → `refine --write` → `scenes --write` (only without a `scenes` key) → `cards` → `audit --json`.
**Send back** runs `preflight`, then clears the cues' hand nudges and runs `refine --cues … --write`
and an audit. **Stage** runs `preflight` and one step (cards and audit need no preflight), then an
audit. One heavy run at a time, FIFO; audits run on a separate light lane
and after every write that changes what the household gets.

Run state lives in `household/content-filter/jobs/<rk>.yml` (last 10 runs and the latest audit,
whose `rows` are the review list); step logs in `media/content-filter/refine/<rk>/jobs/<runId>.log`.

Heavy runs execute in the **filter worker**, an optional process anyone can run with Node and
refine's Python tools (faster-whisper, torch/torchaudio; mlx-whisper on Apple silicon):

```bash
node __app_modules/media/media/cli/contentfilter.cli.mjs worker --app <app url> [--data-dir <app data dir>]
```

It talks to the app only over HTTP and never writes the app's data folders: `POST /jobs/claim
{ owner }` returns the oldest queued run with its steps and inputs (EDL, refined EDL, override,
profile, refine review, transcripts) or 204; the worker lays them out in a scratch folder, runs
`preflight`, `export`, `refine`, `scenes` there (send-back drops the cues' hand fixes in its copy
only after preflight passes), sends `POST /:rk/jobs/:runId/progress` per step and as a heartbeat
every 20 s, and for refine the measured count: refine's own stderr lines (`Sync:`, `[n/N] cue kind
status detail`) are folded (`refineProgress.mjs`) into `step.progress { phase, done, total, firstAt,
recent }`, sent on each phase change, the first and last cue and at most every 2 s (the inline
executor does the same); a running step keeps its start time, and finishes with `POST /:rk/jobs/:runId/complete { status, results | step + error }`.
The app saves the results, drafts card text and audits, then settles the run. A run whose heartbeat
is older than 60 s is marked interrupted; only the claiming worker can report on a run.
`--data-dir` (read-only) lends the worker the app's Plex and Jev credentials; without it set
`PLEX_HOST`/`PLEX_TOKEN` and the Jev key in its environment. With no worker running, queued runs
wait and the library says "Waiting for a filter worker" (an idle worker asks for work every 5 s).
Audit and card-draft stages never need a worker: the app runs them at once.
`CONTENT_FILTER_EXECUTOR=inline` runs heavy steps in the app process instead (for a host whose app
has the Python tools). `contentfilter preflight <rk>` names what is missing ("Refine cannot run
here: faster-whisper is not installed") before anything is written. The app polls run state every
10 s to refresh the library and reap dead workers; app and worker updates of a film's run file go
through the app, under a lock file (`jobs/locks/<rk>.lock`). The review player is an auxiliary
Player: no watch-progress logging.

While a run's export, refine or scenes step writes a film, every write to that film answers 409
"A filter run is writing this film. Try again when it finishes."

### Review

`GET /:rk/review` starts the film's audit when it has none or a stale one and nothing is queued or
running (`content_filter.review.audit_requested`; 2026-11-12, Terminator 2 was refined and certified
but had never been audited, so its list was empty), and reads a film with only VidAngel's rough EDL
(`hasRefined: false`; its rows come from an audit of the raw EDL). It carries `status` (`filmStatus.mjs`):
`{ filters: { present, parts }, refined: { present, measured, of }, certified, next }`, `next` one of
`none | refine | running | checking | check-failed | review | approve | done` (`approve` only when the
sign-off would be accepted). A failed check is kept on the run record (`auditError`,
`content-filter.audit.failed`) and the route stops asking until **Retry**; the payload also carries
`auditRunning` and the filter `worker` status. It returns the latest audit's rows (`cli/contentfilter/reviewRows.mjs`): one row per
moment as the household gets it (the preview rail's moments: a subject group is one row, a scene
swallows its cues), with kind, group, modality, local span, effect, card, `handFixed`, `members`
(the cue ids a ruling applies to) and the reasons the machine is unsure (`refine-<status>`,
`safe-window`, `check-levels`, `exchange-by-length`, `untracked-visual`, `subject-unsure`), unsure
first. The page plays the film in the Media Player with the filter forced on
(`previewStore.forceFilter`), "Play with effect" (4 s lead) and "Play without" (peek).

Per row: effect (only what fits the channel, R1), this film's ruling for a word
(`PUT /:rk/words/:word`, `profilePatch.languageWords`, shown as the current choice) or its whole
group (settings; per-word rulings survive it), the card (draft, edit, approve, withdraw), a hand
nudge, send back, and a verdict (only while the audit is current). Rows can be selected for one
multi-row send-back; rows in a queued or running send-back read "Sent back: <step>". Play with and
without the effect always works, even while a run writes the film. The sign-off names up to three words whose mute no longer covers them, and tells a
running audit ("still running") from a stale one ("out of date. Run Stage again → Audit."). A PUT
with a nudge and an unknown effect is refused before anything is saved. The library re-reads its
title index every 10 minutes.

- **Nudge** — `PUT /:rk/cues/:id` or `/scenes/:id` with `nudge: { in, out }` (local seconds;
  null drops it), stored as `startMs`/`endMs` on the VidAngel clock. Each edge may move at most
  30 s, `in < out`, and both must map through the copy's sync. The resolver plays a nudged cue on
  that span (`handFixed: true`). A nudged mute counts as covering its word for certification only
  if it still contains a measured (`ms`/`frame`) word; on a safe-window word the nudge *is* the pin.
- **Mark reviewed** — `PUT /:rk/review/:rowId { span }` stores `review.<rowId>` in the override
  with the span reviewed; 409 "This part moved. Reload the list." when the span no longer matches.
  A mark stops counting when a later audit moves its row (it stays, named as "changed since you
  reviewed it", until re-marked); a mark whose row is gone is pruned when the audit lands. Sign-off
  does not make the audit stale (the digest leaves out the stored certification).
- **Approve for family** — `POST /:rk/signoff` writes `certification.parent` only when the film is
  machine-certified with nudges counted, the audit passed and is current, every row has a verdict and none is `redo`;
  otherwise 409 with the missing lines ("N rows have no verdict", "N rows wait for redo", "N parts changed since you
  reviewed them", …). No override. `DELETE` withdraws.
- **Verdicts** — `PUT /:rk/review/:rowId` takes `verdict` (`approve` default, `remove`, `ignore`, `redo` + optional
  `reason` edges|category|action|timing|other), `change: {from, to}` (an in-place action change the client already
  applied) and `dwellMs`/`replays`. `remove` disables the cue/scene; `DELETE` is undo and reverts what the verdict
  applied (re-enable, restore `from`). Every verdict and undo appends to `household/content-filter/review-history/<rk>.yml`
  (append-only, via the repository) and logs `content_filter.review.verdict.recorded`. A moved span drops the verdict.

#### Film status card

The film page opens on `FilmStatusCard.jsx`: "Filters: Yes — N parts" (or "None for this film yet"),
"Refined: Yes — m of n measured to the millisecond" (or "No"), the certification, and one button from
`next`: **Refine** (a make run: the whole pipeline), "Checking the result…", **Review** (to the first
row without a verdict) or **Approve for family**. While a run works it shows its phases in words
(Checking the machine, Syncing the film's clock, Measuring each part — n of N, Building scenes,
Drafting cards, Checking the result; `runProgress.js`), a bar, an ETA from the pace since the first
part (after 3), the five latest parts in words and **Stop** (confirmed: nothing from a stopped run is
saved; refused once a run's results are saved). A queued run with no live worker says so. There is no stage dropdown; the sign-off panel lists what is missing and offers Withdraw. An
empty list says why (not refined yet, still checking, run in progress).

#### Review station

The page is a keyboard station: it owns the keys (one capture-phase listener, so they work while the
video has focus; they never fire inside text inputs or an open dialog) and a key bar under the player
shows the keys that apply to the current row, the verdict tally (`done/total`, redo count) and the bleep
level. `?` opens the whole keymap, Esc closes it.

- **Cursor and scope.** Moving the cursor (key, click, timeline, auto-advance) seeks to 4 s before the
  row and plays. One scope drives the list, the timeline and cursor stepping: kind (All / Words /
  Picture / Scenes) × action (All / Blur / Skip / Bleep / Mute) × "needs review". `F` cycles the kind.
  Stepping does not wrap: at the end it says "That is the last part in this view."
- **Auto-advance.** A saved verdict moves to the next row without a verdict in the current scope
  (reading the scope as it is when the save lands, and leaving a cursor the reviewer moved meanwhile).
  At the end it stops: "All N in this view reviewed", or "End of this view. N still open above."
- **Keys.** `→` / `Tab` next; `←` / `Shift+Tab` previous; `Space` replay; `A` approve; `R` remove;
  `I` ignore; `D` redo, then `1` edges, `2` category, `3` action, `4` timing or `Enter` for no reason;
  `U` undo the last verdict; `F` cycle kind; `W` widen 0.5 s each edge; `[` / `]` bleep level
  down / up 0.05; `Shift+D` rework every row flagged redo; `?` keymap; `Esc` close. Action keys by kind:
  words `M` mute, `P` bleep; picture `B` blur, `K` skip; scenes `K` skip, `B` blackout. An action key
  applies the effect through the existing `PUT /:rk/cues/:id` / `/scenes/:id` and records an `approve`
  carrying `change: { from, to }`. `W` works on single-part rows (a scene, or a group of one cue); a
  multi-cue group says "Widen one part at a time." The approve survives the re-audit that shifts the
  row: a mark also holds when the row's span equals the mark's recorded `change.to` edges (an edge
  nudge moves the re-audited row). While the `?` sheet is open only `?` and `Esc` act.
- **Verdict semantics.** `approve` = fine as it is; `ignore` = no opinion and counts as done; `remove`
  disables the cue or scene (a false positive; it is terminal once the re-audit lands, because the row
  leaves the audit); `redo` = rework, with an optional reason. Undo (`U`, or `DELETE`) drops the verdict
  and reverts what it applied, including merged in-place changes (the effect or edges go back to `from`,
  a removed row is re-enabled; re-verdicting over a `remove` also re-enables and re-audits). A verdict whose row's span later moves is dropped and the row returns to
  unreviewed.
- **Permalinks.** Every filter has one: `/admin/content/filter/<ratingKey>/<rowId>` selects and seeks
  that row (an unknown id says "That filter isn't in this film any more"); selecting a row updates the
  URL in place.
- **Timeline.** Under the player, a review timeline shows the rows in the current scope (it follows the
  kind and action filters) with the cursor; clicking a row seeks to it.
- **Rework.** `Shift+D` (press once to arm, again within 4 s to send; the button is one step; at most 500 reasons) queues one run for only the rows flagged redo: a send-back of their cues, or the
  scenes stage when only scene rows are flagged (scene rows stay flagged when mixed with cues). Each
  row's redo reason is stored on the run.
- **Bleep level.** The bleep tone volume, effective = film setting, else household profile `bleepLevel`,
  else 0.25 (clamped 0 to 1). `[` / `]` change the film's level by 0.05; a debounced write saves it to
  the film's settings, the player re-reads its profile and the cue replays. Applied at playback, no
  re-render.

### Review history and `review-stats`

The history file is the durable record of human judgement: `household/content-filter/review-history/<rk>.yml`,
`entries: [...]`, append-only (nothing rewrites or drops an entry, so it survives a re-audit that clears the
live marks). Each entry carries `at`, `by`, `rowId`, the row snapshot (`kind`, `category`, `modality`, `effect`,
`span`), `verdict`, `reason`, `change`, `dwellMs`, `replays`, `machine: { stage, unsure, handFixed }` and
`film: { stage }`. The server holds one mark per row (a later verdict overwrites it); an `undo` entry
means the mark was deleted, so the row has no verdict until a new one is recorded.

`contentfilter review-stats [--since 30d|12h|<date>] [--rk <id>] [--json]` is read-only and reports, over the
NET verdict per row (the latest verdict, none if an undo came after it; not raw entries): verdict counts by kind, category, effect and
machine stage; remove rate by machine stage and by `unsure` reason (where the machine's certification is wrong
most); the action-change matrix (`bleep -> mute`, `blur -> skip`, `edges`); redo reasons; median dwell. Use it to
tighten machine certification where humans keep removing or changing the same kind of row.

Caveats: history is append-only, so a verdict on a row whose span later moved (a re-audit after a nudge)
still counts here even though the live mark was dropped. `--since` takes `Nd`, `Nh` or an ISO date; a bare
number is rejected. The keymap, verdict lifecycle and bleep level are under Review station above.

## QA and current limitations

The resolver and player behavior have unit tests. `cli/player-review` scrubs cue-by-cue to
verify arm/fire timing; use the preview surround to check a title by eye.

The remaining work is primarily default profile/SFX assets, letterbox-precise blur
placement, pinning the remaining safe-window mutes, and bulk authoring in the admin screen.
Coverage and correctness are therefore data-quality concerns, not guarantees of the file
format.

Related implementation:

- `__app_modules/media/media/browser/content-filter/contentFilter.js`
- `__app_modules/media/media/browser/content-filter/useContentFilter.js`
- `__app_modules/media/media/server/adapters/persistence/FilesystemContentFilterRepository.mjs`
- `__app_modules/media/media/browser/content-filter/filterMode.js`, `videoPresentation.jsx`
- `__app_modules/media/media/browser/content-filter/preview/`
- `shared/contracts/content-filter/filterSettings.mjs`
- `__app_modules/media/media/server/api/contentFilter.mjs`
