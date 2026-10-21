/**
 * A kid's bank, in one read: balances, the ledger in plain words, today's
 * pass per privilege, what a pass costs, and when the week closes. Read-only.
 *
 * Balances and offer affordability are the fold of the same ledger read the
 * history comes from (never the wallet snapshot), so an offer says what
 * `buyPass` will decide. History lines are named, in order, by the current
 * week's preview lines (`evidenceLabels`: evidenceRef → label), then the
 * ruleset's rule label, then a generic phrase, so a failing preview or
 * ruleset only makes the words plainer. The last HISTORY_LIMIT lines are
 * returned.
 */
import { CronExpressionParser } from 'cron-parser';
import { historyLines, quote, foldBalances, findPass, capUsed, nonePass } from "../domain/index.mjs";
import { weekWindowFor } from "../../../../learning/school/server/study-calendar.mjs";
import { studyDayWindowForDate } from "../../../../learning/school/server/domain-study-day.mjs";

export const HISTORY_LIMIT = 50;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * When the week next closes, as an ISO instant: the cron's next fire after
 * now in the household timezone (cron-parser, the scheduler's own parser).
 * No cron, or one that does not parse (`onUnreadable` hears why), gives the
 * end of the week's Sunday study day (Monday at the boundary hour).
 *
 * The scheduler itself parses with no timezone, so the job fires in the
 * process TZ; this agrees only while that TZ is the household's (see
 * economy.md).
 */
export function nextWeekClose({ nowMs, studyDay, cron = null, timezone = null, boundaryHour = 4, onUnreadable = null }) {
  if (typeof cron === 'string' && cron.trim()) {
    try {
      // No household timezone means UTC, as the study day reads it.
      return CronExpressionParser.parse(cron.trim(), { currentDate: new Date(nowMs), tz: timezone ?? 'UTC' })
        .next().toDate().toISOString();
    } catch (err) {
      onUnreadable?.(err);
    }
  }
  const sunday = addDays(weekWindowFor(studyDay).from, 6);
  return new Date(studyDayWindowForDate(sunday, { timezone, boundaryHour }).endAtMs).toISOString();
}

export class BankService {
  #economy; #config; #rules; #evidenceLabels; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('./EconomyService.mjs').EconomyService} deps.economy
   * @param {{catalog: () => object}} deps.config
   * @param {{get: () => Promise<{rules?: Array<{id: string, label?: string}>}>}|null} [deps.rules]
   * @param {((userId: string) => Promise<Map<string,string>|object|null>)|null} [deps.evidenceLabels]
   * @param {() => Date} [deps.clock]
   */
  constructor({ economy, config, rules = null, evidenceLabels = null, clock = () => new Date(), logger = console }) {
    if (!economy?.getHistory) throw new Error('BankService requires economy');
    if (!config?.catalog) throw new Error('BankService requires config');
    this.#economy = economy;
    this.#config = config;
    this.#rules = rules;
    this.#evidenceLabels = evidenceLabels;
    this.#clock = clock;
    this.#logger = logger;
  }

  async #labels(source, fn) {
    try {
      return (await fn()) ?? null;
    } catch (err) {
      this.#logger.warn?.('economy.bank.labels-unavailable', { source, error: err?.message ?? String(err) });
      return null;
    }
  }

  /**
   * Today's passes, read strictly. A shard that does not parse is "unknown"
   * rather than "none": the bank must not tell a kid the day's pass is unused
   * when the ledger cannot say.
   */
  async #today(userId) {
    try {
      return await this.#economy.passesToday(userId, { strict: true });
    } catch (err) {
      if (err?.code !== 'CORRUPT_LEDGER') throw err;
      this.#logger.warn?.('economy.bank.pass-unreadable', { userId, error: err.message });
      return null;
    }
  }

  async bank(userId) {
    const entries = await this.#economy.getHistory(userId);
    const balances = foldBalances(entries);
    const today = await this.#today(userId);
    const { timezone, boundaryHour } = this.#economy.studyCalendar ?? {};
    const studyDay = this.#economy.currentStudyDay();
    const catalog = this.#config.catalog();
    const [ruleLabels, evidenceLabels] = await Promise.all([
      this.#labels('rules', async () => {
        const ruleset = this.#rules ? await this.#rules.get() : null;
        return Object.fromEntries((ruleset?.rules ?? []).filter((r) => r?.id && r.label).map((r) => [r.id, r.label]));
      }),
      this.#labels('evidence', async () => (this.#evidenceLabels ? this.#evidenceLabels(userId) : null)),
    ]);
    const history = historyLines(entries, { ruleLabels, evidenceLabels, timezone }).slice(0, HISTORY_LIMIT);
    const privileges = [...new Set(Object.values(catalog.passes ?? {}).flatMap((p) => (Array.isArray(p?.privileges) ? p.privileges : [])))];
    const passFor = (privilege) => {
      const none = nonePass({ learnerId: userId, studyDay, privilege });
      if (today == null) return { ...none, state: 'unknown', capUsed: null };
      const mine = today.filter((p) => p.privilege === privilege);
      const found = findPass(catalog, privilege);
      return { ...(mine.length ? mine[mine.length - 1] : none), capUsed: found ? capUsed(today, found) : null };
    };
    return {
      userId,
      studyDay,
      balances,
      history,
      pass: Object.fromEntries(privileges.map((privilege) => [privilege, passFor(privilege)])),
      offers: Object.fromEntries(privileges.map((privilege) => [privilege, quote(catalog, { privilege, balances })])),
      weekEndsAt: nextWeekClose({
        nowMs: this.#clock().getTime(), studyDay, cron: catalog.week_close?.cron ?? null, timezone, boundaryHour,
        onUnreadable: (err) => this.#logger.warn?.('economy.bank.cron-unreadable', { cron: catalog.week_close?.cron, error: err?.message ?? String(err) }),
      }),
    };
  }
}

export default BankService;
