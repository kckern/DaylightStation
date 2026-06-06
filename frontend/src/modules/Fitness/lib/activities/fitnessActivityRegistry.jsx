import React from 'react';

/**
 * Inline SVG poster for cycle-game merged sessions.
 * Vector only (currentColor) — no rasterized assets, no text glyphs.
 * Bike + coin motif on a 48x48 viewBox.
 */
const CycleGamePoster = (props) => (
  <svg viewBox="0 0 48 48" width="100%" height="100%" role="img" aria-label="Cycle game races" {...props}>
    {/* two wheels */}
    <circle cx="13" cy="32" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" />
    <circle cx="35" cy="32" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" />
    {/* frame */}
    <path d="M13 32 L22 20 L31 32 M22 20 L26 20 M31 32 L26 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    {/* coin */}
    <circle cx="35" cy="13" r="6" fill="currentColor" opacity="0.9" />
    <circle cx="35" cy="13" r="6" fill="none" stroke="currentColor" strokeWidth="1" />
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
