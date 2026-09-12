import { IPlayOverlay } from '#apps/gaming/ports/IPlayOverlay.mjs';

/**
 * Drives the kiosk's web-overlay window.
 *
 * The overlay URL is a SETTING on the device, not a message to it: it survives
 * reboots and redeploys, and while set it renders over every screen the kiosk
 * shows. Two consequences are built in here.
 *
 * First, the page is checked to resolve BEFORE arming. A URL that 404s does not
 * fail quietly — the kiosk paints a browser error page over the television — so
 * a failed check is a refusal to arm, not a warning to ignore.
 *
 * Second, disarm is idempotent and cheap, so the caller can re-assert "nothing
 * is armed" at startup without knowing whether anything was.
 */
export class FullyKioskPlayOverlay extends IPlayOverlay {
  #clients; #httpClient; #gravity; #logger;

  /**
   * @param {Object} config
   * @param {Map<string, {command: Function}>} config.clientsByDevice
   * @param {Object} [config.httpClient] Used to verify the page resolves.
   * @param {string|number} [config.gravity] Android gravity for the overlay window.
   */
  constructor({ clientsByDevice, httpClient = null, gravity = 80, logger = console }) {
    super();
    if (!clientsByDevice) throw new Error('FullyKioskPlayOverlay requires clientsByDevice');
    this.#clients = clientsByDevice;
    this.#httpClient = httpClient;
    this.#gravity = gravity;
    this.#logger = logger;
  }

  async arm(deviceId, url) {
    const client = this.#clients.get(deviceId);
    if (!client) {
      // Not a declared overlay device. Silence is correct: no code path may
      // create an overlay on a screen that did not ask for one.
      this.#logger.debug?.('play.overlay.not_declared', { deviceId });
      return false;
    }
    if (!(await this.#resolves(url))) {
      this.#logger.error?.('play.overlay.url_unreachable', {
        deviceId, url, note: 'refusing to arm — an unreachable page paints an error over the screen',
      });
      return false;
    }

    const gravity = await client.command('setStringSetting', { key: 'webOverlayGravity', value: String(this.#gravity) });
    const set = await client.command('setStringSetting', { key: 'webOverlayUrl', value: url });
    const ok = set?.ok !== false && gravity?.ok !== false;
    this.#logger[ok ? 'info' : 'warn']?.('play.overlay.armed', { deviceId, ok });
    return ok;
  }

  async disarm(deviceId) {
    const client = this.#clients.get(deviceId);
    if (!client) return false;
    const result = await client.command('setStringSetting', { key: 'webOverlayUrl', value: '' });
    const ok = result?.ok !== false;
    this.#logger[ok ? 'info' : 'warn']?.('play.overlay.disarmed', { deviceId, ok });
    return ok;
  }

  async #resolves(url) {
    if (!url) return false;
    if (!this.#httpClient?.get) return true;   // nothing to check with; trust the caller
    try {
      const response = await this.#httpClient.get(url, { timeout: 5000 });
      const status = response?.status ?? 200;
      return status >= 200 && status < 400;
    } catch (error) {
      this.#logger.debug?.('play.overlay.verify_failed', { url, error: error.message });
      return false;
    }
  }
}

export default FullyKioskPlayOverlay;
