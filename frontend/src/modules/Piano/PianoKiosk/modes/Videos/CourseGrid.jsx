// CourseGrid.jsx
import usePianoList from '../../usePianoList.js';

/** Grid of the configured collection's courses; tap one to open its lectures. */
export default function CourseGrid({ collection, onSelect }) {
  const ratingKey = collection ? String(collection).replace(/^plex:/, '') : null;
  const { data: items, error } = usePianoList(ratingKey ? `api/v1/list/plex/${ratingKey}` : null);

  return (
    <section className="piano-mode piano-mode--videos">
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || (collection ? 'No videos found.' : 'No videos.plexCollection configured.')}</p>}
      {items?.length > 0 && (
        <ul className="piano-video-grid piano-video-grid--posters">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
                {(item.thumbnail || item.image) && <img src={item.thumbnail || item.image} alt={item.title} loading="eager" decoding="async" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
