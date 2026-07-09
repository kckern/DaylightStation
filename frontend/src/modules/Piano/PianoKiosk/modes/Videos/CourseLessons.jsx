import { useMemo } from 'react';
import { courseGate, keyOf } from './subcourses.js';
import { lectureUserStatus } from './lectureMeta.js';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';

/**
 * Lessons of one course (one CNN "floor"). Sequential by default — each lesson
 * locks until the previous one is watched (a mini-curriculum). Reuses the
 * `.piano-episode` presentation used by the flat CourseDetail.
 */
export default function CourseLessons({ lessons, onPlay, sequential = true }) {
  const { lockedIds, currentId } = useMemo(
    () => (sequential ? courseGate(lessons) : { lockedIds: new Set(), currentId: null }),
    [sequential, lessons],
  );

  return (
    <ul className="piano-episodes">
      {(lessons || []).map((item) => {
        const k = keyOf(item);
        const st = lectureUserStatus(item);
        const img = item.image || item.thumbnail;
        const locked = lockedIds.has(k);
        const current = k === currentId;
        return (
          <li key={k}>
            <button
              type="button"
              className={['piano-episode', locked && 'piano-episode--locked', current && 'piano-episode--current'].filter(Boolean).join(' ')}
              onClick={() => { if (!locked) onPlay(item); }}
              disabled={locked}
              aria-disabled={locked}
              aria-current={current ? 'true' : undefined}
            >
              <div className="piano-episode__thumb">
                {img && <img src={img} alt="" loading="eager" decoding="async" />}
                {locked && <span className="piano-episode__lock" aria-label="Locked"><LockIcon /></span>}
                {!locked && st.watched && (
                  <span className="piano-episode__check" aria-label="Completed"><span className="piano-episode__check-mark">✓</span></span>
                )}
                {!locked && !st.watched && st.percent > 0 && (
                  <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>
                )}
              </div>
              <div className="piano-episode__label">
                <span className="piano-episode__title">{item.label || item.title}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
