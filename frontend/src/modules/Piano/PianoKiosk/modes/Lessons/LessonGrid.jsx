import { useMemo } from 'react';
import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (item) => item.id || (item.file ? String(item.file).replace(/\.ya?ml$/, '') : String(item.number ?? ''));

/**
 * Generic lesson-collection grid. Renders whatever the collection's index.yml
 * describes — a title and a list of sections, each with a label and items.
 * Knows nothing about any specific collection's content.
 *
 * Index shape (all content-supplied):
 *   { title, subtitle?, sections: [{ label, items: [{ number?, title, subtitle?, file|id }] }] }
 *   (a flat `items` array with no sections is also accepted)
 */
export default function LessonGrid({ collection, onSelect }) {
  const { data: index, error } = usePianoList(
    collection ? `api/v1/piano/lessons/${collection}` : null,
    (r) => r ?? null,
  );

  const { title, subtitle, sections } = useMemo(() => {
    if (!index || Array.isArray(index)) return { title: null, subtitle: null, sections: [] };
    const secs = Array.isArray(index.sections)
      ? index.sections
      : Array.isArray(index.items)
        ? [{ label: null, items: index.items }]
        : [];
    return { title: index.title, subtitle: index.subtitle, sections: secs };
  }, [index]);

  const loading = index === null;
  const empty = !loading && sections.every((s) => !(s.items?.length));

  return (
    <section className="piano-mode piano-mode--lessons lesson-collection">
      {loading && <PianoEmpty loading />}
      {empty && <PianoEmpty message={error || (collection ? 'No drills found.' : 'No lesson collection has been set up yet.')} />}
      {!loading && !empty && (
        <>
          {(title || subtitle) && (
            <header className="lesson-collection__header">
              {title && <h1 className="lesson-collection__title">{title}</h1>}
              {subtitle && <p className="lesson-collection__subtitle">{subtitle}</p>}
            </header>
          )}
          {sections.map((section, si) => (
            <div key={section.label || si} className="lesson-collection__section">
              {section.label && <h2 className="lesson-collection__section-title">{section.label}</h2>}
              <ul className="lesson-collection__grid">
                {(section.items || []).map((item) => {
                  const id = idOf(item);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="lesson-collection__tile"
                        onClick={() => onSelect({ ...item, id })}
                        title={item.subtitle || item.title}
                      >
                        {item.number != null && <span className="lesson-collection__tile-num">{item.number}</span>}
                        <span className="lesson-collection__tile-body">
                          <span className="lesson-collection__tile-title">{item.title}</span>
                          {item.subtitle && <span className="lesson-collection__tile-sub">{item.subtitle}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
