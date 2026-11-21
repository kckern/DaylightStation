// NearbyList — devices this search has heard, in the order they were first
// heard (new ones append at the bottom; nothing on screen moves). Picking a
// row pairs exactly that address; nothing here pairs on its own. Input devices
// only unless "Show everything" is on. After the search ends (`ended`) the
// rows stay pickable and are marked as last heard.
import React from 'react';

function Bars({ n }) {
  return (
    <span className="bts-bars" data-bars={n} role="img" aria-label={`Signal ${n} of 4`}>
      {[1, 2, 3, 4].map((i) => <span key={i} className={`bts-bar${i <= n ? ' is-on' : ''}`} />)}
    </span>
  );
}

export function NearbyList({ rows, hidden, showAll, onToggleShowAll, onPick, busy, ended = false }) {
  return (
    <>
      {rows.length && ended ? <p className="bts-hint">Last heard in this search.</p> : null}
      {rows.length ? (
        <ul className="bts-nearby-list">
          {rows.map((r) => (
            <li key={r.address} data-address={r.address}>
              <button
                type="button"
                className={`bts-device bts-nearby${r.highlight ? ' bts-highlight' : ''}${ended ? ' bts-stale' : ''}`}
                aria-label={`Pair ${r.name}`}
                disabled={busy}
                onClick={() => onPick(r)}
              >
                <span className="bts-device-text">
                  <span className="bts-device-name">{r.name}</span>
                  <span className="bts-device-detail"><span>{r.typeLabel}</span><span>{r.tail}</span></span>
                </span>
                {r.paired ? <span className="bts-badge">Paired</span> : null}
                <Bars n={r.bars} />
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
