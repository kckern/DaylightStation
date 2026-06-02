import React from 'react';
import PropTypes from 'prop-types';
import './CycleGameHome.scss';

/**
 * Cycle-game home (the `idle` lifecycle state). One screen: course picker +
 * custom-race entry, the auto-detected rider lineup, and a Records panel.
 * Prop-driven; the container supplies data + handlers.
 */
export default function CycleGameHome({ courses = [], riders = [], records = [], onSelectCourse, onCustom }) {
  return (
    <div className="cycle-game-home" data-testid="cycle-game-home">
      <div className="cycle-game-home__main">
        <h2 className="cycle-game-home__title">🚴 Cycle Game</h2>

        <div className="cycle-game-home__section">
          <div className="cycle-game-home__label">Courses</div>
          <div className="cycle-game-home__courses">
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                className="cycle-game-home__course"
                data-testid={`course-${c.id}`}
                onClick={() => onSelectCourse?.(c)}
              >
                {c.name}
              </button>
            ))}
            <button type="button" className="cycle-game-home__course cycle-game-home__course--custom" data-testid="course-custom" onClick={() => onCustom?.()}>
              + Custom race
            </button>
          </div>
        </div>

        <div className="cycle-game-home__section">
          <div className="cycle-game-home__label">Riders</div>
          <div className="cycle-game-home__riders">
            {riders.map((r) => (
              <div key={r.userId} className={`cycle-game-home__rider${r.live ? ' is-live' : ''}`}>
                <span className="cycle-game-home__rider-name">{r.displayName}</span>
                <span className="cycle-game-home__rider-status">{r.live ? '🟢' : 'idle'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="cycle-game-home__records">
        <div className="cycle-game-home__label">High scores</div>
        {records.length === 0 && <div className="cycle-game-home__empty">No races yet</div>}
        {records.map((rec, i) => (
          <div key={`${rec.courseId}-${rec.userId}-${i}`} className="cycle-game-home__record">{rec.label}</div>
        ))}
      </aside>
    </div>
  );
}

CycleGameHome.propTypes = {
  courses: PropTypes.array,
  riders: PropTypes.array,
  records: PropTypes.array,
  onSelectCourse: PropTypes.func,
  onCustom: PropTypes.func
};
