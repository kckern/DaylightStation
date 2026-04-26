# Nutribot Date Assignment Bulletproofing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that every food log's `meal.date` reflects the AI-inferred-at-entry date — never the acceptance day, never the revision day, never the UTC day — across all edge cases (same-day accept, next-day accept, same-day revision, next-day revision with/without explicit date words, AI response missing `date` field, legacy logs).

**Architecture:** Two classes of fix. (1) **Accept-time fallback hardening**: when `AcceptFoodLog` sees a log without `meal.date`, it must derive the date from `createdAt` — never from `now`. (2) **Revision-time pinning**: when `LogFoodFromText` handles a revision, the AI prompt's "today is X" context must be pinned to the **original log's `createdAt` date**, not the current wall clock, so the AI's default date output continues to match the original log unless the user's revision text explicitly says otherwise. Plus a persistence-layer guard that throws on items with missing dates, so future regressions fail loudly instead of silently bucketing to UTC today.

**Tech Stack:** Node ESM (`.mjs`), Jest with `--experimental-vm-modules`, DDD layers (domain entity `NutriLog`, application use-cases under `backend/src/3_applications/nutribot/usecases/`, YAML persistence under `backend/src/1_adapters/persistence/yaml/`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs` | Accept-use-case — date resolution on accept | Modify |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs` | Text log use-case — revision & initial parse | Modify |
| `backend/src/2_domains/nutrition/entities/NutriLog.mjs` | Domain entity — `updateDate`, `toNutriListItems`, `toJSON` | Modify (small cleanup) |
| `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs` | Persistence — `saveMany` | Modify (add guard) |
| `backend/src/3_applications/nutribot/lib/deriveLogDate.mjs` | **New** helper: `deriveLogDate(log, timezone)` — single source of truth for "what date does this log belong to?" | Create |
| `tests/isolated/nutribot/date-bulletproof.test.mjs` | **New** regression suite covering all edge cases | Create |

`deriveLogDate` is the one new abstraction. It exists because four call sites (`AcceptFoodLog`, `LogFoodFromText` initial, `LogFoodFromText` revision prompt, `YamlNutriListDatastore` guard) need the exact same "given a log, what's its authoritative date?" logic, and inlining it four times is how the current bugs got in.

---

## Task 1: Write the failing regression test suite

**Files:**
- Create: `tests/isolated/nutribot/date-bulletproof.test.mjs`

- [ ] **Step 1: Create the test file with all edge case scenarios**

```javascript
/**
 * Date Bulletproofing Regression Tests
 *
 * Verifies that meal.date is assigned correctly across all combinations
 * of entry-day, accept-day, revision-day, and user text.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { LogFoodFromText } from '#apps/nutribot/usecases/LogFoodFromText.mjs';
import { AcceptFoodLog } from '#apps/nutribot/usecases/AcceptFoodLog.mjs';
import { NutriLog } from '#domains/nutrition/entities/NutriLog.mjs';

// Fixed clocks for deterministic date behavior
const THU_NOON_PT = new Date('2026-04-16T19:00:00Z'); // Thu 12:00 PT
const FRI_NOON_PT = new Date('2026-04-17T19:00:00Z'); // Fri 12:00 PT

function mockClock(date) {
  jest.useFakeTimers();
  jest.setSystemTime(date);
}

function resetClock() {
  jest.useRealTimers();
}

function buildTextDeps(aiResponseForInitial, aiResponseForRevision = null) {
  const messagingGateway = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    updateMessage: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue({}),
  };
  const aiGateway = {
    chat: jest.fn()
      .mockResolvedValueOnce(aiResponseForInitial)
      .mockResolvedValueOnce(aiResponseForRevision || aiResponseForInitial),
  };
  let savedLog = null;
  const foodLogStore = {
    save: jest.fn().mockImplementation(async (log) => { savedLog = log; }),
    findByUuid: jest.fn().mockImplementation(async () => savedLog),
    updateStatus: jest.fn().mockResolvedValue({}),
  };
  const conversationStateStore = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue({}),
    clear: jest.fn().mockResolvedValue({}),
  };
  const responseContext = {
    sendMessage: jest.fn().mockResolvedValue({ messageId: 'ctx-1' }),
    updateMessage: jest.fn().mockResolvedValue({}),
    deleteMessage: jest.fn().mockResolvedValue({}),
    createStatusIndicator: jest.fn().mockResolvedValue({
      messageId: 'status-1',
      finish: jest.fn().mockResolvedValue({}),
    }),
  };
  return {
    messagingGateway, aiGateway, foodLogStore, conversationStateStore, responseContext,
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    config: {
      getDefaultTimezone: () => 'America/Los_Angeles',
      getUserTimezone: () => 'America/Los_Angeles',
    },
    encodeCallback: (cmd, data) => JSON.stringify({ cmd, ...data }),
    getSavedLog: () => savedLog,
  };
}

function aiJson(date, items = [{ name: 'Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 100, calories: 50, protein: 3, carbs: 9, fat: 0 }]) {
  return JSON.stringify({ date, time: 'morning', items });
}

describe('Date bulletproofing — initial logging', () => {
  afterEach(() => resetClock());

  it('uses AI-inferred date when user says "yesterday I ate" on Thursday', async () => {
    mockClock(THU_NOON_PT);
    const deps = buildTextDeps(aiJson('2026-04-15'));
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({
      userId: 'u1', conversationId: 'c1', text: 'yesterday I ate peas', messageId: 'm1',
      responseContext: deps.responseContext,
    });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-15');
  });

  it('falls back to today (entry date) when AI omits date field', async () => {
    mockClock(THU_NOON_PT);
    const aiNoDate = JSON.stringify({
      items: [{ name: 'Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 100, calories: 50, protein: 3, carbs: 9, fat: 0 }],
    });
    const deps = buildTextDeps(aiNoDate);
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({
      userId: 'u1', conversationId: 'c1', text: 'peas', messageId: 'm1',
      responseContext: deps.responseContext,
    });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16'); // entry day
  });
});

describe('Date bulletproofing — accept', () => {
  afterEach(() => resetClock());

  it('preserves original meal.date when accepted same day', async () => {
    mockClock(THU_NOON_PT);
    const log = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas', items: [],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: THU_NOON_PT,
    });
    const deps = buildAcceptDeps(log);
    const useCase = new AcceptFoodLog(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', logUuid: log.id });
    expect(deps.savedItemDates).toEqual(['2026-04-16']);
  });

  it('preserves original meal.date when accepted next day', async () => {
    // Log created Thu, accepted Fri
    mockClock(THU_NOON_PT);
    const log = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas',
      items: [{ label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: THU_NOON_PT,
    });
    const deps = buildAcceptDeps(log);
    mockClock(FRI_NOON_PT);
    const useCase = new AcceptFoodLog(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', logUuid: log.id });
    expect(deps.savedItemDates).toEqual(['2026-04-16']); // NOT 2026-04-17
  });

  it('derives date from createdAt when meal.date is missing (legacy log)', async () => {
    // Simulate legacy log without meal.date — forge via JSON round-trip
    mockClock(THU_NOON_PT);
    const log = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas',
      items: [{ label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: THU_NOON_PT,
    });
    // Forge a log with missing meal.date but valid createdAt
    const broken = { ...log.toJSON(), meal: { time: 'afternoon' } };
    const deps = buildAcceptDeps({ ...log, meal: { time: 'afternoon' }, toJSON: () => broken });
    mockClock(FRI_NOON_PT);
    const useCase = new AcceptFoodLog(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', logUuid: log.id });
    expect(deps.savedItemDates).toEqual(['2026-04-16']); // derived from createdAt, NOT 2026-04-17
  });
});

describe('Date bulletproofing — revision', () => {
  afterEach(() => resetClock());

  it('revision on next day with no date words preserves original date', async () => {
    // Log created Thu, revised Fri with "add a banana" (no date mention)
    mockClock(THU_NOON_PT);
    const deps = buildTextDeps(
      aiJson('2026-04-16'), // initial
      aiJson('2026-04-17', [ // revision — AI would default to "today" if prompt says today=Fri
        { name: 'Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 100, calories: 50, protein: 3, carbs: 9, fat: 0 },
        { name: 'Banana', noom_color: 'yellow', quantity: 1, unit: 'g', grams: 100, calories: 90, protein: 1, carbs: 23, fat: 0 },
      ]),
    );
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'peas', messageId: 'm1', responseContext: deps.responseContext });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16');

    // Now revise on Friday
    mockClock(FRI_NOON_PT);
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'revision',
      flowState: { pendingLogUuid: deps.getSavedLog().id, originalMessageId: 'orig' },
    });
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'add a banana', messageId: 'm2', responseContext: deps.responseContext });

    // AFTER FIX: date should still be Thursday
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16');

    // Verify the revision prompt pinned "today" to original createdAt (Thu)
    const revisionCall = deps.aiGateway.chat.mock.calls[1];
    const systemPrompt = revisionCall[0].find(m => m.role === 'system').content;
    expect(systemPrompt).toContain('2026-04-16'); // the pinned date
  });

  it('revision with explicit "yesterday" relative to ORIGINAL date moves correctly', async () => {
    // Log created Thu as Thu, then revised saying "actually that was yesterday"
    // → should become Wed (Thu - 1), not "yesterday-from-Fri" (= Thu, same as before)
    mockClock(THU_NOON_PT);
    const deps = buildTextDeps(
      aiJson('2026-04-16'),
      aiJson('2026-04-15'), // AI correctly subtracts 1 from pinned Thu
    );
    const useCase = new LogFoodFromText(deps);
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'peas', messageId: 'm1', responseContext: deps.responseContext });

    mockClock(FRI_NOON_PT);
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'revision',
      flowState: { pendingLogUuid: deps.getSavedLog().id, originalMessageId: 'orig' },
    });
    await useCase.execute({ userId: 'u1', conversationId: 'c1', text: 'actually that was yesterday', messageId: 'm2', responseContext: deps.responseContext });

    expect(deps.getSavedLog().meal.date).toBe('2026-04-15'); // Wed
  });
});

// buildAcceptDeps helper
function buildAcceptDeps(nutriLog) {
  const savedItemDates = [];
  return {
    savedItemDates,
    messagingGateway: {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'm' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
    },
    foodLogStore: {
      findByUuid: jest.fn().mockResolvedValue(nutriLog),
      updateStatus: jest.fn().mockResolvedValue({}),
      findPending: jest.fn().mockResolvedValue([]),
    },
    nutriListStore: {
      saveMany: jest.fn().mockImplementation(async (items) => {
        for (const it of items) savedItemDates.push(it.date);
      }),
    },
    conversationStateStore: { clear: jest.fn().mockResolvedValue({}) },
    generateDailyReport: { execute: jest.fn().mockResolvedValue({}) },
    config: { getDefaultTimezone: () => 'America/Los_Angeles' },
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}
```

- [ ] **Step 2: Run the suite; verify every test fails for the right reason**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/date-bulletproof.test.mjs --runInBand`

Expected: every test fails. Specifically:
- "falls back to today when AI omits date" — passes already (current parseFoodResponse defaults to today)
- "preserves meal.date when accepted next day" — passes already (AcceptFoodLog uses `meal.date` first)
- "derives date from createdAt when meal.date missing" — **fails** (current fallback is `now.toISOString()`, so returns Fri not Thu)
- "revision on next day with no date words preserves original date" — **fails** (current code shifts to Fri)
- "revision with explicit yesterday relative to ORIGINAL date moves correctly" — **fails** (current code treats yesterday relative to Fri=Thu, not Thu=Wed)

- [ ] **Step 3: Commit the failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/isolated/nutribot/date-bulletproof.test.mjs
git commit -m "test(nutribot): add date-bulletproof regression suite (failing)"
```

---

## Task 2: Create the `deriveLogDate` helper

**Files:**
- Create: `backend/src/3_applications/nutribot/lib/deriveLogDate.mjs`
- Test: `tests/isolated/nutribot/deriveLogDate.test.mjs`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/isolated/nutribot/deriveLogDate.test.mjs`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { deriveLogDate } from '#apps/nutribot/lib/deriveLogDate.mjs';

describe('deriveLogDate', () => {
  it('returns meal.date when present', () => {
    const log = { meal: { date: '2026-04-16' }, createdAt: '2026-04-16 12:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('falls back to date portion of createdAt when meal.date is missing', () => {
    const log = { meal: { time: 'morning' }, createdAt: '2026-04-16 12:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('falls back to date portion of createdAt when meal is entirely missing', () => {
    const log = { createdAt: '2026-04-16 12:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('handles ISO-format createdAt with T separator', () => {
    const log = { createdAt: '2026-04-16T19:00:00Z' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2026-04-16');
  });

  it('throws when both meal.date and createdAt are missing', () => {
    expect(() => deriveLogDate({}, 'America/Los_Angeles')).toThrow(/cannot derive date/i);
  });

  it('throws when createdAt is not a parseable date string', () => {
    expect(() => deriveLogDate({ createdAt: 'not-a-date' }, 'America/Los_Angeles')).toThrow(/cannot derive date/i);
  });

  it('never returns current wall-clock date as fallback', () => {
    // Pathological input: use arbitrary past createdAt, ensure output matches, not today
    const log = { createdAt: '2020-01-01 00:00:00' };
    expect(deriveLogDate(log, 'America/Los_Angeles')).toBe('2020-01-01');
  });
});
```

- [ ] **Step 2: Run to confirm they fail (module not found)**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/deriveLogDate.test.mjs --runInBand`

Expected: FAIL with "Cannot find module '#apps/nutribot/lib/deriveLogDate.mjs'"

- [ ] **Step 3: Write the implementation**

Create `backend/src/3_applications/nutribot/lib/deriveLogDate.mjs`:

```javascript
/**
 * Derive the authoritative date for a food log.
 *
 * The persistence layer stores `meal.date` as a `YYYY-MM-DD` string. When it's
 * missing (legacy logs, corrupted writes, migration artifacts), we fall back to
 * the date portion of `createdAt` — the moment the log was entered.
 *
 * We NEVER fall back to the current wall-clock time. Accept-day and revision-day
 * are irrelevant to what date the meal belongs to.
 *
 * @param {object} log - A NutriLog or its JSON representation. Must expose
 *                       `meal` (possibly missing `date`) and `createdAt`.
 * @param {string} timezone - IANA timezone used for formatting createdAt fallback.
 * @returns {string} Date in YYYY-MM-DD format.
 * @throws {Error} If neither meal.date nor a parseable createdAt exists.
 */
export function deriveLogDate(log, timezone = 'America/Los_Angeles') {
  const mealDate = log?.meal?.date;
  if (typeof mealDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mealDate)) {
    return mealDate;
  }

  const createdAt = log?.createdAt;
  if (typeof createdAt === 'string' && createdAt.length >= 10) {
    // Handle both "2026-04-16 12:00:00" and "2026-04-16T19:00:00Z"
    const parsed = new Date(createdAt.replace(' ', 'T'));
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-CA', { timeZone: timezone });
    }
    // Or just slice if it's already a local date string
    const sliced = createdAt.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sliced)) {
      return sliced;
    }
  }

  throw new Error(
    `deriveLogDate: cannot derive date for log id=${log?.id ?? '?'} — ` +
    `meal.date and createdAt are both missing or invalid.`
  );
}

export default deriveLogDate;
```

- [ ] **Step 4: Run and confirm they pass**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/deriveLogDate.test.mjs --runInBand`

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/nutribot/lib/deriveLogDate.mjs tests/isolated/nutribot/deriveLogDate.test.mjs
git commit -m "feat(nutribot): add deriveLogDate helper for authoritative log-date resolution"
```

---

## Task 3: Harden `AcceptFoodLog` to use `deriveLogDate` (no accept-day fallback)

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs` (lines 90-106, 116)

- [ ] **Step 1: Run the failing bulletproof test for legacy-log fallback**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/date-bulletproof.test.mjs -t "derives date from createdAt when meal.date is missing" --runInBand`

Expected: FAIL — returns 2026-04-17 (Fri, the mocked accept day) instead of 2026-04-16 (Thu, the createdAt day).

- [ ] **Step 2: Replace the fallback in `AcceptFoodLog.mjs`**

Find (lines 90-106):
```javascript
      // 4. Add items to nutrilist
      if (this.#nutriListStore && nutriLog.items?.length > 0) {
        const now = new Date();
        const fallbackDate = now.toISOString().split('T')[0];
        const logDate = nutriLog.meal?.date || nutriLog.date || fallbackDate;

        this.#logger.debug?.('acceptLog.savingToNutrilist', { logUuid, logDate });

        const listItems = nutriLog.items.map(item => ({
          ...(typeof item.toJSON === 'function' ? item.toJSON() : item),
          userId,
          chatId: conversationId,
          logUuid: logUuid,
          date: logDate,
        }));
        await this.#nutriListStore.saveMany(listItems);
      }
```

Replace with:
```javascript
      // 4. Add items to nutrilist
      if (this.#nutriListStore && nutriLog.items?.length > 0) {
        const timezone = this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
        const logDate = deriveLogDate(
          typeof nutriLog.toJSON === 'function' ? nutriLog.toJSON() : nutriLog,
          timezone,
        );

        this.#logger.debug?.('acceptLog.savingToNutrilist', { logUuid, logDate });

        const listItems = nutriLog.items.map(item => ({
          ...(typeof item.toJSON === 'function' ? item.toJSON() : item),
          userId,
          chatId: conversationId,
          logUuid: logUuid,
          date: logDate,
        }));
        await this.#nutriListStore.saveMany(listItems);
      }
```

Also find (line 116):
```javascript
          const logDate = nutriLog.meal?.date || nutriLog.date;
          const dateHeader = logDate ? formatDateHeader(logDate, { now: new Date() }).replace('🕒', '✅') : '';
```

Replace with:
```javascript
          const timezone = this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
          let logDate = null;
          try {
            logDate = deriveLogDate(
              typeof nutriLog.toJSON === 'function' ? nutriLog.toJSON() : nutriLog,
              timezone,
            );
          } catch (e) {
            this.#logger.warn?.('acceptLog.dateHeader.deriveFailed', { error: e.message });
          }
          const dateHeader = logDate ? formatDateHeader(logDate, { now: new Date() }).replace('🕒', '✅') : '';
```

And update the autoreport date reference (line 150):
Find:
```javascript
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              date: nutriLog.meal?.date || nutriLog.date,
              responseContext,
            });
```

Replace with:
```javascript
            const timezone = this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
            let reportDate;
            try {
              reportDate = deriveLogDate(
                typeof nutriLog.toJSON === 'function' ? nutriLog.toJSON() : nutriLog,
                timezone,
              );
            } catch {
              reportDate = undefined;
            }
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              date: reportDate,
              responseContext,
            });
```

- [ ] **Step 3: Add the import at the top of `AcceptFoodLog.mjs`**

After the existing import (line 8):
```javascript
import { formatFoodList, formatDateHeader } from '#domains/nutrition/entities/formatters.mjs';
```

Add:
```javascript
import { deriveLogDate } from '../lib/deriveLogDate.mjs';
```

- [ ] **Step 4: Run the bulletproof tests — all three accept-* tests should now pass**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/date-bulletproof.test.mjs -t "Date bulletproofing — accept" --runInBand`

Expected: all 3 accept-related tests PASS.

- [ ] **Step 5: Run the full nutribot test suite to confirm no regression**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/ --runInBand`

Expected: all previously-passing tests still pass; the revision-* tests still fail (fixed in Task 4).

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs
git commit -m "fix(nutribot): use deriveLogDate in AcceptFoodLog — never fall back to accept-day"
```

---

## Task 4: Pin revision-prompt "today" to original log's createdAt date

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs` (`#buildDetectionPrompt`, `#parseFoodResponse`, `#handleRevisionDirect`, `#tryRevisionFallback`, `#handleRevision`)

- [ ] **Step 1: Run the two revision tests to see the current failures**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/date-bulletproof.test.mjs -t "revision" --runInBand`

Expected:
- "revision on next day with no date words preserves original date" — FAIL (date shifts to 2026-04-17)
- "revision with explicit yesterday" — FAIL (AI receives today=Fri, emits Thu instead of Wed)

- [ ] **Step 2: Add `asOfDate` parameter to `#buildDetectionPrompt`**

In `LogFoodFromText.mjs`, find (around line 382):
```javascript
  #buildDetectionPrompt(userText, portionBoost = '') {
    const timezone = this.#getTimezone();
    const { today, dayOfWeek, timeAMPM, unix, time } = getCurrentTimeDetails(timezone);
```

Replace with:
```javascript
  #buildDetectionPrompt(userText, portionBoost = '', asOfDate = null) {
    const timezone = this.#getTimezone();
    const live = getCurrentTimeDetails(timezone);
    // When pinning the prompt to a specific "as of" date (revision flow), synthesize
    // the dayOfWeek/timeAMPM context from that date instead of the live wall clock.
    const { today, dayOfWeek, timeAMPM, unix, time } = asOfDate
      ? pinnedTimeDetails(asOfDate, timezone)
      : live;
```

And add a `pinnedTimeDetails` helper near the existing `getCurrentTimeDetails` at the top of the file (around line 29, after `getCurrentTimeDetails`):

```javascript
/**
 * Produce time-details for a pinned date string, emulating getCurrentTimeDetails()
 * but anchored to the given YYYY-MM-DD instead of the wall clock. Used for revision
 * prompts so the AI's "today" context matches the ORIGINAL log's creation day.
 */
function pinnedTimeDetails(dateStr, timezone = 'America/Los_Angeles') {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Noon UTC on the target date — avoids timezone edge cases that could shift the day.
  const pinned = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const today = dateStr;
  const dayOfWeek = pinned.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
  const timeAMPM = '12:00 PM';
  const hourOfDay = 12;
  const unix = Math.floor(pinned.getTime() / 1000);
  const time = 'midday';
  return { today, timezone, dayOfWeek, timeAMPM, hourOfDay, unix, time };
}
```

- [ ] **Step 3: Add `asOfDate` parameter to `#parseFoodResponse`**

Find (line 439):
```javascript
  #parseFoodResponse(response) {
    const { today } = getCurrentTimeDetails(this.#getTimezone());
```

Replace with:
```javascript
  #parseFoodResponse(response, asOfDate = null) {
    const { today } = asOfDate
      ? { today: asOfDate }
      : getCurrentTimeDetails(this.#getTimezone());
```

(Every `today` reference in the method body remains unchanged — they now transparently use the pinned value when `asOfDate` is provided.)

- [ ] **Step 4: Thread `asOfDate` through `#handleRevisionDirect`**

Find in `#handleRevisionDirect` (around line 678):
```javascript
      // 4. Call AI with revision-aware prompt
      const prompt = this.#buildDetectionPrompt(contextualText);
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

      // 5. Parse response
      const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response);
```

Replace with:
```javascript
      // 4. Call AI with revision-aware prompt — PIN "today" to the ORIGINAL log's
      //    createdAt date. This guarantees that if the user says nothing about
      //    dates, the AI emits the same date the log already has, and if the user
      //    says "yesterday", the AI subtracts from the original date (not from
      //    the revision-day wall clock).
      const timezone = this.#getTimezone();
      const originalDate = deriveLogDate(
        typeof targetLog.toJSON === 'function' ? targetLog.toJSON() : targetLog,
        timezone,
      );
      const prompt = this.#buildDetectionPrompt(contextualText, '', originalDate);
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

      // 5. Parse response — same pin so parse fallback also uses original date
      const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response, originalDate);
```

- [ ] **Step 5: Thread `asOfDate` through `#tryRevisionFallback`**

Find (around line 842):
```javascript
    // Call AI with contextual prompt
    const prompt = this.#buildDetectionPrompt(contextualText);
    const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

    const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response);
```

Replace with:
```javascript
    // Call AI with contextual prompt — pin "today" to original log's date (same
    // reasoning as #handleRevisionDirect)
    const timezone = this.#getTimezone();
    const originalDate = deriveLogDate(
      typeof targetLog.toJSON === 'function' ? targetLog.toJSON() : targetLog,
      timezone,
    );
    const prompt = this.#buildDetectionPrompt(contextualText, '', originalDate);
    const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

    const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response, originalDate);
```

- [ ] **Step 6: Thread `asOfDate` through `#handleRevision` (the older branch)**

Find (around line 562-569):
```javascript
    // Update the log with new items
    const revisionTimestamp = new Date();
    let updatedLog = targetLog.updateItems(foodItems, revisionTimestamp);

    // Update date if different
    const existingDate = targetLog.meal?.date || targetLog.date;
    if (logDate && logDate !== existingDate) {
      updatedLog = updatedLog.updateDate(logDate, aiTime, revisionTimestamp);
    }
```

(This branch receives `logDate` from the caller. The caller already parsed the AI response with the OLD unpinned prompt. Since `#handleRevisionDirect` is the primary revision path and `#handleRevision` is a legacy fallback, we also pin it. But the change is at the call site — `execute()` — not here.)

Find in `execute()` (around line 174):
```javascript
      const prompt = this.#buildDetectionPrompt(text, portionBoost);
      this.#logger.debug?.('logText.aiPrompt', { conversationId, text });

      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });
      this.#logger.debug?.('logText.aiResponse', { conversationId, response: response?.substring?.(0, 500) });

      // 3. Parse response into food items and date
      const { items: foodItems, date: aiDate } = this.#parseFoodResponse(response);
```

Replace with:
```javascript
      // If this path reaches here in revision mode (short-circuit didn't fire),
      // pin the prompt to the existing log's date to prevent date drift.
      let asOfDateForRevision = null;
      if (isRevisionMode && pendingLogUuid && this.#foodLogStore) {
        try {
          const existing = await this.#foodLogStore.findByUuid(pendingLogUuid, userId);
          if (existing) {
            asOfDateForRevision = deriveLogDate(
              typeof existing.toJSON === 'function' ? existing.toJSON() : existing,
              this.#getTimezone(),
            );
          }
        } catch (e) {
          this.#logger.debug?.('logText.asOfDate.deriveFailed', { error: e.message });
        }
      }

      const prompt = this.#buildDetectionPrompt(text, portionBoost, asOfDateForRevision);
      this.#logger.debug?.('logText.aiPrompt', { conversationId, text, asOfDateForRevision });

      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });
      this.#logger.debug?.('logText.aiResponse', { conversationId, response: response?.substring?.(0, 500) });

      // 3. Parse response into food items and date — same pin
      const { items: foodItems, date: aiDate } = this.#parseFoodResponse(response, asOfDateForRevision);
```

- [ ] **Step 7: Add the import at the top of `LogFoodFromText.mjs`**

After the existing imports (around line 11), add:
```javascript
import { deriveLogDate } from '../lib/deriveLogDate.mjs';
```

- [ ] **Step 8: Run the revision tests — both should pass now**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/date-bulletproof.test.mjs -t "revision" --runInBand`

Expected: both revision tests PASS.

- [ ] **Step 9: Run the full isolated nutribot suite to confirm no regression in existing revision tests**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/ --runInBand`

Expected: all tests pass. The existing `revision-flow.test.mjs` uses mocks that won't exercise the pin logic (foodLogStore.findByUuid returns a fixture log); they should continue to pass because the pin is additive — it only changes prompt text, and those tests don't assert on the full prompt.

- [ ] **Step 10: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs
git commit -m "fix(nutribot): pin revision AI prompt to original log date — no more date drift on cross-day revision"
```

---

## Task 5: Add persistence-layer guard in `YamlNutriListDatastore`

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs` (`saveMany`)
- Test: `tests/isolated/nutribot/datastore-date-guard.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/nutribot/datastore-date-guard.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';

describe('YamlNutriListDatastore date guard', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrilist-test-'));
    store = new YamlNutriListDatastore({ basePath: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when any item has no date field', async () => {
    const items = [
      { userId: 'u1', item: 'Peas', date: '2026-04-16', calories: 50 },
      { userId: 'u1', item: 'Banana', calories: 90 }, // missing date
    ];
    await expect(store.saveMany(items)).rejects.toThrow(/missing date/i);
  });

  it('throws when any item has a malformed date', async () => {
    const items = [
      { userId: 'u1', item: 'Peas', date: '2026/04/16', calories: 50 },
    ];
    await expect(store.saveMany(items)).rejects.toThrow(/malformed date/i);
  });

  it('succeeds when all items have valid YYYY-MM-DD dates', async () => {
    const items = [
      { userId: 'u1', item: 'Peas', date: '2026-04-16', calories: 50 },
      { userId: 'u1', item: 'Banana', date: '2026-04-17', calories: 90 },
    ];
    await expect(store.saveMany(items)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run — confirm failing**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/datastore-date-guard.test.mjs --runInBand`

Expected: the "throws when missing date" and "throws when malformed" tests fail (current code silently accepts undefined/malformed date). "succeeds when valid" passes.

- [ ] **Step 3: Add the guard in `saveMany`**

Open `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs`. Locate the `saveMany` method (around line 191). At the top of the method body, before any loop, add:

```javascript
    // Date integrity guard — accepting undefined or malformed dates silently
    // has caused real data to be bucketed to the wrong day. Fail loudly.
    for (const [i, item] of items.entries()) {
      if (!item.date) {
        throw new Error(`YamlNutriListDatastore.saveMany: item[${i}] missing date (logId=${item.logId ?? item.log_uuid ?? '?'})`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
        throw new Error(`YamlNutriListDatastore.saveMany: item[${i}] has malformed date "${item.date}" (expected YYYY-MM-DD)`);
      }
    }
```

- [ ] **Step 4: Run and confirm all three tests pass**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/datastore-date-guard.test.mjs --runInBand`

Expected: PASS (3 tests).

- [ ] **Step 5: Run the full nutribot isolated suite to confirm no regression**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/ --runInBand`

Expected: all tests pass. The AcceptFoodLog tests feed valid dates (from `deriveLogDate`), so they pass through the guard.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs tests/isolated/nutribot/datastore-date-guard.test.mjs
git commit -m "feat(nutribot): add date-integrity guard to YamlNutriListDatastore.saveMany"
```

---

## Task 6: Clean up `NutriLog.updateDate` stray top-level `date` prop

**Files:**
- Modify: `backend/src/2_domains/nutrition/entities/NutriLog.mjs` (lines 364-376)

This removes a confusing no-op — the top-level `date` in `updateDate()` is not read by the constructor. Small cleanup, not a behavior change, but it eliminates a future footgun.

- [ ] **Step 1: Write a test asserting the cleaned-up behavior**

Add to `tests/isolated/nutribot/date-bulletproof.test.mjs` (at the end):

```javascript
describe('NutriLog.updateDate', () => {
  it('updates meal.date and does not leak a top-level date field', () => {
    const log = NutriLog.create({
      userId: 'u1', conversationId: 'c1', text: 'peas',
      items: [{ label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-04-16', time: 'afternoon' },
      timestamp: new Date('2026-04-16T19:00:00Z'),
    });
    const updated = log.updateDate('2026-04-15', 'evening', new Date('2026-04-16T20:00:00Z'));
    const json = updated.toJSON();
    expect(json.meal.date).toBe('2026-04-15');
    expect(json.meal.time).toBe('evening');
    expect(json.date).toBeUndefined(); // no stray top-level date
  });
});
```

- [ ] **Step 2: Run — confirm it passes already (toJSON doesn't expose it, but the field is in memory)**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/date-bulletproof.test.mjs -t "does not leak" --runInBand`

Expected: PASS (the constructor ignores the stray prop, so toJSON never exposes it). Keep the test anyway as a regression anchor.

- [ ] **Step 3: Remove the stray `date` prop from `updateDate`**

Find (lines 364-376):
```javascript
  updateDate(date, time, timestamp) {
    const json = this.toJSON();
    return new NutriLog({
      ...json,
      date,
      meal: {
        ...json.meal,
        date,
        ...(time ? { time } : {}),
      },
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }
```

Replace with:
```javascript
  updateDate(date, time, timestamp) {
    const json = this.toJSON();
    return new NutriLog({
      ...json,
      meal: {
        ...json.meal,
        date,
        ...(time ? { time } : {}),
      },
      updatedAt: this.#formatTimestamp(timestamp),
    });
  }
```

- [ ] **Step 4: Run the full nutribot suite**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/ --runInBand`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/2_domains/nutrition/entities/NutriLog.mjs tests/isolated/nutribot/date-bulletproof.test.mjs
git commit -m "refactor(nutribot): remove stray top-level date prop from NutriLog.updateDate"
```

---

## Task 7: End-to-end scenario test — Thursday log, Friday accept, Saturday revision

**Files:**
- Modify: `tests/isolated/nutribot/date-bulletproof.test.mjs` (add final describe block)

- [ ] **Step 1: Add a scenario test mirroring the real-world INlxxAjRvL case**

Append to `tests/isolated/nutribot/date-bulletproof.test.mjs`:

```javascript
describe('End-to-end: Thu log → Fri accept → Sat revision', () => {
  afterEach(() => resetClock());

  it('keeps date as Thursday through the full lifecycle', async () => {
    // User logs food Thursday afternoon
    mockClock(new Date('2026-04-16T19:00:00Z')); // Thu 12:00 PT
    const deps = buildTextDeps(
      aiJson('2026-04-16'),        // Initial log AI response — Thursday
      aiJson('2026-04-16', [       // Revision AI response (pinned to Thu, user said no date)
        { name: 'Peas', noom_color: 'green', quantity: 1, unit: 'g', grams: 100, calories: 50, protein: 3, carbs: 9, fat: 0 },
        { name: 'Banana', noom_color: 'yellow', quantity: 1, unit: 'g', grams: 100, calories: 90, protein: 1, carbs: 23, fat: 0 },
      ]),
    );
    const textUseCase = new LogFoodFromText(deps);
    await textUseCase.execute({
      userId: 'u1', conversationId: 'c1', text: 'I had peas',
      messageId: 'm1', responseContext: deps.responseContext,
    });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16');

    // User accepts on Friday afternoon (doesn't happen in this test — we accept on Saturday).
    // Actually user revises on Saturday first:
    mockClock(new Date('2026-04-18T19:00:00Z')); // Sat 12:00 PT
    deps.conversationStateStore.get.mockResolvedValue({
      activeFlow: 'revision',
      flowState: { pendingLogUuid: deps.getSavedLog().id, originalMessageId: 'orig' },
    });
    await textUseCase.execute({
      userId: 'u1', conversationId: 'c1', text: 'add a banana',
      messageId: 'm2', responseContext: deps.responseContext,
    });
    expect(deps.getSavedLog().meal.date).toBe('2026-04-16'); // still Thursday

    // Accept on Saturday
    deps.conversationStateStore.get.mockResolvedValue(null);
    const acceptDeps = buildAcceptDeps(deps.getSavedLog());
    const acceptUseCase = new AcceptFoodLog(acceptDeps);
    await acceptUseCase.execute({
      userId: 'u1', conversationId: 'c1', logUuid: deps.getSavedLog().id,
    });
    expect(acceptDeps.savedItemDates).toEqual(['2026-04-16', '2026-04-16']); // both items bucketed to Thu
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/date-bulletproof.test.mjs -t "End-to-end" --runInBand`

Expected: PASS.

- [ ] **Step 3: Run the complete nutribot suite one final time**

Run: `cd /opt/Code/DaylightStation && NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/nutribot/ --runInBand`

Expected: all tests pass — original `revision-flow.test.mjs` and `image-retry.test.mjs`, plus all new bulletproof tests.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add tests/isolated/nutribot/date-bulletproof.test.mjs
git commit -m "test(nutribot): add end-to-end Thu→Fri→Sat scenario covering full log lifecycle"
```

---

## Verification Summary

After all seven tasks, the following invariants are enforced:

1. **On initial logging** — if AI emits a date, it's used; if AI omits it, the entry-day (local timezone) is used. Persisted in `meal.date` as `YYYY-MM-DD`.
2. **On revision** — AI prompt's "today is X" is pinned to the original log's date. AI's default date output therefore matches the original log; only explicit user date words (relative to the pinned date) can shift it.
3. **On accept** — uses `deriveLogDate()`, which reads `meal.date` first, `createdAt` second, and **never** the acceptance wall clock.
4. **Persistence layer** — `saveMany` throws loudly on any item missing or malformed `date`. Silent bucketing to UTC-today is no longer possible.
5. **Entity layer** — `NutriLog.updateDate()` only writes to `meal.date`, no stray top-level field.

The regression suite `tests/isolated/nutribot/date-bulletproof.test.mjs` covers: same-day accept, next-day accept, legacy-log accept (no `meal.date`), AI response missing `date` field, same-day revision, cross-day revision with no date words, cross-day revision with explicit "yesterday", and the full Thu→Sat lifecycle scenario.

---

## Self-Review Notes

- All task steps have concrete code blocks — no TBDs.
- File paths are absolute or rooted at repo root; line references match the reading done at plan time.
- Function signatures stay consistent: `deriveLogDate(log, timezone)` in every call site, `#buildDetectionPrompt(text, portionBoost, asOfDate)` everywhere it's called, `#parseFoodResponse(response, asOfDate)` everywhere.
- One deliberate simplification: `pinnedTimeDetails` uses noon UTC as the anchor. That's safe because the only consumer (`#buildDetectionPrompt`) uses only the date string, day-of-week label, and a human-readable time — never the hour numerically for meal bucketing.
- Known gap: `LogFoodFromImage` and `LogFoodFromUPC` already compute dates from local wall clock at creation and don't have a revision path — no changes needed for Task scope. If a future feature adds UPC/image revision, the same pinning pattern would apply.
