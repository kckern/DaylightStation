// DevicePage — one paired device: its name, where it lives, its status, its
// face (press a button on it and that keycap lights), one sentence on what
// games can do with it, and its actions: Edit buttons (remotes), Pair again
// (a dropped bond), Forget (two presses: the first relabels it "Press again
// to forget" for ARM_MS; moving away disarms it).
import React, { useEffect, useState } from 'react';
import { DeviceFace } from './DeviceFace.jsx';

const ARM_MS = 4000;

export function DevicePage({
  row, face, feed, verdict, savedButtons = null, groups = null,
  canEdit = false, editPending = false, onEdit, onForget, onArm, onPairAgain, busy = false, message = null, armMs = ARM_MS,
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { setArmed(false); }, [row?.address]);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), armMs);
    return () => clearTimeout(t);
  }, [armed, armMs]);
  if (!row) return null;

  const connected = row.status === 'connected';
  const hasFace = face?.caps?.length > 0;
  const prompt = verdict?.text
    || (connected ? `Press a button on ${row.name}.` : null);

  return (
    <section className="bts-page" aria-label={row.name} data-address={row.address}>
      <header className="bts-page-head">
        <h4 className="bts-page-name">{row.name}</h4>
        <p className={`bts-page-status bts-status-${row.status}`}>
          <span className="bts-dot" aria-hidden="true" />{row.statusText}
        </p>
        <p className="bts-page-detail">
          <span>{row.detail}</span>
          {row.battery ? <span>{row.battery}</span> : null}
        </p>
      </header>

      {row.wakeHint ? <p className="bts-hint">{row.wakeHint}</p> : null}

      <div className="bts-page-face">
        {hasFace
          ? <DeviceFace face={face} held={feed?.held} seen={feed?.seen} savedButtons={savedButtons} groups={groups} />
          : <p className="bts-face-empty">{connected ? 'Press its buttons to add them here.' : 'Its buttons show here once it is connected and pressed.'}</p>}
      </div>

      {prompt ? <p className={`bts-verdict bts-tone-${verdict?.tone || 'idle'}`} role="status">{prompt}</p> : null}
      {message ? <p className="bts-result" role="status">{message}</p> : null}

      <div className="bts-page-actions">
        {canEdit ? (
          <button type="button" className="bts-button bts-primary" disabled={editPending} onClick={() => onEdit?.(row)}>
            {editPending ? 'Waiting for a fingerprint…' : 'Edit buttons'}
          </button>
        ) : null}
        {row.status === 'needs-pairing' ? (
          <button type="button" className="bts-button" aria-label={`Pair ${row.name} again`} disabled={busy} onClick={() => onPairAgain?.(row)}>Pair again</button>
        ) : null}
        {row.bonded ? (
          <button
            type="button"
            className={`bts-button bts-forget${armed ? ' bts-armed' : ''}`}
            aria-label={armed ? `Press again to forget ${row.name}` : `Forget ${row.name}`}
            disabled={busy}
            onBlur={() => { if (armed) setArmed(false); }}
            onClick={() => {
              if (armed) { setArmed(false); onForget?.(row); return; }
              setArmed(true);
              onArm?.(row);
            }}
          >
            {armed ? 'Press again to forget' : 'Forget'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default DevicePage;
