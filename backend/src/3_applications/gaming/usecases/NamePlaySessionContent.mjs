/**
 * Name a running session that opened without knowing what it was.
 *
 * The arcade is mostly used by walking up to it and starting a game at the
 * device, not by launching from the house menu. Play observed that way is real
 * and gets metered, but it opens with no title: the observer can see that *a*
 * game is running, never *which*.
 *
 * The device's own logs do know, and they are written as the game loads — so
 * the answer is usually available within seconds of play starting. Asking for
 * it while the session is still open is what lets the countdown know which
 * system it is drawing on, which in turn is what tells it where on the bezel it
 * is allowed to draw. Waiting for the next restart's reconciliation would mean
 * every hand-started game spends its whole life unplaceable.
 *
 * It only ever FILLS A BLANK — `attributeContent` refuses to overwrite — and it
 * never touches time. A wrong guess here costs a mislabelled record; it can
 * never cost or create billable minutes.
 */
export class NamePlaySessionContent {
  #sessions; #logReader; #resolveContent; #toleranceMs; #logger;

  /**
   * @param {Object} config
   * @param {number} [config.toleranceMs=120000] How far apart the device's idea
   *   of the start and ours may be and still be the same session. Wide enough
   *   to absorb clock skew and one observation interval, narrow enough that two
   *   games played back to back are never confused for each other.
   */
  constructor({ sessions, logReader, resolveContent, toleranceMs = 120_000, logger = console }) {
    this.#sessions = sessions;
    this.#logReader = logReader;
    this.#resolveContent = resolveContent;
    this.#toleranceMs = toleranceMs;
    this.#logger = logger;
  }

  /**
   * @param {Object} session The open, unidentified session (an entity).
   * @returns {Promise<{named: boolean, reason?: string, content?: Object}>}
   */
  async execute(session) {
    if (!session?.startedAt) return { named: false, reason: 'not started' };
    if (session.content?.contentId) return { named: false, reason: 'already named' };
    if (!this.#logReader || !this.#resolveContent) return { named: false, reason: 'no log source' };

    const entries = await this.#logReader.listRecentSessions({ limit: 10 });
    const entry = this.#closest(entries, session.startedAt);
    if (!entry?.contentPath) return { named: false, reason: 'no device log near this session' };

    const content = this.#resolveContent(entry.contentPath);
    if (!content) {
      // The device played something the catalog does not list. Worth saying —
      // it means a ROM is on the device that the launcher does not know about.
      this.#logger.info?.('play.session.unknown_content', {
        sessionId: session.id, contentPath: entry.contentPath,
      });
      return { named: false, reason: 'content not in catalog' };
    }

    const outcome = session.attributeContent(content);
    if (!outcome.attributed) return { named: false, reason: outcome.reason };

    await this.#sessions.save(session);
    this.#logger.info?.('play.session.named', {
      sessionId: session.id,
      contentId: content.contentId,
      system: content.console ?? null,
    });
    return { named: true, content };
  }

  #closest(entries, startedAt) {
    const target = Date.parse(startedAt);
    let best = null;
    let bestDelta = Infinity;
    for (const entry of entries || []) {
      const delta = Math.abs(Date.parse(entry.startedAt || 0) - target);
      if (delta < bestDelta) { bestDelta = delta; best = entry; }
    }
    return bestDelta <= this.#toleranceMs ? best : null;
  }
}

export default NamePlaySessionContent;
