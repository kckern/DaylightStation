# School debrief

A short daily after-school debrief for a learner who attends an outside school.
None of that learner's schoolwork reaches the household School system, so each
day they say or type one real moment and something they can now explain, an AI
scores how specific it was, asks for more until it is explainable, then asks a
couple of follow-up questions, and the day is recorded. It is a
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

## Prompts

Four prompts, fixed ids and copy (`PROMPTS` in `server/domain/schoolDebrief.mjs`;
the server sends them to the kiosk in `prompts`, with `{teachTo}` filled in):

| Id | Copy | Kind |
|---|---|---|
| `classes` | Which classes did you have today? | class chips, optional |
| `moment` | Tell me about one moment from today. Where were you, who was there, what happened? | text, required |
| `teach` | What can you do or know now that you couldn't this morning? Explain it so {teachTo} could try it. | text, required |
| `hard` | What was hard, and what did you do about it? | text, optional |

- **Class chips:** the `classes` prompt shows `class_options` as tappable chips
  (the first ten also answer to the digits 1-9 and 0), plus an "Other" field. The
  pick is saved as one comma-joined entry (`via: chips`); an empty pick may be
  submitted.
- **Legacy entries:** a day begun before this prompt set holds `learned` /
  `notable` entries. They stay in the day's state, still reach the questioner,
  and a legacy `learned` satisfies the required `teach`. Legacy days are never
  re-scored: they keep `substance` (1-10) and have no `level`.
- **Legacy prompt ids on a new entry:** a Portal still running the old bundle
  posts `learned` or `notable`. The server accepts them and saves them as
  `teach` and `hard` (logging `school.debrief.legacy-prompt-id` with `from` /
  `to`), so nothing the child typed is lost. The old kiosk still cannot finish
  the day: submit needs `moment`, which the old bundle never asks. It can finish
  once the kiosk reloads, which every deploy does. Any other unknown id is a 400.

## Records

Store: `<household>/school/records/debriefs/{learnerId}/{studyDay}.yml`, one file
per study day. The day is the household 4am-to-4am study day, never a UTC date.
Each file is an append-only event list; state is derived on every read.

| Event | Carries |
|---|---|
| `opened` | at, input, late |
| `entry` | promptId, text, via (`voice`/`typed`), audioRef, at. A resubmitted prompt supersedes the earlier one. |
| `clarify-asked` / `clarify` | a probe and the learner's reply. Repeats up to `max_probes` times in one day; each reply pairs with the open probe. |
| `questions` | level (0-5), levelReason, hook, questions with answer keys, model, questioner (`model`/`fallback`), questionSource (where the *questions* came from). Written **before** any question is shown. Day files from before the redesign carry `substance` / `substanceReason` here instead. |
| `answer` | questionId, response, correct (true/false/null for ungraded), grade, reason |
| `completed` | at; the summary is derived |
| `excused` / `rejected` | by, reason (grown-up only) |
| `discussed` | by (grown-up only): "We talked about it". Never late, never changes the phase or pay. |
| `rescored` | replaces level, levelReason and hook for a fallback day; replaces the questions too only while none has been answered (kept fallback questions are marked `questionSource: fallback`) |

- **Derived state:** `not-started -> entry -> (clarify, repeated) -> questions -> answering
  -> completed`, with `excused` or `rejected` as overrides. Every state before
  completion has a defined next step (`next`), so no state is a dead end.
- **Late:** yesterday's debrief is written into **yesterday's** file with
  `late: true`. It can be done during the next study day (a Friday debrief has
  until the end of Saturday's study day). Older days are closed. Only the
  learner's own events carry `late`; `excused`, `rejected`, `rescored` and `discussed` never
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
Learner words reach a model only as a JSON data field, and every system prompt
tells it never to follow instructions found in that data.

Config under `school.yml -> debrief:` (snake_case), read once at startup;
defaults live in `debriefConfigOf`:

```yaml
debrief:
  questioner: { model: gpt-5-mini, timeout_ms: 30000 }
  judge:      { model: gpt-5-nano, timeout_ms: 8000 }
  rich_level: 3            # level at or above this on time = "told a real moment"
  teachable_level: 4       # level at or above this = "explained it"; also where probing stops
  max_probes: 2            # most probes asked in one day
  teach_to: a younger kid  # fills {teachTo} in the `teach` prompt
  class_options: [Reading, Writing, Math, Typing, Spelling, Grammar, Science, P.E., Art, Music, Quest, Field trip]
  prior_prompt_days: 20    # days of earlier question prompts passed to the questioner
  # legacy days only:
  substantive_score: 6     # substance (1-10) a pre-rubric day needed
  quiz_pass_ratio: 0.67    # share of graded follow-ups right for `quiz-passed`
```

**`DebriefQuestioner`** is the one call after the prompts. It returns
`{level, levelReason, probe, hook, questions}`:

| Level | Meaning |
|---|---|
| 0 | empty, evasive or off-topic |
| 1 | names a topic only ("more division") |
| 2 | names a skill or fact |
| 3 | a concrete event: who, where, what happened |
| 4 | explains how it works or how to do it, step by step |
| 5 | level 4 plus why it mattered or what they would do next |

- `levelReason` is one sentence to the child, in the language they wrote
  (Korean or English), naming what was good or what would make it richer.
- `probe` is one question that quotes the child's own words and asks for how,
  steps or an example (never "say more"); null at level 4 and above.
- `hook` is a parent conversation starter, under 90 characters, naming something
  concrete from the account.
- `questions`: one or two follow-ups, at most one multiple choice (3-4 options,
  exactly one correct) that applies the idea to a new case, and at most one short
  answer with an `expected` example. They never ask what the child already said.

**Probe loop.** After the prompts (`submit`) and after every probe reply
(`clarify`) the questioner runs again with all earlier probes and answers. A
probe is shown only while `level < teachable_level` and fewer than `max_probes`
have been asked; otherwise the questions freeze, whatever the level. So the loop
stops at the teachable level or after `max_probes` probes, never a third.

**Question guards** (`filterQuestions`, applied to the model's questions):
echo questions ("the child", "you said", "did you say", "did you have", "according to you") are
dropped, as is any prompt equal (case and punctuation aside) to one asked in the
last `prior_prompt_days` debrief days, or duplicated within the list. If every
question is dropped the deterministic fallback question is used and the event is
marked `questionSource: fallback` (the child is never shown zero questions).

**Fallback.** A schema failure gets one retry. A second failure, a timeout or an
unconfigured gateway gives `questioner: 'fallback'` with no level: one question
built from the learner's own `teach` words ("What is one step someone would need
to try what you explained?"). Two cases differ in what they withhold:

- `questioner: 'fallback'` (the AI never scored the day): no level, so no
  `substantive` and no `teachable`, and its questions are the fallback's, so no
  `quiz-passed` either. A grown-up can re-score it.
- `questionSource: 'fallback'` with `questioner: 'model'` (the AI scored the day,
  but every question it wrote was filtered out, or a re-score kept answered
  fallback questions): the level stands, so `substantive` and `teachable` are
  earned as usual; only `quiz-passed` is withheld, because questions built from
  the child's own words prove little.

**`DebriefAnswerJudge`:** multiple choice is graded in code against the stored
key. A short answer gets one call returning a 1-10 grade and a reason against
`expected`, and 6 or more is correct. The judge is lenient: `expected` is one
example answer, not the only one; any sensible answer passes, in Korean or
English, in any spelling, and extra correct detail is never a fault. A failed
grade is `correct: null` and is left out of the quiz ratio. An optional decision
gateway scores in parallel and is only logged (shadow).

**Transcription:** `IAIGateway.transcribe` when a take is kept. If it fails the
take is kept and the learner is offered typing.

**Voice floor.** The debrief uses its own, gentler take floor (`DEBRIEF_FLOOR`
in `browser/Programs/shared/speechFloor.js`): a level threshold of 0.02 (the
shared floor's is 0.04) so a soft talker telling a longer story is heard, with
the same 1.2 s minimum length. Other School programs keep the shared floor. A
refused take logs `school.debrief.ui.take.refused` with its verdict.

Answer keys never leave the server before the matching answer is recorded.

## Economy

The economy never reads School files. `ISchoolEarningEvidence.schoolWeek`
carries a `debriefs` fact list
(`{day, state, timeliness, substantive, teachable, quiz: {right, graded}}`); a learner with
no debrief enrollment gets `[]`. See [Economy](../economy/economy.md) for the
two rule kinds, `debrief-day` and `debrief-week`.

The pay maximum is 4 silver a day: never per word, per minute, or for voice.
The rules in `earn-rules.yml` read these facts:

| Rule id | Criterion | Pays when |
|---|---|---|
| `debrief-done` | `completed` | the day is completed (late counts) |
| `debrief-substantive` | `substantive` | completed on time by a model-scored day with `level >= rich_level` |
| `debrief-teachable` | `teachable` | completed by a model-scored day with `level >= teachable_level` (late counts) |
| week bonus | `debrief-week` | every owed day completed or excused, at least one completed |

A legacy day (no `level`) keeps the old rule: `substantive` needs
`substance >= substantive_score`; it can never be `teachable`. A day the AI
never scored (`questioner: 'fallback'`) earns neither `substantive` nor
`teachable`. A day whose questions fell back but whose level the AI set
(`questionSource: 'fallback'`) keeps both and loses only `quiz-passed`.
`quiz-passed` is still a valid criterion but the shipped rules do not use it.

**Visible reasons.** The summary tells the child why, from the same facts the
economy reads: their `levelReason` as the quote, "You told me a real moment"
when the day is `substantive`, "You explained it so someone could try it" when
it is `teachable`, and On time / Late. No score or level number is shown to the
child.

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
| Classes chips | 1-9 and 0 toggle the first ten chips; Enter submits (empty is fine); Left arrow goes back; digits are ignored while the Other field has focus |
| Prompt x3 (moment, teach, hard) | typing goes in the field; Space records or stops **only when the field is empty** (or while recording) and never types a space then; Enter submits; Tab reads the prompt aloud; Left arrow goes back |
| Each probe | as Prompt, but no Back (a probe follows a submit and cannot be stepped back from). If a reply fails to send, the kiosk re-reads the day: when the server got it anyway, the next probe (or the questions) shows; otherwise the words stay in the field and Enter sends them again. The server treats a resend of the last saved reply as a no-op and returns the day |
| Choice (2-4) | 1-4 or A-D answer; result and correct answer show at once; Space or Enter continues |
| Short answer | as Prompt, then Space or Enter continues |
| Summary | Enter or Space finishes |
| "Talk to a grown-up" (a rejected day) | Enter finishes |

- Each probe is its own prompt screen: a reply never carries into the next probe.
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
| `POST /:learnerId/day/:studyDay/submit` | runs the questioner: returns a probe or the frozen questions. The view carries `prompts`, `classOptions`, `probes`, `level`, `levelReason`. |
| `POST /:learnerId/day/:studyDay/clarify` | a probe's reply; returns the next probe or the questions |
| `POST /:learnerId/day/:studyDay/answer` | one answer -> grade and the correct answer |
| `POST /:learnerId/day/:studyDay/complete` | the `completed` event -> summary |
| `GET  /teacher/:learnerId/history` | days with entries, level, levelReason, hook, probes, `discussedAt`, questions, answers, plus owed days with no file as `not-started` and unreadable ones as `unreadable` (teacher; optional `from`/`to`) |
| `GET  /teacher/:learnerId/audio/:file` | a take's audio (teacher) |
| `POST /teacher/:learnerId/day/:day/{excuse,reject,rescore}` | overrides (teacher) |
| `POST /teacher/:learnerId/day/:day/discussed` | the `discussed` event: "We talked about it" (teacher) |

Learner routes need the grant header. Teacher routes go through the teacher
gate and require a teacher id: `?by=<teacherId>` on GET, `by` in the JSON body on
POST, plus the PIN or capability proof. A malformed day or range is a 400.

## Operations

- **Where things live:** records `<household>/school/records/debriefs/{learnerId}/`;
  audio `media/school/debriefs/{learnerId}/`; config `school.yml -> debrief:`.
- **Log events** (`context.app:school`): `school.debrief.opened`, `.entry`,
  `.clarify` (a probe was asked: level, asked), `.questions` (level, count,
  questioner, model, ms), `.questions-filtered` (dropped), `.fallback`,
  `.answer`, `.completed` (summary plus level, words and markers (class chips not counted), probes,
  voiceEntries), `.hook-failed` (warn: the parent push did not go; completion
  still succeeded), `.hook-skipped` (the hook did not read cleanly, so no push),
  `.legacy-prompt-id` (an old-bundle `learned`/`notable` entry was renamed), `.excused` / `.rejected` / `.rescored` / `.discussed`
  (learnerId, day, by), `.launch-failed` (warn), plus `school.direct-launch.issued` for the code-free door. Browser events come
  from the `schoolDebriefLog` facade as `school.debrief.ui.*` (`mounted`,
  `take.start`, `take.kept`, `take.refused`, `submit`, `chips`, `stall`, `resume`, `probe.recovered`,
  API failures). AI spend is under `school/debrief` in the usage ledger.
- **Parent hook push:** when a day completes with a hook, each teacher in
  `school.yml -> teachers` gets one low-priority push (see
  [Push notifications](../notifications/push-standard.md)). It is sent without
  awaiting: no teachers configured or a down notifier logs `.hook-failed` once
  and never fails the child's completion. A hook that does not read cleanly is
  not sent.
- **Teacher panel:** the Debriefs tab shows each day's detail level (`n/5`) and
  its reason, the hook as "Talk about: ...", the probes with the child's
  replies, the entries, and, on a completed day, a "We talked about it" button
  (posts `discussed`; shows "Talked about" afterwards).
- **Excuse, reject, re-score:** the teacher console's Debriefs tab, behind the
  teacher PIN gate. Excuse pays nothing and does not block the week bonus (but a
  week with no completed day earns no week bonus); reject pays nothing and
  blocks it. Re-score asks the AI again for a fallback day: it replaces the
  level, reason and hook, and replaces the questions only while none has been answered. Once
  answers exist the questions (and their grades) stay; only the level, reason and hook change.
  A missed day with no file is listed and can be excused.
- **Open one without a code (admin/testing):** `/school/go/{learnerId}/school-debrief`.
- **Frontend test:** `tests/live/flow/school/school-debrief.runtime.test.mjs`
  mocks every backend call in the browser (`page.route`), so it writes nothing
  and runs against any frontend-only server via `SCHOOL_DEBRIEF_BASE`. It
  screenshots each step at 1280x800 to `test-results/school-debrief/`.

## Is it working

Query the log store (see the Reading Logs section of the project guide):

```bash
# How rich are the days? Count by level (0-5)
_msg:"school.debrief.completed" AND _time:30d | stats by ("data.level") count() as n

# Are answers getting longer and more specific?
_msg:"school.debrief.completed" AND _time:30d | stats avg("data.words") as words, avg("data.markers") as markers

# Is the voice floor refusing takes? Count by verdict
_msg:"school.debrief.ui.take.refused" AND _time:30d | stats by ("data.verdict") count() as n

# Are grown-ups acting on the hooks?
_msg:"school.debrief.discussed" AND _time:30d | stats count() as n
```

Healthy: most days at level 3 or above, words and markers rising over weeks,
few `too-quiet` / `too-short` refusals, `.hook-failed` absent. Many `fallback`
days mean the AI gateway is down or its replies fail the schema (see
`school.debrief.fallback`).
