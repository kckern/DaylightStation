import { describe, it, expect, vi } from 'vitest';
import { GarageHumanActivityService } from './GarageHumanActivityService.mjs';

describe('GarageHumanActivityService', () => {
  const make = () => {
    const gateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    return { gateway, service: new GarageHumanActivityService({ gateway }) };
  };

  it('protects the TV while Emulation is open', async () => {
    const { gateway, service } = make();
    expect(await service.update({ deviceId: 'garage-tv', emulationOpen: true, hrSessionActive: false })).toEqual({ ok: true, active: true });
    expect(gateway.callService).toHaveBeenCalledWith('input_boolean', 'turn_on', { entity_id: 'input_boolean.garage_human_activity' });
  });

  it('protects the TV during an active HR session and releases it afterward', async () => {
    const { gateway, service } = make();
    await service.update({ deviceId: 'garage-tv', emulationOpen: false, hrSessionActive: true });
    await service.update({ deviceId: 'garage-tv', emulationOpen: false, hrSessionActive: false });
    expect(gateway.callService).toHaveBeenNthCalledWith(1, 'input_boolean', 'turn_on', { entity_id: 'input_boolean.garage_human_activity' });
    expect(gateway.callService).toHaveBeenNthCalledWith(2, 'input_boolean', 'turn_off', { entity_id: 'input_boolean.garage_human_activity' });
  });

  it('refuses to let another display clear the garage protection', async () => {
    const { gateway, service } = make();
    expect(await service.update({ deviceId: 'office-tv', emulationOpen: false, hrSessionActive: false })).toEqual({ ok: false, reason: 'invalid_device' });
    expect(gateway.callService).not.toHaveBeenCalled();
  });

  it('reports a Home Assistant failure instead of claiming protection is active', async () => {
    const { gateway, service } = make();
    gateway.callService.mockResolvedValue({ ok: false, error: 'unavailable' });
    expect(await service.update({ deviceId: 'garage-tv', emulationOpen: true, hrSessionActive: false })).toEqual({ ok: false, reason: 'ha_error' });
  });
});
