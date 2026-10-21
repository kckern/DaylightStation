const refuse = (status, message) => { const error = new Error(message); error.status = status; throw error; };

/** The launch target's program name. Not `kind: 'bank'`: on the Portal that is a QUESTION bank. */
export const BANK_PROGRAM = 'economy-bank';

/**
 * OpenBankAtPanel — the coin bank's door on the wall panel (school economy
 * slice 1, C3). A child taps the coin button (or their own chip on the bank
 * strip), taps their face, and sees their own bank: balances, history, ways
 * to spend and ways to earn.
 *
 * THE SAME TRADE AS THE SHELF'S PANEL DOOR (`OpenBookShelfAtPanel`). A face
 * tap proves only that someone at the household's panel chose that face, so
 * the grant is minted short (`PANEL_BANK_GRANT_TTL_MS` in `app.mjs`) and
 * carries one learner.
 *
 * WHAT THE GRANT DOES AND DOES NOT GUARD. It is what SchoolApp mounts the bank
 * screen on: no grant, no screen. The bank DATA is read from
 * `GET /api/v1/economy/users/:id/bank`, which takes no grant today; this door
 * is the identity step that makes a kid open their OWN bank, not a lock on the
 * economy's read. A route that later wants to verify it has the issuer.
 *
 * TWO CHECKS, the shelf door's two:
 *
 * 1. The learner is on the CURRENT roster, so a stale id cannot mint anything.
 * 2. A School panel is configured (`resolveBookScanTarget`). Which screen the
 *    client names is not checked: it names its own screen, so that check was
 *    theatre on the shelf and was dropped there.
 *
 * It writes nothing and reads no coins.
 */
export class OpenBankAtPanel {
  #deps;
  constructor({ roster, grants, target, logger = {} }) {
    if (typeof roster !== 'function') throw new TypeError('OpenBankAtPanel requires a roster reader');
    if (typeof grants?.issue !== 'function') throw new TypeError('OpenBankAtPanel requires a bank grant issuer');
    this.#deps = { roster, grants, target, logger };
  }

  /**
   * @param {{screenId?: string, learnerId?: string}} request
   * @returns {Promise<{launchTarget: {kind: 'program', program: string, learnerId: string, bankGrant: string}}>}
   */
  async open({ screenId, learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) refuse(400, 'Choose whose bank to open.');
    if (!this.#deps.target) refuse(503, 'No School panel is configured. Ask a grown-up.');

    const roster = await this.#deps.roster();
    if (!Array.isArray(roster) || !roster.some((learner) => learner.id === learnerId)) {
      refuse(403, 'Choose a current School learner.');
    }

    const launchTarget = {
      kind: 'program',
      program: BANK_PROGRAM,
      learnerId,
      bankGrant: this.#deps.grants.issue({ learnerId }),
    };
    this.#deps.logger.info?.('school.bank.panel-opened', { screenId: screenId ?? null, learnerId });
    return { launchTarget };
  }
}

export default OpenBankAtPanel;
