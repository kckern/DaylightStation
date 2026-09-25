/**
 * HealthAiUsageService — what Health's AI features cost, from the AI usage
 * ledger.
 *
 * Attribution comes from the ledger rows themselves (`app`/`feature`, set by
 * the scoped gateway each Health use case calls through, and by the agent map
 * for the auditor and coach). Rules:
 *
 * - Only rows attributed to `app: 'health'` count as Health. Rows under any
 *   other app — `messaging` included — never do.
 * - `calls` and `avgUsd` count `status: 'ok'` rows only. A call that is
 *   retried after a 400 (the max_tokens rename) writes an error row and an ok
 *   row for one logical call; error rows carry cost 0 anyway.
 * - `costUsd` sums every row's finite cost. An ok row without a price counts
 *   toward `unpriced`, never as free.
 * - A Health row with no feature is reported as `unspecified`.
 * - Rows written before the ledger carried attribution (no `app` field) cannot
 *   be split by app. They are reported once, as `beforeTracking`: the whole
 *   household's untagged spend in the range, NOT Health's.
 *
 * Ledger only. The auditor's spend from before attribution (its run journal)
 * is shown on the auditor page's spend panel, not folded in here.
 */
import { isAiUsageReader } from './ports/IAiUsageReader.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const round = usd => Math.round(usd * 1e6) / 1e6;
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const HEALTH_APP = 'health';
export const UNSPECIFIED_FEATURE = 'unspecified';

export class HealthAiUsageService {
  #reader; #clock; #timezone; #logger;

  /**
   * @param {Object} deps
   * @param {import('./ports/IAiUsageReader.mjs').IAiUsageReader} deps.reader
   * @param {{ now: () => number }} [deps.clock]
   * @param {string|((userId: string|null) => string)} [deps.timezone] - the
   *   user's timezone, or a lookup by user id. Composition passes the same
   *   per-user source NutritionCleanup days are counted in (falling back to the
   *   household), so "today" here and on the auditor's cap agree.
   * @param {Object} [deps.logger]
   */
  constructor({ reader, clock = { now: () => Date.now() }, timezone = 'America/Los_Angeles', logger = console } = {}) {
    if (!isAiUsageReader(reader)) throw new Error('HealthAiUsageService requires an AI usage reader');
    this.#reader = reader;
    this.#clock = clock;
    this.#timezone = typeof timezone === 'function' ? timezone : () => timezone;
    this.#logger = logger;
  }

  #dateOf(ms, timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ms));
  }

  /**
   * @param {string} [userId] - whose days: dates are counted in this user's timezone
   * @param {{ days?: number }} [options] - 1..90 days, today included
   */
  async usage(userId = null, { days = 30 } = {}) {
    const now = this.#clock.now();
    const timeZone = this.#timezone(userId);
    const dateOf = ms => this.#dateOf(ms, timeZone);
    const today = dateOf(now);
    const first = addDays(today, 1 - days);
    const weekStart = addDays(today, -6);
    const monthStart = today.slice(0, 8) + '01';
    const earliest = [first, weekStart, monthStart].sort()[0];
    // Household dates map to UTC instants within a day either way; read a day
    // of margin on both ends and let the household date decide.
    const rows = await this.#reader.listRows({
      from: new Date(Date.parse(earliest + 'T00:00:00Z') - DAY_MS).toISOString(),
      to: new Date(now + DAY_MS).toISOString(),
    });

    const byDate = new Map(Array.from({ length: days }, (_, i) => addDays(first, i)).map(date => [date, { date, total: 0, byFeature: {} }]));
    const features = new Map();
    const before = { costUsd: 0, calls: 0 };
    let todayUsd = 0, week = 0, month = 0;

    for (const row of rows) {
      const ms = Date.parse(row.ts);
      if (!Number.isFinite(ms)) continue;
      const date = dateOf(ms);
      if (date > today) continue;
      const cost = Number.isFinite(row.costUsd) ? row.costUsd : 0;
      const ok = row.status !== 'error';
      if (!row.attributed) {
        if (date >= first) { before.costUsd += cost; if (ok) before.calls++; }
        continue;
      }
      if (row.app !== HEALTH_APP) continue;
      if (date >= monthStart) month += cost;
      if (date >= weekStart) week += cost;
      if (date === today) todayUsd += cost;
      const day = byDate.get(date);
      if (!day) continue;
      const feature = row.feature || UNSPECIFIED_FEATURE;
      day.total += cost;
      day.byFeature[feature] = (day.byFeature[feature] || 0) + cost;
      const entry = features.get(feature) || { feature, calls: 0, costUsd: 0, priced: 0, pricedUsd: 0, unpriced: 0 };
      entry.costUsd += cost;
      if (ok) {
        entry.calls++;
        if (Number.isFinite(row.costUsd)) { entry.priced++; entry.pricedUsd += row.costUsd; } else entry.unpriced++;
      }
      features.set(feature, entry);
    }

    const result = {
      range: { from: first, to: today, days },
      today: round(todayUsd), week: round(week), month: round(month),
      byFeature: [...features.values()]
        .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
        // No priced call, no average: null reads as "cost unknown", not free.
        .map(({ feature, calls, costUsd, priced, pricedUsd, unpriced }) => ({
          feature, calls, costUsd: round(costUsd), avgUsd: priced ? round(pricedUsd / priced) : null, unpriced,
        })),
      days: [...byDate.values()].map(day => ({
        date: day.date, total: round(day.total),
        byFeature: Object.fromEntries(Object.entries(day.byFeature).map(([k, v]) => [k, round(v)])),
      })),
      beforeTracking: before.calls || before.costUsd ? { costUsd: round(before.costUsd), calls: before.calls } : null,
    };
    this.#logger.debug?.('health.ai-usage.read', { days, rows: rows.length, features: result.byFeature.length });
    return result;
  }
}

export default HealthAiUsageService;
