import { IArcadeGameTerminator } from "../../application/ports/IArcadeGameTerminator.mjs";

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
export class KioskArcadeGameTerminator extends IArcadeGameTerminator {
  #pendingStops=new Map(); #adbByDevice; #kioskByDevice; #packageName; #logger;

  constructor({ adbByDevice, kioskByDevice, packageName, logger = console }) {
    super();
    if (typeof packageName!=='string' || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName)) throw new Error('KioskArcadeGameTerminator requires a valid Android packageName');
    this.#adbByDevice = adbByDevice || new Map();
    this.#kioskByDevice = kioskByDevice || new Map();
    this.#packageName = packageName;
    this.#logger = logger;
  }

  stop({deviceId}) {
    const pending=this.#stopAndVerify(deviceId);
    const jobs=this.#pendingStops.get(deviceId)??new Set();jobs.add(pending);this.#pendingStops.set(deviceId,jobs);
    void pending.finally(()=>{jobs.delete(pending);if(!jobs.size && this.#pendingStops.get(deviceId)===jobs)this.#pendingStops.delete(deviceId);}).catch(()=>{});
    return pending;
  }
  async release({deviceId}) {
    // Never acknowledge release ahead of a previously admitted package kill.
    for(;;){const pending=this.#pendingStops.get(deviceId);if(!pending?.size)break;await Promise.allSettled([...pending]);}
    await this.#probeInstalled(deviceId);
    return {blocked:false,detail:'Released; content remains stopped'};
  }
  async #probeInstalled(deviceId){
    const adb=this.#adbByDevice.get(deviceId);
    if(!adb?.shell)throw Object.assign(new Error('Native enforcement channel unavailable'),{code:'CAPABILITY_UNAVAILABLE'});
    const result=await adb.shell(`pm path ${this.#packageName}`);
    if(result?.ok && result.output?.trim().startsWith('package:'))return {hidden:false};
    const installed=await adb.shell(`pm list packages -u ${this.#packageName}`);
    if(installed?.ok && installed.output?.split(/\r?\n/).some(line=>line.trim()===`package:${this.#packageName}`))return {hidden:true};
    throw Object.assign(new Error('Required native package cannot be verified'),{code:'NATIVE_PACKAGE_UNAVAILABLE',contacted:result?.ok===true});
  }
  async #stopAndVerify(deviceId) {
    const installed=await this.#probeInstalled(deviceId);
    if(installed.hidden){
      const status=await this.#adbByDevice.get(deviceId).shell(`if pidof ${this.#packageName} >/dev/null; then printf running; else printf stopped; fi`);
      return {blocked:status.ok && status.output?.trim()==='stopped',detail:'Local package restriction; process state checked'};
    }
    const result=await this.endPlay(deviceId);
    if(!result.ok)return {blocked:false,detail:result.error};
    const adb=this.#adbByDevice.get(deviceId);
    const status=await adb.shell(`if pidof ${this.#packageName} >/dev/null; then printf running; else printf stopped; fi`);
    return {blocked:status.ok && status.output?.trim()==='stopped',detail:status.ok?'Force-stop checked; unsaved progress may be lost':'Native process state unverified'};
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
      this.#logger.error?.('arcade.terminate.failed', { deviceId, error: error.message });
      return { ok: false, error: error.message };
    }
    if (!stopped?.ok) {
      this.#logger.error?.('arcade.terminate.failed', { deviceId, error: stopped?.error });
      return { ok: false, error: stopped?.error || 'force-stop failed' };
    }

    this.#logger.warn?.('arcade.terminated', {
      deviceId, package: this.#packageName,
      note: 'force-stop is a kill — unsaved in-game progress is lost by design',
    });

    // Best effort: the game is already stopped either way.
    const kiosk = this.#kioskByDevice.get(deviceId);
    if (kiosk?.command) {
      try {
        await kiosk.command('toForeground');
      } catch (error) {
        this.#logger.warn?.('arcade.terminate.kiosk_restore_failed', { deviceId, error: error.message });
      }
    }
    return { ok: true };
  }
}

export default KioskArcadeGameTerminator;
