# Gratitude

The `gratitude` School program asks “What are you grateful for today?” Voice is the usual input; typing earns identical credit. “I'm grateful for my toys” is valid and stores “Toys” in the existing Gratitude collection. Length, eloquence, and explanation are not requirements.

## What the child sees

A close X at the top right (`aria-label="Close"`; Arrow Left does the same), the question, an answer box, Record (secondary) and Submit (primary; while recording, Stop takes the primary style). The box does not take focus, so no on-screen keyboard appears unless the child taps it to type. From Stop until the words arrive (the recorder's saving phase, then the upload and transcription), the screen says "Writing down what you said…". When the words arrive they fill the box and the screen says "Check your words, then tap Submit."; the box still does not take focus. A saved recording with no words keeps "Your recording is saved. Please type your answer or try recording again." From a physical keyboard, a printable key pressed while nothing editable has focus moves focus to the box and adds that character to it; Space instead records while the box is empty or a take is running. Enter submits, and Tab still reads the question aloud. The hint goes away when the box is emptied and does not come back until the next transcript. Once an answer is submitted or the day is complete, no draft is saved again, including from the answer box losing focus as the screen changes.

These come from opt-in props on the shared `ReflectionResponse` (`focusOnOpen`, `focusAfterTake`, `transcribingLabel`, `afterTakeHint`). Their defaults keep the earlier behavior, which School Debrief still uses. The screen logs `school.gratitude.ui.transcribing` when an upload starts (a new take, Retry recording upload, or Retry saved recording) and `school.gratitude.ui.closed` (with the phase) when the close control or Arrow Left is used; neither carries the child's words.

## Enrollment

Add one entry to a learner's `programs` list through the normal assignment service:

```yaml
- programId: gratitude
  corpusId: null
  title: Gratitude
  subject: scripture
  schedule:
    daysOfWeek: [1, 2, 3, 4, 5]
```

The shelf is Scripture & Gospel; the unit is `gratitude:daily`. One accepted submission completes each scheduled study day. Household calendar exceptions apply. The program never becomes terminal and adds no separate coin payout rule. The study day uses the household timezone and 4am boundary. New backdated submissions are refused; already submitted pending work recovers into its original day.

## Assessment and spacing

`IDecisionGateway` (Jev) assesses meaningful effort and semantic novelty using the learner's recent accepted statements and subjects. All learner words are untrusted data. The rubric accepts ordinary subjects, short noun phrases, Korean or English, imperfect spelling, and playful but coherent gratitude. It assesses observable content rather than claiming to know sincerity.

Each topic can earn credit once every seven study-day dates: Monday becomes eligible again the following Monday. Weekends and holidays count; there is no calendar-week reset. Histories are per learner. Synonyms, trivial qualifiers, cosmetic rewording, and splitting a broad topic into small subtopics repeat. Distinct concrete experiences about the same person may qualify.

A confident nonsense/abuse or recent-repetition verdict awards no credit and saves an absolute `retryAt` 30 minutes later. The server enforces it across devices, input methods, refreshes, grants, restarts, and day rollover. Blocked requests do not extend it. A fresh refusal after expiry starts another delay. Other School activities remain available.

Uncertainty requests a clearer answer without a penalty. Microphone denial, speech-floor refusals, transcription failure, model outages, and unreadable evidence never become cheating verdicts or unassessed credit. A saved pending answer can be retried.

## Publication and recovery

After acceptance, a cheap configured `IAIGateway.chatStructured` model extracts one concise faithful subject: it drops only the framing ("I am grateful for") and keeps the action or activity and any specific person, place or event ("I am grateful for eating cookies" becomes "Eating cookies"). The prompt also tells the model to keep the child's own language and never translate; sentence case applies only to languages that have letter case. `normalizeGratitudeSubject` (`GratitudeSubject.mjs`) then strips trailing punctuation, wrapping quotes and a leftover framing phrase (repeating until nothing changes, so a frame-only answer becomes empty and quotes inside a frame go), and applies the household list's sentence case: the first letter or digit decides, so a leading digit ("3 new friends") and an already mixed-case word ("iPad time") are left alone, Korean is unchanged, and the rest stays as the model returned it so names keep their capitals. It refuses an empty subject or one over 160 characters; the limit applies to the cleaned subject, not the raw model answer. Casing never depends on the model. Code never rebuilds a phrase the model shortened; the prompt's examples carry that rule, and a test pins the activity example. Multiple things become one combined subject and still earn at most one credit. School preserves a publication intent before invoking the Gratitude owner's idempotent `publishSchoolGratitude` callback. Completion follows confirmed storage. Stable selection identity prevents duplicates after crashes and lost responses. Normal Gratitude bootstrap, history, and printing consume the existing selection shape.

Server-persisted WebSocket updates carry `topic: gratitude`, `action: item_added`, `source: school`, and `persisted: true`. Displays merge stable IDs and do not POST them again.

## Shared layers and access

Debrief and Gratitude reuse `Programs/shared/ReflectionResponse`, program keyboard controls, the recorder/speech floor and idle helper, `YamlProgramDayStore`, `FilesystemProgramAudio`, `HmacProgramDayGrantIssuer`, and `captureProgramTake`. Debrief's wrappers retain its disk paths, tokens, input shortcuts, prompts, and scoring. Each program keeps its own reducer, launcher, service, and rubric.

Append-only evidence lives at `school/records/gratitude/{learnerId}/{studyDay}.yml`; audio is under `media/school/gratitude/{learnerId}/`. Audio is saved before transcription. Evidence retains original/final text, edits, method, verdict/confidence/model/rubric, repetition matches, cooldowns, and publication state. Corrupt history prevents assessment instead of becoming empty history.

Learner routes under `/api/v1/school/gratitude/{learnerId}/day/{studyDay}` require `X-School-Gratitude-Grant`, bound to learner, program purpose, and allowed days. Verification precedes body parsing; cooldown checks precede take buffering. Audio references must name the learner's saved take. Teacher history/audio reads use the teacher gate. The normal direct door is `/school/go/{learnerId}/gratitude`. Per-tab launch persistence restores refreshes; server checks remain authoritative.

## Configuration and checks

`school.yml` supports `gratitude.judge.{model,min_confidence,timeout_ms}` and `gratitude.extractor.{model,timeout_ms}`. Defaults: calibrated minimum confidence 0.8, model deadlines 8 seconds, extraction using the configured Debrief judge model or the project's cheap model default. Spacing is seven days; the consequence is 30 minutes. AI usage is scoped to `{app: school, feature: gratitude}`.

Structured events use `school.gratitude.*` and `school.gratitude.ui.*`; routine logs omit full transcripts. The School module's `cli/gratitude-calibrate.mjs` checks synthetic cases through the real judge and writes a private report. Calibration is a sample, not a guarantee. `cli/enroll-gratitude.mjs` defaults to an add-only dry run, applies with `--apply`, preserves current enrollments, and refuses stale edits.

`tests/live/flow/school/school-gratitude.runtime.test.mjs` intercepts every API request against a frontend-only server. Run it alongside Debrief's runtime regression after shared changes. It covers typing, completion, nonsense/repetition cooldowns, reload, and leaving to other work at 1280×800. No live household backend is needed.
