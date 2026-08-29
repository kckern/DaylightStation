/** Shared authored School Catalog wiring. This exists independently of any
 * calculator product or transport and may hydrate web, print, or device views. */
import {
  YamlLearningCatalogRepository,
  YamlLearningContentRepository,
} from '#adapters/school/catalog/index.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { SchoolCatalogConfigProjection } from '#adapters/school/catalog/SchoolCatalogConfigProjection.mjs';
import { BuildSchoolCatalog } from '#apps/school/catalog/BuildSchoolCatalog.mjs';

export function createSchoolCatalog({
  configService, householdId = null, learnerDirectory = null, logger = null,
  exerciseLibrary = null,
} = {}) {
  const projection = new SchoolCatalogConfigProjection({ configService, householdId }).read();
  const authoredCatalogs = projection.enabled
    ? new YamlLearningCatalogRepository({ directories: projection.catalogDirectories })
    : null;
  const authoredContent = projection.enabled
    ? new YamlLearningContentRepository({
      documentDirectories: projection.documentDirectories,
      bankDirectories: projection.questionBankDirectories,
      deckDirectories: projection.deckDirectories,
      actionDirectories: projection.actionDirectories,
    })
    : null;
  return new BuildSchoolCatalog({ logger }).execute({
    projection,
    authoredCatalogs,
    authoredContent,
    assignments: projection.enabled ? new YamlAssignmentStore({ configService }) : null,
    learnerDirectory,
    exerciseLibrary,
  });
}

export default createSchoolCatalog;
