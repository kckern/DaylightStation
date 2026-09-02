// Storage: data/users/{username}/apps/health/meals.yml — array of meal objects.
import { ISavedMealsDatastore } from '#apps/health/ports/ISavedMealsDatastore.mjs';

export class YamlSavedMealsDatastore extends ISavedMealsDatastore {
  #dataService;
  static MEALS_PATH = 'apps/health/meals';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlSavedMealsDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  #load(userId) {
    const raw = this.#dataService.user.read?.(YamlSavedMealsDatastore.MEALS_PATH, userId);
    return Array.isArray(raw) ? raw : [];
  }
  #write(meals, userId) {
    this.#dataService.user.write?.(YamlSavedMealsDatastore.MEALS_PATH, meals, userId);
  }

  async list(userId) { return this.#load(userId); }
  async getById(id, userId) { return this.#load(userId).find((m) => m.id === id) || null; }
  async save(meal, userId) {
    const meals = this.#load(userId);
    const idx = meals.findIndex((m) => m.id === meal.id);
    if (idx >= 0) meals[idx] = meal; else meals.push(meal);
    this.#write(meals, userId);
  }
  async remove(id, userId) {
    this.#write(this.#load(userId).filter((m) => m.id !== id), userId);
  }
}
export default YamlSavedMealsDatastore;
