/**
 * Cycle-game lobby helpers (pure).
 */

/**
 * Build a CycleRaceController/Engine config from a course preset (or a custom
 * course-less race), merging in runtime opts (riders, zones, cadence, etc.).
 */
export function buildRaceConfigFromCourse(course = {}, opts = {}) {
  const winCondition = course.win_condition || opts.winCondition || 'distance';
  return {
    mode: opts.mode || 'simultaneous',
    winCondition,
    goalM: winCondition === 'distance' ? (course.goal_m ?? opts.goalM ?? 3000) : undefined,
    timeCapS: winCondition === 'time' ? (course.time_cap_s ?? opts.timeCapS ?? 300) : undefined,
    intervalMs: opts.intervalMs ?? 1000,
    riders: opts.riders || [],
    zones: opts.zones || [],
    hrlessMultiplier: opts.hrlessMultiplier ?? 1,
    startCountdownS: opts.startCountdownS ?? 3,
    raceIdleDnfS: opts.raceIdleDnfS ?? 20,
    courseId: course.id ?? null,
    backgroundPlexId: course.background_plex_id ?? opts.backgroundPlexId ?? null
  };
}

/** Format seconds as m:ss (clamped to >= 0). */
export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
