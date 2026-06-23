import { useMemo } from 'react';
import getLogger from '../../../../../../lib/logging/Logger.js';
import { LESSON_TYPES } from './lessonTypes.js';

/**
 * TheoryLessons — catalog screen for the tonal-backed music-theory lessons.
 *
 * SKELETON: lists the four lesson types and surfaces selection, but the
 * individual lesson runners are not implemented yet. The grading engine
 * (theoryEngine.js) and catalog (lessonTypes.js) are wired and tested so the
 * runners can be filled in without restructuring.
 *
 * @param {(lessonTypeId: string) => void} [onSelect]
 */
export function TheoryLessons({ onSelect }) {
  const logger = useMemo(
    () => getLogger().child({ component: 'piano-theory-lessons' }),
    [],
  );

  const handleSelect = (id) => {
    logger.info('theory.select', { lessonType: id });
    onSelect?.(id);
  };

  return (
    <div className="piano-theory-lessons">
      <h2 className="piano-theory-lessons__title">Music Theory</h2>
      <ul className="piano-theory-lessons__list">
        {LESSON_TYPES.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="piano-theory-lessons__tile"
              onClick={() => handleSelect(t.id)}
              data-status={t.status}
            >
              <span className="piano-theory-lessons__tile-label">{t.label}</span>
              <span className="piano-theory-lessons__tile-blurb">{t.blurb}</span>
              {t.status === 'skeleton' && (
                <span className="piano-theory-lessons__tile-badge">Coming soon</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default TheoryLessons;
