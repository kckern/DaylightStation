import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { useStudioRecorder } from './useStudioRecorder.js';
import StudioPlay from './StudioPlay.jsx';
import StudioRecordings from './StudioRecordings.jsx';
import StudioPlayback from './StudioPlayback.jsx';

/**
 * Studio mode — a freeform play surface with two tabs:
 *   • Play (index)  — staff + falling-notes waterfall + a touch keyboard, with a
 *                     single stateful Record button (count-up + red blink). Stop
 *                     auto-saves the take.
 *   • Recordings    — review/playback, favourite, and curate saved takes.
 *
 * The recorder and take list live here in the container, not in the views, so a
 * recording keeps capturing while the user flips between tabs.
 */
export function Studio() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-studio' }), []);
  const { subscribe, connected } = usePianoMidi();
  const { isPlaying } = usePianoMidiNotes();
  const { currentUser } = usePianoUser();
  const { recording, start, stop } = useStudioRecorder(subscribe);
  const [takes, setTakes] = useState([]);
  const [confirmId, setConfirmId] = useState(null);
  const studioBase = currentUser ? `api/v1/piano/users/${currentUser}/studio` : null;

  // Count-up timer while recording (drives the Record button's MM:SS readout).
  const [elapsedMs, setElapsedMs] = useState(0);
  const recStartRef = useRef(0);
  useEffect(() => {
    if (!recording) { setElapsedMs(0); return undefined; }
    recStartRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - recStartRef.current), 250);
    return () => clearInterval(id);
  }, [recording]);

  const loadTakes = useCallback(async () => {
    if (!studioBase) { setTakes([]); return; }
    try {
      const res = await DaylightAPI(studioBase);
      setTakes(res?.takes ?? []);
    } catch (err) {
      logger.warn('studio.list-failed', { error: err.message });
    }
  }, [logger, studioBase]);

  useEffect(() => { loadTakes(); }, [loadTakes]);

  const saveTake = useCallback(async (take) => {
    if (!studioBase) return;
    try {
      const title = `Take ${new Date().toLocaleString()}`;
      const res = await DaylightAPI(studioBase, {
        title, durationMs: take.durationMs, events: take.events,
      }, 'POST');
      logger.info('studio.save', { id: res?.id, events: take.events.length });
      await loadTakes();
    } catch (err) {
      logger.error('studio.save-failed', { error: err.message });
    }
  }, [studioBase, logger, loadTakes]);

  // Single Record toggle: stop auto-saves whatever was captured (if anything).
  const onRecordToggle = useCallback(async () => {
    if (recording) {
      const take = stop();
      logger.info('studio.record-stop', { events: take.events.length, durMs: take.durationMs });
      if (take.events.length > 0) await saveTake(take);
    } else {
      logger.info('studio.record-start', {});
      start();
    }
  }, [recording, start, stop, saveTake, logger]);

  const onToggleFavorite = useCallback(async (id, favorite) => {
    try {
      await DaylightAPI(`${studioBase}/${id}`, { favorite }, 'PATCH');
      logger.info('studio.favorite', { id, favorite });
      await loadTakes();
    } catch (err) {
      logger.warn('studio.favorite-failed', { id, error: err.message });
    }
  }, [studioBase, loadTakes, logger]);

  const onDelete = useCallback(async (id) => {
    try {
      await DaylightAPI(`${studioBase}/${id}`, {}, 'DELETE');
      logger.info('studio.delete', { id });
      await loadTakes();
    } catch (err) {
      logger.warn('studio.delete-failed', { id, error: err.message });
    }
  }, [studioBase, loadTakes, logger]);

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
        <Route
          index
          element={(
            <StudioPlay
              recording={recording}
              elapsedMs={elapsedMs}
              onRecordToggle={onRecordToggle}
            />
          )}
        />
        <Route
          path="recordings"
          element={(
            <StudioRecordings
              isPlaying={isPlaying}
              connected={connected}
              takes={takes}
              confirmId={confirmId}
              setConfirmId={setConfirmId}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
            />
          )}
        />
        <Route path="recordings/:id" element={<StudioPlayback />} />
      </Routes>
    </section>
  );
}

export default Studio;
