import path from 'node:path';
import yaml from 'js-yaml';
import { generateQuestionBank } from '#domains/school/generatedBanks/generateQuestionBank.mjs';
import { fileExists, readTextFromPath } from '#system/utils/FileIO.mjs';
import { IBankSource } from '#apps/school/ports/IBankSource.mjs';

const DATASET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Filesystem adapter for subject-neutral generated-bank recipes and datasets.
 *
 * Boot resilience (admin advocacy A1): this adapter is constructed inline in
 * createApp, so a throw here used to crash-loop the WHOLE station — fitness,
 * finance, kiosks — over one school content file. It now degrades: a missing
 * recipes file is a quiet empty source (warn — a fresh mount may simply not
 * have one yet), a malformed file or invalid recipe is a LOUD empty/partial
 * source (error log), and only a mis-programmed dataDir still throws.
 */
export class GeneratedBankSource extends IBankSource {
  #dataDir;
  #recipes;
  #byBankId;
  #logger;
  #entities = new Map();
  #cache = new Map();

  constructor({ dataDir, recipesFile = 'recipes.yml', logger = console } = {}) {
    super();
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) {
      throw new Error('GeneratedBankSource requires an absolute dataDir from the content mount');
    }
    this.#dataDir = dataDir;
    this.#logger = logger;
    this.#byBankId = new Map();
    const file = path.join(dataDir, recipesFile);
    let raw = null;
    if (!fileExists(file)) {
      this.#logger.warn?.('school.generated-banks.recipes-missing', { file });
      this.#recipes = [];
      return;
    }
    try {
      raw = yaml.load(readTextFromPath(file));
      if (!Array.isArray(raw)) throw new Error('recipes must be an array');
    } catch (err) {
      this.#logger.error?.('school.generated-banks.recipes-invalid', { file, error: err.message });
      this.#recipes = [];
      return;
    }
    const kept = [];
    for (const recipe of raw) {
      const problem = (typeof recipe?.bankId !== 'string' || !recipe.bankId.trim()) ? 'recipe requires bankId'
        : this.#byBankId.has(recipe.bankId) ? `duplicate bankId '${recipe.bankId}'`
          : !DATASET_ID.test(recipe.entities || '') ? `'${recipe.bankId}' has an invalid entities reference`
            : null;
      if (problem) {
        this.#logger.error?.('school.generated-banks.recipe-invalid', { file, problem });
        continue;
      }
      this.#byBankId.set(recipe.bankId, recipe);
      kept.push(recipe);
    }
    this.#recipes = kept;
  }

  resolve(bankId) {
    const recipe = this.#byBankId.get(bankId);
    if (!recipe || !recipe.available) return null;
    if (this.#cache.has(bankId)) return this.#cache.get(bankId);
    const bank = generateQuestionBank({ recipe, entities: this.#loadEntities(recipe.entities) });
    this.#cache.set(bankId, bank);
    return bank;
  }

  listSummaries() {
    return this.#recipes.map((recipe) => ({
      summaryId: recipe.summaryId ?? recipe.bankId,
      bankId: recipe.bankId,
      title: recipe.title,
      itemType: recipe.itemType,
      available: Boolean(recipe.available),
      collections: [...(recipe.collections ?? [])],
      topics: [...(recipe.topics ?? [])],
      subject: recipe.subject ?? null,
    }));
  }

  #loadEntities(datasetId) {
    if (!this.#entities.has(datasetId)) this.#entities.set(datasetId, this.#load(`${datasetId}.yml`));
    return this.#entities.get(datasetId);
  }

  #load(file) {
    return yaml.load(readTextFromPath(path.join(this.#dataDir, file)));
  }
}

export default GeneratedBankSource;
