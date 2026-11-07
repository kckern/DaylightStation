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
  skipped". It yields to a skip-card. Logs `content-filter.bumper.shown`.
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
Hosts without `uv` set `CONTENT_FILTER_TRANSCRIBE_PY=python3` so the CLI runs `python3 transcribe.py`.
ImageMagick 6 hosts work too (the renderer falls back from `magick` to `convert`).
`refine --kinds visual` needs no transcript (clock sync comes from the override) and selects
`shown` cues, including `skip` cues under a language category. Every Jev request has a
timeout (`TimeoutDecisionGateway`, default 90 s, wrapped around the gateway by the CLI): on timeout the call abstains, a warn line
(`refine.jev.timeout`) goes to `log.jsonl`, and the cue ends `unknown` (`jev-timeout`).

**Region-only cues.** A `shown` cue whose edges stay unsure (edge-all-unsure, bracketed edges)
but which Jev sees in the probe frames is still region-tracked over the first to last frame it
was seen. It keeps its coarse VidAngel in/out and gains `regions` plus
`refine: { edges: coarse }` (status `region` in refine results, `coarse-edges` on the review
list). The player applies such a track over the synced coarse window; `refinedCount` counts
only cues measured at ms/frame, and a cue refined at ms/frame is never replaced by a coarse one.
When Jev sees the subject nowhere, or only judges it whole-frame, no track is written.

**Same-subject tags (R6).** After measurement, `shown` cues whose spans overlap are asked of Jev
pairwise (`subjectGroups.mjs`, both labels plus one frame from the overlap, "the same single
thing on screen?"). Only a confident yes groups; no, abstain, timeout and error leave the tags
separate. Grouped cues carry `subject: <id>` in the refined EDL; a re-run keeps the subjects
already there (`--resubject` asks again, `--no-subjects` skips the step). The resolver turns
cues sharing a `subject` into ONE effect (id = the subject id) over the union of their spans,
following the best-tracked member's region track (most keyframes; held at both ends to cover the
union): regional blur when tracked, full-blur otherwise. `said`/`heard` cues never group, so a
word inside the union still mutes on its own.

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
  even inside an overlapping scene.
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
SRT cues carry an explicit `effect: mute`, so profiles do not change them —
only `cueOverrides.<id>.disabled` does.

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

**Rail** (`FilterRail.jsx`, two tabs). *Review*: last fired cue/scene with Replay, the next 5
upcoming with Jump and Peek, and the `WorkshopPanel`. *Settings*: `SettingsPanel`.
**Timeline** (`FilterTimeline.jsx`): marks for every cue and scene, click to seek, previous/
next cue buttons.

**Workshop actions** (`WorkshopPanel.jsx`, writes via `useFilterWrite.js`), on the cue or
scene selected in the rail. Cue: *Off*, *Mute*, *Bleep*, *Blur*, *Skip*, or *Profile* (clear
the ruling), written to `cueOverrides` by `PUT /{rk}/cues/{cueId}`. Scene: *Tags only* (off),
*Blackout*, *Skip*, *Profile* via `PUT /{rk}/scenes/{id}`, plus **Draft with AI / Regenerate** (one scene's card,
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
old single `language` rule is the fallback (reading it as settings gives all five groups that
value). Defaults when settings are written without a group: Profanity, Blasphemy, Sexual, Slurs
mute; Childish off. **Per-word exceptions:** `profile.languageWords: { <word>: off|mute|bleep }`
(also honoured in a film's `profilePatch`) beats the group; the word is the category leaf
(`language/childish/jerk` -> `jerk`) or an uncensored one-word label. The group rule chooses the
audio effect for *said* cues; the R3 tone caps, R4 line rules and the channel fit apply on top, so
a *shown* language tag (billboard) is still blurred, not muted. Cues carrying their own `effect`
(word-list SRT cues) ignore both. The preview Settings tab has five rows (Profanity, Blasphemy,
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
`content-filter.workshop.failed` (warn), plus `filter-rail.jump`,
`filter-timeline.seek|step` (info).

**No remote access, by design.** The shield is a mouse click on the screen itself and the
rail's controls are plain pointer targets: nothing on the bus, no remote-control action and
no D-pad path opens the surround, seeks through it or writes a ruling. Rulings are made by
someone at the screen.

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
