import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePlayerController from './usePlayerController.js';

const Player = lazy(() => import('./Player.jsx'));
const THROTTLE_MS = 10000;

/** Generic text-and-audio playlist shell. Content labels and ids come from the caller. */
export default function ReadalongPlaylistPlayer({ title = 'Read along', parts = [], progress = {}, onProgress, onExit }) {
  const [index, setIndex] = useState(0);
  const [last, setLast] = useState({ currentTime: 0, duration: 0 });
  const ref = useRef(null);
  const ctrl = usePlayerController(ref);
  const lastWrite = useRef(0);
  const latest = useRef({ part: null, last: { currentTime: 0, duration: 0 } });
  const part = parts[index] ?? null;
  const complete = index === parts.length - 1 && last.duration > 0 && last.currentTime >= last.duration - 0.5;

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
    if (Date.now() - lastWrite.current >= THROTTLE_MS) {
      lastWrite.current = Date.now();
      onProgress?.({ partId: part?.id, positionSeconds: next.currentTime, durationSeconds: next.duration });
    }
  }, [onProgress, part]);
  const changePart = useCallback((nextIndex) => {
    write(false);
    setLast({ currentTime: 0, duration: 0 });
    setIndex(Math.max(0, Math.min(parts.length - 1, nextIndex)));
  }, [parts.length, write]);
  const ended = useCallback(() => {
    write(true);
    if (index < parts.length - 1) changePart(index + 1);
  }, [write, index, parts.length, changePart]);
  const percent = last.duration ? Math.min(100, last.currentTime / last.duration * 100) : 0;
  const resume = progress?.parts?.[part?.id]?.lastPositionSeconds ?? 0;
  const player = useMemo(() => part ? (
    <Player key={part.id} ref={ref} play={{ contentId: part.contentId }} clear={ended} onProgress={receiveProgress} />
  ) : null, [part, ended, receiveProgress]);

  if (!part) return <section className="readalong-playlist"><button type="button" onClick={onExit}>Back to worksheet</button><p>No audio is available for this reading.</p></section>;
  return (
    <section className="readalong-playlist">
      <header className="readalong-playlist__header"><button type="button" onClick={() => { write(false); onExit?.(); }}>← Back to worksheet</button><div><strong>{title}</strong><span>{part.title} · {index + 1} of {parts.length}</span></div></header>
      <div className="readalong-playlist__segments" aria-label={`Playlist progress: part ${index + 1} of ${parts.length}`}>
        {parts.map((candidate, candidateIndex) => <button key={candidate.id} type="button" onClick={() => changePart(candidateIndex)} aria-label={`Play ${candidate.title}`} className={candidateIndex === index ? 'is-current' : candidateIndex < index || progress?.parts?.[candidate.id]?.completedAt ? 'is-complete' : ''}><i style={{ width: `${candidateIndex === index ? percent : candidateIndex < index || progress?.parts?.[candidate.id]?.completedAt ? 100 : 0}%` }} /></button>)}
      </div>
      <div className="readalong-playlist__picker">{parts.map((candidate, candidateIndex) => <button key={candidate.id} type="button" disabled={candidateIndex === index} onClick={() => changePart(candidateIndex)}>{candidateIndex + 1}. {candidate.title}</button>)}</div>
      <div className="readalong-playlist__stage"><Suspense fallback={<p>Loading read along…</p>}>{player}</Suspense></div>
      <footer className="readalong-playlist__controls">
        <button type="button" onClick={() => changePart(index - 1)} disabled={!index}>Previous chapter</button>
        <button type="button" onClick={() => ctrl.seek(Math.max(0, ctrl.getCurrentTime() - 15))}>−15 sec</button>
        <button type="button" onClick={ctrl.toggle}>{complete ? 'Finished' : 'Play / pause'}</button>
        <button type="button" onClick={() => ctrl.seek(Math.min(ctrl.getDuration(), ctrl.getCurrentTime() + 15))}>+15 sec</button>
        <button type="button" onClick={() => changePart(index + 1)} disabled={index === parts.length - 1}>Next chapter</button>
        {resume > 0 && last.currentTime === 0 && <button type="button" onClick={() => ctrl.seek(resume)}>Resume at {Math.floor(resume / 60)} min</button>}
      </footer>
    </section>
  );
}
