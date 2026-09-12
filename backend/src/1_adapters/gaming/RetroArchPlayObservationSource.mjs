/**
 * Infers whether a console emulator is actually being played, by watching it
 * from outside. This is the only file in the play-session slice that knows
 * RetroArch exists; everything above it sees observations with a confidence.
 *
 * Two signals, because neither is sufficient alone:
 *
 *  - **Foreground app** (kiosk REST): the primary presence signal. It needs no
 *    ADB and survives a device reboot without re-authorisation, which matters
 *    because ADB-over-WiFi is the flakier channel of the two.
 *  - **Process CPU delta** (ADB): the confirmer. A misconfigured core once left
 *    the emulator foregrounded, alive, and burning zero CPU with no game
 *    loaded — foreground alone would have billed that as play. Measured on the
 *    living-room hardware, an emulating title burns ~15 CPU ticks/sec; paused,
 *    backgrounded or stuck reads exactly 0.
 *
 * CPU is sampled ACROSS polls rather than by sleeping inside one, so a tick
 * costs two cheap reads and no wall-clock delay.
 *
 * Debounce lives here, not in the use case: a momentary flicker in how we watch
 * a device is an artifact of the watching. While the emulator has slipped out of
 * foreground but not yet exceeded the tolerance, the honest answer is `unknown`
 * — which neither bills nor ends a session — and only a sustained absence is
 * reported as "nothing is loaded".
 *
 * KNOWN LIMIT: this source can confirm that *a* game is running, never *which*.
 * RetroArch exposes no queryable state (its network command interface is not
 * compiled into the Android build), so content identity comes from the launch we
 * issued and is echoed back, not discovered.
 */
import { IPlayObservationSource } from '#apps/gaming/ports/IPlayObservationSource.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const DEFAULT_POLL_MS = 10_000;
const DEFAULT_MISSES_BEFORE_GONE = 2;
// Emulating burns ~15 ticks/sec; anything at or below this is not running a game.
const IDLE_TICK_THRESHOLD = 2;

export class RetroArchPlayObservationSource extends IPlayObservationSource {
  #kiosk; #adb; #package; #pollIntervalMs; #missesBeforeGone; #logger;
  #cpu = new Map();     // deviceId -> { ticks, at }
  #misses = new Map();  // deviceId -> consecutive non-foreground observations

  constructor({
    kioskClient, adbAdapter = null, packageName,
    pollIntervalMs = DEFAULT_POLL_MS,
    missesBeforeGone = DEFAULT_MISSES_BEFORE_GONE,
    logger = console,
  }) {
    super();
    if (!kioskClient?.command) throw new Error('RetroArchPlayObservationSource requires a kiosk client');
    if (!packageName) throw new Error('RetroArchPlayObservationSource requires packageName');
    this.#kiosk = kioskClient;
    this.#adb = adbAdapter;
    this.#package = packageName;
    this.#pollIntervalMs = pollIntervalMs;
    this.#missesBeforeGone = missesBeforeGone;
    this.#logger = logger;
  }

  get confidenceMs() { return this.#pollIntervalMs; }

  async observe(deviceId, { expectedContent = null } = {}) {
    const observedAt = new Date().toISOString();
    const base = { observedAt, confidenceMs: this.#pollIntervalMs };

    const foreground = await this.#foregroundApp();
    if (foreground === null) {
      // Could not ask the device. Not "stopped" — we simply cannot see.
      this.#cpu.delete(deviceId);
      return { ...base, state: PlayState.UNKNOWN, content: null, channel: 'none' };
    }

    if (foreground !== this.#package) {
      const misses = (this.#misses.get(deviceId) || 0) + 1;
      this.#misses.set(deviceId, misses);
      this.#cpu.delete(deviceId);
      if (misses < this.#missesBeforeGone) {
        return { ...base, state: PlayState.UNKNOWN, content: null, channel: 'kiosk' };
      }
      // Sustained absence: nothing is loaded on this device.
      return { ...base, state: PlayState.PAUSED, content: null, channel: 'kiosk' };
    }

    this.#misses.set(deviceId, 0);

    const cpu = await this.#cpuTicks();
    if (cpu === null) {
      // ADB is gone. Foreground still says a game is up, so trust that, but say
      // plainly that play-versus-paused could not be confirmed.
      this.#cpu.delete(deviceId);
      return {
        ...base, state: PlayState.PLAYING, content: expectedContent,
        channel: 'kiosk', degraded: true,
      };
    }
    if (cpu.pid === null) {
      // Foreground is stale but the process is gone — definitively over.
      this.#cpu.delete(deviceId);
      return { ...base, state: PlayState.PAUSED, content: null, channel: 'adb' };
    }

    const previous = this.#cpu.get(deviceId);
    this.#cpu.set(deviceId, { ticks: cpu.ticks, at: Date.now(), pid: cpu.pid });

    // First sample after a (re)start, or after the process changed identity:
    // there is no delta to judge yet, so do not claim play.
    if (!previous || previous.pid !== cpu.pid) {
      return { ...base, state: PlayState.UNKNOWN, content: expectedContent, channel: 'adb' };
    }

    const delta = cpu.ticks - previous.ticks;
    const state = delta > IDLE_TICK_THRESHOLD ? PlayState.PLAYING : PlayState.PAUSED;
    return { ...base, state, content: expectedContent, channel: 'adb', cpuDelta: delta };
  }

  async #foregroundApp() {
    try {
      const result = await this.#kiosk.command('deviceInfo');
      if (!result?.ok) return null;
      const value = result.data?.foregroundApp;
      return typeof value === 'string' ? value : null;
    } catch (error) {
      this.#logger.debug?.('play.observe.kiosk_failed', { error: error.message });
      return null;
    }
  }

  /** utime+stime for the emulator process, or null when ADB cannot answer. */
  async #cpuTicks() {
    if (!this.#adb?.shell) return null;
    try {
      const pidResult = await this.#adb.shell(`pidof ${this.#package}`);
      if (!pidResult?.ok) return null;
      const pid = (pidResult.output || '').trim().split(/\s+/)[0];
      if (!pid) return { pid: null, ticks: 0 };

      const statResult = await this.#adb.shell(`cat /proc/${pid}/stat`);
      if (!statResult?.ok) return null;
      // utime and stime are fields 14 and 15 of /proc/<pid>/stat.
      const fields = (statResult.output || '').trim().split(/\s+/);
      const utime = Number(fields[13]);
      const stime = Number(fields[14]);
      if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
      return { pid, ticks: utime + stime };
    } catch (error) {
      this.#logger.debug?.('play.observe.adb_failed', { error: error.message });
      return null;
    }
  }
}

export default RetroArchPlayObservationSource;
