import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Grid of scores: bundled built-in scores (interactive, engraved) first, then the
 * configured Plex sheet-music collection (page images). Tap a score to open it.
 */
export default function ScoreGrid({ collection, builtin = [], onSelect }) {
  const { data: items, error } = usePianoList(collection ? `api/v1/list/plex/${idOf(collection)}` : null);
  const plex = items ?? [];
  const all = [...builtin, ...plex];
  const loading = items === null && builtin.length === 0;

  return (
    <section className="piano-mode piano-mode--sheetmusic">
      {loading && <PianoEmpty loading />}
      {!loading && all.length === 0 && (
        <PianoEmpty message={error || (collection ? 'No scores found.' : 'No sheet music has been set up yet.')} />
      )}
      {all.length > 0 && (
        <ul className="piano-video-grid piano-video-grid--posters">
          {all.map((item) => {
            const cover = item.thumbnail || item.image;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`piano-video-grid__tile${item.builtin ? ' piano-score-tile--builtin' : ''}`}
                  onClick={() => onSelect(item)}
                  title={item.title}
                >
                  {cover
                    ? <img src={cover} alt={item.title} loading="lazy" decoding="async" />
                    : <span className="piano-score-tile__label">{item.title}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
