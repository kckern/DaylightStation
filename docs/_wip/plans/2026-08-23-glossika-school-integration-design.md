# Glossika × School Framework Integration — Design

> **Status:** designed 2026-08-23; revised same day after an adversarial code
> review (fresh-context agent, findings folded in — see §10 for what the
> review changed).
> Parent docs: [`2026-07-21-glossika-program-design.md`](./2026-07-21-glossika-program-design.md)
> (the ladder itself), [`docs/reference/school/README.md`](../../reference/school/README.md)
> (program units, agenda, self-service), [`print-documents.md`](../../reference/school/print-documents.md)
> (the OMR result shape this credit path mirrors).

---

## 1. The problem

A child walks to the Portal panel, types the six digits printed beside
**Language & Culture** on their agenda, and today's Glossika drill opens right
there — already knowing which child, no face picker. When they finish the
day's queue, School records a **completion (pass, no score)** that mirrors the
OMR result shape — outcome, reward, agenda-served — but prints no worksheet
result and itemizes nothing. Lesson size, content, and the rung chain are
**per enrollment**: Felix's day targets ~10 items across four rungs from one
band of the corpus; Milo's targets 3–5 repetition-only items from another.

Most rails exist and were verified against the code. `BuildAgenda` mints a
code per subject section, including a program-only section;
`ResolveAccessCode` answers `{kind: 'program'}` for a program entry
(`ResolveAccessCode.mjs:320`); `offeredActions` renders `Open {name}`;
`RunSelfServiceAction#program` launches through the registered launcher and
mounts in place when `launcher.surface === 'portal'`;
`LanguageProgramLauncher.status()` already flips the agenda's `servedToday`.

What is missing, in one sentence each:

1. **No program unit exists** in any plan — nothing puts Glossika on an agenda.
2. **Credit has nowhere to live** — program units are fenced out of sessions,
   outcomes, and rewards by design.
3. **Completion is not an event** — the ladder knows `doneToday` but nothing
   closes anything when it flips.
4. **No per-enrollment policy** — daily limit is a child-writable number in
   `progress.yml`; content is a hardcoded seq-1→N scan; the rung chain is
   whatever the device claims; no taxonomy maps a study day into
   Course/Unit/Lesson.
5. **The panel UX has holes** — end-of-day offers "Start the next day" instead
   of closing the loop; three verified defects (§6.2).

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Credit shape | Mirror the OMR PASS: `outcome_recorded {result: 'passed'}` → shared `#settle` → reward. **No receipt print, no itemized grading, no percent.** Reuses the existing `honorClose` "asserted, not evaluated" door. |
| D2 | Coins | Yes — a program **enrollment** may declare `reward: {amount}` (the unit fence stays shut, §4.3). Pays every completed day; the economy's `daily_cap` is the only brake, deliberately. |
| D3 | Trigger | Backend, on the logged attempt that completes the day — credit lands wherever the child finished (panel, laptop, split sittings). Never frontend-initiated, never agenda-lazy. Plus an idempotent catch-up at day boundaries (D11). |
| D4 | Session creation | **The bridge is the only session creator.** No session is opened at dispatch — the keypad path launches and mounts only. Occupancy protection is DoNow's job, not the session's. (Revised: an eager dispatch session cannot mint the deterministic id without the language day counter, and a random-id session would never close.) |
| D5 | Lesson size | `lessonSize` = target **total items per day**, derived: `newPerDay = max(1, round(lessonSize / enrollmentChainLength))` — against the **enrollment's chain** (D12), never the device's. |
| D6 | Content scope | Corpus declares named `bands:` (seq ranges); enrollment carries an ordered `scope:` of band ids and/or raw ranges. Gates **admissions only, never graduates**; edits are prospective. |
| D7 | Taxonomy | Subject = shelf · Course = corpus · Unit = band of `unitSize` study days · **Lesson = one study day** · Module = rung. Synthesized by a pure helper, one source of wording. |
| D8 | State machine | New `program_dispatched` state, parallel to `launch_dispatched`. Full event support — SCHEMA, APPLY, `computeNextAction` — not just TRANSITIONS (§4.1). |
| D9 | Never `completed` | `planner.mjs:243`'s guard (a program unit never flips to `completed` off `passedUnits`) **stays**. Daily recurrence = that guard + `servedToday`; the outcome record sits beside it, not under it. |
| D10 | One clock | "Which study day did this close?" is answered by the **language service's own day counter**, nowhere else. Boundary hour becomes one shared config knob (§7). |
| D11 | Catch-up | A day rolled past before its bridge fired is settled idempotently at the next `rollDay`/`getDay` (evaluate day N−1, fire the bridge). Without this, a server outage at bedtime silently forfeits the day's coins forever. |
| D12 | **Doneness chain** | **The enrollment defines the chain that closes the day.** `programs[].rungs` (default: all four) is the credit bar; devices still filter what they can *serve*, but `doneToday`-for-credit means the enrollment-chain queue is empty. This kills both failure modes the review exposed: full-chain doneness stalls forever in a mic-less household; device-chain doneness lets any browser claim no capabilities and farm repetition-only days. Client claims stop mattering for credit; the teacher authors a chain the household hardware can actually serve. |

## 3. Data model

### 3.1 The program unit (authored curriculum)

One `school.unit` per corpus a household studies, shelved under its subject:

```yaml
# id: language-glossika-korean
title: Korean Sentences
subject: language
program: language
programInstance: glossika-korean     # NEW — names the corpus this unit opens
cadence: daily
reviewState: approved
provenance: { author: kckern, created: 2026-08-23 }   # required by unitValidation
```

`programInstance` is new: today the launcher emits a fixed
`{program: 'language'}` and the frontend opens `courses[0]`, which is wrong the
day a second corpus exists. Validation: legal only when `program` is present,
and it must be added to `validateUnit`'s output whitelist
(`unitValidation.mjs:320-347`) or it is silently dropped.

Each learner's plan lists the unit in `units:` — for Felix and Milo this is the
first `units:` entry either file has ever carried.

### 3.2 The program enrollment (household plan)

A sibling of `enrollments:` in `plans/learners/{id}.yml` — teacher-authored
policy, per the household-data taxonomy ("plans hold policy, never evidence"):

```yaml
programs:
  - programId: language
    corpusId: glossika-korean
    lessonSize: 10            # target items per study day (D5)
    rungs: [repetition, dictation, recording, interpretation]  # the credit bar (D12)
    unitSize: 10              # study days per Unit; cosmetic denominator, default 10
    reward: { amount: 2 }     # optional (D2)
    scope: [fluency-1]        # optional (D6); omitted = whole corpus, seq order
```

Milo's entry: `lessonSize: 4, rungs: [repetition]`. A scope may mix named
bands and raw ranges, in study order:
`scope: [fluency-2, {range: [3200, 3400]}]`.

**`requiresSignoff` is forbidden on a program reward** (validation error). The
review traced why: `awaiting_signoff` deliberately does not close the session
(`CloseSessionOutcome.mjs:427-429`), the bridge never passes `signedOff`, and
no surface exists to sign off a program close — the session would sit
non-terminal forever and show perpetually in-progress. If a signoff surface is
ever wanted, it is its own design (§9).

Editing this record never rewrites history — the ladder log is untouched; only
future queue builds see it.

### 3.3 Corpus bands

`data/content/language/{corpusId}.yml` gains a validated `bands:` section:

```yaml
bands:
  - { id: fluency-1, label: Fluency 1, range: [1, 1000] }
  - { id: fluency-2, label: Fluency 2, range: [1001, 2000] }
  - { id: fluency-3, label: Fluency 3, range: [2001, 3000] }
  - { id: wordbook,  label: Wordbook,  range: [3001, 4143] }
```

(The bands are real: seq 1–3000 is the commercial course, 3001+ the wordbook
import — parent design §6.) `corpus.mjs` validates shape: kebab ids, integer
ranges within `[1, size]`, no duplicate ids. Overlap between bands is legal
(bands are views, not partitions); overlap *within one enrollment's scope*
resolves by first-listed-wins since `everSeen` already dedupes admissions.

### 3.4 What moves out of `progress.yml`

`progress.yml` keeps `day` and `last_activity` only. `daily_limit` becomes a
fallback consulted **only when no `programs:` entry governs** (dev, legacy,
guest-adjacent use). Resolution order in `LanguageStudyService`:

1. program enrollment → `newPerDay` derived per D5;
2. stored `daily_limit`;
3. `DEFAULT_DAILY_LIMIT`.

Applied at **all four** queue-building call sites — `getDay`, `rollDay`,
`#fullDayQueue`, `#summarizeCourse` — or the drill and the agenda judge
different day sizes. This requires injecting a **plans reader** (the
`YamlAssignmentStore` family) into `LanguageStudyService` — a new, named
dependency.

`PUT /pacing` refuses with a named reason when an enrollment governs — one
owner per knob. `PacingControl` renders read-only (or hidden) in that case.

## 4. Domain changes

### 4.1 `sessionEvents.mjs` — full event support, not two lines

The review established that TRANSITIONS alone produces an event that can never
apply: `EVENT_TYPES` derives from SCHEMA keys, `validateInto` rejects unknown
types, and `reduceSession` drops them. The complete change:

- **SCHEMA**: `program_dispatched` with `fields`/`validate` for
  `{programId, corpusId, day}`.
- **TRANSITIONS**: `created` gains `program_dispatched`;
  `program_dispatched: ['outcome_recorded', 'abandoned']`.
- **APPLY**: a handler mirroring `launch_dispatched`'s
  (`sessionEvents.mjs:356-362`).
- **`computeNextAction`**: an explicit case — the default returns
  `'reprint_document'` / "Scan your ticket to print it again", nonsense for a
  program session, and the file's own property test would bless the lie.
  Wording: something like `'continue_program'` / "Keep going on the Portal."

Additive: every existing session replays unchanged.

### 4.2 `CloseSessionOutcome` — the door widens, the reward threads, the printer narrows

- `honorClose` accepts `launch_dispatched || program_dispatched`, recording
  `reason: 'program_complete'` for the new state. Same asserted pass, no
  percent, no bar, same `unavailable` from any other state, same shared
  `#settle`.
- **`rewardOverride` is a real API change**, not a pass-through that exists:
  `#applyReward` reads `unitReward: unit?.reward` (line 418), and program
  units are banned from carrying `reward` — so as wired today every program
  close would skip `no_reward_policy`. `execute()` gains an optional
  `rewardOverride` threaded `execute → #settle → #applyReward`, **including
  the resettling path** (`state.outcome` short-circuit at 177-182) — a
  retried close must not lose the override. The bridge supplies the
  enrollment's `reward` block.
- **Receipt suppression is required, not cosmetic**: the review confirmed that
  without a suppression branch, `#settle` prints today — with taxonomy
  "Independent study". Program closes return `printed: false,
  printReason: 'program'` and build no result document.
- Verified safe: `#settle` with a courseId-less unit — `#nextUnlocked` /
  `#learningProgress` return null early; nothing throws.

### 4.3 `unitValidation.mjs` — the fence does not move

Reward policy lands on the **program enrollment** (§3.2), not the unit, so
`PROGRAM_EXCLUSIVE_FIELDS` is unchanged — the same authored unit serves both
boys with different amounts, and per-learner reward is policy, which is what
plans hold. D2's coins are honored at the enrollment layer via
`rewardOverride` (§4.2).

The only unit-schema change is `programInstance` (program-only field, added to
the output whitelist); `passing`/`retry`/`review`/`reward`/`courseId`/
`sequence` all stay banned on units.

### 4.4 `planner.mjs` — sessions yes, completion no

- Line ~230: program units stop force-nulling the open session — the entry
  carries `sessionId`/`state` like any other. With D4 (bridge-only creation),
  the only sessions that ever appear here are settled or same-day closes —
  no perpetual `in_progress` ghosts.
- Line ~243 guard **stays** (D9).

### 4.5 `dayQueue.mjs` and `ladder.mjs` — admission and chain become injectable

- `buildDayQueue` gains `admission` — an ordered iterable of candidate seqs
  replacing the bare `1..corpusSize` scan (loop at 116-121, verified a clean
  injection point). `everSeen` skip, `playable` filter, `dailyLimit` cap,
  `enteredToday` accounting, and the graduates section are all unchanged.
  Omitted scope ⇒ today's behavior.
- The chain used for **credit** derivation comes from the enrollment's
  `rungs` (D12): the service intersects `RUNG_IDS` with the enrollment list
  (order preserved from the ladder) and builds the doneness queue from that
  chain — client capabilities are not consulted for credit. The *served*
  queue (what the device renders) remains capability-filtered as today; a
  device that cannot serve an enrollment rung simply cannot finish the day on
  that device, and the panel says so (§6.1).
- Scope gates **admissions only**: a sentence already in evidence keeps
  climbing even if a later scope edit excludes it — evidence outranks policy.

### 4.6 `language/taxonomy.mjs` — new, pure

```js
taxonomyFor({ corpus, day, unitSize }) // → { subject, course, unit, lesson }
// { course: corpus.label, unit: `Unit ${ceil(day/unitSize)}`, lesson: `Day ${day}` }
```

One helper feeding the close bridge and any future surface (D7).

## 5. The lifecycle, end to end

### 5.1 Opening (any of four doors) — no session anywhere

1. **Keypad**: agenda code → `ResolveAccessCode` (`kind: 'program'`, already
   built) → `RunSelfServiceAction#program`. **Change:** the branch resolves
   the learner's `programs:` entry to a `corpusId` (falling back to the
   unit's `programInstance`) and puts it on the effect. It does **not** open
   a session (D4). No `NEEDS_SESSION` change — the review showed the
   `program` kind branches at line 234, before that check is ever consulted.
2. **Subject shelf tap / QR broadcast / remote surface**: unchanged.
3. `useSelfService` → `onPortalLaunch`: routes `{kind:'program',
   program:'language', corpusId}` to `lang:{corpusId}` instead of
   `courses[0]`.

### 5.2 The session identity

Deterministic, one per study day, minted **only by the bridge**:

```
ses_lang_{learnerId}_{corpusId}_d{day}
```

(Verified to fit `SESSION_ID_RE`.) Idempotency falls out: the bridge's second
invocation finds `state.outcome` and lands in the existing `already_settled`
path; the reward ref `out:{sessionId}` is unique per day and stable within
it. `day` comes from the language service's counter (D10). The bridge holds a
per-session in-process mutex around its read-then-append — `appendEvent`
serializes writes but two simultaneous flips could otherwise both append
`outcome_recorded`, leaving permanent illegal-transition entries in the log
(double-pay is already prevented by the reward guard, but the log should stay
clean).

### 5.3 Closing — the bridge

New use case `backend/src/3_applications/school/CloseLanguageDay.mjs`.

**Wiring is event-driven, matching `DoNowSchoolBridge`'s real posture** (an
eventBus subscription — the review confirmed `LanguageStudyService` is
constructed in `app.mjs` long before `schoolLifecycle.mjs` builds
`CloseSessionOutcome`, so a direct hook has an ordering problem an event does
not): `LanguageStudyService.logAttempt` — the actual method name;
`saveRecording` delegates to it, so the hook lives in `logAttempt` **only**,
or the flip check double-fires — emits `school.language.day-complete
{learnerId, corpusId, day}` on the bus when the enrollment-chain queue
(D12) reaches zero outstanding. The bridge subscribes and:

1. Resolves the learner's plan → the program unit for this
   `programId`/`programInstance`. **No unit assigned ⇒ log
   `school.language.close.unassigned` and stop** — a learner studying outside
   the school plan (an adult) completes days with no School side effects.
2. Computes the deterministic session id; reads events. If none exist,
   appends `created` + `program_dispatched` now.
3. Calls `CloseSessionOutcome.execute({sessionId, honorClose: true,
   rewardOverride})` with the enrollment's reward block.
4. Failure anywhere: log `warn`, never fail the attempt write. Recovery is
   D11's catch-up, **not** "the next attempt of the day" — after the 4am
   boundary `rollDay` advances the counter and subsequent attempts belong to
   day N+1, so without the catch-up a bridge outage at bedtime forfeits the
   day permanently. `rollDay` and `getDay` therefore evaluate day N−1's
   enrollment-chain queue and fire the bridge idempotently before proceeding.

### 5.4 What the record is (scoped down)

The v1 record of a completed language day is: the settled **session outcome**
(`out:{sessionId}`, result `passed`, reason `program_complete`), the
**reward ledger entry** when one paid, and the agenda's `servedToday` (still
derived from the ladder log via `todayStatus`, independent of the bridge —
verified at `agenda.mjs:141,150` — so agenda truth cannot depend on the
bridge having succeeded).

**No attempt-evidence row is written in v1.** The review established that the
earlier claim was wrong twice over: `CloseSessionOutcome` has no
`appendAttempt` capability, launch honor-closes write no attempt evidence
today, and `buildRecentScores` structurally drops scoreless rows
(`learningProgress.mjs:540, 571`). Folding language days into the report
card / learning-progress tree is real evidence-schema and aggregation design
work — a named deferral (§9), not a sentence.

One accepted asymmetry, stated so it is a choice: the agenda can show
Language **served** while the close failed (no coins yet) — D11 heals it at
the next boundary. The reverse (panel says done, agenda disagrees) cannot
happen: both read the ladder log.

## 6. Frontend work

### 6.1 Lock-mode end-of-day (replaces "Start the next day")

When mounted in lock mode, the `allDone` state becomes a completion screen:
"Day {n} done" + earned coins when settled + one **Done** button → keypad. It
never offers the roll. Outside lock mode the existing roll button stays.

**D12 addendum:** "done" on the panel means the *served* queue is empty; if
the enrollment chain has rungs this device cannot serve, the screen says so
plainly — "Recording is left — finish on a device with a microphone" — using
the enrollment-vs-served chain difference the day payload can now carry.
Never a silent gap between "the panel said done" and "no coins came."

Credit surfacing: `GET /day` gains `credit: {settled, reward}`. To avoid
reintroducing the cross-app import the bridge exists to avoid,
`LanguageStudyService` does **not** read School session state — a read-only
session-status port is injected at composition (or the router composes the
two reads), review finding 10.

### 6.2 Defect fixes (all three verified real by the review)

1. **RepetitionRung save-failure dead end.** `phase: 'done'` with a failed
   save leaves no control that can retry (`onComplete` returns without
   reload on `!result.ok`, entry key unchanged). Fix: on failure the shell
   re-keys the entry (or the rung drops to `idle` + `halted`) so Play
   returns.
2. **Identity lapse on the locked panel.** The guest branch's "Sign in" calls
   `openPicker` while `ProfilePicker` renders only when `!lock.locked`
   (`SchoolApp.jsx:823` vs `:831`). Lock-mode variant: "Type your code
   again" → exit to keypad. Also verify the lock-mode idle timer counts
   **audio playback** as activity — repetition is hands-free by design.
3. **Panel policy chrome.** In lock mode, hide `PacingControl` (enrollment
   governs) and `DeviceSettings` (capability toggles are a grown-up's call —
   though with D12 they can no longer shrink the credit bar, only the served
   set). Render the day payload's `gate.message` when the gate strips a
   claimed rung.

### 6.3 Instance routing

`onPortalLaunch` and `useSelfService`'s `launchTarget` carry `corpusId`
through; `programs.js`'s `sectionFor` already emits `lang:{instanceId}` for
reports, so only the launch path changes.

## 7. Guardrails and policy notes

- **Anti-farming rests on D12, not the gate.** The review disproved the
  earlier claim: `capabilitiesUnder` with an open gate returns the client's
  claims verbatim (`accessGate.mjs:145-149`) and a hindered gate only
  *subtracts* — the gate can never pin a capability ON. With D12, claims
  affect only what a device serves, never what credit requires, so
  under-claiming buys nothing.
- **Reward every day is intended.** `rewardDecision` stays cadence-blind
  (verified: already-rewarded-first ordering, economy owns `daily_cap`). Say
  so in `school.yml` docs.
- **Boundary hour is a new knob, not a consolidation.** Verified: both clocks
  already share `studyDayIndex` and agree by *shared default* (4) — there is
  no config anywhere, and ~5 sites hardcode it (`app.mjs`, `BuildAgenda`,
  `SurfaceProgramLauncher.mjs:144`, language defaults). Introduce one config
  value and thread it; until then there is no live drift, only scope.
- **Session-store growth.** `YamlWorkSessionDatastore#rowsFor` reads and
  reduces every session file in every month, and `CloseSessionOutcome` calls
  `listForLearner` twice per close. Daily program sessions add
  ~365/learner/corpus/year forever. v1 ships with a monthly archival sweep
  for settled program sessions older than the academic period (or, minimum,
  a logged size metric and a named follow-up) — not silence.

## 8. Validation, tests, migration

**Validation:** `programs:` entries (known corpus, `lessonSize >= 1`, `rungs`
⊆ RUNG_IDS and non-empty, scope bands resolve, ranges within corpus size,
`reward.requiresSignoff` forbidden); corpus `bands:` shape; `programInstance`
program-only + output whitelist; `PUT /pacing` refusal.

**Tests (by layer):**
- domain: `program_dispatched` SCHEMA/APPLY/nextAction + replay of legacy
  logs; `admission` injection in `buildDayQueue` (scope, omitted-scope
  equivalence, graduates unaffected); enrollment-chain doneness vs served
  queue (D12 both failure modes); taxonomy helper; planner session-carrying
  program entries + never-completed guard.
- application: bridge idempotency (double flip, mutex, re-log after done,
  midnight retry), D11 catch-up (rolled-past day settles once), lazy session
  creation, unassigned-learner no-op, receipt suppression, `rewardOverride`
  through both settle paths (fresh + resettling), wiring-order (event
  emission before school lifecycle exists).
- frontend: RepetitionRung retry, lock-mode guest branch, lock-mode chrome
  suppression, `corpusId` routing, D12 "finish on a device with a mic"
  message.
- flow: keypad code → drill → simulated completion → settled outcome +
  agenda `servedToday` + coins.

**Migration:** additive throughout. Felix/Milo plans gain `units:` +
`programs:`; corpus gains `bands:`; `progress.yml` untouched (its
`daily_limit` demotes to fallback). No event-log rewrite; no published-doc or
allocation impact. Rollout order: domain → service (plans-reader dependency,
four call sites) → bridge/composition (event wiring) → plan data → frontend;
plan data landing before frontend means credit works before the panel chrome
does, and nothing fires until a `programs:` entry exists.

## 9. Deliberately not built

- **Report-card / learning-progress folding of language days** — deferred by
  review finding 4: needs an evidence schema that can carry a scoreless
  completion and aggregation changes in `buildRecentScores` /
  `learningProgress`. The session outcome is the durable record meanwhile.
- **Signoff on program rewards** — forbidden in v1 (§3.2); a signoff surface
  for program closes is its own design.
- **A second corpus** — everything is keyed for it (`programInstance`,
  `corpusId` on the effect), but only Korean is ingested.
- **Partial-day credit** — a day is done or it is not; no prorating.
- **Scoring** — dictation accuracy remains recorded-not-gating; the pass is
  asserted, never evaluated.
- **`cadence` consumption** — the field stays authored-and-unread; daily
  recurrence remains D9's mechanism.
- **Receipt for language days** — suppressed by design; a paper artifact, if
  ever wanted, is a new document archetype.

## 10. What the adversarial review changed (2026-08-23)

For the record, since several of these reversed earlier statements:

1. **D12 is new** — the original design never chose which capability chain
   defines doneness; both implicit answers were broken (permanent stall vs
   trivial farming).
2. **D4 reversed** — eager session-at-dispatch dropped; the bridge is the
   only creator (id-minting and stale-session problems).
3. **§4.1 tripled** — SCHEMA + APPLY + `computeNextAction`, not just
   TRANSITIONS.
4. **`rewardOverride` acknowledged as an API change** through both settle
   paths, replacing a hand-wave.
5. **§5.4 scoped down** — the attempt-evidence row and the report-card claim
   were unimplementable as written; both moved to a named deferral.
6. **D11 added** — the "next attempt recovers a missed close" claim was
   false across the 4am boundary.
7. **Anti-farming re-based** — the `accessGate` claim was false (gates only
   subtract); D12 carries the defense now.
8. **Wiring, naming, and cost corrections** — event-driven bridge wiring;
   `logAttempt` (not `recordAttempt`), hook in one place only; four
   dailyLimit call sites + a plans-reader dependency; session-store growth
   note; unit YAML `provenance`/`reviewState`; boundary-hour knob is new
   scope, not consolidation.
