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
//
// The hold is CAPPED — a sensor that never comes back must not ride forever at
// a frozen RPM (audit game-design #6: a dead sensor was an unlimited-distance
// cheat AND blocked the idle-DNF clock from ever firing). Ticks 1-5 of a gap
// behave as the original hold; ticks 6-8 decay the held value by half each
// tick (a "coasting to a stop" read, not an abrupt cliff); tick 9+ goes to 0,
// at which point the normal idle-DNF machinery (fed 0 rpm) takes back over.
//   recentRpms: the last few CONNECTED readings, oldest → newest.
//   gapTicks: 1-based count of consecutive ticks the sensor has been gapped
//     for (1 = the first disconnected tick). Defaults to 1 for callers that
//     don't track gap length — same as the pre-cap behavior.
// Returns the RPM to count for this gap tick.
const GAP_COOLDOWN_RATIO = 0.7; // newest < 70% of recent peak ⇒ treat as cooldown
const GAP_HOLD_TICKS = 5;   // ticks 1-5: full hold (cooldown heuristic applies)
const GAP_DECAY_TICKS = 8;  // ticks 6-8: hold decays by half per tick
export function rpmDuringGap(recentRpms = [], gapTicks = 1) {
  const list = Array.isArray(recentRpms) ? recentRpms.filter((r) => Number.isFinite(r)) : [];
  if (list.length === 0) return 0;
  const last = list[list.length - 1];
  if (!(last > 0)) return 0;                    // already at/below zero — nothing to hold
  const peak = Math.max(...list);
  const held = (peak > 0 && last < peak * GAP_COOLDOWN_RATIO) ? 0 : last; // decelerating → honor the drop
  const ticks = Number.isFinite(gapTicks) && gapTicks >= 1 ? gapTicks : 1;
  if (ticks <= GAP_HOLD_TICKS) return held;
  if (ticks <= GAP_DECAY_TICKS) return held * (0.5 ** (ticks - GAP_HOLD_TICKS));
  return 0;                                     // gap has run long enough — presume disconnected
}

export default { resolveRpmLimits, clampCountedRpm, rpmDuringGap };
