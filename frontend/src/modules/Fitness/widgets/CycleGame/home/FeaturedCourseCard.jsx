import React from 'react';
import PropTypes from 'prop-types';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { daysLeft } from '@/modules/Fitness/lib/cycleGame/ladder.js';
import { AVATAR_BASE, FALLBACK_AVATAR } from './constants.js';
import { RaceFlagIcon } from './icons.jsx';
import { uiLog } from './uiLog.js';
import './FeaturedCourseCard.scss';

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const total = Math.round(s); // round total first — else 119.6 → "1:60"
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * "This Week's Course" — the weekly time-trial ladder. Standings are the
 * household's best attempts this week on the featured course; Ride It starts
 * the course with a rival ghost pre-armed (handled by the container).
 */
export default function FeaturedCourseCard({ ladder = null, onRide = null, resolveName = (id) => id }) {
  if (!ladder?.course) return null;
  const { course, week, standings = [], allTimeRecord = null } = ladder;
  const fmtVal = course.win_condition === 'distance' ? fmtTime : formatDistance;
  const remaining = daysLeft(week?.end);

  return (
    <section className="cgh-featured" data-testid="featured-course-card">
      <div className="cgh-featured__head">
        <div>
          <div className="cgh-section-label cgh-section-label--sub">This week&rsquo;s course</div>
          <h3 className="cgh-featured__title">{course.label || course.id}</h3>
        </div>
        <span className="cgh-featured__ends">{remaining > 0 ? `Ends in ${remaining}d` : 'Final day'}</span>
      </div>

      {standings.length === 0 ? (
        <div className="cgh-empty">No rides yet this week — set the first time.</div>
      ) : (
        <ol className="cgh-featured__rows">
          {/* Rail real estate is scarce: top 3 rungs only, one-line overflow. */}
          {standings.slice(0, 3).map((row, i) => (
            <li key={row.userId} className="cgh-featured__row" data-testid={`featured-row-${row.userId}`}>
              <span className="cgh-featured__rank">{i + 1}</span>
              <img
                className="cgh-featured__avatar"
                src={`${AVATAR_BASE}/${row.userId}`}
                onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
                alt=""
              />
              <span className="cgh-featured__name">{resolveName(row.userId)}</span>
              <span className="cgh-featured__value">{fmtVal(row.bestValue)}</span>
            </li>
          ))}
          {standings.length > 3 && (
            <li className="cgh-featured__more" data-testid="featured-more">
              +{standings.length - 3} more this week
            </li>
          )}
        </ol>
      )}

      {allTimeRecord && (
        <div className="cgh-featured__record">
          Record: {fmtVal(allTimeRecord.bestValue)} · {resolveName(allTimeRecord.userId)}
        </div>
      )}

      <button
        type="button"
        className="cgh-featured__ride"
        data-testid="featured-ride"
        onClick={() => { uiLog().info('cycle_game.ui.ride_featured', { courseId: course.id }); onRide?.(); }}
      >
        <RaceFlagIcon />
        <span>Ride it</span>
      </button>
    </section>
  );
}

FeaturedCourseCard.propTypes = {
  ladder: PropTypes.shape({
    course: PropTypes.shape({
      id: PropTypes.string,
      label: PropTypes.string,
      win_condition: PropTypes.string
    }),
    week: PropTypes.shape({
      start: PropTypes.string,
      end: PropTypes.string
    }),
    standings: PropTypes.arrayOf(PropTypes.shape({
      userId: PropTypes.string,
      bestValue: PropTypes.number,
      raceId: PropTypes.string,
      attempts: PropTypes.number
    })),
    allTimeRecord: PropTypes.shape({
      userId: PropTypes.string,
      bestValue: PropTypes.number,
      raceId: PropTypes.string,
      date: PropTypes.string
    })
  }),
  onRide: PropTypes.func,
  resolveName: PropTypes.func
};
