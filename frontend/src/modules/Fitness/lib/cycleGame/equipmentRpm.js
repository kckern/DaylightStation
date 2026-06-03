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

// During an ACTIVE race, an ANT+ cadence broadcast gap (sensor momentarily
// disconnected) should NOT flatline RPM to 0 — that reads as a phantom stop. We
// hold the last good reading through the gap. BUT if the rider was already
// decelerating (a downward trend into the gap), a real cooldown-to-stop is the
// likelier story, so we honor the zero instead of holding a stale high value.
//   recentRpms: the last few CONNECTED readings, oldest → newest.
// Returns the RPM to count for this gap tick.
const GAP_COOLDOWN_RATIO = 0.7; // newest < 70% of recent peak ⇒ treat as cooldown
export function rpmDuringGap(recentRpms = []) {
  const list = Array.isArray(recentRpms) ? recentRpms.filter((r) => Number.isFinite(r)) : [];
  if (list.length === 0) return 0;
  const last = list[list.length - 1];
  if (!(last > 0)) return 0;                    // already at/below zero — nothing to hold
  const peak = Math.max(...list);
  if (peak > 0 && last < peak * GAP_COOLDOWN_RATIO) return 0; // decelerating → honor the drop
  return last;                                  // steady/high then cut → sensor gap → hold
}

export default { resolveRpmLimits, clampCountedRpm, rpmDuringGap };
