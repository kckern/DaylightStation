// __backend/src/1_adapters/devices/DaylightAndroidForegroundProbe.mjs

/**
 * Reads which app a device on the DaylightStation Android kiosk app has in
 * front, and sends it back to the kiosk. Same interface as
 * AndroidForegroundProbe (`foreground()`, `returnToKiosk()`), which is what
 * AndroidExcursionGuard consumes; this one asks the app over its control API
 * where that one asks Android over ADB.
 *
 * It polls `GET /lockdown`, which the app keeps cheap to read.
 *
 * Two things to know beside the ADB probe:
 *
 *   - The guard recognises the kiosk by one package name. The app reports
 *     `kioskInForeground` itself, so when that is true this probe answers with
 *     the guard's kiosk package and the guard needs no second name.
 *   - The app reports the resumed activity as `foregroundActivity`, or null
 *     when it does not know it. The ADB probe answers null when it cannot read
 *     the resumed activity, which the guard counts as a failed probe and does
 *     not act on; this probe does the same, so a screen-level policy
 *     (`allow: ['.accessories.']`) is never judged on a missing activity.
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
    const result = await this.#rest.get('/lockdown');
    if (!result?.ok) {
      this.#logger.debug?.('android.foreground.probe_failed', { error: result?.error });
      return null;
    }
    const { foreground, foregroundActivity, kioskInForeground } = result.data || {};
    const activity = typeof foregroundActivity === 'string' ? foregroundActivity : '';
    if (kioskInForeground === true) return { package: this.#kioskPackage, activity };
    if (typeof foreground !== 'string' || !foreground || !activity) {
      this.#logger.debug?.('android.foreground.probe_failed', {
        error: foreground ? 'activity in front is unknown' : 'no foreground reported',
      });
      return null;
    }
    return { package: foreground, activity };
  }

  async returnToKiosk() {
    return this.#rest.post('/kiosk/foreground');
  }
}

export default DaylightAndroidForegroundProbe;
