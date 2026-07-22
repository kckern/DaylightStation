/**
 * Materials catalog grid (spec §2b/§3). Pure presentation: one tile per
 * material -- poster (or a text placeholder when no poster ships), title,
 * and a null-safe "N parts · ~M min" meta line. Tap -> detail.
 *
 * Poster src is used exactly as the API sends it, unprefixed: `poster` is
 * already the app-proxied Plex-relative path (or `null`), the same contract
 * Piano's CourseTile renders directly (`modules/Piano/PianoKiosk/modes/Videos/CourseTile.jsx`).
 */
function formatMeta(material) {
  const parts = [];
  if (material.unitCount != null) parts.push(`${material.unitCount} parts`);
  if (material.durationMs != null) parts.push(`~${Math.max(1, Math.round(material.durationMs / 60000))} min`);
  return parts.join(' · ');
}

export default function MaterialGrid({ materials, onSelect }) {
  if (!materials || materials.length === 0) {
    return (
      <div className="school-materials school-materials--empty">
        <p>Nothing here yet.</p>
      </div>
    );
  }
  return (
    <div className="school-materials">
      <div className="school-materials__grid">
        {materials.map((m) => {
          const meta = formatMeta(m);
          return (
            <button
              key={m.id}
              type="button"
              className="school-materials__tile"
              onClick={() => onSelect(m)}
            >
              {m.poster ? (
                <img
                  src={m.poster}
                  alt={m.title}
                  loading="lazy"
                  decoding="async"
                  className="school-materials__poster"
                />
              ) : (
                <div className="school-materials__poster school-materials__poster--placeholder">
                  <span>{m.title}</span>
                </div>
              )}
              <h3 className="school-materials__title">{m.title}</h3>
              {meta && <p className="school-materials__meta">{meta}</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
