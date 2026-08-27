# Piano Game Budget & Performance Gate — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound piano-kiosk game time with a server-authoritative per-learner + per-device daily budget, and gate every match (including replays) behind a short graded performance attempt with a degradation ladder whose floor cannot fail.

**Architecture:** Backend follows the repo's DDD layers — a pure domain module (high-water settle math, study-day bucketing), a YAML day-file store under `household/history/piano-games/`, an application service, four routes on the existing piano router. Frontend adds a metering hook modeled on `coinMeteredGate.js` (with the two corrections the design mandates: seed-from-server and stale-session policy), a shared activity signal extracted from `useInactivityReturn`, a budget gate in `Games.jsx`, a pure ladder module, and a `GameGate` host that swaps in place of the game at match boundaries via a small context.

**Tech Stack:** React 18 (hooks, contexts), vitest (+ fake timers), Express 5 router, YAML persistence via `#system/utils/FileIO.mjs`, structured logging via `getLogger().child(...)`.

**Spec:** `docs/_wip/plans/2026-08-27-piano-game-budget-and-gate-design.md` (D1–D16). Phase 2 (OSMD ghost for score passages) is **out of scope**; the material seam (D10) still accepts both input kinds.

## Global Constraints

- **Every timing-sensitive test uses fake timers or an injected clock. Never wall-clock.** The vitest gate now runs 2605 files and wall-clock specs become roaming flakes (see `docs/_wip/bugs/2026-08-27-vitest-gate-nondeterministic-at-2605-files.md`). Backend: inject `clock`/`now`. Frontend: `vi.useFakeTimers()` + injected `api`.
- **Settle carries the cumulative total since open, never a delta** (design D4). Retries are idempotent; the server charges `max(0, cumulative − recorded)`.
- **`openSession` returns the server-held cumulative and the client seeds from it** (design "reload risk is UNDER-charging"). A client that restarts must not restart the meter at zero.
- **Budget resets on the household study day (4am boundary), not UTC** (D6): reuse `studyDate` from `backend/src/2_domains/school/timing.mjs:33`.
- **Budget gate fails OPEN on infrastructure failure; depletion fails CLOSED** (gate-stack table). **Performance gate fails OPEN when its material cannot be fetched** (`gate.unavailable`), and its floor verdict cannot fail via the **rubric** `{ criteria: { completeness: 1 } }` — `cleanliness` deliberately absent (D9).
- **The gate and ungraded practice are unmetered** (D13). Only time inside a match drains the budget.
- **Layer-2 balance writes are domain-service writes with real error handling, never a logging transport** (D16). A failed write surfaces as `budget.settle-failed`.
- **Mode vocabulary:** requirements name `mode: free | metronome | cued` only. `cursor`/`held`/`timed` are matchers, derived — a requirement naming `mode: cursor` throws at runtime (`assessmentAttempt.js:137`).
- **All thresholds come from config; nothing hardcoded.** Both features default `enabled: false`.
- **Logging framework only** (`getLogger().child({component})`), component names `piano-game-budget` / `piano-game-gate`; never raw `console.*`.
- **Config keys** (household piano app config; cached at boot — reloads require restart): exactly the `gameLimit:` / `gameGate:` blocks from the design's Config section.
- Run vitest files directly (`npx vitest run <path>`); never `npm run test:backend` or `--only=domain` (misroutes to jest).

## File Structure

| File | Responsibility |
|---|---|
| Create `backend/src/2_domains/piano/gameBudget.mjs` | Pure: day-record shape, open/settle/close/high-water math, balance, stale-session policy |
| Create `backend/src/2_domains/piano/gameBudget.test.mjs` | Domain tests (injected `at` everywhere) |
| Create `backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.mjs` | Load/save `household/history/piano-games/{studyDate}.yml`, atomic, real errors |
| Create `backend/src/3_applications/piano/PianoGameBudgetService.mjs` | open/settle/close/balance orchestration, config-per-call, events |
| Modify `backend/src/4_api/v1/routers/piano.mjs` (export at `:105`) | 4 budget routes |
| Modify `backend/src/app.mjs:2566` | Wire store + service into `createPianoRouter` |
| Create `frontend/src/modules/Piano/PianoKiosk/activitySignal.js` | Module-level activity store (bump/subscribe/lastActivityAt) |
| Modify `frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.js` | Bump the signal at its three existing bump sites; contract unchanged |
| Create `frontend/src/modules/Piano/PianoKiosk/useGameBudgetMeter.js` | Client meter: seed-from-server, idle pause/resume, hold-and-settle, fail-open |
| Modify `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx` | Gate 3 UI + meter mount in `GameHost` + match-boundary gate wiring |
| Create `frontend/src/modules/Piano/PianoKiosk/modes/Games/MatchGateContext.js` | `{ armed, requestRematch }` context games call instead of self-restarting |
| Create `frontend/src/modules/Piano/PianoKiosk/modes/Games/gameGateLadder.js` | Pure: rung model, degrade/climb, floor requirement |
| Create `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js` | D10 provider seam: `{kind:'exercise'}` fully; `{kind:'score'}` accepted, phase-2 rendering |
| Create `frontend/src/modules/Piano/PianoKiosk/modes/Games/GameGate.jsx` | Gate host: mounts ExerciseRun, Retry/Practice/Leave, fail-open, events |
| Modify `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx` (`:74`, `:86`) | Requirement-sourced policy; wrong-event keeps `{midi, eventId}`; material seam |
| Modify `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/assessment.js` | Thread `requirement.rubric` over the default rubric |
| Modify `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseNotation.jsx` | Expose container + anchor for the ghost |
| Modify `frontend/src/modules/Piano/game-platform/families/addressed-board/useAddressedBoardGame.js:139` | `restart()` routes through MatchGateContext when armed |
| Modify `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` | Its rematch action routes through MatchGateContext when armed |
| Modify `docs/reference/piano/` (new `games-budget-gate.md`) + `docs/reference/school/README.md` link | Endstate reference |

Interface names used throughout (Tasks reference these exactly): domain `emptyDay`, `applyOpen`, `applySettle`, `applyClose`, `balanceFor`, `budgetStudyDate`; service methods `open`, `settle`, `close`, `balance`; HTTP `POST /api/v1/piano/users/:userId/game-budget/session`, `POST …/session/:sessionId/settle`, `POST …/session/:sessionId/close`, `GET …/game-budget`; hook `useGameBudgetMeter`; ladder `initialRung`, `degradeRung`, `climbRung`, `requirementForRung`, `isFloor`.

---

### Task 1: Pure budget domain — `gameBudget.mjs`

**Files:**
- Create: `backend/src/2_domains/piano/gameBudget.mjs`
- Test: `backend/src/2_domains/piano/gameBudget.test.mjs`

**Interfaces:**
- Consumes: `studyDate` from `#domains/school/timing.mjs` (pure; `boundaryHour = 4` default).
- Produces (exact, later tasks depend on these):
  - `budgetStudyDate(instant, timezone)` → `'YYYY-MM-DD'`
  - `emptyDay(studyDateStr)` → day record
  - `applyOpen(day, { sessionId, learnerId, deviceId, at, staleAfterSeconds })` → `{ day, sessionId, cumulativeSeconds, adopted }`
  - `applySettle(day, { sessionId, cumulativeSeconds, at })` → `{ day, chargedSeconds }` — throws `Error('unknown session')` / `Error('session closed')`
  - `applyClose(day, { sessionId, cumulativeSeconds, at })` → `{ day, chargedSeconds }`
  - `balanceFor(day, config, learnerId)` → `{ learnerSecondsLeft, deviceSecondsLeft, secondsLeft }`

Day record shape (this is the layer-2 file's content, so it is the design's D3 source of truth):

```js
{
  schema: 'piano.game-budget-day/v1',
  studyDate: '2026-08-27',
  device: { totalSeconds: 0 },
  learners: {},          // learnerId -> { totalSeconds }
  sessions: {},          // sessionId -> { learnerId, deviceId, openedAt, lastSettleAt, cumulativeSeconds, closed }
}
```

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/2_domains/piano/gameBudget.test.mjs
import { describe, it, expect } from 'vitest';
import {
  budgetStudyDate, emptyDay, applyOpen, applySettle, applyClose, balanceFor,
} from './gameBudget.mjs';

const AT = '2026-08-27T20:00:00.000Z';
const CFG = { dailyMinutes: 45, deviceDailyMinutes: 120, users: { kid_a: { dailyMinutes: 30 } } };

const open = (day, over = {}) => applyOpen(day, {
  sessionId: 'sess_1', learnerId: 'kid_a', deviceId: 'kiosk', at: AT, staleAfterSeconds: 900, ...over,
});

describe('budgetStudyDate', () => {
  it('rolls at the 4am study boundary, not midnight (D6)', () => {
    // 2026-08-28T09:59:00Z is 02:59 in America/Los_Angeles — still the 27th's study day.
    expect(budgetStudyDate('2026-08-28T09:59:00.000Z', 'America/Los_Angeles')).toBe('2026-08-27');
    expect(budgetStudyDate('2026-08-28T12:01:00.000Z', 'America/Los_Angeles')).toBe('2026-08-28');
  });
});

describe('applySettle — hold-and-settle high-water (D4)', () => {
  it('charges only the newly crossed seconds and is idempotent on retry', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 60, at: AT }));
    const again = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 60, at: AT });
    expect(again.chargedSeconds).toBe(0);                       // exact retry = no-op
    ({ day } = applySettle(again.day, { sessionId: 'sess_1', cumulativeSeconds: 90, at: AT }));
    expect(day.learners.kid_a.totalSeconds).toBe(90);
    expect(day.device.totalSeconds).toBe(90);                   // one transaction, never drift (design)
  });

  it('a cumulative BELOW the recorded high-water charges nothing (client restarted at zero)', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 300, at: AT }));
    const res = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 10, at: AT });
    expect(res.chargedSeconds).toBe(0);
    expect(res.day.sessions.sess_1.cumulativeSeconds).toBe(300); // high-water never regresses
  });
});

describe('applyOpen — one open session per learner, stale adoption (design metering §additions)', () => {
  it('re-opening a FRESH session adopts it and returns the server cumulative', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 120, at: AT }));
    const r = open(day, { sessionId: 'sess_2', at: '2026-08-27T20:03:00.000Z' }); // 180s later < 900
    expect(r.adopted).toBe(true);
    expect(r.sessionId).toBe('sess_1');            // same session — double-spend guard
    expect(r.cumulativeSeconds).toBe(120);         // client seeds from this, not zero
  });

  it('a STALE session is closed at its high-water and a fresh one opens at zero', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 120, at: AT }));
    const r = open(day, { sessionId: 'sess_2', at: '2026-08-27T21:00:00.000Z' }); // 3600s > 900
    expect(r.adopted).toBe(false);
    expect(r.sessionId).toBe('sess_2');
    expect(r.cumulativeSeconds).toBe(0);
    expect(r.day.sessions.sess_1.closed).toBe(true);
    expect(r.day.learners.kid_a.totalSeconds).toBe(120); // the tail was already charged, not lost
  });
});

describe('balanceFor', () => {
  it('per-learner override beats dailyMinutes, and device cap is checked in series (D1)', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 600, at: AT }));
    const b = balanceFor(day, CFG, 'kid_a');
    expect(b.learnerSecondsLeft).toBe(30 * 60 - 600);   // override 30, not 45
    expect(b.deviceSecondsLeft).toBe(120 * 60 - 600);
    expect(b.secondsLeft).toBe(Math.min(b.learnerSecondsLeft, b.deviceSecondsLeft));
  });

  it('an unknown learner has the full default allowance', () => {
    const b = balanceFor(emptyDay('2026-08-27'), CFG, 'kid_b');
    expect(b.learnerSecondsLeft).toBe(45 * 60);
  });
});

describe('applyClose', () => {
  it('settles the final cumulative then marks closed; further settles throw', () => {
    let { day } = open(emptyDay('2026-08-27'));
    ({ day } = applyClose(day, { sessionId: 'sess_1', cumulativeSeconds: 45, at: AT }));
    expect(day.sessions.sess_1.closed).toBe(true);
    expect(day.learners.kid_a.totalSeconds).toBe(45);
    expect(() => applySettle(day, { sessionId: 'sess_1', cumulativeSeconds: 60, at: AT }))
      .toThrow('session closed');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run backend/src/2_domains/piano/gameBudget.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// backend/src/2_domains/piano/gameBudget.mjs
/**
 * Pure math for the piano game-time budget (design 2026-08-27, D1/D4/D6).
 *
 * A day record is the LAYER-2 SOURCE OF TRUTH (D3/D15): per-learner seconds,
 * the device-wide total, and every metering session, bucketed on the household
 * STUDY day — the same 4am-boundary local day School uses, because a UTC reset
 * would hand back allowances mid-afternoon (D6).
 *
 * Settles are hold-and-settle with a cumulative high-water mark (D4): the
 * client always sends the running total since open, and the charge is the part
 * of that total not yet recorded. A retry re-sends a total the record already
 * holds and charges zero; a client that restarted at zero sends totals BELOW
 * the mark and charges zero until it climbs back past it — which is why open
 * hands the mark back to the client to seed from (the under-charging fix).
 *
 * Learner and device totals move in the same applySettle call on the same
 * record, so the two cannot drift (design: "one transaction").
 */
import { studyDate } from '#domains/school/timing.mjs';

export function budgetStudyDate(instant, timezone = null) {
  return studyDate(instant instanceof Date ? instant : new Date(instant), timezone);
}

export function emptyDay(studyDateStr) {
  return {
    schema: 'piano.game-budget-day/v1',
    studyDate: studyDateStr,
    device: { totalSeconds: 0 },
    learners: {},
    sessions: {},
  };
}

const clone = (day) => structuredClone(day);
const secondsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;

function openSessionFor(day, learnerId) {
  return Object.entries(day.sessions).find(
    ([, s]) => s.learnerId === learnerId && !s.closed,
  ) ?? null;
}

/**
 * One open session per learner (double-spend guard). A lingering session from
 * a kiosk crash is ADOPTED while fresh — the client resumes its cumulative —
 * and closed-then-replaced once stale, so play is never silently unmetered
 * (design metering §additions 1–2).
 */
export function applyOpen(day, { sessionId, learnerId, deviceId, at, staleAfterSeconds }) {
  const next = clone(day);
  const existing = openSessionFor(next, learnerId);
  if (existing) {
    const [existingId, s] = existing;
    const idleFor = secondsBetween(s.lastSettleAt ?? s.openedAt, at);
    if (idleFor < staleAfterSeconds) {
      return { day: next, sessionId: existingId, cumulativeSeconds: s.cumulativeSeconds, adopted: true };
    }
    // Stale: its high-water is already charged; just seal it.
    s.closed = true;
  }
  next.sessions[sessionId] = {
    learnerId, deviceId, openedAt: at, lastSettleAt: at, cumulativeSeconds: 0, closed: false,
  };
  if (!next.learners[learnerId]) next.learners[learnerId] = { totalSeconds: 0 };
  return { day: next, sessionId, cumulativeSeconds: 0, adopted: false };
}

export function applySettle(day, { sessionId, cumulativeSeconds, at }) {
  const next = clone(day);
  const s = next.sessions[sessionId];
  if (!s) throw new Error('unknown session');
  if (s.closed) throw new Error('session closed');
  const charged = Math.max(0, cumulativeSeconds - s.cumulativeSeconds);
  s.cumulativeSeconds = Math.max(s.cumulativeSeconds, cumulativeSeconds);
  s.lastSettleAt = at;
  if (charged > 0) {
    next.learners[s.learnerId] ??= { totalSeconds: 0 };
    next.learners[s.learnerId].totalSeconds += charged;
    next.device.totalSeconds += charged;
  }
  return { day: next, chargedSeconds: charged };
}

export function applyClose(day, { sessionId, cumulativeSeconds, at }) {
  const settled = applySettle(day, { sessionId, cumulativeSeconds, at });
  settled.day.sessions[sessionId].closed = true;
  return settled;
}

export function balanceFor(day, config, learnerId) {
  const learnerMinutes = config.users?.[learnerId]?.dailyMinutes ?? config.dailyMinutes;
  const learnerSecondsLeft = Math.max(0,
    learnerMinutes * 60 - (day.learners[learnerId]?.totalSeconds ?? 0));
  const deviceSecondsLeft = Math.max(0,
    config.deviceDailyMinutes * 60 - day.device.totalSeconds);
  return { learnerSecondsLeft, deviceSecondsLeft, secondsLeft: Math.min(learnerSecondsLeft, deviceSecondsLeft) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run backend/src/2_domains/piano/gameBudget.test.mjs`
Expected: PASS (10 tests). Confirm the domain-purity gate is clean: `node scripts/audit-layer-imports.mjs` (a cross-domain import of school timing is `2_domains → 2_domains`, which no rule forbids — but verify the tool agrees before committing).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/piano/gameBudget.mjs backend/src/2_domains/piano/gameBudget.test.mjs
git commit -m "feat(piano): pure game-budget math — high-water settles on the study day"
```

---

### Task 2: The day-file store — `YamlPianoGameBudgetStore`

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.test.mjs`

**Interfaces:**
- Consumes: `loadYamlSafe`, `saveYamlToPathAtomic`, `ensureDir` from `#system/utils/FileIO.mjs` (verified exports at `FileIO.mjs:83/418/248`); `emptyDay` from Task 1.
- Produces: `new YamlPianoGameBudgetStore({ historyRoot, logger })` with `loadDay(studyDateStr)` → day record (empty record when the file is absent; **throws on a corrupt file** — a balance store must not silently reset to zero, D16) and `saveDay(day)` → void (throws on failure).

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlPianoGameBudgetStore } from './YamlPianoGameBudgetStore.mjs';
import { emptyDay, applyOpen } from '#domains/piano/gameBudget.mjs';

let root; let store;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'piano-budget-'));
  store = new YamlPianoGameBudgetStore({ historyRoot: root, logger: { warn: () => {}, error: () => {} } });
});

describe('YamlPianoGameBudgetStore', () => {
  it('a missing day file loads as an empty day (a fresh day, not an error)', () => {
    const day = store.loadDay('2026-08-27');
    expect(day).toEqual(emptyDay('2026-08-27'));
  });

  it('round-trips a day record through save and load', () => {
    const { day } = applyOpen(emptyDay('2026-08-27'), {
      sessionId: 's1', learnerId: 'kid_a', deviceId: 'kiosk',
      at: '2026-08-27T20:00:00.000Z', staleAfterSeconds: 900,
    });
    store.saveDay(day);
    expect(store.loadDay('2026-08-27')).toEqual(day);
    // Written where the design says: household/history/piano-games/{date}.yml
    expect(readFileSync(path.join(root, '2026-08-27.yml'), 'utf8')).toContain('piano.game-budget-day/v1');
  });

  it('a CORRUPT day file throws rather than resetting balances to zero (D16)', () => {
    writeFileSync(path.join(root, '2026-08-27.yml'), '{{{ not yaml');
    expect(() => store.loadDay('2026-08-27')).toThrow(/corrupt/i);
  });

  it('a wrong-schema file throws for the same reason', () => {
    writeFileSync(path.join(root, '2026-08-27.yml'), 'schema: something-else/v9\n');
    expect(() => store.loadDay('2026-08-27')).toThrow(/schema/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement**

```js
// backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.mjs
/**
 * The game-budget day files: household/history/piano-games/{YYYY-MM-DD}.yml
 * (design layer 2 — durable, authoritative).
 *
 * THIS IS A BALANCE, NOT A LEDGER TAIL (D16). schoolLedger.mjs swallows write
 * failures by design; for a balance a swallowed write is a lost debit, and a
 * lost debit is free game time — the exact failure the feature exists to
 * prevent. So: writes are atomic and THROW on failure (the service surfaces
 * that as budget.settle-failed), and a corrupt or wrong-schema file on read
 * THROWS rather than quietly loading as a zero-balance fresh day.
 *
 * A genuinely absent file IS a fresh day — the store distinguishes "never
 * written" from "written and unreadable", the same posture the school attempt
 * shards take.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadYamlSafe, saveYamlToPathAtomic, ensureDir } from '#system/utils/FileIO.mjs';
import { emptyDay } from '#domains/piano/gameBudget.mjs';

const SCHEMA = 'piano.game-budget-day/v1';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class YamlPianoGameBudgetStore {
  #root; #logger;

  constructor({ historyRoot, logger = console } = {}) {
    if (!historyRoot) throw new Error('YamlPianoGameBudgetStore requires historyRoot');
    this.#root = historyRoot;
    this.#logger = logger;
  }

  #fileFor(studyDateStr) {
    if (!DAY.test(String(studyDateStr))) throw new Error(`invalid study date: ${studyDateStr}`);
    return path.join(this.#root, `${studyDateStr}.yml`);
  }

  loadDay(studyDateStr) {
    const file = this.#fileFor(studyDateStr);
    if (!existsSync(file)) return emptyDay(studyDateStr);
    const raw = loadYamlSafe(file.replace(/\.yml$/, ''));
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`corrupt game-budget day file: ${file}`);
    }
    if (raw.schema !== SCHEMA) {
      throw new Error(`unexpected schema in ${file}: ${raw.schema ?? '(none)'}`);
    }
    return raw;
  }

  saveDay(day) {
    ensureDir(this.#root);
    saveYamlToPathAtomic(this.#fileFor(day.studyDate), day);
  }
}

export default YamlPianoGameBudgetStore;
```

> **Verify against the real helpers before trusting this code.** `loadYamlSafe(basePath)` takes an extensionless base path in some call sites — read `FileIO.mjs:83` and mirror how `YamlVehicleHistoryDatastore` calls it; if it takes the full path, drop the `.replace`. This is exactly the kind of one-line drift the design's Verification section warns about.

- [ ] **Step 4: Run to verify pass** — same command, 4 tests PASS.
- [ ] **Step 5: Commit** — `git add backend/src/1_adapters/persistence/yaml/YamlPianoGameBudgetStore.*` ; `git commit -m "feat(piano): game-budget day store — a balance that refuses to lose a debit"`

---

### Task 3: The application service — `PianoGameBudgetService`

**Files:**
- Create: `backend/src/3_applications/piano/PianoGameBudgetService.mjs`
- Test: `backend/src/3_applications/piano/PianoGameBudgetService.test.mjs`

**Interfaces:**
- Consumes: Task 1 pure functions; Task 2 store shape (`loadDay`/`saveDay`); a `config` accessor function (read **per call**, never snapshotted — the GrownUpGate discipline); injected `clock` and `idFactory`.
- Produces (exact — Task 4's routes and Task 6's meter depend on the response shapes):

```js
new PianoGameBudgetService({ store, config, timezone = null, clock = () => new Date(), idFactory, logger })
  .open({ learnerId, deviceId })
    → { enabled, sessionId, cumulativeSeconds, secondsLeft, learnerSecondsLeft,
        deviceSecondsLeft, warnAtSeconds, settleIntervalSec: 60, idleAfterSeconds }
  .settle({ sessionId, learnerId, cumulativeSeconds })
    → { secondsLeft, depleted, deviceDepleted }
  .close({ sessionId, learnerId, cumulativeSeconds }) → { ok: true }
  .balance({ learnerId }) → { enabled, secondsLeft, learnerSecondsLeft, deviceSecondsLeft, warnAtSeconds }
```

`config` is `() => householdPianoConfig.gameLimit ?? {}`. When `enabled !== true`, `open`/`balance` return `{ enabled: false }` and nothing is written. `staleAfterSeconds` fixed at `900` (15 min — bounded idle age per the design; a constant with a comment, not config, YAGNI until someone needs it).

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/3_applications/piano/PianoGameBudgetService.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PianoGameBudgetService } from './PianoGameBudgetService.mjs';
import { emptyDay } from '#domains/piano/gameBudget.mjs';

function makeStore() {
  const days = new Map();
  return {
    loadDay: vi.fn((d) => structuredClone(days.get(d)) ?? emptyDay(d)),
    saveDay: vi.fn((day) => { days.set(day.studyDate, structuredClone(day)); }),
    _days: days,
  };
}

const CFG = { enabled: true, dailyMinutes: 45, deviceDailyMinutes: 120, warnAtMinutes: 5, idleAfterSeconds: 90, users: {} };
let store; let now; let svc;
beforeEach(() => {
  store = makeStore();
  now = new Date('2026-08-27T20:00:00.000Z');
  let n = 0;
  svc = new PianoGameBudgetService({
    store, config: () => CFG, timezone: 'America/Los_Angeles',
    clock: () => now, idFactory: () => `sess_${++n}`,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
});

describe('PianoGameBudgetService', () => {
  it('open persists the session and returns the seed cumulative + balance', async () => {
    const r = await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(r).toMatchObject({
      enabled: true, sessionId: 'sess_1', cumulativeSeconds: 0,
      secondsLeft: 45 * 60, warnAtSeconds: 300, idleAfterSeconds: 90, settleIntervalSec: 60,
    });
    expect(store.saveDay).toHaveBeenCalled();
  });

  it('a reopen within the stale window adopts the session — the reload fix', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 120 });
    now = new Date('2026-08-27T20:02:00.000Z');
    const r = await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(r.sessionId).toBe('sess_1');
    expect(r.cumulativeSeconds).toBe(120);     // client seeds here, not at zero
  });

  it('settle reports depletion against the LEARNER allowance and the DEVICE cap separately', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    const r = await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 45 * 60 });
    expect(r.depleted).toBe(true);
    expect(r.deviceDepleted).toBe(false);
    expect(r.secondsLeft).toBe(0);
  });

  it('disabled config opens nothing and writes nothing', async () => {
    const off = new PianoGameBudgetService({
      store, config: () => ({ enabled: false }), clock: () => now,
      idFactory: () => 'x', logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const r = await off.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    expect(r).toEqual({ enabled: false });
    expect(store.saveDay).not.toHaveBeenCalled();
  });

  it('a store write failure surfaces as budget.settle-failed and rethrows (D16)', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    store.saveDay.mockImplementationOnce(() => { throw new Error('disk says no'); });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const svc2 = new PianoGameBudgetService({
      store, config: () => CFG, clock: () => now, idFactory: () => 'y', logger,
    });
    await expect(svc2.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 30 }))
      .rejects.toThrow('disk says no');
    expect(logger.error).toHaveBeenCalledWith('budget.settle-failed', expect.objectContaining({
      sessionId: 'sess_1', learnerId: 'kid_a',
    }));
  });

  it('the day rolls at the study boundary: a 3am settle still lands on yesterday (D6)', async () => {
    await svc.open({ learnerId: 'kid_a', deviceId: 'kiosk' });
    now = new Date('2026-08-28T09:30:00.000Z'); // 02:30 LA — same study day
    await svc.settle({ sessionId: 'sess_1', learnerId: 'kid_a', cumulativeSeconds: 60 });
    expect(store._days.get('2026-08-27').learners.kid_a.totalSeconds).toBe(60);
    expect(store._days.has('2026-08-28')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement**

```js
// backend/src/3_applications/piano/PianoGameBudgetService.mjs
/**
 * Orchestrates the game-time budget (design D1–D6, D15–D16). The server is the
 * source of truth (D3): the kiosk reloads many times a day, so open returns
 * the recorded cumulative for the client to seed from, and settles are
 * idempotent high-water totals the domain math enforces.
 *
 * Config is read PER CALL, never snapshotted at construction.
 */
import {
  budgetStudyDate, applyOpen, applySettle, applyClose, balanceFor,
} from '#domains/piano/gameBudget.mjs';

const STALE_AFTER_SECONDS = 900; // 15 min: past this, a crashed session is sealed, not resumed.

export class PianoGameBudgetService {
  #store; #config; #timezone; #clock; #idFactory; #logger;

  constructor({ store, config, timezone = null, clock = () => new Date(), idFactory = () => `gbs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, logger = console } = {}) {
    if (!store) throw new Error('PianoGameBudgetService requires store');
    if (typeof config !== 'function') throw new Error('PianoGameBudgetService requires a config accessor');
    this.#store = store; this.#config = config; this.#timezone = timezone;
    this.#clock = clock; this.#idFactory = idFactory; this.#logger = logger;
  }

  #cfg() { return this.#config() ?? {}; }
  #today() { return budgetStudyDate(this.#clock(), this.#timezone); }
  #warnAtSeconds(cfg) { return (cfg.warnAtMinutes ?? 5) * 60; }

  async open({ learnerId, deviceId }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return { enabled: false };
    const at = this.#clock().toISOString();
    const day = this.#store.loadDay(this.#today());
    const r = applyOpen(day, {
      sessionId: this.#idFactory(), learnerId, deviceId, at, staleAfterSeconds: STALE_AFTER_SECONDS,
    });
    this.#store.saveDay(r.day);
    const bal = balanceFor(r.day, cfg, learnerId);
    this.#logger.info?.('budget.opened', {
      learnerId, deviceId, sessionId: r.sessionId, adopted: r.adopted,
      cumulativeSeconds: r.cumulativeSeconds, studyDate: r.day.studyDate,
    });
    return {
      enabled: true, sessionId: r.sessionId, cumulativeSeconds: r.cumulativeSeconds,
      ...bal, warnAtSeconds: this.#warnAtSeconds(cfg),
      settleIntervalSec: 60, idleAfterSeconds: cfg.idleAfterSeconds ?? 90,
    };
  }

  async settle({ sessionId, learnerId, cumulativeSeconds }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return { secondsLeft: Infinity, depleted: false, deviceDepleted: false };
    const at = this.#clock().toISOString();
    const day = this.#store.loadDay(this.#today());
    const r = applySettle(day, { sessionId, cumulativeSeconds, at });
    try {
      this.#store.saveDay(r.day);
    } catch (err) {
      // D16: a swallowed debit is free game time. Loud, then rethrow.
      this.#logger.error?.('budget.settle-failed', {
        sessionId, learnerId, cumulativeSeconds, error: err?.message,
      });
      throw err;
    }
    const bal = balanceFor(r.day, cfg, learnerId);
    const depleted = bal.learnerSecondsLeft <= 0;
    const deviceDepleted = bal.deviceSecondsLeft <= 0;
    this.#logger.info?.('budget.settled', {
      sessionId, learnerId, chargedSeconds: r.chargedSeconds, secondsLeft: bal.secondsLeft,
      studyDate: r.day.studyDate,
    });
    if (depleted) this.#logger.info?.('budget.depleted', { learnerId, sessionId });
    if (deviceDepleted) this.#logger.info?.('budget.device-depleted', { sessionId });
    return { secondsLeft: bal.secondsLeft, depleted, deviceDepleted };
  }

  async close({ sessionId, learnerId, cumulativeSeconds }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return { ok: true };
    const at = this.#clock().toISOString();
    const day = this.#store.loadDay(this.#today());
    const r = applyClose(day, { sessionId, cumulativeSeconds, at });
    try {
      this.#store.saveDay(r.day);
    } catch (err) {
      this.#logger.error?.('budget.settle-failed', { sessionId, learnerId, cumulativeSeconds, error: err?.message });
      throw err;
    }
    return { ok: true };
  }

  async balance({ learnerId }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return { enabled: false };
    const day = this.#store.loadDay(this.#today());
    return { enabled: true, ...balanceFor(day, cfg, learnerId), warnAtSeconds: this.#warnAtSeconds(cfg) };
  }
}

export default PianoGameBudgetService;
```

- [ ] **Step 4: Run to verify pass** — 6 tests PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): game-budget service — server-held truth the kiosk can reload against"`

---

### Task 4: HTTP routes + composition wiring

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs` (add `pianoGameBudgetService = null` to the `createPianoRouter` params at `:105`; add routes near the existing `/users/:userId/...` block)
- Modify: `backend/src/app.mjs:2566` (construct store + service, pass into `createPianoRouter`)
- Test: `backend/src/4_api/v1/routers/piano.gameBudget.test.mjs`

**Interfaces:**
- Consumes: Task 3 service.
- Produces the four endpoints named in File Structure. Route absence posture: when the service is not wired, the GET returns `{ enabled: false }` and the POSTs 404 — the meter fails open on both.

- [ ] **Step 1: Write the failing route test** — follow the router's existing test idiom (`piano.courses.test.mjs` is the sibling: build the router with an injected fake service, drive with supertest):

```js
// backend/src/4_api/v1/routers/piano.gameBudget.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

function appWith(service) {
  const app = express();
  app.use(express.json());
  // Mirror piano.courses.test.mjs's minimal construction — pianoContainer double
  // with only what createPianoRouter dereferences at build time.
  app.use('/api/v1/piano', createPianoRouter({
    pianoContainer: { available: () => false },
    pianoGameBudgetService: service,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
}

describe('piano game-budget routes', () => {
  it('POST session opens and returns the seed', async () => {
    const service = { open: vi.fn(async () => ({ enabled: true, sessionId: 's1', cumulativeSeconds: 30, secondsLeft: 100 })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session').send({ deviceId: 'kiosk' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: 's1', cumulativeSeconds: 30 });
    expect(service.open).toHaveBeenCalledWith({ learnerId: 'kid_a', deviceId: 'kiosk' });
  });

  it('POST settle forwards the cumulative and returns depletion', async () => {
    const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: true, deviceDepleted: false })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/settle').send({ cumulativeSeconds: 2700 });
    expect(res.status).toBe(200);
    expect(res.body.depleted).toBe(true);
    expect(service.settle).toHaveBeenCalledWith({ sessionId: 's1', learnerId: 'kid_a', cumulativeSeconds: 2700 });
  });

  it('GET balance answers enabled:false when the feature is off', async () => {
    const service = { balance: vi.fn(async () => ({ enabled: false })) };
    const res = await request(appWith(service)).get('/api/v1/piano/users/kid_a/game-budget');
    expect(res.body).toEqual({ enabled: false });
  });

  it('an unwired service 404s the POSTs and disables the GET', async () => {
    const app = appWith(null);
    expect((await request(app).post('/api/v1/piano/users/k/game-budget/session').send({})).status).toBe(404);
    expect((await request(app).get('/api/v1/piano/users/k/game-budget')).body).toEqual({ enabled: false });
  });
});
```

- [ ] **Step 2: Run to verify failure** — routes 404 / body mismatch.

- [ ] **Step 3: Implement the routes** (inside `createPianoRouter`, after the `/users/:userId/attempts` block; use the router's existing `asyncHandler`):

```js
  // --- Game-time budget (design 2026-08-27; D3: server is the source of truth) ---
  router.get('/users/:userId/game-budget', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.json({ enabled: false });
    res.set('Cache-Control', 'no-store');
    res.json(await pianoGameBudgetService.balance({ learnerId: req.params.userId }));
  }));
  router.post('/users/:userId/game-budget/session', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.status(404).json({ error: 'game budget not configured' });
    res.json(await pianoGameBudgetService.open({
      learnerId: req.params.userId, deviceId: req.body?.deviceId ?? null,
    }));
  }));
  router.post('/users/:userId/game-budget/session/:sessionId/settle', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.status(404).json({ error: 'game budget not configured' });
    res.json(await pianoGameBudgetService.settle({
      sessionId: req.params.sessionId, learnerId: req.params.userId,
      cumulativeSeconds: Number(req.body?.cumulativeSeconds) || 0,
    }));
  }));
  router.post('/users/:userId/game-budget/session/:sessionId/close', asyncHandler(async (req, res) => {
    if (!pianoGameBudgetService) return res.status(404).json({ error: 'game budget not configured' });
    res.json(await pianoGameBudgetService.close({
      sessionId: req.params.sessionId, learnerId: req.params.userId,
      cumulativeSeconds: Number(req.body?.cumulativeSeconds) || 0,
    }));
  }));
```

And in `app.mjs` beside the `createPianoRouter` call at `:2566` (dataDir already in scope as `configService.getDataDir()` — see `:578`):

```js
  const pianoGameBudgetStore = new YamlPianoGameBudgetStore({
    historyRoot: path.join(dataDir, 'household/history/piano-games'),
    logger: rootLogger.child({ component: 'piano-game-budget' }),
  });
  const pianoGameBudgetService = new PianoGameBudgetService({
    store: pianoGameBudgetStore,
    config: () => configService.getHouseholdAppConfig(null, 'piano')?.gameLimit,
    timezone: configService.getHouseholdAppConfig(null, 'school')?.timezone ?? null,
    logger: rootLogger.child({ component: 'piano-game-budget' }),
  });
```

then add `pianoGameBudgetService,` to the `createPianoRouter({ ... })` argument object, and the two imports at the top of `app.mjs` beside the other piano imports. **Check the school timezone accessor**: grep how school composition resolves its timezone (`grep -n "timezone" backend/src/5_composition/modules/schoolLifecycle.mjs | head`) and use the same expression — if it differs from the guess above, the composition is the authority.

- [ ] **Step 4: Run to verify pass** — route tests PASS; also boot check `node -e "import('./backend/src/app.mjs').then(()=>console.log('loads')).catch(e=>{console.error(e.message);process.exit(1)})"` if the repo's app module supports import-without-listen; otherwise rely on the router test.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): game-budget HTTP surface on the piano router"`

---

### Task 5: The activity signal + `useInactivityReturn` modification

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/activitySignal.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/useInactivityReturn.js` (three bump sites: the MIDI effect, the keepAlive interval, the pointer/keydown listeners)
- Test: `frontend/src/modules/Piano/PianoKiosk/activitySignal.test.js`

**Interfaces:**
- Produces: `activitySignal` singleton — `{ bump(), lastActivityAt(): number, subscribe(cb): () => void }`. `bump()` updates the timestamp and notifies subscribers. The design's Modified #5: the existing `onIdle()` contract is untouched; this only *adds* an observable.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/src/modules/Piano/PianoKiosk/activitySignal.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activitySignal } from './activitySignal.js';

describe('activitySignal', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('bump advances lastActivityAt and notifies subscribers', () => {
    const cb = vi.fn();
    const unsub = activitySignal.subscribe(cb);
    vi.setSystemTime(1_005_000);
    activitySignal.bump();
    expect(activitySignal.lastActivityAt()).toBe(1_005_000);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    activitySignal.bump();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
```

Also extend the existing `useInactivityReturn` spec (or create `useInactivityReturn.test.jsx` if none exists — **check first**; a brief in an earlier plan asserted a spec existed when it did not): render the hook, dispatch a `pointerdown`, assert `activitySignal.lastActivityAt()` advanced, and assert the pre-existing `onIdle` still fires after `minutes` of fake-timer advance.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```js
// frontend/src/modules/Piano/PianoKiosk/activitySignal.js
/**
 * One shared "a human just did something" timestamp for the kiosk.
 *
 * Extracted so the game-budget meter can pause AND resume at seconds
 * granularity (design Modified #5). useInactivityReturn keeps its private
 * minutes-granularity onIdle contract untouched — it now also bumps this
 * signal at the same three places it already bumps its own ref, so the two
 * can never disagree about what counts as activity (MIDI, pointerdown,
 * keydown, keepAlive).
 */
const listeners = new Set();
let last = Date.now();

export const activitySignal = {
  bump() {
    last = Date.now();
    for (const cb of listeners) { try { cb(last); } catch { /* listener's problem */ } }
  },
  lastActivityAt: () => last,
  subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
};

export default activitySignal;
```

In `useInactivityReturn.js`, add `import { activitySignal } from './activitySignal.js';` and append `activitySignal.bump();` inside each of the three places that currently set `lastActivityRef.current = Date.now()` (the MIDI-activity effect, the keepAlive interval callback, and the shared `bump` used by the pointer/keydown listeners). No other change; the exported signature stays `(activeNotes, historyLen, minutes, onIdle, keepAlive)`.

- [ ] **Step 4: Run to verify pass** — both specs green.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): a subscribable activity signal beside the idle-return timer"`

---

### Task 6: The client meter — `useGameBudgetMeter`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/useGameBudgetMeter.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/useGameBudgetMeter.test.jsx`

**Interfaces:**
- Consumes: Task 4 endpoints (via injectable `api`, mirroring `createDefaultCoinApi`'s injectability); Task 5 `activitySignal`.
- Produces:

```js
useGameBudgetMeter({ learnerId, deviceId, active, api = defaultApi })
  → { state, secondsLeft, warn }
// state: 'off' | 'opening' | 'playing' | 'idle-paused' | 'warning'
//        | 'depleted' | 'device-depleted' | 'unavailable'
```

Behaviour contract (each line is a test):
1. `open` on mount when `active`; seeds `totalSeconds` from `res.cumulativeSeconds` (the under-charging fix — **never zero**).
2. Ticks 1s (fake timers) while not idle; idle = `Date.now() - activitySignal.lastActivityAt() >= idleAfterSeconds*1000`; emits `budget.idle-paused` / `budget.idle-resumed` on crossings.
3. Settles every `settleIntervalSec` with the cumulative; a settle answering `depleted: true` → state `depleted`, close, stop. `deviceDepleted: true` → `device-depleted`.
4. `warning` when `secondsLeft <= warnAtSeconds` (server-provided).
5. `open` failure or `enabled: false` route answer → `unavailable` / `off` — **fail open** (gate-stack table): the caller treats both as "games allowed, unmetered", and it logs `budget.open-failed`.
6. Unmount closes with the final cumulative.

- [ ] **Step 1: Write the failing tests** — all under `vi.useFakeTimers()`; drive with `renderHook` from `@testing-library/react`; a fake `api` records calls. The two highest-value cases, in full:

```js
it('a remount mid-session seeds from the server cumulative — reload is not free time', async () => {
  const api = fakeApi({ open: { enabled: true, sessionId: 's1', cumulativeSeconds: 300, secondsLeft: 600, warnAtSeconds: 300, settleIntervalSec: 60, idleAfterSeconds: 90 } });
  const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });   // let open resolve
  act(() => { activitySignal.bump(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  // First settle carries 300 (seed) + 60 (ticked) = 360 — NOT 60.
  expect(api.calls.settle.at(-1).cumulativeSeconds).toBe(360);
});

it('idle pauses the drain and resumes on the next activity bump', async () => {
  const api = fakeApi({ open: { enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 600, warnAtSeconds: 60, settleIntervalSec: 600, idleAfterSeconds: 90 } });
  const { result } = renderHook(() => useGameBudgetMeter({ learnerId: 'kid_a', deviceId: 'kiosk', active: true, api }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  act(() => { activitySignal.bump(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(89_000); });
  expect(result.current.state).toBe('playing');
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); }); // crosses 90s idle
  expect(result.current.state).toBe('idle-paused');
  const before = result.current.secondsLeft;
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(result.current.secondsLeft).toBe(before);                     // paused = no drain
  act(() => { activitySignal.bump(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(result.current.state).toBe('playing');
});
```

Write the remaining cases (open-failure → `unavailable`; `enabled:false` → `off`; depletion via settle response; warning threshold; unmount close carries the final cumulative) in the same idiom — each one asserts on `api.calls` or `result.current.state`, never on elapsed real time.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Model directly on `coinMeteredGate.js`'s structure (state machine + notify), as a hook: `useRef` for `totalSeconds`/`sessionId`, one 1s `setInterval` for tick, settle accumulator, `useEffect` teardown → close. Seed `totalSeconds.current = res.cumulativeSeconds` in the open handler with a comment naming the under-charging failure it prevents. Log events per the design's `piano-game-budget` table via `getLogger().child({ component: 'piano-game-budget' })`. Default `api` object mirrors `createDefaultCoinApi` with the four Task-4 URLs.

- [ ] **Step 4: Run to verify pass** — all meter tests green.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the game-budget meter — seeds from the server, pauses when hands leave"`

---

### Task 7: Budget gate + meter in Games mode (gate 3)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx`
- Test: extend `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.test.jsx`

**Interfaces:**
- Consumes: Task 6 hook; `usePianoKioskConfig()` for `config.gameLimit?.enabled`; existing `useSchoolGameAccess` lock stays untouched **above** this gate (gate-stack order 1→3).
- Produces: `GameHost` mounts the meter (`active: true` — D13: only a mounted game is a match); depletion swaps the game for a lock panel. `Games()` renders a device-depletion / learner-depletion panel with the design's two distinct copies.

Copy (exact strings, used by the tests):
- Learner depleted: heading `Games are done for today`, body `You’ve used your piano game time for today. It comes back tomorrow.`
- Device depleted: heading `The piano’s games are done for today`, body `This piano has reached its shared game time for the day.`
- Warning banner (non-blocking, inside the game chrome): `{minutes} min of game time left` where `minutes = Math.ceil(secondsLeft / 60)`.

- [ ] **Step 1: Write failing tests** in `Games.test.jsx`'s existing idiom (it already mocks `useSchoolGameAccess`): mock `useGameBudgetMeter` per test; assert (a) `depleted` renders the learner copy and no game; (b) `device-depleted` renders the device copy; (c) `unavailable` and `off` render the game (fail open); (d) `warning` renders the banner and the game.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — in `GameHost`, after the existing hooks: `const meter = useGameBudgetMeter({ learnerId: currentUser, deviceId: 'piano-kiosk', active: config.gameLimit?.enabled === true });` then a branch above the `entry` check: `if (meter.state === 'depleted') return <BudgetLock kind="learner" />;` etc. `BudgetLock` is a small local component in the same file using the `piano-mode__placeholder` classes the school lock already uses.
- [ ] **Step 4: Verify pass**, plus the untouched school-lock tests still green.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): games check the day's budget after the school gate"`

---

### Task 8: The ladder — `gameGateLadder.js`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gameGateLadder.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gameGateLadder.test.js`

**Interfaces:**
- Produces (pure, no fetching — unit-testable with no fixtures, per the design's New list):

```js
initialRung()            → { timing:'cued', hands:2, span:2, difficulty:'exotic', direction:'both' }
degradeRung(rung)        → next-easier rung; degradation order direction → difficulty → span → hands → timing
                           (timing LAST — the design: it changes what failure means); at floor returns rung unchanged
climbRung(rung)          → one step harder, inverse order
isFloor(rung)            → true when nothing is left to degrade
requirementForRung(rung, { passScore }) →
  // non-floor: { mode: rung.timing === 'cued' ? 'cued' : 'free', hands, span, difficulty, direction, passScore }
  // floor:     { mode:'free', hands:1, span:1, rubric:{ criteria:{ completeness:1 } }, passScore:null }
```

Axis values (hard → easy), from the design's ladder table: `timing: cued → free` (mode vocabulary — never a matcher name), `hands: 2 → 1`, `span: 2 → 1`, `difficulty: exotic → major`, `direction: both → ascending`.

- [ ] **Step 1: Write failing tests** — table-driven: full degradation walk reaches the floor in exactly 5 steps in the stated order; `degradeRung(floor)` is identity; `climbRung(initialRung())` is identity; **the floor requirement carries `rubric: { criteria: { completeness: 1 } }` and `passScore: null` and mode `free`** (this is the D9 contract; name the test `the floor requirement omits cleanliness so a stray key cannot fail it`); a non-floor requirement never carries a rubric.
- [ ] **Step 2: Verify failure.** **Step 3: Implement** (~50 lines, an ordered axis list + index walk). **Step 4: Verify pass.** **Step 5: Commit** — `git commit -m "feat(piano): the gate ladder — five axes down, timing last, an unfailable floor"`

---

### Task 9: ExerciseRun modifications (design Modified #1, #3, #4) + rubric threading

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx:74` (policy), `:86` (wrong event), `:53-69` (material seam)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/assessment.js` (`prepareExerciseAssessment` honors `requirement.rubric`)
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js`
- Test: extend the existing ExerciseRun/assessment specs (locate them first: `ls frontend/src/modules/Piano/PianoKiosk/modes/Exercises/*.test.*`); create `gateMaterial.test.js`

**Interfaces:**
- Produces:
  - `ExerciseRun` new optional prop `material = null`: `{ kind:'exercise', instanceId }` — when present it replaces the `instanceId` prop as the load source, resolved through `resolveGateMaterial`. (D10 seam: `{ kind:'score', … }` is **accepted** by `resolveGateMaterial` and returns a compiled expectation via `compileScoreExpectation`; ExerciseRun passes it straight to `createAssessmentAttempt`, which the design confirms accepts either. Ghost/notation for score kind is Phase 2 — the run renders without notation decoration in that case.)
  - Wrong events keep their payload: `onEvent: (event) => setLastWrong(event?.type === 'wrong' ? { midi: event.midi, eventId: event.eventId } : null)` — `lastWrong` becomes `null | {midi, eventId}` (all three matchers already emit these fields, `assessmentAttempt.js:305,343,363`).
  - Policy: `createAssessmentAttempt({ ...prepared, policy: { matchWindowMs: 220, missWindowMs: 420, timingToleranceMs: 80, timingWindowMs: 320, ...(requirement?.policy ?? {}) } })` — requirement wins; the engine already merges caller policy over its own defaults (`assessmentAttempt.js:233`) and exposes `wrongWindow`/`allowExtras`.
  - `assessment.js`: the built rubric becomes `requirement?.rubric ?? <existing default>`.

- [ ] **Step 1: Write the failing tests.** Three, and the third is the design's named regression test:
  1. `requirement.policy overrides the hardcoded defaults` — build a run with `requirementOverride: { mode:'free', policy:{ wrongWindow: 5 } }`, assert the attempt's policy carries `wrongWindow: 5` (spy on `createAssessmentAttempt` or read the attempt if exposed).
  2. `a wrong event exposes the played midi` — feed a wrong note through the runtime double, assert `lastWrong` equals `{ midi, eventId }`.
  3. **`a completed floor attempt with N wrong notes still passes`** — prepare an assessment with the Task-8 floor requirement (rubric `{criteria:{completeness:1}}`), simulate a complete `cursor` run containing 3 wrong keys, assert `verdict.passed === true` and the wrongs are still present in the attempt evidence (nothing hidden — design: "recorded, not disqualifying"). *Without this test the escape hatch silently stops existing the next time a rubric default changes.*
- [ ] **Step 2: Verify all three fail** (the third fails on `cleanliness` today — that is the point).
- [ ] **Step 3: Implement** the four edits + `gateMaterial.js`:

```js
// frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js
/**
 * D10 provider seam: the gate does not care where its material comes from.
 * Both kinds funnel into createAssessmentAttempt, which accepts a prepared
 * exercise or a compiled score expectation directly (design Material providers).
 */
import { pianoLearningApi } from '../Exercises/pianoLearningApi.js';

export async function resolveGateMaterial(material) {
  if (material?.kind === 'exercise') {
    const res = await pianoLearningApi.instance(material.instanceId);
    if (!res.ok) return { ok: false, error: 'instance-unavailable' };
    return { ok: true, kind: 'exercise', instance: res.data };
  }
  if (material?.kind === 'score') {
    // Accepted from day one (D10); assessed but rendered without the ghost (Phase 1 limit).
    return { ok: false, error: 'score-material-phase-2' };
  }
  return { ok: false, error: 'unknown-material-kind' };
}
```

  (Phase 1 keeps `score` honest: the seam exists, the picker in Task 10 only emits `exercise`, and a `score` config entry logs and is skipped rather than crashing.)
- [ ] **Step 4: Verify pass**, and run the whole Exercises spec directory to catch regressions in the run surface.
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the run surface takes its policy and rubric from the requirement"`

---

### Task 10: The gate host — `GameGate.jsx` + material picking

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Games/GameGate.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateMaterial.js` (add `pickGateMaterial`)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Games/GameGate.test.jsx`

**Interfaces:**
- Consumes: Task 8 ladder; Task 9 `ExerciseRun` (`intent='challenge'`, `requirementOverride`, `material`, `onPassed`, `onExit`); `pianoLearningApi.instances(seedId)` + `instance.supports` for axis-compatible picking; `useNavigate` for the practice detour.
- Produces:

```jsx
<GameGate learnerId={...} gateConfig={config.gameGate} onPassed={() => ...} onLeave={() => ...} />
```

Behaviour contract:
1. Rung persists per learner in `localStorage` key `piano.game-gate.rung.{learnerId}` (JSON rung + `failuresAtRung` + `cleanPasses`); corrupt → `initialRung()`.
2. `pickGateMaterial(gateConfig.material, rung)` — filters config entries to `kind:'exercise'`, picks a seed from the configured `collections`, then an instance whose `supports` includes the rung's mode; returns `{ material, requirement }`.
3. **Fail open** (design gate-stack: "Infrastructure: open"): any material-resolution failure calls `onPassed()` immediately and logs `gate.unavailable` — a backend 502 must not block an earned game.
4. Pass: `onPassed()`; increment `cleanPasses`; after `climbAfterCleanPasses` clean passes, `climbRung` and reset the counter; log `gate.passed` `{score}`.
5. Fail: panel with exactly three buttons — `Try again` (rerun; after `retriesBeforeDegrade` failures, `degradeRung` + banner `We made it a little easier` + log `gate.rung-changed`), `Practice this` (navigate to the existing `intent=practice` route for the same material — **unmetered, ungated**; log `gate.practice-detour`), `Leave` (`onLeave()`; log `gate.abandoned`). None reaches a match without passing (D12).
6. Floor reached → log `gate.floor-reached` once per arrival.
7. Every event carries `learnerId`, `deviceId`, `studyDate`(client-local ok), `sessionId`(gate mount id), plus `material`, `rung`, `mode`, `score`, `attemptId` where the design's table says so.

- [ ] **Step 1: Write failing tests** — mock `ExerciseRun` (`vi.mock`) to a stub exposing `onPassed`/`onExit` triggers; mock `pianoLearningApi`; fake timers; cover contracts 1–6 (seven tests, one per numbered line, plus `corrupt localStorage falls back to initialRung`).
- [ ] **Step 2: Verify failure.** **Step 3: Implement** (~150 lines). **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(piano): the match gate — pass a short attempt, or the ladder comes to you"`

---

### Task 11: Match-boundary wiring (D7/D11) — `MatchGateContext`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Games/MatchGateContext.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Games/Games.jsx` (`GameHost`)
- Modify: `frontend/src/modules/Piano/game-platform/families/addressed-board/useAddressedBoardGame.js` (`restart()` at `:139`)
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx` (its rematch entry point — locate with `grep -n "restart\|rematch\|new game" -i`)
- Test: extend `Games.test.jsx`; extend the addressed-board family spec

**Interfaces:**
- Produces: `MatchGateContext` = `createContext(null)` providing `{ armed: boolean, requestRematch(): void }`.
- `GameHost` state machine: `const [gatePending, setGatePending] = useState(gateEnabled);` `const [matchId, setMatchId] = useState(1);`
  - `gatePending` → render `<GameGate …/>` **in place of** the game (D11: same route, game unmounted — MIDI has no focus concept, so exactly one consumer at a time).
  - `GameGate.onPassed` → `setGatePending(false); setMatchId((n) => n + 1);` — the game mounts keyed `key={matchId}`, so every pass starts a **fresh** match.
  - `requestRematch()` → `setGatePending(true)` (the game unmounts; at a match boundary there is no state to lose).
  - Gate disabled (`config.gameGate?.enabled !== true`) → context provides `{ armed: false, requestRematch }` where `requestRematch` just bumps `matchId` (today's restart behaviour, exactly).
- Game-side contract: where a game currently restarts itself, it first asks the context:

```js
const matchGate = useContext(MatchGateContext);
// in the restart path:
if (matchGate?.armed) { matchGate.requestRematch(); return; }
// …existing local restart continues unchanged when unarmed or unmounted elsewhere.
```

  Applied in exactly two places: `useAddressedBoardGame.restart()` (covers checkers + connect-four — one call site, `:139`, before `setLocalPractice(false)`) and chess's rematch action. Games mounted outside the kiosk (no provider) get `null` from the context and behave exactly as today.

- [ ] **Step 1: Write failing tests** — (a) gate enabled: entering a game renders the gate, not the game; a passed gate renders the game; (b) `requestRematch` from a child re-renders the gate and, after a pass, the game remounts with a new `key` (assert via a probe child that records mount count); (c) gate disabled: no gate renders, `requestRematch` still produces a fresh match; (d) family spec: with an armed context, `restart()` calls `requestRematch` and does **not** reset local state; with no context it behaves as before (existing tests keep passing untouched).
- [ ] **Step 2: Verify failure.** **Step 3: Implement.** **Step 4: Verify pass** — run the full Games + addressed-board + chess spec set. **Step 5: Commit** — `git commit -m "feat(piano): every match starts at the gate, replays included"`

---

### Task 12: Config defaults, reference doc, event-coverage test

**Files:**
- Create: `docs/reference/piano/games-budget-gate.md`
- Modify: `docs/reference/piano/` index/link if one exists (check `ls docs/reference/piano/`)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Games/gateEvents.test.jsx`

- [ ] **Step 1: The event-coverage test.** The design's Observability section: "every event in the layer-1 table is actually emitted on its path". Write one spec that drives the gate host and meter through pass/fail/degrade/idle/deplete flows (mocked api, fake timers) with a logger spy, asserting each of these fires at least once: `gate.presented`, `gate.attempt` (emit on ExerciseRun mount inside the gate), `gate.passed`, `gate.failed`, `gate.rung-changed`, `gate.floor-reached`, `gate.practice-detour`, `gate.abandoned`, `gate.unavailable`, and meter-side `budget.idle-paused`, `budget.idle-resumed`, `budget.warning`, `budget.open-failed`. (Backend events `budget.opened/settled/depleted/device-depleted/settle-failed` are already asserted in Task 3; `budget.day-rollover` is implicit in the day-file naming — assert in Task 3 that two settles across the boundary land in two files, which the last Task-3 test already half-covers; extend it.)
- [ ] **Step 2–4: Fail → implement any missing emission → pass.**
- [ ] **Step 5: Write the reference doc** — endstate voice, no wave narrative (house rule: reference docs are endstate): the gate stack table, the two config blocks with defaults, the day-file location + schema, the event tables, the D9 floor-rubric explanation, the D11 swap-not-modal rationale, the Phase-2 note (score-kind material accepted at the seam; OSMD ghost pending), and the three open questions (retry-count default, adult device-cap exemption, banked credit) copied from the design.
- [ ] **Step 6: Commit** — `git commit -m "feat(piano): game budget + gate config, events, and the reference page"`

---

### Task 13: Live smoke + gate run

- [ ] **Step 1:** `npx vitest run frontend/src/modules/Piano/ backend/src/2_domains/piano/ backend/src/3_applications/piano/ backend/src/4_api/v1/routers/piano.gameBudget.test.mjs` — everything green.
- [ ] **Step 2:** `npm run test:unit:vitest` once (13 min). Known caveat: the gate has documented roaming flakes at this population (`docs/_wip/bugs/2026-08-27-vitest-gate-nondeterministic-at-2605-files.md`) — a NEW failing file in *this plan's* files is yours; a roaming failure elsewhere that passes solo is not. Do not baseline anything.
- [ ] **Step 3:** Manual dev-server check with `gameLimit.enabled: true, gameGate.enabled: true` set in the household piano config (config is boot-cached — restart the dev server after editing): enter Games → gate appears; pass → match starts; restart → gate reappears; idle 90s → meter pauses (watch `piano-game-budget` events in the log store); confirm `data/household/history/piano-games/{today}.yml` exists and its totals move.
- [ ] **Step 4: Commit any doc corrections found during the smoke.**

---

## Self-review (performed while writing)

- **Spec coverage:** D1–D6 → Tasks 1–7. D7/D11 → Task 11. D8/D9 → Tasks 8–9 (floor regression test is Task 9 step 1.3). D10 → Tasks 9–10 (seam accepts both kinds; score deferred to Phase 2 per the design's own phasing). D12 → Task 10. D13 → Task 7 (`active` only in GameHost) + Task 10 (practice detour unmetered by construction — it navigates away from GameHost). D14 (`earned`) and `economy` sources → **deliberately not implemented**: D2 says "ships `fixed`, leaves the others as config selections"; the service's config accessor is the seam, and the reference doc documents `source: fixed` as the only live value. D15/D16 → Tasks 2–3. Observability table → Tasks 3 and 12. Testing section's named cases → Tasks 1 (rollover, idempotency, stale adoption), 6 (reload-not-free, idle pause/resume), 9 (floor regression, policy override), 10 (fail-open `gate.unavailable`), 12 (event coverage). Known-constraint (two renderers) → honored by Phase-1 scope. Open questions 1–3 → recorded in the reference doc, not decided.
- **Placeholder scan:** the two "write the remaining cases in the same idiom" instructions (Tasks 6, 8) name every case individually with its assertion target — acceptable; no TBDs.
- **Type consistency:** `cumulativeSeconds` everywhere (never `coins`); rung axis values match between Tasks 8 and 10; route paths match between Tasks 4 and 6; `requirementForRung` floor shape matches the Task 9 regression test and the design's floor yaml.
- **One deliberate deviation from the design:** the design's config example nests the floor as `ladder.floor`; the plan's `requirementForRung` hardcodes the floor shape and exposes only `passScore`/`retriesBeforeDegrade`/`climbAfterCleanPasses` as config. Reason: a config-authored floor rubric is a loaded footgun (a household edit re-adding `cleanliness` silently re-creates the D9 bug). The reference doc states the floor is fixed by code. If the user wants it configurable, it is a small Task-8 change.
