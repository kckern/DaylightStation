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

// Outcome types for pendingOutcomeRef (extracted from setWorld updater)
const OUTCOME_FAIL = 'fail';
const OUTCOME_ADVANCE = 'advance';

// ─── Constants ──────────────────────────────────────────────────
const COUNTDOWN_STEPS = [3, 2, 1, 0];
const COUNTDOWN_STEP_MS = 800;
const GAME_OVER_DISPLAY_MS = 5000;
const SIDE_SCROLLER_ACTIONS = ['jump', 'duck'];

// ─── Target Generation (2 actions only) ─────────────────────────

const MIN_ACTION_SEPARATION = 4; // Minimum semitones between notes of different actions

function generateScrollerTargets(noteRange, complexity, whiteKeysOnly) {
  const notesPerAction = { single: 1, dyad: 2, triad: 3 };
  let count = notesPerAction[complexity] || 1;

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);

  // Separate by clef: treble (>= 60 / C4) for jump (top staff), bass (< 60) for duck (bottom staff)
  const trebleNotes = available.filter(n => n >= 60);
  const bassNotes = available.filter(n => n < 60);

  if (bassNotes.length >= count && trebleNotes.length >= count) {
    // Enough notes in both clefs — assign by clef (already shuffled)
    return {
      jump: trebleNotes.slice(0, count),
      duck: bassNotes.slice(0, count),
    };
  }

  // All in one clef — pick from shuffled pool, ensuring minimum separation
  const totalNeeded = count * 2;
  if (available.length < totalNeeded) count = 1;

  // Pick duck notes first (from shuffled pool), then find well-separated jump notes
  const duckPitches = available.slice(0, count);
  const duckSet = new Set(duckPitches);

  // Filter remaining notes to those at least MIN_ACTION_SEPARATION from all duck notes
  const separated = available.filter(n =>
    !duckSet.has(n) && duckPitches.every(d => Math.abs(n - d) >= MIN_ACTION_SEPARATION)
  );

  const jumpPitches = separated.length >= count
    ? separated.slice(0, count)
    : available.filter(n => !duckSet.has(n)).slice(0, count);

  return { jump: jumpPitches, duck: duckPitches };
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

  // ─── Memoize config to prevent gameLoop recreation every render ─
  const config = useMemo(() => ({
    health: gameConfig?.health ?? TOTAL_HEALTH,
    damagePerHit: gameConfig?.damage_per_hit ?? 2,
    healPerDodge: gameConfig?.heal_per_dodge ?? 1,
    invincibilityMs: gameConfig?.invincibility_ms ?? 1000,
    jumpDurationMs: gameConfig?.jump_duration_ms ?? 900,
  }), [gameConfig]);

  // Timer refs
  const rafRef = useRef(null);
  const countdownRef = useRef(null);
  const gameOverRef = useRef(null);
  const lastFrameRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const prevDodgeCountRef = useRef(0);
  const pendingOutcomeRef = useRef(null);

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
    const newTargets = generateScrollerTargets(noteRange, complexity, whiteKeysOnly);
    logger.debug('side-scroller.targets-regenerated', { jump: newTargets.jump, duck: newTargets.duck });
    setTargets(newTargets);
  }, [logger]);

  // ─── Game Loop (rAF) ───────────────────────────────────────

  const gameLoop = useCallback((timestamp) => {
    if (phaseRef.current !== 'PLAYING') return;

    const dt = lastFrameRef.current ? Math.min((timestamp - lastFrameRef.current) / 1000, 0.1) : 0.016;
    lastFrameRef.current = timestamp;

    const lvlConfig = levels[levelRef.current] ?? levels[0];
    if (!lvlConfig) return;

    const scrollSpeed = lvlConfig.scroll_speed ?? 3;

    // Obstacle interval: supports [min, max] range or single fixed value
    const rawInterval = lvlConfig.obstacle_interval_ms ?? 2000;
    const [intervalMin, intervalMax] = Array.isArray(rawInterval)
      ? [rawInterval[0], rawInterval[1]]
      : [rawInterval, rawInterval];

    // Spawn decision — computed OUTSIDE state updater to avoid side-effect issues
    const elapsed = timestamp - lastSpawnRef.current;
    // Pick a random threshold within the configured range for this spawn cycle
    const nextInterval = intervalMin + Math.random() * (intervalMax - intervalMin);
    let spawnType = null;
    if (elapsed >= nextInterval || lastSpawnRef.current === 0) {
      spawnType = Math.random() < 0.5 ? OBSTACLE_LOW : OBSTACLE_HIGH;
      lastSpawnRef.current = timestamp;
    }

    setWorld(prev => {
      let next = tickWorld(prev, dt, scrollSpeed);
      next = updateJump(next, dt, config.jumpDurationMs);

      // Spawn obstacle (decision was made outside updater)
      if (spawnType) {
        next = spawnObstacle(next, spawnType);
      }

      // Check collisions
      const collisions = checkCollisions(next);
      if (collisions.length > 0) {
        const hitIndices = collisions.map(c => next.obstacles.indexOf(c));
        next = applyDamage(next, config.damagePerHit, config.invincibilityMs, timestamp, hitIndices);
        logger.debug('side-scroller.collision', { count: collisions.length, health: next.health, damagePerHit: config.damagePerHit });
        if (next.health <= TOTAL_HEALTH * 0.25 && next.health > 0) {
          logger.warn('side-scroller.health-warning', { health: next.health, totalHealth: TOTAL_HEALTH });
        }
      }

      // Check for newly dodged obstacles → heal
      if (next.dodgeCount > prevDodgeCountRef.current) {
        const dodged = next.dodgeCount - prevDodgeCountRef.current;
        for (let i = 0; i < dodged; i++) {
          next = applyHeal(next, config.healPerDodge);
        }
        logger.debug('side-scroller.heal', { dodged, health: next.health, healPerDodge: config.healPerDodge });
        prevDodgeCountRef.current = next.dodgeCount;
      }

      // Evaluate level — store outcome in ref instead of calling setState from updater
      const outcome = evaluateLevel(next, lvlConfig);
      if (outcome === 'fail') {
        pendingOutcomeRef.current = { type: OUTCOME_FAIL, score: next.score, level: levelRef.current };
        return next;
      }
      if (outcome === 'advance') {
        const nextLevel = levelRef.current + 1;
        pendingOutcomeRef.current = { type: OUTCOME_ADVANCE, from: levelRef.current, score: next.score, nextLevel };
        next = { ...next, score: 0 };
      }

      return next;
    });

    // Apply side effects after setWorld (extracted from updater)
    const outcome = pendingOutcomeRef.current;
    if (outcome) {
      pendingOutcomeRef.current = null;
      if (outcome.type === OUTCOME_FAIL) {
        logger.info('side-scroller.game-over', { score: outcome.score, level: outcome.level });
        setPhase('GAME_OVER');
      } else if (outcome.type === OUTCOME_ADVANCE) {
        logger.info('side-scroller.level-advance', { from: outcome.from, score: outcome.score });
        if (outcome.nextLevel >= levels.length) {
          setPhase('GAME_OVER');
        } else {
          setLevel(outcome.nextLevel);
          setLevelName(levels[outcome.nextLevel]?.name ?? '');
          setTimeout(() => regenerateTargets(levels[outcome.nextLevel]), 0);
        }
      }
    }

    rafRef.current = requestAnimationFrame(gameLoop);
  }, [levels, config, logger, regenerateTargets]);

  // Start/stop game loop based on phase — DO NOT reset refs here
  useEffect(() => {
    if (phase === 'PLAYING') {
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
    logger.debug('side-scroller.action', { action: actionName });
    if (actionName === 'jump') {
      setWorld(prev => applyJump(prev));
    } else if (actionName === 'duck') {
      setWorld(prev => applyDuck(prev));
    }
  }, [logger]);

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

    // Reset all timing refs here (NOT in the rAF effect)
    lastFrameRef.current = 0;
    lastSpawnRef.current = 0;
    prevDodgeCountRef.current = 0;
    lastRegenDodgeRef.current = 0;

    setWorld(createInitialWorld(config));
    setLevel(0);
    setPhase('STARTING');
    setCountdown(3);
    setLevelName(levels[0]?.name ?? '');

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

  // ─── Next Obstacle (for staff hint opacity) ────────────────

  const nextObstacleType = useMemo(() => {
    if (phase !== 'PLAYING' || !world.obstacles) return null;
    let nearest = null;
    let nearestDist = Infinity;
    for (const ob of world.obstacles) {
      if (ob.hit || ob.dodged) continue;
      const dist = ob.x - 0.25; // PLAYER_X
      if (dist < -ob.width) continue;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = ob;
      }
    }
    return nearest?.type ?? null;
  }, [phase, world.obstacles]);

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
    nextObstacleType,
  };
}

export default useSideScrollerGame;
