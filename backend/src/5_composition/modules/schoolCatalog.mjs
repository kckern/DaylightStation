/** Shared authored School Catalog wiring. This exists independently of any
 * calculator product or transport and may hydrate web, print, or device views. */
import path from 'node:path';
import {
  YamlLearningCatalogRepository,
  YamlLearningContentRepository,
} from '#adapters/school/catalog/index.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { SchoolCatalogConfigProjection } from '#adapters/school/catalog/SchoolCatalogConfigProjection.mjs';
import { LexiconDeckLoader } from '#adapters/school/catalog/LexiconDeckLoader.mjs';
import { YamlLexiconRepository } from '#adapters/school/catalog/YamlLexiconRepository.mjs';
import { BuildSchoolCatalog } from '#apps/school/catalog/BuildSchoolCatalog.mjs';

export function createSchoolCatalog({
  configService, householdId = null, learnerDirectory = null, logger = null,
  exerciseLibrary = null,
} = {}) {
  const projection = new SchoolCatalogConfigProjection({ configService, householdId }).read();
  const authoredCatalogs = projection.enabled
    ? new YamlLearningCatalogRepository({ directories: projection.catalogDirectories })
    : null;
  const yamlContent = projection.enabled
    ? new YamlLearningContentRepository({
      documentDirectories: projection.documentDirectories,
      bankDirectories: projection.questionBankDirectories,
      deckDirectories: projection.deckDirectories,
      actionDirectories: projection.actionDirectories,
    })
    : null;
  // Card-ladder decks name a `media:` lexicon and list word ids; expanding
  // them here — the content-repository seam — is what lets every existing
  // deck consumer (validation, FSRS, the deck browser) see ordinary cards.
  const mediaDir = configService.getMediaDir?.() ?? null;
  const authoredContent = yamlContent && mediaDir
    ? new LexiconDeckLoader({
      content: yamlContent,
      lexicons: new YamlLexiconRepository({ mediaRoot: path.join(mediaDir, 'school') }),
      logger,
    })
    : yamlContent;
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
