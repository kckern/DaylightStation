import { useMemo, useState, useEffect, useRef } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { ActionStaff } from '../components/ActionStaff.jsx';
import { useFlashcardGame } from './useFlashcardGame.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import { AttemptHistory } from './components/AttemptHistory.jsx';
import { ChordCard } from './components/ChordCard.jsx';
import { LevelPicker } from './components/LevelPicker.jsx';
import { computeKeyboardRange } from '../noteUtils.js';
import { rootPositionVoicing } from './flashcardEngine.js';
import './PianoFlashcards.scss';

// Chord-spelling levels have no note_range (any octave counts) — show C3–C6.
const CHORD_LEVEL_RANGE = [48, 84];

/**
 * Piano Flashcards — untimed note-reading trainer.
 *
 * @param {Object} props
 * @param {Map} props.activeNotes - live MIDI note state
 * @param {Object} props.gameConfig - games.flashcards from piano.yml
 * @param {function} props.onDeactivate - called to exit the game
 * @param {string|null} [props.currentUser] - kiosk user id, for user_start_levels
 */
export function PianoFlashcards({ activeNotes, gameConfig, onDeactivate, onNoteOn, onNoteOff, currentUser = null }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-flashcards' }), []);

  const game = useFlashcardGame(activeNotes, gameConfig, currentUser);
  useAutoGameLifecycle(game.phase, game.startGame, onDeactivate, logger, 'flashcards');

  const [pickerOpen, setPickerOpen] = useState(false);
  const levels = gameConfig?.levels ?? [];

  // A previously picked level (saved per-user preference) overrides the
  // configured start — applied once, and only while the game is still fresh.
  const prefAppliedRef = useRef(false);
  useEffect(() => {
    if (!currentUser || prefAppliedRef.current) return undefined;
    let cancelled = false;
    DaylightAPI(`api/v1/piano/users/${currentUser}/preferences`)
      .then((prefs) => {
        if (cancelled || prefAppliedRef.current) return;
        prefAppliedRef.current = true;
        const name = prefs?.flashcardsLevel;
        if (!name) return;
        const idx = levels.findIndex(l => l?.name === name);
        if (idx >= 0 && idx !== game.level && game.score === 0 && game.attempts.length === 0) {
          logger.info('flashcards.pref-level-applied', { user: currentUser, level: name });
          game.selectLevel(idx);
        }
      })
      .catch(() => { prefAppliedRef.current = true; });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps — one-shot pref load
  }, [currentUser]);

  const handleLevelSelect = (idx) => {
    setPickerOpen(false);
    if (idx === game.level) return;
    game.selectLevel(idx);
    prefAppliedRef.current = true;
    if (currentUser && levels[idx]?.name) {
      DaylightAPI(
        `api/v1/piano/users/${currentUser}/preferences`,
        { flashcardsLevel: levels[idx].name },
        'PUT',
      ).catch((e) => logger.warn('flashcards.pref-save-fail', { error: e?.message }));
    }
  };

  const isChordLevel = game.levelConfig?.card_type === 'chord';

  // Keyboard range from current level config
  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(
      game.levelConfig?.note_range ?? (isChordLevel ? CHORD_LEVEL_RANGE : null)
    ),
    [game.levelConfig, isChordLevel]
  );

  // Target pitches for keyboard highlighting (only show after correct answer).
  // Chord cards have no fixed pitches — show a root-position voicing near C4.
  const targetNotes = useMemo(() => {
    if (!game.currentCard || game.cardStatus !== 'hit') return null;
    if (game.currentCard.type === 'chord') {
      return new Set(rootPositionVoicing(game.currentCard));
    }
    return game.currentCard.pitches ? new Set(game.currentCard.pitches) : null;
  }, [game.currentCard, game.cardStatus]);

  // Wrong notes for keyboard flash
  const wrongNotes = useMemo(() => {
    if (game.cardStatus !== 'miss' || !activeNotes || !game.currentCard) return null;
    const wrong = new Set();
    if (game.currentCard.type === 'chord') {
      let bass = null;
      for (const [note] of activeNotes) {
        if (!game.currentCard.pitchClasses.has(((note % 12) + 12) % 12)) wrong.add(note);
        if (bass === null || note < bass) bass = note;
      }
      // Complete chord over the wrong bass (Cm/Eb): no non-chord-tone to flash,
      // so flash the offending bass note itself.
      if (wrong.size === 0 && bass !== null) wrong.add(bass);
    } else {
      const targetSet = new Set(game.currentCard.pitches);
      for (const [note] of activeNotes) {
        if (!targetSet.has(note)) wrong.add(note);
      }
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
          <button
            type="button"
            className="piano-flashcards__level piano-flashcards__level--button"
            onClick={() => setPickerOpen(true)}
          >
            <div className="piano-flashcards__level-num">Level {game.level + 1}</div>
            <div className="piano-flashcards__level-name">{levelLabel}</div>
          </button>
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
              {game.currentCard.type === 'chord' ? (
                <ChordCard card={game.currentCard} activeNotes={activeNotes} />
              ) : (
                <ActionStaff
                  targetPitches={game.currentCard.pitches}
                  matched={game.cardStatus === 'hit'}
                  activeNotes={activeNotes}
                />
              )}
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

      {pickerOpen && (
        <LevelPicker
          levels={levels}
          currentLevel={game.level}
          onSelect={handleLevelSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="piano-flashcards__keyboard">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={targetNotes}
          wrongNotes={wrongNotes}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
        />
      </div>
    </div>
  );
}

export default PianoFlashcards;
