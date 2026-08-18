import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { isComboHeld } from '../input/combo.js';
import { slotForNote } from './launcherNotes.js';
// Single source of truth: the fallback pair lives with the range-derivation
// helper, so a board's combo and the default can't drift apart.
import { DEFAULT_COMBO_NOTES } from './comboForKeyboard.js';

export { DEFAULT_COMBO_NOTES };

const DEFAULT_COMBO_WINDOW_MS = 300;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_HOLD_EXIT_MS = 2000;

/** Stable stand-in for a caller that has not got a MIDI map yet. */
const NO_NOTES = new Map();

/**
 * The office-screen game launcher: one combo in, one white key out.
 *
 * Replaces the per-game activation combos that used to live in
 * useGameActivation.js. Nine two-note combos were more than anyone could hold
 * in their head, and every new game needed another one.
 *
 * Dismissing the launcher restores whatever was running — an accidental combo
 * mid-game must not cost you the game. Only holding the combo quits.
 *
 * @param {Object} args
 * @param {Map<number, {velocity: number, timestamp: number}>} args.activeNotes
 * @param {Array<Object>} args.slots - from buildLauncherSlots()
 * @param {string|null} [args.initialGame] - deep-linked game id (URL)
 * @param {Object} [args.options] - {comboNotes, comboWindowMs, timeoutMs, holdExitMs}
 */
export function useNoteLauncher({ activeNotes, slots, initialGame = null, options = {} }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-launcher' }), []);

  // Read as primitives rather than merging into an object: a merged object is a
  // new identity every render, and anything downstream of it in an effect dep
  // array would re-run (and re-arm timers) on every idle re-render.
  const comboNotes = options.comboNotes ?? DEFAULT_COMBO_NOTES;
  const comboWindowMs = options.comboWindowMs ?? DEFAULT_COMBO_WINDOW_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const holdExitMs = options.holdExitMs ?? DEFAULT_HOLD_EXIT_MS;

  const liveNotes = activeNotes instanceof Map ? activeNotes : NO_NOTES;

  const [isOpen, setIsOpen] = useState(false);
  const [activeGameId, setActiveGameId] = useState(initialGame);
  // Bumped on every launch, including a re-launch of the game already running.
  // Picking the same game again is otherwise a no-op setState, so a FINISHED
  // board stayed mounted and swallowed every input — "stuck, can't move", with
  // nothing in the log to say why. Callers key the game element on this.
  const [launchNonce, setLaunchNonce] = useState(0);
  const [isHolding, setIsHolding] = useState(false);

  // Mirrors isOpen so the combo effect can decide open-vs-close and log the
  // decision OUTSIDE the state updater. React may call an updater more than
  // once (StrictMode, concurrent re-render); a log line in there double-fires.
  const isOpenRef = useRef(false);
  const activeGameIdRef = useRef(initialGame);

  // Latches on combo press, clears when BOTH combo keys are up. Without it the
  // effect re-toggles on every activeNotes change for as long as they're held.
  const comboLatchedRef = useRef(false);
  const holdTimerRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  // Notes already down are not "struck" — diffing against this is what stops a
  // held key from selecting a game the instant the launcher opens.
  const prevNotesRef = useRef(new Set());

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);

  const clearTimeoutTimer = useCallback(() => {
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = null;
  }, []);

  /** Single write path for the running game, so the ref never drifts. */
  const setGame = useCallback((gameId, event, extra = {}) => {
    activeGameIdRef.current = gameId;
    setActiveGameId(gameId);
    // A launch is always a fresh game, even when it is the same id as the one
    // on screen. Only bump on launch: an exit sets null, which unmounts anyway.
    if (gameId !== null) setLaunchNonce((n) => n + 1);
    logger.info(event, extra);
  }, [logger]);

  const openLauncher = useCallback(() => {
    isOpenRef.current = true;
    setIsOpen(true);
    logger.info('launcher.opened', {});
  }, [logger]);

  const closeLauncher = useCallback((reason) => {
    if (!isOpenRef.current) return;
    isOpenRef.current = false;
    setIsOpen(false);
    logger.info('launcher.dismissed', { reason });
  }, [logger]);

  /** Close the launcher, leaving whatever is running alone. */
  const dismiss = useCallback((reason = 'escape') => closeLauncher(reason), [closeLauncher]);

  /** Quit the running game AND close the launcher — the game's own exit path. */
  const exitGame = useCallback((reason = 'exit') => {
    closeLauncher(reason);
    if (activeGameIdRef.current === null) return;
    setGame(null, 'launcher.game-exited', { gameId: activeGameIdRef.current, reason });
  }, [closeLauncher, setGame]);

  // closeLauncher is stable today, but the timer's "absolute from open"
  // guarantee is a promise to the player, not an implementation detail, so it
  // must not rest on that staying true. Held in a ref, the timer effect depends
  // on nothing but isOpen and the duration -- no caller can re-arm it.
  const closeRef = useRef(closeLauncher);
  useEffect(() => { closeRef.current = closeLauncher; }, [closeLauncher]);

  // ─── Auto-close timer: absolute from open, deliberately not reset by play ──
  useEffect(() => {
    if (!isOpen) return undefined;
    timeoutTimerRef.current = setTimeout(() => closeRef.current('timeout'), timeoutMs);
    return clearTimeoutTimer;
  }, [isOpen, timeoutMs, clearTimeoutTimer]);

  // ─── Combo: tap toggles the launcher, hold quits to free-play ──────────────
  // Idempotent by construction: the latch makes each press act exactly once, so
  // re-running on an unrelated re-render (e.g. an inline comboNotes array) is a
  // no-op rather than a second toggle.
  useEffect(() => {
    const held = isComboHeld(liveNotes, comboNotes, comboWindowMs);

    if (held && !comboLatchedRef.current) {
      comboLatchedRef.current = true;
      setIsHolding(true);
      if (isOpenRef.current) closeLauncher('combo');
      else openLauncher();

      // Armed on every press, whichever way the tap toggled: "held for 2s
      // quits" is true from any state, including the press that just closed
      // the launcher. Released before it fires, it is only ever a tap.
      clearHoldTimer();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        closeLauncher('hold-exit');
        setGame(null, 'launcher.exit-to-free-play', { gameId: activeGameIdRef.current });
        setIsHolding(false);
      }, holdExitMs);
      return;
    }

    if (held) return;

    // The hold is broken the INSTANT the combo stops reading as held — the
    // spec is "held continuously". A ragged two-hand release (top key up at
    // 1.2s, a finger still resting on A0) must not force-quit a running game
    // at 2s. This is deliberately separate from the latch below: cancelling
    // the quit and re-arming the toggle are different questions.
    if (holdTimerRef.current) {
      clearHoldTimer();
      setIsHolding(false);
    }

    // Unlatch only once every combo key is up. Releasing one of two keys while
    // keeping the other down must not re-arm the toggle under the same press.
    if (comboLatchedRef.current && !comboNotes.some((n) => liveNotes.has(n))) {
      comboLatchedRef.current = false;
      setIsHolding(false);
    }
  }, [
    liveNotes, comboNotes, comboWindowMs, holdExitMs,
    clearHoldTimer, openLauncher, closeLauncher, setGame,
  ]);

  // ─── Selection: only NEWLY struck notes count ──────────────────────────────
  useEffect(() => {
    const current = new Set(liveNotes.keys());
    const struck = [...current].filter((n) => !prevNotesRef.current.has(n)).sort((a, b) => a - b);
    // Seeded before the isOpen guard, on EVERY run: the effect that opens the
    // launcher runs in the same commit, so this pass still sees isOpen false.
    // Miss the seeding here and the keys down at that moment read as struck on
    // the very next pass, launching a game nobody picked.
    prevNotesRef.current = current;

    if (!isOpen || struck.length === 0) return;

    for (const note of struck) {                    // lowest first
      const slot = slotForNote(slots, note);
      if (!slot) continue;
      setGame(slot.gameId, 'launcher.game-selected', { note });
      closeLauncher('selected');
      return;
    }
  }, [liveNotes, isOpen, slots, closeLauncher, setGame]);

  // ─── Unmount: no timer outlives the hook ──────────────────────────────────
  useEffect(() => () => {
    clearHoldTimer();
    clearTimeoutTimer();
  }, [clearHoldTimer, clearTimeoutTimer]);

  return { launchNonce, isOpen, activeGameId, isHolding, dismiss, exitGame, timeoutMs };
}
