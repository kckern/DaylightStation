import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import {
  lessonAddress,
  listCatalogLessons,
  validateLearningCatalog,
} from '#domains/school/catalog/index.mjs';

/** Surface-neutral authored Catalog query and hydrated Lesson lookup. */
export class GetLearningCatalog {
  #catalogs; #lessons; #access; #learners;

  constructor({ catalogs, lessonBundles, access = null, learners = null } = {}) {
    if (!catalogs || typeof catalogs.listCatalogs !== 'function'
        || typeof catalogs.getCatalog !== 'function'
        || !lessonBundles || typeof lessonBundles.execute !== 'function') {
      throw new Error('GetLearningCatalog requires catalog and lesson sources');
    }
    if (access !== null && typeof access?.resolve !== 'function') {
      throw new Error('GetLearningCatalog access must implement resolve');
    }
    if (learners !== null && typeof learners?.hasLearner !== 'function') {
      throw new Error('GetLearningCatalog learners must implement hasLearner');
    }
    this.#catalogs = catalogs;
    this.#lessons = lessonBundles;
    this.#access = access;
    this.#learners = learners;
  }

  async list({ learnerId = null } = {}) {
    await this.#validateLearner(learnerId);
    const catalogs = await this.#validatedCatalogs();
    const allowed = await this.#allowedAddresses(catalogs, learnerId);
    const visible = catalogs.map((catalog) => filterCatalog(catalog, allowed)).filter(Boolean);
    return Object.freeze({
      schema: 'school.catalog-index/v1',
      catalogs: Object.freeze(visible.map((catalog) => structuredClone(catalog))),
    });
  }

  async #validatedCatalogs() {
    const summaries = await this.#catalogs.listCatalogs();
    const catalogs = [];
    for (const summary of summaries) {
      // Sequential reads preserve mounted author order and deterministic
      // validation failures across filesystems.
      // eslint-disable-next-line no-await-in-loop
      const raw = await this.#catalogs.getCatalog(summary.catalogId);
      if (!raw) throw new EntityNotFoundError('School Catalog', summary.catalogId);
      const result = validateLearningCatalog(raw);
      if (result.errors.length) {
        throw new ValidationError(`School Catalog '${summary.catalogId}' is invalid: ${result.errors.join('; ')}`);
      }
      if (result.catalog.catalogId !== summary.catalogId) {
        throw new ValidationError(`School Catalog '${summary.catalogId}' declares catalogId '${result.catalog.catalogId}'`);
      }
      catalogs.push(result.catalog);
    }
    return catalogs;
  }

  async lesson({ learnerId = null, ...address } = {}) {
    await this.#validateLearner(learnerId);
    if (this.#access) {
      const catalogs = await this.#validatedCatalogs();
      const allowed = await this.#allowedAddresses(catalogs, learnerId);
      if (!allowed.has(lessonAddress(address))) {
        // Do not distinguish a hidden Lesson from a missing one at the API.
        throw new EntityNotFoundError('School Lesson', Object.values(address).join('/'));
      }
    }
    try {
      const bundle = await this.#lessons.execute(address);
      return Object.freeze({
        ...structuredClone(bundle),
        schema: 'school.learning-lesson/v1',
      });
    } catch (error) {
      // Only translate the address miss. A referenced bank/document miss is a
      // broken publication and must remain an operational validation error,
      // not be misreported to clients as an absent Lesson.
      if (/^School lesson '.+' was not found$/.test(error?.message ?? '')) {
        throw new EntityNotFoundError('School Lesson', Object.values(address).join('/'));
      }
      throw error;
    }
  }

  async #validateLearner(learnerId) {
    if (learnerId === null) return;
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId must be non-empty text');
    if (this.#learners && !(await this.#learners.hasLearner(learnerId))) {
      throw new ValidationError(`unknown learner: ${learnerId}`);
    }
  }

  async #allowedAddresses(catalogs, learnerId) {
    const lessons = catalogs.flatMap((catalog) => listCatalogLessons(catalog)
      .map(({ address, context }) => ({ address, context })));
    if (!this.#access) return new Set(lessons.map(({ address }) => address));
    const resolved = await this.#access.resolve({
      learners: learnerId === null ? [] : [{ learnerId }], lessons,
    });
    const addresses = learnerId === null
      ? resolved?.guest?.lessonAddresses
      : resolved?.learners?.find((entry) => entry.learnerId === learnerId)?.lessonAddresses;
    const known = new Set(lessons.map(({ address }) => address));
    if (!Array.isArray(addresses) || new Set(addresses).size !== addresses.length
        || addresses.some((address) => !known.has(address))) {
      throw new Error('Learning Catalog access policy returned an invalid projection');
    }
    return new Set(addresses);
  }
}

function filterCatalog(catalog, allowed) {
  const subjects = catalog.subjects.map((subject) => {
    const courses = subject.courses.map((course) => {
      const units = course.units.map((unit) => {
        const lessons = unit.lessons.filter((lesson) => allowed.has(lessonAddress({
          catalogId: catalog.catalogId,
          subjectId: subject.subjectId,
          courseId: course.courseId,
          unitId: unit.unitId,
          lessonId: lesson.lessonId,
        })));
        return lessons.length ? { ...unit, lessons } : null;
      }).filter(Boolean);
      return units.length ? { ...course, units } : null;
    }).filter(Boolean);
    return courses.length ? { ...subject, courses } : null;
  }).filter(Boolean);
  if (!subjects.length) return null;
  const installSets = (catalog.installSets ?? []).filter((set) => (
    set.lessonAddresses.every((address) => allowed.has(address))
  ));
  return {
    ...catalog,
    subjects,
    ...(catalog.installSets === undefined ? {} : { installSets }),
  };
}

export default GetLearningCatalog;
