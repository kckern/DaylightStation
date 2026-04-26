import { describe, it, expect, vi } from 'vitest';
import { ActivateDashboardScene } from '#apps/home-automation/usecases/ActivateDashboardScene.mjs';
import { AuthorizationError } from '#system/utils/errors/index.mjs';

const config = {
  summary: { scenes: [{ id: 'scene.all_off', label: 'All Off', icon: 'power' }] },
  rooms: [],
};

describe('ActivateDashboardScene', () => {
  it('activates an allowed scene', async () => {
    const activateScene = vi.fn().mockResolvedValue({ ok: true });
    const uc = new ActivateDashboardScene({
      configRepository: { load: async () => config },
      haGateway: { activateScene },
    });
    const result = await uc.execute({ sceneId: 'scene.all_off' });
    expect(activateScene).toHaveBeenCalledWith('scene.all_off');
    expect(result.ok).toBe(true);
  });
  it('rejects scene not listed in YAML with AuthorizationError', async () => {
    const activateScene = vi.fn();
    const uc = new ActivateDashboardScene({
      configRepository: { load: async () => config },
      haGateway: { activateScene },
    });
    // Message still matches /not on dashboard/i; now also typed for HTTP 403 mapping.
    await expect(uc.execute({ sceneId: 'scene.unknown' }))
      .rejects.toThrow(AuthorizationError);
    await expect(uc.execute({ sceneId: 'scene.unknown' }))
      .rejects.toThrow(/not on dashboard/i);
    expect(activateScene).not.toHaveBeenCalled();
  });
});
