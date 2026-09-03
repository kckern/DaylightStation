// backend/src/3_applications/agents/health-coach/tools/NutritionActionToolFactory.test.mjs

import { describe, it, expect, vi } from 'vitest';
import { NutritionActionToolFactory } from './NutritionActionToolFactory.mjs';

describe('NutritionActionToolFactory', () => {
  const make = (process) => {
    const factory = new NutritionActionToolFactory({ nutritionInput: { process } });
    const tools = factory.createTools();
    return tools.find((t) => t.name === 'log_food');
  };

  // The pending-confirmation gate was retired: the text pipeline now commits
  // captures immediately as unsettled, on every transport including the coach.
  it('logs immediately via the text pipeline', async () => {
    const process = vi.fn(async () => ({ messages: [{ text: '🟡 2 eggs — 140 kcal' }] }));
    const tool = make(process);
    const out = await tool.execute({ userId: 'u', description: '2 eggs' });
    expect(process).toHaveBeenCalledWith({ type: 'text', content: '2 eggs', userId: 'u' });
    expect(out.status).toBe('logged');
    expect(out.summary).toContain('2 eggs');
  });

  it('returns an error envelope on pipeline failure', async () => {
    const tool = make(vi.fn(async () => { throw new Error('parse failed'); }));
    const out = await tool.execute({ userId: 'u', description: 'gibberish' });
    expect(out.error).toMatch(/parse failed/);
  });

  it('requires a description', async () => {
    const tool = make(vi.fn());
    const out = await tool.execute({ userId: 'u', description: '' });
    expect(out.error).toMatch(/description/);
  });
});
