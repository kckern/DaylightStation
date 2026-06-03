import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { shuffle, buildNotePool } from '../noteUtils.js';

// ─── Constants ──────────────────────────────────────────────────

export const ACTIONS = ['moveLeft', 'moveRight', 'rotateCCW', 'rotateCW', 'hardDrop', 'hold'];

export const INITIAL_REPEAT_DELAY = 200; // ms before hold-to-repeat kicks in
export const REPEAT_INTERVAL = 100;      // ms between repeated actions

// Actions that should NOT repeat on hold (one-shot per key press)
const NO_REPEAT_ACTIONS = new Set(['hardDrop', 'hold', 'jump', 'duck']);

// ─── Progression (line-driven difficulty ramp) ──────────────────

/**
 * Hardcoded fallback for PianoTetris musical progression. Each piano.yml
 * `games.tetris.progression` field overrides the matching default; anything
 * omitted falls back here. Thresholds are cumulative lines cleared in the
 * current game (resets each game). Treble is the always-on baseline.
 */
export const DEFAULT_PROGRESSION = {
  thresholds: { treble: 1, bass: 2, dyad: 3, triad: 5, accidentals: 7 },
  treble_range: [60, 81], // C4–A5: entirely treble clef (baseline)
  bass_range: [48, 81],   // C3–A5: low notes (<C4) render in bass clef
};

const NOTES_PER_COMPLEXITY = { single: 1, dyad: 2, triad: 3 };

/**
 * Resolve which musical features are active for a given lines-cleared count.
 * Each threshold ADDS to what's available — it does not replace. So once
 * dyads/triads unlock, they join the pool of possible chord sizes alongside
 * singles, rather than forcing every staff to that size.
 *
 * @param {number} linesCleared - cumulative lines cleared this game
 * @param {Object} [config] - partial override of DEFAULT_PROGRESSION
 * @returns {{ noteRange: [number, number], unlockedChordSizes: number[], whiteKeysOnly: boolean }}
 */
export function computeProgression(linesCleared, config = {}) {
  const thresholds = { ...DEFAULT_PROGRESSION.thresholds, ...(config.thresholds || {}) };
  const trebleRange = config.treble_range ?? DEFAULT_PROGRESSION.treble_range;
  const bassRange = config.bass_range ?? DEFAULT_PROGRESSION.bass_range;

  const noteRange = linesCleared >= thresholds.bass ? bassRange : trebleRange;

  const unlockedChordSizes = [1];
  if (linesCleared >= thresholds.dyad) unlockedChordSizes.push(2);
  if (linesCleared >= thresholds.triad) unlockedChordSizes.push(3);

  const whiteKeysOnly = linesCleared < thresholds.accidentals;

  return { noteRange, unlockedChordSizes, whiteKeysOnly };
}

/**
 * Randomly assign a chord size to each staff from the unlocked pool. Each
 * staff is independently one of the unlocked sizes (additive mix), so a board
 * is a random blend rather than a uniform wall of the newest-unlocked size.
 *
 * @param {number[]} unlockedSizes - chord sizes currently allowed (e.g. [1,2,3])
 * @param {number} numStaves - how many staves to fill
 * @returns {number[]} per-staff chord sizes
 */
export function assignChordSizes(unlockedSizes, numStaves) {
  const pool = unlockedSizes.length > 0 ? unlockedSizes : [1];
  const sizes = [];
  for (let i = 0; i < numStaves; i++) {
    sizes.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return sizes;
}

// ─── Pure Functions ─────────────────────────────────────────────

/**
 * Resolve per-staff note counts from a complexity spec.
 * @param {'single'|'dyad'|'triad'|number[]} complexity - string preset, or a
 *   per-staff array of counts (length is padded/truncated to ACTIONS.length).
 * @returns {number[]} count for each action/staff
 */
function resolveCounts(complexity) {
  if (Array.isArray(complexity)) {
    return ACTIONS.map((_, i) => complexity[i] ?? 1);
  }
  const count = NOTES_PER_COMPLEXITY[complexity] || 1;
  return ACTIONS.map(() => count);
}

/**
 * Generate target pitch assignments for each action.
 *
 * @param {[number, number]} noteRange - [low, high] MIDI note range (inclusive)
 * @param {'single'|'dyad'|'triad'|number[]} complexity - notes per action: a
 *   string preset applied to every staff, or a per-staff array of counts.
 * @param {boolean} whiteKeysOnly - if true, only use white keys (no sharps/flats)
 * @returns {Object<string, number[]>} mapping of action name to array of target MIDI pitches
 */
export function generateTargets(noteRange, complexity = 'single', whiteKeysOnly = false) {
  let counts = resolveCounts(complexity);

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);

  let totalNeeded = counts.reduce((sum, c) => sum + c, 0);

  // Not enough distinct notes for the requested chords — fall back to singles.
  if (available.length < totalNeeded) {
    counts = ACTIONS.map(() => 1);
    totalNeeded = counts.reduce((sum, c) => sum + c, 0);
  }

  const targets = {};
  let idx = 0;
  for (let a = 0; a < ACTIONS.length; a++) {
    const pitches = [];
    for (let i = 0; i < counts[a]; i++) {
      pitches.push(available[idx % available.length]);
      idx++;
    }
    targets[ACTIONS[a]] = pitches;
  }

  return targets;
}

/**
 * Check whether all target pitches for an action are currently active.
 *
 * @param {Map<number, {velocity: number, timestamp: number}>} activeNotes
 * @param {number[]} targetPitches
 * @returns {boolean}
 */
export function isActionMatched(activeNotes, targetPitches) {
  for (const pitch of targetPitches) {
    if (!activeNotes.has(pitch)) return false;
  }
  return true;
}

// ─── React Hook ─────────────────────────────────────────────────

/**
 * Watches activeNotes for matches against action targets and fires callbacks.
 * Supports hold-to-repeat: after INITIAL_REPEAT_DELAY, repeats at REPEAT_INTERVAL.
 *
 * @param {Map<number, {velocity: number, timestamp: number}>} activeNotes
 * @param {Object<string, number[]>|null} targets - mapping of action name to target pitches
 * @param {(actionName: string) => void} onAction - callback fired when action triggers
 * @param {boolean} enabled - whether matching is active
 * @returns {{ matchedActions: Set<string> }}
 */
export function useStaffMatching(activeNotes, targets, onAction, enabled = true) {
  const logger = useMemo(() => getChildLogger({ component: 'staff-matching' }), []);
  const [matchedActions, setMatchedActions] = useState(() => new Set());
  const timersRef = useRef({}); // { [action]: { delay: timeoutId, interval: intervalId } }
  const prevTargetsRef = useRef(null);
  const staleActionsRef = useRef(new Set()); // actions that need fresh press after target change

  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const clearActionTimers = useCallback((action) => {
    const entry = timersRef.current[action];
    if (entry) {
      if (entry.delay != null) clearTimeout(entry.delay);
      if (entry.interval != null) clearInterval(entry.interval);
      delete timersRef.current[action];
    }
  }, []);

  useEffect(() => {
    if (!enabled || !targets) {
      // Clear all timers and matched state when disabled
      for (const action of Object.keys(timersRef.current)) {
        clearActionTimers(action);
      }
      setMatchedActions(new Set());
      staleActionsRef.current = new Set();
      prevTargetsRef.current = null;
      return;
    }

    // Detect target change — mark currently-held matches as stale to require fresh press
    if (targets !== prevTargetsRef.current) {
      if (prevTargetsRef.current !== null) {
        const stale = new Set();
        for (const action of Object.keys(targets)) {
          const pitches = targets[action];
          if (pitches && pitches.length > 0 && isActionMatched(activeNotes, pitches)) {
            stale.add(action);
          }
        }
        staleActionsRef.current = stale;
        // Clear all existing timers since targets changed
        for (const action of Object.keys(timersRef.current)) {
          clearActionTimers(action);
        }
      }
      prevTargetsRef.current = targets;
    }

    const nextMatched = new Set();
    const actions = Object.keys(targets);

    for (const action of actions) {
      const pitches = targets[action];
      if (!pitches || pitches.length === 0) continue;

      const matched = isActionMatched(activeNotes, pitches);

      if (matched) {
        nextMatched.add(action);

        // Skip stale actions — notes were held from before target change
        if (staleActionsRef.current.has(action)) {
          continue;
        }

        // If this action wasn't already tracked, fire immediately and start hold timers
        if (!timersRef.current[action]) {
          logger.info('staff.action-fired', { action, pitches });
          onActionRef.current(action);

          // Hard drop and hold should not repeat on hold
          if (NO_REPEAT_ACTIONS.has(action)) {
            timersRef.current[action] = { delay: null, interval: null };
          } else {
            const delayId = setTimeout(() => {
              const intervalId = setInterval(() => {
                onActionRef.current(action);
              }, REPEAT_INTERVAL);

              if (timersRef.current[action]) {
                timersRef.current[action].interval = intervalId;
              }
            }, INITIAL_REPEAT_DELAY);

            timersRef.current[action] = { delay: delayId, interval: null };
          }
        }
      } else {
        // Notes released — clear stale flag so next press fires normally
        staleActionsRef.current.delete(action);

        if (timersRef.current[action]) {
          // Action no longer matched — stop repeat
          logger.info('staff.action-released', { action });
          clearActionTimers(action);
        }
      }
    }

    setMatchedActions(nextMatched);
  }, [activeNotes, targets, enabled, clearActionTimers]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const action of Object.keys(timersRef.current)) {
        const entry = timersRef.current[action];
        if (entry) {
          if (entry.delay != null) clearTimeout(entry.delay);
          if (entry.interval != null) clearInterval(entry.interval);
        }
      }
      timersRef.current = {};
    };
  }, []);

  return { matchedActions };
}

export default useStaffMatching;
