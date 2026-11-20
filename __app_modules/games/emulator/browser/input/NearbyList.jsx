// NearbyList — devices the search hears right now. Picking a row pairs exactly
// that address; nothing here pairs on its own. Input devices only unless
// "Show everything" is on. After the search ends (`ended`) the rows stay
// pickable, dimmed and marked as last heard.
import React from 'react';

export function NearbyList({ rows, hidden, showAll, onToggleShowAll, onPick, busy, ended = false }) {
  return (
    <>
      {rows.length && ended ? <p className="bts-hint">Last heard in this search.</p> : null}
      {rows.length ? (
        <ul className="bts-list bts-nearby-list">
          {rows.map((r) => (
            <li key={r.address} className={`bts-row${r.highlight ? ' bts-highlight' : ''}${ended ? ' bts-stale' : ''}`} data-address={r.address}>
              <button type="button" className="bts-pick" aria-label={`Pair ${r.name}`} disabled={busy} onClick={() => onPick(r)}>
                <span className="bts-label">{r.name}</span>
                <span className="bts-type">{r.typeLabel}</span>
                <span className="bts-tail">{r.tail}</span>
                <span className="bts-bars" data-bars={r.bars} aria-label={`Signal ${r.bars} of 4`}>
                  {'▮'.repeat(r.bars)}{'▯'.repeat(4 - r.bars)}
                </span>
                {r.paired ? <span className="bts-badge">Paired</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bts-empty">
          {ended
            ? 'Nothing found. Put the device in pairing mode and keep it close, then search again.'
            : 'Nothing found yet. Put the device in pairing mode and keep it close.'}
        </p>
      )}
      <button type="button" className="bts-button bts-toggle" aria-pressed={showAll} onClick={onToggleShowAll}>
        {showAll ? 'Show input devices only' : `Show everything${hidden ? ` (${hidden} more)` : ''}`}
      </button>
    </>
  );
}

export default NearbyList;
