import { ValidationError } from '#domains/core/errors/index.mjs';

const MODE_BY_MODULE = Object.freeze({
  problems: 'drill',
  flashcards: 'flashcard',
  quiz: 'quiz',
  learning_probe: 'learning_probe',
});

/**
 * Open tracked Catalog work from server-resolved content and context.
 *
 * The browser supplies only an address and redundant UI assertions. The
 * application re-resolves learner visibility and derives the bank, mode, and
 * evidence dimensions from the publication, preventing clients from forging
 * course/unit/lesson attribution.
 */
export class OpenCatalogLearningSession {
  #catalog; #grader;

  constructor({ catalog, grader } = {}) {
    if (!catalog || typeof catalog.lesson !== 'function'
        || !grader || typeof grader.openResolvedSession !== 'function') {
      throw new Error('OpenCatalogLearningSession requires Catalog and grading services');
    }
    this.#catalog = catalog;
    this.#grader = grader;
  }

  async execute({ learnerId = null, learning, bankId = null, mode = null, fresh = false } = {}) {
    const address = catalogModuleAddress(learning);
    const bundle = await this.#catalog.lesson({
      learnerId,
      catalogId: address.catalogId,
      subjectId: address.subjectId,
      courseId: address.courseId,
      unitId: address.unitId,
      lessonId: address.lessonId,
    });
    const module = bundle.lesson?.modules?.find(({ moduleId }) => moduleId === address.moduleId);
    if (!module) throw new ValidationError(`unknown Catalog module: ${address.moduleId}`);
    const resolvedMode = module.type === 'activity' && module.mechanic === 'timed_drill'
      ? 'drill'
      : MODE_BY_MODULE[module.type] ?? null;
    if (!resolvedMode || !module.bank) {
      throw new ValidationError(`Catalog module '${address.moduleId}' is not a tracked question session`);
    }
    if (mode !== null && mode !== resolvedMode) {
      throw new ValidationError(`Catalog module '${address.moduleId}' requires mode ${resolvedMode}`);
    }
    if (bankId !== null && bankId !== module.bank.id) {
      throw new ValidationError(`Catalog module '${address.moduleId}' does not use bank ${bankId}`);
    }
    return this.#grader.openResolvedSession({
      userId: learnerId,
      bankSnapshot: module.bank,
      mode: resolvedMode,
      learningContext: learningContext(bundle, module),
      // Catalog quizzes share QuizRunner's restart affordance, so the
      // deliberate-restart flag must survive this path too (Task 17).
      fresh: fresh === true,
    });
  }
}

function catalogModuleAddress(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('Catalog session learning address must be a mapping');
  }
  const address = {};
  for (const field of ['catalogId', 'subjectId', 'courseId', 'unitId', 'lessonId', 'moduleId']) {
    if (typeof raw[field] !== 'string' || !raw[field]) {
      throw new ValidationError(`Catalog session learning.${field} is required`);
    }
    address[field] = raw[field];
  }
  return address;
}

function learningContext(bundle, module) {
  const nodes = [
    bundle.context?.catalog,
    bundle.context?.subject,
    bundle.context?.course,
    bundle.context?.unit,
    bundle.lesson,
    module,
  ].filter(Boolean);
  return {
    catalogId: bundle.context.catalog.catalogId,
    subjectId: bundle.context.subject.subjectId,
    courseId: bundle.context.course.courseId,
    unitId: bundle.context.unit.unitId,
    lessonId: bundle.lesson.lessonId,
    moduleId: module.moduleId,
    areaIds: union(nodes, 'areaIds'),
    conceptIds: [...new Set(module.conceptIds ?? [])],
    classifications: union(nodes, 'classifications'),
    tags: union(nodes, 'tags'),
  };
}

function union(nodes, field) {
  return [...new Set(nodes.flatMap((node) => node[field] ?? []))];
}

export default OpenCatalogLearningSession;
