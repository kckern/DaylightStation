/**
 * School home — the section grid (spec §8). The app's own top-level
 * navigation: SchoolShell renders this when no section is open. Pure
 * presentation; navigation state lives in the shell.
 */
export default function SectionGrid({ sections, onOpen }) {
  return (
    <div className="school-home">
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
