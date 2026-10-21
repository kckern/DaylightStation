/**
 * The Sunday week close: unspent silver becomes gold, which is yours for good.
 *
 * Per close: read the catalog (mode and `week_close.convert`, per call so a
 * reload applies), settle the closing week once more (`PayoutService.settleAll`,
 * which catches last-minute contest and day-met lines and gives the roster),
 * then for each learner and each valid rule convert the wallet's whole `from`
 * balance (`EconomyService.convert`, one locked read-check-pair). What
 * converts is the balance at close time, not the week's earnings: silver
 * minted after a close (a late grade) sits in the wallet and converts at the
 * next one.
 *
 *   off      nothing: no settle, no ledger read
 *   dry-run  logs `economy.week-close.would-convert`, writes nothing
 *   live     writes the pair, logs `economy.week-close.converted`
 *
 * The pair's ref is `close:{learnerId}:{weekId}` (the `from` half; the `to`
 * half is `…:{to}`), so a second close of the same week writes nothing and a
 * close that crashed between the halves is repaired by the next one.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { weekWindowFor } from "../../../../learning/school/server/study-calendar.mjs";
import { CURRENCIES } from "../domain/index.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day) => new Date(`${day}T00:00:00.000Z`).getUTCDay();
const message = (err) => err?.message ?? String(err);

/**
 * The week a close on `studyDay` closes: the week whose Sunday is that day or
 * has most recently passed. On Sunday (the cron's day) that is the current
 * week; on any other day (a manual or late run) it is the previous week, never
 * a week still in progress.
 * @param {string} studyDay - YYYY-MM-DD
 * @returns {string} that week's Monday
 */
export function closingWeekFor(studyDay) {
  const monday = weekWindowFor(studyDay).from;
  return weekday(studyDay) === 0 ? monday : addDays(monday, -7);
}

/** The ref a learner's week-close pair is written under (its `from` half). */
export function closeRef(learnerId, weekId) {
  return `close:${learnerId}:${weekId}`;
}

export class WeekCloseService {
  #payout; #economy; #config; #logger;
  #notAUser = new Set(); // learners already reported as having no wallet

  /**
   * @param {object} deps
   * @param {{settleAll: Function, currentStudyDay: Function}} deps.payout - PayoutService
   * @param {{convert: Function, hasUser?: Function}} deps.economy - EconomyService
   * @param {{catalog: () => {mode: string, week_close: {convert: object[]}}}} deps.config - EconomyConfigProjection
   */
  constructor({ payout, economy, config, logger = console }) {
    if (!payout?.settleAll || !payout?.currentStudyDay) throw new Error('WeekCloseService requires payout');
    if (!economy?.convert) throw new Error('WeekCloseService requires economy');
    if (!config?.catalog) throw new Error('WeekCloseService requires config');
    this.#payout = payout;
    this.#economy = economy;
    this.#config = config;
    this.#logger = logger;
  }

  /** The week a close run now would close, from the preview's own study day. */
  closingWeek() { return closingWeekFor(this.#payout.currentStudyDay()); }

  /** Valid rules in config order. A bad one logs `bad-rule` and is skipped. */
  #rules(list, weekId) {
    const rules = [];
    const used = new Set();
    for (const rule of list ?? []) {
      let reason = null;
      if (rule == null || typeof rule !== 'object' || Array.isArray(rule)) reason = 'not-a-map';
      else if (!CURRENCIES.includes(rule.from) || !CURRENCIES.includes(rule.to)) reason = 'unknown-currency';
      else if (rule.from === rule.to) reason = 'same-currency';
      else if (typeof rule.rate !== 'number' || !Number.isFinite(rule.rate) || rule.rate <= 0) reason = 'bad-rate';
      // One rule per currency keeps every half's ref unique.
      else if (used.has(rule.from) || used.has(rule.to)) reason = 'overlaps';
      if (reason) {
        this.#logger.warn?.('economy.week-close.bad-rule', { weekId, rule, reason });
        continue;
      }
      used.add(rule.from);
      used.add(rule.to);
      rules.push({ from: rule.from, to: rule.to, rate: rule.rate });
    }
    return rules;
  }

  #isUser(learnerId, settled) {
    // PayoutService already said this learner has no wallet.
    if (settled?.reason === 'not-a-user') return false;
    if (typeof this.#economy.hasUser !== 'function' || this.#economy.hasUser(learnerId)) return true;
    if (!this.#notAUser.has(learnerId)) {
      this.#notAUser.add(learnerId);
      this.#logger.info?.('economy.week-close.not-a-user', { learnerId });
    }
    return false;
  }

  /**
   * Close one week for the roster. `weekId` is any day in it (normalised to
   * its Monday); omitted, it is `closingWeek()`. A roster failure throws (the
   * balance is not lost: it converts at the next close); a learner's failure
   * is logged `economy.week-close.failed` and the rest go on.
   * @returns {Promise<{weekId: string|null, mode: string, learners: {learnerId: string, results: object[]}[]}>}
   */
  async close({ weekId = null } = {}) {
    const catalog = this.#config.catalog();
    const { mode } = catalog;
    if (mode === 'off') {
      this.#logger.debug?.('economy.week-close.off', { weekId });
      return { weekId, mode, learners: [] };
    }
    if (weekId != null && !DAY.test(weekId)) throw new ValidationError(`weekId must be YYYY-MM-DD, got ${weekId}`);
    const week = weekId == null ? this.closingWeek() : weekWindowFor(weekId).from;
    const rules = this.#rules(catalog.week_close?.convert, week);

    const settled = await this.#payout.settleAll({ week });
    const counts = { converted: 0, repaired: 0, wouldConvert: 0, belowRate: 0, skipped: 0, failed: 0 };
    const learners = [];
    for (const entry of settled?.learners ?? []) {
      const { learnerId } = entry;
      if (!this.#isUser(learnerId, entry)) continue;
      // A failed settle is logged by PayoutService; the close still runs.
      const results = [];
      for (const rule of rules) results.push(await this.#convert(learnerId, week, rule, mode, counts));
      learners.push({ learnerId, results });
    }
    this.#logger.info?.('economy.week-close.closed', { weekId: week, mode, learners: learners.length, rules: rules.length, ...counts });
    return { weekId: week, mode, learners };
  }

  async #convert(learnerId, weekId, { from, to, rate }, mode, counts) {
    const base = { learnerId, weekId, from, to, rate };
    try {
      const res = await this.#economy.convert(learnerId, {
        from, to, rate, ref: closeRef(learnerId, weekId),
        action: 'week-close', source: 'week-close', meta: { weekId }, dryRun: mode === 'dry-run',
      });
      const figures = { ...base, rate: res.rate, [from]: res.spent, [to]: res.got };
      switch (res.status) {
        case 'converted': counts.converted += 1; this.#logger.info?.('economy.week-close.converted', figures); break;
        case 'repaired': counts.repaired += 1; this.#logger.warn?.('economy.week-close.repaired', figures); break;
        case 'would-convert':
        case 'would-repair':
          counts.wouldConvert += 1;
          this.#logger.info?.('economy.week-close.would-convert', { ...figures, repair: res.status === 'would-repair' });
          break;
        case 'below-rate':
          counts.belowRate += 1;
          this.#logger.info?.('economy.week-close.below-rate', { ...base, [from]: res.balance ?? 0 });
          break;
        default: counts.skipped += 1; this.#logger.debug?.(`economy.week-close.${res.status}`, base);
      }
      return { ...res, from, to };
    } catch (err) {
      counts.failed += 1;
      // A corrupt ledger shard needs a person, not a retry.
      const level = err?.code === 'CORRUPT_LEDGER' ? 'error' : 'warn';
      this.#logger[level]?.('economy.week-close.failed', { ...base, error: message(err), code: err?.code ?? null });
      return { status: 'failed', from, to, rate, error: message(err) };
    }
  }
}

export default WeekCloseService;
