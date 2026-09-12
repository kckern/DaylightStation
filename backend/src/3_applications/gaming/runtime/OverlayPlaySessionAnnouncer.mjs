import { IPlaySessionAnnouncer } from '#apps/gaming/ports/IPlaySessionAnnouncer.mjs';

/**
 * Puts the countdown film up when play is CONFIRMED, and takes it down when the
 * session ends.
 *
 * Arming on confirmed play rather than on launch matters twice over: a launch
 * that never produces a game never puts anything on screen, and the film's
 * appearance is itself evidence that the session is real. The cost is that it
 * appears up to one observation interval after play begins, which is immaterial
 * when the first warning is minutes away.
 *
 * It is torn down rather than left mounted and blank. The overlay is a live
 * WebView holding an open socket and compositing over every frame the device
 * draws; on a screen that spends most of its life showing art and video, leaving
 * it up would cost memory, a socket and GPU work around the clock for nothing.
 */
export class OverlayPlaySessionAnnouncer extends IPlaySessionAnnouncer {
  #overlay; #buildUrl; #logger;

  /**
   * @param {Object} config
   * @param {import('../ports/IPlayOverlay.mjs').IPlayOverlay} config.overlay
   * @param {(deviceId: string) => string} config.buildUrl
   */
  constructor({ overlay, buildUrl, logger = console }) {
    super();
    if (!overlay?.arm) throw new Error('OverlayPlaySessionAnnouncer requires an overlay port');
    if (typeof buildUrl !== 'function') throw new Error('OverlayPlaySessionAnnouncer requires buildUrl()');
    this.#overlay = overlay;
    this.#buildUrl = buildUrl;
    this.#logger = logger;
  }

  async started(session) {
    await this.#overlay.arm(session.deviceId, this.#buildUrl(session.deviceId));
  }

  /** Progress needs no overlay action — the film gets its data over the bus. */
  async progress() {}

  async ended(session) {
    await this.#overlay.disarm(session.deviceId);
  }

  /**
   * Re-assert "nothing is armed" for devices with no open session. A process
   * that died mid-session must not leave a film on the family television, and
   * recovery removes it actively rather than assuming it is absent.
   */
  async disarmIdle(deviceIds = []) {
    for (const deviceId of deviceIds) {
      try {
        await this.#overlay.disarm(deviceId);
      } catch (error) {
        this.#logger.warn?.('play.overlay.disarm_failed', { deviceId, error: error.message });
      }
    }
  }
}

export default OverlayPlaySessionAnnouncer;
