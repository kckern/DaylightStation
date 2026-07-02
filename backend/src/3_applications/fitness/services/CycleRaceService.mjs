import {
  currentWeekWindow, isoWeekOf, parseIsoWeekParam,
  resolveFeaturedCourse, computeLadder, computePersonalBest
} from '#domains/fitness/services/cycleLadder.mjs';

/**
 * CycleRaceService - application service for cycle-game races.
 * Thin orchestration over YamlCycleRaceDatastore: save/get/list + ghost-candidate
 * lookup (filtered by course, or by win-condition+goal for custom races), plus
 * weekly-ladder and personal-best queries built on the pure cycleLadder domain module.
 */
export class CycleRaceService {
  constructor({ datastore, logger = null } = {}) {
    if (!datastore) throw new Error('CycleRaceService requires datastore');
    this.datastore = datastore;
    this.logger = logger;
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

  /** Weekly ladder for the featured course. null = no featured courses configured. */
  async getLadder({ cycleGameConfig = {}, week = null, householdId } = {}) {
    let window;
    let weekNo;
    if (week != null) {
      const parsed = parseIsoWeekParam(week);
      if (!parsed) {
        const err = new Error(`invalid week: ${week}`);
        err.code = 'BAD_WEEK';
        throw err;
      }
      window = parsed.window;
      weekNo = parsed.week;
    } else {
      const now = new Date();
      window = currentWeekWindow(now);
      weekNo = isoWeekOf(now).week;
    }
    const course = resolveFeaturedCourse(cycleGameConfig, weekNo);
    if (!course) return null;
    const t0 = Date.now();
    const entries = await this.datastore.listIndexEntries(householdId);
    const ladder = computeLadder({ course, entries, weekStart: window.start, weekEnd: window.end });
    this.logger?.debug?.('fitness.cycle_races.ladder.computed', {
      courseId: course.id, entries: entries.length, rungs: ladder.standings.length, ms: Date.now() - t0
    });
    return ladder;
  }

  /** All-time personal best on a course. Course def from config, else inferred from history. */
  async getPersonalBest({ cycleGameConfig = {}, userId, courseId, householdId } = {}) {
    const entries = await this.datastore.listIndexEntries(householdId);
    let course = (Array.isArray(cycleGameConfig?.featured_courses) ? cycleGameConfig.featured_courses : [])
      .find((c) => c?.id === courseId) || null;
    if (!course) {
      const sample = entries.find((e) => e.course_id === courseId);
      course = sample
        ? { id: courseId, win_condition: sample.win_condition, goal_m: sample.goal_m, time_cap_s: sample.time_cap_s }
        : { id: courseId, win_condition: 'distance', goal_m: null, time_cap_s: null };
    }
    return computePersonalBest({ entries, course, userId });
  }
}

export default CycleRaceService;
