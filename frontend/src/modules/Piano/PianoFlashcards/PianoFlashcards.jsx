import { useMemo } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { ActionStaff } from '../components/ActionStaff.jsx';
import { useFlashcardGame } from './useFlashcardGame.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import { AttemptHistory } from './components/AttemptHistory.jsx';
import { computeKeyboardRange } from '../noteUtils.js';
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
  useAutoGameLifecycle(game.phase, game.startGame, onDeactivate, logger, 'flashcards');

  // Keyboard range from current level config
  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(game.levelConfig?.note_range ?? null),
    [game.levelConfig]
  );

  // Target pitches for keyboard highlighting (only show after correct answer)
  const targetNotes = useMemo(() => {
    if (!game.currentCard?.pitches || game.cardStatus !== 'hit') return null;
    return new Set(game.currentCard.pitches);
  }, [game.currentCard, game.cardStatus]);

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
