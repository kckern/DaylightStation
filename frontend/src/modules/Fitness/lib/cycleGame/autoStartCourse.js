// frontend/src/modules/Fitness/lib/cycleGame/autoStartCourse.js
/**
 * Map a sim "1-click race" choice to the course shape CycleGameContainer.startRace
 * consumes. `value` is seconds for a time race, metres for a distance race.
 */
export function buildAutoStartCourse({ winCondition, value } = {}) {
  if (winCondition === 'time') {
    return { win_condition: 'time', goal_m: null, time_cap_s: value };
  }
  return { win_condition: 'distance', goal_m: value, time_cap_s: null };
}

export default buildAutoStartCourse;
