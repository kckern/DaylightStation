// tests/_lib/FitnessSimHelper.mjs

/**
 * FitnessSimHelper
 *
 * Playwright wrapper for FitnessSimulationController.
 * Provides clean async API for test automation.
 */
export class FitnessSimHelper {
  constructor(page) {
    this.page = page;
  }

  /**
   * Wait for controller to be available on window
   */
  async waitForController(timeout = 10000) {
    await this.page.waitForFunction(
      () => window.__fitnessSimController,
      { timeout }
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Manual Control
  // ═══════════════════════════════════════════════════════════════

  async setZone(deviceId, zone) {
    return this.page.evaluate(
      ([id, z]) => window.__fitnessSimController.setZone(id, z),
      [deviceId, zone]
    );
  }

  async setHR(deviceId, bpm) {
    return this.page.evaluate(
      ([id, hr]) => window.__fitnessSimController.setHR(id, hr),
      [deviceId, bpm]
    );
  }

  async stopDevice(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.stopDevice(id),
      deviceId
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Automation
  // ═══════════════════════════════════════════════════════════════

  async startAuto(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.startAuto(id),
      deviceId
    );
  }

  async startAutoSession(deviceId, opts = {}) {
    return this.page.evaluate(
      ([id, o]) => window.__fitnessSimController.startAutoSession(id, o),
      [deviceId, opts]
    );
  }

  async stopAuto(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.stopAuto(id),
      deviceId
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Bulk Operations
  // ═══════════════════════════════════════════════════════════════

  async activateAll(zone = 'active') {
    return this.page.evaluate(
      (z) => window.__fitnessSimController.activateAll(z),
      zone
    );
  }

  async startAutoSessionAll(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.startAutoSessionAll(o),
      opts
    );
  }

  async stopAll() {
    return this.page.evaluate(() => window.__fitnessSimController.stopAll());
  }

  async clearAllDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.clearAllDevices());
  }

  // ═══════════════════════════════════════════════════════════════
  // Governance
  // ═══════════════════════════════════════════════════════════════

  async enableGovernance(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.enableGovernance(o),
      opts
    );
  }

  async disableGovernance() {
    return this.page.evaluate(() => window.__fitnessSimController.disableGovernance());
  }

  async triggerChallenge(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.triggerChallenge(o),
      opts
    );
  }

  async completeChallenge(success) {
    return this.page.evaluate(
      (s) => window.__fitnessSimController.completeChallenge(s),
      success
    );
  }

  async getGovernanceState() {
    return this.page.evaluate(() => window.__fitnessSimController.getGovernanceState());
  }

  async resetStats() {
    return this.page.evaluate(() => window.__fitnessSimController.resetStats());
  }

  // ═══════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════

  async getDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getDevices());
  }

  async getActiveDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getActiveDevices());
  }

  async getParticipantProfiles() {
    return this.page.evaluate(() => window.__fitnessSimController.getParticipantProfiles());
  }

  // ═══════════════════════════════════════════════════════════════
  // Convenience Assertions
  // ═══════════════════════════════════════════════════════════════

  async waitForZone(deviceId, zone, timeout = 5000) {
    await this.page.waitForFunction(
      ([id, z]) => {
        const ctrl = window.__fitnessSimController;
        if (!ctrl) return false;
        const device = ctrl.getDevices().find(d => d.deviceId === id);
        return device?.currentZone === z;
      },
      [deviceId, zone],
      { timeout }
    );
  }

  async waitForActiveCount(count, timeout = 5000) {
    await this.page.waitForFunction(
      (c) => {
        const ctrl = window.__fitnessSimController;
        return ctrl && ctrl.getActiveDevices().length === c;
      },
      count,
      { timeout }
    );
  }
}

/**
 * Drive an equipment cadence (RPM) via the controller in the page.
 * Equivalent to moving the popup's RPM slider, but scriptable from Playwright.
 */
export async function setRpm(page, equipmentId, rpm) {
  return page.evaluate(({ id, rpm }) => {
    const ctl = window.__fitnessSimController;
    if (!ctl) return { ok: false, error: 'controller_unavailable' };
    return ctl.setRpm(id, rpm);
  }, { id: equipmentId, rpm });
}

/**
 * Trigger a cycle challenge by selection id.
 * Returns { success, reason?, challengeId? }.
 */
export async function triggerCycleChallenge(page, { selectionId, riderId } = {}) {
  return page.evaluate(({ selectionId, riderId }) => {
    const ctl = window.__fitnessSimController;
    if (!ctl) return { success: false, reason: 'controller_unavailable' };
    return ctl.triggerCycleChallenge({ selectionId, riderId });
  }, { selectionId, riderId });
}

/**
 * Read live cycle-challenge state from window.__fitnessGovernance.
 * Returns null if no cycle challenge is active.
 */
export async function readCycleState(page) {
  return page.evaluate(() => {
    const gov = window.__fitnessGovernance;
    if (!gov || gov.activeChallengeType !== 'cycle') return null;
    return {
      cycleState: gov.cycleState,
      currentRpm: gov.currentRpm,
      riderId: gov.riderId,
      currentPhaseIndex: gov.currentPhaseIndex,
      totalPhases: gov.totalPhases,
      phaseProgressPct: gov.phaseProgressPct,
      equipment: gov.activeChallengeEquipment
    };
  });
}

/**
 * Wait until cycleState transitions to one of `targets`, or timeout.
 */
export async function waitForCycleState(page, targets, { timeoutMs = 30000, pollMs = 250 } = {}) {
  const wanted = Array.isArray(targets) ? targets : [targets];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readCycleState(page);
    if (state && wanted.includes(state.cycleState)) return state;
    await page.waitForTimeout(pollMs);
  }
  const finalState = await readCycleState(page);
  throw new Error(`Timed out waiting for cycleState in ${wanted.join(',')}; last seen: ${JSON.stringify(finalState)}`);
}

/**
 * List equipment as the simulator sees it.
 */
export async function getEquipment(page) {
  return page.evaluate(() => {
    const ctl = window.__fitnessSimController;
    return ctl ? ctl.getEquipment() : [];
  });
}

/**
 * List cycle selections from the active policy set.
 */
export async function listCycleSelections(page) {
  return page.evaluate(() => {
    const ctl = window.__fitnessSimController;
    return ctl ? (ctl.listCycleSelections?.() || []) : [];
  });
}
