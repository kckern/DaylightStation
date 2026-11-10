import { describe, it, expect, vi } from 'vitest';
import { ToggleDashboardEntity } from "../../../../__app_modules/household/home/server/application/home-automation/usecases/ToggleDashboardEntity.mjs";
import { AuthorizationError } from '#system/utils/errors/index.mjs';

const config = {
  summary: { scenes: [] },
  rooms: [{
    id: 'lr', label: 'Living Room',
    lights: [{ entity: 'light.lr_main', label: 'Main' }],
    climate: {}, motion: null,
  }],
};

// Entities that exist in the fake HA; anything else reads as missing.
const existing = {
  'light.hall': { state: 'off', attributes: {} },
  'switch.study_main_lights': { state: 'off', attributes: {} },
  'switch.living_room_shield_plug': { state: 'on', attributes: {} },
};

function makeUC({ callService } = {}) {
  return new ToggleDashboardEntity({
    configRepository: { load: async () => config },
    haGateway: {
      callService: callService || vi.fn().mockResolvedValue({ ok: true }),
      getState: vi.fn(async (id) => existing[id] || null),
    },
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

  it('rejects entity not in YAML whitelist with AuthorizationError', async () => {
    const callService = vi.fn();
    const uc = makeUC({ callService });
    // Message still matches /not on dashboard/i; now also typed for HTTP 403 mapping.
    await expect(uc.execute({ entityId: 'light.hacker', desiredState: 'on' }))
      .rejects.toThrow(AuthorizationError);
    await expect(uc.execute({ entityId: 'light.hacker', desiredState: 'on' }))
      .rejects.toThrow(/not on dashboard/i);
    expect(callService).not.toHaveBeenCalled();
  });

  it('allows a real light the room config never listed, via the entity policy', async () => {
    const callService = vi.fn().mockResolvedValue({ ok: true });
    await makeUC({ callService }).execute({ entityId: 'switch.study_main_lights', desiredState: 'toggle' });
    expect(callService).toHaveBeenCalledWith('switch', 'toggle', { entity_id: 'switch.study_main_lights' });
  });

  it('refuses a real plug — plugs are not switchable unless the household opts them in', async () => {
    const callService = vi.fn();
    await expect(makeUC({ callService }).execute({ entityId: 'switch.living_room_shield_plug', desiredState: 'off' }))
      .rejects.toThrow(AuthorizationError);
    expect(callService).not.toHaveBeenCalled();
  });

  it('rejects invalid desiredState', async () => {
    const uc = makeUC();
    await expect(uc.execute({ entityId: 'light.lr_main', desiredState: 'explode' }))
      .rejects.toThrow(/desiredState/);
  });
});
