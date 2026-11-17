// __backend/src/1_adapters/devices/DaylightAndroidForegroundProbe.mjs

/**
 * Reads which app a device on the DaylightStation Android kiosk app has in
 * front, and sends it back to the kiosk. Same interface as
 * AndroidForegroundProbe (`foreground()`, `returnToKiosk()`), which is what
 * AndroidExcursionGuard consumes; this one asks the app over its control API
 * where that one asks Android over ADB.
 *
 * Two things differ from the ADB probe:
 *
 *   - The guard recognises the kiosk by one package name. The app reports
 *     `kioskInForeground` itself, so when that is true this probe answers with
 *     the guard's kiosk package and the guard needs no second name.
 *   - The app reports the PACKAGE in front, not the activity, so `activity` is
 *     always empty. A guard policy that allows only some screens of a package
 *     (`allow: ['.accessories.']`) therefore matches nothing here, and the
 *     guard sends the device home as soon as it sees the excursion.
 *
 * Contract: ops:docs/superpowers/specs/2026-11-16-daylight-android-control-api.md
 */
export class DaylightAndroidForegroundProbe {
  #rest; #kioskPackage; #logger;

  /**
   * @param {Object} deps
   * @param {{get: Function, post: Function}} deps.restClient
   * @param {string} deps.kioskPackage - the name the guard knows the kiosk by
   */
  constructor({ restClient, kioskPackage, logger = console } = {}) {
    if (!restClient?.get || !restClient?.post) throw new Error('DaylightAndroidForegroundProbe requires a restClient');
    if (!kioskPackage) throw new Error('DaylightAndroidForegroundProbe requires kioskPackage');
    this.#rest = restClient;
    this.#kioskPackage = kioskPackage;
    this.#logger = logger;
  }

  /** @returns {Promise<{package: string, activity: string}|null>} null when the device could not be asked */
  async foreground() {
    const result = await this.#rest.get('/kiosk/status');
    if (!result?.ok) {
      this.#logger.debug?.('android.foreground.probe_failed', { error: result?.error });
      return null;
    }
    if (result.data?.kioskInForeground === true) return { package: this.#kioskPackage, activity: '' };
    const foreground = result.data?.foreground;
    return typeof foreground === 'string' && foreground ? { package: foreground, activity: '' } : null;
  }

  async returnToKiosk() {
    return this.#rest.post('/kiosk/foreground');
  }
}

export default DaylightAndroidForegroundProbe;
