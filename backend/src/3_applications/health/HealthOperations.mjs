import { presentSettlement } from '#domains/nutrition/services/settlement.mjs';

const NUTRITION_UPDATE_FIELDS = new Set([
  'item', 'name', 'unit', 'amount', 'grams', 'noom_color', 'color',
  'calories', 'fat', 'carbs', 'protein', 'fiber', 'sugar', 'sodium', 'cholesterol', 'date',
  // mealTime is how a quick-added / edited row gets stamped into a bucket
  // (Breakfast/Lunch/Dinner/Snacks) — the today-view combobox (F5) and edit
  // sheet (F6) both PUT this field expecting it to persist.
  'mealTime',
]);

/**
 * Cohesive health data capability used by the HTTP adapter.
 *
 * The API owns validation and response envelopes. This service owns the
 * persistence-backed queries and commands that previously made the router an
 * orchestrator for stores, personal context, and nutrition-input adapters.
 */
export class HealthOperations {
  constructor({
    healthData,
    nutritionItems = null,
    personalContext = null,
    setDailyCoaching = null,
    nutritionInput = null,
    resolveDefaultUsername = () => 'default',
    resolveCoachingUsername = () => null,
    today,
    newId,
  }) {
    this.healthData = healthData;
    this.nutritionItems = nutritionItems;
    this.personalContext = personalContext;
    this.setDailyCoaching = setDailyCoaching;
    this.nutritionInput = nutritionInput;
    this.resolveDefaultUsername = resolveDefaultUsername;
    this.resolveCoachingUsername = resolveCoachingUsername;
    this.today = today;
    this.newId = newId;
  }

  defaultUsername() {
    return this.resolveDefaultUsername() || 'default';
  }

  coachingUsername(requestedUsername) {
    return requestedUsername || this.resolveCoachingUsername() || null;
  }

  readWeight(username) { return this.healthData.loadWeightData(username); }
  readActivity(username) { return this.healthData.loadActivityData(username); }
  readFitness(username) { return this.healthData.loadFitnessData(username); }
  readNutrition(username) { return this.healthData.loadNutritionData(username); }
  readCoaching(username) { return this.healthData.loadCoachingData(username); }

  get coachingSchemaAvailable() {
    return typeof this.personalContext?.loadPlaybook === 'function';
  }

  async readCoachingDimensions(username) {
    const playbook = await this.personalContext.loadPlaybook(username);
    return Array.isArray(playbook?.coaching_dimensions) ? playbook.coaching_dimensions : [];
  }

  get dailyCoachingAvailable() {
    return !!this.setDailyCoaching;
  }

  saveDailyCoaching(username, date, coaching) {
    return this.setDailyCoaching.execute({ userId: username, date, coaching });
  }

  get nutritionItemsAvailable() {
    return !!this.nutritionItems;
  }

  currentDate() {
    return this.today();
  }

  async findNutritionItemsByDate(username, date) {
    const rows = await this.nutritionItems.findByDate(username, date);
    const today = this.today();
    return rows.map((row) => ({ ...row, ...presentSettlement(row, today) }));
  }

  findNutritionItem(username, id) {
    return this.nutritionItems.findByUuid(username, id);
  }

  async createNutritionItem(username, itemData) {
    const item = {
      uuid: this.newId(),
      userId: username,
      item: itemData.item || itemData.name,
      name: itemData.name || itemData.item,
      unit: itemData.unit || 'g',
      amount: itemData.amount || itemData.grams || 0,
      grams: itemData.grams || itemData.amount || 0,
      noom_color: itemData.noom_color || itemData.color || 'yellow',
      color: itemData.color || itemData.noom_color || 'yellow',
      calories: itemData.calories || 0,
      fat: itemData.fat || 0,
      carbs: itemData.carbs || 0,
      protein: itemData.protein || 0,
      fiber: itemData.fiber || 0,
      sugar: itemData.sugar || 0,
      sodium: itemData.sodium || 0,
      cholesterol: itemData.cholesterol || 0,
      date: itemData.date || this.today(),
      log_uuid: itemData.log_uuid || 'MANUAL',
    };
    await this.nutritionItems.saveMany([item]);
    return item;
  }

  async updateNutritionItem(username, id, changes) {
    if (!await this.nutritionItems.findByUuid(username, id)) return null;
    const allowedChanges = Object.fromEntries(
      Object.entries(changes).filter(([field]) => NUTRITION_UPDATE_FIELDS.has(field)),
    );
    return {
      item: await this.nutritionItems.update(username, id, allowedChanges),
      changedFields: Object.keys(allowedChanges),
    };
  }

  async deleteNutritionItem(username, id) {
    if (!await this.nutritionItems.findByUuid(username, id)) return { found: false, deleted: false };
    return { found: true, deleted: await this.nutritionItems.deleteById(username, id) };
  }

  get nutritionInputAvailable() {
    return !!this.nutritionInput;
  }

  processNutritionInput(input) {
    return this.nutritionInput.process(input);
  }

  processNutritionCallback(input) {
    return this.nutritionInput.processCallback(input);
  }

  get pendingNutritionAvailable() {
    return typeof this.nutritionInput?.listPendingByDate === 'function';
  }

  listPendingNutrition(username, date) {
    return this.nutritionInput.listPendingByDate(username, date);
  }
}

export default HealthOperations;
