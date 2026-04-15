import https from 'https';

export class ReolinkCameraAdapter {
  #cameras = new Map();
  #logger;

  constructor({ devicesConfig, getAuth, logger = console }) {
    this.#logger = logger;
    this.#discover(devicesConfig, getAuth);
  }

  #discover(devicesConfig, getAuth) {
    for (const [id, device] of Object.entries(devicesConfig)) {
      if (device.type !== 'ip-camera') continue;

      const auth = device.auth_ref ? getAuth(device.auth_ref) : {};
      if (!auth) {
        this.#logger.warn?.('camera.discovery.noAuth', { id, auth_ref: device.auth_ref });
        continue;
      }

      const camera = {
        id,
        host: device.host,
        manufacturer: device.manufacturer || 'unknown',
        model: device.model || 'unknown',
        username: auth.username,
        password: auth.password,
        streams: {},
        homeassistant: device.homeassistant || {},
      };

      if (device.streams) {
        for (const [name, stream] of Object.entries(device.streams)) {
          camera.streams[name] = {
            ...stream,
            url: stream.url
              .replace('{username}', auth.username)
              .replace('{password}', auth.password),
          };
        }
      }

      this.#cameras.set(id, camera);
      this.#logger.info?.('camera.discovered', { id, host: device.host, model: device.model });
    }
  }

  /** List all discovered cameras (safe for API — no credentials) */
  listCameras() {
    return Array.from(this.#cameras.values()).map(cam => ({
      id: cam.id,
      host: cam.host,
      manufacturer: cam.manufacturer,
      model: cam.model,
      capabilities: ['snapshot', ...(Object.keys(cam.streams).length > 0 ? ['live'] : [])],
      streams: Object.keys(cam.streams),
      homeassistant: cam.homeassistant,
    }));
  }

  /** Get a camera by ID (internal — includes credentials) */
  getCamera(id) {
    return this.#cameras.get(id) || null;
  }

  /** Get the RTSP URL for a camera stream */
  getStreamUrl(id, streamName = 'sub') {
    const cam = this.#cameras.get(id);
    return cam?.streams[streamName]?.url || null;
  }

  /**
   * Fetch a live snapshot JPEG from the camera.
   * Returns a { buffer, contentType } object or null on failure.
   */
  async fetchSnapshot(id, { width, height } = {}) {
    const cam = this.#cameras.get(id);
    if (!cam) return null;

    const params = { cmd: 'Snap', channel: '0', user: cam.username, password: cam.password };
    if (width) params.width = String(width);
    if (height) params.height = String(height);
    const snapUrl = `https://${cam.host}/cgi-bin/api.cgi?` + new URLSearchParams(params);

    const t0 = Date.now();
    try {
      const buffer = await new Promise((resolve, reject) => {
        const req = https.get(snapUrl, { rejectUnauthorized: false, timeout: 30000 }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      });

      const durationMs = Date.now() - t0;
      this.#logger.info?.('camera.snapshot.ok', { id, durationMs, sizeBytes: buffer.length });
      return { buffer, contentType: 'image/jpeg' };
    } catch (err) {
      const durationMs = Date.now() - t0;
      this.#logger.error?.('camera.snapshot.error', { id, error: err.message, durationMs });
      return null;
    }
  }
}
