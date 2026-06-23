import { useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import CourseGrid from './CourseGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';

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
