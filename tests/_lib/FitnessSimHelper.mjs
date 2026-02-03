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

  // ═══════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════

  async getDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getDevices());
  }

  async getActiveDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getActiveDevices());
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
