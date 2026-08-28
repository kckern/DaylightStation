/**
 * A progress report in, a VERDICT out.
 *
 * The response is the only thing standing between a child and their finish
 * code, so it says outright whether the companion is satisfied, what the code
 * is, and how many parts are still outstanding — rather than acknowledging the
 * write and leaving the caller to infer the rest. The caller cannot infer it:
 * the letters live in the household's code record, and the frontend's own
 * belief that playback ended is exactly the signal that lies (see
 * `LessonCompanionHandlers`).
 *
 * WHY THE PAYLOAD IS AN ALLOWLIST AND NOT A SPREAD. The router hands this
 * `{id, ...req.body}` — a browser-authored object, straight off the wire. Only
 * these fields mean anything to a handler, so only these are forwarded; a body
 * cannot reach past this line to set anything else. Adding a field to the
 * companion protocol means adding it HERE, on purpose, which is also the one
 * place to read the wire contract off.
 *
 * @returns {Promise<{ok: boolean, tracked: boolean, satisfied?: boolean,
 *                    code?: string[]|null, remainingParts?: number}>}
 */
export class RecordLessonCompanionProgress {
  #companions; #handlers;
  constructor({ companions, handlers } = {}) {
    if (!companions) throw new Error('RecordLessonCompanionProgress requires companions');
    if (!handlers) throw new Error('RecordLessonCompanionProgress requires handlers');
    this.#companions = companions; this.#handlers = handlers;
  }

  /**
   * @param {object} args
   * @param {string} args.id the companion offer id
   * @param {string} [args.partId] which playlist part this report is about
   * @param {number} [args.positionSeconds] where the player is — telemetry, NOT evidence
   * @param {number} [args.durationSeconds] the part's full length
   * @param {boolean} [args.completed] the player said it ended — telemetry, NOT evidence
   * @param {Array<[number, number]>} [args.playedRanges] what the media element
   *   reports it actually rendered. This is the evidence, and the only thing a
   *   dead stream cannot produce.
   * @param {number} [args.maxRate] the fastest playback rate seen during it
   */
  async execute({
    id, partId, positionSeconds, durationSeconds, completed, playedRanges, maxRate,
  } = {}) {
    const offer = await this.#companions.get(id);
    if (!offer) return { ok: false, tracked: false };
    return this.#handlers.recordProgress({
      offer,
      payload: { partId, positionSeconds, durationSeconds, completed, playedRanges, maxRate },
    });
  }
}

export default RecordLessonCompanionProgress;
