// CourseDetail.jsx
import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { lectureStatus } from './lectureMeta.js';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/** A course's lecture list (FitnessShow-style). Tap a lecture to play it. */
export default function CourseDetail({ course, onPlay, onBack }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const courseId = idOf(course?.id);
        logger.info('piano.course-load', { courseId });
        const res = await DaylightAPI(`api/v1/fitness/show/${courseId}/playable`);
        if (!cancelled) setData(res || { items: [] });
      } catch (err) {
        if (!cancelled) { setData({ items: [] }); setError(err.message); }
        logger.warn('piano.course-load-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger, course?.id]);

  const info = data?.info || {};
  const items = data ? (data.items || []) : null;

  return (
    <section className="piano-mode piano-mode--videos piano-video-detail">
      <button type="button" className="piano-game-fullscreen__back" onClick={onBack}>‹ Courses</button>
      <header className="piano-video-detail__band">
        {(info.image || course?.image) && (
          <img className="piano-video-detail__poster" src={info.image || course.image} alt="" />
        )}
        <div className="piano-video-detail__meta">
          <h2 className="piano-video-detail__title">{course?.title || info.title || 'Course'}</h2>
          {info.summary && <p className="piano-video-detail__summary">{info.summary}</p>}
          {items?.length > 0 && <p className="piano-video-detail__count">{items.length} lectures</p>}
        </div>
      </header>
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || 'No lectures found.'}</p>}
      {items?.length > 0 && (
        <ul className="piano-video-grid">
          {items.map((item) => {
            const st = lectureStatus(item);
            return (
              <li key={item.plex || item.id}>
                <button type="button" className="piano-video-grid__tile" onClick={() => onPlay(item)}>
                  {(item.image || item.thumbnail) && <img src={item.image || item.thumbnail} alt="" loading="eager" decoding="async" />}
                  {st.watched && <span className="piano-video-grid__badge">✓</span>}
                  {!st.watched && st.percent > 0 && (
                    <span className="piano-video-grid__bar"><span style={{ width: `${st.percent}%` }} /></span>
                  )}
                  <span className="piano-video-grid__title">{item.label || item.title}</span>
                  {(item.summary || item.description) && (
                    <span className="piano-video-grid__desc">{item.summary || item.description}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
