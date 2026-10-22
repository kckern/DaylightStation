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
 *
 * Settles repeat (every event, every hour), so per-line logs (`would-mint`,
 * `held`, `bad-amount`) fire only when that line's status or amount changed
 * since this process last logged it, and the per-settle summary is `debug`
 * unless something minted or a count moved.
 */
import { PAID_KINDS } from "../domain/index.mjs";
import { ringAmount } from "../domain/earnings/index.mjs";

const CURRENCIES = ['silver', 'gems'];
const HELD = new Set(['indeterminate', 'pending']);

/** The ledger ref one currency of an earning line is paid under. Stable across runs. */
export function payoutRef(lineRef, currency) {
  return currency === 'silver' ? lineRef : `${lineRef}:${currency}`;
}

const message = (err) => err?.message ?? String(err);

/**
 * What a ring-threshold line owes, one step per FINISHED workout: the line's
 * final sessions in end order, each priced at the week's running ring total
 * (`ringAmount` over the line's `priced` rule). Minted in order under the
 * line's one ref, each step pays only what the steps before it (and anything
 * already paid) left short, so every workout gets its own entry, a workout
 * that crosses no new silver step writes nothing (its rings roll into the
 * next), and a week already paid at live rates is never paid twice. A
 * running workout, or one still inside the resume window, waits.
 * @returns {Array<{amount: {silver: number, gems: number}, meta: object}>}
 */
export function ringSteps(line) {
  const finals = (line.sessions ?? []).filter((s) => s?.final && Number.isFinite(s.rings) && s.rings > 0)
    .sort((a, b) => (a.endMs ?? a.startMs) - (b.endMs ?? b.startMs));
  let running = 0;
  return finals.map((s) => {
    running += s.rings;
    return {
      amount: ringAmount(line.priced, running),
      meta: { kind: line.kind, count: running, session: { id: s.sessionId, title: s.title ?? null, startMs: s.startMs, rings: s.rings } },
    };
  });
}

const paysPerWorkout = (line) => line.kind === 'ring-threshold' && Array.isArray(line.sessions) && line.priced?.rate;

// The evidence states that pay, for the line kinds that pay per day.
const PAYING_DAY_STATE = { 'section-day': 'served', 'day-met': 'met' };

/**
 * What the line looked like when it paid, kept on the entry so the bank can
 * say what a payout was for (`historyText`): the line's kind and count (the
 * week's rings for a ring line) and, for the per-day kinds, the days that
 * paid so far. A week line pays its growth in several entries; the days new
 * since the ref's previous entry are the ones this entry paid for.
 */
export function payoutMeta(line) {
  const meta = { kind: line.kind ?? null, count: Number.isFinite(line.count) ? line.count : null };
  const state = PAYING_DAY_STATE[line.kind];
  if (state) {
    meta.days = (line.evidence ?? []).filter((e) => e?.state === state && typeof e.day === 'string').map((e) => e.day).sort();
  }
  return meta;
}

export class PayoutService {
  #preview; #economy; #config; #logger;
  #lastLogged = new Map(); // `${learnerId}|${ref}` → the status/amount last logged
  #lastSummary = new Map(); // `${learnerId}|${weekId}` → the counts last summarised
  #notAUser = new Set(); // learners already reported as having no wallet

  /**
   * @param {object} deps
   * @param {{preview: Function, roster: Function, currentStudyDay: Function}} deps.preview - EarningsPreviewService
   * @param {{mint: Function, getHistory: Function, hasUser?: Function}} deps.economy - EconomyService
   * @param {{catalog: () => {mode: 'off'|'dry-run'|'live'}}} deps.config - EconomyConfigProjection
   */
  constructor({ preview, economy, config, logger = console }) {
    if (!preview?.preview || !preview?.roster || !preview?.currentStudyDay) throw new Error('PayoutService requires preview');
    if (!economy?.mint || !economy?.getHistory) throw new Error('PayoutService requires economy');
    if (!config?.catalog) throw new Error('PayoutService requires config');
    this.#preview = preview;
    this.#economy = economy;
    this.#config = config;
    this.#logger = logger;
  }

  /**
   * The preview's "today" (its clock, timezone and study-day boundary), so a
   * caller choosing weeks agrees with what `week: null` means.
   */
  currentStudyDay() { return this.#preview.currentStudyDay(); }

  // Per call, so a config reload (dry-run → live) applies without a restart.
  #mode() { return this.#config.catalog().mode; }

  /** Log a per-line event only when its status or amount changed. */
  #logChange(level, event, key, state, data) {
    if (this.#lastLogged.get(key) === state) return;
    this.#lastLogged.set(key, state);
    this.#logger[level]?.(event, data);
  }

  /**
   * A learner on the school roster who is not a household user has no
   * wallet: said once per process, then skipped without a word.
   */
  #isUser(learnerId) {
    if (typeof this.#economy.hasUser !== 'function' || this.#economy.hasUser(learnerId)) return true;
    if (!this.#notAUser.has(learnerId)) {
      this.#notAUser.add(learnerId);
      this.#logger.info?.('economy.payout.not-a-user', { learnerId });
    }
    return false;
  }

  /**
   * One learner's week. `week` is any study day in it; null is the preview's
   * own current study day (4 am boundary). A preview or ledger failure throws.
   * @returns {Promise<{minted: object[], skipped: number, held: number, mode: string, wouldMint?: object[], reason?: string}>}
   */
  async settle({ learnerId, week = null }) {
    const mode = this.#mode();
    if (mode === 'off') {
      this.#logger.debug?.('economy.payout.off', { learnerId });
      return { minted: [], skipped: 0, held: 0, mode };
    }
    if (!this.#isUser(learnerId)) return { minted: [], skipped: 0, held: 0, mode, reason: 'not-a-user' };
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
      const { learnerId } = result;
      if (!this.#isUser(learnerId)) {
        learners.push({ learnerId, minted: [], skipped: 0, held: 0, mode, reason: 'not-a-user' });
        continue;
      }
      try {
        learners.push({ learnerId, ...(await this.#pay(learnerId, result, mode)) });
      } catch (err) {
        // A corrupt ledger shard needs a person, not a retry.
        const level = err?.code === 'CORRUPT_LEDGER' ? 'error' : 'warn';
        this.#logger[level]?.('economy.payout.failed', { learnerId, error: message(err), code: err?.code ?? null });
        learners.push({ learnerId, minted: [], skipped: 0, held: 0, mode, error: message(err) });
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
        this.#logChange('info', 'economy.payout.held', `${learnerId}|${line.ref}`, line.status,
          { learnerId, ref: line.ref, status: line.status, ruleId: line.ruleId });
        continue;
      }
      if (line.status !== 'earned' || !line.ref) continue;
      const kind = line.kind === 'ring-contest' ? 'prize' : 'earn';
      const steps = paysPerWorkout(line) ? ringSteps(line) : [{ amount: line.amount, meta: payoutMeta(line) }];
      for (const step of steps) {
        for (const currency of CURRENCIES) {
          const amount = step.amount?.[currency] ?? 0;
          if (amount === 0) continue;
          const ref = payoutRef(line.ref, currency);
          if (!Number.isInteger(amount) || amount < 0) {
            this.#logChange('warn', 'economy.payout.bad-amount', `${learnerId}|${ref}`, `bad|${amount}`,
              { learnerId, ref, currency, amount, ruleId: line.ruleId });
            continue;
          }
          owed.push({ ref, evidenceRef: line.ref, currency, amount, kind, ruleId: line.ruleId, timeliness: line.timeliness ?? null, meta: step.meta });
        }
      }
    }

    // One up-front all-time read: what is already paid, for the skip count
    // and the dry-run figures. Advisory only: `mint` re-checks under the
    // user lock (strict read, earn/prize only), which keeps a racing settle
    // from paying twice.
    const paid = new Map();
    if (owed.length) {
      for (const t of await this.#economy.getHistory(learnerId)) {
        if (!t.ref || !PAID_KINDS.has(t.kind)) continue;
        const key = `${t.currency ?? 'silver'}|${t.ref}`;
        paid.set(key, (paid.get(key) ?? 0) + (t.delta || 0));
      }
    }

    const minted = [];
    const wouldMint = [];
    let skipped = 0;
    for (const entry of owed) {
      const key = `${entry.currency}|${entry.ref}`;
      const shortfall = entry.amount - (paid.get(key) ?? 0);
      if (shortfall <= 0) { skipped += 1; continue; }
      // A ring line's later steps share this ref: count what this step pays.
      paid.set(key, entry.amount);
      if (mode === 'dry-run') {
        this.#logChange('info', 'economy.payout.would-mint', `${learnerId}|${entry.ref}`, `would-mint|${shortfall}`,
          { learnerId, ref: entry.ref, currency: entry.currency, amount: shortfall, ruleId: entry.ruleId });
        wouldMint.push({ ...entry, amount: shortfall });
        continue;
      }
      const res = await this.#economy.mint(learnerId, {
        currency: entry.currency, amount: entry.amount, kind: entry.kind, ref: entry.ref,
        ruleId: entry.ruleId, timeliness: entry.timeliness, evidenceRef: entry.evidenceRef, source: 'payout', meta: entry.meta,
      });
      if (res.minted > 0) minted.push({ ...entry, amount: res.minted, txnId: res.txnId });
      else skipped += 1;
    }

    const weekId = result?.windows?.school?.from ?? null;
    const counts = { minted: minted.length, wouldMint: wouldMint.length, skipped, held };
    const summaryKey = `${learnerId}|${weekId}`;
    const countsKey = JSON.stringify(counts);
    const changed = this.#lastSummary.get(summaryKey) !== countsKey;
    this.#lastSummary.set(summaryKey, countsKey);
    this.#logger[minted.length || changed ? 'info' : 'debug']?.('economy.payout.settled', { learnerId, week: weekId, mode, ...counts });
    return mode === 'dry-run' ? { minted, wouldMint, skipped, held, mode } : { minted, skipped, held, mode };
  }
}

export default PayoutService;
