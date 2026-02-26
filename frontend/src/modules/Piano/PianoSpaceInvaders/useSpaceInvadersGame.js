import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import {
  createInitialState,
  resetForLevel,
  maybeSpawnNote,
  processHit,
  applyScore,
  processMisses,
  cleanupResolvedNotes,
  evaluateLevel,
  getFallDuration,
  TOTAL_HEALTH,
} from './spaceInvadersEngine.js';

const TICK_INTERVAL = 16; // ~60fps
const COUNTDOWN_STEPS = [3, 2, 1, 0]; // 0 = "GO"
const COUNTDOWN_STEP_MS = 800;
const BANNER_DISPLAY_MS = 3000;
const WRONG_NOTE_GLOW_MS = 400; // How long wrong-press red glow lasts
const ERROR_SFX_PATH = '/media/audio/sfx/error.mp3'; // Resolved via DaylightMediaPath

/**
 * Space Invaders game hook — manages state machine, note spawning, hit detection, scoring.
 *
 * @param {Map} activeNotes - From useMidiSubscription
 * @param {Array} noteHistory - From useMidiSubscription
 * @param {Object|null} gameConfig - Parsed game config from piano.yml, or null to disable
 * @returns {Object} Game state for rendering
 */
export function useSpaceInvadersGame(activeNotes, noteHistory, gameConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'space-invaders-game' }), []);
  const [gameState, setGameState] = useState(createInitialState);
  const gameStateRef = useRef(gameState);
  const lastNoteHistoryLen = useRef(0);
  const tickRef = useRef(null);
  const countdownRef = useRef(null);
  const bannerTimeoutRef = useRef(null);
  const [wrongNotes, setWrongNotes] = useState(new Map()); // pitch → expiry timestamp
  const errorAudioRef = useRef(null);

  // Preload error buzzer via media proxy
  useEffect(() => {
    const audio = new Audio(DaylightMediaPath(ERROR_SFX_PATH));
    audio.volume = 0.4;
    audio.preload = 'auto';
    errorAudioRef.current = audio;
  }, []);

  // Keep ref in sync with state (for use in intervals/callbacks)
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const levels = gameConfig?.levels ?? [];
  const timing = gameConfig?.timing ?? {};
  const scoring = gameConfig?.scoring ?? {};

  // ─── Cleanup helper ─────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    tickRef.current = null;
    countdownRef.current = null;
    bannerTimeoutRef.current = null;
  }, []);

  // ─── Countdown ──────────────────────────────────────────────

  const startCountdown = useCallback(() => {
    setGameState(prev => ({ ...prev, phase: 'STARTING', countdown: 3 }));

    let step = 0;
    countdownRef.current = setInterval(() => {
      step++;
      if (step < COUNTDOWN_STEPS.length) {
        setGameState(prev => ({ ...prev, countdown: COUNTDOWN_STEPS[step] }));
      } else {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setGameState(prev => resetForLevel(prev, prev.levelIndex));
        logger.info('space-invaders.started', { level: gameStateRef.current.levelIndex });
      }
    }, COUNTDOWN_STEP_MS);
  }, [logger]);

  // ─── Game Tick (spawning + miss detection + cleanup) ────────

  useEffect(() => {
    if (gameState.phase !== 'PLAYING') return;

    const level = levels[gameState.levelIndex];
    if (!level) return;

    tickRef.current = setInterval(() => {
      const now = Date.now();

      setGameState(prev => {
        if (prev.phase !== 'PLAYING') return prev;

        let next = prev;

        // 1. Spawn notes
        next = maybeSpawnNote(next, level, now);

        // 2. Detect misses
        next = processMisses(next, now, timing.miss_threshold_ms ?? 400);

        // 3. Cleanup old resolved notes
        next = cleanupResolvedNotes(next, now);

        // 4. Check level outcome
        const outcome = evaluateLevel(next.score, level, next.health);
        if (outcome === 'fail') {
          const failReason = next.health <= 0 ? 'health' : 'misses';
          logger.info('space-invaders.level-failed', {
            level: next.levelIndex,
            score: next.score.points,
            misses: next.score.misses,
            health: next.health,
            failReason,
          });
          return { ...next, phase: 'LEVEL_FAILED', failReason };
        }
        if (outcome === 'advance') {
          logger.info('space-invaders.level-complete', {
            level: next.levelIndex,
            score: next.score.points,
          });
          if (next.levelIndex + 1 >= levels.length) {
            return { ...next, phase: 'VICTORY' };
          }
          return { ...next, phase: 'LEVEL_COMPLETE' };
        }

        return next;
      });
    }, TICK_INTERVAL);

    return () => {
      clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [gameState.phase, gameState.levelIndex, levels, timing, logger]);

  // ─── Hit Detection (watch noteHistory for new note_on events) ─

  useEffect(() => {
    if (gameState.phase !== 'PLAYING') {
      lastNoteHistoryLen.current = noteHistory.length;
      return;
    }

    for (let i = lastNoteHistoryLen.current; i < noteHistory.length; i++) {
      const entry = noteHistory[i];
      if (!entry || entry.endTime !== null) continue;

      const pitch = entry.note;
      const now = entry.startTime;

      // Check if this pitch matches any falling note (using ref for sync read)
      const prev = gameStateRef.current;
      const levelMode = levels[prev.levelIndex]?.mode ?? 'hero';
      const { result } = processHit(prev, pitch, now, timing, levelMode);

      if (!result) {
        // Wrong press — buzzer + red glow + health damage
        if (errorAudioRef.current) {
          errorAudioRef.current.currentTime = 0;
          errorAudioRef.current.play().catch(() => {});
        }
        setWrongNotes(wn => {
          const next = new Map(wn);
          next.set(pitch, Date.now() + WRONG_NOTE_GLOW_MS);
          return next;
        });
      }

      setGameState(prevState => {
        if (prevState.phase !== 'PLAYING') return prevState;

        const lm = levels[prevState.levelIndex]?.mode ?? 'hero';
        const { state: newState, result: hitResult } = processHit(prevState, pitch, now, timing, lm);

        if (hitResult) {
          // Correct hit — score + health heal + reset wrong streak
          const newScore = applyScore(newState.score, hitResult, scoring);
          const newHealth = Math.min(TOTAL_HEALTH, newState.health + 1);
          logger.debug('space-invaders.hit', { pitch, result: hitResult, combo: newScore.combo, points: newScore.points, health: newHealth, mode: lm });
          return { ...newState, score: newScore, health: newHealth, wrongStreak: 0 };
        }

        // Wrong press — escalating penalty: 1st=1, 2nd=3, 3rd=5, 4th+=7
        const streak = newState.wrongStreak + 1;
        const penalty = streak === 1 ? 1 : streak === 2 ? 3 : streak === 3 ? 5 : 7;
        const newHealth = Math.max(0, newState.health - penalty);
        logger.debug('space-invaders.wrong-press', { pitch, health: newHealth, streak, penalty });
        return { ...newState, health: newHealth, wrongStreak: streak };
      });
    }

    lastNoteHistoryLen.current = noteHistory.length;
  }, [noteHistory.length, gameState.phase, timing, scoring, levels, logger]);

  // ─── Banner Auto-Advance (LEVEL_COMPLETE / LEVEL_FAILED / VICTORY) ─

  useEffect(() => {
    if (gameState.phase === 'LEVEL_COMPLETE') {
      bannerTimeoutRef.current = setTimeout(() => {
        const nextLevel = gameState.levelIndex + 1;
        logger.info('space-invaders.next-level', { level: nextLevel });
        setGameState(prev => ({ ...prev, levelIndex: nextLevel }));
        startCountdown();
      }, BANNER_DISPLAY_MS);
      return () => clearTimeout(bannerTimeoutRef.current);
    }

    if (gameState.phase === 'LEVEL_FAILED') {
      bannerTimeoutRef.current = setTimeout(() => {
        if (gameState.failReason === 'health') {
          // Health depleted — exit game mode entirely
          logger.info('space-invaders.health-exit', { level: gameState.levelIndex, score: gameState.score.points });
          cleanup();
          setGameState(createInitialState());
        } else {
          // Miss limit exceeded — retry same level
          logger.info('space-invaders.retry-level', { level: gameState.levelIndex });
          startCountdown();
        }
      }, BANNER_DISPLAY_MS);
      return () => clearTimeout(bannerTimeoutRef.current);
    }

    if (gameState.phase === 'VICTORY') {
      bannerTimeoutRef.current = setTimeout(() => {
        logger.info('space-invaders.victory-dismiss', { finalScore: gameState.score.points });
        cleanup();
        setGameState(createInitialState());
      }, 8000);
      return () => clearTimeout(bannerTimeoutRef.current);
    }
  }, [gameState.phase, gameState.levelIndex, gameState.score.points, cleanup, startCountdown, logger]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  // ─── Cleanup expired wrong-note glows ──────────────────────

  useEffect(() => {
    if (wrongNotes.size === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setWrongNotes(prev => {
        const next = new Map();
        for (const [pitch, expiry] of prev) {
          if (expiry > now) next.set(pitch, expiry);
        }
        return next;
      });
    }, WRONG_NOTE_GLOW_MS);
    return () => clearTimeout(timer);
  }, [wrongNotes]);

  // ─── External activation controls ──────────────────────────

  const startGame = useCallback(() => {
    logger.info('space-invaders.activated', {});
    startCountdown();
  }, [startCountdown, logger]);

  // ─── Derived state for rendering ────────────────────────────

  const currentLevel = levels[gameState.levelIndex] ?? null;
  const levelProgress = currentLevel
    ? {
        pointsEarned: gameState.score.points,
        pointsNeeded: currentLevel.points_to_advance,
        missesUsed: gameState.score.misses,
        missesAllowed: currentLevel.max_misses,
      }
    : null;

  return {
    gameState: gameState.phase,
    currentLevel,
    levelMode: currentLevel?.mode ?? 'hero',
    fallingNotes: gameState.fallingNotes,
    score: gameState.score,
    health: gameState.health,
    countdown: gameState.countdown,
    levelProgress,
    fallDuration: getFallDuration(currentLevel),
    wrongNotes,
    startGame,
    totalHealth: TOTAL_HEALTH,
  };
}

export default useSpaceInvadersGame;
