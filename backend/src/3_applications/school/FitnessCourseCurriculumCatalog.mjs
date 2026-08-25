/**
 * Projects School-authored Fitness course configs into the ordinary curriculum
 * catalog port. Source outages use a durable last-known-good projection; a
 * never-compiled course remains unavailable and is reported by name.
 */
import { compileFitnessCourse, FITNESS_COURSE_SCHEMA } from '#domains/school/fitnessCourse.mjs';

const DEFAULT_TTL_MS = 15_000;

export class FitnessCourseCurriculumCatalog {
  #base; #source; #snapshots; #householdId; #clock; #ttlMs; #logger;
  #snapshot = null; #loading = null;

  constructor({ baseCatalog, sourceProvider, projectionStore = null, householdId = null,
    clock = () => Date.now(), ttlMs = DEFAULT_TTL_MS, logger = console } = {}) {
    if (!baseCatalog) throw new Error('FitnessCourseCurriculumCatalog requires baseCatalog');
    this.#base = baseCatalog;
    this.#source = sourceProvider;
    this.#snapshots = projectionStore;
    this.#householdId = householdId;
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#logger = logger;
  }

  invalidate() { this.#snapshot = null; }

  async #load() {
    const [baseUnits, baseWorks] = await Promise.all([this.#base.listUnits(), this.#base.listWorks()]);
    const authored = (baseWorks.items ?? []).filter((entry) => entry.raw?.schema === FITNESS_COURSE_SCHEMA);
    const works = (baseWorks.items ?? []).filter((entry) => entry.raw?.schema !== FITNESS_COURSE_SCHEMA);
    const units = [...(baseUnits.items ?? [])];
    const errors = [...(baseUnits.errors ?? []), ...(baseWorks.errors ?? [])];

    for (const entry of authored) {
      let projection = null;
      try {
        if (!this.#source?.getPlayableEpisodes) throw new Error('Fitness playable source is unavailable');
        // eslint-disable-next-line no-await-in-loop
        const source = await this.#source.getPlayableEpisodes(String(entry.raw.source?.showId ?? ''), this.#householdId);
        const compiled = compileFitnessCourse(entry.raw, source, { subject: entry.subject, work: entry.work });
        if (compiled.errors.length) throw new Error(compiled.errors.join('; '));
        projection = compiled.projection;
        // eslint-disable-next-line no-await-in-loop
        await this.#snapshots?.put?.(entry.work, projection);
        this.#logger.info?.('school.fitness-course.compiled', {
          work: entry.work, courseRevision: projection.courseRevision, units: projection.units.length,
        });
      } catch (error) {
        // eslint-disable-next-line no-await-in-loop
        const cached = await this.#snapshots?.get?.(entry.work);
        if (cached?.work && Array.isArray(cached.units)) {
          projection = cached;
          this.#logger.warn?.('school.fitness-course.snapshot-used', { work: entry.work, error: error.message });
        } else {
          errors.push(`works/${entry.id}: Fitness course unavailable (${error.message})`);
          this.#logger.warn?.('school.fitness-course.unavailable', { work: entry.work, error: error.message });
        }
      }
      if (!projection) continue;
      works.push({ id: entry.id, subject: entry.subject, work: entry.work, raw: projection.work });
      for (const raw of projection.units) units.push({ id: raw.unitId, raw });
    }
    return { at: this.#clock(), works: { items: works, errors }, units: { items: units, errors } };
  }

  async #current() {
    if (this.#snapshot && this.#clock() - this.#snapshot.at < this.#ttlMs) return this.#snapshot;
    if (!this.#loading) {
      this.#loading = this.#load().then((value) => { this.#snapshot = value; return value; })
        .finally(() => { this.#loading = null; });
    }
    return this.#loading;
  }

  async listUnits() { return (await this.#current()).units; }
  async listWorks() { return (await this.#current()).works; }
  async getUnit(id) { return (await this.listUnits()).items.find((entry) => entry.id === id)?.raw ?? null; }
  async getWork(id) { return (await this.listWorks()).items.find((entry) => entry.id === id)?.raw ?? null; }
  listDocuments(options) { return this.#base.listDocuments(options); }
  listManifests(options) { return this.#base.listManifests(options); }
  getDocument(id) { return this.#base.getDocument(id); }
  getManifest(id) { return this.#base.getManifest(id); }
  getCoursePoster(id) { return this.#base.getCoursePoster?.(id) ?? null; }
}

export default FitnessCourseCurriculumCatalog;

