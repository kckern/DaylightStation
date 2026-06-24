import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';

/** Prettify a filename-derived title: "fur-elise-super-easy" → "Fur Elise Super Easy". */
function prettyTitle(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Score';
  return s
    .replace(/\.[a-z0-9]+$/i, '')       // drop any lingering extension
    .replace(/[_-]+/g, ' ')             // dashes/underscores → spaces
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Grid of scores listed from a folder via the generic content API. MusicXML
 * scores are engraved (interactive); scanned page-image scores show their cover.
 * Tap a score to open it.
 */
export default function ScoreGrid({ listPath, onSelect }) {
  const { data: items, error } = usePianoList(listPath);
  const all = items ?? [];
  const loading = items === null;

  return (
    <section className="piano-mode piano-mode--sheetmusic">
      {loading && <PianoEmpty loading />}
      {!loading && all.length === 0 && (
        <PianoEmpty message={error || (listPath ? 'No scores found.' : 'No sheet music has been set up yet.')} />
      )}
      {all.length > 0 && (
        <ul className="piano-video-grid piano-video-grid--posters">
          {all.map((item) => {
            const cover = item.thumbnail || item.image;
            const title = item.type === 'notation' ? prettyTitle(item.title) : (item.title || 'Score');
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`piano-video-grid__tile${item.type === 'notation' ? ' piano-score-tile--builtin' : ''}`}
                  onClick={() => onSelect({ ...item, title })}
                  title={title}
                >
                  {cover
                    ? <img src={cover} alt={title} loading="lazy" decoding="async" />
                    : <span className="piano-score-tile__label">{title}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
