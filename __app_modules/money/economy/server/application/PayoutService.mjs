/**
 * Pays what the weekly earnings preview says was earned. The preview and the
 * payout share one evaluator (`EarningsPreviewService` → `evaluateEarnings`),
 * so the board's "this week's silver" and the ledger cannot disagree.
 *
 * Per settle: read the catalog mode, preview the learner's week, and for each
 * `earned` line mint every currency it pays (silver under the line's `ref`,
 * gems under `${ref}:gems`). `EconomyService.mint` is idempotent on that ref
 * across the whole ledger and pays only the shortfall, so settling again is
 * free and a line that grew since the last settle pays the difference.
 *
 *   off      nothing: no preview, no ledger, no per-line logs
 *   dry-run  logs `economy.payout.would-mint`, writes nothing
 *   live     mints
 *
 * `indeterminate` and `pending` lines are never paid (H9): evidence missing
 * is not evidence of work, and an open period is not over.
 */
const CURRENCIES = ['silver', 'gems'];
const HELD = new Set(['indeterminate', 'pending']);

/** The ledger ref one currency of an earning line is paid under. Stable across runs. */
export function payoutRef(lineRef, currency) {
  return currency === 'silver' ? lineRef : `${lineRef}:${currency}`;
}

export class PayoutService {
  #preview; #economy; #config; #logger;

  /**
   * @param {object} deps
   * @param {{preview: Function, roster: Function}} deps.preview - EarningsPreviewService
   * @param {{mint: Function, getHistory: Function}} deps.economy - EconomyService
   * @param {{catalog: () => {mode: 'off'|'dry-run'|'live'}}} deps.config - EconomyConfigProjection
   */
  constructor({ preview, economy, config, logger = console }) {
    if (!preview?.preview || !preview?.roster) throw new Error('PayoutService requires preview');
    if (!economy?.mint || !economy?.getHistory) throw new Error('PayoutService requires economy');
    if (!config?.catalog) throw new Error('PayoutService requires config');
    this.#preview = preview;
    this.#economy = economy;
    this.#config = config;
    this.#logger = logger;
  }

  // Per call, so a config reload (dry-run → live) applies without a restart.
  #mode() { return this.#config.catalog().mode; }

  /**
   * One learner's week. `week` is any study day in it; null is the preview's
   * own current study day (4 am boundary). A preview failure throws.
   * @returns {Promise<{minted: object[], skipped: number, held: number, mode: string, wouldMint?: object[]}>}
   */
  async settle({ learnerId, week = null }) {
    const mode = this.#mode();
    if (mode === 'off') {
      this.#logger.debug?.('economy.payout.off', { learnerId });
      return { minted: [], skipped: 0, held: 0, mode };
    }
    const result = await this.#preview.preview({ learnerId, week });
    return this.#pay(learnerId, result, mode);
  }

  /** Every learner on the roster, from one roster read. A learner that fails is logged and skipped. */
  async settleAll({ week = null } = {}) {
    const mode = this.#mode();
    if (mode === 'off') {
      this.#logger.debug?.('economy.payout.off', { learnerId: null });
      return { learners: [], mode };
    }
    const roster = await this.#preview.roster({ week });
    const learners = [];
    for (const result of roster?.learners ?? []) {
      try {
        learners.push({ learnerId: result.learnerId, ...(await this.#pay(result.learnerId, result, mode)) });
      } catch (err) {
        this.#logger.warn?.('economy.payout.failed', { learnerId: result.learnerId, error: err?.message ?? String(err) });
        learners.push({ learnerId: result.learnerId, minted: [], skipped: 0, held: 0, mode, error: err?.message ?? String(err) });
      }
    }
    return { learners, mode };
  }

  async #pay(learnerId, result, mode) {
    const owed = [];
    let held = 0;
    for (const line of result?.lines ?? []) {
      if (HELD.has(line.status)) {
        held += 1;
        // Indeterminate is worth seeing; pending is every open line, every run.
        const level = line.status === 'indeterminate' ? 'info' : 'debug';
        this.#logger[level]?.('economy.payout.held', { learnerId, ref: line.ref, status: line.status, ruleId: line.ruleId });
        continue;
      }
      if (line.status !== 'earned' || !line.ref) continue;
      const kind = line.kind === 'ring-contest' ? 'prize' : 'earn';
      for (const currency of CURRENCIES) {
        const amount = line.amount?.[currency] ?? 0;
        if (!Number.isInteger(amount) || amount <= 0) continue;
        owed.push({
          ref: payoutRef(line.ref, currency), evidenceRef: line.ref, currency, amount, kind,
          ruleId: line.ruleId, timeliness: line.timeliness ?? line.ref.split(':').pop() ?? null,
        });
      }
    }

    // One up-front all-time read: what is already paid, for the skip count
    // and the dry-run figures. Advisory only: `mint` re-checks under the
    // user lock, which is what keeps a racing settle from paying twice.
    const paid = new Map();
    if (owed.length) {
      for (const t of await this.#economy.getHistory(learnerId)) {
        if (!t.ref) continue;
        const key = `${t.currency ?? 'silver'}|${t.ref}`;
        paid.set(key, (paid.get(key) ?? 0) + (t.delta || 0));
      }
    }

    const minted = [];
    const wouldMint = [];
    let skipped = 0;
    for (const entry of owed) {
      const shortfall = entry.amount - (paid.get(`${entry.currency}|${entry.ref}`) ?? 0);
      if (shortfall <= 0) { skipped += 1; continue; }
      if (mode === 'dry-run') {
        this.#logger.info?.('economy.payout.would-mint', { learnerId, ref: entry.ref, currency: entry.currency, amount: shortfall, ruleId: entry.ruleId });
        wouldMint.push({ ...entry, amount: shortfall });
        continue;
      }
      const res = await this.#economy.mint(learnerId, {
        currency: entry.currency, amount: entry.amount, kind: entry.kind, ref: entry.ref,
        ruleId: entry.ruleId, timeliness: entry.timeliness, evidenceRef: entry.evidenceRef, source: 'payout',
      });
      if (res.minted > 0) minted.push({ ...entry, amount: res.minted, txnId: res.txnId });
      else skipped += 1;
    }
    if (minted.length || wouldMint.length) {
      this.#logger.info?.('economy.payout.settled', { learnerId, mode, minted: minted.length, wouldMint: wouldMint.length, skipped, held });
    }
    return mode === 'dry-run' ? { minted, wouldMint, skipped, held, mode } : { minted, skipped, held, mode };
  }
}

export default PayoutService;
