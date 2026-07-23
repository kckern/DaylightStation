// Continue-rail row tile: horizontal card (small thumb + text block), not the
// portrait poster tile the kind wall uses. Pure/presentational: no fetching,
// no ranking — ContinueRail hands it an already-merged item.
import Icon from '../icons/Icon.jsx';

export default function ContinueTile({ item, onOpen }) {
  const pct = Math.max(0, Math.min(100, Number(item.percent) || 0));
  return (
    <li className="school-continue__item">
      <button type="button" className="school-continue__button" onClick={() => onOpen(item)}>
        <span className="school-continue__thumb-wrap">
          {item.poster
            ? <img src={item.poster} alt="" loading="lazy" decoding="async" className="school-continue__thumb" />
            : <span className="school-continue__thumb school-continue__thumb--placeholder" />}
        </span>
        <span className="school-continue__text">
          <span className="school-continue__title">{item.title}</span>
          <span className="school-continue__next">
            <Icon name="play" /> {item.nextUnitTitle ? `Next: ${item.nextUnitTitle}` : 'Continue'}
          </span>
          <span className="school-continue__bar">
            <span className="school-continue__bar-fill" style={{ width: `${pct}%`, background: 'var(--kind-continue)' }} />
          </span>
        </span>
      </button>
    </li>
  );
}
