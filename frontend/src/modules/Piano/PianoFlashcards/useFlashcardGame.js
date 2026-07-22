import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import {
  generateCardPitches,
  evaluateMatch,
  generateChordCard,
  evaluateChordMatch,
  resolveStartLevel,
} from './flashcardEngine.js';

const CARD_ADVANCE_DELAY_MS = 400;
const COMPLETE_DISPLAY_MS = 5000;

function createInitialState(startLevel = 0) {
  return {
    phase: 'IDLE',       // IDLE | PLAYING | COMPLETE
    level: startLevel,
    score: 0,
    currentCard: null,   // { pitches: number[] }
    cardStatus: null,    // null | 'hit' | 'miss'
    cardFailed: false,   // true if missed on current card (no points even if corrected)
    attempts: [],        // [{ hit: boolean }] rolling history
  };
}

/**
 * Flashcard game state machine.
 *
 * @param {Map} activeNotes - from useMidiSubscription
 * @param {Object} flashcardsConfig - games.flashcards from piano.yml
 * @param {string|null} [currentUser] - kiosk user id, for user_start_levels
 * @returns game state + controls
 */
export function useFlashcardGame(activeNotes, flashcardsConfig, currentUser = null) {
  const logger = useMemo(() => getChildLogger({ component: 'flashcard-game' }), []);
  const advanceTimerRef = useRef(null);
  const completeTimerRef = useRef(null);
  const lastCardRef = useRef(null);

  const levels = flashcardsConfig?.levels ?? [];
  const startLevel = resolveStartLevel(levels, flashcardsConfig?.user_start_levels, currentUser);
  const [state, setState] = useState(() => createInitialState(startLevel));
  const levelConfig = levels[state.level] ?? null;
  const scorePerCard = flashcardsConfig?.score_per_card ?? 10;
  const scoreNeeded = levelConfig?.score_to_advance ?? 100;

  // ─── Generate a new card ──────────────────────────────────────
  const nextCard = useCallback(() => {
    if (!levelConfig) return;
    let card;
    if (levelConfig.card_type === 'chord') {
      card = generateChordCard(levelConfig.qualities, lastCardRef.current);
    } else {
      card = {
        pitches: generateCardPitches(
          levelConfig.note_range,
          levelConfig.complexity,
          levelConfig.white_keys_only,
        ),
      };
    }
    lastCardRef.current = card;
    setState(prev => ({
      ...prev,
      currentCard: card,
      cardStatus: null,
      cardFailed: false,
    }));
  }, [levelConfig]);

  // ─── Chord match evaluation ───────────────────────────────────
  useEffect(() => {
    if (state.phase !== 'PLAYING' || !state.currentCard) return;
    if (state.cardStatus === 'hit') return; // already matched, waiting for advance

    const card = state.currentCard;
    const result = card.type === 'chord'
      ? evaluateChordMatch(activeNotes, card)
      : evaluateMatch(activeNotes, card.pitches);
    const cardInfo = card.type === 'chord' ? { chord: card.label } : { pitches: card.pitches };

    if (result === 'correct' && !state.cardFailed) {
      // First-try correct — award points
      logger.debug('flashcards.card-hit', { ...cardInfo, firstTry: true });
      setState(prev => ({
        ...prev,
        cardStatus: 'hit',
        score: prev.score + scorePerCard,
        attempts: [...prev.attempts, { hit: true }],
      }));
    } else if (result === 'correct' && state.cardFailed) {
      // Correct after a miss — no points, but advance
      logger.debug('flashcards.card-hit', { ...cardInfo, firstTry: false });
      setState(prev => ({
        ...prev,
        cardStatus: 'hit',
        attempts: [...prev.attempts, { hit: false }],
      }));
    } else if (result === 'wrong') {
      logger.debug('flashcards.card-miss', cardInfo);
      setState(prev => ({
        ...prev,
        cardStatus: 'miss',
        cardFailed: true,
      }));
    }
    // 'partial' and 'idle' — no state change, player is still working
  }, [activeNotes, state.phase, state.currentCard, state.cardFailed, state.cardStatus, scorePerCard, logger]);

  // ─── Clear miss status when all notes released ────────────────
  useEffect(() => {
    if (state.cardStatus !== 'miss') return;
    if (!activeNotes || activeNotes.size === 0) {
      setState(prev => ({ ...prev, cardStatus: null }));
    }
  }, [activeNotes, state.cardStatus]);

  // ─── Advance to next card after hit ───────────────────────────
  useEffect(() => {
    if (state.cardStatus !== 'hit') return;

    advanceTimerRef.current = setTimeout(() => {
      setState(prev => {
        const newScore = prev.score;
        const threshold = levels[prev.level]?.score_to_advance ?? 100;

        // Level up?
        if (newScore >= threshold) {
          const nextLevel = prev.level + 1;
          if (nextLevel >= levels.length) {
            // All levels complete
            return { ...prev, phase: 'COMPLETE', currentCard: null, cardStatus: null };
          }
          return { ...prev, level: nextLevel, score: 0, currentCard: null, cardStatus: null };
        }

        return { ...prev, currentCard: null, cardStatus: null };
      });
    }, CARD_ADVANCE_DELAY_MS);

    return () => clearTimeout(advanceTimerRef.current);
  }, [state.cardStatus, levels]);

  // ─── Generate card when currentCard is null during PLAYING ────
  useEffect(() => {
    if (state.phase === 'PLAYING' && !state.currentCard) {
      nextCard();
    }
  }, [state.phase, state.currentCard, nextCard]);

  // ─── Auto-dismiss COMPLETE after delay ────────────────────────
  useEffect(() => {
    if (state.phase !== 'COMPLETE') return;

    completeTimerRef.current = setTimeout(() => {
      setState(createInitialState(startLevel));
    }, COMPLETE_DISPLAY_MS);

    return () => clearTimeout(completeTimerRef.current);
  }, [state.phase, startLevel]);

  // ─── Log phase transitions ──────────────────────────────────
  useEffect(() => {
    if (state.phase === 'COMPLETE') {
      logger.info('flashcards.game-complete', { finalScore: state.score, level: state.level });
    }
  }, [state.phase, state.score, state.level, logger]);

  // ─── Log level advances ─────────────────────────────────────
  const prevLevelRef = useRef(state.level);
  useEffect(() => {
    if (state.level !== prevLevelRef.current) {
      logger.info('flashcards.level-advance', { from: prevLevelRef.current, to: state.level });
      prevLevelRef.current = state.level;
    }
  }, [state.level, logger]);

  // ─── Controls ─────────────────────────────────────────────────
  const startGame = useCallback(() => {
    logger.info('flashcards.game-started', { startLevel });
    setState({ ...createInitialState(startLevel), phase: 'PLAYING' });
  }, [logger, startLevel]);

  const deactivate = useCallback(() => {
    clearTimeout(advanceTimerRef.current);
    clearTimeout(completeTimerRef.current);
    logger.info('flashcards.game-deactivated', {});
    setState(createInitialState(startLevel));
  }, [logger, startLevel]);

  // ─── Derived values ───────────────────────────────────────────
  const accuracy = useMemo(() => {
    const recent = state.attempts.slice(-20);
    if (recent.length === 0) return 0;
    return Math.round((recent.filter(a => a.hit).length / recent.length) * 100);
  }, [state.attempts]);

  return {
    phase: state.phase,
    level: state.level,
    score: state.score,
    scoreNeeded,
    levelConfig,
    currentCard: state.currentCard,
    cardStatus: state.cardStatus,
    attempts: state.attempts,
    accuracy,
    startGame,
    deactivate,
  };
}
