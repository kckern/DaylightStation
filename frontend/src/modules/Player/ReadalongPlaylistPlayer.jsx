import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePlayerController from './usePlayerController.js';
import { getLogger } from '../../lib/logging/Logger.js';

const Player = lazy(() => import('./Player.jsx'));
const THROTTLE_MS = 10000;

// --- played-coverage accumulator -------------------------------------------
// Why this exists: handleResilienceExhausted calls the same clear() callback a
// real end-of-media event does, so "the player said it finished" is not
// evidence of anything. The seconds that actually went past the child's ears
// are, and each report has to carry the interval played SINCE THE LAST REPORT
// paired with that window's rate. The DOM's cumulative mediaEl.played is the
// wrong thing and is deliberately not used: play 0→100s at 2x, drop to 1x for
// one second, and a cumulative range plus a current rate of 1 hands the server
// a whole chapter of honest-looking coverage. A delta and a cumulative range
// are indistinguishable on the wire, so the guarantee has to live here.

// A jump larger than the wall clock allows is a seek, not listening.
const CONTINUITY_SLACK_SECONDS = 0.75; // timer jitter / coalesced timeupdates
// Hard ceiling on one interval regardless of wall time — a long stall or a
// remount gap must never let a resume jump be banked as playback.
const MAX_INTERVAL_SECONDS = 8;

const round3 = (n) => Math.round(n * 1000) / 1000;

/** Sort and coalesce overlapping/touching intervals so one report never double-counts. */
const mergeRanges = (ranges) => ranges
  .map(([start, end]) => [start, end])
  .sort((a, b) => a[0] - b[0])
  .reduce((out, [start, end]) => {
    const tail = out[out.length - 1];
    if (tail && start <= tail[1] + 1e-3) tail[1] = Math.max(tail[1], end);
    else out.push([start, end]);
    return out;
  }, []);

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
  // Played coverage for the part currently mounted. Held in a ref so it
  // outlives the media element — the Player remounts on resilience and
  // anything kept on the element dies with it. `cursor` is the last observed
  // media position, `wall` the Date.now() of that sample.
  const coverage = useRef({ partId: null, ranges: [], maxRate: 0, cursor: null, wall: 0 });
  const logger = useMemo(() => getLogger().child({ component: 'readalong-playlist' }), []);
  const part = parts[index] ?? null;
  const complete = index === parts.length - 1 && last.duration > 0 && last.currentTime >= last.duration - 0.5;

  useEffect(() => {
    logger.info('readalong.mount', { title, parts: parts.length });
    return () => logger.info('readalong.unmount', { title });
    // Mount/unmount bookends only — title/parts are stable for a mounted shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logger]);

  /**
   * Fold one progress sample into the current part's coverage. Records the
   * newly covered interval only — never the cumulative range — and refuses to
   * bridge a gap the wall clock cannot account for, so a scrub to the end
   * earns nothing.
   */
  const observePlayed = useCallback((partId, currentTime, duration) => {
    if (!partId) return;
    const now = Date.now();
    if (coverage.current.partId !== partId) {
      // A part boundary is a hard break: the outgoing chapter's seconds are
      // not the incoming chapter's.
      coverage.current = { partId, ranges: [], maxRate: 0, cursor: null, wall: 0 };
    }
    const acc = coverage.current;
    const from = acc.cursor;
    const elapsed = acc.wall ? Math.max(0, (now - acc.wall) / 1000) : 0;
    const el = ctrl.getMediaEl?.();
    const reported = Number(el?.playbackRate);
    const rate = Number.isFinite(reported) && reported > 0 ? reported : 1;
    const at = Math.max(0, duration > 0 ? Math.min(currentTime, duration) : currentTime);
    acc.cursor = at;
    acc.wall = now;
    if (from === null) return; // first sample of this element only seeds the cursor
    const delta = at - from;
    if (delta <= 0) return; // paused, stalled, or rewound — no new ground covered
    const plausible = Math.min(MAX_INTERVAL_SECONDS, elapsed * rate + CONTINUITY_SLACK_SECONDS);
    if (delta > plausible) {
      logger.debug('readalong.coverage-break', {
        partId, from: round3(from), to: round3(at), delta: round3(delta),
        allowed: round3(plausible), elapsed: round3(elapsed), rate,
      });
      return;
    }
    acc.ranges.push([round3(from), round3(at)]);
    acc.maxRate = Math.max(acc.maxRate, rate);
  }, [ctrl, logger]);

  /**
   * Hand the buffered intervals to a report and clear them, so the next report
   * carries a delta rather than a restatement. The cursor deliberately
   * survives — playback is continuous across a report boundary even though the
   * reported ranges are not. `rate` is the fastest rate seen over these
   * intervals; the server drops the whole sample when it exceeds 1.
   */
  const drainCoverage = useCallback((partId) => {
    const acc = coverage.current;
    if (!partId || acc.partId !== partId) return { playedRanges: [], rate: 1 };
    const playedRanges = mergeRanges(acc.ranges);
    const rate = acc.maxRate || 1;
    acc.ranges = [];
    acc.maxRate = 0;
    if (playedRanges.length) logger.debug('readalong.coverage-flush', {
      partId, segments: playedRanges.length, rate, willBeDropped: rate > 1,
      seconds: round3(playedRanges.reduce((sum, [start, end]) => sum + (end - start), 0)),
    });
    return { playedRanges, rate };
  }, [logger]);

  const write = useCallback((completed = false) => {
    if (!part || !onProgress) return;
    const { playedRanges, rate } = drainCoverage(part.id);
    onProgress({
      partId: part.id, positionSeconds: last.currentTime, durationSeconds: last.duration, completed,
      // `maxRate` on the wire, not `rate`. The server's allowlist
      // (RecordLessonCompanionProgress) names this field exactly, and anything
      // it does not name is DROPPED — so a mismatch here does not error, it
      // silently reports no rate at all. The server reads a missing rate as
      // normal speed and banks the ranges, which is precisely the fast-forward
      // the drop rule exists to refuse. The name is the whole guarantee.
      playedRanges, maxRate: rate,
    });
  }, [part, onProgress, last, drainCoverage]);
  latest.current = { part, last };
  useEffect(() => () => {
    const current = latest.current;
    if (!current.part || !onProgress) return;
    const { playedRanges, rate } = drainCoverage(current.part.id);
    onProgress({
      partId: current.part.id, positionSeconds: current.last.currentTime,
      durationSeconds: current.last.duration, playedRanges, maxRate: rate,
    });
  }, [onProgress, drainCoverage]);

  const receiveProgress = useCallback((payload) => {
    const next = { currentTime: Number(payload?.currentTime) || 0, duration: Number(payload?.duration) || 0 };
    setLast(next);
    if (typeof payload?.paused === 'boolean') setPaused(payload.paused);
    observePlayed(part?.id ?? null, next.currentTime, next.duration);
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
      const { playedRanges, rate } = drainCoverage(part?.id ?? null);
      logger.debug('readalong.progress-write', {
        partId: part?.id, seconds: Math.round(next.currentTime), segments: playedRanges.length, rate,
      });
      onProgress?.({
        partId: part?.id, positionSeconds: next.currentTime, durationSeconds: next.duration,
        playedRanges, maxRate: rate,
      });
    }
  }, [onProgress, part, progress, ctrl, logger, observePlayed, drainCoverage]);
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
