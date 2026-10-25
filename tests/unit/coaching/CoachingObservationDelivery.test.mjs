import { describe, it, expect, vi } from 'vitest';
import { CoachingOrchestrator } from '../../../__app_modules/wellness/health/server/application/coaching/CoachingOrchestrator.mjs';
import { CoachingCommentaryService } from '../../../__app_modules/wellness/health/server/application/coaching/CoachingCommentaryService.mjs';

function setup({ output = '{"observationId":"unsupported"}', currentFood = 1704, currentProtein = 105, declared = null, reconstructed = false, missingBudget = false, proteinGoal = 150 } = {}) {
  let history = { '2026-10-25': [{ type: 'legacy', text: 'old message', timestamp: '2026-10-25T15:00:00Z' }] };
  const budget = date => ({ date, food: currentFood, exercise: 997, net: currentFood - 997, range: { floor: 1200, top: 1791 }, maintenance: 2291, macros: { protein: currentProtein }, declared, goalBasis: 'current' });
  const runtime = { execute: vi.fn().mockResolvedValue({ output }) };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const messaging = { sendMessage: vi.fn().mockResolvedValue({ messageId: 'sent-1' }), deleteMessage: vi.fn().mockResolvedValue(undefined) };
  const healthStore = {
    loadCoachingData: async () => structuredClone(history), saveCoachingData: async (_u, data) => { history = data; },
    loadNutritionData: async () => reconstructed ? { '2026-10-25': { calories: 2500, reconstructed_calories: 796, protein: 200 } } : {},
    loadWeightData: async () => ({ '2026-10-18': { lbs: 170 }, '2026-10-25': { lbs: 172 } }), loadDayClosedData: async () => ({}),
  };
  const orchestrator = new CoachingOrchestrator({
    commentaryService: new CoachingCommentaryService({ runtime, logger }), messagingGateway: messaging, healthStore,
    nutriListStore: { findByDate: async () => [{ name: 'Rice & beans <b>food</b>', calories: currentFood, protein: currentProtein }] },
    config: { getUserGoals: () => ({ calories_min: 1200, calories_max: 1600, protein: proteinGoal }), getUserTimezone: () => 'America/Los_Angeles' },
    budgetService: { getBudget: async () => missingBudget ? null : budget('2026-10-25'), getBudgetRange: async () => ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].map(budget) },
    clock: { now: () => new Date('2026-10-25T18:00:00Z') }, logger,
  });
  return { orchestrator, runtime, messaging, history: () => history, setIntake: (food, protein) => { currentFood = food; currentProtein = protein; } };
}

describe('evidence-backed observation delivery', () => {
  it('delivers current facts and persists observation metadata with the receipt, ignoring stale caller/model numbers', async () => {
    const { orchestrator, messaging, history, runtime } = setup({ output: '9999 calories; protein target met' });
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c', totals: { calories: 9999, protein: 999 } });
    const message = messaging.sendMessage.mock.calls[0][1];
    expect(message).toContain('1704 cal so far');
    expect(message).toContain('105 / 150g protein so far');
    expect(message).toContain('2026-10-25: Within your exercise-adjusted calorie plan so far.');
    expect(message).not.toMatch(/9999|999g|target met|surplus|below.*target/i);
    expect(history()['2026-10-25'][0]).toMatchObject({ type: 'legacy', text: 'old message' });
    expect(history()['2026-10-25'].at(-1)).toMatchObject({ messageId: 'sent-1', observationId: 'within_plan:day:2026-10-25', observationKind: 'within_plan', observationFingerprint: 'within_plan:day:2026-10-25' });
    expect(runtime.execute.mock.calls[0][0].context.userId).toBe('u');
  });
  it('does not repeat a selected observation even when a provider returns its ID again and history text is long', async () => {
    const { orchestrator, messaging, history } = setup({ output: '{"observationId":"within_plan:day:2026-10-25"}' });
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    history()['2026-10-25'].at(-1).text = 'status line '.repeat(40);
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    expect(messaging.sendMessage).toHaveBeenCalledOnce();
  });
  it('remembers bundled protein facts when later triggers change the eligible calorie kind', async () => {
    const { orchestrator, messaging, history, setIntake } = setup({ declared: 'done' });
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    expect(messaging.sendMessage.mock.calls[0][1]).toContain('protein was 45g below your 150g target');
    expect(history()['2026-10-25'].at(-1).observationFingerprints).toContain('protein_gap:day:2026-10-25');
    setIntake(3000, 105); // with 997 exercise, over plan but below maintenance
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    expect(messaging.sendMessage.mock.calls[1][1]).toContain('above your exercise-adjusted plan');
    expect(messaging.sendMessage.mock.calls[1][1]).not.toContain('below your 150g target');
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    expect(messaging.sendMessage).toHaveBeenCalledTimes(2);
  });
  it('can deliver a new within-plan fact without repeating a previously selected protein gap', async () => {
    const { orchestrator, messaging, setIntake } = setup({ currentFood: 3000, declared: 'done', output: '{"observationId":"protein_gap:day:2026-10-25"}' });
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    expect(messaging.sendMessage.mock.calls[0][1]).toContain('Protein was 45g below your 150g target');
    setIntake(1704, 105);
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    expect(messaging.sendMessage.mock.calls[1][1]).toContain('Within your exercise-adjusted calorie plan.');
    expect(messaging.sendMessage.mock.calls[1][1]).not.toContain('below your 150g target');
  });
  it('uses the seven-day window for weekly facts rather than the loaded 56-day range', async () => {
    const { orchestrator, messaging } = setup();
    await orchestrator.sendWeeklyDigest({ userId: 'u', conversationId: 'c' });
    const message = messaging.sendMessage.mock.calls[0][1];
    expect(message).toContain('2026-10-18 to 2026-10-24');
    expect(message).toContain('7 of 7');
    expect(message).not.toContain('2026-08-30 to 2026-10-24');
  });
  it('escapes event food names exactly once and preserves replacement receipt order', async () => {
    const { orchestrator, messaging, history } = setup({ currentFood: 700 });
    history()['2026-10-25'].push({ type: 'post-report', messageId: 'old-1', text: 'legacy status', timestamp: '2026-10-25T16:00:00Z' });
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c', eventItems: [{ name: 'Rice & beans <b>food</b>' }] });
    const message = messaging.sendMessage.mock.calls[0][1];
    expect(message).toContain('Just logged: Rice &amp; beans &lt;b&gt;food&lt;/b&gt;.');
    expect(message).not.toContain('&amp;amp;');
    expect(messaging.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(messaging.deleteMessage.mock.invocationCallOrder[0]);
    expect(messaging.deleteMessage).toHaveBeenCalledWith('c', 'old-1');
    expect(history()['2026-10-25'].at(-1)).toMatchObject({ messageId: 'sent-1', observationFingerprint: 'logging_incomplete:day:2026-10-25' });
  });
  it('does not turn unknown reconstructed protein into measured protein in the status block', async () => {
    const { orchestrator, messaging } = setup({ reconstructed: true, declared: 'done' });
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    const message = messaging.sendMessage.mock.calls[0][1];
    expect(message).toContain('2500 cal estimated');
    expect(message).toContain('protein unknown');
    expect(message).not.toMatch(/105g|105 \/|target met|within.*plan|surplus/i);
  });
  it('does not invent an exercise credit when budget evidence is unavailable', async () => {
    const { orchestrator, messaging } = setup({ missingBudget: true });
    await orchestrator.sendExerciseReaction({ userId: 'u', conversationId: 'c', activity: { id: 9, type: 'Ride', durationMin: 45, caloriesBurned: 420 } });
    const message = messaging.sendMessage.mock.calls[0][1];
    expect(message).toContain('420 cal burned');
    expect(message).toContain('exercise credit unavailable');
    expect(message).not.toMatch(/210|420 extra|earned/);
  });
  it('shows unknown goals honestly instead of inventing protein targets', async () => {
    const { orchestrator, messaging } = setup({ proteinGoal: null });
    await orchestrator.sendPostReport({ userId: 'u', conversationId: 'c' });
    const message = messaging.sendMessage.mock.calls[0][1];
    expect(message).toContain('105g protein so far');
    expect(message).not.toMatch(/undefined|NaN|150g|target/);
  });
});
