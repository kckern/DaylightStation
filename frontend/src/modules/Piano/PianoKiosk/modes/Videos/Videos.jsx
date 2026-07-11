import { useMemo, useCallback } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';
import { usePianoUser } from '../../PianoUserContext.jsx';
import CourseGrid from './CourseGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import { usePianoPlayback } from '../../PianoPlaybackContext.jsx';
import { lectureContentId } from './lectureMeta.js';
import { isSubcourseShow } from './subcourses.js';
import SubcourseNavigator from './SubcourseNavigator.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Normalize the videos config into ordered tab groups — each `{ label, collections }`
 * becomes one tab whose poster wall merges every collection it lists.
 *
 * Grouped form (preferred): `videos.collections: [{ label, plex: [...] }, ...]`.
 * Legacy form: a flat `videos.plexCollection` (string or array) collapses to a
 * single unlabeled group → a plain grid with no tab bar.
 */
export function resolveCourseGroups(videos) {
  const toList = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
  if (Array.isArray(videos?.collections) && videos.collections.length) {
    return videos.collections
      .map((g) => ({ label: g?.label || null, collections: toList(g?.plex ?? g?.collections) }))
      .filter((g) => g.collections.length);
  }
  const flat = toList(videos?.plexCollection);
  return flat.length ? [{ label: null, collections: flat }] : [];
}

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
  return <CourseDetail course={course} playable={playable} onPlay={onPlay} />;
}

/**
 * Player route. Re-resolves the lecture from the cached /playable endpoint so a
 * cold deep-link works (the lecture object isn't in memory after a reload). The
 * URL segment is the same `lectureContentId(item)` used to push it, so the
 * match is stable both warm and cold.
 */
function LecturePlayerRoute({ PlayerComponent = PianoVideoPlayer }) {
  const { courseId, lectureId } = useParams();
  const navigate = useNavigate();
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

  // Stable so PianoVideoPlayer can memoize the heavy Player element on it
  // (an unstable onBack would defeat the memo and remount the video).
  const goBack = useCallback(() => navigate('..', { relative: 'path' }), [navigate]);

  // Keep the tablet screen awake only while the lecture is ACTIVELY PLAYING
  // (passive playback produces no MIDI/touch that would otherwise reset the
  // screensaver). A paused lecture releases the hold, so an idle paused tab is
  // allowed to sleep — and a tap/MIDI note wakes it. `playing` is the global
  // play/pause state PianoVideoPlayer maintains.
  const { playing } = usePianoPlayback();
  useKeepScreenAwake('video', playing);

  if (lectures === null) return <div className="piano-mode__placeholder">Loading…</div>;
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
      lecture={lecture}
      source={source}
      onBack={goBack}
      isSequential={isSequential}
      engagementTimeoutSeconds={config.videos?.engagement_timeout_seconds ?? 90}
    />
  );
}

export default Videos;
