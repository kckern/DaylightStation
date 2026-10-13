// Air-quality dot colour for the weather widget (replaces the old bitmap dots).
export const AQI_COLORS = Object.freeze({
  good: '#3cb44b',
  moderate: '#a6d83a',
  sensitive: '#f0c419',
  unhealthy: '#e0443e'
});

export function aqiColor(aqi) {
  if (aqi >= 150) return AQI_COLORS.unhealthy;
  if (aqi >= 100) return AQI_COLORS.sensitive;
  if (aqi >= 50) return AQI_COLORS.moderate;
  return AQI_COLORS.good;
}
