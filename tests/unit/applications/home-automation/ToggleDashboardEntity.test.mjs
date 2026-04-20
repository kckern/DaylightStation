import { describe, it, expect, vi } from 'vitest';
import { ToggleDashboardEntity } from '#apps/home-automation/usecases/ToggleDashboardEntity.mjs';

const config = {
  summary: { scenes: [] },
  rooms: [{
    id: 'lr', label: 'Living Room',
    lights: [{ entity: 'light.lr_main', label: 'Main' }],
    climate: {}, motion: null,
  }],
};

function makeUC({ callService } = {}) {
  return new ToggleDashboardEntity({
    configRepository: { load: async () => config },
    haGateway: { callService: callService || vi.fn().mockResolvedValue({ ok: true }) },
  });
}

describe('ToggleDashboardEntity', () => {
  it('calls HA light.turn_on when desiredState is on', async () => {
    const callService = vi.fn().mockResolvedValue({ ok: true });
    const uc = makeUC({ callService });
    const result = await uc.execute({ entityId: 'light.lr_main', desiredState: 'on' });
    expect(callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: 'light.lr_main' });
    expect(result.ok).toBe(true);
  });

  it('calls turn_off when desiredState is off', async () => {
    const callService = vi.fn().mockResolvedValue({ ok: true });
    const uc = makeUC({ callService });
    await uc.execute({ entityId: 'light.lr_main', desiredState: 'off' });
    expect(callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: 'light.lr_main' });
  });

  it('calls toggle when desiredState is toggle', async () => {
    const callService = vi.fn().mockResolvedValue({ ok: true });
    const uc = makeUC({ callService });
    await uc.execute({ entityId: 'light.lr_main', desiredState: 'toggle' });
    expect(callService).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.lr_main' });
  });

  it('rejects entity not in YAML whitelist', async () => {
    const callService = vi.fn();
    const uc = makeUC({ callService });
    await expect(uc.execute({ entityId: 'light.hacker', desiredState: 'on' }))
      .rejects.toThrow(/not on dashboard/i);
    expect(callService).not.toHaveBeenCalled();
  });

  it('rejects invalid desiredState', async () => {
    const uc = makeUC();
    await expect(uc.execute({ entityId: 'light.lr_main', desiredState: 'explode' }))
      .rejects.toThrow(/desiredState/);
  });
});
