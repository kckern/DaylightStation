/**
 * NutritionAuditTriage — decides whether a cleanup snapshot is worth an LLM audit.
 *
 * The nutrition auditor (an LLM agent) runs on every settled change to the
 * food log, and about a third of those runs find nothing to change. Triage
 * puts a cheap check in front of it:
 *
 *   1. code rules first — a pending capture always goes to the auditor, since
 *      completing stranded captures is part of its job;
 *   2. then a typed decision model answers yes/no gut-checks that code cannot
 *      (a garbled name, implausible calories for the food, a mismatched icon).
 *
 * Modes:
 *   shadow  assess and record the verdict, but always run the audit — the
 *           verdicts are compared with what the audit actually changed before
 *           anyone trusts the threshold;
 *   gate    skip the audit when triage says nothing needs attention;
 *   off     do nothing.
 *
 * Triage never blocks the audit by failing: any error means "audit".
 */

import { yesNo } from '#apps/common/ports/IDecisionGateway.mjs';

const MODES = new Set(['shadow', 'gate', 'off']);
const DEFAULT_THRESHOLD = 0.3;

// Only what a reviewer would look at; provenance and evidence blobs are noise here
const ROW_FIELDS = ['id', 'uuid', 'date', 'mealTime', 'name', 'label', 'icon', 'amount', 'unit', 'grams',
  'calories', 'protein', 'carbs', 'fat', 'kind', 'parentId'];

const QUESTIONS = {
  badName: yesNo(
    'Does any entry in `rows` or `pending` have a name (`name` or `label`) that is garbled, truncated, a raw code, or does not clearly name a food or drink?'),
  implausibleNutrition: yesNo(
    'Does any entry have calories or macros that look clearly implausible for its name and amount — for example off by about 10x, or a serving-unit mix-up?'),
  wrongIcon: yesNo(
    'Does any entry have an `icon` that clearly pictures a different kind of food than its name? Ignore "default".'),
  ungroupedDish: yesNo(
    'Are there ungrouped entries (`parentId` empty) logged together that are obviously parts of one dish and should be grouped?'),
  duplicateEntry: yesNo(
    'Does the same food appear twice at the same time in a way that looks like an accidental duplicate rather than two servings?'),
};

export class NutritionAuditTriage {
  #decisionGateway; #logger;

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {'shadow'|'gate'|'off'} [deps.mode='shadow']
   * @param {number} [deps.threshold=0.3] - Probability at or above which a question flags the snapshot
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, mode = 'shadow', threshold = DEFAULT_THRESHOLD, logger = console } = {}) {
    this.#decisionGateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.mode = MODES.has(mode) ? mode : 'shadow';
    this.threshold = Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD;
    this.#logger = logger;
  }

  /** Whether triage runs at all. */
  get active() { return !!this.#decisionGateway && this.mode !== 'off'; }

  /** Whether a "nothing to do" verdict may skip the audit. */
  get gating() { return this.active && this.mode === 'gate'; }

  /**
   * @param {{ rows: Object[], pending: Object[], fingerprint: string }} snapshot
   * @returns {Promise<null|{ needsAudit: boolean, reason: string, score: number|null, flags: Object<string, number>, model: string|null }>}
   *   null when triage is inactive or failed (callers audit as before)
   */
  async assess(snapshot) {
    if (!this.active) return null;

    if (snapshot.pending?.length) {
      return this.#verdict(snapshot, { needsAudit: true, reason: 'pending-capture', score: null, flags: {}, model: null });
    }
    if (!snapshot.rows?.length) {
      return this.#verdict(snapshot, { needsAudit: false, reason: 'empty', score: null, flags: {}, model: null });
    }

    try {
      const state = { rows: snapshot.rows.map(compactRow) };
      const result = await this.#decisionGateway.evaluate(state, QUESTIONS);
      const flags = Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => [id, answer.probability]));
      const score = Math.max(...Object.values(flags));
      return this.#verdict(snapshot, {
        needsAudit: score >= this.threshold,
        reason: score >= this.threshold ? Object.entries(flags).sort(([, a], [, b]) => b - a)[0][0] : 'clean',
        score, flags, model: result.model
      });
    } catch (error) {
      this.#logger.warn?.('nutrition.triage.failed', { fingerprint: snapshot.fingerprint, error: error.message });
      return null;
    }
  }

  #verdict(snapshot, verdict) {
    this.#logger.info?.('nutrition.triage.assessed', {
      mode: this.mode, threshold: this.threshold, fingerprint: snapshot.fingerprint,
      rows: snapshot.rows?.length ?? 0, pending: snapshot.pending?.length ?? 0, ...verdict
    });
    return verdict;
  }
}

function compactRow(row) {
  const out = {};
  for (const key of ROW_FIELDS) if (row[key] != null && row[key] !== '') out[key] = row[key];
  return out;
}

export default NutritionAuditTriage;
