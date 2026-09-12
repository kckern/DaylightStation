/**
 * Reads the emulator's own per-session log files off the device.
 *
 * This is the recovery channel: when live observation was blind, the device
 * still wrote down what happened. It is the second file that may name RetroArch.
 *
 * WHAT IT CAN ANSWER — and the limits are measured, not assumed:
 *
 *  - **When a session started.** The filename carries the start timestamp
 *    exactly. Reliable.
 *  - **What was played.** The body records the content path and the core, which
 *    is the identity the Android build's missing command interface would have
 *    provided. This is the difference between "a game ran" and "this game ran",
 *    so attribution can be confirmed or corrected after the fact.
 *
 * WHAT IT CANNOT ANSWER: when a session ended. Measured across 425 session logs
 * on the living-room device, the median span from start to last write is 28
 * seconds and 59% of sessions stop writing within a minute — logging is
 * dominated by startup, and steady play writes only sporadically. A session that
 * ran ten minutes routinely shows a three-second write span. `lastWriteAt` is
 * therefore returned as a LOWER BOUND on activity and must never be treated as
 * an end time.
 *
 * Kept to two shell round-trips: one listing pass, one read pass.
 */

const CONTENT_LINE = /Loading content file:\s*"([^"]+)"/;
const CORE_LINE = /Loading dynamic libretro core from:\s*"([^"]+)"/;
const FILENAME = /retroarch__(\d{4})_(\d{2})_(\d{2})__(\d{2})_(\d{2})_(\d{2})\.log$/;

export class RetroArchSessionLogReader {
  #adb; #logDir; #logger;

  constructor({ adbAdapter, logDir, logger = console }) {
    if (!adbAdapter?.shell) throw new Error('RetroArchSessionLogReader requires an adbAdapter');
    if (!logDir) throw new Error('RetroArchSessionLogReader requires logDir');
    this.#adb = adbAdapter;
    this.#logDir = logDir;
    this.#logger = logger;
  }

  /**
   * Most recent sessions the device recorded, oldest first.
   * @param {Object} [opts]
   * @param {number} [opts.limit=20] How many of the newest logs to inspect.
   * @returns {Promise<Array<{startedAt: string, lastWriteAt: string|null,
   *   contentPath: string|null, corePath: string|null, file: string}>>}
   */
  async listRecentSessions({ limit = 20 } = {}) {
    const names = await this.#listNames(limit);
    if (names.length === 0) return [];

    const [mtimes, content, cores] = await Promise.all([
      this.#statMtimes(names),
      this.#grepField(names, 'Loading content file', CONTENT_LINE),
      this.#grepField(names, 'Loading dynamic libretro core', CORE_LINE),
    ]);

    return names
      .map((file) => {
        const startedAt = this.#startFromName(file);
        if (!startedAt) return null;
        return {
          file,
          startedAt,
          // LOWER BOUND on activity. Never an end time — see the header.
          lastWriteAt: mtimes.get(file) ?? null,
          contentPath: content.get(file) ?? null,
          corePath: cores.get(file) ?? null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  #startFromName(file) {
    const m = FILENAME.exec(file);
    if (!m) return null;
    const [, y, mo, d, h, mi, sec] = m;
    // The device writes local time; the reader keeps it as a local wall-clock
    // instant rather than pretending to know the offset.
    return `${y}-${mo}-${d}T${h}:${mi}:${sec}`;
  }

  async #listNames(limit) {
    const result = await this.#run(`cd ${this.#quote(this.#logDir)} && ls -1 *.log 2>/dev/null | sort | tail -n ${Number(limit) || 20}`);
    if (!result) return [];
    return result.split('\n').map((l) => l.trim()).filter((l) => FILENAME.test(l));
  }

  async #statMtimes(names) {
    const out = new Map();
    const result = await this.#run(`cd ${this.#quote(this.#logDir)} && stat -c '%Y %n' ${names.join(' ')} 2>/dev/null`);
    for (const line of (result || '').split('\n')) {
      const [epoch, ...rest] = line.trim().split(/\s+/);
      const name = rest.join(' ');
      const seconds = Number(epoch);
      if (name && Number.isFinite(seconds)) out.set(name, new Date(seconds * 1000).toISOString());
    }
    return out;
  }

  async #grepField(names, needle, pattern) {
    const out = new Map();
    const result = await this.#run(`cd ${this.#quote(this.#logDir)} && grep -m1 -H ${this.#quote(needle)} ${names.join(' ')} 2>/dev/null`);
    for (const line of (result || '').split('\n')) {
      const sep = line.indexOf(':');
      if (sep < 0) continue;
      const file = line.slice(0, sep).trim();
      const match = pattern.exec(line.slice(sep + 1));
      if (file && match) out.set(file, match[1]);
    }
    return out;
  }

  async #run(command) {
    try {
      const result = await this.#adb.shell(command);
      if (!result?.ok) {
        this.#logger.debug?.('play.logreader.shell_failed', { error: result?.error });
        return null;
      }
      return result.output || '';
    } catch (error) {
      this.#logger.debug?.('play.logreader.shell_threw', { error: error.message });
      return null;
    }
  }

  #quote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
}

export default RetroArchSessionLogReader;
