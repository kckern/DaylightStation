import { it, expect, vi } from 'vitest';
import { MealInstructionService } from './MealInstructionService.mjs';
import { OpenAIAdapter } from '#adapters/ai/OpenAIAdapter.mjs';

it('sends a transcribed dinner instruction through the real gateway as message objects', async () => {
  const post = vi.fn(async (_url, body) => {
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages).toEqual([expect.objectContaining({ role: 'user', content: expect.stringContaining('add potatoes') })]);
    return { status: 200, headers: {}, data: { choices: [{ message: { content: '{"intent":"add"}' } }] } };
  });
  const aiGateway = new OpenAIAdapter({ apiKey: 'test' }, { httpClient: { post }, logger: {} });
  const service = new MealInstructionService({ aiGateway, nutritionItems: { findByDate: async () => [
    { uuid: 'broth', name: 'Broth', mealTime: 'evening', date: '2026-09-06' },
  ] } });
  await expect(service.execute('u', { date: '2026-09-06', bucket: 'evening', text: 'add potatoes' })).resolves.toBeNull();
  expect(post).toHaveBeenCalledOnce();
});
