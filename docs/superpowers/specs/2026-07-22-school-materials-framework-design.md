# School — Materials Framework (re-plan of sub-project 2)

**Status:** Design spec, revised after adversarial review. Supersedes
`2026-07-21-school-courses-design.md`.
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
  title        // 'Hamlet 1: The Ghost of the King'
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

## 3. Categories are closed; config selects, it does not assemble

**Revised after review.** An earlier draft let `school.yml` assemble categories
from free-form knobs (`sequential`, `gate`, `completion`, `credit`). That was
wrong on two counts: the knobs are not orthogonal, and roughly half the
expressible combinations are broken. The clearest failure: `sequential: true`
with a `completion` that can never be satisfied locks every unit after the first
**forever**, on an unattended kiosk, silently.

Pedagogy is therefore a **closed set defined in code**, in
`2_domains/school/categories.mjs`:

```javascript
export const CATEGORIES = {
  // Sequenced, gated, credited. Shakespeare Tales, Art Lessons.
  course: {
    sequential: true,
    gated: true,                      // an unsatisfied gate locks the next unit
    completion: ['played', 'gate'],   // ALL listed conditions must hold
    credit: { coins: true, curriculum: true }
  },
  // Look-it-up material. Cliff notes. Resume works; nothing is recorded.
  reference: {
    sequential: false,
    gated: false,
    completion: [],
    credit: { coins: false, curriculum: false }
  },
  // Freestyle listening (retires R9). Records "finished", earns nothing.
  listening: {
    sequential: false,
    gated: false,
    completion: ['played'],
    credit: { coins: false, curriculum: false }
  }
};
```

This is deliberately *less* configurable than the first draft, and costs nothing
real. The configurability that matters — which Plex roots are material, what
medium, which pedagogy each gets, and the pass marks — is all still config. Only
*inventing a new pedagogy shape* is now a code change, and there are three,
all stable. A fourth gets promoted when there is a real case to design against.

It also removes an entire class of failure rather than validating against it: a
broken combination becomes **inexpressible** instead of rejected, so there is no
validator to keep correct and no "config is incoherent" boot path to design for
a panel with no keyboard.

### Config

Replaces the `courses:` block in `data/household/config/school.yml`.

```yaml
materials:
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

  # Scalars stay tunable. Neither can produce a locked-forever material:
  # a badly-chosen value is annoying and recoverable, not silent and permanent.
  completion_threshold_percent: 90   # bar for `played`
  quiz_pass_percent: 80              # bar for a quiz step (see §5)
```

### Fail-closed, but loudly

An omitted or unrecognised `category` resolves to `reference` — no gate, no
credit. A config slip makes material *inert*: it never pays coins and never
locks a child out, which are the two failure directions that matter.

**It must also log a warning at config load naming the source and the
unrecognised value.** Silent fallback would violate this subsystem's convention
6 ("Failures are never silent") and is a genuinely expensive failure: a typo'd
`category: coures` serves a whole course ungated and uncredited, and the quiz
evidence never collected cannot be reconstructed when the typo is found weeks
later. The precedent is `questionBankValidation.mjs`, which fails loudly with an
errors list.

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

`plex-album` walks `library/metadata/{id}/children` twice (artist → albums →
tracks); verified 2026-07-22 against `619778`, which returns 16 albums, and
`619862`, which returns 5 ordered tracks carrying `index`, `title` and
`duration`.

### `plex-show` reuses `getPlayableEpisodes` — but discards its watch fields

`FitnessPlayableService.getPlayableEpisodes(showId)` exists
(`FitnessPlayableService.mjs:47`) and is show-agnostic, and School reuses it for
**ordering, episode metadata, resume points and transcoding**.

**School must ignore its `isWatched` / watch-state output entirely.** That field
mixes a fitness-specific classifier with Plex's `viewCount`
(`FitnessPlayableService.mjs:169–181`), and Plex watch state is per *account*,
not per child — one child finishing an episode would flag it watched for every
child in the household. Piano already avoids this by layering per-user `enrich()`
on top and ignoring the global fields for per-user decisions; School does the
same. Per-child state comes only from the progress store (§6).

The previous draft described this service as giving "ordering, watch state,
resume," which would have walked an implementer straight into cross-child
contamination.

### Single-unit materials

Plex `483195` "I Survived" is an *artist* holding 19 *albums*, each holding
exactly **one ~68-minute track** (verified 2026-07-22 against `483214`). Same
hierarchy as Shakespeare, same adapter — the difference is arity, not shape.

This needs no special case, and that is the point:

- **Sequencing is vacuously true.** One unit means nothing follows it to lock.
- **The gate lands at the end, not the middle.** Gates fire *between* units; with
  one unit there is nothing between. A bank linked to that unit becomes an
  end-of-book quiz, which is the correct and only available granularity for a
  single audio file.
- **`completion: ['played','gate']` still reads naturally**: finish the book,
  pass the quiz.

Which category suits it is a config decision, not a code one.

**Forward compatibility, not built now.** If per-chapter gating of a single file
is ever wanted, the extension is virtual units: a source emits several `Unit`s
from one track, each carrying a time range, and everything downstream is
unchanged because it only ever sees ordered units. Deliberately deferred — it
requires hand-authoring timecodes for every book, and nothing today needs it.
Do not add `start`/`end` to `Unit` until a real case exists.

### Implementation gotcha: albums carry no duration

The album entries under `619778` carry **no `duration` attribute at all**
(verified 2026-07-22); only their tracks do. A `plex-album` adapter must **sum
its tracks' durations** rather than read the album's, or every material in the
catalog renders as "0 min".

### Deferred, deliberately

`komga` / `files` adapters (R5) are **not** in this slice. The interface is
designed to accept them; building them belongs to the Reader sub-project, which
still has its own renderers to write (`PagedReader.jsx` and `FlowReader.jsx` are
both stubs today).

---

## 5. Gates

A gate is what must be satisfied before the next unit unlocks. **Whether a
category gates at all** is the category's `gated` flag (§3). **What the gate
consists of** is declared per unit, by its bank.

### A gate is a sequence of steps, not a type

An earlier draft made `readalong` and `quiz` alternative gate *types*. That was
a category error: a readalong is a **presentation** step, a quiz is an
**assessment** step. They compose.

```
[]                  no bank for this unit → no gate (see below)
[quiz]              answer questions
[readalong]         read it — exposure only, see the caveat below
[readalong, quiz]   read it, then prove you understood it
```

### Steps are declared in the bank

The bank already backlinks to the unit it gates. It gains one more optional
field, so a single authored file per unit carries both the reading and the
assessment:

```yaml
id: hamlet-act-1-quiz
title: Hamlet — Act 1
unit: plex:619845          # the unit this gates
readalong: talk:...        # OPTIONAL — read this before the questions
audience: assigned
items: [...]
```

Steps are derived, not configured: `readalong` present → a readalong step;
`items` non-empty → a quiz step. Both → both, in that order. This keeps gate
composition entirely data-driven per unit and out of the category table, which
is what stops the combinatorics from coming back.

**Renamed `lecture:` → `unit:`** to match the generalised model. Verified free:
the data volume holds one bank (`us-state-capitals.yml`) and it carries no
`lecture:` key.

### Validation must also *return* the new fields

`questionBankValidation.mjs` ends by returning a **whitelist**:
`{ id, title, audience, topics, items }` (line 82). Adding `unit` and
`readalong` to the validation rules is necessary but **not sufficient** — they
must also be added to the returned bank, or gate discovery reads fields that
were validated and then silently thrown away.

Rules: `unit` and `readalong` optional; when present, non-empty strings. No
further validation — a bank does not know whether that Plex id or readalong path
resolves, and should not.

### A unit with no bank has no gate

Not an error. It is the escape hatch that keeps a material usable while its
quizzes are still being written — essential when Shakespeare alone implies 16
plays × ~5 acts ≈ 80 banks, authored incrementally. Ship Hamlet with acts 1–2
quizzed and the rest ungated.

### Readalong steps: two hard constraints

**1. A readalong step proves exposure, not comprehension.** `ContentScroller`
derives scroll position from the main media element's clock
(`ContentScroller.jsx:150–154`, fed from `mainEl.currentTime` at :225), so
"reached the end" is close to the presence signal R2.5 explicitly rejected for
video. It is still worth having — forced exposure is a real pedagogical tool,
and R10 asks for exactly it — but `[readalong]` alone must not be treated as
equivalent to a quiz pass. This is precisely why the user-facing composition
`[readalong, quiz]` exists: it upgrades exposure to comprehension.

**2. A text-only readalong has no end signal, and would lock the unit forever.**
Verified: the only completion signal is `handleEnded`, fired by the media
element's `onEnded` (`ContentScroller.jsx:325–327, 418, 469`). The
`useEndOfContentWatchdog` fallback at :333–338 is `enabled: !!isVideo` and keyed
to `mediaRef`, so it is a stuck-DASH watchdog, **not** a no-media fallback. With
no main media there is no clock, no scroll, and no `ended`.

Therefore: **a readalong step with no main media is satisfied by an explicit
"Done reading" tap.** Weaker still, and deliberately visible as such. A readalong
step that carries narration keeps the `ended` signal. An implementation that
assumes `ended` will always arrive produces exactly the permanently-locked
material this design elsewhere works hard to prevent.

### Gate satisfaction is derived where it can be, stored where it cannot

- **Quiz steps** are derived by folding the attempt log, grouped by `sessionId`
  — never stored as a flag. The log stays the source of truth, so reassigning
  attempts (R6.5) moves the pass with them automatically.
- **Readalong steps** have no attempt log, so satisfaction is a recorded event:
  per child, per unit, once, written alongside unit progress (§6) and carrying
  `attributedTo` like every other School record, so it is reassignable too.

---

## 6. Progress, completion and credit

### Storage — and what the existing store does *not* give us

**Corrected after review.** An earlier draft claimed "only the video-flavoured
*name* was wrong" about `UserVideoProgressStore`. That is false. The store bakes
in Piano's completion **policy**, not just its naming:

| Piano-specific behaviour | Where |
|---|---|
| Path hardcoded to `apps/piano` | `UserVideoProgressStore.mjs:27` |
| Filename hardcoded to `video-progress` | `:~55` (`loadYaml(path.join(dir,'video-progress'))`) |
| Threshold read from `getHouseholdAppConfig(null,'piano').videos.completion_threshold_percent` | `:31–32` |
| `completedAt` stamped only when `percent >= threshold && engaged` | `:59–62` |
| `userWatched` / `summarize()` recompute that same engaged-AND-threshold rule | `:105`, `:137` |

School has no `engaged` signal — R2.5 replaced it with comprehension
deliberately. So if School consumed this store's completion machinery as-is:
`completedAt` would **never** stamp, `userWatched` would be **permanently
false**, and the threshold lookup would resolve `school.yml → videos.…`, which
does not exist, silently falling back to a hardcoded 90.

**Decision: School uses this store as a dumb playhead/percent store only.**

- Parameterise **app name and filename**. School writes
  `data/users/{id}/apps/school/material-progress.yml`.
- School reads only `playhead`, `percent`, `duration`, `lastPlayed`.
- **`completedAt`, `engaged`, `userWatched` and `summarize()` are INERT for
  School** and must not be read. All School completion is computed in
  `2_domains/school/materialPolicy.mjs` from percent + gate state.

An audio track's playhead/percent/duration is the same shape as a video's, so no
new store is needed for the audio case — but the completion *rule* was never
reusable, and pretending otherwise was the single riskiest error in the previous
draft.

**Piano's behaviour must be unchanged**: app name defaults to `piano`, filename
to `video-progress.yml`, and Piano's existing tests must pass untouched. That is
a necessary completion gate for this task but not a sufficient one — it does not
catch School accidentally consuming the piano-flavoured `userWatched`. Add a
test asserting School's policy ignores it.

### Completion

`completion` is a list; every listed condition must hold.

| Value | Holds when |
|---|---|
| `played` | `percent >= completion_threshold_percent` |
| `gate` | Every gate step for the unit is satisfied (or it has none) |

`[]` records no completion at all. `['played','gate']` is `course` and preserves
R2.5 exactly: watch percentage alone never completes a unit.

### Locking

When the category is `sequential`, units are ordered by `index` and every unit
after the first **incomplete** one is locked: disabled, greyed, padlock overlay,
click is a no-op. The first incomplete unit is the current one.

**A locked unit always states why**, naming the step to satisfy. A silent lock is
the real trap. Retakes are unlimited and the pass bar is 80 rather than 100 —
the three mitigations the previous spec identified for dead-end risk on an
unattended kiosk, all retained.

### Credit

`credit` is where R8 (economy) and R6 (curriculum) attach.

- `credit.coins` → on unit completion, call the existing `EconomyService` earn
  path. Its per-ref replay guard and daily caps apply unchanged; no parallel
  currency logic (R8.2, non-goal 3).
- `credit.curriculum` → the completion is emitted as an attributable event.
  Until sub-project 4 exists nothing consumes it; the event is still written,
  because R6.5 requires the evidence to exist before anything aggregates it.

**Unresolved tension, see OPEN-C.** Quiz passes are *derived* from the attempt
log so reassignment moves them automatically — but a curriculum completion event
is *written* at completion time and does not move when the underlying attempts
are reassigned. This is the same class of problem OPEN-9 already tracks for
coins.

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

On a unit ending, if a gate exists, the chrome runs its steps in order —
`ReadalongScroller` then `QuizRunner`, either or both. `QuizRunner` is already
built and shipped in slice 1. Skipping is allowed; the unit stays incomplete,
and in a sequential material the next unit stays locked. That is the mastery
rule doing its job, not an error state.

---

## 8. The School home

The gap that motivated this whole re-plan: **§5 of the requirements listed ten
sub-projects and none of them owned the surface they mount on.** Slice 1 shipped
and hardcoded `BankBrowser` as the entire body of `SchoolApp`
(`SchoolApp.jsx:107`, branching on `active?.mode` at :108–109), because there was
nowhere else to put it. Deleting the old Portal menu then stranded everything
else with no route in.

The home is a **section grid**. Sections come from two places:

1. **One per category present in config** — Courses, Reference, Listening.
2. **Built-in sections** for non-material work — Quizzes & Flashcards (slice 1,
   already built), and later Games and Writing.

**Scope of 2a before 2b lands.** Category sections read material endpoints that
do not exist until 2b. 2a therefore ships the **built-in sections only**, with
category sections appearing as 2b delivers them. 2a must not render tiles
pointing at absent endpoints.

Decided (2026-07-21): the home is a **tool menu now, worklist later**. When
curriculum (sub-project 4) lands, an "assigned to you" band appears *above* the
grid and the sections remain as free browse. This keeps the home independent of
the largest unbuilt sub-project instead of blocking on it.

Also decided: **Games means educational games only** — the typing tutor arcade
and drills. `routes.games` in `portal.yml`, which points at
`retroarch/launchable`, is vestigial from the menu-outside-School model and is
deleted.

And: **Music and Art come inside School; Ambient and Webcam stay screen-level.**
Music and Art are curricular — the staged collection is literally "Art Lessons",
and Plex carries Music Appreciation — so they enter as *sources*, appearing
within whichever category section their pedagogy implies. They are deliberately
**not** their own top-level sections, because sections come from categories and
a per-subject section would reintroduce the subject-keyed menu this design
replaces. Ambient and Webcam are screen-level utilities reachable from the
TouchChrome lane — not schoolwork in a homeschool menu.

---

## 9. Where it lives

**Corrected after review.** Source adapters consume
`FitnessPlayableService`, a concrete `3_applications` service.
`docs/reference/core/layers-of-abstraction/ddd-reference.md:45` permits
`1_adapters → 3_applications` **ports only**, so sources cannot live in
`1_adapters`. They live in the application layer, matching the existing
precedent where Piano consumes the service via injection.

| Layer | Path | Role |
|---|---|---|
| Domain | `2_domains/school/materialPolicy.mjs` | Pure: order units, first-incomplete, locked set, completion fold |
| Domain | `2_domains/school/categories.mjs` | The closed category table + fail-closed resolution |
| Application | `3_applications/school/sources/PlexShowSource.mjs` | collection → show → season → episode |
| Application | `3_applications/school/sources/PlexAlbumSource.mjs` | artist → album → track |
| Application | `3_applications/school/sources/ReadalongSource.mjs` | config list → entry |
| Application | `3_applications/school/GetMaterialCatalog.mjs` | Catalog grid for a category |
| Application | `3_applications/school/GetMaterialUnits.mjs` | Units + per-user progress + lock state |
| Application | `3_applications/piano/UserVideoProgressStore.mjs` | **Modified**: app + filename parameterised (§6) |
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
| ~~7~~ | ~~Content gates~~ | — | — | **Absorbed into 2b** as a `readalong` gate step |
| ~~R9~~ | ~~Freestyle content~~ | — | — | **Absorbed into 2b** as the `listening` category |

**Why 2a before 2b.** The home is small and unblocks a panel that is currently a
dead end — the only interactive elements on `/screens/portal` today are one
bank's Quiz/Cards buttons and a chrome Back that returns to the screen the child
is already on. It also gives 2b, 9 and 10 a real surface to mount into.

**Shakespeare is 2b's proving ground, not a follow-on.** Building the framework
against video alone would reproduce the exact assumption this re-plan exists to
remove. The audio case must work in the same slice, or the abstraction is
unverified.

---

## 11. Open questions

- **OPEN-A — Bank authoring at volume.** Shakespeare implies ~80 banks. The
  ungated-by-default escape hatch (§5) makes incremental authoring safe, but
  whether to assist generation — there is a `POST /api/v1/ai/transcribe`
  endpoint and the tracks are narrated audio — is undecided and out of scope.
- **OPEN-B — Per-chapter gating of single-file material.** Deferred (§4).
  Revisit with a real case.
- **OPEN-C — Reassignment and written completion events.** Quiz passes are
  derived and move automatically; `credit.curriculum` completion events are
  written and do not. Either the event carries enough provenance to be
  re-derived or invalidated, or reassignment must move it too. Same class as
  OPEN-9 (coins). Decide before sub-project 4.
- **OPEN-3, OPEN-7, OPEN-9, OPEN-10** from the requirements doc are unchanged.

---

## 12. Non-goals

- Editing `modules/Player` or `lib/Player`. School wraps from the consumer side.
- A parallel currency, progress or content-adapter system where one exists.
- Emulator/arcade games in School (§8).
- Migrating Piano to this framework. Piano's course code stays as it is.

**Named honestly:** this leaves Piano's lock math ("linear scan, first
unwatched") and School's `materialPolicy.mjs` ("linear scan, first incomplete")
as near-duplicate pure functions in perpetuity, and `UserVideoProgressStore` is
the only file both touch. That duplication is accepted: the completion semantics
genuinely differ (engaged-and-watched vs gate-satisfied), and coupling a live,
historically fragile kiosk to a new framework to save ~50 lines of pure policy is
a bad trade. Convention 3 survives — neither module imports from the other's
tree.

---

## 13. Upstream correction

`2026-07-21-portal-homeschool-requirements.md` §4 states that
`UserVideoProgressStore` stores at `data/users/{id}/apps/{app}/video-progress.yml`
and that "the app segment is a parameter." **It is not** — `apps/piano` is
hardcoded at `UserVideoProgressStore.mjs:27`, as is the filename. That row
should be corrected when the requirements doc is next touched, so the two
documents stop disagreeing.
