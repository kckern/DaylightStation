/**
 * IHomeAutomationGateway - Port interface for home automation providers
 *
 * Provider-agnostic interface for controlling smart home devices.
 * Implementations: HomeAssistantAdapter, HubitatAdapter, etc.
 */

/**
 * Device state representation
 * @typedef {Object} DeviceState
 * @property {string} entityId - Unique device identifier
 * @property {string} state - Current state value (e.g., 'on', 'off', '72')
 * @property {Object} attributes - Provider-specific attributes
 * @property {string} lastChanged - ISO timestamp of last state change
 */

/**
 * Service call result
 * @typedef {Object} ServiceResult
 * @property {boolean} ok - Whether the call succeeded
 * @property {string} [error] - Error message if failed
 * @property {Object} [data] - Response data from provider
 */

/**
 * @interface IHomeAutomationGateway
 */

/**
 * Check if an object implements IHomeAutomationGateway
 * @param {Object} obj
 * @returns {boolean}
 */
export function isHomeAutomationGateway(obj) {
  return (
    obj &&
    typeof obj.getState === 'function' &&
    typeof obj.callService === 'function' &&
    typeof obj.activateScene === 'function'
  );
}

/**
 * Assert that an object implements IHomeAutomationGateway
 * @param {Object} obj
 * @throws {Error} if not a valid gateway
 */
export function assertHomeAutomationGateway(obj) {
  if (!isHomeAutomationGateway(obj)) {
    throw new Error('Object does not implement IHomeAutomationGateway');
  }
}

/**
 * IHomeAutomationGateway interface definition
 *
 * Implementations must provide:
 *
 * getState(entityId: string): Promise<DeviceState | null>
 *   Get current state of a device/entity.
 *   Returns null if entity not found.
 *
 * callService(domain: string, service: string, data?: Object): Promise<ServiceResult>
 *   Call a service on the home automation platform.
 *   Examples:
 *     callService('light', 'turn_on', { entity_id: 'light.living_room' })
 *     callService('switch', 'toggle', { entity_id: 'switch.garage' })
 *     callService('script', 'turn_on', { entity_id: 'script.movie_mode' })
 *
 * activateScene(sceneId: string): Promise<ServiceResult>
 *   Activate a scene by ID (convenience wrapper for callService).
 *   Implementation should normalize scene IDs (e.g., add 'scene.' prefix if needed).
 *
 * runScript(scriptId: string): Promise<ServiceResult>
 *   Run a script/automation by ID (convenience wrapper for callService).
 *   Implementation should normalize script IDs.
 *
 * waitForState(entityId: string, desiredState: string, options?: WaitOptions): Promise<WaitResult>
 *   Poll entity until it reaches desired state or timeout.
 *   options.timeoutMs - Max wait time (default: 30000)
 *   options.pollIntervalMs - Poll interval (default: 2000)
 *   Returns { reached: boolean, elapsed: number, finalState: string }
 *
 * isConnected(): boolean
 *   Check if gateway is connected/configured.
 *
 * getProviderName(): string
 *   Return provider name (e.g., 'homeassistant', 'hubitat').
 */

/**
 * Wait options for waitForState
 * @typedef {Object} WaitOptions
 * @property {number} [timeoutMs=30000] - Maximum wait time in milliseconds
 * @property {number} [pollIntervalMs=2000] - Polling interval in milliseconds
 */

/**
 * Wait result from waitForState
 * @typedef {Object} WaitResult
 * @property {boolean} reached - Whether desired state was reached
 * @property {number} elapsedMs - Time elapsed in milliseconds
 * @property {string} finalState - Final state value when wait completed
 */

/**
 * Create a no-op gateway for testing or when no provider is configured
 * @returns {IHomeAutomationGateway}
 */
export function createNoOpGateway() {
  return {
    async getState(_entityId) {
      return null;
    },
    async callService(_domain, _service, _data) {
      return { ok: false, error: 'No home automation provider configured' };
    },
    async activateScene(_sceneId) {
      return { ok: false, error: 'No home automation provider configured' };
    },
    async runScript(_scriptId) {
      return { ok: false, error: 'No home automation provider configured' };
    },
    async waitForState(_entityId, _desiredState, _options) {
      return { reached: false, elapsedMs: 0, finalState: 'unknown' };
    },
    isConnected() {
      return false;
    },
    getProviderName() {
      return 'noop';
    }
  };
}

export default {
  isHomeAutomationGateway,
  assertHomeAutomationGateway,
  createNoOpGateway
};
