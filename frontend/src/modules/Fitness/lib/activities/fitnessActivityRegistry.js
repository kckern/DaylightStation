import CycleGamePoster from './CycleGamePoster.jsx';

/**
 * Registry mapping a backend activity `type` to its frontend presentation.
 * Each entry: { label(count) -> string, accent (hex), Poster (inline-svg component), overlayKey }.
 */
const REGISTRY = {
  'cycle-game': {
    label: (n) => `${n} ${n === 1 ? 'race' : 'races'}`,
    accent: '#3ba776',
    Poster: CycleGamePoster,
    overlayKey: 'race-bands',
  },
};

/**
 * Look up the presentation descriptor for an activity type.
 * @param {string} type
 * @returns {{ label: (count:number)=>string, accent: string, Poster: React.ComponentType, overlayKey: string } | null}
 */
export function getActivityDisplay(type) {
  return REGISTRY[type] || null;
}

/**
 * Pick the activity with the highest `count` from an activities array.
 * @param {Array<{ type: string, count?: number }>} [activities]
 * @returns {object | null} the highest-count activity, or null if empty.
 */
export function primaryActivity(activities = []) {
  if (!activities || !activities.length) return null;
  return [...activities].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
}

export default { getActivityDisplay, primaryActivity };
