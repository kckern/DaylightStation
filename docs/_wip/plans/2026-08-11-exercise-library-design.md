# Exercise Library — shared corpus, two projections

**Date:** 2026-08-11
**Status:** In implementation on `feat/exercise-library`. Corpus moved, index builder and
shared domain done; CLI, adapter, API, UI, and School source outstanding.

## Problem

A complete exercise-reference corpus was dropped into the media tree in December 2025 and
has never been wired to anything. Nothing in `backend/`, `frontend/`, `cli/`, `docs/`, or
`data/` references it, and no commit mentions it.

Two apps want it, for different reasons:

- **FitnessApp** wants demos and workout building blocks — a strength-training counterpart
  to the cycle-game racing module.
- **SchoolApp** wants health/anatomy curriculum — the muscle essays, the muscle and
  equipment taxonomies, and the exercise instructions as readable, quizzable material.

Neither app owns the corpus. That is the central design constraint.

## The corpus

At `media/library/exercise/` (moved there 2026-08-11 from `media/apps/fitness/library/`).

| Subfolder | Count | Contents |
|---|---|---|
| `exercises/` | 3,860 files | ~1,287 exercises: one `.yaml` + two stills (`_1.png`, `_2.png`) each |
| `assets/` | 1,309 | UUID-named `.gif` demo loops |
| `hevy_videos/` | 66 | `.mp4` clips named `Exercise-Name_BodyPart.mp4` |
| `equipment/` | 29 | one YAML per equipment type |
| `muscles/` | 49 | 25 YAML + 24 PNG — `cardio` has no plate |
| `muscle_groups/` | 11 | one YAML per group |

### Record shapes

```yaml
# exercises/<slug>.yaml
id: <uuid>
name: 3/4 Sit-Up
slug: 3-4-sit-up
image: <uuid>              # → assets/<uuid>.gif
description: <one paragraph>
target_groups: [core]
target_muscles: [abs]
equipment: [body-weight]
instructions:              # ordered prose steps, ~6 per exercise
  - Lie down on your back on a mat…
```

```yaml
# muscles/<slug>.yaml
id: <uuid>
name: Abs
slug: abs
group: core
image: <uuid>
description: <one paragraph>
full_description: <multi-page anatomy essay>

# muscle_groups/<slug>.yaml
id: <uuid>
name: Chest
slug: chest
description: <one paragraph>
muscles: [pectorals]

# equipment/<slug>.yaml
id: barbell
name: Barbell
slug: barbell
description: <one paragraph>
```

### Known data defect: taxonomy mismatch

Exercise records carry `target_groups: [core]`, but `muscle_groups/` contains no `core`
entry — its 11 groups are back, cardio, chest, deltoids, forearms, hips, lower-legs, neck,
shoulders, upper-arms, upper-legs. Meanwhile `muscles/abs.yaml` declares `group: core`.

**Resolution (code):** the adapter derives group membership from the *muscle* records and
treats the exercise-level `target_groups` as a hint. Any group that fails to resolve is
logged once at index-build time, never per request.

**Resolution (data) — done 2026-08-11.** The first full parse showed the defect was far
larger than the `core` mismatch alone. Of 1,296 exercises, **190 (15%) resolved to no muscle
group at all** and would have been unreachable in a group-based browse UI:

| Cause | Count |
|---|---|
| Only resolvable muscle was `abs`, blocked by the missing `core` group | 157 |
| No `target_muscles` at all (conditioning work) | 26 |
| Every target muscle dangling | 7 |

Two root causes, both scrape gaps rather than design problems:

1. **No abdominal group existed.** The 11 scraped groups covered no part of the trunk, yet
   `muscles/abs.yaml` declares `group: core` and the Hevy filenames use `_Waist`.
2. **13 muscles were referenced but never scraped** — including by the *muscle-group records
   themselves* (`back` lists `lower-traps`, `lower-back`, `teres-major`; `neck` lists both
   SCM entries). That made the corpus self-documenting: each missing muscle's correct group
   is readable from whichever group claims it.

Fixed by patching the corpus — `muscle_groups/core.yaml`, 13 muscle records, and
`target_groups`/`target_muscles: [cardio]` on the 26 conditioning exercises. **Result: 0
orphans**, and the `unknown-group` / `unknown-muscle` warning kinds vanished from the build.

The authored records are preserved in-repo at `cli/exercise-library/curated/`, because the
corpus itself is not version controlled. See that README for the provenance caveat on the
hand-written anatomy essays.

### Provenance

The `hevy_videos` folder name and the `Name_BodyPart.mp4` convention point at the Hevy
catalog; the exercise slugs and the Waist/Thighs/Chest body-part taxonomy match the
ExerciseDB dataset. Treat this as third-party scraped content: fine for household use,
not for redistribution.

## Decision 1 — Move the data out from under `apps/fitness`

```
media/apps/fitness/library/   →   media/library/exercise/     ✅ DONE 2026-08-11
```

Verified after the move: 5,351 files, per-directory counts unchanged
(`assets` 1309, `equipment` 29, `exercises` 3860, `hevy_videos` 66,
`muscle_groups` 11, `muscles` 49). `media/apps/fitness/` now holds only
`_trash`, `households`, `sessions`, `ux`.

Everything under `media/apps/<app>/` is app-private by convention — that is where
`gameshow`, `jeopardy`, and `school` media live. A corpus that two apps read should not
sit inside one of them. Nothing references the path today, so the move costs a rename plus
one config value, and it will never be cheaper than now.

## Decision 2 — One adapter, one corpus domain, two projections

```
1_adapters/reference/exercise-library/
  YamlExerciseLibraryRepository.mjs   Read a prebuilt index manifest; resolve
                                      image uuid → assets/<uuid>.gif; expose
                                      lookups by slug / muscle / group / equipment

2_domains/exercise/                   Exercise, Muscle, MuscleGroup, Equipment
                                      Shared vocabulary — no app owns these.

2_domains/fitness/workout/            Workout, ExerciseGroup, set/rep/rest
                                      value objects. Fitness-only.

3_applications/fitness/
  BrowseLibrary · BuildWorkout · SaveWorkout · RunWorkout

3_applications/school/sources/
  ExerciseLibrarySource.mjs           listMaterials / listWorks / getMaterial
```

The split matters: `2_domains/exercise/` is the corpus vocabulary both apps share, while
`Workout` and its grouping semantics are meaningful only to Fitness and stay under
`2_domains/fitness/`.

## The School integration is one file

School already walks a pluggable materials-source registry. `GetMaterialCatalog` iterates
`materials.sources`, calling `listMaterials(root)` on each and stamping results with a
resolved category; `MediaAlbumSource`, `MediaSeriesSource`, and `MediaLabelSource` are the
existing implementors, composed in `app.mjs`.

### ⚠️ CORRECTED 2026-08-11 — the original projection was wrong

The first version of this section claimed muscle essays could be served as `lecture_notes`
**units** from a materials source. **That is not possible**, and the error was a conflation of
two disjoint School subsystems:

| | Materials pipeline | Learning-catalog pipeline |
|---|---|---|
| Registry | `materials.sources` (pluggable) | `catalogs` (single repository) |
| Chain | `GetMaterialUnits` → `MaterialDetail` → `SchoolMaterialPlayer` | `LearningCatalogBrowser` → `startLearning` → `LearningContentReader` |
| A "unit" is | **a Plex content id** — `SchoolMaterialPlayer.jsx:73`: `unit.id IS the plex:<key> content id` | n/a |
| Prose lives in | nowhere; there is no unit `type` and no prose field | `module.document.blocks[]`, a validated `school.learning-document/v1` |

`lecture_notes` is a **module** type (`2_domains/school/catalog/moduleValidation.mjs:11`), and
`LearningContentReader` takes a `module`, never a `unit`. A materials source emitting prose
units would route into the shared Player with a non-Plex content id and fail to resolve.

**What survives:** the materials registry really is pluggable, and a source can add muscle-group
and equipment **collections** with zero frontend change. What does not survive is rendering the
anatomy prose through it.

### Revised approach — prose goes through the pipeline built for prose

Project the corpus into the **learning catalog** as `lecture_notes` modules carrying
`school.learning-document/v1` documents, which `LearningContentReader` already renders. Muscle
groups become lessons; each muscle's `fullDescription` becomes the document; exercises targeting
that muscle become `examples`.

This keeps the design's real claim — **no change to `SchoolApp.jsx`** — because that component
already dispatches `lecture_notes` at line 259. It costs more than "one new file": the corpus
needs a catalog repository, and `GetLearningCatalog` takes a single `catalogs` repository rather
than a registry, so composition work is required.

**Rejected alternative:** teaching the materials pipeline about non-playable units. It is a
smaller diff, but it pushes a "unit that is not media" concept into a pipeline whose progress
writes assume `plexId: unitId` — risking corruption in a subsystem the children use daily, to
avoid backend work in one that is additive.

**Note for whoever writes the category test:** `resolveCategory` returns `reference` for an
omitted or misspelled category as well as a correct one, and only warns
(`school.materials.category-unknown`). Asserting `category === 'reference'` alone passes against
a mis-filed config; assert the absence of that warning too.

## The Fitness module

`frontend/src/modules/Fitness/widgets/FitnessInstruction/`, registered as
`fitness:instruction` in `modules/Fitness/index.js` alongside `fitness:cycle-game`. Same
shape as every other module: an `index.jsx` exporting a default container plus a `manifest`
(`id`, `name`, `icon`, `description`).

Three states: Browse, Build, Run.

### Browse

Muscle-group rail across the top; muscle and equipment chips as secondary filters;
free-text search over `name`. Results are a grid of cards, each looping its
`assets/<image>.gif` with the name beneath.

Detail view: large GIF, `instructions` rendered as numbered steps, target muscles and
equipment as chips that link back into the filter, and — for the 66 exercises that have
one — the `hevy_videos` MP4 as a real-motion alternative to the GIF.

### Build

`+` on any card appends to a tray. The tray is the workout under construction.

`ExerciseGroup` is the structural unit: one or more exercises plus a round count.

- 1 exercise → straight sets
- 2 exercises → superset
- 3+ exercises → circuit

Per exercise within a group: sets, reps-or-seconds, load, rest. Groups and their contents
reorder by drag.

### Save

Writes a `Workout` to `data/household/apps/fitness/workouts/{id}.yml` — household-scoped
with an `author` field, not per-user. The garage screen is shared equipment, and session
history is already household-wide; a workout one person builds should be runnable by
whoever walks in next.

### Run

Full-screen player inside the existing `FitnessFrame` / `FitnessModuleContainer` shell,
touch-first with `onPointerDown` per the app's stated convention.

Layout: the current exercise's GIF looping large, its name, `Set 2 of 4`, target reps and
load, and a next-up strip. One large Done target advances. Rest counts down and
auto-advances. A circuit group rotates through its exercises before incrementing the round.

Runs log into the **existing fitness session record**, so strength work lands in the same
history as cycle work — session detail, recaps, and the longitudinal widget pick it up with
no new plumbing. Attribution comes through the existing `IdentityProvider` and presence
rather than a parallel identity path.

**Audio ordering constraint.** Rest-timer cues must route through the shared
unlock-on-gesture audio element. The garage Firefox kiosk ships `media.autoplay.default=1`,
which blocks audible autoplay until a user gesture. Browse and Build both begin with taps,
so a gesture always precedes Run — preserve that sequence and cues work without a
profile-level pref change.

## Risks

1. **Cold-parse stall — the main engineering risk.** Measured on the development machine:
   every corpus file is an online-only cloud placeholder (`blocks=0`), and hydrating a
   single 1.8 KB YAML took over 120 seconds. A boot-time walk of 1,287 YAML files would
   hang the backend outright. **The adapter must load a prebuilt index manifest**, generated
   once by a CLI command and refreshed deliberately — it must never walk the tree per boot.

2. **Corpus size — MEASURED 2026-08-11.** **437 MB across 5,352 files**, read off the
   homeserver where the tree is local. The dev machine's cloud mount reported `652 K`, an
   undercount of roughly 670×, because `du` there counts only hydrated blocks.

   | Slice | Files | Size |
   |---|---|---|
   | YAML — everything the index build reads | 1,363 | **2.5 MB** |
   | Images + video — must stream | 3,988 | ~434 MB |

   By directory: `assets/` 282M, `exercises/` 124M (the PNG stills), `hevy_videos/` 28M,
   `muscles/` 4.6M, `equipment/` and `muscle_groups/` under 350K combined.

   **Consequence:** 99.4% of the corpus is media. Only the generated index manifest belongs
   in the container image; every image and video streams from the media tree. It also means
   local development never needs the full corpus — hydrating the 2.5 MB of YAML is enough to
   build the index.

   **Method note:** measure on the homeserver, never the dev machine. `du` on a cloud mount
   reports hydrated blocks rather than real size, and forcing full hydration to find out ran
   for over an hour and reached 31% before being abandoned for a single `ssh`.

3. **Provenance.** Third-party scraped content (see above). Household use only.

4. **Essay quality.** The `full_description` anatomy texts read as generic generated prose.
   They are serviceable as reference material but were not authored for this curriculum.
   They deserve a read-through before backing graded schoolwork.

## Testing

- Adapter unit tests against a small fixture tree (a handful of YAML records), covering the
  taxonomy-mismatch resolution explicitly.
- Domain tests for group and round expansion — straight sets, superset, circuit.
- A Playwright live-flow test covering browse → build → run, per the project's
  `tests/live/flow/` convention.

## Open items for the implementation plan

- The index-manifest CLI: command name, output location, and when it regenerates.
- Whether `Workout` records need versioning once one has been run and logged against.
- Which subject the School shelf files under on the subject wall.
