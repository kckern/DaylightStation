import './home-ui.scss';

/**
 * A titled stretch of the page. Sentence-case title, a quiet figure or phrase
 * on the right, one hairline under the head. Renders nothing when told it is
 * empty, so a short page means a quiet house.
 */
export function HomeSection({ title, aside, empty = false, children }) {
  if (empty) return null;
  return (
    <section className="home-section" aria-label={title}>
      <div className="home-section__head">
        <h2 className="home-section__title">{title}</h2>
        {aside ? <span className="home-section__aside">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** A named sub-grouping inside a section (a room under "On"). */
export function HomeGroup({ name, children }) {
  return (
    <div className="home-section__group">
      <h3 className="home-section__group-name">
        {name}
      </h3>
      <div>{children}</div>
    </div>
  );
}

export default HomeSection;
