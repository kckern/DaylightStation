/**
 * LifeEventSuggester — suggests life events from recent calendar items for the
 * user to confirm. It writes nothing; the coach offers suggestions and records
 * only what the user confirms (add_life_event).
 */
import {
  LifeEventSignalDetector, calendarItemsForDay, toSuggestion,
} from '#domains/lifeplan/services/LifeEventSignalDetector.mjs';

const MODES = new Set(['shadow', 'decide', 'off']);
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const DEFAULT_MIN_CONFIDENCE = 0.6;

const nameKey = (s) => String(s || '').trim().toLowerCase();

function shiftDate(ymd, deltaDays) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function collectItems(days) {
  const items = [];
  for (const date of Object.keys(days || {}).sort()) {
    for (const item of calendarItemsForDay(days[date])) {
      items.push({ id: `c${items.length}`, date, item });
    }
  }
  return items;
}

export class LifeEventSuggester {
  #aggregator; #plans; #detector; #decision; #timezone; #clock; #timeoutMs; #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.aggregator - LifelogAggregator (aggregateRange)
   * @param {Object} deps.lifePlanStore - ILifePlanRepository (load)
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {'shadow'|'decide'|'off'} [deps.mode='shadow']
   * @param {number} [deps.minConfidence=0.6]
   * @param {string} [deps.timezone='UTC'] - household zone for "today"
   * @param {Object} [deps.clock] - { now(): Date }
   * @param {number} [deps.timeoutMs=5000]
   * @param {Object} [deps.logger]
   */
  constructor({ aggregator, lifePlanStore, detector = new LifeEventSignalDetector(), decisionGateway = null,
    mode = 'shadow', minConfidence = DEFAULT_MIN_CONFIDENCE, timezone = 'UTC', clock = null,
    timeoutMs = 5000, logger = null } = {}) {
    this.#aggregator = aggregator;
    this.#plans = lifePlanStore;
    this.#detector = detector;
    this.#decision = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.mode = MODES.has(mode) ? mode : 'shadow';
    this.minConfidence = Number.isFinite(minConfidence) ? minConfidence : DEFAULT_MIN_CONFIDENCE;
    this.#timezone = timezone || 'UTC';
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  async suggest(username, { days = DEFAULT_DAYS } = {}) {
    const span = Math.max(1, Math.min(Number.isFinite(days) ? Math.floor(days) : DEFAULT_DAYS, MAX_DAYS));
    const endDate = this.#today();
    const startDate = shiftDate(endDate, -(span - 1));
    const range = await this.#aggregator.aggregateRange(username, startDate, endDate);
    const items = collectItems(range?.days).map((it) => ({ ...it, keyword: this.#detector.classify(it.item) }));
    const known = new Set((this.#plans.load(username)?.life_events || []).map((e) => nameKey(e.name)).filter(Boolean));

    const judge = 'keyword';
    const suggestions = items
      .filter((it) => it.keyword)
      .map((it) => toSuggestion(it.date, it.item, it.keyword.kind, it.keyword.confidence, 'keyword'))
      .filter((s) => !known.has(nameKey(s.name)));

    this.#logger?.info?.('lifeplan.life-event.suggested', {
      username, mode: this.mode, judge, items: items.length, suggestions: suggestions.length,
    });
    return { judge, startDate, endDate, suggestions };
  }

  #today() {
    const now = this.#clock?.now?.() ?? new Date();
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: this.#timezone }).format(now);
    } catch {
      return now.toISOString().slice(0, 10);
    }
  }
}

export default LifeEventSuggester;
