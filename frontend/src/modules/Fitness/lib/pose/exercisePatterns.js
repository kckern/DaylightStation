/**
 * Exercise pattern definitions for use with createActionDetector / createCustomActionDetector.
 *
 * Each pattern is a plain config object. Usage:
 *   import { createActionDetector } from './poseActions.js';
 *   import { JUMPING_JACK } from './exercisePatterns.js';
 *   const detector = createActionDetector(JUMPING_JACK);
 */

// ---------------------------------------------------------------------------
// Cyclic (rep-counted) exercises
// ---------------------------------------------------------------------------

export const JUMPING_JACK = {
  id: 'jumping-jack',
  name: 'Jumping Jack',
  phases: [
    { name: 'open',   match: { armsOverhead: true, wideStance: true } },
    { name: 'closed', match: { armsAtSides: true, narrowStance: true, upright: true } },
  ],
  timing: { minCycleMs: 400, maxCycleMs: 3000, maxPhaseMs: 2000 },
};

export const SQUAT = {
  id: 'squat',
  name: 'Squat',
  phases: [
    { name: 'down', match: { squatting: true } },
    { name: 'up',   match: { squatting: false, upright: true, narrowStance: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};

export const LUNGE = {
  id: 'lunge',
  name: 'Lunge',
  phases: [
    { name: 'down', match: { lunging: true } },
    { name: 'up',   match: { lunging: false, upright: true } },
  ],
  timing: { minCycleMs: 800, maxCycleMs: 5000 },
};

export const PUSH_UP = {
  id: 'push-up',
  name: 'Push-up',
  phases: [
    { name: 'down', match: { prone: true, leftElbow: 'MID' } },
    { name: 'up',   match: { prone: true, armsExtended: true } },
  ],
  timing: { minCycleMs: 500, maxCycleMs: 4000 },
};

// ---------------------------------------------------------------------------
// Sustained (hold) exercises
// ---------------------------------------------------------------------------

export const PLANK = {
  id: 'plank',
  name: 'Plank',
  sustain: { prone: true, armsExtended: true },
  timing: { gracePeriodMs: 500 },
};

// ---------------------------------------------------------------------------
// Custom (complex) exercises
// ---------------------------------------------------------------------------

/**
 * Burpee — custom detector tracking a state machine:
 * upright → squatting → prone → squatting → upright + armsOverhead
 *
 * Use with createCustomActionDetector(BURPEE).
 */
const createBurpeeDetect = () => {
  const PHASES = ['standing', 'squatDown', 'prone', 'squatUp', 'jump'];
  let phase = 'standing';
  let repCount = 0;
  let phaseEnteredAt = null;

  return (position, history, timestamp) => {
    const match = {
      standing:  () => position.upright && !position.squatting,
      squatDown: () => position.squatting,
      prone:     () => position.prone,
      squatUp:   () => position.squatting,
      jump:      () => position.upright && position.armsOverhead,
    };

    const nextIndex = (PHASES.indexOf(phase) + 1) % PHASES.length;
    const nextPhase = PHASES[nextIndex];

    if (match[nextPhase]()) {
      if (nextPhase === 'standing' && phase === 'jump') {
        repCount++;
      }
      phase = nextPhase;
      phaseEnteredAt = timestamp;
    }

    // Reset if stuck in one phase too long (8s)
    if (phaseEnteredAt && timestamp - phaseEnteredAt > 8000) {
      phase = 'standing';
      phaseEnteredAt = null;
    }

    return { repCount, currentPhase: phase, active: phase !== 'standing' };
  };
};

export const BURPEE = {
  id: 'burpee',
  name: 'Burpee',
  maxHistory: 90,
  detect: createBurpeeDetect(),
};
