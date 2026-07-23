import MaterialsSection from '../materials/MaterialsSection.jsx';
import BankBrowser from '../browse/BankBrowser.jsx';
import { subjectLabel } from './subjects.js';

/**
 * One subject's shelf: language courses (tiles into the language program),
 * materials (the full grid → detail → player flow, reused whole), and
 * practice banks (BankBrowser filtered to this subject). Groups only render
 * when they have content; a wholly empty shelf explains itself.
 */
// Built-in program launchers per subject — first-class School programs that
// aren't Plex/bank content (a typing drill, a writing surface later). Each
// opens a top-level section. Kept here (a frontend routing concern) rather
// than in the content pipeline, the same split PROGRAMS makes.
const SUBJECT_PROGRAMS = {
  writing: [{ id: 'typing', label: 'Typing', hint: 'Learn to touch-type', section: 'typing' }],
};

export default function SubjectPage({ subjectId, shelf, guestOnly, onLaunch, notice, onOpen, initialMaterialPath = [], onMaterialNav }) {
  const programs = SUBJECT_PROGRAMS[subjectId] ?? [];
  const empty = programs.length === 0 && (!shelf
    || (!shelf.materials.length && !shelf.banks.length && !shelf.courses.length));
  if (empty) {
    return (
      <div className="school-subject school-subject--empty">
        <p>Nothing on this shelf yet.</p>
      </div>
    );
  }
  return (
    <div className="school-subject">
      {programs.length > 0 && (
        <section className="school-subject__group">
          <div className="school-home__grid">
            {programs.map((prog) => (
              <button
                key={prog.id}
                type="button"
                className="school-home__tile"
                onClick={() => onOpen(prog.section)}
              >
                <h3 className="school-home__label">{prog.label}</h3>
                <p className="school-home__hint">{prog.hint}</p>
              </button>
            ))}
          </div>
        </section>
      )}
      {shelf?.courses?.length > 0 && (
        <section className="school-subject__group">
          <div className="school-home__grid">
            {shelf.courses.map((c) => (
              <button
                key={c.id}
                type="button"
                className="school-home__tile"
                onClick={() => onOpen(`lang:${c.id}`)}
              >
                <h3 className="school-home__label">{c.label}</h3>
                <p className="school-home__hint">Listen, say it, write it</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {shelf.materials.length > 0 && (
        <section className="school-subject__group">
          <MaterialsSection materials={shelf.materials} initialMaterialPath={initialMaterialPath} onMaterialNav={onMaterialNav} sectionLabel={subjectLabel(subjectId)} />
        </section>
      )}

      {shelf.banks.length > 0 && (
        <section className="school-subject__group">
          <h3 className="school-subject__heading">Practice</h3>
          <BankBrowser guestOnly={guestOnly} onLaunch={onLaunch} notice={notice} subjectFilter={subjectId} />
        </section>
      )}
    </div>
  );
}
