import { SUBJECTS, subjectHasContent } from './subjects.js';
import StudentPanel from './StudentPanel.jsx';

/**
 * The School front door: six subject shelves on the left two-thirds, the meta
 * rail (student panel + Library) on the right third. Subjects are how a
 * family thinks about school; the rail is how a learner thinks about
 * themselves. Rendered for claimed AND unclaimed visitors — the panel itself
 * carries the claim affordance, so one home serves both.
 *
 * An empty shelf renders greyed rather than hidden (the Piano/registry
 * convention): the shape of the whole curriculum stays visible instead of the
 * wall pretending that what exists is all there is.
 */
export default function SchoolHome({ grouped, onOpen, bankTitles }) {
  const libraryCount = grouped.library.materials.length + grouped.library.banks.length;
  return (
    <div className="school-home2">
      <div className="school-home2__subjects">
        {SUBJECTS.map((s) => {
          const shelf = grouped.bySubject[s.id];
          const has = subjectHasContent(shelf);
          return (
            <button
              key={s.id}
              type="button"
              className={`school-home2__subject${has ? '' : ' is-empty'}`}
              onClick={has ? () => onOpen(`subject:${s.id}`) : undefined}
              disabled={!has}
            >
              <h3 className="school-home2__subject-label">{s.label}</h3>
              <p className="school-home2__subject-hint">{has ? s.hint : 'Nothing here yet'}</p>
            </button>
          );
        })}
      </div>
      <aside className="school-home2__rail">
        <StudentPanel onOpen={onOpen} bankTitles={bankTitles} />
        <button type="button" className="school-home2__library" onClick={() => onOpen('library')}>
          <h3 className="school-home2__subject-label">Library</h3>
          <p className="school-home2__subject-hint">
            Reference and browsing{libraryCount ? ` · ${libraryCount}` : ''}
          </p>
        </button>
      </aside>
    </div>
  );
}
