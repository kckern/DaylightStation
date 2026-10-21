/**
 * The Sunday week close: unspent silver becomes gold, which is yours for good.
 *
 * Per close: read the catalog (mode and `week_close.convert`, per call so a
 * reload applies), refuse a week that has not ended, settle the closing week
 * once more (`PayoutService.settleAll`, which catches last-minute contest and
 * day-met lines and gives the roster), then for each wallet and each valid
 * rule convert the whole `from` balance (`EconomyService.convert`, one locked
 * read-check-pair). What converts is the balance at close time, not the
 * week's earnings: silver minted after a close (a late grade) sits in the
 * wallet and converts at the next one.
 *
 * Whose wallet: every roster learner, plus every other household user with
 * at least one `source: payout` entry (a kid who left the roster, a
 * piano-only earner). A parent's or a legacy deposit/arcade wallet, with no
 * payout ever, never converts.
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
  #payout; #economy; #config; #listUsers; #logger;

  /**
   * @param {object} deps
   * @param {{settleAll: Function, currentStudyDay: Function}} deps.payout - PayoutService
   * @param {{convert: Function, hasUser?: Function}} deps.economy - EconomyService
   * @param {{catalog: () => {mode: string, week_close: {convert: object[]}}}} deps.config - EconomyConfigProjection
   * @param {() => string[]} [deps.listUsers] - household users with a wallet (`EconomyConfigProjection.users`)
   */
  constructor({ payout, economy, config, listUsers = () => [], logger = console }) {
    if (!payout?.settleAll || !payout?.currentStudyDay) throw new Error('WeekCloseService requires payout');
    if (!economy?.convert) throw new Error('WeekCloseService requires economy');
    if (!config?.catalog) throw new Error('WeekCloseService requires config');
    this.#payout = payout;
    this.#economy = economy;
    this.#config = config;
    this.#listUsers = listUsers;
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

  /**
   * Whose wallets close: roster learners unconditionally (PayoutService has
   * already said once which of them have no wallet), then the other
   * household users, converted only if they have a payout entry. Without a
   * roster (the settle failed) only the second group is known.
   */
  #wallets(settled) {
    const wallets = new Map();
    for (const entry of settled?.learners ?? []) {
      if (entry?.reason === 'not-a-user' || !entry?.learnerId) continue;
      wallets.set(entry.learnerId, null);
    }
    for (const userId of this.#listUsers() ?? []) {
      if (!wallets.has(userId)) wallets.set(userId, 'payout');
    }
    return wallets;
  }

  /**
   * Close one week. `weekId` is any day in it (normalised to its Monday);
   * omitted, it is `closingWeek()`. A week whose Sunday is still ahead is
   * refused (`ValidationError`, code `WEEK_NOT_ENDED`). A failed week-wide
   * settle is logged `economy.week-close.settle-failed` and the close goes on
   * with the household's payout earners; one wallet's failure is logged
   * `economy.week-close.failed` and the rest go on.
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
    const today = this.#payout.currentStudyDay();
    const week = weekId == null ? closingWeekFor(today) : weekWindowFor(weekId).from;
    // `>`: on its own Sunday a week is closable (the cron runs then).
    if (addDays(week, 6) > today) {
      this.#logger.warn?.('economy.week-close.refused', { weekId: week, today, reason: 'week-not-ended' });
      throw new ValidationError(`week ${week} has not ended (today is ${today})`, { code: 'WEEK_NOT_ENDED' });
    }
    const rules = this.#rules(catalog.week_close?.convert, week);

    let settled = null;
    try {
      settled = await this.#payout.settleAll({ week });
    } catch (err) {
      // No roster this time: the payout earners still close.
      const level = err?.code === 'CORRUPT_LEDGER' ? 'error' : 'warn';
      this.#logger[level]?.('economy.week-close.settle-failed', { weekId: week, error: message(err), code: err?.code ?? null });
    }
    const counts = { converted: 0, repaired: 0, wouldConvert: 0, belowRate: 0, skipped: 0, failed: 0 };
    const learners = [];
    for (const [learnerId, requireSource] of this.#wallets(settled)) {
      // One learner's failed settle is logged by PayoutService; their close still runs.
      const results = [];
      for (const rule of rules) results.push(await this.#convert(learnerId, week, rule, mode, counts, requireSource));
      learners.push({ learnerId, results });
    }
    this.#logger.info?.('economy.week-close.closed', { weekId: week, mode, learners: learners.length, rules: rules.length, ...counts });
    return { weekId: week, mode, learners };
  }

  async #convert(learnerId, weekId, { from, to, rate }, mode, counts, requireSource) {
    const base = { learnerId, weekId, from, to, rate };
    try {
      const res = await this.#economy.convert(learnerId, {
        from, to, rate, ref: closeRef(learnerId, weekId),
        action: 'week-close', source: 'week-close', meta: { weekId }, dryRun: mode === 'dry-run', requireSource,
      });
      // A repair goes to the currency the first half named, which may not be today's rule's.
      const target = res.to ?? to;
      const figures = { ...base, to: target, rate: res.rate, [from]: res.spent, [target]: res.got };
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
        default: counts.skipped += 1; this.#logger.debug?.('economy.week-close.skipped', { ...base, status: res.status });
      }
      return { ...res, from, to: target };
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
