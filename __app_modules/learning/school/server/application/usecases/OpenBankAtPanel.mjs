const refuse = (status, message) => { const error = new Error(message); error.status = status; throw error; };

/** The launch target's program name. Not `kind: 'bank'`: on the Portal that is a QUESTION bank. */
export const BANK_PROGRAM = 'economy-bank';

/**
 * OpenBankAtPanel — the coin bank's door on the wall panel (school economy
 * slice 1, C3). A child taps the coin button (or their own chip on the bank
 * strip), taps their face, and sees their own bank: balances, history, ways
 * to spend and ways to earn.
 *
 * THE DOOR IS THE ROSTER CHECK PLUS THE FACE TAP, AND NOTHING ELSE. It mints
 * no grant. The bank data is read from `GET /api/v1/economy/users/:id/bank`,
 * which is unauthenticated in slice 1 (decided): anyone at the panel could
 * read any kid's bank, and a grant here would only imply a protection that
 * does not exist. What the door does is make the ordinary path a kid opening
 * their OWN bank, by tapping their own face.
 *
 * TWO CHECKS, the shelf door's two (`OpenBookShelfAtPanel`):
 *
 * 1. The learner is on the CURRENT roster, so a stale id opens nothing.
 * 2. A School panel is configured (`resolveBookScanTarget`). Which screen the
 *    client names is not checked: it names its own screen, so that check was
 *    theatre on the shelf and was dropped there.
 *
 * It writes nothing and reads no coins.
 */
export class OpenBankAtPanel {
  #deps;
  constructor({ roster, target, logger = {} }) {
    if (typeof roster !== 'function') throw new TypeError('OpenBankAtPanel requires a roster reader');
    this.#deps = { roster, target, logger };
  }

  /**
   * @param {{screenId?: string, learnerId?: string}} request
   * @returns {Promise<{launchTarget: {kind: 'program', program: string, learnerId: string}}>}
   */
  async open({ screenId, learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) refuse(400, 'Choose whose bank to open.');
    if (!this.#deps.target) refuse(503, 'No School panel is configured. Ask a grown-up.');

    const roster = await this.#deps.roster();
    if (!Array.isArray(roster) || !roster.some((learner) => learner.id === learnerId)) {
      refuse(403, 'Choose a current School learner.');
    }

    this.#deps.logger.info?.('school.bank.panel-opened', { screenId: screenId ?? null, learnerId });
    return { launchTarget: { kind: 'program', program: BANK_PROGRAM, learnerId } };
  }
}

export default OpenBankAtPanel;
