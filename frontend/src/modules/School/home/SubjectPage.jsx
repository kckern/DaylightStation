import MaterialsSection from '../materials/MaterialsSection.jsx';
import BankBrowser from '../browse/BankBrowser.jsx';

/**
 * One subject's shelf: language courses (tiles into the language program),
 * materials (the full grid → detail → player flow, reused whole), and
 * practice banks (BankBrowser filtered to this subject). Groups only render
 * when they have content; a wholly empty shelf explains itself.
 */
export default function SubjectPage({ subjectId, shelf, guestOnly, onLaunch, notice, onOpen }) {
  const empty = !shelf
    || (!shelf.materials.length && !shelf.banks.length && !shelf.courses.length);
  if (empty) {
    return (
      <div className="school-subject school-subject--empty">
        <p>Nothing on this shelf yet.</p>
      </div>
    );
  }
  return (
    <div className="school-subject">
      {shelf.courses.length > 0 && (
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
          <MaterialsSection materials={shelf.materials} />
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
