import React from 'react';

/**
 * Inline SVG poster for cycle-game merged sessions — a waving checkered race flag.
 * Vector only (currentColor) — no rasterized assets, no text glyphs.
 * (svgrepo 3532, viewBox 0 0 37.979 37.979.)
 */
const CycleGamePoster = (props) => (
  <svg viewBox="0 0 37.979 37.979" width="100%" height="100%" fill="currentColor" role="img" aria-label="Cycle game races" {...props}>
    <path d="M21.553,2.322C15.45,3.435,9.956,6.693,2.608,3.406c0.096,0.333,0.189,0.667,0.283,1h-1.75L1,3.906H0l8.988,31.75h1l-4.01-14.167h1.75c0.109,0.39,0.221,0.778,0.33,1.168C15.405,25.942,20.9,22.684,27,21.571C25.186,15.155,23.369,8.738,21.553,2.322z M9.796,5.831c2.07-0.046,4.032-0.473,5.971-0.983c0.521,1.833,1.039,3.667,1.559,5.5c-1.938,0.51-3.901,0.937-5.973,0.983C10.834,9.497,10.314,7.664,9.796,5.831z M5.766,20.739L1.354,5.156h1.75c1.472,5.194,2.941,10.389,4.412,15.583H5.766z M7.173,15.991c-0.508-1.792-1.017-3.583-1.522-5.375c2.046,0.751,3.951,1.005,5.773,0.964c0.507,1.792,1.015,3.583,1.521,5.375C11.125,16.996,9.219,16.742,7.173,15.991z M20.651,22.098c-1.938,0.511-3.9,0.937-5.972,0.982c-0.519-1.834-1.038-3.667-1.558-5.5c2.069-0.046,4.032-0.473,5.973-0.983C19.613,18.432,20.133,20.264,20.651,22.098z M24.039,14.635c-1.729,0.375-3.414,0.889-5.121,1.337c-0.508-1.792-1.016-3.583-1.521-5.375c1.706-0.449,3.395-0.962,5.12-1.337C23.023,11.052,23.531,12.843,24.039,14.635z M23.227,5.446c0.096,0.333,0.189,0.667,0.283,1c0.787-0.118,1.584-0.195,2.398-0.213c0.52,1.833,1.037,3.667,1.557,5.5c-0.813,0.018-1.611,0.095-2.396,0.213c0.591,2.083,1.181,4.167,1.771,6.25c0.785-0.118,1.584-0.195,2.396-0.213c0.521,1.833,1.039,3.667,1.56,5.5c-2.07,0.045-4.033,0.473-5.974,0.981c-0.121-0.432-0.243-0.86-0.364-1.291c-2.018,0.529-4.008,1.15-6.068,1.525c0.217,0.766,0.434,1.529,0.649,2.293c6.101-1.113,11.597-4.371,18.94-1.086c-1.814-6.416-3.633-12.833-5.449-19.25C29.11,5.128,26.094,5.015,23.227,5.446z M34.833,18.322c-2.046-0.751-3.95-1.005-5.772-0.964c-0.508-1.792-1.016-3.583-1.521-5.375c1.82-0.041,3.727,0.213,5.771,0.964C33.817,14.739,34.326,16.53,34.833,18.322z" />
  </svg>
);

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
