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
  define their rosters. **DECIDED (2026-07-21): the household IS the school.**
  The roster is the full household membership from the existing profile store
  (`data/users/{id}/profile.yml` via `getAllUserProfiles()`) — no separate
  school roster file, unlike Piano's `users.primary` subset.
- R1.4 Selection should be remembered between visits, and must be able to
  lapse — a stale identity that silently credits the wrong child is worse than
  no identity.
- R1.5 Conceptually similar to the Piano Kiosk's "who is playing" flow, but
  with a materially different role: in Piano identity is soft attribution for
  watch credit; here it is the spine of the entire application.
- R1.6 **DECIDED (2026-07-21):** Identity is a **soft pick with idle lapse**.
  A child taps their face to claim the device; identity stays visible in the
  chrome and lapses after an idle gap, re-prompting on next use. No PIN, no
  authentication.
- R1.8 **DECIDED (2026-07-21):** The reusable identity elements are
  **extracted from Piano into a system-wide home**, and Piano is refactored to
  consume them from there.

  **Governing principle: a module is not an export surface for other modules.**
  School must not import from `modules/Piano/`. Shared code moves to a shared
  location and every consumer — including Piano — imports from there. Without
  this, school would depend on Piano, a worse coupling than duplication.

  In scope for extraction: the presentational picker (`WhoIsPlayingPrompt.jsx`),
  pagination math (`whoIsPlayingLayout.js`), and the idle-gap predicate
  (`whoIsPlaying.js` / `useWhoIsPlaying.js`). Already shared and needs no move:
  `frontend/src/lib/userDisplayName.js`.

  Out of scope, stays piano-private: the `piano:user:${pianoId}` storage key,
  the `/api/v1/piano/users` roster endpoint, and the screensaver coupling that
  drops to guest on screen-off.

  **Risk note.** This edits a kiosk with a history of subtle breakage. It is
  tolerable because the change is mechanical (import paths, not logic) and the
  extracted pieces carry existing test coverage — `WhoIsPlayingPrompt.test.jsx`,
  `whoIsPlayingLayout.test.js`, `whoIsPlaying.test.js` — so the extraction is
  verifiable. Those tests must pass unchanged, aside from import paths, before
  the extraction is considered done. Proposed home: `frontend/src/lib/identity/`,
  consistent with `userDisplayName.js` already living under `lib/`.
- R1.7 **DECIDED (2026-07-21):** A **guest mode** exists but is severely
  gated. A guest may use generic, non-curricular things — play music, take a
  generic quiz, drill generic flashcards. A guest is never assigned curriculum
  and accrues no curricular progress.

### R2 — Video courses

- R2.1 Children watch video courses on the Portal.
- R2.2 Needs a **school-specific player chrome** wrapping the core Player —
  comparable to `PianoVideoPlayer` or `FitnessPlayer`, which both wrap the
  shared Player with their own surrounding UI.
- R2.3 Chrome features are **OPEN**: candidates include pause behaviour,
  overlays, progress display, and resume affordances.
- R2.4 Progress must resume where the child left off.
- R2.5 **DECIDED (2026-07-21):** Completion requires a **post-video quiz**.
  Watch percentage alone does not complete a lesson; the child must answer
  questions about the material.

  Rationale: an attention check only proves a body was in the room.
  Comprehension is the signal that actually measures learning. This is a
  deliberate rejection of Piano's presence-based `engaged` flag as the model
  here.

  **Consequence:** the quiz engine (sub-project 3) is a **dependency** of the
  course slice, not a later addition. See §5 sequencing.
- R2.6 **DECIDED (2026-07-21):** Course videos are **Plex-backed**, consuming
  the shared `fitnessPlayableService` exactly as Piano does — inheriting
  ordering, season/episode structure, watch state, resume, and transcoding.
  Loose materials (PDFs, maps, worksheets) stay filesystem-backed via the
  existing `FileAdapter`.
- R2.7 **Course collections staged (2026-07-21).** `data/household/config/school.yml`
  now carries a `courses.collections` block, shaped like `piano.yml`'s
  `videos.collections` (each entry is a tab; its collections merge into one
  poster wall):
  - `Art Lessons` — `plex:685094` (25 items)
  - `Kids Courses` — `plex:685095` (2 items)

  Both live in the Plex **Lectures** library. Nothing reads this yet — slice 1
  does not touch `school.yml` at all — it is staged for sub-project 2.

  Piano's `completion_threshold_percent` / `engagement_timeout_seconds` were
  deliberately **not** copied across, because R2.5 makes school completion
  comprehension-based rather than watch-percentage-plus-presence.

### R3 — Quizzes

- R3.1 Benchmark is Quizlet, not a game show.
- R3.2 Must support multiple question types. Named so far: multiple choice,
  matching. Likely also short answer and cloze/fill-in.
- R3.3 Question banks must be authorable as plain data files in the data
  volume, hand-writable without touching code.
- R3.4 Quiz results feed per-child progress.
- R3.5 **DECIDED (2026-07-21):** A **new canonical question-bank schema**, in
  its own domain. The existing GameShow (Jeopardy-shaped) and journalist
  (Telegram multiple-choice) models are left untouched — no regression risk to
  the party game or the journaling bot. This schema is intended as the
  household's lasting question format; the others may migrate later, or never.
- R3.6 **DECIDED (2026-07-21):** `type` describes how an item is **graded**;
  mode (quiz vs. flashcard drill) describes how it is **presented**. One bank
  serves both consumers — a flashcard is any item shown prompt-first with the
  answer revealed. This is what lets R3 and R4 share a sub-project without
  duplicating content.
- R3.7 **DECIDED (2026-07-21):** First slice supports four types:
  `multiple_choice`, `short_answer`, `cloze`, `matching`.
- R3.8 **DECIDED (2026-07-21):** Banks carry no scoring, rounds, point values,
  or scheduling — nothing about who is asking or how well they did. That state
  belongs to the attempt log (R3.9). Keeps banks portable and hand-writable
  per R3.3.
- R3.9 **Attempt log must be append-only.** Quiz results are individually
  attributable events, not a rollup, so that R6.5 reassignment is possible.

  **The existing generic endpoint is NOT sufficient.** Verified 2026-07-21 at
  `backend/src/4_api/v1/routers/piano.mjs:346-364`:
  `PUT /users/:userId/progress/:collection/:drillId` performs a spread-merge
  into a single per-drill record and increments a `plays` counter. Prior
  attempts are overwritten and unrecoverable. That shape is fine for drilling,
  where only latest state matters, but a merged counter cannot be split or
  reattributed after the fact.

  Rollups may be derived from the attempt log for display; the log is the
  source of truth.

### R4 — Flashcards

- R4.1 Standard flashcard drilling, same content domain as quizzes.
- R4.2 Shares a question/item bank with quizzes where sensible.
- R4.3 **DECIDED (2026-07-21):** First slice is a **simple drill with missed
  items resurfacing within the session**. No persistent scheduling state, no
  due dates.

  Deferring this is low-risk precisely because of R3.9: every attempt is
  logged, so Leitner buckets or full spaced repetition can be computed from
  history later without having lost the data needed to do it.
- R4.4 **Drag interactions are acceptable on the Portal.** The project's
  no-drag touch preference originates with the **fitness** widgets, where the
  display is wall-mounted and used at arm's length mid-workout. The Portal is a
  desk panel at close range, which is a different ergonomic case. Drag-to-connect
  is therefore allowed for `matching`. This is scoped to this device and does
  not relax the fitness rule.

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
- R6.5 **Reassignment (DECIDED 2026-07-21).** A parent or teacher must be able
  to **reallocate credit and progress between children** when work was
  attributed to the wrong person.

  This is the primary mitigation for mis-credit, and it is why identity can
  safely be a soft pick (R1.6): attribution does not have to be correct at the
  moment it happens, it has to be correctable afterwards.

  **Architectural consequence — binds sub-project 2.** Progress must be stored
  as individually attributable **events**, not solely as per-child rollups. A
  record must carry enough provenance to be identified and moved: what content,
  what happened, when, and how far. A design that persists only a summary per
  child (e.g. a single "percent complete" figure) makes reassignment impossible
  after the fact and must be rejected. Rollups may be derived from events, but
  events are the source of truth.

  Reassignment of a completion that already paid out coins must also decide
  whether the coin transaction follows the progress. See **OPEN-9**.

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

### R11 — Launching native Android apps (live lessons)

- R11.1 The Portal must be able to launch a native Android app — specifically
  **Zoom**, for live lessons with a teacher.
- R11.2 **The launch mechanism already exists and is generic.** No new
  launching code is required:
  - `frontend/src/lib/fkb.js` — `launchApp(pkg)` / `startApplication(pkg, activity)`,
    wrapping FKB's `fully.startApplication`.
  - `Menu/MenuStack.jsx:150` — handles an `android` selection, pushes an
    `android-launch` nav entry.
  - `Menu/AndroidLaunchCard.jsx` — performs the launch and verifies it: if FKB
    is still foregrounded after 2.5s the app did not start, so it reports
    failure and offers up to 2 retries; an FKB `onResume` dismisses the card
    when the user returns.
  - Menu YAML: `input: android:<package>[/<activity>]`.

  Adding Zoom is therefore a **menu entry plus device config**, not a build.

- R11.3 **RISK — FKB kiosk mode may kill the launched app.** This project has
  already hit this on the Shield TV, where kiosk mode kills any launched
  activity within ~28ms, forcing an architectural workaround (see the
  AudioBridge design notes). Whether the Portal's kiosk configuration behaves
  the same is unverified. **Test this early**, before designing a lesson flow
  that assumes Zoom launches and returns cleanly. If it reproduces, the fix is
  FKB configuration, not application code.

- R11.4 **GAP — `AndroidLaunchCard` is keyboard-only.** It binds raw
  `Escape`/`Enter` keydowns, and its failure state reads "Press OK to retry" /
  "Press Back to return". The Portal has neither key. Back happens to work
  (TouchChrome emits `escape`, which pops the nav stack) and retry happens to
  be reachable only because play/pause synthesizes `Enter` — both accidental,
  and the on-screen text instructs a touch user to press keys that do not
  exist. Needs touch affordances and corrected copy. Small, but real.

- R11.5 Zoom must be added to FKB's launcher whitelist on the device.

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
| Generic per-user drill progress | `PUT /users/:userId/progress/:collection/:drillId` | App-agnostic keys, but **merge-and-increment rollup — not an event log.** Suitable for drilling; **cannot** back reassignable quiz results. See R3.9 |
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
| 1 | **Identity + quiz/flashcard engine** | L | question schema | R1, R3, R4 |
| 2 | Course player + progress | M | 1 | R2, R6.1 |
| 3 | Reader (paged + flow) | S–M | — | R5.1–R5.3 |
| 4 | Curriculum / assignments | L | 1, 2 | R6.2, R6.3 |
| 5 | Parent view + sign-off + reassignment | M | 4 | R7, R6.5 |
| 6 | Economy hooks | S | 1 or 2 | R8 |
| 7 | Content gates | S | 4 | R10 |
| 9 | Writing assignments (TipTap) | M | 1 | spec: `2026-07-21-school-writing-assignments-design.md` |
| 10 | Typing tutor (drill + arcade) | M | 1 | spec: `2026-07-21-school-typing-tutor-design.md` |
| 8 | Android launch touch affordances | XS | — | R11.4 |

**R11 (Zoom) is mostly not a sub-project.** Launching already works generically
(R11.2); adding Zoom is a menu entry plus a whitelist change. The only code
work is making `AndroidLaunchCard`'s failure state usable without a keyboard,
listed above as sub-project 8. It is independent of everything else and can be
done at any time — including alongside the first slice, since it is small and
the Portal will want Zoom before the curriculum exists.

**Sequencing revised 2026-07-21.** Identity and the quiz engine are built
together as the first slice, ahead of courses. R2.5 makes quizzes a
prerequisite for course completion, so building courses first would ship
videos that play and resume but can never complete — no completion events, no
coins, nothing to sign off.

Quizzes are independently useful, so this is a shippable slice rather than
scaffolding: R1.7 already establishes that a guest can drill a generic quiz or
flashcard set with no curriculum attached. First deliverable is a child
claiming a profile, taking a quiz, and the result being recorded against them.

**Not a sub-project:** R5.4 (filesystem materials) is satisfied by existing
`FileAdapter` plus a `local-media.yml` roots entry. R9 (freestyle audio) is
largely existing playback plus config; revisit only if it proves otherwise.

**Sequencing note.** Sub-project 4 (Reader) has no dependency on identity and
could run at any point. Everything else funnels through identity.

---

## 6. Open decisions

- ~~**OPEN-1 — Engagement signal.**~~ **RESOLVED 2026-07-21.** Completion
  requires a post-video quiz; see R2.5.
- ~~**OPEN-2 — Question bank schema.**~~ **RESOLVED 2026-07-21.** New canonical
  standalone schema; see R3.5–R3.9.
- **OPEN-3 — Bank sharing with the game show.** Sharing a *format* is ruled
  out. Whether to support an export/adapt step from a school bank into a
  Jeopardy set is undecided and low priority.
- ~~**OPEN-4 — Identity promotion vs. fresh build.**~~ **RESOLVED 2026-07-21.**
  Neither: extract to a shared home. See R1.8.
- ~~**OPEN-5 — Identity strength.**~~ **RESOLVED 2026-07-21.** Soft pick with
  idle lapse; see R1.6. Justified by R6.5 — mis-credit is repairable, so
  attribution need not be authenticated at the point of capture. Revisit only
  if reassignment proves to be a frequent chore rather than a rare correction.
- ~~**OPEN-6 — Flashcard scheduling.**~~ **RESOLVED 2026-07-21.** Simple drill
  with in-session resurfacing; see R4.3. Revisit once there is real usage data
  in the attempt log to compute schedules from.
- **OPEN-7 — Parent view location.** Admin module vs. a Portal surface vs.
  both. Note this surface now also owns reassignment (R6.5), not just review
  and sign-off.
- **OPEN-9 — Do coins follow reassigned progress?** If a completion paid out
  coins to the wrong child and is then reassigned, the coins may need to move
  too. `EconomyService` is an append-only ledger with a per-ref replay guard,
  so this would be a compensating pair of transactions rather than an edit.
  Whether that is worth doing — or whether coin errors are simply left alone —
  is undecided.
- ~~**OPEN-8 — Course content source.**~~ **RESOLVED 2026-07-21.** Plex-backed
  courses, filesystem materials; see R2.6.
- **OPEN-10 — Generic vs. curricular content.** R1.7 implies content carries a
  property distinguishing generic material (open to any user, including guests)
  from curricular material (assigned to a specific child). Where that property
  lives — content metadata, curriculum config, or an explicit allow-list — is
  undecided. Mostly lands in sub-project 4, but the first slice must know which
  bucket a quiz is in.

---

## 7. Non-goals

- Replacing the game show. It stays a party game on the TV app.
- Multi-household or multi-tenant support.
- Any parallel currency, progress, or content-adapter system where one already
  exists.
- Editing `modules/Player` or `lib/Player`. School chrome wraps the shared
  Player from the consumer side, exactly as Piano and Fitness do.
