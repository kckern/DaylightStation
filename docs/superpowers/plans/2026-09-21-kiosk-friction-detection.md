# Kiosk Friction Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Portal and Piano kiosks their own automatic first line of
defense against unsupervised chaos (repeated rejected codes, mashed keys,
rejected ISBN prefixes, mashed video restarts) — a per-device rolling
friction score that flips a State Gates entitlement, driving an in-app
soft-lock that actually disables input (not just a visual cover) and
self-clears, with no dependency on the flaky FKB bridge or the pending
Portal Keys APK rebuild.

**Architecture:** Raw signals feed a small new `KioskFrictionTracker`
application service (NOT part of State Gates) that keeps a short rolling
window per device and publishes a numeric `kiosk.friction-score` assertion,
using the SAME producer pattern `SchoolStateGatesProducer.mjs` already uses
(stable per-subject assertion id, monotonic `sourceRevision`, explicit
period bounds, `validUntil` for decay) — a first pass at this plan invented
a different, incompatible assertion shape and caught it in adversarial
review. State Gates does only what it already does well: a `comparison` gate
turns the number crossing a policy threshold into a four-state evaluation,
and an `entitlement` turns the gate into `granted`/`denied` — the exact
mechanism `piano.games` already uses, reused by both kiosks via a new shared
`useKioskAccess` hook mirroring `useSchoolGameAccess`.

**Tech Stack:** Node ESM backend (DDD layers), React 18 frontend, State
Gates bounded context, Vitest (frontend) / whichever runner each backend
file's siblings already use (mixed in this codebase — check per file, do
not assume Vitest), existing `useWebSocketSubscription`.

**Spec:** `docs/superpowers/specs/2026-09-21-kiosk-friction-detection-design.md`

**Corrections to the spec/first plan draft, found by adversarial review:**

1. **The household manual-lockdown composition (spec §6) is unnecessary and
   was going to be broken anyway.** Both kiosks already black out in
   software on the existing manual/NFC lockdown — `SchoolApp.jsx` and
   `PianoApp.jsx` already consume a `useShutdownLock` hook and render a
   `ShutdownBlackout` component. The spec's "only blacks out browser
   content, the Portal's physical buttons stay live" problem is about the
   `portal_keys` APK integration specifically, which no State Gates claim
   can fix regardless. This plan drops the `household.manual-lockdown`
   claim, the `household.not-locked-down` gate, and the `ShutdownService`
   integration (spec §6) entirely. `kiosk.access` is just `kiosk.friction-ok`.
2. **The assertion/period model in the first draft could never actually
   publish.** State Gates requires a stable `assertionId`, a strictly
   increasing `sourceRevision` on correction, and an explicit `period.id` —
   none of which a fresh sliding 5-minute window per ping can honestly
   provide (a fresh id per ping either 409s on the second ping, at a stable
   id, or accumulates unbounded live assertion instances, at a fresh one
   per ping). Task 3 below uses `SchoolStateGatesProducer.mjs`'s exact
   pattern instead: one stable assertion per `(device, calendar day)`,
   corrected in place, `validUntil` driving decay.
3. **Policy is a JS object shipped in code** (`installedStateGatesPolicy.mjs`),
   not a household YAML file — there is no authored
   `data/household/state-gates/config.yml` in this household, and creating
   one from a partial file would silently drop the installed `piano.games`
   graph.
4. **The device router, ingress path, and test locations in the first draft
   were all wrong** — corrected file-by-file in Tasks 3/4/2 below, each with
   the real path confirmed during planning.
5. **A `<div>` intercepting pointer/key events cannot actually block input**
   that a sibling component's own global key handlers are listening for.
   Task 6 now disables the underlying input-accepting hooks directly
   (gated on `granted`), with the cover as the visible explanation, not the
   enforcement mechanism.

## Global Constraints

- Entitlement failure posture is **fail_open** — a missing/unreadable
  `kiosk.friction-score` claim, or a State Gates read failure on the kiosk
  side, must resolve to **granted**. This is the opposite of `piano.games`
  and is the single easiest mistake to make copying that hook.
- The rolling-window arithmetic lives in the tracker service, never in
  State Gates policy.
- `friction-ping` calls are fire-and-forget from the client; a failed ping
  must never block or degrade the actual kiosk feature in progress.
- v1 wires exactly 5 signals: `code.rejected`, `keypad.stray-press` burst,
  `add.rejected: not-a-book-prefix` burst, IME-mash flurry,
  `piano.video.restart` mashing. Rapid profile-hopping and gamepad-reseed
  are explicitly deferred — do not wire them in this plan.
- The friction-score window length and comparison threshold are policy
  values (spec §10 open question 1, unresolved) — ship the spec's starting
  suggestion (5-minute window, threshold **5**) as the initial value, in a
  code comment marked provisional, not silently treated as final.
- Enforcement is immediate at the configured threshold — the spec's dry-run
  idea (log without enforcing for a week) is a separate open question KC
  has not answered; this plan does not build a dry-run mode. If a dry-run
  is wanted later, the threshold/posture are policy values, changeable
  without new code.

---

### Task 1: Pure rolling-window domain function

**Files:**
- Create: `backend/src/2_domains/devices/kioskFrictionWindow.mjs`
- Test: `backend/src/2_domains/devices/kioskFrictionWindow.test.mjs`

**Interfaces:**
- Produces:
  `export function recordFrictionPing(events, { at, windowMs })` →
  `events` filtered to the window, plus the new ping appended (pure, no
  mutation of the input array).
  `export function frictionScore(events, { at, windowMs })` → integer count
  of events within `[at - windowMs, at]`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/2_domains/devices/kioskFrictionWindow.test.mjs
import { describe, it, expect } from 'vitest';
import { recordFrictionPing, frictionScore } from './kioskFrictionWindow.mjs';

describe('kioskFrictionWindow', () => {
  it('starts empty and scores zero', () => {
    expect(frictionScore([], { at: 1000, windowMs: 60000 })).toBe(0);
  });

  it('counts a ping recorded inside the window', () => {
    const events = recordFrictionPing([], { at: 1000, windowMs: 60000 });
    expect(frictionScore(events, { at: 1000, windowMs: 60000 })).toBe(1);
  });

  it('drops a ping once it ages out of the window', () => {
    let events = recordFrictionPing([], { at: 0, windowMs: 60000 });
    events = recordFrictionPing(events, { at: 30000, windowMs: 60000 });
    expect(frictionScore(events, { at: 30000, windowMs: 60000 })).toBe(2);
    expect(frictionScore(events, { at: 61001, windowMs: 60000 })).toBe(1);
  });

  it('does not mutate the input array', () => {
    const events = Object.freeze(recordFrictionPing([], { at: 0, windowMs: 60000 }));
    expect(() => recordFrictionPing(events, { at: 1, windowMs: 60000 })).not.toThrow();
  });

  it('recordFrictionPing itself prunes stale events, so state never grows unbounded', () => {
    let events = recordFrictionPing([], { at: 0, windowMs: 1000 });
    events = recordFrictionPing(events, { at: 5000, windowMs: 1000 });
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe(5000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run backend/src/2_domains/devices/kioskFrictionWindow.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/devices/kioskFrictionWindow.mjs
/**
 * Per-device rolling friction window — pure, no clock, no I/O. State Gates
 * itself has no "N events in the last M minutes for one subject" primitive
 * (its `count` expression counts across a set of subjects sharing one
 * period, a different shape); this is the small piece that does that
 * arithmetic, so State Gates can be asked only to compare a number against
 * a policy threshold.
 */
export function recordFrictionPing(events, { at, windowMs }) {
  const pruned = events.filter((event) => at - event.at <= windowMs);
  return [...pruned, { at }];
}

export function frictionScore(events, { at, windowMs }) {
  return events.filter((event) => at - event.at <= windowMs).length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run backend/src/2_domains/devices/kioskFrictionWindow.test.mjs`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/devices/kioskFrictionWindow.mjs backend/src/2_domains/devices/kioskFrictionWindow.test.mjs
git commit -m "feat(devices): add pure kiosk friction rolling-window functions"
```

---

### Task 2: State Gates policy — claim, gate, entitlement (installed, in code)

**Files:**
- Modify: `backend/src/5_composition/modules/installedStateGatesPolicy.mjs`
  — this is a plain frozen JS object (`INSTALLED_STATE_GATES_POLICY`,
  snake_case keys, `'$subject'`/`'$period'` as literal strings), not YAML.
  There is no authored household `state-gates/config.yml` for this
  household — this file IS the graph. Add to it directly.
- Test: `tests/isolated/domain/state-gates/stateGatesDomain.test.mjs` — the
  real existing policy/evaluation test suite (confirmed present during
  planning; a first draft of this task guessed a nonexistent test location
  under `backend/src/3_applications/state-gates/`).

**Interfaces:**
- Produces: claim type `kiosk.friction-score` (`subject_kinds: ['device']`,
  `period_kinds: ['interval']`, `value: { type: 'number', min: 0 }`,
  `accepted_publishers: ['kiosk-friction-tracker']`); gate `kiosk.friction-ok`
  (`not(comparison gte threshold))`); entitlement `kiosk.access` = gate
  `kiosk.friction-ok`, `failure_posture: 'fail_open'`.

- [ ] **Step 1: Write the failing policy test**

Read `tests/isolated/domain/state-gates/stateGatesDomain.test.mjs` in full
first to copy its exact fixture-construction pattern (how it builds a
`PolicyGraph`, posts assertions, and reads back an entitlement decision).
Add a case: given a posted `kiosk.friction-score` assertion of value `4` for
subject `{ kind: 'device', id: 'portal' }`, `kiosk.access` evaluates
`granted`. Given a posted value of `6`, `denied`. Given **no assertion at
all** for a fresh device, `granted` — this is the fail-open case and the
single most important assertion in this test (the mirror of the mistake
`piano.games`'s fail-closed posture would make here).

- [ ] **Step 2: Run the test to verify it fails**

Run whatever command that test file's siblings use.
Expected: FAIL — the new claim/gate/entitlement do not exist yet.

- [ ] **Step 3: Add the policy definitions**

In `installedStateGatesPolicy.mjs`, inside `INSTALLED_STATE_GATES_POLICY`:

```js
  publishers: {
    school: { description: 'School learner-day completion authority' },
    fitness: { description: 'Fitness weekly movement authority' },
    'kiosk-friction-tracker': { description: 'Per-device unsupervised-input friction score' },
  },
```

```js
  claim_types: {
    // ...existing 'school.day.complete' and 'fitness.weekly.rings'...
    'kiosk.friction-score': {
      schema_version: 1,
      value: { type: 'number', min: 0 },
      subject_kinds: ['device'],
      period_kinds: ['interval'],
      accepted_publishers: ['kiosk-friction-tracker'],
      visibility: 'administrative',
    },
  },
```

```js
  gates: {
    // ...existing 'school.day-complete' and 'fitness.weekly-rings'...
    'kiosk.friction-ok': {
      schema_version: 1,
      subject_kinds: ['device'],
      period_kinds: ['interval'],
      expression: {
        not: {
          comparison: {
            claim: {
              type: 'kiosk.friction-score', publisher: 'kiosk-friction-tracker',
              subject: '$subject', period: '$period',
            },
            op: 'gte',
            // PROVISIONAL threshold — spec §10 open question 1. Retune
            // against real friction-score history; do not treat as final.
            value: 5,
          },
        },
      },
      reason_labels: {
        CLAIM_FALSE: 'This device is in a cooldown.',
      },
    },
  },
```

```js
  entitlements: {
    'piano.games': { gate: 'school.day-complete', failure_posture: 'fail_closed' },
    'kiosk.access': { gate: 'kiosk.friction-ok', failure_posture: 'fail_open' },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Register the new publisher principal**

In `backend/src/app.mjs`, near where `schoolStateGatesPrincipal =
Object.freeze({ service: 'school-state-gates-producer' })` is declared
(line ~1537) and where `producerPrincipals: { school: ..., fitness: ... }`
is passed into `createStateGatesModule` (line ~1552), add:

```js
const kioskFrictionStateGatesPrincipal = Object.freeze({ service: 'kiosk-friction-tracker' });
// ...
producerPrincipals: {
  school: schoolStateGatesPrincipal,
  fitness: fitnessStateGatesPrincipal,
  'kiosk-friction-tracker': kioskFrictionStateGatesPrincipal,
},
```

(This principal object is threaded to `KioskFrictionTracker` in Task 3 —
note it here so Task 3 doesn't have to rediscover this wiring point.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/5_composition/modules/installedStateGatesPolicy.mjs backend/src/app.mjs
git commit -m "feat(state-gates): add kiosk.friction-score claim and kiosk.access entitlement (fail-open)"
```

---

### Task 3: `KioskFrictionTracker` application service + friction-ping endpoint

**Files:**
- Create: `backend/src/3_applications/devices/services/KioskFrictionTracker.mjs`
  (in `services/`, alongside `PianoScreenAuthorityService.mjs`/
  `PianoMidiWakeService.mjs` — confirmed sibling location; a first draft
  placed this at the folder root)
- Test: `backend/src/3_applications/devices/services/
  KioskFrictionTracker.test.mjs` — **before writing, check the test runner
  `PianoScreenAuthorityService.test.mjs`/`DeviceFactory.test.mjs` actually
  use** (this codebase mixes `node:test` and Vitest across different areas;
  a first draft assumed Vitest here without checking and would have run
  nothing). Match whichever runner this folder's siblings use.
- Modify: `backend/src/4_api/v1/routers/device.mjs` — add a friction-ping
  route using this file's own relative-path convention (routes are declared
  relative, e.g. `router.post('/:deviceId/presence', ...)`, not with a
  leading `/api/v1/device/...` — that prefix is applied at the mount point,
  not per-route).
- Modify: `backend/src/app.mjs` — construct `KioskFrictionTracker` and wire
  it to the router, alongside the `stateGatesModule.ingress`/
  `producerPrincipals` wiring from Task 2, and alongside wherever
  `PianoScreenAuthorityService`/`PianoMidiWakeService` are constructed.

**Interfaces:**
- Consumes: `recordFrictionPing`/`frictionScore` from Task 1;
  `stateGatesModule.ingress.observe(householdId, principal, assertion)` and
  `.retract(...)` (the actual ingress surface in-process producers use — NOT
  `ObserveAssertion.execute` directly, which is the HTTP/admin-facing use
  case, not the in-process producer path) with the
  `kioskFrictionStateGatesPrincipal` from Task 2 Step 5.
- Produces: `export class KioskFrictionTracker { constructor({ ingress, householdId, principal, windowMs, clock, logger }); async recordFriction({ deviceId, kind }); }`

- [ ] **Step 1: Read `SchoolStateGatesProducer.mjs` in full**

This service is deliberately modeled on it (`#nextRevision`, stable
per-subject assertion id, explicit period bounds, `validUntil`). Read it
completely before writing a line — do not re-derive the assertion shape
from scratch a second time.

- [ ] **Step 2: Write the failing test**

```js
// (file extension/runner per Task 3's own file-header instruction above)
import { describe, it, expect, vi } from 'vitest'; // or node:test — match siblings
import { KioskFrictionTracker } from './KioskFrictionTracker.mjs';

function setup({ now = Date.UTC(2026, 8, 21, 12, 0, 0) } = {}) {
  const ingress = { observe: vi.fn(async () => ({ accepted: true })) };
  let clockValue = now;
  const clock = () => clockValue;
  const principal = { service: 'kiosk-friction-tracker' };
  const tracker = new KioskFrictionTracker({
    ingress, householdId: 'test-household', principal, windowMs: 60000, clock, logger: { warn: vi.fn() },
  });
  return { tracker, ingress, advance: (ms) => { clockValue += ms; } };
}

describe('KioskFrictionTracker', () => {
  it('publishes a stable per-device-per-day assertion with the current rolling count', async () => {
    const { tracker, ingress } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    const [householdId, principal, assertion] = ingress.observe.mock.calls[0];
    expect(householdId).toBe('test-household');
    expect(principal).toEqual({ service: 'kiosk-friction-tracker' });
    expect(assertion).toMatchObject({
      claimType: 'kiosk.friction-score',
      subject: { kind: 'device', id: 'portal' },
      value: 1,
    });
    expect(typeof assertion.assertionId).toBe('string');
    expect(assertion.assertionId).toContain('portal');
    expect(Number.isInteger(assertion.sourceRevision)).toBe(true);
    expect(assertion.sourceRevision).toBeGreaterThan(0);
    expect(typeof assertion.period?.id).toBe('string');
    expect(Number.isFinite(assertion.period?.startsAt)).toBe(true);
    expect(Number.isFinite(assertion.period?.endsAt)).toBe(true);
    expect(assertion.validUntil).toBeLessThanOrEqual(assertion.period.endsAt);
  });

  it('corrects the SAME assertion id in place across multiple pings the same day, with a strictly increasing sourceRevision', async () => {
    const { tracker, ingress } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    await tracker.recordFriction({ deviceId: 'portal', kind: 'code-rejected' });
    const [, , first] = ingress.observe.mock.calls[0];
    const [, , second] = ingress.observe.mock.calls[1];
    expect(second.assertionId).toBe(first.assertionId);
    expect(second.sourceRevision).toBeGreaterThan(first.sourceRevision);
    expect(second.value).toBe(2);
  });

  it('keeps separate rolling counts and separate assertion ids per device', async () => {
    const { tracker, ingress } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    await tracker.recordFriction({ deviceId: 'yellow-room-tablet', kind: 'video-restart' });
    const [, , portalAssertion] = ingress.observe.mock.calls[0];
    const [, , pianoAssertion] = ingress.observe.mock.calls[1];
    expect(portalAssertion.assertionId).not.toBe(pianoAssertion.assertionId);
    expect(portalAssertion.value).toBe(1);
    expect(pianoAssertion.value).toBe(1);
  });

  it('a failed publish does not throw back to the caller (fire-and-forget posture)', async () => {
    const ingress = { observe: vi.fn(async () => { throw new Error('state gates unreachable'); }) };
    const logger = { warn: vi.fn() };
    const tracker = new KioskFrictionTracker({
      ingress, householdId: 'test-household', principal: { service: 'kiosk-friction-tracker' },
      windowMs: 60000, clock: () => 0, logger,
    });
    await expect(tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' })).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Expected: FAIL — module does not exist.

- [ ] **Step 4: Write the implementation**

```js
// backend/src/3_applications/devices/services/KioskFrictionTracker.mjs
import { recordFrictionPing, frictionScore } from '#domains/devices/kioskFrictionWindow.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar-day boundary — friction cooldown does not need household-
 * timezone precision (unlike School's study-day semantics); this is purely
 * for assertion-id/period stability, not curriculum logic, so importing a
 * School domain util here would be the wrong layer dependency anyway. */
function utcDayWindow(at) {
  const dayStart = Math.floor(at / DAY_MS) * DAY_MS;
  return { day: new Date(dayStart).toISOString().slice(0, 10), startsAt: dayStart, endsAt: dayStart + DAY_MS };
}

/**
 * Tracks a short rolling window of "friction" signals per device and keeps
 * State Gates' `kiosk.friction-score` claim current — one stable assertion
 * per (device, calendar day), corrected in place with a strictly increasing
 * `sourceRevision`, exactly the pattern `SchoolStateGatesProducer.mjs` uses.
 * Never throws back to a caller.
 */
export class KioskFrictionTracker {
  #ingress; #householdId; #principal; #windowMs; #clock; #logger;
  #eventsByDevice = new Map(); #revisions = new Map();

  constructor({ ingress, householdId, principal, windowMs, clock = () => Date.now(), logger = console }) {
    if (!ingress?.observe) throw new Error('KioskFrictionTracker requires ingress.observe');
    if (!householdId) throw new Error('KioskFrictionTracker requires householdId');
    if (!principal) throw new Error('KioskFrictionTracker requires principal');
    this.#ingress = ingress;
    this.#householdId = householdId;
    this.#principal = principal;
    this.#windowMs = windowMs;
    this.#clock = clock;
    this.#logger = logger;
  }

  #nextRevision(assertionId, observedAt) {
    const candidate = Math.max(1, Math.trunc(observedAt));
    const next = Math.max(candidate, (this.#revisions.get(assertionId) ?? 0) + 1);
    this.#revisions.set(assertionId, next);
    return next;
  }

  async recordFriction({ deviceId, kind }) {
    const at = this.#clock();
    const events = recordFrictionPing(this.#eventsByDevice.get(deviceId) ?? [], { at, windowMs: this.#windowMs });
    this.#eventsByDevice.set(deviceId, events);
    const value = frictionScore(events, { at, windowMs: this.#windowMs });

    const { day, startsAt, endsAt } = utcDayWindow(at);
    const assertionId = `kiosk:friction-score:${deviceId}:${day}`;
    try {
      await this.#ingress.observe(this.#householdId, this.#principal, {
        assertionId,
        claimType: 'kiosk.friction-score',
        subject: { kind: 'device', id: deviceId },
        period: { kind: 'interval', id: `kiosk-day:${deviceId}:${day}`, startsAt, endsAt },
        value,
        sourceRevision: this.#nextRevision(assertionId, at),
        observedAt: new Date(at).toISOString(),
        validFrom: new Date(at).toISOString(),
        // Decay: the claim naturally goes stale `windowMs` after the LAST
        // ping, well inside the day-long period, so a quiet device re-opens
        // on its own without an active decrement job.
        validUntil: new Date(Math.min(at + this.#windowMs, endsAt)).toISOString(),
      });
    } catch (error) {
      this.#logger.warn?.('devices.kiosk-friction.publish-failed', { deviceId, kind, error: error.message });
    }
  }
}

export default KioskFrictionTracker;
```

**Before finalizing this step**, confirm the exact field names `ingress.
observe`'s assertion argument expects (`claimType` vs `claimTypeId`,
`validFrom`/`validUntil` as ISO strings vs epoch ms) against
`SchoolStateGatesProducer.mjs`'s own `#publish` call — that file is the
ground truth read in Step 1; match it exactly rather than the sketch above
if anything differs.

- [ ] **Step 5: Run the test to verify it passes**

Expected: PASS.

- [ ] **Step 6: Add the HTTP endpoint**

In `backend/src/4_api/v1/routers/device.mjs`, following its existing
relative-path/`asyncHandler`/`mapCommand`-or-equivalent error convention:

```js
router.post('/:deviceId/friction-ping', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { kind } = req.body ?? {};
  if (typeof kind !== 'string' || !kind) {
    return res.status(400).json(buildErrorBody({ error: 'kind is required', code: 'INVALID_ENVELOPE' }));
  }
  await kioskFrictionTracker.recordFriction({ deviceId, kind });
  res.json({ ok: true });
}));
```

(Match this file's actual existing error-body helper — `buildErrorBody`/
`ERROR_CODES` are already imported at the top of `device.mjs`; reuse them
rather than a bespoke error shape.)

- [ ] **Step 7: Write a router-level test**

Follow whichever existing test pattern covers a sibling route in this same
file's test sibling. Valid request → `200 { ok: true }`,
`kioskFrictionTracker.recordFriction` called with the right args; missing
`kind` → `400`.

- [ ] **Step 8: Wire `KioskFrictionTracker` into `app.mjs`**

Construct it where `stateGatesModule` and the device router are already
being assembled (Task 2 Step 5's location), passing
`stateGatesModule.ingress`, the household id, `kioskFrictionStateGatesPrincipal`,
and a `windowMs` constant matching the policy's threshold window (5 minutes
— add a short comment cross-referencing `installedStateGatesPolicy.mjs`'s
own threshold comment so the two don't silently drift apart; there is no
existing "read the policy's own value back out" convention to lean on
instead).

- [ ] **Step 9: Run the full devices and router test suites**

Run whatever commands this area's siblings use (confirmed per-file in Steps
2/7).
Expected: PASS, no regressions.

- [ ] **Step 10: Commit**

```bash
git add backend/src/3_applications/devices/services/KioskFrictionTracker.mjs backend/src/3_applications/devices/services/KioskFrictionTracker.test.mjs backend/src/4_api/v1/routers/device.mjs backend/src/app.mjs
git commit -m "feat(devices): add KioskFrictionTracker service and friction-ping endpoint"
```

---

### Task 4: Wire `code.rejected` into the tracker

**Files:**
- Modify: `backend/src/3_applications/school/usecases/ResolveAccessCode.mjs`
  — confirmed during planning: this use case already has `deviceId`
  (`resolve({ code, deviceId })`) and already logs
  `school.selfservice.code.rejected` at **three** separate exit points —
  `used_up` (~line 293), and a combined `unscoped-record`/`no-live-record`
  branch (~line 300) that already runs its own existing burst throttle,
  `#strikeAttempt(deviceId)`. Call `kioskFrictionTracker.recordFriction`
  unconditionally at all three reject exits — not only when
  `#strikeAttempt` reports `overBudget`. That existing throttle is a
  narrower, code-specific mechanism; the friction tracker is a general,
  cross-signal one, and gating it behind the narrower throttle's own trip
  point would mean it only ever sees a rejection that had already tripped a
  different, unrelated threshold.
- Test: extend `ResolveAccessCode.mjs`'s existing test file — a small,
  additive side effect on an already-tested flow, not a new file.

**Interfaces:**
- Consumes: `KioskFrictionTracker.recordFriction` (Task 3).

- [ ] **Step 1: Write the failing tests**

Add three cases to the existing test file, one per reject exit (`used_up`,
`unscoped-record`, `no-live-record`): each calls
`kioskFrictionTracker.recordFriction` with `{ deviceId, kind: 'code-rejected' }`,
where `deviceId` is whatever the existing test fixtures already pass into
`resolve(...)`.

- [ ] **Step 2: Run the tests to verify they fail**

Expected: FAIL — no friction-tracking call happens on any reject path yet.

- [ ] **Step 3: Add the side effect**

Inject `kioskFrictionTracker` as an optional constructor dependency,
default `null` (matching this codebase's convention for a collaborator that
must degrade gracefully when absent — see `gradingHook = null` in
`SchoolPrintScanConsumer`'s constructor), and call it, fire-and-forget, at
all three reject sites:

```js
this.#kioskFrictionTracker?.recordFriction({ deviceId, kind: 'code-rejected' }).catch(() => {});
```

- [ ] **Step 4: Run the tests to verify they pass, then the full file's suite**

Expected: PASS, no regressions in the file's existing cases.

- [ ] **Step 5: Wire into composition and commit**

```bash
git add backend/src/3_applications/school/usecases/ResolveAccessCode.mjs backend/src/app.mjs
git commit -m "feat(school): record code-rejection friction on all three reject paths"
```

---

### Task 5: Frontend `useKioskAccess` hook

**Files:**
- Create: `frontend/src/hooks/devices/useKioskAccess.js`
- Test: `frontend/src/hooks/devices/useKioskAccess.test.jsx`

**Interfaces:**
- Produces: `export default function useKioskAccess(deviceId)` →
  `{ granted: boolean, degraded: boolean }`.

- [ ] **Step 1: Read `useSchoolGameAccess.js` and its test file in full**

Copy the polling interval, WS-refresh pattern, and test harness shape
faithfully.

- [ ] **Step 2: Write the failing tests**

Mirror `useSchoolGameAccess.test.jsx`'s structure for `kiosk.access`,
filtering `subject.kind === 'device' && subject.id === deviceId` and
`period.id` on the `^kiosk-day:` pattern Task 3 produces (not
`^school-day:`), including a time-containment check against
`period.startsAt`/`period.endsAt` the same way the piano hook does:
- entitlement item present, `decision: 'granted'` → `{ granted: true, degraded: false }`.
- `decision: 'denied'` → `{ granted: false, degraded: false }`.
- **no entitlement item for this device at all** → `{ granted: true, degraded: false }` — the fail-open case, the single most important test here.
- a failed API read → `{ granted: true, degraded: true }`.
- a State Gates WS event for this device triggers a refetch.

- [ ] **Step 3: Run the tests to verify they fail**

Expected: FAIL — module does not exist.

- [ ] **Step 4: Write the implementation**

Copy `useSchoolGameAccess.js`'s structure, replacing the capability filter
(`piano.games` → `kiosk.access`), the subject filter (`learner` → `device`,
matching `deviceId`), the period-id pattern, and — the one line that must
NOT be a literal copy — the closed/open direction: where
`useSchoolGameAccess` treats "no decision" and "a failed read" as closed,
this hook treats both as `granted: true`. Write this as an explicit,
commented branch, not an inverted boolean in a ternary.

- [ ] **Step 5: Run the tests to verify they pass**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/devices/useKioskAccess.js frontend/src/hooks/devices/useKioskAccess.test.jsx
git commit -m "feat(devices): add useKioskAccess hook (fail-open kiosk.access entitlement)"
```

---

### Task 6: Soft-lock — cover UI AND disabling the real input paths

**Files:**
- Create: `frontend/src/modules/Devices/KioskSoftLockCover.jsx` (visible
  explanation only — see below, this does NOT itself block input)
- Test: `frontend/src/modules/Devices/KioskSoftLockCover.test.jsx`
- Modify: `frontend/src/modules/School/SchoolApp.jsx` — mount
  `useKioskAccess`, skipping it when this surface has no panel device id
  (`deviceIdFor(screenId)` — confirmed during planning to return `null` for
  non-panel surfaces; do not hardcode the literal `'portal'`).
- Modify: `frontend/src/modules/School/selfService/Keypad.jsx` — gate its
  key-handling on `granted` (the code pad and the ISBN pad's input
  acceptance both live downstream of this component's input path per
  earlier session investigation — confirm the exact prop/hook boundary
  before wiring, since this plan's earlier drafts have already been wrong
  about assumed component shapes twice).
- Modify: Piano's kiosk chrome — same pattern, `yellow-room-tablet` via
  `kioskDeviceIdentity.js`'s `KIOSK_DEVICE_ID` (confirmed present, used by
  `PianoApp.jsx:23`).

**Interfaces:**
- Consumes: `useKioskAccess` (Task 5).
- Produces: `<KioskSoftLockCover />` — a visible, full-cover explanation
  component. **Its own `stopPropagation` handlers are not the enforcement
  mechanism** — a plain `<div>` cannot block a sibling's global
  `keydown`/pointer listeners (`useHardwareKeyboard` and similar). The real
  enforcement is `granted` gating the input-accepting hooks/handlers
  directly, wherever they live, in the same places Task 7 adds friction
  pings.

- [ ] **Step 1: Write the failing component test**

```jsx
// frontend/src/modules/Devices/KioskSoftLockCover.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KioskSoftLockCover from './KioskSoftLockCover.jsx';

describe('KioskSoftLockCover', () => {
  it('renders a full-cover message', () => {
    render(<KioskSoftLockCover />);
    expect(screen.getByText(/taking a short break/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails, then write the component**

```jsx
// frontend/src/modules/Devices/KioskSoftLockCover.jsx
import './KioskSoftLockCover.scss';

/**
 * The VISIBLE explanation for a denied `kiosk.access` entitlement. This
 * component does not itself enforce anything — it cannot block input a
 * sibling's own global key/pointer listeners already own. Real enforcement
 * is `granted` gating those listeners directly (Keypad.jsx, BookShelf's add
 * flow, Piano's video controls — wherever Task 7 also adds friction pings).
 * Self-clears the moment the caller stops rendering it.
 */
export default function KioskSoftLockCover() {
  return (
    <div className="kiosk-soft-lock-cover" role="alert" aria-live="polite">
      <p>Taking a short break. Back in a minute.</p>
    </div>
  );
}
```

Match `docs/reference/frontend/design-system.md`'s token conventions for the
stylesheet rather than raw colors.

Run: `npx vitest run frontend/src/modules/Devices/KioskSoftLockCover.test.jsx`
Expected: PASS.

- [ ] **Step 3: Read `Keypad.jsx` and `SchoolApp.jsx` in full to find the real input-gating point**

Identify exactly which handler(s) accept a keystroke/tap today (the same
`fkb.keyCapture`/keypad digit path this session's log investigation already
found), and wrap that acceptance in a `granted` check — return early (no
digit recorded, no lookup fired) when `!granted`, rather than only hiding
UI. Write a test asserting a keystroke is ignored when `useKioskAccess`
(mocked) returns `granted: false`.

- [ ] **Step 4: Mount `useKioskAccess` + `KioskSoftLockCover` in `SchoolApp.jsx`**

```jsx
const deviceId = deviceIdFor(screenId); // existing resolution — do not hardcode
const { granted } = deviceId ? useKioskAccess(deviceId) : { granted: true };
// ... near the top of the render tree:
{!granted && <KioskSoftLockCover />}
```

Add a test confirming the cover renders when `useKioskAccess` (mocked)
returns `{ granted: false }`, following whichever `vi.mock` pattern
`SchoolApp.test.jsx` already uses for a sibling hook.

- [ ] **Step 5: Repeat Steps 3-4 for Piano's kiosk chrome and its own input path**

Find Piano's actual note-input/video-control acceptance point (via
`kioskDeviceIdentity.js`'s consumers) and gate it the same way, with an
equivalent test.

- [ ] **Step 6: Run the full touched-module test suites**

Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Devices/ frontend/src/modules/School/SchoolApp.jsx frontend/src/modules/School/selfService/Keypad.jsx
git add -A  # plus the Piano kiosk chrome file(s) touched in Step 5, and any updated tests
git commit -m "feat(devices): gate kiosk input on kiosk.access, mount soft-lock cover on Portal and Piano"
```

---

### Task 7: Wire the five v1 frontend signals

**Files:**
- Modify the REAL call sites (confirmed during planning — do not re-grep
  for names that don't exist, e.g. there is no literal
  `school.ime.mode.toggled` string anywhere; the IME log is built as
  `school.ime.${category}.${detail}` inside `imeLog.mode(...)`):
  - `frontend/src/modules/School/selfService/Keypad.jsx:302,332` (stray-press)
  - `frontend/src/modules/School/books/useBookShelf.js:455,467` (filter to
    the call where `reason === 'not-a-book-prefix'`)
  - `frontend/src/modules/School/ime/HangulTypingProvider.jsx:122`
    (`imeLog.mode('toggled', ...)` — this provider is mounted from
    `SchoolApp.jsx:1348`)
  - Piano's video restart call site (`PianoVideoPlayer.jsx:265`)
- Create: `frontend/src/hooks/devices/useFrictionPing.js`
- Test: `frontend/src/hooks/devices/useFrictionPing.test.js`

**Interfaces:**
- Produces: `export default function useFrictionPing(deviceId)` → a function
  `report(kind)`, locally debouncing to "N occurrences of the same `kind`
  within a short local window" before firing the network call.

- [ ] **Step 1: Write the failing tests for the pre-filter**

```js
// frontend/src/hooks/devices/useFrictionPing.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useFrictionPing from './useFrictionPing.js';

describe('useFrictionPing', () => {
  it('does not ping the backend on the first one or two occurrences of a kind', () => {
    const post = vi.fn();
    const { result } = renderHook(() => useFrictionPing('portal', { post, burstThreshold: 3, burstWindowMs: 10000 }));
    act(() => { result.current('stray-press'); });
    act(() => { result.current('stray-press'); });
    expect(post).not.toHaveBeenCalled();
  });

  it('pings once the burst threshold is reached within the local window', () => {
    const post = vi.fn();
    const { result } = renderHook(() => useFrictionPing('portal', { post, burstThreshold: 3, burstWindowMs: 10000 }));
    act(() => { result.current('stray-press'); });
    act(() => { result.current('stray-press'); });
    act(() => { result.current('stray-press'); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('portal', 'stray-press');
  });

  it('tracks each kind independently', () => {
    const post = vi.fn();
    const { result } = renderHook(() => useFrictionPing('portal', { post, burstThreshold: 2, burstWindowMs: 10000 }));
    act(() => { result.current('stray-press'); });
    act(() => { result.current('video-restart'); });
    expect(post).not.toHaveBeenCalled();
  });

  it('swallows a failed post rather than throwing back to the caller', async () => {
    const post = vi.fn(() => Promise.reject(new Error('network down')));
    const { result } = renderHook(() => useFrictionPing('portal', { post, burstThreshold: 1, burstWindowMs: 10000 }));
    expect(() => act(() => { result.current('stray-press'); })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/hooks/devices/useFrictionPing.js
import { useCallback, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';

const DEFAULT_BURST_THRESHOLD = 3;
const DEFAULT_BURST_WINDOW_MS = 10000;

function defaultPost(deviceId, kind) {
  // DaylightAPI(path, data, method) — data is the request body, third arg
  // is the HTTP method. NOT an options object.
  return DaylightAPI(`api/v1/device/${encodeURIComponent(deviceId)}/friction-ping`, { kind }, 'POST');
}

/**
 * Local burst pre-filter before a friction signal ever reaches the network —
 * a single stray key never fires a ping. Fire-and-forget: a failed post is
 * swallowed here, never thrown back to the caller mid-handling a real UI
 * event.
 */
export default function useFrictionPing(deviceId, {
  post = defaultPost, burstThreshold = DEFAULT_BURST_THRESHOLD, burstWindowMs = DEFAULT_BURST_WINDOW_MS,
} = {}) {
  const timestampsByKind = useRef(new Map());
  return useCallback((kind) => {
    const now = Date.now();
    const existing = timestampsByKind.current.get(kind) ?? [];
    const recent = existing.filter((at) => now - at <= burstWindowMs);
    recent.push(now);
    if (recent.length >= burstThreshold) {
      timestampsByKind.current.set(kind, []);
      Promise.resolve(post(deviceId, kind)).catch(() => {});
    } else {
      timestampsByKind.current.set(kind, recent);
    }
  }, [deviceId, post, burstThreshold, burstWindowMs]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Wire the hook into the four real call sites**

Instantiate `useFrictionPing(deviceId)` **once**, at the component that
already owns the device id for each kiosk (the same component Task 6 wired
`useKioskAccess` into), and pass the resulting `report` function down to
`Keypad.jsx`, `useBookShelf.js`, and `HangulTypingProvider.jsx` (all three
live under `SchoolApp.jsx` on the School side) via props/context — or, if
these three remount independently often enough that prop/context threading
is awkward, use a **module-level** timestamp map (not a `useRef`) inside
`useFrictionPing.js` itself, keyed by `(deviceId, kind)`, so burst state
survives a remount of any one call site. Decide which approach before
writing code; do not leave both as options in the committed implementation.

Add one assertion per call site to its existing test file: triggering the
underlying event `burstThreshold` times results in one `friction-ping`
network call with the right `kind`.

- [ ] **Step 6: Run the full touched-module test suites**

Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/devices/useFrictionPing.js frontend/src/hooks/devices/useFrictionPing.test.js
git add -A  # the four wired call sites and their updated tests
git commit -m "feat(devices): wire the five v1 friction signals through useFrictionPing"
```

---

## Out of scope for this plan

- Rapid profile-hopping and gamepad-reseed detection (deferred to v1.1).
- Retuning the 5-minute window / threshold-5 policy values against real
  data, and the spec's dry-run-mode question (§10 Q1) — both unresolved,
  not guessed here.
- Device actuation reliability (the FKB bridge, the Portal Keys APK
  rebuild) — a separate, smaller spec.
- ISBN pattern blocklist and cleanup of the one already-fabricated record —
  a separate, unrelated, bounded task.
- Whether the soft-lock cover should explain itself in specific language —
  shipped generic per spec §10 open question 3.
