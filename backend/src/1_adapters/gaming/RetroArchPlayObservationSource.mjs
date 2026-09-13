/**
 * Infers whether a console emulator is actually being played, by watching it
 * from outside. This is the only file in the play-session slice that knows
 * RetroArch exists; everything above it sees observations with a confidence.
 *
 * Two signals, because neither is sufficient alone:
 *
 *  - **Foreground app** (kiosk REST): the primary presence signal. It needs no
 *    ADB and survives a device reboot without re-authorisation, which matters
 *    because ADB-over-WiFi is the flakier channel of the two. If REST is down,
 *    the focused Android activity supplies the same presence gate over ADB.
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
 * RetroArch exposes no queryable command interface in the Android build. Load
 * identity therefore comes from its per-session log (preferred) or the launch
 * intent we recorded, never from a fictional remote status API.
 */
import { IPlayObservationSource } from '#apps/gaming/ports/IPlayObservationSource.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const DEFAULT_POLL_MS = 10_000;
const DEFAULT_MISSES_BEFORE_GONE = 2;
// Emulating burns ~15 ticks/sec; anything at or below this is not running a game.
const IDLE_TICK_THRESHOLD = 2;

export class RetroArchPlayObservationSource extends IPlayObservationSource {
  #kiosk; #adb; #package; #pollIntervalMs; #missesBeforeGone; #logger; #logs; #resolveContent;
  #cpu = new Map();     // deviceId -> { ticks, at }
  #misses = new Map();  // deviceId -> consecutive non-foreground observations
  #warnedMismatches = new Set();

  constructor({
    kioskClient, adbAdapter = null, packageName,
    logReader = null, resolveContent = null,
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
    this.#logs = logReader;
    this.#resolveContent = typeof resolveContent === 'function' ? resolveContent : null;
    this.#pollIntervalMs = pollIntervalMs;
    this.#missesBeforeGone = missesBeforeGone;
    this.#logger = logger;
  }

  get confidenceMs() { return this.#pollIntervalMs; }

  async observe(deviceId, { expectedContent = null } = {}) {
    const observedAt = new Date().toISOString();
    const base = { observedAt, confidenceMs: this.#pollIntervalMs };

    let foreground = await this.#foregroundApp();
    let presenceChannel = 'kiosk';
    if (foreground === null) {
      // REST is the reboot-stable primary, not a single point of failure. ADB's
      // focused activity is an independent presence signal and keeps the meter
      // alive through a Fully Kiosk API outage.
      const focused = await this.#focusedApp();
      if (!focused.available) {
        this.#cpu.delete(deviceId);
        return { ...base, state: PlayState.UNKNOWN, loaded: null, content: null, channel: 'none' };
      }
      foreground = focused.app;
      presenceChannel = 'adb';
    }

    if (foreground !== this.#package) {
      const misses = (this.#misses.get(deviceId) || 0) + 1;
      this.#misses.set(deviceId, misses);
      this.#cpu.delete(deviceId);
      if (misses < this.#missesBeforeGone) {
        return { ...base, state: PlayState.UNKNOWN, loaded: null, content: null, channel: presenceChannel };
      }
      // Sustained absence: nothing is loaded on this device.
      return { ...base, state: PlayState.PAUSED, loaded: false, content: null, channel: presenceChannel };
    }

    this.#misses.set(deviceId, 0);
    const identity = await this.#currentIdentity(expectedContent);

    const cpu = await this.#cpuTicks();
    if (cpu === null) {
      // With kiosk presence we can degrade to foreground-only. If ADB was also
      // the presence source, losing its CPU read leaves no independent proof of
      // play — loaded remains plausible, but time does not accrue.
      this.#cpu.delete(deviceId);
      if (presenceChannel === 'adb') {
        return {
          ...base, ...identity, state: PlayState.UNKNOWN, loaded: true,
          channel: 'adb', degraded: true,
        };
      }
      return {
        ...base, ...identity, state: PlayState.PLAYING, loaded: true,
        channel: 'kiosk', degraded: true,
      };
    }
    if (cpu.pid === null) {
      // Foreground is stale but the process is gone — definitively over.
      this.#cpu.delete(deviceId);
      return { ...base, state: PlayState.PAUSED, loaded: false, content: null, channel: 'adb' };
    }

    const previous = this.#cpu.get(deviceId);
    this.#cpu.set(deviceId, { ticks: cpu.ticks, at: Date.now(), pid: cpu.pid });

    // First sample after a (re)start, or after the process changed identity:
    // there is no delta to judge yet, so do not claim play.
    if (!previous || previous.pid !== cpu.pid) {
      return { ...base, ...identity, state: PlayState.UNKNOWN, loaded: true, channel: 'adb' };
    }

    const delta = cpu.ticks - previous.ticks;
    const state = delta > IDLE_TICK_THRESHOLD ? PlayState.PLAYING : PlayState.PAUSED;
    return { ...base, ...identity, state, loaded: true, channel: 'adb', cpuDelta: delta };
  }

  async #currentIdentity(expectedContent) {
    if (!this.#logs?.readCurrentSession) {
      return { loadId: null, loadedAt: null, content: expectedContent };
    }
    const current = await this.#logs.readCurrentSession();
    if (!current) return { loadId: null, loadedAt: null, content: expectedContent };

    const content = current.contentPath && this.#resolveContent
      ? this.#resolveContent(current.contentPath)
      : null;
    if (expectedContent?.contentId && expectedContent.contentId !== content?.contentId
        && !this.#warnedMismatches.has(current.file)) {
      this.#warnedMismatches.add(current.file);
      this.#logger.warn?.('play.content.intent_mismatch', {
        loadId: current.file,
        expectedContentId: expectedContent.contentId,
        observedContentId: content?.contentId ?? null,
        contentPath: current.contentPath ?? null,
      });
    }
    return {
      loadId: current.file,
      loadedAt: current.startedAt,
      content,
      contentPath: current.contentPath ?? null,
      corePath: current.corePath ?? null,
    };
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

  /** Focused package from Android's window service, or unavailable. */
  async #focusedApp() {
    if (!this.#adb?.shell) return { available: false, app: null };
    try {
      const result = await this.#adb.shell('dumpsys window');
      if (!result?.ok) return { available: false, app: null };
      // Shield TV may report mCurrentFocus=null while asleep but retain a
      // useful mFocusedApp ActivityRecord. Accept either real package shape.
      const match = /m(?:CurrentFocus|FocusedApp)=[^\n]*\su\d+\s+([A-Za-z0-9_.$]+)\//m.exec(result.output || '');
      return { available: true, app: match?.[1] ?? null };
    } catch (error) {
      this.#logger.debug?.('play.observe.adb_focus_failed', { error: error.message });
      return { available: false, app: null };
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
