const NOOP_LOGGER = Object.freeze({});
const REF = /^(course|activity):(.+)$/;
const list = (value) => (Array.isArray(value) ? value : []);
const errorText = (err) => (err instanceof Error ? err.message : String(err));
const isBytes = (value) => Buffer.isBuffer(value) || value instanceof Uint8Array;

/**
 * GetLearnerWorkImage — the picture behind a learner work item's `imageUrl`
 * ref (domain/learnerWork.mjs):
 *
 *   course:<courseId>      the course poster (JPEG)
 *   activity:<issuanceId>  the solved first page of a printed activity (PNG),
 *                          rendered once from the platform's solution PDF and
 *                          cached as `<platform>-<externalId>.png`
 *
 * Anything it cannot serve is null (the route answers 404): an unknown or
 * malformed ref, a course without a poster, an issuance no learner holds, a
 * platform that is not wired or has no solution, or a render that fails.
 */
export class GetLearnerWorkImage {
  #learners;
  #curriculum;
  #printedActivities;
  #platforms;
  #renderPdfFirstPagePng;
  #cache;
  #logger;

  constructor({
    learners = null, curriculum = null, printedActivities = null, platforms = null,
    renderPdfFirstPagePng = null, cache = null, logger = NOOP_LOGGER,
  } = {}) {
    this.#learners = typeof learners === 'function' ? learners : null;
    this.#curriculum = curriculum;
    this.#printedActivities = printedActivities;
    this.#platforms = platforms instanceof Map ? platforms : new Map();
    this.#renderPdfFirstPagePng = typeof renderPdfFirstPagePng === 'function' ? renderPdfFirstPagePng : null;
    this.#cache = cache;
    this.#logger = logger ?? NOOP_LOGGER;
  }

  async execute(ref) {
    const match = typeof ref === 'string' ? REF.exec(ref) : null;
    if (!match) return null;
    const [, kind, id] = match;
    if (kind === 'course') return this.#coursePoster(id);
    return this.#activityPage(id);
  }

  async #coursePoster(courseId) {
    if (!this.#curriculum?.getCoursePoster) return null;
    try {
      const bytes = await this.#curriculum.getCoursePoster(courseId);
      return isBytes(bytes) ? { bytes, contentType: 'image/jpeg' } : null;
    } catch (err) {
      this.#logger.warn?.('school.course-poster.read-failed', { courseId, error: errorText(err) });
      return null;
    }
  }

  async #findIssuance(issuanceId) {
    if (!this.#learners || !this.#printedActivities) return null;
    for (const learner of list(await this.#learners())) {
      if (!learner?.id) continue;
      const found = list(await this.#printedActivities.listForLearner(learner.id))
        .find((i) => i?.issuanceId === issuanceId);
      if (found) return found;
    }
    return null;
  }

  async #activityPage(issuanceId) {
    const started = Date.now();
    try {
      const issuance = await this.#findIssuance(issuanceId);
      if (!issuance?.externalId) return null;
      const key = `${issuance.platform}-${issuance.externalId}.png`;
      const hit = this.#cache ? await this.#cache.read(key) : null;
      if (isBytes(hit)) {
        this.#logger.info?.('school.printed-activity.page-render', { issuanceId, cached: true, ms: Date.now() - started });
        return { bytes: hit, contentType: 'image/png' };
      }
      const platform = this.#platforms.get(issuance.platform);
      if (!platform?.getSolution || !this.#renderPdfFirstPagePng) return null;
      const pdf = await platform.getSolution(issuance.externalId);
      if (!pdf) return null;
      const png = await this.#renderPdfFirstPagePng(pdf, { width: 800 });
      if (!isBytes(png)) return null;
      if (this.#cache) await this.#cache.write(key, png);
      this.#logger.info?.('school.printed-activity.page-render', { issuanceId, cached: false, ms: Date.now() - started });
      return { bytes: png, contentType: 'image/png' };
    } catch (err) {
      this.#logger.warn?.('school.printed-activity.page-render-failed', { issuanceId, error: errorText(err) });
      return null;
    }
  }
}

export default GetLearnerWorkImage;
