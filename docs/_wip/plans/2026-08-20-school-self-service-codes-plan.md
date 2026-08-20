# School Self-Service Access Codes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a child start their own school work by typing a 6-digit code, printed on their agenda, into a locked School panel — without a parent and without a QR scanner.

**Architecture:** The code is a human-typable alias for a `subject_next` token that `BuildAgenda` already mints. It resolves through the same use cases a scan resolves through (`IssueDocument`, `DispatchMedia`, `DoNowService`), but presents a screen-shaped **launch card** instead of thermal slips. `ResolveScanAction` is not modified. Two independent config switches (mint / lock) mean "both off" is exactly today's behaviour.

**Design doc:** `docs/_wip/plans/2026-08-20-school-self-service-codes-design.md` (commit `e0d771724`). Read it first — it records why three obvious approaches are wrong.

**Tech Stack:** Node ESM (`.mjs`), Vitest, React (`.jsx`), js-yaml. DDD layering enforced by `npm run audit:layers`.

---

## ⚠️ Preflight — how to actually run these tests

**Do not use `npm run test:isolated --only=domain`.** It routes `tests/isolated/domain/` to **Jest**
(`isolated.harness.mjs`, `JEST_TARGETS`), but every file there imports from `'vitest'`. Measured
2026-08-20 on a clean tree: **159 of 179 suites fail to load** with
`TypeError: Cannot redefine property: Symbol($$jest-matchers-object)`. This is pre-existing rot,
not something you caused, and it hides your real result.

**Run domain tests directly under vitest:**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path/to/file.test.mjs>
```

Verified working: `agenda.test.mjs` + `sessions/tokens.test.mjs` → 52 passed, 552ms.

**If you add a NEW directory under `tests/isolated/`,** register it in `isolated.harness.mjs`
in the same commit, in the list matching its imports. A directory in neither list is silently
never run — `tests/isolated/cli/` and `tests/isolated/feedback/` are in that state today.

**Layer discipline:** run `npm run audit:layers` before each commit. Domain (`2_domains/`) may not
import from applications or adapters.

---

## Task 1: The access code primitive

**Files:**
- Create: `backend/src/2_domains/school/sessions/accessCode.mjs`
- Test: `tests/isolated/domain/school/sessions/accessCode.test.mjs`

Pure domain. No clock, no I/O, no `Math.random` — randomness is injected exactly the way
`mintToken({ rng })` already does it (`tokens.mjs`).

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  SCHOOL_ACCESS_CODE_DIGITS, mintAccessCode, normalizeAccessCode,
} from '#domains/school/sessions/accessCode.mjs';

const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

describe('normalizeAccessCode', () => {
  it('accepts exactly six digits, zero-padded included', () => {
    expect(normalizeAccessCode('000042')).toBe('000042');
  });
  it('rejects anything else', () => {
    ['12345', '1234567', 'abc123', '', null, 123456].forEach((bad) => {
      expect(thrownBy(() => normalizeAccessCode(bad)).code).toBe('INVALID_SCHOOL_ACCESS_CODE');
    });
  });
});

describe('mintAccessCode', () => {
  it('is six digits wide', () => {
    const code = mintAccessCode({ random: () => 0.5 });
    expect(code).toHaveLength(SCHOOL_ACCESS_CODE_DIGITS);
    expect(code).toMatch(/^\d{6}$/);
  });
  it('zero-pads a small draw rather than emitting a short code', () => {
    expect(mintAccessCode({ random: () => 0 })).toBe('000000');
  });
  it('clamps a misbehaving rng instead of overflowing', () => {
    expect(mintAccessCode({ random: () => 1 })).toMatch(/^\d{6}$/);
  });
  it('retries until it draws a code that is not taken', () => {
    const code = mintAccessCode({ random: seq(0.111111, 0.222222), taken: (c) => c === '111111' });
    expect(code).toBe('222222');
  });
  it('gives up rather than looping forever when the space is exhausted', () => {
    expect(() => mintAccessCode({ random: () => 0.5, taken: () => true }))
      .toThrow(/could not mint/);
  });
  it('requires an injected random function', () => {
    expect(() => mintAccessCode({})).toThrow(/random function is required/);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/school/sessions/accessCode.test.mjs
```
Expected: FAIL — `Failed to resolve import "#domains/school/sessions/accessCode.mjs"`.

**Step 3 — DELIVERED. Do not re-implement from this plan.**

Task 1 shipped in `72ba1d8d7` + `9d7a3aae8`. **Read the module, not this document.** Nine
code-review items amended the original spec; the source block that used to sit here is stale, and
re-implementing from it would undo the review. The delivered contract:

```js
// backend/src/2_domains/school/sessions/accessCode.mjs
SCHOOL_ACCESS_CODE_DIGITS = 6
SCHOOL_ACCESS_CODE_SPACE  = 10 ** SCHOOL_ACCESS_CODE_DIGITS   // derived, not restated

normalizeAccessCode(value)      // -> value, or throws
mintAccessCode({ rng, taken })  // BOTH REQUIRED — no defaults
```

Errors are TYPED (`#domains/core/errors/index.mjs`), never bare `Error`:

| Failure | Error | `code` |
|---|---|---|
| malformed code | `ValidationError` | `INVALID_SCHOOL_ACCESS_CODE` |
| missing `rng` or `taken` | `ValidationError` | `INVALID_SCHOOL_ACCESS_CODE_MINT` (`details.missing`) |
| non-numeric / non-finite draw | `DomainInvariantError` | `SCHOOL_ACCESS_CODE_RNG_INVALID` |
| space exhausted | `DomainInvariantError` | `SCHOOL_ACCESS_CODE_SPACE_EXHAUSTED` |

**Assert `.code`, never a message regex.** That string-matching is exactly what review item 1
removed — and `continuationCode.mjs:41` carries the phrase "access code" inside a bare-`Error`
message, so the obvious regex matches across both modules, one typed and one not.

**`taken` has no default.** Every caller passes a collision predicate. Task 4 must wire it to
Task 3's `getByAccessCode`, not only to a within-agenda `Set` — a forgotten predicate is now a
thrown error rather than duplicate codes on paper.

**The draw guard must stay ahead of coercion.** `Number(null)` is `0` and would mint `000000` on
every agenda for every child. `Number.isFinite` does not coerce, so it takes the raw value
directly.

**Step 4: Run it and watch it pass**

Same command. Expected: PASS, 8 tests.

**Step 5: Commit**

```bash
npm run audit:layers
git add backend/src/2_domains/school/sessions/accessCode.mjs \
        tests/isolated/domain/school/sessions/accessCode.test.mjs
git commit -m "feat(school): mint six-digit panel access codes"
```

---

## Task 2: The token record carries the code, on its own clock

**Files:**
- Modify: `backend/src/2_domains/school/sessions/tokens.mjs` (`createTokenRecord`, `resolveTokenState`)
- Test: `tests/isolated/domain/school/sessions/tokens.test.mjs` (append)

**Why this is not free.** `subject_next` tokens are minted with a deliberate **7-day** TTL
(`BuildAgenda.mjs:40`, `DEFAULT_SUBJECT_TOKEN_TTL_HOURS = 168`) so the printed QR outlives the day.
A code riding `expiresAt` would therefore be valid for a week, and yesterday's printed code would
resolve to a different lesson today. The record needs a **second, shorter clock**.

**Step 1: Write the failing test** (append to the existing suite)

```js
describe('access code on a token record', () => {
  const base = {
    tokenClass: 'subject_next',
    subject: { learnerId: 'test-user', subject: 'mathematics' },
    at: '2026-08-20T16:00:00Z',
    expiresAt: '2026-08-27T16:00:00Z',   // the QR's week
  };

  it('carries an accessCode and its own earlier expiry', () => {
    const record = createTokenRecord({
      ...base, token: 'sch:ABCDEFGHJKLMNPQR',
      accessCode: '481920', accessCodeExpiresAt: '2026-08-21T11:00:00Z',
    });
    expect(record.accessCode).toBe('481920');
    expect(record.accessCodeExpiresAt).toBe('2026-08-21T11:00:00Z');
  });

  it('rejects a malformed code', () => {
    expect(() => createTokenRecord({
      ...base, token: 'sch:ABCDEFGHJKLMNPQR', accessCode: '48192',
      accessCodeExpiresAt: '2026-08-21T11:00:00Z',
    })).toThrow(expect.objectContaining({ code: 'INVALID_SCHOOL_ACCESS_CODE' }));
  });

  it('refuses a code with no expiry of its own', () => {
    expect(() => createTokenRecord({
      ...base, token: 'sch:ABCDEFGHJKLMNPQR', accessCode: '481920',
    })).toThrow(/accessCodeExpiresAt/);
  });

  it('expires the code while the token itself still resolves', () => {
    const record = createTokenRecord({
      ...base, token: 'sch:ABCDEFGHJKLMNPQR',
      accessCode: '481920', accessCodeExpiresAt: '2026-08-21T11:00:00Z',
    });
    const now = '2026-08-22T09:00:00Z';        // past the code, inside the week
    expect(isAccessCodeLive(record, now)).toBe(false);
    expect(resolveTokenState({ record, now, sessionState: { state: 'created' } }).status)
      .not.toBe('expired');
  });
});
```

**Step 2: Run and confirm it fails** — `isAccessCodeLive` is not exported yet.

**Step 3: Implement.** In `tokens.mjs`:

- import `normalizeAccessCode` from `./accessCode.mjs`;
- in `createTokenRecord`, after the existing per-class validation: if `accessCode` is present,
  `normalizeAccessCode(it)` and require `isIsoTimestamp(accessCodeExpiresAt)` — throw
  `` `${caller}: accessCode requires accessCodeExpiresAt` `` otherwise. Carry both onto the record;
- add and export:

```js
/**
 * A code dies at the study-day rollover; its token lives a week (see
 * BuildAgenda's TTL). Two clocks on one record, deliberately.
 */
export function isAccessCodeLive(record, now) {
  if (!record?.accessCode || !record.accessCodeExpiresAt) return false;
  if (record.revokedAt) return false;
  const ms = Date.parse(record.accessCodeExpiresAt);
  return Number.isFinite(ms) && Date.parse(now) < ms;
}
```

- thread `accessCode` / `accessCodeExpiresAt` through `mintToken`'s call to `createTokenRecord`.
- Leave `resolveTokenState` alone: it reads `expiresAt` and must keep doing so, or the printed QR
  would die with the code.

**Step 4: Run and confirm PASS** (existing 40 tests must still pass — this is additive).

**Step 5: Commit** — `feat(school): give an access code its own study-day clock`

---

## Task 3: Look a code up

**Files:**
- Modify: `backend/src/3_applications/school/ports/ITokenRegistry.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlTokenRegistry.mjs`
- Test: `tests/isolated/adapter/school/tokenRegistry.test.mjs` — APPEND to the existing file.
  (`adapter` is a JEST target whose files import vitest — run directly per Preflight.)

Records are keyed by token body on disk (`<dataDir>/household/school/tokens/{body}.yml`), so a code
lookup needs an index. Keep it simple: an in-memory `Map<code, body>` built on the same boot sweep
that already prunes expired files, updated on every `put`, and rebuilt from disk on a miss.

**Step 1: Failing test** — cover: `put` then `getByAccessCode` returns the record; an unknown code
returns `null`; a code whose `accessCodeExpiresAt` has passed returns `null`; a revoked token's
code returns `null`; two records with different codes do not collide.

**Step 2: Run, confirm fail.**

**Step 3: Implement** — add to `ITokenRegistry`:

```js
  /**
   * Look up a token by its printed 6-digit panel code.
   * @returns {Promise<object|null>} null when unknown, expired, or revoked —
   *   the caller says "Try again"; a keypad never dead-ends.
   */
  async getByAccessCode(code) {
    throw new Error('ITokenRegistry.getByAccessCode must be implemented');
  }
```

Implement in `YamlTokenRegistry` using `isAccessCodeLive(record, { now })` so expiry policy stays in
the domain. The class already carries an injected `#now` ms clock — use it; do not add a second
clock dep.

**Step 4: Run, confirm PASS. Step 5: Commit** — `feat(school): resolve a token by its panel code`

---

## Task 4: Mint at agenda build, print on the receipt

**Files:**
- Modify: `backend/src/3_applications/school/usecases/BuildAgenda.mjs:218-236`
- Modify: `backend/src/2_domains/school/documents/receipts.mjs` (`agendaDocument`, `lessonAction`)
- Test: `tests/isolated/domain/school/documents/receipts.test.mjs` (append)
- Test: existing BuildAgenda suite

**Step 1: Failing tests.**

Receipts: given `accessCodesBySubject: { mathematics: '481920' }`, the mathematics lesson block
carries the code, rendered with an unmistakable label. **It must not be confusable with the
SchoolCalc study code already printed on the same page** (`BuildAgenda.mjs:203-209`,
"Enter on calculator."). Assert the literal strings differ:

```js
it('labels a panel code so it cannot be read as a calculator code', () => {
  const doc = agendaDocument({ ...args, accessCodesBySubject: { mathematics: '481920' } });
  const flat = JSON.stringify(doc.blocks);
  expect(flat).toContain('PANEL CODE 481920');
  expect(flat).not.toContain('Enter on calculator');
});
```

BuildAgenda: with `selfService.enabled !== true`, no minted record carries an `accessCode` and the
document is unchanged (a characterisation test — this is the "both off is today, exactly" guarantee).
With it true, each `subject_next` record carries a code and an `accessCodeExpiresAt` equal to the
next study-day boundary.

**Step 2: Run, confirm fail. Step 3: Implement.**

**Two rules Task 2 added that the mint MUST respect, or `createTokenRecord` throws:**

1. **A code is legal only on a `subject_next` token** (`SCHOOL_ACCESS_CODE_WRONG_CLASS`). That is
   already the only place Task 4 mints, so this costs nothing — but a test constructing a record of
   any other class will throw, which is a real trip when writing fixtures.
2. **`accessCodeExpiresAt` may not be LATER than `expiresAt`** (`SCHOOL_ACCESS_CODE_OUTLIVES_TOKEN`;
   equal is allowed). The token TTL defaults to 7 days and the code expires at the next 4am
   rollover, so the normal case is fine — but a household configuring `subjectTokenTtlHours` below
   ~24 would cross the rollover and start throwing. Clamp the code's expiry to the token's, or fail
   loudly with a message naming the config key.

**`taken` must consult the registry, not just a local Set** — `getByAccessCode` is what prevents a
code minted on a previous day from being reissued while the older record is still live. Task 3 notes
that if two live records ever carry the same code, the index's last writer wins and the earlier
record's code becomes unreachable; this predicate is what stops that happening.

At `BuildAgenda.mjs:218`, extend the existing `mintToken` call:

```js
const accessCode = this.#selfService?.enabled
  ? mintAccessCode({ random: this.#rng, taken: (c) => mintedCodes.has(c) })
  : null;
if (accessCode) mintedCodes.add(accessCode);

const record = mintToken({
  tokenClass: 'subject_next',
  subject: { learnerId, subject: section.subject },
  at: nowIso,
  rng: this.#rng,
  expiresAt: new Date(Date.parse(nowIso) + this.#ttlMs).toISOString(),
  ...(accessCode ? {
    accessCode,
    // The code dies at the rollover; the token above keeps its week.
    accessCodeExpiresAt: new Date(studyDayWindow(Date.parse(nowIso), {
      timezone: this.#timezone, boundaryHour: this.#boundaryHour,
    }).endAtMs).toISOString(),
  } : {}),
});
```

`mintedCodes` is a `Set` local to the build, guarding within-agenda collisions; `getByAccessCode`
guards across days. Do NOT add a `nextStudyDayBoundary` helper. `studyDayWindow(nowMs, { timezone, boundaryHour })`
in `studyDay.mjs` already returns `{ startAtMs, endAtMs }`, and `endAtMs` IS the next 4am
boundary. That file keeps one copy of this math on purpose, so `GetTeacherToday` and the
lifecycle window filter cannot disagree about what "today" means.

**Note the exclusion:** a schoolcalc entry returns early at `BuildAgenda.mjs:210-215` with
`token: null`, so it never reaches this code and is not keypad-reachable. That is intended
(design §1). Do not "fix" it here.

**Step 4: PASS. Step 5: Commit** — `feat(school): print a panel code beside each lesson`

*Stop here and look at real paper before continuing.* Set `selfService.enabled: true`, build an
agenda, confirm the codes print and read clearly beside the calculator codes. Tasks 1-4 ship
safely on their own: nothing resolves a code yet.

---

## Task 5: What the card offers

**Files:**
- Create: `backend/src/2_domains/school/selfService/offeredActions.mjs`
- Test: `tests/isolated/domain/school/selfService/offeredActions.test.mjs`

Pure. Consumes a `ResolveSubjectNext` resolution so it never re-derives state.

**Step 1: Failing test.** Table-drive it:

| Input | Expect |
|---|---|
| `{kind:'served'}` | `[]` + sentence "You already did this today" |
| `{kind:'locked', remedy:'Ask a grown-up'}` | `[]` + that remedy verbatim |
| `{kind:'empty'}` / `{kind:'unavailable'}` | `[]` + "Tell a grown-up" |
| `move.kind:'play'` | one `play` action targeting `mediaSurface` |
| `move.kind:'print'` | one `print` action |
| `move.kind:'screen'`, `bankPrintable:true` | one `print` action |
| `move.kind:'screen'`, `bankPrintable:false` | one `screen` action |
| `move.kind:'launch'` | one `launch` action on `unit.launch.surface` |
| `{kind:'program'}` | one `program` action, no surface |

Plus two guard tests that encode design decisions:

```js
it('never offers print and play together — the session schema forbids it', () => {
  const actions = offeredActions(
    { kind: 'move', move: { kind: 'play' }, unit: { media: {}, document: {} } },
    { mediaSurface: 'livingroom-tv' },
  );
  expect(actions).toHaveLength(1);
  expect(actions[0].kind).toBe('play');
});

it('does not decide bank printability itself', () => {
  const civ = { kind: 'move', move: { kind: 'screen' }, unit: { bank: {}, subject: 'civilization' } };
  expect(offeredActions(civ, { bankPrintable: false })[0].kind).toBe('screen');
});
```

That second test is the point of `bankPrintable`. `offerSession.mjs:133-145` records deleting exactly
this `subject === 'civilization'` guess in favour of one authoritative `IssueDocument.canIssueBank`
call — which a pure module cannot make. The application layer calls it once and passes the boolean.

**Steps 2-4:** fail → implement → pass. Every result ends with an `exit` action.

**Step 5: Commit** — `feat(school): offer one action per launch card`

---

## Task 6: `/resolve`, which must not write

**Files:**
- Create: `backend/src/3_applications/school/usecases/ResolveAccessCode.mjs`
- Create: `backend/src/4_api/v1/routers/school.selfservice.mjs`
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (wire behind `lifecycle.enabled`)
- Test: `tests/isolated/application/school/ResolveAccessCode.test.mjs`

**The hazard.** `ResolveSubjectNext.execute` calls `ensureSession`, which **appends a `created`
event** when the plan entry has no session (`offerSession.mjs:34-42`). `BuildAgenda` pre-creates the
printed entry's session (`:385-389`), so the first resolve usually reuses — but once the day
advances, typing a code opens a session. A child typing a sibling's code would write into that
sibling's history.

**Step 1: Write the regression test FIRST — it is the reason this task exists**

```js
it('appends no events when the entry has no session yet', async () => {
  const appended = [];
  const sessions = { ...fakeSessions, appendEvent: async (...a) => { appended.push(a); } };
  const usecase = new ResolveAccessCode({ ...deps, sessions });

  const card = await usecase.execute({ code: '481920' });

  expect(card.actions).toHaveLength(1);
  expect(appended).toEqual([]);        // <- the whole point
});
```

Plus: an unknown code returns `{ ok: false, sentence: 'Try again' }` and never throws; an expired
code does the same; a valid code returns learner, subject, title, and the actions from Task 5.

**Step 2: Run, confirm fail. Step 3: Implement.**

`ResolveAccessCode` does NOT call `ResolveSubjectNext.execute`. It:
1. `tokens.getByAccessCode(code)` → null → the "Try again" shape;
2. plans the learner's work and sections (same planner + `planDailyAgenda` inputs);
3. for the entry, uses its existing session state when present, and otherwise computes
   `nextMove(unit, { state: 'created' })` against a **synthetic** created state — a `created` state
   needs no persisted session to predict the move;
4. calls `IssueDocument.canIssueBank(unit.bank)` once for `bankPrintable`;
5. returns `offeredActions(resolution, { mediaSurface, bankPrintable })`.

Router: `POST /resolve` → 200 with the card, or 200 with the "Try again" shape. Never 500 to a
keypad.

**Step 4: PASS. Step 5: Commit** — `feat(school): resolve a panel code without opening a session`

---

## Task 7: `/act`, which does the thing

**Files:**
- Create: `backend/src/3_applications/school/usecases/RunSelfServiceAction.mjs`
- Modify: `backend/src/4_api/v1/routers/school.selfservice.mjs`
- Test: `tests/isolated/application/school/RunSelfServiceAction.test.mjs`
- Test: `tests/isolated/application/school/selfServiceScanParity.test.mjs`

**Do NOT refactor `ResolveScanAction`** (design D7, reversed after review). Its helpers are
extractable, but every exit is paper-shaped — `#play` prints "When it finishes, scan your card for
the questions" — so byte-identical parity would have the keypad printing a thermal slip on every
tap. `RunSelfServiceAction` calls the same use cases directly. Extract only two judgements as
shared pure functions, if and only if a test needs them twice:
1. `#print`'s `canIssueBank` print-vs-screen fallback;
2. `#dispatchLaunch`'s DoNow call + `launch_dispatched` append + honour-close.

**Step 1: Failing tests.**

Parity — the test that matters:

```js
it('prints through the same use case a scan prints through, with the same arguments', async () => {
  const calls = [];
  const issue = { execute: async (args) => { calls.push(args); return { status: 'issued' }; },
                  canIssueBank: async () => true };
  await new RunSelfServiceAction({ ...deps, issueDocument: issue })
    .execute({ code: '481920', action: 'print' });
  expect(calls).toEqual([{ sessionId: 'sess-1' }]);
});
```

The debounce — the one the design's own happy path depends on:

```js
it('says something when the print is debounced', async () => {
  const issue = { execute: async () => ({ status: 'debounced', document: null, message: '' }),
                  canIssueBank: async () => true };
  const res = await new RunSelfServiceAction({ ...deps, issueDocument: issue })
    .execute({ code: '481920', action: 'print' });
  expect(res.sentence).toMatch(/already on its way/i);
});
```

`IssueDocument.mjs:253-283` returns `status:'debounced'` with an empty `message` inside
`printCooldownMinutes` (default 10). That silence was designed for thermal slips. On a screen it
means a child taps "Print it again", nothing happens, and nothing explains why.

Also: `/act` DOES call `ensureSession` (unlike `/resolve`); DoNow's four outcomes each surface their
sentence verbatim; an action not in the resolved card's action list is refused.

**Steps 2-4:** fail → implement → pass.

**Step 5: Commit** — `feat(school): run a launch-card action through the scan path's use cases`

---

## Task 8: The keypad and lock mode

**Files:**
- Create: `frontend/src/modules/School/selfService/Keypad.jsx`
- Create: `frontend/src/modules/School/selfService/LaunchCard.jsx`
- Create: `frontend/src/modules/School/selfService/useSelfService.js`
- Modify: `frontend/src/modules/School/SchoolApp.jsx`
- Modify: `frontend/src/modules/School/schoolApi.js`
- Test: `tests/isolated/modules/School/Keypad.test.jsx` (vitest target — correct list already)

**Lock mode is narrower than it sounds.** `portal.yml` mounts School as a widget with no `clear`
prop, so `SchoolApp` **already** omits its exit affordance — "there is nothing behind this screen to
exit to." Lock mode narrows a surface that is already terminal.

**Three behaviours that are not optional:**

1. **Accept `school.launch`.** `portal.yml` is the only screen in the house that mounts School, so
   `PortalSurface`'s broadcast has exactly one recipient — this panel. If lock mode ignores it,
   today's QR "answer on the screen" path breaks with no other screen to catch it. Keep the
   `SchoolApp.jsx:321-348` subscription live in lock mode.
2. **Register occupancy.** A keypad-mounted QuizRunner must open its sitting through the same
   `SchoolService` path the SPA's `start()` uses, or `PortalSurface.occupancy()` is blind to it and
   DoNow will interrupt a child mid-quiz.
3. **Do not swallow `actions.escape`.** `portal.yml` maps idle escape to `reload` — the kiosk's only
   refresh affordance, since FKB has no address bar.

**Degraded states** (a wall panel loses its backend; `schoolLifecycle.mjs:174` also leaves the whole
lifecycle inert unless `lifecycle.enabled === true`, and lock mode ships in *screen* config that
moves independently):

```
/resolve unreachable or 404 -> "The school computer isn't answering. Tell a grown-up."
                               + retry. Never a silently dead keypad.
```

**Logging** (`context.app: school`, per CLAUDE.md — new features ship with logging):
`code.rejected`, `code.resolved`, `action.run`, `print.confirmed`, `print.debounced`,
`print.retried`, `idle.timeout`.

**Steps:** test → fail → implement → pass → commit per component. Commit message:
`feat(school): keypad and launch card for the locked panel`

---

## Task 9: Turn it on

**Files:**
- Modify: `data/household/config/school.yml`
- Modify: `data/household/screens/portal.yml`
- Modify: `docs/reference/school/README.md` (CLAUDE.md: update docs when changing code)

```yaml
# school.yml
selfService:
  enabled: true
  mediaSurface: livingroom-tv     # per-unit `media.surface` overrides
  idleTimeoutSeconds: 120

# data/household/screens/portal.yml
  school: { mode: locked }
```

**Config is cached at startup** (CLAUDE.md): editing YAML needs a dev-server restart or a
`reloadHouseholdAppConfig` call.

**Rollout order — do not collapse it:**
1. `selfService.enabled: true` only. Codes print. Panel still browsable. Read the paper.
2. Confirm codes resolve — `/resolve` by hand, check the card matches the printed lesson.
3. `mode: locked` on the panel.

**Printer locality — a deployment precondition, not a knob.** Worksheets print through one household
laser injected at construction (`schoolLifecycle.mjs:307-323`, falling back to the `kitchen-printer`
device); `IssueDocument.execute({sessionId})` takes no location argument, and `donow.yml`'s
`thermalPrinterLocation` routes something else entirely. If the laser is not in the school room,
change the confirm copy to "Go and fetch it from the kitchen" rather than asking a question the
child cannot answer.

**Final verification**

```bash
npm run audit:layers
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/domain/school/ tests/isolated/application/school/
```

---

## Deferred, deliberately

- **One-tap print+play.** Blocked by the session schema in both directions (`sessionEvents.mjs:178-189`;
  `DISPATCHABLE = {created, media_stalled}`). Needs new transitions plus a replay migration — its own
  work item.
- **SchoolCalc subjects on the keypad.** They mint `token: null`, so there is nothing to alias.
- **Per-job printer routing** through `IssueDocument`.
- **The Jest/vitest harness misrouting** — `domain` sits in `JEST_TARGETS` while its files import
  vitest, so 159 of 179 suites never run through `npm run test:isolated`. Unrelated to this feature
  and worth its own fix; `tests/isolated/cli/` and `tests/isolated/feedback/` are in neither list.

## Open questions

- Does the keypad need an "I don't have a code" affordance, or is the exit enough?
- Should a `served` resolution let a child re-open finished work, or is the sentence terminal?
- Does the idle timeout also close a running quiz, or only the card?
