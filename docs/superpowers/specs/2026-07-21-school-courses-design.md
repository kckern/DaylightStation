# School Portal — Video Courses (Sub-project 2)

**Status:** Design spec, 2026-07-21.
**Parent requirements:** `2026-07-21-portal-homeschool-requirements.md` (R2, R6.1)
**Depends on:** slice 1 (identity + quiz/flashcard engine), shipped and deployed.
**Modelled on:** the Piano Kiosk's Videos mode, `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`.

---

## 1. Goal

A child picks a course on the Portal, watches its lectures in order, and each
lecture counts as complete only once they have watched it and passed its quiz.

---

## 2. What is copied from Piano, and what is not

Piano already solved most of this. The parts worth taking are the *shape*, not
the code: Piano's course files are entangled with MIDI, a music-curriculum
taxonomy, and a sibling-pacing rule that school does not want.

### Reused directly (no new code)

| Capability | Where |
|---|---|
| Plex playable-episode resolution + watch state | `FitnessPlayableService.getPlayableEpisodes(showId)` — generic despite its folder |
| Generic watch logging | `POST /api/v1/play/log` |
| Poster/tile UI atoms | `ProfileAvatar`, `LockIcon` (`@/modules/Fitness/player/overlays/LockIcon.jsx`) |
| The shared Player | `modules/Player/Player.jsx`, wrapped from the consumer side only |

### Copied as a pattern, reimplemented for school

- The use-case-over-injected-service shape of `GetPlayableUnits` / `GetCourseProgress`.
- The course grid → course detail → player routing skeleton.
- The sequential lock math (a pure linear scan, label-driven).

### Deliberately NOT carried over

- **`engaged` / the MIDI engagement gate.** Piano completes a lesson on
  `watched ≥ threshold AND engaged`, where `engaged` means a MIDI note was
  played. School has no such signal, and R2.5 already decided completion is
  comprehension-based. The quiz replaces `engaged` outright.
- **`co_progress`** — Piano's sibling-pacing lock, keyed to named users. Not a
  school requirement; omitted rather than generalised speculatively.
- **`CurriculumIndex` / subcourses / lanes** — a music-curriculum taxonomy
  (`piano.lane`, repertoire, instructor). School courses are flat: course →
  unit → lecture.
- **`UserVideoProgressStore` as-is** — its path and config lookup are hardcoded
  to piano. See §5.

---

## 3. Config

Extends the existing `data/household/config/school.yml`:

```yaml
courses:
  collections:
    - label: Art Lessons
      plex: [plex:685094]
    - label: Kids Courses
      plex: [plex:685095]

  # A course is sequential when its Plex item carries one of these labels.
  # Same mechanism as piano.yml: tag it in Plex, no per-course config entry.
  sequential_labels: [sequential]

  # Watch bar for a lecture to count as watched.
  completion_threshold_percent: 90

  # Score needed to pass a lecture's quiz. Deliberately not 100 — see §6.
  quiz_pass_percent: 80
```

`reference_units` is **not** included. Piano needs it to exclude practice
material from lesson sequencing; add it only if a real school course turns out
to need it.

---

## 4. Linking a lecture to its quiz

A question bank gains one optional field:

```yaml
id: watercolour-lesson-1-quiz
title: Watercolour — Lesson 1
lecture: plex:685101          # the lecture this quiz completes
audience: assigned
items: [...]
```

Chosen over a filename convention or a mapping table because the link lives
with the content that changes most often, and a renamed Plex item breaks
loudly (the bank names a lecture that no longer exists) rather than silently
orphaning a file.

**A lecture with no bank has no quiz gate** — it completes on watch alone. This
is the escape hatch that keeps a course usable while its quizzes are still
being written, and it must not be treated as an error.

`questionBankValidation.mjs` gains: `lecture` optional; when present, a
non-empty string. No further validation — the bank does not know whether that
Plex id exists, and should not.

---

## 5. Progress and completion

### Storage

`UserVideoProgressStore` is currently hardcoded to `data/users/{id}/apps/piano/`
and `getHouseholdAppConfig(null, 'piano')`. **Parameterise it by app name**
rather than copying it — one store, two consumers, so a fix reaches both.
School writes to `data/users/{id}/apps/school/video-progress.yml`.

This is a change to a file Piano depends on. Piano's behaviour must be
unchanged: the app name defaults to `piano`, and Piano's existing tests must
pass untouched. That is the completion gate for this task.

### Completion rule

A lecture is complete when **both** hold:

1. `percent >= courses.completion_threshold_percent`, and
2. its quiz has been passed — **or it has no quiz.**

"Passed" = any single quiz session against the linked bank scored
`>= quiz_pass_percent`. Derived by folding the attempt log (grouped by
`sessionId`), never stored as a separate flag — the log stays the source of
truth, so a reassignment of attempts (R6.5) automatically moves the pass with
them.

Retakes are unlimited and a pass is permanent. Passing once is passing.

### Economy

A newly-completed lecture fires one coin earn, reusing `EconomyService.earn`
with a school-specific action. Its per-`ref` replay guard already prevents
double payment; the `ref` is the lecture's contentId.

---

## 6. Sequential courses

Marked by a Plex label from `sequential_labels`, exactly as Piano does it.

**What locks.** Within a course, lectures are ordered (unit index, then item
index). Every lecture after the first **incomplete** one is locked: disabled,
greyed, padlock overlay, click is a no-op. The first incomplete lecture is
marked "current".

Note the difference from Piano, and it is the whole point of the mastery
choice: Piano locks on the first **unwatched** lecture, school locks on the
first **incomplete** one — and incomplete now includes "quiz not passed". A
child who watches a lecture fully but fails its quiz does not advance.

**During playback**, mirroring Piano:
- Forward skip and forward scrub are clamped to the furthest point reached this
  session.
- The playback-rate control is hidden — no speeding through.

**The dead-end risk, and what is done about it.** Requiring a pass to advance
can strand a child on a kiosk with nobody nearby. Three deliberate mitigations,
all of which must be present:

1. **Unlimited retakes**, and a pass is any single qualifying session — a bad
   run never counts against a later good one.
2. **`quiz_pass_percent` defaults to 80, not 100.** A single wrong answer must
   not lock a course.
3. **A locked lecture always states why**, naming the quiz to retake, rather
   than showing a bare padlock. A silent lock is the actual trap; a lock that
   explains itself is a next step.

If stranding still shows up in practice, the fix is a parent override, which
belongs with sign-off in sub-project 5 — not a weakening of the rule here.

---

## 7. File structure

### Backend

| Path | Layer | Responsibility |
|---|---|---|
| `2_domains/school/coursePolicy.mjs` | domain | Pure: order lectures, compute first-incomplete, locked set, quiz-pass fold |
| `3_applications/school/GetSchoolCourseUnits.mjs` | application | Course detail: units + lectures, enriched with per-user progress and lock state |
| `3_applications/school/GetSchoolCourseProgress.mjs` | application | Poster-wall aggregate per course |
| `3_applications/piano/UserVideoProgressStore.mjs` | application | **Modified**: app name parameterised, defaults to `piano` |
| `4_api/v1/routers/school.mjs` | api | **Modified**: adds the course routes below |

New routes under `/api/v1/school`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/courses` | Tabs and their collections, from config |
| `GET` | `/courses/:courseId/units?userId=` | Units + lectures with progress and lock state |
| `GET` | `/courses/progress?ids=&userId=` | Aggregate for the poster wall |

### Frontend — `frontend/src/modules/School/courses/`

| Path | Responsibility |
|---|---|
| `CourseGrid.jsx` | Tabs per collection group; poster wall; sequential badge |
| `CourseTile.jsx` | One poster: cover, progress, completed/total |
| `CourseDetail.jsx` | Units and lectures; lock/current rendering; the why-locked message |
| `SchoolVideoPlayer.jsx` | Wraps the shared Player; forward-clamp when sequential; hands off to the quiz on end |
| `useCourseUnits.js` | Fetch hook for the units endpoint |

`SchoolApp.jsx` gains a top-level switch between Courses and Banks. **The
Player itself is never modified** — school chrome wraps it from the consumer
side, exactly as Piano and Fitness do.

---

## 8. The lecture → quiz handoff

When a lecture reaches the watch threshold and has a linked bank, the player
offers its quiz on end. Taking it runs the existing `QuizRunner` unchanged —
one pass, server-graded, recorded against the child. The runner already handles
identity abandonment, the loading gate, and unrecorded-answer signalling.

Skipping the quiz is allowed. The lecture stays incomplete, and in a sequential
course the next lecture stays locked — which is the mastery rule doing its job,
not a bug.

---

## 9. Learning log

A child records a short spoken reflection after a lecture — "what did you
learn?" — which is transcribed and kept against their record. Modelled on the
Fitness voice memo, but reusing the layers that are already shared rather than
building a third recorder.

### What already exists and is reused as-is

| Layer | Where | Note |
|---|---|---|
| Capture UI + recorder | `frontend/src/modules/VoiceCapture/` — `useMediaRecorderCapture`, `VoiceCaptureOverlay`, `MicMeter` | Already consumed cross-module by `modules/Feedback` and `modules/Fitness/feedback`, so this is the established shared home |
| Transcription | `POST /api/v1/ai/transcribe` (`4_api/v1/routers/ai.mjs`, OpenAI adapter) | Generic; takes an audio buffer, returns text |

### What is NOT reused, and why

`POST /api/v1/fitness/voice_memo` welds upload, transcription and
fitness-session storage into one endpoint, and requires a fitness session. It
is not a general memo service and school must not call it.

Note also that `Fitness/player/panels/hooks/useVoiceMemoRecorder.js` is a
*separate* MediaRecorder implementation that predates and ignores
`modules/VoiceCapture/`. That duplication is pre-existing debt. **It is not
this sub-project's job to fix it** — School simply uses the shared module, so
we add no new fragmentation. Converging Fitness onto `VoiceCapture` is a
worthwhile follow-up, tracked separately, and touching a live workout surface
is not something to bundle into a courses build.

### Storage — its own store, deliberately

Log entries are **per-child records**, so they get the same treatment as quiz
attempts rather than living in a generic memo blob: append-only, date-sharded,
carrying `attributedTo`.

`data/users/{userId}/apps/school/log/{YYYY-MM-DD}.yml`:

```yaml
- id: log_7fd2a1
  at: '2026-07-21T16:04:11.212Z'
  contentId: plex:685101      # the lecture reflected on (null for a free-standing entry)
  bankId: null                # or the quiz, if logged after one
  audio: media/school/log/kckern/log_7fd2a1.webm
  transcript: "I learned that mixing too many colours makes mud."
  transcriptStatus: ok        # ok | pending | failed
  attributedTo: kckern
```

This is what lets a parent reassign a log entry alongside the attempts from the
same sitting (R6.5) — a rollup-only design could not.

**The audio is the artifact; the transcript is derived.** If transcription
fails, the entry is still written with `transcriptStatus: failed` and the audio
retained. Losing a child's recording because a cloud API was down would be the
worst outcome here, and it is the one thing this design refuses to allow.
Retrying a failed transcript is a later concern; keeping the audio is not.

### Rules

- **Optional, and never a gate.** A learning log entry is never required to
  complete a lecture or unlock the next one. Sequential courses already gate on
  a quiz pass (§6), and stacking a second lock on a spoken reflection would
  compound the dead-end risk that section exists to contain.
- **Never for guests.** A guest produces no attempts (slice 1) and likewise
  produces no log entries — there is nobody to attribute them to. The record
  button is absent for a guest rather than failing on submit.
- **Prompted, not nagged.** Offered after a lecture ends, alongside the quiz
  handoff. Skipping is a tap and carries no penalty.
- The mic on this panel is already available: FKB `microphoneAccess` is true
  on the Portal (see `portal.yml`).

### Surface

| Path | Responsibility |
|---|---|
| `modules/School/log/LearningLogButton.jsx` | Record affordance + entry count, mirroring `FitnessVoiceMemo`'s thin-shell shape |
| `modules/School/log/useLearningLog.js` | Submit (audio → transcribe → persist), list for the current child |

Backend: `3_applications/school/LearningLogService.mjs` plus routes
`POST /api/v1/school/log` and `GET /api/v1/school/users/:userId/log`. The
datastore gains append/read methods alongside the attempt log, reusing the same
date-sharded pattern.

Although it lands with courses, nothing about the record ties it to video —
`contentId` may name a quiz bank or be null, so reading (sub-project 3) and
free-standing reflections work later without a schema change.

---

## 10. Out of scope

- Curriculum and assignment — what a child *should* do today (sub-project 4).
- Parent view, sign-off, reassignment UI, and any parent override of a lock
  (sub-project 5).
- Reading / PDF / EPUB (sub-project 3).
- `co_progress`, `reference_units`, subcourse lanes, spaced repetition.
- Converging `Fitness/player/panels/hooks/useVoiceMemoRecorder.js` onto the
  shared `modules/VoiceCapture/` (§9) — real debt, but a live workout surface
  is not something to refactor inside a courses build.
- Retrying a failed transcript. The audio is kept and the entry is marked
  `failed`; re-transcription can come later without a schema change.
