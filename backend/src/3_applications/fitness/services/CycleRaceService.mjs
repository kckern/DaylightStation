/**
 * CycleRaceService - application service for cycle-game races.
 * Thin orchestration over YamlCycleRaceDatastore: save/get/list + ghost-candidate
 * lookup (filtered by course, or by win-condition+goal for custom races).
 */
export class CycleRaceService {
  constructor({ datastore } = {}) {
    if (!datastore) throw new Error('CycleRaceService requires datastore');
    this.datastore = datastore;
  }

  save(record, householdId) {
    // Never persist a dead race: if no participant covered any distance the row is
    // worthless ("0 m") and just clutters history. The client guards this too, but
    // we enforce it here so a stray POST can't slip a zero-distance race into storage.
    const totalDistanceM = Object.values(record?.participants || {})
      .reduce((sum, p) => sum + (Number(p?.final_distance_m) || 0), 0);
    if (totalDistanceM <= 0) return null;
    return this.datastore.save(record, householdId);
  }
  get(raceId, householdId) { return this.datastore.findById(raceId, householdId); }
  listByDate(date, householdId) { return this.datastore.findByDate(date, householdId); }
  listDates(householdId) { return this.datastore.listDates(householdId); }

  async findGhostCandidates({ courseId = null, winCondition = null, goalM = null, timeCapS = null, householdId } = {}) {
    const dates = await this.datastore.listDates(householdId);
    const matches = [];
    for (const date of dates) {
      const races = await this.datastore.findByDate(date, householdId);
      for (const r of races) {
        const rc = r?.race || {};
        const hit = courseId
          ? rc.course_id === courseId
          : (rc.win_condition === winCondition
              && (winCondition === 'distance' ? rc.goal_m === goalM : rc.time_cap_s === timeCapS));
        if (hit) matches.push(r);
      }
    }
    return matches;
  }
}

export default CycleRaceService;
