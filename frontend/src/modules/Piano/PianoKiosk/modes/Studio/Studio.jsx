import { useMemo, useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { useStudioRecorder } from './useStudioRecorder.js';
import StudioPlay from './StudioPlay.jsx';
import StudioRecordings from './StudioRecordings.jsx';

/**
 * Studio mode — a freeform play surface with two tabs:
 *   • Play (index)      — staff + falling-notes waterfall + a touch keyboard.
 *   • Recordings        — capture the live MIDI stream, save takes, and play them
 *                         back out the port so the piano sounds them.
 *
 * The recorder and take list live here in the container, not in the Recordings
 * view, so a recording keeps capturing while the user flips back to the Play tab.
 */
export function Studio() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-studio' }), []);
  const { isPlaying, subscribe, scheduleNotes, connected } = usePianoMidi();
  const { pianoId } = usePianoKioskConfig();
  const { recording, lastTake, start, stop } = useStudioRecorder(subscribe);
  const [takes, setTakes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
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

  const onRecordToggle = useCallback(() => {
    if (recording) {
      const take = stop();
      logger.info('studio.record-stop', { events: take.events.length, durMs: take.durationMs });
    } else {
      logger.info('studio.record-start', {});
      start();
    }
  }, [recording, start, stop, logger]);

  const onSave = useCallback(async () => {
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
  }, [lastTake, studioBase, logger, loadTakes]);

  const onPlay = useCallback(async (id) => {
    try {
      const take = await DaylightAPI(`${studioBase}/${id}`);
      const ok = scheduleNotes(take?.events ?? []);
      logger.info('studio.playback-start', { id, sent: ok, events: take?.events?.length ?? 0 });
    } catch (err) {
      logger.error('studio.playback-failed', { id, error: err.message });
    }
  }, [studioBase, scheduleNotes, logger]);

  const onDelete = useCallback(async (id) => {
    try {
      await DaylightAPI(`${studioBase}/${id}`, {}, 'DELETE');
      logger.info('studio.delete', { id });
      await loadTakes();
    } catch (err) {
      logger.warn('studio.delete-failed', { id, error: err.message });
    }
  }, [studioBase, logger, loadTakes]);

  const status = recording ? 'Recording…' : isPlaying ? 'Playing' : connected ? 'Ready' : 'Piano not connected';

  return (
    <section className="piano-mode piano-mode--studio">
      <nav className="piano-studio__tabs">
        <NavLink to="" end className={({ isActive }) => `piano-studio__tab${isActive ? ' is-active' : ''}`}>
          Play
        </NavLink>
        <NavLink to="recordings" className={({ isActive }) => `piano-studio__tab${isActive ? ' is-active' : ''}`}>
          Recordings
          {recording && <span className="piano-studio__rec-dot" aria-label="recording" />}
        </NavLink>
      </nav>

      <Routes>
        <Route index element={<StudioPlay />} />
        <Route
          path="recordings"
          element={(
            <StudioRecordings
              recording={recording}
              lastTake={lastTake}
              busy={busy}
              status={status}
              connected={connected}
              takes={takes}
              confirmId={confirmId}
              setConfirmId={setConfirmId}
              onRecordToggle={onRecordToggle}
              onSave={onSave}
              onPlay={onPlay}
              onDelete={onDelete}
            />
          )}
        />
      </Routes>
    </section>
  );
}

export default Studio;
