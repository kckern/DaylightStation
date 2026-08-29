/**
 * Application-owned port for querying whether a device display is powered on.
 */
export class IDisplayPowerCheck {
  async isDisplayOn(_deviceId) {
    throw new Error('IDisplayPowerCheck.isDisplayOn must be implemented');
  }
}

export function isDisplayPowerCheck(value) {
  return value !== null && typeof value === 'object' && typeof value.isDisplayOn === 'function';
}

export function createNoOpDisplayPowerCheck() {
  return new class NoOpDisplayPowerCheck extends IDisplayPowerCheck {
    async isDisplayOn() {
      return { on: false, state: 'unknown', source: 'none' };
    }
  }();
}
