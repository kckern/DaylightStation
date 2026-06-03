// Per-equipment RPM limits for the cycle game.
//  - gaugeMaxRpm: speedometer dial scale (DISPLAY only — never clamps the value).
//  - abuseMaxRpm: optional clamp on the RPM that COUNTS toward distance, for
//    equipment that can be cheated by hand-spinning (e.g. the ab roller). null =
//    uncapped — a real bike's cadence is always legitimate, so it never clamps.
const DEFAULT_GAUGE_MAX_RPM = 120;

export function resolveRpmLimits(equipment = {}) {
  const gaugeMaxRpm = Number.isFinite(equipment?.max_rpm) && equipment.max_rpm > 0
    ? equipment.max_rpm
    : DEFAULT_GAUGE_MAX_RPM;
  const abuseMaxRpm = Number.isFinite(equipment?.abuse_max_rpm) && equipment.abuse_max_rpm > 0
    ? equipment.abuse_max_rpm
    : null;
  return { gaugeMaxRpm, abuseMaxRpm };
}

export function clampCountedRpm(rpm, abuseMaxRpm) {
  const v = Number.isFinite(rpm) ? rpm : 0;
  if (Number.isFinite(abuseMaxRpm) && abuseMaxRpm > 0) return Math.min(v, abuseMaxRpm);
  return v;
}

export default { resolveRpmLimits, clampCountedRpm };
