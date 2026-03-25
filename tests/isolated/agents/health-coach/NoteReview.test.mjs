import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { NoteReview } from '../../../../backend/src/3_applications/agents/health-coach/assignments/NoteReview.mjs';

describe('NoteReview', () => {
  it('has correct static properties', () => {
    assert.equal(NoteReview.id, 'note-review');
    assert.equal(NoteReview.schedule, undefined);
  });

  it('gather loads nutrition, goals, workouts, and alert budget', async () => {
    const nr = new NoteReview();
    const mockTools = [
      { name: 'get_today_nutrition', execute: async () => ({ calories: 1200, protein: 80 }) },
      { name: 'get_user_goals', execute: async () => ({ goals: { calories: 2000 } }) },
      { name: 'get_recent_workouts', execute: async () => ({ workouts: [] }) },
    ];
    const memory = { get: mock.fn(() => null), serialize: () => '' };
    const gathered = await nr.gather({ tools: mockTools, userId: 'kckern', memory, logger: console, context: {} });
    assert.ok(gathered.todayNutrition);
    assert.ok(gathered.goals);
    assert.equal(gathered.alertsSentToday.count, 0);
  });

  it('gather picks up forceSpeak from context', async () => {
    const nr = new NoteReview();
    const mockTools = [
      { name: 'get_today_nutrition', execute: async () => ({}) },
      { name: 'get_user_goals', execute: async () => ({}) },
      { name: 'get_recent_workouts', execute: async () => ({}) },
    ];
    const memory = { get: mock.fn(() => null), serialize: () => '' };
    const gathered = await nr.gather({ tools: mockTools, userId: 'kckern', memory, logger: console, context: { forceSpeak: true } });
    assert.equal(gathered.forceSpeak, true);
  });

  it('buildPrompt includes alert budget', () => {
    const nr = new NoteReview();
    const gathered = {
      todayNutrition: { calories: 1200, protein: 80 },
      goals: { goals: { calories: 2000 } },
      workouts: { workouts: [] },
      alertsSentToday: { count: 1, topics: ['sodium warning'] },
      forceSpeak: false,
    };
    const prompt = nr.buildPrompt(gathered, { serialize: () => '' });
    assert.ok(prompt.includes('1') || prompt.includes('alert'));
    assert.ok(prompt.includes('should_send: false'));
  });

  it('act increments alerts_sent_today when message sent', async () => {
    const nr = new NoteReview();
    const memory = {
      get: mock.fn(() => ({ count: 1, topics: ['prev'] })),
      set: mock.fn(),
    };
    await nr.act({ should_send: true, text: 'Protein at 30%' }, { memory, userId: 'kckern', logger: console });
    assert.equal(memory.set.mock.calls.length, 1);
    const saved = memory.set.mock.calls[0].arguments[1];
    assert.equal(saved.count, 2);
  });

  it('act does nothing when should_send is false', async () => {
    const nr = new NoteReview();
    const memory = { get: mock.fn(), set: mock.fn() };
    await nr.act({ should_send: false }, { memory, userId: 'kckern', logger: console });
    assert.equal(memory.set.mock.calls.length, 0);
  });
});
