# Exercise library

A ~1,300-exercise reference corpus with demo animations, step-by-step instructions, and
muscle / muscle-group / equipment taxonomies. **Two apps read it for different reasons**, and
neither owns it:

- **Fitness** — an Exercise Library module (Browse → Build → Run) that assembles and runs
  strength workouts on the garage touchscreen.
- **School** — an *Anatomy & Movement* catalog whose lessons are the muscle records' anatomy
  essays, with exercises as worked examples.

That shared use is the reason for every structural decision below.

## Where things live

```
{mediaDir}/library/exercise/          the corpus — NOT under apps/, because two apps read it
  exercises/    <slug>.yaml + <slug>_1.png + <slug>_2.png
  assets/       <uuid>.gif demo loops, <uuid>.png muscle plates
  hevy_videos/  <Name>_<BodyPart>.mp4
  muscles/  muscle_groups/  equipment/

{dataDir}/household/apps/fitness/
  exercise-index.yml       the generated manifest — the ONLY thing read at runtime
  workouts/<id>.yml        saved workouts, household-scoped

cli/exercise-library/curated/   hand-authored taxonomy records (the corpus is not in git)
```

### Size, and why the manifest exists

| | Files | Size |
|---|---|---|
| Corpus total | 5,352 | **437 MB** |
| — YAML (all the index reads) | 1,363 | 2.5 MB |
| — images + video (streamed, never bundled) | 3,988 | ~434 MB |
| **Generated manifest** | 1 | **2.8 MB** |

The corpus lives on cloud-synced storage where files are online-only placeholders. A single
cold read was measured at **over 120 seconds**. Nothing at runtime may walk that tree — the CLI
pre-builds one manifest, and the adapter reads only that.

> **Never size this tree with local `du`.** On the dev machine it reports hydrated blocks, and
> was wrong here by ~670× (652 K vs 437 MB). Measure on the homeserver, where the same tree is
> local. Forcing hydration to find out ran an hour and reached 31% before being abandoned.

## The CLI

```bash
npm run exercise:index      # build the manifest; prints counts + every warning
npm run exercise:validate   # same report, exits non-zero if any exercise has no muscle group
```

**Re-run `exercise:index` after any corpus change.** The manifest is a build artifact; nothing
regenerates it automatically.

Current clean state: 1,296 exercises · 38 muscles · 12 groups · 29 equipment · 52 matched
videos · 2,564 stills · **0 exercises without a group**.

### Reading the warning report

Warnings are data, not log noise, and come in two shapes:

- **Aggregated** — one entry per distinct defect with a `count`. A missing group referenced by
  400 exercises is one row, not 400.
- **Per-record** (`non-scalar-field`, `empty-field`) — one entry per record, because their
  subject is a *field name* shared across records and collapsing would hide which records are
  affected.

Every warning uses the same skeleton: `{ kind, subject, referrer, referencedBy, count }`. The
offending identifier is always `subject` — never a per-kind key.

The one warning kind expected in normal operation is `unmatched-video`: 14 Hevy clips have no
corresponding exercise record. That is genuine partial overlap between two sources, not a defect.

## Architecture

```
media corpus ──(CLI, offline)──▶ exercise-index.yml
                                       │
                        1_adapters/reference/exercise-library/
                          YamlExerciseLibraryRepository        parse once, cache, serve both apps
                                       │
                    ┌──────────────────┴──────────────────┐
      3_applications/fitness/                  3_applications/school/catalog/
        BrowseExerciseLibrary                    ExerciseLibraryCatalogSource
        SaveWorkout · PrepareWorkoutRun          (via composite catalog repositories)
        LogStrengthRun                                   │
                    │                            LearningContentReader
        /api/v1/fitness/…                        (no SchoolApp.jsx change)
```

**Domains.** `2_domains/exercise/` is the vocabulary both apps share — Exercise, Muscle,
MuscleGroup, Equipment, and the filter predicate. `2_domains/fitness/workout/` holds Workout,
ExerciseGroup, and `expandWorkout`, which are meaningful only to Fitness.

### Two things that will bite you

**1. Slug-keyed maps must use `Object.create(null)`.** Corpus slugs are third-party scraped
strings. Against a plain object literal, a slug named `constructor` makes `map[key]` truthy
(the inherited constructor) and `.includes` throws; `__proto__` vanishes silently and produces
a *misleading* warning. **The protection does not survive serialization** — parsing the manifest
hands back `Object.prototype`-backed objects, so the adapter rebuilds every keyed map on load.

**2. Filter terms are multi-value: OR within a facet, AND across facets.** `?group=chest&group=back`
matches either; `?group=chest&equipment=barbell` requires both. Express's `qs` parser turns
repeated keys into arrays, so **forward `req.query` through untouched**. `String(req.query.group)`
turns `['chest','back']` into `'chest,back'` and matches nothing; treating a non-scalar as "no
constraint" returns the entire corpus silently. A malformed term matches nothing, never everything.

## Fitness module

`frontend/src/modules/Fitness/widgets/FitnessInstruction/`, registered as `fitness:instruction`
(legacy id `fitness_instruction`). Three states.

> **Registration is not enough to make it reachable.** The Fitness Apps menu is an explicit
> allowlist in the household `fitness.yml`, not a render of the widget registry — a module can
> be registered, imported, and fully tested while being invisible in the UI. It needs an entry:
>
> ```yaml
> app_menus:
>   - name: Fitness Apps
>     id: app_menu1
>     items:
>       - name: Exercise Library
>         id: fitness_instruction
> ```
>
> That config is cached at startup, so a backend restart is required. This was missed initially
> and only surfaced when the app was opened in a browser — every unit test passed against a
> module nothing could navigate to.

**Browse.** Group rail, muscle/equipment chips, search, card grid.

Rendering 1,296 looping GIFs would be ~282 MB and would take the kiosk down, so three layers
bound three different quantities: a **60-card DOM window** grown per "Show more"; an
**IntersectionObserver** so no `<img>` mounts until visible; and — deliberately **not** one-shot —
the observer *drops* an image when its card scrolls away, so resident memory tracks the viewport
(~10–14 MB) instead of growing with scroll depth. Filtering, not scrolling, is the real control.

**Build.** Each tray pick seeds a straight-sets group. Group *size* derives its meaning — 1 =
sets, 2 = superset, 3+ = circuit — shown, never chosen from a dropdown.

The sets/rounds composition is resolved by *which control is shown*, so the user is never asked:
a single exercise gets a per-exercise **Sets** knob with `rounds: 1`; two or more get a
group-level **Rounds** knob with every `sets` pinned to 1. Merging two 3-set singles yields
`rounds: 3` (max, so no work is silently lost); splitting hands the sets back.

Reorder is **up/down targets, not drag** — a drag needs an uninterrupted tracked contact across
distance, which is the gesture a damp finger drops halfway and which fights the page's own
scrolling. Up/down are discrete, so a slip is a no-op rather than a group dropped in the wrong
place, and they are keyboard-reachable for free.

**Run.** Full-screen player over the server-expanded step list. Only rest auto-advances; a timed
work step still waits for a tap, because auto-advancing moves the screen while someone is
mid-plank. The countdown is deadline-based rather than decrement-per-tick, so a throttled kiosk
tab cannot stretch a 90-second rest.

> **Audio.** The garage Firefox kiosk ships `media.autoplay.default=1`, blocking audible autoplay
> until a user gesture. Cues route through `installCueAudioUnlock` in
> `frontend/src/modules/Fitness/player/hooks/audioCuePlayer.js`. **Never construct a fresh
> `Audio`** — a new element has not been unlocked and stays silent. Browse and Build both begin
> with taps, so a gesture always precedes Run; preserve that ordering.

### Expansion happens server-side

`expandWorkout` lives in the backend domain and no build alias resolves `backend/src` from
frontend runtime code. A frontend copy would be exactly the duplicated-ordering bug that domain
exists to prevent, so the server expands and joins against the corpus:

```
POST /api/v1/fitness/workouts/run       an unsaved draft (the primary Build → Run path)
GET  /api/v1/fitness/workouts/:id/run   a saved workout
```

Both return `{ workout, steps, exercises, missingSlugs }`. A slug that has since vanished from
the corpus degrades — it appears in `missingSlugs` and the runner draws a placeholder — rather
than 500ing.

## Endpoints

```
GET    /api/v1/fitness/exercises?group=&muscle=&equipment=&q=    summaries
GET    /api/v1/fitness/exercises/taxonomy                        groups, muscles, equipment
GET    /api/v1/fitness/exercises/:slug                           full record
GET    /api/v1/fitness/workouts                                  summaries
POST   /api/v1/fitness/workouts                                  create/update; 400 names unknown slugs
GET    /api/v1/fitness/workouts/:id
DELETE /api/v1/fitness/workouts/:id
POST   /api/v1/fitness/workouts/run                              expand a draft
GET    /api/v1/fitness/workouts/:id/run                          expand a saved workout
POST   /api/v1/fitness/sessions/:sessionId/strength              log a completed run
```

The strength route's body is
`{ workoutId, completedSteps, completedAt?, startedAt?, openSession?, household? }`. See
[Session logging](#session-logging) for `openSession`.

Every browse response carries `library: { available, builtAt, counts }`, plus a `hint` naming
`npm run exercise:index` when the manifest is missing — because a browse screen showing "no
exercises" is otherwise indistinguishable from a broken one.

## Session logging

Wired end to end as of 2026-08-11 and covered by
`tests/live/flow/fitness/exercise-library.runtime.test.mjs` (test 6), which walks the real
journey in a browser and asserts the finished run reaches a session record.

A completed run appends to `strength.runs[]` on the fitness session record, so it
lands in the same history as cycle work and the reporting stack picks it up unchanged.

Runs **append** rather than replace — bail-at-two-sets-then-restart is ordinary, and replacing
would delete sets that were actually performed. Each exercise carries `setsCompleted` beside
`setsPlanned`, so a reader can say "2 of 4". Planned always comes from the *stored* workout,
never the client. Nothing is clamped: a report of 5 against a prescribed 4 records 5.

Attribution uses the session's own `participants` block via `getPresentParticipantIds()`.
**Never `getRoster()`** — it is expensive, has caused real performance bugs, and must never be
memoized. Presence is membership in that block, *not* an `hr_device`: strength work is routinely
strapless, so filtering on the strap would attribute the common case to nobody.

### Which session — adopt, else open

`FitnessInstructionContainer` reads `fitnessSessionInstance` off the fitness context (via
`useOptionalFitnessContext`, so the module still renders outside a provider) and hands it to
`strengthRunLog.js`, which resolves the session in two steps:

1. **A live session is adopted.** A lift between intervals belongs to the ride, not to a second
   record. The POST carries no `openSession` flag, so an id the app is holding that the server
   does not know still 404s — that is a real bug and has to stay visible.
2. **Otherwise the server opens one.** The client mints the id the run would have had
   (`formatSessionId`, `YYYYMMDDHHmmss` local) and posts `openSession: true`.

**Why the server and not the browser.** A strength workout with no session is the *ordinary*
case — `FitnessSession` only starts from sensor traffic and strength work is strapless — and the
browser cannot create the record even if it tried:

| Gate | Why a strength-only session fails it |
|---|---|
| `PersistenceManager.validateSessionPayload` | empty roster, under 60s, under 3 ticks, no non-zero HR series — all four |
| `POST /save_session` | `session_write_whitelist` admits only the garage kiosk (Firefox) |

Those gates are correct; they keep sensor flap out of history. They just mean the client can only
*ask*. `openSession` is opt-in for exactly that reason: posting an id you believe exists and
having it silently created would hide a bug, so the flag distinguishes a **claim** from a
**request**. A session opened this way starts at the run's `startedAt`, ends at `completedAt`,
and carries no participants — nobody was identified, and guessing would be worse.

Two devices can therefore produce two records for one workout (the kiosk's session plus one
opened from a tablet). That is a `POST /sessions/merge`, and a mergeable duplicate beats a
workout that was never recorded.

### An unsaved plan is saved first

`setsPlanned` comes from the *stored* workout, so an unsaved plan is unloggable. Rather than lose
the run, `ensureWorkoutOnShelf` saves it and files against the new id. A plan that already has an
id is never duplicated.

### The person is told, every time

The completion panel carries the recording state — `Recording to your session…` → `Recorded to
your session.` — and a failure replaces it with a red **NOT RECORDED** block naming the reason,
plus a **Try again** target that re-files the same sets. Someone who did four sets and reads only
"Nice work" would assume it counted, so a failed filing never renders as a plain completion.

**Stopping early is a completion, not a discard.** "End run" with sets already done lands on the
completion panel and files what was performed (two of six files two) instead of dropping back to
Browse with the work thrown away. With nothing done there is nothing to file, so it exits
immediately.

## School projection

School's **materials** and **learning-catalog** pipelines are disjoint, and the difference
matters:

| | Materials | Learning catalog |
|---|---|---|
| A "unit" is | **a Plex content id** | n/a |
| Prose lives in | nowhere — no unit type, no prose field | `module.document.blocks[]` |
| `lecture_notes` is | not a thing here | a **module** type |

An early design tried to serve muscle essays as `lecture_notes` *units* from a materials source.
That is impossible — those units route into the shared Player with a non-Plex content id and
fail to resolve. Prose goes through the learning catalog, which is what `LearningContentReader`
was built for.

`ExerciseLibraryCatalogSource` projects muscle groups → courses, muscles → lessons carrying
`lecture_notes` documents, and exercises → `examples` (capped at 6 per muscle; biceps alone has
197). It merges with authored YAML behind `CompositeLearningCatalogRepository` /
`CompositeLearningContentRepository`, so every consumer still sees a single repository.
**Authored YAML wins** — the shelf is correctable with a file, not a code change.

`SchoolApp.jsx` is not modified. It already dispatches `lecture_notes` at line 259.

**Known gap:** lesson images are omitted. `LearningContentReader` ignores `asset` blocks, and
`assetId` is a `REFERENCE_ID` that cannot express corpus media paths. Emitting them would render
blank, so exercises ship as prompt + instruction steps. Displaying them needs a reader change
plus an asset-id scheme.

**Access.** `catalog.access` in the household `school.yml` grants the `anatomy` catalog to each
learner by name and to guests, leaving `unassigned: hidden` intact — a global flip would also
expose every future authored course.

## Corpus curation

The scrape had a taxonomy hole: **190 of 1,296 exercises (15%) resolved to no muscle group** and
would have been unreachable in a group-based UI.

| Cause | Count | Fix |
|---|---|---|
| Only resolvable muscle was `abs`, and no abdominal group existed | 157 | added `muscle_groups/core.yaml` |
| 13 muscles referenced but never scraped | 7 | added the muscle records |
| No `target_muscles` at all (conditioning) | 26 | assigned to `cardio` |

The corpus was self-documenting about the second one: the *muscle-group records themselves*
listed the missing muscles (`back` claims `lower-traps`, `neck` claims both SCM entries), so each
one's correct group was readable from whichever group claimed it.

Those records are hand-authored and preserved in `cli/exercise-library/curated/` with a restore
procedure, because the corpus is not version controlled. **Their anatomy essays were written for
this project and have not been reviewed by anyone qualified** — School renders them as reader
content, so read them before they back graded schoolwork. The same caveat applies to the scraped
essays, which read as generic generated prose.

## Provenance

Third-party scraped content — the `hevy_videos` naming matches the Hevy catalog, and the slugs
and body-part taxonomy match ExerciseDB. Fine for household use; do not redistribute.
