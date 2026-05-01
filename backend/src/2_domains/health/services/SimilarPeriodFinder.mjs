/**
 * SimilarPeriodFinder (F-104)
 *
 * Pure scoring service. Given a current 30-day signature object and a list of
 * named historical periods (each with their own aggregated stats), returns a
 * ranked list of periods ordered by similarity to the signature.
 *
 * Stateless. No I/O, no fs, no network. The class wrapper exists for
 * dependency-injection consistency with sibling services and to allow
 * injection of a logger for "no matches found" warnings.
 *
 * Scoring algorithm (per dimension):
 *   score = 1 - min(1, abs(signature.x - period.stats.x) / SCALE[x])
 *
 * Composite score is the simple average of present-dimension scores. Missing
 * dimensions on either side are excluded from both numerator and denominator.
 *
 * Tied scores break deterministically by period name (lexicographic), giving
 * stable output across calls.
 *
 * @module domains/health/services/SimilarPeriodFinder
 */

const SCALES = {
  weight_avg_lbs: 30,
  weight_delta_lbs: 10,
  protein_avg_g: 100,
  calorie_avg: 1500,
  tracking_rate: 1,
};

const DIMENSIONS = Object.keys(SCALES);

export class SimilarPeriodFinder {
  /**
   * @param {object} [opts]
   * @param {object} [opts.logger] structured logger; falls back to console
   */
  constructor({ logger } = {}) {
    this.logger = logger || console;
  }

  /**
   * Rank periods by similarity to a signature.
   *
   * @param {object} args
   * @param {object} args.signature current 30-day aggregate (subset of DIMENSIONS)
   * @param {Array<{name: string, stats: object, from?: string, to?: string, description?: string}>} args.periods
   * @param {number} [args.maxResults=3]
   * @returns {Array<{name: string, score: number, dimensionScores: object, period: object}>}
   * @throws {TypeError} when signature is not an object or periods is not an array
   */
  findSimilar({ signature, periods, maxResults = 3 } = {}) {
    if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
      throw new TypeError('SimilarPeriodFinder.findSimilar: signature must be an object');
    }
    if (!Array.isArray(periods)) {
      throw new TypeError('SimilarPeriodFinder.findSimilar: periods must be an array');
    }

    if (periods.length === 0) {
      // Only warn when caller passed a signature with at least one usable
      // dimension — empty signature + empty periods is an unremarkable no-op.
      const hasUsableDim = DIMENSIONS.some(
        (d) => typeof signature[d] === 'number' && Number.isFinite(signature[d]),
      );
      if (hasUsableDim && this.logger?.warn) {
        this.logger.warn('similar_period.no_periods', {
          dimensionsPresent: DIMENSIONS.filter(
            (d) => typeof signature[d] === 'number' && Number.isFinite(signature[d]),
          ),
        });
      }
      return [];
    }

    const scored = periods.map((period) => this.#scorePeriod(signature, period));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.name || '').localeCompare(b.name || '');
    });

    return scored.slice(0, maxResults);
  }

  /**
   * Score a single period against the signature. Returns the match record.
   *
   * @param {object} signature
   * @param {{name: string, stats: object}} period
   * @returns {{name: string, score: number, dimensionScores: object, period: object}}
   */
  #scorePeriod(signature, period) {
    const stats = period?.stats || {};
    const dimensionScores = {};

    for (const dim of DIMENSIONS) {
      const sigVal = signature[dim];
      const periodVal = stats[dim];
      if (
        typeof sigVal !== 'number' || !Number.isFinite(sigVal)
        || typeof periodVal !== 'number' || !Number.isFinite(periodVal)
      ) {
        continue;
      }
      const scale = SCALES[dim];
      const diff = Math.abs(sigVal - periodVal);
      const score = 1 - Math.min(1, diff / scale);
      dimensionScores[dim] = score;
    }

    const present = Object.values(dimensionScores);
    const composite = present.length === 0
      ? 0
      : present.reduce((sum, s) => sum + s, 0) / present.length;

    return {
      name: period?.name,
      score: composite,
      dimensionScores,
      period,
    };
  }
}

export default SimilarPeriodFinder;
