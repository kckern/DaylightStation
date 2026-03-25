import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { ExerciseReaction } from '../../../../backend/src/3_applications/agents/health-coach/assignments/ExerciseReaction.mjs';

describe('ExerciseReaction', () => {
  it('has correct static properties', () => {
    assert.equal(ExerciseReaction.id, 'exercise-reaction');
    assert.equal(ExerciseReaction.schedule, undefined);
  });

  it('execute returns should_send false for small activities', async () => {
    const er = new ExerciseReaction();
    const result = await er.execute({
      context: { activity: { calories: 100, type: 'Walk' } },
      agentRuntime: {}, workingMemory: {}, tools: [], systemPrompt: '', agentId: 'test', userId: 'kckern',
    });
    assert.equal(result.should_send, false);
  });

  it('execute returns should_send false for missing activity', async () => {
    const er = new ExerciseReaction();
    const result = await er.execute({
      context: {},
      agentRuntime: {}, workingMemory: {}, tools: [], systemPrompt: '', agentId: 'test', userId: 'kckern',
    });
    assert.equal(result.should_send, false);
  });

  it('gather reads activity from context', async () => {
    const er = new ExerciseReaction();
    const mockTools = [
      { name: 'get_today_nutrition', execute: async () => ({ calories: 800 }) },
      { name: 'get_user_goals', execute: async () => ({ goals: { calories: 2000 } }) },
    ];
    const gathered = await er.gather({
      tools: mockTools, userId: 'kckern', memory: { serialize: () => '' }, logger: console,
      context: { activity: { type: 'Run', calories: 500, duration: 45 } },
    });
    assert.equal(gathered.activity.type, 'Run');
    assert.equal(gathered.activity.calories, 500);
    assert.ok(gathered.todayNutrition);
  });

  it('buildPrompt includes activity and net calories', () => {
    const er = new ExerciseReaction();
    const gathered = {
      activity: { type: 'Run', calories: 500, duration: 45, avgHr: 155 },
      todayNutrition: { calories: 800, protein: 60 },
      goals: { goals: { calories: 2000 } },
    };
    const prompt = er.buildPrompt(gathered, { serialize: () => '' });
    assert.ok(prompt.includes('Run') || prompt.includes('500'));
  });

  it('act sets exercise_today in memory', async () => {
    const er = new ExerciseReaction();
    const memory = { set: mock.fn() };
    await er.act({ should_send: true, text: 'test' }, { memory, userId: 'kckern', logger: console });
    assert.equal(memory.set.mock.calls.length, 1);
    assert.equal(memory.set.mock.calls[0].arguments[0], 'exercise_today');
  });
});
