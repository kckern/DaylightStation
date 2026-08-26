# School — the Home Assistant grading hook (printout + sound)

**This is the piece people forget exists, because it's split across two
systems and half of it isn't in this repository at all.** When a child scans
a graded OMR sheet, two things happen that look like one event: a thermal
receipt prints, *and* a sound/scene fires in the room. Only the first one is
this codebase's doing end-to-end. The second is this repo asking Home
Assistant to do something, and Home Assistant deciding what that something
is.

## 1. The pipeline, split by who owns which half

```
Sheet fed into the OMR reader
    │
    ▼
ResolveCardScan / RecordCardScanOutcome        ┐
    │  grades, records evidence                │  THIS REPO
    ▼                                          │  (backend/src/3_applications/school/)
thermal receipt printed via ReceiptPrinting    ┘  — a receipt prints regardless
    │                                              of anything below this line
    ▼
SchoolGradingHookAdapter.fire(result, ...)     ┐
    │  builds 11 named variables, calls        │  THIS REPO
    │  gateway.callService('script', <name>)   │  (backend/src/1_adapters/school/
    ▼                                          ┘   SchoolGradingHookAdapter.mjs)
    │
    │  ── the network boundary: an HA service call ──
    ▼
Home Assistant script (e.g. script.school_worksheet_scan_notification)
    │  branches on `result`, decides what actually       ┐  HOME ASSISTANT
    │  happens: a chime, a light scene, a TTS             │  (NOT in this repo —
    │  announcement, nothing at all                       │  edited in HA directly)
    ▼                                                     ┘
Sound / light / announcement in the room (or nothing, if the script says so)
```

**The consequence for troubleshooting:** if the printout happens but the
sound doesn't, the fault could be anywhere along this chain, and each
segment needs a different fix. This repo can only tell you it *asked* HA to
do something and whether HA's *service call* succeeded — it has no visibility
into what the HA script itself does with that request, because that logic
does not exist anywhere in this codebase or its data tree. (Confirmed: no
copy of any `school_worksheet_scan_notification`-named script exists in this
repo or the household data tree — it lives only inside Home Assistant's own
configuration.)

## 2. Configuration — two independent hook instances

Both live in `data/household/school/school.yml` and are wired by the same
adapter class, `SchoolGradingHookAdapter`, with a different `configKey`:

| Config key | Fires when | Variables |
|---|---|---|
| `grading_hook` | Every terminal OMR paper-scan outcome (see §3) | 11 keys, see §3 table |
| `piano_lesson_hook` | Once per learner per study day, the moment the assigned daily piano lesson (the `piano-course` program) crosses completion | `result: 'satisfied'`, `learner_id`, `student`, `subject: 'arts'`, `course`, `lesson`, `percent` |

```yaml
grading_hook:
  script: script.school_worksheet_scan_notification

piano_lesson_hook:
  script: script.school_worksheet_scan_notification   # same script, both hooks, in this household today
```

**Presence of `script` is the entire enable switch.** There is no separate
`enabled` flag, no score-band-to-script mapping, and no per-learner override
in `school.yml` — both were considered and deliberately rejected, because
either would put behavior in two places and force a repo redeploy to retune
a light or change one child's cue. **A household that wants a different
scene above 90%, or a distinct chime for one kid, writes that branch inside
the Home Assistant script itself**, keyed on the `percent`/`learner_id`
variables this repo already sends — it does not belong in `school.yml` or
in this codebase.

`school.yml` is boot-cached — changing which script a hook points at needs a
container restart before it takes effect.

## 3. The four terminal outcomes and their variables

Every call carries the **same 11 keys**, snake_case (to match Home Assistant
convention, not this codebase's camelCase). A key that doesn't apply to a
given outcome rides along as `null` (or `[]` for list-valued keys) rather
than being omitted, specifically so an HA template can write `{{ percent }}`
without an `is defined` guard:

| variable | `graded` | `review` | `unresolved` | `refused` |
|---|---|---|---|---|
| `result` | `graded` | `review` | `unresolved` | `refused` |
| `learner_id` | ✓ or `null` | ✓ or `null` | `null` | ✓ or `null` |
| `test_id` | ✓ | ✓ | ✓ | ✓ |
| `session_id` | ✓ | ✓ | `null` | `null` |
| `percent` | ✓ or `null`* | `null` | `null` | `null` |
| `earned` | ✓ | `null` | `null` | `null` |
| `total` | ✓ | `null` | `null` | `null` |
| `pending_review` | `null` | ✓ | `null` | `null` |
| `reasons` | `[]` | ✓ | `[]` | `[]` |
| `items` | `[]` | ✓ | `[]` | `[]` |
| `code` | `null` | `null` | ✓ | ✓ |

\* `percent`/`earned`/`total` are the **gradebook's own row-count numbers**
(the same ones that drive pass/fail and the report card) — deliberately not
an independently computed points-weighted figure, so the room never announces
a different outcome than the report card records.

**What does NOT fire the hook:** a card the store has never seen, a card
whose records are all retired, or a scan that resolves to no live allocation
at all (`unknownCard`, `deadCard`, no-allocation). Those never reached a
resolved scan in the first place — see
[`logs-and-tracing.md`](./logs-and-tracing.md) for their own event names.

**Composed multi-section worksheets fire once per section** as each
independently reaches `graded` or lands in review — each fire carries that
section's own score, not the whole card's aggregate.

## 4. Reliability: the circuit breaker

The hook call is **fire-and-forget** — it is never awaited into the grading
path, and every call site wraps it in `.catch(() => {})`. **The hook can
never affect grading or block a receipt from printing**, even if Home
Assistant is completely down.

A "gateway failure" means either a thrown error **or** a returned
`{ok:false, error}` — the real adapter never throws outright, so both shapes
count identically toward the breaker. After **5 consecutive failures** the
breaker opens and backs off exponentially, capped at 60s. A success does not
explicitly reset the backoff window — it simply elapses, and the next
attempt (if it also succeeds) zeroes the failure count.

**There is no deduplication and no throttle by design** — two learners each
scoring 83% in the same minute both deserve their own light, so nothing here
collapses or drops a repeat.

| Event | Level | Meaning |
|---|---|---|
| `school.grading_hook.fired` | info | Success — carries `script` + `result` |
| `school.grading_hook.skipped` (`not_configured`) | debug | No `script` set for this hook — expected in a household that hasn't opted in |
| `school.grading_hook.skipped` (`backoff`) | warn | Circuit breaker open — HA call skipped entirely during the backoff window |
| `school.grading_hook.failed` | error | One failed HA call, breaker not yet open |
| `school.grading_hook.circuit_open` | error | 5th consecutive failure — backoff begins |
| `school.grading_hook.error` | error | Config load or outcome-shaping itself threw — **distinct from `.failed`**: this never touched the gateway or the breaker at all |

**Symptom: "the sound plays sometimes but not other times."** Check for
`.skipped { reason: 'backoff' }` or a preceding run of `.failed` — this is
the circuit breaker protecting against a flaky Home Assistant instance, not
a School defect. It self-heals once HA answers again.

## 5. How to isolate "is this HA, or is this the repo"

```bash
# 1. Confirm the hook actually fired (repo-side) — grep the log store
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:school.grading_hook AND _time:1h'

# 2. If it fired, confirm HA received and can run the script at all,
#    completely independent of a real scan:
node cli/dscli.mjs ha state script.school_worksheet_scan_notification

# 3. Manually trigger the exact same call this repo makes, with fabricated
#    variables, to test the HA script in isolation:
node cli/dscli.mjs ha call-service script school_worksheet_scan_notification \
  --data '{"result":"graded","learner_id":"learner3","test_id":"9251793","session_id":"ses_test","percent":92,"earned":23,"total":25,"pending_review":null,"reasons":[],"items":[],"code":null}' \
  --allow-write
```

If step 1 shows `.fired` but nothing happens in the room, **the defect is
inside the Home Assistant script**, not in this repo — step 3 proves it by
reproducing the exact call outside of any real scan. Fixing it means editing
the script inside Home Assistant's own configuration; there is nothing to
change here.

If step 1 shows no event at all for a scan that should have graded, work
backward through the OMR pipeline trace in
[`logs-and-tracing.md`](./logs-and-tracing.md#4b-omr-sheet-scan--grade--thermal-receipt--ha-sound-cue)
— the scan likely never reached a terminal outcome in the first place.

## 6. Where the code lives (this repo's half only)

| Layer | Path |
|---|---|
| Adapter (fires the HA service call, owns the circuit breaker) | `backend/src/1_adapters/school/SchoolGradingHookAdapter.mjs` |
| Wiring — `grading_hook` instance | `backend/src/app.mjs` (search `gradingHook = new SchoolGradingHookAdapter`) |
| Wiring — `piano_lesson_hook` instance | `backend/src/app.mjs` (search `pianoLessonHook = new SchoolGradingHookAdapter`) |
| Caller (OMR scan outcome → hook) | `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs` |
| Caller (piano lesson completion → hook) | `backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs` |
| Generic HA CLI (state/list/resolve/toggle/call-service) | `cli/commands/ha.mjs`, invoked as `node cli/dscli.mjs ha ...` |
| Config | `data/household/school/school.yml` → `grading_hook:` / `piano_lesson_hook:` |
| The actual sound/scene/announcement logic | **Home Assistant's own configuration — not in this repository** |
