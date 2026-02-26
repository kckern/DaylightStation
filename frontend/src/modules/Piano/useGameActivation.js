import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { isActivationComboHeld } from './PianoSpaceInvaders/spaceInvadersEngine.js';

const ACTIVATION_COOLDOWN_MS = 2000;

/**
 * Shared activation hook — watches MIDI input for any game's activation combo
 * and returns which game (if any) is currently active.
 *
 * Replaces activation detection previously hardcoded in useRhythmGame for the
 * rhythm game. Supports multiple games via config-driven combos.
 *
 * @param {Map<number, {velocity: number, timestamp: number}>} activeNotes
 * @param {Object|null} gamesConfig - parsed `games` section from piano.yml
 * @param {string|null} initialGame - game ID to auto-activate on mount (e.g. from URL)
 * @returns {{ activeGameId: string|null, gameConfig: Object|null, deactivate: () => void }}
 */
export function useGameActivation(activeNotes, gamesConfig, initialGame = null) {
  const logger = useMemo(() => getChildLogger({ component: 'game-activation' }), []);

  const [activeGameId, setActiveGameId] = useState(null);
  const cooldownRef = useRef(0);
  const initialGameApplied = useRef(false);

  const deactivate = useCallback(() => {
    if (activeGameId) {
      logger.info('game.deactivated', { gameId: activeGameId });
    }
    setActiveGameId(null);
    cooldownRef.current = Date.now() + ACTIVATION_COOLDOWN_MS;
  }, [activeGameId, logger]);

  // ─── Auto-activate from URL (initialGame) ────────────────────

  useEffect(() => {
    if (!initialGame || !gamesConfig || initialGameApplied.current) return;
    if (gamesConfig[initialGame]) {
      logger.info('game.url-activated', { gameId: initialGame });
      setActiveGameId(initialGame);
      initialGameApplied.current = true;
    }
  }, [initialGame, gamesConfig, logger]);

  // ─── Combo Detection ──────────────────────────────────────────

  useEffect(() => {
    if (!gamesConfig) return;
    if (Date.now() < cooldownRef.current) return;

    const gameIds = Object.keys(gamesConfig);

    for (const gameId of gameIds) {
      const gameConf = gamesConfig[gameId];
      const activation = gameConf?.activation;
      if (!activation?.notes) continue;

      const comboHeld = isActivationComboHeld(
        activeNotes,
        activation.notes,
        activation.window_ms ?? 300
      );

      if (!comboHeld) continue;

      cooldownRef.current = Date.now() + ACTIVATION_COOLDOWN_MS;

      if (activeGameId === null) {
        // No game active — activate this one
        logger.info('game.activated', { gameId });
        setActiveGameId(gameId);
        return;
      }

      if (activeGameId === gameId) {
        // Same game combo re-pressed — deactivate (toggle off)
        logger.info('game.deactivated', { gameId, reason: 'combo-toggle' });
        setActiveGameId(null);
        return;
      }

      // Different game combo while one is active — ignore
      return;
    }
  }, [activeNotes, gamesConfig, activeGameId, logger]);

  // ─── Dev Shortcut: backtick cycles through games (localhost only) ──

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
    if (!gamesConfig) return;

    const gameIds = Object.keys(gamesConfig);
    if (gameIds.length === 0) return;

    const handleKey = (e) => {
      if (e.key !== '`') return;
      e.preventDefault();
      e.stopPropagation();

      if (Date.now() < cooldownRef.current) return;
      cooldownRef.current = Date.now() + ACTIVATION_COOLDOWN_MS;

      setActiveGameId(prev => {
        if (prev === null) {
          const next = gameIds[0];
          logger.info('game.dev-activated', { gameId: next });
          return next;
        }

        const currentIdx = gameIds.indexOf(prev);
        const nextIdx = currentIdx + 1;

        if (nextIdx >= gameIds.length) {
          logger.info('game.dev-deactivated', { from: prev });
          return null;
        }

        const next = gameIds[nextIdx];
        logger.info('game.dev-cycled', { from: prev, to: next });
        return next;
      });
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [gamesConfig, logger]);

  // ─── Return ───────────────────────────────────────────────────

  const gameConfig = activeGameId ? (gamesConfig?.[activeGameId] ?? null) : null;

  return {
    activeGameId,
    gameConfig,
    deactivate,
  };
}

export default useGameActivation;
