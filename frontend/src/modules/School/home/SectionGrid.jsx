/**
 * The browse shelves — DEMOTED from the front door.
 *
 * This used to be the whole home screen, which made a wall of category nouns
 * the first thing a child saw. It is now the fallback below their actual next
 * step, and `compact` shrinks it further while work is outstanding: the same
 * shelves, quieter, growing to full size once the day's set is cleared.
 *
 * Pure presentation; navigation state lives in the shell.
 */
export default function SectionGrid({ sections, onOpen, compact = false }) {
  return (
    <div className={`school-browse-grid${compact ? ' is-compact' : ''}`}>
      <div className="school-home__grid">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className="school-home__tile"
            onClick={() => onOpen(s.id)}
          >
            <h3 className="school-home__label">{s.label}</h3>
            {s.hint && <p className="school-home__hint">{s.hint}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}
