import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { shuffle, buildNotePool } from '../noteUtils.js';

// ─── Constants ──────────────────────────────────────────────────

export const ACTIONS = ['moveLeft', 'moveRight', 'rotateCCW', 'rotateCW', 'hardDrop', 'hold'];

export const INITIAL_REPEAT_DELAY = 200; // ms before hold-to-repeat kicks in
export const REPEAT_INTERVAL = 100;      // ms between repeated actions

// Actions that should NOT repeat on hold (one-shot per key press)
const NO_REPEAT_ACTIONS = new Set(['hardDrop', 'hold']);

// ─── Pure Functions ─────────────────────────────────────────────

/**
 * Generate target pitch assignments for each action.
 *
 * @param {[number, number]} noteRange - [low, high] MIDI note range (inclusive)
 * @param {'single'|'dyad'|'triad'} complexity - how many notes per action
 * @param {boolean} whiteKeysOnly - if true, only use white keys (no sharps/flats)
 * @returns {Object<string, number[]>} mapping of action name to array of target MIDI pitches
 */
export function generateTargets(noteRange, complexity = 'single', whiteKeysOnly = false) {
  const notesPerAction = { single: 1, dyad: 2, triad: 3 };
  let count = notesPerAction[complexity] || 1;

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);

  const totalNeeded = count * ACTIONS.length;

  if (available.length < totalNeeded) {
    count = 1;
  }

  const targets = {};
  for (let a = 0; a < ACTIONS.length; a++) {
    const start = a * count;
    const pitches = [];
    for (let i = 0; i < count; i++) {
      pitches.push(available[(start + i) % available.length]);
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
      for (const action of ACTIONS) {
        clearActionTimers(action);
      }
      setMatchedActions(new Set());
      return;
    }

    const nextMatched = new Set();

    for (const action of ACTIONS) {
      const pitches = targets[action];
      if (!pitches || pitches.length === 0) continue;

      const matched = isActionMatched(activeNotes, pitches);

      if (matched) {
        nextMatched.add(action);

        // If this action wasn't already tracked, fire immediately and start hold timers
        if (!timersRef.current[action]) {
          logger.debug('staff.action-fired', { action, pitches });
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
      } else if (timersRef.current[action]) {
        // Action no longer matched — stop repeat
        logger.debug('staff.action-released', { action });
        clearActionTimers(action);
      }
    }

    setMatchedActions(nextMatched);
  }, [activeNotes, targets, enabled, clearActionTimers]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const action of ACTIONS) {
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
