/**
 * Fitness's achievement evidence for the economy's gem rules
 * (`IAchievementEvidence` provider: activity-contest / milestone kinds).
 *
 *   race            contest   — the week's featured cycle course ladder
 *   race-pb         milestone — a new personal best on a featured course
 *   glider-act      milestone — first completion of a Skyline Glider act
 *   glider-bells    milestone — first run that collected every bell in an act
 *   ring-improved   contest   — award-week rings above the rider's 4-week average
 *   rings-lifetime  milestone — cumulative rings crossing 1k/5k/10k/25k/50k
 *
 * Read-only. Each sub-source is read once per call; one that throws makes only
 * ITS activities unavailable. A milestone is dated by the household study day
 * it happened on and keyed so that re-reading history gives the same key and
 * day forever — the economy pays it in exactly one week.
 *
 * Learner ids are fitness participant ids; `ghost:` riders never count.
 */
import { isoWeekOf } from '../../domain/services/cycleLadder.mjs';
import { raceEpochMs } from '../activities/CycleGameProvider.mjs';
import { evaluateRecapReadiness } from '../sessionConsolidationPolicy.mjs';

export const FITNESS_ACHIEVEMENT_ACTIVITIES = Object.freeze(['race', 'race-pb', 'glider-act', 'glider-bells', 'ring-improved', 'rings-lifetime']);
// Early marks for a new rider, then one every 10,000 rings: the household's
// kids are already past 50,000, so a fixed ladder would never fire again.
export const LIFETIME_RING_MARKS = Object.freeze([1000, 5000]);
export const LIFETIME_RING_STEP = 10_000;

/** Every mark in (before, total]: the early ones, then each multiple of the step. */
export function ringMarksCrossed(before, total) {
  const marks = LIFETIME_RING_MARKS.filter((m) => before < m && total >= m);
  for (let m = (Math.floor(before / LIFETIME_RING_STEP) + 1) * LIFETIME_RING_STEP; m <= total; m += LIFETIME_RING_STEP) marks.push(m);
  return marks;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const PRIOR_WEEKS = 4;
const MIN_PRIOR_WEEKS_WITH_RINGS = 2;

const isGhost = (id) => String(id).startsWith('ghost:');
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const inWeek = (day, week) => typeof day === 'string' && day >= week.from && day <= week.to;
const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v ?? ''));

/** 'YYYY-MM-DD' (a Monday) → the ISO week param the ladder takes, 'YYYY-Www'. */
export function isoWeekParam(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const { year, week } = isoWeekOf(new Date(y, m - 1, d));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Ladder value → contest score, higher is better: 1e6/seconds for a distance course, metres for a time course. */
export function ladderScore(course, bestValue) {
  if (!Number.isFinite(bestValue) || bestValue <= 0) return null;
  return course?.win_condition === 'distance' ? 1e6 / bestValue : bestValue;
}

/** Small stable string hash (djb2, base36) — fingerprints an act's bell set. */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** The bell ids of a resolved act (its collectible-path segments). */
export function actBells(act) {
  return (act?.segments ?? [])
    .filter((s) => s?.type === 'collectible-path')
    .flatMap((s) => s.collectibles ?? [])
    .map((c) => c?.id)
    .filter(Boolean);
}

/**
 * Personal bests from race index rows. Rows are grouped per course definition
 * (id + win condition + goal), walked in raceId (start-time) order; a rider's
 * strictly better result than their prior best on that course is a PB. Their
 * first ever valid result sets the bar and is not a PB. Lobby races
 * (course_id null) and ghosts never count.
 * @returns {Array<{learnerId, courseId, raceId, date}>}
 */
export function findPersonalBests(entries, learnerIds) {
  const wanted = new Set(learnerIds);
  const rows = (entries ?? []).filter((e) => e?.id && e.course_id).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const best = new Map();
  const out = [];
  for (const e of rows) {
    const lowerBetter = e.win_condition === 'distance';
    const course = `${e.course_id}|${e.win_condition}|${e.goal_m ?? ''}|${e.time_cap_s ?? ''}`;
    for (const p of e.participants ?? []) {
      if (!p || p.isGhost || isGhost(p.userId) || !wanted.has(p.userId)) continue;
      const v = lowerBetter ? p.final_time_s : p.final_distance_m;
      if (!Number.isFinite(v) || v <= 0) continue;
      const k = `${course}|${p.userId}`;
      const prior = best.get(k);
      if (prior == null) { best.set(k, v); continue; }
      if (lowerBetter ? v < prior : v > prior) {
        best.set(k, v);
        out.push({ learnerId: p.userId, courseId: e.course_id, raceId: String(e.id), date: e.date ?? null });
      }
    }
  }
  return out;
}

/**
 * @param {object} deps
 * @param {{getLadder: Function, listIndexEntries: Function, get: Function}} deps.races  CycleRaceService
 * @param {() => object} deps.cycleGameConfig  the household's `cycle_game` config (featured courses)
 * @param {{listAll: Function}} deps.gliderRuns  SkylineGliderRunService
 * @param {{list: Function}} deps.gliderActs  SkylineGliderCourseCatalog (resolved acts)
 * @param {{standings: Function}} deps.fitnessRings  fitnessRingsProvider
 * @param {{listSessionsInRange: Function}} deps.sessions  SessionService (index-backed summaries)
 * @param {string} [deps.householdId]
 * @param {object} [deps.logger]
 * @param {() => number} [deps.now]
 */
export function createFitnessAchievementProvider({
  races, cycleGameConfig = () => ({}), gliderRuns, gliderActs, fitnessRings, sessions,
  householdId = null, logger = null, now = () => Date.now(),
} = {}) {
  for (const [name, dep, fn] of [['races', races, 'getLadder'], ['races', races, 'listIndexEntries'], ['gliderRuns', gliderRuns, 'listAll'],
    ['gliderActs', gliderActs, 'list'], ['fitnessRings', fitnessRings, 'standings'], ['sessions', sessions, 'listSessionsInRange']]) {
    if (typeof dep?.[fn] !== 'function') throw new Error(`fitnessAchievementProvider requires ${name}.${fn}()`);
  }

  const courseLabel = (courseId) => {
    const featured = cycleGameConfig()?.featured_courses;
    const list = Array.isArray(featured) ? featured : [];
    return list.find((c) => c?.id === courseId)?.label || courseId;
  };

  /** race (contest) */
  async function raceContest({ learnerIds, week, today }) {
    const ladder = await races.getLadder({ cycleGameConfig: cycleGameConfig() || {}, week: isoWeekParam(week.from), householdId });
    const wanted = new Set(learnerIds);
    const standings = (ladder?.standings ?? [])
      .filter((s) => wanted.has(s.userId) && !isGhost(s.userId))
      .map((s) => ({ learnerId: s.userId, score: ladderScore(ladder.course, s.bestValue) }))
      .filter((s) => s.score != null);
    return { race: { standings, closed: today != null && today > week.to } };
  }

  /** race-pb (milestone) */
  async function racePbs({ learnerIds, week, studyDay }) {
    const pbs = findPersonalBests(await races.listIndexEntries(householdId), learnerIds)
      // Folder dates are local calendar days; the study day can be one earlier.
      .filter((pb) => pb.date && pb.date >= addDays(week.from, -1) && pb.date <= addDays(week.to, 1));
    const out = {};
    for (const pb of pbs) {
      const record = typeof races.get === 'function' ? await races.get(pb.raceId, householdId) : null;
      const ms = raceEpochMs(record);
      const day = Number.isFinite(ms) ? studyDay(ms) : pb.date;
      if (!inWeek(day, week)) continue;
      (out[pb.learnerId] ??= []).push({ key: `${pb.courseId}:${pb.raceId}`, day, label: `New best on ${courseLabel(pb.courseId)}` });
    }
    return out;
  }

  /**
   * glider-act + glider-bells (milestones), from the run log. The progress
   * file's `completed.<act>.at` is NOT used: it moves to the best-bells run,
   * so it is not the first completion and would re-date the milestone.
   */
  async function glider({ learnerIds, week, studyDay }) {
    const wanted = new Set(learnerIds);
    const acts = new Map((gliderActs.list(householdId) ?? []).map((a) => [a.id, a]));
    const runs = (await gliderRuns.listAll(householdId) ?? [])
      .filter((r) => wanted.has(r?.rider?.user_id) && r?.run?.course_id && Number.isFinite(toMs(r.run.ended_at)))
      .sort((a, b) => toMs(a.run.ended_at) - toMs(b.run.ended_at) || String(a.run.id).localeCompare(String(b.run.id)));
    const firstAct = new Map();
    const firstBells = new Map();
    const bellSets = new Map();
    for (const [id, act] of acts) {
      const bells = [...new Set(actBells(act))].sort();
      if (bells.length) bellSets.set(id, { bells, key: `${id}:${hash(bells.join(','))}` });
    }
    for (const r of runs) {
      const rider = r.rider.user_id;
      const actId = r.run.course_id;
      const k = `${rider}|${actId}`;
      if (r.run.status === 'completed' && !firstAct.has(k)) firstAct.set(k, r);
      const set = bellSets.get(actId);
      if (set && !firstBells.has(k)) {
        const got = new Set(r.collectibles ?? []);
        if (set.bells.every((b) => got.has(b))) firstBells.set(k, r);
      }
    }
    const firstActs = {};
    const bells = {};
    const name = (actId) => acts.get(actId)?.name || actId;
    for (const r of firstAct.values()) {
      const day = studyDay(toMs(r.run.ended_at));
      if (inWeek(day, week)) (firstActs[r.rider.user_id] ??= []).push({ key: r.run.course_id, day, label: `Finished ${name(r.run.course_id)}` });
    }
    for (const r of firstBells.values()) {
      const day = studyDay(toMs(r.run.ended_at));
      if (inWeek(day, week)) (bells[r.rider.user_id] ??= []).push({ key: bellSets.get(r.run.course_id).key, day, label: `Every bell in ${name(r.run.course_id)}` });
    }
    return { 'glider-act': firstActs, 'glider-bells': bells };
  }

  /** ring-improved (contest): this award week minus the mean of the 4 before it. */
  async function ringImproved({ learnerIds, ringMs, contestClosed }) {
    const windows = [0, 1, 2, 3, 4].map((i) => ({ fromMs: ringMs.fromMs - i * WEEK_MS, toMs: ringMs.toMs - i * WEEK_MS }));
    const reads = await Promise.all(windows.map((w) => fitnessRings.standings({ learnerIds, ...w })));
    const ringsOf = (rows, id) => rows.find((r) => r.learnerId === id)?.rings ?? 0;
    const standings = [];
    for (const id of learnerIds) {
      const prior = reads.slice(1).map((rows) => ringsOf(rows, id));
      if (prior.filter((n) => n > 0).length < MIN_PRIOR_WEEKS_WITH_RINGS) continue;
      const mean = prior.reduce((a, b) => a + b, 0) / PRIOR_WEEKS;
      standings.push({ learnerId: id, score: Math.round((ringsOf(reads[0], id) - mean) * 10) / 10 });
    }
    return { 'ring-improved': { standings, closed: contestClosed === true } };
  }

  /**
   * rings-lifetime (milestone). Walks every session summary (the month index,
   * not session YAML) oldest first. A crossing counts only once its session is
   * settled, the same "final" rule ring-days pays on, so a workout that could
   * still be merged never dates a mark.
   */
  async function ringsLifetime({ learnerIds, week, studyDay }) {
    const all = await sessions.listSessionsInRange('1900-01-01', week.to, householdId) ?? [];
    const rows = all.map((s) => ({ s, start: toMs(s.startTime) })).filter((x) => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
    const at = now();
    const out = {};
    for (const id of learnerIds) {
      let total = 0;
      for (const { s, start } of rows) {
        const rings = s.participants?.[id]?.rings;
        if (!Number.isFinite(rings) || rings <= 0) continue;
        const before = total;
        total += rings;
        const crossed = ringMarksCrossed(before, total);
        if (!crossed.length) continue;
        const day = studyDay(start);
        if (!inWeek(day, week)) continue;
        const endMs = Number.isFinite(toMs(s.endTime)) ? toMs(s.endTime) : (Number.isFinite(s.durationMs) ? start + s.durationMs : null);
        if (!evaluateRecapReadiness({ finalized: s.finalized === true, endTime: endMs, now: at }).settled) continue;
        for (const m of crossed) (out[id] ??= []).push({ key: String(m), day, label: `${m.toLocaleString('en-US')} lifetime rings` });
      }
    }
    return out;
  }

  const SOURCES = [
    { activities: ['race'], kind: 'contest', read: raceContest },
    { activities: ['race-pb'], kind: 'milestone', read: async (a) => ({ 'race-pb': await racePbs(a) }) },
    { activities: ['glider-act', 'glider-bells'], kind: 'milestone', read: glider },
    { activities: ['ring-improved'], kind: 'contest', read: ringImproved },
    { activities: ['rings-lifetime'], kind: 'milestone', read: async (a) => ({ 'rings-lifetime': await ringsLifetime(a) }) },
  ];

  return {
    name: 'fitness',
    activities: [...FITNESS_ACHIEVEMENT_ACTIVITIES],

    async week(args) {
      const learnerIds = (args?.learnerIds ?? []).filter((id) => id && !isGhost(id));
      const a = { ...args, learnerIds };
      const learners = Object.fromEntries(learnerIds.map((id) => [id, { days: {}, milestones: {} }]));
      const contests = {};
      const unavailable = [];
      const t0 = Date.now();
      await Promise.all(SOURCES.map(async (src) => {
        try {
          const got = await src.read(a);
          if (src.kind === 'contest') { Object.assign(contests, got); return; }
          for (const activity of src.activities) {
            for (const id of learnerIds) learners[id].milestones[activity] = got[activity]?.[id] ?? [];
          }
        } catch (err) {
          logger?.warn?.('fitness.achievements.source-failed', { activities: src.activities, error: err?.message ?? String(err) });
          unavailable.push(...src.activities);
        }
      }));
      logger?.debug?.('fitness.achievements.week', { from: args?.week?.from, to: args?.week?.to, learners: learnerIds.length, unavailable, ms: Date.now() - t0 });
      return { learners, contests, unavailable };
    },
  };
}

export default createFitnessAchievementProvider;
