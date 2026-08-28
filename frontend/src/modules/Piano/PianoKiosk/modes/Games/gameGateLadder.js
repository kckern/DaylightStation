/**
 * gameGateLadder — the pure data structure for the piano game challenge's
 * failure ladder.
 *
 * A "rung" is five axes, each with two values (hard / easy). Fixed
 * degradation order, hard -> easy:
 *   direction: both -> ascending
 *   difficulty: exotic -> major
 *   span: 2 -> 1
 *   hands: 2 -> 1
 *   timing: cued -> free       (LAST — it changes what failure *means*)
 *
 * degradeRung eases the FIRST axis (in the order above) that is not
 * already at its easy value. climbRung restores the LAST axis (in the
 * order above) that has been eased. Walking down from initialRung() and
 * back up with climbRung retraces the exact same path in reverse; the same
 * rule also gives sensible behaviour for a rung assembled by hand (not
 * reached by walking down), which a pure index counter would not.
 *
 * No fetching, no React, no logging — a pure module, unit-testable with no
 * fixtures.
 */

// Order matters: this IS the degradation order. climbRung walks it backward.
const AXES = [
  { key: 'direction', hard: 'both', easy: 'ascending' },
  { key: 'difficulty', hard: 'exotic', easy: 'major' },
  { key: 'span', hard: 2, easy: 1 },
  { key: 'hands', hard: 2, easy: 1 },
  { key: 'timing', hard: 'cued', easy: 'free' },
];

export function initialRung() {
  return {
    timing: 'cued', hands: 2, span: 2, difficulty: 'exotic', direction: 'both',
  };
}

export function degradeRung(rung) {
  const axis = AXES.find((a) => rung[a.key] !== a.easy);
  if (!axis) return rung; // already at the floor — return unchanged, never null
  return { ...rung, [axis.key]: axis.easy };
}

export function climbRung(rung) {
  let axis;
  for (let i = AXES.length - 1; i >= 0; i -= 1) {
    if (rung[AXES[i].key] !== AXES[i].hard) { axis = AXES[i]; break; }
  }
  if (!axis) return rung; // already at the top — return unchanged, never null
  return { ...rung, [axis.key]: axis.hard };
}

export function isFloor(rung) {
  return AXES.every((a) => rung[a.key] === a.easy);
}

export function requirementForRung(rung, { passScore }) {
  if (isFloor(rung)) {
    // D9 contract: the floor must be unfailable. `cleanliness` is
    // deliberately absent from the rubric — a stray key here re-creates
    // the exact bug that would fail a child who has already failed every
    // rung. Do not add criteria; do not give the floor a non-null passScore.
    return {
      mode: 'free',
      hands: 1,
      span: 1,
      rubric: { criteria: { completeness: 1 } },
      passScore: null,
    };
  }
  const { timing, hands, span, difficulty, direction } = rung;
  return {
    mode: timing === 'cued' ? 'cued' : 'free',
    hands,
    span,
    difficulty,
    direction,
    passScore,
  };
}
