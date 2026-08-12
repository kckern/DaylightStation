// backend/src/3_applications/school/sources/ExerciseLibraryCatalogSource.mjs
//
// Projects the shared exercise-reference corpus into the School LEARNING CATALOG
// (`school.catalog/v1`) and its reading content (`school.learning-document/v1`).
//
// WHY THE LEARNING CATALOG AND NOT `materials.sources`
// ----------------------------------------------------
// School has two disjoint pipelines and only one of them can render prose:
//
//   materials.sources -> GetMaterialUnits -> MaterialDetail -> SchoolMaterialPlayer
//       A unit id IS a Plex content id (SchoolMaterialPlayer.jsx: `const contentId
//       = unitId`). Every unit is handed to the shared Player. There is no text
//       unit, no reader branch, and no unit `type`.
//
//   learning catalog -> LearningCatalogBrowser -> SchoolApp.startLearning
//                    -> LearningContentReader
//       `lecture_notes` and `examples` are MODULE types (moduleValidation.mjs).
//       This is the pipeline built to render authored prose, and the one an
//       anatomy essay belongs in.
//
// So the corpus enters as a catalog + document repository pair, behind the two
// existing ports, and `SchoolApp.jsx` needs no change: it already dispatches
// `lecture_notes`/`examples` to `LearningContentReader`.
//
// THE PROJECTION
// --------------
//   muscle group (12)  -> unit          `anatomy/anatomy/muscles/<group>`
//   muscle (38)        -> lesson        one per muscle, inside its group's unit
//   muscle.fullDescription -> a `lecture_notes` document, one prose block per paragraph
//   exercises targeting the muscle -> an `examples` module (prompt + instruction steps)
//   equipment (29)     -> one `equipment` course holding a single guide lesson
//
// BLOCK TYPES ARE CHOSEN FOR WHAT THE READER ACTUALLY RENDERS. `LearningContentReader`
// renders `table`, `worked_example`, `formula`, and falls through to `<p>{block.text}</p>`
// for everything else — so `prose` and `heading` display their text, while `definition`
// (term/definition, no `text`) and `asset` (assetId/alt, no `text`) would validate but
// render BLANK. The corpus's "Gluteus Maximus: ..." lines are therefore prose, not
// `definition` blocks, and exercise demo images are omitted rather than emitted as
// invisible `asset` blocks. See the report note on images.
//
// FAIL-SOFT IS A HARD REQUIREMENT
// -------------------------------
// `GetLearningCatalog.#validatedCatalogs` THROWS when any catalog fails validation,
// which would take down the whole `/catalogs` endpoint for every other catalog too.
// An unavailable or empty corpus therefore publishes NOTHING (`listCatalogs()` -> [])
// rather than an empty-but-invalid catalog. `validateLearningCatalog` requires every
// list to be non-empty, so a group with no muscles, or a catalog with no groups, is
// dropped at the point it would become invalid.

import {
  validateLearningCatalog,
  validateLearningDocument,
} from '#domains/school/catalog/index.mjs';

/** Matches the domain's `ID` rule for catalog/unit/lesson/module/block identifiers. */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Matches the domain's `REFERENCE_ID` rule for documentIds. */
const REFERENCE_ID = /^[a-z0-9][a-z0-9:._/-]{0,127}$/;

export const DEFAULT_CATALOG_ID = 'anatomy';
export const DEFAULT_CATALOG_TITLE = 'Anatomy & Movement';
/**
 * Exercises shown per muscle. The corpus has up to 197 for a single muscle
 * (biceps); an `examples` module is a read-through list, not a browse rail, so
 * it is capped. Selection is the manifest's own slug order — deterministic, so
 * the same muscle always shows the same demonstrations.
 */
export const DEFAULT_MAX_EXAMPLES = 6;

const DOCUMENT_NAMESPACE = 'anatomy';
const EQUIPMENT_DOCUMENT_KEY = 'equipment';

/** Deterministic short hash, for the rare corpus slug too long to be an `ID`. */
function shortHash(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * A corpus slug as a domain `ID`.
 *
 * Three of the 1,296 exercise slugs exceed the 64-character limit
 * (`dumbbell-seated-biceps-curl-on-exercise-ball-with-leg-raised-single-arm`).
 * Truncating alone could collide two near-identical variants into one
 * `exampleId`, which validation rejects as a duplicate — so the truncation
 * carries a hash of the FULL slug and stays unique.
 */
export function toSafeId(slug, fallback) {
  if (typeof slug === 'string' && ID.test(slug)) return slug;
  const cleaned = String(slug ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '');
  if (ID.test(cleaned)) return cleaned;
  const stem = cleaned.slice(0, 50).replace(/-+$/, '');
  const candidate = `${stem}-${shortHash(String(slug ?? ''))}`;
  return ID.test(candidate) ? candidate : fallback;
}

/** Non-empty trimmed string, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Split a corpus essay into paragraphs.
 *
 * The corpus is inconsistent: 21 of the 38 essays separate paragraphs with a
 * SINGLE newline and the rest use a blank line, so splitting on `\n\n` alone
 * would collapse most essays into one 5,000-character block. Any run of
 * newlines is a break.
 */
export function toParagraphs(essay) {
  return String(essay ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** `{ description }` only when there is one — the header rule rejects an empty string. */
function optionalDescription(value) {
  const trimmed = text(value);
  return trimmed ? { description: trimmed } : {};
}

/**
 * One muscle's anatomy essay as a `school.learning-document/v1`.
 * Returns null when the muscle carries no prose (nothing to read).
 */
export function buildMuscleDocument(muscle) {
  const paragraphs = toParagraphs(muscle?.fullDescription);
  if (paragraphs.length === 0) return null;
  return {
    schema: 'school.learning-document/v1',
    documentId: muscleDocumentId(muscle.slug),
    title: text(muscle.name) ?? muscle.slug,
    blocks: paragraphs.map((paragraph, index) => ({
      blockId: `p${index + 1}`,
      type: 'prose',
      text: paragraph,
    })),
  };
}

/**
 * Every equipment type as one reference guide document.
 *
 * Each of the 29 records carries a full descriptive paragraph (not a one-liner),
 * so this is a readable guide rather than a table: a `heading` naming the item
 * followed by its `prose`. Returns null when no equipment has a description.
 */
export function buildEquipmentDocument(equipment) {
  const blocks = [];
  for (const item of equipment ?? []) {
    const name = text(item?.name) ?? text(item?.slug);
    const description = text(item?.description);
    if (!name || !description) continue;
    blocks.push({ blockId: `b${blocks.length + 1}`, type: 'heading', level: 2, text: name });
    blocks.push({ blockId: `b${blocks.length + 1}`, type: 'prose', text: description });
  }
  if (blocks.length === 0) return null;
  return {
    schema: 'school.learning-document/v1',
    documentId: equipmentDocumentId(),
    title: 'Equipment Guide',
    blocks,
  };
}

export function muscleDocumentId(slug) {
  return `${DOCUMENT_NAMESPACE}:${slug}`;
}

export function equipmentDocumentId() {
  return `${DOCUMENT_NAMESPACE}:${EQUIPMENT_DOCUMENT_KEY}`;
}

/** One exercise as an `examples` entry, or null when it has no usable steps. */
function toExample(exercise, index) {
  const steps = (exercise?.instructions ?? []).map(text).filter(Boolean);
  if (steps.length === 0) return null;
  const name = text(exercise?.name) ?? text(exercise?.slug);
  if (!name) return null;
  const description = text(exercise?.description);
  return {
    exampleId: toSafeId(exercise.slug, `example-${index + 1}`),
    prompt: description ? `${name} — ${description}` : name,
    steps,
  };
}

/**
 * Build the whole catalog tree. Pure: every corpus read is done by the caller and
 * handed in, so this function is exercised in tests without a repository at all.
 *
 * @returns {object|null} a `school.catalog/v1` mapping, or null when the corpus
 *   yields nothing publishable (no group with a muscle that has prose).
 */
export function buildAnatomyCatalog({
  groups = [],
  muscles = [],
  equipment = [],
  examplesByMuscle = () => [],
  catalogId = DEFAULT_CATALOG_ID,
  title = DEFAULT_CATALOG_TITLE,
  maxExamples = DEFAULT_MAX_EXAMPLES,
} = {}) {
  const musclesByGroup = new Map();
  for (const muscle of muscles) {
    if (!muscle?.slug || !muscle.group) continue;
    if (!musclesByGroup.has(muscle.group)) musclesByGroup.set(muscle.group, []);
    musclesByGroup.get(muscle.group).push(muscle);
  }

  const units = [];
  for (const group of groups) {
    const members = musclesByGroup.get(group?.slug) ?? [];
    const lessons = [];
    for (const muscle of members) {
      const lesson = buildMuscleLesson(muscle, examplesByMuscle, maxExamples);
      if (lesson) lessons.push(lesson);
    }
    // A unit with no lessons fails `validateUniqueList` — drop it rather than
    // publish a catalog that throws for every other catalog too.
    if (lessons.length === 0) continue;
    units.push({
      unitId: group.slug,
      title: text(group.name) ?? group.slug,
      ...optionalDescription(group.description),
      lessons,
    });
  }

  const courses = [];
  if (units.length > 0) {
    courses.push({ courseId: 'muscles', title: 'The Muscular System', units });
  }
  const equipmentCourse = buildEquipmentCourse(equipment);
  if (equipmentCourse) courses.push(equipmentCourse);
  if (courses.length === 0) return null;

  return {
    schema: 'school.catalog/v1',
    catalogId,
    title,
    subjects: [{ subjectId: 'anatomy', title: 'Anatomy', courses }],
  };
}

function buildMuscleLesson(muscle, examplesByMuscle, maxExamples) {
  // The essay IS the lesson. No prose means nothing for the reader to show, and
  // an `examples`-only lesson would be a bare exercise list filed under anatomy.
  if (toParagraphs(muscle.fullDescription).length === 0) return null;

  const modules = [{
    moduleId: 'notes',
    type: 'lecture_notes',
    title: text(muscle.name) ?? muscle.slug,
    documentId: muscleDocumentId(muscle.slug),
  }];

  const examples = [];
  const seen = new Set();
  for (const exercise of examplesByMuscle(muscle.slug) ?? []) {
    if (examples.length >= maxExamples) break;
    const example = toExample(exercise, examples.length);
    // Duplicate exampleIds fail validation; a collision after id-safening is
    // dropped rather than allowed to invalidate the catalog.
    if (!example || seen.has(example.exampleId)) continue;
    seen.add(example.exampleId);
    examples.push(example);
  }
  if (examples.length > 0) {
    modules.push({
      moduleId: 'exercises',
      type: 'examples',
      title: 'How it is trained',
      examples,
    });
  }

  return {
    lessonId: muscle.slug,
    title: text(muscle.name) ?? muscle.slug,
    ...optionalDescription(muscle.description),
    modules,
  };
}

function buildEquipmentCourse(equipment) {
  if (!buildEquipmentDocument(equipment)) return null;
  return {
    courseId: 'equipment',
    title: 'Training Equipment',
    units: [{
      unitId: 'equipment-guide',
      title: 'Equipment Guide',
      lessons: [{
        lessonId: 'equipment-guide',
        title: 'Equipment Guide',
        modules: [{
          moduleId: 'notes',
          type: 'lecture_notes',
          title: 'Equipment Guide',
          documentId: equipmentDocumentId(),
        }],
      }],
    }],
  };
}

/**
 * Corpus-backed School catalog + learning content, behind the two existing ports.
 *
 * Implements the `ILearningCatalogRepository` surface (`listCatalogs`/`getCatalog`)
 * and the `ILearningContentRepository` surface (`getDocument`/`getQuestionBank`/
 * `getLearningAction`) so it can be composed with the YAML repositories without
 * either side knowing about the other. It never extends those port base classes:
 * one object legitimately answers both, and the ports are duck-typed everywhere
 * they are consumed.
 *
 * The corpus repository is INJECTED — this is `3_applications/`, which may not
 * import `1_adapters/`.
 */
export class ExerciseLibraryCatalogSource {
  #library;
  #logger;
  #catalogId;
  #title;
  #maxExamples;
  #built = null; // { catalog, documents } — memoized projection

  constructor({
    exerciseLibrary,
    logger = null,
    catalogId = DEFAULT_CATALOG_ID,
    title = DEFAULT_CATALOG_TITLE,
    maxExamples = DEFAULT_MAX_EXAMPLES,
  } = {}) {
    if (!exerciseLibrary || typeof exerciseLibrary.listMuscles !== 'function') {
      throw new Error('ExerciseLibraryCatalogSource requires an exercise library repository');
    }
    // Fail-closed, but LOUDLY: a typo'd `catalog_id` still publishes (under the
    // default id) rather than withdrawing the shelf, but it says so — otherwise
    // the shelf silently appears at an address no config or link points to.
    const validCatalogId = typeof catalogId === 'string' && ID.test(catalogId);
    if (!validCatalogId) {
      logger?.warn?.('school.catalog.exercise-library.catalog-id-invalid', {
        configured: catalogId, using: DEFAULT_CATALOG_ID,
      });
    }
    const safeCatalogId = validCatalogId ? catalogId : DEFAULT_CATALOG_ID;
    this.#library = exerciseLibrary;
    this.#logger = logger;
    this.#catalogId = safeCatalogId;
    this.#title = text(title) ?? DEFAULT_CATALOG_TITLE;
    this.#maxExamples = Number.isInteger(maxExamples) && maxExamples > 0
      ? maxExamples : DEFAULT_MAX_EXAMPLES;
  }

  get catalogId() { return this.#catalogId; }

  /**
   * Build (once) and self-validate the projection.
   *
   * Validation runs HERE, not only in `BuildLearningLesson`, because an invalid
   * catalog reaching `GetLearningCatalog` throws and blanks the endpoint for every
   * catalog. A projection that fails its own schema is discarded with an error log
   * and the source publishes nothing — degraded, never destructive.
   */
  #build() {
    if (this.#built) return this.#built;
    this.#built = { catalog: null, documents: new Map() };
    try {
      const catalog = buildAnatomyCatalog({
        groups: this.#library.listGroups(),
        muscles: this.#library.listMuscles(),
        equipment: this.#library.listEquipment(),
        examplesByMuscle: (slug) => this.#exercisesForMuscle(slug),
        catalogId: this.#catalogId,
        title: this.#title,
        maxExamples: this.#maxExamples,
      });
      if (!catalog) {
        this.#logger?.warn?.('school.catalog.exercise-library.empty', {
          catalogId: this.#catalogId,
          reason: 'corpus produced no publishable lessons; run `exercise-library build`',
        });
        return this.#built;
      }

      const validated = validateLearningCatalog(catalog);
      if (validated.errors.length) {
        this.#logger?.error?.('school.catalog.exercise-library.invalid', {
          catalogId: this.#catalogId,
          errors: validated.errors.slice(0, 5),
          errorCount: validated.errors.length,
        });
        return this.#built;
      }

      const documents = this.#buildDocuments();
      this.#built = { catalog, documents };
      this.#logger?.info?.('school.catalog.exercise-library.published', {
        catalogId: this.#catalogId,
        lessons: countLessons(catalog),
        documents: documents.size,
      });
    } catch (error) {
      // A corpus read or projection bug must not take the catalog endpoint down.
      this.#logger?.error?.('school.catalog.exercise-library.failed', {
        catalogId: this.#catalogId, error: error.message,
      });
    }
    return this.#built;
  }

  /** Every document this catalog references, keyed by documentId and self-validated. */
  #buildDocuments() {
    const documents = new Map();
    const add = (document) => {
      if (!document) return;
      if (!REFERENCE_ID.test(document.documentId)) return;
      const result = validateLearningDocument(document);
      if (result.errors.length) {
        this.#logger?.warn?.('school.catalog.exercise-library.document-invalid', {
          documentId: document.documentId, errors: result.errors.slice(0, 3),
        });
        return;
      }
      documents.set(document.documentId, document);
    };
    for (const muscle of this.#library.listMuscles()) add(buildMuscleDocument(muscle));
    add(buildEquipmentDocument(this.#library.listEquipment()));
    return documents;
  }

  #exercisesForMuscle(slug) {
    const slugs = this.#library.listExerciseSlugsBy('muscle', slug) ?? [];
    const out = [];
    for (const exerciseSlug of slugs) {
      // Stop early: the cap is small and the bucket can hold ~200 slugs, so
      // materializing them all would be wasted work 97% of the time. A few extra
      // are taken so that exercises rejected for missing steps can be replaced.
      if (out.length >= this.#maxExamples * 3) break;
      const exercise = this.#library.getExercise(exerciseSlug);
      if (exercise) out.push(exercise);
    }
    return out;
  }

  // -- ILearningCatalogRepository -------------------------------------------

  async listCatalogs() {
    const { catalog } = this.#build();
    if (!catalog) return [];
    return [{ catalogId: catalog.catalogId, title: catalog.title }];
  }

  async getCatalog(catalogId) {
    const { catalog } = this.#build();
    if (!catalog || catalog.catalogId !== catalogId) return null;
    return structuredClone(catalog);
  }

  // -- ILearningContentRepository -------------------------------------------

  async getDocument(documentId) {
    const { documents } = this.#build();
    const found = documents.get(documentId);
    return found ? structuredClone(found) : null;
  }

  /** The corpus authors no assessments. Explicit so the composite can chain past it. */
  async getQuestionBank() { return null; }

  async getLearningAction() { return null; }
}

function countLessons(catalog) {
  let total = 0;
  for (const subject of catalog.subjects ?? []) {
    for (const course of subject.courses ?? []) {
      for (const unit of course.units ?? []) total += (unit.lessons ?? []).length;
    }
  }
  return total;
}

export default ExerciseLibraryCatalogSource;
