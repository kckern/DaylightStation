import { summariseUsage, formatDuration } from '#domains/gaming/services/playUsage.mjs';

/**
 * Reads the usage ledger for a window and rolls it up.
 *
 * The monitoring surface: who played, what, for how long, on which day, across
 * every device. It exists so usage can be WATCHED before any policy is written
 * against it — you cannot set a sensible limit on a number you have never seen.
 */
export class SummarisePlayUsage {
  #sessions; #logger;

  constructor({ sessions, logger = console }) {
    if (!sessions?.listSince) throw new Error('SummarisePlayUsage requires a sessions repository with listSince');
    this.#sessions = sessions;
    this.#logger = logger;
  }

  async execute({ since, until = null }) {
    const found = await this.#sessions.listSince(since, until);
    const summary = summariseUsage(
      found.map((s) => (typeof s?.toSnapshot === 'function' ? s.toSnapshot() : s)),
    );
    return {
      since,
      until: until || new Date().toISOString(),
      totalPlayed: formatDuration(summary.totalPlayedMs),
      ...summary,
    };
  }
}

export default SummarisePlayUsage;
