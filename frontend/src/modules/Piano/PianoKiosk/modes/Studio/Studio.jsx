import { useMemo, useState, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { NoteWaterfall } from '../../../components/NoteWaterfall.jsx';
import { CurrentChordStaff } from '../../../components/CurrentChordStaff.jsx';
import { computeKeyboardRange } from '../../../noteUtils.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { useStudioRecorder } from './useStudioRecorder.js';
import Icon from '../../icons/Icon.jsx';

/**
 * Studio mode — freeform play with the falling-notes visual, plus record/playback.
 * Recording captures the live BLE-MIDI stream; playback schedules the take back
 * out the MIDI port so the piano itself sounds it. Takes persist to the backend.
 */
export function Studio() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-studio' }), []);
  const { activeNotes, noteHistory, isPlaying, subscribe, scheduleNotes, connected } = usePianoMidi();
  const { pianoId } = usePianoKioskConfig();
  const { recording, lastTake, start, stop } = useStudioRecorder(subscribe);
  const [takes, setTakes] = useState([]);
  const [busy, setBusy] = useState(false);
  const { startNote, endNote } = useMemo(() => computeKeyboardRange(null), []);
  const studioBase = `api/v1/piano/${pianoId}/studio`;

  const loadTakes = useCallback(async () => {
    try {
      const res = await DaylightAPI(studioBase);
      setTakes(res?.takes ?? []);
    } catch (err) {
      logger.warn('studio.list-failed', { error: err.message });
    }
  }, [logger, studioBase]);

  useEffect(() => { loadTakes(); }, [loadTakes]);

  const onRecordToggle = () => {
    if (recording) {
      const take = stop();
      logger.info('studio.record-stop', { events: take.events.length, durMs: take.durationMs });
    } else {
      logger.info('studio.record-start', {});
      start();
    }
  };

  const onSave = async () => {
    if (!lastTake?.events?.length) return;
    setBusy(true);
    try {
      const title = `Take ${new Date().toLocaleString()}`;
      const res = await DaylightAPI(studioBase, {
        title, durationMs: lastTake.durationMs, events: lastTake.events,
      }, 'POST');
      logger.info('studio.save', { id: res?.id, events: lastTake.events.length });
      await loadTakes();
    } catch (err) {
      logger.error('studio.save-failed', { error: err.message });
    } finally {
      setBusy(false);
    }
  };

  const onPlay = async (id) => {
    try {
      const take = await DaylightAPI(`${studioBase}/${id}`);
      const ok = scheduleNotes(take?.events ?? []);
      logger.info('studio.playback-start', { id, sent: ok, events: take?.events?.length ?? 0 });
    } catch (err) {
      logger.error('studio.playback-failed', { id, error: err.message });
    }
  };

  const onDelete = async (id) => {
    try {
      await DaylightAPI(`${studioBase}/${id}`, {}, 'DELETE');
      logger.info('studio.delete', { id });
      await loadTakes();
    } catch (err) {
      logger.warn('studio.delete-failed', { id, error: err.message });
    }
  };

  return (
    <section className="piano-mode piano-mode--studio">
      <div className="piano-studio__toolbar">
        <button
          type="button"
          className={`piano-studio__rec${recording ? ' is-recording' : ''}`}
          onClick={onRecordToggle}
        >
          {recording ? <><Icon name="stop" /> Stop</> : <><Icon name="record" /> Record</>}
        </button>
        {!recording && lastTake?.events?.length > 0 && (
          <button type="button" className="piano-studio__save" onClick={onSave} disabled={busy}>
            Save take
          </button>
        )}
        <span className="piano-studio__status">
          {recording ? 'Recording…' : isPlaying ? 'Playing' : connected ? 'Ready' : 'Piano not connected'}
        </span>
      </div>

      <div className="piano-mode__staff">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>

      <div className="piano-studio__waterfall">
        <NoteWaterfall
          noteHistory={noteHistory}
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
        />
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
                <button type="button" onClick={() => onDelete(id)} aria-label="Delete take"><Icon name="trash" label="Delete take" /></button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export default Studio;
