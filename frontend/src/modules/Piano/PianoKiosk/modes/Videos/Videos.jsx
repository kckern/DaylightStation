import { useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import CourseGrid from './CourseGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';

/**
 * Videos mode — passive lectures from a configured Plex collection.
 * Three views: course grid → course detail (lectures) → player.
 * Collection id comes from piano config `videos.plexCollection` (a Plex
 * collection ratingKey, optionally `plex:`-prefixed).
 */
export function Videos() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-videos' }), []);
  const { config } = usePianoKioskConfig();
  const collection = config.videos.plexCollection;
  const [course, setCourse] = useState(null);
  const [lecture, setLecture] = useState(null);

  // Guardrail: keep the tablet screen awake while a lecture is playing (passive
  // playback produces no MIDI/touch, which would otherwise trip the screensaver).
  useKeepScreenAwake('video', !!lecture);

  if (lecture) {
    return (
      <PianoVideoPlayer
        lecture={lecture}
        onBack={() => { logger.info('piano.video-close', {}); setLecture(null); }}
      />
    );
  }
  if (course) {
    return (
      <CourseDetail
        course={course}
        onPlay={(item) => { logger.info('piano.video-play', { contentId: item.plex || item.id }); setLecture(item); }}
        onBack={() => setCourse(null)}
      />
    );
  }
  return (
    <CourseGrid
      collection={collection}
      onSelect={(item) => { logger.info('piano.course-open', { id: item.id }); setCourse(item); }}
    />
  );
}

export default Videos;
