/**
 * Compare what the device recorded against what we observed, after a blind spot.
 *
 * What this deliberately does NOT do is invent time. The device's own session
 * logs give an exact start and the content that was loaded, but measurement
 * showed they cannot give an end (median write-span 28s; 59% of sessions stop
 * writing within a minute). So a session we never saw is reported as a gap with
 * a known beginning and an unknown duration — never as a settled figure, and
 * never as billable minutes conjured from a timestamp.
 *
 * Two useful things it CAN do:
 *
 *  1. **Surface unrecorded sessions.** The device says a game started at 16:20;
 *     we have no session for it. That is a hole in the meter and it should be
 *     loud, because a silent hole is how a meter drifts without anyone noticing.
 *  2. **Repair attribution.** A session observed while its launch intent had
 *     expired knows it was playing but not what. The log knows. Filling that in
 *     costs nothing and makes the history answerable.
 */
export class ReconcilePlaySessions {
  #sessions; #logReader; #resolveContent; #matchToleranceMs; #logger;

  constructor({ sessions, logReader, resolveContent = null, matchToleranceMs = 120_000, logger = console }) {
    if (!sessions) throw new Error('ReconcilePlaySessions requires a sessions repository');
    if (!logReader?.listRecentSessions) throw new Error('ReconcilePlaySessions requires a logReader');
    this.#sessions = sessions;
    this.#logReader = logReader;
    this.#resolveContent = resolveContent;
    this.#matchToleranceMs = matchToleranceMs;
    this.#logger = logger;
  }

  /**
   * @param {Object} input
   * @param {string} input.deviceId
   * @param {string} input.since   Only consider device sessions starting at/after this.
   */
  async execute({ deviceId, since }) {
    const result = { matched: [], unrecorded: [], enriched: [] };

    const recorded = await this.#sessions.listForDeviceSince(deviceId, since);
    const onDevice = (await this.#logReader.listRecentSessions({ limit: 40 }))
      .filter((entry) => Date.parse(entry.startedAt) >= Date.parse(since));

    for (const entry of onDevice) {
      const match = this.#closest(recorded, entry.startedAt);
      if (!match) {
        result.unrecorded.push({
          startedAt: entry.startedAt,
          contentPath: entry.contentPath,
          content: this.#resolve(entry.contentPath),
        });
        // Loud on purpose: the device played something the meter never saw.
        this.#logger.warn?.('play.session.unrecorded', {
          deviceId, startedAt: entry.startedAt, contentPath: entry.contentPath,
          note: 'device logged a session with no corresponding record; duration unknown and NOT billed',
        });
        continue;
      }

      result.matched.push(match.id);

      if (!match.content?.contentId && entry.contentPath) {
        const content = this.#resolve(entry.contentPath);
        if (content) {
          result.enriched.push({ sessionId: match.id, content });
          this.#logger.info?.('play.session.attribution_repaired', {
            deviceId, sessionId: match.id, contentId: content.contentId,
          });
        }
      }
    }

    return result;
  }

  #closest(recorded, startedAt) {
    const target = Date.parse(startedAt);
    let best = null;
    let bestDelta = Infinity;
    for (const session of recorded) {
      const delta = Math.abs(Date.parse(session.startedAt || 0) - target);
      if (delta < bestDelta) { bestDelta = delta; best = session; }
    }
    return bestDelta <= this.#matchToleranceMs ? best : null;
  }

  #resolve(contentPath) {
    if (!contentPath || !this.#resolveContent) return null;
    try {
      return this.#resolveContent(contentPath) || null;
    } catch (error) {
      this.#logger.debug?.('play.reconcile.resolve_failed', { contentPath, error: error.message });
      return null;
    }
  }
}

export default ReconcilePlaySessions;
