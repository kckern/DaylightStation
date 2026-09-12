import { IPlayTerminator } from '#apps/gaming/ports/IPlayTerminator.mjs';

/**
 * Stops the emulator and brings the kiosk back.
 *
 * Force-stopping is a kill: the emulator's auto-savestate does NOT run, so
 * anything the player had not saved is gone. Battery saves are bounded by the
 * emulator's own SRAM autosave interval; in-game savestate progress is not.
 * That is why the warning ladder is a hard requirement upstream and not a
 * courtesy.
 *
 * The kiosk is brought forward afterwards so the screen lands somewhere sensible
 * rather than on whatever the launcher happens to show. Failing to do so is
 * reported but does not make the stop a failure — the game is already stopped,
 * and reporting otherwise would invite a retry that kills nothing twice.
 */
export class KioskPlayTerminator extends IPlayTerminator {
  #adbByDevice; #kioskByDevice; #packageName; #logger;

  constructor({ adbByDevice, kioskByDevice, packageName, logger = console }) {
    super();
    if (!packageName) throw new Error('KioskPlayTerminator requires packageName');
    this.#adbByDevice = adbByDevice || new Map();
    this.#kioskByDevice = kioskByDevice || new Map();
    this.#packageName = packageName;
    this.#logger = logger;
  }

  async endPlay(deviceId) {
    const adb = this.#adbByDevice.get(deviceId);
    if (!adb?.shell) {
      return { ok: false, error: 'no ADB channel for this device' };
    }

    let stopped;
    try {
      stopped = await adb.shell(`am force-stop ${this.#packageName}`);
    } catch (error) {
      this.#logger.error?.('play.terminate.failed', { deviceId, error: error.message });
      return { ok: false, error: error.message };
    }
    if (!stopped?.ok) {
      this.#logger.error?.('play.terminate.failed', { deviceId, error: stopped?.error });
      return { ok: false, error: stopped?.error || 'force-stop failed' };
    }

    this.#logger.warn?.('play.terminated', {
      deviceId, package: this.#packageName,
      note: 'force-stop is a kill — unsaved in-game progress is lost by design',
    });

    // Best effort: the game is already stopped either way.
    const kiosk = this.#kioskByDevice.get(deviceId);
    if (kiosk?.command) {
      try {
        await kiosk.command('toForeground');
      } catch (error) {
        this.#logger.warn?.('play.terminate.kiosk_restore_failed', { deviceId, error: error.message });
      }
    }
    return { ok: true };
  }
}

export default KioskPlayTerminator;
