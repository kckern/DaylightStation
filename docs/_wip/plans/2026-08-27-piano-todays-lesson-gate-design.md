# Piano Kiosk — Today's Lesson Gate (implementation-ready design)

**Status:** design, verified against code 2026-08-27, not yet implemented
**Supersedes:** the same-day requirements draft (rewritten in place)

## 0. What changed from the original draft, and why

The draft's core architecture survives review: reuse
`PianoCourseProgramLauncher.status()` as the single source of truth, model the
kiosk hook on `useSchoolGameAccess`, treat `excused` as done, ride the existing
`school` broadcast topic for the live clear, and leave Studio-via-MIDI alone.
All of those claims were re-verified against the real files and hold. Changes:

1. **Namespace resolved (was open question §11.1).** The endpoint lives under
   `/api/v1/school/lifecycle/...`, NOT `/api/v1/piano/kiosk/...`. The draft
   treated this as a coin flip; it is not — the dependency direction decides it.
   See §5.
2. **Parent bypass designed (was non-goal §9 / open question §11.2).** Now in
   scope, per owner decision: the bypass is a Teacher Console write, not an
   on-kiosk `OperatorDrawer` control. It is a **study-day-scoped, append-only
   bypass record** consumed inside `status()` itself, so the agenda, the
   ceremony bridge, and the kiosk gate all agree for free. See §7.
3. **Course-complete hole fixed.** The draft assumed `status().context` names
   the next lesson whenever `doneToday: false`. Reading the launcher shows the
   `context` focus falls back to the *last* lesson when the course is finished
   (`next` is null), and `doneToday` stays `false` forever on a completed
   course — the draft's rule would gate a child who finished Hoffman with a
   card pointing at nothing. Fix: `status()` gains a structural
   `nextLesson: null|{...}` field and the gate requires it. See §6.2.
4. **Bypass write needs its own broadcast.** The draft's live-clear signal
   (`piano-lesson-complete` on topic `school`) only fires on a real lesson
   completion. A Teacher Console bypass happens on a different device and
   would otherwise wait out the 15s poll. The bypass use case broadcasts a
   `program-day-bypass-changed` event on the same topic; the kiosk hook
   listens for both. Precedent: `RecordStoryRead` already broadcasts on this
   topic from a use case. See §7.4.
5. **Small corrections.** The "Who's Playing" chip lives in `PianoChrome`, not
   `PianoMenu`, so it survives the gate with zero work (the draft implied it
   was a menu concern). The kiosk hook must fail **open** on error/404 — the
   opposite of `useSchoolGameAccess`, which fails closed; the doc now says so
   explicitly wherever the model hook is cited.

## 1. Summary

When a learner picks themselves at the piano kiosk ("Who's Playing" →
`PianoUserContext.setCurrentUser`), and they are enrolled in a School
`piano-course` program with an unfinished lesson today, `PianoMenu` stops
showing the normal tile grid and shows **only** a single card: today's
next-up lesson, with thumbnail and tap-to-launch. The moment School considers
the obligation discharged — a real completion, a co-progress excusal, or a
parent bypass — the gate clears live, no reload.

The piano itself is never gated. Sitting down and playing still auto-enters
Studio (`useAutoStudioEntry`), which triggers on `pathname === menuPath`, not
on what `PianoMenu` renders (verified, §9).

## 2. End-to-end data flow

```
                       ┌──────────────── School owns the rule ────────────────┐
Who's-Playing pick ──▶ usePianoLessonGate(learnerId)
                        │  GET /api/v1/school/lifecycle/learners/:id/piano-lesson-gate
                        ▼
                       GetPianoLessonGate (new use case)
                        │  assignments.get(learnerId) → piano-course enrollments
                        │  launcher.status({userId, programInstance}) per enrollment
                        ▼
                       PianoCourseProgramLauncher.status()
                        │  GetPlayableUnits (evidence: userCompletedAt, co-progress lock)
                        │  dayBypasses.activeFor(...)   ◀── NEW (parent bypass, §7)
                        ▼
              {gated, reason, course, unit, lesson}
                        │
        gated=true ──▶ PianoMenu renders <TodaysLessonGate/> (replaces tiles+activity)
                        │  tap → openPianoCourseLesson() → /videos/:courseId/:lessonId
                        ▼
              child completes lesson → play.mjs publishes piano.lesson.completed
                        │
                       PianoLessonCeremonyBridge → broadcast topic 'school'
                        │  {event:'piano-lesson-complete', learnerId, ...}
                        ▼
              usePianoLessonGate hears it → refetch → gated:false → normal menu

Parent bypass (different device):
Teacher Console (Student → Operations) → POST /api/v1/school/program-day-bypasses
  → ManageProgramDayBypass (teacherGate.assert) → YamlProgramDayBypassStore.append
  → broadcast topic 'school' {event:'program-day-bypass-changed', learnerId, ...}
  → kiosk hook refetches → status() now sees the bypass → gated:false
```

## 3. Verified foundations (what the code actually does)

- **`PianoCourseProgramLauncher.status()`**
  (`backend/src/3_applications/school/PianoCourseProgramLauncher.mjs`) returns
  `{doneToday, excused?, error?, score, context:{course,unit,lesson},
  progress, progressLabel, completedLessons, completedLessonsToday}`. The
  study day rolls at 4am (`BOUNDARY_HOUR = 4`, `isSameStudyDay` from
  `#domains/school/studyDay.mjs`). `context.lesson` carries `thumbnail`
  (house-proxied path only) and `description` (sanitized) when present.
  Evidence order: `completedToday` first, then the co-progress lock
  (`excused: true` only when the lock blocks the next lesson AND does not
  exempt it), then owed.
- **`GetPlayableUnits`**
  (`backend/src/3_applications/piano/usecases/GetPlayableUnits.mjs`) is
  injected into the launcher (Decision D1 — a use case never imports a
  concrete adapter) and separately takes `schoolAssignments` to mint the
  co-progress `exemptLessonIds` for today's assigned lesson. Its guard fails
  **closed** for the exemption (an unreadable assignment file is not evidence
  a lesson was assigned) — that posture is correct and unchanged.
- **`PianoLessonCeremonyBridge`**
  (`backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs`)
  subscribes to `piano.lesson.completed`, re-derives via `status()`, and
  broadcasts `{event:'piano-lesson-complete', learnerId, student, courseId,
  lesson, progressLabel, score, studyDate, timestamp}` on
  `CEREMONY_TOPIC = 'school'`. `WebSocketEventBus.broadcast(topic, payload)`
  sends `{topic, timestamp, ...payload}` to every WS client subscribed to the
  topic or `'*'` — and the frontend `WebSocketService` syncs subscriptions as
  `'*'`, so the kiosk receives it (same transport `useScanCeremony` and
  `useSchoolLaunch` already consume). The excused day never chimes
  (`status?.excused === true` → return) and a bypass never reaches the bridge
  at all (it only wakes on completion events).
- **Mounts:** `v1Routers.school` → `/api/v1/school` (`school.mjs`);
  `schoolLifecycle.router` → `/api/v1/school/lifecycle` (`app.mjs` ~3956);
  `v1Routers.piano` → `/api/v1/piano`. The lifecycle router registers each
  route **only when its use case is injected** (a School-less deployment
  404s), and `GET /learners/:learnerId/completion` is documented in-file as
  "the public read seam for consumers such as the piano kiosk".
- **Kiosk precedents:** `useSchoolGameAccess` (poll 15s + visibilitychange +
  per-learner request-generation guard + guest handling; fails **closed** —
  correct for Games, wrong for this gate); `usePianoCurfew` (30s local
  re-evaluate, fail-open posture); `useKioskLaunchCommand` (the kiosk already
  holds a WS connection); `openPianoCourseLesson` in `pianoContentOpen.js`
  navigates to `${basePath}/videos/{courseNumeric}/{plex:lessonId}`, which
  `Videos.jsx` routes (`:courseId/:lectureId` → `LecturePlayerRoute`).
- **Teacher Console write pattern:** panels call `useTeacherWrite({panel})` →
  `run(key, ({actorId, pin, stepUpToken}) => api...(...), {onSuccess,
  stepUp?})`. Auth is the `daylight_teacher_session` HttpOnly cookie
  (Path=/api/v1/school); `school.mjs` middleware injects the capability proof
  as `req.body.pin` for every non-`/teacher/auth/*` route, and use cases
  assert via `teacherGate.assert({userId, pin, action, context})`. Sensitive
  writes add a one-use step-up grant in `X-Teacher-Step-Up`
  (curriculum-exception apply does; attestations don't).
- **Override precedents:** `ManageCurriculumException` +
  `YamlCurriculumExceptionStore` (append-only ledger at
  `school/records/curriculum-exceptions.yml`, applied/retracted operations,
  teacherGate-asserted, reason required). **Not reusable directly** for this
  feature: it validates `targetId` against `curriculum.listUnits()` — School
  curriculum unit ids — and piano lessons are Plex episodes that would fail
  that lookup with `EntityNotFoundError`. It is the *shape* to copy, not the
  store to reuse. `RecordAttestation`/`AttestationPanel` is the learner-scoped
  panel shape to copy on the frontend.

## 4. Trigger

The gate re-evaluates whenever the active kiosk user changes. No new hook
point in `PianoUserContext`: the gate hook takes `currentUser` as input (same
as `useSchoolGameAccess(currentUser)`) and re-fetches when it changes,
including initial roster-restore.

## 5. API namespace — resolved

**`GET /api/v1/school/lifecycle/learners/:learnerId/piano-lesson-gate`**, on
the existing `schoolLifecycle.mjs` router. This replaces the draft's
`/api/v1/piano/kiosk/...` proposal. Four reasons, in order of weight:

1. **Dependency direction.** Everything the endpoint needs —
   `pianoCourseLauncher`, `stores.assignments`, the bypass store — is
   constructed in `5_composition/modules/schoolLifecycle.mjs`. The piano
   router (`piano.mjs`) has zero School dependencies today (verified by
   grep). Mounting under `/piano` would force either the piano composition to
   import School's launcher or `app.mjs` to thread School use cases into the
   piano router — a new School→Piano wiring edge for no functional gain.
2. **Explicit precedent.** `GET /learners/:learnerId/completion` on this same
   router already serves the piano kiosk (`useSchoolGameAccess` calls it).
   House style is settled: the domain that owns the rule serves the read; the
   consumer's identity does not move the endpoint.
3. **The rule is School policy.** "Is today's obligation discharged" — study
   day boundary, enrollment, excusal, bypass — is School's question. Piano
   only renders the answer.
4. **Degrade behavior falls out.** Lifecycle routes exist only when their use
   case is injected; on a School-less install the endpoint 404s and the kiosk
   hook fails open to the normal menu (§8.2) — exactly the right behavior,
   with no extra code.

## 6. Gate read — backend

### 6.1 New use case: `GetPianoLessonGate`

`backend/src/3_applications/school/usecases/GetPianoLessonGate.mjs`

```js
constructor({ assignments, launcher, logger })   // both required
async execute({ learnerId })
```

Algorithm:
1. `!learnerId || learnerId === 'guest'` → `{gated: false, reason: 'guest'}`.
2. `assignments.get(learnerId)` → filter `programs` rows where
   `row.programId === launcher.id` (`'piano-course'`); resolve each row's
   `courseId ?? corpusId` (same iteration `PianoLessonCeremonyBridge.#handle`
   uses). None → `{gated: false, reason: 'not-enrolled'}`.
3. For each enrollment: `await launcher.status({userId: learnerId,
   programInstance: courseId})`.
   - `status.error === true` → **fail open**: log
     `school.piano-gate.status-unavailable` (warn) and return
     `{gated: false, reason: 'unavailable'}`. A network or Plex hiccup must
     never lock a child out of the whole menu (curfew's fail-open posture).
   - `status.doneToday === true` → this enrollment is discharged (covers real
     completion, `excused`, and `bypassed` — §7.3); continue to the next.
   - `status.doneToday === false && status.nextLesson` (§6.2) → **gated**:
     return the payload below, built from `status.nextLesson`.
   - `status.doneToday === false && !status.nextLesson` → course complete:
     nothing launchable, treat as discharged (`reason: 'course-complete'`).
4. All enrollments discharged → `{gated: false, reason: 'done'}` (or the last
   non-owed reason encountered; `done` is fine — the frontend only branches
   on `gated`).

Multiple enrollments (unusual): gated while **any** is owed; the shown lesson
is the first owed one encountered, matching the draft.

An assignment-store read failure is caught and returned as
`{gated: false, reason: 'unavailable'}` — same fail-open rule as a launcher
error. (Contrast: `GetPlayableUnits.#assignedLessonId` fails closed for the
co-progress *exemption*; that guard protects pacing, this one protects menu
access. Different stakes, deliberately different postures.)

Response contract (`Cache-Control: no-store`, like `/completion`):

```jsonc
{
  "schema": "school.piano-lesson-gate/v1",
  "learnerId": "kid1",
  "gated": true,
  "reason": "owed",        // owed | done | excused | bypassed | course-complete
                           // | not-enrolled | guest | unavailable
  "course": { "id": "plex:675689", "title": "Hoffman Academy" },
  "unit":   { "id": "42", "title": "Unit 3", "position": 3 },
  "lesson": {
    "id": "plex:987654",
    "title": "Lesson 12: Broken Chords",
    "position": 12,
    "thumbnail": "/api/...",     // omitted when absent — branch on presence
    "description": "..."         // omitted when absent
  }
}
```

`course`/`unit`/`lesson` appear only when `gated: true`. `reason` is
diagnostic (logs, tests, teacher panel); the kiosk branches on `gated` alone.

### 6.2 Launcher change: structural `nextLesson`

`PianoCourseProgramLauncher.status()`'s not-done return gains one field:

```js
return {
  ...common,
  doneToday: false,
  nextLesson: next ? this.#lessonContext({ result, item: next }) : null,
  progressLabel: ...,   // unchanged
};
```

Rationale: `common.context`'s focus rule (`completedToday.last ?? next ??
credit.last`) cannot distinguish "next lesson" from "last lesson of a finished
course". Consumers that need *the launchable next lesson* must not infer it
from `context`. Additive field; no existing consumer reads it, and the
existing `context` contract is untouched.

### 6.3 Router + composition

- `backend/src/4_api/v1/routers/schoolLifecycle.mjs`: register beside
  `/completion`, gated on injection, thin shell per the router's own rules
  (no domain imports, no error envelope):

  ```js
  if (getPianoLessonGate) {
    router.get('/learners/:learnerId/piano-lesson-gate', asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store')
        .json(await getPianoLessonGate.execute({ learnerId: req.params.learnerId }));
    }));
  }
  ```

- `backend/src/5_composition/modules/schoolLifecycle.mjs`: construct after
  the launcher exists (`pianoCourseLauncher`, ~line 476):

  ```js
  const getPianoLessonGate = pianoCourseLauncher
    ? new GetPianoLessonGate({ assignments: stores.assignments, launcher: pianoCourseLauncher, logger })
    : null;
  ```

  Add to the `useCases` map (so it reaches `createSchoolLifecycleRouter`) and
  document in the router factory's JSDoc dep list. No `app.mjs` change needed
  for the read.

## 7. Parent bypass — Teacher Console

### 7.1 Semantics

A bypass is a **parent-issued excusal of one learner's `piano-course`
obligation for one study day**. It is consumed inside
`PianoCourseProgramLauncher.status()`, which makes every surface agree at
once: the kiosk gate clears, the agenda card settles as excused (stops
nagging), and the ceremony stays silent (nothing was accomplished — same rule
as the co-progress excusal, whose class-doc reasoning applies verbatim).
Ordering inside `status()`:

1. `completedToday` — **a real completion outranks a bypass.** If the child
   does the lesson anyway, the day reads as genuinely done and the ceremony
   chimes as normal (the bypass check sits after the completion branch, so
   `excused` is never set on a real completion).
2. **bypass check (new)** — active bypass for (learnerId, `piano-course`,
   today's study date) → `{...common, doneToday: true, excused: true,
   bypassed: true, progressLabel: `Excused today by ${decidedBy} ·
   ${completed}/${total}`}`.
3. co-progress lock — unchanged.
4. owed — unchanged.

Scope rules:
- **Study-day keyed, not TTL'd.** The record stores an explicit `studyDate`
  (computed by the use case via `studyDayForInstant(now, {timezone,
  boundaryHour: 4})` — the same 4am boundary the launcher already uses). It
  cannot leak into tomorrow: tomorrow's `status()` computes a new study date
  and the record simply stops matching. Granting at 2am files under the
  previous study day, correctly.
- **Today only in v1.** The use case computes `studyDate` itself; the caller
  cannot pass one. Pre-excusing future days is a follow-up if ever wanted.
- **Reason required, actor recorded, retractable** — same discipline as
  curriculum exceptions and attestations.

Accepted side effect (documented, not plumbed): `GetPlayableUnits'`
co-progress exemption does not read the bypass store, so a bypassed +
co-progress-locked learner still has today's assigned lesson exempt from the
pacing lock in the course grid. Playing is never gated, so a child choosing
to do the excused lesson anyway is fine — and if they finish it, rule 1 above
takes over. Not worth a second store consumer.

### 7.2 Record + store (adapter layer)

`backend/src/1_adapters/persistence/yaml/YamlProgramDayBypassStore.mjs` —
clone of `YamlCurriculumExceptionStore`'s shape: append-only ledger,
`#writeChain` serialization, `saveYamlToPathAtomic`, file at
`configService.getHouseholdPath('school/records/program-day-bypasses.yml')`.

```yaml
- schema: school.program-day-bypass/v1
  operation: applied
  bypassId: pdb_3f9c2e71a0b45d18        # hash of the seed, like exc_*
  learnerId: kid1
  programId: piano-course
  studyDate: '2026-08-27'
  reason: 'Recital tonight — practiced at the hall instead'
  decidedBy: kckern
  decidedAt: '2026-08-27T14:02:11-07:00'
- schema: school.program-day-bypass/v1
  operation: retracted
  bypassId: pdb_3f9c2e71a0b45d18
  reason: 'Granted the wrong kid'
  retractedBy: kckern
  retractedAt: '2026-08-27T14:05:40-07:00'
```

API: `list()`, `append(record)`, `active()` (applied minus retracted, as the
exception store), plus one query the launcher calls:

```js
async activeFor({ learnerId, programId, studyDate })  // → record | null
```

The record is program-generic (`programId`) so a future launcher can adopt
the same ledger, but v1 wires only `piano-course`.

### 7.3 Use case + launcher injection (application layer)

`backend/src/3_applications/school/usecases/ManageProgramDayBypass.mjs`:

```js
constructor({ store, assignments, teacherGate, eventBus = null,
              timezone = null, clock = () => new Date(), logger = console })

async list({ learnerId = null })
  // { schema: 'school.program-day-bypasses/v1', active: [...], history: [...] }
  // filtered to the learner when given; `active` filtered to today's studyDate.

async grant({ learnerId, programId = 'piano-course', reason, decidedBy, pin })
  // teacherGate.assert({ userId: decidedBy, pin, action: 'program-day-bypass.grant',
  //                      context: { learnerId, programId } });
  // ValidationError on missing learnerId/reason; verify the learner actually has
  //   a programId enrollment (assignments.get) → EntityNotFoundError otherwise;
  // studyDate = studyDayForInstant(clock(), { timezone, boundaryHour: 4 });
  // idempotent: an existing active bypass for the same key is returned, not duplicated;
  // append { operation:'applied', ... }; broadcast (§7.4); return the record.

async retract({ bypassId, reason, retractedBy, pin })
  // teacherGate.assert(action: 'program-day-bypass.retract'); EntityNotFoundError
  // when not active; append retraction; broadcast (§7.4); return the record.
```

`PianoCourseProgramLauncher` constructor gains `dayBypasses = null`
(injected store, optional — a composition without it behaves exactly as
today). `status()` step 2 (§7.1):

```js
const bypass = await this.#dayBypasses?.activeFor?.({
  learnerId: userId,          // the launcher's userId IS the School learnerId
  programId: this.id,
  studyDate: studyDayForInstant(nowMs, { timezone: this.#timezone, boundaryHour: BOUNDARY_HOUR }),
});
```

wrapped in try/catch: a store read failure logs a warn and is treated as "no
bypass" (the launcher must never turn an unreadable ledger into
`error: true` — that would degrade the whole agenda card, not just the
bypass).

### 7.4 Live push on bypass writes

`grant` and `retract` broadcast on the `school` topic (the constant is
`CEREMONY_TOPIC` in `PianoLessonCeremonyBridge.mjs`; declare a local
`const SCHOOL_TOPIC = 'school'` with a cross-reference comment, exactly as
`RecordStoryRead` does):

```js
this.#eventBus?.broadcast?.(SCHOOL_TOPIC, {
  event: 'program-day-bypass-changed',
  learnerId, programId, studyDate,
  active: true /* grant */ | false /* retract */,
  decidedBy,            // retractedBy on retract
  timestamp: Date.now(),
});
```

Wrapped in try/catch; a dead bus costs the instant clear, never the write
(the 15s poll remains the robustness floor). `useScanCeremony` switches on
`payload.event` and returns null for unknown events, so this broadcast is
ignored by the Portal banner with no change there.

### 7.5 Write routes (API layer)

In `backend/src/4_api/v1/routers/school.mjs`, beside the pass-override /
attestation block (root-level, so the existing cookie→`req.body.pin`
middleware applies; `wrap()` already maps `ValidationError`→400,
`EntityNotFoundError`→404, `GuestForbiddenError`→403):

```
GET  /api/v1/school/program-day-bypasses?learnerId=kid1   → manageProgramDayBypass.list
POST /api/v1/school/program-day-bypasses                  → .grant  (201)
POST /api/v1/school/program-day-bypasses/:bypassId/retract → .retract
```

Each guarded by `if (!manageProgramDayBypass) throw new
EntityNotFoundError('program day bypasses', 'not configured')`, matching the
curriculum-exception routes. No step-up grant required — this is
attestation-weight (day-scoped, reversible, fully audited), not
curriculum-exception-weight (permanent record). The teacherGate assert in the
use case still refuses non-teachers.

### 7.6 Composition wiring

In `5_composition/modules/schoolLifecycle.mjs`:
- Construct `const programDayBypassStore = new YamlProgramDayBypassStore({ configService })`
  **before** the launcher block (~line 474) and pass
  `dayBypasses: programDayBypassStore` into `new PianoCourseProgramLauncher({...})`.
- Construct `manageProgramDayBypass` beside `manageCurriculumException`
  (~line 606–608), with `store: programDayBypassStore,
  assignments: stores.assignments, teacherGate, eventBus, timezone, clock, logger`.
  (`eventBus` is already a module input; null-safe per §7.4.)
- Export via `useCases` and `stores` (mirror `curriculumExceptionStore`).

In `app.mjs` (~line 3863, where `manageCurriculumException` is threaded):

```js
manageProgramDayBypass: schoolLifecycle.useCases?.manageProgramDayBypass ?? null,
```

into `createSchoolRouter`.

### 7.7 Teacher Console UI

**Panel:** `frontend/src/modules/School/teacher/panels/ProgramDayBypassPanel.jsx`,
rendered in `LearnerOperationsView` (`WorkspaceViews.jsx`) beside
`AttestationPanel` — Student → Operations is the established home for
learner-scoped "override what School would otherwise enforce" writes.
Modeled line-for-line on `AttestationPanel`:

- Reads: `usePanelFetch(() => schoolApi.programDayBypasses(learnerId), { deps: [learnerId], panel: 'program-day-bypass', notFoundAs: 'unavailable' })`
  for the ledger, plus `schoolApi.pianoLessonGate(learnerId)` for a one-line
  live status ("Owed today: Lesson 12 — Broken Chords" / "Already done today"
  / "Not enrolled in a piano course"), so the parent sees what they are
  excusing before they excuse it.
- Write: a required reason textarea and one button — copy
  **"Excuse today's piano lesson"** — via
  `useTeacherWrite({ panel: 'program-day-bypass' })`:

  ```js
  const save = () => run('grant', ({ actorId, pin }) => schoolApi.grantProgramDayBypass({
    learnerId, programId: 'piano-course', reason, decidedBy: actorId, pin,
  }), { onSuccess: () => { setReason(''); log.retry(); gate.retry(); } });
  ```
- Active-today bypass renders with decidedBy/reason and a Retract flow
  (reason required), like the exception list's retraction row.
- Disabled/empty states: gate read says `not-enrolled` → the panel renders
  the unavailable copy ("No piano course is assigned to this student.");
  already granted → the grant button is replaced by the active row.

**Client:** add to `frontend/src/modules/School/schoolApi.js`
(BASE `/api/v1/school`, cookie auth rides for free):

```js
programDayBypasses: (learnerId) => req(`/program-day-bypasses?learnerId=${encodeURIComponent(learnerId)}`),
grantProgramDayBypass: (body) => req('/program-day-bypasses', body),
retractProgramDayBypass: (bypassId, body) => req(`/program-day-bypasses/${encodeURIComponent(bypassId)}/retract`, body),
pianoLessonGate: (learnerId) => req(`/lifecycle/learners/${encodeURIComponent(learnerId)}/piano-lesson-gate`),
```

**Discoverability:** one new row in `interventions.js` (the "which repair do
I need?" index):

```js
{ id: 'program-day-bypass', scope: 'learner', label: "Excuse today's piano lesson",
  useWhen: "Today's piano lesson shouldn't be required — recital, illness, travel.",
  where: 'Student → Operations.', href: learnerOps },
```

**Visibility:** `ActiveOverrides.jsx` (School → Operations, whose charter is
"the complete override surface in ONE place") gains a third group, "Today's
program bypasses", read from `schoolApi.programDayBypasses()` with no
learnerId filter — learner name via the existing `nameFor`, plus
decidedBy/reason/studyDate.

## 8. Frontend — kiosk

### 8.1 `usePianoLessonGate(learnerId)`

`frontend/src/modules/Piano/PianoKiosk/usePianoLessonGate.js`, modeled on
`useSchoolGameAccess` with two deliberate differences (fail-open, WS refresh):

- State: `{ learnerId, status: 'loading'|'ready'|'error', gated, course, unit, lesson, refresh }`.
- Guest / falsy learnerId → `{status:'ready', gated:false}` immediately, no fetch.
- Fetch `api/v1/school/lifecycle/learners/:id/piano-lesson-gate` via
  `DaylightAPI`; same request-generation guard (never project a stale
  learner's gate onto a newly-picked one — including the snapshot-mismatch
  fallback return at the bottom of the hook, which resolves to *not gated*
  while the new learner's read is in flight).
- **Fail open:** any fetch error (including the 404 of an unwired lifecycle)
  → `{status:'error', gated:false}` with a `warn` log
  (`piano.lesson-gate.read-failed`). First-fetch loading also renders as not
  gated: a brief menu-then-gate flash beats a false lock.
- 15s poll while mounted + `visibilitychange` refresh, as the model hook.
- WS: `useWebSocketSubscription('school', handler)` (import from
  `hooks/useWebSocket.js`; the kiosk already holds this socket via
  `useKioskLaunchCommand`). Handler:

  ```js
  if ((msg.event === 'piano-lesson-complete' || msg.event === 'program-day-bypass-changed')
      && msg.learnerId === learnerId) refresh();
  ```

  Re-fetch rather than trust the payload — completion truth has one owner
  (the same rule the ceremony bridge follows). The poll is the fallback for a
  dropped socket; the broadcast is what makes the clear feel instant.

Structured logging per house rules: child logger `piano-lesson-gate`;
`info` on gate transitions (`piano.lesson-gate.change` with
`{learnerId, gated, reason}`), `debug` on refresh causes, `warn` on failures.

### 8.2 `PianoMenu` branching

```js
const gate = usePianoLessonGate(currentUser);
const gated = !curfew && gate.gated;   // curfew wins outright
```

- `curfew` true → existing curfew render, untouched (no lesson launch after
  bedtime; the tiles-disabled + message treatment stays exactly as is).
- `gated` true → render `<TodaysLessonGate lesson={gate.lesson}
  unit={gate.unit} course={gate.course} onLaunch={...}/>` **in place of**
  `PianoMenuActivity` + `piano-menu__tiles` (full replacement, not
  disabled-with-overlay — that is curfew's look; this is a single-purpose
  screen).
- What survives untouched, for free: the "Who's Playing" chip
  (`PianoUserChip` renders in `PianoChrome`, outside this component — a
  sibling can still switch users, which re-runs the gate for the new
  learner), and the `LiveKeyboard` strip at the foot of `PianoMenu`, which
  stays in both branches.

### 8.3 `TodaysLessonGate` component

`frontend/src/modules/Piano/PianoKiosk/TodaysLessonGate.jsx` — presentational:

- Lesson thumbnail (`lesson.thumbnail`, absent-safe), unit + course context
  line, lesson title, optional description, and one large tap target
  ("Start today's lesson").
- Tap calls `openPianoCourseLesson({ courseId: course.id, lessonId:
  lesson.id, basePath, navigate })` from `pianoContentOpen.js` — the exact
  navigation the DoNow course-lesson launch arm already uses
  (`/videos/{course}/{plex:lesson}` → `LecturePlayerRoute`). It validates id
  shapes and logs; on a false return (malformed ids) fall back to
  `navigate(`${basePath}/videos/${course.id.replace(/^plex:/,'')}`)` — the
  course detail page — rather than a dead tap.
- **No DoNow dispatch.** DoNow's `kiosk.launch` path exists to address a
  different physical device from a QR/panel slip; this tap originates on the
  tablet already showing the menu.
- Log `piano.lesson-gate.launch` (info) on tap.

### 8.4 Precedence and interaction with existing locks

- Curfew > gate (render order in §8.2).
- The Games/whole-day-completion lock (`useSchoolGameAccess`) is untouched
  and independent: once the lesson gate clears, Games may still be locked by
  whole-day School completion. Both can be true at once; they never interact.

## 9. Studio-via-MIDI is unaffected (verified, no work)

`useAutoStudioEntry` (`frontend/src/Apps/PianoApp.jsx` wires it with
`pathname: location.pathname`) arms on `pathname === menuPath` and fires
`onEnter()` on sustained playing via `shouldAutoEnterStudio`. The gate
replaces content *within* the menu route; the pathname does not change, so a
child who sits down and plays while the gate is showing still auto-enters
Studio. Constraint on implementers: the gate must remain a render branch of
`PianoMenu` — never a redirect to a different route.

## 10. Failure and edge-case matrix

| Condition | Behavior | Where enforced |
|---|---|---|
| No `piano-course` enrollment | `gated:false, reason:'not-enrolled'` | GetPianoLessonGate |
| `guest` / no learner picked | `gated:false` (no fetch) | hook + use case |
| `status().error` (Plex/School unreadable) | fail open, `reason:'unavailable'`, warn log | GetPianoLessonGate |
| Assignment store read throws | fail open, `reason:'unavailable'` | GetPianoLessonGate |
| Endpoint 404 (lifecycle unwired) / network error | fail open, `status:'error', gated:false` | usePianoLessonGate |
| First fetch in flight / learner just switched | render not-gated until resolved | usePianoLessonGate |
| Course fully complete (`next` null) | not gated, `reason:'course-complete'` | §6.2 `nextLesson` |
| Co-progress locked, lesson NOT exempt | `doneToday:true, excused:true` → not gated (nothing launchable — gating would be a dead end; mirrors the agenda's settle-as-done) | launcher, unchanged |
| Co-progress locked, assigned lesson exempt | day owed → gated at that lesson | launcher, unchanged |
| Parent bypass active today | `doneToday:true, excused:true, bypassed:true` → not gated; agenda settles; no chime | launcher §7.1 |
| Bypass granted, child completes lesson anyway | real completion wins; ceremony chimes | ordering §7.1 |
| Bypass store unreadable | treated as no bypass, warn log — never `error:true` | launcher §7.3 |
| Bypass retracted mid-day | broadcast → kiosk refetches → gate returns | §7.4 |
| 4am boundary crosses while menu is up | 15s poll re-derives against the new study day | hook poll |
| Curfew + gate both true | curfew view | PianoMenu §8.2 |
| WS down | poll clears the gate within 15s | hook |
| Backend restart | stateless reads; ledger on disk; kiosk poll recovers | — |

Note on config caching: the bypass ledger is read per-request by the store
(like the exception ledger), so writes are live without a restart. Only
`piano.yml`/`school.yml` config changes carry the usual restart caveat.

## 11. DDD layer placement — every touched or added file

| Layer | File | Change |
|---|---|---|
| 1_adapters | `persistence/yaml/YamlProgramDayBypassStore.mjs` | **new** — append-only ledger + `activeFor` |
| 3_applications | `school/PianoCourseProgramLauncher.mjs` | edit — optional `dayBypasses` dep; bypass branch in `status()`; `nextLesson` field |
| 3_applications | `school/usecases/GetPianoLessonGate.mjs` | **new** — gate read |
| 3_applications | `school/usecases/ManageProgramDayBypass.mjs` | **new** — grant/retract/list + broadcast |
| 4_api | `v1/routers/schoolLifecycle.mjs` | edit — `GET /learners/:learnerId/piano-lesson-gate` (injection-gated) |
| 4_api | `v1/routers/school.mjs` | edit — 3 `program-day-bypasses` routes (injection-gated) |
| 5_composition | `modules/schoolLifecycle.mjs` | edit — store, both use cases, launcher injection, exports |
| (root) | `app.mjs` | edit — thread `manageProgramDayBypass` into `createSchoolRouter` |
| frontend kiosk | `Piano/PianoKiosk/usePianoLessonGate.js` | **new** |
| frontend kiosk | `Piano/PianoKiosk/TodaysLessonGate.jsx` (+ SCSS in the kiosk stylesheet) | **new** |
| frontend kiosk | `Piano/PianoKiosk/PianoMenu.jsx` | edit — gate branch |
| frontend teacher | `School/teacher/panels/ProgramDayBypassPanel.jsx` | **new** |
| frontend teacher | `School/teacher/WorkspaceViews.jsx` | edit — panel into `LearnerOperationsView` |
| frontend teacher | `School/teacher/panels/ActiveOverrides.jsx` | edit — bypasses group |
| frontend teacher | `School/teacher/interventions.js` | edit — one row |
| frontend shared | `School/schoolApi.js` | edit — 4 client functions |

No `2_domains` change: `studyDayForInstant`/`isSameStudyDay` already exist
and are the only domain logic involved. The bypass is a record + policy
consumption, which the application layer owns (same placement call the
curriculum-exception feature made).

## 12. Testing plan

Backend (run vitest directly on `tests/isolated/**` — the `--only=domain`
harness mis-routes vitest files to Jest):

- `tests/isolated/application/school/pianoCourseProgramLauncher.test.mjs`
  (extend): bypass sets `doneToday/excused/bypassed`; real completion
  outranks an active bypass (no `excused` flag, ceremony-eligible);
  yesterday's bypass does not match today; bypass-store throw → treated as
  no bypass, not `error`; `nextLesson` present when owed, null when course
  complete, absent semantics on the done branch unchanged.
- `tests/isolated/application/school/getPianoLessonGate.test.mjs` (**new**):
  guest, not-enrolled, owed (payload shape from `nextLesson`), done,
  excused, bypassed, course-complete, launcher `error` → fail open,
  assignments throw → fail open, multi-enrollment any-owed rule.
- `tests/isolated/application/school/manageProgramDayBypass.test.mjs`
  (**new**): teacherGate refusal, reason/learner validation, non-enrolled
  learner → EntityNotFoundError, idempotent double-grant, retract of
  unknown/inactive id, study-date stamping across the 4am boundary
  (injected clock), broadcast payloads on grant/retract, dead-bus tolerance.
- Adapter: `YamlProgramDayBypassStore` — append/active/activeFor round-trip,
  retraction filtering, ENOENT → empty.
- Router: `schoolLifecycle` gate route (404 when unwired, no-store header,
  payload pass-through); `school.mjs` bypass routes (not-configured 404,
  cookie-pin middleware reaches the gate assert, error mapping).

Frontend (existing patterns cited as templates):

- `usePianoLessonGate.test.jsx` (mirror `useSchoolGameAccess.test.jsx`):
  guest, generation race guard on rapid learner switches, poll +
  visibilitychange refresh, **fail-open on error/404**, WS-event-triggered
  refetch for both event names, wrong-learner events ignored.
- `PianoMenu.gate.test.js` (parallel to `PianoMenu.curfew.test.js`): tiles +
  activity replaced when gated; curfew outranks gate; normal menu when
  `gated:false`; keyboard strip present in both branches.
- `TodaysLessonGate.test.jsx`: renders lesson data (thumbnail-absent safe),
  tap navigates via `openPianoCourseLesson` to the right route, course-detail
  fallback on malformed ids, no DoNow call.
- `ProgramDayBypassPanel.test.jsx` (mirror `AttestationPanel` coverage):
  gate-status line states, grant requires reason, retract flow,
  not-enrolled unavailable copy, `useTeacherWrite` refusal surface.

Live smoke (manual, on the tablet): pick an enrolled learner → single card;
complete the lesson → menu returns without reload; re-pick → normal menu;
grant a bypass from the Teacher Console on a laptop → kiosk clears within a
second; retract → gate returns.

## 13. Non-goals (unchanged from draft, minus the bypass)

- No browsing into the full course from the gate screen — single-purpose;
  the Courses tile returns when the gate clears.
- No change to the Games/whole-day-completion lock.
- No change to DoNow/agenda QR/panel launches (`launch()`/
  `issueLaunchTarget()` untouched — a bypassed day remains launchable from a
  slip, which is correct: launching is never gated).
- No on-kiosk operator bypass (`OperatorDrawer`) — the Teacher Console owns
  the escape hatch.
- No future-dated bypasses in v1 (§7.1).
