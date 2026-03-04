/**
 * poseActions.js — SemanticMove action detectors
 *
 * Consumes SemanticPosition objects (plain objects with boolean/numeric properties
 * like { handsUp, bodyProne, armsExtended }) and recognizes movement patterns
 * over time: cyclic rep-counting (jumping jacks, squats) and sustained holds (plank).
 *
 * No dependency on poseSemantics.js — receives plain position objects.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if every key in `match` has the same value in `position`.
 */
function matchesPhase(position, match) {
  for (const key of Object.keys(match)) {
    if (position[key] !== match[key]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Cyclic (rep-counted) detector
// ---------------------------------------------------------------------------

function createCyclicDetector(pattern) {
  const { phases, timing = {} } = pattern;
  const { minCycleMs = 0, maxCycleMs = Infinity, maxPhaseMs = Infinity } = timing;

  let phaseIndex = -1;       // -1 = waiting for first phase match
  let repCount = 0;
  let cycleStartTime = null;
  let phaseEnteredTime = null;

  function update(position, timestamp) {
    // Check if current phase has exceeded maxPhaseMs
    if (phaseIndex >= 0 && phaseEnteredTime !== null) {
      const elapsed = timestamp - phaseEnteredTime;
      if (elapsed > maxPhaseMs) {
        // Reset cycle — too slow
        phaseIndex = -1;
        cycleStartTime = null;
        phaseEnteredTime = null;
      }
    }

    // Determine what phase we expect next
    const nextIndex = phaseIndex === -1 ? 0 : (phaseIndex + 1) % phases.length;
    const nextPhase = phases[nextIndex];

    if (matchesPhase(position, nextPhase.match)) {
      if (nextIndex === 0 && phaseIndex === -1) {
        // Starting a new cycle from scratch
        phaseIndex = 0;
        cycleStartTime = timestamp;
        phaseEnteredTime = timestamp;
      } else if (nextIndex === 0 && phaseIndex >= 0) {
        // Wrapped back to phase 0 — means we already counted the rep
        // when hitting the last phase. Just start a new cycle.
        phaseIndex = 0;
        cycleStartTime = timestamp;
        phaseEnteredTime = timestamp;
      } else {
        // Advancing to next phase within the cycle
        phaseIndex = nextIndex;
        phaseEnteredTime = timestamp;

        // If we just hit the last phase, the cycle is complete
        if (phaseIndex === phases.length - 1) {
          const cycleDuration = timestamp - cycleStartTime;
          if (cycleDuration >= minCycleMs && cycleDuration <= maxCycleMs) {
            repCount++;
          }
        }
      }
    }

    return {
      repCount,
      currentPhase: phaseIndex >= 0 ? phases[phaseIndex].name : null,
      phaseIndex,
      active: phaseIndex > 0,
    };
  }

  function reset() {
    phaseIndex = -1;
    repCount = 0;
    cycleStartTime = null;
    phaseEnteredTime = null;
  }

  return { update, reset, id: pattern.id };
}

// ---------------------------------------------------------------------------
// Sustained (hold) detector
// ---------------------------------------------------------------------------

function createSustainDetector(pattern) {
  const { sustain, timing = {} } = pattern;
  const { gracePeriodMs = 0 } = timing;

  let holdStartTime = null;
  let lastMatchTime = null;
  let holding = false;

  function update(position, timestamp) {
    const matches = matchesPhase(position, sustain);

    if (matches) {
      if (!holding) {
        // Start hold (or resume within grace)
        if (holdStartTime === null) {
          holdStartTime = timestamp;
        }
        holding = true;
      }
      lastMatchTime = timestamp;
    } else {
      // Not matching — check grace period
      if (holding && lastMatchTime !== null) {
        const elapsed = timestamp - lastMatchTime;
        if (elapsed > gracePeriodMs) {
          // Grace period exceeded — break hold
          holding = false;
          holdStartTime = null;
          lastMatchTime = null;
        }
      }
    }

    const holdDurationMs = holding && holdStartTime !== null
      ? timestamp - holdStartTime
      : 0;

    return {
      holding,
      holdDurationMs,
      active: holding,
    };
  }

  function reset() {
    holdStartTime = null;
    lastMatchTime = null;
    holding = false;
  }

  return { update, reset, id: pattern.id };
}

// ---------------------------------------------------------------------------
// Custom action detector
// ---------------------------------------------------------------------------

/**
 * Wraps a user-provided detect function with history management.
 */
export function createCustomActionDetector(def) {
  const { id, detect, maxHistory = 60 } = def;
  let history = [];

  function update(position, timestamp) {
    history.push({ position, timestamp });
    if (history.length > maxHistory) {
      history = history.slice(history.length - maxHistory);
    }

    const result = detect(position, history, timestamp);
    return result || { active: false };
  }

  function reset() {
    history = [];
  }

  return { update, reset, id };
}

// ---------------------------------------------------------------------------
// Dispatch factory
// ---------------------------------------------------------------------------

/**
 * Creates the appropriate detector based on pattern shape.
 * - Has `phases` array → cyclic (rep-counted)
 * - Has `sustain` object → sustained (hold)
 * - Neither → throws
 */
export function createActionDetector(pattern) {
  if (pattern.phases) {
    return createCyclicDetector(pattern);
  }
  if (pattern.sustain) {
    return createSustainDetector(pattern);
  }
  throw new Error(`Invalid action pattern "${pattern.id}": must have "phases" or "sustain" property`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  createActionDetector,
  createCustomActionDetector,
  matchesPhase,
};
