/** Shared authored School Catalog wiring. This exists independently of any
 * calculator product or transport and may hydrate web, print, or device views. */
import path from 'node:path';
import {
  YamlLearningCatalogRepository,
  YamlLearningContentRepository,
} from '#adapters/school/catalog/index.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { AssignedLearningCatalogAccessPolicy } from '#adapters/school/config/AssignedLearningCatalogAccessPolicy.mjs';
import { GetLearningCatalog } from '#apps/school/GetLearningCatalog.mjs';
import { BuildLearningLesson } from '#apps/school/catalog/BuildLearningLesson.mjs';
import { createCoreLearningModuleRegistry } from '#apps/school/catalog/LearningModuleRegistry.mjs';
import { ExerciseLibraryCatalogSource } from '#apps/school/sources/ExerciseLibraryCatalogSource.mjs';
import {
  CompositeLearningCatalogRepository,
  CompositeLearningContentRepository,
} from '#apps/school/sources/CompositeLearningRepositories.mjs';

export function createSchoolCatalog({
  configService, householdId = null, learnerDirectory = null, logger = null,
  exerciseLibrary = null,
} = {}) {
  if (typeof configService?.getHouseholdAppConfig !== 'function'
      || typeof configService?.getDataDir !== 'function') {
    throw new Error('createSchoolCatalog requires a ConfigService');
  }
  const config = configService.getHouseholdAppConfig(householdId, 'school')?.catalog ?? {};
  if (config.enabled === false) return inert('school.yml catalog.enabled is false');
  try {
    const dataDirectory = configService.getDataDir();
    const contentRoot = resolveFromData(dataDirectory, config.content?.root ?? 'content/school/learning-catalog');
    const catalogDirectories = resolveDirectoryList(dataDirectory,
      config.content?.catalog_directories, [path.join(contentRoot, 'catalogs')], 'catalog.content.catalog_directories');
    const documentDirectories = resolveDirectoryList(dataDirectory,
      config.content?.document_directories, [path.join(contentRoot, 'documents')], 'catalog.content.document_directories');
    const questionBankDirectories = resolveDirectoryList(dataDirectory,
      config.content?.question_bank_directories, [path.join(contentRoot, 'question-banks')], 'catalog.content.question_bank_directories');
    const deckDirectories = resolveDirectoryList(dataDirectory,
      config.content?.flashcard_deck_directories, [path.join(contentRoot, 'flashcard-decks')], 'catalog.content.flashcard_deck_directories');
    const actionDirectories = resolveDirectoryList(dataDirectory,
      config.content?.action_directories, [path.join(contentRoot, 'actions')], 'catalog.content.action_directories');
    const authoredCatalogs = new YamlLearningCatalogRepository({ directories: catalogDirectories });
    const authoredContent = new YamlLearningContentRepository({
      documentDirectories, bankDirectories: questionBankDirectories, deckDirectories, actionDirectories,
    });

    // Generated shelves join the authored ones behind the same two ports, because
    // GetLearningCatalog/BuildLearningLesson each take ONE repository rather than a
    // registry. Authored content is listed FIRST so a hand-authored catalog or
    // document always overrides a generated one — an author can correct the
    // projection with a YAML file instead of a code change.
    const generated = createGeneratedSources({ exerciseLibrary, config, logger });
    const catalogs = generated.length
      ? new CompositeLearningCatalogRepository({ sources: [authoredCatalogs, ...generated], logger })
      : authoredCatalogs;
    const content = generated.length
      ? new CompositeLearningContentRepository({ sources: [authoredContent, ...generated], logger })
      : authoredContent;

    const moduleRegistry = createCoreLearningModuleRegistry();
    const lessonBundles = new BuildLearningLesson({ catalogs, content, modules: moduleRegistry });
    const accessPolicy = new AssignedLearningCatalogAccessPolicy({
      assignments: new YamlAssignmentStore({ configService }),
      config: config.access ?? null,
    });
    return Object.freeze({
      wired: true, reason: null, catalogs, content, moduleRegistry, lessonBundles, accessPolicy,
      query: new GetLearningCatalog({
        catalogs, lessonBundles, access: accessPolicy, learners: learnerDirectory,
      }),
      diagnostics: Object.freeze({
        contentRoot,
        catalogDirectories: Object.freeze(catalogDirectories),
        documentDirectories: Object.freeze(documentDirectories),
        questionBankDirectories: Object.freeze(questionBankDirectories),
        deckDirectories: Object.freeze(deckDirectories),
        actionDirectories: Object.freeze(actionDirectories),
        generatedSources: Object.freeze(generated.map((source) => source.catalogId)),
      }),
    });
  } catch (error) {
    logger?.error?.('school.catalog.wiring-failed', { error: error.message });
    return inert(error.message);
  }
}

/**
 * Corpus-backed catalog sources, per `catalog.exercise_library` in school.yml.
 *
 * Opt-in: absent config publishes nothing. Construction failure is logged and
 * skipped rather than allowed to fail the whole catalog wiring — a broken
 * generated shelf must never cost the household its authored curriculum.
 */
function createGeneratedSources({ exerciseLibrary, config, logger }) {
  const settings = config.exercise_library ?? null;
  if (!exerciseLibrary || !settings || settings.enabled === false) return [];
  try {
    return [new ExerciseLibraryCatalogSource({
      exerciseLibrary,
      logger,
      ...(settings.catalog_id ? { catalogId: settings.catalog_id } : {}),
      ...(settings.title ? { title: settings.title } : {}),
      ...(Number.isInteger(settings.max_examples_per_muscle)
        ? { maxExamples: settings.max_examples_per_muscle } : {}),
    })];
  } catch (error) {
    logger?.error?.('school.catalog.exercise-library.wiring-failed', { error: error.message });
    return [];
  }
}

function resolveDirectoryList(dataDirectory, configured, fallback, field) {
  const values = configured ?? fallback;
  if (!Array.isArray(values) || values.length === 0 || !values.every(nonEmptyString)) {
    throw new Error(`${field} must contain at least one path`);
  }
  return [...new Set(values.map((value) => resolveFromData(dataDirectory, value)))];
}

function resolveFromData(dataDirectory, value) {
  if (!nonEmptyString(value)) throw new Error('School Catalog path must be a non-empty string');
  return path.resolve(dataDirectory, value);
}

function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }

function inert(reason) {
  return Object.freeze({
    wired: false, reason, catalogs: null, content: null, moduleRegistry: null,
    lessonBundles: null, accessPolicy: null, query: null, diagnostics: Object.freeze({}),
  });
}

export default createSchoolCatalog;
