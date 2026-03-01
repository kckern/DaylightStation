import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import {
  createBoard,
  spawnPiece,
  nextPieceFromBag,
  movePiece,
  rotatePiece,
  lockPiece,
  clearLines,
  getGhostPosition,
  hardDrop as engineHardDrop,
  calculateScore,
  getGravityMs,
  generateBag,
} from './tetrisEngine.js';
import { generateTargets, useStaffMatching } from './useStaffMatching.js';

// ─── Constants ──────────────────────────────────────────────────

export const COUNTDOWN_STEPS = [3, 2, 1, 0];
export const COUNTDOWN_STEP_MS = 800;
export const LOCK_DELAY_MS = 500;
export const GAME_OVER_DISPLAY_MS = 5000;

// ─── Initial State Factory ──────────────────────────────────────

function createInitialGameState() {
  return {
    phase: 'IDLE',
    board: createBoard(),
    currentPiece: null,
    nextPiece: null,
    heldPiece: null,   // type string or null
    holdUsed: false,    // reset each new piece — can only hold once per piece
    bag: [],
    nextBag: [],
    score: 0,
    linesCleared: 0,
    level: 0,
    countdown: null,
    _spawnCount: 0, // monotonic counter to detect new piece spawns
  };
}

// ─── Hook ───────────────────────────────────────────────────────

/**
 * Tetris game state machine — wires the tetris engine + staff matching.
 * Manages phases, gravity tick, piece locking, and level advancement.
 *
 * @param {Map<number, {velocity: number, timestamp: number}>} activeNotes
 * @param {Object|null} tetrisConfig - from piano.yml { levels: [...] }
 * @returns {Object} game state and controls
 */
export function useTetrisGame(activeNotes, tetrisConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-tetris' }), []);

  const [gameState, setGameState] = useState(createInitialGameState);
  const gameStateRef = useRef(gameState);

  // Keep ref in sync with state (for use inside intervals/callbacks)
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const levels = tetrisConfig?.levels ?? [];

  // Timer refs
  const gravityRef = useRef(null);
  const lockDelayRef = useRef(null);
  const countdownRef = useRef(null);
  const gameOverRef = useRef(null);
  const targetTimerRef = useRef(null);

  // Targets for staff matching
  const [targets, setTargets] = useState(null);

  // ─── Cleanup ────────────────────────────────────────────────

  const clearAllTimers = useCallback(() => {
    if (gravityRef.current) { clearInterval(gravityRef.current); gravityRef.current = null; }
    if (lockDelayRef.current) { clearTimeout(lockDelayRef.current); lockDelayRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (gameOverRef.current) { clearTimeout(gameOverRef.current); gameOverRef.current = null; }
    if (targetTimerRef.current) { clearInterval(targetTimerRef.current); targetTimerRef.current = null; }
  }, []);

  // ─── Target Generation ──────────────────────────────────────

  const regenerateTargets = useCallback((levelConfig) => {
    if (!levelConfig) return;
    const noteRange = levelConfig.note_range || [60, 72];
    const complexity = levelConfig.complexity || 'single';
    const whiteKeysOnly = levelConfig.white_keys_only ?? false;
    const newTargets = generateTargets(noteRange, complexity, whiteKeysOnly);
    setTargets(newTargets);
  }, []);

  // ─── Spawn Next Piece + Target Rotation ─────────────────────

  const advanceToNextPiece = useCallback((prevState) => {
    const advanced = nextPieceFromBag(prevState);

    if (advanced.currentPiece === null || advanced.phase === 'GAME_OVER') {
      return { ...advanced, phase: 'GAME_OVER' };
    }

    return advanced;
  }, []);

  // ─── Lock + Clear + Score + Level Up + Spawn ────────────────

  const lockAndAdvance = useCallback(() => {
    // Cancel any pending lock delay
    if (lockDelayRef.current) { clearTimeout(lockDelayRef.current); lockDelayRef.current = null; }

    setGameState(prev => {
      if (prev.phase !== 'PLAYING' || !prev.currentPiece) return prev;

      // Guard: if rotation changed the piece shape and it can still fall, don't lock — apply gravity instead
      const canFall = movePiece(prev.board, prev.currentPiece, 0, 1);
      if (canFall) {
        return { ...prev, currentPiece: canFall };
      }

      // 1. Lock piece onto board
      const boardAfterLock = lockPiece(prev.board, prev.currentPiece);

      // 2. Clear completed lines
      const { board: boardAfterClear, linesCleared: newLines } = clearLines(boardAfterLock);

      // 3. Calculate score
      const lineScore = calculateScore(newLines, prev.level);
      const totalScore = prev.score + lineScore;
      const totalLines = prev.linesCleared + newLines;

      // 4. Level up every 10 lines
      const newLevel = Math.floor(totalLines / 10);
      const leveledUp = newLevel > prev.level;

      if (newLines > 0) {
        logger.info('tetris.lines-cleared', { lines: newLines, score: lineScore, totalLines, totalScore });
      }
      logger.info('tetris.piece-locked', { type: prev.currentPiece.type, y: prev.currentPiece.y });

      if (leveledUp) {
        logger.info('tetris.level-up', { from: prev.level, to: newLevel });
      }

      // 5. Advance to next piece
      const stateForAdvance = {
        ...prev,
        board: boardAfterClear,
        score: totalScore,
        linesCleared: totalLines,
        level: newLevel,
        holdUsed: false,
      };
      const advanced = advanceToNextPiece(stateForAdvance);

      if (advanced.phase === 'GAME_OVER') {
        logger.info('tetris.game-over', { score: totalScore, lines: totalLines, level: newLevel });
        return advanced;
      }

      return { ...advanced, _spawnCount: prev._spawnCount + 1 };
    });
  }, [advanceToNextPiece, logger]);

  // ─── Handle piece spawned (for target regeneration) ─────────

  // Track piece spawns via _spawnCount (monotonic counter in state)
  const lastSpawnCountRef = useRef(0);
  useEffect(() => {
    if (gameState.phase !== 'PLAYING') return;
    if (!gameState.currentPiece) return;
    if (gameState._spawnCount === lastSpawnCountRef.current) return;
    lastSpawnCountRef.current = gameState._spawnCount;

    const levelConfig = levels[gameState.level] ?? levels[0];
    if (!levelConfig) return;
    const rotation = levelConfig.target_rotation || 'piece';

    if (rotation === 'piece') {
      regenerateTargets(levelConfig);
    }
  }, [gameState.phase, gameState._spawnCount, gameState.level, levels, regenerateTargets]);

  // ─── Gravity Tick ───────────────────────────────────────────

  useEffect(() => {
    if (gameState.phase !== 'PLAYING') {
      if (gravityRef.current) { clearInterval(gravityRef.current); gravityRef.current = null; }
      return;
    }

    // Use config-driven gravity if available, else engine default
    const levelConfig = levels[gameState.level] ?? levels[0];
    const gravityMs = levelConfig?.gravity_ms ?? getGravityMs(gameState.level);

    gravityRef.current = setInterval(() => {
      setGameState(prev => {
        if (prev.phase !== 'PLAYING' || !prev.currentPiece) return prev;

        const moved = movePiece(prev.board, prev.currentPiece, 0, 1);
        if (moved) {
          // Cancel any pending lock delay since we moved successfully
          if (lockDelayRef.current) { clearTimeout(lockDelayRef.current); lockDelayRef.current = null; }
          return { ...prev, currentPiece: moved };
        }

        // Can't move down — start lock delay if not already started
        if (!lockDelayRef.current) {
          lockDelayRef.current = setTimeout(() => {
            lockDelayRef.current = null;
            lockAndAdvance();
          }, LOCK_DELAY_MS);
        }

        return prev;
      });
    }, gravityMs);

    return () => {
      clearInterval(gravityRef.current);
      gravityRef.current = null;
    };
  }, [gameState.phase, gameState.level, levels, lockAndAdvance]);

  // ─── Target timer rotation ─────────────────────────────────

  useEffect(() => {
    if (gameState.phase !== 'PLAYING') {
      if (targetTimerRef.current) { clearInterval(targetTimerRef.current); targetTimerRef.current = null; }
      return;
    }

    const levelConfig = levels[gameState.level] ?? levels[0];
    if (!levelConfig) return;
    const rotation = levelConfig.target_rotation || 'piece';

    if (rotation === 'timer') {
      const interval = levelConfig.target_change_ms || 5000;
      targetTimerRef.current = setInterval(() => {
        regenerateTargets(levelConfig);
      }, interval);

      return () => {
        clearInterval(targetTimerRef.current);
        targetTimerRef.current = null;
      };
    }
  }, [gameState.phase, gameState.level, levels, regenerateTargets]);

  // ─── Staff Matching: Action Handler ─────────────────────────

  const handleAction = useCallback((actionName) => {
    // Hard drop needs special handling — lock immediately after drop
    if (actionName === 'hardDrop') {
      // Cancel any pending lock delay
      if (lockDelayRef.current) { clearTimeout(lockDelayRef.current); lockDelayRef.current = null; }

      setGameState(prev => {
        if (prev.phase !== 'PLAYING' || !prev.currentPiece) return prev;
        const { piece: dropped, distance } = engineHardDrop(prev.board, prev.currentPiece);
        if (distance === 0) return prev; // already at bottom, let normal lock handle it

        // Lock immediately after hard drop
        const boardAfterLock = lockPiece(prev.board, dropped);
        const { board: boardAfterClear, linesCleared: newLines } = clearLines(boardAfterLock);
        const lineScore = calculateScore(newLines, prev.level) + distance * 2; // bonus for hard drop distance
        const totalScore = prev.score + lineScore;
        const totalLines = prev.linesCleared + newLines;
        const newLevel = Math.floor(totalLines / 10);

        if (newLines > 0) {
          logger.info('tetris.lines-cleared', { lines: newLines, score: lineScore, totalLines, totalScore });
        }
        logger.info('tetris.hard-drop', { type: prev.currentPiece.type, distance });

        const stateForAdvance = {
          ...prev,
          board: boardAfterClear,
          score: totalScore,
          linesCleared: totalLines,
          level: newLevel,
          holdUsed: false,
        };
        const advanced = advanceToNextPiece(stateForAdvance);

        if (advanced.phase === 'GAME_OVER') {
          logger.info('tetris.game-over', { score: totalScore, lines: totalLines, level: newLevel });
          return advanced;
        }

        return { ...advanced, _spawnCount: prev._spawnCount + 1 };
      });
      return;
    }

    // Hold piece
    if (actionName === 'hold') {
      setGameState(prev => {
        if (prev.phase !== 'PLAYING' || !prev.currentPiece) return prev;
        if (prev.holdUsed) return prev; // can only hold once per piece

        const currentType = prev.currentPiece.type;

        if (prev.heldPiece) {
          // Swap: spawn the held piece, store the current one
          const spawned = spawnPiece(prev.board, prev.heldPiece);
          if (!spawned) return prev; // blocked — shouldn't happen but be safe
          logger.info('tetris.hold-swap', { stored: currentType, retrieved: prev.heldPiece });
          return {
            ...prev,
            currentPiece: spawned,
            heldPiece: currentType,
            holdUsed: true,
            _spawnCount: prev._spawnCount + 1,
          };
        } else {
          // No held piece yet — store current, advance to next
          logger.info('tetris.hold-store', { stored: currentType });
          const advanced = advanceToNextPiece(prev);
          if (advanced.phase === 'GAME_OVER') return advanced;
          return {
            ...advanced,
            heldPiece: currentType,
            holdUsed: true,
            _spawnCount: prev._spawnCount + 1,
          };
        }
      });
      return;
    }

    setGameState(prev => {
      if (prev.phase !== 'PLAYING' || !prev.currentPiece) return prev;

      let result = null;

      switch (actionName) {
        case 'moveLeft':
          result = movePiece(prev.board, prev.currentPiece, -1, 0);
          break;
        case 'moveRight':
          result = movePiece(prev.board, prev.currentPiece, 1, 0);
          break;
        case 'rotateCCW':
          result = rotatePiece(prev.board, prev.currentPiece, -1);
          break;
        case 'rotateCW':
          result = rotatePiece(prev.board, prev.currentPiece, 1);
          break;
        default:
          return prev;
      }

      if (!result) return prev; // blocked — no change

      // Cancel pending lock delay — rotation/movement may have changed resting state.
      // Gravity tick will re-evaluate and start a new lock delay if still resting.
      if (lockDelayRef.current) { clearTimeout(lockDelayRef.current); lockDelayRef.current = null; }

      // On successful action with 'match' rotation, regenerate targets
      const levelConfig = levels[prev.level] ?? levels[0];
      if (levelConfig?.target_rotation === 'match') {
        // Schedule target regeneration outside setState
        setTimeout(() => regenerateTargets(levelConfig), 0);
      }

      return { ...prev, currentPiece: result };
    });
  }, [levels, regenerateTargets, advanceToNextPiece, logger]);

  // ─── useStaffMatching integration ───────────────────────────

  const staffEnabled = gameState.phase === 'PLAYING';
  const { matchedActions } = useStaffMatching(activeNotes, targets, handleAction, staffEnabled);

  // ─── Ghost Piece (derived) ──────────────────────────────────

  const ghostPiece = useMemo(() => {
    if (!gameState.currentPiece || gameState.phase !== 'PLAYING') return null;
    return getGhostPosition(gameState.board, gameState.currentPiece);
  }, [gameState.board, gameState.currentPiece, gameState.phase]);

  // ─── Start Game (Countdown) ─────────────────────────────────

  const startGame = useCallback(() => {
    if (gameStateRef.current.phase !== 'IDLE') return;

    clearAllTimers();

    // Initialize fresh game state with bags and first piece ready
    const bag = generateBag();
    const nextBag = generateBag();
    const board = createBoard();

    const currentType = bag.pop();
    const nextType = bag.pop();

    setGameState({
      phase: 'STARTING',
      board,
      currentPiece: null,
      nextPiece: { type: nextType, rotation: 0, x: 8, y: 0 },
      bag,
      nextBag,
      score: 0,
      linesCleared: 0,
      level: 0,
      countdown: 3,
      // Store the first piece type so we can spawn it after countdown
      _pendingType: currentType,
    });

    logger.info('tetris.game-started', {});

    let step = 0;
    countdownRef.current = setInterval(() => {
      step++;
      if (step < COUNTDOWN_STEPS.length) {
        setGameState(prev => ({ ...prev, countdown: COUNTDOWN_STEPS[step] }));
      } else {
        clearInterval(countdownRef.current);
        countdownRef.current = null;

        // Transition to PLAYING — spawn first piece
        setGameState(prev => {
          const type = prev._pendingType;
          const spawned = spawnPiece(prev.board, type);
          const { _pendingType, ...rest } = prev;
          return {
            ...rest,
            phase: 'PLAYING',
            countdown: null,
            currentPiece: spawned,
            _spawnCount: 1,
          };
        });
      }
    }, COUNTDOWN_STEP_MS);
  }, [clearAllTimers, logger]);

  // ─── Generate initial targets when PLAYING starts ───────────

  const prevPhaseRef = useRef(gameState.phase);
  useEffect(() => {
    if (prevPhaseRef.current !== 'PLAYING' && gameState.phase === 'PLAYING') {
      const levelConfig = levels[gameState.level] ?? levels[0];
      if (levelConfig) {
        regenerateTargets(levelConfig);
      }
    }
    prevPhaseRef.current = gameState.phase;
  }, [gameState.phase, gameState.level, levels, regenerateTargets]);

  // ─── Game Over Auto-Dismiss ─────────────────────────────────

  useEffect(() => {
    if (gameState.phase !== 'GAME_OVER') return;

    // Clear gameplay timers
    if (gravityRef.current) { clearInterval(gravityRef.current); gravityRef.current = null; }
    if (lockDelayRef.current) { clearTimeout(lockDelayRef.current); lockDelayRef.current = null; }
    if (targetTimerRef.current) { clearInterval(targetTimerRef.current); targetTimerRef.current = null; }

    gameOverRef.current = setTimeout(() => {
      gameOverRef.current = null;
      logger.info('tetris.game-dismissed', { score: gameStateRef.current.score, lines: gameStateRef.current.linesCleared });
      setGameState(createInitialGameState());
      setTargets(null);
      lastSpawnCountRef.current = 0;
    }, GAME_OVER_DISPLAY_MS);

    return () => {
      if (gameOverRef.current) { clearTimeout(gameOverRef.current); gameOverRef.current = null; }
    };
  }, [gameState.phase, logger]);

  // ─── Deactivate (manual exit) ───────────────────────────────

  const deactivate = useCallback(() => {
    clearAllTimers();
    setGameState(createInitialGameState());
    setTargets(null);
    lastSpawnCountRef.current = 0;
    logger.info('tetris.game-deactivated', {});
  }, [clearAllTimers, logger]);

  // ─── Cleanup on Unmount ─────────────────────────────────────

  useEffect(() => clearAllTimers, [clearAllTimers]);

  // ─── Return ─────────────────────────────────────────────────

  return {
    phase: gameState.phase,
    board: gameState.board,
    currentPiece: gameState.currentPiece,
    ghostPiece,
    nextPiece: gameState.nextPiece,
    heldPiece: gameState.heldPiece,
    holdUsed: gameState.holdUsed,
    score: gameState.score,
    linesCleared: gameState.linesCleared,
    level: gameState.level,
    countdown: gameState.countdown,
    spawnCount: gameState._spawnCount,
    targets,
    matchedActions,
    startGame,
    deactivate,
  };
}

export default useTetrisGame;
