//
// Named multi-item meal templates. Items are SNAPSHOTS — a later catalog
// edit never mutates a saved meal. Logging writes NutriList rows directly
// (log_uuid 'SAVEDMEAL'), the same mechanism quick-add uses.

import { bucketForHour as mealTimeFromHour } from '#shared/contracts/health/mealBuckets.mjs';
import { localDateISO } from '#shared/contracts/health/isoDate.mjs';
import { foodGrams } from '#shared/contracts/health/foodQuantity.mjs';

const snapshotItem = (item) => ({
  ...structuredClone(item),
  name: String(item.name),
  grams: foodGrams(item),
  calories: Number(item.calories) || 0,
  protein: Number(item.protein) || 0,
  carbs: Number(item.carbs) || 0,
  fat: Number(item.fat) || 0,
  color: item.color || 'yellow',
});

export class SavedMealsService {
  #mealsStore; #nutriListStore; #clock; #createId; #logger;

  constructor({ mealsStore, nutriListStore, clock, createId, logger }) {
    if (!mealsStore || !nutriListStore || !clock?.now || typeof createId !== 'function') {
      throw new Error('SavedMealsService requires mealsStore, nutriListStore, clock, createId');
    }
    this.#mealsStore = mealsStore;
    this.#nutriListStore = nutriListStore;
    this.#clock = clock;
    this.#createId = createId;
    this.#logger = logger || console;
  }

  async list(userId) {
    const meals = await this.#mealsStore.list(userId);
    return meals.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  }

  async create({ name, items }, userId) {
    if (!name) throw new Error('SavedMeal requires name');
    if (!Array.isArray(items) || items.length === 0) throw new Error('SavedMeal requires items');
    const meal = {
      id: this.#createId(),
      name,
      items: items.map(snapshotItem),
      createdAt: new Date(this.#clock.now()).toISOString(),
      useCount: 0,
      lastUsed: null,
    };
    await this.#mealsStore.save(meal, userId);
    this.#logger.info?.('health.meals.created', { name, itemCount: meal.items.length });
    return meal;
  }

  async logToDate(mealId, userId, { date, mealTime } = {}) {
    const meal = await this.#mealsStore.getById(mealId, userId);
    if (!meal) throw new Error(`Saved meal not found: ${mealId}`);

    const now = new Date(this.#clock.now());
    // LOCAL date, not UTC — see localDateISO comment on FoodCatalogService's
    // twin fix; the UTC form reads as tomorrow every evening in this
    // household's timezone (UTC-7/8).
    const targetDate = date || localDateISO(now);
    const targetMealTime = mealTime || mealTimeFromHour(now.getHours());

    const rows = meal.items.map((item) => ({
      ...item,
      id: undefined,
      uuid: this.#createId(),
      userId,
      item: item.name,
      name: item.name,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      grams: foodGrams(item),
      unit: 'g',
      amount: foodGrams(item),
      color: item.color,
      date: targetDate,
      mealTime: targetMealTime,
      log_uuid: 'SAVEDMEAL',
    }));
    await this.#nutriListStore.saveMany(rows);

    meal.useCount = (meal.useCount || 0) + 1;
    meal.lastUsed = targetDate;
    await this.#mealsStore.save(meal, userId);

    this.#logger.info?.('health.meals.logged', { mealId, date: targetDate, items: rows.length });
    return { items: rows };
  }

  async remove(id, userId) {
    await this.#mealsStore.remove(id, userId);
    this.#logger.info?.('health.meals.removed', { id });
  }
}
export default SavedMealsService;
