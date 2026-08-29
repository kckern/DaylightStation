import { IHealthCoachWorkspaceRepository } from '#apps/agents/health-coach/ports/IHealthCoachWorkspaceRepository.mjs';

export class DataServiceHealthCoachWorkspaceRepository extends IHealthCoachWorkspaceRepository {
  #dataService; #profileService; #mediaProgressMemory;
  constructor({ dataService, profileService = null, mediaProgressMemory = null }) {
    super();
    if (!dataService?.user?.read || !dataService?.user?.write) {
      throw new Error('DataServiceHealthCoachWorkspaceRepository requires dataService user read/write');
    }
    this.#dataService = dataService;
    this.#profileService = profileService;
    this.#mediaProgressMemory = mediaProgressMemory;
  }
  getHealthProfile(userId) { return this.#dataService.user.read('profile/health', userId); }
  getBaselines(userId) { return this.#dataService.user.read('profile/baselines', userId); }
  saveBaselines(userId, payload) { return this.#dataService.user.write('profile/baselines', payload, userId); }
  async saveDashboard(userId, date, dashboard) {
    await this.#dataService.user.write(`health-dashboard/${date}`, dashboard, userId);
    return `health-dashboard/${date}`;
  }
  getGoals(userId) {
    const goals = this.#dataService.user.read('agents/health-coach/goals', userId) || {};
    if (goals.nutrition?.calories_min || !this.#profileService?.isReady?.()) return goals;
    const profileGoals = this.#profileService.getUserProfile(userId)?.apps?.nutribot?.goals;
    if (!profileGoals) return goals;
    return {
      ...goals,
      nutrition: {
        ...goals.nutrition,
        calories_min: profileGoals.calories_min,
        calories_max: profileGoals.calories_max,
        protein_g: goals.nutrition?.protein_g || profileGoals.protein,
        carbs_g: goals.nutrition?.carbs_g || profileGoals.carbs,
        fat_g: goals.nutrition?.fat_g || profileGoals.fat,
        fiber_g: goals.nutrition?.fiber_g || profileGoals.fiber,
        sodium_mg: goals.nutrition?.sodium_mg || profileGoals.sodium,
      },
    };
  }
  getProgramState(userId) { return this.#dataService.user.read('agents/health-coach/program-state', userId); }
  saveProgramState(userId, state) { return this.#dataService.user.write('agents/health-coach/program-state', state, userId); }
  async listRecentFitnessProgress(days = 7, nowMs = Date.now()) {
    if (!this.#mediaProgressMemory) return null;
    const all = await this.#mediaProgressMemory.listProgress('plex/14_fitness');
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    return all.filter((item) => item.lastPlayed && new Date(item.lastPlayed).getTime() >= cutoff)
      .sort((a, b) => new Date(b.lastPlayed).getTime() - new Date(a.lastPlayed).getTime());
  }
}
export default DataServiceHealthCoachWorkspaceRepository;
