# Piano "Piano With Jonny" — season reorg into three lanes

**Date:** 2026-07-09
**Area:** filesystem (NAS `Lectures/Piano With Jonny`), curriculum index pipeline (`cli/curriculum/`, `1_adapters/content/media/plex`), piano kiosk Videos mode (`frontend/src/modules/Piano/PianoKiosk/modes/Videos/`), per-user progress migration
**Status:** Design approved — ready for implementation plan(s)
**Supersedes / extends:** `2026-07-09-piano-curriculum-metadata-and-categories-design.md` (the `piano:` metadata + three-category lanes shipped there). This design takes the next step: making the **physical Plex seasons** match the lane model, upfront, at the filesystem, with a dry-run safety gate.

---

## Problem

`Piano With Jonny` (Plex `676490`, section 17) is a 2,434-episode, 13-season show whose season structure is an artifact of how it was scraped, not how it should be learned. Three problems:

1. **Seasons don't match the content model.** The just-shipped work sorts content into three lanes — **Lessons** (graded curriculum), **Practice** (drills + how-to-practice), **Repertoire** (songs) — but the *physical* seasons interleave lanes: S00 practice, S01–04 lessons, S05 practice, S06–07 lessons, S08 mixed, S09 practice, S10–12 repertoire. The lane assignment is therefore an overlay fighting the underlying season list.

2. **Courses fragment on trailing part numbers.** The `Course:` tag carries the part ("Silent Night – Rhumba **1**", "… **2**"), so one multi-part course/song renders as several cards: Song Tutorials = 182 cards for 130 songs, Challenges = 57 for 30, etc. Each numbered "part" is itself a full 4–13 episode mini-course.

3. **Repertoire is three duplicate lists.** Tutorials / Challenges / Accompaniments are three *treatments* of one overlapping song catalog — marquee standards (Autumn Leaves, Misty, Blue Moon…) appear in all three — but they're modeled as three separate seasons, so a song shows up three times with no join.

Because we are willing to reorganize the source files on the NAS, we fix this at the root: renumber and regroup the seasons so the season list **is** the lane model, normalize the `Course:` tags and episode titles, and join Repertoire song-first. This is a one-time, high-blast-radius filesystem operation, so it is gated behind a reviewed dry run and a reversible apply.

## Locked decisions

### Content model — three lanes

| Lane | Paradigm | Behaviour |
|---|---|---|
| **Lessons** | course/lesson curriculum | sequential, gated, **counted in the program ring** |
| **Practice** | drills + how-to-practice | always-open, uncounted, ungated, browse by topic |
| **Repertoire** | songs (performance) | always-open, uncounted, **song-first** faceted catalog |

The dividing line is the course/lesson paradigm: **only Lessons is "the curriculum."** Practice and Repertoire are always-available. One exception: a drill/exercise **explicitly or obviously attached to a lesson** stays *in* that lesson as an in-lesson asset (e.g. Season 07's "Major Turnaround Exercises" beside the turnaround lessons) rather than moving to Practice.

### Final Plex tree — 13 seasons → 9

```
PRACTICE
  S00  Practice                155   groups: How to Practice · Scales · Chord & Voicing Exercises ·
                                     Rhythm Exercises · Two-Hand Coordination
                                     (= old S00 Reference + S05 Scales + S09 Exercises + S08 exercise strand)
LESSONS
  S01  Soloing                 133   groups: Pop Soloing · 2-5-1 Soloing            (= old S01 + S02)
  S02  Improvisation           155   (= old S03)
  S03  Chord Voicings          220   groups: Rootless · Drop 2 · Quartal · Block    (= old S04, ⅓)
  S04  Chord Theory & Color     74   theory · extensions · alterations · ear training · reharm  (= old S04, ⅓)
  S05  Lead Sheet Application    40   the 5 "Play Lead Sheets With…" courses         (= old S04, ⅓)
  S06  Comping & Rhythm          81   groups: Comping · Rhythm Essentials           (= old S06 + S08 essentials strand)
  S07  Intros, Endings & Fills   61   (= old S07)
REPERTOIRE
  S08  Song Library           1515   song-first · treatment facet                   (= old S10 + S11 + S12)
                    TOTAL      2434   (conserved)
```

Read top to bottom, the season list is now Practice → Lessons → Repertoire, each season in exactly one lane. Episode counts are projected from a course-name classification (see "Classification rules"); the normalizer's dry run reports the exact final counts.

**Uneven-by-design seasons:** S05 Lead Sheet Application (40) is a tight applied unit; S03 Chord Voicings (220) is the systematic voicing matrix that faceting handles; S08 Song Library (1515) is the special-case library that is *song-first browsed, never scrolled*.

### Grouping representation

Plex gives exactly two levels below the show (Season → Episode); the lane model has more (Lane → Group → Course → Part → Lesson). Season is fixed at the **topic** level (the table above). Everything below the season is an **authored overlay** carried in NFO tags and surfaced through the committed index:

- **Group** — the intra-season bucket (e.g. within Chord Voicings: Rootless / Drop 2 / Quartal / Block; within Soloing: Pop Soloing / 2-5-1 Soloing).
- **Course + Part** — a multi-part course collapses to one course card (`Course:` = base name) with `Part: N` ordering the runs. Part 1 sorts before Part 2 by episode number, so sequential gating is unchanged.
- **Repertoire Song + Treatment** — a song is the catalog identity; a treatment (tutorial/challenge/accompaniment) is a run under it.

### Repertoire is song-first

Season 08 Song Library renders as a **song catalog**, not a treatment list:

- **Level 1 — Song catalog:** one card per normalized `Song:`; facets (style · difficulty · instructor) + search; each card shows the available treatment chips `[Tutorial] [Challenge] [Accompaniment]`.
- **Level 2 — Song page:** pick a treatment (*Learn it* / *Master it* / *Comp it*).
- **Level 3 — Treatment → parts → lessons.**
- **Level 4 — Lesson → Player.**
- A small **Skill Challenges** shelf holds the ~4 non-song challenges (10-Lesson Blues, Jazz Ballad Soloing, Halloween/Love Progression) that carry `SkillChallenge: true` and no `Song:`.

No progress ring at the catalog level (Repertoire is uncounted), but per-lesson watched state still shows so a learner sees where they left off in a treatment.

## Data model

### NFO tag schema (the on-disk source of truth)

The normalizer rewrites each episode's NFO. Existing fields kept: `<showtitle>`, `<plot>`, `<genre>` (style + generic Music/Educational), `<tag>Skill Level: …</tag>`, `<tag>Focus: …</tag>`, `<tag>Type: …</tag>`, `<credits>`, `<studio>`, and critically `<uniqueid type="wistia">` (the rename-stable identity used for progress migration). Changed / added:

```xml
<season>3</season>                          <!-- renumbered to new season -->
<episode>57</episode>                        <!-- renumbered E1..N within the new season -->
<title>Rootless Voicings, Walking Bass</title>  <!-- redundant course prefix stripped -->
<tag>Course: Soloing Over a Turnaround</tag> <!-- base name; trailing part number removed -->
<tag>Part: 2</tag>                           <!-- only when the course is a numbered part -->
<tag>Lane: lessons</tag>                      <!-- lessons | practice | repertoire -->
<tag>Group: Rootless Voicings</tag>           <!-- intra-season group; omitted when a season has one group -->
<!-- repertoire only: -->
<tag>Song: Fly Me to the Moon</tag>          <!-- normalized catalog identity; omitted for SkillChallenge -->
<tag>Treatment: tutorial</tag>               <!-- tutorial | challenge | accompaniment -->
<tag>SkillChallenge: true</tag>              <!-- non-song challenge; then Song omitted -->
```

`Lane` is stored explicitly (not derived from season) so a future re-shuffle can't silently mis-route content, and so the in-lesson-exercise exception is representable per episode.

### Filenames

`Piano With Jonny - S<new>E<new> - <clean title>.{mp4,nfo}`, moved into the new season folder `Season NN - <Name>/`. The `S..E..` token drives Plex's episode identity; the descriptive tail mirrors the cleaned `<title>`.

### Committed index (`676490.json`)

`cli/curriculum/nfoIndex.mjs` reads the *normalized* NFOs, so it no longer needs normalization heuristics. The per-episode record gains `part`, `lane`, `group`, and (repertoire) `song`, `treatment`, `skillChallenge`; the per-season record gains `lane` and the ordered group list. `CurriculumIndex.mergeEpisode/mergeSeason` and `PlexAdapter.#curriculumMerge` surface these under `item.piano` / `season.piano` exactly as the current `category/styles/skill/instructor` fields do.

## Classification rules (source of truth for the normalizer)

The normalizer assigns new season, lane, group, and repertoire fields from the *old* `Course:` tag and season. These rules are the specification; the dry run exists so a human confirms the edges before apply.

- **Base course + part:** strip a trailing ` – N` / ` N` from `Course:` → base name; the stripped integer → `Part`. Absent ⇒ no `Part`.
- **Lane** (per old season, with per-course exceptions):
  - Practice ⇐ old S00 (Practice Essentials), S05 (Scales), S09 (Exercises), and the S08 courses whose base name contains "Exercise".
  - Lessons ⇐ old S01, S02, S03, S04, S06, S07, and the S08 courses that are **not** exercises (the Essentials strand). Exception: a drill course sitting inside a Lessons season and obviously paired with its lessons (e.g. S07 "Major Turnaround Exercises") stays `lessons`.
  - Repertoire ⇐ old S10, S11, S12.
- **New season + group** (per the tree): old S01/S02 → S01 Soloing (group = old season name); old S03 → S02; old S04 → **S03 Chord Voicings** if base matches `Rootless|Drop 2|Quartal|Block Chords`, **S05 Lead Sheet Application** if base matches `Play Piano Lead Sheets`, else **S04 Chord Theory & Color** (group by chord family for Voicings; theory topics otherwise); old S06 → S06 (group Comping); old S08 essentials → S06 (group Rhythm Essentials, by style); old S07 → S07; practice sources → S00 (group by drill topic); repertoire → S08.
- **Repertoire Song + Treatment:** `Treatment` = tutorial (old S10) / challenge (old S11) / accompaniment (old S12). `Song` = the base `Course:` normalized for punctuation and casing so variants merge (**"Fly Me To The Moon" = "Fly Me to the Moon – Challenge" = "Fly Me To The Moon – Challenge"**). **Landmine:** a course whose base is a technique with an incidental song example ("Ear Training With Holiday Songs 1 – Silent Night") is **not** a Silent Night song — `Song` comes from the `Course:` identity, never from a title substring. Non-song challenges (progressions, N-lesson challenges) get `SkillChallenge: true` and no `Song`.

The dry run emits the full song-merge list for human confirmation before any apply.

## Filesystem normalizer — `cli/curriculum/normalize.mjs`

A standalone CLI, safety-first. Phases:

1. **Plan (dry run, default).** Parse every NFO; compute the target (new path, season, episode, title, tags) for each of the 2,434 episodes; build the old→new map keyed by Wistia `uniqueid`. Emit to a review file: every file `old → new`, every NFO field diff, the projected per-season/-group counts, and the **repertoire song-merge list**. No writes.
2. **Apply (`--apply`).** Tar all NFOs + a filename manifest to a timestamped backup; rewrite NFOs; move+rename the `.mp4`/`.nfo` pairs into new season folders; write an **undo script** that reverses every move. Idempotent (re-running on normalized files is a no-op). Scoped by `--season <old>` so a single old season can be normalized and eyeballed in isolation; the risky repertoire seasons (old S10–12) run last.
3. **Plex reconcile.** Trigger a targeted library rescan; capture Plex's new episode list; join old↔new by Wistia `uniqueid` to produce `oldRatingKey → newRatingKey`.
4. **Progress migration.** Remap every per-user `video-progress.yml` entry and any `media_memory` reference from old ratingKey → new ratingKey via the map. Wistia id is the join key of record; `(oldSeason,oldEpisode) → (newSeason,newEpisode)` is the fallback. Report unmatched entries (must be zero).
5. **Regenerate index.** Run `build-index.mjs` on the normalized NFOs → `676490.json`; commit.
6. **Verify.** Episode count conserved (2,434); every season single-lane; every playable episode joins to an index record; a sampled set of pre-reorg progress entries still resolve to the same content post-migration.

**Risk register:** (a) renaming into new season folders re-keys Plex episodes → **mitigated** by Wistia-keyed progress migration (phase 4); (b) a mis-merged song corrupts the catalog → **mitigated** by the dry-run song-merge review (phase 1); (c) partial apply → **mitigated** by per-season scoping, backup tar, and the undo script.

## Backend surfacing

No new endpoints. The expanded `piano` block flows through the existing path (`CurriculumIndex` → `PlexAdapter.#curriculumMerge` → list router passthrough + `GetPlayableUnits` lift). `programStats` and `continueTarget` already gate on content category; they consume `lane === 'lessons'` (rename from the interim `category`). The `subcourses` label and `reference_units` config become vestigial once `Lane` is authoritative — the reference-unit config path is removed in favour of `Lane: practice`.

## Frontend — three lanes (`modes/Videos/`)

- **Program home:** three lane sections (Practice · Lessons · Repertoire), Lessons carrying the program ring + Continue/Up-next.
- **Lessons:** season chapters; within a season, courses grouped by `piano.group`; multi-part courses collapse to one card → Part 1 / Part 2 → lessons; sequential gating retained.
- **Practice:** flat always-open grid grouped by `piano.group` (How to Practice · Scales · Chord & Voicing Exercises · Rhythm Exercises · Two-Hand Coordination); no ring, no gate.
- **Repertoire (`RepertoireBrowser`):** song-first catalog → facets + search → song card with treatment chips → song page → treatment parts → lessons; plus the Skill Challenges shelf.

Reuse the existing `subcourses.js` pure helpers; extend for group/part collapse, song→treatment join, and lane routing. New pure helpers are unit-tested against real `676490.json` fixtures.

## Testing

- **Normalizer (pure):** base/part split; lane assignment incl. the in-lesson-exercise exception; new-season+group mapping for a sampled course per old season; song-key normalization + the Silent-Night-is-not-a-song landmine; treatment assignment; idempotency (normalized input → empty plan). Fixtures are real NFO snippets.
- **Migration:** old→new ratingKey map built from a Wistia-keyed fixture; a progress entry survives remap; unmatched-count is zero.
- **Index/adapter:** existing `CurriculumIndex`/`PlexAdapter` suites extended for `lane/group/part/song/treatment`.
- **Frontend (pure + component):** group/part collapse; song→treatments join; lane routing; program denominator counts only `lane==='lessons'`; Continue skips Practice/Repertoire; Repertoire catalog renders one card per song with correct chips; Skill Challenges shelf renders.

## Implementation decomposition (for writing-plans)

Sequential, each independently testable and deployable:

1. **Plan 1 — Normalizer + dry run.** `normalize.mjs` (plan phase only) + classification rules + pure tests. Deliverable: a reviewed dry-run manifest and song-merge list. **Gate: human review before Plan 2.**
2. **Plan 2 — Apply + migrate + reindex.** Apply phase, Plex reconcile, progress migration, `676490.json` regen, verification. Deliverable: normalized NAS + migrated progress + committed index.
3. **Plan 3 — Backend.** `lane` fields through index/adapter/router/usecase; retire `reference_units`/`subcourses` vestiges.
4. **Plan 4 — Frontend three lanes.** Home lanes, group/part collapse, song-first `RepertoireBrowser`, Practice grid; pure + component tests.

## Out of scope (YAGNI)

- No new Player internals; Repertoire reuses the existing lesson player + hand-off.
- No Plex agent/metadata-agent change (Path C still owns titles/metadata via the index).
- No AI classification — rules + human dry-run review only.
- No server-side Continue memoization (client-derived).
- No change to non-video piano modes or to other shows.
