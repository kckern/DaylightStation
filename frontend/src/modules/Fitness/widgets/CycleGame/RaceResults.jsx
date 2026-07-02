import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import resolveParticipantIdentity from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
import SplitsChart from './panels/SplitsChart.jsx';
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

// Count a number up from 0 to target with an ease-out, unless the user prefers
// reduced motion (also true in jsdom, where matchMedia is absent — so tests read
// the final value synchronously).
function useCountUp(target, active, durationMs = 950) {
  const reduce = typeof window === 'undefined' || !window.matchMedia
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = active && !reduce && Number.isFinite(target);
  const [val, setVal] = useState(on ? 0 : target);
  useEffect(() => {
    if (!on) { setVal(target); return undefined; }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / durationMs);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [target, on, durationMs]);
  return val;
}

// One finishing-order row — slides into place (CSS) with its metric ticking up.
function ResultRow({ s, riders, winCondition, dnfSet, penalizedSet, index, animate }) {
  const name = riders[s.userId]?.displayName || s.userId;
  const isDnf = dnfSet.has(s.userId);
  const isPenalized = penalizedSet.has(s.userId);
  const isWinner = s.placement === 1 && !isDnf;
  const rider = riders[s.userId] || {};
  const isGhost = !!rider.isGhost || String(s.userId).startsWith('ghost:');
  const sourceId = isGhost ? resolveParticipantIdentity(String(s.userId)).sourceId : s.userId;
  const avatarSrc = rider.avatarSrc || `${AVATAR_BASE}/${sourceId}`;
  const medalClass = s.placement <= 3 ? ` race-results__row--p${s.placement}` : '';

  const counted = useCountUp(isDnf ? NaN : (winCondition === 'distance' ? s.finishTimeS : s.distanceM), animate);
  const metric = isDnf
    ? 'DNF'
    : winCondition === 'distance' ? fmtTime(counted) : formatDistance(counted);

  return (
    <li
      className={`race-results__row${medalClass}${isWinner ? ' is-winner' : ''}`}
      data-testid="result-row"
      data-testid-row={s.userId}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span className="race-results__place" data-testid={`result-row-${s.userId}`}>
        <span className="race-results__placement">{MEDALS[s.placement] || s.placement}</span>
        <span className={`race-results__avatar${isGhost ? ' cg-ghost' : ''}`}>
          <CircularUserAvatar name={name} avatarSrc={avatarSrc} fallbackSrc={FALLBACK_AVATAR}
            size={isWinner ? 64 : 50} showGauge={false} showIndicator={false} />
        </span>
        <span className="race-results__name">
          {name}
          {isWinner && <span className="race-results__crown" aria-hidden="true">👑</span>}
          {isPenalized && (
            <span className="race-results__penalty" title="False start penalty" aria-label="false start penalty">⏱️</span>
          )}
        </span>
        <span className={`race-results__metric${isDnf ? ' race-results__metric--dnf' : ''}`}>{metric}</span>
      </span>
    </li>
  );
}
ResultRow.propTypes = {
  s: PropTypes.object.isRequired, riders: PropTypes.object.isRequired,
  winCondition: PropTypes.string, dnfSet: PropTypes.instanceOf(Set), penalizedSet: PropTypes.instanceOf(Set),
  index: PropTypes.number, animate: PropTypes.bool
};

/**
 * Race results board — a Mario-Kart-style finish: rows slide into their finishing
 * order while each metric ticks up to its final value, the winner spotlit with a
 * crown. When laps were completed, the lap-by-lap splits table reviews the race
 * below the podium (skipped for short races that never finish a lap). A
 * config-driven dwell auto-returns to the lobby; the last few seconds show a
 * countdown. Distance races headline finish time; time races headline distance.
 */
export default function RaceResults({
  standings = [], riders = {}, winCondition = 'distance', dnf = [], penalized = [],
  lapLengthM = 0, elapsedS = 0, secondsLeft = null, animate = true, onExit = null,
  ladderNotes = [], saveFailed = false
}) {
  const dnfSet = new Set(dnf);
  const penalizedSet = new Set(penalized);
  const anyDnf = standings.some((s) => dnfSet.has(s.userId));
  const anyPenalty = standings.some((s) => penalizedSet.has(s.userId));
  // Only review splits when laps were actually completed. With no completed laps
  // SplitsChart falls back to a "live order" list that just duplicates the podium
  // above — an empty box that inflates the page (short races never finish a lap).
  const anyLapsCompleted = standings.some((s) => (riders[s.userId]?.lapSplits || []).length > 0);
  const showSplits = Number.isFinite(lapLengthM) && lapLengthM > 0 && standings.length > 0 && anyLapsCompleted;

  return (
    <div className="race-results" data-testid="race-results">
      <div className="race-results__eyebrow">Finish</div>
      <h2 className="race-results__title">Results</h2>
      {saveFailed && (
        <div className="race-results__save-failed" data-testid="race-results-save-failed" role="alert">
          Race could not be saved — it won&rsquo;t appear in history or the ladder
        </div>
      )}
      <ol className="race-results__list">
        {standings.map((s, i) => (
          <ResultRow key={s.userId} s={s} riders={riders} winCondition={winCondition}
            dnfSet={dnfSet} penalizedSet={penalizedSet} index={i} animate={animate} />
        ))}
      </ol>

      {ladderNotes.length > 0 && (
        <div className="race-results__ladder" data-testid="race-results-ladder">
          {ladderNotes.map((note) => (
            <div key={note} className="race-results__ladder-note">{note}</div>
          ))}
        </div>
      )}

      {showSplits && (
        <div className="race-results__splits" data-testid="race-results-splits">
          <SplitsChart riderIds={standings.map((s) => s.userId)} riders={riders}
            lapLengthM={lapLengthM} elapsedS={elapsedS} final />
        </div>
      )}

      {(anyDnf || anyPenalty) && (
        <dl className="race-results__legend" data-testid="race-results-legend">
          {anyDnf && (
            <div className="race-results__legend-item"><dt>DNF</dt><dd>Did Not Finish — stopped pedaling</dd></div>
          )}
          {anyPenalty && (
            <div className="race-results__legend-item"><dt aria-hidden="true">⏱️</dt><dd>False start — pedaling before the green light</dd></div>
          )}
        </dl>
      )}

      <div className="race-results__exit-row">
        {Number.isFinite(secondsLeft) && secondsLeft > 0 && secondsLeft <= 5 && (
          <span className="race-results__countdown" data-testid="race-results-countdown" aria-live="polite">
            Back to lobby in {secondsLeft}…
          </span>
        )}
        {onExit && (
          <button type="button" className="race-results__exit" data-testid="race-results-exit" onClick={onExit}>
            Exit
          </button>
        )}
      </div>
    </div>
  );
}

RaceResults.propTypes = {
  standings: PropTypes.array,
  riders: PropTypes.object,
  winCondition: PropTypes.string,
  dnf: PropTypes.array,
  penalized: PropTypes.array,
  lapLengthM: PropTypes.number,
  elapsedS: PropTypes.number,
  secondsLeft: PropTypes.number,
  animate: PropTypes.bool,
  onExit: PropTypes.func,
  ladderNotes: PropTypes.arrayOf(PropTypes.string),
  saveFailed: PropTypes.bool
};
