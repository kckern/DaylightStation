const NOOP_LOGGER = Object.freeze({});
const REF = /^(course|activity|program):(.+)$/;
/** Cache key parts become a file name: nothing that can climb out of the cache dir. */
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
const list = (value) => (Array.isArray(value) ? value : []);
const errorText = (err) => (err instanceof Error ? err.message : String(err));
const isBytes = (value) => Buffer.isBuffer(value) || value instanceof Uint8Array;

/**
 * GetLearnerWorkImage — the picture behind a learner work item's `imageUrl`
 * ref (domain/learnerWork.mjs):
 *
 *   course:<courseId>      the course poster (JPEG)
 *   activity:<issuanceId>  the solved first page of a printed activity (PNG),
 *                          rendered once from the platform's solution PDF (or,
 *                          when the page has no solution, e.g. tracing, its
 *                          printable PDF) and cached as `<platform>-<externalId>.png`
 *   program:<programId>:<instanceId>
 *                          a program instance's poster (JPEG), e.g. a
 *                          card-ladder package
 *
 * Anything it cannot serve is null (the route answers 404): an unknown or
 * malformed ref, a course without a poster, an issuance no learner holds, a
 * page not yet finished (or voided), an id unsafe as a file name, a
 * platform that is not wired or has neither solution nor printable, a
 * program poster that is missing, or a render that fails.
 */
export class GetLearnerWorkImage {
  #learners;
  #curriculum;
  #printedActivities;
  #platforms;
  #renderPdfFirstPagePng;
  #cache;
  #logger;
  /** cacheKey → in-flight render, so two requests for one page render it once. */
  #inFlight = new Map();

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
    if (kind === 'program') return this.#programPoster(id);
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

  async #programPoster(id) {
    const parts = id.split(':');
    if (parts.length !== 2 || !parts.every((p) => SAFE.test(p))) return null;
    const [programId, instanceId] = parts;
    if (!this.#curriculum?.getProgramPoster) return null;
    try {
      const bytes = await this.#curriculum.getProgramPoster(programId, instanceId);
      return isBytes(bytes) ? { bytes, contentType: 'image/jpeg' } : null;
    } catch (err) {
      this.#logger.warn?.('school.program-poster.read-failed', { programId, instanceId, error: errorText(err) });
      return null;
    }
  }

  async #findIssuance(issuanceId) {
    if (!this.#learners || !this.#printedActivities) return null;
    const learners = list(await this.#learners()).filter((l) => l?.id);
    const perLearner = await Promise.all(learners.map(async (learner) => list(
      await this.#printedActivities.listForLearner(learner.id),
    ).find((i) => i?.issuanceId === issuanceId) ?? null));
    return perLearner.find(Boolean) ?? null;
  }

  async #readCache(key, issuanceId) {
    if (!this.#cache) return null;
    try {
      const hit = await this.#cache.read(key);
      return isBytes(hit) ? hit : null;
    } catch (err) {
      this.#logger.warn?.('school.printed-activity.page-cache-read-failed', { issuanceId, error: errorText(err) });
      return null;
    }
  }

  async #activityPage(issuanceId) {
    const started = Date.now();
    try {
      const issuance = await this.#findIssuance(issuanceId);
      if (!issuance) return null;
      // The solution is the answer key: only a finished, kept page shows it.
      if (!issuance.completedStudyDay || issuance.voidedAt) {
        this.#logger.debug?.('school.printed-activity.page-not-finished', { issuanceId });
        return null;
      }
      const { platform, externalId } = issuance;
      if (!SAFE.test(String(platform ?? '')) || !SAFE.test(String(externalId ?? ''))) {
        this.#logger.debug?.('school.printed-activity.page-unsafe-key', { issuanceId });
        return null;
      }
      const key = `${platform}-${externalId}.png`;
      const hit = await this.#readCache(key, issuanceId);
      if (hit) {
        this.#logger.info?.('school.printed-activity.page-render', { issuanceId, cached: true, ms: Date.now() - started });
        return { bytes: hit, contentType: 'image/png' };
      }
      let render = this.#inFlight.get(key);
      if (!render) {
        render = this.#render(issuance, key, issuanceId).finally(() => this.#inFlight.delete(key));
        this.#inFlight.set(key, render);
      }
      const rendered = await render;
      if (!rendered) return null;
      this.#logger.info?.('school.printed-activity.page-render', {
        issuanceId, cached: false, source: rendered.source, ms: Date.now() - started,
      });
      return { bytes: rendered.png, contentType: 'image/png' };
    } catch (err) {
      this.#logger.warn?.('school.printed-activity.page-render-failed', { issuanceId, error: errorText(err) });
      return null;
    }
  }

  /**
   * The PDF to show: the solution, else the printable (pages with nothing to
   * solve, such as tracing or coloring, have no solution PDF). A printable
   * lookup that throws counts as absent.
   */
  async #pagePdf(platform, externalId, issuanceId) {
    const solution = platform.getSolution ? await platform.getSolution(externalId) : null;
    if (solution) return { pdf: solution, source: 'solution' };
    if (!platform.getPrintable) return null;
    try {
      const printable = await platform.getPrintable(externalId);
      return printable ? { pdf: printable, source: 'printable' } : null;
    } catch (err) {
      this.#logger.debug?.('school.printed-activity.page-no-printable', { issuanceId, error: errorText(err) });
      return null;
    }
  }

  /** Solution (or printable) PDF → first-page PNG → cache. Resolves null when there is nothing to show. */
  async #render(issuance, key, issuanceId) {
    const platform = this.#platforms.get(issuance.platform);
    if (!platform || !this.#renderPdfFirstPagePng) return null;
    const found = await this.#pagePdf(platform, issuance.externalId, issuanceId);
    if (!found) return null;
    const { pdf, source } = found;
    const png = await this.#renderPdfFirstPagePng(pdf, { width: 800 });
    if (!isBytes(png)) return null;
    if (this.#cache) {
      try {
        await this.#cache.write(key, png);
      } catch (err) {
        this.#logger.warn?.('school.printed-activity.page-cache-write-failed', { issuanceId, error: errorText(err) });
      }
    }
    return { png, source };
  }
}

export default GetLearnerWorkImage;
