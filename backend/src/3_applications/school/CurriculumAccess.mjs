/**
 * Read-side access to the published curriculum, validated (spec §3).
 *
 * Every lifecycle use case needs the same three things — "give me unit X",
 * "give me its document", "give me its media manifest" — and every one of them
 * needs those things VALIDATED, because `validateUnit` resolves cross-references
 * against sets the caller supplies. Building those sets is a whole-catalog read,
 * and doing it independently in five use cases would mean five catalog scans per
 * barcode scan.
 *
 * So this is one collaborator, constructed once in the composition root and
 * injected everywhere. It is not a port: it owns no I/O of its own and adds no
 * new external contract — it reads through `ICurriculumCatalog` and applies the
 * domain validators. (`ValidateCatalog` deliberately does NOT use it: the
 * promotion gate must report on everything on disk, including the drafts and
 * broken files this class filters out.)
 *
 * PUBLISHABLE ONLY. `listUnits`/`getUnit` serve approved units; a draft sitting
 * in the tree is invisible to a child at the printer, which is the entire point
 * of the promotion boundary.
 *
 * The snapshot is cached for a short TTL because a single scan fans out into
 * several use cases within milliseconds, and re-reading the catalog for each
 * would be the same answer three times. The TTL is short enough that a parent
 * who edits a unit sees it within a moment, without a restart.
 */
import { validateUnit, isPublishable } from '#domains/school/curriculum/unitValidation.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { validateManifest } from '#domains/school/curriculum/manifestValidation.mjs';
import { validateWork } from '#domains/school/curriculum/workValidation.mjs';

const DEFAULT_TTL_MS = 15_000;

export class CurriculumAccess {
  #catalog; #bankIds; #programIds; #surfaceValidators; #activityValidators; #ttlMs; #clock; #logger;
  #snapshot = null;
  #loading = null;

  /**
   * @param {object} deps
   * @param {import('./ports/ICurriculumCatalog.mjs').ICurriculumCatalog} deps.catalog
   * @param {() => Iterable<string>} [deps.bankIds] - ids of every question bank that exists;
   *   a function because banks warm asynchronously and the set changes without a restart
   * @param {() => Iterable<string>} [deps.programIds] - ids of every program that exists
   *   (Task 12 supplies real ids; default empty means no unit can be a program unit yet)
   * @param {() => Map<string, Function>} [deps.surfaceValidators] - surface id →
   *   that surface's own `validateAction`, the same registered-adapter set
   *   `DoNowService` dispatches through; default empty means no unit can carry
   *   a `launch:` block yet
   * @param {number} [deps.ttlMs]
   * @param {() => number} [deps.clock] - epoch ms, injected for deterministic tests
   * @param {object} [deps.logger]
   */
  constructor({
    catalog, bankIds = () => [], programIds = () => [], surfaceValidators = () => new Map(),
    activityValidators = () => new Map(),
    ttlMs = DEFAULT_TTL_MS, clock = () => Date.now(), logger = console,
  } = {}) {
    if (!catalog) throw new Error('CurriculumAccess requires a catalog');
    this.#catalog = catalog;
    this.#bankIds = typeof bankIds === 'function' ? bankIds : () => bankIds;
    this.#programIds = typeof programIds === 'function' ? programIds : () => programIds;
    this.#surfaceValidators = typeof surfaceValidators === 'function' ? surfaceValidators : () => surfaceValidators;
    this.#activityValidators = typeof activityValidators === 'function' ? activityValidators : () => activityValidators;
    this.#ttlMs = ttlMs;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** Drop the cache — for a parent who just edited a unit and wants it now. */
  invalidate() { this.#snapshot = null; }

  async #load() {
    const [units, documents, manifests, works] = await Promise.all([
      this.#catalog.listUnits(),
      this.#catalog.listDocuments(),
      this.#catalog.listManifests(),
      // Tolerated as absent: a catalog adapter predating work configs simply has
      // no listWorks, and a school with none is a school that has not written
      // them yet — neither is a reason to fail every other read.
      this.#catalog.listWorks?.() ?? { items: [], errors: [] },
    ]);

    const validDocuments = new Map();
    (documents.items ?? []).forEach(({ id, raw }) => {
      const { errors, document } = validateDocument(raw);
      if (!errors.length) validDocuments.set(id, document);
    });
    const validManifests = new Map();
    (manifests.items ?? []).forEach(({ id, raw }) => {
      const { errors, manifest } = validateManifest(raw);
      if (!errors.length) validManifests.set(id, manifest);
    });

    const surfaceValidators = this.#surfaceValidators();
    const activityValidators = this.#activityValidators();
    const sets = {
      bankIds: new Set(this.#bankIds() ?? []),
      documentIds: new Set(validDocuments.keys()),
      manifestIds: new Set(validManifests.keys()),
      programIds: new Set(this.#programIds() ?? []),
      surfaceValidators: surfaceValidators instanceof Map ? surfaceValidators : new Map(),
      activityValidators: activityValidators instanceof Map ? activityValidators : new Map(),
    };

    const validUnits = new Map();
    const errors = [];
    // A draft is not an error — it is simply not for a learner yet. But it is
    // dropped from what this class serves just the same, and a silent drop
    // here is exactly what sent the planner.mjs investigation into loaders,
    // manifests and schemas instead of `reviewState`: the only downstream
    // symptom was "assigned but no published units belong to it", which names
    // the wrong cause. Logging it beside invalid-units, same level and shape,
    // is what keeps the real cause visible instead of relocated.
    const droppedDraftIds = [];
    (units.items ?? []).forEach(({ id, raw }) => {
      const result = validateUnit(raw, sets);
      if (result.errors.length) { errors.push(`units/${id}: ${result.errors.join('; ')}`); return; }
      if (isPublishable(result.unit)) validUnits.set(id, result.unit);
      else droppedDraftIds.push(id);
    });
    if (errors.length) this.#logger.warn?.('school.curriculum.invalid-units', { count: errors.length, errors });
    if (droppedDraftIds.length) {
      this.#logger.warn?.('school.curriculum.drafts-dropped', { count: droppedDraftIds.length, ids: droppedDraftIds });
    }

    // Works are validated against the shelf and folder they were found in, which
    // is the only check that can catch a config claiming to be somewhere it is
    // not. An invalid one is dropped and logged rather than served half-read:
    // downstream reads `grading` and `structure` to decide what a child does.
    const validWorks = new Map();
    const workErrors = [];
    (works.items ?? []).forEach(({ id, subject, work, raw }) => {
      const result = validateWork(raw, { subject, work });
      if (result.errors.length) workErrors.push(`works/${id}: ${result.errors.join('; ')}`);
      else validWorks.set(id, result.work);
    });
    if (workErrors.length) this.#logger.warn?.('school.curriculum.invalid-works', { count: workErrors.length, errors: workErrors });

    return {
      units: validUnits, documents: validDocuments, manifests: validManifests,
      works: validWorks, at: this.#clock(),
    };
  }

  async #current() {
    if (this.#snapshot && this.#clock() - this.#snapshot.at < this.#ttlMs) return this.#snapshot;
    // Deduped: several use cases woken by one scan share a single catalog read.
    if (!this.#loading) {
      this.#loading = this.#load()
        .then((snapshot) => { this.#snapshot = snapshot; return snapshot; })
        .finally(() => { this.#loading = null; });
    }
    return this.#loading;
  }

  /** @returns {Promise<object[]>} every valid work config, normalised */
  async listWorks() {
    return [...(await this.#current()).works.values()];
  }

  /**
   * @param {string} id - `<subject>/<work>`
   * @returns {Promise<object|null>}
   */
  async getWork(id) {
    return (await this.#current()).works.get(id) ?? null;
  }

  async getCoursePoster(courseId) {
    return this.#catalog.getCoursePoster?.(courseId) ?? null;
  }

  /** @returns {Promise<object[]>} every publishable unit, normalised */
  async listUnits() {
    return [...(await this.#current()).units.values()];
  }

  /** @returns {Promise<object|null>} */
  async getUnit(unitId) {
    return (await this.#current()).units.get(unitId) ?? null;
  }

  /** @returns {Promise<object|null>} */
  async getDocument(documentId) {
    return (await this.#current()).documents.get(documentId) ?? null;
  }

  /** @returns {Promise<object|null>} */
  async getManifest(manifestId) {
    return (await this.#current()).manifests.get(manifestId) ?? null;
  }

  /**
   * A unit as a PARENT SURFACE may see it: what it is and what it teaches.
   *
   * Not the whole unit, on purpose. `review` holds the marking rubric AND the
   * answer key, and these summaries are served over an HTTP route as reachable
   * as every other one on this console — a catalog listing that handed out the
   * answers to the sheet a child is holding would be a worse defect than the
   * missing titles it fixes. The artefact refs are left out for the same reason:
   * knowing a unit HAS a bank is useful, knowing which one is a lookup key.
   *
   * @param {object} unit
   * @returns {{unitId: string, title: string, subject: string, objectives: string[],
   *            courseId: string|null, sequence: number|null, grades: string[],
   *            passingPercent: number|null, hasBank: boolean, hasDocument: boolean,
   *            hasMedia: boolean, hasActivity: boolean}}
   */
  static summarise(unit, courseTitle = null) {
    return {
      unitId: unit.unitId,
      title: unit.title,
      subject: unit.subject,
      objectives: [...(unit.objectives ?? [])],
      courseId: unit.courseId ?? null,
      // A course id is an internal join key, never a display label.  Teacher
      // surfaces need the resolved title to name an assignment or enrollment
      // without guessing from a slug.
      courseTitle: courseTitle ?? null,
      sequence: unit.sequence ?? null,
      module: unit.module ?? null,
      grades: [...(unit.grades ?? [])],
      passingPercent: unit.passing?.percent ?? null,
      hasBank: Boolean(unit.bank),
      hasDocument: Boolean(unit.document),
      hasMedia: Boolean(unit.media),
      hasActivity: Boolean(unit.activity),
    };
  }

  /** @returns {Promise<object[]>} every publishable unit, summarised */
  async listUnitSummaries() {
    const current = await this.#current();
    return [...current.units.values()].map((unit) => CurriculumAccess.summarise(
      unit,
      this.#courseFor(current, unit.courseId)?.title ?? null,
    ));
  }

  /** @returns {Promise<object|null>} null for an unknown or unpublished unit */
  async getUnitSummary(unitId) {
    const current = await this.#current();
    const unit = current.units.get(unitId) ?? null;
    return unit ? CurriculumAccess.summarise(unit, this.#courseFor(current, unit.courseId)?.title ?? null) : null;
  }

  // Unit authors historically used both `course` and `subject/course` ids.
  // The full curriculum model already accepts either for its join; its public
  // summary must do the same or title-bearing responses disappear depending
  // on which harmless spelling an author chose.
  #courseFor(current, courseId) {
    if (!courseId) return null;
    return current.works.get(courseId)
      ?? [...current.works.values()].find((work) => work.work === courseId
        || `${work.subject}/${work.work}` === courseId)
      ?? null;
  }
}

export default CurriculumAccess;
