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

export function createSchoolCatalog({
  configService, householdId = null, learnerDirectory = null, logger = null,
} = {}) {
  if (typeof configService?.getHouseholdAppConfig !== 'function'
      || typeof configService?.getDataDir !== 'function') {
    throw new Error('createSchoolCatalog requires a ConfigService');
  }
  const config = configService.getHouseholdAppConfig(householdId, 'school')?.catalog ?? {};
  if (config.enabled === false) return inert('school.yml catalog.enabled is false');
  try {
    const dataDirectory = configService.getDataDir();
    const contentRoot = resolveFromData(dataDirectory, config.content?.root ?? 'content/school/catalog');
    const catalogDirectories = resolveDirectoryList(dataDirectory,
      config.content?.catalog_directories, [path.join(contentRoot, 'catalogs')], 'catalog.content.catalog_directories');
    const documentDirectories = resolveDirectoryList(dataDirectory,
      config.content?.document_directories, [path.join(contentRoot, 'documents')], 'catalog.content.document_directories');
    const questionBankDirectories = resolveDirectoryList(dataDirectory,
      config.content?.question_bank_directories, [path.join(contentRoot, 'question-banks')], 'catalog.content.question_bank_directories');
    const actionDirectories = resolveDirectoryList(dataDirectory,
      config.content?.action_directories, [path.join(contentRoot, 'actions')], 'catalog.content.action_directories');
    const catalogs = new YamlLearningCatalogRepository({ directories: catalogDirectories });
    const content = new YamlLearningContentRepository({
      documentDirectories, bankDirectories: questionBankDirectories, actionDirectories,
    });
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
        actionDirectories: Object.freeze(actionDirectories),
      }),
    });
  } catch (error) {
    logger?.error?.('school.catalog.wiring-failed', { error: error.message });
    return inert(error.message);
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
