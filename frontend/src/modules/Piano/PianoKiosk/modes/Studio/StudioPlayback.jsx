import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { NoteWaterfall } from '../../../components/NoteWaterfall.jsx';
import { StudioTopPane } from '../../../components/StudioTopPane.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { computeKeyboardRange } from '../../../noteUtils.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { useStudioPlayback } from './useStudioPlayback.js';
import Icon from '../../icons/Icon.jsx';

const SPEEDS = [0.5, 1, 1.5];
function mmss(ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Transport bar — play/pause, ±10s, a scrub track, time read-out, and speed
 * pills. Reads the playhead from pb.positionRef via its own rAF so dragging is
 * silky and the visualizer above never re-renders on position change.
 */
function Transport({ pb, onExit }) {
  const fillRef = useRef(null);
  const headRef = useRef(null);
  const timeRef = useRef(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    let raf;
    const paint = () => {
      const pct = pb.durationMs ? Math.min(1, pb.positionRef.current / pb.durationMs) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${pct})`;
      if (headRef.current) headRef.current.style.left = `${pct * 100}%`;
      if (timeRef.current) timeRef.current.textContent = `${mmss(pb.positionRef.current)} / ${mmss(pb.durationMs)}`;
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [pb]);

  const seekToClientX = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    pb.seek(pct * pb.durationMs);
  }, [pb]);

  const onPointerDown = useCallback((e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekToClientX(e.clientX);
  }, [seekToClientX]);
  const onPointerMove = useCallback((e) => { if (draggingRef.current) seekToClientX(e.clientX); }, [seekToClientX]);
  const onPointerUp = useCallback((e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  return (
    <div className="piano-playback__transport">
      <div className="piano-playback__row">
        <button type="button" className="piano-playback__skip" onClick={() => pb.seek(pb.positionRef.current - 10000)} aria-label="Back 10 seconds">
          <Icon name="skip-back-15" />
        </button>
        <button type="button" className="piano-playback__play" onClick={pb.toggle} aria-label={pb.isPlaying ? 'Pause' : 'Play'}>
          <Icon name={pb.isPlaying ? 'pause' : 'play'} />
        </button>
        <button type="button" className="piano-playback__skip" onClick={() => pb.seek(pb.positionRef.current + 10000)} aria-label="Forward 10 seconds">
          <Icon name="skip-forward-15" />
        </button>
        <span ref={timeRef} className="piano-playback__time">0:00 / 0:00</span>

        <div className="piano-playback__speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={`piano-playback__speed${pb.speed === s ? ' is-active' : ''}`}
              onClick={() => pb.setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>

        <button type="button" className="piano-playback__exit" onClick={onExit} aria-label="Close player">
          <Icon name="close" />
        </button>
      </div>

      <div
        ref={trackRef}
        className="piano-playback__track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(pb.durationMs)}
        tabIndex={0}
      >
        <span ref={fillRef} className="piano-playback__track-fill" />
        <span ref={headRef} className="piano-playback__track-head" />
      </div>
    </div>
  );
}

/**
 * Studio playback — a focused "now playing" view for a saved take. Fetches the
 * take, then plays it back through the live sound path while visualizing it with
 * the same staff → falling-notes waterfall → keyboard the Play tab uses (here
 * read-only, lit by the recording). Auto-plays on open.
 */
export default function StudioPlayback() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-studio-playback' }), []);
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = usePianoUser();
  const { activeNotes, noteHistory, pressNote, releaseNote, connected } = usePianoMidi();
  const { startNote, endNote } = useMemo(() => computeKeyboardRange(null), []);
  const [take, setTake] = useState(undefined); // undefined=loading, null=missing

  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await DaylightAPI(`api/v1/piano/users/${currentUser}/studio/${id}`);
        if (!cancelled) setTake(data || null);
      } catch (err) {
        if (!cancelled) setTake(null);
        logger.warn('studio.playback.load-failed', { id, error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser, id, logger]);

  const pb = useStudioPlayback({ events: take?.events, pressNote, releaseNote });
  usePianoBreadcrumb(useMemo(() => [{ label: 'Recordings' }, { label: take?.title || 'Take' }], [take?.title]));

  // Auto-play once the take is loaded.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current && take?.events?.length) {
      startedRef.current = true;
      logger.info('studio.playback.open', { id, events: take.events.length });
      pb.play();
    }
  }, [take, id, pb, logger]);

  const exit = useCallback(() => { pb.stop(); navigate('..', { relative: 'path' }); }, [pb, navigate]);

  if (take === undefined) return <div className="piano-mode piano-mode--studio piano-playback"><p className="piano-mode__placeholder">Loading…</p></div>;
  if (take === null) return <div className="piano-mode piano-mode--studio piano-playback"><p className="piano-mode__placeholder">This take could not be loaded.</p></div>;

  return (
    <div className="piano-playback">
      <StudioTopPane activeNotes={activeNotes} />

      <div className="piano-playback__waterfall">
        <NoteWaterfall noteHistory={noteHistory} activeNotes={activeNotes} startNote={startNote} endNote={endNote} />
      </div>

      <div className="piano-playback__keys">
        <PianoKeyboard activeNotes={activeNotes} startNote={startNote} endNote={endNote} />
      </div>

      <Transport pb={pb} onExit={exit} />
      {!connected && <p className="piano-playback__hint">Piano not connected — playing the visual only.</p>}
    </div>
  );
}
