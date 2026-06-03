import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import './RaceResults.scss';

const AVATAR_BASE = '/api/v1/static/img/users';
const FALLBACK_AVATAR = `${AVATAR_BASE}/user`;
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * Race results board — a podium reveal. Rows in placement order with medal
 * accents; the winner is spotlit with a crown. Distance races headline finish
 * time; time races headline distance. DNF (idled out) and DQ (over-max RPM
 * abuse) riders are flagged. Rows reveal with a staggered animation.
 */
export default function RaceResults({ standings = [], riders = {}, winCondition = 'distance', dnf = [], dq = [] }) {
  const dnfSet = new Set(dnf);
  const dqSet = new Set(dq);
  return (
    <div className="race-results" data-testid="race-results">
      <div className="race-results__eyebrow">Finish</div>
      <h2 className="race-results__title">Results</h2>
      <ol className="race-results__list">
        {standings.map((s, i) => {
          const name = riders[s.userId]?.displayName || s.userId;
          const isDq = dqSet.has(s.userId);
          const isDnf = !isDq && dnfSet.has(s.userId);
          const flagged = isDq || isDnf;
          const metric = isDq
            ? 'DQ'
            : isDnf
              ? 'DNF'
              : winCondition === 'distance'
                ? fmtTime(s.finishTimeS)
                : formatDistance(s.distanceM);
          const rider = riders[s.userId] || {};
          // Ghost ids are `ghost:<raceId>:<sourceUserId>` — resolve to the real face.
          const isGhost = !!rider.isGhost || String(s.userId).startsWith('ghost:');
          const sourceId = isGhost ? String(s.userId).split(':')[2] || s.userId : s.userId;
          const avatarSrc = rider.avatarSrc || `${AVATAR_BASE}/${sourceId}`;
          const medalClass = s.placement <= 3 ? ` race-results__row--p${s.placement}` : '';
          const isWinner = s.placement === 1 && !flagged;
          return (
            <li
              key={s.userId}
              className={`race-results__row${medalClass}${isWinner ? ' is-winner' : ''}`}
              data-testid="result-row"
              data-testid-row={s.userId}
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="race-results__place" data-testid={`result-row-${s.userId}`}>
                <span className="race-results__placement">
                  {MEDALS[s.placement] || s.placement}
                </span>
                <span className={`race-results__avatar${isGhost ? ' cg-ghost' : ''}`}>
                  <CircularUserAvatar
                    name={name}
                    avatarSrc={avatarSrc}
                    fallbackSrc={FALLBACK_AVATAR}
                    size={isWinner ? 64 : 50}
                    showGauge={false}
                    showIndicator={false}
                  />
                </span>
                <span className="race-results__name">
                  {name}
                  {isWinner && <span className="race-results__crown" aria-hidden="true">👑</span>}
                </span>
                <span className={`race-results__metric${flagged ? ' race-results__metric--dnf' : ''}`}>{metric}</span>
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
  dnf: PropTypes.array,
  dq: PropTypes.array
};
