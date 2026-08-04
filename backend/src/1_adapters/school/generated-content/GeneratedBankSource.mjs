import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { generateQuestionBank } from '#domains/school/generatedBanks/generateQuestionBank.mjs';

const DATASET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Filesystem adapter for subject-neutral generated-bank recipes and datasets. */
export class GeneratedBankSource {
  #dataDir;
  #recipes;
  #byBankId;
  #entities = new Map();
  #cache = new Map();

  constructor({ dataDir, recipesFile = 'recipes.yml' } = {}) {
    if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) {
      throw new Error('GeneratedBankSource requires an absolute dataDir from the content mount');
    }
    this.#dataDir = dataDir;
    this.#recipes = this.#load(recipesFile);
    if (!Array.isArray(this.#recipes)) throw new Error('GeneratedBankSource recipes must be an array');
    this.#byBankId = new Map();
    for (const recipe of this.#recipes) {
      if (typeof recipe?.bankId !== 'string' || !recipe.bankId.trim()) throw new Error('GeneratedBankSource recipe requires bankId');
      if (this.#byBankId.has(recipe.bankId)) throw new Error(`GeneratedBankSource duplicate bankId '${recipe.bankId}'`);
      if (!DATASET_ID.test(recipe.entities || '')) throw new Error(`GeneratedBankSource '${recipe.bankId}' has an invalid entities reference`);
      this.#byBankId.set(recipe.bankId, recipe);
    }
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
    return yaml.load(fs.readFileSync(path.join(this.#dataDir, file), 'utf8'));
  }
}

export default GeneratedBankSource;
