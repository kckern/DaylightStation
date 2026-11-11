import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from "../../components/CircularUserAvatar.jsx";
import { formatDistance } from "../../lib/cycleGame/formatDistance.js";
import resolveParticipantIdentity from "../../lib/cycleGame/participantIdentity.js";
import { comparisonLines } from "../../lib/cycleGame/resultsComparison.js";
import { MedalIcon, CrownIcon, GhostIcon } from "./home/icons.jsx";
import SplitsChart from "./panels/SplitsChart.jsx";
import "./RaceResults.scss";

const AVATAR_BASE = '/api/v1/static/img/users';
const FALLBACK_AVATAR = `${AVATAR_BASE}/user`;

// Fit rules for a 1920x1080 board (see RaceResults.scss): from DENSE_MIN_ROWS rows the
// rows compact; the lap-splits table (tallest optional block) only shows up to
// SPLITS_MAX_ROWS rows.
const DENSE_MIN_ROWS = 5;
const SPLITS_MAX_ROWS = 3;

// Ghost display names arrive with a trailing ghost emoji; the board shows the SVG
// GhostIcon instead.
const TRAILING_EMOJI = /[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/u;
const cleanName = (n) => String(n ?? '').replace(TRAILING_EMOJI, '') || String(n ?? '');
const isGhostId = (id, riders) => !!riders[id]?.isGhost || String(id).startsWith('ghost:');

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  // Round TOTAL seconds first — floor-minutes/round-remainder renders "1:60"
  // for 119.6s, and the count-up animation passes through 59.5-60 every race.
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
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
function ResultRow({ s, riders, winCondition, stoppedSet, overtimeSet, index, animate, comparison }) {
  const name = cleanName(riders[s.userId]?.displayName || s.userId);
  // Stopped = parked or no-sensor when the race closed. Nobody is eliminated:
  // they keep the distance they rode, worded "Stopped at 412 m".
  const isStopped = stoppedSet.has(s.userId);
  // Overtime = the race closed around them (mercy-kill window / operator Finish)
  // while they were still riding. They keep their real metric, just tagged
  // "OT" (audit game-design #7).
  const isOvertime = !isStopped && overtimeSet.has(s.userId);
  const finished = s.finishTimeS != null;
  // Time races never stamp finishTimeS, so "finished" must not gate the crown —
  // exclude only stopped/overtime (a race closed before ANY finisher has no winner).
  const isWinner = s.placement === 1 && !isStopped && !isOvertime;
  const rider = riders[s.userId] || {};
  const isGhost = isGhostId(s.userId, riders);
  const sourceId = isGhost ? resolveParticipantIdentity(String(s.userId)).sourceId : s.userId;
  const avatarSrc = rider.avatarSrc || `${AVATAR_BASE}/${sourceId}`;
  const medalClass = s.placement <= 3 ? ` race-results__row--p${s.placement}` : '';

  // Finishers headline the win-condition's counterpart metric (distance race →
  // finish time; time race → distance covered), exactly as before. Anyone who
  // did NOT finish — overtime and stopped included — has no finish time, so they
  // always show their real distance traveled ("Stopped at …" when stopped).
  const metricTarget = finished && !isStopped ? (winCondition === 'distance' ? s.finishTimeS : s.distanceM) : s.distanceM;
  const counted = useCountUp(metricTarget, animate);
  const metric = isStopped
    ? `Stopped at ${formatDistance(counted)}`
    : finished ? (winCondition === 'distance' ? fmtTime(counted) : formatDistance(counted))
    : formatDistance(counted);

  const lines = !isGhost && !isStopped && comparison ? comparisonLines(comparison, winCondition) : [];

  return (
    <li
      className={`race-results__row${medalClass}${isWinner ? ' is-winner' : ''}`}
      data-testid="result-row"
      data-testid-row={s.userId}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span className="race-results__place" data-testid={`result-row-${s.userId}`}>
        <span className="race-results__placement"><MedalIcon place={s.placement} /></span>
        <span className={`race-results__avatar${isGhost ? ' cg-ghost' : ''}`}>
          <CircularUserAvatar name={name} avatarSrc={avatarSrc} fallbackSrc={FALLBACK_AVATAR}
            size={isWinner ? 64 : 50} showGauge={false} showIndicator={false} />
        </span>
        <span className="race-results__name">
          <span className="race-results__name-text">{name}</span>
          {isGhost && <span className="race-results__ghost-mark" aria-label="ghost"><GhostIcon /></span>}
          {isWinner && <span className="race-results__crown" aria-hidden="true"><CrownIcon /></span>}
        </span>
        <span className={`race-results__metric${isStopped ? ' race-results__metric--stopped' : ''}`}>
          {metric}
          {isOvertime && (
            <span className="race-results__ot-tag" title="Still riding when the race closed" aria-label="overtime">OT</span>
          )}
        </span>
      </span>
      {lines.length > 0 && (
        <div className="race-results__compare" data-testid={`result-compare-${s.userId}`}>
          {lines.map((line, i) => (
            <span key={line} className={i === 0 && (line === 'New best' || line === 'First ride at this length') ? 'is-emphasis' : undefined}>{line}</span>
          ))}
        </div>
      )}
    </li>
  );
}
ResultRow.propTypes = {
  s: PropTypes.object.isRequired, riders: PropTypes.object.isRequired,
  winCondition: PropTypes.string, stoppedSet: PropTypes.instanceOf(Set), overtimeSet: PropTypes.instanceOf(Set),
  index: PropTypes.number, animate: PropTypes.bool, comparison: PropTypes.object
};

// One sentence comparing the single live rider with the pace rival they raced.
// Distance race: finish times when both have one, else metres at the close.
// Time race: distance covered. Null when it cannot be said (tie, no data, a stopped rider).
function versusSentence({ standings, riders, stoppedSet, rivalId, rivalLabel, winCondition }) {
  if (!rivalId || !rivalLabel) return null;
  const rival = standings.find((s) => s.userId === rivalId);
  const live = standings.filter((s) => s.userId !== rivalId && !isGhostId(s.userId, riders) && !stoppedSet.has(s.userId));
  if (!rival || live.length !== 1 || standings.length !== 2) return null;
  const me = live[0];
  const num = Number.isFinite;
  if (winCondition === 'distance' && num(me.finishTimeS) && num(rival.finishTimeS)) {
    const d = Math.round(Math.abs(me.finishTimeS - rival.finishTimeS));
    if (d === 0) return null;
    return me.finishTimeS < rival.finishTimeS ? `You beat ${rivalLabel} by ${d} s` : `${rivalLabel} finished ${d} s ahead`;
  }
  if (!num(me.distanceM) || !num(rival.distanceM)) return null;
  const d = Math.abs(me.distanceM - rival.distanceM);
  if (Math.round(d) === 0) return null;
  const dist = formatDistance(d);
  const won = me.distanceM > rival.distanceM;
  if (winCondition === 'distance') return won ? `You beat ${rivalLabel} by ${dist}` : `${rivalLabel} finished ${dist} ahead`;
  return won ? `You went ${dist} further than ${rivalLabel}` : `${rivalLabel} went ${dist} further`;
}

/**
 * Race results board — a Mario-Kart-style finish: rows slide into their finishing
 * order while each metric ticks up to its final value, the winner spotlit with a
 * crown. When laps were completed, the lap-by-lap splits table reviews the race
 * below the podium (skipped for short races that never finish a lap). A
 * config-driven dwell auto-returns to the lobby; the last few seconds show a
 * countdown for the whole dwell. Distance races headline finish time; time races headline distance.
 */
export default function RaceResults({
  standings = [], riders = {}, winCondition = 'distance', stopped = [], overtime = [],
  lapLengthM = 0, elapsedS = 0, secondsLeft = null, animate = true, onExit = null,
  ladderNotes = [], saveFailed = false,
  onRematch = null, onHold = null, comparisons = null, rivalId = null, rivalLabel = ''
}) {
  const heldRef = useRef(false);
  useEffect(() => {
    if (!onHold || typeof document === 'undefined') return undefined;
    const hold = () => {
      if (heldRef.current) return;
      heldRef.current = true;
      onHold();
    };
    document.addEventListener('pointerdown', hold, true);
    document.addEventListener('keydown', hold, true);
    return () => {
      document.removeEventListener('pointerdown', hold, true);
      document.removeEventListener('keydown', hold, true);
    };
  }, [onHold]);

  const stoppedSet = new Set(stopped);
  const overtimeSet = new Set(overtime);
  const anyOvertime = standings.some((s) => !stoppedSet.has(s.userId) && overtimeSet.has(s.userId));
  // Only review splits when laps were actually completed. With no completed laps
  // SplitsChart falls back to a "live order" list that just duplicates the podium
  // above — an empty box that inflates the page (short races never finish a lap).
  const anyLapsCompleted = standings.some((s) => (riders[s.userId]?.lapSplits || []).length > 0);
  const showSplits = Number.isFinite(lapLengthM) && lapLengthM > 0 && standings.length > 0 && standings.length <= SPLITS_MAX_ROWS && anyLapsCompleted;
  const dense = standings.length >= DENSE_MIN_ROWS;
  const versus = versusSentence({ standings, riders, stoppedSet, rivalId, rivalLabel, winCondition });
  const showCountdown = Number.isFinite(secondsLeft) && secondsLeft > 0;

  return (
    <div className={`race-results${dense ? ' race-results--dense' : ''}`} data-testid="race-results">
      <div className="race-results__eyebrow">Finish</div>
      <h2 className="race-results__title">Results</h2>
      {saveFailed && (
        <div className="race-results__save-failed" data-testid="race-results-save-failed" role="alert">
          Race could not be saved — it won&rsquo;t appear in history or the ladder
        </div>
      )}
      {versus && <div className="race-results__versus" data-testid="race-results-versus">{versus}</div>}
      <ol className="race-results__list">
        {standings.map((s, i) => (
          <ResultRow key={s.userId} s={s} riders={riders} winCondition={winCondition}
            stoppedSet={stoppedSet} overtimeSet={overtimeSet} index={i} animate={animate} comparison={comparisons?.[s.userId]} />
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

      {anyOvertime && (
        <dl className="race-results__legend" data-testid="race-results-legend">
          {anyOvertime && (
            <div className="race-results__legend-item"><dt>OT</dt><dd>Still riding when the race closed</dd></div>
          )}
        </dl>
      )}

      <div className="race-results__exit-row">
        {onRematch && (
          <button type="button" className="race-results__rematch is-primary" data-testid="race-results-rematch" onClick={onRematch}>
            Rematch
          </button>
        )}
        {onExit && (
          <button type="button" className="race-results__exit" data-testid="race-results-exit" onClick={onExit}>
            Exit
          </button>
        )}
        {showCountdown && (
          <span className="race-results__countdown" data-testid="race-results-countdown" aria-live="off">
            Back to lobby in {secondsLeft}
          </span>
        )}
      </div>
    </div>
  );
}

RaceResults.propTypes = {
  standings: PropTypes.array,
  riders: PropTypes.object,
  winCondition: PropTypes.string,
  stopped: PropTypes.array,
  overtime: PropTypes.array,
  lapLengthM: PropTypes.number,
  elapsedS: PropTypes.number,
  secondsLeft: PropTypes.number,
  animate: PropTypes.bool,
  onExit: PropTypes.func,
  ladderNotes: PropTypes.arrayOf(PropTypes.string),
  saveFailed: PropTypes.bool,
  onRematch: PropTypes.func,
  onHold: PropTypes.func,
  comparisons: PropTypes.object,
  rivalId: PropTypes.string,
  rivalLabel: PropTypes.string
};
