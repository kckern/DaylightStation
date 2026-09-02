// Storage: data/users/{username}/apps/health/goals.yml
import { IHealthGoalsDatastore } from '#apps/health/ports/IHealthGoalsDatastore.mjs';

export class YamlHealthGoalsDatastore extends IHealthGoalsDatastore {
  #dataService;
  static GOALS_PATH = 'apps/health/goals';

  constructor(config) {
    super();
    if (!config.dataService) throw new Error('YamlHealthGoalsDatastore requires dataService');
    this.#dataService = config.dataService;
  }

  async load(userId) {
    const raw = this.#dataService.user.read?.(YamlHealthGoalsDatastore.GOALS_PATH, userId);
    return raw && typeof raw === 'object' ? raw : null;
  }

  async save(goals, userId) {
    const result = this.#dataService.user.write?.(YamlHealthGoalsDatastore.GOALS_PATH, goals, userId);
    if (result === false) {
      const err = new Error(`GOALS_WRITE_FAILED: could not write goals to ${YamlHealthGoalsDatastore.GOALS_PATH} for user ${userId}`);
      err.code = 'GOALS_WRITE_FAILED';
      throw err;
    }
  }
}
export default YamlHealthGoalsDatastore;
