/**
 * IFitnessRead
 *   recentWorkouts({ days?, limit? }):
 *     Promise<Array<{ date, type, durationSec, distanceM?, source }>>
 *   fitnessSummary({ periodDays? }):
 *     Promise<{ totalMinutes, byType, asOf }>
 */
export function isFitnessRead(obj) {
  return !!obj
    && typeof obj.recentWorkouts === 'function'
    && typeof obj.fitnessSummary === 'function';
}

export function assertFitnessRead(obj) {
  if (!isFitnessRead(obj)) throw new Error('Object does not implement IFitnessRead');
}

export default { isFitnessRead, assertFitnessRead };
