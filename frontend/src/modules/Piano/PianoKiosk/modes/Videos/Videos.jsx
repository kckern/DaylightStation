import { useMemo, useCallback, useRef, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import CourseGrid from './CourseGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
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

/** Course grid → push the selected course id (relative). */
function CourseGridRoute({ groups }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const navigate = useNavigate();
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
  const navigate = useNavigate();
  const { speakerConnected } = usePianoMidi();
  const playable = usePianoCoursePlayable(idOf(courseId), currentUser);
  const course = useMemo(() => ({ id: courseId }), [courseId]);
  const onPlay = useCallback((item) => {
    const contentId = lectureContentId(item);
    logger.info('piano.video-play', { contentId });
    navigate(`${contentId}`);
  }, [navigate, logger]);

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
  const { courseId, lectureId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { config } = usePianoKioskConfig();
  const { currentUser } = usePianoUser();
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
