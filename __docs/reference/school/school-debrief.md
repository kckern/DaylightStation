# School debrief

A short daily after-school debrief for a learner who attends an outside school.
None of that learner's schoolwork reaches the household School system, so each
day they say or type what they did and learned, an AI asks a few follow-up
questions grounded in what they said, and the day is recorded. It is a
**program** in the story-time shape (see [Programs](./programs.md)): an entry in
`assignment.programs[]`, a launcher, a Portal runner. There is no course behind
it.

- Program id `school-debrief`, unit id `school-debrief:daily`, title
  "After-school debrief".
- Code: `__app_modules/learning/school/` (`server/domain/schoolDebrief.mjs`,
  `server/application/debrief/`, `server/api/schoolDebrief.mjs`,
  `browser/Programs/SchoolDebrief/`).

## Enrollment

A program enrollment in the learner's plan,
`plans/learners/{learnerId}.yml` under `assignment.programs[]`:

```yaml
- programId: school-debrief
  corpusId: null            # dedupe key: one debrief enrollment per learner
  subject: writing          # nearest of the nine shelves; defaults to writing
  title: After-school debrief
  schedule:
    daysOfWeek: [1, 2, 3, 4, 5]
    except:                 # the outside school's days off, entered per term
      - { from: '<yyyy-mm-dd>', to: '<yyyy-mm-dd>', label: <label> }
```

`appendAssignedProgramEntries` projects it as a `cadence: 'daily'` agenda entry
that prints with a panel code. There is no `target`: one debrief per day is the
obligation, and the program is never terminal. A day outside `daysOfWeek`, inside
an `except` range, or excused by the household calendar is not owed. A day the
school was open but the debrief does not apply to can be excused by a grown-up.

## Records

Store: `<household>/school/records/debriefs/{learnerId}/{studyDay}.yml`, one file
per study day. The day is the household 4am-to-4am study day, never a UTC date.
Each file is an append-only event list; state is derived on every read.

| Event | Carries |
|---|---|
| `opened` | at, input, late |
| `entry` | promptId, text, via (`voice`/`typed`), audioRef, at. A resubmitted prompt supersedes the earlier one. |
| `clarify-asked` / `clarify` | the AI's "tell me more" prompt; the learner's reply |
| `questions` | substance, substanceReason, questions with answer keys, model, questioner (`model`/`fallback`). Written **before** any question is shown. |
| `answer` | questionId, response, correct (true/false/null for ungraded), grade, reason |
| `completed` | at; the summary is derived |
| `excused` / `rejected` | by, reason (grown-up only) |
| `rescored` | replaces substance for a fallback day; replaces the questions too only while none has been answered |

- **Derived state:** `not-started -> entry -> (clarify) -> questions -> answering
  -> completed`, with `excused` or `rejected` as overrides. Every state before
  completion has a defined next step (`next`), so no state is a dead end.
- **Late:** yesterday's debrief is written into **yesterday's** file with
  `late: true`. It can be done during the next study day (a Friday debrief has
  until the end of Saturday's study day). Older days are closed. Only the
  learner's own events carry `late`; `excused`, `rejected` and `rescored` never
  do, so a grown-up acting the next day cannot make an on-time day late.
- **Read failures:** a missing file reads as empty. A corrupt file is preserved
  as `*.yml.corrupt-*` and never overwritten. An unreadable store makes the
  launcher report `error: true`, never a false zero.
- **Audio:** kept on the media mount, `media/school/debriefs/{learnerId}/`, never
  in the data volume or the repo. The transcript is the record; the audio is
  there for a grown-up to listen to.

## Launcher

`SchoolDebriefProgramLauncher` (registered in code, like `sentence-ladder`):

- `doneToday`: a `completed` event, or `excused`.
- `obligationProgress`: `{completed: 0|1, total: 1}` plus a label (`Not started`,
  `Telling`, `Questions`, `Done`, `Excused`, `Talk to a grown-up` for a rejected
  day).
- `owedDays(learnerId, {from, to})`: the owed study days in a range (never past
  today; default the last 14 owed days). The teacher history uses it to list
  missed days that have no file.
- `servedWork`: `[{unitId: 'school-debrief:daily', title}]` when done, else `[]`.
- `error: true` when the store cannot be read.

`launch()` and the code-free door (`issueLaunchTarget`, used by
`/school/go/{learnerId}/school-debrief`) return
`{kind: 'program', program: 'school-debrief', learnerId, debriefGrant, today, lateDay}`.
The grant is an HMAC token bound to the learner and the study days it may write
(today, plus yesterday while still in grace). Every write route requires it in
the `X-School-Debrief-Grant` header.

The term grid replays a past day only from evidence stamped before that day
closed, so a late debrief leaves yesterday showing missed. That is intended: the
grid shows the on-time habit, and the grace day only affects pay.

## AI

Two fixed-shape `IAIGateway.chatStructured` calls under the usage tags
`{app: 'school', feature: 'debrief'}`. No agent runtime. Both use
`reasoningEffort` (the models are reasoning models) and send **no temperature**.

Config under `school.yml -> debrief:`, read once at startup:

```yaml
debrief:
  questioner: { model: gpt-5-mini, timeout_ms: 30000 }
  judge:      { model: gpt-5-nano, timeout_ms: 8000 }
  substantive_score: 6
  clarify_below: 4
  quiz_pass_ratio: 0.67
```

**`DebriefQuestioner`** returns `{substance 1-10, substanceReason, clarify,
questions}`: two to four multiple-choice and at most one short-answer question,
each answerable from what the learner said plus ordinary grade-level knowledge.
The entry is passed as a JSON data field and anything in it that reads as an
instruction is ignored. Prompts from the last five debriefs are passed so it does
not repeat itself.

- **One "tell me more" round** when `substance < clarify_below`: the learner sees
  the `clarify` prompt once, their reply is appended, and the call runs again.
  Never a second round.
- **Fallback:** a schema failure gets one retry. A second failure, a timeout or
  an unconfigured gateway uses fixed questions built from the learner's own
  answers: "which of these did you say you had today?" (one class they named
  among ones they did not, in an order that varies with the text) and "explain
  it to a younger kid". The event is marked `questioner: 'fallback'`: both the
  substantive and the quiz bonus are withheld (the questions come from the
  child's own words, so passing them proves little), and a grown-up can
  re-score.

**`DebriefAnswerJudge`:** multiple choice is graded in code against the stored
key. The short answer gets one call returning a 1-10 grade and a reason against
`expected`; 6 or more is correct. A failed grade is `correct: null` and is left
out of the quiz ratio. An optional decision gateway scores in parallel and is
only logged (shadow).

**Transcription:** `IAIGateway.transcribe` when a take is kept. If it fails the
take is kept and the learner is offered typing.

Answer keys never leave the server before the matching answer is recorded.

## Economy

The economy never reads School files. `ISchoolEarningEvidence.schoolWeek`
carries a `debriefs` fact list
(`{day, state, timeliness, substantive, quiz: {right, graded}}`); a learner with
no debrief enrollment gets `[]`. See [Economy](../economy/economy.md) for the
two rule kinds, `debrief-day` and `debrief-week`.

**Coins are preview only.** The rules sit in `earn-rules.yml` and mint when
weekly payout ships. Until the economy is live, kid surfaces show
**"Coins start soon"** and never a silver figure. The summary reads the bank
once; only `mode: live` shows earned lines (from the weekly preview, 2-second
limit, any failure shows no coin line).

## Screens and keys

`browser/Programs/SchoolDebrief/`. Readable at 1280x800 (the Portal). Esc is
never bound (FKB captures it). One key map per screen:

| Screen | Keys |
|---|---|
| Start card (today / resume / yesterday late) | Enter starts the first offer; 1-2 pick an offer |
| Prompt x3 (classes; one thing learned, required; hard/funny/interesting) and "tell me more" | typing goes in the field; Space records or stops **only when the field is empty** (or while recording) and never types a space then; Enter submits; Tab reads the prompt aloud; Left arrow goes back |
| Choice (2-4) | 1-4 or A-D answer; result and correct answer show at once; Space or Enter continues |
| Short answer | as Prompt, then Space or Enter continues |
| Summary | Enter finishes |
| "Talk to a grown-up" (a rejected day) | Enter finishes |

- Each prompt is saved when submitted; walking away loses at most the field the
  learner was in.
- After 45 seconds idle a "Still there?" nudge appears; 5 minutes after the last
  input the program closes to the keypad (on every screen, the start card
  included) and the start card offers to resume.
- A rejected day shows "A grown-up wants to talk with you about this one." with
  a Done button (Enter); the start card offers no resume for it.
- The mic is open only while recording. A refused take says why; typing is always
  available; with no mic API the record control is absent.

## Routes

Under `/api/v1/school/debrief/`.

| Route | Purpose |
|---|---|
| `GET  /:learnerId/day/:studyDay` | derived state (start card, resume) |
| `POST /:learnerId/day/:studyDay/open` | the `opened` event |
| `POST /:learnerId/day/:studyDay/take` | audio -> media mount + transcription -> `{audioRef, text}` |
| `POST /:learnerId/day/:studyDay/entry` | one prompt's text |
| `POST /:learnerId/day/:studyDay/submit` | runs the questioner (or returns the clarify prompt) |
| `POST /:learnerId/day/:studyDay/clarify` | the "tell me more" reply |
| `POST /:learnerId/day/:studyDay/answer` | one answer -> grade and the correct answer |
| `POST /:learnerId/day/:studyDay/complete` | the `completed` event -> summary |
| `GET  /teacher/:learnerId/history` | days with entries, questions, answers, plus owed days with no file as `not-started` and unreadable ones as `unreadable` (teacher; optional `from`/`to`) |
| `GET  /teacher/:learnerId/audio/:file` | a take's audio (teacher) |
| `POST /teacher/:learnerId/day/:day/{excuse,reject,rescore}` | overrides (teacher) |

Learner routes need the grant header. Teacher routes go through the teacher
gate and require a teacher id: `?by=<teacherId>` on GET, `by` in the JSON body on
POST, plus the PIN or capability proof. A malformed day or range is a 400.

## Operations

- **Where things live:** records `<household>/school/records/debriefs/{learnerId}/`;
  audio `media/school/debriefs/{learnerId}/`; config `school.yml -> debrief:`.
- **Log events** (`context.app:school`): `school.debrief.opened`, `.entry`,
  `.clarify`, `.questions` (score, count, model, ms), `.answer`, `.completed`,
  `.excused` / `.rejected` / `.rescored` (learnerId, day, by), `.launch-failed`
  (warn), plus `school.direct-launch.issued` for the code-free door. Browser events come
  from the `schoolDebriefLog` facade (`mounted`, `take.*`, `submit`, `stall`,
  `resume`, API failures). AI spend is under `school/debrief` in the usage ledger.
- **Excuse, reject, re-score:** the teacher console's Debriefs tab, behind the
  teacher PIN gate. Excuse pays nothing and does not block the week bonus (but a
  week with no completed day earns no week bonus); reject pays nothing and
  blocks it. Re-score asks the AI again for a fallback day: it replaces the
  score, and replaces the questions only while none has been answered. Once
  answers exist the questions (and their grades) stay; only the score changes.
  A missed day with no file is listed and can be excused.
- **Open one without a code (admin/testing):** `/school/go/{learnerId}/school-debrief`.
- **Frontend test:** `tests/live/flow/school/school-debrief.runtime.test.mjs`
  mocks every backend call in the browser (`page.route`), so it writes nothing
  and runs against any frontend-only server via `SCHOOL_DEBRIEF_BASE`. It
  screenshots each step at 1280x800 to `test-results/school-debrief/`.
