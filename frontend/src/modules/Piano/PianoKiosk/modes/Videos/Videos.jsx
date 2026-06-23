import { useMemo, useCallback } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import usePianoList from '../../usePianoList.js';
import CourseGrid from './CourseGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import { lectureContentId } from './lectureMeta.js';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Videos mode — passive lectures from a configured Plex collection.
 *
 * Routed so the course id and lecture contentId live in the URL (deep-linkable,
 * survives reload, physical/browser Back becomes an "up" gesture):
 *   index          → course grid
 *   :courseId      → course detail (lecture list)
 *   :courseId/:lectureId → player
 *
 * All navigation is RELATIVE (navigate('subpath') / navigate('..')) so the mode
 * works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 * Collection id comes from piano config `videos.plexCollection` (a Plex
 * collection ratingKey, optionally `plex:`-prefixed).
 */
export function Videos() {
  const { config } = usePianoKioskConfig();
  const collection = config.videos.plexCollection;
  return (
    <Routes>
      <Route index element={<CourseGridRoute collection={collection} />} />
      <Route path=":courseId" element={<CourseDetailRoute />} />
      <Route path=":courseId/:lectureId" element={<LecturePlayerRoute />} />
    </Routes>
  );
}

/** Course grid → push the selected course id (relative). */
function CourseGridRoute({ collection }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const navigate = useNavigate();
  return (
    <CourseGrid
      collection={collection}
      onSelect={(item) => { logger.info('piano.course-open', { id: item.id }); navigate(idOf(item.id)); }}
    />
  );
}

/** Course detail → push the lecture contentId (relative); Back goes up a level. */
function CourseDetailRoute() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { courseId } = useParams();
  const navigate = useNavigate();
  const course = useMemo(() => ({ id: courseId }), [courseId]);
  return (
    <CourseDetail
      course={course}
      onPlay={(item) => {
        const contentId = lectureContentId(item);
        logger.info('piano.video-play', { contentId });
        navigate(`${contentId}`);
      }}
      onBack={() => navigate('..', { relative: 'path' })}
    />
  );
}

/**
 * Player route. Re-resolves the lecture from the cached /playable endpoint so a
 * cold deep-link works (the lecture object isn't in memory after a reload). The
 * URL segment is the same `lectureContentId(item)` used to push it, so the
 * match is stable both warm and cold.
 */
function LecturePlayerRoute() {
  const { courseId, lectureId } = useParams();
  const navigate = useNavigate();
  const { data: lectures } = usePianoList(
    `api/v1/fitness/show/${idOf(courseId)}/playable`,
    (r) => r?.items ?? [],
  );
  const lecture = useMemo(
    () => (lectures || []).find((l) => String(lectureContentId(l)) === String(lectureId)) || null,
    [lectures, lectureId],
  );

  // Stable so PianoVideoPlayer can memoize the heavy Player element on it
  // (an unstable onBack would defeat the memo and remount the video).
  const goBack = useCallback(() => navigate('..', { relative: 'path' }), [navigate]);

  // Keep the tablet screen awake while a lecture is playing (passive playback
  // produces no MIDI/touch, which would otherwise trip the screensaver).
  useKeepScreenAwake('video', true);

  if (lectures === null) return <div className="piano-mode__placeholder">Loading…</div>;
  if (!lecture) {
    return (
      <div className="piano-mode__placeholder">
        This lecture can’t be played.{' '}
        <button type="button" onClick={goBack}>Back</button>
      </div>
    );
  }
  return <PianoVideoPlayer lecture={lecture} onBack={goBack} />;
}

export default Videos;
