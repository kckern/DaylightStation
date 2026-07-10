import { useMemo } from 'react';
import { courseGate, keyOf } from './subcourses.js';
import { lectureUserStatus } from './lectureMeta.js';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';

function fmt(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Lessons of one course. Thumbnail-forward (reuses .piano-episode), sequential by
 * default: the current lesson is the one loud row (Play button + is-current); later
 * lessons are soft-locked "later", not error-red. A reference course never gates.
 */
export default function LessonList({ lessons, sections = null, onPlay, sequential = true, reference = false }) {
  const gate = sequential && !reference;
  const { lockedIds, currentId } = useMemo(
    () => (gate ? courseGate(lessons) : { lockedIds: new Set(), currentId: null }),
    [gate, lessons],
  );
  const row = (item) => {
    const k = keyOf(item);
    const st = lectureUserStatus(item);
    const img = item.image || item.thumbnail;
    const locked = lockedIds.has(k);
    const current = k === currentId;
    const dur = fmt(item.duration);
    return (
      <li key={k}>
        <button type="button"
          className={['piano-episode', locked && 'piano-episode--locked', current && 'is-current'].filter(Boolean).join(' ')}
          onClick={() => { if (!locked) onPlay(item); }} disabled={locked} aria-disabled={locked} aria-current={current ? 'true' : undefined}>
          <div className="piano-episode__thumb">
            {img && <img src={img} alt="" loading="eager" decoding="async" />}
            {locked && <span className="piano-episode__lock" aria-label="Later"><LockIcon /></span>}
            {!locked && st.watched && <span className="piano-episode__check" aria-label="Completed"><span className="piano-episode__check-mark">✓</span></span>}
            {!locked && !st.watched && st.percent > 0 && <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>}
            {dur && <span className="piano-episode__duration">{dur}</span>}
          </div>
          <div className="piano-episode__label"><span className="piano-episode__title">{item.label || item.title}</span></div>
          {current && <span className="psc-play"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Play</span>}
        </button>
      </li>
    );
  };
  if (Array.isArray(sections) && sections.length > 1) {
    return (
      <div className="psc-lesson-sections">
        {sections.map((sec) => (
          <section key={sec.label} className="psc-lesson-section">
            <h4 className="psc-part-title">{sec.label}</h4>
            <ul className="piano-episodes psc-lessons">{(sec.lessons || []).map(row)}</ul>
          </section>
        ))}
      </div>
    );
  }
  return <ul className="piano-episodes psc-lessons">{(lessons || []).map(row)}</ul>;
}
