import path from 'node:path';

const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/** Translates school.yml storage configuration into resolved catalog locations. */
export class SchoolCatalogConfigProjection {
  constructor({ configService, householdId = null } = {}) {
    if (!configService?.getHouseholdAppConfig || !configService?.getDataDir) {
      throw new Error('SchoolCatalogConfigProjection requires configService');
    }
    this.configService = configService;
    this.householdId = householdId;
  }

  read() {
    const config = this.configService.getHouseholdAppConfig(this.householdId, 'school')?.catalog ?? {};
    if (config.enabled === false) return { enabled: false, reason: 'school.yml catalog.enabled is false', config };
    try {
      const dataDirectory = this.configService.getDataDir();
      const contentRoot = this.#resolve(dataDirectory, config.content?.root ?? 'content/school/learning-catalog');
      return {
        enabled: true,
        config,
        contentRoot,
        catalogDirectories: this.#directories(dataDirectory, config.content?.catalog_directories, [path.join(contentRoot, 'catalogs')], 'catalog.content.catalog_directories'),
        documentDirectories: this.#directories(dataDirectory, config.content?.document_directories, [path.join(contentRoot, 'documents')], 'catalog.content.document_directories'),
        questionBankDirectories: this.#directories(dataDirectory, config.content?.question_bank_directories, [path.join(contentRoot, 'question-banks')], 'catalog.content.question_bank_directories'),
        deckDirectories: this.#directories(dataDirectory, config.content?.flashcard_deck_directories, [path.join(contentRoot, 'flashcard-decks')], 'catalog.content.flashcard_deck_directories'),
        actionDirectories: this.#directories(dataDirectory, config.content?.action_directories, [path.join(contentRoot, 'actions')], 'catalog.content.action_directories'),
      };
    } catch (error) {
      return { enabled: false, reason: error.message, config };
    }
  }

  #directories(dataDirectory, configured, fallback, field) {
    const values = configured ?? fallback;
    if (!Array.isArray(values) || values.length === 0 || !values.every(nonEmptyString)) {
      throw new Error(`${field} must contain at least one path`);
    }
    return [...new Set(values.map((value) => this.#resolve(dataDirectory, value)))];
  }

  #resolve(dataDirectory, value) {
    if (!nonEmptyString(value)) throw new Error('School Catalog path must be a non-empty string');
    return path.resolve(dataDirectory, value);
  }
}
