# Nutribot Coaching Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nutribot's vapid per-accept coaching with HealthCoachAgent-powered, reconciliation-aware messaging that only speaks when it has something useful to say.

**Architecture:** HealthCoachAgent gains 5 new assignments and 2 new tool factories. Nutribot's 3 coaching use cases are deleted. AcceptFoodLog delegates coaching decisions to the agent. Strava webhook triggers exercise-reaction assignment.

**Tech Stack:** Node.js ES modules, Mastra agent framework (via MastraAdapter), YAML persistence, Telegram Bot API, node-canvas (reports)

**Spec:** `docs/superpowers/specs/2026-03-25-nutribot-coaching-redesign.md`

**Reference files:**
- Agent framework: `docs/ai-context/agents.md`
- HealthCoachAgent: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`
- DailyDashboard (reference assignment): `backend/src/3_applications/agents/health-coach/assignments/DailyDashboard.mjs`
- Assignment base: `backend/src/3_applications/agents/framework/Assignment.mjs`
- HealthToolFactory: `backend/src/3_applications/agents/health-coach/tools/HealthToolFactory.mjs`
- DashboardToolFactory: `backend/src/3_applications/agents/health-coach/tools/DashboardToolFactory.mjs`
- AcceptFoodLog: `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs`
- NutribotContainer: `backend/src/3_applications/nutribot/NutribotContainer.mjs`
- GenerateThresholdCoaching (to delete): `backend/src/3_applications/nutribot/usecases/GenerateThresholdCoaching.mjs`
- GenerateReportCoaching (to delete): `backend/src/3_applications/nutribot/usecases/GenerateReportCoaching.mjs`
- GenerateOnDemandCoaching (to delete): `backend/src/3_applications/nutribot/usecases/GenerateOnDemandCoaching.mjs`
- Strava webhook: `backend/src/4_api/v1/routers/fitness.mjs`
- Bootstrap: `backend/src/0_system/bootstrap.mjs`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs` | Tools for reconciliation, adjusted nutrition, coaching history |
| `backend/src/3_applications/agents/health-coach/tools/MessagingChannelToolFactory.mjs` | `send_channel_message` tool for pushing messages to Telegram |
| `backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs` | Scheduled daily brief with reconciled yesterday + today's target |
| `backend/src/3_applications/agents/health-coach/assignments/NoteReview.mjs` | Event-triggered per-accept review — agent decides whether to speak |
| `backend/src/3_applications/agents/health-coach/assignments/EndOfDayReport.mjs` | Event-triggered coaching commentary for daily report |
| `backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs` | Scheduled weekly trend summary |
| `backend/src/3_applications/agents/health-coach/assignments/ExerciseReaction.mjs` | Strava webhook-triggered exercise context message |
| `backend/src/3_applications/agents/health-coach/schemas/coachingMessage.mjs` | Output schema for Telegram-bound messages |
| `tests/unit/agents/health-coach/ReconciliationToolFactory.test.mjs` | Tests for reconciliation tools |
| `tests/unit/agents/health-coach/MessagingChannelToolFactory.test.mjs` | Tests for Telegram channel tool |
| `tests/unit/agents/health-coach/MorningBrief.test.mjs` | Tests for morning brief assignment |
| `tests/unit/agents/health-coach/NoteReview.test.mjs` | Tests for note review assignment |
| `tests/unit/agents/health-coach/EndOfDayReport.test.mjs` | Tests for end-of-day report assignment |
| `tests/unit/agents/health-coach/WeeklyDigest.test.mjs` | Tests for weekly digest assignment |
| `tests/unit/agents/health-coach/ExerciseReaction.test.mjs` | Tests for exercise reaction assignment |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs` | Register new tool factories and assignments |
| `backend/src/3_applications/agents/health-coach/prompts/system.mjs` | Extend system prompt with nutrition coaching rules |
| `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs` | Replace coaching delegation with agent invocation + running total |
| `backend/src/3_applications/nutribot/NutribotContainer.mjs` | Remove coaching use case wiring, add agent orchestrator ref |
| `backend/src/3_applications/nutribot/usecases/index.mjs` | Remove coaching exports |
| `backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs` | Remove `#generateThresholdCoaching` dependency and `#checkAndTriggerCoaching()` |
| `backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs` | Add running total + agent delegation (same as AcceptFoodLog) |
| `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` | Add `coach` command case |
| `backend/src/4_api/v1/routers/fitness.mjs` | Add ExerciseReaction trigger on Strava webhook |
| `backend/src/0_system/bootstrap.mjs` | Wire new deps into HealthCoachAgent, pass orchestrator to NutribotContainer |

### Deleted Files

| File | Reason |
|------|--------|
| `backend/src/3_applications/nutribot/usecases/GenerateThresholdCoaching.mjs` | Replaced by NoteReview assignment |
| `backend/src/3_applications/nutribot/usecases/GenerateReportCoaching.mjs` | Replaced by EndOfDayReport assignment |
| `backend/src/3_applications/nutribot/usecases/GenerateOnDemandCoaching.mjs` | Replaced by direct agent invocation |

---

## Task 1: ReconciliationToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs`
- Test: `tests/unit/agents/health-coach/ReconciliationToolFactory.test.mjs`

- [ ] **Step 1: Write failing tests for `get_reconciliation_summary`**

```javascript
import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { ReconciliationToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs';

describe('ReconciliationToolFactory', () => {
  const mockHealthStore = {
    loadReconciliationData: mock.fn(async () => ({
      '2026-03-23': {
        tracking_accuracy: 0.53,
        implied_intake: 2015,
        tracked_calories: 1063,
        derived_bmr: 1166,
        avg_tracking_accuracy: 0.53,
        exercise_calories: 400,
      },
      '2026-03-22': {
        tracking_accuracy: 0.38,
        implied_intake: 1527,
        tracked_calories: 580,
        avg_tracking_accuracy: 0.53,
        exercise_calories: 0,
      },
    })),
    loadAdjustedNutritionData: mock.fn(async () => ({
      '2026-03-23': {
        calories: 1850,
        protein: 160,
        portion_multiplier: 1.49,
        phantom_calories: 230,
      },
    })),
    loadNutritionData: mock.fn(async () => ({
      '2026-03-23': { calories: 1063, protein: 107 },
    })),
  };
  it('creates 3 tools', () => {
    const factory = new ReconciliationToolFactory({
      healthStore: mockHealthStore,
    });
    const tools = factory.createTools();
    assert.equal(tools.length, 3);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('get_reconciliation_summary'));
    assert.ok(names.includes('get_adjusted_nutrition'));
    assert.ok(names.includes('get_coaching_history'));
  });

  it('get_reconciliation_summary returns accuracy and missed days', async () => {
    const factory = new ReconciliationToolFactory({
      healthStore: mockHealthStore,
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'get_reconciliation_summary');
    const result = await tool.execute({ userId: 'kckern', days: 7 });
    assert.ok(result.avgAccuracy !== undefined);
    assert.ok(result.days !== undefined);
    assert.ok(Array.isArray(result.days));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/agents/health-coach/ReconciliationToolFactory.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ReconciliationToolFactory**

Create `backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs` with 3 tools:

1. `get_reconciliation_summary` — loads `reconciliation.yml` via `healthStore.loadReconciliationData()`, computes window stats (avg accuracy, missed days, best/worst day, accuracy trend), returns per-day records
2. `get_adjusted_nutrition` — loads `nutriday_adjusted.yml` via `healthStore.loadAdjustedNutritionData()`, returns adjusted totals + portion multiplier + phantom calories for a date range
3. `get_coaching_history` — loads coaching data via `healthStore.loadCoachingData()` (same store used by `DashboardToolFactory.log_coaching_note`), returns last N days of coaching messages for dedup

Note: nutrition goals are served by the existing `get_user_goals` tool in `DashboardToolFactory`. No new goals tool needed. Coaching data uses `healthStore` consistently — do NOT introduce a separate `nutriCoachStore`.

Each tool follows the same pattern as `HealthToolFactory`: `createTool()` with JSON Schema parameters, async execute, try/catch with error return.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/agents/health-coach/ReconciliationToolFactory.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/ReconciliationToolFactory.mjs tests/unit/agents/health-coach/ReconciliationToolFactory.test.mjs
git commit -m "feat(health-coach): add ReconciliationToolFactory with reconciliation, adjusted nutrition, coaching history, and goals tools"
```

---

## Task 2: MessagingChannelToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/tools/MessagingChannelToolFactory.mjs`
- Test: `tests/unit/agents/health-coach/MessagingChannelToolFactory.test.mjs`

- [ ] **Step 1: Write failing test**

```javascript
import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { MessagingChannelToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/MessagingChannelToolFactory.mjs';

describe('MessagingChannelToolFactory', () => {
  it('creates send_channel_message tool', () => {
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: mock.fn() },
      configService: { getHeadOfHousehold: () => 'kckern' },
    });
    const tools = factory.createTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'send_channel_message');
  });

  it('send_channel_message calls gateway', async () => {
    const sendMock = mock.fn(async () => ({ messageId: '999' }));
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: sendMock },
      configService: { getHeadOfHousehold: () => 'kckern' },
      conversationId: 'telegram:b123_c456',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'send_channel_message');
    const result = await tool.execute({ text: 'Hello', parseMode: 'HTML' });
    assert.equal(result.success, true);
    assert.equal(sendMock.mock.calls.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/agents/health-coach/MessagingChannelToolFactory.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement MessagingChannelToolFactory**

Single tool: `send_channel_message` — takes `text` and optional `parseMode`, sends via `messagingGateway.sendMessage(conversationId, text, { parseMode })`. The `conversationId` is injected at construction (resolved from user config — the nutribot Telegram chat ID).

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/tools/MessagingChannelToolFactory.mjs tests/unit/agents/health-coach/MessagingChannelToolFactory.test.mjs
git commit -m "feat(health-coach): add MessagingChannelToolFactory for agent-to-Telegram message delivery"
```

---

## Task 3: Telegram Message Output Schema

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/schemas/coachingMessage.mjs`

- [ ] **Step 1: Write the schema**

```javascript
export const coachingMessageSchema = {
  type: 'object',
  properties: {
    should_send: { type: 'boolean', description: 'Whether a message should be sent. False = stay silent.' },
    text: { type: 'string', description: 'Message text (Telegram HTML)' },
    parse_mode: { type: 'string', enum: ['HTML', 'Markdown'], default: 'HTML' },
  },
  required: ['should_send'],
  if: { properties: { should_send: { const: true } } },
  then: { required: ['should_send', 'text'] },
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/schemas/coachingMessage.mjs
git commit -m "feat(health-coach): add telegramMessage output schema for agent coaching messages"
```

---

## Task 3.5: Extend Assignment.gather() to receive context

**Files:**
- Modify: `backend/src/3_applications/agents/framework/Assignment.mjs`
- Test: `tests/unit/agents/framework/Assignment.test.mjs`

- [ ] **Step 1: Read current Assignment.mjs**

Read `backend/src/3_applications/agents/framework/Assignment.mjs`. Line 36: `gather({ tools, userId, memory, logger })` — no `context`.

- [ ] **Step 2: Pass context to gather()**

In `execute()`, change line 36 from:
```javascript
const gathered = await this.gather({ tools, userId, memory, logger });
```
to:
```javascript
const gathered = await this.gather({ tools, userId, memory, logger, context });
```

This is a non-breaking change — existing assignments that don't destructure `context` are unaffected.

- [ ] **Step 3: Run existing Assignment tests**

Run: `node --test tests/unit/agents/framework/Assignment.test.mjs`
Expected: PASS (existing tests don't rely on gather not receiving context)

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/agents/framework/Assignment.mjs
git commit -m "feat(agents): pass context to Assignment.gather() for event-triggered assignments"
```

---

## Task 4: MorningBrief Assignment

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs`
- Test: `tests/unit/agents/health-coach/MorningBrief.test.mjs`

- [ ] **Step 1: Write failing tests**

Test the gather phase returns reconciliation + weight + missed days. Test buildPrompt includes accuracy data. Test act sets `last_morning_brief` in memory.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/agents/health-coach/MorningBrief.test.mjs`

- [ ] **Step 3: Implement MorningBrief**

Extends `Assignment`. `static schedule = '0 10 * * *'`. Gather calls: `get_reconciliation_summary`, `get_weight_trend`, `get_user_goals`, `get_today_nutrition`. BuildPrompt assembles yesterday's reconciled data, weight trend, accuracy window. OutputSchema: `coachingMessageSchema`. Act: set `last_morning_brief` in memory with 24h TTL. **Delivery is NOT in act()** — `HealthCoachAgent.runAssignment()` handles `send_channel_message` after execute returns (same pattern as DailyDashboard's `write_dashboard`).

Follow `DailyDashboard.mjs` pattern exactly for gather/buildPrompt/validate/act structure.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/assignments/MorningBrief.mjs tests/unit/agents/health-coach/MorningBrief.test.mjs
git commit -m "feat(health-coach): add MorningBrief assignment — reconciliation-aware daily brief"
```

---

## Task 5: NoteReview Assignment

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/assignments/NoteReview.mjs`
- Test: `tests/unit/agents/health-coach/NoteReview.test.mjs`

- [ ] **Step 1: Write failing tests**

Test that gather loads today's nutrition total, targets, exercise, and alerts_sent_today from memory. Test that act respects max 2 alerts/day (if memory shows 2 already sent, should_send must be false). Test that `should_send: false` results in no `send_channel_message` call.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement NoteReview**

No static schedule (event-triggered only). Gather calls: `get_today_nutrition`, `get_user_goals`, `get_recent_workouts` (today only). BuildPrompt: includes running total, targets, alerts already sent (from memory), and explicit instruction "Return should_send: false unless there is something the user doesn't already know." Validate: `coachingMessageSchema`. Act: if `should_send`, increment `alerts_sent_today` in memory, append topic to `last_alert_topics`. **Delivery handled by `HealthCoachAgent.runAssignment()`** post-execute.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/assignments/NoteReview.mjs tests/unit/agents/health-coach/NoteReview.test.mjs
git commit -m "feat(health-coach): add NoteReview assignment — per-accept agent review with silence default"
```

---

## Task 6: EndOfDayReport Assignment

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/assignments/EndOfDayReport.mjs`
- Test: `tests/unit/agents/health-coach/EndOfDayReport.test.mjs`

- [ ] **Step 1: Write failing tests**

Test gather loads raw + adjusted nutrition, reconciliation accuracy, weight trend, exercise summary, coaching history. Test buildPrompt includes both raw and adjusted numbers. Test act calls `log_coaching_note`.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement EndOfDayReport**

No static schedule (event-triggered). Gather calls: `get_today_nutrition`, `get_adjusted_nutrition`, `get_reconciliation_summary`, `get_weight_trend`, `get_recent_workouts`, `get_coaching_history`. BuildPrompt: includes raw vs adjusted side-by-side, tracking accuracy, weight trend, instructions to produce concise data-driven commentary (no cheerleading). OutputSchema: `coachingMessageSchema`. Act: update memory with coaching state. **Delivery (send message + log coaching note) handled by `HealthCoachAgent.runAssignment()`** post-execute — same pattern as DailyDashboard's dashboard persistence.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/assignments/EndOfDayReport.mjs tests/unit/agents/health-coach/EndOfDayReport.test.mjs
git commit -m "feat(health-coach): add EndOfDayReport assignment — reconciliation-aware report coaching"
```

---

## Task 7: WeeklyDigest Assignment

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs`
- Test: `tests/unit/agents/health-coach/WeeklyDigest.test.mjs`

- [ ] **Step 1: Write failing tests**

Test gather loads 7-day reconciliation, weight trend (7d + 14d), nutrition history. Test buildPrompt includes accuracy trend direction. Test act sets `last_weekly_digest` in memory with 7d TTL.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement WeeklyDigest**

`static schedule = '0 19 * * 0'` (Sunday 7pm). Gather: `get_reconciliation_summary` (7d), `get_weight_trend` (14d), `get_nutrition_history` (7d), `get_user_goals`. BuildPrompt: weekly averages (tracked vs adjusted), accuracy trend (improving/declining), missed days, best/worst tracking days, protein avg vs target. OutputSchema: `coachingMessageSchema`. Act: send message, set `last_weekly_digest` in memory.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/assignments/WeeklyDigest.mjs tests/unit/agents/health-coach/WeeklyDigest.test.mjs
git commit -m "feat(health-coach): add WeeklyDigest assignment — weekly trend analysis"
```

---

## Task 8: ExerciseReaction Assignment

**Files:**
- Create: `backend/src/3_applications/agents/health-coach/assignments/ExerciseReaction.mjs`
- Test: `tests/unit/agents/health-coach/ExerciseReaction.test.mjs`

- [ ] **Step 1: Write failing tests**

Test gather uses activity from context (calories, type, duration). Test that activities <200 cal result in `should_send: false`. Test buildPrompt includes net calorie calculation.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement ExerciseReaction**

No static schedule (Strava webhook-triggered). Gather: read `context.activity` for calories/type/duration (context passed to gather via Task 3.5 framework change), call `get_today_nutrition`, `get_user_goals`. Guard: if `context.activity.calories < 200`, return early from `execute()` with `{ should_send: false }` — skip the entire LLM pipeline. BuildPrompt: activity details, today's logged total, net calories (logged - exercise). OutputSchema: `coachingMessageSchema`. Act: set `exercise_today` in memory. **Delivery handled by `HealthCoachAgent.runAssignment()`** post-execute.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/assignments/ExerciseReaction.mjs tests/unit/agents/health-coach/ExerciseReaction.test.mjs
git commit -m "feat(health-coach): add ExerciseReaction assignment — Strava-triggered post-exercise context"
```

---

## Task 9: Update System Prompt

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/prompts/system.mjs`

- [ ] **Step 1: Read current system prompt**

Read `backend/src/3_applications/agents/health-coach/prompts/system.mjs`.

- [ ] **Step 2: Extend with nutrition coaching rules**

Add a `## Nutrition Coaching (Messaging Channel)` section after the existing content:

```
## Nutrition Coaching (Messaging Channel)

When producing messages for the nutrition coaching channel:

### Tone
- Direct and factual. Reference specific numbers from the tools.
- Never say "great job", "keep it up", "awesome choice", or similar cheerleading.
- Never suggest specific foods ("try Greek yogurt"). Just state the gap.
- No emoji spam. One relevant emoji per message max.

### Data Rules
- Always show both raw (tracked) and adjusted (reconciled) numbers when available.
- If tracking accuracy < 70%, lead with that fact.
- Flag days with < 800 tracked calories as likely incomplete, not as real intake.
- Reference weight trends to ground calorie advice ("weight down 1.2 lbs this week at X avg intake").

### Message Discipline
- Check working memory for alerts_sent_today. Max 2 per day.
- Check coaching history. Don't repeat the same observation within 7 days.
- Return should_send: false unless you have something the user doesn't already know.
- A running total line is already shown on accept — don't restate it.
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/prompts/system.mjs
git commit -m "feat(health-coach): extend system prompt with nutrition coaching rules — no cheerleading, data-only"
```

---

## Task 10: Register New Tools and Assignments in HealthCoachAgent

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`

- [ ] **Step 1: Read current HealthCoachAgent**

Read `backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs`.

- [ ] **Step 2: Add imports and registration**

Import `ReconciliationToolFactory`, `MessagingChannelToolFactory`, and all 5 new assignments. In `registerTools()`, add the two new tool factories and register all 5 assignments.

Extend `runAssignment()` to handle Telegram delivery for coaching assignments (following the DailyDashboard pattern for `write_dashboard`):

```javascript
async runAssignment(assignmentId, opts = {}) {
  // ... existing userId injection ...
  const result = await super.runAssignment(assignmentId, opts);

  // Existing: persist dashboard
  if (assignmentId === 'daily-dashboard' && result) { /* ... existing code ... */ }

  // New: deliver Telegram messages for coaching assignments
  const telegramAssignments = ['morning-brief', 'note-review', 'end-of-day-report', 'weekly-digest', 'exercise-reaction'];
  if (telegramAssignments.includes(assignmentId) && result?.should_send) {
    const sendTool = this.getTools().find(t => t.name === 'send_channel_message');
    if (sendTool) {
      await sendTool.execute({ text: result.text, parseMode: result.parse_mode || 'HTML' });
    }
    // Log coaching note for end-of-day report
    if (assignmentId === 'end-of-day-report') {
      const noteTool = this.getTools().find(t => t.name === 'log_coaching_note');
      if (noteTool) {
        const today = new Date().toISOString().split('T')[0];
        await noteTool.execute({ userId: opts.userId, date: today, note: { type: 'observation', text: result.text } });
      }
    }
  }

  return result;
}
```

- [ ] **Step 3: Run existing HealthCoachAgent tests to verify no regression**

Run: `node --test tests/unit/agents/health-coach/HealthCoachAgent.test.mjs`
Expected: PASS (existing tests should still pass — new tools/assignments are additive)

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/HealthCoachAgent.mjs
git commit -m "feat(health-coach): register ReconciliationToolFactory, MessagingChannelToolFactory, and 5 nutrition coaching assignments"
```

---

## Task 11: Modify AcceptFoodLog — Running Total + Agent Delegation

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs`
- Test: Update or add tests in `tests/unit/nutribot/AcceptFoodLog.test.mjs` (if exists)

- [ ] **Step 1: Read current AcceptFoodLog**

Already read above. Key changes:
1. After updating message with ✅, compute and append running total line
2. Replace `#generateDailyReport` coaching trigger with agent `NoteReview` invocation
3. On last-pending, trigger `EndOfDayReport` assignment instead of (or in addition to) the existing report

- [ ] **Step 2: Implement running total line**

After step 6 (update message), load today's nutriday sum via `nutriListStore.findByDate(userId, date)`, sum calories and protein, append `↳ {cal} / {target} cal • {protein}g protein` to the accepted message text.

- [ ] **Step 3: Replace coaching delegation**

Remove `#generateDailyReport` dependency for coaching. Instead, accept an `agentOrchestrator` dependency. After accept:
1. Fire-and-forget: `agentOrchestrator.runAssignment('health-coach', 'note-review', { userId, context: { ... } })` (wrapped in try/catch, non-blocking)
2. On last pending: `agentOrchestrator.runAssignment('health-coach', 'end-of-day-report', { userId, context: { ... } })`

The existing `GenerateDailyReport` use case is kept for the **report PNG rendering** (deterministic) but its coaching trigger is removed.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs
git commit -m "feat(nutribot): replace per-accept coaching with running total + agent NoteReview delegation"
```

---

## Task 12: Delete Old Coaching Use Cases

**Files:**
- Delete: `backend/src/3_applications/nutribot/usecases/GenerateThresholdCoaching.mjs`
- Delete: `backend/src/3_applications/nutribot/usecases/GenerateReportCoaching.mjs`
- Delete: `backend/src/3_applications/nutribot/usecases/GenerateOnDemandCoaching.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/index.mjs`
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs`

- [ ] **Step 1: Read index.mjs to find coaching exports**

Read `backend/src/3_applications/nutribot/usecases/index.mjs`.

- [ ] **Step 2: Remove coaching exports from index.mjs**

Remove the export lines for `GenerateThresholdCoaching`, `GenerateReportCoaching`, `GenerateOnDemandCoaching`.

- [ ] **Step 3: Strip coaching from GenerateDailyReport**

Read `backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs`. Remove:
- `#generateThresholdCoaching` private field (line 19)
- `this.#generateThresholdCoaching = deps.generateThresholdCoaching` (line 35)
- The entire `#checkAndTriggerCoaching()` method (lines 340-369)
- Any call to `#checkAndTriggerCoaching()` in the execute flow

The report PNG rendering and data gathering stay intact.

- [ ] **Step 4: Remove coaching wiring from NutribotContainer**

Remove:
- Import of `GenerateThresholdCoaching`, `GenerateReportCoaching`, `GenerateOnDemandCoaching`
- Private fields `#generateThresholdCoaching`, `#generateReportCoaching`, `#generateOnDemandCoaching`
- Getter methods `getGenerateThresholdCoaching()`, `getGenerateOnDemandCoaching()`, `getGenerateReportCoaching()`
- `generateThresholdCoaching` dependency from `getGenerateDailyReport()` constructor

- [ ] **Step 5: Delete the 3 coaching use case files**

```bash
git rm backend/src/3_applications/nutribot/usecases/GenerateThresholdCoaching.mjs
git rm backend/src/3_applications/nutribot/usecases/GenerateReportCoaching.mjs
git rm backend/src/3_applications/nutribot/usecases/GenerateOnDemandCoaching.mjs
```

- [ ] **Step 6: Run all nutribot tests to verify no breakage**

Run: `node --test tests/unit/nutribot/*.test.mjs` (if they exist)
Expected: PASS (or fix any broken imports)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(nutribot): delete coaching use cases, strip coaching from GenerateDailyReport — replaced by HealthCoachAgent assignments"
```

---

## Task 13: Fix ConfirmAllPending + Wire /coach Command

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs`
- Modify: `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs`

- [ ] **Step 1: Read ConfirmAllPending**

Read `backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs`. It receives `generateDailyReport` and triggers it after batch confirmation. Apply same treatment as AcceptFoodLog: add agent delegation for coaching after batch accept.

- [ ] **Step 2: Update ConfirmAllPending**

Add `agentOrchestrator` dependency. After batch confirmation, fire `end-of-day-report` assignment instead of relying on GenerateDailyReport's coaching path (which is now stripped).

- [ ] **Step 3: Wire /coach command in NutribotInputRouter**

Read `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` `handleCommand()`. Add a `coach` case:

```javascript
case 'coach': {
  const orchestrator = this.container.getAgentOrchestrator?.();
  if (!orchestrator) {
    await responseContext.sendMessage('Coaching not available.', {});
    return { ok: true, handled: false };
  }
  const result = await orchestrator.runAssignment('health-coach', 'note-review', {
    userId: this.#resolveUserId(event),
    context: { forceSpeak: true },
  });
  return { ok: true, result };
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs backend/src/1_adapters/nutribot/NutribotInputRouter.mjs
git commit -m "feat(nutribot): fix ConfirmAllPending agent delegation, wire /coach command to HealthCoachAgent"
```

---

## Task 14: Wire Strava Webhook to ExerciseReaction

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`

- [ ] **Step 1: Read the fitness router**

Read `backend/src/4_api/v1/routers/fitness.mjs` to find where Strava webhook events are processed.

- [ ] **Step 2: Add ExerciseReaction trigger**

After the existing Strava activity processing, add:

```javascript
// Trigger HealthCoachAgent exercise reaction (fire-and-forget)
// The assignment itself guards on calorie threshold (>200 cal) — API layer just forwards the event
if (stravaAdapter.shouldEnrich(event)) {
  agentOrchestrator.runAssignment('health-coach', 'exercise-reaction', {
    userId,
    context: { activity: enrichedActivity },
  }).catch(err => logger.warn?.('strava.exerciseReaction.error', { error: err.message }));
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): trigger HealthCoachAgent exercise-reaction on Strava activity webhook"
```

---

## Task 15: Bootstrap Wiring

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

- [ ] **Step 1: Read bootstrap.mjs around `createAgentsApiRouter()` and nutribot wiring**

Find where HealthCoachAgent is registered and where NutribotContainer is created.

- [ ] **Step 2: Pass new dependencies to HealthCoachAgent**

Add `healthStore` (for reconciliation data), `nutriCoachStore`, `messagingGateway` (Telegram), `conversationId` (nutribot chat), and `configService` to the agent's dependency bag.

- [ ] **Step 3: Pass `agentOrchestrator` to NutribotContainer**

Add `agentOrchestrator` as an option so `AcceptFoodLog` can invoke agent assignments.

**Note:** The orchestrator is created in `createAgentsApiRouter()` which may run after `createNutribotServices()`. If so, use a lazy reference pattern: pass a getter `() => agentOrchestrator` that resolves at call time, not at construction time. Or restructure bootstrap to create the orchestrator earlier (before nutribot services).

- [ ] **Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(bootstrap): wire reconciliation + Telegram deps into HealthCoachAgent, pass orchestrator to NutribotContainer"
```

---

## Task 16: Update HealthCoachAgent barrel export

**Files:**
- Modify: `backend/src/3_applications/agents/health-coach/index.mjs`

- [ ] **Step 1: Read current index.mjs**

- [ ] **Step 2: Add exports for new tool factories and assignments**

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/agents/health-coach/index.mjs
git commit -m "chore(health-coach): export new tool factories and assignments from barrel"
```

---

## Task 17: Integration Smoke Test

- [ ] **Step 1: Start dev server**

```bash
lsof -i :3112  # Check if already running
node backend/index.js  # Or use existing
```

- [ ] **Step 2: Verify agent registration**

```bash
curl -s http://localhost:3112/api/v1/agents | jq '.[] | select(.id == "health-coach") | .assignments'
```

Expected: Should list `daily-dashboard`, `morning-brief`, `note-review`, `end-of-day-report`, `weekly-digest`, `exercise-reaction`.

- [ ] **Step 3: Trigger MorningBrief manually**

```bash
curl -s -X POST http://localhost:3112/api/v1/agents/health-coach/assignments/morning-brief/run \
  -H "Content-Type: application/json" \
  -d '{"userId":"kckern"}' | jq .
```

Verify: Returns structured message with reconciliation data, sends to Telegram.

- [ ] **Step 4: Trigger NoteReview manually**

```bash
curl -s -X POST http://localhost:3112/api/v1/agents/health-coach/assignments/note-review/run \
  -H "Content-Type: application/json" \
  -d '{"userId":"kckern"}' | jq .
```

Verify: Returns `should_send: false` or a data-driven alert (not cheerleading).

- [ ] **Step 5: Commit integration test notes if needed**

---

## Task 18: Update docs

**Files:**
- Modify: `docs/ai-context/agents.md`

- [ ] **Step 1: Add new assignments and tool factories to the Health Coach Agent section**

Update the file listing to include the 5 new assignments and 2 new tool factories.

- [ ] **Step 2: Commit**

```bash
git add docs/ai-context/agents.md
git commit -m "docs: update agent context with new health-coach nutrition coaching assignments"
```
