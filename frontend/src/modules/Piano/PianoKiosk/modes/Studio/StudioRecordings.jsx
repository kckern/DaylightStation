import Icon from '../../icons/Icon.jsx';

/**
 * Studio recordings view — the record/playback workbench. Presentational: the
 * recorder state and persistence live in the Studio container (so a take keeps
 * capturing while the user flips to the Play tab) and are passed in here. Capture
 * the live BLE-MIDI stream, save a take, then play one back out the MIDI port so
 * the piano itself sounds it.
 */
export default function StudioRecordings({
  recording, lastTake, busy, status, connected,
  takes, confirmId, setConfirmId,
  onRecordToggle, onSave, onPlay, onDelete,
}) {
  const canSave = !recording && lastTake?.events?.length > 0;

  return (
    <div className="piano-studio-recordings">
      <div className="piano-studio__toolbar">
        <button
          type="button"
          className={`piano-studio__rec${recording ? ' is-recording' : ''}`}
          onClick={onRecordToggle}
        >
          {recording ? <><Icon name="stop" /> Stop</> : <><Icon name="record" /> Record</>}
        </button>
        {canSave && (
          <button type="button" className="piano-studio__save" onClick={onSave} disabled={busy}>
            Save take
          </button>
        )}
        <span className="piano-studio__status">{status}</span>
      </div>

      <div className="piano-studio__takes">
        <h3>Saved takes</h3>
        {takes.length === 0 && <p className="piano-mode__placeholder">No takes yet.</p>}
        <ul>
          {takes.map((t) => {
            const id = typeof t === 'string' ? t : t.id;
            const title = typeof t === 'string' ? t : (t.title || t.id);
            return (
              <li key={id}>
                <span className="piano-studio__take-title">{title}</span>
                <button type="button" onClick={() => onPlay(id)} disabled={!connected}><Icon name="play" /> Play</button>
                {confirmId === id ? (
                  <span className="piano-studio__confirm">
                    Delete?
                    <button type="button" onClick={() => { setConfirmId(null); onDelete(id); }} aria-label="Confirm delete"><Icon name="trash" /></button>
                    <button type="button" onClick={() => setConfirmId(null)} aria-label="Cancel delete"><Icon name="close" /></button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmId(id)} aria-label="Delete take"><Icon name="trash" /></button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
