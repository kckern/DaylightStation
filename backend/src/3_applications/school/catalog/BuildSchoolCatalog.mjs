import { AssignedLearningCatalogAccessPolicy } from '../services/AssignedLearningCatalogAccessPolicy.mjs';
import { GetLearningCatalog } from '../GetLearningCatalog.mjs';
import { BuildLearningLesson } from './BuildLearningLesson.mjs';
import { createCoreLearningModuleRegistry } from './LearningModuleRegistry.mjs';
import { ExerciseLibraryCatalogSource } from '../sources/ExerciseLibraryCatalogSource.mjs';
import { CompositeLearningCatalogRepository, CompositeLearningContentRepository } from '../sources/CompositeLearningRepositories.mjs';

const inert = (reason) => Object.freeze({
  wired: false, reason, catalogs: null, content: null, moduleRegistry: null,
  lessonBundles: null, accessPolicy: null, query: null, diagnostics: Object.freeze({}),
});

/** Application policy for authored/generated precedence and catalog degradation. */
export class BuildSchoolCatalog {
  constructor({ logger = console } = {}) { this.logger = logger; }

  execute({ projection, authoredCatalogs, authoredContent, assignments, learnerDirectory, exerciseLibrary = null }) {
    if (!projection?.enabled) return inert(projection?.reason || 'School Catalog is disabled');
    try {
      const generated = this.#generated({ exerciseLibrary, config: projection.config });
      const catalogs = generated.length
        ? new CompositeLearningCatalogRepository({ sources: [authoredCatalogs, ...generated], logger: this.logger })
        : authoredCatalogs;
      const content = generated.length
        ? new CompositeLearningContentRepository({ sources: [authoredContent, ...generated], logger: this.logger })
        : authoredContent;
      const moduleRegistry = createCoreLearningModuleRegistry();
      const lessonBundles = new BuildLearningLesson({ catalogs, content, modules: moduleRegistry });
      const accessPolicy = new AssignedLearningCatalogAccessPolicy({ assignments, config: projection.config.access ?? null });
      return Object.freeze({
        wired: true, reason: null, catalogs, content, moduleRegistry, lessonBundles, accessPolicy,
        query: new GetLearningCatalog({ catalogs, lessonBundles, access: accessPolicy, learners: learnerDirectory }),
        diagnostics: Object.freeze({
          contentRoot: projection.contentRoot,
          catalogDirectories: Object.freeze(projection.catalogDirectories),
          documentDirectories: Object.freeze(projection.documentDirectories),
          questionBankDirectories: Object.freeze(projection.questionBankDirectories),
          deckDirectories: Object.freeze(projection.deckDirectories),
          actionDirectories: Object.freeze(projection.actionDirectories),
          generatedSources: Object.freeze(generated.map((source) => source.catalogId)),
        }),
      });
    } catch (error) {
      this.logger.error?.('school.catalog.wiring-failed', { error: error.message });
      return inert(error.message);
    }
  }

  #generated({ exerciseLibrary, config }) {
    const settings = config.exercise_library ?? null;
    if (!exerciseLibrary || !settings || settings.enabled === false) return [];
    try {
      return [new ExerciseLibraryCatalogSource({
        exerciseLibrary,
        logger: this.logger,
        ...(settings.catalog_id ? { catalogId: settings.catalog_id } : {}),
        ...(settings.title ? { title: settings.title } : {}),
        ...(Number.isInteger(settings.max_examples_per_muscle) ? { maxExamples: settings.max_examples_per_muscle } : {}),
      })];
    } catch (error) {
      this.logger.error?.('school.catalog.exercise-library.wiring-failed', { error: error.message });
      return [];
    }
  }
}
