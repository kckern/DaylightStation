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
    ▼                                          │  (__backend/src/3_applications/school/)
thermal receipt printed via ReceiptPrinting    ┘  — a receipt prints regardless
    │                                              of anything below this line
    ▼
SchoolGradingHookAdapter.fire(result, ...)     ┐
    │  builds 11 named variables, calls        │  THIS REPO
    │  gateway.callService('script', <name>)   │  (__backend/src/1_adapters/school/
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
does not exist anywhere in this codebase or its data tree. The script lives in
Home Assistant's own configuration, at
`_includes/scripts/school_worksheet_scan_notification.yaml` under HA's config
directory on `{env.prod_host}`.

**Since 2026-09-22 the phone text is not written by HA.** The backend composes
it (`2_domains/school/notifications/schoolPush.mjs`) and sends it as the
`notification` variable. The HA script plays the siren from `result` and
relays `notification` verbatim. See
[`reference/notifications/push-standard.md`](../../reference/notifications/push-standard.md).

## 2. Configuration — three independent hook instances

All live in `data/household/school/school.yml` and are wired by the same
adapter class, `SchoolGradingHookAdapter`, with a different `configKey`:

| Config key | Fires when | Variables |
|---|---|---|
| `grading_hook` | Every terminal OMR paper-scan outcome (see §3) | the §3 key set |
| `piano_lesson_hook` | Once per learner per study day, the moment the assigned daily piano lesson (the `piano-course` program) crosses completion | `result: 'satisfied'`, `learner_id`, `student`, `subject: 'arts'`, `course`, `lesson`, `percent` (course completion, not a lesson score), `notification` |
| `presence_hook` | Someone is working in the school room (§7): a study-reader card tap, an OMR sheet, or Portal use | `result: 'present'`, `source` (`card` \| `omr` \| `portal`), `location`, `device`, `event`, `learner_id`, `student`; the grading keys ride as `null` |

```yaml
grading_hook:
  script: script.school_worksheet_scan_notification

piano_lesson_hook:
  script: script.school_worksheet_scan_notification   # same script, both hooks, in this household today

presence_hook:
  script: script.school_presence   # absent = off
  cooldownMinutes: 5               # one HA call per window, shared by all sources; 0 = every event
  devices: [portal]                # SCREEN ids (/screen/<id>) that mean "a person is in the study"; not hardware device ids
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

## 3. The terminal outcomes and their variables

Every call carries the **same key set**, snake_case (to match Home Assistant
convention, not this codebase's camelCase). A key that doesn't apply to a
given outcome rides along as `null` (or `[]` for list-valued keys) rather
than being omitted. Beware: Jinja's `default('x')` does **not** replace a
`null`, so a template must write `default('x', true)`. The original script
missed this and rendered `None` in 60% of school pushes.

**Real `result` values**, as sent:

- A graded scan settles to `passed` or `needs_remediation`. It stays `graded`
  only when settling isn't wired or fails.
- A scan that did not finish grading sends `partial` (with `code: partial_scan`
  or `live_record_unmarked`), `review`, `unresolved` or `refused`.
- The piano hook sends `satisfied`.

| variable | graded (`passed` / `needs_remediation`) | `review` | `unresolved` | `refused` |
|---|---|---|---|---|
| `result` | as settled | `review` | `unresolved` | `refused` |
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
| `subject` / `course` / `unit` / `lesson` | ids, not labels | ids | `null` | `null` |
| `notification` | composed push | composed push | composed push | composed push |

`notification` is `{title, message, data}` (the finished phone copy), or `null`
when the phone should hear nothing. For example, an unmarked old record on a
card whose other work graded is sent as `null`. The HA script relays an object
verbatim, sends nothing for `null`, and falls back to minimal legacy text only
when the key is missing, which means an older backend.

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
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:school.grading_hook AND _time:1h'

# 2. If it fired, confirm HA received and can run the script at all,
#    completely independent of a real scan:
node cli/dscli.mjs ha state script.school_worksheet_scan_notification

# 3. Manually trigger the exact same call this repo makes, with fabricated
#    variables, to test the HA script in isolation. "notification": null
#    plays the siren without pushing a fake result to the phone:
node cli/dscli.mjs ha call-service script school_worksheet_scan_notification \
  --data '{"result":"passed","learner_id":"learner3","test_id":"9251793","session_id":"ses_test","percent":92,"earned":23,"total":25,"pending_review":null,"reasons":[],"items":[],"code":null,"notification":null}' \
  --allow-write
```

Leaving `notification` out of a manual test takes the legacy branch and does
push. Before 2026-09-22 that is how a siren test sent a real "Worksheet
Passed" to the phone.

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
| Adapter (fires the HA service call, owns the circuit breaker, cooldown) | `__app_modules/learning/school/server/adapters/SchoolGradingHookAdapter.mjs` |
| Wiring — the three hook instances (`grading_hook`, `piano_lesson_hook`, `presence_hook`) | `__app_modules/learning/school/server/composition/lifecycle-runtime.mjs` |
| Caller (OMR scan outcome → hook; also the `omr` presence source) | `__app_modules/learning/school/server/application/workflows/SchoolPrintScanConsumer.mjs` |
| Caller (piano lesson completion → hook) | `__app_modules/learning/school/server/application/PianoLessonCeremonyBridge.mjs` |
| Presence source: `card` (print-agenda taps) | `__app_modules/learning/school/server/application/workflows/LearnerCardActions.mjs` |
| Presence source: `portal` (Express middleware on the school router) | `__app_modules/learning/school/server/api/presenceMiddleware.mjs` |
| Portal device id (set once, sent as `X-Daylight-Device`) | `__app_modules/learning/school/browser/schoolDevice.js` |
| Generic HA CLI (state/list/resolve/toggle/call-service) | `cli/commands/ha.mjs`, invoked as `node cli/dscli.mjs ha ...` |
| Config | `data/household/school/school.yml` → `grading_hook:` / `piano_lesson_hook:` |
| Phone copy (title, body, tag, channel) | `__backend/src/2_domains/school/notifications/schoolPush.mjs`, composed by the two callers above |
| The actual sound/scene/announcement logic | **Home Assistant's own configuration — not in this repository** (`_includes/scripts/school_worksheet_scan_notification.yaml`) |

## 7. The presence hook (study room lights)

When someone is working in the school room (HA area "Study"), the backend
calls HA `script.school_presence`, which turns on the study and living-room
main lights at any hour. The script lives in HA's config at
`_includes/scripts/school_presence.yaml` on `{env.prod_host}` (not in this
repo). It is the third `SchoolGradingHookAdapter` instance
(`configKey: 'presence_hook'`) and obeys the same rules as §4: fire-and-forget,
never on the print/grade/request path, same circuit breaker.

**Sources** (`source` variable):

- `card`: every print-agenda outcome at a reader whose `learner_action` is
  `print-agenda` (the study reader, per the triggers `sources.yml`). The
  living-room reader runs `reading-session` and never fires it.
- `omr`: every sheet event, unreadable ones included. `device` is the
  event-bus topic (e.g. `omr`, `omr-study`), not the reader id.
- `portal`: Express middleware on the school router. Any POST whose
  `X-Daylight-Device` header (or body `deviceId`; a `fleet:` prefix is
  stripped) is listed in `devices`. That id is the SCREEN id
  (`deviceIdFor` returns it; the Portal is `/screen/<id>`), not a hardware
  device id. `devices` is read from the boot-cached config snapshot: restart
  (or reload household config) after editing `school.yml`. GETs never fire. The browser sets the id
  once (SchoolShell, `browser/schoolDevice.js`) and every school API client
  sends the header.

**Ignored on purpose** (a person is not acting): paths under
`/card-ladder/test/` (grown-up test door), `/reading/` (automatic acks),
paths ending `/heartbeat` (flashcard 30 s timer), and any body with
`mode: 'test'`. **Counted on purpose:** remote-launch `POST /sessions` (a
grown-up sending work implies a child is about to be there) and the
media-lesson playhead `POST /lesson/:id/position` (someone is watching).

**Cooldown.** `cooldownMinutes` allows one HA call per window, shared by all
sources, so one child's tap covers a sibling's inside the window. It is armed
*before* the HA call (concurrent fires dedupe) and released if the call
fails. `0` fires on every event. The cooldown is per adapter instance and held
in memory, so a restart clears it.

| Event | Meaning |
|---|---|
| `school.presence_hook.fired` | HA call succeeded |
| `school.presence_hook.skipped` (`not_configured` / `backoff` / `cooldown`) | No `script` set / breaker open / inside the window. `cooldown` skips are rate-limited (2/min + aggregate); `not_configured` is debug-only |
| `school.presence_hook.failed`, `.circuit_open`, `.reset` | As §4 |

**"The lights didn't come on" checklist:**

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:school.presence_hook AND _time:1h'
```

1. No events at all: is the `presence_hook` key (with `script`) in
   `school.yml`, and has the container restarted since it was added
   (boot-cached)? For `portal`, does the request carry the device header?
   A Portal running a stale bundle sends no header until it is reloaded.
2. `skipped` with `cooldown`: a recent event already fired; expected. This
   line is rate-limited (at most 2 a minute, then an aggregate line), so it
   may be absent even when skips happened. The other tell is a `.fired`
   within the last `cooldownMinutes`.
3. `skipped` with `backoff`, or `failed` / `circuit_open`: HA is flaky; see §4.
4. `fired` but the lights stayed off: the fault is inside the HA script;
   test it with `node cli/dscli.mjs ha state script.school_presence`.
