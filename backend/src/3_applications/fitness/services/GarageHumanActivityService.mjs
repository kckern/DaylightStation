/** Mirrors the garage kiosk's human activity into the Home Assistant shutdown guard. */
export class GarageHumanActivityService {
  constructor({ gateway, logger } = {}) {
    this.gateway = gateway;
    this.logger = logger;
  }

  async update({ deviceId, emulationOpen, hrSessionActive } = {}) {
    if (deviceId !== 'garage-tv' || typeof emulationOpen !== 'boolean' || typeof hrSessionActive !== 'boolean') {
      return { ok: false, reason: 'invalid_device' };
    }
    if (!this.gateway?.callService) return { ok: false, reason: 'ha_unavailable' };

    const active = emulationOpen || hrSessionActive;
    const result = await this.gateway.callService('input_boolean', active ? 'turn_on' : 'turn_off', {
      entity_id: 'input_boolean.garage_human_activity',
    });
    if (!result?.ok) {
      this.logger?.warn?.('fitness.garage_human_activity.sync_failed', { active, error: result?.error ?? null });
      return { ok: false, reason: 'ha_error' };
    }
    this.logger?.info?.('fitness.garage_human_activity.synced', { active, emulationOpen, hrSessionActive });
    return { ok: true, active };
  }
}
