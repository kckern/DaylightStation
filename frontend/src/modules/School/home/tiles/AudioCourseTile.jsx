// Audio course tile: square art (1/1), a headphones chip, clamped title, and
// a null-safe "N works" / "N chapters" meta line. Pure/presentational.
// Kind colour (var(--kind-audio)) appears only on the chip.
import Icon from '../icons/Icon.jsx';

function formatMeta(item) {
  if (item.unitCount == null) return '';
  return `${item.unitCount} ${item.kind === 'collection' ? 'works' : 'chapters'}`;
}

export default function AudioCourseTile({ item, onOpen }) {
  const meta = formatMeta(item);
  return (
    <li className="school-tile school-tile--audio">
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
          <span className="school-tile__chip" style={{ color: 'var(--kind-audio)' }}>
            <Icon name="kind-audio" />
          </span>
        </span>
        <h3 className="school-tile__title">{item.title}</h3>
        {meta && <p className="school-tile__meta">{meta}</p>}
      </button>
    </li>
  );
}
