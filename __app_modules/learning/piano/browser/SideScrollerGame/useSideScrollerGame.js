import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../../../frontend/src/lib/logging/singleton.js';
import { useStaffMatching } from '../game-platform/families/bound-action/useStaffMatching.js';
import { resolveTheme } from './sideScrollerTheme.js';
import { useSideScrollerSfx } from './sideScrollerSounds.js';
import { generateScrollerTargets } from './sideScrollerTargets.js';
import { planSteps } from '../../../../../__capabilities/gaming/portable/realtime/index.mjs';
import { createFrameDriver, createEffectDispatcher } from '../../../../../__capabilities/gaming/browser/platform/realtime/index.js';
import {
  TOTAL_HEALTH,
  MAX_DUCK_MS,
  PLAYER_X,
  createInitialWorld,
  spawnObstacle,
  tickWorld,
  applyJump,
  applyDuck,
  applyShoot,
  releaseDuck,
  updateJump,
  updateDuck,
  checkCollisions,
  applyDamage,
  applyHeal,
  evaluateLevel,
  pickObstacleType,
  mixIncludesShootable,
} from './sideScrollerEngine.js';

// Outcome types for pendingOutcomeRef (extracted from setWorld updater)
const OUTCOME_FAIL = 'fail';
const OUTCOME_ADVANCE = 'advance';

// ─── Constants ──────────────────────────────────────────────────
const COUNTDOWN_STEPS = [3, 2, 1, 0];
const COUNTDOWN_STEP_MS = 800;
/** Fixed simulation step. Whole steps only; the remainder carries to the next frame. */
const STEP_S = 1 / 60;
/** Longest frame the loop will simulate (a backgrounded tab does not leap). */
const MAX_FRAME_S = 0.1;
/** Cleared-obstacle sounds; no log names, so the dispatcher adds no log lines. */
const SFX_TABLE = Object.freeze({
  hit: () => [{ id: 'hit', cue: 'hit' }],
  dodge: () => [{ id: 'dodge', cue: 'dodge' }],
});
/** How long the death burst plays before the Game Over card. */
export const DEATH_MS = 2000;

// ─── Hook ───────────────────────────────────────────────────────

export function useSideScrollerGame(activeNotes, gameConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'side-scroller' }), []);

  // Resolved visual + audio theme (config-driven; defaults reproduce the
  // original Mega Man + procedural-CSS look). Sounds are silent until configured.
  const theme = useMemo(() => resolveTheme(gameConfig), [gameConfig]);
  const sfx = useSideScrollerSfx(theme.sounds);
  const effects = useMemo(() => createEffectDispatcher({
    table: SFX_TABLE,
    playCue: (cue) => { sfx.play(cue); return true; },
    logNames: {},
  }), [sfx]);

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

  const levels = useMemo(() => gameConfig?.levels ?? [], [gameConfig?.levels]);

  // ─── Memoize config to prevent gameLoop recreation every render ─
  const config = useMemo(() => ({
    health: gameConfig?.health ?? TOTAL_HEALTH,
    damagePerHit: gameConfig?.damage_per_hit ?? 2,
    healPerDodge: gameConfig?.heal_per_dodge ?? 1,
    invincibilityMs: gameConfig?.invincibility_ms ?? 1000,
    jumpDurationMs: gameConfig?.jump_duration_ms ?? 900,
    maxDuckMs: gameConfig?.max_duck_ms ?? MAX_DUCK_MS,
  }), [gameConfig]);

  // Timer refs
  const driverRef = useRef(null);
  const countdownRef = useRef(null);
  const deathTimerRef = useRef(null);
  // Simulated clock (ms). Advances only by fixed steps while PLAYING, so every
  // engine timestamp (duck, damage, shoot pose, spawn spacing) is game time.
  const simMsRef = useRef(0);
  const carryRef = useRef(0);
  // Sim time of the last spawn; null = nothing spawned yet this run.
  const lastSpawnRef = useRef(null);
  const prevDodgeCountRef = useRef(0);
  const pendingOutcomeRef = useRef(null);

  // ─── Cleanup ────────────────────────────────────────────────

  const clearAllTimers = useCallback(() => {
    driverRef.current?.stop();
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (deathTimerRef.current) { clearTimeout(deathTimerRef.current); deathTimerRef.current = null; }
  }, []);

  // ─── Target Regeneration ────────────────────────────────────

  const regenerateTargets = useCallback((lvlConfig) => {
    if (!lvlConfig) return;
    const noteRange = lvlConfig.note_range || [60, 72];
    const complexity = lvlConfig.complexity || 'single';
    const whiteKeysOnly = lvlConfig.white_keys_only ?? false;
    // The shoot staff exists only where something can need shooting.
    const shoot = mixIncludesShootable(lvlConfig.obstacle_mix);
    const newTargets = generateScrollerTargets(noteRange, complexity, whiteKeysOnly, { shoot });
    logger.info('side-scroller.targets-regenerated', { jump: newTargets.jump, duck: newTargets.duck, shoot: newTargets.shoot ?? null });
    setTargets(newTargets);
  }, [logger]);

  // ─── Game Loop (rAF) ───────────────────────────────────────

  const gameLoop = useCallback(({ elapsedS }) => {
    if (phaseRef.current !== 'PLAYING') return false;

    const lvlConfig = levels[levelRef.current] ?? levels[0];
    if (!lvlConfig) return false;

    const scrollSpeed = lvlConfig.scroll_speed ?? 3;

    // Obstacle interval: supports [min, max] range or single fixed value
    const rawInterval = lvlConfig.obstacle_interval_ms ?? 2000;
    const [intervalMin, intervalMax] = Array.isArray(rawInterval)
      ? [rawInterval[0], rawInterval[1]]
      : [rawInterval, rawInterval];

    // Plan whole fixed steps; the remainder carries to the next frame.
    const plan = planSteps(elapsedS, { stepS: STEP_S, remainder: 'carry', carryS: carryRef.current });
    carryRef.current = plan.carryS;
    if (plan.dts.length === 0) return true;

    // Per-step clock + spawn decisions — computed OUTSIDE the state updater to
    // avoid side-effect issues (the updater only replays them).
    const steps = plan.dts.map((dt) => {
      simMsRef.current += dt * 1000;
      const now = simMsRef.current;
      // Pick a random threshold within the configured range for this spawn check
      const nextInterval = intervalMin + Math.random() * (intervalMax - intervalMin);
      let spawnType = null;
      if (lastSpawnRef.current === null || now - lastSpawnRef.current >= nextInterval) {
        spawnType = pickObstacleType(lvlConfig.obstacle_mix);
        lastSpawnRef.current = now;
      }
      return { dt, now, spawnType };
    });

    setWorld(prev => {
      let next = prev;
      for (const { dt, now, spawnType } of steps) {
        const before = next;
        next = tickWorld(next, dt, scrollSpeed);
        next = updateJump(next, dt, config.jumpDurationMs);
        next = updateDuck(next, now, config.maxDuckMs);

        if (next.blockHits > (before.blockHits ?? 0)) {
          logger.info('side-scroller.block-hit', {
            hits: next.blockHits - (before.blockHits ?? 0),
            broken: next.blocksBroken - (before.blocksBroken ?? 0),
            blocksBroken: next.blocksBroken,
          });
        }

        // Spawn obstacle (decision was made outside updater)
        if (spawnType) {
          next = spawnObstacle(next, spawnType);
        }

        // Check collisions
        const collisions = checkCollisions(next);
        if (collisions.length > 0) {
          const hitIndices = collisions.map(c => next.obstacles.indexOf(c));
          next = applyDamage(next, config.damagePerHit, config.invincibilityMs, now, hitIndices);
          effects.dispatch([{ type: 'hit' }]);
          logger.info('side-scroller.collision', { count: collisions.length, types: collisions.map(c => c.type), health: next.health, damagePerHit: config.damagePerHit });
          if (next.health <= TOTAL_HEALTH * 0.25 && next.health > 0) {
            logger.warn('side-scroller.health-warning', { health: next.health, totalHealth: TOTAL_HEALTH });
          }
        }

        // Check for newly cleared obstacles (dodged or shot down) → heal
        if (next.dodgeCount > prevDodgeCountRef.current) {
          const dodged = next.dodgeCount - prevDodgeCountRef.current;
          for (let i = 0; i < dodged; i++) {
            next = applyHeal(next, config.healPerDodge);
          }
          effects.dispatch([{ type: 'dodge' }]);
          logger.info('side-scroller.heal', { dodged, health: next.health, healPerDodge: config.healPerDodge });
          prevDodgeCountRef.current = next.dodgeCount;
        }

        // Evaluate level — store outcome in ref instead of calling setState from updater
        const outcome = evaluateLevel(next, lvlConfig);
        if (outcome === 'fail') {
          pendingOutcomeRef.current = { type: OUTCOME_FAIL, score: next.score, level: levelRef.current };
          return next; // no further steps after a fail
        }
        if (outcome === 'advance') {
          const nextLevel = levelRef.current + 1;
          pendingOutcomeRef.current = { type: OUTCOME_ADVANCE, from: levelRef.current, score: next.score, nextLevel };
          next = { ...next, score: 0 };
        }
      }

      return next;
    });

    // Apply side effects after setWorld (extracted from updater)
    const outcome = pendingOutcomeRef.current;
    if (outcome) {
      pendingOutcomeRef.current = null;
      if (outcome.type === OUTCOME_FAIL) {
        // The world freezes and the player bursts; Game Over follows the burst.
        // The phase ref moves now, not on the next render, so a frame already
        // queued cannot fail the run a second time.
        phaseRef.current = 'DYING';
        if (!deathTimerRef.current) {
          sfx.play('death');
          logger.info('side-scroller.death', { score: outcome.score, level: outcome.level });
          setPhase('DYING');
          deathTimerRef.current = setTimeout(() => {
            deathTimerRef.current = null;
            sfx.play('gameover');
            logger.info('side-scroller.game-over', { score: outcome.score, level: outcome.level });
            setPhase('GAME_OVER');
          }, DEATH_MS);
        }
        return false;
      } else if (outcome.type === OUTCOME_ADVANCE) {
        logger.info('side-scroller.level-advance', { from: outcome.from, score: outcome.score });
        if (outcome.nextLevel >= levels.length) {
          sfx.play('gameover');
          setPhase('GAME_OVER');
        } else {
          sfx.play('levelup');
          setLevel(outcome.nextLevel);
          setLevelName(levels[outcome.nextLevel]?.name ?? '');
          setTimeout(() => regenerateTargets(levels[outcome.nextLevel]), 0);
        }
      }
    }

    return true;
  }, [levels, config, logger, regenerateTargets, sfx, effects]);

  // One frame driver for the hook's lifetime; it always calls the latest loop.
  const gameLoopRef = useRef(gameLoop);
  useEffect(() => { gameLoopRef.current = gameLoop; }, [gameLoop]);
  if (!driverRef.current) {
    driverRef.current = createFrameDriver({
      onFrame: (frame) => gameLoopRef.current(frame),
      maxFrameS: MAX_FRAME_S,
      // Surface a loop failure as an uncaught error, as a throwing rAF callback did.
      onError: (err) => { setTimeout(() => { throw err; }, 0); },
    });
  }

  // Start/stop game loop based on phase — DO NOT reset refs here
  useEffect(() => {
    const driver = driverRef.current;
    if (phase === 'PLAYING') {
      driver.start();
    } else {
      driver.stop();
    }
    return () => driver.stop();
  }, [phase]);

  // ─── Action Handlers ────────────────────────────────────────

  const handleAction = useCallback((actionName) => {
    logger.info('side-scroller.action', { action: actionName });
    if (actionName === 'jump') {
      sfx.play('jump');
      setWorld(prev => applyJump(prev));
    } else if (actionName === 'duck') {
      sfx.play('duck');
      const now = simMsRef.current;
      setWorld(prev => applyDuck(prev, now));
    } else if (actionName === 'shoot') {
      // No slide-shot: a shot while ducking is ignored, and says so.
      if (worldRef.current.playerState === 'ducking') {
        logger.info('side-scroller.shot-ignored', { reason: 'ducking' });
        return;
      }
      sfx.play('shoot');
      const now = simMsRef.current;
      setWorld(prev => applyShoot(prev, now));
    }
  }, [logger, sfx]);

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
    if (!lvlConfig) return;
    if (world.dodgeCount > lastRegenDodgeRef.current) {
      lastRegenDodgeRef.current = world.dodgeCount;
      regenerateTargets(lvlConfig);
    }
  }, [world.dodgeCount, phase, level, levels, regenerateTargets]);

  // ─── Start Game (Countdown) ─────────────────────────────────

  const startGame = useCallback(() => {
    if (!['IDLE', 'GAME_OVER'].includes(phaseRef.current)) return;
    clearAllTimers();

    // Reset all timing refs here (NOT in the rAF effect)
    simMsRef.current = 0;
    carryRef.current = 0;
    lastSpawnRef.current = null;
    prevDodgeCountRef.current = 0;
    lastRegenDodgeRef.current = 0;

    setWorld(createInitialWorld(config));
    setLevel(0);
    setPhase('STARTING');
    setCountdown(3);
    setLevelName(levels[0]?.name ?? '');

    sfx.play('start');
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
  }, [clearAllTimers, levels, config, logger, regenerateTargets, sfx]);

  // ─── Cleanup on Unmount ─────────────────────────────────────

  useEffect(() => clearAllTimers, [clearAllTimers]);

  // ─── Next Obstacle (for staff hint opacity) ────────────────

  const nextObstacleType = useMemo(() => {
    if (phase !== 'PLAYING' || !world.obstacles) return null;
    let nearest = null;
    let nearestDist = Infinity;
    for (const ob of world.obstacles) {
      if (ob.hit || ob.dodged) continue;
      const dist = ob.x - PLAYER_X;
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
    // Simulated ms — the clock the world's invincibleUntil / shootUntil are stamped in.
    simMs: simMsRef.current,
    startGame,
    nextObstacleType,
    theme,
  };
}

export default useSideScrollerGame;
