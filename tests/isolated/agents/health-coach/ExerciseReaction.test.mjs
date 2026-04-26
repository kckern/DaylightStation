import { describe, it, expect, vi } from 'vitest';

import { ExerciseReaction } from '../../../../backend/src/3_applications/agents/health-coach/assignments/ExerciseReaction.mjs';

describe('ExerciseReaction', () => {
  it('has correct static properties', () => {
    expect(ExerciseReaction.id).toBe('exercise-reaction');
    expect(ExerciseReaction.schedule).toBe(undefined);
  });

  it('execute returns should_send false for small activities', async () => {
    const er = new ExerciseReaction();
    const result = await er.execute({
      context: { activity: { calories: 100, type: 'Walk' } },
      agentRuntime: {}, workingMemory: {}, tools: [], systemPrompt: '', agentId: 'test', userId: 'kckern',
    });
    expect(result.should_send).toBe(false);
  });

  it('execute returns should_send false for missing activity', async () => {
    const er = new ExerciseReaction();
    const result = await er.execute({
      context: {},
      agentRuntime: {}, workingMemory: {}, tools: [], systemPrompt: '', agentId: 'test', userId: 'kckern',
    });
    expect(result.should_send).toBe(false);
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
    expect(gathered.activity.type).toBe('Run');
    expect(gathered.activity.calories).toBe(500);
    expect(gathered.todayNutrition).toBeTruthy();
  });

  it('buildPrompt includes activity and net calories', () => {
    const er = new ExerciseReaction();
    const gathered = {
      activity: { type: 'Run', calories: 500, duration: 45, avgHr: 155 },
      todayNutrition: { calories: 800, protein: 60 },
      goals: { goals: { calories: 2000 } },
    };
    const prompt = er.buildPrompt(gathered, { serialize: () => '' });
    expect(prompt.includes('Run') || prompt.includes('500')).toBeTruthy();
  });

  it('act sets exercise_today in memory', async () => {
    const er = new ExerciseReaction();
    const memory = { set: vi.fn() };
    await er.act({ should_send: true, text: 'test' }, { memory, userId: 'kckern', logger: console });
    expect(memory.set.mock.calls.length).toBe(1);
    expect(memory.set.mock.calls[0][0]).toBe('exercise_today');
  });
});
