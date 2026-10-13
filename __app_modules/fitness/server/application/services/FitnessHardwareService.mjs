/** Semantic control facade for Fitness-owned room hardware. */
export class FitnessHardwareService {
  constructor({ zoneLedController = null, danceLightingController = null, equipmentFanController = null }) {
    this.zoneLedController = zoneLedController;
    this.danceLightingController = danceLightingController;
    this.equipmentFanController = equipmentFanController;
  }

  async syncZone(input) {
    if (!this.zoneLedController) return { kind: 'unconfigured' };
    return { kind: 'found', body: await this.zoneLedController.syncZone(input) };
  }
  zoneStatus(householdId) { return this.zoneLedController ? { kind: 'found', body: this.zoneLedController.getStatus(householdId) } : { kind: 'unconfigured' }; }
  zoneMetrics() { return this.zoneLedController ? { kind: 'found', body: this.zoneLedController.getMetrics() } : { kind: 'unconfigured' }; }
  zoneReset() { return this.zoneLedController ? { kind: 'found', body: this.zoneLedController.reset() } : { kind: 'unconfigured' }; }

  async dance(action, householdId, bpm) {
    const method = action === 'bpm' ? 'setBpm' : action;
    if (!this.danceLightingController || typeof this.danceLightingController[method] !== 'function') {
      return { ok: true, skipped: true, reason: 'dance_lighting_unavailable' };
    }
    return action === 'bpm'
      ? this.danceLightingController.setBpm(householdId, bpm)
      : this.danceLightingController[action](householdId);
  }

  async evaluateFan(input) {
    if (!this.equipmentFanController) return { kind: 'unconfigured' };
    return { kind: 'found', body: await this.equipmentFanController.evaluate(input) };
  }
  fanStatus(householdId) { return this.equipmentFanController ? { kind: 'found', body: this.equipmentFanController.getStatus(householdId) } : { kind: 'unconfigured' }; }
  fanReset() { return this.equipmentFanController ? { kind: 'found', body: this.equipmentFanController.reset() } : { kind: 'unconfigured' }; }
}

export default FitnessHardwareService;
