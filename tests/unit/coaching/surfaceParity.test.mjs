import { describe, it, expect } from 'vitest';
import { budgetDayView } from '../../../__app_modules/wellness/health/server/application/coaching/CoachingEvidenceService.mjs';
import { budgetStory } from '../../../__app_modules/wellness/health/browser/today/budgetStory.js';
import { buildReportCaption } from '../../../__app_modules/wellness/nutribot/server/application/usecases/reportCaption.mjs';
import { buildObservations } from '../../../__app_modules/wellness/health/server/application/coaching/observations.mjs';
import { renderObservation } from '../../../__app_modules/wellness/health/server/application/coaching/observationText.mjs';
import { MorningBrief } from '../../../__app_modules/wellness/health/server/application/agents/health-coach/assignments/MorningBrief.mjs';
import { EndOfDayReport } from '../../../__app_modules/wellness/health/server/application/agents/health-coach/assignments/EndOfDayReport.mjs';
import { ExerciseReaction } from '../../../__app_modules/wellness/health/server/application/agents/health-coach/assignments/ExerciseReaction.mjs';
import { WeeklyDigest } from '../../../__app_modules/wellness/health/server/application/agents/health-coach/assignments/WeeklyDigest.mjs';
import { DailyDashboard } from '../../../__app_modules/wellness/health/server/application/agents/health-coach/assignments/DailyDashboard.mjs';
import { summarizeBudgetPeriod } from '../../../__app_modules/wellness/health/portable/contracts/health/budgetPeriod.mjs';

const today = '2026-10-25';
const budget = (over = {}) => ({ date: '2026-10-24', food: 1704, exercise: 997, net: 707, maintenance: 2100,
  range: { floor: 1200, top: 1600 }, zone: 'in-range', remaining: 893, complete: true, declared: null,
  macros: { protein: 105 }, goalBasis: 'current', sessions: [], ...over });
const view = over => budgetDayView(budget(over), { today });
const goals = { goals: { nutrition: { calories_min: 1200, calories_max: 1600, protein_min: 150 } } };
const gathered = day => ({ todayNutrition: day, nutrition: day, nutritionHistory: { days: [day] }, goals });
const raw = { output: JSON.stringify({ should_send: true, text: '9999 cal surplus; protein target met', parse_mode: 'HTML' }) };
const logger = { warn() {} };

// A food-only comparison, copied model prose, or added webhook burn breaks these cases.
describe('delivery surface budget parity', () => {
  it.each([
    [1199, 0, 'logging_incomplete'], [806, 302, 'logging_incomplete'], [1200, 0, 'within_plan'], [1600, 0, 'within_plan'], [1601, 0, 'over_plan'],
    [2100, 0, 'over_plan'], [2101, 0, 'energy_surplus'], [1704, 997, 'within_plan'],
    [2597, 997, 'within_plan'], [2598, 997, 'over_plan'], [3097, 997, 'over_plan'], [3098, 997, 'energy_surplus'],
  ])('%i food with %i exercise has the same supported verdict on all coach surfaces', async (food, exercise, kind) => {
    const b = budget({ food, exercise, net: food - exercise, remaining: Math.abs(1600 + exercise - food), zone: food < 1200 ? 'incomplete' : 'in-range' });
    const day = budgetDayView(b, { today });
    const ev = { current: day, days: [day], period: summarizeBudgetPeriod([day.assessment]) };
    const observation = buildObservations({ type: 'post-report', evidence: ev, proteinGoal: 150 }).find(o => o.kind === kind);
    expect(observation).toBeTruthy();
    const story = budgetStory(b, { date: b.date, today });
    expect(story.text).toMatch(kind === 'within_plan' ? /On plan/ : kind === 'energy_surplus' ? /Surplus/ : kind === 'logging_incomplete' ? /Incomplete log/ : /Missed plan/);
    for (const Assignment of [MorningBrief, EndOfDayReport]) {
      const output = await new Assignment().validate(raw, gathered(day), logger);
      expect(output.text).toContain(renderObservation(observation));
      expect(output.text).not.toContain('9999');
    }
    const caption = buildReportCaption({ budget: b });
    expect(caption).toContain(`/ 1200–${1600 + exercise} cal`);
    if (exercise) expect(caption).toContain('exercise');
  });

  it('does not reconstruct a verdict when no budget exists', async () => {
    expect(buildReportCaption({ totals: { calories: 1000 }, goals: { calories_min: 1200, calories_max: 1600 } }))
      .toBe('🔥 1000 cal logged • budget assessment unavailable');
    const output = await new EndOfDayReport().validate(raw, { goals }, logger);
    expect(output.text).toMatch(/unavailable/i);
    expect(output.text).not.toMatch(/9999|surplus|target met/);
  });

  it.each([MorningBrief, EndOfDayReport, WeeklyDigest, ExerciseReaction])('%s falls back on malformed output and honors supported silence', async Assignment => {
    const data = { ...gathered(view()), activity: { id: 'run', calories: 997 } };
    const output = await new Assignment().validate({ output: '{bad json' }, data, logger);
    expect(output.should_send).toBe(true);
    expect(output.text).not.toContain('9999');
    expect(await new Assignment().validate({ output: '{"should_send":false}' }, data, logger)).toEqual({ should_send: false });
  });

  it('separates pending activity burn from the canonical daily credit before and after enrichment', async () => {
    const assignment = new ExerciseReaction();
    const activity = { id: 'run-1', type: 'Run', calories: 997 };
    for (const [exercise, sessions, synced] of [[0, [], false], [997, [{ id: 'run-1', calories: 997 }], true]]) {
      const output = await assignment.validate(raw, { ...gathered(view({ exercise, sessions })), activity }, logger);
      expect(output.text).toContain('Activity burn: 997 cal');
      if (synced) {
        expect(output.text).toContain('997 cal of exercise credit is included once in your 2597 cal food plan');
        expect(output.text).not.toContain('pending');
      } else {
        expect(output.text).toMatch(/pending/i);
        expect(output.text).not.toContain('2597');
      }
    }
  });

  it('keeps live protein partial and finished unknown protein distinct from zero', async () => {
    const report = new EndOfDayReport();
    const live = await report.validate(raw, gathered(view({ date: today })), logger);
    expect(live.text).not.toMatch(/below.*target|target met/);
    const unknown = await report.validate(raw, gathered(view({ macros: {} })), logger);
    expect(unknown.text).not.toMatch(/below.*target|target met/);
    const zero = await report.validate(raw, gathered(view({ macros: { protein: 0 } })), logger);
    expect(zero.text).toContain('150g below');
  });

  it('preserves dashboard curated data but canonicalizes budget commentary and model CTAs', async () => {
    const curated = { up_next: { primary: { content_id: 'plex:1', title: 'Strength', duration: 30 } } };
    const output = await new DailyDashboard().validate({ output: JSON.stringify({ generated_at: '2026-10-25T12:00:00Z', curated,
      coach: { briefing: '9999 calorie surplus', cta: [{ type: 'observation', message: 'protein target met' }], prompts: [{ type: 'free_text', question: 'Why the 9999 calorie surplus?' }] } }) }, gathered(view()), logger);
    expect(output.curated).toEqual(curated);
    expect(output.coach.briefing).toContain('Within your exercise-adjusted calorie plan');
    expect(JSON.stringify(output.coach)).not.toMatch(/9999|target met/);
  });
});

describe('assignment history eligibility', () => {
  const makeTools = (days, events) => [
    { name: 'get_budget_range', execute: async () => ({ days }) },
    { name: 'get_user_goals', execute: async () => goals },
    { name: 'find_similar_period', execute: async params => { events.push(params); return { matches: [{ name: 'analog', score: 1, period: {} }] }; } },
  ];
  const run = (Assignment, days, events) => new Assignment().gather({ tools: makeTools(days, events), userId: 'u', memory: { get: () => null, set() {} }, logger });
  it('calendar gaps and incomplete days break a trailing over-plan streak', async () => {
    // Current wall date is irrelevant here: use dates guaranteed to be historical.
    for (const days of [
      [view({ date: '2026-10-19', food: 1900, exercise: 0 }), view({ date: '2026-10-21', food: 1900, exercise: 0 }), view({ date: '2026-10-22', food: 1900, exercise: 0 })],
      [view({ date: '2026-10-19', food: 1900, exercise: 0 }), view({ date: '2026-10-20', food: 700, exercise: 0 }), view({ date: '2026-10-21', food: 1900, exercise: 0 }), view({ date: '2026-10-22', food: 1900, exercise: 0 })],
    ]) {
      const events = [];
      expect((await run(MorningBrief, days, events)).similarPeriod).toBe(null);
      expect(events).toHaveLength(0);
    }
  });
  it('weekly comparisons use matched exercise-adjusted plan deltas and exclude the live day', async () => {
    const events = [];
    const days = [view({ date: '2026-10-22', food: 2500, exercise: 997, macros: { protein: 150 } }),
      view({ date: '2026-10-23', food: 1600, exercise: 0, macros: { protein: 150 } }),
      view({ date: today, food: 3000, exercise: 0, macros: { protein: 1 } })];
    const result = await run(WeeklyDigest, days, events);
    expect(result.similarPeriod).toBe(null);
    expect(events).toHaveLength(0);
  });
  it('unknown protein cannot trigger a three-day shortfall while measured zero can', async () => {
    for (const [macros, expected] of [[{}, false], [{ protein: 0 }, true]]) {
      const events = [];
      const days = ['2026-10-21', '2026-10-22', '2026-10-23'].map(date => view({ date, food: 1500, exercise: 0, macros }));
      const result = await run(MorningBrief, days, events);
      expect(Boolean(result.similarPeriod)).toBe(expected);
    }
  });
});

it('morning delivery judges yesterday instead of the current partial row and retains configured CTAs', async () => {
  const output = await new MorningBrief().validate(raw, { ...gathered(view()),
    nutritionHistory: { today, days: [view(), view({ date: today, food: 400 })] },
    complianceCtas: [{ dimension: 'strength', message: 'Resume your configured strength routine.' }],
  }, logger);
  expect(output.text).toContain('2026-10-24: Within');
  expect(output.text).not.toContain('2026-10-25:');
  expect(output.text).toContain('Resume your configured strength routine.');
});

it('lightweight exercise snapshots distinguish pending activity synchronization from daily credit', async () => {
  const { buildExerciseReactionSnapshot } = await import('../../../__app_modules/wellness/health/server/application/coaching/snapshots.mjs');
  for (const [exercise, sessions, synced] of [[0, [], false], [997, [{ id: 'run-1' }], true]]) {
    const current = view({ exercise, sessions });
    const evidence = { userId: 'u', date: today, today, current, days: [], period: summarizeBudgetPeriod([]), sourceState: {} };
    const snapshot = buildExerciseReactionSnapshot({ activity: { id: 'run-1', caloriesBurned: 997 }, evidence });
    expect(snapshot.observations.find(o => o.kind === 'activity_burn')?.facts).toMatchObject({ activityBurn: 997, synced });
  }
});

it('post-report snapshots expose canonical food units and unknowns without legacy goal aliases', async () => {
  const { buildPostReportSnapshot } = await import('../../../__app_modules/wellness/health/server/application/coaching/snapshots.mjs');
  const current = view();
  const snapshot = buildPostReportSnapshot({ date: current.date, calories: { consumed: 1704, goal_min: 1200, goal_max: 1600 }, protein: { consumed: 105, goal: 150 },
    evidence: { userId: 'u', today, current, days: [], period: summarizeBudgetPeriod([]), sourceState: {} } });
  expect(snapshot).toMatchObject({ userId: 'u', current_budget: { maintenance: 2100, exercise: 997, net: 707, planFood: 2597 },
    calories: { consumed: 1704, logging_floor: 1200, plan_food: 2597, exercise_credit: 997 } });
  expect(snapshot.calories).not.toHaveProperty('goal_min');
  expect(snapshot.calories).not.toHaveProperty('goal_max');
});

it('labels a protein average based on fewer measured days', async () => {
  const { CoachingMessageBuilder } = await import('../../../__app_modules/wellness/health/server/application/coaching/CoachingMessageBuilder.mjs');
  const text = CoachingMessageBuilder.buildWeeklyDigestBlock({ thisWeek: { calories: 1550, protein: 125, trustedDays: 2, totalDays: 7, proteinDays: 1 }, longTermAvg: { trustedDays: 0 } });
  expect(text).toContain('protein based on 1 measured day');
});

it('preserves retry and per-user activity receipts without adding transport retries', async () => {
  const { CoachingOrchestrator } = await import('../../../__app_modules/wellness/health/server/application/coaching/CoachingOrchestrator.mjs');
  const histories = new Map();
  const delivered = [];
  let failNextSend = true;
  const orchestrator = new CoachingOrchestrator({
    commentaryService: { generate: async snapshot => snapshot.observations[0] ?? null },
    messagingGateway: { sendMessage: async (conversation, text) => {
      if (failNextSend) { failNextSend = false; throw new Error('offline'); }
      delivered.push({ conversation, text }); return { messageId: `receipt-${delivered.length}` };
    } },
    healthStore: { loadNutritionData: async () => ({}), loadCoachingData: async userId => structuredClone(histories.get(userId) || {}),
      saveCoachingData: async (userId, data) => histories.set(userId, data) },
    budgetService: { getBudget: async (userId, date) => budget({ date, exercise: userId === 'alice' ? 997 : 0,
      sessions: userId === 'alice' ? [{ id: 'run-1' }] : [] }), getBudgetRange: async () => [] },
    nutriListStore: { findByDate: async () => [] },
    config: { getUserGoals: () => ({ protein: 150 }), getUserTimezone: () => 'America/Los_Angeles' },
    clock: { now: () => new Date('2026-10-25T18:00:00Z') }, logger: { error() {}, info() {} },
  });
  const input = { userId: 'alice', conversationId: 'alice-chat', activity: { id: 'run-1', caloriesBurned: 997, durationMin: 45, type: 'Run' } };
  await orchestrator.sendExerciseReaction(input);
  expect(histories.size).toBe(0); // Failed delivery cannot suppress a later retry.
  await orchestrator.sendExerciseReaction(input);
  await orchestrator.sendExerciseReaction(input);
  await orchestrator.sendExerciseReaction({ ...input, userId: 'bob', conversationId: 'bob-chat' });
  expect(delivered.map(message => message.conversation)).toEqual(['alice-chat', 'bob-chat']);
  expect(delivered[0].text).toContain('997 cal exercise credit included today');
  expect(delivered[1].text).toContain('0 cal exercise credit included today');
  expect(delivered[1].text).toContain('pending');
  expect(histories.get('alice')[today][0]).toMatchObject({ activityId: 'run-1', messageId: 'receipt-1' });
  expect(histories.get('bob')[today][0]).toMatchObject({ activityId: 'run-1', messageId: 'receipt-2' });
});

it.each([
  [{ content: { episodes: [{ id: 'plex:1', title: 'Canonical Strength' }] } }, ['Selected fitness content: Canonical Strength.']],
  [{ catalog: { shows: [{ id: '1', title: 'Canonical Program' }] } }, ['Selected fitness content: Canonical Program.']],
  [{ content: { episodes: [{ id: 'plex:2', title: 'Other Session' }] } }, []],
  [{}, []],
])('retains only fitness CTAs resolved from gathered content: %j', async (content, messages) => {
  const data = { generated_at: '2026-10-25T18:00:00Z', curated: { up_next: { primary: { content_id: 'plex:1', title: 'Invented label', duration: 30 } } },
    coach: { briefing: '9999 calorie surplus', cta: [{ type: 'nudge', message: 'Burn 9999 calories' }] } };
  const output = await new DailyDashboard().validate({ output: JSON.stringify(data) }, { ...gathered(view()), ...content }, logger);
  expect(output.coach.cta.map(cta => cta.message)).toEqual(messages);
  expect(output.curated).toEqual(data.curated);
});

it.each([MorningBrief, WeeklyDigest, EndOfDayReport, ExerciseReaction, DailyDashboard])('automated %s gathers with tools and gives the model no tools', async Assignment => {
  let budgetGathered = false;
  let mutationCount = 0;
  const tools = [
    { name: 'get_day_budget', execute: async () => { budgetGathered = true; return view(); } },
    { name: 'get_budget_range', execute: async () => ({ days: [view()] }) },
    { name: 'get_user_goals', execute: async () => goals },
    { name: 'send_channel_message', execute: async () => { mutationCount++; } },
    { name: 'write_dashboard', execute: async () => { mutationCount++; } },
    { name: 'log_coaching_note', execute: async () => { mutationCount++; } },
  ];
  const dashboard = { generated_at: '2026-10-25T18:00:00Z', curated: { up_next: { primary: { content_id: 'plex:1', title: 'Session', duration: 30 } } }, coach: { briefing: '9999 surplus' } };
  const result = await new Assignment().execute({
    tools, userId: 'u', agentId: 'health-coach', context: { activity: { id: 'run-1', calories: 997 } }, logger,
    workingMemory: { load: async () => ({ pruneExpired() {}, serialize: () => '', set() {}, get: () => null }), save: async () => {} },
    agentRuntime: { execute: async request => {
      expect(request.tools).toEqual([]);
      if (Assignment !== WeeklyDigest) expect(budgetGathered).toBe(true);
      for (const tool of request.tools) if (['send_channel_message', 'write_dashboard', 'log_coaching_note'].includes(tool.name)) await tool.execute();
      return Assignment === DailyDashboard ? { output: JSON.stringify(dashboard) } : raw;
    } },
  });
  expect(mutationCount).toBe(0);
  expect(Assignment === DailyDashboard ? result.coach.briefing : result.text).not.toContain('9999');
});

it('persists only the validated dashboard after execution and preserves interactive tools', async () => {
  const { HealthCoachAgent } = await import('../../../__app_modules/wellness/health/server/application/agents/health-coach/HealthCoachAgent.mjs');
  const writes = [];
  const dashboard = { generated_at: '2026-10-25T18:00:00Z', curated: { up_next: { primary: { content_id: 'plex:1', title: 'Session', duration: 30 } } }, coach: { briefing: '9999 surplus' } };
  let chatTools;
  const agent = new HealthCoachAgent({
    agentRuntime: { execute: async request => {
      if (request.context.mode === 'chat') { chatTools = request.tools; return raw; }
      expect(writes).toHaveLength(0);
      expect(request.tools).toEqual([]);
      return { output: JSON.stringify(dashboard) };
    } },
    workingMemory: { load: async () => ({ pruneExpired() {}, serialize: () => '', set() {} }), save: async () => {} },
    workspaceRepository: { getProgramState: () => null, getGoals: () => goals.goals,
      saveDashboard: async (userId, date, data) => { writes.push({ userId, date, data }); return 'synthetic-dashboard'; } },
    fitnessPlayableService: { listFitnessShows: async () => ({ shows: [] }) },
    healthStore: {}, logger,
  });
  const result = await agent.runAssignment('daily-dashboard', { userId: 'alice' });
  expect(writes).toHaveLength(1);
  expect(writes[0].userId).toBe('alice');
  expect(writes[0].data).toEqual(result);
  expect(writes[0].data.coach.briefing).not.toContain('9999');
  expect(writes[0].data.curated).toEqual(dashboard.curated);
  await agent.run('interactive question', { userId: 'alice' });
  expect(chatTools.some(tool => tool.name === 'write_dashboard')).toBe(true);
});

it.each([
  { goals: { calories: 9999, calories_min: 9000, calories_max: 9999, protein: 150 } },
  { goals: { nutrition: { calories: 9999, calories_min: 9000, calories_max: 9999, protein_min: 150 } } },
  { calories: 9999, calories_min: 9000, calories_max: 9999, protein: 150 },
])('assignment goal context replaces every legacy calorie alias with explicit units: %j', async goals => {
  const { goalsWithRange, rangeOf } = await import('../../../__app_modules/wellness/health/server/application/agents/health-coach/assignments/budgetContext.mjs');
  const context = goalsWithRange(goals, view());
  expect(JSON.stringify(context)).not.toMatch(/9999|9000|calories_min|calories_max/);
  expect(context.goals.nutrition).toMatchObject({ logging_floor: 1200, plan_food: 2597, base_plan_net: 1600, exercise_credit: 997 });
  expect(rangeOf(null, goals)).toEqual({ floor: null, top: null });
});
