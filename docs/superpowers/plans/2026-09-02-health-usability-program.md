# Health Usability, Capture & Data-Richness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-02-health-usability-prd.md` (approved rev 2). Read it before starting any phase.

**Goal:** Rebuild `/health` food logging around a settled/unsettled lifecycle, first-class groups with photos, frictionless per-meal capture, durable scale-signal matching, macro/icon/viz surfacing, quick add, and flicker-free loading.

**Architecture:** The flat NutriList row store stays the single day-view source of truth; groups and settlement ride on it as new whitelisted fields (`kind`, `parentId`, `settled`, `photoRef`, `microsSource`). The pending Accept/Revise/Discard queue is retired at the one seam all transports share (`NutribotInputRouter`) by auto-accepting with `settled:false`. A new durable ObservationService replaces `ScaleNutribotBridge`. Display phases are additive over that foundation.

**Tech Stack:** Node ESM backend (DDD layers, YAML persistence via FileIO), React + Mantine + `@/lib/ui` frontend, vitest for unit tests, Playwright for flow tests.

## Global Constraints

- **Whitelists drop unknown keys.** `validateNutriLog`/`validateFoodItem` (backend/src/2_domains/nutrition/entities/schemas.mjs) and `dehydrateNutriListItem`/`saveMany` (backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs) silently discard any field they don't name. Every new persisted field must be threaded through ALL of them (Phase 0) before any other phase writes it.
- **Storage `status` stays `pending|accepted|rejected|deleted`.** Lifecycle-visible entries are `accepted` + `settled:false`. Never invent a new status value — `BudgetService.COUNTED`, `syncFromLog` (`isAccepted`), and the color aggregations all filter on `status`.
- **Absent `settled` field reads as settled** (migration by defaulting — PRD F3.6). No backfill of hot or archive files, ever.
- **Auto-settle is read-time** (PRD F3.5): 3 days, computed at presentation, no scheduled job, no archive mutation.
- **Rollups computed on read, never stored** (PRD F2.3).
- **Single-user:** every endpoint resolves `getDefaultUsername()`; do not add user attribution.
- **Logging framework only** — `createAppLogger('health')` children on the frontend, injected `logger` on the backend. Never raw `console.*`.
- **No sliders** (touch convention). No hardcoded asset paths — the icon manifest owns filenames. Design tokens from `@/lib/ui` / `var(--ds-*)`; run `npm run audit:ui` before committing frontend styles (pre-commit gate enforces baselines).
- **Tests:** vitest, colocated (`Foo.test.mjs` backend, `Foo.test.jsx` frontend). Run `npx vitest run <file>` from the repo root. jsdom cannot see layout — CSS/layout claims need Playwright or manual check, not jsdom assertions.
- **Dates are LOCAL, never `toISOString()`** — use `localTodayISO` (frontend) / `localDateISO` (backend) patterns.
- **Docs:** each phase's final task updates `docs/reference/health/README.md` (present-tense endstate style, no class names in prose).
- **Deploys on kckern-server:** `./scripts/deploy-gate.sh` must pass (exit 0) before any container replace.

**Phase order is dependency order.** Phases 0→1→2 are strictly sequential. Phases 3 and 4 need 0–1. Phase 5 needs 0–1. Phases 6–9 need 0–2 and are parallelizable. Phase 10 needs 2. Each phase ends mergeable and shippable.

---

# Phase 0 — Schema Foundation

New persisted fields, threaded through every whitelist, plus the settlement domain helper. Nothing user-visible yet.

### Task 0.1: Thread new fields through the FoodItem/NutriLog validators

**Files:**
- Modify: `backend/src/2_domains/nutrition/entities/schemas.mjs` (validateFoodItem ~line 132–210; validateNutriLog return ~line 320–359)
- Test: `backend/src/2_domains/nutrition/entities/schemas.newfields.test.mjs` (create)

**Interfaces:**
- Produces: `validateFoodItem(item).value` now carries `kind` (`'item'|'group'`, default `'item'`), `parentId` (string|null), `photoRef` (string|null), `settled` (boolean|undefined — undefined means "field absent", preserved as absent), `settledBy` (`'user'|'auto'`|null), `settledAt` (string|null), `microsSource` (`'ai'|'catalog'`|null).
- Consumed by: every later phase.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/nutrition/entities/schemas.newfields.test.mjs
import { describe, it, expect } from 'vitest';
import { validateFoodItem, validateNutriLog } from './schemas.mjs';

const baseItem = {
  id: 'aB3dE5fG7h', label: 'Oatmeal', grams: 100, unit: 'g', amount: 100, color: 'yellow',
};

describe('validateFoodItem new lifecycle/group fields', () => {
  it('defaults kind to item and preserves group fields', () => {
    const r = validateFoodItem({ ...baseItem, kind: 'group', parentId: 'zZ9yX8wV7u', photoRef: 'ph_123' });
    expect(r.valid).toBe(true);
    expect(r.value.kind).toBe('group');
    expect(r.value.parentId).toBe('zZ9yX8wV7u');
    expect(r.value.photoRef).toBe('ph_123');
  });
  it('defaults kind=item, parentId/photoRef null when absent', () => {
    const r = validateFoodItem(baseItem);
    expect(r.value.kind).toBe('item');
    expect(r.value.parentId).toBeNull();
    expect(r.value.photoRef).toBeNull();
  });
  it('rejects unknown kind', () => {
    expect(validateFoodItem({ ...baseItem, kind: 'plate' }).valid).toBe(false);
  });
  it('preserves settled=false with settledBy/settledAt, and ABSENCE stays absent', () => {
    const r = validateFoodItem({ ...baseItem, settled: false, settledBy: 'user', settledAt: '2026-09-02 10:00:00' });
    expect(r.value.settled).toBe(false);
    expect(r.value.settledBy).toBe('user');
    const r2 = validateFoodItem(baseItem);
    expect('settled' in r2.value ? r2.value.settled : undefined).toBeUndefined();
  });
  it('preserves microsSource', () => {
    expect(validateFoodItem({ ...baseItem, microsSource: 'ai' }).value.microsSource).toBe('ai');
  });
  it('round-trips through validateNutriLog items', () => {
    const log = {
      id: 'aB3dE5fG7h', userId: 'u', status: 'accepted',
      meal: { date: '2026-09-02', time: 'morning' },
      items: [{ ...baseItem, settled: false, kind: 'item' }],
      createdAt: '2026-09-02 08:00:00', updatedAt: '2026-09-02 08:00:00',
    };
    const r = validateNutriLog(log);
    expect(r.valid).toBe(true);
    expect(r.value.items[0].settled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run backend/src/2_domains/nutrition/entities/schemas.newfields.test.mjs`. Expected: FAIL (`kind` undefined on value).

- [ ] **Step 3: Implement.** In `validateFoodItem`: add validation + pass-through. Insert before the error-count check:

```js
  // Lifecycle / taxonomy fields (PRD Themes 2–3). Absent `settled` must STAY
  // absent — presentation treats absence as settled (migration by defaulting).
  if (item.kind !== undefined && !['item', 'group'].includes(item.kind)) {
    errors.push("kind must be 'item' or 'group'");
  }
  if (item.parentId !== undefined && item.parentId !== null && typeof item.parentId !== 'string') {
    errors.push('parentId must be a string when present');
  }
  if (item.settled !== undefined && typeof item.settled !== 'boolean') {
    errors.push('settled must be a boolean when present');
  }
  if (item.settledBy !== undefined && item.settledBy !== null && !['user', 'auto'].includes(item.settledBy)) {
    errors.push("settledBy must be 'user' or 'auto'");
  }
  if (item.microsSource !== undefined && item.microsSource !== null && !['ai', 'catalog'].includes(item.microsSource)) {
    errors.push("microsSource must be 'ai' or 'catalog'");
  }
```

and extend the returned `value` object:

```js
      kind: item.kind || 'item',
      parentId: item.parentId ?? null,
      photoRef: item.photoRef ?? null,
      ...(item.settled !== undefined ? { settled: item.settled } : {}),
      settledBy: item.settledBy ?? null,
      settledAt: item.settledAt ?? null,
      microsSource: item.microsSource ?? null,
```

(`validateNutriLog` already maps items through `validateFoodItem` at line 329 — no change needed there.)

- [ ] **Step 4: Run test — PASS.** Also run the existing suite to catch regressions: `npx vitest run backend/src/2_domains/nutrition/`.

- [ ] **Step 5: Commit** — `git add backend/src/2_domains/nutrition/entities/ && git commit -m "feat(health): thread lifecycle+group fields through FoodItem/NutriLog validators"`

### Task 0.2: Thread the same fields through YamlNutriListDatastore

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs` — `dehydrateNutriListItem` (line 29–54), `saveMany` transform (line 230–254), `#normalizeItem` (line 128–138)
- Test: `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.newfields.test.mjs` (create; follow the mocking pattern of any existing datastore test — construct with a stub `dataService` whose `user.resolveDir` returns a temp dir path, use real FileIO against `fs.mkdtempSync`)

**Interfaces:**
- Produces: rows persisted via `syncFromLog` and `saveMany` retain `kind`, `parentId`, `photoRef`, `settled`, `settledBy`, `settledAt`, `microsSource`, and `mealTime`. `#normalizeItem` defaults `kind: 'item'`.

- [ ] **Step 1: Write the failing test** — save a log with one group + one child through `syncFromLog` (build a minimal `nutriLog` object: `{ id, userId, isAccepted: true, items: [...], meal: { date, time }, status: 'accepted', createdAt, acceptedAt }`), then `findByDate` and assert `kind`, `parentId`, `settled === false` survived. Second test: `saveMany` with `settled: false` + `kind: 'group'` survives a `findByDate` read.

```js
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { YamlNutriListDatastore } from './YamlNutriListDatastore.mjs';

let dir, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrilist-'));
  store = new YamlNutriListDatastore({
    dataService: { user: { resolveDir: (rel) => path.join(dir, rel) } },
    logger: { warn: () => {}, info: () => {} },
  });
});

const groupItem = { id: 'gGgGgGgGgG', uuid: '11111111-1111-4111-8111-111111111111', label: 'Smoothie', icon: 'smoothie', grams: 400, unit: 'g', amount: 400, color: 'green', calories: 0, kind: 'group', parentId: null, settled: false, settledBy: null, settledAt: null, photoRef: 'ph_1', microsSource: null };
const childItem = { ...groupItem, id: 'cCcCcCcCcC', uuid: '22222222-2222-4222-8222-222222222222', label: 'Blueberries', kind: 'item', parentId: 'gGgGgGgGgG', calories: 80, photoRef: null };

it('syncFromLog persists kind/parentId/settled/photoRef', async () => {
  await store.syncFromLog({ id: 'lLlLlLlLlL', userId: 'u1', isAccepted: true, status: 'accepted', items: [groupItem, childItem], meal: { date: '2026-09-02', time: 'morning' }, createdAt: '2026-09-02 08:00:00', acceptedAt: '2026-09-02 08:00:00' });
  const rows = await store.findByDate('u1', '2026-09-02');
  const g = rows.find((r) => r.kind === 'group');
  const c = rows.find((r) => r.parentId === 'gGgGgGgGgG');
  expect(g).toBeTruthy(); expect(g.settled).toBe(false); expect(g.photoRef).toBe('ph_1');
  expect(c).toBeTruthy(); expect(c.mealTime).toBe('morning');
});
```

- [ ] **Step 2: Run — FAIL** (fields missing from read rows).
- [ ] **Step 3: Implement.** Append to `dehydrateNutriListItem`'s returned object: `kind: item.kind, parentId: item.parentId, photoRef: item.photoRef, settled: item.settled, settledBy: item.settledBy, settledAt: item.settledAt, microsSource: item.microsSource,`. In `saveMany`'s transform add the same seven keys (`kind: item.kind || 'item'`, others `?? null`, but `settled: item.settled` verbatim — do NOT default it, absence must persist as absence; YAML omits `undefined` keys, which is exactly right). In `#normalizeItem` add `kind: item.kind || 'item'`.
- [ ] **Step 4: Run — PASS.** Then full adapter suite: `npx vitest run backend/src/1_adapters/persistence/yaml/`.
- [ ] **Step 5: Commit** — `git commit -m "feat(health): persist lifecycle+group fields in nutrilist datastore"`

### Task 0.3: Settlement domain helper (read-time auto-settle)

**Files:**
- Create: `backend/src/2_domains/nutrition/services/settlement.mjs`
- Test: `backend/src/2_domains/nutrition/services/settlement.test.mjs`

**Interfaces:**
- Produces: `AUTO_SETTLE_DAYS = 3`; `effectiveSettled(row, todayISO) → boolean`; `presentSettlement(row, todayISO) → { settled: boolean, settledBy: 'user'|'auto'|null }`. Pure functions, no clock access (todayISO injected) — domain layer must stay deterministic.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { effectiveSettled, presentSettlement, AUTO_SETTLE_DAYS } from './settlement.mjs';

describe('effectiveSettled', () => {
  it('absent settled field = settled (legacy rows)', () => {
    expect(effectiveSettled({ date: '2026-09-01' }, '2026-09-02')).toBe(true);
  });
  it('settled:true = settled', () => {
    expect(effectiveSettled({ settled: true, date: '2026-09-02' }, '2026-09-02')).toBe(true);
  });
  it('settled:false within window = unsettled', () => {
    expect(effectiveSettled({ settled: false, date: '2026-09-01' }, '2026-09-02')).toBe(false);
  });
  it('settled:false older than AUTO_SETTLE_DAYS = auto-settled', () => {
    expect(AUTO_SETTLE_DAYS).toBe(3);
    expect(effectiveSettled({ settled: false, date: '2026-08-28' }, '2026-09-02')).toBe(true);
  });
  it('uses createdAt date prefix when present', () => {
    expect(effectiveSettled({ settled: false, createdAt: '2026-08-28 09:00:00', date: '2026-09-02' }, '2026-09-02')).toBe(true);
  });
  it('presentSettlement reports auto for aged rows', () => {
    expect(presentSettlement({ settled: false, date: '2026-08-20' }, '2026-09-02')).toEqual({ settled: true, settledBy: 'auto' });
    expect(presentSettlement({ settled: false, date: '2026-09-02' }, '2026-09-02')).toEqual({ settled: false, settledBy: null });
    expect(presentSettlement({ settled: true, settledBy: 'user', date: '2026-09-02' }, '2026-09-02')).toEqual({ settled: true, settledBy: 'user' });
  });
});
```

- [ ] **Step 2: Run — FAIL** (module missing).
- [ ] **Step 3: Implement**

```js
// Read-time settlement (PRD F3.5/F3.6): rows are never mutated to auto-settle;
// age is computed at presentation. Absent `settled` = settled (legacy default).
export const AUTO_SETTLE_DAYS = 3;

const dayOf = (row) => (row?.createdAt || row?.date || '').slice(0, 10);

const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

export function effectiveSettled(row, todayISO) {
  if (row?.settled !== false) return true;
  const created = dayOf(row);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) return true;
  return daysBetween(created, todayISO) > AUTO_SETTLE_DAYS;
}

export function presentSettlement(row, todayISO) {
  if (row?.settled === true) return { settled: true, settledBy: row.settledBy ?? 'user' };
  if (effectiveSettled(row, todayISO)) {
    return { settled: true, settledBy: row?.settled === false ? 'auto' : null };
  }
  return { settled: false, settledBy: null };
}
export default { AUTO_SETTLE_DAYS, effectiveSettled, presentSettlement };
```

Adjust the legacy-row case: the test expects `{ settled: true, settledBy: null }` for absent-field rows — the implementation above returns exactly that (absent → `row?.settled === false` is false → `settledBy: null`).

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(health): read-time settlement domain helper"`

### Task 0.4: Serve settlement + kind from the day endpoint

**Files:**
- Modify: `backend/src/3_applications/health/HealthOperations.mjs` — locate `findNutritionItemsByDate` (grep for it; it backs `GET /nutrilist/:date`, router line 413)
- Test: extend `backend/src/3_applications/health/HealthOperations.pendingNutrition.test.mjs`'s sibling — create `backend/src/3_applications/health/HealthOperations.settlement.test.mjs` following that file's construction pattern for `HealthOperations` (read it first; reuse its fixture/builder helpers verbatim)

**Interfaces:**
- Produces: each row from `findNutritionItemsByDate` gains `settled` (effective boolean) and `settledBy` (per `presentSettlement`), with today's date supplied by the operation's clock in LOCAL form. Raw stored `settled` is replaced in the response by the effective value — the UI never re-implements the age rule.

- [ ] **Step 1: Write the failing test** — stub the nutrilist store to return one legacy row (no `settled`), one fresh `settled:false` row, one aged `settled:false` row (date 10 days back); assert the mapped output has `settled` true/false/true and `settledBy` null/null/'auto'.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — in `findNutritionItemsByDate`, after fetching rows, map:

```js
    const today = localDateISO(new Date(this.#clock?.now?.() ?? Date.now()));
    return rows.map((r) => ({ ...r, ...presentSettlement(r, today) }));
```

importing `presentSettlement` from `#domains/nutrition/services/settlement.mjs`. If `HealthOperations` has no clock, use `new Date()` — this is the application layer, ambient clock is permitted there (the domain helper stays pure). Add a local `localDateISO` if the file doesn't already have one (copy the 4-line implementation from `SavedMealsService.mjs`).
- [ ] **Step 4: Run — PASS.** Run `npx vitest run backend/src/3_applications/health/`.
- [ ] **Step 5: Commit** — `git commit -m "feat(health): day endpoint serves effective settlement"`

---

# Phase 1 — One Lifecycle Across Transports

Kill the pending queue at the shared seam. After this phase: every AI capture (web text/voice/photo/UPC, Telegram) lands immediately as `accepted` + `settled:false`, visible in the day view and counting in the budget. Scale-path pending survives until Phase 5.

### Task 1.1: Auto-commit seam in the input pipeline

**Files:**
- Read first: `backend/src/3_applications/nutribot/services/NutribotInputRouter.mjs` (610 lines — the routing seam), `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs` (what accept does: flips status, stamps `acceptedAt`, syncs nutrilist)
- Modify: `NutribotInputRouter.mjs` (or, if routing happens per-use-case with no common post-hook, add one there — the deliverable is ONE seam, not five edits)
- Test: `backend/src/3_applications/nutribot/services/NutribotInputRouter.autocommit.test.mjs`

**Interfaces:**
- Produces: for input types `text | voice | image | barcode` (NOT scale), a successful parse that would previously return a pending log + Accept/Revise/Discard choices now: (1) marks every item `settled: false`, (2) invokes the same accept path `AcceptFoodLog` uses (status → `accepted`, `acceptedAt` stamped, nutrilist synced via `syncFromLog`), (3) returns `{ committed: true, logId, items: [...] }` alongside a message whose choices are `Undo` and `Edit` (callback data reusing the existing discard/revise callback commands — grep `cmd:'x'` and the revise command in `LogFoodFromText.mjs` to get the exact callback strings; Undo maps to the discard command, which after this change performs delete semantics).
- Consumed by: Task 1.3 (web UI), Task 1.4 (Telegram copy).

- [ ] **Step 1: Read the router + AcceptFoodLog; identify the exact post-parse point** where a pending log and its choice keyboard are assembled. Write down (in the test file header comment) the function name and current message shape you found — the test must assert against the real shape.
- [ ] **Step 2: Write the failing test** — drive the router with a stubbed text use case returning a known pending log; assert the result has `committed: true`, the log passed to the accept path had `items[].settled === false`, and the returned message's choices contain no Accept.
- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement** at the seam. Keep `LogFoodFrom*` internals untouched — they still build a `pending` log; the seam immediately accepts it with `settled:false` stamped on items before sync. Scale-typed inputs bypass the seam (`if (type === 'scale') return legacy path`).
- [ ] **Step 5: Run — PASS**, plus `npx vitest run backend/src/3_applications/nutribot/`.
- [ ] **Step 6: Commit** — `git commit -m "feat(health): auto-commit AI captures as unsettled at the input-router seam"`

### Task 1.2: Settling writes + discard-as-delete

**Files:**
- Modify: `backend/src/3_applications/health/HealthOperations.mjs` (`updateNutritionItem`, `deleteNutritionItem` — backing `PUT/DELETE /nutrilist/:uuid`, router lines 459–502)
- Test: `backend/src/3_applications/health/HealthOperations.settlement.test.mjs` (extend from Task 0.4)

**Interfaces:**
- Produces: any `updateNutritionItem` call stamps `settled: true, settledBy: 'user', settledAt: <local timestamp>` onto the row (merged with the caller's updates; an explicit `{ settled: true }`-only body is the one-tap confirm). `PUT /nutrilist/:uuid` therefore settles. Delete is unchanged (it already hard-deletes via `deleteById`) — it IS the discard replacement; assert nothing new needed beyond a test pinning it.

- [ ] **Step 1: Write the failing test** — update a `settled:false` row with `{ mealTime: 'evening' }`; assert the persisted row has `settled === true`, `settledBy === 'user'`, and `mealTime === 'evening'`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — in `updateNutritionItem`, merge `{ settled: true, settledBy: 'user', settledAt: <now local> }` into the updates before calling the store's `update`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(health): edits settle entries"`

### Task 1.3: Web UI — unsettled rows in place, pending queue removed

**Files:**
- Modify: `frontend/src/modules/Health/today/EntryRow.jsx` (unsettled cue + one-tap confirm), `frontend/src/modules/Health/today/AddCombobox.jsx` (sentence path: no more review phase), `frontend/src/modules/Health/today/TodayView.jsx` (drop `PendingConfirmCard` + `NeedsReviewSection` usage; captures reload the day instead), `frontend/src/modules/Health/health.scss` (unsettled style)
- Delete (after usages are gone): `frontend/src/modules/Health/today/NeedsReviewSection.jsx`, `NeedsReviewSection.test.jsx`, `PendingConfirmCard.jsx`
- Test: `frontend/src/modules/Health/today/EntryRow.test.jsx` (create), update `TodayView.test.jsx` and `AddCombobox.test.jsx` expectations

**Interfaces:**
- Consumes: rows now carry `settled`/`settledBy` (Task 0.4); `POST /nutrition/input` responses now carry `committed: true` (Task 1.1).
- Produces: `EntryRow` renders a `health-row--unsettled` class + a small "✓ confirm" tap target (its own button, ≥44px, `aria-label="Confirm entry"`) when `row.settled === false`; tapping PUTs `{ settled: true }` and calls a new `onConfirm(row)` prop wired to `day.reload`. The unsettled cue = dashed left accent + the badge (never color alone — A1).

- [ ] **Step 1: Write the failing EntryRow test** — render with `settled:false`, assert the confirm button exists with the aria-label and the row has the unsettled class; render with `settled:true`, assert absent.
- [ ] **Step 2: Run — FAIL.** `npx vitest run frontend/src/modules/Health/today/EntryRow.test.jsx`
- [ ] **Step 3: Implement EntryRow** (confirm button calls `DaylightAPI(...nutrilist/${row.uuid}, { settled: true }, 'PUT')` then `onConfirm?.()`; add scss: `.health-row--unsettled { border-left: 2px dashed var(--ds-warning); }` and a `.health-row__confirm` styled from tokens).
- [ ] **Step 4: Update AddCombobox** — `submitSentence` now expects `{ committed }`: on success just call `onDone()` (day reload shows the new unsettled rows); delete the `review` phase and `PendingConfirmCard` import. Keep the error path exactly as-is (input never lost).
- [ ] **Step 5: Update TodayView** — remove `pendingReview` resource, `NeedsReviewSection`, `pendingCapture` state and `PendingConfirmCard`; `handleCaptureResult` keeps only the no-food-detected `captureNotice` branch and otherwise calls `day.reload()`. Delete the two now-unused components + their tests.
- [ ] **Step 6: Run** — `npx vitest run frontend/src/modules/Health/today/`. Fix fallout in `TodayView.test.jsx`/`LogTable.test.jsx` (assertions referencing removed components).
- [ ] **Step 7: Manual verify on dev server** (`npm run dev`, port per settings): type a sentence into a meal's add box → rows appear immediately with dashed cue; tap ✓ → cue clears. Check the equation strip moved.
- [ ] **Step 8: Commit** — `git commit -m "feat(health): unsettled rows in place; pending review queue removed from web"`

### Task 1.4: Telegram copy for the new lifecycle

**Files:**
- Modify: the Telegram handler that renders the parse-result message (find via `grep -rn "Accept" backend/src/3_applications/nutribot/handlers/ backend/src/3_applications/nutribot/bot/`) — it now receives the Task 1.1 committed shape
- Test: extend the nearest existing handler test with one case

**Interfaces:**
- Produces: Telegram reply reads "Logged ✓ — <n> items, <kcal> kcal" with inline keyboard `[Undo] [Edit]` (Undo = existing discard callback → deletes the committed log + nutrilist rows; Edit = existing revise callback, unchanged).

- [ ] **Step 1: Locate the message builder; write a failing test** asserting the new copy + two-button keyboard for a committed result.
- [ ] **Step 2: Run — FAIL. Step 3: Implement. Step 4: Run — PASS** (`npx vitest run backend/src/3_applications/nutribot/`).
- [ ] **Step 5: Verify `DiscardFoodLog` on an accepted log removes nutrilist rows** — read `DiscardFoodLog.mjs`; it must call `removeByLogId` (or `syncFromLog` with non-accepted status, which strips rows — line 156–175 of the datastore). If it refuses non-pending logs, relax that guard to allow `accepted` and add a test.
- [ ] **Step 6: Commit** — `git commit -m "feat(health): telegram lifecycle copy — logged+undo replaces accept gate"`

### Task 1.5: Docs — lifecycle

- [ ] Update `docs/reference/health/README.md`: capture funnel section rewritten (immediate unsettled commit, one lifecycle, budget counts unsettled, discard=delete, `rejected` unreachable). Note the consciously-reversed invariants. Commit `docs(health): lifecycle endstate`.

---

# Phase 2 — Groups & Photos

### Task 2.1: Group-aware parse output

**Files:**
- Read first: the AI parse prompt/response contract — `grep -rn "items" backend/src/3_applications/nutribot/lib/ | grep -i "prompt\|schema"` and `LogFoodFromText.mjs`'s parse-response handling
- Modify: the parse prompt + the mapping from AI response to `items[]`
- Test: colocated test for the mapper (pure: AI JSON → items with `kind`/`parentId`)

**Interfaces:**
- Produces: when the AI itemizes a composite ("smoothie with…", multi-dish photo), the mapped items are: one `kind:'group'` item per dish (label = dish name, `grams` = sum of children, `calories: 0` — group rows carry NO nutrition; rollups are computed) followed by its children with `parentId` = the group item's id. Single foods stay flat `kind:'item'`. The prompt instructs the model to emit `{ dishes: [{ name, items: [...] }], loose: [...] }` and the mapper flattens.

- [ ] **Step 1: Write the failing mapper test** (composite in → group+children with linked ids; single food in → one flat item).
- [ ] **Step 2–4: Red → implement → green.** Group ids: generate via the same id helper the use case already uses for items (grep `shortIdFromUuid`/`uuidv4` in the use case).
- [ ] **Step 5: Commit** — `git commit -m "feat(health): group-aware parse mapping"`

### Task 2.2: Rollups + grouped rendering in the day view

**Files:**
- Create: `frontend/src/modules/Health/today/groupRows.js` (pure) + `groupRows.test.js`
- Modify: `frontend/src/modules/Health/today/LogTable.jsx`, `EntryRow.jsx`, `health.scss`

**Interfaces:**
- Produces: `groupRows(rows) → [{ row, children, rollup: { calories, protein, carbs, fat } }]` — top-level rows in original order; children attached to their parent (matched on `parentId === row.id || parentId === row.uuid`); orphaned children render top-level. Rollup sums children (numeric-tolerant like `kcal()` in LogTable.jsx:5). Groups deeper than one level render flattened under the topmost group (indent only — PRD F2.4).
- `LogTable` Section renders group rows collapsed by default: name, icon slot, rollup kcal, chevron; tap chevron expands children indented (`health-row--child`); tapping the group row itself opens the edit sheet (Task 2.4). Bucket kcal totals must use the rollup-aware sum (children counted once — exclude `kind:'group'` rows from `kcal()` since they carry 0, children carry the values; pin with a test).

- [ ] **Step 1: Write failing `groupRows` tests** (nesting, orphans, rollup math, empty).
- [ ] **Step 2–4: Red → implement → green.** `npx vitest run frontend/src/modules/Health/today/groupRows.test.js`
- [ ] **Step 5: Wire into LogTable + EntryRow** (chevron button ≥44px, `aria-expanded`); update `LogTable.test.jsx`.
- [ ] **Step 6: Manual dev-server check** with a parsed composite sentence.
- [ ] **Step 7: Commit** — `git commit -m "feat(health): grouped day-view rendering with computed rollups"`

### Task 2.3: Photo persistence + serving

**Files:**
- Create: `backend/src/1_adapters/persistence/PhotoStore.mjs` (writes `lifelog/nutrition/photos/{photoRef}.jpg` + `{photoRef}.thumb.jpg` under the user dir via `dataService.user.resolveDir`; sharp is NOT in the dependency tree — check `package.json`; if absent, store the original only and serve it for both, with a `size=thumb` query reserved) + test
- Modify: the image input path (where the data-URL is decoded for the AI — grep `LogFoodFromImage.mjs` for the base64 handling): after a successful parse, persist the photo, stamp `photoRef` on the produced group/item rows
- Modify: `backend/src/4_api/v1/routers/health.mjs` — add `GET /nutrition/photos/:photoRef` streaming the file (404 on miss, path-traversal guard: `photoRef` must match `/^ph_[A-Za-z0-9]+$/`)
- Test: router test asserting the guard rejects `../` and serves a stored fixture

**Interfaces:**
- Produces: `PhotoStore.save(userId, buffer) → photoRef` (`ph_` + short id); `PhotoStore.resolvePath(userId, photoRef) → absolute path | null`. Rows carry `photoRef`; frontend fetches `api/v1/health/nutrition/photos/{photoRef}`.
- Deletion rule (PRD F2.5): photo files are NOT deleted when an entry is deleted (multi-reference); no GC this wave — document it.

- [ ] **Steps: red → green for PhotoStore (temp-dir test), red → green for the route guard, wire the image use case, commit** — `git commit -m "feat(health): persist capture photos with serving endpoint"`

### Task 2.4: Group operations in the edit sheet + photo thumbs

**Files:**
- Modify: `frontend/src/modules/Health/today/EntryEditSheet.jsx`, `EntryRow.jsx` (thumb), `EntryEditSheet.test.jsx`

**Interfaces:**
- Produces: opening the sheet on a `kind:'group'` row shows: rename (text input + save → PUT name), Move-to buckets (existing buttons — backend must move children too: extend `updateNutritionItem` so a `mealTime` update on a group row cascades to rows whose `parentId` matches, one test), scale-group chips `×½ ×¾ ×1½ ×2` (each child updated via the existing scale() math per child row, sequential PUTs), Delete (confirm dialog → deletes group + children). Rows with `photoRef` render a 32px thumbnail (`<img loading="lazy">`, `alt=""`), tapping the row still opens the sheet where the photo shows full-width.

- [ ] **Steps: failing sheet test for group mode → implement → cascade test on backend (`HealthOperations.settlement.test.mjs` extension: mealTime update on group moves children) → green → manual check → commit** — `git commit -m "feat(health): group edit operations + photo thumbnails"`

### Task 2.5: Docs — groups/photos

- [ ] Update `docs/reference/health/README.md` (entry taxonomy, photo store + endpoint, deletion rule). Commit.

---

# Phase 3 — Loading Discipline & Local Caching

### Task 3.1: Stale-while-revalidate in useApiResource

**Files:**
- Modify: `frontend/src/lib/hooks/useApiResource.js`
- Test: `frontend/src/lib/hooks/useApiResource.swr.test.jsx` (create; mock `DaylightAPI` with `vi.mock`)

**Interfaces:**
- Produces: new option `swr: true`. Behavior: a module-level `Map` keyed by `path` holds the last good payload; on mount with a cache hit, `data` initializes from cache and `loading` stays `false` (a `revalidating` flag is exposed instead); the fetch still runs and quietly replaces `data`. `reload()` never flips `loading` when cached data exists. Cache writes on every success. Default (no `swr`) behavior byte-identical to today — this hook is used app-wide (`modules/Auto` promotion note in its header); do not change defaults.

- [ ] **Step 1: Failing test** — first mount: loading true → data; second mount same path: `loading === false` immediately, `data` = cached value, then updated value after the mocked fetch resolves; `revalidating` true during the background fetch.
- [ ] **Step 2–4: Red → implement → green.** Run the whole frontend hook suite plus `npx vitest run frontend/src/modules/Health/` for regressions.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): opt-in stale-while-revalidate mode for useApiResource"`

### Task 3.2: Today never dissolves its chrome

**Files:**
- Modify: `frontend/src/modules/Health/today/useHealthDay.js` (pass `swr: true` to both resources), `TodayView.jsx`, `LogTable.jsx`

**Interfaces:**
- Produces: `LogTable` renders unconditionally (bucket headings always present); the `LoadingState` shimmer appears only INSIDE a section body when `day.loading && !day.items.length` (true cold start); `day.reload()` after a mutation causes no shimmer (SWR covers it). The Exercise section header renders even with zero sessions once budget data exists. AI-capture waits render as an in-place pending row in the target bucket: `TodayView` keeps a `capturePending: bucketId|null` state set when a capture submit starts, cleared on result; `LogTable` shows a skeleton row in that bucket ("Analyzing…", `aria-busy`).

- [ ] **Steps: update tests (TodayView.test.jsx — headings present during loading), implement, manual flicker check on dev server (mutate a row; confirm no full-list disappearance), commit** — `git commit -m "feat(health): permanent chrome, SWR day data, in-place capture pending"`

### Task 3.3: Docs — loading discipline. Update README (chrome/SWR/pending affordance rules). Commit.

---

# Phase 4 — Capture Affordances

### Task 4.1: Bucket parameter through the input pipeline

**Files:**
- Modify: `backend/src/4_api/v1/routers/health.mjs` (`POST /nutrition/input`, line 763 — accept `bucket` in body, validate against `MealTimes`, pass to `processNutritionInput`), `backend/src/3_applications/health/HealthOperations.mjs` (`processNutritionInput` — thread `bucket` through), the input router/use-case seam from Task 1.1 (apply precedence)
- Test: `NutribotInputRouter.autocommit.test.mjs` extension

**Interfaces:**
- Produces: precedence explicit-in-utterance > bucket param > clock (`getMealTimeFromHour`). The parse already yields a meal time; the AI prompt gains an instruction to also emit `mealTimeExplicit: true` only when the text/caption names a meal ("for lunch", "breakfast was…"). Mapper passes it through. At the seam: `const mealTime = parsed.mealTimeExplicit ? parsed.mealTime : (bucket || clockDerived)`. Response includes `{ mealTime, moved: parsed.mealTimeExplicit && bucket && parsed.mealTime !== bucket }` so the UI can show the "moved to Lunch" cue.
- Consumed by: Task 4.2.

- [ ] **Steps: failing seam test (three precedence cases + `moved` flag) → implement → green → commit** — `git commit -m "feat(health): bucket pre-binding with explicit-utterance precedence"`

### Task 4.2: Per-meal capture buttons

**Files:**
- Modify: `frontend/src/modules/Health/capture/useNutritionInput.js` (`submit(type, content, { bucket })` → body `{ type, content, bucket }`), `VoiceCapture.jsx` / `PhotoCapture.jsx` (accept + forward a `bucket` prop; read both first — they own their own trigger buttons), `LogTable.jsx` (Section header-right gains the three icon buttons wired with `b.id`), `TodayView.jsx` (pass submit handlers down; barcode opens `BarcodeCapture` with a `bucket` to apply on decode), `health.scss`
- Test: update `LogTable.test.jsx` (buttons render per bucket with aria-labels `Log by voice to Breakfast` etc.)

**Interfaces:**
- Produces: every meal section header carries mic/camera/barcode `ActionIcon`s (≥44px touch target via padding; inline SVG icons following `TodayView.jsx`'s `BarcodeIcon` pattern). Tap counts from Today: mic = 1 tap to recording (VoiceCapture's own affordance counts as the same tap — verify by reading it; if it needs a second tap to start, that's the 2nd of the ≤2 budget). After a capture where the response has `moved: true`, show `captureNotice` "Moved to <label>".

- [ ] **Steps: red (LogTable test) → implement → green → manual mobile-viewport check via headless Playwright screenshot (memory: `reference_headless_playwright_screenshot`) → commit** — `git commit -m "feat(health): per-meal mic/camera/barcode capture"`

### Task 4.3: Global quick-capture replaces footer icons

**Files:**
- Modify: `frontend/src/modules/Health/today/TodayView.jsx` + `MacroFooter.jsx` (remove capture children from footer), create `frontend/src/modules/Health/today/QuickCaptureBar.jsx` + test, `health.scss`

**Interfaces:**
- Produces: a fixed bottom-right cluster (mobile: always visible; desktop: same, unobtrusive) with text/mic/camera/barcode. Bucket default by local hour using `mealTimeFromHour` thresholds copied to a shared frontend helper in `mealBuckets.js` (`export const bucketForHour = (h) => h < 11 ? 'morning' : h < 15 ? 'afternoon' : h < 20 ? 'evening' : 'night';` — mirror SavedMealsService's mapping, NOT `getMealTimeFromHour`'s; pin with a test and note the intentional divergence). Text button focuses the matching bucket's AddCombobox (`onAddTo(bucketForHour(now))`).

- [ ] **Steps: red → implement → green → commit** — `git commit -m "feat(health): global quick-capture bar; footer capture icons retired"`

### Task 4.4: Docs — capture. Update README. Commit.

---

# Phase 5 — Durable Observation Matcher (replaces ScaleNutribotBridge)

Read `docs/reference/nutrition/README.md` in full plus `ScaleNutribotBridge.mjs`, `CompositionStore.mjs`, `ApplyScanToComposition.mjs`, and `LogFoodFromScale.mjs` before starting. The bridge's shipped behaviors are requirements (PRD F3.7): 25s quiet-commit, `rs:done` immediate, `rs:clear`/`rs:undo`, slot consumption at placement end, re-prompt dedup, non-gram refusal, net-weight math via `computeNet`/`computeNutrition`.

### Task 5.1: YamlObservationStore

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlObservationStore.mjs` + test (temp-dir pattern from Task 0.2)

**Interfaces:**
- Produces: per-user file `lifelog/nutrition/observations.yml`. Records: `{ id, kind: 'weight'|'upc'|'container'|'density', value, unit, scaleId, at (local ts), date, status: 'open'|'consumed'|'dismissed', pairedEntryUuid: null|string }`. API: `append(userId, obs)`, `listByDate(userId, date)`, `update(userId, id, patch)`, `openForScale(userId, scaleId)`. Head-of-household attribution (single-user).

- [ ] **Steps: red → green → commit** — `git commit -m "feat(health): durable observation store"`

### Task 5.2: Pure matcher

**Files:**
- Create: `backend/src/2_domains/nutrition/services/ObservationMatcher.mjs` + test

**Interfaces:**
- Produces: `matchObservations({ observations, entries, nowTs }) → { pairings: [{ observationId, entryUuid, confidence }], composition: {...}|null }`. Rules (PRD F3.7, all pinned by tests): 900s window; candidate entries = unsettled, same date; tie-break nearest-in-time; plausibility = paired weight implies kcal/g within [0.1, 9] against the entry's calories (else no pairing); a weight with no in-window candidate stays open (waits for the next entry). Pure — no clock, no I/O.

- [ ] **Steps: red (≥6 rule tests) → green → commit** — `git commit -m "feat(health): observation matching rules"`

### Task 5.3: ObservationService — absorb the bridge

**Files:**
- Create: `backend/src/3_applications/nutrition/ObservationService.mjs` + test
- Modify: composition wiring — find where `ScaleNutribotBridge` and `createFoodScaleRelay`/`createBarcodeRelay` are constructed (`grep -rn "ScaleNutribotBridge" backend/src/5_composition/`) and route the relay events to the new service instead; delete the bridge registration (leave the file until Task 5.6)
- Port: every behavioral test the bridge has (`grep -rn "test" backend/src/1_adapters/hardware/ | grep -i scale`) — each shipped behavior gets an equivalent ObservationService test before the swap

**Interfaces:**
- Produces: consumes the same WS events (`{source:'food-scale', grams, unit, stable}` + parsed scan events from `ApplyScanToComposition`'s vocabulary). Every signal is appended to the ObservationStore AND fed to the composition flow. Complete compositions quiet-commit after 25s (or `rs:done`) into an `accepted`+`settled:false` entry via the Phase-1 seam, with the pairing recorded (`status:'consumed'`, `pairedEntryUuid`). Non-gram units refused with the same log event the bridge used. `rs:clear`/`rs:undo` semantics preserved against the store.

- [ ] **Steps: port bridge behavior tests one at a time (red → green each) → wire composition → commit** — `git commit -m "feat(health): ObservationService replaces ScaleNutribotBridge"`

### Task 5.4: Observation API + day-view surfacing

**Files:**
- Modify: `backend/src/4_api/v1/routers/health.mjs` — `GET /nutrition/observations?date=`, `POST /nutrition/observations/:id/pair { entryUuid }` (validates entry exists, re-pairs: recompute the entry's grams/nutrition from the observation via the net-weight math, mark old pairing open), `POST /nutrition/observations/:id/dismiss`
- Create: `frontend/src/modules/Health/today/ObservationRow.jsx` + test; modify `TodayView.jsx` (SWR resource; render open observations at the top of the day as compact rows: "82 g on kitchen scale — unmatched", Dismiss button after day end), `EntryRow.jsx` (paired badge: "82 g · scale ✓" when a row's uuid appears in a consumed observation), `EntryEditSheet.jsx` (a "Measurements" section listing the day's observations with "pair to this entry" buttons)

- [ ] **Steps: router tests red → green; UI tests red → green; manual end-to-end with the kitchen scale if reachable, else the relay's replay fixture (check `_extensions/kitchen-relay` for one); commit** — `git commit -m "feat(health): observation surfacing, pairing and re-pairing"`

### Task 5.5: Macro wiring for scale entries — commit path calls `computeNutrition` (previously uncalled; PRD F3.8) and stores macros on the item's existing `protein/carbs/fat` fields with `microsSource: null`. One test.
- [ ] Commit — `git commit -m "feat(health): scale entries carry computed macros"`

### Task 5.6: Retire the bridge + docs

- [ ] Move `ScaleNutribotBridge.mjs` + its tests out of the build (delete; git history preserves), confirm `npx vitest run backend/src/` green and boot succeeds (`node backend/index.js` on the dev port, watch for composition errors). Update `docs/reference/nutrition/README.md` (flow diagram: ObservationService) and `docs/reference/health/README.md`. Commit — `git commit -m "chore(health): retire ScaleNutribotBridge; docs endstate"`

---

# Phase 6 — Macro & Micro Surfacing

### Task 6.1: Goals grow macro + watch-micro fields

**Files:**
- Modify: `backend/src/3_applications/health/BudgetService.mjs` (`getBudget` response), goals validation (find the goals store/shape — `grep -rn "goalsStore" backend/src/5_composition/`), `frontend/src/modules/Health/progress/ProgressView.jsx` goals form
- Test: `BudgetService.test.mjs` extension

**Interfaces:**
- Produces: goals accept `macroGoals: { proteinG, carbsG, fatG }` (numbers|null) and `watchMicros: [{ key: 'sodium'|'fiber'|'sugar'|'cholesterol', limit: number, direction: 'ceiling'|'floor' }]`. `getBudget` response gains `macros: { protein, carbs, fat, sodium, fiber, sugar, cholesterol }` (day sums over COUNTED items — same fold as `food`) and `microCoverage: { [key]: { covered, total } }` where `covered` counts items with `microsSource` set, `total` counts COUNTED items.

- [ ] **Steps: red (budget returns macros + coverage; goals round-trip) → green → commit** — `git commit -m "feat(health): budget serves day macros, goals carry macro/micro targets"`

### Task 6.2: Parse pipeline emits micros

- [ ] Extend the AI prompt (same anchor as Task 2.1) to emit `fiber/sugar/sodium/cholesterol` per item and set `microsSource: 'ai'` in the mapper; catalog quick-add path sets `microsSource: 'catalog'` when the entry has micro data (modify `FoodCatalogService.quickAdd` — read it first). Tests on the mapper + quickAdd. Commit — `git commit -m "feat(health): captures emit micros with provenance"`

### Task 6.3: MacroBarRow on Today

**Files:**
- Create: `frontend/src/modules/Health/today/MacroBarRow.jsx` + test + scss; modify `TodayView.jsx` (mount under EquationStrip), `LogTable.jsx` (per-meal subtotal line under the kcal in each Section header: `P 32 · C 41 · F 12`)

**Interfaces:**
- Consumes: `day.budget.macros`, `day.budget.goals.macroGoals`, `watchMicros`, `microCoverage`.
- Produces: one horizontal bar per macro with a goal tick (floor rendering: fill toward goal; over-goal segment uses `var(--ds-warning)`); one bar per watch micro (ceiling rendering: fill toward limit, over = `var(--ds-danger)`) with the coverage caption "based on {covered} of {total} items" when `covered < total`. Load `dataviz` skill conventions? No — this is product UI inside the app's design system; use health.scss tokens. Bars are pure CSS divs, no chart lib. All values also in `aria-label` text.

- [ ] **Steps: red → green → manual check → commit** — `git commit -m "feat(health): macro/watch-micro bars with coverage honesty"`

### Task 6.4: Docs. Update README (goal fields, coverage rule). Commit.

---

# Phase 7 — Food Icons

### Task 7.1: Manifest curation

**Files:**
- Create: `cli/curate-nutrition-icons.mjs` (scan `media/img/nutrition/icons` recursively; skip `Case Conflict` files; slugify basenames; on slug collision prefer the shallower/cleaner path and log the loser; emit YAML draft `{ icons: { <slug>: { path: '<relative path>' } } }`), output to `docs/_wip/2026-09-XX-icon-manifest-draft.yml`
- The reviewed manifest lands in the data mount at `data/household/apps/health/icon-manifest.yml` (per-app subdirs under `apps/{app}/` are used directly — CLAUDE.md; write via `sudo docker exec` heredoc on prod, plain write on dev ACLs)

- [ ] **Steps: write + run the script; eyeball the draft (expect ~500+ slugs after dedupe); install the manifest; also merge the existing flat `getPath('icons')/food` vocabulary — for each of its 310 slugs absent from the new set, add an alias entry `{ <old-slug>: { path: <hi-res equivalent or old file> } }` so stored `FoodItem.icon` slugs keep resolving. Commit the script only** — `git commit -m "feat(health): icon-manifest curation script"`

### Task 7.2: Manifest store + serving route

**Files:**
- Create: `backend/src/1_adapters/persistence/IconManifestStore.mjs` (loads the YAML once, `resolve(slug) → { absolutePath } | null` joining against the media root from dataService/config — find how other code resolves `media/` paths: `grep -rn "getPath('icons')" backend/src/`) + test (temp manifest fixture)
- Modify: `backend/src/4_api/v1/routers/health.mjs` — `GET /nutrition/icons/:slug` (slug regex `/^[a-z0-9][a-z0-9-_]*$/i`, 404 on miss, long cache headers, streams the PNG)

- [ ] **Steps: red → green → commit** — `git commit -m "feat(health): icon manifest store + serving endpoint"`

### Task 7.3: Agent assignment + catalog icon field

**Files:**
- Modify: the parse prompt/mapper (Task 2.1 anchor) — inject the manifest slug list (truncate to names only) and require each item's `icon` be chosen from it; `backend/src/2_domains/health/entities/FoodCatalogEntry.mjs` (add `icon` field — read the entity first; it has none) and `FoodCatalogService` (`quickAdd` copies catalog icon onto the row; catalog entries get icon backfilled when a parse commits a food matching an entry — find the existing name-match path in `backfill`)
- Tests: entity + service extensions

- [ ] **Steps: red → green → commit** — `git commit -m "feat(health): AI icon assignment; catalog carries icons"`

### Task 7.4: Icons in the UI + override

**Files:**
- Modify: `EntryRow.jsx` (icon `<img src=api/v1/health/nutrition/icons/{row.icon}>` with `onError` hiding to the neutral dot fallback — the existing Noom dot remains the fallback glyph), `EntryEditSheet.jsx` (icon section: current icon + "Change…" opens a small searchable grid fed by a new `GET /nutrition/icons?q=` manifest-list endpoint; picking asks `Just this entry` / `Always for this food` — the latter also PUTs the catalog favorite-style endpoint: add `PUT /nutrition/catalog/icon { name, icon }` beside the favorite route), group rows use their own icon else first child's
- Tests: EntryRow fallback behavior; router test for the two new endpoints

- [ ] **Steps: red → green → manual → commit** — `git commit -m "feat(health): row icons with entry/always override"`

### Task 7.5: Docs. README icons section (manifest ownership, alias rule, fallback). Commit.

---

# Phase 8 — Viz & Layout

### Task 8.1: Batched budget range endpoint

**Files:**
- Modify: `backend/src/3_applications/health/BudgetService.mjs` — add `getBudgetRange(userId, from, to)`; `backend/src/4_api/v1/routers/health.mjs` — `GET /budget/range?from=&to=` (validate dates, cap 62 days, per-day errors → `{ date, error: code }` gaps not 500s)
- Test: `BudgetService.test.mjs` extension

**Interfaces:**
- Produces: `[{ date, budget, food, exercise, remaining, status, macros: { protein, carbs, fat } }]` — loads goals + weight data ONCE, iterates dates; nutrilist via one `findByDateRange` call folded per-day (COUNTED filter identical to `getBudget`); workouts per day via the existing store call. Dates with no weight → `{ date, error: 'NO_WEIGHT_DATA' }`.

- [ ] **Steps: red (3-day range with one gap) → green → commit** — `git commit -m "feat(health): batched budget range endpoint"`

### Task 8.2: WeekStrip → per-day bars

**Files:**
- Rewrite: `frontend/src/modules/Health/today/WeekStrip.jsx` + `WeekStrip.test.jsx`, scss

**Interfaces:**
- Consumes: ONE `api/v1/health/budget/range?from=&to=` call (replaces the 7 parallel calls at line 44).
- Produces: 7 cells, each: weekday letter, day number, a vertical bar whose height = `min(food/budget, 1.25)` of the cell's bar area, hue = under (`--ds-success`) / over (`--ds-danger`) / gap (`--ds-text-low` hollow); today ringed; `aria-label` includes kcal + status. No macro segments in the strip (PRD F7.1 honest-encoding rule) — macros stay in the tapped day.

- [ ] **Steps: red → green → manual → commit** — `git commit -m "feat(health): week strip as budget bars off the range endpoint"`

### Task 8.3: Weight widget

**Files:**
- Create: `frontend/src/modules/Health/today/WeightChip.jsx` + test (SWR on the existing `GET /api/v1/health/weight` — read the router handler at line 188 first for its response shape; sparkline = inline SVG polyline of the last 30 raw entries + a second polyline of `lbs_adjusted_average`, trend delta = adjusted average now vs 7 days ago)
- Modify: `TodayView.jsx` (mobile placement: compact row under MacroBarRow)

- [ ] **Steps: red → green → commit** — `git commit -m "feat(health): weight + trend chip with sparkline"`

### Task 8.4: Layout — max width + right sidebar

**Files:**
- Modify: `frontend/src/modules/Health/health.scss` (`.health-today { max-width: 720px; margin-inline: auto; }`; at `min-width: 1100px` a grid `1fr 320px` with `.health-today__aside`), `TodayView.jsx` (render `<aside className="health-today__aside">` containing WeightChip, MacroBarRow's expanded detail, WeekStrip's month cousin — reuse `budget/range` for a 30-day bar block — and the intake-vs-burn block from Task 8.5; on narrow viewports the aside contents that duplicate main-column widgets are hidden via CSS, single source in JSX)

- [ ] **Steps: implement; verify with TWO Playwright screenshots (390px and 1440px widths — jsdom cannot see this); commit** — `git commit -m "feat(health): capped column + desktop sidebar"`

### Task 8.5: Intake-vs-burn over time

- [ ] Create `frontend/src/modules/Health/progress/IntakeBurnChart.jsx` + test — 30-day paired bars (food down-bar, exercise up-bar) off `budget/range`; mount in ProgressView and in the desktop aside. Also refactor ProgressView's 14-day adherence effect onto the range endpoint (kills the other parallel-call storm — read the effect first). Commit — `git commit -m "feat(health): intake-vs-burn chart; progress on range endpoint"`

### Task 8.6: Docs. README viz/layout endstate. Commit.

---

# Phase 9 — Quick Add

### Task 9.1: Bucket-aware zero-query suggest

**Files:**
- Modify: `backend/src/3_applications/health/FoodCatalogService.mjs` (`suggest(query, userId, limit, { bucket })`; `quickAdd(catalogEntryId, userId, { mealTime })` records per-bucket usage), catalog entry shape gains `usageByBucket: { [mealTime]: { count, lastUsed } }` (thread through the catalog store's persistence — read `FoodCatalogService` fully first; it owns its entry shape), router (`suggest` passes `bucket` query param; `quickadd` accepts `mealTime` in body and uses it directly — retiring the frontend's follow-up PUT)
- Test: `FoodCatalogService.suggest.test.mjs` + `FoodCatalogService.quickAdd.test.mjs` extensions

**Interfaces:**
- Produces: empty-query suggest with `bucket` returns up to `limit` ranked: favorites first (shipped contract), then blended per-bucket score `0.6 * bucketFrequency + 0.4 * recencyDecay(lastUsedInBucket)` (frequency normalized over 90 days; decay half-life 14 days), global score backfilling when bucket history < 5 entries. `quickAdd(..., { mealTime })` writes the row with that `mealTime` AND `settled: true, settledBy: 'user'` (deliberate pick — PRD F8.3), quantity = last quantity for that food in that bucket when recorded, else catalog default.

- [ ] **Steps: red (bucket ranking, backfill, settled row, mealTime direct) → green → commit** — `git commit -m "feat(health): bucket-aware quick-add suggest + direct mealTime"`

### Task 9.2: Combobox opens with suggestions

**Files:**
- Modify: `frontend/src/modules/Health/today/AddCombobox.jsx` + test

**Interfaces:**
- Produces: on mount (empty text), fetch `catalog/suggest?bucket={bucketId}` and show the list immediately; typing switches to the query path as today. `pick()` calls quickadd with `{ catalogEntryId, mealTime: bucketId }` and drops the follow-up PUT (lines 44–46). Suggestion rows show the icon (Phase 7) and kcal.

- [ ] **Steps: red → green → manual (open Breakfast add: regulars appear with zero keystrokes) → commit** — `git commit -m "feat(health): zero-typing quick add"`

### Task 9.3: Docs. README quick-add ranking contract. Commit.

---

# Phase 10 — Smart Meal Templates

### Task 10.1: Template model + service

**Files:**
- Create: `backend/src/3_applications/health/TemplateService.mjs` + test; a `mealsStore`-style YAML store or extend the existing meals store file (find it: `grep -rn "mealsStore" backend/src/5_composition/`) with a parallel `templates` collection

**Interfaces:**
- Produces: template `{ id, name, icon, components: [{ name, role: 'core'|'variant', calories, protein, carbs, fat, color, icon, grams, unit, amount }], createdAt, useCount, lastUsed, source: 'manual'|'curated' }`. `list`, `create`, `remove`, and `instantiate(id, userId, { date, mealTime, variantNames: [] }) → { groupUuid, items }` — writes ONE `kind:'group'` row (label = template name, settled:true) + core rows + chosen variant rows as children via `nutriListStore.saveMany` (mirror `SavedMealsService.logToDate`'s row shape, adding `kind`/`parentId`/`settled: true`).

- [ ] **Steps: red → green → commit** — `git commit -m "feat(health): meal templates with core/variant instantiation"`

### Task 10.2: Saved-meals migration

- [ ] Create `cli/migrate-saved-meals-to-templates.mjs`: reads saved meals via the meals store, writes each as an all-core `source:'manual'` template, idempotent (skips names that already exist), prints a summary, does NOT delete the originals (the meals endpoints stay — copy-to-today transport). Run it on dev, verify, commit script — `git commit -m "feat(health): saved-meal → template migration script"`

### Task 10.3: Template mining

**Files:**
- Create: `backend/src/2_domains/nutrition/services/TemplateMiner.mjs` + test (pure); `backend/src/3_applications/health/TemplateCurationJob.mjs` + test; register on the app's job scheduler (find how existing jobs register: `ls backend/src/3_applications/nutribot/jobs/` and grep the composition root; weekly cadence)

**Interfaces:**
- Produces: `mineTemplates({ rows, existingTemplateNames, dismissedKeys, windowDays: 90 }) → proposals[]` — co-occurrence = same bucket same day OR same `parentId`; a combo needs ≥6 occurrences; component `role: 'core'` at ≥70% presence, `'variant'` at 20–70%, dropped below; proposal key = sorted core-name hash; dedup against existing template names and dismissed keys. Job writes proposals to the template store with `status: 'proposed'`; endpoints `GET /nutrition/templates?includeProposed=1`, `POST /nutrition/templates/:id/approve { name }`, `POST /nutrition/templates/:id/dismiss` (dismiss persists the key forever).

- [ ] **Steps: red (miner rules incl. dedup + dismissal) → green → job wiring → commit** — `git commit -m "feat(health): template mining with persistent dismissals"`

### Task 10.4: Template picker replaces SavedMealsSheet

**Files:**
- Create: `frontend/src/modules/Health/today/TemplatePicker.jsx` + test (list templates with icons + item counts; proposals section on top with Approve/Dismiss; picking a template shows variant toggles then Log — instantiates into the launch bucket); modify `TodayView.jsx`/`AddCombobox.jsx` (the "Saved meals ▸" affordance becomes "Meals & templates ▸"), delete `SavedMealsSheet.jsx` + test after parity
- Modify: `AddCombobox.jsx` — suggest list merges template name matches ranked per PRD F6.4 (favorites → templates → rest; backend: suggest response gains `type: 'food'|'template'` entries — extend Task 9.1's endpoint)

- [ ] **Steps: red → green → manual (smoothie flow: propose→approve→one-tap log→toggle mango) → commit** — `git commit -m "feat(health): template picker with variant toggles"`

### Task 10.5: Docs + program close-out

- [ ] Update `docs/reference/health/README.md` (templates, mining parameters) and mark the PRD's build-order table as delivered. Run the full gates: `npx vitest run backend/src/ frontend/src/`, `npm run audit:ui`, Playwright flow smoke if `tests/live/flow/health/` exists. Update `docs/docs-last-updated.txt`. Commit — `git commit -m "docs(health): usability program endstate"`

---

## Self-review notes (already applied)

- Spec coverage: F1.1–F9.3 map to Phases 4/2/1/6/7/10/8/9/3 respectively; A1–A4 are embedded in Tasks 1.3, 2.4, 4.2, 6.3 (non-color cues, ≥44px, chips-not-sliders). U2.4 (two plates → two sibling groups) rides Task 2.1's mapper (`dishes[]` naturally yields siblings).
- Deliberately deferred beyond this program: none — every PRD requirement has a task. Photo GC and multi-user are PRD non-goals.
- Type consistency: `settled/settledBy/settledAt/kind/parentId/photoRef/microsSource` names are identical in Tasks 0.1→0.2→0.4→1.x→2.x; `bucketForHour` divergence from `getMealTimeFromHour` is intentional and pinned (Task 4.3).
