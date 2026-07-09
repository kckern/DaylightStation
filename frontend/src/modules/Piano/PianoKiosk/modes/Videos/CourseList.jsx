import { progressOf } from './subcourses.js';

/**
 * The courses within one season (each a CNN "floor"). Courses share the show's
 * poster; the tile caption carries the course name + per-user watched count.
 */
export default function CourseList({ courses, poster, onSelect }) {
  return (
    <ul className="piano-video-grid piano-video-grid--posters piano-subcourse-menu">
      {(courses || []).map((c) => {
        const { watched, total } = progressOf(c.lessons);
        return (
          <li key={c.floor}>
            <button type="button" className="piano-video-grid__tile piano-subcourse-tile" onClick={() => onSelect(c)} title={c.label}>
              {poster && <img src={poster} alt="" loading="lazy" decoding="async" className="piano-cover" />}
              <span className="piano-subcourse-tile__label">{c.label}</span>
              <span className="piano-subcourse-tile__meta">{watched}/{total}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
