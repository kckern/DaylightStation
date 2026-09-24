/**
 * HeadlineStoryJudge — a typed-decision second opinion on the Headlines briefing.
 *
 * HeadlineService#buildBriefing clusters cross-outlet titles by string
 * similarity (>= 0.72 against the cluster's lead title) and labels timeline
 * coverage with a keyword regex. Paraphrased headlines of one event score
 * 0.5-0.7 and stay apart; "Gemini Live API" reads as a live update. This judge
 * asks the decision model about exactly those cases:
 *
 *   - a pair in the ambiguous similarity band  → yesNo "same news event?"
 *   - a title shown in a story timeline        → choice of event kind
 *
 * It runs at harvest time, never on the request path. Verdicts are cached by
 * title pair and by title; the request path only reads the cache.
 *
 * Modes (user feed.yml `headlines.jev.mode`):
 *   shadow   ask and log beside the legacy verdict; the briefing is unchanged
 *   promote  the briefing merges band pairs and relabels titles from cached verdicts
 *   off      do nothing
 *
 * Any failure means "no verdict": the legacy clustering and label stand.
 */
import { yesNo, choice } from '#apps/common/ports/IDecisionGateway.mjs';

export const LEGACY_MATCH = 0.72;
export const EVENT_KINDS = ['live', 'update', 'correction', 'analysis', 'report'];
const LEGACY_EQUIVALENT = { live: 'update', update: 'update', correction: 'correction', analysis: 'report', report: 'report' };
const MODES = new Set(['shadow', 'promote', 'off']);
/** Consecutive model failures after which a pass stops asking. */
const BREAKER_FAILURES = 3;
const DEFAULTS = Object.freeze({ mode: 'shadow', bandLow: 0.5, sameThreshold: 0.6, labelConfidence: 0.6 });

const SAME_EVENT = {
  sameEvent: yesNo(
    'Do headlines `a.title` and `b.title` report the same specific news event (the same incident, announcement, ruling, or result), not merely the same topic, people, or ongoing story?',
    { yes: 'Both outlets are covering one specific event.', no: 'Different events, or only the same broad topic or people.' }),
};

const EVENT_KIND = {
  kind: choice('What kind of coverage is the headline `title`?', {
    live: 'Breaking news, or a live blog / live coverage page',
    update: 'A follow-up or update to an already-reported story',
    correction: 'A correction or retraction of earlier reporting',
    analysis: 'Analysis, opinion, editorial, explainer, or commentary',
    report: 'A straight news report of an event',
  }),
};

const pickSame = answers => (Number.isFinite(answers?.sameEvent?.probability) ? answers.sameEvent : null);
const pickKind = answers => (EVENT_KINDS.includes(answers?.kind?.choice) ? answers.kind : null);
const unit = (value, fallback) => (Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback);
const round = value => Math.round(value * 1000) / 1000;

export class HeadlineStoryJudge {
  #decision; #logger; #timeoutMs; #maxCalls; #cacheMax;
  #pairs = new Map();
  #labels = new Map();

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway; absent/unconfigured = inactive
   * @param {Object} [deps.logger]
   * @param {number} [deps.timeoutMs=3000] - Per-question request timeout
   * @param {number} [deps.maxCallsPerReview=80] - Model calls allowed per pass (see beginPass)
   * @param {number} [deps.cacheMax=5000] - Entries kept per cache (pairs, labels), oldest evicted first
   */
  constructor({ decisionGateway = null, logger = console, timeoutMs = 3000, maxCallsPerReview = 80, cacheMax = 5000 } = {}) {
    this.#decision = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
    this.#maxCalls = maxCallsPerReview;
    this.#cacheMax = cacheMax;
  }

  /** Normalize the user's `headlines.jev` block. */
  static settings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const bandLow = unit(r.band_low, DEFAULTS.bandLow);
    return {
      mode: MODES.has(r.mode) ? r.mode : DEFAULTS.mode,
      bandLow: bandLow < LEGACY_MATCH ? bandLow : DEFAULTS.bandLow,
      sameThreshold: unit(r.same_threshold, DEFAULTS.sameThreshold),
      labelConfidence: unit(r.label_confidence, DEFAULTS.labelConfidence),
    };
  }

  static pairKey(normA, normB) {
    const a = String(normA || ''); const b = String(normB || '');
    return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
  }

  static labelKey(title) {
    return String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  active(settings) { return !!this.#decision && !!settings && MODES.has(settings.mode) && settings.mode !== 'off'; }
  promoting(settings) { return this.active(settings) && settings.mode === 'promote'; }

  cachedPair(normA, normB) { return this.#pairs.get(HeadlineStoryJudge.pairKey(normA, normB)) ?? null; }
  cachedLabel(title) { return this.#labels.get(HeadlineStoryJudge.labelKey(title)) ?? null; }

  /** Request-path read: merge this band pair? Only cached verdicts count; never calls the model. */
  sameEvent(normA, normB, settings) {
    if (!this.promoting(settings)) return false;
    const hit = this.cachedPair(normA, normB);
    return !!hit && hit.probability >= settings.sameThreshold;
  }

  /** Request-path read: the Jev kind for a title, or null to keep the legacy label. */
  eventKind(title, settings) {
    if (!this.promoting(settings)) return null;
    const hit = this.cachedLabel(title);
    return hit && hit.confidence >= settings.labelConfidence ? hit.choice : null;
  }

  /**
   * Start a pass: one call budget and one failure breaker shared by every
   * review() call that receives it (a page's pair pass and label pass).
   * @param {number} [budget] - Model calls allowed; defaults to maxCallsPerReview
   */
  beginPass(budget = this.#maxCalls) {
    return { budget, consecutiveFailures: 0, breakerOpen: false, seenPairs: new Set() };
  }

  /**
   * Ask the model about uncached pairs and titles in a briefing trace. Never throws.
   * @param {{ pageId?: string, pairs: Object[], titles: Object[] }} trace
   * @param {ReturnType<typeof HeadlineStoryJudge.settings>} settings
   * @param {ReturnType<HeadlineStoryJudge['beginPass']>} [pass] - Shared budget/breaker; a fresh pass by default
   */
  async review(trace, settings, pass = this.beginPass()) {
    const page = trace?.pageId ?? null;
    const pairs = trace?.pairs ?? [];
    const titles = trace?.titles ?? [];
    const summary = { page, mode: settings?.mode ?? null, pairs: pairs.length, titles: titles.length, evaluated: 0, cached: 0, failed: 0, skipped: 0 };
    if (!this.active(settings)) return summary;

    for (const pair of pairs) {
      const key = HeadlineStoryJudge.pairKey(pair.normA, pair.normB);
      // A pair already handled in this pass (cached, asked, or failed) is neither
      // re-asked nor re-counted: the label pass re-sees the pair pass's pairs.
      if (pass.seenPairs.has(key)) continue;
      pass.seenPairs.add(key);
      if (this.#pairs.has(key)) { summary.cached++; continue; }
      if (!this.#spend(pass)) { summary.skipped++; continue; }
      const got = await this.#ask({ a: pair.a, b: pair.b }, SAME_EVENT, pickSame,
        'feed.headlines.jev-pair-failed', { page, a: pair.a?.title, b: pair.b?.title });
      this.#settle(pass, !!got, page);
      if (!got) { summary.failed++; continue; }
      const record = { probability: got.answer.probability, model: got.model };
      this.#remember(this.#pairs, key, record);
      summary.evaluated++;
      const jevSame = record.probability >= settings.sameThreshold;
      this.#logger.info?.('feed.headlines.jev-pair', {
        page, mode: settings.mode, similarity: round(pair.similarity),
        a: pair.a?.title, aSource: pair.a?.source, b: pair.b?.title, bSource: pair.b?.source,
        jevProbability: record.probability, jevSame, legacySame: false, agreed: !jevSame,
        model: got.model, ms: got.ms,
      });
    }

    for (const item of titles) {
      const key = HeadlineStoryJudge.labelKey(item.title);
      if (!key) continue;
      if (this.#labels.has(key)) { summary.cached++; continue; }
      if (!this.#spend(pass)) { summary.skipped++; continue; }
      const got = await this.#ask({ title: item.title, source: item.source }, EVENT_KIND, pickKind,
        'feed.headlines.jev-label-failed', { page, title: item.title });
      this.#settle(pass, !!got, page);
      if (!got) { summary.failed++; continue; }
      const record = { choice: got.answer.choice, confidence: Number.isFinite(got.answer.confidence) ? got.answer.confidence : 0, model: got.model };
      this.#remember(this.#labels, key, record);
      summary.evaluated++;
      this.#logger.info?.('feed.headlines.jev-label', {
        page, mode: settings.mode, title: item.title, source: item.source,
        legacyKind: item.legacyKind, jevKind: record.choice, jevConfidence: record.confidence,
        probabilities: got.answer.probabilities ?? null,
        agreed: LEGACY_EQUIVALENT[record.choice] === item.legacyKind,
        model: got.model, ms: got.ms,
      });
    }
    return summary;
  }

  /** Take one call from the pass, or false when the budget is spent or the breaker is open. */
  #spend(pass) {
    if (pass.breakerOpen || pass.budget <= 0) return false;
    pass.budget--;
    return true;
  }

  /** Track consecutive failures; open the breaker (logged once) at BREAKER_FAILURES. */
  #settle(pass, ok, page) {
    if (ok) { pass.consecutiveFailures = 0; return; }
    pass.consecutiveFailures++;
    if (!pass.breakerOpen && pass.consecutiveFailures >= BREAKER_FAILURES) {
      pass.breakerOpen = true;
      this.#logger.warn?.('feed.headlines.jev-breaker-open', { page, failures: pass.consecutiveFailures });
    }
  }

  async #ask(state, questions, pick, failEvent, context) {
    const started = Date.now();
    try {
      const result = await this.#decision.evaluate(state, questions, { timeout: this.#timeoutMs });
      const answer = pick(result?.answers);
      if (!answer) throw new Error('decision model returned no usable answer');
      return { answer, model: result.model ?? null, ms: Date.now() - started };
    } catch (error) {
      this.#logger.warn?.(failEvent, { ...context, error: error.message, ms: Date.now() - started });
      return null;
    }
  }

  #remember(map, key, value) {
    if (map.size >= this.#cacheMax) map.delete(map.keys().next().value);
    map.set(key, value);
  }
}

export default HeadlineStoryJudge;
