// PairedList — the Bluetooth screen's paired devices, one row per address,
// one status each. Forget takes two presses: the first relabels the button
// "Press again to forget" for ARM_MS, so one stray press never removes a
// working pairing.
import React, { useEffect, useState } from 'react';

const ARM_MS = 4000;

export function PairedList({ rows, busy, onForget, onArm, onTest, onPairAgain, armMs = ARM_MS }) {
  const [armed, setArmed] = useState(null);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(null), armMs);
    return () => clearTimeout(t);
  }, [armed, armMs]);

  if (!rows.length) return <p className="bts-empty">No Bluetooth devices paired yet.</p>;
  return (
    <ul className="bts-list bts-paired-list">
      {rows.map((r) => {
        const isArmed = armed === r.address;
        return (
          <li key={r.address} className="bts-row" data-address={r.address} data-status={r.status}>
            <div className="bts-row-main">
              <span className="bts-label">{r.name}</span>
              <span className="bts-type">{r.typeLabel}</span>
              <span className="bts-tail">{r.tail}</span>
              <span className={`bts-status bts-status-${r.status}`}>{r.statusText}</span>
            </div>
            {r.wakeHint ? <p className="bts-hint">{r.wakeHint}</p> : null}
            <div className="bts-row-actions">
              {r.status === 'connected' ? (
                <button type="button" className="bts-button" aria-label={`Test ${r.name}`} onClick={() => onTest(r)}>Test</button>
              ) : null}
              {r.status === 'needs-pairing' ? (
                <button type="button" className="bts-button" aria-label={`Pair ${r.name} again`} disabled={busy} onClick={() => onPairAgain(r)}>Pair again</button>
              ) : null}
              {r.bonded ? (
                <button
                  type="button"
                  className={`bts-button bts-forget${isArmed ? ' bts-armed' : ''}`}
                  aria-label={isArmed ? `Press again to forget ${r.name}` : `Forget ${r.name}`}
                  disabled={busy}
                  // Moving away disarms it, so a later stray press starts over.
                  onBlur={() => { if (isArmed) setArmed(null); }}
                  onClick={() => {
                    if (isArmed) { setArmed(null); onForget(r); return; }
                    setArmed(r.address);
                    onArm?.(r);
                  }}
                >
                  {isArmed ? 'Press again to forget' : 'Forget'}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default PairedList;
