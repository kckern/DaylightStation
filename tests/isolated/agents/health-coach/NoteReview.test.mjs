import { describe, it, expect, vi } from 'vitest';

import { NoteReview } from '../../../../backend/src/3_applications/agents/health-coach/assignments/NoteReview.mjs';

describe('NoteReview', () => {
  it('has correct static properties', () => {
    expect(NoteReview.id).toBe('note-review');
    expect(NoteReview.schedule).toBe(undefined);
  });

  it('gather loads nutrition, goals, workouts, and alert budget', async () => {
    const nr = new NoteReview();
    const mockTools = [
      { name: 'get_today_nutrition', execute: async () => ({ calories: 1200, protein: 80 }) },
      { name: 'get_user_goals', execute: async () => ({ goals: { calories: 2000 } }) },
      { name: 'get_recent_workouts', execute: async () => ({ workouts: [] }) },
    ];
    const memory = { get: vi.fn(() => null), serialize: () => '' };
    const gathered = await nr.gather({ tools: mockTools, userId: 'kckern', memory, logger: console, context: {} });
    expect(gathered.todayNutrition).toBeTruthy();
    expect(gathered.goals).toBeTruthy();
    expect(gathered.alertsSentToday.count).toBe(0);
  });

  it('gather picks up forceSpeak from context', async () => {
    const nr = new NoteReview();
    const mockTools = [
      { name: 'get_today_nutrition', execute: async () => ({}) },
      { name: 'get_user_goals', execute: async () => ({}) },
      { name: 'get_recent_workouts', execute: async () => ({}) },
    ];
    const memory = { get: vi.fn(() => null), serialize: () => '' };
    const gathered = await nr.gather({ tools: mockTools, userId: 'kckern', memory, logger: console, context: { forceSpeak: true } });
    expect(gathered.forceSpeak).toBe(true);
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
    expect(prompt.includes('1') || prompt.includes('alert')).toBeTruthy();
    expect(prompt.includes('should_send: false')).toBeTruthy();
  });

  it('act increments alerts_sent_today when message sent', async () => {
    const nr = new NoteReview();
    const memory = {
      get: vi.fn(() => ({ count: 1, topics: ['prev'] })),
      set: vi.fn(),
    };
    await nr.act({ should_send: true, text: 'Protein at 30%' }, { memory, userId: 'kckern', logger: console });
    expect(memory.set.mock.calls.length).toBe(1);
    const saved = memory.set.mock.calls[0][1];
    expect(saved.count).toBe(2);
  });

  it('act does nothing when should_send is false', async () => {
    const nr = new NoteReview();
    const memory = { get: vi.fn(), set: vi.fn() };
    await nr.act({ should_send: false }, { memory, userId: 'kckern', logger: console });
    expect(memory.set.mock.calls.length).toBe(0);
  });
});
