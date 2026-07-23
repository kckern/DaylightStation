import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { generateGeoBank } from '#domains/school/geography/generateGeoBank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export class GeographyBankSource {
  #dir; #recipes; #entities = {}; #cache = new Map();

  constructor({ dataDir } = {}) {
    this.#dir = dataDir || path.join(HERE, 'geography');
    this.#recipes = this.#load('decks.yml');
    this.#entities['us-states'] = this.#load('us-states.yml');
    this.#entities.world = this.#load('world.yml');
  }

  #load(file) {
    return yaml.load(fs.readFileSync(path.join(this.#dir, file), 'utf8'));
  }

  #recipeFor(bankId) {
    if (typeof bankId !== 'string' || !bankId.startsWith('geo:')) return null;
    const deckId = bankId.slice('geo:'.length);
    return this.#recipes.find((r) => r.deckId === deckId) || null;
  }

  resolve(bankId) {
    const recipe = this.#recipeFor(bankId);
    if (!recipe || !recipe.available) return null;
    if (this.#cache.has(bankId)) return this.#cache.get(bankId);
    const bank = generateGeoBank({ recipe, entities: this.#entities[recipe.entities] });
    this.#cache.set(bankId, bank);
    return bank;
  }

  listDeckSummaries() {
    return this.#recipes.map((r) => ({
      deckId: r.deckId,
      bankId: `geo:${r.deckId}`,
      title: r.title,
      itemType: r.itemType,
      available: !!r.available,
    }));
  }
}

export default GeographyBankSource;
