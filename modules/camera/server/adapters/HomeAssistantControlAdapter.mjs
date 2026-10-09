/**
 * HomeAssistantControlAdapter — camera controls via Home Assistant
 *
 * Implements ICameraControlGateway. Maps camera HA entity config
 * (floodlight, siren) to generic control operations.
 *
 * @module adapters/camera
 */

/** Map of HA entity prefix → control type */
const CONTROL_TYPE_MAP = {
  floodlight: 'light',
  siren: 'siren',
};

export class HomeAssistantControlAdapter {
  /** @type {Map<string, { id: string, type: string, label: string, entityId: string, domain: string }[]>} */
  #cameraControls = new Map();
  #haGateway;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.devicesConfig - devices object from devices.yml
   * @param {Object} options.haGateway - HomeAssistantAdapter instance (getState, callService)
   * @param {Object} [options.logger]
   */
  constructor({ devicesConfig, haGateway, logger = console }) {
    this.#haGateway = haGateway;
    this.#logger = logger;
    this.#discover(devicesConfig);
  }

  #discover(devicesConfig) {
    for (const [id, device] of Object.entries(devicesConfig)) {
      if (device.type !== 'ip-camera') continue;
      const ha = device.homeassistant;
      if (!ha) continue;

      const controls = [];
      for (const [key, entityId] of Object.entries(ha)) {
        const type = CONTROL_TYPE_MAP[key];
        if (!type) continue; // Skip non-control entities (camera, motion sensors, etc.)
        const domain = entityId.split('.')[0]; // e.g. 'light' from 'light.driveway_camera_floodlight'
        controls.push({
          id: key,
          type,
          label: key.charAt(0).toUpperCase() + key.slice(1), // 'floodlight' → 'Floodlight'
          entityId,
          domain,
        });
      }

      if (controls.length > 0) {
        this.#cameraControls.set(id, controls);
        this.#logger.info?.('camera.controls.discovered', { cameraId: id, controls: controls.map(c => c.id) });
      }
    }
  }

  /**
   * List available controls for a camera.
   * @param {string} cameraId
   * @returns {Promise<{ id: string, type: string, label: string, state: string }[]>}
   */
  async listControls(cameraId) {
    const controls = this.#cameraControls.get(cameraId);
    if (!controls || !this.#haGateway) return [];

    const results = [];
    for (const ctrl of controls) {
      try {
        const haState = await this.#haGateway.getState(ctrl.entityId);
        results.push({
          id: ctrl.id,
          type: ctrl.type,
          label: ctrl.label,
          state: haState?.state || 'unknown',
        });
      } catch (err) {
        this.#logger.warn?.('camera.controls.stateError', { cameraId, control: ctrl.id, error: err.message });
        results.push({ id: ctrl.id, type: ctrl.type, label: ctrl.label, state: 'unknown' });
      }
    }

    return results;
  }

  /**
   * Execute a control action.
   * @param {string} cameraId
   * @param {string} controlId - e.g. 'floodlight', 'siren'
   * @param {'on'|'off'|'trigger'} action
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async executeControl(cameraId, controlId, action) {
    const controls = this.#cameraControls.get(cameraId);
    const ctrl = controls?.find(c => c.id === controlId);
    if (!ctrl) return { ok: false, error: `Unknown control: ${controlId}` };
    if (!this.#haGateway) return { ok: false, error: 'Home automation not configured' };

    const serviceMap = {
      on: 'turn_on',
      off: 'turn_off',
      trigger: 'turn_on', // siren.turn_on triggers it
    };
    const service = serviceMap[action];
    if (!service) return { ok: false, error: `Unknown action: ${action}` };

    this.#logger.info?.('camera.controls.execute', { cameraId, control: controlId, action });
    return this.#haGateway.callService(ctrl.domain, service, { entity_id: ctrl.entityId });
  }
}
