import MaterialsSection from '../materials/MaterialsSection.jsx';
import BankBrowser from '../browse/BankBrowser.jsx';

/**
 * The Library — reference material plus everything unshelved: content for
 * looking things up or free browsing, never part of a curriculum. Untagged
 * generic banks appear here as the Practice group (`subjectFilter={null}` =
 * untagged only).
 */
export default function LibraryPage({ library, guestOnly, onLaunch, notice, initialMaterialId = null }) {
  return (
    <div className="school-subject school-subject--library">
      {library.materials.length > 0 && (
        <section className="school-subject__group">
          <MaterialsSection materials={library.materials} initialMaterialId={initialMaterialId} sectionLabel="Library" />
        </section>
      )}
      <section className="school-subject__group">
        <h3 className="school-subject__heading">Practice</h3>
        <BankBrowser guestOnly={guestOnly} onLaunch={onLaunch} notice={notice} subjectFilter={null} />
      </section>
    </div>
  );
}
