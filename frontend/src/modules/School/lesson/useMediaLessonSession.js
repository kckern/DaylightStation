/**
 * useMediaLessonSession — the living-room MEDIA LESSON's whole state machine,
 * driven by one WebSocket topic, one snapshot fetch, and the four moments the
 * backend cannot see.
 *
 * Sibling of `School/reading/useReadingSession.js` and built to read like it:
 * same `useWebSocketSubscription` shape, same stable-listener refs, same
 * doctrine. The difference is what is at stake — a reading session credits a
 * story, this one holds a HARD GATE in front of a child, so several of the
 * rules below are stricter than the reading screen's equivalents.
 *
 * SIX VIEWS:
 *   idle        no lesson dispatched to this room — the widget renders nothing
 *   open        the snapshot is in, the media has not reported a frame yet
 *   playing     the Player owns the screen
 *   checkpoint  the gate is blocking and a question is up
 *   celebrating a ✓ beat — either one checkpoint cleared, or the whole lesson
 *               finished (`celebration` says which)
 *   done        terminal: the lesson ended, was abandoned, or died server-side
 *
 * ## THE GATE IS THE BACKEND'S, AND THIS HOOK NEVER OPENS IT ON ITS OWN WORD
 *
 * `clearedIds` grows in exactly ONE place: a `lessonAnswer` reply that says
 * `checkpointCleared`. Not on a failed POST (the child may have been right, but
 * nothing recorded it), not on a rewind, not on a timeout. Everything else that
 * looks like an escape hatch — the notice, `escape()`, `exitLesson` — ENDS the
 * lesson rather than releasing the checkpoint. That asymmetry is the feature.
 *
 * ## ATTRIBUTION IS FROZEN AT OPEN AND NEVER RE-READ
 *
 * `learnerRef` is written once per session, from the snapshot, and is what the
 * score placard names and every log line carries. The server pins attribution
 * on its own side (answers carry only a `sessionId`), so this ref cannot
 * mis-credit a grade — but it can mis-credit the SCREEN, and a re-broadcast
 * naming a sibling who wandered past would do exactly that. Same hazard, same
 * rule, as the reading session's D4.
 *
 * ## `ended` IS THE ONLY COMPLETION
 *
 * The Player calls `clear` for every reason it stops — end of content, a load
 * failure, a grown-up pressing back — so only the media element's own `ended`
 * may POST `/ended`. `notePlaybackDismissed` records nothing, ever.
 *
 * ## THREE DECISIONS THIS HOOK MAKES (delegated at design time)
 *
 * **1. A 410 ends the lesson, and DROPS THE GATE on the way out.** `schoolApi`
 * passes 410 through untouched because only the caller knows what a gone
 * session means; here it means the server no longer has this lesson, so no
 * answer can ever clear the checkpoint the child is sitting in front of.
 * Leaving `checkpoints` in place would leave `useCheckpointGate` blocking a
 * paused picture with no question that can release it — the frozen TV the
 * design forbids. So `endBecauseGone` empties the checkpoint list (the gate's
 * documented "no list, no gate" safe direction), stops the heartbeat, and goes
 * to `done`. Nothing is skipped by this: the session is gone, so there is no
 * completion left to claim, and the durable evidence already written stays
 * written. The heartbeat is the first thing to learn the session died, which is
 * why it reads its own status instead of discarding it.
 *
 * **2. The ✓ beat is SHORT for a checkpoint and LONG for the lesson, and the
 * gate is held through the short one.** `clearedIds` is published at the END of
 * the checkpoint beat, not when the reply lands — otherwise the gate releases
 * mid-✓ and the video walks out from under the child's own success. A
 * checkpoint is a punctuation mark in a 20-minute lesson (five of them at nine
 * seconds each is most of a minute of nothing), so its beat is ~1.2s and it is
 * the SAME for the last checkpoint as for any other: the milestone is finishing
 * the lesson, not clearing its final gate, and a long beat there would sit on a
 * paused picture with the lesson still to run. The long celebration belongs to
 * `ended`. If the media ends DURING a checkpoint beat, `ended` wins: the
 * pending clear is flushed immediately (the server already recorded it — the
 * delay was only ever cosmetic) and the beat's timer is cancelled, so it cannot
 * fire back over the lesson's own ending.
 *
 * **3. LAST DISPATCH WINS — but a repeat of the SAME session is ignored.** A
 * new `sessionId` replaces whatever is running, even mid-checkpoint: DoNow's
 * occupancy and approval ladder have already ruled that this room now shows
 * that lesson, and a screen that refused would leave the TV on lesson A while
 * the server believes it dispatched lesson B. Nothing is lost by yielding — the
 * abandoned lesson's cleared checkpoints and furthest-watched are durable, so
 * it resumes tomorrow exactly where it stopped. The reading session reaches the
 * same answer from "the session IS the screen". A REPEAT of the running
 * sessionId is a different thing (a re-broadcast, a reconnect, a second wake)
 * and is dropped: re-fetching would yank a playing lesson back to `open`, and
 * re-reading the snapshot's learner is precisely the attribution leak above.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import { schoolApi } from '../schoolApi.js';
import getLogger from '../../../lib/logging/Logger.js';

// Lazy module logger — `getLogger()` at import time binds before the app has
// configured the logger (CLAUDE.md, "Module-Level Loggers").
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'school', component: 'school-lesson' });
  return _logger;
}

/** How often the playhead is reported while playing. */
export const HEARTBEAT_MS = 15000;
/** The ✓ beat for one cleared checkpoint. Punctuation, not a ceremony. */
export const CHECKPOINT_CELEBRATE_MS = 1200;
/** The ✓ beat for the whole lesson. This one is the milestone. */
export const LESSON_CELEBRATE_MS = 6000;

/** One topic per room, mirroring `reading:{location}`. */
export const lessonTopic = (location) => `lesson:${location}`;

const EMPTY = Object.freeze([]);

/**
 * The broadcaster's event key. `learnerCardActions` (reading) writes `event`;
 * the media-lesson adapter's specified broadcast writes `type`. Both are
 * accepted rather than guessed at, because the two producers are written by
 * different tasks and a screen that ignores the wrong spelling shows a black
 * TV with nothing in any log to say why.
 */
const eventNameOf = (payload) => payload?.event ?? payload?.type ?? null;

/** Seconds, or null — never a fabricated 0 (see `schoolApi.lessonPosition`). */
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);

/**
 * Where "rewind and rewatch" lands: the START of the passage this question is
 * about, i.e. the previous checkpoint, or the beginning when there is none.
 */
export function rewindTargetFor(checkpoint, checkpoints) {
  const at = finiteOrNull(checkpoint?.at);
  if (at === null) return 0;
  let previous = 0;
  for (const cp of Array.isArray(checkpoints) ? checkpoints : EMPTY) {
    const cpAt = finiteOrNull(cp?.at);
    if (cpAt === null || cpAt >= at) continue;
    if (cpAt > previous) previous = cpAt;
  }
  return previous;
}

/**
 * @param {object} opts
 * @param {string} [opts.location] the room this screen is — one topic per room.
 * @param {(seconds: number, meta: {checkpointId: string|null}) => void} [opts.onRewind]
 *   the widget's seek. The hook never touches a media element.
 * @param {(tone: 'success'|'warn'|'error') => void} [opts.onCue] optional audio.
 * @param {number} [opts.heartbeatMs] / [opts.checkpointCelebrateMs] / [opts.lessonCelebrateMs]
 *   overridable for tests; the defaults are the exported constants.
 */
export function useMediaLessonSession({
  location = 'livingroom',
  onRewind = null,
  onCue = null,
  heartbeatMs = HEARTBEAT_MS,
  checkpointCelebrateMs = CHECKPOINT_CELEBRATE_MS,
  lessonCelebrateMs = LESSON_CELEBRATE_MS,
} = {}) {
  const [view, setView] = useState('idle');
  const [lesson, setLesson] = useState(null);        // { sessionId, contentId, title, resumePosition }
  const [learner, setLearner] = useState(null);      // { id, name } — frozen at open
  const [checkpoints, setCheckpoints] = useState(EMPTY);
  const [clearedIds, setClearedIds] = useState(EMPTY);
  const [dueCheckpoint, setDueCheckpoint] = useState(null);
  const [celebration, setCelebration] = useState(null); // 'checkpoint' | 'lesson' | null
  const [notice, setNotice] = useState(null);        // { tone, title, detail }

  // Refs mirror what the async paths need to read WITHOUT re-subscribing or
  // going stale inside a closure that outlives its render.
  const viewRef = useRef(view);
  viewRef.current = view;
  const noticeRef = useRef(notice);
  noticeRef.current = notice;
  const checkpointsRef = useRef(checkpoints);
  checkpointsRef.current = checkpoints;
  const dueRef = useRef(dueCheckpoint);
  dueRef.current = dueCheckpoint;

  const sessionIdRef = useRef(null);
  const learnerRef = useRef(null);          // FROZEN at open; never re-read
  const positionRef = useRef(null);
  const startedRef = useRef(false);
  const endedRef = useRef(false);
  const answeringRef = useRef(false);
  const pendingClearRef = useRef(null);     // the id the ✓ beat is holding back
  const celebrateTimer = useRef(null);
  /**
   * Bumped on every session change and every teardown. Every async
   * continuation compares against it, so a reply to the PREVIOUS lesson cannot
   * write into the current one (the reading session's `pickRef` identity check,
   * generalized: here there are four call sites, not one).
   */
  const generationRef = useRef(0);
  const mounted = useRef(true);

  const onRewindRef = useRef(onRewind);
  onRewindRef.current = onRewind;
  const onCueRef = useRef(onCue);
  onCueRef.current = onCue;

  useEffect(() => () => {
    mounted.current = false;
    generationRef.current += 1;
    clearTimeout(celebrateTimer.current);
  }, []);

  const cue = useCallback((tone) => {
    try { onCueRef.current?.(tone); } catch { /* a cue is never worth the screen */ }
  }, []);

  /**
   * Notices here do NOT expire on a timer, unlike the reading screen's. At a
   * blocked checkpoint the notice IS the escape affordance — it is the only
   * thing telling a stranded child that back will get them out — and an
   * affordance that vanishes after seven seconds strands them again.
   */
  const say = useCallback((next) => setNotice(next), []);

  /** Post the playhead. Never surfaces as an error; 410 is the exception. */
  const sendPosition = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const gen = generationRef.current;
    // UNDEFINED, not 0: an unknown position must reach the server as absent.
    const res = await schoolApi.lessonPosition(sessionId, positionRef.current ?? undefined);
    if (!mounted.current || gen !== generationRef.current) return;
    if (res.status === 410) { endBecauseGoneRef.current?.('position'); return; }
    if (!res.ok) {
      logger().warn('school.lesson.position.failed', { sessionId, status: res.status });
    }
  }, []);

  /**
   * The session is gone server-side. See header decision 1: this is the branch
   * that guarantees a dead session cannot leave a frozen picture.
   */
  const endBecauseGone = useCallback((where) => {
    if (viewRef.current === 'done' || viewRef.current === 'idle') return;
    logger().warn('school.lesson.session.gone', { sessionId: sessionIdRef.current, where });
    generationRef.current += 1;          // orphan every reply still in flight
    clearTimeout(celebrateTimer.current);
    endedRef.current = true;             // nothing may POST /ended for a dead session
    pendingClearRef.current = null;
    setCheckpoints(EMPTY);               // an empty list cannot block (useCheckpointGate)
    setDueCheckpoint(null);
    setCelebration(null);
    say({ tone: 'warn', title: 'That lesson is finished', detail: 'You can start it again from your list.' });
    setView('done');
  }, [say]);
  // `sendPosition` is defined first (it is a dependency of the heartbeat effect
  // and must stay `[]`-stable), so it reaches this through a ref.
  const endBecauseGoneRef = useRef(endBecauseGone);
  endBecauseGoneRef.current = endBecauseGone;

  /** A deliberate stop: back at a notice, or the widget bailing. Credits nothing. */
  const exitLesson = useCallback((reason) => {
    if (viewRef.current === 'done') return;
    logger().info('school.lesson.exit', { sessionId: sessionIdRef.current, reason, view: viewRef.current });
    generationRef.current += 1;
    clearTimeout(celebrateTimer.current);
    pendingClearRef.current = null;
    // `done` is terminal, so it must not leave a blocking verdict behind it:
    // the widget tears the Player down, but for however long that takes, the
    // gate must not be the reason a picture is stuck.
    setCheckpoints(EMPTY);
    setDueCheckpoint(null);
    setCelebration(null);
    setView('done');
  }, []);

  /** Publish a held-back clear: the gate opens HERE, and only from a server reply. */
  const commitClear = useCallback(() => {
    const id = pendingClearRef.current;
    clearTimeout(celebrateTimer.current);
    if (!id) return;
    pendingClearRef.current = null;
    setClearedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setDueCheckpoint(null);
    setCelebration(null);
    if (viewRef.current !== 'done') setView('playing');
  }, []);

  /** Fetch the snapshot and take up the lesson. One generation per session. */
  const openLesson = useCallback(async (sessionId) => {
    const gen = ++generationRef.current;
    clearTimeout(celebrateTimer.current);
    sessionIdRef.current = sessionId;
    learnerRef.current = null;
    positionRef.current = null;
    startedRef.current = false;
    endedRef.current = false;
    answeringRef.current = false;
    pendingClearRef.current = null;
    setLesson(null);
    setLearner(null);
    setCheckpoints(EMPTY);
    setClearedIds(EMPTY);
    setDueCheckpoint(null);
    setCelebration(null);
    say(null);
    setView('open');

    const res = await schoolApi.lessonSession(sessionId);
    if (!mounted.current || gen !== generationRef.current) return;
    if (!res.ok || !res.data) {
      // Nothing has mounted yet, so there is no picture to strand: fall back to
      // idle and say why. 410 here is the same story as any other failure —
      // the lesson never started.
      logger().error('school.lesson.session.fetch-failed', { sessionId, status: res.status });
      sessionIdRef.current = null;
      setView('idle');
      cue('error');
      say(res.status === 410
        ? { tone: 'error', title: 'That lesson is finished', detail: 'You can start it again from your list.' }
        : { tone: 'error', title: "I couldn't open that lesson", detail: 'Tell a grown-up, then try again.' });
      return;
    }

    const data = res.data;
    const who = data.learner ?? {
      id: data.learnerId ?? null,
      name: data.learnerName ?? data.displayName ?? null,
    };
    learnerRef.current = who;                            // FROZEN — see header
    setLearner(who);
    setLesson({
      sessionId: data.sessionId ?? sessionId,
      contentId: data.contentId ?? null,
      title: data.title ?? null,
      resumePosition: finiteOrNull(data.resumePosition),
    });
    setCheckpoints(Array.isArray(data.checkpoints) ? data.checkpoints : EMPTY);
    setClearedIds(Array.isArray(data.cleared ?? data.clearedIds) ? (data.cleared ?? data.clearedIds) : EMPTY);
    positionRef.current = finiteOrNull(data.resumePosition);
    logger().info('school.lesson.session.open', {
      sessionId, learnerId: who?.id ?? null, contentId: data.contentId ?? null,
      checkpoints: Array.isArray(data.checkpoints) ? data.checkpoints.length : 0,
      resumePosition: positionRef.current,
    });
  }, [cue, say]);

  // ── the four moments the backend cannot see ──────────────────────────────

  /** The widget's sampled playhead. A ref: this ticks ~10Hz and must not render. */
  const notePosition = useCallback((seconds) => {
    const next = finiteOrNull(seconds);
    if (next !== null) positionRef.current = next;
  }, []);

  /** The first frame. */
  const notePlaybackStarted = useCallback(async () => {
    if (startedRef.current || !sessionIdRef.current) return;
    startedRef.current = true;
    logger().info('school.lesson.playback.started', {
      sessionId: sessionIdRef.current, learnerId: learnerRef.current?.id ?? null,
      position: positionRef.current,
    });
    if (viewRef.current === 'open') setView('playing');
    await sendPosition();
  }, [sendPosition]);

  /** The media element's own `ended` — the ONLY thing that may claim the lesson. */
  const notePlaybackCompleted = useCallback(async () => {
    if (endedRef.current) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    endedRef.current = true;
    const gen = generationRef.current;
    // A ✓ beat in progress is flushed rather than cancelled: the server already
    // recorded that clear, and `/ended` is about to be refused if we pretend
    // otherwise. The beat's own timer dies with it (see `commitClear`).
    commitClear();
    logger().info('school.lesson.playback.completed', {
      sessionId, learnerId: learnerRef.current?.id ?? null, position: positionRef.current,
    });

    const res = await schoolApi.lessonEnded(sessionId);
    if (!mounted.current || gen !== generationRef.current) return;
    if (res.status === 410) {
      // The media finished and the server had already let the session go. There
      // is nothing to resume and nothing alarming to say — but no ✓ either: this
      // hook never celebrates a lesson it could not see recorded.
      logger().info('school.lesson.completion.gone', { sessionId });
      say({ tone: 'warn', title: 'That lesson had already finished', detail: null });
      setView('done');
      return;
    }
    if (!res.ok) {
      logger().error('school.lesson.completion.failed', { sessionId, status: res.status });
      cue('error');
      say({ tone: 'error', title: "I couldn't save that lesson", detail: 'Tell a grown-up — you watched it, it just needs writing down.' });
      setView('done');
      return;
    }
    const remaining = Array.isArray(res.data?.remaining) ? res.data.remaining : EMPTY;
    if (res.data?.completed === false) {
      // The gate was bypassed somehow (a stuck seek suppresses enforcement).
      // Say what is still owed rather than showing a ✓ nobody earned.
      logger().warn('school.lesson.completion.refused', { sessionId, remaining: remaining.length });
      cue('warn');
      say({
        tone: 'warn',
        title: remaining.length === 1 ? 'One question is still waiting' : `${remaining.length} questions are still waiting`,
        detail: 'Start the lesson again to finish them.',
      });
      setView('done');
      return;
    }
    cue('success');
    setCelebration('lesson');
    setView('celebrating');
    clearTimeout(celebrateTimer.current);
    celebrateTimer.current = setTimeout(() => {
      if (!mounted.current) return;
      setCelebration(null);
      setView('done');
    }, lessonCelebrateMs);
  }, [commitClear, cue, lessonCelebrateMs, say]);

  /**
   * The Player went away WITHOUT `ended` — a load failure, a bail, a grown-up
   * pressing back. Records nothing, ever.
   */
  const notePlaybackDismissed = useCallback(() => {
    if (endedRef.current || !sessionIdRef.current) return;
    const neverPlayed = !startedRef.current;
    logger().info('school.lesson.playback.abandoned', {
      sessionId: sessionIdRef.current, position: positionRef.current, neverPlayed,
    });
    // Only the media that never played needs explaining. A grown-up pressing
    // back already knows why the lesson stopped.
    if (neverPlayed) {
      cue('warn');
      say({ tone: 'warn', title: "That lesson wouldn't play", detail: 'Nothing was lost — try it again in a minute.' });
    }
    exitLesson(neverPlayed ? 'never-played' : 'dismissed');
  }, [cue, exitLesson, say]);

  /**
   * The gate's ruling, handed back by the widget (which owns the playhead).
   * Edge-driven on the DUE CHECKPOINT, not on its id: after "rewind and
   * rewatch" the very same checkpoint must be able to stop the child again.
   */
  const noteCheckpointDue = useCallback((checkpoint) => {
    const here = viewRef.current;
    if (here === 'idle' || here === 'done') return;
    if (!checkpoint) {
      // The gate stopped blocking for a reason we did not cause (a rewind that
      // landed, a seek). Never leave a question up over playing video.
      if (here === 'checkpoint') { setDueCheckpoint(null); setView('playing'); }
      return;
    }
    // A ✓ beat is holding this same checkpoint back on purpose; the gate is
    // still reporting it due and must not re-open the question over the ✓.
    if (here === 'celebrating') return;
    if (here === 'checkpoint' && dueRef.current?.id === checkpoint.id) return;
    logger().info('school.lesson.checkpoint.hit', {
      sessionId: sessionIdRef.current, learnerId: learnerRef.current?.id ?? null,
      checkpointId: checkpoint.id, at: checkpoint.at, position: positionRef.current,
    });
    setDueCheckpoint(checkpoint);
    say(null);
    setView('checkpoint');
    cue('warn');
    // The gate position is the single most useful heartbeat there is, and the
    // periodic one is about to stop (see the heartbeat effect).
    sendPosition();
  }, [cue, say, sendPosition]);

  /**
   * Grade one answer. The reply is returned so the overlay can shake, reshuffle
   * or tick — this hook decides only what happens to the LESSON.
   */
  const answer = useCallback(async (checkpointId, itemId, given) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return { ok: false, status: 0, reason: 'no-session' };
    if (viewRef.current !== 'checkpoint') return { ok: false, status: 0, reason: 'not-at-a-checkpoint' };
    // A remote's double-click must not spend two attempts on one answer.
    if (answeringRef.current) return { ok: false, status: 0, reason: 'in-flight' };
    answeringRef.current = true;
    const gen = generationRef.current;
    say(null);

    const res = await schoolApi.lessonAnswer(sessionId, { checkpointId, itemId, given });
    if (!mounted.current || gen !== generationRef.current) {
      return { ok: false, status: res.status, reason: 'stale' };
    }
    answeringRef.current = false;

    if (res.status === 410) {
      endBecauseGone('answer');
      return { ok: false, status: 410, reason: 'gone' };
    }
    if (!res.ok || !res.data) {
      // THE HARD GATE: a client cannot clear a checkpoint on its own word, so
      // nothing moves. The child is not stranded — the notice is the way out.
      logger().error('school.lesson.checkpoint.answer-failed', { sessionId, checkpointId, itemId, status: res.status });
      cue('error');
      say({
        tone: 'error',
        title: "That didn't send",
        detail: 'Try the answer again — or press back to stop the lesson.',
      });
      return { ok: false, status: res.status, correct: null, checkpointCleared: false };
    }

    const data = res.data;
    logger().info('school.lesson.checkpoint.answered', {
      sessionId, checkpointId, itemId, status: data.status ?? null,
      correct: data.correct ?? null, attempts: data.attempts ?? null,
      checkpointCleared: Boolean(data.checkpointCleared),
    });

    if (data.checkpointCleared) {
      cue('success');
      pendingClearRef.current = checkpointId;
      setCelebration('checkpoint');
      setView('celebrating');
      clearTimeout(celebrateTimer.current);
      // The gate stays blocked for the length of the beat — `commitClear` is
      // what publishes the id, and the video resumes off that.
      celebrateTimer.current = setTimeout(() => { if (mounted.current) commitClear(); }, checkpointCelebrateMs);
    } else if (data.correct === false) {
      cue('warn');
    }
    return { ok: true, status: res.status, ...data };
  }, [checkpointCelebrateMs, commitClear, cue, endBecauseGone, say]);

  /**
   * "Rewind and rewatch" — the option offered beside every wrong answer. It
   * releases the VIEW only: the checkpoint is not cleared, so the gate fires
   * again when the playhead comes back to it.
   */
  const chooseRewind = useCallback(() => {
    const checkpoint = dueRef.current;
    if (viewRef.current !== 'checkpoint' || !checkpoint) return;
    const target = rewindTargetFor(checkpoint, checkpointsRef.current);
    logger().info('school.lesson.checkpoint.rewind', {
      sessionId: sessionIdRef.current, learnerId: learnerRef.current?.id ?? null,
      checkpointId: checkpoint.id, from: positionRef.current, to: target,
    });
    say(null);
    setDueCheckpoint(null);
    setView('playing');
    try {
      onRewindRef.current?.(target, { checkpointId: checkpoint.id });
    } catch (err) {
      logger().error('school.lesson.checkpoint.rewind-failed', {
        checkpointId: checkpoint.id, error: err?.message ?? String(err),
      });
    }
  }, [say]);

  /**
   * Back / escape. A live question is a GATE: back does nothing there. At a
   * notice it is the way out, and the caller can tell which happened.
   */
  const escape = useCallback(() => {
    if (!noticeRef.current) return false;
    // A notice with no lesson behind it (an open that never resolved) has
    // nothing to exit FROM: dismissing it is the whole action, and moving to
    // `done` would hand the widget a terminal view for a lesson that never was.
    if (viewRef.current === 'idle') { say(null); return true; }
    exitLesson('escape');
    return true;
  }, [exitLesson, say]);

  // The heartbeat runs while PLAYING only. At a checkpoint the playhead is not
  // moving, so a periodic repost would carry no information — and the server
  // accepts a checkpoint answer from a stalled session precisely because a
  // child thinking for two minutes is the normal case.
  useEffect(() => {
    if (view !== 'playing') return undefined;
    const id = setInterval(() => { sendPosition(); }, heartbeatMs);
    return () => clearInterval(id);
  }, [view, heartbeatMs, sendPosition]);

  const handle = useCallback((payload) => {
    const event = eventNameOf(payload);
    if (event === 'lesson.open') {
      const sessionId = payload?.sessionId ?? null;
      if (!sessionId) {
        logger().warn('school.lesson.open.no-session', { location });
        return;
      }
      // A re-broadcast of the lesson already running: dropped. See header 3.
      if (sessionId === sessionIdRef.current && viewRef.current !== 'idle' && viewRef.current !== 'done') {
        logger().debug('school.lesson.open.repeat', { sessionId, view: viewRef.current });
        return;
      }
      if (sessionIdRef.current && sessionIdRef.current !== sessionId) {
        logger().info('school.lesson.session.replaced', {
          from: sessionIdRef.current, to: sessionId, during: viewRef.current,
        });
      }
      openLesson(sessionId);
      return;
    }
    logger().debug('school.lesson.event-ignored', { event, location });
  }, [location, openLesson]);

  useWebSocketSubscription(lessonTopic(location), handle, [handle]);

  return {
    view,
    lesson,
    learner,
    checkpoints,
    clearedIds,
    dueCheckpoint,
    celebration,
    notice,
    notePosition,
    notePlaybackStarted,
    notePlaybackCompleted,
    notePlaybackDismissed,
    noteCheckpointDue,
    answer,
    chooseRewind,
    escape,
    exitLesson,
    dismissNotice: () => say(null),
  };
}

export default useMediaLessonSession;
