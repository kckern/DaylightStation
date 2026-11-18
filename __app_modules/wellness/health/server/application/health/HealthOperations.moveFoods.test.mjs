import { describe, expect, it, vi } from 'vitest';
import { HealthOperations } from './HealthOperations.mjs';

describe('HealthOperations.moveFoods', () => {
  it('replaces a client-sent today with the server date', async () => {
    const ops = new HealthOperations({ healthData: {}, nutritionItems: {}, today: () => '2026-09-07' });
    const moveFoods = vi.fn(async () => ({ committed: true }));
    ops.mealCommands = { moveFoods };
    await ops.moveFoods('u', { today: '2099-01-01', toDate: '2026-09-20' });
    expect(moveFoods).toHaveBeenCalledWith('u', expect.objectContaining({ today: '2026-09-07', toDate: '2026-09-20' }));
  });

  it('gives day input the server date, whatever the caller sent', async () => {
    const ops = new HealthOperations({ healthData: {}, nutritionItems: {}, today: () => '2026-09-07' });
    const processDayInput = vi.fn(async () => ({ committed: true }));
    ops.nutritionInput = { processDayInput };
    await ops.processDayInput({ userId: 'u', content: 'eggs', today: '2099-01-01' });
    expect(processDayInput).toHaveBeenCalledWith({ userId: 'u', content: 'eggs', today: '2026-09-07' });
  });
});
