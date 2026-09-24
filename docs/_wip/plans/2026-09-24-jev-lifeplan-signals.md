# Life Plan Signals (Life Events via Jev) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the life coach offer life events it finds in the user's recent calendar ("Moving day", "Dad's surgery") as suggestions the user confirms. A typed-decision model (Jev) runs in shadow beside the keyword detector until its agreement is measured.
**Architecture:** The keyword detector moves from `1_adapters` to `2_domains` (it is pure judgment, not IO) and is fixed to emit domain-shaped suggestions. A new application service `LifeEventSuggester` reads the lifelog calendar, runs the keyword judge, optionally asks `IDecisionGateway` one `choice` question per calendar item, and returns suggestions. It writes nothing. The coach gets a read-only `suggest_life_events` tool and a confirm-gated `add_life_event` writer, the same conversation-confirmation convention every other coach writer uses.
**Tech Stack:** Node ESM (`.mjs`), vitest, `IDecisionGateway` (`choice`), LifelogAggregator, YAML life-plan store, lifeplan-guide agent tools.

---

## Current state (verified)

Checked against code on `main` at `bf03fd80a`. Where the docs disagree with the code, the code wins and the mismatch is noted.

**Life-event detection has no caller and no suggestion flow.**
- `backend/src/1_adapters/lifeplan/signals/LifeEventSignalDetector.mjs:1-49`: substring match of lowercase calendar `summary` against `DEFAULT_PATTERNS` (lines 42-49), hardcoded confidences 0.6–0.9. It pushes **one suggestion per matching pattern**, so one item can produce several. It is pure (no IO), so it is domain judgment sitting in the adapter layer.
- Nothing constructs it. `grep -rn LifeEventSignalDetector backend/ frontend/src` finds only the class itself and `tests/isolated/lifeplan/signals/belief-signal-detector.test.mjs:3,89-122`. `docs/reference/life/life-domain-architecture.md:57` says the same ("Not wired"), which is correct.
- **No user-confirmation flow exists for life events.** There is no suggestions endpoint, no UI, no coach tool. The only life-event write path is `PATCH /api/v1/life/plan/life_events` (`backend/src/4_api/v1/routers/life/plan.mjs:87-101` → `LifePlanOperations.updateSection`, `backend/src/3_applications/lifeplan/LifePlanOperations.mjs:58-67`), which **replaces the whole array**. The confirm convention that does exist is the coach's: writer tools carry `CONFIRM_PREFIX` ("Only call after the user has explicitly confirmed in conversation", `backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs:10`), and the system prompt says "There are no separate confirmation cards — your confirmation is the conversation" (`prompts/system.mjs:55-60`). This plan reuses that convention.
- **The detector's types do not match the domain.** It emits `relocation | job_change | health_event | family_event | travel | education`. `LifeEventType` (`backend/src/2_domains/lifeplan/value-objects/LifeEventType.mjs:1-6`) is `family | career | location | education | health | financial`, and `LifeEvent` (`entities/LifeEvent.mjs:1-31`) has `type` + `subtype`. A suggestion could not be saved as-is. `travel` has no domain type at all.
- **Keyword false positives:** substring matching means `birth` fires on every "Birthday" item (confidence 0.9, `family_event`), `exam` on "example", `flight` on any flight.
- Calendar data reaches the lifelog through `CalendarExtractor` (`backend/src/1_adapters/lifelog/extractors/CalendarExtractor.mjs:1-8`), which extracts **past** events only. Suggestions from this source are things that already happened (`status: occurred`); anticipated events are out of reach until future calendar items are exposed.
- `LifelogAggregator.aggregateRange(username, start, end)` returns `{ days: { [date]: { sources, categories, summaries } } }` (`backend/src/3_applications/lifelog/LifelogAggregator.mjs:118-146`); calendar items are at `days[date].sources.calendar` with `{ time, endTime, summary, duration, location, calendarName, allday, description }`.

**BeliefSignalDetector is in the domain, not the adapter layer, and is also unwired.**
- It lives at `backend/src/2_domains/lifeplan/services/BeliefSignalDetector.mjs:7`. `life-domain-architecture.md:55` lists it under `1_adapters/lifeplan/signals/`, which is wrong. No caller outside its test. Out of scope here; the docs task corrects the location.

**Evening captures are stored but carry no structure to map outcomes onto** (see "Later phase" at the end).
- Storage exists: `CeremonyService.completeCeremony` (`backend/src/3_applications/lifeplan/services/CeremonyService.mjs:96-113`) appends `{ type: 'unit_capture', periodId, completedAt, responses }` to `<user>/ceremony-records.yml` via `YamlCeremonyRecordStore` (`backend/src/1_adapters/persistence/yaml/YamlCeremonyRecordStore.mjs:19-24`).
- The capture is free text: `responses = { observations, mood }` (`frontend/src/modules/Life/views/ceremony/UnitCapture.jsx:36-58`). The morning intention is **one free-text string** `responses.intentions` plus `energy` (`UnitIntention.jsx:39,50`). There is no intention entity and no per-intention id.
- Rules exist (`backend/src/2_domains/lifeplan/entities/Rule.mjs:1-33`, with `recordTrigger({followed, helped})` at line 26), nested under `plan.qualities[].rules`. But `Quality` keeps rules as raw objects (`entities/Quality.mjs:7`), **nothing at runtime ever calls `recordTrigger` or `RuleMatchingService.recordOutcome`**, and both `CeremonyService.mjs:76` and `RetroService.mjs:41` read `r.effectiveness`, a field that does not exist on a rule. The retro's "rule effectiveness" step always shows `undefined`.
- `unit_capture` content does not include the rules (`CeremonyService.mjs:47-59`); only `unit_intention` does.
- `user-journey.md:132` says captures feed "belief evidence and rule effectiveness". No code does either.

**Decision gateway:** built in `createApp` at `backend/src/app.mjs:711-717` (null without a key). `bootstrapLifeplan` is called at `app.mjs:1422-1438` in the same function and does not receive it today.

---

## Questions for Jev

One `choice` per calendar item, batched `CHUNK = 20` items per `evaluate` call (state stays far under the 32k limit; each item is ~200 bytes).

```js
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';

export const LIFE_EVENT_OPTIONS = Object.freeze({
  none: 'Not a life event: routine meetings, appointments and checkups, errands, classes, social plans, trips, birthdays, holidays and yearly anniversaries',
  relocation: 'Moving home: moving day, a house closing, moving into a new apartment',
  job_change: 'Starting, leaving or losing a job, or a promotion: a first or last day at work, onboarding, a resignation',
  health_event: 'A significant health event: surgery, a hospital stay, a serious diagnosis. Not a routine appointment',
  family_event: 'A wedding, a birth, a death or funeral, a divorce, a child leaving home',
  education: 'Starting or finishing a school or program: graduation, orientation, an enrolment, a final exam',
  financial: 'A major financial event: retirement, buying a car, paying off a large debt, a bankruptcy',
});

// per item, question id = item id ('c0', 'c1', ...)
questions[id] = choice(
  `What kind of life event, if any, does the calendar item \`${id}\` mark? `
  + 'Most calendar items are routine; answer none unless the item itself marks a lasting change in someone\'s life.',
  LIFE_EVENT_OPTIONS,
);
```

`state` (one chunk):

```js
{
  c0: { date: '2026-09-20', summary: 'Moving day', calendar: 'Family', allDay: true, location: null },
  c1: { date: '2026-09-21', summary: 'Standup', calendar: 'Work', allDay: false, location: 'Zoom' },
  // ... up to 20
}
```

`summary` is capped at 200 chars and `location` at 100. `description` is never sent (long, often private, and not needed to classify).

Answer used: `answers[id].choice` (a key of `LIFE_EVENT_OPTIONS`) and `answers[id].confidence`. The option keys other than `none` are exactly the keys of the domain's `LIFE_EVENT_SIGNAL_KINDS`, which map to `LifeEventType` (a test pins this).

---

## Rollout

Config: the system-level `agents` app config (`system/config/agents.yml` in the data tree, read with `configService.getAppConfig('agents')`), key `lifeplan_guide.life_event_signals`:

```yaml
lifeplan_guide:
  life_event_signals:
    mode: shadow        # shadow | decide | off   (default shadow)
    min_confidence: 0.6 # model suggestions below this are dropped in decide mode
```

| Mode | Suggestions returned | Model called |
|---|---|---|
| no gateway configured | keyword | never |
| `off` | keyword | never |
| `shadow` (default) | keyword | yes, logged only |
| `decide` | model (≥ `min_confidence`), keyword if any chunk fails | yes |

Log events:
- `lifeplan.life-event.shadow` (info), one per calendar item judged: `{ username, date, keyword, model, confidence, agreed, summary? }`. `keyword`/`model` are a kind or `none`; the model kind counts as `none` below `min_confidence`. `summary` (first 60 chars) is logged **only on disagreement rows**, so they can be reviewed by hand without shipping every calendar title to the log store.
- `lifeplan.life-event.shadow-summary` (info), one per suggest call: `{ username, mode, items, keywordHits, modelHits, agreed, disagreed, model, ms }`.
- `lifeplan.life-event.model-failed` (warn): `{ username, mode, items, error, ms }`.
- `lifeplan.life-event.suggested` (info): `{ username, mode, judge, items, suggestions }`.
- `lifeplan.life-event.confirmed` (info), when the coach writes a confirmed event: `{ username, type, subtype, detector, confidence }`.

Promote `shadow → decide` when all hold, measured from `lifeplan.life-event.shadow` over at least 14 days:
1. at least 150 judged items (`"lifeplan.life-event.shadow" AND _time:30d | stats by ("data.agreed") count()`);
2. of the `agreed:false` rows, hand review finds the model right in at least 80%;
3. on items where the keyword judge said `none`, the model's effective hit rate is at most 3% (it must not flood the coach);
4. no `lifeplan.life-event.confirmed` event with `detector: keyword` whose shadow row had the model at `none`. A user-confirmed event the model would have missed blocks promotion.

Volume note: the model only runs when the coach calls `suggest_life_events`, so evidence accumulates slowly. That is acceptable. Rollback is setting `mode: shadow` or `off` and restarting the backend (config is cached at startup).

---

## Task 0: Worktree

**Step 1:** Sync with the deployed source first (see `CLAUDE.local.md`), then:

```bash
cd /path/to/DaylightStation
git fetch origin
git worktree add .worktrees/jev-lifeplan-signals -b feat/jev-lifeplan-signals main
cd .worktrees/jev-lifeplan-signals
```

All later paths are relative to the worktree. Do not start a backend from the worktree while the main dev server runs.

---

## Task 1: Move the keyword detector into the domain and fix its output

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.mjs`
- Create (test): `backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.test.mjs`
- Delete: `backend/src/1_adapters/lifeplan/signals/LifeEventSignalDetector.mjs` (and the then-empty `signals/` directory)
- Modify: `tests/isolated/lifeplan/signals/belief-signal-detector.test.mjs` (remove line 3 import and the `describe('LifeEventSignalDetector', …)` block, lines 89-122)

**Step 1: Write the failing test**

```js
// backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.test.mjs
import { describe, it, expect } from 'vitest';
import {
  LifeEventSignalDetector, LIFE_EVENT_SIGNAL_KINDS, calendarItemsForDay, toSuggestion,
} from './LifeEventSignalDetector.mjs';
import { LifeEventType } from '../value-objects/LifeEventType.mjs';

const day = (...summaries) => ({ sources: { calendar: summaries.map((summary) => ({ summary })) } });

describe('LifeEventSignalDetector', () => {
  const detector = new LifeEventSignalDetector();

  it('maps every signal kind to a domain LifeEventType', () => {
    for (const type of Object.values(LIFE_EVENT_SIGNAL_KINDS)) {
      expect(LifeEventType.isValid(type)).toBe(true);
    }
  });

  it('emits domain-shaped suggestions (type + subtype)', () => {
    const out = detector.detectFromLifelog({ '2026-09-20': day('Moving day - new apartment', 'Team meeting') });
    expect(out).toEqual([{
      date: '2026-09-20', type: 'location', subtype: 'relocation', name: 'Moving day - new apartment',
      source: 'calendar', confidence: 0.8, detector: 'keyword',
    }]);
  });

  it('matches whole words only: a birthday is not a birth, an example is not an exam', () => {
    expect(detector.detectFromLifelog({ '2026-09-20': day("Mom's birthday", 'Worked example review') })).toEqual([]);
    expect(detector.detectFromLifelog({ '2026-09-20': day('Birth of baby Kern') })[0].subtype).toBe('family_event');
  });

  it('emits at most one suggestion per calendar item (first matching pattern wins)', () => {
    const out = detector.detectFromLifelog({ '2026-09-20': day('First day back after surgery') });
    expect(out).toHaveLength(1);
    expect(out[0].subtype).toBe('job_change');
  });

  it('does not treat travel as a life event', () => {
    expect(detector.detectFromLifelog({ '2026-09-20': day('Flight to Denver', 'Hotel check-in') })).toEqual([]);
  });

  it('reads the categories shape when sources is absent', () => {
    const days = { '2026-09-20': { categories: { calendar: { calendar: [{ summary: 'Graduation' }] } } } };
    expect(detector.detectFromLifelog(days)[0].type).toBe('education');
  });

  it('classify returns null for routine items and empty summaries', () => {
    expect(detector.classify({ summary: 'Standup' })).toBeNull();
    expect(detector.classify({})).toBeNull();
  });

  it('calendarItemsForDay tolerates missing data and {events} wrappers', () => {
    expect(calendarItemsForDay(undefined)).toEqual([]);
    expect(calendarItemsForDay({ sources: { calendar: { events: [{ summary: 'x' }] } } })).toEqual([{ summary: 'x' }]);
  });

  it('toSuggestion maps kind to type and keeps the kind as subtype', () => {
    expect(toSuggestion('2026-09-01', { summary: 'Retirement party' }, 'financial', 0.9, 'model'))
      .toEqual({ date: '2026-09-01', type: 'financial', subtype: 'financial', name: 'Retirement party', source: 'calendar', confidence: 0.9, detector: 'model' });
  });
});
```

**Step 2: Run it**

```bash
npx vitest run --config vitest.config.mjs backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.test.mjs
```
Expected: FAIL, `Failed to load url ./LifeEventSignalDetector.mjs`.

**Step 3: Implement**

```js
// backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.mjs
/**
 * Keyword policy for spotting life events in calendar items. Pure: takes the
 * lifelog day map and returns suggestions for the user to confirm. It is the
 * judge whenever no typed-decision model is configured, and the baseline the
 * model is shadow-compared against (see LifeEventSuggester).
 */
import { LifeEventType } from '../value-objects/LifeEventType.mjs';

/** Signal kind → LifeEvent.type. The kind is kept as the event's subtype. */
export const LIFE_EVENT_SIGNAL_KINDS = Object.freeze({
  relocation: LifeEventType.LOCATION,
  job_change: LifeEventType.CAREER,
  health_event: LifeEventType.HEALTH,
  family_event: LifeEventType.FAMILY,
  education: LifeEventType.EDUCATION,
  financial: LifeEventType.FINANCIAL,
});

const DEFAULT_PATTERNS = [
  { kind: 'relocation', keywords: ['moving day', 'new apartment', 'house closing'], confidence: 0.8 },
  { kind: 'job_change', keywords: ['first day', 'onboarding', 'resignation', 'last day'], confidence: 0.7 },
  { kind: 'health_event', keywords: ['surgery', 'hospital', 'doctor follow-up', 'diagnosis'], confidence: 0.8 },
  { kind: 'family_event', keywords: ['wedding', 'birth', 'funeral', 'anniversary'], confidence: 0.9 },
  { kind: 'education', keywords: ['graduation', 'orientation', 'first class', 'exam'], confidence: 0.7 },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compile = (patterns) => patterns.map((p) => ({
  ...p,
  re: new RegExp(`\\b(?:${p.keywords.map(escapeRe).join('|')})\\b`, 'i'),
}));

/** Calendar items for one lifelog day, whichever shape the aggregator produced. */
export function calendarItemsForDay(day) {
  const data = day?.sources?.calendar || day?.categories?.calendar?.calendar;
  if (!data) return [];
  return Array.isArray(data) ? data : (data.events || []);
}

/** A suggestion in LifeEvent terms: type from the kind, kind kept as subtype. */
export function toSuggestion(date, item, kind, confidence, detector) {
  return {
    date,
    type: LIFE_EVENT_SIGNAL_KINDS[kind],
    subtype: kind,
    name: item.summary || item.name,
    source: 'calendar',
    confidence,
    detector,
  };
}

export class LifeEventSignalDetector {
  #patterns;

  constructor(config = {}) {
    this.#patterns = compile(config.patterns || DEFAULT_PATTERNS);
  }

  /** First matching pattern for one calendar item, or null. */
  classify(item) {
    const summary = item?.summary || item?.name || '';
    if (!summary) return null;
    const hit = this.#patterns.find((p) => p.re.test(summary));
    return hit ? { kind: hit.kind, confidence: hit.confidence ?? 0.7 } : null;
  }

  detectFromLifelog(lifelogDays) {
    const out = [];
    for (const [date, day] of Object.entries(lifelogDays || {})) {
      for (const item of calendarItemsForDay(day)) {
        const hit = this.classify(item);
        if (hit) out.push(toSuggestion(date, item, hit.kind, hit.confidence, 'keyword'));
      }
    }
    return out;
  }
}
```

Then remove the old adapter file and the old test block:

```bash
git rm backend/src/1_adapters/lifeplan/signals/LifeEventSignalDetector.mjs
```

In `tests/isolated/lifeplan/signals/belief-signal-detector.test.mjs`, delete line 3 (`import { LifeEventSignalDetector } from '#adapters/lifeplan/signals/LifeEventSignalDetector.mjs';`) and the whole `describe('LifeEventSignalDetector', () => { … });` block (lines 89-122). The new colocated test covers it.

**Step 4: Run**

```bash
npx vitest run --config vitest.config.mjs backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.test.mjs tests/isolated/lifeplan/signals/belief-signal-detector.test.mjs
grep -rn "adapters/lifeplan/signals" backend tests || echo "no stale imports"
```
Expected: all pass; `no stale imports`.

**Step 5: Commit**

```bash
git add -A backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.mjs backend/src/2_domains/lifeplan/services/LifeEventSignalDetector.test.mjs backend/src/1_adapters/lifeplan/signals tests/isolated/lifeplan/signals/belief-signal-detector.test.mjs
git commit -m "refactor(lifeplan): move life-event keyword detector into the domain

Pure judgment belonged in 2_domains. Emits LifeEventType + subtype,
one suggestion per calendar item, whole-word matching (a birthday is
no longer a birth), and drops travel, which has no domain type.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: LifeEventSuggester, keyword path

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/LifeEventSuggester.mjs`
- Create (test): `backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs`

**Step 1: Write the failing test**

```js
// backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { LifeEventSuggester } from './LifeEventSuggester.mjs';

const clock = { now: () => new Date('2026-09-24T18:00:00Z') };
const cal = (date, ...summaries) => [date, { sources: { calendar: summaries.map((summary) => ({ summary, calendarName: 'Family', allday: true })) } }];

function setup({ days = Object.fromEntries([cal('2026-09-20', 'Moving day', 'Standup')]), plan = { life_events: [] }, ...rest } = {}) {
  const aggregator = { aggregateRange: vi.fn(async () => ({ days })) };
  const lifePlanStore = { load: vi.fn(() => plan) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const suggester = new LifeEventSuggester({ aggregator, lifePlanStore, clock, timezone: 'UTC', logger, ...rest });
  return { suggester, aggregator, lifePlanStore, logger };
}

describe('LifeEventSuggester (keyword path)', () => {
  it('without a decision model returns keyword suggestions over the last N days', async () => {
    const { suggester, aggregator } = setup();
    const result = await suggester.suggest('kc', { days: 14 });
    expect(aggregator.aggregateRange).toHaveBeenCalledWith('kc', '2026-09-11', '2026-09-24');
    expect(result.judge).toBe('keyword');
    expect(result.suggestions).toEqual([{
      date: '2026-09-20', type: 'location', subtype: 'relocation', name: 'Moving day',
      source: 'calendar', confidence: 0.8, detector: 'keyword',
    }]);
  });

  it('clamps days to 1..60 and defaults to 14', async () => {
    const { suggester, aggregator } = setup();
    await suggester.suggest('kc');
    expect(aggregator.aggregateRange).toHaveBeenLastCalledWith('kc', '2026-09-11', '2026-09-24');
    await suggester.suggest('kc', { days: 500 });
    expect(aggregator.aggregateRange).toHaveBeenLastCalledWith('kc', '2026-07-27', '2026-09-24');
  });

  it('skips items already recorded as life events in the plan (by name)', async () => {
    const { suggester } = setup({ plan: { life_events: [{ name: 'moving day' }] } });
    expect((await suggester.suggest('kc')).suggestions).toEqual([]);
  });

  it('treats a gateway that reports not-configured as absent', async () => {
    const decisionGateway = { isConfigured: () => false, evaluate: vi.fn() };
    const { suggester } = setup({ decisionGateway });
    await suggester.suggest('kc');
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('logs lifeplan.life-event.suggested', async () => {
    const { suggester, logger } = setup();
    await suggester.suggest('kc');
    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.suggested',
      { username: 'kc', mode: 'shadow', judge: 'keyword', items: 2, suggestions: 1 });
  });
});
```

**Step 2: Run it**

```bash
npx vitest run --config vitest.config.mjs backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs
```
Expected: FAIL, module not found.

**Step 3: Implement (keyword path only; Task 3 adds the model)**

```js
// backend/src/3_applications/lifeplan/services/LifeEventSuggester.mjs
/**
 * LifeEventSuggester — suggests life events from recent calendar items for the
 * user to confirm. It writes nothing; the coach offers suggestions and records
 * only what the user confirms (add_life_event).
 */
import {
  LifeEventSignalDetector, calendarItemsForDay, toSuggestion,
} from '#domains/lifeplan/services/LifeEventSignalDetector.mjs';

const MODES = new Set(['shadow', 'decide', 'off']);
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const DEFAULT_MIN_CONFIDENCE = 0.6;

const nameKey = (s) => String(s || '').trim().toLowerCase();

function shiftDate(ymd, deltaDays) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function collectItems(days) {
  const items = [];
  for (const date of Object.keys(days || {}).sort()) {
    for (const item of calendarItemsForDay(days[date])) {
      items.push({ id: `c${items.length}`, date, item });
    }
  }
  return items;
}

export class LifeEventSuggester {
  #aggregator; #plans; #detector; #decision; #timezone; #clock; #timeoutMs; #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.aggregator - LifelogAggregator (aggregateRange)
   * @param {Object} deps.lifePlanStore - ILifePlanRepository (load)
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {'shadow'|'decide'|'off'} [deps.mode='shadow']
   * @param {number} [deps.minConfidence=0.6]
   * @param {string} [deps.timezone='UTC'] - household zone for "today"
   * @param {Object} [deps.clock] - { now(): Date }
   * @param {number} [deps.timeoutMs=5000]
   * @param {Object} [deps.logger]
   */
  constructor({ aggregator, lifePlanStore, detector = new LifeEventSignalDetector(), decisionGateway = null,
    mode = 'shadow', minConfidence = DEFAULT_MIN_CONFIDENCE, timezone = 'UTC', clock = null,
    timeoutMs = 5000, logger = null } = {}) {
    this.#aggregator = aggregator;
    this.#plans = lifePlanStore;
    this.#detector = detector;
    this.#decision = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.mode = MODES.has(mode) ? mode : 'shadow';
    this.minConfidence = Number.isFinite(minConfidence) ? minConfidence : DEFAULT_MIN_CONFIDENCE;
    this.#timezone = timezone || 'UTC';
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  async suggest(username, { days = DEFAULT_DAYS } = {}) {
    const span = Math.max(1, Math.min(Number.isFinite(days) ? Math.floor(days) : DEFAULT_DAYS, MAX_DAYS));
    const endDate = this.#today();
    const startDate = shiftDate(endDate, -(span - 1));
    const range = await this.#aggregator.aggregateRange(username, startDate, endDate);
    const items = collectItems(range?.days).map((it) => ({ ...it, keyword: this.#detector.classify(it.item) }));
    const known = new Set((this.#plans.load(username)?.life_events || []).map((e) => nameKey(e.name)).filter(Boolean));

    const judge = 'keyword';
    const suggestions = items
      .filter((it) => it.keyword)
      .map((it) => toSuggestion(it.date, it.item, it.keyword.kind, it.keyword.confidence, 'keyword'))
      .filter((s) => !known.has(nameKey(s.name)));

    this.#logger?.info?.('lifeplan.life-event.suggested', {
      username, mode: this.mode, judge, items: items.length, suggestions: suggestions.length,
    });
    return { judge, startDate, endDate, suggestions };
  }

  #today() {
    const now = this.#clock?.now?.() ?? new Date();
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: this.#timezone }).format(now);
    } catch {
      return now.toISOString().slice(0, 10);
    }
  }
}

export default LifeEventSuggester;
```

**Step 4: Run** (same command). Expected: 5 passed.

**Step 5: Commit**

```bash
git add backend/src/3_applications/lifeplan/services/LifeEventSuggester.mjs backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs
git commit -m "feat(lifeplan): LifeEventSuggester with keyword judge

Scans the last N days of lifelog calendar items and returns life-event
suggestions for the user to confirm. Writes nothing.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Jev judge in shadow and decide modes

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/LifeEventSuggester.mjs` (full replacement below)
- Modify (test): `backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs` (append)

**Step 1: Append failing tests**

```js
// append to LifeEventSuggester.test.mjs
import { LIFE_EVENT_OPTIONS } from './LifeEventSuggester.mjs';
import { LIFE_EVENT_SIGNAL_KINDS } from '#domains/lifeplan/services/LifeEventSignalDetector.mjs';

/** Gateway that answers each question id from a table: id → [choice, confidence]. */
function gateway(table, { fail = false } = {}) {
  return {
    isConfigured: () => true,
    evaluate: vi.fn(async (state, questions) => {
      if (fail) throw new Error('jev down');
      const answers = {};
      for (const id of Object.keys(questions)) {
        const [choice, confidence] = table[state[id].summary] || ['none', 0.95];
        answers[id] = { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
      }
      return { model: 'jev-test-1', answers, usage: {} };
    }),
  };
}

describe('LifeEventSuggester (model judge)', () => {
  it('offers exactly none + the domain signal kinds', () => {
    expect(Object.keys(LIFE_EVENT_OPTIONS).sort()).toEqual(['none', ...Object.keys(LIFE_EVENT_SIGNAL_KINDS)].sort());
  });

  it('shadow: returns keyword suggestions, asks the model, logs agreement per item', async () => {
    const decisionGateway = gateway({ 'Moving day': ['relocation', 0.9], Standup: ['none', 0.97] });
    const { suggester, logger } = setup({ decisionGateway });
    const result = await suggester.suggest('kc');

    expect(result.judge).toBe('keyword');
    expect(result.suggestions.map((s) => s.detector)).toEqual(['keyword']);
    const [state, questions] = decisionGateway.evaluate.mock.calls[0];
    expect(state).toEqual({
      c0: { date: '2026-09-20', summary: 'Moving day', calendar: 'Family', allDay: true, location: null },
      c1: { date: '2026-09-20', summary: 'Standup', calendar: 'Family', allDay: true, location: null },
    });
    expect(questions.c0.type).toBe('choice');
    expect(questions.c0.instructions).toContain('`c0`');
    expect(questions.c0.options).toBe(LIFE_EVENT_OPTIONS);

    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.shadow',
      { username: 'kc', date: '2026-09-20', keyword: 'relocation', model: 'relocation', confidence: 0.9, agreed: true });
    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.shadow-summary', expect.objectContaining(
      { username: 'kc', mode: 'shadow', items: 2, keywordHits: 1, modelHits: 1, agreed: 2, disagreed: 0, model: 'jev-test-1' }));
  });

  it('shadow: logs a short summary only on disagreement rows', async () => {
    const days = Object.fromEntries([cal('2026-09-21', "Mom's funeral service at St. Mary's with the whole extended family")]);
    const decisionGateway = gateway({});  // model says none
    const { suggester, logger } = setup({ days, decisionGateway });
    await suggester.suggest('kc');
    const row = logger.info.mock.calls.find(([e]) => e === 'lifeplan.life-event.shadow')[1];
    expect(row.agreed).toBe(false);
    expect(row.keyword).toBe('family_event');
    expect(row.model).toBe('none');
    expect(row.summary).toHaveLength(60);
  });

  it('batches 20 items per evaluate call', async () => {
    const summaries = Array.from({ length: 45 }, (_, i) => `Meeting ${i}`);
    const decisionGateway = gateway({});
    const { suggester } = setup({ days: Object.fromEntries([cal('2026-09-22', ...summaries)]), decisionGateway });
    await suggester.suggest('kc');
    expect(decisionGateway.evaluate.mock.calls.map(([state]) => Object.keys(state).length)).toEqual([20, 20, 5]);
  });

  it('model failure logs a warning and returns keyword suggestions', async () => {
    const decisionGateway = gateway({}, { fail: true });
    const { suggester, logger } = setup({ decisionGateway, mode: 'decide' });
    const result = await suggester.suggest('kc');
    expect(result.judge).toBe('keyword');
    expect(result.suggestions).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith('lifeplan.life-event.model-failed', expect.objectContaining({ error: 'jev down' }));
  });

  it('a missing answer counts as a failure (no partial model verdicts)', async () => {
    const decisionGateway = { isConfigured: () => true, evaluate: vi.fn(async () => ({ model: 'm', answers: {}, usage: {} })) };
    const { suggester, logger } = setup({ decisionGateway, mode: 'decide' });
    expect((await suggester.suggest('kc')).judge).toBe('keyword');
    expect(logger.warn).toHaveBeenCalledWith('lifeplan.life-event.model-failed', expect.objectContaining({ error: 'no answer for c0' }));
  });

  it('off: never calls the model', async () => {
    const decisionGateway = gateway({});
    const { suggester } = setup({ decisionGateway, mode: 'off' });
    await suggester.suggest('kc');
    expect(decisionGateway.evaluate).not.toHaveBeenCalled();
  });

  it('decide: returns model suggestions above min confidence, typed from the kind', async () => {
    const days = Object.fromEntries([cal('2026-09-23', 'Retirement party for KC', 'Maybe a job thing', 'Standup')]);
    const decisionGateway = gateway({ 'Retirement party for KC': ['financial', 0.82], 'Maybe a job thing': ['job_change', 0.4] });
    const { suggester } = setup({ days, decisionGateway, mode: 'decide', minConfidence: 0.6 });
    const result = await suggester.suggest('kc');
    expect(result.judge).toBe('model');
    expect(result.suggestions).toEqual([{
      date: '2026-09-23', type: 'financial', subtype: 'financial', name: 'Retirement party for KC',
      source: 'calendar', confidence: 0.82, detector: 'model',
    }]);
  });

  it('noteConfirmed logs lifeplan.life-event.confirmed from the event signal', () => {
    const { suggester, logger } = setup();
    suggester.noteConfirmed('kc', { type: 'location', subtype: 'relocation', signals: [{ detector: 'keyword', confidence: 0.8 }] });
    expect(logger.info).toHaveBeenCalledWith('lifeplan.life-event.confirmed',
      { username: 'kc', type: 'location', subtype: 'relocation', detector: 'keyword', confidence: 0.8 });
  });
});
```

**Step 2: Run**

```bash
npx vitest run --config vitest.config.mjs backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs
```
Expected: FAIL, `LIFE_EVENT_OPTIONS` is not exported; the model tests fail.

**Step 3: Implement (full file)**

```js
// backend/src/3_applications/lifeplan/services/LifeEventSuggester.mjs
/**
 * LifeEventSuggester — suggests life events from recent calendar items for the
 * user to confirm. It writes nothing; the coach offers suggestions and records
 * only what the user confirms (add_life_event).
 *
 * Two judges:
 *   keyword  the domain LifeEventSignalDetector. Always runs. It is the answer
 *            when no decision model is configured, the mode is off, or the
 *            model fails.
 *   model    a typed-decision model (IDecisionGateway), asked one choice per
 *            calendar item: which life-event kind, or none.
 *
 * Modes (agents config → lifeplan_guide.life_event_signals.mode):
 *   shadow  (default) return keyword suggestions; ask the model too and log
 *           per-item agreement (lifeplan.life-event.shadow);
 *   decide  return the model's suggestions (confidence ≥ minConfidence);
 *           keyword if any chunk fails;
 *   off     keyword only.
 *
 * Model trouble never throws out of suggest().
 */
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';
import {
  LifeEventSignalDetector, calendarItemsForDay, toSuggestion,
} from '#domains/lifeplan/services/LifeEventSignalDetector.mjs';

const MODES = new Set(['shadow', 'decide', 'off']);
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const DEFAULT_MIN_CONFIDENCE = 0.6;
const CHUNK = 20;
const LOGGED_SUMMARY_CHARS = 60;

export const LIFE_EVENT_OPTIONS = Object.freeze({
  none: 'Not a life event: routine meetings, appointments and checkups, errands, classes, social plans, trips, birthdays, holidays and yearly anniversaries',
  relocation: 'Moving home: moving day, a house closing, moving into a new apartment',
  job_change: 'Starting, leaving or losing a job, or a promotion: a first or last day at work, onboarding, a resignation',
  health_event: 'A significant health event: surgery, a hospital stay, a serious diagnosis. Not a routine appointment',
  family_event: 'A wedding, a birth, a death or funeral, a divorce, a child leaving home',
  education: 'Starting or finishing a school or program: graduation, orientation, an enrolment, a final exam',
  financial: 'A major financial event: retirement, buying a car, paying off a large debt, a bankruptcy',
});

const questionFor = (id) => choice(
  `What kind of life event, if any, does the calendar item \`${id}\` mark? `
  + 'Most calendar items are routine; answer none unless the item itself marks a lasting change in someone\'s life.',
  LIFE_EVENT_OPTIONS,
);

const nameKey = (s) => String(s || '').trim().toLowerCase();
const summaryOf = (item) => String(item.summary || item.name || '');

function shiftDate(ymd, deltaDays) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function collectItems(days) {
  const items = [];
  for (const date of Object.keys(days || {}).sort()) {
    for (const item of calendarItemsForDay(days[date])) {
      items.push({ id: `c${items.length}`, date, item });
    }
  }
  return items;
}

/** What the model sees for one item. Never the description. */
const describe = ({ date, item }) => ({
  date,
  summary: summaryOf(item).slice(0, 200),
  calendar: item.calendarName ?? null,
  allDay: !!item.allday,
  location: item.location ? String(item.location).slice(0, 100) : null,
});

export class LifeEventSuggester {
  #aggregator; #plans; #detector; #decision; #timezone; #clock; #timeoutMs; #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.aggregator - LifelogAggregator (aggregateRange)
   * @param {Object} deps.lifePlanStore - ILifePlanRepository (load)
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {'shadow'|'decide'|'off'} [deps.mode='shadow']
   * @param {number} [deps.minConfidence=0.6]
   * @param {string} [deps.timezone='UTC'] - household zone for "today"
   * @param {Object} [deps.clock] - { now(): Date }
   * @param {number} [deps.timeoutMs=5000]
   * @param {Object} [deps.logger]
   */
  constructor({ aggregator, lifePlanStore, detector = new LifeEventSignalDetector(), decisionGateway = null,
    mode = 'shadow', minConfidence = DEFAULT_MIN_CONFIDENCE, timezone = 'UTC', clock = null,
    timeoutMs = 5000, logger = null } = {}) {
    this.#aggregator = aggregator;
    this.#plans = lifePlanStore;
    this.#detector = detector;
    this.#decision = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.mode = MODES.has(mode) ? mode : 'shadow';
    this.minConfidence = Number.isFinite(minConfidence) ? minConfidence : DEFAULT_MIN_CONFIDENCE;
    this.#timezone = timezone || 'UTC';
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  /** Whether the model is asked at all. */
  get modelActive() { return !!this.#decision && this.mode !== 'off'; }

  /**
   * @returns {Promise<{ judge: 'keyword'|'model', startDate: string, endDate: string, suggestions: Object[] }>}
   */
  async suggest(username, { days = DEFAULT_DAYS } = {}) {
    const span = Math.max(1, Math.min(Number.isFinite(days) ? Math.floor(days) : DEFAULT_DAYS, MAX_DAYS));
    const endDate = this.#today();
    const startDate = shiftDate(endDate, -(span - 1));
    const range = await this.#aggregator.aggregateRange(username, startDate, endDate);
    const items = collectItems(range?.days).map((it) => ({ ...it, keyword: this.#detector.classify(it.item) }));
    const known = new Set((this.#plans.load(username)?.life_events || []).map((e) => nameKey(e.name)).filter(Boolean));

    let judge = 'keyword';
    let verdicts = null;
    if (this.modelActive && items.length) {
      const asked = await this.#askModel(username, items);
      if (asked) {
        verdicts = asked.verdicts;
        this.#logShadow(username, items, asked);
        if (this.mode === 'decide') judge = 'model';
      }
    }

    const suggestions = items.flatMap((it) => {
      if (judge === 'model') {
        const kind = this.#effectiveKind(verdicts[it.id]);
        return kind === 'none' ? [] : [toSuggestion(it.date, it.item, kind, verdicts[it.id].confidence, 'model')];
      }
      return it.keyword ? [toSuggestion(it.date, it.item, it.keyword.kind, it.keyword.confidence, 'keyword')] : [];
    }).filter((s) => !known.has(nameKey(s.name)));

    this.#logger?.info?.('lifeplan.life-event.suggested', {
      username, mode: this.mode, judge, items: items.length, suggestions: suggestions.length,
    });
    return { judge, startDate, endDate, suggestions };
  }

  /** Called by the coach's writer after the user confirmed an event. */
  noteConfirmed(username, event) {
    const signal = event?.signals?.[0] || {};
    this.#logger?.info?.('lifeplan.life-event.confirmed', {
      username, type: event?.type ?? null, subtype: event?.subtype ?? null,
      detector: signal.detector ?? null, confidence: signal.confidence ?? null,
    });
  }

  #effectiveKind(verdict) {
    if (!verdict || verdict.kind === 'none' || verdict.confidence < this.minConfidence) return 'none';
    return verdict.kind;
  }

  /** All chunks or nothing: any failure or missing answer returns null. */
  async #askModel(username, items) {
    const startedAt = Date.now();
    const verdicts = {};
    let model = null;
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        const state = Object.fromEntries(chunk.map((it) => [it.id, describe(it)]));
        const questions = Object.fromEntries(chunk.map((it) => [it.id, questionFor(it.id)]));
        const result = await this.#decision.evaluate(state, questions, { timeout: this.#timeoutMs });
        model = result?.model ?? model;
        for (const it of chunk) {
          const answer = result?.answers?.[it.id];
          if (!answer || !Object.hasOwn(LIFE_EVENT_OPTIONS, answer.choice)) throw new Error(`no answer for ${it.id}`);
          verdicts[it.id] = { kind: answer.choice, confidence: Number(answer.confidence) || 0 };
        }
      }
      return { verdicts, model, ms: Date.now() - startedAt };
    } catch (error) {
      this.#logger?.warn?.('lifeplan.life-event.model-failed', {
        username, mode: this.mode, items: items.length, error: error.message, ms: Date.now() - startedAt,
      });
      return null;
    }
  }

  #logShadow(username, items, { verdicts, model, ms }) {
    let agreed = 0; let keywordHits = 0; let modelHits = 0;
    for (const it of items) {
      const keyword = it.keyword?.kind ?? 'none';
      const modelKind = this.#effectiveKind(verdicts[it.id]);
      const same = keyword === modelKind;
      if (same) agreed += 1;
      if (keyword !== 'none') keywordHits += 1;
      if (modelKind !== 'none') modelHits += 1;
      this.#logger?.info?.('lifeplan.life-event.shadow', {
        username, date: it.date, keyword, model: modelKind, confidence: verdicts[it.id].confidence, agreed: same,
        ...(same ? {} : { summary: summaryOf(it.item).slice(0, LOGGED_SUMMARY_CHARS) }),
      });
    }
    this.#logger?.info?.('lifeplan.life-event.shadow-summary', {
      username, mode: this.mode, items: items.length, keywordHits, modelHits,
      agreed, disagreed: items.length - agreed, model, ms,
    });
  }

  #today() {
    const now = this.#clock?.now?.() ?? new Date();
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: this.#timezone }).format(now);
    } catch {
      return now.toISOString().slice(0, 10);
    }
  }
}

export default LifeEventSuggester;
```

Note on the disagreement test: "Mom's funeral service at St. Mary's with the whole extended family" is 66 chars, so the logged summary is exactly 60.

**Step 4: Run** (same command). Expected: all 14 tests pass.

**Step 5: Commit**

```bash
git add backend/src/3_applications/lifeplan/services/LifeEventSuggester.mjs backend/src/3_applications/lifeplan/services/LifeEventSuggester.test.mjs
git commit -m "feat(lifeplan): Jev life-event judge, shadow by default

One choice question per calendar item (kind or none), 20 per call.
Shadow logs per-item agreement with the keyword judge; decide mode
returns model suggestions above min confidence. Any model failure
falls back to the keyword judge.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: PlanAuthoringService.addLifeEvent

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/PlanAuthoringService.mjs` (imports at lines 1-5; serializers at lines 17-20; new method after `setPurpose`, ~line 140)
- Modify (test): `tests/isolated/lifeplan/services/plan-authoring.test.mjs` (append inside the top-level `describe`)

**Step 1: Failing test**

```js
  it('addLifeEvent appends a typed event with the date on the right field and keeps the signal', () => {
    const ev = svc.addLifeEvent('test-user', {
      type: 'location', subtype: 'relocation', name: 'Moving day', status: 'occurred', date: '2026-09-20',
      signal: { source: 'calendar', date: '2026-09-20', detector: 'keyword', confidence: 0.8 },
    });
    expect(ev).toMatchObject({
      id: 'moving-day', type: 'location', subtype: 'relocation', name: 'Moving day', status: 'occurred',
      actual_date: '2026-09-20', expected_date: null,
      signals: [{ source: 'calendar', date: '2026-09-20', detector: 'keyword', confidence: 0.8 }],
    });
    expect(saved.life_events).toHaveLength(1);
    const next = svc.addLifeEvent('test-user', { type: 'career', name: 'Moving day', status: 'anticipated', date: '2026-10-01' });
    expect(next.id).toBe('moving-day-2');
    expect(next.expected_date).toBe('2026-10-01');
    expect(next.signals).toEqual([]);
  });

  it('addLifeEvent rejects unknown types, bad status, and missing names', () => {
    expect(() => svc.addLifeEvent('test-user', { type: 'travel', name: 'x', status: 'occurred' })).toThrow(/type/);
    expect(() => svc.addLifeEvent('test-user', { type: 'family', name: 'x', status: 'cancelled' })).toThrow(/status/);
    expect(() => svc.addLifeEvent('test-user', { type: 'family', status: 'occurred' })).toThrow(/name/);
  });
```

**Step 2: Run**

```bash
npx vitest run --config vitest.config.mjs tests/isolated/lifeplan/services/plan-authoring.test.mjs
```
Expected: FAIL, `svc.addLifeEvent is not a function`.

**Step 3: Implement**

Add imports after line 5:

```js
import { LifeEvent } from '#domains/lifeplan/entities/LifeEvent.mjs';
import { LifeEventType } from '#domains/lifeplan/value-objects/LifeEventType.mjs';
```

Add a serializer after line 20:

```js
const serializeLifeEvent = event => ({ id: event.id, type: event.type, subtype: event.subtype, name: event.name, status: event.status, impact_type: event.impact_type, duration_type: event.duration_type, expected_date: event.expected_date, actual_date: event.actual_date, impact: event.impact, resolution: event.resolution, signals: event.signals, notes: event.notes });
```

Add the method after `setPurpose`:

```js
  /**
   * Append a life event. `date` lands on actual_date for an occurred event and
   * on expected_date for an anticipated one. `signal` records where a
   * confirmed suggestion came from ({ source, date, detector, confidence }).
   * @returns {object} the created life event record
   */
  addLifeEvent(username, { type, subtype = null, name, status = 'occurred', date = null, signal = null } = {}) {
    if (!name) throw new Error('Life event requires a name');
    if (!LifeEventType.isValid(type)) throw new Error(`Unknown life event type: ${type}`);
    if (!['anticipated', 'occurred'].includes(status)) throw new Error(`Unsupported life event status: ${status}`);
    const plan = this.#loadOrCreate(username);
    const event = new LifeEvent({
      id: this.#uniqueId(name, plan.life_events),
      type,
      subtype,
      name,
      status,
      expected_date: status === 'anticipated' ? date : null,
      actual_date: status === 'occurred' ? date : null,
      signals: signal ? [signal] : [],
    });
    plan.life_events.push(event);
    this.#lifePlanStore.save(username, plan);
    return serializeLifeEvent(event);
  }
```

**Step 4: Run** (same command). Expected: pass.

**Step 5: Commit**

```bash
git add backend/src/3_applications/lifeplan/services/PlanAuthoringService.mjs tests/isolated/lifeplan/services/plan-authoring.test.mjs
git commit -m "feat(lifeplan): addLifeEvent authoring write path

Appends one typed LifeEvent instead of replacing the whole array via
PATCH /life_events; keeps the suggestion signal it came from.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Coach tools, suggest_life_events and add_life_event

**Files:**
- Modify: `backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs` (destructure at line 8; two tools appended to the returned array)
- Modify: `backend/src/3_applications/agents/lifeplan-guide/LifeplanGuideAgent.mjs:74-88` (destructure `lifeEventSuggester`, pass to `PlanToolFactory`)
- Modify: `backend/src/3_applications/agents/lifeplan-guide/prompts/system.mjs:55-60` ("Changing the plan" list)
- Create (test): `tests/isolated/agents/lifeplan-guide/life-event-tools.test.mjs`

**Step 1: Failing test**

```js
// tests/isolated/agents/lifeplan-guide/life-event-tools.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

function tools(overrides = {}) {
  const deps = {
    lifePlanStore: { load: () => ({}), save: vi.fn() },
    goalStateService: {}, beliefEvaluator: {}, feedbackService: {},
    planAuthoringService: { addLifeEvent: vi.fn((u, e) => ({ id: 'moving-day', ...e, signals: e.signal ? [e.signal] : [] })) },
    lifeEventSuggester: {
      suggest: vi.fn(async () => ({ judge: 'keyword', startDate: '2026-09-11', endDate: '2026-09-24',
        suggestions: [{ date: '2026-09-20', type: 'location', subtype: 'relocation', name: 'Moving day', source: 'calendar', confidence: 0.8, detector: 'keyword' }] })),
      noteConfirmed: vi.fn(),
    },
    clock: { now: () => new Date('2026-09-24T12:00:00Z') },
    ...overrides,
  };
  const list = new PlanToolFactory(deps).createTools();
  return { deps, get: (name) => list.find((t) => t.name === name) };
}

describe('PlanToolFactory life-event tools', () => {
  it('suggest_life_events is read-only and returns the suggestions and window', async () => {
    const { deps, get } = tools();
    const tool = get('suggest_life_events');
    expect(tool.description).not.toMatch(/Writes to the user's plan/);
    const out = await tool.execute({ userId: 'kc', days: 30 });
    expect(deps.lifeEventSuggester.suggest).toHaveBeenCalledWith('kc', { days: 30 });
    expect(out.window).toEqual({ start: '2026-09-11', end: '2026-09-24' });
    expect(out.suggestions[0].name).toBe('Moving day');
  });

  it('suggest_life_events degrades to an error payload without a suggester or on failure', async () => {
    expect(await tools({ lifeEventSuggester: null }).get('suggest_life_events').execute({ userId: 'kc' }))
      .toEqual({ error: 'Life event suggestions are not available', suggestions: [] });
    const failing = { suggest: vi.fn(async () => { throw new Error('lifelog down'); }) };
    expect(await tools({ lifeEventSuggester: failing }).get('suggest_life_events').execute({ userId: 'kc' }))
      .toEqual({ error: 'lifelog down', suggestions: [] });
  });

  it('add_life_event is confirm-gated, writes via planAuthoringService, and logs the confirmation', async () => {
    const { deps, get } = tools();
    const tool = get('add_life_event');
    expect(tool.description).toMatch(/Only call after the user has explicitly confirmed/);
    const suggestion = { date: '2026-09-20', source: 'calendar', detector: 'keyword', confidence: 0.8 };
    const out = await tool.execute({ userId: 'kc', type: 'location', subtype: 'relocation', name: 'Moving day',
      status: 'occurred', date: '2026-09-20', fromSuggestion: suggestion });
    expect(deps.planAuthoringService.addLifeEvent).toHaveBeenCalledWith('kc', {
      type: 'location', subtype: 'relocation', name: 'Moving day', status: 'occurred', date: '2026-09-20',
      signal: { source: 'calendar', date: '2026-09-20', detector: 'keyword', confidence: 0.8 },
    });
    expect(deps.lifeEventSuggester.noteConfirmed).toHaveBeenCalledWith('kc', out.created);
  });

  it('add_life_event returns an error payload when authoring rejects', async () => {
    const planAuthoringService = { addLifeEvent: vi.fn(() => { throw new Error('Unknown life event type: travel'); }) };
    const out = await tools({ planAuthoringService }).get('add_life_event')
      .execute({ userId: 'kc', type: 'travel', name: 'x', status: 'occurred' });
    expect(out).toEqual({ error: 'Unknown life event type: travel' });
  });
});
```

**Step 2: Run**

```bash
npx vitest run --config vitest.config.mjs tests/isolated/agents/lifeplan-guide/life-event-tools.test.mjs
```
Expected: FAIL, `Cannot read properties of undefined (reading 'description')`.

**Step 3: Implement**

`PlanToolFactory.mjs` line 8 becomes:

```js
    const { lifePlanStore, goalStateService, beliefEvaluator, feedbackService, planAuthoringService, lifeEventSuggester, clock } = this.deps;
```

Append to the returned array (after `set_purpose`):

```js
      createTool({
        name: 'suggest_life_events',
        description: "Read-only. Scans the user's recent calendar for items that look like life events (a move, a job change, a wedding or funeral, surgery, a graduation, a major financial change). Returns suggestions only: offer them to the user in plain words, and call add_life_event only for the ones they confirm.",
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            days: { type: 'number', description: 'How many days back to scan (default 14, max 60)' },
          },
          required: ['userId'],
        },
        execute: async ({ userId, days }) => {
          if (!lifeEventSuggester) return { error: 'Life event suggestions are not available', suggestions: [] };
          try {
            const result = await lifeEventSuggester.suggest(userId, { days });
            return { suggestions: result.suggestions, window: { start: result.startDate, end: result.endDate } };
          } catch (e) {
            return { error: e.message, suggestions: [] };
          }
        },
      }),

      createTool({
        name: 'add_life_event',
        description: `${CONFIRM_PREFIX} Records a life event in the plan. When it came from suggest_life_events, pass that suggestion as fromSuggestion unchanged.`,
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User identifier' },
            type: { type: 'string', enum: ['family', 'career', 'location', 'education', 'health', 'financial'] },
            subtype: { type: 'string', description: 'Finer kind, e.g. relocation, job_change, family_event' },
            name: { type: 'string', description: 'Short name, e.g. "Moved to Denver"' },
            status: { type: 'string', enum: ['anticipated', 'occurred'] },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            fromSuggestion: { type: 'object', description: 'The suggestion this came from, if any' },
          },
          required: ['userId', 'type', 'name', 'status'],
        },
        execute: async ({ userId, type, subtype, name, status, date, fromSuggestion }) => {
          try {
            const signal = fromSuggestion
              ? { source: fromSuggestion.source || 'calendar', date: fromSuggestion.date ?? date ?? null,
                detector: fromSuggestion.detector ?? null, confidence: fromSuggestion.confidence ?? null }
              : null;
            const created = planAuthoringService.addLifeEvent(userId, { type, subtype, name, status, date, signal });
            lifeEventSuggester?.noteConfirmed?.(userId, created);
            return { created };
          } catch (e) {
            return { error: e.message };
          }
        },
      }),
```

`LifeplanGuideAgent.mjs` `registerTools()`: add `lifeEventSuggester,` to the destructure on the `planAuthoringService, clock,` line and to the `PlanToolFactory` deps:

```js
    const {
      lifePlanStore, goalStateService, beliefEvaluator, feedbackService,
      planAuthoringService, lifeEventSuggester, clock,
      // ...unchanged
    } = this.deps;

    this.addToolFactory(new PlanToolFactory({
      lifePlanStore, goalStateService, beliefEvaluator, feedbackService,
      planAuthoringService, lifeEventSuggester, clock,
    }));
```

`prompts/system.mjs`, in "## Changing the plan", after the `add_evidence` bullet:

```
- add_life_event — record a life event (a move, job change, wedding, surgery...). suggest_life_events finds candidates in the recent calendar: during a check-in or retro, offer at most two in plain words ("Your calendar had 'Moving day' on the 20th — want me to note that as a life event?") and add only the ones the user confirms.
```

**Step 4: Run**

```bash
npx vitest run --config vitest.config.mjs tests/isolated/agents/lifeplan-guide tests/isolated/agents/lifeplan-guide-tools.test.mjs
```
Expected: all pass (existing tool-name assertions use `arrayContaining`/`toContain`, so adding tools does not break them).

**Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide tests/isolated/agents/lifeplan-guide/life-event-tools.test.mjs
git commit -m "feat(lifeplan-guide): suggest_life_events + confirm-gated add_life_event

The coach offers calendar-derived life events and records only what
the user confirms in conversation.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Composition wiring

**Files:**
- Modify: `backend/src/5_composition/modules/lifeplan.mjs` (import; deps destructure at line 41; construct after `ceremonyService` ~line 88; add to `services` in the return ~line 175; bootstrap log list ~line 164)
- Modify: `backend/src/app.mjs:1422-1438` (pass `decisionGateway` and config)
- Modify: `backend/src/5_composition/bootstrap.mjs:2906-2922` (pass `lifeEventSuggester` to the agent)
- Modify (test): `tests/isolated/composition/lifeplan-bootstrap.test.mjs` (append)

**Step 1: Failing test** (append inside the `describe`)

```js
  it('wires a LifeEventSuggester that falls back to keywords without a decision model', async () => {
    const dataPath = tmpUserDir();
    const aggregator = { aggregateRange: async () => ({ days: { '2026-09-20': { sources: { calendar: [{ summary: 'Moving day' }] } } } }) };
    const clock = { now: () => new Date('2026-09-24T12:00:00Z') };
    const { services } = bootstrapLifeplan({ dataPath, aggregator, clock, logger: null });
    const result = await services.lifeEventSuggester.suggest('test-user');
    expect(result.judge).toBe('keyword');
    expect(result.suggestions.map((s) => s.subtype)).toEqual(['relocation']);
  });

  it('passes the decision gateway and mode through', async () => {
    const dataPath = tmpUserDir();
    const aggregator = { aggregateRange: async () => ({ days: { '2026-09-20': { sources: { calendar: [{ summary: 'Retirement party' }] } } } }) };
    const decisionGateway = { isConfigured: () => true, evaluate: async () => ({ model: 'm', usage: {},
      answers: { c0: { type: 'choice', choice: 'financial', confidence: 0.9, probabilities: {} } } }) };
    const { services } = bootstrapLifeplan({ dataPath, aggregator, decisionGateway,
      lifeEventSignals: { mode: 'decide', min_confidence: 0.5 }, clock: { now: () => new Date('2026-09-24T12:00:00Z') }, logger: null });
    const result = await services.lifeEventSuggester.suggest('test-user');
    expect(result.judge).toBe('model');
    expect(result.suggestions[0].type).toBe('financial');
  });
```

**Step 2: Run**

```bash
npx vitest run --config vitest.config.mjs tests/isolated/composition/lifeplan-bootstrap.test.mjs
```
Expected: FAIL, `Cannot read properties of undefined (reading 'suggest')`.

**Step 3: Implement**

`lifeplan.mjs`:

```js
import { LifeEventSuggester } from '#apps/lifeplan/services/LifeEventSuggester.mjs';
```

JSDoc additions and destructure (line 41):

```js
 * @param {Object} [deps.decisionGateway] - IDecisionGateway for the life-event judge (optional)
 * @param {Object} [deps.lifeEventSignals] - { mode: shadow|decide|off, min_confidence }
```
```js
  const { dataPath, aggregator, notificationService, userService, listHouseholdUsers, defaultUsername, timezone, clock, logger,
    decisionGateway = null, lifeEventSignals = {} } = deps;
```

After `ceremonyService`:

```js
  // Life-event suggestions for the coach (keyword judge; Jev in shadow unless promoted)
  const lifeEventSuggester = new LifeEventSuggester({
    aggregator,
    lifePlanStore: container.getLifePlanStore(),
    decisionGateway,
    mode: lifeEventSignals.mode,
    minConfidence: lifeEventSignals.min_confidence,
    timezone: timezone || 'UTC',
    clock,
    logger: logger?.child?.({ submodule: 'life-event-signals' }) || logger,
  });
```

Add `'life-event-signals'` to the `lifeplan.bootstrap.complete` services list and `lifeEventSuggester,` to the returned `services` object.

`app.mjs` `bootstrapLifeplan({ ... })` at line 1422, add after `timezone:`:

```js
    // Typed-decision model for the coach's life-event suggestions (shadow by default).
    // agents config → lifeplan_guide.life_event_signals: { mode: shadow|decide|off, min_confidence }
    decisionGateway,
    lifeEventSignals: configService.getAppConfig?.('agents')?.lifeplan_guide?.life_event_signals || {},
```

(`decisionGateway` is the `let` from `app.mjs:711`, same `createApp` scope.)

`bootstrap.mjs` `agentOrchestrator.register(LifeplanGuideAgent, { ... })`, after `planAuthoringService:`:

```js
      lifeEventSuggester: config.lifeplanServices.services.lifeEventSuggester,
```

**Step 4: Run**

```bash
npx vitest run --config vitest.config.mjs tests/isolated/composition/lifeplan-bootstrap.test.mjs
npm run audit:layers
```
Expected: tests pass; layer audit reports no new violations (the domain file imports only its own value-object; the application service imports `#apps/common/ports` and `#domains`).

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/lifeplan.mjs backend/src/app.mjs backend/src/5_composition/bootstrap.mjs tests/isolated/composition/lifeplan-bootstrap.test.mjs
git commit -m "feat(lifeplan): wire LifeEventSuggester with the decision gateway

Mode comes from agents config lifeplan_guide.life_event_signals
(default shadow). The coach agent receives the suggester.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Docs

**Files:**
- Modify: `docs/reference/life/life-domain-architecture.md` (lines 40-47 honesty pass; 49-57 `1_adapters/lifeplan/` table and "Not wired" note; `3_applications/lifeplan/` table; add a "Life event signals" section before "Belief Evidence Model"; test table ~line 277)
- Modify: `docs/reference/life/user-journey.md:132` (evening-capture row) and add a life-event note where coach proposals are described (~line 133)

**Step 1: Edits**

In `life-domain-architecture.md`:
- `1_adapters/lifeplan/` table: remove the `signals/` row. Replace the "Not wired" paragraph with: "**Not wired.** None of the four metric adapters or the `IMetricSource` port they'd implement are constructed anywhere under `5_composition/`." Then note that `BeliefSignalDetector` lives in `2_domains/lifeplan/services/` (not adapters) and has no production caller.
- Honesty pass: add `LifeEventSignalDetector` (domain, via `LifeEventSuggester`) to "Wired and reachable".
- `3_applications/lifeplan/` table: add `LifeEventSuggester | Life-event suggestions from recent calendar items for the coach; keyword judge + Jev (shadow/decide/off)`.
- New section:

```markdown
### Life event signals

The coach can offer life events it finds in the recent calendar. Nothing is written without the user's confirmation in conversation.

- `2_domains/lifeplan/services/LifeEventSignalDetector.mjs`: whole-word keyword policy. Emits `{ date, type (LifeEventType), subtype (signal kind), name, source: 'calendar', confidence, detector: 'keyword' }`, at most one per calendar item. Kinds: relocation→location, job_change→career, health_event→health, family_event→family, education→education, financial→financial. Travel is not a life event.
- `3_applications/lifeplan/services/LifeEventSuggester.mjs`: reads `aggregateRange` over the last N days (default 14, max 60), skips names already in `plan.life_events`, and asks the decision gateway one `choice` per item (kind or `none`, 20 items per call; summary, calendar, all-day and location only, never the description).
- Mode: agents config `lifeplan_guide.life_event_signals.mode` = `shadow` (default; keyword answers, model logged) | `decide` (model answers at `min_confidence`, default 0.6) | `off`. No gateway or any model failure means keyword answers.
- Coach tools: `suggest_life_events` (read-only) and `add_life_event` (confirm-gated, `PlanAuthoringService.addLifeEvent`; the suggestion is kept in `signals[]`).
- Logs: `lifeplan.life-event.shadow` (per item; `summary` only on disagreement), `.shadow-summary`, `.model-failed`, `.suggested`, `.confirmed`. Promotion criteria: `docs/_wip/plans/2026-09-24-jev-lifeplan-signals.md` (Rollout).
- Source limit: the lifelog calendar extractor exposes past events only, so suggestions are events that already occurred.
```

- Test table: add `backend/src/2_domains/lifeplan/services/*.test.mjs` and `backend/src/3_applications/lifeplan/services/*.test.mjs` (colocated, unit).

In `user-journey.md:132`, change the System cell of the evening-capture row to: "Capture recorded (free text + mood). **[GAP]** Not yet mapped to rule or intention outcomes; rule effectiveness is never updated at runtime. See the later phase in `docs/_wip/plans/2026-09-24-jev-lifeplan-signals.md`." After the Coach-on-demand row, add: "Life events: the coach can offer life events it spots in the recent calendar (`suggest_life_events`) and records them only on confirmation [EXISTS]."

**Step 2: Verify no instance data**

```bash
grep -nE "homeserver|kckern|10\.0\.0\.|:3111|:3112" docs/reference/life/life-domain-architecture.md docs/reference/life/user-journey.md || echo clean
```
Expected: `clean`.

**Step 3: Commit**

```bash
git add docs/reference/life/life-domain-architecture.md docs/reference/life/user-journey.md
git commit -m "docs(life): life-event signals, correct signal detector locations, capture gap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full suite for touched dirs

**Step 1:**

```bash
npx vitest run --config vitest.config.mjs \
  backend/src/2_domains/lifeplan \
  backend/src/3_applications/lifeplan \
  tests/isolated/lifeplan \
  tests/isolated/agents/lifeplan-guide \
  tests/isolated/agents/lifeplan-guide-tools.test.mjs \
  tests/isolated/composition/lifeplan-bootstrap.test.mjs \
  tests/isolated/api/routers/life-plan-authoring.test.mjs
npm run audit:layers
grep -rn "adapters/lifeplan/signals" backend tests docs/reference || echo "no stale references"
```
Expected: all green, no new layer violations, `no stale references`. If anything outside these dirs imports `LifeEventSignalDetector`, the grep catches it.

**Step 2:** Merge per the repo's workflow (merge into `main`, record the branch in `docs/_archive/deleted-branches.md`, delete it). Do not deploy.

---

## Later phase (not in this plan): evening captures → rule outcomes

Capture storage exists; the structure to map outcomes onto does not. Build these first, in this order, each its own plan:

1. **Rule outcome write path.** Hydrate `Quality.rules` into `Rule` entities (`entities/Quality.mjs:7`), give `recordTrigger` a `helped: null` ("unknown") case so a capture that says "followed" does not count as "didn't help", and add `PlanAuthoringService.recordRuleOutcome(username, ruleId, { followed, helped })`. Fix `CeremonyService.mjs:76` and `RetroService.mjs:41` to use `evaluateEffectiveness()` instead of the missing `r.effectiveness` field. Today the retro's rule-effectiveness step always shows `undefined`, and that bug stands on its own.
2. **Rules in capture content.** `CeremonyService.getCeremonyContent('unit_capture')` returns `rules: this.#getAllRules(plan)` (as `unit_intention` already does).
3. **Confirm surface.** A capture Confirm step (`UnitCapture.jsx`, step 2) that shows suggested per-rule outcomes as editable chips and submits them as `responses.rule_outcomes`; `completeCeremony` applies only what was submitted.
4. **Then the Jev question**, run on the Observations → Confirm step transition via a new `POST /life/plan/ceremony/unit_capture/suggest`:
   ```js
   state = { capture: '<observations text>', rules: { r_<id>: { trigger, action } } }
   questions[`r_${id}`] = choice(
     'Going only by `capture`, how did the user do on the rule `r_<id>` today?',
     { done: 'They followed it', partial: 'They partly followed it',
       failed: 'The trigger happened and they did not follow it', not_mentioned: 'The capture does not say' });
   ```
   Pre-select chips only at confidence ≥ 0.7; everything else defaults to `not_mentioned`. Never apply without the Confirm submit.
5. **Intentions are out of reach.** The morning intention is one free-text string (`UnitIntention.jsx:39`) with no ids. Per-intention outcomes need itemized intentions (one input per line, stored as `responses.intentions: [{ id, text }]`) before any question can target them.
