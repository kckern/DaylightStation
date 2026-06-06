import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import './HistoryTable.scss';

/**
 * History — past races as a columnar table. Days repeat across consecutive rows,
 * so each calendar day is printed once as a sticky group header and each row
 * shows only its clock time.
 */
export function HistoryTable({ records = [], onSelectRecord }) {
  if (records.length === 0) {
    return <div className="cgh-empty">No races yet</div>;
  }
  return (
    <ol className="cgh-records cgh-records--table">
      <li className="cgh-records__head" aria-hidden="true">
        <span>Riders</span><span>Dist</span><span>Time</span><span>When</span>
      </li>
      {records.map((rec, i) => {
        // Day repeats across consecutive rows (all of "Today" etc.), so
        // print it once as a sticky group header and let each row show only
        // the clock time — frees vertical space and kills the redundancy.
        const showDay = i === 0 || records[i - 1].whenDay !== rec.whenDay;
        return (
        <Fragment key={`${rec.raceId || i}`}>
          {showDay && rec.whenDay && (
            <li className="cgh-records__day" aria-hidden="true">{rec.whenDay}</li>
          )}
          <li className="cgh-record">
          <button
            type="button"
            className="cgh-record__btn"
            data-testid={`record-${rec.raceId}`}
            onClick={() => onSelectRecord?.(rec.raceId)}
            aria-label={`${rec.winnerName || 'Winner'} won — ${rec.distanceLabel || '—'}, ${rec.timeLabel || '—'}, ${rec.whenDay || ''} ${rec.whenTime || ''}`}
          >
            <span className="cgh-record__riders">
              <span className="cgh-record__avatars">
                {rec.winnerAvatar && (
                  <img className={`cgh-record__winner-avatar${rec.winnerIsGhost ? ' cg-ghost' : ''}`} src={rec.winnerAvatar} alt={rec.winnerName}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                )}
                {(rec.others || []).slice(0, 2).map((o, i) => (
                  <img key={o.id || i} className={`cgh-record__crescent${o.isGhost ? ' cg-ghost' : ''}`} src={o.avatarSrc} alt={o.displayName}
                    style={{ zIndex: -1 - i }} title={o.displayName}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ))}
                {(rec.others || []).length > 2 && (
                  <span className="cgh-record__more" title={(rec.others || []).map((o) => o.displayName).join(', ')}>+{rec.others.length - 2}</span>
                )}
              </span>
              <span className="cgh-record__winner-name">{rec.winnerName}</span>
            </span>

            {['distance', 'time'].map((col) => {
              const value = col === 'distance' ? rec.distanceLabel : rec.timeLabel;
              const isGoal = rec.goalColumn === col;
              const empty = !value || value === '—';
              return (
                <span
                  key={col}
                  className="cgh-record__cell"
                  data-col={col}
                  data-goal={isGoal ? 'true' : 'false'}
                >
                  {isGoal && <span className="cgh-record__flag" aria-hidden="true">🏁</span>}
                  {empty ? (
                    <span className="cgh-record__cell-empty" title="No result recorded" aria-label="No result recorded">—</span>
                  ) : value}
                </span>
              );
            })}

            <span className="cgh-record__when">{rec.whenTime}</span>
          </button>
          </li>
        </Fragment>
        );
      })}
    </ol>
  );
}

HistoryTable.propTypes = {
  records: PropTypes.array,
  onSelectRecord: PropTypes.func
};

export default HistoryTable;
