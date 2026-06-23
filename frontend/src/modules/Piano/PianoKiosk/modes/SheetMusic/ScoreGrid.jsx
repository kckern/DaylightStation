import usePianoList from '../../usePianoList.js';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Grid of scores from the configured Plex sheet-music collection. Tap a score
 * to open the viewer.
 */
export default function ScoreGrid({ collection, onSelect }) {
  const { data: items, error } = usePianoList(collection ? `api/v1/list/plex/${idOf(collection)}` : null);

  return (
    <section className="piano-mode piano-mode--sheetmusic">
      <h2>Sheet Music</h2>
      {items === null && <p className="piano-mode__placeholder">Loading…</p>}
      {items?.length === 0 && <p className="piano-mode__placeholder">{error || (collection ? 'No scores found.' : 'No sheetmusic.collection configured.')}</p>}
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
