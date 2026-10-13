import { useEffect, useRef } from 'react';
import Icon from '../../ui/icons/Icon.jsx';

/**
 * LevelPicker — modal list of all flashcard levels; tap to jump anywhere.
 * Opened from the level block in the stats column.
 */
export function LevelPicker({ levels, currentLevel, onSelect, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus?.();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="piano-flashcards__picker-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="piano-flashcards__picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose level"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="piano-flashcards__picker-title">Choose level</h2>
        <button
          type="button"
          className="piano-flashcards__picker-close"
          aria-label="Close level picker"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        <ul className="piano-flashcards__picker-list">
          {levels.map((level, i) => (
            <li key={level?.name ?? i}>
              <button
                type="button"
                className={[
                  'piano-flashcards__picker-item',
                  i === currentLevel && 'piano-flashcards__picker-item--active',
                ].filter(Boolean).join(' ')}
                aria-current={i === currentLevel ? 'true' : undefined}
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
