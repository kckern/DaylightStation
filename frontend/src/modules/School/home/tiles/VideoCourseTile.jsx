// Video course tile: portrait poster (2/3), a play chip overlaid on the
// poster corner, clamped 2-line title, and — when in progress — a thin
// underline showing percent complete. Pure/presentational: no fetching,
// no ranking. Kind colour (var(--kind-video)) appears only on the chip and
// the progress underline, never as a tile background.
import Icon from '../icons/Icon.jsx';

export default function VideoCourseTile({ item, onOpen }) {
  const hasProgress = typeof item.percent === 'number' && item.percent > 0;
  return (
    <li className="school-tile school-tile--video">
      <button type="button" className="school-tile__button" onClick={() => onOpen(item)}>
        <span className="school-tile__poster-wrap">
          {item.poster ? (
            <img
              src={item.poster}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="school-tile__poster"
            />
          ) : (
            <span className="school-tile__poster school-tile__poster--placeholder">
              <span>{item.title}</span>
            </span>
          )}
          <span className="school-tile__chip" style={{ color: 'var(--kind-video)' }}>
            <Icon name="play" />
          </span>
        </span>
        <h3 className="school-tile__title">{item.title}</h3>
        {hasProgress && (
          <span
            className="school-tile__progress"
            style={{ width: `${item.percent}%`, background: 'var(--kind-video)' }}
          />
        )}
      </button>
    </li>
  );
}
