// Utility functions for RPM device visuals

export const RPM_COLORS = {
  idle: '#666',
  min: '#3b82f6',
  med: '#22c55e',
  high: '#f59e0b',
  max: '#ef4444'
};

export function calculateRpmProgress(rpm, thresholds) {
  const { min = 0, max = 100 } = thresholds || {};
  if (!Number.isFinite(rpm) || rpm <= min) return 0;
  if (rpm >= max) return 1;
  return (rpm - min) / (max - min);
}

export function getRpmZoneColor(rpm, thresholds) {
  const { min = 10, med = 50, high = 80, max = 120 } = thresholds || {};
  if (!Number.isFinite(rpm) || rpm < min) return RPM_COLORS.idle;
  if (rpm >= max) return RPM_COLORS.max;
  if (rpm >= high) return RPM_COLORS.high;
  if (rpm >= med) return RPM_COLORS.med;
  return RPM_COLORS.min;
}
