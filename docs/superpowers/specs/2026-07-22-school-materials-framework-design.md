# School — Materials Framework (re-plan of sub-project 2)

**Status:** Design spec. Supersedes `2026-07-21-school-courses-design.md`.
**Date:** 2026-07-22
**Requirements:** [`2026-07-21-portal-homeschool-requirements.md`](2026-07-21-portal-homeschool-requirements.md)

---

## 1. Why this replaces the courses spec

`2026-07-21-school-courses-design.md` designed **video courses**, modelled
directly on the Piano Kiosk's Videos mode: Plex shows, seasons, episodes, a
`sequential` Plex label, and `UserVideoProgressStore`. It is a good design for
exactly one shape of content.

Two things broke that assumption:

1. **Audio material with the same pedagogy.** Plex `619778` "Shakespeare Tales"
   is an *artist* holding 16 *albums* (plays), each holding ~5 *tracks* (acts,
   7–11 min). The intended rule is: choose any play freely, but work its acts in
   order, passing a comprehension quiz before the next unlocks. That is the
   video course's lock rule applied to a different Plex hierarchy and a
   different medium.
2. **Material that should not be gated at all.** Cliff notes, reference
   audiobooks, freestyle listening. Same source shape as Shakespeare, opposite
   pedagogy — no order, no gate, no credit.

Those cannot be expressed by adding fields to a video-course model. They need
**structure and pedagogy to be independent axes**. That is what this spec
defines.

It also absorbs two things that were separate sub-projects, because they turn
out to be dimensions of this framework rather than features beside it:
**content gates** (R10, old sub-project 7) and **freestyle content** (R9).

---

## 2. The model

Three layers. Each answers one question and varies for one reason.

| Layer | Answers | Varies by |
|---|---|---|
| **Source** | What are the units, and in what order? | Where content lives (`plex-show`, `plex-album`, `readalong`, later `komga`/`files`) |
| **Material** | — | Nothing. This is the normalised invariant everything downstream reads. |
| **Category** | Is it ordered? Gated? What does finishing it earn? Where does a child find it? | Pedagogy, not medium |

### Naming

The generic noun is **material**, not "content" and not "course".

- **"Content" is already taken**, heavily: `2_domains/content/`,
  `1_adapters/content/{media,readable}/`, `contentId`, `ContentAdapter`. That is
  the platform layer School *consumes*. A `SchoolContent` entity sitting on top
  of the content domain would be confusing precisely where the layering matters.
- **"Course" is now a category**, not the top-level thing — one pedagogy among
  several. Calling everything a course forced awkward constructions like "a
  reference course that isn't really a course."
- "Material" is already this project's vocabulary for exactly this: R2.6 "loose
  materials", R5.4 "a folder of maps or worksheets".

### Entities

```
Material {
  id           // 'plex:619844'
  title        // 'Hamlet'
  poster
  source       // 'plex-album'      — which adapter produced it
  medium       // 'audio'|'video'|'text'
  category     // 'course'|'reference'|'listening'
  units: Unit[]
}

Unit {
  id           // 'plex:619845'
  index        // 1-based position within the material
  title        // 'Hamlet 1: ...'
  duration     // ms, null for untimed text
  group        // 'Unit 3' for season-grouped video; null when flat (audio tracks)
  medium       // usually inherits from the material; may differ (see §5)
}
```

`group` is what lets one model carry both hierarchies. Video material from a
Plex show has seasons, so its units carry a group label for display. Audio
material from an album is flat, so `group` is null. **The lock math never reads
`group`** — it is a linear scan over `units` ordered by `index`, identical in
both cases. Grouping is presentation only.

A **catalog** is the set of materials produced by one source entry. Catalogs
never gate; only the units within a material do. That is the whole of
"free choice across, strict order within" — it needs no extra concept, because
sequencing is defined per material and nothing sequences the catalog.

---

## 3. Config

Replaces the `courses:` block in `data/household/config/school.yml`.

```yaml
materials:
  # ---- Categories: pedagogy, reusable across sources --------------------
  categories:
    course:
      sequential: true
      gate: quiz               # next unit locked until this one's gate passes
      completion: [played, gate]
      credit: { coins: true, curriculum: true }

    reference:                 # Cliff notes, look-it-up material
      sequential: false
      gate: none
      completion: []           # nothing to complete; resume still works
      credit: { coins: false, curriculum: false }

    listening:                 # freestyle audiobooks (retires R9)
      sequential: false
      gate: none
      completion: [played]     # records "finished", earns nothing
      credit: { coins: false, curriculum: false }

  # ---- Sources: where material comes from and its shape -----------------
  sources:
    - label: Shakespeare Tales
      source: plex-album
      root: plex:619778
      medium: audio
      category: course

    - label: Art Lessons
      source: plex-show
      root: plex:685094
      medium: video
      category: course

    - label: Kids Courses
      source: plex-show
      root: plex:685095
      medium: video
      category: course

    - label: I Survived
      source: plex-album      # same adapter as Shakespeare — see §4
      root: plex:483195
      medium: audio
      category: listening

  # ---- Thresholds -------------------------------------------------------
  completion_threshold_percent: 90   # bar for `played`
  quiz_pass_percent: 80              # bar for a quiz gate (see §6)
```

### Config rules

- **`category` is required per source in practice but fail-closed in code.** An
  omitted or unknown `category` resolves to `reference` — no gate, no credit.
  Per the subsystem's convention 7, a config slip must make material *inert*,
  never accidentally pay coins and never silently lock a child out. Both failure
  directions are safe this way.
- **`sequential` moves from a Plex label to the category.** The old spec keyed it
  off a per-course Plex label copied from `piano.yml`. Labelling 16 Shakespeare
  albums by hand is busywork expressing a rule that holds for the whole source.
  A per-material Plex label remains supported as an *override*, for a source
  with mixed pedagogy.
- **Categories are open.** Adding one is a config entry plus a home section
  (§8) — not a code change.

---

## 4. Sources

A source adapter is a small module implementing one interface. It is the only
place that knows a Plex hierarchy.

```
MaterialSource {
  listMaterials(root)  ->  Material[]   // no units — for the catalog grid
  getMaterial(id)      ->  Material     // with units, ordered
}
```

| Adapter | Hierarchy | Material | Unit | Medium |
|---|---|---|---|---|
| `plex-show` | collection → show → season → episode | show | episode (`group` = season) | video |
| `plex-album` | artist → album → track | album | track (`group` = null) | audio |
| `readalong` | config list → entry | entry | section/chapter | text |

`plex-show` keeps consuming `FitnessPlayableService.getPlayableEpisodes(showId)`
— generic despite its folder, and already the source of ordering, watch state,
resume and transcoding. `plex-album` walks
`library/metadata/{id}/children` twice (artist → albums → tracks); verified
2026-07-22 against `619778`, which returns 16 albums, and `619862`, which
returns 5 ordered tracks carrying `index`, `title` and `duration`.

**Adding a medium is one adapter, not a rewrite.** Nothing downstream — lock
math, gates, progress, credit, UI shell — reads `source` or `medium` except to
choose a player chrome.

### Single-unit materials

Plex `483195` "I Survived" is an *artist* holding 19 *albums*, each holding
exactly **one ~68-minute track** (verified 2026-07-22 against `483214`). Same
hierarchy as Shakespeare, same adapter — the difference is arity, not shape.

This needs no special case, and that is the point:

- **Sequencing is vacuously true.** One unit means nothing follows it to lock.
  `sequential` stays harmless rather than wrong.
- **The gate lands at the end, not the middle.** Gates fire *between* units; with
  one unit there is nothing between. A bank linked to that unit becomes an
  end-of-book quiz, which is the correct and only available granularity for a
  single audio file.
- **`completion: [played, gate]` still reads naturally**: finish the book, pass
  the quiz.

Which category suits it is a config decision, not a code one — `listening` for
free enjoyment, `course` for credited work. That choice being a one-line edit is
the framework earning its keep.

**Forward compatibility, not built now.** If per-chapter gating of a single file
is ever wanted, the extension is virtual units: a source emits several `Unit`s
from one track, each carrying a time range, and everything downstream is
unchanged because it only ever sees ordered units. Deliberately deferred — it
requires hand-authoring timecodes for every book, and nothing today needs it.
Do not add `start`/`end` to `Unit` until a real case exists.

### Implementation gotcha: album duration is 0

Plex reports `duration: 0` on these album entries; only the *tracks* carry real
durations. A `plex-album` adapter must **sum its tracks' durations** rather than
trust the album's, or every material in the catalog renders as "0 min".

### Deferred, deliberately

`komga` / `files` adapters (R5) are **not** in this slice. The interface is
designed to accept them; building them belongs to the Reader sub-project, which
still has its own renderers to write (`PagedReader.jsx` and `FlowReader.jsx` are
both stubs today).

---

## 5. Gates

A gate is what must be satisfied before the next unit unlocks. It is pluggable
for the same reason sources are.

| `gate` | Satisfied by | Strength |
|---|---|---|
| `quiz` | A linked bank scored `>= quiz_pass_percent` | Comprehension |
| `readalong` | Reaching the end of a linked readalong | **Exposure only** |
| `none` | Nothing — units never lock | — |

### Quiz gates are discovered, not configured

A question bank carries an optional backlink, as the previous spec decided:

```yaml
id: hamlet-act-1-quiz
title: Hamlet — Act 1
unit: plex:619845          # the unit this quiz gates
audience: assigned
items: [...]
```

**Renamed `lecture:` → `unit:`** to match the generalised model. This is free —
courses were never built, so no bank in the data volume carries the old key.

`questionBankValidation.mjs` gains: `unit` optional; when present, a non-empty
string. No further validation — a bank does not know whether that Plex id
exists, and should not.

**A unit with no bank has no gate**, and this is not an error. It is the escape
hatch that keeps a material usable while its quizzes are still being written —
essential when Shakespeare alone implies 16 plays × ~5 acts ≈ 80 banks, authored
incrementally. Ship Hamlet with acts 1–2 quizzed and the rest ungated.

### Readalong gates are declared

Readalong material is not a file School owns, so there is no backlink to hang.
Declared on the source instead, as an entry gate applied before the first unit
of every material from it:

```yaml
    - label: Shakespeare Tales
      source: plex-album
      root: plex:619778
      medium: audio
      category: course
      entry_gate: { type: readalong, ref: 'talk:how-to-read-shakespeare' }
```

(`ref` above is **illustrative** — no such readalong exists yet. A real entry
gate names existing readalong content, e.g. a `scripture:` or `talk:` id the
`/api/v1/info/{path}` endpoint already resolves.)

This satisfies R10 ("inject a prerequisite before content unlocks — e.g. read a
scripture") and R10.2 (reuse the scroller, don't invent a parallel
presentation): the gate renders `ReadalongScroller`, which already handles
verses, paragraphs, poetry, optional video and ambient audio.

A per-unit readalong gate is **not** supported in this slice. The common case is
"read this before starting," and a per-unit form would require the mapping table
the quiz design explicitly rejected. Revisit only with a real case.

### A readalong gate is honestly weaker

`ContentScroller` auto-scrolls, so "reached the end" is close to the
presence signal R2.5 explicitly rejected for video — it proves a body was in the
room, not comprehension. It is still worth having; forced exposure is a real
pedagogical tool. But it must not be treated as equivalent to a quiz pass, which
is why **`credit` is a category decision and not implied by passing a gate.** A
category that gates on readalong alone and pays coins is expressible, and is a
choice made in the open rather than a property smuggled in by the gate type.

---

## 6. Progress, completion and credit

### Storage

`UserVideoProgressStore` is hardcoded to `data/users/{id}/apps/piano/` and
`getHouseholdAppConfig(null, 'piano')`. **Parameterise it by app name and
filename** rather than copying it — one store, two consumers, so a fix reaches
both. School writes `data/users/{id}/apps/school/material-progress.yml`.

An audio track's `playhead`/`percent`/`duration` is the same shape as a video's,
so no new store is needed for the audio case — only the video-flavoured *name*
was wrong.

**Piano's behaviour must be unchanged**: the app name defaults to `piano`, the
filename to `video-progress.yml`, and Piano's existing tests must pass
untouched. That is the completion gate for this task.

### Completion

`completion` is a list; every listed condition must hold.

| Value | Holds when |
|---|---|
| `played` | `percent >= completion_threshold_percent` |
| `gate` | The unit's gate is satisfied (or it has none) |

`[]` records no completion at all. `[played, gate]` is the `course` default and
preserves R2.5 exactly: watch percentage alone never completes a unit.

"Gate satisfied" for a quiz is derived by **folding the attempt log**, grouped by
`sessionId` — never stored as a separate flag. The log stays the source of
truth, so a reassignment of attempts (R6.5) moves the pass along with them
automatically.

### Locking

When the category is `sequential`, units are ordered by `index` and every unit
after the first **incomplete** one is locked: disabled, greyed, padlock overlay,
click is a no-op. The first incomplete unit is the current one.

**A locked unit always states why**, naming the gate to satisfy. A silent lock is
the real trap. Retakes are unlimited and the pass bar is 80 rather than 100 —
the three mitigations the previous spec identified for dead-end risk on an
unattended kiosk, all retained.

### Credit

`credit` is where R8 (economy) and R6 (curriculum) attach — the reason they are
config rather than code is that neither sub-project should have to modify the
materials framework when it lands.

- `credit.coins: true` → on unit completion, call the existing
  `EconomyService` earn path. Its per-ref replay guard and daily caps apply
  unchanged; no parallel currency logic (R8.2, non-goal 3).
- `credit.curriculum: true` → the completion is emitted as an attributable
  event eligible for curriculum progress. Until sub-project 4 exists, nothing
  consumes it; the event is still written, because R6.5 requires the evidence to
  exist before anything aggregates it.

---

## 7. What a child sees

Catalog grid (materials from the sources of one category) → material detail
(ordered units, lock state, why-locked message) → player.

Player chrome is chosen by `medium`, wrapping the shared Player from the
consumer side only. **`modules/Player` and `lib/Player` are never modified**
(non-goal 4) — School wraps, exactly as Piano and Fitness do.

| Medium | Chrome |
|---|---|
| `video` | Video player with forward-clamp when sequential |
| `audio` | Audio player: art, unit title, scrub, resume |
| `text` | `ReadalongScroller` |

On a unit ending, if a quiz gate exists, the chrome hands off to `QuizRunner`
— already built and shipped in slice 1. Skipping the quiz is allowed; the unit
stays incomplete, and in a sequential material the next unit stays locked. That
is the mastery rule doing its job, not an error state.

---

## 8. The School home

The gap that motivated this whole re-plan: **§5 of the requirements listed ten
sub-projects and none of them owned the surface they mount on.** Slice 1 shipped
and hardcoded `BankBrowser` as the entire body of `SchoolApp`, because there was
nowhere else to put it. Deleting the old Portal menu then stranded everything
else with no route in.

The home is a **section grid**. Sections come from two places:

1. **One per category present in config** — Courses, Reference, Listening. This
   is why category earns its keep twice: it decides both what material *does*
   and where a child *finds* it. Adding a category adds a section.
2. **Built-in sections** for non-material work — Quizzes & Flashcards (slice 1,
   already built), and later Games and Writing.

Decided (2026-07-21, this conversation): the home is a **tool menu now, worklist
later**. When curriculum (sub-project 4) lands, an "assigned to you" band appears
*above* the grid and the sections remain as free browse. This keeps the home
independent of the largest unbuilt sub-project instead of blocking on it.

Also decided: **Games means educational games only** — the typing tutor arcade
and drills. `routes.games` in `portal.yml`, which points at
`retroarch/launchable`, is vestigial from the menu-outside-School model and is
deleted.

And: **Music and Art come inside School; Ambient and Webcam stay screen-level.**
Music and Art are curricular — the staged collection is literally "Art Lessons",
and Plex carries Music Appreciation — so they enter as *sources*, appearing
within whichever category section their pedagogy implies (Art Lessons under
Courses; music-for-listening under Listening). They are deliberately **not**
their own top-level sections, because sections come from categories and a
per-subject section would reintroduce the subject-keyed menu this design
replaces. Ambient and Webcam are screen-level utilities reachable from the
TouchChrome lane — not schoolwork in a homeschool menu.

`SchoolApp` currently branches on `active?.mode`. It grows a section route above
that; `BankBrowser` becomes one section's body rather than the app's whole body.

---

## 9. Where it lives

| Layer | Path | Role |
|---|---|---|
| Domain | `2_domains/school/materialPolicy.mjs` | Pure: order units, first-incomplete, locked set, completion fold |
| Domain | `2_domains/school/categories.mjs` | Category resolution + fail-closed default |
| Adapter | `1_adapters/school/sources/PlexShowSource.mjs` | collection → show → season → episode |
| Adapter | `1_adapters/school/sources/PlexAlbumSource.mjs` | artist → album → track |
| Adapter | `1_adapters/school/sources/ReadalongSource.mjs` | config list → entry |
| Application | `3_applications/school/GetMaterialCatalog.mjs` | Catalog grid for a category |
| Application | `3_applications/school/GetMaterialUnits.mjs` | Units + per-user progress + lock state |
| Application | `3_applications/piano/UserVideoProgressStore.mjs` | **Modified**: app + filename parameterised |
| API | `4_api/v1/routers/school.mjs` | `GET /materials?category=`, `GET /materials/:id/units?userId=` |
| Frontend | `modules/School/materials/MaterialGrid.jsx` | Catalog tiles per source |
| Frontend | `modules/School/materials/MaterialDetail.jsx` | Units, lock/current rendering, why-locked |
| Frontend | `modules/School/materials/players/` | One chrome per medium |
| Frontend | `modules/School/home/SectionGrid.jsx` | The home (§8) |

---

## 10. Re-planned decomposition

Replaces §5 of the requirements doc.

| # | Sub-project | Size | Depends on | Status |
|---|---|---|---|---|
| 1 | Identity + quiz/flashcard engine | L | — | **Built and deployed** |
| 2a | **School home shell** (§8) | S | 1 | Next — unblocks the panel |
| 2b | **Materials framework** (§2–§7) | L | 1, 2a | The core of this spec |
| 3 | Reader (paged + flow) — adds `komga`/`files` sources | S–M | 2b *(renderers: none)* | `PagedReader.jsx`/`FlowReader.jsx` are stubs and can be built any time; only wiring reading in **as material** needs 2b |
| 4 | Curriculum / assignments | L | 2b | Consumes `credit.curriculum` events |
| 5 | Parent view + sign-off + reassignment | M | 4 | — |
| 6 | Economy hooks | S | 2b | Consumes `credit.coins` |
| 8 | Android launch touch affordances (R11.4) | XS | — | Independent; do any time |
| 9 | Writing assignments (TipTap) | M | 1, 2a | Spec exists |
| 10 | Typing tutor (drill + arcade) | M | 1, 2a | Spec exists; this is "Games" |
| ~~7~~ | ~~Content gates~~ | — | — | **Absorbed into 2b** as `gate: readalong` |
| ~~R9~~ | ~~Freestyle content~~ | — | — | **Absorbed into 2b** as a category |

**Why 2a before 2b.** The home is small and unblocks a panel that is currently a
dead end — the only interactive elements on `/screens/portal` today are one
bank's Quiz/Cards buttons and a chrome Back that returns to a screen the child
is already on. It also gives 2b, 9 and 10 a real surface to mount into rather
than each inventing one.

**Shakespeare is 2b's proving ground, not a follow-on.** Building the framework
against video alone would reproduce the exact assumption this re-plan exists to
remove. The audio case must work in the same slice, or the abstraction is
unverified.

---

## 11. Open questions

- **OPEN-A — Bank authoring at volume.** Shakespeare implies ~80 banks. The
  ungated-by-default escape hatch (§5) makes incremental authoring safe, but
  whether to assist generation — there is a `POST /api/v1/ai/transcribe`
  endpoint and the tracks are narrated audio — is undecided and out of scope
  here.
- **OPEN-B — Per-unit readalong gates.** Deferred (§5). Revisit with a real case.
- **OPEN-3, OPEN-7, OPEN-9, OPEN-10** from the requirements doc are unchanged
  and still open.

---

## 12. Non-goals

- Editing `modules/Player` or `lib/Player`. School wraps from the consumer side.
- A parallel currency, progress or content-adapter system where one exists.
- Emulator/arcade games in School (§8).
- Migrating Piano to this framework. Piano's course code stays as it is; the
  only shared file touched is `UserVideoProgressStore`, whose existing behaviour
  is preserved by default.
