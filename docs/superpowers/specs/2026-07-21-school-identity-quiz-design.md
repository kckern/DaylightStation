# School Portal — Identity + Quiz/Flashcard Engine (Slice 1)

**Status:** Design spec, approved 2026-07-21. Revised same day after a stern
review pass (roster endpoint, flashcard answer contract, lapse-vs-session,
results shape, quiz vs. drill semantics).
**Parent requirements:** `2026-07-21-portal-homeschool-requirements.md`
**Covers:** R1 (identity), R3 (quizzes), R4 (flashcards)

---

## 1. Goal

A child claims a profile on the Portal, takes a quiz or drills flashcards, and
the result is recorded against them — **reassignably**.

This is sub-project 1 of the homeschool platform. It ships ahead of courses
because R2.5 makes a post-video quiz the completion signal for a lesson, so
courses cannot complete until this exists. It is not scaffolding: R1.7 already
establishes that a guest can drill a generic set with no curriculum attached,
so this slice is useful on its own the day it lands.

---

## 2. Architecture

Three concerns, deliberately separated:

1. **Identity** — who is using the Portal. Shared presentational pieces
   extracted out of Piano into `frontend/src/lib/identity/`; a school-owned
   container consumes them.
2. **Content** — question banks. Plain YAML in the data volume, knowing
   nothing about users, scoring, or scheduling.
3. **Record** — an append-only attempt log, per child, one event per answer.

The load-bearing constraint is R6.5: a parent must be able to reallocate credit
between children. That forces the record to be **individually attributable
events**, not rollups. Rollups are derived for display; the log is the source
of truth. This is why the existing
`PUT /users/:userId/progress/:collection/:drillId` is *not* reused — verified at
`backend/src/4_api/v1/routers/piano.mjs:346-364`, it spread-merges into a single
per-drill record and increments a `plays` counter, destroying the individual
attempts a reassignment would need.

### Grading happens on the server

One POST per answer; the server grades and appends the attempt in the same
call. Rationale is **single-source grading logic**, not secrecy: tolerant
short-answer matching and matching-pair comparison are fiddly enough that
having them in two places guarantees divergence. It also makes the log
authoritative — a recorded attempt always carries the grade the server assigned.

Banks are served **in full, including answers**. Flashcard mode is self-graded
and must reveal answers client-side, so hiding them is impossible anyway. This
is explicitly *not* a security boundary, and the spec should not pretend
otherwise: a child with devtools on a kiosk could read answers. That is an
acceptable risk for a homeschool device, and the mitigation if it ever matters
is parental observation, not client obfuscation.

---

## 3. File structure

### Extracted shared identity — `frontend/src/lib/identity/`

Moved out of `frontend/src/modules/Piano/PianoKiosk/`, with tests. Piano is
refactored to import from the new home. Per R1.8, **a module is not an export
surface for other modules** — school must never import from `modules/Piano/`.

| New path | Moved from | Responsibility |
|---|---|---|
| `lib/identity/ProfilePicker.jsx` | `WhoIsPlayingPrompt.jsx` | Presentational picker. Props unchanged: `{users, activeId, onPick, onDismiss, onScreenOff, timeoutMs}` |
| `lib/identity/profilePickerLayout.js` | `whoIsPlayingLayout.js` | `columnsForCount`, `paginateProfiles`, `PICKER_PAGE_SIZE` |
| `lib/identity/idleGap.js` | `whoIsPlaying.js` | `firesOnGap(lastMs, nowMs, thresholdMs)` — pure predicate |
| `lib/identity/useIdleGap.js` | `useWhoIsPlaying.js` | Idle-gap re-prompt hook |
| — | `lib/userDisplayName.js` | **Does not move.** Already shared with Fitness |

Names are neutralised during the move: "who is playing" is actively misleading
when the activity is a quiz. Tests move with their subjects and are renamed to
match.

**Stays piano-private, not extracted:** the `piano:user:${pianoId}` storage key,
the `/api/v1/piano/users` roster endpoint, and `usePianoScreenOff`'s coupling
that drops to guest on screen-off.

**Deferred, explicitly out of scope:** converging Piano's *container*
(`PianoUserContext.jsx`) onto a shared one. This slice extracts the elements
only. Two containers exist afterwards; that is accepted, and noted as a
follow-up rather than pretended away.

### Backend — new

| Path | Layer | Responsibility |
|---|---|---|
| `2_domains/school/questionBankValidation.mjs` | domain | Pure validation + normalisation of a bank. No I/O |
| `2_domains/school/grading.mjs` | domain | Pure per-type grading. No I/O, no dates |
| `2_domains/school/attempt.mjs` | domain | `createAttempt()` factory — stamps id and timestamp |
| `2_domains/school/index.mjs` | domain | Barrel export |
| `1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` | adapter | Dumb storage: read banks, append attempts, read attempt days |
| `3_applications/school/SchoolService.mjs` | application | Use cases: list/get banks, grade-and-record, read results |
| `4_api/v1/routers/school.mjs` | api | Thin HTTP shell |

`YamlSchoolDatastore` mirrors `YamlEconomyDatastore` deliberately — same
date-sharded append-only layout, same `configService` injection, same
"dumb storage, no logic" contract. That pattern is proven in this codebase and
already has an established test shape.

### Frontend — new

| Path | Responsibility |
|---|---|
| `modules/School/SchoolApp.jsx` | App root: header with profile chip, routes between picker/browser/runner |
| `modules/School/identity/SchoolProfileContext.jsx` | Provider: roster, current profile, persistence, lapse |
| `modules/School/identity/useSchoolProfile.js` | Consumer hook |
| `modules/School/browse/BankBrowser.jsx` | Grid of available banks, filtered by audience |
| `modules/School/quiz/QuizRunner.jsx` | Drives a quiz session: **one pass**, one item at a time, score summary at the end. No resurfacing — a quiz is an assessment, and re-asking missed items until correct would converge every score to 100% and gut the R2.5 completion signal |
| `modules/School/quiz/items/MultipleChoiceItem.jsx` | Tap targets |
| `modules/School/quiz/items/ShortAnswerItem.jsx` | On-screen keyboard input |
| `modules/School/quiz/items/ClozeItem.jsx` | Short answer with split prompt |
| `modules/School/quiz/items/MatchingItem.jsx` | Drag-to-connect pairs |
| `modules/School/flashcards/FlashcardRunner.jsx` | Prompt → reveal → self-grade. **Missed items resurface before the session ends (R4.3)** — resurfacing belongs to drilling, not assessment |
| `modules/School/schoolLog.js` | Logging facade (see §9) |

### Frontend — modified

| Path | Change |
|---|---|
| `lib/appRegistry.js` | Register `school` app with a dynamic import |
| `modules/Piano/PianoKiosk/**` | Import-path updates only for the extracted identity pieces |

**Not modified:** `modules/Player`, `lib/Player`, `screen-framework/overlays/TouchChrome.*`.
The profile chip lives in the school app's own header, not in the screen
chrome — keeping identity out of the framework's control lane until something
actually needs it to span apps.

---

## 4. Data formats

### Question bank — `data/content/quizzes/{bankId}.yml`

Mirrors the existing `data/content/games/<game>/*.yml` convention.

```yaml
id: us-state-capitals
title: US State Capitals
audience: generic          # generic | assigned  (R1.7 guest gating)
topics: [geography, us-states]
items:
  - id: wa
    type: multiple_choice
    prompt: What is the capital of Washington?
    answer: Olympia
    choices: [Seattle, Olympia, Spokane, Tacoma]

  - id: or
    type: short_answer
    prompt: What is the capital of Oregon?
    answer: Salem
    accept: [salem]        # additional accepted forms

  - id: id-cloze
    type: cloze
    prompt: "The capital of Idaho is ___."
    answer: Boise
    accept: [boise]

  - id: pnw-pairs
    type: matching
    prompt: Match each state to its capital
    pairs:
      - { left: Washington, right: Olympia }
      - { left: Oregon,     right: Salem }
```

Per R3.8 a bank carries **no** scoring, point values, rounds, scheduling, or
per-child state. `audience` is the sole concession, and only because guest
gating must work before any curriculum exists (OPEN-10); it is expected to be
superseded by curriculum config in sub-project 4.

**Validation rules** (`questionBankValidation.mjs`, pure):

- `id`, `title`, `items` required; `items` non-empty.
- Item `id` required and unique within the bank.
- `type` ∈ {`multiple_choice`, `short_answer`, `cloze`, `matching`}.
- `multiple_choice`: `choices` ≥ 2, all unique (duplicates render as identical
  tap targets), and `answer` must appear in `choices`.
- `short_answer` / `cloze`: `answer` required; `accept` optional array.
- `cloze`: `prompt` must contain the blank marker `___` **exactly once**.
  Multi-blank cloze is a different item type with its own grading and UI
  questions; rejecting it now is cheaper than half-supporting it.
- `matching`: `pairs` ≥ 2; `left` values unique; `right` values unique.
- `audience` defaults to `assigned` when absent — **fail closed**, so a bank
  is never accidentally exposed to guests by omission.
- Invalid banks are omitted from listings with a `warn` log naming the file and
  the reason. One malformed file must never break the browser.

### Attempt log — `data/users/{userId}/apps/school/attempts/{YYYY-MM-DD}.yml`

Append-only array, date-sharded by `at`. Layout and semantics mirror
`YamlEconomyDatastore`'s ledger.

```yaml
- id: att_k3f9d2
  at: '2026-07-21T15:04:11.212Z'
  sessionId: ses_9d21ba
  bankId: us-state-capitals
  itemId: wa
  itemType: multiple_choice
  mode: quiz              # quiz | flashcard
  given: Olympia          # quiz mode: what the child answered — a string for
                          # every type except matching, where it is an array of
                          # {left, right} pairs. Flashcard mode: always null
                          # (the child self-grades; there is no typed answer).
  correct: true           # server-assigned in quiz mode; the child's own
                          # self-report in flashcard mode (see mode)
  attributedTo: kckern    # denormalised for reassignment auditing
```

`attributedTo` duplicates the path's `userId` deliberately. When an attempt is
later moved between children (R6.5), the file it sits in changes but this field
records who it was *originally* credited to — without it, a reassignment is
unauditable after the fact.

`sessionId` groups the attempts from one sitting, which is the natural unit a
parent would reassign ("that whole quiz was actually Milo").

---

## 5. API

All under `/api/v1/school`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/roster` | Household roster for the picker: `[{id, name}]` |
| `GET` | `/banks?audience=` | List banks. `audience=generic` filters to guest-safe sets |
| `GET` | `/banks/:bankId` | One bank, full (answers included — see §2) |
| `POST` | `/sessions` | Open a session → `{sessionId}`. Body `{userId?, bankId, mode}` |
| `POST` | `/sessions/:sessionId/answer` | Record one answer (server-graded in quiz mode) |
| `GET` | `/users/:userId/results?bankId=` | Derived rollup from the attempt log |

**`GET /roster`.** The household **is** the school — there is no separate
school roster, and no `school.yml`. The endpoint returns every household
member, straight from the existing profile store:
`UserService.getAllProfiles()` (backed by `configService.getAllUserProfiles()`,
i.e. `data/users/{id}/profile.yml`), shaped to
`[{id, name, group_label?}]` and sorted by name for a deterministic picker.
Adding a child to the household automatically adds them here; there is no
second list to forget to update.

School must not call `/api/v1/piano/users`; that endpoint is piano-private
(§3) and reflects piano's own subset roster. No profiles on disk yields an
empty roster and the UI's empty state, not an error.

**Bank reads are ungated.** `GET /banks` and `GET /banks/:bankId` require no
identity and enforce no audience — per §2 the bank content is not a security
boundary, and inventing auth on reads would only pretend it is. The `audience`
rule is enforced at exactly one place: session open.

**`POST /sessions/:sessionId/answer`** — shape depends on the session's `mode`.

*Quiz mode:* request `{itemId, given}` → response `{correct, expected, attemptId}`.
The server grades via the pure domain module, appends the attempt, and returns
the verdict. `expected` lets the UI show the right answer after a wrong
response without a second call. `given` is a string for every type except
`matching`, where it is an array of `{left, right}`.

*Flashcard mode:* request `{itemId, selfGrade: 'correct' | 'incorrect'}` →
response `{attemptId}`. **The server does not grade a flashcard** — the child
revealed the answer and judged themselves, so there is nothing to grade. The
server records the self-report verbatim: `correct` from `selfGrade`,
`given: null`. No `correct`/`expected` in the response; the client already
knows both. `mode: flashcard` on the attempt is what marks the verdict as
self-reported rather than server-assigned — rollups must never mix the two as
if they were the same kind of evidence.

All four item types are drillable as cards: prompt shown, answer (or pair
list, for `matching`) revealed on tap, self-graded.

`bankId` is deliberately **not** in either request — the session already holds
it, and accepting it again would let a client grade against one bank while
recording under another.

**Session state.** Sessions are held **in memory** — `{sessionId, userId|null,
bankId, mode, startedAt}` — not persisted. Server-side session state is what
lets the guest and audience rules be enforced without trusting the client.

A restart mid-quiz loses open sessions; a subsequent answer returns `410` and
the UI sends the child back to the bank browser. This is acceptable because
**attempts already appended are on disk and survive** — a restart costs the
remainder of one sitting, never a recorded result. Sessions are dropped after
2 hours of inactivity so the map cannot grow without bound.

There is deliberately **no close endpoint**. Nothing downstream depends on a
session "ending" — results derive from the attempt log, and expiry is the only
cleanup. The `school.session.end` log event (§9) is emitted by the frontend
when a runner finishes or is abandoned; it is telemetry, not state.

**`GET /users/:userId/results?bankId=`** — derived by folding the user's
attempt log, never stored. Response, per bank:

```json
{
  "bankId": "us-state-capitals",
  "quiz":      { "attempts": 12, "correct": 9, "lastAt": "2026-07-21T15:04:11Z" },
  "flashcard": { "attempts": 30, "correct": 24, "lastAt": "2026-07-20T19:11:02Z" },
  "items": { "wa": { "quizAttempts": 2, "quizCorrect": 1, "lastCorrect": true } }
}
```

Quiz and flashcard counts are **never merged**: one is server-graded evidence,
the other a self-report (§5, flashcard mode). `items` carries quiz-mode
per-item state only — it is what sub-project 2 will read to gate lesson
completion, and self-reports must not leak into that.

**Guest sessions.** A session with no `userId` is a guest session: it grades and
returns verdicts normally but **appends nothing**. Per R1.7 a guest may drill
generic sets; per R1.2 nothing untracked may be attributed. The API must reject
a guest session opened against an `audience: assigned` bank with `403`.

---

## 6. Identity behaviour

- **Roster** fetched from `GET /api/v1/school/roster` (§5): the full household
  membership from the existing profile store. The household is the school —
  no per-app roster config exists for this slice.
- **Selection** via the extracted `ProfilePicker`.
- **Persistence** in `localStorage` under the flat key `school:user`, restored
  on load if the id is still on the roster; otherwise cleared to unclaimed.

  No device segment in the key: `localStorage` is already scoped per device and
  origin. Piano qualifies its key with `${pianoId}` because one tablet can front
  several pianos; the Portal has no such multiplicity, so a segment here would
  be noise implying a distinction that does not exist.
- **Visibility.** The current profile is shown persistently in the school app
  header. This is the primary defence against accidental mis-credit (the
  failure mode R6.5 exists to repair), so it must not be tucked into a menu.
- **Lapse at 10 minutes** of no interaction, returning to unclaimed. Shorter
  than Piano's gap on purpose: on Piano an expired identity merely fails to
  credit, which is harmless; here a stale identity actively credits the wrong
  child.
- **Claim prompt on tracked work.** Starting a quiz or drill while unclaimed
  opens the picker. Browsing does not.
- **Guest** is reachable by dismissing the picker. Guests see only
  `audience: generic` banks and produce no attempts.
- **Lapse or profile switch abandons any open session.** A server session is
  pinned to the user who opened it, and it outlives the 10-minute identity
  lapse by design (2-hour expiry). Without this rule, child A walks away
  mid-quiz, identity lapses, child B walks up to a still-live quiz screen and
  records attempts as A — exactly the accidental mis-credit this identity
  design exists to prevent. So: when identity lapses or the chip is used to
  switch profiles, the client **discards the sessionId and leaves the runner**
  (back to the bank browser, via the claim prompt if lapsed). The abandoned
  session is never resumed; it simply expires server-side. Attempts already
  appended remain, correctly attributed to A. Answering an item **counts as
  interaction** for the lapse timer — a child slowly thinking through a quiz
  is present, not idle.

---

## 7. Grading rules

Pure functions in `2_domains/school/grading.mjs`, one per type, each
`(item, given) -> {correct, expected}`.

- **multiple_choice** — exact match against `answer`.
- **short_answer / cloze** — normalise both sides (trim, collapse internal
  whitespace, casefold) then match against `answer` or any entry in `accept`.
  Normalisation is deliberately conservative: no stemming, no fuzzy distance,
  no punctuation stripping. A child writing "St. Paul" vs "St Paul" should be
  handled by an explicit `accept` entry, not by a clever matcher that will
  eventually accept something wrong.
- **matching** — `given` is an array of `{left, right}`; correct only if every
  pair matches. All-or-nothing, no partial credit, because partial credit on a
  matching item has no obvious correct weighting and would need a design
  decision nobody has made.

Grading must not read the clock or any I/O. Timestamps are applied by
`createAttempt`, which is the only place `new Date()` appears in the domain.

---

## 8. Error handling

| Condition | Behaviour |
|---|---|
| Malformed bank YAML | Excluded from listings; `warn` naming file and reason. Browser still renders |
| Unknown `bankId` | `404` |
| Unknown `itemId` in an answer | `400`; nothing appended |
| Unknown or expired `sessionId` | `410`; UI returns to the bank browser |
| `given` of the wrong shape for the item type | `400`; nothing appended |
| `given` on a flashcard session, or `selfGrade` on a quiz session | `400`; nothing appended — the mode contract (§5) is strict both ways |
| Invalid `mode` on session open | `400` |
| Unknown `userId` on session open | `400` before any file is touched |
| Guest session against `assigned` bank | `403` |
| Attempt append fails (disk/permission) | `500`, and the UI must show the answer as **unrecorded** rather than silently proceeding — a lost attempt is a lost record, and silence here is what makes progress untrustworthy |
| No banks configured | Empty-state copy directing to `data/content/quizzes/`, not an error |

---

## 9. Logging

Per the project logging rule, no raw `console.*`. A category facade
`modules/School/schoolLog.js` delegating to a child logger, following the
`Feed/Scroll/feedLog.js` pattern.

Events to emit from the start:

- `school.profile.claimed` / `school.profile.lapsed` — `{userId, reason}`
- `school.session.start` / `school.session.end` — `{sessionId, bankId, mode, userId|null, itemCount}`
- `school.answer.graded` — `{sessionId, itemId, itemType, correct}` (debug)
- `school.answer.record-failed` — `{sessionId, itemId, error}` (error)
- `school.bank.invalid` — `{file, reason}` (warn, backend)

---

## 10. Testing

**Pure domain** — `tests/isolated/domain/school/`, vitest.
- `questionBankValidation.test.mjs` — each rule, each failure, `audience`
  defaulting to `assigned` when absent, duplicate choices rejected, multi-blank
  cloze rejected.
- `grading.test.mjs` — every type; whitespace/case tolerance; that
  normalisation does *not* accept near-misses it shouldn't; matching
  all-or-nothing.
- `attempt.test.mjs` — shape and id uniqueness.

**Adapter** — `tests/isolated/adapter/school/`, vitest.
- Append-only behaviour: two appends on one day both survive; a second day
  shards to a second file; reading all returns them in order. Mirrors
  `YamlEconomyDatastore.test.mjs`.

**Application** — `tests/isolated/application/school/`, vitest.
- Guest session appends nothing but still returns verdicts.
- Guest against an `assigned` bank is rejected.
- A recorded attempt carries `attributedTo` matching the session user.
- An answer against an unknown session is rejected without appending.
- An answer naming an `itemId` absent from the session's bank is rejected.
- A flashcard `selfGrade` is recorded verbatim with `given: null` and is never
  passed through grading.
- `given` on a flashcard session (and `selfGrade` on a quiz session) is
  rejected without appending.
- Results rollup keeps quiz and flashcard counts separate.

**Frontend** — colocated `.test.jsx`, vitest.
- `ProfilePicker` renders and pages correctly **after the move**, from its new
  path.
- Lapse fires at the threshold and returns to unclaimed.
- Lapse (or a chip profile switch) while a runner is open discards the session
  and leaves the runner — the mis-credit handoff case in §6.
- Answering an item resets the lapse timer.
- Each item type: renders, accepts input, reports the answer.
- `FlashcardRunner` resurfaces a missed item before the session ends (R4.3).
- `QuizRunner` does **not** resurface — one pass, then a summary.

**Regression gate for the extraction.** The moved Piano tests
(`WhoIsPlayingPrompt.test.jsx`, `whoIsPlayingLayout.test.js`,
`whoIsPlaying.test.js`) must pass with **no changes other than import paths and
renames**. Any behavioural edit needed to make them pass means the extraction
changed behaviour and must be reverted and redone. This is the completion gate
for the Piano refactor, per R1.8.

---

## 11. Out of scope

Deferred to later sub-projects, listed so they are not built by accident:

- Courses, video playback, and quiz-gated lesson completion (sub-project 2).
- Curriculum and assignment — what a given child *should* do today
  (sub-project 4). `audience` is the stopgap.
- Parent view, sign-off, and the **reassignment UI** (sub-project 5). This
  slice makes reassignment *possible* by storing attributable events; it does
  not build the tool that performs it.
- Economy payouts for quiz completion (sub-project 6).
- Spaced repetition or any persistent scheduling (R4.3 — retrofittable from
  the attempt log later).
- Converging Piano's identity container onto a shared one (§3).
- Zoom launching (R11 — already works; only the touch affordance gap in
  `AndroidLaunchCard` is outstanding, tracked as sub-project 8).
