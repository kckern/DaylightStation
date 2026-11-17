import { IArcadeGameOverlay } from "../../application/ports/IArcadeGameOverlay.mjs";

const GRAVITIES = Object.freeze(['top', 'bottom']);

/**
 * Drives the countdown film on a device running the DaylightStation Android
 * kiosk app, through the app's web overlay (`POST /kiosk/overlay`).
 *
 * The web overlay is a transparent, non-interactive page the app draws above
 * the kiosk and above other apps, and it stays until cleared: the same thing
 * Fully's `webOverlayUrl` setting is, so this class keeps the same two rules
 * as FullyKioskArcadeGameOverlay.
 *
 * First, the page is checked to resolve BEFORE arming. An unreachable page
 * would paint an error over the television, so a failed check is a refusal to
 * arm.
 *
 * Second, disarm is idempotent and cheap, so the caller can re-assert "nothing
 * is armed" at startup without knowing whether anything was. One difference
 * from Fully: the app has a single overlay, so clearing it also clears a text
 * message an operator put up from the Admin console.
 */
export class DaylightAndroidArcadeGameOverlay extends IArcadeGameOverlay {
  #clients; #httpClient; #gravity; #logger;

  /**
   * @param {Object} config
   * @param {Map<string, {showWebOverlay: Function, clearOverlay: Function}>} config.clientsByDevice
   * @param {Object} [config.httpClient] Used to verify the page resolves.
   * @param {'top'|'bottom'} [config.gravity] Edge the overlay window sits against.
   */
  constructor({ clientsByDevice, httpClient = null, gravity = 'bottom', logger = console } = {}) {
    super();
    if (!clientsByDevice) throw new Error('DaylightAndroidArcadeGameOverlay requires clientsByDevice');
    if (!GRAVITIES.includes(gravity)) throw new Error(`DaylightAndroidArcadeGameOverlay gravity must be one of ${GRAVITIES.join(', ')}`);
    this.#clients = clientsByDevice;
    this.#httpClient = httpClient;
    this.#gravity = gravity;
    this.#logger = logger;
  }

  async arm(deviceId, url) {
    const client = this.#clients.get(deviceId);
    if (!client) {
      // Not a declared overlay device: no code path may create an overlay on
      // a screen that did not ask for one.
      this.#logger.debug?.('arcade.overlay.not_declared', { deviceId });
      return false;
    }
    if (!(await this.#resolves(url))) {
      this.#logger.error?.('arcade.overlay.url_unreachable', {
        deviceId, url, note: 'refusing to arm — an unreachable page paints an error over the screen',
      });
      return false;
    }

    const result = await client.showWebOverlay(url, this.#gravity);
    // The device says what it is showing; anything but a web overlay is not armed.
    const showing = result?.ok === true && result.data?.shown !== false
      && (result.data?.kind === undefined || result.data.kind === 'web');
    this.#logger[showing ? 'info' : 'warn']?.('arcade.overlay.armed', {
      deviceId, ok: showing, url, gravity: this.#gravity,
      error: showing ? undefined : (result?.error || 'kiosk did not show the web overlay'),
    });
    return showing;
  }

  async disarm(deviceId) {
    const client = this.#clients.get(deviceId);
    if (!client) return false;
    const result = await client.clearOverlay();
    const ok = result?.ok === true;
    this.#logger[ok ? 'info' : 'warn']?.('arcade.overlay.disarmed', {
      deviceId, ok, error: ok ? undefined : (result?.error || 'kiosk refused to clear the overlay'),
    });
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
      this.#logger.debug?.('arcade.overlay.verify_failed', { url, error: error.message });
      return false;
    }
  }
}

export default DaylightAndroidArcadeGameOverlay;
