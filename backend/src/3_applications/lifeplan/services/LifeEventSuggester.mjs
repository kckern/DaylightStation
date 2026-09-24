/**
 * LifeEventSuggester — suggests life events from recent calendar items for the
 * user to confirm. It writes nothing; the coach offers suggestions and records
 * only what the user confirms (add_life_event).
 *
 * Two judges:
 *   keyword  the domain LifeEventSignalDetector. Always runs. It is the answer
 *            when no decision model is configured, the mode is off, or the
 *            model fails.
 *   model    a typed-decision model (IDecisionGateway), asked one choice per
 *            calendar item: which life-event kind, or none.
 *
 * Modes (agents config → lifeplan_guide.life_event_signals.mode):
 *   shadow  (default) return keyword suggestions at once; ask the model detached
 *           (the answer never waits on it) and log
 *           per-item agreement (lifeplan.life-event.shadow);
 *   decide  return the model's suggestions (confidence ≥ minConfidence),
 *           chunks evaluated in parallel;
 *           keyword if any chunk fails;
 *   off     keyword only.
 *
 * Model trouble never throws out of suggest().
 */
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';
import {
  LifeEventSignalDetector, calendarItemsForDay, toSuggestion,
} from '#domains/lifeplan/services/LifeEventSignalDetector.mjs';

const MODES = new Set(['shadow', 'decide', 'off']);
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const DEFAULT_MIN_CONFIDENCE = 0.6;
const CHUNK = 20;
const LOGGED_SUMMARY_CHARS = 60;

export const LIFE_EVENT_OPTIONS = Object.freeze({
  none: 'Not a life event: routine meetings, appointments and checkups, errands, classes, social plans, trips, birthdays, holidays and yearly anniversaries',
  relocation: 'Moving home: moving day, a house closing, moving into a new apartment',
  job_change: 'Starting, leaving or losing a job, or a promotion: a first or last day at work, onboarding, a resignation',
  health_event: 'A significant health event: surgery, a hospital stay, a serious diagnosis. Not a routine appointment',
  family_event: 'A wedding, a birth, a death or funeral, a divorce, a child leaving home',
  education: 'Starting or finishing a school or program: graduation, orientation, an enrolment, a final exam',
  financial: 'A major financial event: retirement, buying a car, paying off a large debt, a bankruptcy',
});

const questionFor = (id) => choice(
  `What kind of life event, if any, does the calendar item \`${id}\` mark? `
  + 'Most calendar items are routine; answer none unless the item itself marks a lasting change in someone\'s life.',
  LIFE_EVENT_OPTIONS,
);

const nameKey = (s) => String(s || '').trim().toLowerCase();
const signalKey = (date, summary) => `${date}|${nameKey(summary)}`;
const summaryOf = (item) => String(item.summary || item.name || '');

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

/** What the model sees for one item. Never the description. */
const modelView = ({ date, item }) => ({
  date,
  summary: summaryOf(item).slice(0, 200),
  calendar: item.calendarName ?? null,
  allDay: !!item.allday,
  location: item.location ? String(item.location).slice(0, 100) : null,
});

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

  /** Whether the model is asked at all. */
  get modelActive() { return !!this.#decision && this.mode !== 'off'; }

  /**
   * @returns {Promise<{ judge: 'keyword'|'model', startDate: string, endDate: string, suggestions: Object[] }>}
   */
  async suggest(username, { days = DEFAULT_DAYS } = {}) {
    const span = Math.max(1, Math.min(Number.isFinite(days) ? Math.floor(days) : DEFAULT_DAYS, MAX_DAYS));
    const endDate = this.#today();
    const startDate = shiftDate(endDate, -(span - 1));
    const range = await this.#aggregator.aggregateRange(username, startDate, endDate);
    const items = collectItems(range?.days).map((it) => ({ ...it, keyword: this.#detector.classify(it.item) }));
    const recorded = this.#plans.load(username)?.life_events || [];
    const knownNames = new Set(recorded.map((e) => nameKey(e.name)).filter(Boolean));
    const knownSignals = new Set(recorded.flatMap((e) => (e.signals || [])
      .filter((sig) => sig?.date && sig?.summary)
      .map((sig) => signalKey(sig.date, sig.summary))));
    const isKnown = (s) => knownNames.has(nameKey(s.name)) || knownSignals.has(signalKey(s.date, s.name));

    let judge = 'keyword';
    let verdicts = null;
    if (this.modelActive && items.length) {
      if (this.mode === 'shadow') {
        // Shadow never delays the answer: the model runs detached and only logs.
        void this.#askModel(username, items)
          .then((asked) => asked && this.#logShadow(username, items, asked))
          .catch(() => {});
      } else {
        const asked = await this.#askModel(username, items);
        if (asked) {
          verdicts = asked.verdicts;
          this.#logShadow(username, items, asked);
          judge = 'model';
        }
      }
    }

    const suggestions = items.flatMap((it) => {
      if (judge === 'model') {
        const kind = this.#effectiveKind(verdicts[it.id]);
        return kind === 'none' ? [] : [toSuggestion(it.date, it.item, kind, verdicts[it.id].confidence, 'model')];
      }
      return it.keyword ? [toSuggestion(it.date, it.item, it.keyword.kind, it.keyword.confidence, 'keyword')] : [];
    }).filter((s) => !isKnown(s));

    this.#logger?.info?.('lifeplan.life-event.suggested', {
      username, mode: this.mode, judge, items: items.length, suggestions: suggestions.length,
    });
    return { judge, startDate, endDate, suggestions };
  }

  /** Called by the coach's writer after the user confirmed an event. */
  noteConfirmed(username, event) {
    const signal = event?.signals?.[0] || {};
    this.#logger?.info?.('lifeplan.life-event.confirmed', {
      username, type: event?.type ?? null, subtype: event?.subtype ?? null,
      detector: signal.detector ?? null, confidence: signal.confidence ?? null,
    });
  }

  #effectiveKind(verdict) {
    if (!verdict || verdict.kind === 'none' || verdict.confidence < this.minConfidence) return 'none';
    return verdict.kind;
  }

  /** All chunks (in parallel) or nothing: any failure or missing answer returns null. */
  async #askModel(username, items) {
    const startedAt = Date.now();
    try {
      const chunks = [];
      for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
      const results = await Promise.all(chunks.map((chunk) => {
        const state = Object.fromEntries(chunk.map((it) => [it.id, modelView(it)]));
        const questions = Object.fromEntries(chunk.map((it) => [it.id, questionFor(it.id)]));
        return this.#decision.evaluate(state, questions, { timeout: this.#timeoutMs });
      }));
      const verdicts = {};
      let model = null;
      chunks.forEach((chunk, n) => {
        const result = results[n];
        model = result?.model ?? model;
        for (const it of chunk) {
          const answer = result?.answers?.[it.id];
          if (!answer || !Object.hasOwn(LIFE_EVENT_OPTIONS, answer.choice)) throw new Error(`no answer for ${it.id}`);
          verdicts[it.id] = { kind: answer.choice, confidence: Number(answer.confidence) || 0 };
        }
      });
      return { verdicts, model, ms: Date.now() - startedAt };
    } catch (error) {
      this.#logger?.warn?.('lifeplan.life-event.model-failed', {
        username, mode: this.mode, items: items.length, error: error.message, ms: Date.now() - startedAt,
      });
      return null;
    }
  }

  #logShadow(username, items, { verdicts, model, ms }) {
    let agreed = 0; let keywordHits = 0; let modelHits = 0;
    for (const it of items) {
      const keyword = it.keyword?.kind ?? 'none';
      const modelKind = this.#effectiveKind(verdicts[it.id]);
      const same = keyword === modelKind;
      if (same) agreed += 1;
      if (keyword !== 'none') keywordHits += 1;
      if (modelKind !== 'none') modelHits += 1;
      this.#logger?.info?.('lifeplan.life-event.shadow', {
        username, date: it.date, keyword, model: modelKind, confidence: verdicts[it.id].confidence, agreed: same,
        ...(same ? {} : { summary: summaryOf(it.item).slice(0, LOGGED_SUMMARY_CHARS) }),
      });
    }
    this.#logger?.info?.('lifeplan.life-event.shadow-summary', {
      username, mode: this.mode, items: items.length, keywordHits, modelHits,
      agreed, disagreed: items.length - agreed, model, ms,
    });
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
