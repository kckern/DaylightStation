# Nutribot DDD Migration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate nutribot from `_legacy/chatbots/bots/nutribot/` into proper DDD architecture with clean port/adapter abstractions.

**Architecture:** Application isolation - nutribot stays self-contained in `3_applications/nutribot/` with domain entities in `1_domains/lifelog/`, external service adapters in `2_adapters/`, and API endpoints in `4_api/routers/`.

**Tech Stack:** Node.js ES modules, Express.js, YAML persistence via FileIO, Telegram Bot API, OpenAI GPT-4o-mini, Nutritionix API.

**Reference Design:** `docs/plans/2026-01-23-nutribot-ddd-migration.md`

---

## Phase 1: Foundation

### Task 1.1: Create Lifelog Domain Directory Structure

**Files:**
- Create: `backend/src/1_domains/lifelog/index.mjs`
- Create: `backend/src/1_domains/lifelog/entities/index.mjs`

**Step 1: Create directory and index files**

```bash
mkdir -p backend/src/1_domains/lifelog/entities
```

**Step 2: Create lifelog domain barrel export**

Create `backend/src/1_domains/lifelog/index.mjs`:
```javascript
// backend/src/1_domains/lifelog/index.mjs
// Lifelog domain - nutrition tracking entities

export * from './entities/index.mjs';
```

**Step 3: Create entities barrel export (placeholder)**

Create `backend/src/1_domains/lifelog/entities/index.mjs`:
```javascript
// backend/src/1_domains/lifelog/entities/index.mjs
// Entity exports will be added as entities are migrated

// export { FoodItem } from './FoodItem.mjs';
// export { NutriLog } from './NutriLog.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/lifelog/
git commit -m "feat(lifelog): create domain directory structure"
```

---

### Task 1.2: Migrate FoodItem Entity

**Files:**
- Read: `backend/_legacy/chatbots/bots/nutribot/domain/FoodItem.mjs`
- Create: `backend/src/1_domains/lifelog/entities/FoodItem.mjs`
- Modify: `backend/src/1_domains/lifelog/entities/index.mjs`

**Step 1: Read legacy FoodItem to understand structure**

Review `backend/_legacy/chatbots/bots/nutribot/domain/FoodItem.mjs` for:
- Constructor parameters
- All getter methods
- Factory methods (create, from, fromLegacy)
- Serialization (toJSON)

**Step 2: Create migrated FoodItem with private fields**

Create `backend/src/1_domains/lifelog/entities/FoodItem.mjs`:
```javascript
// backend/src/1_domains/lifelog/entities/FoodItem.mjs
import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {Object} FoodItemProps
 * @property {string} [id]
 * @property {string} [uuid]
 * @property {string} label
 * @property {string} [icon]
 * @property {number} grams
 * @property {string} [unit]
 * @property {number} [amount]
 * @property {'green'|'yellow'|'orange'} [color]
 * @property {number} [calories]
 * @property {number} [protein]
 * @property {number} [carbs]
 * @property {number} [fat]
 * @property {number} [fiber]
 * @property {number} [sugar]
 * @property {number} [sodium]
 * @property {number} [cholesterol]
 */

/**
 * FoodItem - Immutable value object representing a food item with nutrition data
 */
export class FoodItem {
  #id;
  #uuid;
  #label;
  #icon;
  #grams;
  #unit;
  #amount;
  #color;
  #calories;
  #protein;
  #carbs;
  #fat;
  #fiber;
  #sugar;
  #sodium;
  #cholesterol;

  /**
   * @param {FoodItemProps} props
   */
  constructor(props) {
    this.#id = props.id || this.#generateShortId();
    this.#uuid = props.uuid || uuidv4();
    this.#label = props.label;
    this.#icon = props.icon || '';
    this.#grams = props.grams || 0;
    this.#unit = props.unit || 'g';
    this.#amount = props.amount ?? props.grams ?? 0;
    this.#color = props.color || 'yellow';
    this.#calories = props.calories || 0;
    this.#protein = props.protein || 0;
    this.#carbs = props.carbs || 0;
    this.#fat = props.fat || 0;
    this.#fiber = props.fiber || 0;
    this.#sugar = props.sugar || 0;
    this.#sodium = props.sodium || 0;
    this.#cholesterol = props.cholesterol || 0;

    Object.freeze(this);
  }

  #generateShortId() {
    return Math.random().toString(36).substring(2, 8);
  }

  // Getters
  get id() { return this.#id; }
  get uuid() { return this.#uuid; }
  get label() { return this.#label; }
  get icon() { return this.#icon; }
  get grams() { return this.#grams; }
  get unit() { return this.#unit; }
  get amount() { return this.#amount; }
  get color() { return this.#color; }
  get calories() { return this.#calories; }
  get protein() { return this.#protein; }
  get carbs() { return this.#carbs; }
  get fat() { return this.#fat; }
  get fiber() { return this.#fiber; }
  get sugar() { return this.#sugar; }
  get sodium() { return this.#sodium; }
  get cholesterol() { return this.#cholesterol; }

  // Computed properties
  get isGreen() { return this.#color === 'green'; }
  get isYellow() { return this.#color === 'yellow'; }
  get isOrange() { return this.#color === 'orange'; }
  get displayAmount() { return `${this.#amount}${this.#unit}`; }

  /**
   * Create new FoodItem with updated properties
   * @param {Partial<FoodItemProps>} updates
   * @returns {FoodItem}
   */
  with(updates) {
    return new FoodItem({
      ...this.toJSON(),
      ...updates
    });
  }

  /**
   * Serialize to plain object
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.#id,
      uuid: this.#uuid,
      label: this.#label,
      icon: this.#icon,
      grams: this.#grams,
      unit: this.#unit,
      amount: this.#amount,
      color: this.#color,
      calories: this.#calories,
      protein: this.#protein,
      carbs: this.#carbs,
      fat: this.#fat,
      fiber: this.#fiber,
      sugar: this.#sugar,
      sodium: this.#sodium,
      cholesterol: this.#cholesterol
    };
  }

  /**
   * Create FoodItem from plain object
   * @param {Object} obj
   * @returns {FoodItem}
   */
  static fromJSON(obj) {
    return new FoodItem(obj);
  }

  /**
   * Create new FoodItem with auto-generated IDs
   * @param {Omit<FoodItemProps, 'id' | 'uuid'>} props
   * @returns {FoodItem}
   */
  static create(props) {
    return new FoodItem({
      ...props,
      id: undefined,
      uuid: undefined
    });
  }

  /**
   * Create from legacy format
   * @param {Object} legacy - Legacy food item with item/noom_color fields
   * @param {string} [id]
   * @returns {FoodItem}
   */
  static fromLegacy(legacy, id) {
    return new FoodItem({
      id: id || legacy.uuid?.substring(0, 8),
      uuid: legacy.uuid,
      label: legacy.item || legacy.label,
      icon: legacy.icon || '',
      grams: legacy.amount || legacy.grams || 0,
      unit: legacy.unit || 'g',
      amount: legacy.amount || legacy.grams || 0,
      color: legacy.noom_color || legacy.color || 'yellow',
      calories: legacy.calories || 0,
      protein: legacy.protein || 0,
      carbs: legacy.carbs || 0,
      fat: legacy.fat || 0,
      fiber: legacy.fiber || 0,
      sugar: legacy.sugar || 0,
      sodium: legacy.sodium || 0,
      cholesterol: legacy.cholesterol || 0
    });
  }

  /**
   * Check equality by ID
   * @param {FoodItem} other
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof FoodItem && this.#id === other.id;
  }
}
```

**Step 3: Update entities index**

Edit `backend/src/1_domains/lifelog/entities/index.mjs`:
```javascript
// backend/src/1_domains/lifelog/entities/index.mjs
export { FoodItem } from './FoodItem.mjs';
// export { NutriLog } from './NutriLog.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/lifelog/entities/
git commit -m "feat(lifelog): migrate FoodItem entity from legacy"
```

---

### Task 1.3: Migrate NutriLog Entity

**Files:**
- Read: `backend/_legacy/chatbots/bots/nutribot/domain/NutriLog.mjs`
- Create: `backend/src/1_domains/lifelog/entities/NutriLog.mjs`
- Modify: `backend/src/1_domains/lifelog/entities/index.mjs`

**Step 1: Read legacy NutriLog to understand structure**

Review `backend/_legacy/chatbots/bots/nutribot/domain/NutriLog.mjs` for:
- Status lifecycle (pending → accepted → rejected → deleted)
- Meal structure (date, time)
- Items array management
- Computed properties (totals, color counts)

**Step 2: Create migrated NutriLog aggregate root**

Create `backend/src/1_domains/lifelog/entities/NutriLog.mjs`:
```javascript
// backend/src/1_domains/lifelog/entities/NutriLog.mjs
import { FoodItem } from './FoodItem.mjs';

/**
 * @typedef {'pending'|'accepted'|'rejected'|'deleted'} NutriLogStatus
 * @typedef {'morning'|'afternoon'|'evening'|'night'} MealTime
 */

/**
 * @typedef {Object} NutriLogProps
 * @property {string} [id]
 * @property {string} userId
 * @property {string} [conversationId]
 * @property {NutriLogStatus} [status]
 * @property {string} text
 * @property {{date: string, time: MealTime}} meal
 * @property {Array<FoodItem|Object>} [items]
 * @property {Object} [questions]
 * @property {Object} [nutrition]
 * @property {Object} [metadata]
 * @property {string} [timezone]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {string|null} [acceptedAt]
 */

/**
 * NutriLog - Aggregate root for meal logs
 */
export class NutriLog {
  #id;
  #userId;
  #conversationId;
  #status;
  #text;
  #meal;
  #items;
  #questions;
  #nutrition;
  #metadata;
  #timezone;
  #createdAt;
  #updatedAt;
  #acceptedAt;

  /**
   * @param {NutriLogProps} props
   */
  constructor(props) {
    this.#id = props.id || this.#generateShortId();
    this.#userId = props.userId;
    this.#conversationId = props.conversationId || props.userId;
    this.#status = props.status || 'pending';
    this.#text = props.text || '';
    this.#meal = props.meal || { date: this.#today(), time: 'afternoon' };
    this.#items = (props.items || []).map(i => i instanceof FoodItem ? i : FoodItem.fromJSON(i));
    this.#questions = props.questions || [];
    this.#nutrition = props.nutrition || {};
    this.#metadata = props.metadata || {};
    this.#timezone = props.timezone || 'America/Los_Angeles';
    this.#createdAt = props.createdAt || new Date().toISOString();
    this.#updatedAt = props.updatedAt || new Date().toISOString();
    this.#acceptedAt = props.acceptedAt || null;

    Object.freeze(this);
  }

  #generateShortId() {
    return Math.random().toString(36).substring(2, 10);
  }

  #today() {
    return new Date().toISOString().split('T')[0];
  }

  #now() {
    return new Date().toISOString();
  }

  // Getters
  get id() { return this.#id; }
  get userId() { return this.#userId; }
  get conversationId() { return this.#conversationId; }
  get status() { return this.#status; }
  get text() { return this.#text; }
  get meal() { return { ...this.#meal }; }
  get items() { return [...this.#items]; }
  get questions() { return [...this.#questions]; }
  get nutrition() { return { ...this.#nutrition }; }
  get metadata() { return { ...this.#metadata }; }
  get timezone() { return this.#timezone; }
  get createdAt() { return this.#createdAt; }
  get updatedAt() { return this.#updatedAt; }
  get acceptedAt() { return this.#acceptedAt; }

  // Status checks
  get isPending() { return this.#status === 'pending'; }
  get isAccepted() { return this.#status === 'accepted'; }
  get isRejected() { return this.#status === 'rejected'; }
  get isDeleted() { return this.#status === 'deleted'; }

  // Computed properties
  get itemCount() { return this.#items.length; }

  get totalCalories() {
    return this.#items.reduce((sum, item) => sum + (item.calories || 0), 0);
  }

  get totalProtein() {
    return this.#items.reduce((sum, item) => sum + (item.protein || 0), 0);
  }

  get colorCounts() {
    return {
      green: this.#items.filter(i => i.color === 'green').length,
      yellow: this.#items.filter(i => i.color === 'yellow').length,
      orange: this.#items.filter(i => i.color === 'orange').length
    };
  }

  get hasUnansweredQuestions() {
    return this.#questions.some(q => !q.answered);
  }

  // Status transitions
  accept() {
    if (this.#status !== 'pending') {
      throw new Error(`Cannot accept log with status: ${this.#status}`);
    }
    return this.#withUpdates({
      status: 'accepted',
      acceptedAt: this.#now()
    });
  }

  reject() {
    if (this.#status !== 'pending') {
      throw new Error(`Cannot reject log with status: ${this.#status}`);
    }
    return this.#withUpdates({ status: 'rejected' });
  }

  delete() {
    return this.#withUpdates({ status: 'deleted' });
  }

  // Item management
  addItem(item) {
    const foodItem = item instanceof FoodItem ? item : FoodItem.fromJSON(item);
    return this.#withUpdates({
      items: [...this.#items, foodItem]
    });
  }

  removeItem(itemId) {
    return this.#withUpdates({
      items: this.#items.filter(i => i.id !== itemId)
    });
  }

  updateItem(itemId, updates) {
    return this.#withUpdates({
      items: this.#items.map(i => i.id === itemId ? i.with(updates) : i)
    });
  }

  setItems(items) {
    return this.#withUpdates({
      items: items.map(i => i instanceof FoodItem ? i : FoodItem.fromJSON(i))
    });
  }

  // Other updates
  setText(text) {
    return this.#withUpdates({ text });
  }

  updateDate(date, time) {
    return this.#withUpdates({
      meal: { date, time: time || this.#meal.time }
    });
  }

  setNutrition(nutrition) {
    return this.#withUpdates({ nutrition });
  }

  #withUpdates(updates) {
    return new NutriLog({
      ...this.toJSON(),
      ...updates,
      updatedAt: this.#now()
    });
  }

  /**
   * Convert items to denormalized list format
   * @returns {Object[]}
   */
  toNutriListItems() {
    return this.#items.map(item => ({
      ...item.toJSON(),
      logId: this.#id,
      date: this.#meal.date,
      status: this.#status,
      createdAt: this.#createdAt,
      acceptedAt: this.#acceptedAt
    }));
  }

  toJSON() {
    return {
      id: this.#id,
      userId: this.#userId,
      conversationId: this.#conversationId,
      status: this.#status,
      text: this.#text,
      meal: { ...this.#meal },
      items: this.#items.map(i => i.toJSON()),
      questions: [...this.#questions],
      nutrition: { ...this.#nutrition },
      metadata: { ...this.#metadata },
      timezone: this.#timezone,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      acceptedAt: this.#acceptedAt
    };
  }

  static fromJSON(obj, timezone) {
    return new NutriLog({
      ...obj,
      timezone: timezone || obj.timezone
    });
  }

  static create(props) {
    return new NutriLog({
      ...props,
      id: undefined,
      status: 'pending',
      createdAt: undefined,
      updatedAt: undefined
    });
  }

  /**
   * Create from legacy format
   * @param {Object} legacy
   * @param {string} userId
   * @param {string} conversationId
   * @param {string} timezone
   * @returns {NutriLog}
   */
  static fromLegacy(legacy, userId, conversationId, timezone) {
    const foodData = legacy.food_data || {};
    return new NutriLog({
      id: legacy.id,
      userId,
      conversationId,
      status: legacy.status || 'pending',
      text: foodData.text || '',
      meal: {
        date: foodData.date || new Date().toISOString().split('T')[0],
        time: foodData.time || 'afternoon'
      },
      items: (foodData.food || []).map(f => FoodItem.fromLegacy(f)),
      questions: foodData.questions || [],
      nutrition: foodData.nutrition || {},
      metadata: { messageId: legacy.message_id },
      timezone,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      acceptedAt: legacy.acceptedAt
    });
  }
}
```

**Step 3: Update entities index**

Edit `backend/src/1_domains/lifelog/entities/index.mjs`:
```javascript
// backend/src/1_domains/lifelog/entities/index.mjs
export { FoodItem } from './FoodItem.mjs';
export { NutriLog } from './NutriLog.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/1_domains/lifelog/entities/
git commit -m "feat(lifelog): migrate NutriLog aggregate root from legacy"
```

---

### Task 1.4: Create Port Interfaces

**Files:**
- Create: `backend/src/3_applications/nutribot/ports/INutriLogStore.mjs`
- Create: `backend/src/3_applications/nutribot/ports/INutriListStore.mjs`
- Create: `backend/src/3_applications/nutribot/ports/IMessagingGateway.mjs`
- Create: `backend/src/3_applications/nutribot/ports/IFoodParser.mjs`
- Create: `backend/src/3_applications/nutribot/ports/INutritionLookup.mjs`
- Create: `backend/src/3_applications/nutribot/ports/index.mjs`

**Step 1: Create ports directory**

```bash
mkdir -p backend/src/3_applications/nutribot/ports
```

**Step 2: Create INutriLogStore port**

Create `backend/src/3_applications/nutribot/ports/INutriLogStore.mjs`:
```javascript
// backend/src/3_applications/nutribot/ports/INutriLogStore.mjs

/**
 * Port interface for NutriLog persistence
 * @interface INutriLogStore
 */
export const INutriLogStore = {
  async save(nutriLog) {},
  async findById(userId, id) {},
  async findByDate(userId, date) {},
  async findByDateRange(userId, startDate, endDate) {},
  async findPending(userId) {},
  async findAccepted(userId) {},
  async updateStatus(userId, id, status) {},
  async delete(userId, id) {}
};

/**
 * Validate object implements INutriLogStore
 * @param {Object} obj
 * @returns {boolean}
 */
export function isNutriLogStore(obj) {
  return (
    obj &&
    typeof obj.save === 'function' &&
    typeof obj.findById === 'function' &&
    typeof obj.findPending === 'function' &&
    typeof obj.updateStatus === 'function'
  );
}
```

**Step 3: Create INutriListStore port**

Create `backend/src/3_applications/nutribot/ports/INutriListStore.mjs`:
```javascript
// backend/src/3_applications/nutribot/ports/INutriListStore.mjs

/**
 * Port interface for denormalized NutriList persistence
 * @interface INutriListStore
 */
export const INutriListStore = {
  async syncFromLog(nutriLog) {},
  async addItem(userId, item) {},
  async getItemsForDate(userId, date) {},
  async getItemsForDateRange(userId, startDate, endDate) {},
  async findByLogId(userId, logId) {},
  async updateItem(userId, itemId, updates) {},
  async removeItem(userId, itemId) {},
  async removeByLogId(userId, logId) {}
};

/**
 * Validate object implements INutriListStore
 * @param {Object} obj
 * @returns {boolean}
 */
export function isNutriListStore(obj) {
  return (
    obj &&
    typeof obj.syncFromLog === 'function' &&
    typeof obj.getItemsForDate === 'function' &&
    typeof obj.removeItem === 'function'
  );
}
```

**Step 4: Create IMessagingGateway port**

Create `backend/src/3_applications/nutribot/ports/IMessagingGateway.mjs`:
```javascript
// backend/src/3_applications/nutribot/ports/IMessagingGateway.mjs

/**
 * Port interface for messaging operations (Telegram-agnostic)
 * @interface IMessagingGateway
 */
export const IMessagingGateway = {
  async sendMessage(userId, text, options = {}) {},
  async sendPhoto(userId, imageBuffer, caption, options = {}) {},
  async sendKeyboard(userId, text, buttons, options = {}) {},
  async editMessage(userId, messageId, text, options = {}) {},
  async editKeyboard(userId, messageId, buttons) {},
  async deleteMessage(userId, messageId) {},
  async answerCallback(callbackId, text) {},
  async getFileUrl(fileId) {},
  async downloadFile(fileId) {}
};

/**
 * Validate object implements IMessagingGateway
 * @param {Object} obj
 * @returns {boolean}
 */
export function isMessagingGateway(obj) {
  return (
    obj &&
    typeof obj.sendMessage === 'function' &&
    typeof obj.sendKeyboard === 'function' &&
    typeof obj.answerCallback === 'function'
  );
}
```

**Step 5: Create IFoodParser port**

Create `backend/src/3_applications/nutribot/ports/IFoodParser.mjs`:
```javascript
// backend/src/3_applications/nutribot/ports/IFoodParser.mjs

/**
 * Port interface for AI food parsing
 * @interface IFoodParser
 */
export const IFoodParser = {
  async parseText(text, context = {}) {},
  async parseImage(imageUrl, context = {}) {},
  async parseVoice(audioBuffer, context = {}) {}
};

/**
 * Validate object implements IFoodParser
 * @param {Object} obj
 * @returns {boolean}
 */
export function isFoodParser(obj) {
  return (
    obj &&
    typeof obj.parseText === 'function' &&
    typeof obj.parseImage === 'function'
  );
}
```

**Step 6: Create INutritionLookup port**

Create `backend/src/3_applications/nutribot/ports/INutritionLookup.mjs`:
```javascript
// backend/src/3_applications/nutribot/ports/INutritionLookup.mjs

/**
 * Port interface for nutrition database lookups
 * @interface INutritionLookup
 */
export const INutritionLookup = {
  async lookupByName(foodName) {},
  async lookupByUPC(barcode) {}
};

/**
 * Validate object implements INutritionLookup
 * @param {Object} obj
 * @returns {boolean}
 */
export function isNutritionLookup(obj) {
  return (
    obj &&
    typeof obj.lookupByName === 'function' &&
    typeof obj.lookupByUPC === 'function'
  );
}
```

**Step 7: Create ports barrel export**

Create `backend/src/3_applications/nutribot/ports/index.mjs`:
```javascript
// backend/src/3_applications/nutribot/ports/index.mjs
export { INutriLogStore, isNutriLogStore } from './INutriLogStore.mjs';
export { INutriListStore, isNutriListStore } from './INutriListStore.mjs';
export { IMessagingGateway, isMessagingGateway } from './IMessagingGateway.mjs';
export { IFoodParser, isFoodParser } from './IFoodParser.mjs';
export { INutritionLookup, isNutritionLookup } from './INutritionLookup.mjs';
```

**Step 8: Commit**

```bash
git add backend/src/3_applications/nutribot/ports/
git commit -m "feat(nutribot): add port interfaces for DDD adapters"
```

---

### Task 1.5: Create YamlNutriLogStore Adapter

**Files:**
- Create: `backend/src/2_adapters/persistence/yaml/YamlNutriLogStore.mjs`

**Step 1: Create the adapter**

Create `backend/src/2_adapters/persistence/yaml/YamlNutriLogStore.mjs`:
```javascript
// backend/src/2_adapters/persistence/yaml/YamlNutriLogStore.mjs
import { NutriLog } from '../../../1_domains/lifelog/entities/NutriLog.mjs';
import { loadYaml, saveYaml, yamlExists } from '../../../0_infrastructure/utils/FileIO.mjs';

/**
 * YAML-based NutriLog persistence adapter
 * Implements INutriLogStore port
 */
export class YamlNutriLogStore {
  #userDataService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService for path resolution
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.userDataService) {
      throw new Error('YamlNutriLogStore requires userDataService');
    }
    this.#userDataService = config.userDataService;
    this.#logger = config.logger || console;
  }

  #getPath(userId) {
    return this.#userDataService.getUserPath(userId, 'lifelog/nutrition/nutrilog');
  }

  #loadLogs(userId) {
    const path = this.#getPath(userId);
    const data = loadYaml(path);
    return data || {};
  }

  #saveLogs(userId, logs) {
    const path = this.#getPath(userId);
    saveYaml(path, logs);
  }

  async save(nutriLog) {
    const logs = this.#loadLogs(nutriLog.userId);
    logs[nutriLog.id] = nutriLog.toJSON();
    this.#saveLogs(nutriLog.userId, logs);

    this.#logger.debug?.('nutrilog.saved', {
      userId: nutriLog.userId,
      logId: nutriLog.id,
      status: nutriLog.status
    });

    return nutriLog;
  }

  async findById(userId, id) {
    const logs = this.#loadLogs(userId);
    const data = logs[id];
    return data ? NutriLog.fromJSON(data) : null;
  }

  async findByDate(userId, date) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => log.meal?.date === date && log.status !== 'deleted')
      .map(log => NutriLog.fromJSON(log));
  }

  async findByDateRange(userId, startDate, endDate) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => {
        const date = log.meal?.date;
        return date >= startDate && date <= endDate && log.status !== 'deleted';
      })
      .map(log => NutriLog.fromJSON(log));
  }

  async findPending(userId) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => log.status === 'pending')
      .map(log => NutriLog.fromJSON(log));
  }

  async findAccepted(userId) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => log.status === 'accepted')
      .map(log => NutriLog.fromJSON(log));
  }

  async updateStatus(userId, id, status) {
    const logs = this.#loadLogs(userId);
    if (!logs[id]) return null;

    logs[id].status = status;
    logs[id].updatedAt = new Date().toISOString();
    if (status === 'accepted') {
      logs[id].acceptedAt = new Date().toISOString();
    }

    this.#saveLogs(userId, logs);
    return NutriLog.fromJSON(logs[id]);
  }

  async delete(userId, id) {
    return this.updateStatus(userId, id, 'deleted');
  }

  async count(userId, options = {}) {
    const logs = this.#loadLogs(userId);
    let items = Object.values(logs);

    if (options.status) {
      items = items.filter(log => log.status === options.status);
    }
    if (options.date) {
      items = items.filter(log => log.meal?.date === options.date);
    }

    return items.length;
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlNutriLogStore.mjs
git commit -m "feat(adapters): add YamlNutriLogStore implementing INutriLogStore"
```

---

### Task 1.6: Create YamlNutriListStore Adapter

**Files:**
- Create: `backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs`

**Step 1: Create the adapter**

Create `backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs`:
```javascript
// backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs
import { loadYaml, saveYaml } from '../../../0_infrastructure/utils/FileIO.mjs';

/**
 * YAML-based NutriList persistence adapter
 * Implements INutriListStore port
 *
 * Stores denormalized food items for fast reporting
 */
export class YamlNutriListStore {
  #userDataService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService for path resolution
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.userDataService) {
      throw new Error('YamlNutriListStore requires userDataService');
    }
    this.#userDataService = config.userDataService;
    this.#logger = config.logger || console;
  }

  #getPath(userId) {
    return this.#userDataService.getUserPath(userId, 'lifelog/nutrition/nutrilist');
  }

  #loadItems(userId) {
    const path = this.#getPath(userId);
    const data = loadYaml(path);
    return Array.isArray(data) ? data : [];
  }

  #saveItems(userId, items) {
    const path = this.#getPath(userId);
    saveYaml(path, items);
  }

  /**
   * Sync items from a NutriLog (removes old items for log, adds new if accepted)
   * @param {NutriLog} nutriLog
   */
  async syncFromLog(nutriLog) {
    const userId = nutriLog.userId;
    let items = this.#loadItems(userId);

    // Remove existing items for this log
    items = items.filter(item => item.logId !== nutriLog.id);

    // Add new items if log is accepted
    if (nutriLog.status === 'accepted') {
      const newItems = nutriLog.toNutriListItems();
      items = [...items, ...newItems];
    }

    this.#saveItems(userId, items);

    this.#logger.debug?.('nutrilist.synced', {
      userId,
      logId: nutriLog.id,
      status: nutriLog.status,
      itemCount: nutriLog.items.length
    });
  }

  async addItem(userId, item) {
    const items = this.#loadItems(userId);
    items.push(item);
    this.#saveItems(userId, items);
    return item;
  }

  async getItemsForDate(userId, date) {
    const items = this.#loadItems(userId);
    return items.filter(item => item.date === date);
  }

  async getItemsForDateRange(userId, startDate, endDate) {
    const items = this.#loadItems(userId);
    return items.filter(item => item.date >= startDate && item.date <= endDate);
  }

  async findByLogId(userId, logId) {
    const items = this.#loadItems(userId);
    return items.filter(item => item.logId === logId);
  }

  async updateItem(userId, itemId, updates) {
    const items = this.#loadItems(userId);
    const index = items.findIndex(item => item.id === itemId || item.uuid === itemId);

    if (index === -1) return null;

    items[index] = { ...items[index], ...updates };
    this.#saveItems(userId, items);

    return items[index];
  }

  async removeItem(userId, itemId) {
    const items = this.#loadItems(userId);
    const filtered = items.filter(item => item.id !== itemId && item.uuid !== itemId);

    if (filtered.length === items.length) return false;

    this.#saveItems(userId, filtered);
    return true;
  }

  async removeByLogId(userId, logId) {
    const items = this.#loadItems(userId);
    const filtered = items.filter(item => item.logId !== logId);
    const removedCount = items.length - filtered.length;

    this.#saveItems(userId, filtered);
    return removedCount;
  }

  async getColorSummary(userId, date) {
    const items = await this.getItemsForDate(userId, date);
    return {
      green: items.filter(i => i.color === 'green').reduce((sum, i) => sum + (i.grams || 0), 0),
      yellow: items.filter(i => i.color === 'yellow').reduce((sum, i) => sum + (i.grams || 0), 0),
      orange: items.filter(i => i.color === 'orange').reduce((sum, i) => sum + (i.grams || 0), 0)
    };
  }

  async getNutritionSummary(userId, date) {
    const items = await this.getItemsForDate(userId, date);
    return {
      calories: items.reduce((sum, i) => sum + (i.calories || 0), 0),
      protein: items.reduce((sum, i) => sum + (i.protein || 0), 0),
      carbs: items.reduce((sum, i) => sum + (i.carbs || 0), 0),
      fat: items.reduce((sum, i) => sum + (i.fat || 0), 0),
      fiber: items.reduce((sum, i) => sum + (i.fiber || 0), 0),
      sodium: items.reduce((sum, i) => sum + (i.sodium || 0), 0)
    };
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/2_adapters/persistence/yaml/YamlNutriListStore.mjs
git commit -m "feat(adapters): add YamlNutriListStore implementing INutriListStore"
```

---

## Phase 2: External Adapters

### Task 2.1: Create TelegramMessagingAdapter

**Files:**
- Create: `backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs`

**Step 1: Create the adapter**

Create `backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs`:
```javascript
// backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs

/**
 * Telegram messaging adapter implementing IMessagingGateway
 */
export class TelegramMessagingAdapter {
  #token;
  #baseUrl;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.token - Telegram bot token
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.token) {
      throw new Error('TelegramMessagingAdapter requires token');
    }
    this.#token = config.token;
    this.#baseUrl = `https://api.telegram.org/bot${config.token}`;
    this.#logger = config.logger || console;
  }

  async #callApi(method, params = {}) {
    const response = await fetch(`${this.#baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const data = await response.json();

    if (!data.ok) {
      this.#logger.error?.('telegram.api.error', {
        method,
        error: data.description
      });
      throw new Error(`Telegram API error: ${data.description}`);
    }

    return data.result;
  }

  /**
   * Extract chat ID from conversation ID format "telegram:botId_chatId"
   */
  #extractChatId(userId) {
    if (userId.includes('_')) {
      return userId.split('_').pop();
    }
    return userId;
  }

  async sendMessage(userId, text, options = {}) {
    const chatId = this.#extractChatId(userId);
    const result = await this.#callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      disable_notification: options.silent || false
    });

    this.#logger.debug?.('telegram.message.sent', {
      chatId,
      messageId: result.message_id
    });

    return { messageId: String(result.message_id) };
  }

  async sendPhoto(userId, imageSource, caption, options = {}) {
    const chatId = this.#extractChatId(userId);

    // imageSource can be URL, file_id, or Buffer
    const params = {
      chat_id: chatId,
      caption,
      parse_mode: options.parseMode || 'HTML'
    };

    if (typeof imageSource === 'string') {
      params.photo = imageSource;
    } else {
      // Buffer - would need multipart form data
      throw new Error('Buffer upload not yet implemented');
    }

    const result = await this.#callApi('sendPhoto', params);
    return { messageId: String(result.message_id) };
  }

  async sendKeyboard(userId, text, buttons, options = {}) {
    const chatId = this.#extractChatId(userId);

    // Convert abstract buttons to Telegram inline keyboard format
    const inlineKeyboard = buttons.map(row =>
      row.map(btn => ({
        text: btn.label,
        callback_data: btn.data
      }))
    );

    const result = await this.#callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });

    return { messageId: String(result.message_id) };
  }

  async editMessage(userId, messageId, text, options = {}) {
    const chatId = this.#extractChatId(userId);

    await this.#callApi('editMessageText', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      text,
      parse_mode: options.parseMode || 'HTML'
    });

    return { messageId };
  }

  async editKeyboard(userId, messageId, buttons) {
    const chatId = this.#extractChatId(userId);

    const inlineKeyboard = buttons.map(row =>
      row.map(btn => ({
        text: btn.label,
        callback_data: btn.data
      }))
    );

    await this.#callApi('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      reply_markup: { inline_keyboard: inlineKeyboard }
    });

    return { messageId };
  }

  async deleteMessage(userId, messageId) {
    const chatId = this.#extractChatId(userId);

    await this.#callApi('deleteMessage', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10)
    });

    return true;
  }

  async answerCallback(callbackId, text) {
    await this.#callApi('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: text || undefined
    });

    return true;
  }

  async getFileUrl(fileId) {
    const file = await this.#callApi('getFile', { file_id: fileId });
    return `https://api.telegram.org/file/bot${this.#token}/${file.file_path}`;
  }

  async downloadFile(fileId) {
    const url = await this.getFileUrl(fileId);
    const response = await fetch(url);
    return Buffer.from(await response.arrayBuffer());
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs
git commit -m "feat(adapters): add TelegramMessagingAdapter implementing IMessagingGateway"
```

---

### Task 2.2: Create TelegramWebhookParser

**Files:**
- Create: `backend/src/2_adapters/telegram/TelegramWebhookParser.mjs`

**Step 1: Create the parser**

Create `backend/src/2_adapters/telegram/TelegramWebhookParser.mjs`:
```javascript
// backend/src/2_adapters/telegram/TelegramWebhookParser.mjs

/**
 * @typedef {Object} NormalizedInput
 * @property {'text'|'image'|'voice'|'callback'|'command'|'upc'} type
 * @property {string} userId - Conversation ID format: "telegram:botId_chatId"
 * @property {string} [text] - Text content (for text/command types)
 * @property {string} [command] - Command name without slash (for command type)
 * @property {string} [fileId] - Telegram file ID (for image/voice types)
 * @property {string} [callbackData] - Callback data (for callback type)
 * @property {string} [callbackId] - Callback query ID for acknowledgment
 * @property {string} [messageId] - Source message ID
 * @property {Object} [metadata] - Additional context
 */

/**
 * Parses Telegram webhook payloads into normalized input events
 */
export class TelegramWebhookParser {
  #botId;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.botId - Telegram bot ID
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.botId) {
      throw new Error('TelegramWebhookParser requires botId');
    }
    this.#botId = config.botId;
    this.#logger = config.logger || console;
  }

  #buildConversationId(chatId) {
    return `telegram:${this.#botId}_${chatId}`;
  }

  #isUPC(text) {
    // UPC codes are 8-14 digits, optionally with dashes
    const cleaned = text.replace(/-/g, '');
    return /^\d{8,14}$/.test(cleaned);
  }

  #isCommand(text) {
    return text.startsWith('/');
  }

  /**
   * Parse Telegram update into normalized input
   * @param {Object} update - Telegram webhook update
   * @returns {NormalizedInput|null}
   */
  parse(update) {
    // Handle callback queries (button presses)
    if (update.callback_query) {
      return this.#parseCallback(update.callback_query);
    }

    // Handle messages
    const message = update.message || update.edited_message;
    if (!message) {
      this.#logger.debug?.('telegram.parse.unsupported', { updateKeys: Object.keys(update) });
      return null;
    }

    // Route by message content type
    if (message.photo) {
      return this.#parsePhoto(message);
    }
    if (message.voice) {
      return this.#parseVoice(message);
    }
    if (message.text) {
      return this.#parseText(message);
    }

    this.#logger.debug?.('telegram.parse.unsupported', { messageKeys: Object.keys(message) });
    return null;
  }

  #parseCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id || callbackQuery.from?.id;

    return {
      type: 'callback',
      userId: this.#buildConversationId(chatId),
      callbackData: callbackQuery.data,
      callbackId: callbackQuery.id,
      messageId: String(callbackQuery.message?.message_id),
      metadata: {
        from: callbackQuery.from,
        chatType: callbackQuery.message?.chat?.type
      }
    };
  }

  #parsePhoto(message) {
    // Get largest photo size
    const photo = message.photo[message.photo.length - 1];

    return {
      type: 'image',
      userId: this.#buildConversationId(message.chat.id),
      fileId: photo.file_id,
      text: message.caption || '',
      messageId: String(message.message_id),
      metadata: {
        from: message.from,
        chatType: message.chat.type,
        width: photo.width,
        height: photo.height
      }
    };
  }

  #parseVoice(message) {
    return {
      type: 'voice',
      userId: this.#buildConversationId(message.chat.id),
      fileId: message.voice.file_id,
      messageId: String(message.message_id),
      metadata: {
        from: message.from,
        chatType: message.chat.type,
        duration: message.voice.duration,
        mimeType: message.voice.mime_type
      }
    };
  }

  #parseText(message) {
    const text = message.text.trim();

    // Check for command
    if (this.#isCommand(text)) {
      const [command, ...args] = text.slice(1).split(/\s+/);
      return {
        type: 'command',
        userId: this.#buildConversationId(message.chat.id),
        command: command.toLowerCase(),
        text: args.join(' '),
        messageId: String(message.message_id),
        metadata: {
          from: message.from,
          chatType: message.chat.type
        }
      };
    }

    // Check for UPC code
    if (this.#isUPC(text)) {
      return {
        type: 'upc',
        userId: this.#buildConversationId(message.chat.id),
        text: text.replace(/-/g, ''),
        messageId: String(message.message_id),
        metadata: {
          from: message.from,
          chatType: message.chat.type
        }
      };
    }

    // Regular text
    return {
      type: 'text',
      userId: this.#buildConversationId(message.chat.id),
      text,
      messageId: String(message.message_id),
      metadata: {
        from: message.from,
        chatType: message.chat.type
      }
    };
  }
}
```

**Step 2: Create index for telegram adapters**

Create `backend/src/2_adapters/telegram/index.mjs`:
```javascript
// backend/src/2_adapters/telegram/index.mjs
export { TelegramMessagingAdapter } from './TelegramMessagingAdapter.mjs';
export { TelegramWebhookParser } from './TelegramWebhookParser.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/telegram/
git commit -m "feat(adapters): add TelegramWebhookParser for normalizing webhook payloads"
```

---

### Task 2.3: Create OpenAIFoodParserAdapter

**Files:**
- Create: `backend/src/2_adapters/ai/OpenAIFoodParserAdapter.mjs`

**Step 1: Create the adapter**

Create `backend/src/2_adapters/ai/OpenAIFoodParserAdapter.mjs`:
```javascript
// backend/src/2_adapters/ai/OpenAIFoodParserAdapter.mjs
import { FoodItem } from '../../1_domains/lifelog/entities/FoodItem.mjs';

/**
 * OpenAI-based food parser implementing IFoodParser
 */
export class OpenAIFoodParserAdapter {
  #apiKey;
  #model;
  #baseUrl;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.apiKey - OpenAI API key
   * @param {string} [config.model] - Model to use (default: gpt-4o-mini)
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.apiKey) {
      throw new Error('OpenAIFoodParserAdapter requires apiKey');
    }
    this.#apiKey = config.apiKey;
    this.#model = config.model || 'gpt-4o-mini';
    this.#baseUrl = 'https://api.openai.com/v1';
    this.#logger = config.logger || console;
  }

  async #callOpenAI(messages, options = {}) {
    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.#apiKey}`
      },
      body: JSON.stringify({
        model: this.#model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2000,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();

    if (data.error) {
      this.#logger.error?.('openai.error', { error: data.error });
      throw new Error(`OpenAI API error: ${data.error.message}`);
    }

    return data.choices[0].message.content;
  }

  #buildFoodParsePrompt(text, context = {}) {
    return [
      {
        role: 'system',
        content: `You are a nutrition AI that parses food descriptions into structured data.

Given a food description, extract:
- Individual food items with estimated portions
- Noom color category (green: <1 cal/g, yellow: 1-2.4 cal/g, orange: >2.4 cal/g)
- Estimated nutrition (calories, protein, carbs, fat, fiber, sodium)

Respond with JSON:
{
  "items": [
    {
      "label": "food name",
      "icon": "emoji",
      "grams": number,
      "unit": "g",
      "amount": number,
      "color": "green|yellow|orange",
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "fiber": number,
      "sodium": number
    }
  ],
  "questions": ["clarification questions if portions unclear"]
}`
      },
      {
        role: 'user',
        content: `Parse this food: "${text}"${context.timezone ? ` (timezone: ${context.timezone})` : ''}`
      }
    ];
  }

  async parseText(text, context = {}) {
    const messages = this.#buildFoodParsePrompt(text, context);
    const response = await this.#callOpenAI(messages);

    try {
      const parsed = JSON.parse(response);

      this.#logger.debug?.('foodparser.parsed', {
        input: text,
        itemCount: parsed.items?.length || 0
      });

      return {
        items: (parsed.items || []).map(item => FoodItem.create(item)),
        questions: parsed.questions || []
      };
    } catch (err) {
      this.#logger.error?.('foodparser.parse.error', { error: err.message, response });
      throw new Error('Failed to parse food response');
    }
  }

  async parseImage(imageUrl, context = {}) {
    const messages = [
      {
        role: 'system',
        content: `You are a nutrition AI that identifies food in images.
Analyze the image and identify all visible food items with estimated portions.
Respond with the same JSON format as text parsing.`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Identify the food in this image:' },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ];

    const response = await this.#callOpenAI(messages);
    const parsed = JSON.parse(response);

    return {
      items: (parsed.items || []).map(item => FoodItem.create(item)),
      questions: parsed.questions || []
    };
  }

  async parseVoice(audioBuffer, context = {}) {
    // Voice parsing requires transcription first
    // This would typically use Whisper API
    throw new Error('Voice parsing not yet implemented - requires transcription service');
  }
}
```

**Step 2: Create index for ai adapters**

Create `backend/src/2_adapters/ai/index.mjs`:
```javascript
// backend/src/2_adapters/ai/index.mjs
export { OpenAIFoodParserAdapter } from './OpenAIFoodParserAdapter.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/ai/
git commit -m "feat(adapters): add OpenAIFoodParserAdapter implementing IFoodParser"
```

---

### Task 2.4: Create NutritionixAdapter

**Files:**
- Create: `backend/src/2_adapters/nutrition/NutritionixAdapter.mjs`

**Step 1: Create the adapter**

Create `backend/src/2_adapters/nutrition/NutritionixAdapter.mjs`:
```javascript
// backend/src/2_adapters/nutrition/NutritionixAdapter.mjs

/**
 * Nutritionix API adapter implementing INutritionLookup
 */
export class NutritionixAdapter {
  #appId;
  #appKey;
  #baseUrl;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.appId - Nutritionix App ID
   * @param {string} config.appKey - Nutritionix App Key
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.appId || !config.appKey) {
      throw new Error('NutritionixAdapter requires appId and appKey');
    }
    this.#appId = config.appId;
    this.#appKey = config.appKey;
    this.#baseUrl = 'https://trackapi.nutritionix.com/v2';
    this.#logger = config.logger || console;
  }

  async #callApi(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': this.#appId,
        'x-app-key': this.#appKey
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.#baseUrl}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      this.#logger.error?.('nutritionix.error', { endpoint, error: data });
      throw new Error(`Nutritionix API error: ${data.message || response.statusText}`);
    }

    return data;
  }

  #mapNutritionixToFoodData(food) {
    return {
      label: food.food_name,
      icon: this.#getFoodIcon(food.food_name),
      grams: food.serving_weight_grams || 100,
      unit: food.serving_unit || 'g',
      amount: food.serving_qty || 1,
      calories: Math.round(food.nf_calories || 0),
      protein: Math.round(food.nf_protein || 0),
      carbs: Math.round(food.nf_total_carbohydrate || 0),
      fat: Math.round(food.nf_total_fat || 0),
      fiber: Math.round(food.nf_dietary_fiber || 0),
      sodium: Math.round(food.nf_sodium || 0),
      sugar: Math.round(food.nf_sugars || 0),
      cholesterol: Math.round(food.nf_cholesterol || 0),
      color: this.#calculateNoomColor(food.nf_calories, food.serving_weight_grams)
    };
  }

  #calculateNoomColor(calories, grams) {
    if (!calories || !grams) return 'yellow';
    const density = calories / grams;
    if (density < 1) return 'green';
    if (density < 2.4) return 'yellow';
    return 'orange';
  }

  #getFoodIcon(foodName) {
    // Simple emoji mapping - could be expanded
    const lowerName = foodName.toLowerCase();
    if (lowerName.includes('apple')) return '🍎';
    if (lowerName.includes('banana')) return '🍌';
    if (lowerName.includes('chicken')) return '🍗';
    if (lowerName.includes('egg')) return '🥚';
    if (lowerName.includes('bread')) return '🍞';
    if (lowerName.includes('rice')) return '🍚';
    if (lowerName.includes('salad')) return '🥗';
    if (lowerName.includes('coffee')) return '☕';
    return '🍽️';
  }

  async lookupByName(foodName) {
    const data = await this.#callApi('/natural/nutrients', 'POST', {
      query: foodName
    });

    if (!data.foods || data.foods.length === 0) {
      return null;
    }

    this.#logger.debug?.('nutritionix.lookup.name', {
      query: foodName,
      results: data.foods.length
    });

    return data.foods.map(food => this.#mapNutritionixToFoodData(food));
  }

  async lookupByUPC(barcode) {
    const data = await this.#callApi(`/search/item?upc=${barcode}`);

    if (!data.foods || data.foods.length === 0) {
      return null;
    }

    this.#logger.debug?.('nutritionix.lookup.upc', {
      barcode,
      product: data.foods[0]?.food_name
    });

    return this.#mapNutritionixToFoodData(data.foods[0]);
  }
}
```

**Step 2: Create index for nutrition adapters**

Create `backend/src/2_adapters/nutrition/index.mjs`:
```javascript
// backend/src/2_adapters/nutrition/index.mjs
export { NutritionixAdapter } from './NutritionixAdapter.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/nutrition/
git commit -m "feat(adapters): add NutritionixAdapter implementing INutritionLookup"
```

---

## Phase 3: Application Layer

### Task 3.1: Inline Callback Utility

**Files:**
- Create: `backend/src/3_applications/nutribot/lib/callback.mjs`

**Step 1: Create inlined callback utility**

Create `backend/src/3_applications/nutribot/lib/callback.mjs`:
```javascript
// backend/src/3_applications/nutribot/lib/callback.mjs

/**
 * Encode action and params into callback data string
 * @param {string} action - Action identifier
 * @param {Object} params - Additional parameters
 * @returns {string} JSON-encoded callback data
 */
export function encodeCallback(action, params = {}) {
  const payload = { a: action, ...params };
  return JSON.stringify(payload);
}

/**
 * Decode callback data string into action and params
 * @param {string} data - Callback data string
 * @returns {Object} Decoded object with 'a' property for action
 */
export function decodeCallback(data) {
  try {
    if (typeof data === 'string' && data.startsWith('{')) {
      return JSON.parse(data);
    }
    return { legacy: true, raw: data };
  } catch (err) {
    return { legacy: true, raw: data, error: err.message };
  }
}

/**
 * Common callback actions
 */
export const CallbackActions = {
  ACCEPT_LOG: 'accept_log',
  REJECT_LOG: 'reject_log',
  DELETE_LOG: 'delete_log',
  REVISE_ITEM: 'revise_item',
  DATE_SELECT: 'date_select',
  PORTION_ADJUST: 'portion_adjust',
  CONFIRM_ALL: 'confirm_all'
};
```

**Step 2: Create lib directory index**

Create `backend/src/3_applications/nutribot/lib/index.mjs`:
```javascript
// backend/src/3_applications/nutribot/lib/index.mjs
export { encodeCallback, decodeCallback, CallbackActions } from './callback.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/
git commit -m "feat(nutribot): inline callback utility from legacy"
```

---

### Task 3.2: Create WebhookHandler

**Files:**
- Create: `backend/src/3_applications/nutribot/handlers/WebhookHandler.mjs`

**Step 1: Create the webhook handler**

Create `backend/src/3_applications/nutribot/handlers/WebhookHandler.mjs`:
```javascript
// backend/src/3_applications/nutribot/handlers/WebhookHandler.mjs
import { decodeCallback, CallbackActions } from '../lib/callback.mjs';

/**
 * Routes normalized webhook input to appropriate use cases
 */
export class WebhookHandler {
  #container;
  #config;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.container - NutribotContainer with use cases
   * @param {Object} config.nutribotConfig - Nutribot configuration
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.container) {
      throw new Error('WebhookHandler requires container');
    }
    this.#container = config.container;
    this.#config = config.nutribotConfig;
    this.#logger = config.logger || console;
  }

  /**
   * Handle normalized input event
   * @param {Object} input - Normalized input from TelegramWebhookParser
   * @returns {Promise<Object>} Response to send back
   */
  async handle(input) {
    this.#logger.debug?.('webhook.received', {
      type: input.type,
      userId: input.userId
    });

    try {
      switch (input.type) {
        case 'text':
          return await this.#handleText(input);
        case 'image':
          return await this.#handleImage(input);
        case 'voice':
          return await this.#handleVoice(input);
        case 'upc':
          return await this.#handleUPC(input);
        case 'callback':
          return await this.#handleCallback(input);
        case 'command':
          return await this.#handleCommand(input);
        default:
          this.#logger.warn?.('webhook.unsupported', { type: input.type });
          return { ok: true, handled: false };
      }
    } catch (error) {
      this.#logger.error?.('webhook.error', {
        type: input.type,
        error: error.message
      });
      throw error;
    }
  }

  async #handleText(input) {
    const useCase = this.#container.getLogFoodFromText();
    const result = await useCase.execute({
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      text: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleImage(input) {
    const useCase = this.#container.getLogFoodFromImage();
    const result = await useCase.execute({
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      fileId: input.fileId,
      caption: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleVoice(input) {
    const useCase = this.#container.getLogFoodFromVoice();
    const result = await useCase.execute({
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      fileId: input.fileId,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleUPC(input) {
    const useCase = this.#container.getLogFoodFromUPC();
    const result = await useCase.execute({
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      barcode: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleCallback(input) {
    const decoded = decodeCallback(input.callbackData);
    const action = decoded.a;

    // Acknowledge callback immediately
    const messaging = this.#container.getMessagingGateway();
    await messaging.answerCallback(input.callbackId);

    switch (action) {
      case CallbackActions.ACCEPT_LOG: {
        const useCase = this.#container.getAcceptFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          logId: decoded.id,
          messageId: input.messageId
        });
      }
      case CallbackActions.REJECT_LOG: {
        const useCase = this.#container.getDiscardFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          logId: decoded.id,
          messageId: input.messageId
        });
      }
      case CallbackActions.REVISE_ITEM: {
        const useCase = this.#container.getReviseFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          logId: decoded.logId,
          itemId: decoded.itemId,
          messageId: input.messageId
        });
      }
      default:
        this.#logger.warn?.('webhook.callback.unknown', { action });
        return { ok: true, handled: false };
    }
  }

  async #handleCommand(input) {
    switch (input.command) {
      case 'help': {
        const useCase = this.#container.getHandleHelpCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          conversationId: input.userId
        });
      }
      case 'review': {
        const useCase = this.#container.getHandleReviewCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          conversationId: input.userId
        });
      }
      case 'report': {
        const useCase = this.#container.getGenerateDailyReport();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          conversationId: input.userId
        });
      }
      default:
        this.#logger.warn?.('webhook.command.unknown', { command: input.command });
        return { ok: true, handled: false };
    }
  }

  /**
   * Resolve system user ID from conversation ID
   */
  #resolveUserId(conversationId) {
    if (this.#config?.getUserIdFromConversation) {
      return this.#config.getUserIdFromConversation(conversationId) || conversationId;
    }
    return conversationId;
  }
}
```

**Step 2: Create handlers index**

Create `backend/src/3_applications/nutribot/handlers/index.mjs`:
```javascript
// backend/src/3_applications/nutribot/handlers/index.mjs
export { WebhookHandler } from './WebhookHandler.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/handlers/
git commit -m "feat(nutribot): add WebhookHandler for routing normalized input to use cases"
```

---

## Phase 4: Cutover

### Task 4.1: Update Bootstrap to Wire New Services

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`

**Step 1: Add nutribot service creation function**

Add to `backend/src/0_infrastructure/bootstrap.mjs` (find appropriate section):
```javascript
// Add imports at top
import { YamlNutriLogStore } from '../2_adapters/persistence/yaml/YamlNutriLogStore.mjs';
import { YamlNutriListStore } from '../2_adapters/persistence/yaml/YamlNutriListStore.mjs';
import { TelegramMessagingAdapter } from '../2_adapters/telegram/TelegramMessagingAdapter.mjs';
import { TelegramWebhookParser } from '../2_adapters/telegram/TelegramWebhookParser.mjs';
import { OpenAIFoodParserAdapter } from '../2_adapters/ai/OpenAIFoodParserAdapter.mjs';
import { NutritionixAdapter } from '../2_adapters/nutrition/NutritionixAdapter.mjs';
import { WebhookHandler } from '../3_applications/nutribot/handlers/WebhookHandler.mjs';

/**
 * Create nutribot services with DDD architecture
 * @param {Object} config
 * @param {Object} config.userDataService
 * @param {Object} config.telegram - { token, botId }
 * @param {Object} config.openai - { apiKey }
 * @param {Object} config.nutritionix - { appId, appKey }
 * @param {Object} [config.logger]
 * @returns {Object}
 */
export function createNutribotServices(config) {
  const { userDataService, telegram, openai, nutritionix, logger = console } = config;

  // Persistence adapters
  const nutriLogStore = new YamlNutriLogStore({ userDataService, logger });
  const nutriListStore = new YamlNutriListStore({ userDataService, logger });

  // External service adapters
  const messagingGateway = telegram?.token
    ? new TelegramMessagingAdapter({ token: telegram.token, logger })
    : null;

  const webhookParser = telegram?.botId
    ? new TelegramWebhookParser({ botId: telegram.botId, logger })
    : null;

  const foodParser = openai?.apiKey
    ? new OpenAIFoodParserAdapter({ apiKey: openai.apiKey, logger })
    : null;

  const nutritionLookup = nutritionix?.appId
    ? new NutritionixAdapter({
        appId: nutritionix.appId,
        appKey: nutritionix.appKey,
        logger
      })
    : null;

  return {
    nutriLogStore,
    nutriListStore,
    messagingGateway,
    webhookParser,
    foodParser,
    nutritionLookup
  };
}
```

**Step 2: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs
git commit -m "feat(bootstrap): add createNutribotServices for DDD nutribot wiring"
```

---

### Task 4.2: Update API Router

**Files:**
- Modify: `backend/src/4_api/routers/nutribot.mjs`

**Step 1: Update router to use new components**

This task requires reviewing the existing router and updating it to use:
- `TelegramWebhookParser` for parsing incoming webhooks
- `WebhookHandler` for routing to use cases
- New adapter-based services

The specific changes depend on the current router structure. Key pattern:

```javascript
// In router
router.post('/webhook', async (req, res) => {
  try {
    // Parse Telegram update into normalized input
    const input = webhookParser.parse(req.body);
    if (!input) {
      return res.sendStatus(200); // Acknowledge unknown updates
    }

    // Route to use cases via handler
    await webhookHandler.handle(input);

    res.sendStatus(200);
  } catch (error) {
    logger.error?.('nutribot.webhook.error', { error: error.message });
    res.sendStatus(200); // Always 200 to Telegram to prevent retries
  }
});
```

**Step 2: Test the new wiring manually**

Send test messages via Telegram to verify:
1. Text messages are parsed and logged
2. Callbacks work (accept/reject buttons)
3. Commands work (/help, /report)

**Step 3: Commit**

```bash
git add backend/src/4_api/routers/nutribot.mjs
git commit -m "refactor(nutribot): update router to use DDD adapters and WebhookHandler"
```

---

### Task 4.3: Verify and Clean Up

**Step 1: End-to-end testing**

Test all input types via Telegram:
- [ ] Text message: "2 eggs and toast"
- [ ] Image: Send food photo
- [ ] UPC: Send barcode number
- [ ] Callback: Accept/reject pending log
- [ ] Command: /help, /report, /review

**Step 2: Verify YAML files**

Check that data is being written correctly:
```bash
cat {data_mount}/users/{username}/lifelog/nutrition/nutrilog.yml
cat {data_mount}/users/{username}/lifelog/nutrition/nutrilist.yml
```

**Step 3: Document legacy code for deletion**

Create list of legacy files to delete after confidence period:
- `backend/_legacy/chatbots/bots/nutribot/` (entire directory)
- Related imports in other files

**Step 4: Final commit**

```bash
git add .
git commit -m "feat(nutribot): complete DDD migration - ready for production validation"
```

---

## Summary

**Total Tasks:** 14 tasks across 4 phases

**Files Created:**
- `1_domains/lifelog/entities/FoodItem.mjs`
- `1_domains/lifelog/entities/NutriLog.mjs`
- `3_applications/nutribot/ports/` (5 port interfaces)
- `2_adapters/persistence/yaml/YamlNutriLogStore.mjs`
- `2_adapters/persistence/yaml/YamlNutriListStore.mjs`
- `2_adapters/telegram/TelegramMessagingAdapter.mjs`
- `2_adapters/telegram/TelegramWebhookParser.mjs`
- `2_adapters/ai/OpenAIFoodParserAdapter.mjs`
- `2_adapters/nutrition/NutritionixAdapter.mjs`
- `3_applications/nutribot/lib/callback.mjs`
- `3_applications/nutribot/handlers/WebhookHandler.mjs`

**Files Modified:**
- `0_infrastructure/bootstrap.mjs`
- `4_api/routers/nutribot.mjs`

**Key Patterns Used:**
- Port interfaces with validation functions
- Adapter classes with constructor injection
- Private fields for encapsulation
- FileIO for all YAML operations
- Normalized input abstraction (Telegram-agnostic)
