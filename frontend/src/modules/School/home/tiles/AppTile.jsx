// App tile: a wide banner row (not a poster grid tile) — programs and
// language courses are launched, not browsed. Left edge band carries the
// kind colour; the icon, label, blurb, and a trailing "OPEN ›" affordance
// read left-to-right. Pure/presentational.
import Icon from '../icons/Icon.jsx';

export default function AppTile({ item, onOpen }) {
  const blurb = item.hint ?? item.blurb ?? '';
  return (
    <li className="school-tile school-tile--app">
      <button type="button" className="school-tile__button" onClick={() => onOpen(item)}>
        <span className="school-tile__edge" style={{ background: 'var(--kind-app)' }} />
        <span className="school-tile__app-icon" style={{ color: 'var(--kind-app)' }}>
          <Icon name={item.icon || 'kind-app'} />
        </span>
        <span className="school-tile__app-body">
          <span className="school-tile__app-label">{item.label}</span>
          {blurb && <span className="school-tile__app-blurb">{blurb}</span>}
        </span>
        <span className="school-tile__app-open">OPEN &rsaquo;</span>
      </button>
    </li>
  );
}
