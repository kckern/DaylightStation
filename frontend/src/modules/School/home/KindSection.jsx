import Icon from './icons/Icon.jsx';

export default function KindSection({ kind, items, Tile, onOpen }) {
  // Render nothing when items is empty
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <section className="school-kind-section">
      <div className="school-kind-section__head">
        <span style={{ color: `var(--kind-${kind.token})` }}>
          <Icon
            name={kind.icon}
            className="school-kind-section__icon"
          />
        </span>
        <h2 className="school-kind-section__verb">{kind.verb}</h2>
        <span className="school-kind-section__descriptor">
          {kind.descriptor} · {items.length}
        </span>
      </div>
      <ul className="school-kind-section__grid">
        {items.map((item) => (
          <Tile key={item.id} item={item} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
