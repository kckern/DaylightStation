// ButtonEditor — set what each button on one remote does. Press a button on
// the remote (or tap its keycap) to pick it, then tap an action. The face
// shows every change at once; Done saves them all, Cancel drops them.
// Actions come from the host (`groups`: Playback, Navigate, Nothing), so this
// screen never names an action of its own.
import React, { useEffect, useRef } from 'react';
import { DeviceFace } from './DeviceFace.jsx';
import { capActionId, capActionLabel } from './deviceFaceModel.js';

export function ButtonEditor({ row, face, held, picked, onPick, draft, groups, onSet, saving = false, error = null, defaultFor = null }) {
  const pickedCap = face?.caps?.find((c) => c.id === picked) || null;
  // A press on the remote picks its keycap: focus follows, so a gamepad or the
  // keys carry on from there.
  const rootRef = useRef(null);
  useEffect(() => {
    const el = picked ? [...(rootRef.current?.querySelectorAll('.bts-cap') || [])].find((n) => n.dataset.cap === picked) : null;
    if (el && el !== document.activeElement) el.focus();
  }, [picked]);
  // Drafts are keyed by each keycap's slot: its position on a remote drawn as
  // mounted, else the key it sends.
  const labels = Object.fromEntries((face?.caps || []).map((c) => [c.slot ?? c.key, capActionLabel(c, draft, groups, defaultFor)]));
  // The chip that is on: what the picked button does now (saved, or its key's default).
  const current = pickedCap ? capActionId(pickedCap, draft, defaultFor) : null;
  return (
    <section className="bts-editor" ref={rootRef} aria-label={`Edit buttons on ${row?.name || 'this remote'}`}>
      <div className="bts-page-face">
        {face?.caps?.length
          ? <DeviceFace face={face} held={held} picked={picked} onPick={onPick} labels={labels} />
          : <p className="bts-face-empty">Press a button on {row?.name || 'the remote'} to add it here.</p>}
      </div>
      <p className="bts-editor-prompt" role="status">
        {pickedCap ? `${pickedCap.legend} does: ${labels[pickedCap.slot ?? pickedCap.key]}` : `Press a button on ${row?.name || 'the remote'}, or tap one.`}
      </p>
      <div className="bts-chips">
        {(groups || []).map((g) => (
          <div key={g.id} className="bts-chip-group" role="group" aria-label={g.label}>
            {g.actions.length > 1 ? <h5 className="bts-chip-heading">{g.label}</h5> : null}
            <div className="bts-chip-row">
              {g.actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`bts-chip${current === a.id ? ' is-on' : ''}`}
                  aria-pressed={current === a.id}
                  disabled={!pickedCap || saving}
                  onClick={() => onSet(pickedCap.slot ?? pickedCap.key, a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error ? <p className="bts-tone-error bts-status-line" role="alert">{error}</p> : null}
    </section>
  );
}

export default ButtonEditor;
