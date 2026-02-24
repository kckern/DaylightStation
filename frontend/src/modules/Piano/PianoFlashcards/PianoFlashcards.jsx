import { useMemo, useEffect } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { ActionStaff } from '../components/ActionStaff.jsx';
import { useFlashcardGame } from './useFlashcardGame.js';
import { AttemptHistory } from './components/AttemptHistory.jsx';
import './PianoFlashcards.scss';

/**
 * Piano Flashcards — untimed note-reading trainer.
 *
 * @param {Object} props
 * @param {Map} props.activeNotes - live MIDI note state
 * @param {Object} props.flashcardsConfig - games.flashcards from piano.yml
 * @param {function} props.onDeactivate - called to exit the game
 */
export function PianoFlashcards({ activeNotes, flashcardsConfig, onDeactivate }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-flashcards' }), []);

  const game = useFlashcardGame(activeNotes, flashcardsConfig);

  // Auto-start on mount
  useEffect(() => {
    if (game.phase === 'IDLE') {
      logger.info('flashcards.auto-start', {});
      game.startGame();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentional mount-only

  // Auto-deactivate when game returns to IDLE after COMPLETE
  const phaseRef = useMemo(() => ({ prev: game.phase }), []);
  useEffect(() => {
    if (phaseRef.prev === 'COMPLETE' && game.phase === 'IDLE') {
      logger.info('flashcards.auto-deactivate', {});
      onDeactivate?.();
    }
    phaseRef.prev = game.phase;
  }, [game.phase, onDeactivate, logger]);

  // Keyboard range from current level config
  const { startNote, endNote } = useMemo(() => {
    const range = game.levelConfig?.note_range;
    if (!range) return { startNote: 48, endNote: 84 };
    const span = range[1] - range[0];
    const pad = Math.max(Math.round(span / 3), 6);
    const rawStart = range[0] - pad;
    const rawEnd = range[1] + pad;
    // Ensure at least 2 octaves
    const minSpan = 24;
    const actualSpan = rawEnd - rawStart;
    if (actualSpan < minSpan) {
      const extra = Math.ceil((minSpan - actualSpan) / 2);
      return { startNote: Math.max(21, rawStart - extra), endNote: Math.min(108, rawEnd + extra) };
    }
    return { startNote: Math.max(21, rawStart), endNote: Math.min(108, rawEnd) };
  }, [game.levelConfig]);

  // Target pitches for keyboard highlighting
  const targetNotes = useMemo(() => {
    if (!game.currentCard?.pitches) return null;
    return new Set(game.currentCard.pitches);
  }, [game.currentCard]);

  // Wrong notes for keyboard flash
  const wrongNotes = useMemo(() => {
    if (game.cardStatus !== 'miss' || !activeNotes || !game.currentCard) return null;
    const targetSet = new Set(game.currentCard.pitches);
    const wrong = new Set();
    for (const [note] of activeNotes) {
      if (!targetSet.has(note)) wrong.add(note);
    }
    return wrong.size > 0 ? wrong : null;
  }, [game.cardStatus, activeNotes, game.currentCard]);

  // Level label
  const levelLabel = game.levelConfig?.name ?? `Level ${game.level}`;

  // Progress percentage
  const progressPct = game.scoreNeeded > 0
    ? Math.min(100, (game.score / game.scoreNeeded) * 100)
    : 0;

  return (
    <div className="piano-flashcards">
      <div className="piano-flashcards__play-area">
        {/* Left column: level info + score */}
        <div className="piano-flashcards__stats-left">
          <div className="piano-flashcards__level">
            <div className="piano-flashcards__level-num">Level {game.level + 1}</div>
            <div className="piano-flashcards__level-name">{levelLabel}</div>
          </div>
          <div className="piano-flashcards__score-block">
            <div className="piano-flashcards__score-value">{game.score}</div>
            <div className="piano-flashcards__score-label">/ {game.scoreNeeded}</div>
          </div>
          <div className="piano-flashcards__progress">
            <div
              className="piano-flashcards__progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Center: flashcard */}
        <div className="piano-flashcards__card-area">
          {game.currentCard && (
            <div className={[
              'piano-flashcards__card',
              game.cardStatus === 'hit' && 'piano-flashcards__card--hit',
              game.cardStatus === 'miss' && 'piano-flashcards__card--miss',
            ].filter(Boolean).join(' ')}>
              <ActionStaff
                targetPitches={game.currentCard.pitches}
                matched={game.cardStatus === 'hit'}
                activeNotes={activeNotes}
              />
            </div>
          )}

          {game.phase === 'COMPLETE' && (
            <div className="piano-flashcards__complete">
              <div className="piano-flashcards__complete-title">Training Complete!</div>
              <div className="piano-flashcards__complete-stat">{game.accuracy}% accuracy</div>
            </div>
          )}
        </div>

        {/* Right column: attempt history */}
        <div className="piano-flashcards__stats-right">
          <AttemptHistory attempts={game.attempts} accuracy={game.accuracy} />
        </div>
      </div>

      <div className="piano-flashcards__keyboard">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={targetNotes}
          wrongNotes={wrongNotes}
        />
      </div>
    </div>
  );
}

export default PianoFlashcards;
