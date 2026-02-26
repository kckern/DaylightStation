import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { useStaffMatching } from '../PianoTetris/useStaffMatching.js';
import { shuffle, buildNotePool } from '../noteUtils.js';
import {
  TOTAL_HEALTH,
  createInitialWorld,
  spawnObstacle,
  tickWorld,
  applyJump,
  applyDuck,
  releaseDuck,
  updateJump,
  checkCollisions,
  applyDamage,
  applyHeal,
  evaluateLevel,
  OBSTACLE_LOW,
  OBSTACLE_HIGH,
} from './sideScrollerEngine.js';

// ─── Constants ──────────────────────────────────────────────────
const COUNTDOWN_STEPS = [3, 2, 1, 0];
const COUNTDOWN_STEP_MS = 800;
const GAME_OVER_DISPLAY_MS = 5000;
const SIDE_SCROLLER_ACTIONS = ['jump', 'duck'];

// ─── Target Generation (2 actions only) ─────────────────────────

function generateScrollerTargets(noteRange, complexity, whiteKeysOnly) {
  const notesPerAction = { single: 1, dyad: 2, triad: 3 };
  let count = notesPerAction[complexity] || 1;

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);
  const totalNeeded = count * SIDE_SCROLLER_ACTIONS.length;

  if (available.length < totalNeeded) count = 1;

  const targets = {};
  for (let a = 0; a < SIDE_SCROLLER_ACTIONS.length; a++) {
    const start = a * count;
    const pitches = [];
    for (let i = 0; i < count; i++) {
      pitches.push(available[(start + i) % available.length]);
    }
    targets[SIDE_SCROLLER_ACTIONS[a]] = pitches;
  }
  return targets;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useSideScrollerGame(activeNotes, gameConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'side-scroller' }), []);

  const [phase, setPhase] = useState('IDLE');
  const [world, setWorld] = useState(() => createInitialWorld(gameConfig));
  const [level, setLevel] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [targets, setTargets] = useState(null);
  const [levelName, setLevelName] = useState('');

  const worldRef = useRef(world);
  const phaseRef = useRef(phase);
  const levelRef = useRef(level);

  useEffect(() => { worldRef.current = world; }, [world]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { levelRef.current = level; }, [level]);

  const levels = gameConfig?.levels ?? [];
  const config = {
    health: gameConfig?.health ?? TOTAL_HEALTH,
    damagePerHit: gameConfig?.damage_per_hit ?? 2,
    healPerDodge: gameConfig?.heal_per_dodge ?? 1,
    invincibilityMs: gameConfig?.invincibility_ms ?? 1000,
    jumpDurationMs: gameConfig?.jump_duration_ms ?? 500,
  };

  // Timer refs
  const rafRef = useRef(null);
  const countdownRef = useRef(null);
  const gameOverRef = useRef(null);
  const lastFrameRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const prevDodgeCountRef = useRef(0);

  // ─── Cleanup ────────────────────────────────────────────────

  const clearAllTimers = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (gameOverRef.current) { clearTimeout(gameOverRef.current); gameOverRef.current = null; }
  }, []);

  // ─── Target Regeneration ────────────────────────────────────

  const regenerateTargets = useCallback((lvlConfig) => {
    if (!lvlConfig) return;
    const noteRange = lvlConfig.note_range || [60, 72];
    const complexity = lvlConfig.complexity || 'single';
    const whiteKeysOnly = lvlConfig.white_keys_only ?? false;
    setTargets(generateScrollerTargets(noteRange, complexity, whiteKeysOnly));
  }, []);

  // ─── Game Loop (rAF) ───────────────────────────────────────

  const gameLoop = useCallback((timestamp) => {
    if (phaseRef.current !== 'PLAYING') return;

    const dt = lastFrameRef.current ? Math.min((timestamp - lastFrameRef.current) / 1000, 0.1) : 0.016;
    lastFrameRef.current = timestamp;

    const lvlConfig = levels[levelRef.current] ?? levels[0];
    if (!lvlConfig) return;

    const scrollSpeed = lvlConfig.scroll_speed ?? 3;
    const obstacleIntervalMs = lvlConfig.obstacle_interval_ms ?? 2000;

    setWorld(prev => {
      let next = tickWorld(prev, dt, scrollSpeed);
      next = updateJump(next, dt, config.jumpDurationMs);

      // Spawn obstacles at intervals
      const elapsed = timestamp - lastSpawnRef.current;
      if (elapsed >= obstacleIntervalMs || lastSpawnRef.current === 0) {
        const type = Math.random() < 0.5 ? OBSTACLE_LOW : OBSTACLE_HIGH;
        next = spawnObstacle(next, type);
        lastSpawnRef.current = timestamp;
      }

      // Check collisions
      const collisions = checkCollisions(next);
      if (collisions.length > 0) {
        const hitIndices = collisions.map(c => next.obstacles.indexOf(c));
        next = applyDamage(next, config.damagePerHit, config.invincibilityMs, timestamp, hitIndices);
        logger.debug('side-scroller.collision', { health: next.health });
      }

      // Check for newly dodged obstacles → heal
      if (next.dodgeCount > prevDodgeCountRef.current) {
        const dodged = next.dodgeCount - prevDodgeCountRef.current;
        for (let i = 0; i < dodged; i++) {
          next = applyHeal(next, config.healPerDodge);
        }
        prevDodgeCountRef.current = next.dodgeCount;
      }

      // Evaluate level
      const outcome = evaluateLevel(next, lvlConfig);
      if (outcome === 'fail') {
        logger.info('side-scroller.game-over', { score: next.score, level: levelRef.current });
        setPhase('GAME_OVER');
        return next;
      }
      if (outcome === 'advance') {
        logger.info('side-scroller.level-advance', { from: levelRef.current, score: next.score });
        const nextLevel = levelRef.current + 1;
        if (nextLevel >= levels.length) {
          setPhase('GAME_OVER');
          return next;
        }
        setLevel(nextLevel);
        setLevelName(levels[nextLevel]?.name ?? '');
        next = { ...next, score: 0 };
        setTimeout(() => regenerateTargets(levels[nextLevel]), 0);
      }

      return next;
    });

    rafRef.current = requestAnimationFrame(gameLoop);
  }, [levels, config, logger, regenerateTargets]);

  // Start/stop game loop based on phase
  useEffect(() => {
    if (phase === 'PLAYING') {
      lastFrameRef.current = 0;
      lastSpawnRef.current = 0;
      prevDodgeCountRef.current = 0;
      rafRef.current = requestAnimationFrame(gameLoop);
    } else {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [phase, gameLoop]);

  // ─── Action Handlers ────────────────────────────────────────

  const handleAction = useCallback((actionName) => {
    if (actionName === 'jump') {
      setWorld(prev => applyJump(prev));
    } else if (actionName === 'duck') {
      setWorld(prev => applyDuck(prev));
    }
  }, []);

  // Staff matching
  const staffEnabled = phase === 'PLAYING';
  const { matchedActions } = useStaffMatching(activeNotes, targets, handleAction, staffEnabled);

  // Release duck when duck action is no longer matched
  useEffect(() => {
    if (phase !== 'PLAYING') return;
    if (!matchedActions.has('duck')) {
      setWorld(prev => releaseDuck(prev));
    }
  }, [matchedActions, phase]);

  // ─── Target regeneration on dodge ───────────────────────────

  const lastRegenDodgeRef = useRef(0);
  useEffect(() => {
    if (phase !== 'PLAYING') return;
    const lvlConfig = levels[level] ?? levels[0];
    if (!lvlConfig || lvlConfig.target_rotation !== 'dodge') return;
    if (world.dodgeCount > lastRegenDodgeRef.current) {
      lastRegenDodgeRef.current = world.dodgeCount;
      regenerateTargets(lvlConfig);
    }
  }, [world.dodgeCount, phase, level, levels, regenerateTargets]);

  // ─── Start Game (Countdown) ─────────────────────────────────

  const startGame = useCallback(() => {
    if (phaseRef.current !== 'IDLE') return;
    clearAllTimers();

    setWorld(createInitialWorld(config));
    setLevel(0);
    setPhase('STARTING');
    setCountdown(3);
    setLevelName(levels[0]?.name ?? '');
    lastRegenDodgeRef.current = 0;

    logger.info('side-scroller.game-started', {});

    let step = 0;
    countdownRef.current = setInterval(() => {
      step++;
      if (step < COUNTDOWN_STEPS.length) {
        setCountdown(COUNTDOWN_STEPS[step]);
      } else {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);
        setPhase('PLAYING');

        const lvlConfig = levels[0];
        if (lvlConfig) {
          regenerateTargets(lvlConfig);
        }
      }
    }, COUNTDOWN_STEP_MS);
  }, [clearAllTimers, levels, config, logger, regenerateTargets]);

  // ─── Game Over Auto-Dismiss ─────────────────────────────────

  useEffect(() => {
    if (phase !== 'GAME_OVER') return;
    gameOverRef.current = setTimeout(() => {
      gameOverRef.current = null;
      logger.info('side-scroller.game-dismissed', { score: worldRef.current.score });
      setPhase('IDLE');
      setWorld(createInitialWorld(config));
      setTargets(null);
    }, GAME_OVER_DISPLAY_MS);
    return () => {
      if (gameOverRef.current) { clearTimeout(gameOverRef.current); gameOverRef.current = null; }
    };
  }, [phase, config, logger]);

  // ─── Cleanup on Unmount ─────────────────────────────────────

  useEffect(() => clearAllTimers, [clearAllTimers]);

  // ─── Return ─────────────────────────────────────────────────

  return {
    phase,
    world,
    level,
    levelName,
    countdown,
    targets,
    matchedActions,
    health: world.health,
    totalHealth: config.health,
    score: world.score,
    startGame,
  };
}

export default useSideScrollerGame;
