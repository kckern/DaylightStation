import MaterialsSection from '../materials/MaterialsSection.jsx';
import BankBrowser from '../browse/BankBrowser.jsx';

/**
 * The Library — reference material plus everything unshelved: content for
 * looking things up or free browsing, never part of a curriculum. The
 * Practice group shows EVERY bank, grouped by subject (design audit #2):
 * the old untagged-only filter told children a full room was empty.
 */
export default function LibraryPage({ library, guestOnly, onLaunch, notice, initialMaterialPath = [], onMaterialNav }) {
  return (
    <div className="school-subject school-subject--library">
      {library.materials.length > 0 && (
        <section className="school-subject__group">
          <MaterialsSection materials={library.materials} initialMaterialPath={initialMaterialPath} onMaterialNav={onMaterialNav} sectionLabel="Library" />
        </section>
      )}
      <section className="school-subject__group">
        <h3 className="school-subject__heading">Practice</h3>
        <BankBrowser guestOnly={guestOnly} onLaunch={onLaunch} notice={notice} grouped />
      </section>
    </div>
  );
}
