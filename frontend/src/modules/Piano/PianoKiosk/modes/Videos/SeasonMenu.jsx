import { progressOf } from './subcourses.js';

/**
 * The seasons of a subcourses program. Each tile shows the season poster (or the
 * program poster), the season title, and "N courses · watched/total".
 */
export default function SeasonMenu({ seasons, poster, onSelect }) {
  return (
    <ul className="piano-video-grid piano-video-grid--posters piano-subcourse-menu">
      {(seasons || []).map((s) => {
        const { watched, total } = progressOf(s.lessons);
        const count = s.courses.length;
        const name = s.title || `Season ${s.index}`;
        return (
          <li key={s.id}>
            <button type="button" className="piano-video-grid__tile piano-subcourse-tile" onClick={() => onSelect(s)} title={name}>
              {(s.thumbnail || poster) && <img src={s.thumbnail || poster} alt="" loading="lazy" decoding="async" className="piano-cover" />}
              <span className="piano-subcourse-tile__label">{name}</span>
              <span className="piano-subcourse-tile__meta">{count} course{count === 1 ? '' : 's'} · {watched}/{total}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
