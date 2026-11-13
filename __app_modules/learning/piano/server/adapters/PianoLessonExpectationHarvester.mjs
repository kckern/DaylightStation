import { IHarvester, HarvesterCategory } from '#apps/harvester/ports/IHarvester.mjs';

/**
 * PianoLessonExpectationHarvester — runs BuildLessonExpectations through the
 * unified scheduler (nightly) and `POST /api/v1/harvest/piano-lesson-expectations`
 * (`?limit=N&force=true`).
 */
export class PianoLessonExpectationHarvester extends IHarvester {
  #build;
  #logger;
  #lastError = null;
  #lastRun = null;

  constructor({ buildLessonExpectations, logger = console }) {
    super();
    if (!buildLessonExpectations) throw new Error('PianoLessonExpectationHarvester requires buildLessonExpectations');
    this.#build = buildLessonExpectations;
    this.#logger = logger;
  }

  get serviceId() { return 'piano-lesson-expectations'; }
  get category() { return HarvesterCategory.OTHER; }

  async harvest(_username, options = {}) {
    const force = options.force === true || options.force === 'true';
    const limit = Number(options.limit);
    try {
      const result = await this.#build().execute({ force, limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity });
      this.#lastRun = Date.now();
      this.#lastError = null;
      return { ...result, count: result.computed, status: result.failed > 0 ? 'partial' : 'success' };
    } catch (error) {
      this.#lastError = error.message;
      this.#logger.error?.('piano.lesson-expectation.harvest-failed', { error: error.message });
      throw error;
    }
  }

  getStatus() {
    return {
      state: this.#lastError ? 'open' : 'closed',
      failures: this.#lastError ? 1 : 0,
      lastFailure: this.#lastError ? this.#lastRun : null,
      cooldownUntil: null,
    };
  }
}

export default PianoLessonExpectationHarvester;
