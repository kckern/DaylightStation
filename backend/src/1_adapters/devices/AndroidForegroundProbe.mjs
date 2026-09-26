// backend/src/1_adapters/devices/AndroidForegroundProbe.mjs

/**
 * Reads which screen an Android device has in front, and sends it home.
 *
 * `returnToKiosk` presses HOME rather than launching the kiosk by name: on a
 * kiosk device the kiosk IS the home app, so HOME lands there however it was
 * left — and it keeps working if the kiosk's activity name ever changes.
 */

/** `mResumedActivity: ActivityRecord{66e989c u0 de.ozerov.fully/.LauncherReplacement t10957}` */
const RESUMED = /mResumedActivity:\s*ActivityRecord\{\S+\s+u\d+\s+([^\s/]+)\/(\S+)/;

export function parseResumedActivity(output) {
  const match = RESUMED.exec(output || '');
  return match ? { package: match[1], activity: match[2] } : null;
}

export class AndroidForegroundProbe {
  #adb; #logger;

  constructor({ adbAdapter, logger = console }) {
    if (!adbAdapter?.shell) throw new Error('AndroidForegroundProbe requires an adbAdapter');
    this.#adb = adbAdapter;
    this.#logger = logger;
  }

  /** @returns {Promise<{package: string, activity: string}|null>} null when the device could not be asked */
  async foreground() {
    const result = await this.#adb.shell('dumpsys activity activities | grep mResumedActivity');
    if (!result?.ok) {
      this.#logger.debug?.('android.foreground.probe_failed', { error: result?.error });
      return null;
    }
    return parseResumedActivity(result.output);
  }

  async returnToKiosk() {
    return this.#adb.shell('input keyevent KEYCODE_HOME');
  }
}

export default AndroidForegroundProbe;
