/**
 * SubtitleCueReview: a second opinion on subtitle word-list mute cues, for a grown-up.
 *
 * The word list (srt-mutes) decides what is muted, and it mutes every listed word.
 * This service asks a typed-decision model (IDecisionGateway, e.g. Jev) how
 * each flagged word is used in its line (with the lines either side for
 * context) and how offensive it is. It never adds, removes or edits a cue.
 * Its output is a review queue: the word-list cue exactly as emitted, plus the
 * model's category/severity/confidence and the reasons a grown-up should look.
 *
 * Offline and batch: bounded concurrency, and any failure marks that one item.
 * No gateway means every item is listed for review, unjudged.
 */
import { choice, score } from '#apps/common/ports/IDecisionGateway.mjs';
import { SEVERITY_LEVELS, lineContext } from '#domains/content-filter/subtitleWords.mjs';

const NONE = 'none';

const GROUP_DESCRIPTIONS = Object.freeze({
  profanity: 'Swearing or cursing',
  blasphemy: "God's, Jesus's or Christ's name used as an exclamation or a curse",
  vulgarity: 'Crude sexual or bodily language',
  racial: 'A slur against a race or ethnicity',
  childish: 'Mild name-calling or a playground insult',
});
const NONE_DESCRIPTION = 'Not offensive here: the plain, innocent meaning (an animal, a place, a prayer, a ghost, a tool)';

const USE_INSTRUCTIONS = 'The word `word` was flagged in the subtitle `line`. `before` and `after` are the '
  + 'neighbouring subtitle lines, given only for context. How is `word` used in `line`?';
const SEVERITY_INSTRUCTIONS = 'How offensive is `word`, as used in `line`, for a child to hear?';
/** Rubric for SEVERITY_LEVELS, same order (low, medium, high). */
const SEVERITY_RUBRIC = Object.freeze([
  'Mild: a parent might let it pass for a young child',
  'Moderate: ordinary swearing a parent would want muted',
  'Severe: a strong curse, a slur, or crude sexual language',
]);

const REASONS = Object.freeze({
  notOffensive: 'not-offensive', categoryDiffers: 'category-differs', severityDiffers: 'severity-differs',
  lowConfidence: 'low-confidence', failed: 'model-failed', unavailable: 'model-unavailable',
});

const round3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

export class SubtitleCueReview {
  #gateway; #logger; #concurrency; #minConfidence; #timeoutMs;

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway; absent or unconfigured = review everything unjudged
   * @param {number} [deps.concurrency=4] - Max evaluations in flight
   * @param {number} [deps.minConfidence=0.7] - Category confidence below this is flagged
   * @param {number} [deps.timeoutMs=5000]
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, concurrency = 4, minConfidence = 0.7, timeoutMs = 5000, logger = console } = {}) {
    this.#gateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#concurrency = Math.max(1, Math.floor(Number(concurrency)) || 1);
    this.#minConfidence = Number.isFinite(minConfidence) ? minConfidence : 0.7;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  /** The two questions, over the word list's own groups plus `none`. */
  static questions(groups) {
    const options = Object.fromEntries(groups.map((g) => [g, GROUP_DESCRIPTIONS[g] ?? null]));
    options[NONE] = NONE_DESCRIPTION;
    return {
      use: choice(USE_INSTRUCTIONS, options),
      severity: score(SEVERITY_INSTRUCTIONS, [...SEVERITY_RUBRIC]),
    };
  }

  /**
   * @param {{ contentId?: string, title?: string, lines: Object[], hits: Object[], groups: string[] }} input
   * @returns {Promise<{ model: string|null, items: Object[], summary: Object }>}
   */
  async review({ contentId = null, title = null, lines, hits, groups }) {
    const startedAt = Date.now();
    const questions = this.#gateway ? SubtitleCueReview.questions(groups) : null;
    let model = null;
    const items = await mapBounded(hits, this.#concurrency, async (hit) => {
      const { item, model: answeredBy } = await this.#reviewHit(hit, lines, questions, { contentId, title });
      model = model ?? answeredBy;
      return item;
    });
    const summary = summarize(items);
    this.#logger.info?.('content-filter.cue-review.summary', { contentId, model, ms: Date.now() - startedAt, ...summary });
    return { model, items, summary };
  }

  async #reviewHit(hit, lines, questions, { contentId, title }) {
    const context = lineContext(lines, hit.lineIndex);
    const item = {
      cueId: hit.cueId, at: hit.in, word: hit.token, category: hit.category, severity: hit.severity,
      ...context, jev: null, status: 'review', reasons: [], decision: null,
    };
    if (!questions) {
      item.reasons.push(REASONS.unavailable);
      return { item, model: null };
    }
    const startedAt = Date.now();
    try {
      const result = await this.#gateway.evaluate({ title: title ?? '', word: hit.token, ...context }, questions,
        { timeout: this.#timeoutMs });
      const use = result.answers.use;
      const sev = result.answers.severity;
      const level = Math.min(SEVERITY_LEVELS.length - 1, Math.max(0, Math.round(sev.score)));
      item.jev = {
        category: use.choice, categoryConfidence: round3(use.confidence),
        severity: SEVERITY_LEVELS[level], severityScore: round3(sev.score), severityConfidence: round3(sev.confidence),
      };
      item.reasons = reasonsFor(hit, item.jev, this.#minConfidence);
      item.status = item.reasons.length ? 'review' : 'agree';
      this.#logger.debug?.('content-filter.cue-review.item', {
        contentId, cueId: hit.cueId, word: hit.token, listGroup: hit.group, listSeverity: hit.severity,
        ...item.jev, status: item.status, reasons: item.reasons, model: result.model, ms: Date.now() - startedAt,
      });
      return { item, model: result.model ?? null };
    } catch (error) {
      item.reasons.push(REASONS.failed);
      this.#logger.warn?.('content-filter.cue-review.failed', { contentId, cueId: hit.cueId, error: error.message, ms: Date.now() - startedAt });
      return { item, model: null };
    }
  }
}

function reasonsFor(hit, jev, minConfidence) {
  const reasons = [];
  if (jev.category === NONE) reasons.push(REASONS.notOffensive);
  else if (jev.category !== hit.group) reasons.push(REASONS.categoryDiffers);
  if (jev.severity !== hit.severity) reasons.push(REASONS.severityDiffers);
  if ((jev.categoryConfidence ?? 0) < minConfidence) reasons.push(REASONS.lowConfidence);
  return reasons;
}

function summarize(items) {
  const count = (pred) => items.filter(pred).length;
  const withReason = (r) => count((i) => i.reasons.includes(r));
  return {
    cues: items.length,
    agree: count((i) => i.status === 'agree'),
    review: count((i) => i.status === 'review'),
    notOffensive: withReason(REASONS.notOffensive),
    categoryDiffers: withReason(REASONS.categoryDiffers),
    severityDiffers: withReason(REASONS.severityDiffers),
    lowConfidence: withReason(REASONS.lowConfidence),
    failed: withReason(REASONS.failed),
    unavailable: withReason(REASONS.unavailable),
  };
}

/**
 * Carry a grown-up's filled-in `decision` from a previous review file onto a
 * fresh review, by cue id, only when that id still names the same word.
 * Returns new item objects; neither input is modified.
 */
export function carryForwardDecisions(items, previousItems) {
  const prior = new Map();
  for (const p of Array.isArray(previousItems) ? previousItems : []) {
    if (p?.cueId && p.decision != null) prior.set(p.cueId, p);
  }
  return items.map((item) => {
    const p = prior.get(item.cueId);
    return p && p.word === item.word ? { ...item, decision: p.decision } : item;
  });
}

/** Map with at most `limit` calls in flight; results keep input order. */
async function mapBounded(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export default SubtitleCueReview;
