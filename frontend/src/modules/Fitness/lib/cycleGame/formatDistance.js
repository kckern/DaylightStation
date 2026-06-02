/**
 * Format a distance in meters for display. Starts in whole meters and rolls
 * over to kilometers so a race doesn't begin as "0.00 km".
 *   < 1 km   → whole meters ("850 m")
 *   < 10 km  → 2 decimals   ("1.23 km")
 *   >= 10 km → 1 decimal    ("12.4 km")
 * @param {number} meters
 * @returns {string}
 */
export function formatDistance(meters) {
  const m = Number.isFinite(meters) && meters > 0 ? Math.round(meters) : 0;
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`;
}

export default formatDistance;
