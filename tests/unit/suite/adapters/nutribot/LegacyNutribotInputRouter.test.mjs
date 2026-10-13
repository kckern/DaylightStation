import { describe, expect, it, vi } from 'vitest';
import { LegacyNutribotInputRouter } from "../../../../../__app_modules/nutribot/server/adapters/LegacyNutribotInputRouter.mjs";
import { NutribotScaleRefusal } from "../../../../../__app_modules/nutribot/server/application/ports/NutribotScaleRefusal.mjs";

describe('LegacyNutribotInputRouter', () => {
  it('preserves the established scale-refusal result envelope', async () => {
    const refusal = new NutribotScaleRefusal({ code: 'NUTRIBOT_SCALE_UNKNOWN_LEVEL', message: 'unknown level' });
    const adapter = new LegacyNutribotInputRouter({
      inputRouter: { route: vi.fn().mockResolvedValue(refusal) },
    });
    await expect(adapter.route({ type: 'callback' })).resolves.toEqual({
      success: false,
      error: 'unknown level',
      code: 'NUTRIBOT_SCALE_UNKNOWN_LEVEL',
    });
  });

  it('does not translate unexpected failures', async () => {
    const failure = new Error('datastore offline');
    const adapter = new LegacyNutribotInputRouter({ inputRouter: { route: vi.fn().mockRejectedValue(failure) } });
    await expect(adapter.route({ type: 'callback' })).rejects.toBe(failure);
  });
});
