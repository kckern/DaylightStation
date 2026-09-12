/**
 * Gives a child play time, extends it, or takes it back.
 *
 * All three are the same operation — an entry on an append-only ledger — which
 * is deliberate: revoking by writing a negative delta leaves both the grant and
 * the revocation visible, where editing a balance would leave neither.
 *
 * This is the seam the economy plugs into. A parent granting twenty minutes from
 * a phone and tokens being converted into minutes write the same kind of entry,
 * so pricing can change without this use case knowing it exists.
 */
export class GrantPlayTime {
  #ledger; #today; #logger;

  constructor({ ledger, today = () => new Date().toISOString().slice(0, 10), logger = console }) {
    if (!ledger?.append) throw new Error('GrantPlayTime requires a grant ledger');
    this.#ledger = ledger;
    this.#today = today;
    this.#logger = logger;
  }

  /**
   * @param {Object} input
   * @param {string} input.userId
   * @param {number} input.minutes  Negative takes time back.
   * @param {string} [input.by]     Who authorised it.
   * @param {string} [input.reason]
   * @param {string} [input.on]     ISO date; defaults to today.
   */
  async execute({ userId, minutes, by = null, reason = null, on = null }) {
    if (!userId) throw new Error('GrantPlayTime requires a userId');
    if (!Number.isFinite(minutes) || minutes === 0) {
      throw new Error('GrantPlayTime requires a non-zero number of minutes');
    }

    const day = on || this.#today();
    const before = await this.#ledger.forUserOn(userId, day);
    let deltaMs = Math.round(minutes * 60_000);

    // Never let a revocation drive the balance below zero: a negative balance
    // would read as debt, and nothing in this system collects debts from a child.
    if (deltaMs < 0 && before.grantedMs + deltaMs < 0) deltaMs = -before.grantedMs;
    if (deltaMs === 0) {
      return { userId, day, grantedMs: before.grantedMs, changedMs: 0 };
    }

    await this.#ledger.append(userId, day, { deltaMs, by, reason });
    const after = await this.#ledger.forUserOn(userId, day);

    this.#logger.info?.('play.grant.recorded', {
      userId, day, deltaMs, by, reason, grantedMs: after.grantedMs,
    });
    return { userId, day, grantedMs: after.grantedMs, changedMs: deltaMs };
  }
}

export default GrantPlayTime;
