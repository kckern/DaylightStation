# School Grading Hook — Design

**Status:** approved 2026-08-22

## Problem

A scanned OMR sheet produces an outcome that exists only on a screen and in the
log store. The household has home automation; a graded sheet should be able to
turn on a light, sound a chime, or do whatever the household decides — without
this repo knowing or caring which.

The failure outcomes matter more than the success one. A sheet the reader could
not read leaves no signal in the room at all; that is the case this hook is most
worth having.

## Goal

A config-driven hook that calls one Home Assistant script, with the grading
outcome as script variables, on every terminal scan outcome. Behaviour lives in
Home Assistant. This repo is a dumb pipe.

## Non-goals

- Deciding what should happen for a given score. That is Home Assistant's job.
- Score-band → script mapping in our config. Explicitly rejected: it puts
  behaviour in two places and forces a redeploy to retune a light.
- Per-learner overrides. Same reason. HA can branch on `learner_id`.
- Any coupling between home automation and whether grading succeeds.

## Design

### Component

`SchoolGradingHookAdapter` — `backend/src/1_adapters/school/`.

Modelled on `AmbientLedAdapter` (`1_adapters/fitness/`): injected gateway,
injected config loader, logger, circuit breaker, metrics, and a public method
that **never throws** — it returns `{ok, skipped?, reason?}` the way the LED
adapter does, so callers can await it without a try/catch.

### Attachment point

`createSchoolPrintScanConsumer` gains one optional dependency, `gradingHook`.
At each of the four terminal outcomes it already logs, it also fires the hook
and awaits the (non-throwing) result.

Attached at the consumer rather than subscribing to Slice C's `omr` broadcast:
the outcomes are already resolved in hand there, it is the same process, and a
bus subscriber adds indirection for a single publisher. Slice C's broadcast
remains the frontend's transport and is unaffected.

Absent dependency or absent config → no-op, no log noise beyond one debug line.

### Config

`school.yml`:

```yaml
grading_hook:
  script: script.school_graded
```

That is the entire surface. The presence of `script` is the enable switch —
the same convention as `ambient_led` requiring `scenes.off`. No `enabled` flag,
no bands, no throttle knob.

### Dispatch

`gateway.callService('script', '<bare name>', vars)`.

`runScript(scriptId)` takes no parameters, so `callService` is the only
parameterised path. Data passed to `script.<name>` becomes that script's
variables in Home Assistant.

A configured value of `script.school_graded` splits to domain `script`,
service `school_graded`. A value with no `script.` prefix is used as the
service name as-is.

### Variable contract

**Every call carries the same key set**, with inapplicable values as `null`
(and empty arrays for the list-valued keys):

| variable | graded | review | unresolved | refused |
|---|---|---|---|---|
| `result` | `graded` | `review` | `unresolved` | `refused` |
| `learner_id` | ✓ | ✓ | `null` | ✓ or `null` |
| `test_id` | ✓ | ✓ | ✓ | ✓ |
| `session_id` | ✓ | ✓ | `null` | ✓ or `null` |
| `percent` | ✓ | `null` | `null` | `null` |
| `earned` | ✓ | `null` | `null` | `null` |
| `total` | ✓ | `null` | `null` | `null` |
| `pending_review` | `null` | ✓ | `null` | `null` |
| `reasons` | `[]` | ✓ | `[]` | `[]` |
| `items` | `[]` | ✓ | `[]` | `[]` |
| `code` | `null` | `null` | ✓ | ✓ |

Uniformity is deliberate. Home Assistant templates are awkward with
sometimes-missing variables; `{{ percent }}` resolving to `None` is far easier
to write against than requiring `is defined` guards on every branch. Keys are
snake_case to match HA convention, not the camelCase used inside this codebase.

### Failure behaviour

Grading must never be affected by home automation.

- The adapter never throws. A gateway error returns `{ok:false, error}`.
- Circuit breaker copied from `AmbientLedAdapter`: 5 consecutive failures opens
  it, exponential backoff capped at 60s, a success closes it.
- **No deduplication.** Two learners both scoring 83% each deserve their own
  light. The LED adapter dedupes because a scene is a *state*; a grade is an
  *event*.
- **No throttle.** Three children scanning in succession must all fire. A 2s
  window would silently swallow the second and third.

Logs: `school.grading_hook.fired` (with `result` and the script called),
`.skipped` (with reason), `.failed`, `.circuit_open`.

### Testing

Stubbed gateway, no network, no data volume:

1. Each of the four outcomes produces the documented variable set — including
   the `null`/`[]` filling for inapplicable keys.
2. Absent `grading_hook` config makes zero gateway calls.
3. A gateway that throws does not propagate; the consumer still completes the
   grading path.
4. The breaker opens after 5 consecutive failures and backs off.
5. `script.foo` and bare `foo` both dispatch to service `foo`.

Location and runner: `tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs`,
**vitest** with an explicit `import { describe, it, expect } from 'vitest'`.
That matches both siblings — `tests/isolated/adapter/fitness/AmbientLedAdapter.test.mjs`
(the adapter this one is modelled on) and the existing
`tests/isolated/adapter/school/*.test.mjs` files. It is in the `gate-vitest`
population, so it is protected by the now-empty baseline.

## Risks

**The hook fires on every scan, including reprints and rescans.** A rescanned
sheet is a real second event and will fire again. If that turns out to be
noisy in practice, the fix belongs in the HA script (which can debounce on
`session_id`), not here — consistent with the thin-pipe decision.

**A wedged reader could fire repeatedly.** The circuit breaker protects Home
Assistant from a failing gateway, but not from a reader producing many valid
scans. Accepted: the same reader would already be spamming the log store and
the on-screen ceremony, so this is not a new failure mode and not worth a
throttle that would break the legitimate three-children-in-a-row case.
