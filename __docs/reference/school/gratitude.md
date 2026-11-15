# Gratitude

The `gratitude` School program asks “What are you grateful for today?” Voice is the usual input; typing earns identical credit. “I'm grateful for my toys” is valid and stores “Toys” in the existing Gratitude collection. Length, eloquence, and explanation are not requirements.

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

Each topic can earn credit once every seven study-day dates: Monday becomes eligible again the following Monday. Weekends and holidays count; there is no calendar-week reset. Histories are per learner. Synonyms, trivial qualifiers, cosmetic rewording, and splitting a broad topic into small subtopics repeat. Genuinely distinct concrete experiences about the same person may qualify.

A confident nonsense/abuse or recent-repetition verdict awards no credit and saves an absolute `retryAt` 30 minutes later. The server enforces it across devices, input methods, refreshes, grants, restarts, and day rollover. Blocked requests do not extend it. A fresh refusal after expiry starts another delay. Other School activities remain available.

Uncertainty requests a clearer answer without a penalty. Microphone denial, speech-floor refusals, transcription failure, model outages, and unreadable evidence never become cheating verdicts or unassessed credit. A saved pending answer can be retried.

## Publication and recovery

After acceptance, a cheap configured `IAIGateway.chatStructured` model extracts one concise faithful subject, preserving specific reasons/events. Multiple things become one combined subject and still earn at most one credit. School preserves a publication intent before invoking the Gratitude owner's idempotent `publishSchoolGratitude` callback. Completion follows confirmed storage. Stable selection identity prevents duplicates after crashes and lost responses. Normal Gratitude bootstrap, history, and printing consume the existing selection shape.

Server-persisted WebSocket updates carry `topic: gratitude`, `action: item_added`, `source: school`, and `persisted: true`. Displays merge stable IDs and do not POST them again.

## Shared layers and access

Debrief and Gratitude reuse `Programs/shared/ReflectionResponse`, program keyboard controls, the recorder/speech floor and idle helper, `YamlProgramDayStore`, `FilesystemProgramAudio`, `HmacProgramDayGrantIssuer`, and `captureProgramTake`. Debrief's wrappers retain its disk paths, tokens, input shortcuts, prompts, and scoring. Each program keeps its own reducer, launcher, service, and rubric.

Append-only evidence lives at `school/records/gratitude/{learnerId}/{studyDay}.yml`; audio is under `media/school/gratitude/{learnerId}/`. Audio is saved before transcription. Evidence retains original/final text, edits, method, verdict/confidence/model/rubric, repetition matches, cooldowns, and publication state. Corrupt history prevents assessment instead of becoming empty history.

Learner routes under `/api/v1/school/gratitude/{learnerId}/day/{studyDay}` require `X-School-Gratitude-Grant`, bound to learner, program purpose, and allowed days. Verification precedes body parsing; cooldown checks precede take buffering. Audio references must name the learner's saved take. Teacher history/audio reads use the teacher gate. The normal direct door is `/school/go/{learnerId}/gratitude`. Per-tab launch persistence restores refreshes; server checks remain authoritative.

## Configuration and checks

`school.yml` supports `gratitude.judge.{model,min_confidence,timeout_ms}` and `gratitude.extractor.{model,timeout_ms}`. Defaults: calibrated minimum confidence 0.8, model deadlines 8 seconds, extraction using the configured Debrief judge model or the project's cheap model default. Spacing is seven days; the consequence is 30 minutes. AI usage is scoped to `{app: school, feature: gratitude}`.

Structured events use `school.gratitude.*` and `school.gratitude.ui.*`; routine logs omit full transcripts. The School module's `cli/gratitude-calibrate.mjs` checks synthetic cases through the real judge and writes a private report. Calibration is a sample, not a guarantee. `cli/enroll-gratitude.mjs` defaults to an add-only dry run, applies with `--apply`, preserves current enrollments, and refuses stale edits.

`tests/live/flow/school/school-gratitude.runtime.test.mjs` intercepts every API request against a frontend-only server. Run it alongside Debrief's runtime regression after shared changes. It covers typing, completion, nonsense/repetition cooldowns, reload, and leaving to other work at 1280×800. No live household backend is needed.
