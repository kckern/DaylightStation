/**
 * ReolinkStateAdapter — polls AI detection state from Reolink cameras
 *
 * Implements ICameraStateGateway. Authenticates via the Reolink HTTP API
 * (token-based, 1-hour lease), then polls GetAiState for detection status.
 *
 * @module adapters/camera
 */
import https from 'https';

export class ReolinkStateAdapter {
  /** @type {Map<string, { host: string, username: string, password: string }>} */
  #cameras = new Map();
  /** @type {Map<string, { token: string, expiresAt: number }>} */
  #tokens = new Map();
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.devicesConfig - devices object from devices.yml
   * @param {Function} options.getAuth - (authRef) => { username, password }
   * @param {Object} [options.logger]
   */
  constructor({ devicesConfig, getAuth, logger = console }) {
    this.#logger = logger;
    for (const [id, device] of Object.entries(devicesConfig)) {
      if (device.type !== 'ip-camera') continue;
      const auth = device.auth_ref ? getAuth(device.auth_ref) : null;
      if (!auth) continue;
      this.#cameras.set(id, { host: device.host, username: auth.username, password: auth.password });
    }
  }

  /**
   * Get detection state for a camera.
   * @param {string} cameraId
   * @returns {Promise<{ detections: { type: string, active: boolean }[], motion: boolean }>}
   */
  async getDetectionState(cameraId) {
    const cam = this.#cameras.get(cameraId);
    if (!cam) return { detections: [], motion: false };

    try {
      const token = await this.#getToken(cameraId, cam);
      const results = await this.#apiCall(cam.host, token, [
        { cmd: 'GetAiState', action: 0, param: { channel: 0 } },
        { cmd: 'GetMdState', action: 0, param: { channel: 0 } },
      ]);

      const aiState = results.find(r => r.cmd === 'GetAiState');
      const mdState = results.find(r => r.cmd === 'GetMdState');

      const detections = [];
      if (aiState?.code === 0) {
        const v = aiState.value;
        if (v.people?.support) detections.push({ type: 'person', active: v.people.alarm_state === 1 });
        if (v.vehicle?.support) detections.push({ type: 'vehicle', active: v.vehicle.alarm_state === 1 });
        if (v.dog_cat?.support) detections.push({ type: 'animal', active: v.dog_cat.alarm_state === 1 });
      }

      const motion = mdState?.code === 0 ? mdState.value.state === 1 : false;

      return { detections, motion };
    } catch (err) {
      this.#logger.warn?.('camera.state.error', { cameraId, error: err.message });
      return { detections: [], motion: false };
    }
  }

  // ── Private ──

  async #getToken(cameraId, cam) {
    const cached = this.#tokens.get(cameraId);
    if (cached && Date.now() < cached.expiresAt) return cached.token;

    const result = await this.#apiCall(cam.host, null, [
      { cmd: 'Login', param: { User: { userName: cam.username, password: cam.password } } },
    ]);

    const loginResp = result.find(r => r.cmd === 'Login');
    if (loginResp?.code !== 0) throw new Error('Reolink login failed');

    const token = loginResp.value.Token.name;
    const leaseTime = loginResp.value.Token.leaseTime || 3600;
    // Refresh 60s before expiry
    this.#tokens.set(cameraId, { token, expiresAt: Date.now() + (leaseTime - 60) * 1000 });

    this.#logger.debug?.('camera.state.login', { cameraId, leaseTime });
    return token;
  }

  #apiCall(host, token, commands) {
    const path = token
      ? `/cgi-bin/api.cgi?token=${token}`
      : '/cgi-bin/api.cgi?cmd=Login';
    const body = JSON.stringify(commands);

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: host,
        port: 443,
        path,
        method: 'POST',
        rejectUnauthorized: false,
        timeout: 5000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            // Handle token expiry — clear cache so next call re-authenticates
            if (Array.isArray(json) && json[0]?.error?.rspCode === -6) {
              this.#tokens.delete(host); // force re-login
              reject(new Error('Token expired'));
              return;
            }
            resolve(json);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end(body);
    });
  }
}
