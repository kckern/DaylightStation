import React from 'react';
import PropTypes from 'prop-types';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import './RaceResults.scss';

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * Race results board: standings rows in placement order. For a distance race
 * the headline metric is finish time; for a time race it's distance. DNF riders
 * are flagged. (Count-up animation is layered via CSS/caller; values shown final.)
 */
export default function RaceResults({ standings = [], riders = {}, winCondition = 'distance', dnf = [] }) {
  const dnfSet = new Set(dnf);
  return (
    <div className="race-results" data-testid="race-results">
      <h2 className="race-results__title">Results</h2>
      <ol className="race-results__list">
        {standings.map((s) => {
          const name = riders[s.userId]?.displayName || s.userId;
          const isDnf = dnfSet.has(s.userId);
          const metric = isDnf
            ? 'DNF'
            : winCondition === 'distance'
              ? fmtTime(s.finishTimeS)
              : formatDistance(s.distanceM);
          return (
            <li key={s.userId} className="race-results__row" data-testid="result-row" data-testid-row={s.userId}>
              <span className="race-results__place" data-testid={`result-row-${s.userId}`}>
                <span className="race-results__placement">{s.placement}</span>
                <span className="race-results__name">{name}</span>
                <span className={`race-results__metric${isDnf ? ' race-results__metric--dnf' : ''}`}>{metric}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

RaceResults.propTypes = {
  standings: PropTypes.array,
  riders: PropTypes.object,
  winCondition: PropTypes.string,
  dnf: PropTypes.array
};
