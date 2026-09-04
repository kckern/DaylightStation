// Storage: data/users/{username}/apps/health/meal-templates.yml
//
// File shape: { templates: [...], dismissedKeys: [...] }. An older/foreign file
// holding a bare array is read as `{ templates: array, dismissedKeys: [] }`
// rather than thrown over — the same fail-soft posture the saved-meals store
// has, and it means a hand-written list of templates still loads.
import { IMealTemplateDatastore } from '#apps/health/ports/IMealTemplateDatastore.mjs';

export class YamlMealTemplateDatastore extends IMealTemplateDatastore {
  #dataService;
  static TEMPLATES_PATH = 'apps/health/meal-templates';

  constructor(config) {
    super();
    if (!config?.dataService) throw new Error('YamlMealTemplateDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  #load(userId) {
    const raw = this.#dataService.user.read?.(YamlMealTemplateDatastore.TEMPLATES_PATH, userId);
    if (Array.isArray(raw)) return { templates: raw, dismissedKeys: [] };
    return {
      templates: Array.isArray(raw?.templates) ? raw.templates : [],
      dismissedKeys: Array.isArray(raw?.dismissedKeys) ? raw.dismissedKeys : [],
    };
  }

  #write(file, userId) {
    const result = this.#dataService.user.write?.(YamlMealTemplateDatastore.TEMPLATES_PATH, file, userId);
    if (result === false) {
      const err = new Error(`TEMPLATES_WRITE_FAILED: could not write meal templates to ${YamlMealTemplateDatastore.TEMPLATES_PATH} for user ${userId}`);
      err.code = 'TEMPLATES_WRITE_FAILED';
      throw err;
    }
  }

  async list(userId) { return this.#load(userId).templates; }

  async getById(id, userId) {
    return this.#load(userId).templates.find((t) => t.id === id) || null;
  }

  async save(template, userId) {
    const file = this.#load(userId);
    const idx = file.templates.findIndex((t) => t.id === template.id);
    if (idx >= 0) file.templates[idx] = template; else file.templates.push(template);
    this.#write(file, userId);
  }

  async remove(id, userId) {
    const file = this.#load(userId);
    file.templates = file.templates.filter((t) => t.id !== id);
    this.#write(file, userId);
  }

  async listDismissedKeys(userId) { return this.#load(userId).dismissedKeys; }

  async addDismissedKey(key, userId) {
    const file = this.#load(userId);
    // A dismissal is idempotent by construction: the same key twice is one
    // entry, so a double-tap or a replayed request cannot grow the ledger.
    if (!file.dismissedKeys.includes(key)) file.dismissedKeys.push(key);
    this.#write(file, userId);
  }
}
export default YamlMealTemplateDatastore;
