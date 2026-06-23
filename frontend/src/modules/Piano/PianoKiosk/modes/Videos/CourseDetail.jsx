// CourseDetail.jsx
import { useMemo, useState, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { lectureStatus } from './lectureMeta.js';
import PianoBack from '../../PianoBack.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Course landing page — FitnessShow-style two-panel layout: a left show-info
 * panel (poster + title + summary + lecture count) and a right scrollable grid
 * of episode cards. Watch state (✓ / progress bar) rides on the thumbnail and
 * comes from media_memory signals (see lectureStatus). Tap a card to play.
 */
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
  const poster = info.image || course?.image;
  const title = course?.title || info.title || 'Course';

  return (
    <section className="piano-mode--videos piano-course">
      <PianoBack onClick={onBack} label="Videos" />
      <div className="piano-course__content">
        <aside className="piano-course__info">
          {poster && <img className="piano-course__poster" src={poster} alt="" />}
          <h2 className="piano-course__title">{title}</h2>
          {items?.length > 0 && <div className="piano-course__count">{items.length} lectures</div>}
          {info.summary && <p className="piano-course__summary">{info.summary}</p>}
        </aside>

        <div className="piano-course__episodes">
          {items === null && <PianoEmpty loading />}
          {items?.length === 0 && <PianoEmpty message={error || 'No lectures found.'} />}
          {items?.length > 0 && (
            <ul className="piano-episodes">
              {items.map((item) => {
                const st = lectureStatus(item);
                const img = item.image || item.thumbnail;
                return (
                  <li key={item.plex || item.id}>
                    <button type="button" className="piano-episode" onClick={() => onPlay(item)}>
                      <div className="piano-episode__thumb">
                        {img && <img src={img} alt="" loading="eager" decoding="async" />}
                        {st.watched && <span className="piano-episode__check" aria-label="Watched">✓</span>}
                        {!st.watched && st.percent > 0 && (
                          <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>
                        )}
                      </div>
                      <div className="piano-episode__label">
                        {item.itemIndex != null && <span className="piano-episode__num">E{item.itemIndex}</span>}
                        <span className="piano-episode__title">{item.label || item.title}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
