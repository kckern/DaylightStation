# Household Economy (Coins) — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A persistent, auditable household coin economy: kids earn coins by completing piano lessons (and via parent deposits) and spend them as a metered drain playing arcade games in the Fitness EmulatorGame widget.

**Architecture:** New `economy` backend domain following the repo's DDD layers — pure domain logic in `2_domains/economy`, a YAML append-only ledger datastore in `1_adapters/persistence/yaml`, an application service in `3_applications/economy`, a thin router in `4_api`, wired via a `5_composition` module. Balance is always derived by folding an immutable transaction log; `wallet.yml` is a reconcilable cache. Metered spending uses one open session (hold) per user with periodic settles, so a 25-minute arcade run produces a handful of ledger entries and a crash costs at most the unsettled tail. Frontend integration replaces the currently-stubbed open gate in `fitnessGameGate.js` with a coin-metered gate.

**Tech Stack:** Node ES modules (`.mjs`), Express, YAML persistence via `#system/utils/FileIO.mjs`, vitest (colocated `*.test.mjs`, real fs against `/tmp`, hand-rolled fake `configService`), React frontend calling `DaylightAPI`.

**Design doc:** `docs/_wip/plans/2026-07-17-household-economy-design.md` (read it first — currency model, policy catalog, hold-and-settle, auth ladder).

---

## Context you must know before starting (read once)

**Import aliases** (`package.json` `imports`): `#system/*` → `backend/src/0_system/*`, `#domains/*` → `2_domains`, `#apps/*` → `3_applications`, `#adapters/*` → `1_adapters`, `#composition/*` → `5_composition`.

**FileIO:** `import { loadYaml, loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs'`. Paths are passed **without** the `.yml` extension — FileIO appends it. `loadYamlSafe` returns `null` on missing/corrupt.

**ConfigService accessors:** `getUserProfile(username)` (null for unknown user), `getUserDir(username)` → `<dataDir>/users/<username>`, `getHouseholdAppConfig(householdId, appName)` → parsed `data/household/config/<app>.yml`. NOTE: household app config is **cached at startup** — after editing `economy.yml` in the live data dir, the dev server must restart before changes apply.

**DI convention:** app-layer stores/services take `constructor({ configService, logger = console })` (see `backend/src/3_applications/piano/UserVideoProgressStore.mjs`). Adapters throw `InfrastructureError` (`#system/utils/errors/index.mjs`) with `{ code: 'MISSING_DEPENDENCY' }` when built without `configService` (see `YamlFinanceDatastore.mjs`). Domain errors come from `#domains/core/errors/index.mjs` (`DomainInvariantError`, `ValidationError`).

**Router pattern:** factory `createXRouter({ xService, logger = console })` returning `express.Router()`; handlers wrapped in `asyncHandler`, ends with `router.use(errorHandlerMiddleware({ shape: 'string' }))` — both from `#system/http/middleware/index.mjs`. Template: `backend/src/4_api/v1/routers/piano.mjs`.

**Router registration is explicit, 3 hops:**
1. `backend/src/5_composition/modules/economyApi.mjs` — composition module that builds datastore + service + router (template: `5_composition/modules/gratitudeApi.mjs`).
2. `backend/src/app.mjs` — import the module (~line 80 with the other composition imports) and set `v1Routers.economy = createEconomyApiRouter({...})` (gratitude precedent at ~line 1801).
3. `backend/src/4_api/v1/routers/api.mjs` — add `'/economy': 'economy'` to the `routeMap` (~line 60–123).

**Test conventions:** vitest, colocated `Foo.test.mjs` next to `Foo.mjs`. No fs mocking — real fs under `/tmp`, fake `configService` object, `beforeEach`/`afterEach` `fs.rmSync(DIR, { recursive: true, force: true })`. Assert both return values and on-disk YAML. Run one file: `npx vitest run <path>` (from repo root). Full gate: `npm run test:unit:vitest`.

**Baseline (recorded 2026-07-17):** gate shows 6407/6455, with 3 pre-existing failing files unrelated to this work (`tests/isolated/modules/Admin/paginationScrollGuard.test.mjs`, `tests/isolated/modules/Life/UserSwitcher.test.jsx`, `tests/unit/hooks/useStreamingSearch.test.jsx`). Do not chase these; do not add new failures.

**Frontend API helper:** `import { DaylightAPI } from '<rel>/lib/api.mjs'` — `DaylightAPI('api/v1/economy/...', body)` (path WITHOUT leading slash; GET auto-promotes to POST when body has keys; throws on `!response.ok`).

**Frontend logging is mandatory** (project CLAUDE.md): use `getLogger().child({ component: '...' })` from `frontend/src/lib/logging/Logger.js` — never raw `console.*`. Module-level code uses the lazy `logger()` pattern.

**Commits:** this is an isolated feature branch — commit after every green task (per-task auto-commits are authorized here). Do NOT push or merge to main; that's a separate gated step.

**Data model (decided in design):**

```yaml
# data/users/{userId}/apps/economy/ledger/{YYYY-MM-DD}.yml  (append-only list)
- id: txn_k3j2h4
  at: "2026-07-17T20:15:00.000Z"
  kind: earn            # deposit | earn | spend | withdraw | adjust
  delta: 5              # signed integer; earn/deposit > 0, spend/withdraw < 0
  action: piano-lesson-complete
  source: piano         # originating domain/app
  ref: "plex:12345"     # traceability handle (nullable)

# data/users/{userId}/apps/economy/wallet.yml  (cache — always reconcilable)
balance: 42
as_of: "2026-07-17T20:15:00.000Z"
session:                # the open metered session (hold); null when none
  id: ses_9d8f7g
  action: arcade-play
  opened_at: "..."
  last_settled_at: "..."
  settled_coins: 3
```

**MVP simplifications (intentional, documented):** one open session per user at a time (that IS the double-spend guard); a session with no settle for >5 min is stale and auto-closed on next wallet read; coins are integers in the ledger (frontend accumulates fractional drain, settles whole coins).

---

### Task 1: Domain — transaction factory + balance fold

**Files:**
- Create: `backend/src/2_domains/economy/entities/Transaction.mjs`
- Create: `backend/src/2_domains/economy/entities/Transaction.test.mjs`

**Step 1: Write the failing test**

```js
// Transaction.test.mjs
import { describe, it, expect } from 'vitest';
import { createTransaction, foldBalance } from './Transaction.mjs';

describe('createTransaction', () => {
  it('builds a stamped transaction with generated id', () => {
    const t = createTransaction({ kind: 'earn', delta: 5, action: 'piano-lesson-complete', source: 'piano', ref: 'plex:123' });
    expect(t.id).toMatch(/^txn_/);
    expect(t.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.kind).toBe('earn');
    expect(t.delta).toBe(5);
  });
  it('rejects sign/kind mismatch', () => {
    expect(() => createTransaction({ kind: 'earn', delta: -5, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'spend', delta: 3, action: 'x', source: 'test' })).toThrow();
  });
  it('rejects non-integer and zero deltas and unknown kinds', () => {
    expect(() => createTransaction({ kind: 'earn', delta: 1.5, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'earn', delta: 0, action: 'x', source: 'test' })).toThrow();
    expect(() => createTransaction({ kind: 'bogus', delta: 1, action: 'x', source: 'test' })).toThrow();
  });
});

describe('foldBalance', () => {
  it('sums deltas, never below zero reporting', () => {
    expect(foldBalance([{ delta: 5 }, { delta: 3 }, { delta: -2 }])).toBe(6);
    expect(foldBalance([])).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/economy/entities/Transaction.test.mjs`
Expected: FAIL — cannot find module `./Transaction.mjs`.

**Step 3: Write minimal implementation**

```js
// Transaction.mjs
/**
 * Household economy transaction — immutable ledger entry.
 * delta is a signed integer; sign must match kind.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

const KIND_SIGN = { deposit: 1, earn: 1, spend: -1, withdraw: -1, adjust: 0 }; // adjust: any sign

export function createTransaction({ kind, delta, action, source, ref = null }) {
  if (!(kind in KIND_SIGN)) throw new ValidationError(`unknown transaction kind: ${kind}`);
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError(`delta must be a non-zero integer, got ${delta}`);
  const sign = KIND_SIGN[kind];
  if (sign !== 0 && Math.sign(delta) !== sign) throw new ValidationError(`${kind} requires delta sign ${sign}`);
  if (!action) throw new ValidationError('action is required');
  if (!source) throw new ValidationError('source is required');
  return { id: `txn_${shortId()}`, at: new Date().toISOString(), kind, delta, action, source, ref };
}

export function foldBalance(transactions) {
  return Math.max(0, (transactions || []).reduce((sum, t) => sum + (t.delta || 0), 0));
}
```

NOTE: check that `#domains/core/utils/id.mjs` exports `shortId` (it is imported that way in `4_api/v1/routers/piano.mjs:~4`); if the signature differs, adapt.

**Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/2_domains/economy/entities/Transaction.test.mjs`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add backend/src/2_domains/economy/entities/
git commit -m "feat(economy): transaction factory + balance fold (domain)"
```

---

### Task 2: Domain — policy resolver (per-kid overrides, blackout windows)

**Files:**
- Create: `backend/src/2_domains/economy/services/policy.mjs`
- Create: `backend/src/2_domains/economy/services/policy.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { resolvePolicy, inBlackout, drainPerSecond } from './policy.mjs';

const CONFIG = {
  earn: { 'piano-lesson-complete': { reward: 5, per: 'completion', daily_cap: 20 } },
  spend: { 'arcade-play': { cost: 2, per: '10min', self_serve: true, auth: 'identify', blackout: ['22:00-07:00'] } },
  users: {
    jimmy: { 'arcade-play': { blackout: ['22:00-07:00', '15:00-17:00'], daily_cap: 6 } },
  },
};

describe('resolvePolicy', () => {
  it('returns household default when no override', () => {
    const p = resolvePolicy(CONFIG, 'susie', 'arcade-play');
    expect(p).toMatchObject({ cost: 2, per: '10min', auth: 'identify' });
    expect(p.blackout).toEqual(['22:00-07:00']);
  });
  it('merges per-kid override, most-specific-wins', () => {
    const p = resolvePolicy(CONFIG, 'jimmy', 'arcade-play');
    expect(p.blackout).toEqual(['22:00-07:00', '15:00-17:00']);
    expect(p.daily_cap).toBe(6);
    expect(p.cost).toBe(2); // inherited
  });
  it('finds earn actions too, and returns null for unknown actions', () => {
    expect(resolvePolicy(CONFIG, 'jimmy', 'piano-lesson-complete')).toMatchObject({ reward: 5 });
    expect(resolvePolicy(CONFIG, 'jimmy', 'nope')).toBeNull();
  });
});

describe('inBlackout', () => {
  it('handles overnight ranges', () => {
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T23:30:00'))).toBe(true);
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T06:15:00'))).toBe(true);
    expect(inBlackout(['22:00-07:00'], new Date('2026-07-17T12:00:00'))).toBe(false);
  });
  it('handles same-day ranges and empty lists', () => {
    expect(inBlackout(['15:00-17:00'], new Date('2026-07-17T16:00:00'))).toBe(true);
    expect(inBlackout([], new Date())).toBe(false);
    expect(inBlackout(undefined, new Date())).toBe(false);
  });
});

describe('drainPerSecond', () => {
  it('converts cost/per into coins-per-second', () => {
    expect(drainPerSecond({ cost: 2, per: '10min' })).toBeCloseTo(2 / 600);
    expect(drainPerSecond({ cost: 3, per: '20min' })).toBeCloseTo(3 / 1200);
  });
});
```

**Step 2: Run test to verify it fails** — `npx vitest run backend/src/2_domains/economy/services/policy.test.mjs` → FAIL (module not found).

**Step 3: Write minimal implementation**

```js
// policy.mjs — pure functions over the economy.yml config shape. No I/O.
export function resolvePolicy(config, userId, action) {
  const base = config?.earn?.[action] || config?.spend?.[action] || null;
  if (!base) return null;
  const override = config?.users?.[userId]?.[action] || {};
  const type = config?.earn?.[action] ? 'earn' : 'spend';
  return { type, action, ...base, ...override };
}

// windows: ["HH:MM-HH:MM", ...]; overnight ranges (start > end) wrap midnight.
export function inBlackout(windows, now = new Date()) {
  if (!Array.isArray(windows) || windows.length === 0) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return windows.some((w) => {
    const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(w).trim());
    if (!m) return false;
    const start = +m[1] * 60 + +m[2];
    const end = +m[3] * 60 + +m[4];
    return start <= end ? mins >= start && mins < end : mins >= start || mins < end;
  });
}

// per: "<N>min" (e.g. "10min"); returns coins/second.
export function drainPerSecond({ cost, per }) {
  const m = /^(\d+)min$/.exec(String(per || '').trim());
  if (!m || !cost) return 0;
  return cost / (+m[1] * 60);
}
```

**Step 4: Verify pass** — same vitest command → PASS.

**Step 5: Commit** — `git add backend/src/2_domains/economy/services/ && git commit -m "feat(economy): policy resolver with per-kid overrides + blackout windows"`

---

### Task 3: Domain barrel

**Files:**
- Create: `backend/src/2_domains/economy/index.mjs`

**Step 1:** (no test needed — pure re-export, matches gratitude's barrel style)

```js
export { createTransaction, foldBalance } from './entities/Transaction.mjs';
export { resolvePolicy, inBlackout, drainPerSecond } from './services/policy.mjs';
```

**Step 2:** Sanity: `node -e "import('./backend/src/2_domains/economy/index.mjs').then(m => console.log(Object.keys(m)))"` — expect the 5 names. (Run from repo root; if `#domains` alias resolution fails from a bare `node -e`, rely on the Task 4 tests instead.)

**Step 3: Commit** — `git add backend/src/2_domains/economy/index.mjs && git commit -m "feat(economy): domain barrel"`

---

### Task 4: Adapter — YamlEconomyDatastore (ledger append + wallet cache + session)

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlEconomyDatastore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlEconomyDatastore.test.mjs`

The datastore is dumb storage: append transactions to the date-sharded ledger, read ledgers, read/write the wallet snapshot. It does NOT compute balances or enforce policy (that's the service).

**Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { YamlEconomyDatastore } from './YamlEconomyDatastore.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/econ-ds-test-user';
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: () => USER_DIR,
};
const clean = () => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} };
const makeStore = () => new YamlEconomyDatastore({ configService });

beforeEach(clean);
afterEach(clean);

describe('YamlEconomyDatastore', () => {
  it('requires configService', () => {
    expect(() => new YamlEconomyDatastore({})).toThrow(/configService/);
  });
  it('appends transactions to a date-sharded ledger file and reads them back', () => {
    const ds = makeStore();
    const t1 = { id: 'txn_a', at: '2026-07-17T10:00:00.000Z', kind: 'deposit', delta: 10, action: 'parent-deposit', source: 'admin', ref: null };
    const t2 = { id: 'txn_b', at: '2026-07-17T11:00:00.000Z', kind: 'spend', delta: -3, action: 'arcade-play', source: 'emulator', ref: 'ses_1' };
    ds.appendTransaction(USER, t1);
    ds.appendTransaction(USER, t2);
    const day = ds.readLedgerDay(USER, '2026-07-17');
    expect(day).toHaveLength(2);
    expect(day[1].delta).toBe(-3);
    expect(fs.existsSync(path.join(USER_DIR, 'apps', 'economy', 'ledger', '2026-07-17.yml'))).toBe(true);
  });
  it('reads all ledger days in order', () => {
    const ds = makeStore();
    ds.appendTransaction(USER, { id: 'txn_1', at: '2026-07-16T10:00:00.000Z', kind: 'earn', delta: 5, action: 'x', source: 't', ref: null });
    ds.appendTransaction(USER, { id: 'txn_2', at: '2026-07-17T10:00:00.000Z', kind: 'earn', delta: 2, action: 'x', source: 't', ref: null });
    const all = ds.readAllTransactions(USER);
    expect(all.map((t) => t.id)).toEqual(['txn_1', 'txn_2']);
  });
  it('round-trips the wallet snapshot, null when absent', () => {
    const ds = makeStore();
    expect(ds.readWallet(USER)).toBeNull();
    ds.writeWallet(USER, { balance: 7, as_of: '2026-07-17T10:00:00.000Z', session: null });
    expect(ds.readWallet(USER).balance).toBe(7);
  });
  it('returns null/empty for unknown users instead of throwing', () => {
    const ds = makeStore();
    expect(ds.readWallet('nobody')).toBeNull();
    expect(ds.readAllTransactions('nobody')).toEqual([]);
  });
});
```

**Step 2: Verify fail** — `npx vitest run backend/src/1_adapters/persistence/yaml/YamlEconomyDatastore.test.mjs` → FAIL.

**Step 3: Implementation**

```js
// YamlEconomyDatastore.mjs
/**
 * YAML persistence for the household economy.
 * Layout under data/users/{userId}/apps/economy/:
 *   ledger/{YYYY-MM-DD}.yml — append-only transaction list (sharded by txn.at date)
 *   wallet.yml              — balance snapshot + open metered session (cache)
 * Dumb storage only: no balance math, no policy. See EconomyService.
 */
import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlEconomyDatastore {
  #configService;

  constructor(config = {}) {
    if (!config.configService) {
      throw new InfrastructureError('YamlEconomyDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
  }

  #economyDir(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'economy');
  }

  appendTransaction(userId, txn) {
    const dir = this.#economyDir(userId);
    if (!dir) return null;
    const day = String(txn.at).slice(0, 10);
    const base = path.join(dir, 'ledger', day);
    ensureDir(path.dirname(base));
    const list = loadYamlSafe(base) || [];
    list.push(txn);
    saveYaml(base, list, { noRefs: true });
    return txn;
  }

  readLedgerDay(userId, day) {
    const dir = this.#economyDir(userId);
    if (!dir) return [];
    return loadYamlSafe(path.join(dir, 'ledger', day)) || [];
  }

  readAllTransactions(userId) {
    const dir = this.#economyDir(userId);
    if (!dir) return [];
    const ledgerDir = path.join(dir, 'ledger');
    if (!fs.existsSync(ledgerDir)) return [];
    return fs.readdirSync(ledgerDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .sort()
      .flatMap((f) => loadYamlSafe(path.join(ledgerDir, f.replace(/\.yml$/, ''))) || []);
  }

  readWallet(userId) {
    const dir = this.#economyDir(userId);
    if (!dir) return null;
    return loadYamlSafe(path.join(dir, 'wallet'));
  }

  writeWallet(userId, wallet) {
    const dir = this.#economyDir(userId);
    if (!dir) return null;
    ensureDir(dir);
    saveYaml(path.join(dir, 'wallet'), wallet, { noRefs: true });
    return wallet;
  }
}

export default YamlEconomyDatastore;
```

NOTE: verify `ensureDir` exists in FileIO (it's imported by `YamlFinanceDatastore.mjs`). If FileIO's `saveYaml` already ensures the directory, keep `ensureDir` anyway — explicit is fine.

**Step 4: Verify pass** — same command → PASS.

**Step 5: Commit** — `git add backend/src/1_adapters/persistence/yaml/YamlEconomyDatastore.* && git commit -m "feat(economy): YAML ledger + wallet datastore"`

---

### Task 5: Application — EconomyService core (balance, deposit, earn with daily cap)

**Files:**
- Create: `backend/src/3_applications/economy/EconomyService.mjs`
- Create: `backend/src/3_applications/economy/EconomyService.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { EconomyService } from './EconomyService.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/econ-svc-test-user';
const ECONOMY_CONFIG = {
  currency: { name: 'coins' },
  earn: { 'piano-lesson-complete': { reward: 5, per: 'completion', daily_cap: 10 } },
  spend: { 'arcade-play': { cost: 2, per: '10min', self_serve: true, auth: 'identify', blackout: [] } },
  users: {},
};
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: () => USER_DIR,
  getHouseholdAppConfig: () => ECONOMY_CONFIG,
};
const clean = () => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} };
const makeService = () => new EconomyService({
  datastore: new YamlEconomyDatastore({ configService }),
  configService,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

beforeEach(clean);
afterEach(clean);

describe('EconomyService', () => {
  it('starts at zero balance', async () => {
    expect((await makeService().getBalance(USER)).balance).toBe(0);
  });
  it('deposit increases balance and writes a ledger entry + wallet snapshot', async () => {
    const svc = makeService();
    const res = await svc.deposit(USER, { amount: 25, note: 'allowance' });
    expect(res.balance).toBe(25);
    expect((await svc.getBalance(USER)).balance).toBe(25);
    const wallet = new YamlEconomyDatastore({ configService }).readWallet(USER);
    expect(wallet.balance).toBe(25);
  });
  it('earn applies the policy reward', async () => {
    const svc = makeService();
    const res = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    expect(res.earned).toBe(5);
    expect(res.balance).toBe(5);
  });
  it('earn enforces daily_cap (10) and reports capped earns', async () => {
    const svc = makeService();
    await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:1' });
    await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:2' });
    const third = await svc.earn(USER, { action: 'piano-lesson-complete', source: 'piano', ref: 'plex:3' });
    expect(third.earned).toBe(0);
    expect(third.capped).toBe(true);
    expect(third.balance).toBe(10);
  });
  it('rejects unknown earn actions and unknown users', async () => {
    const svc = makeService();
    await expect(svc.earn(USER, { action: 'nope', source: 'x' })).rejects.toThrow();
    await expect(svc.getBalance('nobody')).rejects.toThrow();
  });
  it('deposit validates amount is a positive integer', async () => {
    const svc = makeService();
    await expect(svc.deposit(USER, { amount: -5 })).rejects.toThrow();
    await expect(svc.deposit(USER, { amount: 2.5 })).rejects.toThrow();
  });
});
```

**Step 2: Verify fail.**

**Step 3: Implementation**

```js
// EconomyService.mjs
/**
 * Use cases for the household coin economy. Owns all balance math and policy
 * enforcement; the datastore is dumb storage; the router is a thin shell.
 * Balance is derived by folding the append-only ledger; wallet.yml is a cache.
 */
import { createTransaction, foldBalance, resolvePolicy, inBlackout, drainPerSecond } from '#domains/economy/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const STALE_SESSION_MS = 5 * 60 * 1000; // no settle for 5 min → session considered dead

export class EconomyService {
  #ds; #configService; #logger;

  constructor({ datastore, configService, logger = console }) {
    this.#ds = datastore;
    this.#configService = configService;
    this.#logger = logger;
  }

  #config() {
    return this.#configService.getHouseholdAppConfig?.(null, 'economy') || {};
  }

  #assertUser(userId) {
    if (!this.#configService.getUserProfile?.(userId)) {
      throw new EntityNotFoundError(`unknown user: ${userId}`);
    }
  }

  #snapshot(userId, session = undefined) {
    const balance = foldBalance(this.#ds.readAllTransactions(userId));
    const prev = this.#ds.readWallet(userId) || { session: null };
    const wallet = {
      balance,
      as_of: new Date().toISOString(),
      session: session === undefined ? (prev.session ?? null) : session,
    };
    this.#ds.writeWallet(userId, wallet);
    return wallet;
  }

  async getBalance(userId) {
    this.#assertUser(userId);
    const wallet = this.#reapStale(userId);
    return { userId, balance: wallet.balance, session: wallet.session };
  }

  async deposit(userId, { amount, note = null, source = 'admin' }) {
    this.#assertUser(userId);
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('deposit amount must be a positive integer');
    this.#ds.appendTransaction(userId, createTransaction({ kind: 'deposit', delta: amount, action: 'parent-deposit', source, ref: note }));
    const wallet = this.#snapshot(userId);
    this.#logger.info('economy-deposit', { userId, amount, balance: wallet.balance });
    return { userId, balance: wallet.balance };
  }

  async earn(userId, { action, source, ref = null }) {
    this.#assertUser(userId);
    const policy = resolvePolicy(this.#config(), userId, action);
    if (!policy || policy.type !== 'earn') throw new ValidationError(`unknown earn action: ${action}`);
    const reward = policy.reward || 0;
    const cap = policy.daily_cap ?? Infinity;
    const today = new Date().toISOString().slice(0, 10);
    const earnedToday = this.#ds.readLedgerDay(userId, today)
      .filter((t) => t.kind === 'earn' && t.action === action)
      .reduce((s, t) => s + t.delta, 0);
    const grant = Math.max(0, Math.min(reward, cap - earnedToday));
    if (grant > 0) {
      this.#ds.appendTransaction(userId, createTransaction({ kind: 'earn', delta: grant, action, source, ref }));
    }
    const wallet = this.#snapshot(userId);
    this.#logger.info('economy-earn', { userId, action, earned: grant, capped: grant < reward, balance: wallet.balance });
    return { userId, earned: grant, capped: grant < reward, balance: wallet.balance };
  }

  #reapStale(userId) {
    // Auto-close sessions that stopped settling (crash/power-loss). Costs the
    // kid nothing extra: consumed coins were already settled incrementally.
    const wallet = this.#ds.readWallet(userId) || this.#snapshot(userId);
    const s = wallet.session;
    if (s && Date.now() - Date.parse(s.last_settled_at || s.opened_at) > STALE_SESSION_MS) {
      this.#logger.warn('economy-session-stale-reaped', { userId, sessionId: s.id });
      return this.#snapshot(userId, null);
    }
    return this.#snapshot(userId); // refresh balance from ledger fold
  }
}

export default EconomyService;
```

NOTE: confirm `EntityNotFoundError` exists in `#domains/core/errors/index.mjs` (the recon saw it exported for gratitude). If it does not, use `ValidationError` and adjust tests.

**Step 4: Verify pass.**

**Step 5: Commit** — `git add backend/src/3_applications/economy/ && git commit -m "feat(economy): EconomyService — balance, deposit, earn with daily cap"`

---

### Task 6: Application — metered sessions (open / settle / close, blackout, stale reap)

**Files:**
- Modify: `backend/src/3_applications/economy/EconomyService.mjs`
- Modify: `backend/src/3_applications/economy/EconomyService.test.mjs`

**Step 1: Add failing tests** (append a `describe('metered sessions')` block)

```js
import { vi } from 'vitest'; // add to imports

describe('metered sessions', () => {
  it('openSession requires positive balance and no existing session', async () => {
    const svc = makeService();
    await expect(svc.openSession(USER, { action: 'arcade-play', source: 'emulator' })).rejects.toThrow(/balance/i);
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    expect(s.sessionId).toMatch(/^ses_/);
    expect(s.balance).toBe(10);
    expect(s.drainPerSecond).toBeCloseTo(2 / 600);
    await expect(svc.openSession(USER, { action: 'arcade-play', source: 'emulator' })).rejects.toThrow(/session/i);
  });
  it('openSession blocks during blackout windows', async () => {
    ECONOMY_CONFIG.spend['arcade-play'].blackout = ['00:00-23:59'];
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    await expect(svc.openSession(USER, { action: 'arcade-play', source: 'emulator' })).rejects.toThrow(/blackout/i);
    ECONOMY_CONFIG.spend['arcade-play'].blackout = [];
  });
  it('settle appends one spend txn and clamps to balance', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 5 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    const r1 = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 2 });
    expect(r1.balance).toBe(3);
    const r2 = await svc.settleSession(USER, { sessionId: s.sessionId, coins: 99 }); // over-report clamps
    expect(r2.balance).toBe(0);
    expect(r2.depleted).toBe(true);
  });
  it('closeSession settles the tail and clears the session', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    const r = await svc.closeSession(USER, { sessionId: s.sessionId, coins: 1 });
    expect(r.balance).toBe(9);
    expect((await svc.getBalance(USER)).session).toBeNull();
  });
  it('settle with zero coins is a no-op ledger-wise', async () => {
    const svc = makeService();
    await svc.deposit(USER, { amount: 10 });
    const s = await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
    await svc.settleSession(USER, { sessionId: s.sessionId, coins: 0 });
    const txns = new YamlEconomyDatastore({ configService }).readAllTransactions(USER);
    expect(txns.filter((t) => t.kind === 'spend')).toHaveLength(0);
  });
  it('stale session is reaped on next getBalance', async () => {
    vi.useFakeTimers();
    try {
      const svc = makeService();
      await svc.deposit(USER, { amount: 10 });
      await svc.openSession(USER, { action: 'arcade-play', source: 'emulator' });
      vi.advanceTimersByTime(6 * 60 * 1000);
      vi.setSystemTime(Date.now()); // keep ISO stamps coherent
      expect((await svc.getBalance(USER)).session).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
```

(If fake timers fight with `new Date()` inside `createTransaction`, prefer `vi.setSystemTime(new Date(Date.now() + 6*60*1000))` over `advanceTimersByTime` — the goal is just to make `last_settled_at` look old.)

**Step 2: Verify fail.**

**Step 3: Implement** (add to `EconomyService`; import `shortId` from `#domains/core/utils/id.mjs`)

```js
async openSession(userId, { action, source }) {
  this.#assertUser(userId);
  const policy = resolvePolicy(this.#config(), userId, action);
  if (!policy || policy.type !== 'spend') throw new ValidationError(`unknown spend action: ${action}`);
  if (inBlackout(policy.blackout)) throw new ValidationError(`${action} is in a blackout window`);
  const wallet = this.#reapStale(userId);
  if (wallet.session) throw new ValidationError(`user already has an open session: ${wallet.session.id}`);
  if (wallet.balance <= 0) throw new ValidationError('insufficient balance');
  const session = {
    id: `ses_${shortId()}`, action,
    opened_at: new Date().toISOString(),
    last_settled_at: new Date().toISOString(),
    settled_coins: 0,
  };
  this.#snapshot(userId, session);
  this.#logger.info('economy-session-open', { userId, action, sessionId: session.id, balance: wallet.balance });
  return { userId, sessionId: session.id, balance: wallet.balance, drainPerSecond: drainPerSecond(policy) };
}

async settleSession(userId, { sessionId, coins }) {
  this.#assertUser(userId);
  const wallet = this.#ds.readWallet(userId);
  const session = wallet?.session;
  if (!session || session.id !== sessionId) throw new ValidationError(`no open session ${sessionId}`);
  const spend = Math.min(Math.max(0, Math.floor(coins || 0)), wallet.balance);
  if (spend > 0) {
    this.#ds.appendTransaction(userId, createTransaction({ kind: 'spend', delta: -spend, action: session.action, source: 'economy-session', ref: sessionId }));
  }
  const updated = { ...session, last_settled_at: new Date().toISOString(), settled_coins: session.settled_coins + spend };
  const next = this.#snapshot(userId, updated);
  this.#logger.debug?.('economy-session-settle', { userId, sessionId, spend, balance: next.balance });
  return { userId, balance: next.balance, depleted: next.balance <= 0 };
}

async closeSession(userId, { sessionId, coins = 0 }) {
  const settled = await this.settleSession(userId, { sessionId, coins });
  const next = this.#snapshot(userId, null);
  this.#logger.info('economy-session-close', { userId, sessionId, balance: next.balance });
  return { userId, balance: settled.balance };
}
```

**Step 4: Verify pass** — full file: `npx vitest run backend/src/3_applications/economy/EconomyService.test.mjs`.

**Step 5: Commit** — `git commit -am "feat(economy): metered spend sessions — open/settle/close, blackout, stale reap"`

---

### Task 7: API router + composition + registration

**Files:**
- Create: `backend/src/4_api/v1/routers/economy.mjs`
- Create: `backend/src/4_api/v1/routers/economy.test.mjs`
- Create: `backend/src/5_composition/modules/economyApi.mjs`
- Modify: `backend/src/app.mjs` (two lines: import + `v1Routers.economy = ...` near the gratitude wiring ~l.1801)
- Modify: `backend/src/4_api/v1/routers/api.mjs` (routeMap: add `'/economy': 'economy'`)

**Routes (all JSON):**

| Method/Path | Body | Returns |
|---|---|---|
| GET `/users/:userId/wallet` | — | `{ userId, balance, session }` |
| POST `/users/:userId/deposit` | `{ amount, note? }` | `{ userId, balance }` |
| POST `/users/:userId/earn` | `{ action, source, ref? }` | `{ userId, earned, capped, balance }` |
| POST `/users/:userId/sessions` | `{ action, source }` | `{ userId, sessionId, balance, drainPerSecond }` |
| POST `/users/:userId/sessions/:sessionId/settle` | `{ coins }` | `{ userId, balance, depleted }` |
| POST `/users/:userId/sessions/:sessionId/close` | `{ coins? }` | `{ userId, balance }` |

**Step 1: Write the failing test** — supertest against a real express app (mirror `piano.preset.test.mjs` style):

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import express from 'express';
import request from 'supertest';
import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { EconomyService } from '#apps/economy/EconomyService.mjs';
import { createEconomyRouter } from './economy.mjs';

const USER = 'test-user';
const USER_DIR = '/tmp/econ-router-test-user';
const configService = {
  getUserProfile: (id) => (id === USER ? { id } : null),
  getUserDir: () => USER_DIR,
  getHouseholdAppConfig: () => ({
    earn: { 'piano-lesson-complete': { reward: 5, per: 'completion' } },
    spend: { 'arcade-play': { cost: 2, per: '10min', blackout: [] } },
  }),
};
const clean = () => { try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch {} };
const makeApp = () => {
  const economyService = new EconomyService({
    datastore: new YamlEconomyDatastore({ configService }),
    configService, logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/economy', createEconomyRouter({ economyService }));
  return app;
};

beforeEach(clean);
afterEach(clean);

describe('economy router', () => {
  it('wallet starts empty; deposit then earn then metered session round-trip', async () => {
    const app = makeApp();
    expect((await request(app).get(`/api/v1/economy/users/${USER}/wallet`)).body.balance).toBe(0);
    await request(app).post(`/api/v1/economy/users/${USER}/deposit`).send({ amount: 10 }).expect(200);
    const earn = await request(app).post(`/api/v1/economy/users/${USER}/earn`).send({ action: 'piano-lesson-complete', source: 'piano' });
    expect(earn.body.balance).toBe(15);
    const open = await request(app).post(`/api/v1/economy/users/${USER}/sessions`).send({ action: 'arcade-play', source: 'emulator' });
    expect(open.body.sessionId).toMatch(/^ses_/);
    const settle = await request(app).post(`/api/v1/economy/users/${USER}/sessions/${open.body.sessionId}/settle`).send({ coins: 3 });
    expect(settle.body.balance).toBe(12);
    await request(app).post(`/api/v1/economy/users/${USER}/sessions/${open.body.sessionId}/close`).send({ coins: 1 }).expect(200);
    expect((await request(app).get(`/api/v1/economy/users/${USER}/wallet`)).body.session).toBeNull();
  });
  it('maps domain errors to non-200s', async () => {
    const app = makeApp();
    const res = await request(app).post(`/api/v1/economy/users/${USER}/sessions`).send({ action: 'arcade-play', source: 'emulator' });
    expect(res.status).toBeGreaterThanOrEqual(400); // insufficient balance
    const unknown = await request(app).get('/api/v1/economy/users/nobody/wallet');
    expect(unknown.status).toBeGreaterThanOrEqual(400);
  });
});
```

**Step 2: Verify fail.**

**Step 3: Implement router** (follow `piano.mjs` structure exactly):

```js
// economy.mjs
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

export function createEconomyRouter({ economyService, logger = console }) {
  if (!economyService) throw new Error('createEconomyRouter requires economyService');
  const router = express.Router();

  router.get('/users/:userId/wallet', asyncHandler(async (req, res) => {
    res.json(await economyService.getBalance(req.params.userId));
  }));
  router.post('/users/:userId/deposit', asyncHandler(async (req, res) => {
    res.json(await economyService.deposit(req.params.userId, req.body || {}));
  }));
  router.post('/users/:userId/earn', asyncHandler(async (req, res) => {
    res.json(await economyService.earn(req.params.userId, req.body || {}));
  }));
  router.post('/users/:userId/sessions', asyncHandler(async (req, res) => {
    res.json(await economyService.openSession(req.params.userId, req.body || {}));
  }));
  router.post('/users/:userId/sessions/:sessionId/settle', asyncHandler(async (req, res) => {
    res.json(await economyService.settleSession(req.params.userId, { sessionId: req.params.sessionId, coins: req.body?.coins }));
  }));
  router.post('/users/:userId/sessions/:sessionId/close', asyncHandler(async (req, res) => {
    res.json(await economyService.closeSession(req.params.userId, { sessionId: req.params.sessionId, coins: req.body?.coins ?? 0 }));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}
export default createEconomyRouter;
```

Check how `errorHandlerMiddleware` maps `ValidationError`/`EntityNotFoundError` to status codes (read `#system/http/middleware`). If domain errors surface as 500s, that still satisfies the `>= 400` test — but prefer proper 400/404 mapping if the middleware supports it.

**Composition module** (`5_composition/modules/economyApi.mjs`, mirror `gratitudeApi.mjs`):

```js
import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { EconomyService } from '#apps/economy/EconomyService.mjs';
import { createEconomyRouter } from '#api/v1/routers/economy.mjs';

export function createEconomyApi({ configService, logger = console }) {
  const economyService = new EconomyService({
    datastore: new YamlEconomyDatastore({ configService }),
    configService, logger,
  });
  return { economyService, router: createEconomyRouter({ economyService, logger }) };
}
```

(Read `gratitudeApi.mjs` first and match its exact export shape/name style — if it returns just the router, do the same and expose the service separately for Task 8's piano wiring.)

**app.mjs wiring** — next to the gratitude lines (~l.80 import, ~l.1801 wiring):

```js
import { createEconomyApi } from '#composition/modules/economyApi.mjs';
// ... where v1Routers are assembled:
const economyApi = createEconomyApi({ configService, logger });
v1Routers.economy = economyApi.router;
```

**api.mjs** — in `routeMap`: `'/economy': 'economy',`

**Step 4: Verify pass** — router test file passes; then boot check: `node -e "import('./backend/src/app.mjs')"` is NOT a valid smoke test here (app.mjs starts servers) — instead run the existing backend jest suite briefly if cheap, or rely on Task 10's live verification.

**Step 5: Commit** — `git add -A backend/src && git commit -m "feat(economy): API router, composition module, registration"`

---

### Task 8: Piano earn hook — lesson completion pays out

**Files:**
- Modify: `backend/src/3_applications/piano/UserVideoProgressStore.mjs` (record() returns `newlyCompleted`)
- Modify: `backend/src/3_applications/piano/UserVideoProgressStore.test.mjs` (extend)
- Modify: the call site of `record(` (find it: `grep -rn "\.record(" backend/src/4_api/v1/routers/piano.mjs backend/src` — it's the video-progress PUT route) and `app.mjs`/PianoContainer wiring to pass `economyService` through.

**Design:** `record()` already stamps `completedAt` sticky-once (lines ~58–61). Add a `newlyCompleted: true` flag on the returned entry exactly when `completedAt` transitions null→value in this call. The **router call site** (not the store) then fires `economyService.earn(userId, { action: 'piano-lesson-complete', source: 'piano', ref: plexId })` fire-and-forget with `.catch(err => logger.warn(...))` — an economy outage must never break progress recording. Inject `economyService` as an **optional** dependency (default `null` → skip earn) wherever the piano router/container is built in `app.mjs`.

**Step 1: Failing tests**

a) Store: `record()` returns `newlyCompleted: true` on the call that first stamps completion, and `newlyCompleted: false` on subsequent calls / non-completing calls.

b) Router (extend the existing piano router test or add `piano.economyHook.test.mjs`): build the piano app with a stub `economyService = { earn: vi.fn().mockResolvedValue({}) }`, PUT a progress update that crosses the completion threshold with `engaged: true`, assert `earn` called once with `{ action: 'piano-lesson-complete', source: 'piano', ref: <plexId> }`; PUT again, assert still called only once; build without `economyService`, assert route still 200s.

**Step 2: Verify fail.**

**Step 3: Implement.** In `UserVideoProgressStore.record()`: capture `const wasCompleted = !!existing.completedAt;` before the merge, and include `newlyCompleted: !wasCompleted && !!completedAt` in the returned entry (do NOT persist the flag into the YAML — strip it from the saved object, return-value only). In the router handler, after a successful record: `if (economyService && result?.newlyCompleted) economyService.earn(...).catch(...)`. Thread `economyService` from `app.mjs` (Task 7 exposes it from `createEconomyApi`) into the piano router factory options (`createPianoRouter({ pianoContainer, economyService, logger })`) or PianoContainer — match whichever is less invasive after reading the actual wiring.

**Step 4: Verify pass** — run both modified test files, plus the full existing piano test set: `npx vitest run backend/src/3_applications/piano backend/src/4_api/v1/routers` (no regressions).

**Step 5: Commit** — `git commit -am "feat(economy): piano lesson completion pays out coins (fire-and-forget earn hook)"`

---

### Task 9: Frontend — coin-metered gate for EmulatorGame

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/EmulatorGame/coinMeteredGate.js`
- Create: `frontend/src/modules/Fitness/widgets/EmulatorGame/coinMeteredGate.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/fitnessGameGate.js`
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/fitnessGameGate.test.js`

**Current state:** `fitnessGameGate.js` is 16 lines returning `createOpenGate()` (governance disabled). `EmulatorConsole` consumes the gate as `{ isPlayable(), getStatus() → { state }, onChange(cb) → unsub }` with states `playing | warning | paused | depleted` (depleted message at `EmulatorConsole.jsx:100`).

**Gate contract to implement** (`createCoinMeteredGate({ userId, action = 'arcade-play', api, settleIntervalSec = 60 })` — `api` injected for testability, defaults to real `DaylightAPI` calls):

- `start()` → `POST api/v1/economy/users/{userId}/sessions {action, source:'emulator'}`. On success: state `playing`, begin 1s local drain tick (`remaining -= drainPerSecond`) and the settle timer. On failure (blackout / broke / open session elsewhere): state `depleted`, expose `reason`.
- Every `settleIntervalSec` and on `stop()`: send accumulated **whole** coins consumed (`Math.floor`), carry the fraction. Reconcile local `remaining` with the server's returned `balance` (server wins; server balance is whole coins — local view = server balance minus unsettled fraction).
- Local `remaining <= 0` → state `depleted`, stop the drain, `stop()` (close session).
- `getStatus()` → `{ state, coins: Math.max(0, Math.floor(remaining)), secondsLeft }` — extra fields are safe; EmulatorConsole only reads `.state`, the widget overlay reads `coins`.
- `stop()` idempotent; `close` uses the final unsent coins. All transitions notify `onChange` subscribers.
- Structured logging: `logger().info('coin-gate-open'| 'coin-gate-depleted' | ...)` via the lazy module-logger pattern.

**Step 1: Failing tests** — vitest + `vi.useFakeTimers()`, injected fake `api` recording calls:

```js
// core cases:
// - start() opens a session and state becomes 'playing' with coins = server balance
// - advancing 60s of fake time triggers exactly one settle with floor(drain*60) coins
// - remaining hits 0 → state 'depleted', close called, drain stops
// - start() rejection (e.g. blackout) → state 'depleted' immediately, reason surfaced, no timers left
// - stop() settles the tail and is idempotent
// - onChange fires on every state change and unsubscribe works
```

**Step 2: Verify fail. Step 3: Implement.** Keep it a plain JS module (no React) so fake timers stay simple.

**Step 4:** Rewrite `buildFitnessGameGate({ getActivePlayerId, economyEnabled, ... })`: if `economyEnabled` is falsy or no active player id → return the current open gate (unchanged legacy behavior, preserving the existing 2 tests); else return `createCoinMeteredGate({ userId: getActivePlayerId(), ... })`. Update `fitnessGameGate.test.js`: keep the open-gate default tests, add the economy branch.

**Step 5: Verify** — `npx vitest run frontend/src/modules/Fitness/widgets/EmulatorGame/` all green.

**Step 6: Commit** — `git commit -am "feat(economy): coin-metered gate for EmulatorGame (hold-and-settle client)"`

---

### Task 10: Frontend — wire gate into widget + coins overlay + depleted copy

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.jsx` (~l.152 `buildLaunchContext`, gate passed at ~l.320)
- Modify: `frontend/src/modules/Emulator/EmulatorConsole.jsx` (l.100 depleted copy; verify overlay prop name at its signature ~l.108)
- Modify: `frontend/src/modules/Fitness/widgets/EmulatorGame/EmulatorGameWidget.test.jsx`

**Steps:**
1. **Failing test:** widget test asserting that when economy config is enabled and an active player exists, the built gate is the coin gate (spy on `buildFitnessGameGate` args / gate mode) and that gate `start()` is invoked on launch and `stop()` on close/unmount. Also: overlay data receives `session.coins` from gate status.
2. Wire: in `buildLaunchContext`, pass `getActivePlayerId` + an `economyEnabled` flag (read from widget `config` prop — the widget already receives `config`; enable via the fitness menu config entry for this widget, default OFF so nothing changes for existing installs until config turns it on). Call `gate.start()` when the console launches, `gate.stop()` in the existing close/unmount path.
3. Overlay: subscribe to the gate and feed `'session.coins': status.coins` into the overlay data bag that `EmulatorConsole` reads at l.230 (`overlayDataProp['session.coins'] ?? '—'`) — find the exact prop the widget passes (grep `session.coins` / `overlayData` in the widget) and thread it.
4. Copy tweak: `EmulatorConsole.jsx:100` — change `'Out of credit — earn more!'` to `'Out of coins — earn more!'` (check for existing tests asserting the old string: `grep -rn "Out of credit" frontend/` and update them).
5. Spend authorization (design: `auth: identify`): the widget already runs an identity ceremony (`useIdentity()` → `registerIdentify`, `unlockedUser`). Gate the coin session behind it: only pass `economyEnabled: true` into the gate build when `unlockedUser` matches the active player (or trigger `registerIdentify('Spend coins')` on launch when policy demands). Keep this minimal — reuse the existing ceremony, no new UI.
6. Verify: `npx vitest run frontend/src/modules/Fitness/widgets/EmulatorGame/ frontend/src/modules/Emulator/` green.
7. Commit: `git commit -am "feat(economy): EmulatorGame spends coins — wired gate, coins overlay, identify-gated"`

---

### Task 11: Config + live smoke test

**Files:**
- Create: `docs/reference/economy/economy.md` — reference doc: currency model, data layout, policy schema (copy the schema from the design doc), API routes table, the config-cache-restart gotcha, curl examples for deposit.
- Create: example config committed as `data/household/config/economy.yml` **in the repo checkout** (the repo's `data/` is a stub tree — this is the documented example; the LIVE file must be created in the real data dir).

**Example config:**

```yaml
currency:
  name: coins
  cashout_rate: 0.10
earn:
  piano-lesson-complete:
    reward: 5
    per: completion
    daily_cap: 20
spend:
  arcade-play:
    cost: 2
    per: 10min
    self_serve: true
    auth: identify
    blackout: ["22:00-07:00"]
users: {}
```

**Live smoke (dev, this machine):**
1. Copy the example to the real data dir: `"$DAYLIGHT_BASE_PATH/data/household/config/economy.yml"` (base path from `.env`; the CLAUDE.local mount note about SSH applies to prod only — local Dropbox dir is writable).
2. Restart the dev backend (config is cached at startup — see CLAUDE.md; check `lsof -i :3111` first per repo rules; `npm run dev` if not running).
3. Smoke with curl against the backend port from `.claude/settings.local.json` (`env.ports.backend`, 3112 on kckern-macbook — Vite proxies `/api/*` but direct backend works too):

```bash
BASE=http://localhost:3112/api/v1/economy
curl -s $BASE/users/kckern/wallet                                  # { balance: 0, session: null }
curl -s -X POST $BASE/users/kckern/deposit -H 'Content-Type: application/json' -d '{"amount": 10}'
curl -s -X POST $BASE/users/kckern/earn -H 'Content-Type: application/json' -d '{"action":"piano-lesson-complete","source":"piano","ref":"smoke"}'
curl -s $BASE/users/kckern/wallet                                  # { balance: 15 }
# session round-trip
SID=$(curl -s -X POST $BASE/users/kckern/sessions -d '{"action":"arcade-play","source":"emulator"}' -H 'Content-Type: application/json' | node -pe 'JSON.parse(require("fs").readFileSync(0)).sessionId')
curl -s -X POST $BASE/users/kckern/sessions/$SID/settle -d '{"coins":2}' -H 'Content-Type: application/json'
curl -s -X POST $BASE/users/kckern/sessions/$SID/close  -d '{"coins":0}' -H 'Content-Type: application/json'
```
4. Inspect the ledger on disk: `cat "$DAYLIGHT_BASE_PATH/data/users/kckern/apps/economy/ledger/$(date +%F).yml"` — verify entries; verify `wallet.yml` balance matches the fold.
5. **Clean up smoke data** (delete the test ledger/wallet for kckern or leave a note) — smoke coins are not real coins.

**Commit:** `git add docs/reference/economy data/household/config/economy.yml && git commit -m "docs(economy): reference doc + example policy config"`

---

### Task 12: Full gates + docs index + finish

**Steps:**
1. Full vitest gate: `npm run test:unit:vitest` — expect no NEW failing files beyond the 3 recorded in the baseline note above.
2. Backend jest suite (if it covers touched areas): `cd backend && npm test` — compare against a pre-change run if unsure which failures are pre-existing.
3. Update `CLAUDE.md` navigation table: add `| Household economy (coins) | docs/reference/economy/economy.md |`.
4. Update the design doc status header to "Phase 1 implemented on feature/household-economy".
5. Run the repo verify skill (`/verify`) — drive the real flow: dev server up, deposit via curl, open the fitness emulator widget with economy enabled, watch coins drain, hit depleted, confirm ledger entries. UI visual check: per the screenshots-over-code-agents feedback, ask KC for a quick look at the kiosk overlay OR use the chart-screenshot harness pattern if applicable.
6. Commit any doc updates: `git commit -am "docs(economy): navigation + status updates"`.
7. **STOP — do not merge.** Use superpowers:finishing-a-development-branch: present merge/PR options to KC. Merging to main and any deploy are gated on KC's review (repo commit policy). Remind: live `economy.yml` must exist in the prod data dir + container restart before this works in prod.

---

## Explicitly OUT of scope (Phase 2+, do not build now)

- TV / screen-framework coin governance (Phase 2)
- Cash-out + parent-mobile async approval (Phase 2)
- PIN entry, NFC tokens, biometric auth (Phase 2/3)
- Fitness-coins → coins exchange (Phase 3)
- Parent dashboard / ledger history UI (Phase 3)
- Deposit admin UI — Phase 1 deposits are via curl/API only
- Allowance automation, interest, savings goals (Phase 4 / YAGNI)
