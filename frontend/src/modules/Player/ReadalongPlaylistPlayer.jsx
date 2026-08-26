import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePlayerController from './usePlayerController.js';
import { getLogger } from '../../lib/logging/Logger.js';

const Player = lazy(() => import('./Player.jsx'));
const THROTTLE_MS = 10000;

// Inline SVG icon set — this kiosk's WebView renders unicode glyphs as tofu,
// so every pictogram here is a path. Stroke-based, currentColor, sized by CSS.
const icon = (paths, viewBox = '0 0 24 24') => (
  <svg viewBox={viewBox} focusable="false" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);
const ICONS = {
  back: icon(<path d="M15 5 8 12l7 7M8 12h13" />),
  prev: icon(<><path d="M17 5.5 9.5 12 17 18.5z" fill="currentColor" stroke="none" /><path d="M7 5.5v13" /></>),
  next: icon(<><path d="M7 5.5 14.5 12 7 18.5z" fill="currentColor" stroke="none" /><path d="M17 5.5v13" /></>),
  rewind: icon(<><path d="M12.5 4.5 5.5 12l7 7.5" /><path d="M18.5 4.5 11.5 12l7 7.5" /></>),
  forward: icon(<><path d="M11.5 4.5 18.5 12l-7 7.5" /><path d="M5.5 4.5 12.5 12l-7 7.5" /></>),
  play: icon(<path d="M8 5.2 18 12 8 18.8z" fill="currentColor" stroke="none" />),
  pause: icon(<><path d="M8.5 5.5v13" strokeWidth="3.4" /><path d="M15.5 5.5v13" strokeWidth="3.4" /></>)
};

/**
 * Generic text-and-audio playlist shell. Content labels and ids come from the
 * caller. Built for a 1280x800 touch kiosk used by children: one chapter rail
 * up top (each chip is both the picker and that chapter's progress bar), the
 * verse stage owning everything in between, one transport row at the bottom.
 */
export default function ReadalongPlaylistPlayer({ title = 'Read along', parts = [], progress = {}, onProgress, onExit }) {
  const [index, setIndex] = useState(0);
  const [last, setLast] = useState({ currentTime: 0, duration: 0 });
  const [paused, setPaused] = useState(true);
  const ref = useRef(null);
  const ctrl = usePlayerController(ref);
  const lastWrite = useRef(0);
  const latest = useRef({ part: null, last: { currentTime: 0, duration: 0 } });
  // One resume decision per part, made on the first progress event that
  // carries a real duration.
  const resumeDecided = useRef({});
  const logger = useMemo(() => getLogger().child({ component: 'readalong-playlist' }), []);
  const part = parts[index] ?? null;
  const complete = index === parts.length - 1 && last.duration > 0 && last.currentTime >= last.duration - 0.5;

  useEffect(() => {
    logger.info('readalong.mount', { title, parts: parts.length });
    return () => logger.info('readalong.unmount', { title });
    // Mount/unmount bookends only — title/parts are stable for a mounted shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logger]);

  const write = useCallback((completed = false) => {
    if (!part || !onProgress) return;
    onProgress({ partId: part.id, positionSeconds: last.currentTime, durationSeconds: last.duration, completed });
  }, [part, onProgress, last]);
  latest.current = { part, last };
  useEffect(() => () => {
    const current = latest.current;
    if (current.part && onProgress) onProgress({
      partId: current.part.id, positionSeconds: current.last.currentTime, durationSeconds: current.last.duration,
    });
  }, [onProgress]);

  const receiveProgress = useCallback((payload) => {
    const next = { currentTime: Number(payload?.currentTime) || 0, duration: Number(payload?.duration) || 0 };
    setLast(next);
    if (typeof payload?.paused === 'boolean') setPaused(payload.paused);
    // Auto-resume: a child returning mid-chapter should not have to hunt for
    // their place. Decided once per part, only for a meaningful saved position
    // that is not effectively the start or the end.
    if (part && next.duration > 0 && !resumeDecided.current[part.id]) {
      resumeDecided.current[part.id] = true;
      const target = Number(progress?.parts?.[part.id]?.lastPositionSeconds) || 0;
      if (target > 5 && target < next.duration - 10 && next.currentTime < 2) {
        ctrl.seek(target);
        logger.info('readalong.resume-applied', { partId: part.id, seconds: Math.round(target) });
      }
    }
    if (Date.now() - lastWrite.current >= THROTTLE_MS) {
      lastWrite.current = Date.now();
      logger.debug('readalong.progress-write', { partId: part?.id, seconds: Math.round(next.currentTime) });
      onProgress?.({ partId: part?.id, positionSeconds: next.currentTime, durationSeconds: next.duration });
    }
  }, [onProgress, part, progress, ctrl, logger]);
  const changePart = useCallback((nextIndex) => {
    const bounded = Math.max(0, Math.min(parts.length - 1, nextIndex));
    logger.info('readalong.part-change', { from: index, to: bounded, partId: parts[bounded]?.id });
    write(false);
    setLast({ currentTime: 0, duration: 0 });
    setPaused(true);
    setIndex(bounded);
  }, [parts, index, write, logger]);
  const ended = useCallback(() => {
    logger.info('readalong.part-complete', { partId: part?.id, index });
    write(true);
    if (index < parts.length - 1) changePart(index + 1);
  }, [write, index, parts.length, changePart, logger, part]);
  const skip = useCallback((delta) => {
    const from = ctrl.getCurrentTime();
    const max = ctrl.getDuration() || last.duration || Infinity;
    logger.debug('readalong.skip', { delta, from: Math.round(from) });
    ctrl.seek(Math.max(0, Math.min(max, from + delta)));
  }, [ctrl, last.duration, logger]);
  const toggle = useCallback(() => {
    logger.debug('readalong.toggle', { paused });
    ctrl.toggle();
  }, [ctrl, paused, logger]);
  const exit = useCallback(() => {
    logger.info('readalong.exit', { partId: part?.id });
    write(false);
    onExit?.();
  }, [write, onExit, logger, part]);

  const percent = last.duration ? Math.min(100, last.currentTime / last.duration * 100) : 0;
  const player = useMemo(() => part ? (
    <Player key={part.id} ref={ref} play={{ contentId: part.contentId }} clear={ended} onProgress={receiveProgress} />
  ) : null, [part, ended, receiveProgress]);

  if (!part) return (
    <section className="readalong-playlist" aria-label={title}>
      <header className="readalong-playlist__topbar">
        <button type="button" className="readalong-playlist__back" onClick={onExit}>{ICONS.back}<span>Back</span></button>
      </header>
      <div className="readalong-playlist__stage"><p className="readalong-playlist__empty">No audio is available for this reading.</p></div>
    </section>
  );
  return (
    <section className="readalong-playlist" aria-label={title}>
      <header className="readalong-playlist__topbar">
        <button type="button" className="readalong-playlist__back" onClick={exit}>{ICONS.back}<span>Back</span></button>
        <div className="readalong-playlist__chapters" role="group" aria-label={`${title}: chapter ${index + 1} of ${parts.length}`}>
          {parts.map((candidate, candidateIndex) => {
            const done = candidateIndex < index || Boolean(progress?.parts?.[candidate.id]?.completedAt);
            const current = candidateIndex === index;
            const fill = current ? percent : done ? 100 : 0;
            return (
              <button key={candidate.id} type="button"
                className={`readalong-playlist__chapter${current ? ' is-current' : ''}${done ? ' is-complete' : ''}`}
                disabled={current}
                onClick={() => changePart(candidateIndex)}
                aria-label={`Play ${candidate.title}`}>
                <span className="readalong-playlist__chapter-name">{candidate.title}</span>
                <span className="readalong-playlist__chapter-fill" aria-hidden="true"><i style={{ width: `${fill}%` }} /></span>
              </button>
            );
          })}
        </div>
      </header>
      <div className="readalong-playlist__stage">
        <Suspense fallback={<p className="readalong-playlist__empty">Loading read along…</p>}>{player}</Suspense>
      </div>
      <footer className="readalong-playlist__controls">
        <button type="button" className="readalong-playlist__control" onClick={() => changePart(index - 1)} disabled={!index}>
          {ICONS.prev}<span>Previous</span>
        </button>
        <button type="button" className="readalong-playlist__control" onClick={() => skip(-15)}>
          {ICONS.rewind}<span>Back 15s</span>
        </button>
        <button type="button" className="readalong-playlist__control readalong-playlist__control--primary" onClick={toggle}>
          {paused ? ICONS.play : ICONS.pause}
          <span>{complete ? 'Play again' : paused ? 'Play' : 'Pause'}</span>
        </button>
        <button type="button" className="readalong-playlist__control" onClick={() => skip(15)}>
          {ICONS.forward}<span>Ahead 15s</span>
        </button>
        <button type="button" className="readalong-playlist__control" onClick={() => changePart(index + 1)} disabled={index === parts.length - 1}>
          {ICONS.next}<span>Next</span>
        </button>
      </footer>
    </section>
  );
}
