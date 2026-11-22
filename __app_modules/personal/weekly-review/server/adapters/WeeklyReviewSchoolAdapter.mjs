/**
 * Reads a household's school work for the weekly review through the port
 * School hands over (`schoolLearnerWork`): `list({ from, to })` for the
 * window's WorkItems and `image(ref)` for a course or activity picture.
 * Curation onto days is the domain's job (schoolWorkPolicy); this only fetches.
 */
export class WeeklyReviewSchoolAdapter {
  #schoolLearnerWork;
  #logger;

  constructor({ schoolLearnerWork, logger } = {}) {
    if (!schoolLearnerWork) throw new Error('WeeklyReviewSchoolAdapter requires schoolLearnerWork');
    this.#schoolLearnerWork = schoolLearnerWork;
    this.#logger = logger || null;
  }

  /**
   * @param {string} from first day, YYYY-MM-DD, inclusive
   * @param {string} toExclusive day after the last, YYYY-MM-DD
   * @returns {Promise<object[]>} WorkItems
   */
  async getWorkForDateRange(from, toExclusive) {
    const result = await this.#schoolLearnerWork.list({ from, to: toExclusive });
    const items = Array.isArray(result?.items) ? result.items : [];
    this.#logger?.debug?.('weekly-review.school.fetched', { from, to: toExclusive, items: items.length });
    return items;
  }

  /**
   * @param {string} ref `course:<id>` or `activity:<issuanceId>`
   * @returns {Promise<{ bytes: Buffer, contentType: string } | null>}
   */
  async getImage(ref) {
    const started = Date.now();
    const img = (await this.#schoolLearnerWork.image(ref)) || null;
    this.#logger?.debug?.('weekly-review.school.image', { ref, hit: !!img, ms: Date.now() - started });
    return img;
  }
}
