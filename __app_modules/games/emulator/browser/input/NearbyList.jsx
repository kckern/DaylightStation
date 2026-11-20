// NearbyList — devices the search hears right now. Picking a row pairs exactly
// that address; nothing here pairs on its own. Input devices only unless
// "Show everything" is on.
import React from 'react';

export function NearbyList({ rows, hidden, showAll, onToggleShowAll, onPick, busy }) {
  return (
    <>
      {rows.length ? (
        <ul className="bts-list bts-nearby-list">
          {rows.map((r) => (
            <li key={r.address} className={`bts-row${r.highlight ? ' bts-highlight' : ''}`} data-address={r.address}>
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
        <p className="bts-empty">Nothing found yet. Put the device in pairing mode and keep it close.</p>
      )}
      <button type="button" className="bts-button bts-toggle" aria-pressed={showAll} onClick={onToggleShowAll}>
        {showAll ? 'Show input devices only' : `Show everything${hidden ? ` (${hidden} more)` : ''}`}
      </button>
    </>
  );
}

export default NearbyList;
