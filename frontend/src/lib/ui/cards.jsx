// frontend/src/lib/ui/cards.jsx
import './ds.scss';

/** A titled surface panel — the house card. */
export function SectionCard({ title, actions, children, className = '' }) {
  return (
    <section className={`ds-card ${className}`.trim()}>
      {(title || actions) ? (
        <header className="ds-card__header">
          {title ? <h3 className="ds-card__title">{title}</h3> : <span />}
          {actions ? <div className="ds-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ds-card__body">{children}</div>
    </section>
  );
}

/**
 * Label / big tabular number / trend / sparkline. `emphasis` is the ONE
 * louder variant — a screen should have at most one emphasized stat.
 */
export function StatCard({ label, value, unit, trend, spark, emphasis = false }) {
  return (
    <div className={`ds-stat${emphasis ? ' ds-stat--emphasis' : ''}`}>
      <span className="ds-stat__label">{label}</span>
      <span className="ds-stat__value">
        <span className="ds-stat__number">{value}</span>
        {unit ? <span className="ds-stat__unit">{unit}</span> : null}
      </span>
      {trend ? <span className="ds-stat__trend">{trend}</span> : null}
      {spark ? <div className="ds-stat__spark">{spark}</div> : null}
    </div>
  );
}
