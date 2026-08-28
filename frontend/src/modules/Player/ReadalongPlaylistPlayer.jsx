import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePlayerController from './usePlayerController.js';
import { getLogger } from '../../lib/logging/Logger.js';
import { createMediaGate } from '../../lib/Player/gate/mediaGate.js';
import { resolvePause } from '../../lib/Player/gate/pauseArbiter.js';
import { GATE_ID } from '../../lib/Player/gate/gateIds.js';

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

// --- the required-companion clamp ------------------------------------------
// A REQUIRED companion is the one a worksheet's gate row depends on, so the two
// cheap ways to shorten it — raise the rate, drag the scrubber forward — are
// refused here as well as on the server. This is NOT the security boundary: the
// server drops the ranges of any sample above 1x and never saw the seconds a
// seek skipped, so a client that lied about either earns nothing. The clamp
// exists so a child does not spend a chapter walking into a wall they cannot
// see, and is deliberately generous in the one direction that costs nothing —
// rewinding, and re-listening to already-heard audio, stay completely free.
//
// An OPTIONAL companion keeps every affordance it ever had. Nothing below
// changes for it.

/**
 * The furthest point a child may jump to in this part, or null for "no ceiling".
 *
 * A finished chapter is heard end to end, so it is free to roam; an unfinished
 * one is capped at the furthest position reached — whichever is greater of what
 * the server already recorded and what this session has watched go past.
 */
// --- the completion card ---------------------------------------------------
// Finishing a required companion releases a FINISH CODE — letters from A–E the
// child copies onto their worksheet's gate row. A sheet with a blank or wrong
// gate row does not pass however well it scored, so this card is the only place
// the letters are ever shown to a child, and everything about it turns on one
// rule: IT RENDERS FROM THE SERVER'S ANSWER, never from this component's belief
// that playback finished. `Player.handleResilienceExhausted` calls the same
// `clear()` a real ending does; a stream that died at 0:05 and one that played
// through are indistinguishable here.

/**
 * The four things the server's `gate` can say, and the ONLY discriminator that
 * separates them: `{satisfied:false, code:null, remainingParts:0}` is the answer
 * for an optional companion with no gate at all, for a required one whose code
 * record is missing, AND for a handler that recorded nothing — so neither
 * `satisfied` nor `remainingParts` can carry this branch.
 *
 * NOT the gate-ROW vocabulary (`satisfied`/`blank`/`wrong`/`exhausted`, from
 * `companionCode.mjs`). That one grades a scanned sheet — what the child marked
 * on paper. This one describes the COMPANION — whether the reading has been
 * finished. They are deliberately different words for deliberately different
 * facts, and nothing here should ever branch on a row status.
 */
const GATE = Object.freeze({
  NONE: 'none',           // optional: nothing gates, nothing to finish
  OPEN: 'open',           // satisfied; `code` carries the letters
  CLOSED: 'closed',       // required and not yet done
  UNAVAILABLE: 'unavailable', // the gate could not be read — tell a grown-up
});

/**
 * The letters, in order, with nothing between them.
 *
 * A hand-copied twin of `formatCode` in `#domains/school/companionCode.mjs`,
 * for the same reason `useCheckpointGate` duplicates `seekCeilingFor`: a
 * frontend module cannot import a backend domain one. `#domains/*` is a Node
 * subpath import in the ROOT package.json and `frontend/vite.config.js` aliases
 * only `@` and the `@shared-*` trees, so the import would resolve in vitest and
 * fail the browser build. The backend is the authority; this is presentation.
 *
 * NOTHING UNUSABLE IS EVER RENDERED AS BLANK — null, never `''`. An empty string
 * is the printed spelling of "no code at all", and a gate row a child copies a
 * blank into is a gate no child can pass. A caller must treat null as "show the
 * tell-a-grown-up slip", not as an empty code.
 */
const formatCode = (code) => {
  if (!Array.isArray(code) || code.length === 0) return null;
  const letters = code.map((letter) => (typeof letter === 'string' ? letter.trim().toUpperCase() : ''));
  return letters.every((letter) => /^[A-E]$/.test(letter)) ? letters.join('') : null;
};

/**
 * Read a verdict off a progress response, or null when the answer says nothing.
 *
 * A handler with no `recordProgress` answers a bare `{ok:true, tracked:false}`:
 * no `gate`, no `satisfied`, and `undefined` is falsy — which must NOT read as
 * "not satisfied, keep listening". Nothing is known, so nothing is said.
 *
 * `gate` is preferred and `code` is the fallback, in that order: a response that
 * carries usable letters and claims satisfaction has told us everything the
 * `open` branch needs, even if it never named the gate.
 */
const verdictFrom = (answer) => {
  if (!answer || typeof answer !== 'object') return null;
  const code = formatCode(answer.code);
  const gate = typeof answer.gate === 'string' && answer.gate
    ? answer.gate
    : (answer.satisfied === true && code ? GATE.OPEN : null);
  if (!gate) return null;
  return { gate, code, remainingParts: Number.isFinite(answer.remainingParts) ? answer.remainingParts : null };
};

const seekCeilingFor = ({ saved = {}, reachedSeconds = 0 } = {}) => {
  const duration = Number(saved.durationSeconds) || 0;
  // A completed chapter with no recorded length cannot name a ceiling. Failing
  // OPEN is right here and only here: the part is already finished, so there is
  // nothing left ahead of the child to skip.
  if (saved.completedAt) return duration > 0 ? duration : null;
  return Math.max(Number(saved.lastPositionSeconds) || 0, reachedSeconds || 0);
};

/**
 * Generic text-and-audio playlist shell. Content labels and ids come from the
 * caller. Built for a 1280x800 touch kiosk used by children: one chapter rail
 * up top (each chip is both the picker and that chapter's progress bar), the
 * verse stage owning everything in between, one transport row at the bottom.
 *
 * @param {'required'|'optional'} [participation] — whether this companion gates
 *   a worksheet. It arrives on the backend handler's `open()` effect and is
 *   threaded here by `SchoolApp`. Anything other than `'required'` is treated
 *   as optional, so an absent value can only ever loosen the clamp, never
 *   impose one on a companion that was never gated.
 */
export default function ReadalongPlaylistPlayer({
  title = 'Read along', parts = [], progress = {}, participation = 'optional', onProgress, onExit,
}) {
  const required = participation === 'required';
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
  // Furthest media position this session has actually watched go past, per part.
  // A ref, not state: it changes several times a second and nothing renders off
  // it — the gate and `skip` both read it through `ceiling`.
  const reached = useRef({});
  // The live ceiling, so the transport can bound a jump without waiting for a
  // render. `null` means unclamped (an optional companion, or a finished part).
  const ceiling = useRef(null);
  const gateRef = useRef(null);
  // The latest thing the SERVER said about the gate, and whether this child has
  // reached the end of the last part. Two pieces of state, because they answer
  // different questions: an already-satisfied companion shows its code the
  // moment it opens, while "keep listening" is only worth saying to a child who
  // just watched the reading run out.
  const [verdict, setVerdict] = useState(null);
  const [finishAsked, setFinishAsked] = useState(false);
  // A response can land after the child has already left. Nothing to render to.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
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
    let rate = Number.isFinite(reported) && reported > 0 ? reported : 1;
    // The rate clamp lives on the sample loop rather than on a control, because
    // this shell HAS no speed control: a rate above 1 can only arrive from
    // outside it (the `player:cycle-playback-rate` screen action, or a rate this
    // collection's playback session restored). Player's controlled rate would
    // re-assert whatever the session holds, so pinning the element on every
    // sample — the same technique `useCommonMediaController` uses to re-assert
    // its own rate — is what actually holds. Debug level: if something did fight
    // us tick by tick this would otherwise flood the store.
    if (required && el && rate > 1) {
      try { el.playbackRate = 1; } catch (_) { /* not an element we can write to */ }
      logger.debug('readalong.rate-clamped', { partId, from: rate });
      rate = 1;
    }
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
    // The high-water mark advances ONLY over audio that was banked as played —
    // the same evidence the server counts. Deriving it from the raw playhead
    // instead would let one seek the clamp happened to miss (the gate binds on
    // the first render after the lazy Player resolves) move the frontier to
    // wherever the seek landed, which is the whole thing being refused.
    reached.current[partId] = Math.max(reached.current[partId] ?? 0, at);
  }, [ctrl, logger, required]);

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

  /**
   * Send one report and take the server's answer as the truth about the gate.
   *
   * EVERY report is a chance to learn the verdict, not just the last one: the
   * answer is a point-in-time snapshot and under a two-sibling race the child
   * whose write lands first is told a part is outstanding while the household is
   * satisfied a millisecond later. A card rendered once from the first response
   * would be stale for as long as it stayed up; the next ping corrects it.
   *
   * Never throws: `onProgress` is the caller's fetch and this runs on a timer,
   * from a DOM event, and from an effect. A rejected write leaves the last known
   * verdict standing rather than replacing it with a wrong one.
   */
  const report = useCallback(async (payload) => {
    if (!onProgress) return null;
    let answer = null;
    try {
      answer = await onProgress(payload);
    } catch (err) {
      logger.warn('readalong.progress-failed', {
        partId: payload?.partId ?? null, error: String(err?.message || err),
      });
      return null;
    }
    const next = verdictFrom(answer);
    if (next && alive.current) {
      setVerdict(next);
      logger.debug('readalong.gate-verdict', {
        partId: payload?.partId ?? null, gate: next.gate, remainingParts: next.remainingParts,
      });
    }
    return next;
  }, [onProgress, logger]);
  const reportRef = useRef(report);
  reportRef.current = report;

  const write = useCallback((completed = false) => {
    if (!part || !onProgress) return Promise.resolve(null);
    const { playedRanges, rate } = drainCoverage(part.id);
    return report({
      partId: part.id, positionSeconds: last.currentTime, durationSeconds: last.duration, completed,
      // `maxRate` on the wire, not `rate`. The server's allowlist
      // (RecordLessonCompanionProgress) names this field exactly, and anything
      // it does not name is DROPPED — so a mismatch here does not error, it
      // silently reports no rate at all. The server reads a missing rate as
      // normal speed and banks the ranges, which is precisely the fast-forward
      // the drop rule exists to refuse. The name is the whole guarantee.
      playedRanges, maxRate: rate,
    });
  }, [part, onProgress, last, drainCoverage, report]);

  /**
   * THE SIBLING CASE, and the most important behaviour here: a child who opens a
   * companion their household has ALREADY satisfied sees the code immediately,
   * with no playback at all.
   *
   * The code cannot arrive on the descriptor — the handler's `open()` effect
   * carries the playlist, the saved positions and `participation`, and the
   * letters live somewhere else entirely (the household's code record, reached
   * through `codeRef`). `/companions/:id/progress` is the only endpoint that
   * reads the gate, so opening one asks it once, up front.
   *
   * The probe BANKS NOTHING: no ranges, rate 1, and `positionSeconds` echoes
   * what the server already recorded rather than the playhead's 0 — writing a
   * real 0 here would wipe the saved resume position of every companion a child
   * so much as opened.
   */
  useEffect(() => {
    if (!required) return;
    const current = latest.current.part;
    if (!current) return;
    const saved = progress?.parts?.[current.id] ?? {};
    logger.info('readalong.gate-probe', { partId: current.id });
    reportRef.current({
      partId: current.id,
      positionSeconds: Number(saved.lastPositionSeconds) || 0,
      durationSeconds: Number(saved.durationSeconds) || 0,
      playedRanges: [], maxRate: 1,
    });
    // ONCE PER MOUNT, deliberately. `report` and `progress` both change identity
    // as the shell renders, and re-running this would put a write on the wire
    // per render — the identity-churn shape this house has already paid for once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  /**
   * The seek clamp, borrowed whole from the checkpoint gate rather than rebuilt:
   * `mediaGate` already owns the DOM `seeking` listener, the frame of slack a
   * browser lands a seek within, the element rebinding across a resilience
   * remount, and a never-throws contract. Only the CEILING is ours.
   *
   * The verdict never blocks — `resolvePause` turns `{blocked:false, seekCeiling}`
   * into a PLAYING decision, and `mediaGate` resumes only what it paused itself,
   * so nothing here can touch the transport. A ceiling is a standing rule and is
   * enforced with playback running free, which is exactly what this wants: play
   * on, rewind at will, but never past the frontier.
   */
  useEffect(() => {
    const gate = createMediaGate({ getMediaEl: () => ctrl.getMediaEl?.() ?? null, logger });
    gateRef.current = gate;
    return () => { gateRef.current = null; gate.detach(); };
  }, [ctrl, logger]);

  const syncGate = useCallback(() => {
    const current = latest.current.part;
    const next = required && current
      ? seekCeilingFor({
        saved: progress?.parts?.[current.id] ?? {},
        reachedSeconds: reached.current[current.id] ?? 0,
      })
      : null;
    ceiling.current = next;
    gateRef.current?.apply(resolvePause({
      gates: [{ blocked: false, id: GATE_ID.COMPANION, seekCeiling: next }],
    }));
  }, [required, progress]);

  // No deps: this is the supervisor. `mediaGate` re-reads the element on every
  // apply, so running once per render is what binds a player that mounted after
  // the last verdict change (the lazy Player resolves without re-rendering this
  // shell) and what re-binds one the resilience layer swapped underneath us.
  // Cheap by construction — `apply` publishes only when a field actually moved.
  useEffect(syncGate);

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
      report({
        partId: part?.id, positionSeconds: next.currentTime, durationSeconds: next.duration,
        playedRanges, maxRate: rate,
      });
    }
  }, [report, part, progress, ctrl, logger, observePlayed, drainCoverage]);
  const changePart = useCallback((nextIndex) => {
    const bounded = Math.max(0, Math.min(parts.length - 1, nextIndex));
    logger.info('readalong.part-change', { from: index, to: bounded, partId: parts[bounded]?.id });
    write(false);
    setLast({ currentTime: 0, duration: 0 });
    setPaused(true);
    setIndex(bounded);
  }, [parts, index, write, logger]);
  /**
   * AWAIT THE WRITE, and render from what comes back.
   *
   * This is the same callback `Player.handleResilienceExhausted` invokes, so
   * "playback ended" is not evidence of anything — a stream that died at 0:05
   * arrives here exactly as one that played through. Only the server's verdict
   * separates them, so the last part shows nothing until the answer lands.
   */
  const ended = useCallback(async () => {
    logger.info('readalong.part-complete', { partId: part?.id, index });
    const answer = await write(true);
    if (index < parts.length - 1) {
      changePart(index + 1);
      return;
    }
    if (!alive.current) return;
    setFinishAsked(true);
    logger.info('readalong.finished', {
      partId: part?.id, gate: answer?.gate ?? null, remainingParts: answer?.remainingParts ?? null,
    });
  }, [write, index, parts.length, changePart, logger, part]);
  const skip = useCallback((delta) => {
    const from = ctrl.getCurrentTime();
    const max = ctrl.getDuration() || last.duration || Infinity;
    // "Ahead 15s" is bounded by the ceiling as well as by the duration, so the
    // button lands ON the high-water mark rather than being snapped back off it
    // by the clamp a beat later — a child gets a jump that visibly stops, not
    // one that appears to fail.
    const limit = ceiling.current == null ? max : Math.min(max, ceiling.current);
    const to = Math.max(0, Math.min(limit, from + delta));
    logger.debug('readalong.skip', { delta, from: Math.round(from), to: Math.round(to), ceiling: ceiling.current });
    ctrl.seek(to);
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

  /**
   * What the card should say, or null for "say nothing".
   *
   * `open` shows the code whenever it is known — the moment the companion is
   * opened, if the household had already satisfied it. Everything else is worth
   * saying only to a child who has just watched the reading run out, so it waits
   * on `finishAsked`; nagging a child mid-chapter about a gate they have not
   * reached yet would be worse than silence.
   *
   * An `open` gate whose letters are unusable falls to the slip, NOT to a blank
   * code — see `formatCode`.
   */
  const card = useMemo(() => {
    if (!verdict || verdict.gate === GATE.NONE) return null;
    if (verdict.gate === GATE.OPEN && verdict.code) return { kind: 'code', code: verdict.code };
    if (!finishAsked) return null;
    if (verdict.gate === GATE.CLOSED) return { kind: 'more' };
    return { kind: 'unavailable' }; // `unavailable`, or an `open` with no usable code
  }, [verdict, finishAsked]);

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
        {/* Over the stage, not instead of it: the reading stays exactly where
            it was, so a child who wants to hear a verse again can dismiss this
            and carry on. `role="status"` because it appears without a tap. */}
        {card && (
          <div className="readalong-playlist__finish" role="status" data-testid="readalong-finish">
            {card.kind === 'code' && (
              <>
                <p className="readalong-playlist__finish-lead">You finished the reading. Write these letters on your paper:</p>
                {/* The whole point of the card, so it is the loudest thing on
                    the screen — this is a 1280x800 kiosk a child copies from
                    across a table. The size is CSS; jsdom cannot see it. */}
                <p className="readalong-playlist__code" data-testid="readalong-code">{card.code}</p>
                <button type="button" className="readalong-playlist__finish-action" onClick={exit}>Done</button>
              </>
            )}
            {card.kind === 'more' && (
              <>
                <p className="readalong-playlist__finish-lead">Keep listening — there is more to hear before your letters are ready.</p>
                <button type="button" className="readalong-playlist__finish-action" onClick={() => setFinishAsked(false)}>Keep going</button>
              </>
            )}
            {card.kind === 'unavailable' && (
              <>
                {/* No number, no code, no advice a child can act on alone: the
                    gate could not be read, and only a grown-up can fix that. */}
                <p className="readalong-playlist__finish-lead">Something is wrong with this reading. Tell a grown-up.</p>
                <button type="button" className="readalong-playlist__finish-action" onClick={exit}>Done</button>
              </>
            )}
          </div>
        )}
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
