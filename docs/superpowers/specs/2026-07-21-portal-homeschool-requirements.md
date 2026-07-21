# Portal Homeschool Platform — Requirements

**Status:** Requirements capture. Not a design spec.
**Date:** 2026-07-21

This document captures the full scope of the Portal homeschool/education
platform. It is deliberately broader than any one implementation plan: each
numbered sub-project below gets its own spec → plan → build cycle, and each
should reference this document rather than restating scope.

Nothing here is a commitment to build. Sections marked **OPEN** are decisions
not yet made.

---

## 1. Context

The Portal is a repurposed Facebook Portal panel (touch-only, no remote, no
keyboard) running FullyKiosk. It already runs on the screen framework with a
touch menu and a persistent on-screen control lane (`TouchChrome`), because
kiosk mode suppresses Android's Back button and a touch user would otherwise be
stranded once content opens.

The intent is to grow it into an **education / homeschool device**: a surface
where a child identifies themselves, works through assigned material, and has
that work recorded.

Secondary framing from the original request, retained but not scoped: desktop
assistant, ambient/audio playback, cast target from MediaApp (already working).

---

## 2. Vision

A child walks up to the Portal, indicates who they are, and sees what they are
meant to do. They can watch course videos, take quizzes, drill flashcards, and
read assigned books or documents. Their progress is recorded per-child. A
parent can review that progress and sign off on work. Completing schoolwork can
pay into the existing household coin economy.

Alongside assigned work there is a freestyle mode — audiobooks and reading with
no curriculum attached.

---

## 3. Requirements

### R1 — User profiles / identity

- R1.1 The device must know **which family member is currently using it**.
- R1.2 Identity drives everything downstream: progress, curriculum, gates,
  sign-off, and economy credit are all per-child.
- R1.3 Roster must be config-driven, consistent with how other household apps
  define their rosters.
- R1.4 Selection should be remembered between visits, and must be able to
  lapse — a stale identity that silently credits the wrong child is worse than
  no identity.
- R1.5 Conceptually similar to the Piano Kiosk's "who is playing" flow, but
  with a materially different role: in Piano identity is soft attribution for
  watch credit; here it is the spine of the entire application.

### R2 — Video courses

- R2.1 Children watch video courses on the Portal.
- R2.2 Needs a **school-specific player chrome** wrapping the core Player —
  comparable to `PianoVideoPlayer` or `FitnessPlayer`, which both wrap the
  shared Player with their own surrounding UI.
- R2.3 Chrome features are **OPEN**: candidates include pause behaviour,
  overlays, progress display, and resume affordances.
- R2.4 Progress must resume where the child left off.
- R2.5 Completion must be resistant to a child parking a video and walking
  away. See **OPEN-1**.

### R3 — Quizzes

- R3.1 Benchmark is Quizlet, not a game show.
- R3.2 Must support multiple question types. Named so far: multiple choice,
  matching. Likely also short answer and cloze/fill-in.
- R3.3 Question banks must be authorable as plain data files in the data
  volume, hand-writable without touching code.
- R3.4 Quiz results feed per-child progress.

### R4 — Flashcards

- R4.1 Standard flashcard drilling, same content domain as quizzes.
- R4.2 Shares a question/item bank with quizzes where sensible.
- R4.3 Whether flashcards use spaced repetition is **OPEN**.

### R5 — Reading

- R5.1 Support both **PDF** and **EPUB**.
- R5.2 Source material via the existing Audiobookshelf and Komga integrations.
- R5.3 Grouping/selection of "what belongs to this course" should be
  config-driven (tag, collection, or library reference) rather than hardcoded.
- R5.4 Also support arbitrary filesystem materials — e.g. a folder of maps or
  worksheets for a given lesson.

### R6 — Progress tracking / curriculum

- R6.1 Track, per child: how far through a course they are, their scores, and
  what they have completed.
- R6.2 Concept of a **curriculum**: who is doing what, and how far along.
- R6.3 Track discrete obligations — homework done, exam passed, work signed
  off.
- R6.4 Precedent exists in the Piano Kiosk, but only partially.

### R7 — Parent view

- R7.1 A parent-facing surface to review child progress.
- R7.2 Parents can **sign off** on homework or grant credit for work that the
  system cannot verify automatically.
- R7.3 Likely lives in the existing Admin module rather than on the Portal.

### R8 — Economy integration

- R8.1 Completing schoolwork — passing quizzes, finishing lessons — can earn
  household coins.
- R8.2 Must use the existing `EconomyService` earn path, including its daily
  caps and replay guard. No parallel currency logic.

### R9 — Freestyle (non-curriculum) content

- R9.1 Listening to audiobooks outside any curriculum, via Plex or
  Audiobookshelf.
- R9.2 Selection driven by config (tags or collections), not hardcoded lists.

### R10 — Content gates

- R10.1 Ability to inject a prerequisite before content unlocks — e.g. read a
  scripture before moving forward.
- R10.2 Should reuse existing readalong/scroller content rather than inventing
  a parallel presentation.

---

## 4. What already exists

Findings from codebase exploration on 2026-07-21. These materially reduce
scope and should be verified still-current before each sub-project starts.

### Already built and reusable

| Capability | Where | Notes |
|---|---|---|
| Per-user video progress | `3_applications/piano/UserVideoProgressStore.mjs` | Constructed once in `contentApi.mjs` and **injected** into Piano — not owned by it. Stores at `data/users/{id}/apps/{app}/video-progress.yml`; the app segment is a parameter |
| Generic watch logging | `POST /api/v1/play/log` | Records per-user progress whenever `userId` is present in the body |
| Generic per-user drill progress | `PUT /users/:userId/progress/:collection/:drillId` | Already app-agnostic; arbitrary collection/drill keys, merge-and-increment semantics |
| Course/episode machinery | shared `fitnessPlayableService` | Plex-backed; Piano consumes it rather than reimplementing |
| Roster hydration | `0_system/config/UserService.mjs` — `hydrateUsers` | App-agnostic id → profile |
| Display naming | `frontend/src/lib/userDisplayName.js` | Already app-wide; used by Piano and Fitness |
| Profile picker UI | `Piano/PianoKiosk/WhoIsPlayingPrompt.jsx` + `whoIsPlayingLayout.js` | Purely presentational; takes no piano-specific prop |
| Idle re-prompt | `whoIsPlaying.js` (`firesOnGap`), `useWhoIsPlaying.js` | Generic idle-gap mechanism |
| Book content adapters | `1_adapters/content/readable/komga/`, `.../audiobookshelf/` | Komga → `paged`, ABS → `flow`. Unified search; `GET /api/v1/list/readable` aggregates across both |
| Arbitrary file/materials browsing | `1_adapters/content/media/files/FileAdapter.mjs` | Handles images, PDFs, MusicXML. Roots config-driven in `local-media.yml`. **Satisfies R5.4 today** |
| File byte streaming | `GET /api/v1/proxy/media/stream/*` | Path-containment checked |
| Coin earning | `3_applications/economy/EconomyService.mjs` | Daily caps, blackout windows, per-ref replay guard |
| Readalong presentation | `Player/renderers/ReadalongScroller.jsx` | Verses and paragraphs; candidate for R10 |

### Existing seams that are stubs

| Seam | Where | State |
|---|---|---|
| `reader` nav type | `Menu/MenuStack.jsx` | `case 'reader':` renders a TODO placeholder. Fed by `selection.read` / `action: Read`, which the list schema already normalizes |
| Paged reader | `Player/renderers/PagedReader.jsx` | Stub div. Registered as `readable_paged` |
| Flow reader | `Player/renderers/FlowReader.jsx` | Stub div. Registered as `readable_flow` |

### Confirmed gaps

- **No user identity in the screen framework.** No `useCurrentUser`, no profile
  context, no per-viewer session anywhere in `frontend/src/screen-framework/`.
  The only identity is *device* identity (`deviceId` from screen YAML
  websocket guardrails), used to scope state publishing. `app:family-selector/user_2`
  looks like a user but is a static string baked into menu YAML at authoring
  time. Piano built its own identity privately inside its own module tree.
- **No generic quiz core.** Two incompatible question models already exist:
  - `2_domains/gameshow/` — Jeopardy-shaped: `rounds → categories → clues`,
    with `value`, `daily_double`, wagering. A clue is a clue/answer pair with
    optional media. No multiple choice, no matching. Not a quiz core with a
    Jeopardy skin — it is Jeopardy.
  - `2_domains/journalist/entities/` — `QuizQuestion`/`QuizAnswer`/`QuizCategory`,
    real multiple choice with `choices[]`, used by the Telegram journaling bot.
    Shares no code with GameShow.

  A school quiz model would be the **third**. The journalist model is closer to
  what school needs than the game show model is.
- **No curriculum/assignment concept** anywhere.
- **No parent sign-off concept** anywhere.

### Registration is cheap

- New widget: one line in `screen-framework/widgets/builtins.js`.
- New app: one entry in `frontend/src/lib/appRegistry.js` with a dynamic import.
- Menu items already support `play`/`open`/`list`/`display`/`launch`/`read`
  actions via `2_domains/content/utils/listConfigNormalizer.mjs`.

The hard part of this project is the shared spine, not mounting surfaces.

---

## 5. Decomposition

Each row is an independent spec → plan → build cycle.

| # | Sub-project | Size | Depends on | Covers |
|---|---|---|---|---|
| 1 | Identity / profiles on the screen framework | M | — | R1 |
| 2 | Course player + progress | M | 1 | R2, R6.1 |
| 3 | Quiz + flashcard engine | L | 1, question schema | R3, R4 |
| 4 | Reader (paged + flow) | S–M | — | R5.1–R5.3 |
| 5 | Curriculum / assignments | L | 1, 2 | R6.2, R6.3 |
| 6 | Parent view + sign-off | M | 5 | R7 |
| 7 | Economy hooks | S | 2 or 3 | R8 |
| 8 | Content gates | S | 5 | R10 |

**Not a sub-project:** R5.4 (filesystem materials) is satisfied by existing
`FileAdapter` plus a `local-media.yml` roots entry. R9 (freestyle audio) is
largely existing playback plus config; revisit only if it proves otherwise.

**Sequencing note.** Sub-project 4 (Reader) has no dependency on identity and
could run at any point. Everything else funnels through identity.

---

## 6. Open decisions

- **OPEN-1 — Engagement signal.** Piano's completion rule is
  `watched ≥ threshold% AND engaged`, where `engaged` means the student played
  along on MIDI at least once. That conjunction is what makes completion
  honest. School has the same park-the-video problem and **no equivalent
  signal**. What counts as engagement for a course video is undecided and must
  be answered in sub-project 2.
- **OPEN-2 — Question bank schema.** Given two existing incompatible models,
  what does the school question schema look like, and does it deliberately
  align with the journalist model, extend it, or stand apart?
- **OPEN-3 — Bank sharing with the game show.** Sharing a *format* is ruled
  out. Whether to support an export/adapt step from a school bank into a
  Jeopardy set is undecided and low priority.
- **OPEN-4 — Identity promotion vs. fresh build.** Piano's picker components
  are reusable by import, but promoting them into the framework means editing
  working Piano code on a device that has historically been fragile. Building
  the school identity container fresh — reusing only the presentational pieces
  — costs some duplication but carries no regression risk to Piano.
- **OPEN-5 — Identity strength.** Whether identity is a soft self-declared
  pick (Piano-style) or something stronger, given that credit and coins hang
  off it. Note the garage already has a fingerprint reader; whether the Portal
  warrants anything beyond a tap is undecided.
- **OPEN-6 — Flashcard scheduling.** Spaced repetition or simple drilling.
- **OPEN-7 — Parent view location.** Admin module vs. a Portal surface vs.
  both.
- **OPEN-8 — Course content source.** Whether courses are Plex-backed (as
  Piano's are, via `fitnessPlayableService`), filesystem-backed, or both.

---

## 7. Non-goals

- Replacing the game show. It stays a party game on the TV app.
- Multi-household or multi-tenant support.
- Any parallel currency, progress, or content-adapter system where one already
  exists.
- Editing `modules/Player` or `lib/Player`. School chrome wraps the shared
  Player from the consumer side, exactly as Piano and Fitness do.
