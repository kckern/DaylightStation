const refuse = (status, message) => { const error = new Error(message); error.status = status; throw error; };

/**
 * OpenBookShelfAtPanel — the reading shelf's second door.
 *
 * A child at the wall panel taps the reading icon, taps their own face, and
 * lands on the ISBN pad. No printed card, no six-digit code, no scanned book.
 * The first door (a printed access code) costs a thermal print and a
 * transcription; the second (`PrepareBookScan`) needs the book in hand. This
 * one asks for neither, because "I want to log a book I am holding" should not
 * begin with fetching a slip of paper.
 *
 * WHAT IT DELIBERATELY GIVES UP, AND WHAT PAYS FOR IT.
 *
 * The access-code path proves possession of paper the agenda printed, spends
 * one of twelve uses, throttles wrong guesses, and re-asks "is this you?" on
 * every open after the first. A face tap proves none of that: the roster is on
 * the screen and anyone standing there can tap any of it. So this door does
 * NOT get the ordinary eight-hour book grant. It takes its own issuer with a
 * short TTL (see `app.mjs`), which is the honest trade — the household's own
 * panel, in the household's own hallway, opening a reading log for as long as
 * a child is plausibly still standing at it, and no longer.
 *
 * TWO THINGS IT STILL CHECKS:
 *
 * 1. The learner is on the CURRENT roster — the same check `PrepareBookScan`
 *    applies after a scan, so a stale id in a client cannot mint anything.
 * 2. The screen is the household's one School panel, resolved server-side by
 *    `resolveBookScanTarget`. The client says which screen it is; the server
 *    decides whether that is a screen this door exists on.
 *
 * It writes nothing and reads no shelf. Its whole output is authority, and the
 * shelf routes verify that authority for themselves on every call.
 */
export class OpenBookShelfAtPanel {
  #deps;
  constructor({ roster, issueLaunchTarget, target, logger = {} }) {
    if (typeof roster !== 'function') throw new TypeError('OpenBookShelfAtPanel requires a roster reader');
    if (typeof issueLaunchTarget !== 'function') throw new TypeError('OpenBookShelfAtPanel requires a launch target issuer');
    this.#deps = { roster, issueLaunchTarget, target, logger };
  }

  /**
   * @param {{screenId?: string, learnerId?: string}} request
   * @returns {Promise<{launchTarget: object, bookEntry: null}>} `bookEntry` is
   *   null on purpose: no book was scanned, so the shelf opens at the pad with
   *   nothing seeded. The shelf's own seeding effect is gated on an `isbn13`,
   *   so null is the supported "the child will type it" case.
   */
  async open({ screenId, learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) refuse(400, 'Choose who is reading.');
    const target = this.#deps.target;
    if (!target) refuse(503, 'No reading panel is configured. Ask a grown-up.');
    if (screenId !== target.screenId) refuse(403, 'Books do not open from this screen.');

    const roster = await this.#deps.roster();
    if (!Array.isArray(roster) || !roster.some(learner => learner.id === learnerId)) {
      refuse(403, 'Choose a current School learner.');
    }

    const launchTarget = await this.#deps.issueLaunchTarget({ userId: learnerId });
    this.#deps.logger.info?.('school.book-shelf.panel-opened', { screenId });
    return { launchTarget, bookEntry: null };
  }
}

export default OpenBookShelfAtPanel;
