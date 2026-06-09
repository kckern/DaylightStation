/**
 * Central registry of in-session challenge types → marker presentation.
 * Consolidates icon/color knowledge that was previously scattered across
 * buildChallengeToast (emoji), cycleOverlayVisuals (ring colors), and
 * ZONE_COLOR_MAP. Used by the session-detail timeline challenge markers.
 *
 * Each entry: { label, color (hex), icon (emoji/string) }.
 */
const REGISTRY = {
  cycle: { label: 'Cycle', color: '#f59e0b', icon: '🚴' },
  zone:  { label: 'Zone',  color: '#3ba776', icon: '🎯' }
};

const FALLBACK = { label: 'Challenge', color: '#94a3b8', icon: '🏆' };

/** Presentation descriptor for a challenge type (never null). */
export function getChallengeTypeDisplay(type) {
  return REGISTRY[type] || FALLBACK;
}

/**
 * Classify a persisted challenge event as 'cycle' or 'zone'. Prefers the
 * persisted `data.type`; for legacy events without it, a missing zoneId implies
 * a cycle challenge (cycle challenges carry no zone).
 */
export function resolveChallengeMarkerType(event) {
  const d = event?.data || {};
  if (d.type) return d.type;
  return d.zoneId == null ? 'cycle' : 'zone';
}

export default { getChallengeTypeDisplay, resolveChallengeMarkerType };
