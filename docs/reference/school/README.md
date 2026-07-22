# School (Portal Homeschool) — Reference

> **Status:** Sub-project 1 is built and deployed. Everything else is **specced
> only — no implementation exists.** Each section below says which it is.
>
> **Requirements (the whole programme):** [`docs/superpowers/specs/2026-07-21-portal-homeschool-requirements.md`](../../superpowers/specs/2026-07-21-portal-homeschool-requirements.md)
>
> **Roadmap (candidate future work, categorized):** [`docs/roadmap/2026-07-21-school-module-roadmap.md`](../../roadmap/2026-07-21-school-module-roadmap.md)
>
> This is the durable map of the School subsystem: what runs today, what is
> designed but unbuilt, and the decisions behind both.

---

## 1. What School is

The Portal — a repurposed Facebook Portal panel, touch-only, running FullyKiosk
— **is** the school device, the way the living-room screen is the TV. Its
screen renders the School app as its whole surface rather than a menu
containing a School entry.

A child claims a profile, works through material, and that work is recorded
against them. The household **is** the school: the roster is the full household
membership from `data/users/{id}/profile.yml`, not a separate list.

---

## 2. Built and deployed

### Identity

A **soft, self-declared tap** — no PIN, no authentication. A child taps their
face to claim the device; identity is visible in the chrome and lapses after 10
minutes idle. Guest is session-only and never persisted.

Deliberately soft because mis-attribution is **repairable** rather than
prevented: a parent can reallocate credit later. That is also why every record
below is an individually attributable event, not a rollup — a rolled-up counter
cannot be split or reassigned after the fact.

Shared identity elements live in `frontend/src/lib/identity/`, extracted out of
the Piano Kiosk. **A module is not an export surface for other modules:** School
never imports from `modules/Piano/`; both import from the shared home.

### Quizzes and flashcards

One canonical question-bank format at `data/content/quizzes/*.yml`. `type`
describes how an item is **graded**; mode describes how it is **presented** —
so one bank serves both a quiz and a flashcard drill without duplicating
content.

Four item types: `multiple_choice`, `short_answer`, `cloze`, `matching`.

- **Grading is server-side**, for single-source logic rather than secrecy.
  Banks ship with their answers because flashcards must reveal them; this is
  explicitly not a security boundary.
- **A quiz is one pass** — each item asked once, then a score. Resurfacing
  would converge every score to 100% and destroy the completion signal courses
  depend on.
- **A flashcard drill resurfaces** missed cards until they are got. Drilling
  and assessment are different jobs.
- Short-answer matching is deliberately conservative: trim, collapse
  whitespace, casefold, nothing more. "St. Paul" vs "St Paul" is an explicit
  `accept` entry's job, not a clever matcher's.
- **Matching is all-or-nothing**, checked as a true bijection — unique lefts
  covering exactly the item's lefts. (An earlier count-based check let one
  correct pair repeated N times grade as fully correct.)

### The attempt log

`data/users/{userId}/apps/school/attempts/{YYYY-MM-DD}.yml` — append-only,
date-sharded, mirroring the economy ledger. Every answer is one event carrying
`attributedTo`.

Rollups are **derived, never stored**. The log is the source of truth, so a
later reassignment moves the evidence and the statistics together.

Quiz and flashcard tallies are **never merged**: one is server-graded evidence,
the other a self-report.

A guest grades normally and records nothing.

### Where it lives

| Layer | Path |
|---|---|
| Domain (pure) | `backend/src/2_domains/school/` — bank validation, grading, attempt factory |
| Persistence | `backend/src/1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` |
| Application | `backend/src/3_applications/school/SchoolService.mjs` — sessions, guest rule, mode contract, results fold |
| API | `backend/src/4_api/v1/routers/school.mjs` → `/api/v1/school` |
| Frontend | `frontend/src/modules/School/` |
| Shared identity | `frontend/src/lib/identity/` |
| Screen | `data/household/screens/portal.yml` → `widget: school` |
| Config | `data/household/config/school.yml` |

Sessions are **in memory by design**. A restart costs the rest of one sitting,
never a recorded attempt — those are already on disk.

**Design spec:** [`2026-07-21-school-identity-quiz-design.md`](../../superpowers/specs/2026-07-21-school-identity-quiz-design.md)

### The home shell

School's landing surface is a **section grid** — the app owns its own top-level
navigation. Sections come from two places: built-ins (Quizzes & Flashcards
today; Games and Writing when their sub-projects land) and, once the materials
framework ships, one section per material category. A tile never points at an
absent endpoint.

Back steps one navigation level: runner → bank list → home → exit. The exit
control only exists when School is mounted as an app; on the Portal, where
School is the screen, home is the root and no exit affordance renders.

**Design spec:** [`2026-07-22-school-materials-framework-design.md`](../../superpowers/specs/2026-07-22-school-materials-framework-design.md) §8

### The materials framework

Plex-backed material — video courses, audio plays, freestyle audiobooks — is
normalised into one model: a **material** with ordered **units**. Where content
lives is a *source* (`plex-show` for collection→show→season→episode, `plex-album`
for artist→album→track); how it behaves is a *category* (`course` sequenced,
quiz-gated, credited; `reference` free browse; `listening` records "finished",
earns nothing). Categories are a **closed set in code**; config only selects one
per source, and an unknown name fails closed to `reference` with a loud warning.

A quiz bank gains an optional `unit:` backlink to the Plex item it gates. Within
a sequential material, every unit after the first incomplete one is locked, and
a locked unit always names what to do (`Pass the quiz for “…” first`). A unit
with no bank has no gate — the escape hatch that lets quizzes be authored
incrementally. Completion is comprehension-based: `played` (≥ the configured
percent) AND the gate, derived fresh on every read from the progress store and
the attempt log — never stored as a flag, so reassignment keeps working.

Per-child playhead/percent lives at
`data/users/{id}/apps/school/material-progress.yml` via the shared progress
store (parameterised, Piano untouched); School reads raw playhead/percent only
and computes its own completion. The home grid grows one section per category
present in config; grid → detail → player, with the player wrapping the shared
Player from the consumer side and handing off to the quiz on unit end.

**Explicitly not built** (named deferrals, not gaps): the video forward-clamp
(the quiz gate is the enforcement; clamp is anti-skip UX), the readalong source
and readalong gate-step UI (banks may carry `readalong:` — validated and
preserved — but no configured content uses it; a gate runner meeting one treats
it as unsatisfied and warns), and coin/curriculum *consumption* of completion
(sub-projects 4 and 6 read what this framework records).

**Config:** `data/household/config/school.yml` `materials:` block — sources
(label, source, root, medium, category) plus `completion_threshold_percent` and
`quiz_pass_percent`. Boot-cached; config edits need a container restart.

---

## 3. Specced, not built

No code exists for anything in this section. Each links its spec.

| Sub-project | Spec | Shape |
|---|---|---|
| **Writing assignments** | [`2026-07-21-school-writing-assignments-design.md`](../../superpowers/specs/2026-07-21-school-writing-assignments-design.md) | TipTap, light rich text, no spell check. Bluetooth keyboard |
| **Typing tutor** | [`2026-07-21-school-typing-tutor-design.md`](../../superpowers/specs/2026-07-21-school-typing-tutor-design.md) | Drill (curriculum) + arcade, modelled on `PianoSpaceInvaders`' pure-engine split. No npm dependency |
| Curriculum / assignments | — | Not yet designed |
| Parent view, sign-off, reassignment UI | — | Not yet designed. **The reassignment UI is unbuilt**; today's storage makes it *possible*, nothing performs it |
| Reading (PDF / EPUB) | — | Not yet designed. Adapters exist; the two renderers are stubs |

### Decisions already made in those specs

- **Course completion is comprehension-based** — a post-video quiz, not
  watch-percentage plus presence. An attention check only proves a body was in
  the room. This is why quizzes were built before courses: they are a
  *dependency* of course completion, not a follow-on.
- **Sequential courses lock on the first *incomplete* lecture**, and incomplete
  includes "quiz not passed" — so watching fully but failing does not advance
  you. Piano locks on the first *unwatched*; this is stricter on purpose.
- That mastery rule carries a **dead-end risk** on an unattended kiosk, so
  three mitigations ship with it: unlimited retakes, a pass bar of 80 rather
  than 100, and a lock that always names the quiz to retake. A silent lock is
  the real trap.
- **Learning log and writing submissions join the same attributable record** as
  quiz attempts, so a parent's reassignment moves a whole sitting together.
  Writing drafts are the one mutable store — a draft is edited by nature; the
  submission is the event.
- **No second gate anywhere.** Only sequential courses lock. The learning log,
  writing word-counts and typing lessons are all explicitly ungated.

---

## 4. Conventions this subsystem holds to

1. **Per-child records are append-only events with `attributedTo`.** Anything
   a parent might need to reassign must survive as individual evidence.
2. **Rollups are derived, never stored.**
3. **A module is not an export surface for other modules.** Shared code moves
   to a shared home and every consumer imports from there, including the module
   it came from.
4. **The shared Player is never modified.** School chrome wraps it from the
   consumer side, exactly as Piano and Fitness do.
5. **Guests do not produce records.** No identity means no attribution, so the
   affordance is absent rather than failing on submit.
6. **Failures are never silent.** An unrecorded answer, an unsaved draft, a
   failed transcript — each surfaces at the moment it happens. Silence is what
   makes a progress record untrustworthy.
7. **Config is fail-closed.** `audience` defaults to `assigned`, so an omission
   never exposes material to a guest.

---

## 5. Gotchas

- **`data/household/config/school.yml`'s `materials:` block is live config** —
  the materials framework reads it at boot. The old staged `courses:` block is
  retired. A missing `materials:` block degrades to an empty catalog with a
  single logged warning, never a 500.
- Piano's `completion_threshold_percent` / `engagement_timeout_seconds` are
  deliberately **absent** from that file. Copying them would silently
  reinstate the watch-plus-presence completion model that School rejected.
- The old Portal menu list was deleted; the School home grid is the panel's
  navigation now. Music and Art return as material *sources* when the
  materials framework lands (they are curricular; they get no top-level
  section of their own). Ambient and Webcam are screen-level utilities for
  the TouchChrome lane, not School sections — still unwired.
- Screen-framework features survive the single-widget layout — the doorbell
  subscription, PiP, casting, software volume and `portalKeys` are all
  screen-level. Casting in particular works because `ScreenActionHandler`
  mounts content via `showOverlay()` and does not need a menu widget present.
- `Fitness/player/panels/hooks/useVoiceMemoRecorder.js` is a second
  MediaRecorder implementation that predates and ignores
  `modules/VoiceCapture/`. Pre-existing debt; School uses the shared module and
  adds no new fragmentation.
