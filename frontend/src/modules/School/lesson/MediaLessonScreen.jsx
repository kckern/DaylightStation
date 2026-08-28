/**
 * MediaLessonScreen — the `school-lesson` widget on the living-room TV, and the
 * composition the whole hard-gated-media-lesson feature resolves to.
 *
 * Sibling of `School/reading/ReadingSessionScreen.jsx` and built to read like
 * it: it RENDERS NOTHING unless a lesson is live, so the screen's own menu and
 * screensaver are untouched by this widget existing; it mounts the Player
 * through `useScreenOverlay()`, the same slot a cast and a reading session's
 * book use; it keeps STABLE listener refs, because the media element outlives
 * several renders and `removeEventListener` matches by reference; and it treats
 * `clear` (the Player stopping for ANY reason) as categorically different from
 * the element's own `ended`.
 *
 * Everything below that is what a GATE adds to a reading session.
 *
 * ## THE TWO HALVES, AND WHY THEY ARE TWO
 *
 * `MediaLessonScreen` sits in the screen's LAYOUT. `LessonStage` sits in the
 * OVERLAY SLOT, above it. They are separate components because the overlay is
 * rendered by `ScreenOverlayProvider` as a SIBLING of its children — so no
 * React context this widget provides can reach it, and the props it was mounted
 * with are frozen at `showOverlay` time. Re-calling `showOverlay` on every state
 * change would work (same component type = a props update, not a remount) but it
 * pushes a provider `setState`, and its `[fullscreen]` effect re-emits
 * `screen:overlay-mounted` on the ActionBus every time. So live state crosses
 * the boundary through a tiny external store instead: ONE `showOverlay` call per
 * session, with props that never change.
 *
 * The stage owns everything downstream of the media element — the 10 Hz clock,
 * the checkpoint gate, the enforcement, the frame and the question card — which
 * also keeps 10 Hz re-renders inside the overlay subtree and off the screen's
 * layout entirely.
 *
 * ## THE CHAIN, IN ORDER
 *
 *   `useMediaClockState`  the playhead. `SurroundFrame` samples NOTHING — under
 *                         `SurroundHost` it is `SurroundStage` that runs this
 *                         hook and passes the four clock props down, and this
 *                         is a DIRECT frame mount, so the clock is ours to run.
 *   → `notePosition`      the session's heartbeat payload (a ref write, no render)
 *   → `useCheckpointGate` the AUTHORITY: position + checkpoints + cleared → verdict
 *   → `noteCheckpointDue` the session's view machine (edge-driven, by the hook)
 *   → `useMediaGate`      ENFORCEMENT on the element. One per element, always.
 *   → `CheckpointQuizOverlay`  while a question is up.
 *
 * `player.seeking` is deliberately NOT passed to `useMediaGate`. Its JSDoc is
 * explicit that `seeking.active` suspends ALL enforcement, and that a slot which
 * sticks true is indistinguishable from having no gate at all — the easiest hole
 * to open in a checkpoint. Nothing here needs it: the arbiter's anti-thrash rule
 * is protecting against a clamp fighting a seek, and this gate does not clamp
 * (it has a `seekCeiling`, and `mediaGate` applies it), while our own rewind
 * writes `currentTime` once, to a position the gate is not blocking on anyway.
 *
 * ## THREE DECISIONS DELEGATED TO THIS TASK
 *
 * **1. Something renders between `lesson.open` and the first frame.** The wake
 * path no longer reloads the page, but the Player still has to resolve and open
 * a Plex stream, and the screen is otherwise showing a menu or a framed painting.
 * A child who was told the TV was about to start their lesson would watch the
 * painting for several seconds with no acknowledgement that anything landed. So
 * `open` paints a CURTAIN — the child's face, their name, the lesson's title —
 * in the widget's own layout, after one `dismissOverlay()` takes the screensaver
 * down. It is the same shape the reading session's `open` view is, for the same
 * reason, and it costs nothing: the Player mounts over the top of it.
 *
 * **2. If the Player calls `clear` while a checkpoint is up, THE PLAYER WINS and
 * the lesson ends.** The gate holds a pause on an element that is going away;
 * holding it harder would mean a question card over a dead surface with no
 * transport left to release. So `clear` runs the same path it runs anywhere
 * else: detach, dismiss, `notePlaybackDismissed` — which records NOTHING, and
 * whose `exitLesson` empties `checkpoints` and `dueCheckpoint` precisely so that
 * a terminal view cannot leave a blocking verdict behind it. Nothing is skipped
 * by this: the checkpoint stays uncleared and durable server-side, the lesson
 * cannot be claimed complete (`/ended` is never posted, and the backend refuses
 * `media_completed` while checkpoints are outstanding anyway), and the child
 * resumes at that same question. The gate loses the ARGUMENT and keeps the
 * GUARANTEE, which is the right way round.
 *
 * **3. The surround frame is for VIDEO only.** The feature is format-neutral —
 * `media` resolves a manifest, which may be audio — and all three of the frame's
 * rules are geometry of a video box: it locks the media 16:9, it sizes the
 * footer to the MEASURED media-box width, and it top-anchors the picture and
 * gives the slack to the band. With an `<audio>` element there is no media box,
 * so the footer would size against nothing and the placard would straddle the
 * edge of nothing. The frame therefore mounts ALWAYS and is `active` only for a
 * `<video>`: its inactive shell is `display: contents`, generating no box and
 * re-parenting nothing, which is exactly why `active` is a prop rather than a
 * conditional wrapper. An audio lesson loses the checkpoint map and the score
 * placard; it keeps the gate, the question card and the ✓, which are the parts
 * that make the lesson hard-gated. Chrome shaped for audio is a design task, not
 * a wiring one — the suppression is logged so the log store can say how often it
 * actually happens.
 *
 * ## THE ESCAPE LEAK, AND THE ONE MECHANISM THAT CLOSES IT
 *
 * `ActionBus.emit` BROADCASTS. `CheckpointQuizOverlay` subscribing to `escape`
 * does not consume it, and `ScreenActionHandler` subscribes to the same action
 * on the same bus. On the living-room screen that handler walks
 * `actions.escape` from `living-room.yml`, whose second step is
 * `when: overlay_active → do: dismiss_overlay` — and our Player IS the mounted
 * fullscreen overlay. So without something in between, back at a live question
 * tears the Player down and ends the lesson, which is exactly the exit the gate
 * is supposed to refuse.
 *
 * The framework already has the seam for this and nothing in production uses it:
 * `registerEscapeInterceptor`. `ScreenActionHandler.handleEscape` consults it
 * FIRST and returns early when it reports handled, and `consumeBack` (the
 * hardware/popstate path) defers on it too. So the widget claims escape for
 * exactly the window a checkpoint is up, and gives it back the moment the ✓ beat
 * ends. The interceptor returns `true` unconditionally in that window — refusing
 * is the whole point, and the lesson's own handlers (the overlay's blocked-line,
 * and `useMediaLessonSession.escape`, which exits only at a notice) decide what
 * back MEANS there. The slot is single-valued and last-writer-wins; nothing else
 * in the app registers one today, and the cleanup unregisters rather than
 * restoring, which is the framework's own contract.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import PropTypes from 'prop-types';
import Player from '../../Player/Player.jsx';
import SurroundFrame from '../../Surround/SurroundFrame.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { useScreenOverlay } from '../../../screen-framework/overlays/ScreenOverlayProvider.jsx';
import { useScreenAction } from '../../../screen-framework/input/useScreenAction.js';
import { useMediaClockState } from '../../../lib/Player/useMediaClock.js';
import { useMediaGate } from '../../../lib/Player/gate/useMediaGate.js';
import { useCheckpointGate } from './useCheckpointGate.js';
import { useMediaLessonSession } from './useMediaLessonSession.js';
import CheckpointQuizOverlay from './CheckpointQuizOverlay.jsx';
// SIDE-EFFECT IMPORT, AND IT IS LOAD-BEARING. `SurroundHost` is what imports
// `Surround/builtins.js`; `SurroundFrame` imports no registrations at all, so a
// direct mount must bring its own or every region resolves null and warns
// `surround.module.missing`. `Surround/builtins.js` is deliberately NOT imported
// — the definition below names only lesson modules, and pulling the concert-hall
// chrome into a school bundle for nothing is the dependency this feature keeps out.
import './surround/registerLessonSurround.js';
import getLogger from '../../../lib/logging/Logger.js';
import './MediaLessonScreen.scss';

/**
 * The lesson's surround definition, INLINE. There is no content sidecar to
 * resolve it from: a lesson's chrome comes from its SESSION, which is why this
 * is a direct `SurroundFrame` mount and not a `SurroundHost` one.
 *
 * Both modules are placed in a slot they declare (`registerLessonSurround.js`):
 * the map is a strip and belongs under the picture, the placard is a badge that
 * straddles the top edge. `height: 'fill'` hands the band's slack to the map,
 * which is the region the frame's SCSS expects to absorb it.
 */
const LESSON_SURROUND_DEFINITION = Object.freeze({
  regions: {
    top: { module: 'lesson-score' },
    bottom: { module: 'checkpoint-map', height: 'fill' },
  },
});

const EMPTY = Object.freeze([]);

/** The stage's view of the lesson before the widget has published anything. */
const IDLE_SNAPSHOT = Object.freeze({
  view: 'idle',
  celebration: null,
  checkpoints: EMPTY,
  clearedIds: EMPTY,
  dueCheckpoint: null,
  notice: null,
  learner: null,
});

/**
 * The smallest thing that can carry live state across the overlay boundary.
 * Deliberately not a context and not a re-`showOverlay`: see the header.
 * `set` always notifies — the widget only calls it with a freshly derived
 * snapshot, and an equality check here would duplicate the `useMemo` that
 * produced it.
 */
function createLessonStore(initial) {
  let snapshot = initial;
  const subscribers = new Set();
  return {
    get: () => snapshot,
    set: (next) => { snapshot = next; subscribers.forEach((fn) => fn()); },
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
}

/**
 * What sits in the overlay slot: the frame, the Player inside it, the gate over
 * the element, and the question card when one is up.
 *
 * Every prop is STABLE for the life of the session — they are captured once by
 * `showOverlay` and never handed back. Everything that moves arrives through
 * `store`.
 *
 * @param {object} props
 * @param {{get: Function, subscribe: Function}} props.store live lesson state.
 * @param {object} props.api the session hook's stable callbacks.
 * @param {object} props.play the Player's `play` object — ONE object, built once
 *   per session. An inline literal here is the identity-churn shape that once
 *   opened 495 Plex transcode sessions.
 * @param {() => (HTMLMediaElement|null)} props.getMediaEl
 * @param {(el: HTMLMediaElement|null) => void} props.onMediaRef
 * @param {() => void} props.clear the Player is done, for ANY reason.
 * @param {string} props.mediaKind `'video'` | `'audio'` | `null` until attached.
 */
export function LessonStage({ store, api, play, getMediaEl, onMediaRef, clear, logger = null }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const contentId = play?.contentId ?? null;
  const log = useMemo(
    () => logger ?? getLogger().child({ app: 'school', component: 'media-lesson-stage' }),
    [logger],
  );

  const { position, duration, playing, seeking } = useMediaClockState({
    getMediaEl, contentId, logger: log,
  });

  const { verdict, dueCheckpoint, approaching } = useCheckpointGate({
    position,
    checkpoints: state.checkpoints,
    clearedIds: state.clearedIds,
    logger: log,
  });

  // A fresh array and a fresh verdict every render is SAFE here, and is what
  // that hook's §4 asks for: it stabilizes the arbiter's DECISION by comparing
  // five scalars, so no caller-side identity churn can reach an `apply`.
  useMediaGate({ getMediaEl, verdicts: [verdict], contentId, logger: log });

  // The playhead the session reports to the server. A ref write inside the hook,
  // so this effect firing ten times a second costs one function call.
  useEffect(() => { api.notePosition(position); }, [api, position]);

  // The gate's ruling, handed to the session's view machine. The hook is
  // edge-driven and idempotent for a repeated same-id ruling, so a churned
  // object identity cannot re-open a question over a ✓.
  useEffect(() => { api.noteCheckpointDue(dueCheckpoint ?? null); }, [api, dueCheckpoint]);

  // Decision 3: VIDEO only. `null` (nothing attached yet) is not video, so the
  // frame stays off until the element exists — the same "arrives a beat after
  // the player" shape the frame's entrance choreography was written for.
  const framed = state.mediaKind === 'video';
  useEffect(() => {
    if (!state.mediaKind || framed) return;
    log.info('school.lesson.surround.suppressed', { contentId, mediaKind: state.mediaKind });
  }, [contentId, framed, log, state.mediaKind]);

  const surround = useMemo(() => ({
    id: 'school-lesson',
    definition: LESSON_SURROUND_DEFINITION,
    // The payload Task 16's modules read. `correct` / `total` / `attempts` are
    // deliberately ABSENT: the session hook aggregates no per-item grades, and
    // `LessonScore` already falls back to cleared-of-placeable, which is the
    // truer statement for a gate — a checkpoint is cleared or it is not.
    lesson: {
      checkpoints: state.checkpoints,
      clearedIds: state.clearedIds,
      approaching,
      learner: state.learner,
    },
  }), [approaching, state.checkpoints, state.clearedIds, state.learner]);

  // Mounted for `checkpoint` AND for the checkpoint ✓ beat: the session hook
  // leaves `checkpoint` the moment the clear lands, so a `view === 'checkpoint'`
  // test alone would unmount the card before its own tick could paint.
  const quizUp = state.view === 'checkpoint'
    || (state.view === 'celebrating' && state.celebration === 'checkpoint');

  return (
    <div className="media-lesson-stage" data-testid="media-lesson-stage">
      <SurroundFrame
        active={framed}
        data={surround}
        contentId={contentId}
        position={position}
        duration={duration}
        playing={playing}
        seeking={seeking}
        logger={log}
      >
        <Player play={play} onMediaRef={onMediaRef} clear={clear} />
      </SurroundFrame>

      {quizUp && state.dueCheckpoint ? (
        <CheckpointQuizOverlay
          checkpoint={state.dueCheckpoint}
          onAnswer={api.answer}
          onRewind={api.chooseRewind}
          onEscape={api.escape}
          notice={state.notice}
          learnerName={state.learner?.name ?? state.learner?.displayName ?? null}
        />
      ) : null}
    </div>
  );
}

LessonStage.propTypes = {
  store: PropTypes.object.isRequired,
  api: PropTypes.object.isRequired,
  play: PropTypes.object.isRequired,
  getMediaEl: PropTypes.func.isRequired,
  onMediaRef: PropTypes.func.isRequired,
  clear: PropTypes.func.isRequired,
  logger: PropTypes.object,
};

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <div
      className={`media-lesson__notice media-lesson__notice--${notice.tone}`}
      role="status"
      data-testid="media-lesson-notice"
    >
      <strong>{notice.title}</strong>
      {notice.detail ? <span>{notice.detail}</span> : null}
    </div>
  );
}

Notice.propTypes = { notice: PropTypes.object };

/**
 * @param {object} props
 * @param {string} [props.location] the room this screen is. One topic per room,
 *   off the screen's own widget config (`living-room.yml`).
 * @param {number} [props.checkpointCelebrateMs] / [props.lessonCelebrateMs] the
 *   two ✓ beats. Exposed for the same reason the reading screen exposes
 *   `confirmMs`: a timing the session hook owns, overridable at the seam.
 */
export function MediaLessonScreen({ location = 'livingroom', checkpointCelebrateMs, lessonCelebrateMs } = {}) {
  const {
    showOverlay, dismissOverlay, registerEscapeInterceptor, unregisterEscapeInterceptor,
  } = useScreenOverlay();

  const log = useMemo(() => getLogger().child({ app: 'school', component: 'media-lesson-screen' }), []);

  // The hook needs `onRewind`; the stage needs the hook's callbacks. Refs break
  // the cycle without re-creating either every render.
  const handlers = useRef({});
  const mediaRef = useRef(null);
  const [mediaKind, setMediaKind] = useState(null);

  // STABLE identities, delegating to whatever `handlers` holds this render.
  // Listeners rebuilt per render could never be removed again — the element
  // outlives several renders, and `removeEventListener` matches by reference.
  const listeners = useRef({
    playing: () => handlers.current.notePlaybackStarted?.(),
    ended: () => handlers.current.notePlaybackCompleted?.(),
  });

  const getMediaEl = useCallback(() => mediaRef.current, []);

  const detachMedia = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.removeEventListener('playing', listeners.current.playing);
    el.removeEventListener('ended', listeners.current.ended);
    mediaRef.current = null;
    setMediaKind(null);
  }, []);

  const attachMedia = useCallback((el) => {
    if (!el || el === mediaRef.current) return;
    detachMedia();
    mediaRef.current = el;
    el.addEventListener('playing', listeners.current.playing);
    el.addEventListener('ended', listeners.current.ended);
    const tag = el.tagName?.toLowerCase?.() ?? null;
    setMediaKind(tag === 'video' || tag === 'audio' ? tag : null);
    log.info('school.lesson.media-attached', { tag });
  }, [detachMedia, log]);

  /**
   * "Rewind and rewatch". The hook decides WHERE; the element is the widget's,
   * so the seek is. One write, to a position the gate is not blocking on — no
   * clamp, no `seeking` slot, nothing for the arbiter to suppress.
   */
  const onRewind = useCallback((seconds) => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(seconds)) return;
    el.currentTime = seconds;
  }, []);

  const session = useMediaLessonSession({ location, onRewind, checkpointCelebrateMs, lessonCelebrateMs });

  // Rebound every render so the listeners registered above always call the
  // freshest closures — the element outlives several renders of this component.
  handlers.current.notePlaybackStarted = session.notePlaybackStarted;
  handlers.current.notePlaybackCompleted = session.notePlaybackCompleted;
  handlers.current.notePlaybackDismissed = session.notePlaybackDismissed;

  useEffect(() => detachMedia, [detachMedia]);

  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createLessonStore({ ...IDLE_SNAPSHOT, mediaKind: null });

  const {
    view, celebration, lesson, learner, checkpoints, clearedIds, dueCheckpoint, notice,
  } = session;

  // Everything the stage renders from, in one object, published on change.
  const snapshot = useMemo(() => ({
    view, celebration, checkpoints, clearedIds, dueCheckpoint, notice, learner, mediaKind,
  }), [view, celebration, checkpoints, clearedIds, dueCheckpoint, notice, learner, mediaKind]);
  useEffect(() => { storeRef.current.set(snapshot); }, [snapshot]);

  // Stable by construction: every callback the session hook returns is a
  // `useCallback` over stable deps, so this memo settles on the first render and
  // the frozen prop the stage was mounted with stays correct for the session.
  const api = useMemo(() => ({
    notePosition: session.notePosition,
    noteCheckpointDue: session.noteCheckpointDue,
    answer: session.answer,
    chooseRewind: session.chooseRewind,
    escape: session.escape,
  }), [session.notePosition, session.noteCheckpointDue, session.answer, session.chooseRewind, session.escape]);

  const clearPlayer = useCallback(() => {
    // Decision 2: the Player wins. `notePlaybackDismissed` records nothing and
    // its `exitLesson` empties the checkpoint list, so no verdict is left
    // blocking a surface that is going away.
    detachMedia();
    dismissOverlay();
    handlers.current.notePlaybackDismissed?.();
  }, [detachMedia, dismissOverlay]);

  // ONE MOUNT PER SESSION. Keyed on the session and its content, so the props
  // captured by `showOverlay` are captured once and the Player is never handed a
  // new `play` object mid-lesson.
  const sessionId = lesson?.sessionId ?? null;
  const contentId = lesson?.contentId ?? null;
  const resumePosition = lesson?.resumePosition ?? null;
  useEffect(() => {
    if (!sessionId || !contentId) return;
    // Dismiss first, and claim `high`: `showOverlay` REFUSES to replace a
    // mounted fullscreen overlay at default priority, so a lingering art
    // screensaver would otherwise swallow the lesson the child was sent.
    dismissOverlay();
    showOverlay(LessonStage, {
      store: storeRef.current,
      api,
      play: { contentId, ...(Number.isFinite(resumePosition) && resumePosition > 0 ? { seconds: resumePosition } : null) },
      getMediaEl,
      onMediaRef: attachMedia,
      clear: clearPlayer,
      logger: log,
    }, { chrome: 'media', priority: 'high' });
    log.info('school.lesson.stage.mounted', { sessionId, contentId, resumePosition });
    // Deliberately keyed on the SESSION, not on the callbacks: they are stable,
    // and a re-run would re-push the overlay record for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, contentId]);

  // The lesson is over: the Player goes, and whatever the widget has to say is
  // said in the layout underneath. The long ✓ belongs to the lesson, so the
  // picture comes down for it too.
  const lessonCelebration = view === 'celebrating' && celebration === 'lesson';
  useEffect(() => {
    if (view !== 'done' && !lessonCelebration) return;
    detachMedia();
    dismissOverlay();
  }, [view, lessonCelebration, detachMedia, dismissOverlay]);

  // See the header: `ActionBus.emit` broadcasts, and the living-room screen's
  // own escape chain would dismiss the Player out from under a live question.
  const checkpointUp = view === 'checkpoint'
    || (view === 'celebrating' && celebration === 'checkpoint');
  useEffect(() => {
    if (!checkpointUp || typeof registerEscapeInterceptor !== 'function') return undefined;
    registerEscapeInterceptor(() => true);
    log.debug('school.lesson.escape.claimed', { sessionId });
    return () => {
      unregisterEscapeInterceptor?.();
      log.debug('school.lesson.escape.released', { sessionId });
    };
  }, [checkpointUp, registerEscapeInterceptor, unregisterEscapeInterceptor, log, sessionId]);

  // A notice with no question in front of it is the ONLY place this widget acts
  // on escape; at a checkpoint the card owns it, and the hook is the single
  // authority on what back means there.
  // Bound to the CALLBACK, not to `session` — the hook returns a fresh object
  // every render, so depending on it would unsubscribe and resubscribe this
  // action on every one of them.
  const { escape: escapeSession } = session;
  const dismissNotice = useCallback(() => { escapeSession(); }, [escapeSession]);
  useScreenAction('escape', notice && (view === 'idle' || view === 'done') ? dismissNotice : null);

  // The living-room screen runs the ArtMode screensaver with `showOnLoad`, and a
  // screensaver is a FULLSCREEN OVERLAY. It suppresses itself for active content
  // and for a mounted overlay — and between `lesson.open` and the Player
  // mounting, a lesson is neither. Once, on the way out of `idle`.
  const wasIdle = useRef(true);
  useEffect(() => {
    if (view !== 'idle' && wasIdle.current) {
      dismissOverlay();
      log.debug('school.lesson.screensaver-cleared', { view });
    }
    wasIdle.current = view === 'idle';
  }, [view, dismissOverlay, log]);

  const name = learner?.name || learner?.displayName || null;

  // The screen belongs to the menu when no lesson is dispatched, and to the
  // Player once one is up. The exception is the same one the reading session
  // makes: a lesson that never opened has no picture to strand, and the notice
  // is the only thing that can tell the child why nothing happened.
  if (view === 'idle') {
    if (!notice) return null;
    return (
      <div className="media-lesson media-lesson--idle" data-testid="media-lesson" data-view="idle">
        <Notice notice={notice} />
      </div>
    );
  }
  if (view === 'playing' || view === 'checkpoint') return null;
  if (view === 'celebrating' && celebration === 'checkpoint') return null;

  return (
    <div className={`media-lesson media-lesson--${view}`} data-testid="media-lesson" data-view={view}>
      <Notice notice={notice} />

      {view === 'open' ? (
        <div className="media-lesson__curtain" data-testid="media-lesson-curtain">
          <div className="media-lesson__who">
            <ProfileAvatar id={learner?.id} name={name || learner?.id} size={256} />
            {name ? <h2 className="media-lesson__name">{name}</h2> : null}
          </div>
          <h1 className="media-lesson__title">{lesson?.title || 'Getting your lesson…'}</h1>
          <p className="media-lesson__hint">Starting your lesson</p>
        </div>
      ) : null}

      {lessonCelebration ? (
        <div className="media-lesson__celebrate" data-testid="media-lesson-celebrate">
          <div className="media-lesson__who">
            <ProfileAvatar id={learner?.id} name={name || learner?.id} size={256} />
          </div>
          <h1 className="media-lesson__title">Lesson finished{name ? `, ${name}` : ''}!</h1>
          {lesson?.title ? <p className="media-lesson__hint">{lesson.title}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

MediaLessonScreen.propTypes = {
  location: PropTypes.string,
  checkpointCelebrateMs: PropTypes.number,
  lessonCelebrateMs: PropTypes.number,
};

export default MediaLessonScreen;
