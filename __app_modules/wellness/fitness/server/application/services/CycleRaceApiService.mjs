/** Joins household cycle-game policy to race projections (ladder, personal best, rival pool). */
export class CycleRaceApiService {
  constructor({ races, config }) { this.races = races; this.config = config; }
  get available() { return Boolean(this.races); }
  ladder({ householdId, week }) {
    return this.races.getLadder({ cycleGameConfig: this.config?.getCycleGameConfig(householdId) || {}, week, householdId });
  }
  personalBest({ householdId, userId, courseId }) {
    return this.races.getPersonalBest({ cycleGameConfig: this.config?.getCycleGameConfig(householdId) || {}, userId, courseId, householdId });
  }
  rivalPool({ householdId, winCondition, goalM, timeCapS }) {
    return this.races.getRivalPool({ winCondition, goalM, timeCapS, householdId });
  }
}

export default CycleRaceApiService;
