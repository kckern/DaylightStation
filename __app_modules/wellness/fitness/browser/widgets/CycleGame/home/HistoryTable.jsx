import React, { Fragment, useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import "./HistoryTable.scss";

/**
 * History — past races as a columnar table. Days repeat across consecutive rows,
 * so each calendar day is printed once as a sticky group header and each row
 * shows only its clock time.
 */
/**
 * Hides, most recent first, every row (and day header) that does not fit whole in `box`,
 * so the unscrollable lobby never shows a half-clipped row. A box with no height (jsdom,
 * not laid out) hides nothing. Returns how many rows were hidden.
 */
export function fitHistoryRows(box, list) {
  const items = [...list.children];
  items.forEach((li) => { li.style.display = ''; });
  const limit = box.getBoundingClientRect().bottom;
  if (!(box.getBoundingClientRect().height > 0)) return 0;
  let cut = false; let hidden = 0;
  items.forEach((li) => {
    const isRow = li.classList.contains('cgh-record');
    if (!cut && li.getBoundingClientRect().bottom > limit + 0.5) cut = true;
    if (cut) { li.style.display = 'none'; if (isRow) hidden += 1; }
  });
  // A day header with no visible row under it is dropped too.
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const li = items[i];
    if (li.classList.contains('cgh-records__day') && li.style.display !== 'none') {
      const next = items[i + 1];
      if (!next || next.style.display === 'none' || !next.classList.contains('cgh-record')) li.style.display = 'none';
    }
  }
  return hidden;
}

export function HistoryTable({ records = [], onSelectRecord, disabled = false }) {
  const boxRef = useRef(null);
  const listRef = useRef(null);
  useLayoutEffect(() => {
    const box = boxRef.current; const list = listRef.current;
    if (!box || !list) return undefined;
    const run = () => { const n = fitHistoryRows(box, list); box.dataset.hiddenRows = String(n); };
    run();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(run); ro.observe(box);
    return () => ro.disconnect();
  }, [records]);
  if (records.length === 0) {
    return <div className="cgh-empty">No races yet</div>;
  }
  return (
    <div className="cgh-history" ref={boxRef} data-testid="history-box">
    <ol className="cgh-records cgh-records--table" ref={listRef}>
      <li className="cgh-records__head" aria-hidden="true" data-secondary>
        <span>Riders</span><span>Speed</span><span>Race</span><span>When</span>
      </li>
      {records.map((rec, i) => {
        // Day repeats across consecutive rows (all of "Today" etc.), so
        // print it once as a sticky group header and let each row show only
        // the clock time — frees vertical space and kills the redundancy.
        const showDay = i === 0 || records[i - 1].whenDay !== rec.whenDay;
        // The cell sits under "Speed", but a lead rider who did not finish has
        // no pace: it then holds how far they got, and says so.
        const isDistance = rec.speedKind === 'distance';
        const resultText = isDistance ? `${rec.speedLabel} ridden, did not finish` : (rec.speedLabel || '—');
        return (
        <Fragment key={`${rec.raceId || i}`}>
          {showDay && rec.whenDay && (
            <li className="cgh-records__day" aria-hidden="true" data-secondary>{rec.whenDay}</li>
          )}
          <li className="cgh-record">
          <button
            type="button"
            className="cgh-record__btn"
            data-testid={`record-${rec.raceId}`}
            disabled={disabled}
            onClick={() => onSelectRecord?.(rec.raceId)}
            aria-label={`${rec.winnerName || 'Lead rider'} — ${resultText}, ${rec.raceLabel || 'race'}, ${rec.whenDay || ''} ${rec.whenTime || ''}`}
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

            <span
              className="cgh-record__cell"
              data-col="speed"
              data-kind={rec.speedLabel ? (isDistance ? 'distance' : 'speed') : undefined}
              aria-label={isDistance ? resultText : undefined}
              title={isDistance ? 'Distance ridden (did not finish)' : undefined}
            >
              {rec.speedLabel ? rec.speedLabel : (
                <span className="cgh-record__cell-empty" title="No result recorded" aria-label="No result recorded">—</span>
              )}
            </span>

            <span className="cgh-record__cell cgh-record__cell--race" data-col="race">
              <span className="cgh-record__race-icon" aria-hidden="true">{rec.raceKind === 'time' ? '⏱' : '🏁'}</span>
              {rec.raceLabel || '—'}
            </span>

            <span className="cgh-record__when">{rec.whenTime}</span>
          </button>
          </li>
        </Fragment>
        );
      })}
    </ol>
    </div>
  );
}

HistoryTable.propTypes = {
  records: PropTypes.array,
  onSelectRecord: PropTypes.func,
  disabled: PropTypes.bool
};

export default HistoryTable;
