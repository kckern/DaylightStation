import { useMemo, useCallback, useRef, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';
import { usePianoUser } from '../../PianoUserContext.jsx';
import usePianoLessonGate, { PENDING_CAPTION } from '../../usePianoLessonGate.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import CourseGrid from './CourseGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaverHooks.js';
import { usePianoPlayback } from '../../usePianoPlayback.js';
import { lectureContentId } from './lectureMeta.js';
import { isSubcourseShow } from './subcourses.js';
import SubcourseNavigator from './SubcourseNavigator.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';
import { resolveCoursePolicy, nextLectureAfter } from './coursePolicy.js';
import { useCourseTabPolicy } from './useCourseTabPolicy.js';
import { pianoLearningApi } from '../Exercises/pianoLearningApi.js';
import { resolveCourseGroups } from './courseGroups.js';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

// How long the screen-awake hold outlives a lecture dropping out of "playing".
// Sized to ride out rebuffering and stall-recovery pauses (observed at a 45s
// cadence on the yellow-room tablet) without keeping an abandoned paused tab
// lit for long. Leaving the player releases the hold immediately regardless.
const VIDEO_WAKE_GRACE_MS = 150_000;

/**
 * Videos mode — passive lectures from configured Plex collections.
 *
 * Routed so the course id and lecture contentId live in the URL (deep-linkable,
 * survives reload, physical/browser Back becomes an "up" gesture):
 *   index          → course grid
 *   :courseId      → course detail (lecture list)
 *   :courseId/:lectureId → player
 *
 * All navigation is RELATIVE (navigate('subpath') / navigate('..')) so the mode
 * works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 * Collections come from piano config `videos.collections` (grouped into tabs) or
 * the legacy flat `videos.plexCollection`.
 */
export function Videos({ source, PlayerComponent }) {
  const { config } = usePianoKioskConfig();
  // `source` (a videos-shaped config: { collections } or { plexCollection }) lets
  // the same grid→detail→player flow back another menu item (e.g. Playalong).
  // Defaults to the Courses config. `PlayerComponent` swaps the lecture player so
  // a mode (e.g. Singalong) can reuse this grid/detail flow with karaoke chrome;
  // defaults to the standard PianoVideoPlayer.
  const videos = source ?? config.videos;
  const groups = useMemo(() => resolveCourseGroups(videos), [videos]);
  return (
    <Routes>
      <Route index element={<CourseGridRoute groups={groups} />} />
      <Route path=":courseId" element={<CourseDetailRoute />} />
      <Route path=":courseId/:lectureId" element={<LecturePlayerRoute PlayerComponent={PlayerComponent} />} />
    </Routes>
  );
}

/**
 * The daily video cap's redirect, shared by all three Videos routes.
 *
 * THE CAP CLOSES DOORS `gated` LEAVES OPEN, and that is deliberate rather than
 * belt-and-braces. `CourseGridRoute`'s header lists the routes the lesson gate
 * does not reach — the exercise checkpoint's `return` deep link, a DoNow push,
 * history, a reload — and calls them residual, which they are for `gated`:
 * their cost is starting the wrong lesson.
 *
 * For the cap they are the main road. The checkpoint's "Continue" replays a
 * stored `/videos/<course>/<lecture>` link, which is an ordinary daily path, so
 * a cap enforced only at the grid would never fire for the child it exists for.
 *
 * It returns to the MENU rather than rendering a locked pane: the menu already
 * carries the caption saying why (PianoMenu's videos tile), and a second copy
 * of that sentence living here is how one rule becomes two.
 */
function useVideoCapRedirect(gate, learnerId, route, logger) {
  const locked = gate.videosLocked === true;
  const { completedToday = null, cap = null } = gate.videos ?? {};
  // From an effect, not from render: render stays pure, and this is the line a
  // parent asking "why can't he open videos?" will search for.
  useEffect(() => {
    if (locked) logger.info('piano.videos.cap-redirected', { learnerId, completedToday, cap, route });
  }, [locked, learnerId, completedToday, cap, route, logger]);
  return locked;
}

/**
 * Course grid → push the selected course id (relative).
 *
 * Under the lesson gate the grid does not exist for that learner: the ONE
 * launcher they have is the lesson card on the menu, and PianoChrome's mode
 * crumb points straight here (`${basePath}/videos`), which is the door a
 * learner walked out of on 2026-09-01 — assigned course → crumb → every course
 * → a lesson from the wrong one. Guests, School-less installs and failed or
 * timed-out reads see the full grid (the hook fails open on purpose).
 *
 * While a named learner's verdict is in flight the grid is withheld — a cold
 * read was measured at 11.1s and a wall tablet that showed the wall for 11s
 * would be teaching the escape. It says so rather than going blank: a dark
 * pane on a kiosk reads as a crash, and the menu's pending state uses these
 * same words (PianoMenu's `piano-home__pending` caption).
 *
 * NOTE (2026-09-01): this closes the GRID. `CourseDetailRoute` and
 * `LecturePlayerRoute` still take `:courseId` from the URL with no gate read,
 * so a non-assigned course reached without passing the grid still plays.
 * Strongest first:
 *   1. The exercise checkpoint `return` param — first-order and in-app.
 *      `handleAutoAdvance` below builds
 *      `${pianoBase}/videos/${courseId}/${lectureId}` and both passes it as the
 *      `return` query param and persists it through
 *      `pianoLearningApi.rememberCheckpoint` as `returnTo`. `Exercises.jsx`
 *      reads `query.get('return')` and, on a pass, navigates straight to it —
 *      a live deep link into an arbitrary course that never touches the grid.
 *      The exercises dashboard's Continue replays the same stored value
 *      (`next_up.return_to`), so it outlives the session that made it.
 *   2. A DoNow / `useKioskLaunchCommand` push: `onPianoCourseOpen` in
 *      `PianoApp.jsx` → `openPianoCourseLesson` navigates to
 *      `${basePath}/videos/${courseId}/${lessonId}` with no gate read.
 *      Grown-up-initiated, so arguably legitimate.
 *   3. A verdict that flips to gated while a course is already on screen.
 *   4. History back/forward onto a stale `/videos/<other-course>` entry.
 *   5. A reload or a watchdog remount on a stale URL.
 * Full list, and why closing them needs the gate API to return the owed SET
 * rather than one course, under "Residual escape vectors" in
 * docs/_wip/bugs/2026-09-01-piano-lesson-gate-escapes-via-course-grid.md.
 */
export function CourseGridRoute({ groups }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const navigate = useNavigate();
  const { basePath } = usePianoKioskConfig();
  const { currentUser } = usePianoUser();
  const gate = usePianoLessonGate(currentUser);
  const capped = useVideoCapRedirect(gate, currentUser, 'grid', logger);
  const redirected = gate.gated;
  const courseId = gate.course?.id ?? null;
  // Logged from an effect, not from render: render must stay pure, and this is
  // the event the incident was traced by.
  useEffect(() => {
    if (redirected) logger.info('piano.videos.grid-redirected', { learnerId: currentUser, courseId });
  }, [redirected, logger, currentUser, courseId]);

  // `replace` so the grid leaves no history entry to come back to — a pushed
  // one would let Back land here again and bounce straight out a second time.
  // The menu never sends a gated learner to /videos, so this cannot loop.
  if (redirected || capped) return <Navigate to={basePath} replace />;
  // The hook owns who is waiting (a guest never is) and owns the wording, so
  // this screen and the menu cannot drift apart on either.
  if (gate.pending) {
    return (
      <p className="piano-mode__placeholder" role="status">{PENDING_CAPTION}</p>
    );
  }
  return (
    <CourseGrid
      groups={groups}
      onSelect={(item) => { logger.info('piano.course-open', { id: item.id }); navigate(idOf(item.id)); }}
    />
  );
}

/**
 * Show route — fetches the course once and branches: a Plex show labeled
 * `subcourses` drills through the SubcourseNavigator (season → course → lesson);
 * every other course renders the flat/multi-unit CourseDetail. Both receive the
 * single /playable fetch so nothing is fetched twice.
 */
export function CourseDetailRoute() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { courseId } = useParams();
  const { currentUser } = usePianoUser();
  const { basePath } = usePianoKioskConfig();
  const gate = usePianoLessonGate(currentUser);
  const capped = useVideoCapRedirect(gate, currentUser, 'course', logger);
  const navigate = useNavigate();
  const { speakerConnected } = usePianoMidi();
  const playable = usePianoCoursePlayable(idOf(courseId), currentUser);
  const course = useMemo(() => ({ id: courseId }), [courseId]);
  const onPlay = useCallback((item) => {
    const contentId = lectureContentId(item);
    logger.info('piano.video-play', { contentId });
    navigate(`${contentId}`);
  }, [navigate, logger]);

  if (capped) return <Navigate to={basePath} replace />;
  if (isSubcourseShow(playable.info)) {
    return <SubcourseNavigator course={course} playable={playable} onPlay={onPlay} />;
  }
  return <CourseDetail course={course} playable={playable} onPlay={onPlay} speakerDisabled={!speakerConnected} />;
}

/**
 * Player route. Re-resolves the lecture from the cached /playable endpoint so a
 * cold deep-link works (the lecture object isn't in memory after a reload). The
 * URL segment is the same `lectureContentId(item)` used to push it, so the
 * match is stable both warm and cold.
 */
export function LecturePlayerRoute({ PlayerComponent = PianoVideoPlayer }) {
  const capLogger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { courseId, lectureId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { config, basePath } = usePianoKioskConfig();
  const { currentUser } = usePianoUser();
  const lessonGate = usePianoLessonGate(currentUser);
  const capped = useVideoCapRedirect(lessonGate, currentUser, 'lecture', capLogger);
  // Keep the whole response so we can read the show/source title + per-user fields.
  const { items, info, isSequential } = usePianoCoursePlayable(idOf(courseId), currentUser);
  const lectures = items;
  const source = info?.title || '';
  const lecture = useMemo(
    () => (lectures || []).find((l) => String(lectureContentId(l)) === String(lectureId)) || null,
    [lectures, lectureId],
  );

  // Per-user course policy (piano.yml videos.user_policies): gate on/off,
  // end-of-lecture behavior, speed permission. Folded together with the owning
  // TAB's policy (videos.collections) so speed needs both a permitted person
  // and permitted content, and a singing tab can drop the play-a-note gate.
  const userPolicy = useMemo(() => resolveCoursePolicy(config.videos, currentUser), [config, currentUser]);
  const policy = useCourseTabPolicy(config.videos, idOf(courseId), userPolicy);
  const nextLecture = useMemo(() => nextLectureAfter(lectures, lectureId), [lectures, lectureId]);
  const checkpoint = lecture?.piano?.checkpoint ?? null;
  const checkpointPending = Boolean(checkpoint && !lecture?.checkpointStatus?.passed);

  // The shared Player reacts to `ended` too — its own end-of-content listener
  // is registered at element-creation time, BEFORE PianoVideoPlayer's, so in
  // production it actually FIRES FIRST: clear() → this goBack runs, then
  // onAutoAdvance sets the flag. React 18 batches both navigations into one
  // commit, so the user still lands on the next lecture, but the guard as
  // written can't intercept that ordering. It's kept anyway as
  // belt-and-suspenders for the reverse ordering (onAutoAdvance first) and for
  // any non-natural clear() call that races a real auto-advance — a scenario
  // this ref still protects. The flag resets once the route lands on the new
  // lecture.
  const advancingRef = useRef(false);
  useEffect(() => { advancingRef.current = false; }, [lectureId]);

  // Stable so PianoVideoPlayer can memoize the heavy Player element on it
  // (an unstable onBack would defeat the memo and remount the video).
  const goBack = useCallback(() => {
    if (advancingRef.current) return;
    navigate('..', { relative: 'path' });
  }, [navigate]);

  // Hard speaker gate: playback on the kiosk is worthless (and confusing)
  // without audio, so a lost BT speaker link exits the player immediately —
  // not a pause, not a mute. `speakerConnected` flips false only after 3
  // consecutive bad heartbeats (see usePianoBridgeNotes), so this isn't
  // trigger-happy on a single blip.
  const { speakerConnected } = usePianoMidi();
  useEffect(() => {
    if (!speakerConnected) {
      getLogger().child({ component: 'piano-videos' }).info('piano.video.speaker-gate-exit', { courseId, lectureId });
      goBack();
    }
  }, [speakerConnected, goBack, courseId, lectureId]);

  const handleAutoAdvance = useCallback(async () => {
    if (checkpointPending && checkpoint?.exercise_id) {
      advancingRef.current = true;
      const markerIndex = location.pathname.indexOf('/videos/');
      const pianoBase = markerIndex >= 0 ? location.pathname.slice(0, markerIndex) : '/piano';
      const returnPath = nextLecture
        ? `${pianoBase}/videos/${encodeURIComponent(courseId)}/${encodeURIComponent(lectureContentId(nextLecture))}`
        : `${pianoBase}/videos/${encodeURIComponent(courseId)}`;
      const query = new URLSearchParams({
        intent: 'challenge',
        return: returnPath,
        requirement: JSON.stringify(checkpoint),
        // The lesson the child was watching, so the exercise says why it is on
        // screen ("Pass this to finish Lesson 3") instead of a bare
        // "Pass challenge" over a bank title. Same value this hands the
        // pending-checkpoint record below, which is where the RESUME path
        // (the exercises dashboard's Continue) reads its own label from.
        ...(lecture.label || lecture.title ? { label: lecture.label || lecture.title } : {}),
      });
      getLogger().child({ component: 'piano-videos' }).info('piano.video.checkpoint-open', {
        courseId, lectureId, exerciseId: checkpoint.exercise_id,
      });
      if (currentUser && currentUser !== 'guest') {
        await pianoLearningApi.rememberCheckpoint(currentUser, lectureContentId(lecture), {
          title: lecture.label || lecture.title,
          courseTitle: source,
          returnTo: returnPath,
          requirement: checkpoint,
        });
      }
      navigate(`${pianoBase}/exercises/run/${encodeURIComponent(checkpoint.exercise_id)}?${query}`, { replace: true });
      return;
    }
    if (!nextLecture) {
      getLogger().child({ component: 'piano-videos' }).info('piano.video.auto-advance-end-of-course', { courseId });
      navigate('..', { relative: 'path' });
      return;
    }
    advancingRef.current = true;
    const nextId = lectureContentId(nextLecture);
    getLogger().child({ component: 'piano-videos' }).info('piano.video.auto-advance-next', { from: lectureId, to: nextId });
    // `replace: true` — the shared Player's own end-clear→goBack may fire in
    // the same batched commit (see advancingRef comment above); replacing
    // instead of pushing keeps that a no-op history-wise, so the natural path
    // nets exactly one new history entry instead of a spurious extra one.
    navigate(`../${nextId}`, { relative: 'path', replace: true });
  }, [checkpoint, checkpointPending, courseId, currentUser, lecture, lectureId, location.pathname, navigate, nextLecture, source]);

  // Keep the tablet screen awake while the lecture plays (passive playback
  // produces no MIDI/touch that would otherwise reset the screensaver), with a
  // grace window so the hold survives the constant brief drops out of "playing"
  // that rebuffering and stall-recovery cause — see useKeepScreenAwake. A
  // genuinely abandoned paused tab still sleeps, just a few minutes later.
  // `playing` is the global play/pause state PianoVideoPlayer maintains.
  const { playing } = usePianoPlayback();
  useKeepScreenAwake('video', playing, VIDEO_WAKE_GRACE_MS);

  // AFTER every hook above, not beside the cap read at the top of this
  // component: an early return there would skip the rest and break the rules of
  // hooks on the very first capped render. First branch in the render, though —
  // ahead of the loading skeleton, so a capped learner never watches a player
  // spin up before being turned around.
  if (capped) return <Navigate to={basePath} replace />;
  if (lectures === null) return <section className="piano-mode piano-mode--videos"><SkeletonStage /></section>;
  if (!lecture) {
    return (
      <div className="piano-mode__placeholder">
        This lecture can’t be played.{' '}
        <button type="button" onClick={goBack}>Back</button>
      </div>
    );
  }
  return (
    <PlayerComponent
      key={lectureId}
      lecture={lecture}
      source={source}
      onBack={goBack}
      isSequential={isSequential}
      speedEnabled={policy.allowSpeed}
      engagementTimeoutSeconds={config.videos?.engagement_timeout_seconds ?? 90}
      engagementGateEnabled={policy.engagementGate}
      onAutoAdvance={checkpointPending || policy.autoAdvance ? handleAutoAdvance : null}
    />
  );
}

export default Videos;
