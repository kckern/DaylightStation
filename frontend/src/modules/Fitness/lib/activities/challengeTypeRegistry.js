import { ZONE_COLOR_MAP } from '@/modules/Fitness/lib/chartHelpers.js';

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
 * Resolve the display color for a specific challenge marker. HR-zone challenges are
 * tinted by their actual zone (warm `#ffd43b` vs hot `#ff922b`, etc.) so the timeline
 * shows *which* zone was targeted; cycle/other challenges use the type color.
 * @param {{ type?: string, zoneId?: string|null }} marker
 */
export function getChallengeMarkerColor(marker) {
  const zoneId = marker?.zoneId;
  if (marker?.type === 'zone' && zoneId && ZONE_COLOR_MAP[zoneId]) {
    return ZONE_COLOR_MAP[zoneId];
  }
  return getChallengeTypeDisplay(marker?.type).color;
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

export default { getChallengeTypeDisplay, resolveChallengeMarkerType, getChallengeMarkerColor };
