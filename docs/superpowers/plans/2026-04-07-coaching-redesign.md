# Coaching System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the verbose, LLM-generated coaching messages with template-driven status blocks plus a single LLM commentary sentence via Mastra generate().

**Architecture:** Code builds deterministic HTML status blocks (numbers, percentages, formatting). A lightweight Mastra `generate()` call with gpt-4o-mini adds one optional commentary sentence. If the LLM fails, the status block sends alone. Collapse 6 assignments to 4, fix duplicate firing.

**Tech Stack:** Node.js/ESM, Mastra SDK (`@mastra/core`), Telegram HTML, YAML persistence via existing datastores.

**Spec:** `docs/superpowers/specs/2026-04-07-coaching-redesign-design.md`

---

## File Structure

### New Files

| File | Purpose |
|---|---|
| `backend/src/3_applications/coaching/CoachingMessageBuilder.mjs` | Deterministic HTML status block builder for all 4 assignment types |
| `backend/src/3_applications/coaching/CoachingCommentaryService.mjs` | Mastra generate() wrapper — one sentence LLM commentary |
| `backend/src/3_applications/coaching/CoachingOrchestrator.mjs` | Coordinates snapshot → builder → commentary → delivery → persistence |
| `backend/src/3_applications/coaching/snapshots.mjs` | Data snapshot builders for all 4 assignment types |
| `backend/src/3_applications/coaching/patterns.mjs` | Detect recent_pattern from nutrition history |
| `backend/src/3_applications/coaching/index.mjs` | Barrel export |
| `tests/unit/coaching/CoachingMessageBuilder.test.mjs` | Unit tests for HTML builder |
| `tests/unit/coaching/patterns.test.mjs` | Unit tests for pattern detection |
| `tests/unit/coaching/CoachingCommentaryService.test.mjs` | Unit tests for commentary service (mocked Mastra) |
| `tests/unit/coaching/CoachingOrchestrator.test.mjs` | Integration test for full orchestration |

### Modified Files

| File | Change |
|---|---|
| `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs` | Remove coaching triggers (lines 154-173) |
| `backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs` | Add post-report coaching call after report send |
| `backend/src/3_applications/agents/framework/Scheduler.mjs` | Add idempotency guard to `#tick()` |
| `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs` | Remove old coaching assignments, wire new orchestrator |
| `backend/src/0_system/bootstrap.mjs` | Wire CoachingOrchestrator with dependencies |

---

## Task 1: Pattern Detection

**Files:**
- Create: `backend/src/3_applications/coaching/patterns.mjs`
- Test: `tests/unit/coaching/patterns.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/coaching/patterns.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { detectPattern } from '../../../backend/src/3_applications/coaching/patterns.mjs';

describe('detectPattern', () => {
  const goals = { calories_min: 1200, calories_max: 1600, protein: 120 };

  it('returns protein_short when protein < 80% goal for 3+ of last 5 days', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 90 },
      { date: '2026-04-06', calories: 1300, protein: 80 },
      { date: '2026-04-05', calories: 1500, protein: 85 },
      { date: '2026-04-04', calories: 1400, protein: 130 },
      { date: '2026-04-03', calories: 1350, protein: 70 },
    ];
    expect(detectPattern(days, goals)).toBe('protein_short');
  });

  it('returns calorie_surplus when above goal_max for 2+ of last 3 days', () => {
    const days = [
      { date: '2026-04-07', calories: 1800, protein: 120 },
      { date: '2026-04-06', calories: 1700, protein: 120 },
      { date: '2026-04-05', calories: 1400, protein: 120 },
    ];
    expect(detectPattern(days, goals)).toBe('calorie_surplus');
  });

  it('returns calorie_deficit when below goal_min for 2+ of last 3 days', () => {
    const days = [
      { date: '2026-04-07', calories: 800, protein: 120 },
      { date: '2026-04-06', calories: 1000, protein: 120 },
      { date: '2026-04-05', calories: 1400, protein: 120 },
    ];
    expect(detectPattern(days, goals)).toBe('calorie_deficit');
  });

  it('returns missed_logging when 0 calories for 1+ of last 3 days', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 120 },
      { date: '2026-04-06', calories: 0, protein: 0 },
      { date: '2026-04-05', calories: 1400, protein: 120 },
    ];
    expect(detectPattern(days, goals)).toBe('missed_logging');
  });

  it('returns binge_after_deficit when day > goal_max follows 2+ days < goal_min', () => {
    const days = [
      { date: '2026-04-07', calories: 2200, protein: 120 },
      { date: '2026-04-06', calories: 900, protein: 60 },
      { date: '2026-04-05', calories: 800, protein: 50 },
    ];
    expect(detectPattern(days, goals)).toBe('binge_after_deficit');
  });

  it('returns on_track when within goals for 3+ consecutive days', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 125 },
      { date: '2026-04-06', calories: 1300, protein: 130 },
      { date: '2026-04-05', calories: 1500, protein: 122 },
    ];
    expect(detectPattern(days, goals)).toBe('on_track');
  });

  it('returns null when no pattern detected', () => {
    const days = [
      { date: '2026-04-07', calories: 1400, protein: 110 },
      { date: '2026-04-06', calories: 1700, protein: 130 },
    ];
    expect(detectPattern(days, goals)).toBeNull();
  });

  it('handles empty array', () => {
    expect(detectPattern([], goals)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/patterns.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pattern detection**

Create `backend/src/3_applications/coaching/patterns.mjs`:

```javascript
/**
 * Detect the most notable recent nutrition pattern.
 * @param {Array<{date: string, calories: number, protein: number}>} days - Recent daily data, most recent first
 * @param {{calories_min: number, calories_max: number, protein: number}} goals
 * @returns {string|null} Pattern identifier or null
 */
export function detectPattern(days, goals) {
  if (!days || days.length === 0) return null;

  const last3 = days.slice(0, 3);
  const last5 = days.slice(0, 5);

  // binge_after_deficit: today > max, preceded by 2+ days < min
  if (last3.length >= 3) {
    const todayOver = last3[0].calories > goals.calories_max;
    const prev2Under = last3.slice(1, 3).every(d => d.calories < goals.calories_min && d.calories > 0);
    if (todayOver && prev2Under) return 'binge_after_deficit';
  }

  // missed_logging: 0 calories for 1+ of last 3 days
  if (last3.some(d => d.calories === 0)) return 'missed_logging';

  // calorie_surplus: above goal_max for 2+ of last 3 days
  const surplusDays = last3.filter(d => d.calories > goals.calories_max);
  if (surplusDays.length >= 2) return 'calorie_surplus';

  // calorie_deficit: below goal_min for 2+ of last 3 days
  const deficitDays = last3.filter(d => d.calories < goals.calories_min && d.calories > 0);
  if (deficitDays.length >= 2) return 'calorie_deficit';

  // protein_short: protein < 80% of goal for 3+ of last 5 days
  const proteinThreshold = goals.protein * 0.8;
  const proteinShortDays = last5.filter(d => d.protein < proteinThreshold && d.calories > 0);
  if (proteinShortDays.length >= 3) return 'protein_short';

  // on_track: within goals for 3+ consecutive days from most recent
  const onTrackStreak = last3.filter(d =>
    d.calories >= goals.calories_min &&
    d.calories <= goals.calories_max &&
    d.protein >= goals.protein
  );
  if (onTrackStreak.length >= 3) return 'on_track';

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/patterns.test.mjs`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/coaching/patterns.mjs tests/unit/coaching/patterns.test.mjs
git commit -m "feat(coaching): add pattern detection for nutrition trends"
```

---

## Task 2: CoachingMessageBuilder

**Files:**
- Create: `backend/src/3_applications/coaching/CoachingMessageBuilder.mjs`
- Test: `tests/unit/coaching/CoachingMessageBuilder.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/coaching/CoachingMessageBuilder.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { CoachingMessageBuilder } from '../../../backend/src/3_applications/coaching/CoachingMessageBuilder.mjs';

describe('CoachingMessageBuilder', () => {
  describe('buildPostReportBlock', () => {
    it('builds status block with percentages', () => {
      const html = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: 850, goal_min: 1200, goal_max: 1600 },
        protein: { consumed: 62, goal: 120 },
      });
      expect(html).toContain('<b>850 / 1600 cal</b>');
      expect(html).toContain('53%');
      expect(html).toContain('<b>62 / 120g protein</b>');
      expect(html).toContain('52%');
    });

    it('handles zero consumed', () => {
      const html = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: 0, goal_min: 1200, goal_max: 1600 },
        protein: { consumed: 0, goal: 120 },
      });
      expect(html).toContain('0%');
      expect(html).toContain('<b>0 / 1600 cal</b>');
    });

    it('shows over-budget when exceeding goal_max', () => {
      const html = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: 2000, goal_min: 1200, goal_max: 1600 },
        protein: { consumed: 150, goal: 120 },
      });
      expect(html).toContain('125%');
    });
  });

  describe('buildMorningBriefBlock', () => {
    it('builds yesterday + 7-day avg + weight', () => {
      const html = CoachingMessageBuilder.buildMorningBriefBlock({
        yesterday: { calories: 1626, protein: 94 },
        weekAvg: { calories: 1450, protein: 112 },
        proteinGoal: 120,
        weight: { current: 170.3, trend7d: -0.09 },
      });
      expect(html).toContain('<b>Yesterday:</b> 1626 cal');
      expect(html).toContain('94g protein');
      expect(html).toContain('<b>7-day avg:</b>');
      expect(html).toContain('target: 120g');
      expect(html).toContain('170.3 lbs');
    });
  });

  describe('buildWeeklyDigestBlock', () => {
    it('builds week vs long-term comparison', () => {
      const html = CoachingMessageBuilder.buildWeeklyDigestBlock({
        thisWeek: { avgCalories: 1453, avgProtein: 112 },
        longTermAvg: { avgCalories: 1520, avgProtein: 105 },
        weight: { weekStart: 170.4, weekEnd: 170.2, trend7d: -0.16 },
      });
      expect(html).toContain('<b>This week:</b>');
      expect(html).toContain('1453 avg cal');
      expect(html).toContain('<b>vs 8-wk avg:</b>');
      expect(html).toContain('<b>Weight trend:</b>');
    });
  });

  describe('buildExerciseReactionBlock', () => {
    it('builds exercise summary with budget impact', () => {
      const html = CoachingMessageBuilder.buildExerciseReactionBlock({
        activity: { type: 'Run', durationMin: 45, caloriesBurned: 320 },
        budgetImpact: 150,
      });
      expect(html).toContain('<b>Run:</b> 45 min');
      expect(html).toContain('320 cal burned');
      expect(html).toContain('~150 extra cal earned');
    });
  });

  describe('wrapCommentary', () => {
    it('wraps non-empty commentary in blockquote', () => {
      const html = CoachingMessageBuilder.wrapCommentary('That chicken hit hard.');
      expect(html).toBe('\n\n<blockquote>That chicken hit hard.</blockquote>');
    });

    it('returns empty string for empty commentary', () => {
      expect(CoachingMessageBuilder.wrapCommentary('')).toBe('');
      expect(CoachingMessageBuilder.wrapCommentary(null)).toBe('');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/CoachingMessageBuilder.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CoachingMessageBuilder**

Create `backend/src/3_applications/coaching/CoachingMessageBuilder.mjs`:

```javascript
/**
 * Builds deterministic HTML status blocks for coaching messages.
 * No LLM involved — pure computation and formatting.
 */
export class CoachingMessageBuilder {

  /**
   * @param {{calories: {consumed, goal_min, goal_max}, protein: {consumed, goal}}} data
   * @returns {string} Telegram HTML
   */
  static buildPostReportBlock({ calories, protein }) {
    const calPct = calories.goal_max > 0 ? Math.round((calories.consumed / calories.goal_max) * 100) : 0;
    const protPct = protein.goal > 0 ? Math.round((protein.consumed / protein.goal) * 100) : 0;

    return [
      `\u{1F525} <b>${calories.consumed} / ${calories.goal_max} cal</b> (${calPct}%)`,
      `\u{1F4AA} <b>${protein.consumed} / ${protein.goal}g protein</b> (${protPct}%)`,
    ].join('\n');
  }

  /**
   * @param {{yesterday: {calories, protein}, weekAvg: {calories, protein}, proteinGoal: number, weight: {current, trend7d}}} data
   * @returns {string} Telegram HTML
   */
  static buildMorningBriefBlock({ yesterday, weekAvg, proteinGoal, weight }) {
    const trend = weight.trend7d >= 0 ? `+${weight.trend7d.toFixed(2)}` : weight.trend7d.toFixed(2);

    return [
      `\u{1F4CA} <b>Yesterday:</b> ${yesterday.calories} cal \u{00B7} ${yesterday.protein}g protein`,
      `\u{1F4C9} <b>7-day avg:</b> ${weekAvg.calories} cal \u{00B7} ${weekAvg.protein}g protein (target: ${proteinGoal}g)`,
      `\u{2696}\u{FE0F} <b>Weight:</b> ${weight.current} lbs (${trend}/wk)`,
    ].join('\n');
  }

  /**
   * @param {{thisWeek: {avgCalories, avgProtein}, longTermAvg: {avgCalories, avgProtein}, weight: {weekStart, weekEnd, trend7d}}} data
   * @returns {string} Telegram HTML
   */
  static buildWeeklyDigestBlock({ thisWeek, longTermAvg, weight }) {
    const trend = weight.trend7d >= 0 ? `+${weight.trend7d.toFixed(2)}` : weight.trend7d.toFixed(2);

    return [
      `\u{1F4CA} <b>This week:</b> ${thisWeek.avgCalories} avg cal \u{00B7} ${thisWeek.avgProtein}g avg protein`,
      `\u{1F4C8} <b>vs 8-wk avg:</b> ${longTermAvg.avgCalories} cal \u{00B7} ${longTermAvg.avgProtein}g protein`,
      `\u{2696}\u{FE0F} <b>Weight trend:</b> ${trend} lbs this week \u{00B7} ${weight.weekStart} \u{2192} ${weight.weekEnd}`,
    ].join('\n');
  }

  /**
   * @param {{activity: {type, durationMin, caloriesBurned}, budgetImpact: number}} data
   * @returns {string} Telegram HTML
   */
  static buildExerciseReactionBlock({ activity, budgetImpact }) {
    return [
      `\u{1F3C3} <b>${activity.type}:</b> ${activity.durationMin} min \u{00B7} ${activity.caloriesBurned} cal burned`,
      `\u{1F525} <b>Budget update:</b> ~${budgetImpact} extra cal earned`,
    ].join('\n');
  }

  /**
   * Wrap commentary in blockquote if non-empty.
   * @param {string|null} commentary
   * @returns {string}
   */
  static wrapCommentary(commentary) {
    if (!commentary) return '';
    const trimmed = commentary.trim();
    if (!trimmed) return '';
    return `\n\n<blockquote>${trimmed}</blockquote>`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/CoachingMessageBuilder.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/coaching/CoachingMessageBuilder.mjs tests/unit/coaching/CoachingMessageBuilder.test.mjs
git commit -m "feat(coaching): add deterministic HTML status block builder"
```

---

## Task 3: CoachingCommentaryService

**Files:**
- Create: `backend/src/3_applications/coaching/CoachingCommentaryService.mjs`
- Test: `tests/unit/coaching/CoachingCommentaryService.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/coaching/CoachingCommentaryService.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { CoachingCommentaryService } from '../../../backend/src/3_applications/coaching/CoachingCommentaryService.mjs';

describe('CoachingCommentaryService', () => {
  function makeMockAgent(response) {
    return {
      generate: vi.fn().mockResolvedValue({ text: response }),
    };
  }

  function makeMockAgentFactory(agent) {
    return () => agent;
  }

  it('returns commentary from LLM', async () => {
    const agent = makeMockAgent('That chicken hit hard.');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report', calories: { consumed: 850 } });
    expect(result).toBe('That chicken hit hard.');
    expect(agent.generate).toHaveBeenCalledOnce();
  });

  it('passes snapshot as JSON string to agent', async () => {
    const agent = makeMockAgent('Nice.');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const snapshot = { type: 'post-report', calories: { consumed: 850 } };
    await service.generate(snapshot);

    const input = agent.generate.mock.calls[0][0];
    expect(JSON.parse(input)).toEqual(snapshot);
  });

  it('returns empty string when LLM returns empty', async () => {
    const agent = makeMockAgent('');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report' });
    expect(result).toBe('');
  });

  it('returns empty string when LLM throws', async () => {
    const agent = { generate: vi.fn().mockRejectedValue(new Error('timeout')) };
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report' });
    expect(result).toBe('');
  });

  it('strips HTML tags from LLM output', async () => {
    const agent = makeMockAgent('<b>Bold</b> commentary <blockquote>no</blockquote>');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report' });
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<blockquote>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/CoachingCommentaryService.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CoachingCommentaryService**

Create `backend/src/3_applications/coaching/CoachingCommentaryService.mjs`:

```javascript
const SYSTEM_PROMPT = `You are a nutrition coach providing brief commentary on a user's daily tracking data.

RULES:
- One sentence only. Max 30 words.
- Output raw text, no HTML tags (the caller wraps it in <blockquote>).
- Conversational, direct. Talk like a friend who happens to know your numbers.
- Reference specific foods or items from the data when relevant.
- NEVER repeat an observation from recent_coaching. Find something new or say nothing.
- NEVER use phrases like "great job", "keep it up", "you've got this", "stay consistent".
- NEVER give generic advice like "focus on protein-rich foods" or "ensure consistent tracking".
- If there is genuinely nothing interesting to say, return an empty string.
- Time awareness: if time_of_day is "morning", don't warn about low intake — the day just started.
- The user does not eat breakfast. Do not mention missing breakfast or morning meals.

ASSIGNMENT CONTEXT:
- post-report: Comment on what was just logged. What stands out? Budget status?
- morning-brief: Comment on yesterday or recent trend. What's the story of the past few days?
- weekly-digest: What's the narrative arc of the week? What changed vs prior weeks?
- exercise-reaction: Frame the burned calories as budget. What does it buy?`;

/**
 * Generates a single commentary sentence via Mastra generate().
 * If the LLM fails or returns nothing, returns empty string.
 */
export class CoachingCommentaryService {
  #agentFactory;
  #logger;

  /**
   * @param {Object} deps
   * @param {Function} deps.agentFactory - () => Mastra Agent instance (allows lazy creation and test injection)
   * @param {Object} [deps.logger]
   */
  constructor({ agentFactory, logger }) {
    this.#agentFactory = agentFactory;
    this.#logger = logger || console;
  }

  /**
   * @param {Object} snapshot - Pre-computed data snapshot
   * @returns {Promise<string>} Commentary sentence or empty string
   */
  async generate(snapshot) {
    try {
      const agent = this.#agentFactory();
      const response = await agent.generate(JSON.stringify(snapshot));
      const raw = response?.text?.trim() || '';

      // Strip any HTML tags the LLM might have included despite instructions
      const cleaned = raw.replace(/<[^>]*>/g, '').trim();

      this.#logger.debug?.('coaching.commentary.generated', {
        type: snapshot.type,
        length: cleaned.length,
        text: cleaned.slice(0, 100),
      });

      return cleaned;
    } catch (err) {
      this.#logger.warn?.('coaching.commentary.failed', { type: snapshot.type, error: err.message });
      return '';
    }
  }

  /** Expose system prompt for testing/inspection */
  static get SYSTEM_PROMPT() {
    return SYSTEM_PROMPT;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/CoachingCommentaryService.test.mjs`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/coaching/CoachingCommentaryService.mjs tests/unit/coaching/CoachingCommentaryService.test.mjs
git commit -m "feat(coaching): add LLM commentary service with Mastra generate()"
```

---

## Task 4: Snapshot Builders

**Files:**
- Create: `backend/src/3_applications/coaching/snapshots.mjs`

- [ ] **Step 1: Write the snapshot builders**

Create `backend/src/3_applications/coaching/snapshots.mjs`:

```javascript
/**
 * Build pre-computed data snapshots for LLM commentary.
 * Each builder takes raw data from datastores and returns a compact JSON object.
 */

/**
 * @param {Object} opts
 * @param {string} opts.date - Report date (YYYY-MM-DD)
 * @param {string} opts.timeOfDay - 'morning' | 'afternoon' | 'evening'
 * @param {{consumed: number, goal_min: number, goal_max: number}} opts.calories
 * @param {{consumed: number, goal: number}} opts.protein
 * @param {Array<{name: string, calories: number, protein: number}>} opts.items - Today's food items
 * @param {string|null} opts.recentPattern - Pattern from detectPattern()
 * @param {number|null} opts.weightTrend7d
 * @param {Array<{type: string, hours_ago: number, text: string}>} opts.recentCoaching
 */
export function buildPostReportSnapshot({ date, timeOfDay, calories, protein, items, recentPattern, weightTrend7d, recentCoaching }) {
  // Pick top 3 notable items by protein contribution, then calories
  const notable = (items || [])
    .filter(i => i.calories > 0)
    .sort((a, b) => (b.protein || 0) - (a.protein || 0) || (b.calories || 0) - (a.calories || 0))
    .slice(0, 3)
    .map(i => {
      const parts = [i.name || 'Unknown'];
      if (i.protein > 0) parts.push(`${Math.round(i.protein)}g protein`);
      return parts.join(' (') + (parts.length > 1 ? ')' : '');
    });

  return {
    type: 'post-report',
    date,
    time_of_day: timeOfDay,
    calories: { consumed: calories.consumed, goal_min: calories.goal_min, goal_max: calories.goal_max, pct: calories.goal_max > 0 ? Math.round((calories.consumed / calories.goal_max) * 100) : 0 },
    protein: { consumed: protein.consumed, goal: protein.goal, pct: protein.goal > 0 ? Math.round((protein.consumed / protein.goal) * 100) : 0 },
    notable_items: notable,
    recent_pattern: recentPattern,
    weight_trend_7d: weightTrend7d,
    recent_coaching: recentCoaching || [],
  };
}

/**
 * @param {Object} opts
 * @param {string} opts.date
 * @param {{calories: number, protein: number}} opts.yesterday
 * @param {{calories: number, protein: number}} opts.weekAvg
 * @param {number} opts.proteinGoal
 * @param {{current: number, trend7d: number}} opts.weight
 * @param {string|null} opts.recentPattern
 * @param {Array} opts.recentCoaching
 * @param {Array<{date: string, calories: number, protein: number}>} opts.recentDays - Last 7 days for context
 */
export function buildMorningBriefSnapshot({ date, yesterday, weekAvg, proteinGoal, weight, recentPattern, recentCoaching, recentDays }) {
  return {
    type: 'morning-brief',
    date,
    time_of_day: 'morning',
    yesterday,
    week_avg: weekAvg,
    protein_goal: proteinGoal,
    weight: { current: weight.current, trend_7d: weight.trend7d },
    recent_pattern: recentPattern,
    recent_days: (recentDays || []).slice(0, 7).map(d => ({ date: d.date, calories: d.calories, protein: d.protein })),
    recent_coaching: recentCoaching || [],
  };
}

/**
 * @param {Object} opts
 * @param {{avgCalories: number, avgProtein: number}} opts.thisWeek
 * @param {{avgCalories: number, avgProtein: number}} opts.longTermAvg
 * @param {{weekStart: number, weekEnd: number, trend7d: number}} opts.weight
 * @param {Array} opts.recentCoaching
 * @param {Array<{date: string, calories: number, protein: number}>} opts.weekDays - This week's daily data
 */
export function buildWeeklyDigestSnapshot({ thisWeek, longTermAvg, weight, recentCoaching, weekDays }) {
  return {
    type: 'weekly-digest',
    this_week: thisWeek,
    long_term_avg: longTermAvg,
    weight: { week_start: weight.weekStart, week_end: weight.weekEnd, trend_7d: weight.trend7d },
    week_days: (weekDays || []).map(d => ({ date: d.date, calories: d.calories, protein: d.protein })),
    recent_coaching: recentCoaching || [],
  };
}

/**
 * @param {Object} opts
 * @param {{type: string, durationMin: number, caloriesBurned: number}} opts.activity
 * @param {number} opts.budgetImpact
 * @param {{consumed: number, goal_max: number}} opts.todayCalories
 * @param {Array} opts.recentCoaching
 */
export function buildExerciseReactionSnapshot({ activity, budgetImpact, todayCalories, recentCoaching }) {
  return {
    type: 'exercise-reaction',
    activity,
    budget_impact: budgetImpact,
    today_calories: todayCalories,
    recent_coaching: recentCoaching || [],
  };
}

/**
 * Build recent_coaching array from coaching history.
 * @param {Object} coachingData - Keyed by date, each value is array of {type, text, timestamp}
 * @param {number} [windowDays=4] - How many days back to include
 * @returns {Array<{type: string, hours_ago: number, text: string}>}
 */
export function buildRecentCoaching(coachingData, windowDays = 4) {
  if (!coachingData) return [];

  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const entries = [];

  for (const [date, messages] of Object.entries(coachingData)) {
    for (const msg of messages) {
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (ts < cutoff) continue;
      entries.push({
        type: msg.type,
        hours_ago: Math.round((now - ts) / (60 * 60 * 1000)),
        text: (msg.text || '').slice(0, 200),
      });
    }
  }

  return entries.sort((a, b) => a.hours_ago - b.hours_ago);
}

/**
 * Determine time of day from timezone.
 * @param {string} [timezone='America/Los_Angeles']
 * @returns {'morning' | 'afternoon' | 'evening'}
 */
export function getTimeOfDay(timezone = 'America/Los_Angeles') {
  const hour = new Date().toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
  const h = parseInt(hour, 10);
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/3_applications/coaching/snapshots.mjs
git commit -m "feat(coaching): add data snapshot builders for LLM context"
```

---

## Task 5: CoachingOrchestrator

**Files:**
- Create: `backend/src/3_applications/coaching/CoachingOrchestrator.mjs`
- Create: `backend/src/3_applications/coaching/index.mjs`
- Test: `tests/unit/coaching/CoachingOrchestrator.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/coaching/CoachingOrchestrator.test.mjs`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoachingOrchestrator } from '../../../backend/src/3_applications/coaching/CoachingOrchestrator.mjs';

describe('CoachingOrchestrator', () => {
  let orchestrator;
  let mockCommentary;
  let mockMessaging;
  let mockHealthStore;
  let mockNutriListStore;
  let mockConfig;

  beforeEach(() => {
    mockCommentary = { generate: vi.fn().mockResolvedValue('Nice protein hit.') };
    mockMessaging = { sendMessage: vi.fn().mockResolvedValue({ messageId: '123' }) };
    mockHealthStore = {
      loadNutritionData: vi.fn().mockResolvedValue({}),
      loadWeightData: vi.fn().mockResolvedValue({}),
      loadCoachingData: vi.fn().mockResolvedValue({}),
      saveCoachingData: vi.fn(),
    };
    mockNutriListStore = {
      findByDate: vi.fn().mockResolvedValue([
        { name: 'Chicken', calories: 300, protein: 40 },
        { name: 'Rice', calories: 200, protein: 5 },
      ]),
    };
    mockConfig = {
      getUserGoals: vi.fn().mockReturnValue({ calories_min: 1200, calories_max: 1600, protein: 120 }),
      getUserTimezone: vi.fn().mockReturnValue('America/Los_Angeles'),
    };

    orchestrator = new CoachingOrchestrator({
      commentaryService: mockCommentary,
      messagingGateway: mockMessaging,
      healthStore: mockHealthStore,
      nutriListStore: mockNutriListStore,
      config: mockConfig,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  });

  it('sends post-report message with status block + commentary', async () => {
    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockMessaging.sendMessage).toHaveBeenCalledOnce();
    const [convId, text, opts] = mockMessaging.sendMessage.mock.calls[0];
    expect(convId).toBe('telegram:123');
    expect(text).toContain('<b>850 / 1600 cal</b>');
    expect(text).toContain('<blockquote>Nice protein hit.</blockquote>');
    expect(opts.parseMode).toBe('HTML');
  });

  it('sends status block without commentary when LLM returns empty', async () => {
    mockCommentary.generate.mockResolvedValue('');

    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    const [, text] = mockMessaging.sendMessage.mock.calls[0];
    expect(text).toContain('<b>850 / 1600 cal</b>');
    expect(text).not.toContain('<blockquote>');
  });

  it('persists coaching message to history', async () => {
    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockHealthStore.saveCoachingData).toHaveBeenCalledOnce();
    const [userId, data] = mockHealthStore.saveCoachingData.mock.calls[0];
    expect(userId).toBe('kckern');
    expect(data['2026-04-07']).toBeDefined();
    expect(data['2026-04-07'][0].type).toBe('post-report');
  });

  it('still sends status block when LLM throws', async () => {
    mockCommentary.generate.mockRejectedValue(new Error('timeout'));

    await orchestrator.sendPostReport({
      userId: 'kckern',
      conversationId: 'telegram:123',
      date: '2026-04-07',
      totals: { calories: 850, protein: 62, carbs: 100, fat: 30 },
    });

    expect(mockMessaging.sendMessage).toHaveBeenCalledOnce();
    const [, text] = mockMessaging.sendMessage.mock.calls[0];
    expect(text).toContain('<b>850 / 1600 cal</b>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/CoachingOrchestrator.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CoachingOrchestrator**

Create `backend/src/3_applications/coaching/CoachingOrchestrator.mjs`:

```javascript
import { CoachingMessageBuilder } from './CoachingMessageBuilder.mjs';
import { detectPattern } from './patterns.mjs';
import { buildPostReportSnapshot, buildMorningBriefSnapshot, buildWeeklyDigestSnapshot, buildExerciseReactionSnapshot, buildRecentCoaching, getTimeOfDay } from './snapshots.mjs';

/**
 * Coordinates data gathering → status block → LLM commentary → delivery → persistence.
 */
export class CoachingOrchestrator {
  #commentaryService;
  #messagingGateway;
  #healthStore;
  #nutriListStore;
  #config;
  #logger;

  constructor({ commentaryService, messagingGateway, healthStore, nutriListStore, config, logger }) {
    this.#commentaryService = commentaryService;
    this.#messagingGateway = messagingGateway;
    this.#healthStore = healthStore;
    this.#nutriListStore = nutriListStore;
    this.#config = config;
    this.#logger = logger || console;
  }

  /**
   * Send coaching message after a nutrition report is generated.
   * @param {{userId: string, conversationId: string, date: string, totals: {calories, protein, carbs, fat}}} opts
   */
  async sendPostReport({ userId, conversationId, date, totals }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const [coachingData, nutritionData, weightData, items] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
        this.#nutriListStore.findByDate(userId, date).catch(() => []),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const recentDays = this.#getRecentDays(nutritionData, date, 5);
      const pattern = detectPattern(recentDays, goals);
      const weightTrend = this.#getWeightTrend7d(weightData, date);
      const timeOfDay = getTimeOfDay(this.#config.getUserTimezone?.(userId));

      // Build status block
      const statusBlock = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: totals.calories, goal_min: goals.calories_min, goal_max: goals.calories_max || goals.calories },
        protein: { consumed: totals.protein, goal: goals.protein },
      });

      // Build snapshot and get commentary
      const snapshot = buildPostReportSnapshot({
        date, timeOfDay,
        calories: { consumed: totals.calories, goal_min: goals.calories_min, goal_max: goals.calories_max || goals.calories },
        protein: { consumed: totals.protein, goal: goals.protein },
        items, recentPattern: pattern, weightTrend7d: weightTrend, recentCoaching,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      // Deliver
      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });

      // Persist
      await this.#persistCoaching(userId, date, 'post-report', message);

      this.#logger.info?.('coaching.post_report.sent', { userId, date, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.post_report.failed', { userId, date, error: err.message });
    }
  }

  /**
   * Send morning brief coaching message.
   * @param {{userId: string, conversationId: string}} opts
   */
  async sendMorningBrief({ userId, conversationId }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, nutritionData, weightData] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const recentDays = this.#getRecentDays(nutritionData, today, 7);
      const yesterday = recentDays[0] || { calories: 0, protein: 0 };
      const weekAvg = this.#computeAvg(recentDays);
      const pattern = detectPattern(recentDays, goals);
      const weight = this.#getWeightSnapshot(weightData, today);

      const statusBlock = CoachingMessageBuilder.buildMorningBriefBlock({
        yesterday, weekAvg, proteinGoal: goals.protein, weight,
      });

      const snapshot = buildMorningBriefSnapshot({
        date: today, yesterday, weekAvg, proteinGoal: goals.protein,
        weight, recentPattern: pattern, recentCoaching, recentDays,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, today, 'morning-brief', message);

      this.#logger.info?.('coaching.morning_brief.sent', { userId, date: today, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.morning_brief.failed', { userId, error: err.message });
    }
  }

  /**
   * Send weekly digest coaching message.
   * @param {{userId: string, conversationId: string}} opts
   */
  async sendWeeklyDigest({ userId, conversationId }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, nutritionData, weightData] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const weekDays = this.#getRecentDays(nutritionData, today, 7);
      const longTermDays = this.#getRecentDays(nutritionData, today, 56);
      const thisWeek = this.#computeAvg(weekDays);
      const longTermAvg = this.#computeAvg(longTermDays);
      const weight = this.#getWeightSnapshotWeekly(weightData, today);

      const statusBlock = CoachingMessageBuilder.buildWeeklyDigestBlock({
        thisWeek: { avgCalories: thisWeek.calories, avgProtein: thisWeek.protein },
        longTermAvg: { avgCalories: longTermAvg.calories, avgProtein: longTermAvg.protein },
        weight,
      });

      const snapshot = buildWeeklyDigestSnapshot({
        thisWeek: { avgCalories: thisWeek.calories, avgProtein: thisWeek.protein },
        longTermAvg: { avgCalories: longTermAvg.calories, avgProtein: longTermAvg.protein },
        weight, recentCoaching, weekDays,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, today, 'weekly-digest', message);

      this.#logger.info?.('coaching.weekly_digest.sent', { userId, date: today, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.weekly_digest.failed', { userId, error: err.message });
    }
  }

  /**
   * Send exercise reaction coaching message.
   * @param {{userId: string, conversationId: string, activity: {type, durationMin, caloriesBurned}}} opts
   */
  async sendExerciseReaction({ userId, conversationId, activity }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, nutritionData] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
      ]);

      const todayNutrition = nutritionData[today] || { calories: 0 };
      // Roughly half the burned calories as budget impact (conservative estimate)
      const budgetImpact = Math.round(activity.caloriesBurned * 0.5);
      const recentCoaching = buildRecentCoaching(coachingData);

      const statusBlock = CoachingMessageBuilder.buildExerciseReactionBlock({ activity, budgetImpact });

      const snapshot = buildExerciseReactionSnapshot({
        activity, budgetImpact,
        todayCalories: { consumed: todayNutrition.calories, goal_max: goals.calories_max || goals.calories },
        recentCoaching,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, today, 'exercise-reaction', message);

      this.#logger.info?.('coaching.exercise_reaction.sent', { userId, date: today, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.exercise_reaction.failed', { userId, error: err.message });
    }
  }

  // ── Private helpers ──

  #getToday(userId) {
    const tz = this.#config.getUserTimezone?.(userId) || 'America/Los_Angeles';
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  }

  #getRecentDays(nutritionData, beforeDate, count) {
    return Object.keys(nutritionData || {})
      .filter(d => d < beforeDate)
      .sort()
      .reverse()
      .slice(0, count)
      .map(d => ({
        date: d,
        calories: nutritionData[d]?.calories || 0,
        protein: nutritionData[d]?.protein || 0,
      }));
  }

  #computeAvg(days) {
    if (!days.length) return { calories: 0, protein: 0 };
    const sum = days.reduce((acc, d) => ({ calories: acc.calories + d.calories, protein: acc.protein + d.protein }), { calories: 0, protein: 0 });
    return { calories: Math.round(sum.calories / days.length), protein: Math.round(sum.protein / days.length) };
  }

  #getWeightTrend7d(weightData, date) {
    const dates = Object.keys(weightData || {}).filter(d => d <= date).sort().reverse();
    if (dates.length < 2) return null;
    const recent = weightData[dates[0]]?.weight || weightData[dates[0]];
    const weekAgo = dates.find((d, i) => i > 0 && this.#daysBetween(d, dates[0]) >= 6);
    if (!weekAgo) return null;
    const older = weightData[weekAgo]?.weight || weightData[weekAgo];
    if (typeof recent !== 'number' || typeof older !== 'number') return null;
    return Math.round((recent - older) * 100) / 100;
  }

  #getWeightSnapshot(weightData, today) {
    const dates = Object.keys(weightData || {}).filter(d => d <= today).sort().reverse();
    const current = dates[0] ? (weightData[dates[0]]?.weight || weightData[dates[0]]) : null;
    const trend7d = this.#getWeightTrend7d(weightData, today);
    return { current: typeof current === 'number' ? current : 0, trend7d: trend7d || 0 };
  }

  #getWeightSnapshotWeekly(weightData, today) {
    const dates = Object.keys(weightData || {}).filter(d => d <= today).sort().reverse();
    const weekEnd = dates[0] ? (weightData[dates[0]]?.weight || weightData[dates[0]]) : 0;
    const weekStartDate = dates.find(d => this.#daysBetween(d, dates[0]) >= 6);
    const weekStart = weekStartDate ? (weightData[weekStartDate]?.weight || weightData[weekStartDate]) : weekEnd;
    return {
      weekStart: typeof weekStart === 'number' ? weekStart : 0,
      weekEnd: typeof weekEnd === 'number' ? weekEnd : 0,
      trend7d: typeof weekEnd === 'number' && typeof weekStart === 'number' ? Math.round((weekEnd - weekStart) * 100) / 100 : 0,
    };
  }

  #daysBetween(dateA, dateB) {
    return Math.abs((new Date(dateB) - new Date(dateA)) / (24 * 60 * 60 * 1000));
  }

  async #persistCoaching(userId, date, type, text) {
    try {
      const data = await this.#healthStore.loadCoachingData(userId).catch(() => ({}));
      if (!data[date]) data[date] = [];
      data[date].push({ type, text, timestamp: new Date().toISOString() });
      await this.#healthStore.saveCoachingData(userId, data);
    } catch (err) {
      this.#logger.warn?.('coaching.persist.failed', { userId, date, type, error: err.message });
    }
  }
}
```

- [ ] **Step 4: Create barrel export**

Create `backend/src/3_applications/coaching/index.mjs`:

```javascript
export { CoachingMessageBuilder } from './CoachingMessageBuilder.mjs';
export { CoachingCommentaryService } from './CoachingCommentaryService.mjs';
export { CoachingOrchestrator } from './CoachingOrchestrator.mjs';
export { detectPattern } from './patterns.mjs';
export * from './snapshots.mjs';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/unit/coaching/CoachingOrchestrator.test.mjs`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/coaching/CoachingOrchestrator.mjs backend/src/3_applications/coaching/index.mjs tests/unit/coaching/CoachingOrchestrator.test.mjs
git commit -m "feat(coaching): add orchestrator coordinating builder + commentary + delivery"
```

---

## Task 6: Fix Scheduler Deduplication

**Files:**
- Modify: `backend/src/3_applications/agents/framework/Scheduler.mjs`

- [ ] **Step 1: Add idempotency guard to Scheduler#tick()**

In `backend/src/3_applications/agents/framework/Scheduler.mjs`, add a `#recentRuns` Map and check it before executing:

Add field after line 14 (`#running = false;`):

```javascript
  #recentRuns = new Map(); // key: jobKey:dateHour → true
```

Replace the `#tick()` method (lines 93-123) with:

```javascript
  async #tick() {
    if (this.#running) return;
    this.#running = true;

    try {
      const now = new Date();
      // Prune old dedup keys (older than 2 hours)
      const pruneThreshold = now.getTime() - 2 * 60 * 60 * 1000;
      for (const [key, ts] of this.#recentRuns) {
        if (ts < pruneThreshold) this.#recentRuns.delete(key);
      }

      for (const [jobKey, job] of this.#jobs) {
        if (this.#isDue(job, now)) {
          // Idempotency guard: skip if already ran this hour
          const dateHour = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}`;
          const dedupKey = `${jobKey}:${dateHour}`;
          if (this.#recentRuns.has(dedupKey)) {
            this.#logger.debug?.('scheduler.dedup.skipped', { jobKey, dedupKey });
            continue;
          }

          job.lastRun = now;
          this.#recentRuns.set(dedupKey, now.getTime());
          this.#logger.info?.('scheduler.trigger', { jobKey });
          try {
            if (job.handler) {
              await job.handler();
            } else {
              await job.orchestrator.runAssignment(
                job.agentId,
                job.assignmentId,
                { triggeredBy: 'scheduler' }
              );
            }
          } catch (err) {
            this.#logger.error?.('scheduler.failed', { jobKey, error: err.message });
          }
        }
      }
    } finally {
      this.#running = false;
    }
  }
```

- [ ] **Step 2: Verify existing scheduler tests still pass (if any)**

Run: `NODE_OPTIONS=--experimental-vm-modules npx vitest run tests/ --reporter=line 2>&1 | grep -i scheduler`
If no scheduler tests exist, skip to commit.

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/agents/framework/Scheduler.mjs
git commit -m "fix(scheduler): add hourly idempotency guard to prevent duplicate assignment fires"
```

---

## Task 7: Remove Old Coaching Triggers from AcceptFoodLog

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs`

- [ ] **Step 1: Remove coaching triggers**

In `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs`, remove the `end-of-day-report` and `note-review` fire-and-forget calls.

Replace lines 140-175 (from `// 7. If no pending logs remain` through the `note-review` block) with:

```javascript
      // 7. If no pending logs remain, auto-generate today's report
      if (this.#foodLogStore?.findPending && this.#generateDailyReport?.execute) {
        try {
          const pending = await this.#foodLogStore.findPending(userId);
          this.#logger.debug?.('acceptLog.autoreport.pendingCheck', { userId, pendingCount: pending.length });
          if (pending.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              date: nutriLog.meal?.date || nutriLog.date,
              responseContext,
            });
          }
        } catch (e) {
          this.#logger.warn?.('acceptLog.autoreport.error', { error: e.message });
        }
      }
```

This keeps the report generation but removes both coaching triggers. Coaching will be triggered by GenerateDailyReport instead (Task 8).

- [ ] **Step 2: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs
git commit -m "refactor(nutribot): remove coaching triggers from AcceptFoodLog

Coaching is now triggered by GenerateDailyReport (post-report) instead
of fire-and-forget from AcceptFoodLog."
```

---

## Task 8: Add Post-Report Coaching to GenerateDailyReport

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs`

- [ ] **Step 1: Add coachingOrchestrator dependency**

In `GenerateDailyReport.mjs`, add `#coachingOrchestrator` to the class fields and constructor. The constructor currently receives deps like `foodLogStore`, `nutriListStore`, etc.

Add field:
```javascript
  #coachingOrchestrator;
```

In the constructor, add:
```javascript
  this.#coachingOrchestrator = deps.coachingOrchestrator || null;
```

- [ ] **Step 2: Add coaching call after report send**

After the report is sent and the message ID is saved (after the `// 12. Save report message ID` block, around line 250), add:

```javascript
      // 13. Send coaching commentary (fire-and-forget)
      if (this.#coachingOrchestrator) {
        this.#coachingOrchestrator.sendPostReport({
          userId,
          conversationId,
          date,
          totals,
        }).catch(e => this.#logger.warn?.('report.coaching.error', { error: e.message }));
      }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs
git commit -m "feat(nutribot): trigger post-report coaching from GenerateDailyReport"
```

---

## Task 9: Wire CoachingOrchestrator in Bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Add import**

Add near the other application imports (around line 173):

```javascript
import { CoachingOrchestrator, CoachingCommentaryService } from '#apps/coaching/index.mjs';
```

- [ ] **Step 2: Check if subpath import `#apps/coaching/index.mjs` is configured**

Check `backend/package.json` for the `imports` field to verify `#apps` maps to `./src/3_applications`. If it does, the import will work. If not, use the relative path.

Run: `grep -A5 '"#apps"' backend/package.json`

- [ ] **Step 3: Create CoachingOrchestrator instance after health-coach agent registration**

After the `agentOrchestrator.register(HealthCoachAgent, {...})` block (around line 2750), add:

```javascript
    // Create coaching orchestrator (new template-driven system)
    let coachingOrchestrator = null;
    if (healthStore && messagingGateway) {
      const { Agent } = await import('@mastra/core/agent');
      const commentaryAgentFactory = () => new Agent({
        name: 'health-coach-commentary',
        instructions: CoachingCommentaryService.SYSTEM_PROMPT,
        model: 'openai/gpt-4o-mini',
      });

      const commentaryService = new CoachingCommentaryService({
        agentFactory: commentaryAgentFactory,
        logger,
      });

      coachingOrchestrator = new CoachingOrchestrator({
        commentaryService,
        messagingGateway,
        healthStore,
        nutriListStore: nutriListDatastore,
        config: configService,
        logger,
      });
    }
```

- [ ] **Step 4: Pass coachingOrchestrator to GenerateDailyReport**

Find where `GenerateDailyReport` is instantiated in bootstrap (search for `new GenerateDailyReport` or `generateDailyReport`). Add `coachingOrchestrator` to its dependency object.

- [ ] **Step 5: Register scheduler jobs for morning-brief and weekly-digest**

After the coaching orchestrator creation, add scheduler registrations:

```javascript
    // Register coaching schedule (replaces old HealthCoachAgent scheduler assignments)
    if (coachingOrchestrator && scheduler) {
      const coachingConversationId = conversationId ?? configService?.getNutribotConversationId?.() ?? null;
      const coachingUserId = configService?.getHeadOfHousehold?.() || 'default';

      if (coachingConversationId) {
        scheduler.registerTask('coaching:morning-brief', '0 10 * * *', async () => {
          await coachingOrchestrator.sendMorningBrief({ userId: coachingUserId, conversationId: coachingConversationId });
        });

        scheduler.registerTask('coaching:weekly-digest', '0 19 * * 0', async () => {
          await coachingOrchestrator.sendWeeklyDigest({ userId: coachingUserId, conversationId: coachingConversationId });
        });
      }
    }
```

Note: The Scheduler already has `registerTask()` (check the file — if it only has `registerAgent()`, we'll need to add a `registerTask()` method. The explore agent found a `job.handler` check in `#tick()` at line 109, so `registerTask` likely exists.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): wire CoachingOrchestrator with Mastra commentary service"
```

---

## Task 10: Update HealthCoachAgent to Remove Old Assignments

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`

- [ ] **Step 1: Remove old coaching assignment registrations**

In `HealthCoachAgent.mjs`, in the `registerTools()` method, remove these lines:

```javascript
    this.registerAssignment(new MorningBrief());
    this.registerAssignment(new NoteReview());
    this.registerAssignment(new EndOfDayReport());
    this.registerAssignment(new WeeklyDigest());
    this.registerAssignment(new ExerciseReaction());
```

Keep only:
```javascript
    this.registerAssignment(new DailyDashboard());
```

Also remove the corresponding imports at the top of the file.

- [ ] **Step 2: Simplify runAssignment()**

In `runAssignment()`, remove the coaching delivery block (the `const coachingAssignments = [...]` section and everything after it). The method should only handle `daily-dashboard` now:

```javascript
  async runAssignment(assignmentId, opts = {}) {
    if (!opts.userId) {
      opts.userId = this.deps.configService?.getHeadOfHousehold?.() || 'default';
    }
    const result = await super.runAssignment(assignmentId, opts);

    if (assignmentId === 'daily-dashboard' && result) {
      const writeTool = this.getTools().find(t => t.name === 'write_dashboard');
      if (writeTool) {
        const today = new Date().toISOString().split('T')[0];
        await writeTool.execute({ userId: opts.userId, date: today, dashboard: result });
      }
    }

    return result;
  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
git commit -m "refactor(health-coach): remove old coaching assignments, keep only daily-dashboard"
```

---

## Task 11: Rewire Strava Webhook Exercise Reaction

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`

- [ ] **Step 1: Replace old exercise-reaction trigger with CoachingOrchestrator**

In `backend/src/4_api/v1/routers/fitness.mjs`, around lines 847-855, replace:

```javascript
        // Trigger HealthCoachAgent exercise reaction (fire-and-forget)
        // The assignment itself guards on calorie threshold (>200 cal)
        if (adapter.shouldEnrich?.(event)) {
          const userId = event.ownerId;
          agentOrchestrator?.runAssignment('health-coach', 'exercise-reaction', {
            userId,
            context: { activity: event },
          }).catch(err => logger.warn?.('strava.exerciseReaction.error', { error: err.message }));
        }
```

With:

```javascript
        // Trigger coaching exercise reaction (fire-and-forget)
        if (adapter.shouldEnrich?.(event) && event.calories > 200) {
          const userId = event.ownerId;
          const conversationId = router.orchestrator?.deps?.conversationId
            || configService?.getNutribotConversationId?.()
            || null;
          if (coachingOrchestrator && conversationId) {
            coachingOrchestrator.sendExerciseReaction({
              userId,
              conversationId,
              activity: {
                type: event.type || 'Workout',
                durationMin: Math.round((event.duration || 0) / 60),
                caloriesBurned: event.calories || 0,
              },
            }).catch(err => logger.warn?.('strava.exerciseReaction.error', { error: err.message }));
          }
        }
```

Note: `coachingOrchestrator` needs to be accessible in the router scope. Check how it's passed — it may need to be attached to the router object (e.g., `router.coachingOrchestrator`) similar to how `router.orchestrator` and `router.scheduler` are set in bootstrap. If so, also add `router.coachingOrchestrator = coachingOrchestrator;` in bootstrap after creating it, and reference it as `router.coachingOrchestrator` in the fitness router.

- [ ] **Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "refactor(fitness): rewire Strava exercise reaction to CoachingOrchestrator"
```

---

## Task 12: Manual Verification

- [ ] **Step 1: Build Docker image**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

- [ ] **Step 2: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 3: Trigger a post-report coaching message**

Log a food item via Telegram, accept it, and verify:
1. The nutribot report PNG is sent
2. A coaching message follows with the structured status block format
3. The commentary (if any) is in a `<blockquote>`
4. No duplicate messages

- [ ] **Step 4: Check logs for coaching events**

```bash
sudo docker logs daylight-station --tail 50 2>&1 | grep "coaching\."
```

Expected: `coaching.post_report.sent` with `hasCommentary: true/false`

- [ ] **Step 5: Verify no duplicate morning briefs**

Wait for 10 AM cron or manually trigger, then check:
```bash
sudo docker logs daylight-station 2>&1 | grep "coaching.morning_brief\|scheduler.dedup"
```

Expected: Single `coaching.morning_brief.sent`, no `scheduler.dedup.skipped` (or if dedup fires, only one actual send).
