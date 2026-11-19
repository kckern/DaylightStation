/**
 * The DaylightStation Android kiosk app, seen through the kiosk-client shape
 * the arcade adapters already use: `command(name, params) -> { ok, data }`.
 *
 * The arcade's observation source, terminator and speaker were written against
 * Fully's REST client and call three of its commands. This client answers
 * those three from the app's control API, so the same adapters serve a device
 * on either provider:
 *
 *   deviceInfo    -> GET  /lockdown         (what is in front)
 *   toForeground  -> POST /kiosk/foreground (return to the kiosk)
 *   textToSpeech  -> POST /speak
 *
 * Every other command answers UNSUPPORTED without a request. That includes the
 * settings the Fully overlay driver writes (`webOverlayUrl`): on this app the
 * countdown film goes through `showWebOverlay` / `clearOverlay` below
 * (`POST /kiosk/overlay`), driven by DaylightAndroidArcadeGameOverlay.
 *
 * Contract: ops:docs/superpowers/specs/2026-11-16-daylight-android-control-api.md
 * ("Arcade overlay and supervision").
 */
export class DaylightAndroidArcadeKioskClient {
  #rest;

  /** @param {{restClient: {get: Function, post: Function}}} deps */
  constructor({ restClient } = {}) {
    if (!restClient?.get || !restClient?.post) {
      throw new Error('DaylightAndroidArcadeKioskClient requires restClient');
    }
    this.#rest = restClient;
  }

  /** Marks the client for the composition, which picks the overlay driver by it. */
  get provider() { return 'daylight-android'; }

  /** Draw `url` as the non-interactive web overlay; `gravity` is `top` or `bottom`. */
  showWebOverlay(url, gravity) {
    return this.#rest.post('/kiosk/overlay', { url, ...(gravity ? { gravity } : {}) });
  }

  /**
   * Clear the web overlay. Safe when none is showing. The text message is a
   * separate layer and is left alone: `{url:''}` clears only the web layer.
   */
  clearOverlay() {
    return this.#rest.post('/kiosk/overlay', { url: '' });
  }

  async command(name, params = {}) {
    if (name === 'deviceInfo' || name === 'getDeviceInfo') {
      const result = await this.#rest.get('/lockdown');
      if (!result?.ok) return result;
      const foreground = typeof result.data?.foreground === 'string' ? result.data.foreground : null;
      // `foregroundApp` is the name Fully's deviceInfo uses and the arcade reads.
      return { ok: true, data: { ...result.data, foreground, foregroundApp: foreground } };
    }
    if (name === 'toForeground') return this.#rest.post('/kiosk/foreground');
    if (name === 'textToSpeech') {
      return this.#rest.post('/speak', {
        text: params.text,
        ...(params.locale ? { locale: params.locale } : {}),
      });
    }
    return { ok: false, code: 'UNSUPPORTED', error: `The Android kiosk app has no equivalent of ${name}` };
  }
}

export default DaylightAndroidArcadeKioskClient;
