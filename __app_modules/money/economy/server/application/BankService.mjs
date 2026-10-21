/**
 * A kid's bank, in one read: balances, the ledger in plain words, today's
 * pass, what a pass costs, and when the week closes. Read-only.
 *
 * History lines are named, in order, by the current week's preview lines
 * (`evidenceLabels`: evidenceRef → label), then the ruleset's rule label,
 * then a generic phrase, so a failing preview or ruleset only makes the
 * words plainer. The last HISTORY_LIMIT lines are returned.
 */
import { historyLines, quote } from "../domain/index.mjs";
import { weekWindowFor } from "../../../../learning/school/server/study-calendar.mjs";
import { studyDayWindowForDate } from "../../../../learning/school/server/domain-study-day.mjs";

export const HISTORY_LIMIT = 50;
const CRON_WEEKLY = /^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * When the week next closes, as an ISO instant. A weekly cron `M H * * D`
 * (the shipped `30 23 * * 0`, Sunday 23:30 local) gives the first such
 * local time after now in the study day's Monday-to-Sunday week, or the week
 * after once it has passed. Any other cron, or none, gives the end of the
 * week's Sunday study day (Monday at the boundary hour).
 */
export function nextWeekClose({ nowMs, studyDay, cron = null, timezone = null, boundaryHour = 4 }) {
  const monday = weekWindowFor(studyDay).from;
  const m = typeof cron === 'string' ? cron.trim().match(CRON_WEEKLY) : null;
  const minute = m ? Number(m[1]) : NaN;
  const hour = m ? Number(m[2]) : NaN;
  if (!m || minute > 59 || hour > 23) {
    return new Date(studyDayWindowForDate(addDays(monday, 6), { timezone, boundaryHour }).endAtMs).toISOString();
  }
  let day = addDays(monday, (Number(m[3]) + 6) % 7);
  const at = (d) => studyDayWindowForDate(d, { timezone, boundaryHour: hour + minute / 60 }).startAtMs;
  while (at(day) <= nowMs) day = addDays(day, 7);
  return new Date(at(day)).toISOString();
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

  async bank(userId) {
    const { balances } = await this.#economy.getBalance(userId);
    const entries = await this.#economy.getHistory(userId);
    const today = await this.#economy.passesToday(userId);
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
    return {
      userId,
      balances,
      history,
      pass: today.length ? today[today.length - 1] : { state: 'none', studyDay },
      offers: Object.fromEntries(privileges.map((privilege) => [privilege, quote(catalog, { privilege, balances })])),
      weekEndsAt: nextWeekClose({ nowMs: this.#clock().getTime(), studyDay, cron: catalog.week_close?.cron ?? null, timezone, boundaryHour }),
    };
  }
}

export default BankService;
