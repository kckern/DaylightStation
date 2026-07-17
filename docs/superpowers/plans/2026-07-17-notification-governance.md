# Notification Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the notification pipeline from re-sending the same nudge within a cooldown window and silence non-critical notifications during a household quiet-hours window — enforced once, app-wide, at `NotificationService.send()` — with a parent-facing SYSTEM › Notifications Admin page to configure it and watch sent-vs-suppressed events.

**Architecture:** A pure domain decision (`NotificationPolicy` + `QuietHours`) is consulted inside the existing shared `NotificationService.send()` choke point; per-user cooldown state and a bounded recent-events log persist in a `YamlNotificationLedgerStore`; household `notifications.yml` holds the quiet-hours window and per-category cooldowns; the governance deps are additive (absent → service behaves exactly as today) and degrade open (any governance error logs a warn and allows the send). An Admin sub-router + React page expose config + the ledger.

**Tech Stack:** Node ESM backend (DDD layers under `backend/src/`), Express 5 admin sub-routers, YAML persistence via `#system/utils/FileIO.mjs`; React 18 + Mantine 7 Admin frontend; Vitest for both (`tests/isolated/**/*.test.mjs` backend with `#domains/#apps/#adapters/#api` aliases + supertest; co-located `*.test.jsx` frontend).

## Global Constraints

- **Valid notification categories** (exact, from `NotificationCategory`): `ceremony`, `drift_alert`, `goal_update`, `system`. Cooldown config keys are these categories plus `default`. Do NOT use `drift` — the category is `drift_alert`.
- **Valid urgencies** (from `NotificationUrgency`): `low`, `normal`, `high`, `critical`. `critical` bypasses quiet hours; cooldown applies to all urgencies including `critical`.
- **Degrade open:** any throw from the config loader or ledger store inside `send()` is caught, logged `warn` (`notification.governance.degraded`), and treated as send-allowed. Governance must NEVER block a real notification.
- **Additive / back-compatible:** if `policy`/`ledgerStore` are not injected, `send()` behaves exactly as today. Existing `NotificationService` tests must stay green untouched.
- **`now` is a single household-local `Date`** — the container runs `TZ=America/Los_Angeles`, so `new Date()` is already household-local. `evaluate` uses `now.getTime()` for cooldown and `now`'s hour/minute for quiet hours.
- **Suppress, do not defer** (YAGNI): a suppressed non-critical notification during quiet hours is dropped, not queued for replay.
- **Household config accessor gotcha:** read `notifications.yml` via `configService.getHouseholdAppConfig(null, 'notifications')` — NEVER `getAppConfig` (returns null).
- **New v1 admin endpoints go on the existing admin router** (`admin/index.mjs` composes sub-routers via `router.use('/x', …)`); do NOT add a top-level `api.mjs` routeMap entry — `/admin` already maps to the admin router.
- Test runner: single file → `npx vitest run <path>`. Backend isolated tests must not add a NEW `node scripts/gate-vitest.mjs` failure (the repo has ~4 pre-existing unrelated ones).
- One commit per task; messages `feat(notification): …` / `feat(admin): …`, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Deploy discipline (`CLAUDE.local.md`): building/deploying allowed, but never redeploy during an active fitness session or a playing Player video; check the gate before `sudo deploy-daylight`.

---

## File Structure

**New (backend):**
- `backend/src/2_domains/notification/value-objects/QuietHours.mjs` — overnight-aware window membership.
- `backend/src/2_domains/notification/services/NotificationPolicy.mjs` — pure send/suppress decision.
- `backend/src/1_adapters/persistence/yaml/YamlNotificationLedgerStore.mjs` — per-user cooldown map + bounded events log.
- `backend/src/3_applications/notification/NotificationConfigService.mjs` — read/validate/write `notifications.yml` + reload.
- `backend/src/4_api/v1/routers/admin/notifications.mjs` — admin sub-router (config GET/PUT + ledger GET).

**Modified (backend):**
- `backend/src/2_domains/notification/entities/NotificationIntent.mjs` — add optional `dedupeKey`.
- `backend/src/3_applications/notification/NotificationService.mjs` — governance injection + decision flow.
- `backend/src/5_composition/modules/notifications.mjs` — construct + wire policy/ledger/configLoader.
- `backend/src/3_applications/lifeplan/services/CeremonyScheduler.mjs` — set `dedupeKey` on nudge intents.
- `backend/src/3_applications/agents/lifeplan-guide/tools/NotificationToolFactory.mjs` — set `dedupeKey` on the `send_action_message` intent (CadenceCheck's path).
- `backend/src/4_api/v1/routers/admin/index.mjs` — mount the notifications sub-router.
- `backend/src/app.mjs:2942` — inject `notificationConfigService` + `notificationLedgerStore` into `createAdminRouter`.

**New (frontend):**
- `frontend/src/modules/Admin/Notifications/NotificationsIndex.jsx` (+ `.test.jsx`).

**Modified (frontend):**
- `frontend/src/modules/Admin/AdminNav.jsx` — SYSTEM nav item.
- the Admin router (wherever `/admin/system/*` routes are declared) — route for `/admin/system/notifications`.

**New (config/data):**
- `data/household/config/notifications.yml` (seed) — created via `docker exec` heredoc, not committed.

---

## Task 1: QuietHours value object

**Files:**
- Create: `backend/src/2_domains/notification/value-objects/QuietHours.mjs`
- Test: `tests/isolated/domain/notification/quiet-hours.test.mjs`

**Interfaces:**
- Produces: `new QuietHours({ enabled, start, end })` (start/end are `"HH:MM"`); `isWithin(now: Date) → boolean`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/notification/quiet-hours.test.mjs
import { describe, it, expect } from 'vitest';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';

const at = (h, m = 0) => { const d = new Date(2026, 6, 17, h, m, 0); return d; };

describe('QuietHours.isWithin', () => {
  it('is never within when disabled', () => {
    expect(new QuietHours({ enabled: false, start: '21:00', end: '07:00' }).isWithin(at(23))).toBe(false);
  });
  it('handles an overnight window (21:00 -> 07:00)', () => {
    const q = new QuietHours({ enabled: true, start: '21:00', end: '07:00' });
    expect(q.isWithin(at(23))).toBe(true);   // late night
    expect(q.isWithin(at(3))).toBe(true);    // early morning
    expect(q.isWithin(at(12))).toBe(false);  // midday
    expect(q.isWithin(at(7))).toBe(false);   // end is exclusive
    expect(q.isWithin(at(21))).toBe(true);   // start is inclusive
  });
  it('handles a same-day window (13:00 -> 14:00)', () => {
    const q = new QuietHours({ enabled: true, start: '13:00', end: '14:00' });
    expect(q.isWithin(at(13, 30))).toBe(true);
    expect(q.isWithin(at(12, 59))).toBe(false);
  });
  it('treats a degenerate start===end window as never within', () => {
    expect(new QuietHours({ enabled: true, start: '09:00', end: '09:00' }).isWithin(at(9))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/domain/notification/quiet-hours.test.mjs`
Expected: FAIL — cannot resolve `#domains/notification/value-objects/QuietHours.mjs`.

- [ ] **Step 3: Write the value object**

```javascript
// backend/src/2_domains/notification/value-objects/QuietHours.mjs
/**
 * Household quiet-hours window. Times are "HH:MM" in household-local time.
 * `isWithin` correctly spans midnight for overnight windows (e.g. 21:00 -> 07:00).
 * Start is inclusive, end is exclusive. A degenerate start===end window is never within.
 */
export class QuietHours {
  constructor({ enabled = false, start = '21:00', end = '07:00' } = {}) {
    this.enabled = !!enabled;
    this.start = start;
    this.end = end;
  }

  #toMinutes(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }

  isWithin(now) {
    if (!this.enabled) return false;
    const mins = now.getHours() * 60 + now.getMinutes();
    const s = this.#toMinutes(this.start);
    const e = this.#toMinutes(this.end);
    if (s === e) return false;                 // degenerate: no window
    if (s < e) return mins >= s && mins < e;   // same-day window
    return mins >= s || mins < e;              // overnight window
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/domain/notification/quiet-hours.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/notification/value-objects/QuietHours.mjs tests/isolated/domain/notification/quiet-hours.test.mjs
git commit -m "feat(notification): QuietHours value object (overnight-aware window)"
```

---

## Task 2: NotificationPolicy (pure decision)

**Files:**
- Create: `backend/src/2_domains/notification/services/NotificationPolicy.mjs`
- Test: `tests/isolated/domain/notification/notification-policy.test.mjs`

**Interfaces:**
- Consumes: `QuietHours` (Task 1).
- Produces: `new NotificationPolicy()`; `evaluate({ intent, lastSentAt, now, quietHours, cooldownMs }) → { send: boolean, reason: 'ok' | 'cooldown' | 'quiet_hours' }`. `intent` is any object with `.urgency`; `lastSentAt` is epoch ms or null; `now` is a `Date`; `quietHours` is a `QuietHours` or null; `cooldownMs` is a number.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/notification/notification-policy.test.mjs
import { describe, it, expect } from 'vitest';
import { NotificationPolicy } from '#domains/notification/services/NotificationPolicy.mjs';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';

const policy = new NotificationPolicy();
const at = (h) => new Date(2026, 6, 17, h, 0, 0);
const quiet = new QuietHours({ enabled: true, start: '21:00', end: '07:00' });
const HOUR = 3600_000;

describe('NotificationPolicy.evaluate', () => {
  it('sends when no prior send and outside quiet hours', () => {
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: null, now: at(12), quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: true, reason: 'ok' });
  });
  it('suppresses within the cooldown window', () => {
    const now = at(12);
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: now.getTime() - 10 * 60_000, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'cooldown' });
  });
  it('sends once the cooldown has elapsed', () => {
    const now = at(12);
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: now.getTime() - 2 * HOUR, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: true, reason: 'ok' });
  });
  it('suppresses a non-critical notification during quiet hours', () => {
    expect(policy.evaluate({ intent: { urgency: 'high' }, lastSentAt: null, now: at(23), quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'quiet_hours' });
  });
  it('lets a critical notification through quiet hours (but still respects cooldown)', () => {
    expect(policy.evaluate({ intent: { urgency: 'critical' }, lastSentAt: null, now: at(23), quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: true, reason: 'ok' });
    const now = at(23);
    expect(policy.evaluate({ intent: { urgency: 'critical' }, lastSentAt: now.getTime() - 60_000, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'cooldown' });
  });
  it('quiet-hours reason wins over an also-active cooldown', () => {
    const now = at(23);
    expect(policy.evaluate({ intent: { urgency: 'normal' }, lastSentAt: now.getTime() - 60_000, now, quietHours: quiet, cooldownMs: HOUR }))
      .toEqual({ send: false, reason: 'quiet_hours' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/domain/notification/notification-policy.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the policy**

```javascript
// backend/src/2_domains/notification/services/NotificationPolicy.mjs
/**
 * Pure send/suppress decision for a notification intent. No I/O, no clock read —
 * everything (lastSentAt, now, quietHours, cooldownMs) is passed in.
 */
export class NotificationPolicy {
  evaluate({ intent, lastSentAt, now, quietHours, cooldownMs }) {
    if (quietHours && quietHours.isWithin(now) && intent.urgency !== 'critical') {
      return { send: false, reason: 'quiet_hours' };
    }
    if (lastSentAt && (now.getTime() - lastSentAt) < cooldownMs) {
      return { send: false, reason: 'cooldown' };
    }
    return { send: true, reason: 'ok' };
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/domain/notification/notification-policy.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/notification/services/NotificationPolicy.mjs tests/isolated/domain/notification/notification-policy.test.mjs
git commit -m "feat(notification): pure NotificationPolicy (quiet-hours + cooldown decision)"
```

---

## Task 3: YamlNotificationLedgerStore

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlNotificationLedgerStore.mjs`
- Test: `tests/isolated/adapters/notification-ledger-store.test.mjs`

**Interfaces:**
- Produces: `new YamlNotificationLedgerStore({ basePath })` (writes `<basePath>/notification-ledger.yml`); methods:
  - `getLastSent(username, dedupeKey) → number | null`
  - `recordSent({ username, dedupeKey, category, atMs })`
  - `recordSuppressed({ username, dedupeKey, category, reason, atMs })`
  - `recentEvents(limit = 50) → Array<{ at, username, category, dedupeKey, delivered, suppressed, reason }>` (newest first).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapters/notification-ledger-store.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlNotificationLedgerStore } from '#adapters/persistence/yaml/YamlNotificationLedgerStore.mjs';

let dir, store;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'ledger-')); store = new YamlNotificationLedgerStore({ basePath: dir }); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('YamlNotificationLedgerStore', () => {
  it('round-trips lastSent', () => {
    expect(store.getLastSent('kckern', 'ceremony:x')).toBeNull();
    store.recordSent({ username: 'kckern', dedupeKey: 'ceremony:x', category: 'ceremony', atMs: 1000 });
    expect(store.getLastSent('kckern', 'ceremony:x')).toBe(1000);
  });
  it('recordSuppressed does NOT move lastSent', () => {
    store.recordSent({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', atMs: 1000 });
    store.recordSuppressed({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', reason: 'cooldown', atMs: 2000 });
    expect(store.getLastSent('kckern', 'k')).toBe(1000);
  });
  it('recentEvents returns newest-first and includes both kinds', () => {
    store.recordSent({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', atMs: 1000 });
    store.recordSuppressed({ username: 'kckern', dedupeKey: 'k', category: 'ceremony', reason: 'cooldown', atMs: 2000 });
    const ev = store.recentEvents(10);
    expect(ev[0]).toMatchObject({ at: 2000, suppressed: true, reason: 'cooldown' });
    expect(ev[1]).toMatchObject({ at: 1000, delivered: true, reason: 'ok' });
  });
  it('bounds the events log', () => {
    for (let i = 0; i < 250; i++) store.recordSent({ username: 'u', dedupeKey: 'k', category: 'system', atMs: i });
    expect(store.recentEvents(1000).length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/adapters/notification-ledger-store.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the store** (mirrors `YamlLifeplanMetricsStore` — same `FileIO` helpers)

```javascript
// backend/src/1_adapters/persistence/yaml/YamlNotificationLedgerStore.mjs
import path from 'path';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

const MAX_EVENTS = 200;

/**
 * Persists notification governance state in a single household file:
 *   { cooldowns: { "<username>|<dedupeKey>": <lastSentMs> }, events: [ ...bounded log ] }
 * The cooldown map drives dedupe; the events log feeds the Admin "recent activity" view.
 */
export class YamlNotificationLedgerStore {
  #basePath;
  constructor({ basePath }) { this.#basePath = basePath; }

  #file() { return path.join(this.#basePath, 'notification-ledger.yml'); }
  #key(username, dedupeKey) { return `${username || '-'}|${dedupeKey}`; }

  #load() {
    const d = loadYamlSafe(this.#file());
    return {
      cooldowns: (d && typeof d.cooldowns === 'object' && d.cooldowns) || {},
      events: (d && Array.isArray(d.events) && d.events) || [],
    };
  }
  #save(d) {
    if (d.events.length > MAX_EVENTS) d.events = d.events.slice(-MAX_EVENTS);
    saveYaml(this.#file(), d);
  }

  getLastSent(username, dedupeKey) {
    const v = this.#load().cooldowns[this.#key(username, dedupeKey)];
    return typeof v === 'number' ? v : null;
  }

  recordSent({ username, dedupeKey, category, atMs }) {
    const d = this.#load();
    d.cooldowns[this.#key(username, dedupeKey)] = atMs;
    d.events.push({ at: atMs, username: username || null, category, dedupeKey, delivered: true, suppressed: false, reason: 'ok' });
    this.#save(d);
  }

  recordSuppressed({ username, dedupeKey, category, reason, atMs }) {
    const d = this.#load();
    d.events.push({ at: atMs, username: username || null, category, dedupeKey, delivered: false, suppressed: true, reason });
    this.#save(d);
  }

  recentEvents(limit = 50) {
    const events = this.#load().events;
    return events.slice(-limit).reverse();
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/adapters/notification-ledger-store.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlNotificationLedgerStore.mjs tests/isolated/adapters/notification-ledger-store.test.mjs
git commit -m "feat(notification): YamlNotificationLedgerStore (cooldown map + bounded events)"
```

---

## Task 4: NotificationIntent.dedupeKey

**Files:**
- Modify: `backend/src/2_domains/notification/entities/NotificationIntent.mjs`
- Test: `tests/isolated/domain/notification/notification-intent-dedupe.test.mjs`

**Interfaces:**
- Produces: `NotificationIntent` now accepts an optional `dedupeKey` (string) and echoes it in `toJSON()`. Absent → `undefined`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/notification/notification-intent-dedupe.test.mjs
import { describe, it, expect } from 'vitest';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

describe('NotificationIntent.dedupeKey', () => {
  it('stores and serializes an explicit dedupeKey', () => {
    const i = new NotificationIntent({ title: 'x', body: 'y', category: 'ceremony', urgency: 'normal', dedupeKey: 'ceremony:unit_intention:2026-07-17' });
    expect(i.dedupeKey).toBe('ceremony:unit_intention:2026-07-17');
    expect(i.toJSON().dedupeKey).toBe('ceremony:unit_intention:2026-07-17');
  });
  it('is undefined when not provided (back-compatible)', () => {
    const i = new NotificationIntent({ title: 'x', body: 'y', category: 'system', urgency: 'normal' });
    expect(i.dedupeKey).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/domain/notification/notification-intent-dedupe.test.mjs`
Expected: FAIL — `dedupeKey` is undefined even when passed.

- [ ] **Step 3: Add the field**

In `NotificationIntent.mjs`, change the constructor destructure to include `dedupeKey` and assign it, and add it to `toJSON()`:

```javascript
  constructor({ title, body, category, urgency, actions = [], metadata = {}, dedupeKey } = {}) {
    // …existing category/urgency validation unchanged…
    this.title = title;
    this.body = body;
    this.category = category;
    this.urgency = urgency;
    this.actions = actions;
    this.metadata = metadata;
    this.dedupeKey = dedupeKey;
    this.createdAt = new Date().toISOString();
  }
```

and in `toJSON()` add `dedupeKey: this.dedupeKey,` before `createdAt`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/domain/notification/notification-intent-dedupe.test.mjs`
Expected: PASS. Then regression: `npx vitest run tests/isolated/domain/notification` (all notification domain tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/notification/entities/NotificationIntent.mjs tests/isolated/domain/notification/notification-intent-dedupe.test.mjs
git commit -m "feat(notification): optional dedupeKey on NotificationIntent"
```

---

## Task 5: NotificationService governance integration

**Files:**
- Modify: `backend/src/3_applications/notification/NotificationService.mjs`
- Test: `tests/isolated/notification/notification-service-governance.test.mjs`

**Interfaces:**
- Consumes: `NotificationPolicy.evaluate` (Task 2), the ledger store methods (Task 3), `NotificationIntent.dedupeKey` (Task 4).
- Produces: `NotificationService` constructor additionally accepts `{ policy, ledgerStore, configLoader, clock }`. When `policy` AND `ledgerStore` are set, `send()` consults them: a suppressed intent returns `[{ delivered: false, suppressed: true, reason, channel: null }]` and never routes; a sent intent records `recordSent` after routing. Any governance error degrades open. When they're absent, behavior is unchanged.
- `configLoader` is `() => ({ quietHours: QuietHours|null, cooldowns: { [category]: minutes, default: minutes } })`. `clock` is `{ now: () => Date }` (optional; falls back to `new Date()`).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/notification/notification-service-governance.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '#apps/notification/NotificationService.mjs';
import { NotificationPolicy } from '#domains/notification/services/NotificationPolicy.mjs';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';

function makeService({ ledgerStore, quietHours = null, cooldowns = { default: 60 }, now }) {
  const appSends = [];
  const appAdapter = { channel: 'app', send: async (i) => { appSends.push(i); return { delivered: true, channelId: 'app' }; } };
  const svc = new NotificationService({
    adapters: [appAdapter],
    preferenceLoader: () => ({ getChannelsFor: () => ['app'] }),
    policy: new NotificationPolicy(),
    ledgerStore,
    configLoader: () => ({ quietHours, cooldowns }),
    clock: { now: () => now },
    logger: { debug() {}, warn() {} },
  });
  return { svc, appSends };
}
const intent = (over = {}) => ({ title: 'Set your intention', body: 'b', category: 'ceremony', urgency: 'normal', metadata: { username: 'kckern' }, dedupeKey: 'ceremony:unit_intention:2026-07-17', ...over });

describe('NotificationService governance', () => {
  it('suppresses a 2nd identical intent within cooldown and does not hit the adapter', async () => {
    const state = { last: null, suppressed: [] };
    const ledgerStore = {
      getLastSent: () => state.last,
      recordSent: ({ atMs }) => { state.last = atMs; },
      recordSuppressed: (e) => state.suppressed.push(e),
    };
    const now = new Date(2026, 6, 17, 12, 0, 0);
    const { svc, appSends } = makeService({ ledgerStore, cooldowns: { default: 60 }, now });
    const r1 = await svc.send(intent());
    expect(r1[0].delivered).toBe(true);
    expect(appSends.length).toBe(1);
    const r2 = await svc.send(intent());               // same key, same minute
    expect(r2[0]).toMatchObject({ delivered: false, suppressed: true, reason: 'cooldown' });
    expect(appSends.length).toBe(1);                    // adapter NOT hit again
    expect(state.suppressed[0]).toMatchObject({ reason: 'cooldown', dedupeKey: 'ceremony:unit_intention:2026-07-17' });
  });

  it('suppresses non-critical during quiet hours but delivers critical', async () => {
    const ledgerStore = { getLastSent: () => null, recordSent() {}, recordSuppressed() {} };
    const q = new QuietHours({ enabled: true, start: '21:00', end: '07:00' });
    const now = new Date(2026, 6, 17, 23, 0, 0);
    const { svc, appSends } = makeService({ ledgerStore, quietHours: q, now });
    const r = await svc.send(intent({ urgency: 'high', dedupeKey: 'k1' }));
    expect(r[0]).toMatchObject({ delivered: false, suppressed: true, reason: 'quiet_hours' });
    expect(appSends.length).toBe(0);
    const rc = await svc.send(intent({ urgency: 'critical', dedupeKey: 'k2' }));
    expect(rc[0].delivered).toBe(true);
    expect(appSends.length).toBe(1);
  });

  it('degrades open when the ledger store throws', async () => {
    const ledgerStore = { getLastSent: () => { throw new Error('disk gone'); }, recordSent() {}, recordSuppressed() {} };
    const now = new Date(2026, 6, 17, 12, 0, 0);
    const { svc, appSends } = makeService({ ledgerStore, now });
    const r = await svc.send(intent());
    expect(r[0].delivered).toBe(true);   // delivered despite governance error
    expect(appSends.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/notification/notification-service-governance.test.mjs`
Expected: FAIL — governance not wired; cooldown/quiet-hours not enforced.

- [ ] **Step 3: Integrate governance into `NotificationService`**

Add the private fields and constructor params:

```javascript
  #policy;
  #ledgerStore;
  #configLoader;
  #clock;

  constructor({ adapters = [], preferenceLoader, logger, policy, ledgerStore, configLoader, clock } = {}) {
    this.#adapters = adapters;
    this.#adapterMap = new Map(adapters.map(a => [a.channel, a]));
    this.#preferenceLoader = preferenceLoader;
    this.#logger = logger;
    this.#pending = [];
    this.#policy = policy;
    this.#ledgerStore = ledgerStore;
    this.#configLoader = configLoader;
    this.#clock = clock;
  }
```

At the TOP of `send()`, after `const intent = …` normalization (right after line 38) and BEFORE `const preference = …`, insert the governance pre-check. Compute the shared vars once so the post-record reuses them:

```javascript
    // Governance (dedupe + quiet hours). Additive: only active when policy+ledger
    // are wired. Degrades open — a governance error never blocks delivery.
    const governed = this.#policy && this.#ledgerStore;
    let gv = null;
    if (governed) {
      try {
        const now = this.#clock?.now?.() || new Date();
        const username = intent.metadata?.username || null;
        const dedupeKey = intent.dedupeKey || `${intent.category}:${username || '-'}:${intent.title || ''}`;
        const cfg = this.#configLoader?.() || { quietHours: null, cooldowns: {} };
        const cooldownMins = cfg.cooldowns?.[intent.category] ?? cfg.cooldowns?.default ?? 60;
        const cooldownMs = cooldownMins * 60_000;
        const lastSentAt = this.#ledgerStore.getLastSent(username, dedupeKey);
        const decision = this.#policy.evaluate({ intent, lastSentAt, now, quietHours: cfg.quietHours, cooldownMs });
        gv = { now, username, dedupeKey };
        if (!decision.send) {
          this.#ledgerStore.recordSuppressed({ username, dedupeKey, category: intent.category, reason: decision.reason, atMs: now.getTime() });
          this.#logger?.debug?.('notification.suppressed', { category: intent.category, reason: decision.reason, dedupeKey });
          return [{ delivered: false, suppressed: true, reason: decision.reason, channel: null }];
        }
      } catch (error) {
        this.#logger?.warn?.('notification.governance.degraded', { error: error.message });
        gv = null; // fall through and deliver
      }
    }
```

Then, immediately before `return results;` (after the pending-tracking block at line 87), record the send:

```javascript
    if (governed && gv) {
      try {
        this.#ledgerStore.recordSent({ username: gv.username, dedupeKey: gv.dedupeKey, category: intent.category, atMs: gv.now.getTime() });
      } catch (error) {
        this.#logger?.warn?.('notification.governance.degraded', { error: error.message });
      }
    }

    return results;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/notification/notification-service-governance.test.mjs`
Expected: PASS (3 tests). Then regression — the EXISTING service tests must stay green (governance is additive/inactive without policy+ledger):
Run: `npx vitest run tests/isolated/notification tests/isolated/adapters/notification-channels.test.mjs`
Expected: PASS (update nothing — if an existing test breaks, the change was not additive; fix the change, not the test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/notification/NotificationService.mjs tests/isolated/notification/notification-service-governance.test.mjs
git commit -m "feat(notification): governance (dedupe + quiet hours) at the send() choke point"
```

---

## Task 6: Wire governance in the composition root + seed config

**Files:**
- Modify: `backend/src/5_composition/modules/notifications.mjs`
- Test: `tests/isolated/composition/notifications-governance-wiring.test.mjs`
- Data (manual, not committed): `data/household/config/notifications.yml`

**Interfaces:**
- Consumes: `NotificationPolicy`, `QuietHours`, `YamlNotificationLedgerStore`, and (new dep) `configService` + `dataPath` + `clock` passed into `bootstrapNotifications`.
- Produces: `bootstrapNotifications(deps)` constructs the policy, the ledger store (basePath = `<dataPath>/household/state`), and a `configLoader` that reads `notifications.yml` fresh each call, and injects all four into `NotificationService`. Returns the same `{ container, notificationService }` shape, plus `ledgerStore` and `notificationConfigService`-relevant pieces are exposed for the admin wiring (see Task 8/9).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/composition/notifications-governance-wiring.test.mjs
import { describe, it, expect } from 'vitest';
import { bootstrapNotifications } from '#composition/modules/notifications.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('bootstrapNotifications governance wiring', () => {
  it('wires a ledger store + config loader so a repeat send is suppressed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'notif-'));
    try {
      const configService = { getHouseholdAppConfig: () => ({ quiet_hours: { enabled: false }, cooldowns: { ceremony: 60, default: 60 } }) };
      const { notificationService } = bootstrapNotifications({
        eventBus: { publish() {} },
        configService,
        dataPath: dir,
        clock: { now: () => new Date(2026, 6, 17, 12, 0, 0) },
        logger: { debug() {}, warn() {}, info() {}, child: () => ({ debug() {}, warn() {}, info() {} }) },
      });
      const intent = { title: 't', body: 'b', category: 'ceremony', urgency: 'normal', metadata: { username: 'u' }, dedupeKey: 'ceremony:x' };
      const r1 = await notificationService.send(intent);
      const r2 = await notificationService.send(intent);
      expect(r2.some(x => x.suppressed)).toBe(true);
      expect(r2.find(x => x.suppressed).reason).toBe('cooldown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/composition/notifications-governance-wiring.test.mjs`
Expected: FAIL — governance not constructed; the repeat send is delivered, not suppressed.

- [ ] **Step 3: Wire it in `bootstrapNotifications`**

Add imports at the top of `notifications.mjs`:

```javascript
import path from 'path';
import { NotificationPolicy } from '#domains/notification/services/NotificationPolicy.mjs';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';
import { YamlNotificationLedgerStore } from '#adapters/persistence/yaml/YamlNotificationLedgerStore.mjs';
```

In `bootstrapNotifications(deps)`, add `configService`, `dataPath`, `clock` to the destructure. After the adapters/preference are built and before the container is created, construct the governance pieces:

```javascript
  const ledgerStore = new YamlNotificationLedgerStore({ basePath: path.join(dataPath, 'household', 'state') });
  const policy = new NotificationPolicy();
  const configLoader = () => {
    const c = configService?.getHouseholdAppConfig?.(null, 'notifications') || {};
    return {
      quietHours: new QuietHours(c.quiet_hours || { enabled: false }),
      cooldowns: c.cooldowns || { default: 60 },
    };
  };
```

Then pass them into the `NotificationContainer` / `NotificationService` construction. The container currently receives `{ adapters, preferenceLoader }` (or similar) and returns the service via `getNotificationService()`. Extend the container to forward `policy`, `ledgerStore`, `configLoader`, `clock` to the `NotificationService` constructor. Read `NotificationContainer.mjs` first; if it constructs the service with a fixed arg set, add the four params through it. If the container does not need to own them, construct the service in `bootstrapNotifications` directly with all deps and keep the container for the adapter set — follow whichever the existing file does with least change. Finally, expose `ledgerStore` on the return object:

```javascript
  return { container, notificationService, ledgerStore };
```

At the `bootstrapNotifications(...)` CALL SITE (grep for it in `backend/src/app.mjs`), pass the new deps: `configService`, `dataPath` (the same data path other bootstraps use — the value passed to `bootstrapLifeplan` as `dataPath`), and `clock`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/composition/notifications-governance-wiring.test.mjs`
Expected: PASS. Regression: `npx vitest run tests/isolated/notification` (existing composition/service tests green).

- [ ] **Step 5: Seed the household config** (in the running container; not a git file)

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/notifications.yml << 'EOF'
quiet_hours:
  enabled: true
  start: \"21:00\"
  end: \"07:00\"
cooldowns:
  ceremony: 1200
  drift_alert: 1440
  default: 60
EOF"
```

- [ ] **Step 6: Commit** (code only)

```bash
git add backend/src/5_composition/modules/notifications.mjs tests/isolated/composition/notifications-governance-wiring.test.mjs
git commit -m "feat(notification): wire governance (policy/ledger/config) in the composition root"
```

---

## Task 7: Senders set an explicit dedupeKey

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/CeremonyScheduler.mjs` (the `notificationService.send({...})` call)
- Modify: `backend/src/3_applications/agents/lifeplan-guide/tools/NotificationToolFactory.mjs` (the `send_action_message` intent it builds)
- Test: `tests/isolated/lifeplan/services/ceremony-scheduler-dedupe.test.mjs`

**Interfaces:**
- Produces: ceremony nudge intents carry `dedupeKey: "ceremony:<type>:<periodId>"`; the coach's action-message intents carry `dedupeKey: "cadence:<username>:<localDate>"` (or a stable per-message key). This makes explicit keys authoritative instead of the derived title fallback.

- [ ] **Step 1: Write the failing test** (assert the scheduler passes a dedupeKey)

```javascript
// tests/isolated/lifeplan/services/ceremony-scheduler-dedupe.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { CeremonyScheduler } from '#apps/lifeplan/services/CeremonyScheduler.mjs';

describe('CeremonyScheduler sets a dedupeKey on nudges', () => {
  it('includes ceremony:<type>:<periodId> in the sent intent', async () => {
    const sent = [];
    const notificationService = { send: async (i) => { sent.push(i); return [{ delivered: true }]; } };
    // Minimal stubs: a plan with a default-enabled ceremony that is due now, one period, no prior record.
    const plan = { ceremonies: {}, cadence: {} };
    const lifePlanStore = { load: () => plan };
    const ceremonyRecordStore = { hasRecord: () => false, getLatestRecord: () => null };
    const cadenceService = { isCeremonyDue: (timing) => timing === 'start_of_unit', resolve: () => ({ unit: { periodId: '2026-07-17' } }) };
    const scheduler = new CeremonyScheduler({
      notificationService, lifePlanStore, ceremonyRecordStore, cadenceService,
      timezone: 'America/Los_Angeles',
      clock: { now: () => new Date(2026, 6, 17, 7, 0, 0), today: () => '2026-07-17' },
      logger: { info() {}, debug() {}, warn() {} },
    });
    // The public entry that sends nudges — confirm its real name by reading the file (checkAndNotify(username)).
    await scheduler.checkAndNotify('kckern');
    const unitIntention = sent.find(i => i.metadata?.ceremony === 'unit_intention' || (i.dedupeKey || '').includes('unit_intention'));
    expect(unitIntention).toBeTruthy();
    expect(unitIntention.dedupeKey).toBe('ceremony:unit_intention:2026-07-17');
  });
});
```

> Before running: READ `CeremonyScheduler.mjs` to confirm the send entry method name (`checkAndNotify(username)`), the exact `cadencePosition`/`periodId` resolution, and the stub shape the real code calls (adjust the stubs above to satisfy every method the method invokes so the test fails for the RIGHT reason — a missing dedupeKey, not a stub TypeError).

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/lifeplan/services/ceremony-scheduler-dedupe.test.mjs`
Expected: FAIL — `dedupeKey` is undefined on the sent intent.

- [ ] **Step 3: Add the dedupeKey**

In `CeremonyScheduler.mjs`, the `notificationService.send({ ... })` call currently builds `{ title, body, category: 'ceremony', urgency, actions, metadata: { username, ceremony: type, periodId } }`. Add:

```javascript
        dedupeKey: `ceremony:${type}:${periodId}`,
```

In `NotificationToolFactory.mjs`, the `send_action_message` tool builds an intent passed to `notificationService.send`. Add a `dedupeKey` derived from the message's stable identity — use `cadence:${userId}:${date}` when the tool has a date, else `action:${userId}:${title}`. READ the tool to see what fields it has (it receives `userId` after the Task-22/23 rename and a `title`); set:

```javascript
        dedupeKey: `action:${userId}:${title}`,
```

(If the tool already carries a more stable key such as a ceremony/date, prefer that; the goal is a stable per-logical-message key, not per-call uniqueness.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/lifeplan/services/ceremony-scheduler-dedupe.test.mjs`
Expected: PASS. Regression: `npx vitest run tests/isolated/lifeplan/services/ceremony-scheduling.test.mjs tests/isolated/agents/lifeplan-guide` (existing scheduler/agent tests green — the added field is additive).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/lifeplan/services/CeremonyScheduler.mjs backend/src/3_applications/agents/lifeplan-guide/tools/NotificationToolFactory.mjs tests/isolated/lifeplan/services/ceremony-scheduler-dedupe.test.mjs
git commit -m "feat(notification): lifeplan senders set explicit dedupeKeys"
```

---

## Task 8: NotificationConfigService (read/validate/write notifications.yml)

**Files:**
- Create: `backend/src/3_applications/notification/NotificationConfigService.mjs`
- Test: `tests/isolated/notification/notification-config-service.test.mjs`

**Interfaces:**
- Produces: `new NotificationConfigService({ configService, logger })`; methods:
  - `getConfig() → { quiet_hours: { enabled, start, end }, cooldowns: { [category]: minutes } }` (defaults filled in).
  - `updateConfig(data) → savedConfig` — validates, writes `<householdConfigDir>/notifications.yml`, reloads the household config cache, returns `getConfig()`. Throws an error with `code: 'VALIDATION'` on bad input.
- Consumes: `configService.getHouseholdAppConfig(null, 'notifications')`, `configService.getHouseholdPath('config')`, `configService.reloadHouseholdAppConfig(null, 'notifications')`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/notification/notification-config-service.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NotificationConfigService } from '#apps/notification/NotificationConfigService.mjs';

function make() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ncfg-'));
  let stored = { quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: 1200, default: 60 } };
  const reload = vi.fn(() => { /* re-read from disk into `stored` in real impl; here noop */ });
  const configService = {
    getHouseholdAppConfig: () => stored,
    getHouseholdPath: (sub) => path.join(dir, sub),
    reloadHouseholdAppConfig: reload,
  };
  // ensure config dir exists
  require('node:fs').mkdirSync(path.join(dir, 'config'), { recursive: true });
  return { svc: new NotificationConfigService({ configService, logger: { warn() {} } }), dir, reload, setStored: (s) => { stored = s; } };
}

describe('NotificationConfigService', () => {
  it('returns config with defaults filled', () => {
    const { svc } = make();
    const c = svc.getConfig();
    expect(c.quiet_hours.start).toBe('21:00');
    expect(c.cooldowns.default).toBe(60);
  });
  it('writes notifications.yml and reloads on update', () => {
    const { svc, dir, reload } = make();
    svc.updateConfig({ quiet_hours: { enabled: false, start: '22:00', end: '06:00' }, cooldowns: { ceremony: 600, default: 30 } });
    const file = path.join(dir, 'config', 'notifications.yml');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('22:00');
    expect(reload).toHaveBeenCalled();
  });
  it('rejects a bad time with a VALIDATION error', () => {
    const { svc } = make();
    expect(() => svc.updateConfig({ quiet_hours: { enabled: true, start: '9am', end: '07:00' }, cooldowns: { default: 60 } }))
      .toThrowError(/time/i);
  });
  it('rejects a negative cooldown', () => {
    const { svc } = make();
    expect(() => svc.updateConfig({ quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: -5, default: 60 } }))
      .toThrowError(/cooldown/i);
  });
});
```

> Note: replace the `require('node:fs')` line with an `import { mkdirSync } from 'node:fs'` at the top when finalizing (kept inline here for readability). Confirm `configService.getHouseholdPath` returns the household ROOT + subdir (per `admin/index.mjs`'s `getHouseholdPath('')` usage); adjust the write path if the real method returns the config dir directly.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/notification/notification-config-service.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the service**

```javascript
// backend/src/3_applications/notification/NotificationConfigService.mjs
import path from 'path';
import { saveYaml } from '#system/utils/FileIO.mjs';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULTS = { quiet_hours: { enabled: false, start: '21:00', end: '07:00' }, cooldowns: { default: 60 } };

function validationError(message) {
  const e = new Error(message);
  e.code = 'VALIDATION';
  return e;
}

export class NotificationConfigService {
  #configService;
  #logger;
  constructor({ configService, logger = console }) {
    this.#configService = configService;
    this.#logger = logger;
  }

  getConfig() {
    const c = this.#configService.getHouseholdAppConfig?.(null, 'notifications') || {};
    return {
      quiet_hours: { ...DEFAULTS.quiet_hours, ...(c.quiet_hours || {}) },
      cooldowns: { ...DEFAULTS.cooldowns, ...(c.cooldowns || {}) },
    };
  }

  updateConfig(data = {}) {
    const qh = data.quiet_hours || {};
    if (!TIME_RE.test(qh.start ?? '') || !TIME_RE.test(qh.end ?? '')) {
      throw validationError('quiet_hours start/end must be "HH:MM" 24-hour times');
    }
    const cooldowns = data.cooldowns || {};
    for (const [k, v] of Object.entries(cooldowns)) {
      if (!Number.isInteger(v) || v < 0) throw validationError(`cooldown for "${k}" must be a non-negative integer (minutes)`);
    }
    const next = {
      quiet_hours: { enabled: !!qh.enabled, start: qh.start, end: qh.end },
      cooldowns: { default: 60, ...cooldowns },
    };
    const file = path.join(this.#configService.getHouseholdPath('config'), 'notifications.yml');
    saveYaml(file, next);
    this.#configService.reloadHouseholdAppConfig?.(null, 'notifications');
    this.#logger?.info?.('notification.config.updated', { file });
    return this.getConfig();
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/notification/notification-config-service.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/notification/NotificationConfigService.mjs tests/isolated/notification/notification-config-service.test.mjs
git commit -m "feat(notification): NotificationConfigService (validate + persist notifications.yml)"
```

---

## Task 9: Admin notifications sub-router (config + ledger)

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/notifications.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/index.mjs` (import + mount + destructure deps)
- Modify: `backend/src/app.mjs:2942` (inject `notificationConfigService` + `notificationLedgerStore` into `createAdminRouter`)
- Test: `tests/isolated/api/routers/admin-notifications.test.mjs`

**Interfaces:**
- Consumes: `NotificationConfigService` (Task 8), `YamlNotificationLedgerStore` (Task 3 / exposed by Task 6).
- Produces: mounted at `/api/v1/admin/notifications`:
  - `GET /` → config; `PUT /` → `{ validate, persist }` (400 with `{error}` on `VALIDATION`); `GET /ledger?limit=` → `{ events }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/api/routers/admin-notifications.test.mjs
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminNotificationsRouter } from '#api/v1/routers/admin/notifications.mjs';

function app({ config = { quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { default: 60 } }, events = [] } = {}) {
  let stored = config;
  const notificationConfigService = {
    getConfig: () => stored,
    updateConfig: (d) => {
      if (!/^\d{2}:\d{2}$/.test(d.quiet_hours?.start || '')) { const e = new Error('bad time'); e.code = 'VALIDATION'; throw e; }
      stored = d; return stored;
    },
  };
  const notificationLedgerStore = { recentEvents: (n) => events.slice(0, n) };
  const a = express();
  a.use(express.json());
  a.use('/api/v1/admin/notifications', createAdminNotificationsRouter({ notificationConfigService, notificationLedgerStore }));
  return a;
}

describe('admin notifications router', () => {
  it('GET returns config', async () => {
    const res = await request(app()).get('/api/v1/admin/notifications');
    expect(res.status).toBe(200);
    expect(res.body.cooldowns.default).toBe(60);
  });
  it('PUT persists valid config', async () => {
    const res = await request(app()).put('/api/v1/admin/notifications').send({ quiet_hours: { enabled: false, start: '22:00', end: '06:00' }, cooldowns: { default: 30 } });
    expect(res.status).toBe(200);
    expect(res.body.quiet_hours.start).toBe('22:00');
  });
  it('PUT 400s on validation error', async () => {
    const res = await request(app()).put('/api/v1/admin/notifications').send({ quiet_hours: { start: '9am' }, cooldowns: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/time/i);
  });
  it('GET /ledger returns events', async () => {
    const res = await request(app({ events: [{ at: 2, suppressed: true, reason: 'cooldown' }, { at: 1, delivered: true }] })).get('/api/v1/admin/notifications/ledger?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/api/routers/admin-notifications.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the sub-router**

```javascript
// backend/src/4_api/v1/routers/admin/notifications.mjs
import express from 'express';

/**
 * Admin sub-router for household notification governance. Forwards to injected
 * services only (this router never imports #apps).
 */
export function createAdminNotificationsRouter({ notificationConfigService, notificationLedgerStore, logger = console }) {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try { res.json(notificationConfigService.getConfig()); } catch (e) { next(e); }
  });

  router.put('/', (req, res, next) => {
    try {
      res.json(notificationConfigService.updateConfig(req.body || {}));
    } catch (e) {
      if (e.code === 'VALIDATION') return res.status(400).json({ error: e.message });
      next(e);
    }
  });

  router.get('/ledger', (req, res, next) => {
    try {
      const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
      res.json({ events: notificationLedgerStore.recentEvents(limit) });
    } catch (e) { next(e); }
  });

  return router;
}
```

- [ ] **Step 4: Mount it + inject deps**

In `admin/index.mjs`: add the import near the other sub-router imports:

```javascript
import { createAdminNotificationsRouter } from './notifications.mjs';
```

Add `notificationConfigService` and `notificationLedgerStore` to the `createAdminRouter(config)` destructure, and mount after the existing sub-routers:

```javascript
  const notificationsRouter = createAdminNotificationsRouter({
    notificationConfigService,
    notificationLedgerStore,
    logger: logger.child?.({ submodule: 'notifications' }) || logger,
  });
  router.use('/notifications', notificationsRouter);
```

In `backend/src/app.mjs` at the `createAdminRouter({ … })` call (line ~2942), add the two deps. The `notificationLedgerStore` comes from `bootstrapNotifications(...)`'s return (Task 6 exposed it); construct the `NotificationConfigService` near where notifications are bootstrapped and pass it too:

```javascript
  // near the notifications bootstrap:
  const notificationConfigService = new NotificationConfigService({ configService, logger });
  // …
  v1Routers.admin = createAdminRouter({
    // …existing deps…
    notificationConfigService,
    notificationLedgerStore,   // from bootstrapNotifications(...).ledgerStore
  });
```

(Add `import { NotificationConfigService } from './3_applications/notification/NotificationConfigService.mjs';` with the other app.mjs imports.)

- [ ] **Step 5: Run it, verify it passes**

Run: `npx vitest run tests/isolated/api/routers/admin-notifications.test.mjs`
Expected: PASS (4 tests). Then a smoke that the admin router still composes: `npx vitest run tests/isolated/api` (no new failures).

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/notifications.mjs backend/src/4_api/v1/routers/admin/index.mjs backend/src/app.mjs tests/isolated/api/routers/admin-notifications.test.mjs
git commit -m "feat(admin): notifications sub-router (config GET/PUT + ledger)"
```

---

## Task 10: Admin frontend — SYSTEM › Notifications page

**Files:**
- Create: `frontend/src/modules/Admin/Notifications/NotificationsIndex.jsx`
- Create: `frontend/src/modules/Admin/Notifications/NotificationsIndex.test.jsx`
- Modify: `frontend/src/modules/Admin/AdminNav.jsx` (SYSTEM nav item)
- Modify: the Admin router that declares `/admin/system/*` routes (find it: grep `admin/system/config` in `frontend/src/modules/Admin` / `frontend/src/Apps`)

**Interfaces:**
- Consumes: `GET/PUT /api/v1/admin/notifications`, `GET /api/v1/admin/notifications/ledger` (Task 9). Uses the app's `DaylightAPI` helper (same as other Admin pages — confirm its import path by reading a sibling Admin page such as `Config/ConfigIndex.jsx`).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Admin/Notifications/NotificationsIndex.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
import { NotificationsIndex } from './NotificationsIndex.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
beforeEach(() => {
  api.mockReset();
  api.mockImplementation((pathArg) => {
    if (String(pathArg).includes('/ledger')) return Promise.resolve({ events: [{ at: 2, username: 'kckern', category: 'ceremony', delivered: false, suppressed: true, reason: 'cooldown' }] });
    return Promise.resolve({ quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: 1200, default: 60 } });
  });
});

describe('NotificationsIndex', () => {
  it('renders quiet hours, cooldowns, and the ledger', async () => {
    wrap(<NotificationsIndex />);
    expect(await screen.findByDisplayValue('21:00')).toBeInTheDocument();
    expect(screen.getByText(/1200/)).toBeInTheDocument();       // ceremony cooldown
    await waitFor(() => expect(screen.getByText(/cooldown/i)).toBeInTheDocument()); // ledger row reason
  });
  it('saves quiet hours via PUT', async () => {
    wrap(<NotificationsIndex />);
    await screen.findByDisplayValue('21:00');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/v1/admin/notifications', 'PUT', expect.objectContaining({ quiet_hours: expect.any(Object), cooldowns: expect.any(Object) })));
  });
});
```

> Before running: READ a sibling Admin page (`Config/ConfigIndex.jsx`) to confirm the exact `DaylightAPI` import path and call signature (`DaylightAPI(path)` for GET, `DaylightAPI(path, 'PUT', body)` or similar for writes). Align the mock + component to the real signature.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Admin/Notifications/NotificationsIndex.test.jsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write the page**

```jsx
// frontend/src/modules/Admin/Notifications/NotificationsIndex.jsx
import { useState, useEffect, useCallback } from 'react';
import { Stack, Paper, Title, Group, Switch, TextInput, Table, Button, Badge, NumberInput, Text, Loader } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';

export function NotificationsIndex() {
  const [config, setConfig] = useState(null);
  const [events, setEvents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadConfig = useCallback(async () => {
    const c = await DaylightAPI('/api/v1/admin/notifications');
    setConfig({ quiet_hours: c.quiet_hours, cooldowns: c.cooldowns });
  }, []);
  const loadLedger = useCallback(async () => {
    const r = await DaylightAPI('/api/v1/admin/notifications/ledger?limit=50');
    setEvents(r.events || []);
  }, []);

  useEffect(() => { loadConfig(); loadLedger(); }, [loadConfig, loadLedger]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const saved = await DaylightAPI('/api/v1/admin/notifications', 'PUT', config);
      setConfig({ quiet_hours: saved.quiet_hours, cooldowns: saved.cooldowns });
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (!config) return <Loader />;
  const qh = config.quiet_hours;
  const setQh = (patch) => setConfig((c) => ({ ...c, quiet_hours: { ...c.quiet_hours, ...patch } }));
  const setCooldown = (k, v) => setConfig((c) => ({ ...c, cooldowns: { ...c.cooldowns, [k]: v } }));

  return (
    <Stack gap="md" p="md">
      <Title order={3}>Notifications</Title>
      {error && <Text c="red">{error}</Text>}

      <Paper p="md" withBorder>
        <Group justify="space-between" mb="sm"><Title order={5}>Quiet hours</Title>
          <Switch checked={qh.enabled} onChange={(e) => setQh({ enabled: e.currentTarget.checked })} label="Enabled" /></Group>
        <Group>
          <TextInput label="Start" value={qh.start} onChange={(e) => setQh({ start: e.currentTarget.value })} w={120} />
          <TextInput label="End" value={qh.end} onChange={(e) => setQh({ end: e.currentTarget.value })} w={120} />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">Non-critical notifications are suppressed during this window (household-local).</Text>
      </Paper>

      <Paper p="md" withBorder>
        <Title order={5} mb="sm">Cooldowns (minutes)</Title>
        <Table>
          <Table.Thead><Table.Tr><Table.Th>Category</Table.Th><Table.Th>Minutes</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {Object.entries(config.cooldowns).map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td>{k}</Table.Td>
                <Table.Td><NumberInput value={v} min={0} onChange={(val) => setCooldown(k, Number(val) || 0)} w={120} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Group><Button onClick={save} loading={saving}>Save</Button></Group>

      <Paper p="md" withBorder>
        <Group justify="space-between" mb="sm"><Title order={5}>Recent activity</Title>
          <Button size="xs" variant="light" onClick={loadLedger}>Refresh</Button></Group>
        <Table>
          <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>User</Table.Th><Table.Th>Category</Table.Th><Table.Th>Result</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {events.map((e, i) => (
              <Table.Tr key={i}>
                <Table.Td>{new Date(e.at).toLocaleString()}</Table.Td>
                <Table.Td>{e.username || '—'}</Table.Td>
                <Table.Td>{e.category}</Table.Td>
                <Table.Td>{e.suppressed
                  ? <Badge color="gray" variant="light">suppressed · {e.reason}</Badge>
                  : <Badge color="green" variant="light">sent</Badge>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

export default NotificationsIndex;
```

- [ ] **Step 5: Wire nav + route**

In `AdminNav.jsx`, add to the SYSTEM section's items (with the other SYSTEM items), importing `IconBell` from `@tabler/icons-react`:

```javascript
      { label: 'Notifications', icon: IconBell, to: '/admin/system/notifications' },
```

In the Admin router (the file that maps `/admin/system/config` → `ConfigIndex`), add a route `/admin/system/notifications` → `<NotificationsIndex />` (import it). Match the existing route-declaration style in that file.

- [ ] **Step 6: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Admin/Notifications/NotificationsIndex.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Admin/Notifications/ frontend/src/modules/Admin/AdminNav.jsx <the-admin-router-file>
git commit -m "feat(admin): SYSTEM > Notifications page (quiet hours, cooldowns, live ledger)"
```

---

## Task 11: Final verification, build & deploy

- [ ] **Step 1: Full backend + frontend suites for the feature**

Run: `npx vitest run tests/isolated/domain/notification tests/isolated/notification tests/isolated/adapters/notification-ledger-store.test.mjs tests/isolated/adapters/notification-channels.test.mjs tests/isolated/composition/notifications-governance-wiring.test.mjs tests/isolated/api/routers/admin-notifications.test.mjs tests/isolated/lifeplan/services/ceremony-scheduler-dedupe.test.mjs frontend/src/modules/Admin/Notifications`
Expected: all PASS.

- [ ] **Step 2: Gate — no new regressions**

Run: `node scripts/gate-vitest.mjs`
Expected: exit 0 (no NEW failing files beyond the ~4 pre-existing unrelated ones).

- [ ] **Step 3: Confirm the deploy gate is clear** (no active fitness session / playing video — `CLAUDE.local.md`), then build:

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

- [ ] **Step 4: Seed `notifications.yml` in the container if not already present** (Task 6 Step 5), then deploy:

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Verify live** — container healthy, then:

```bash
curl -s http://localhost:3111/api/v1/admin/notifications | head -c 200          # config JSON
curl -s http://localhost:3111/api/v1/admin/notifications/ledger?limit=5 | head   # events JSON
```

Load `/admin/system/notifications` and confirm the page renders config + ledger; toggle quiet hours and Save; trigger a duplicate lifeplan nudge path and confirm a `suppressed · cooldown` row appears.

- [ ] **Step 6: Update docs** — add a short "Notification governance" subsection to `docs/reference/life/life-domain-architecture.md` (or a notification reference doc) describing the policy/ledger/config + the Admin page. Commit.

---

## Self-Review

**Spec coverage:**
- Decision flow at `send()` → Task 5. ✅
- `NotificationPolicy` (pure) + `QuietHours` → Tasks 2, 1. ✅
- Persisted `YamlNotificationLedgerStore` (cooldown map + bounded events) → Task 3. ✅
- `notifications.yml` config + `configLoader` + household-accessor gotcha → Tasks 6, 8. ✅
- `NotificationIntent.dedupeKey` + senders set it → Tasks 4, 7. ✅
- Degrade-open + defaults → Task 5 (degrade), Task 8 (defaults). ✅
- Admin API (GET/PUT/ledger, 400 on validation) → Task 9. ✅
- Admin page (quiet hours + cooldowns + live ledger, SYSTEM nav) → Task 10. ✅
- Testing (domain/adapter/integration/api/frontend) → distributed across all tasks. ✅
- YAGNI suppress-not-defer → honored (no queue/replay anywhere). ✅

**Type/name consistency:** ledger methods use object args `{ username, dedupeKey, category, atMs }` in Task 3 and are called that way in Tasks 5/9. `evaluate({ intent, lastSentAt, now, quietHours, cooldownMs })` is defined in Task 2 and called identically in Task 5. `configLoader` returns `{ quietHours: QuietHours, cooldowns }` in Task 6 and is consumed that way in Task 5. Cooldown keys are categories (`ceremony`/`drift_alert`/`default`) throughout. `NotificationConfigService.getConfig/updateConfig` shapes match between Tasks 8 and 9.

**Placeholder scan:** every code step carries real code; the few "READ the sibling file to confirm X" notes are flagged inline where the exact local signature (CeremonyScheduler send-method name, `DaylightAPI` call signature, the Admin route-declaration file, `getHouseholdPath` return shape) must be verified against the real file before finalizing that one call — the implementer confirms those against the named file.

**Deferred (explicit, out of scope):** defer-and-replay during quiet hours; per-user quiet-hours schedules; per-user channel mute UI — all noted in the spec's Non-goals.
