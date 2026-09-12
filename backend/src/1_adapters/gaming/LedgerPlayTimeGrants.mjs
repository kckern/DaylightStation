import { IPlayTimeGrant } from '#apps/gaming/ports/IPlayTimeGrant.mjs';

/**
 * Answers how long a session may play, from granted time on the ledger.
 *
 * Adults are handled first and play without a ceiling — that is what makes
 * shared family play work without anyone tallying a couch.
 *
 * For everyone else the answer is the fold of today's grants. Where that time
 * CAME FROM is none of this adapter's business: a parent granting twenty minutes
 * directly and the economy converting tokens into minutes both write the same
 * kind of entry. Pricing, exchange rates and weekday rules stay on the far side
 * of the ledger, which is the whole point of the boundary.
 *
 * A child with no entries gets `null` — NO grant — rather than zero. Zero would
 * expire instantly and stop a game the moment it started; null means nothing is
 * metered for them yet, which is the honest state until someone grants time.
 */
export class LedgerPlayTimeGrants extends IPlayTimeGrant {
  #ledger; #isAdmin; #today; #logger;

  constructor({ ledger, isAdmin, today = () => new Date().toISOString().slice(0, 10), logger = console }) {
    super();
    if (!ledger?.forUserOn) throw new Error('LedgerPlayTimeGrants requires a grant ledger');
    if (typeof isAdmin !== 'function') throw new Error('LedgerPlayTimeGrants requires isAdmin()');
    this.#ledger = ledger;
    this.#isAdmin = isAdmin;
    this.#today = today;
    this.#logger = logger;
  }

  async forSession(session) {
    const userId = session?.payerId ?? session?.userId ?? null;
    if (!userId) return null;

    try {
      if (await this.#isAdmin(userId)) return { grantedMs: null, grantRef: `admin:${userId}` };
    } catch (error) {
      // Cannot establish whether this is an adult ⇒ do not assume they are one.
      this.#logger.warn?.('play.grant.admin_check_failed', { userId, error: error.message });
    }

    const day = this.#today();
    try {
      const { grantedMs } = await this.#ledger.forUserOn(userId, day);
      if (!grantedMs) return null;
      return { grantedMs, grantRef: `ledger:${userId}:${day}` };
    } catch (error) {
      this.#logger.warn?.('play.grant.ledger_failed', { userId, day, error: error.message });
      return null;
    }
  }
}

export default LedgerPlayTimeGrants;
