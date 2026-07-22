/**
 * LevelPicker — modal list of all flashcard levels; tap to jump anywhere.
 * Opened from the level block in the stats column.
 */
export function LevelPicker({ levels, currentLevel, onSelect, onClose }) {
  return (
    <div className="piano-flashcards__picker-backdrop" onClick={onClose}>
      <div
        className="piano-flashcards__picker"
        role="dialog"
        aria-label="Choose level"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="piano-flashcards__picker-title">Choose Level</div>
        <ul className="piano-flashcards__picker-list">
          {levels.map((level, i) => (
            <li key={level?.name ?? i}>
              <button
                type="button"
                className={[
                  'piano-flashcards__picker-item',
                  i === currentLevel && 'piano-flashcards__picker-item--active',
                ].filter(Boolean).join(' ')}
                onClick={() => onSelect(i)}
              >
                <span className="piano-flashcards__picker-num">{i + 1}</span>
                <span className="piano-flashcards__picker-name">{level?.name ?? `Level ${i + 1}`}</span>
                <span className="piano-flashcards__picker-kind">
                  {level?.card_type === 'chord' ? 'Chords' : 'Notes'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default LevelPicker;
