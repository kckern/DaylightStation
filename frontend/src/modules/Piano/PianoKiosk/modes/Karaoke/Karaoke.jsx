import { useCallback, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { usePianoCoursePlayable } from '../Videos/usePianoCoursePlayable.js';
import { lectureContentId } from '../Videos/lectureMeta.js';
import SingalongPlayer from '../Singalong/SingalongPlayer.jsx';
import { SkeletonGrid } from '../../Skeleton.jsx';
import { parseSongs, categoriesOf, filterSongs } from './karaokeBrowse.js';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

/**
 * Karaoke — a purpose-built SONG browser for a single Plex karaoke show (its
 * seasons are genre categories, e.g. "Crooners & Standards", "Piano Men"). Much
 * simpler than the Courses/Videos flow: no sequence/locks, no progress bars, no
 * thumbnails — just search + category tabs over a flat, alphabetized song grid.
 * Picking a song plays it through the existing karaoke chrome (SingalongPlayer).
 *
 *   index      → the browser (search + tabs + card grid)
 *   :songId    → the player (looks the song back up from the shared /playable
 *                fetch so a cold deep-link still resolves)
 */
export function Karaoke() {
  const { config } = usePianoKioskConfig();
  const showId = idOf(config.karaoke?.plexShow);
  const playable = usePianoCoursePlayable(showId);

  return (
    <Routes>
      <Route index element={<KaraokeBrowseRoute playable={playable} />} />
      <Route path=":songId" element={<KaraokePlayerRoute playable={playable} />} />
    </Routes>
  );
}

function KaraokeBrowseRoute({ playable }) {
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ component: 'piano-karaoke' }), []);
  const onSelect = useCallback((song) => {
    logger.info('piano.karaoke-play', { id: song.id });
    navigate(`${song.id}`);
  }, [navigate, logger]);
  return <KaraokeBrowser playable={playable} onSelect={onSelect} />;
}

/** The browse UI: search box + category chips + a grid of title/artist cards. */
function KaraokeBrowser({ playable, onSelect }) {
  usePianoBreadcrumb(useMemo(() => [{ label: 'Karaoke' }], []));
  const { items, parents } = playable;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  const songs = useMemo(() => parseSongs(items), [items]);
  const categories = useMemo(() => categoriesOf(parents), [parents]);
  const filtered = useMemo(
    () => filterSongs(songs, { query, category }),
    [songs, query, category],
  );
  // Search results and "All" mix categories together, so each card needs its
  // own category label; a single selected category is self-evident from the tab.
  const showCategory = !!query.trim() || category === 'All';

  if (items === null) {
    return (
      <section className="piano-mode piano-karaoke">
        <SkeletonGrid count={12} aspect="square" />
      </section>
    );
  }

  return (
    <section className="piano-mode piano-karaoke">
      <input
        type="search"
        className="piano-karaoke__search"
        placeholder="Search songs or artists…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="piano-karaoke__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={category === 'All'}
          className={`piano-karaoke__tab${category === 'All' ? ' is-active' : ''}`}
          onClick={() => setCategory('All')}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            type="button"
            role="tab"
            key={c}
            aria-selected={category === c}
            className={`piano-karaoke__tab${category === c ? ' is-active' : ''}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="piano-karaoke__empty">No songs found.</p>
      ) : (
        <ul className="piano-karaoke__grid">
          {filtered.map((s) => (
            <li key={s.id}>
              <button type="button" className="piano-karaoke__card" onClick={() => onSelect(s)}>
                <span className="piano-karaoke__card-song">{s.song}</span>
                {s.artist && <span className="piano-karaoke__card-artist">{s.artist}</span>}
                {showCategory && s.category && (
                  <span className="piano-karaoke__card-category">{s.category}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Player route. Re-resolves the song from the shared /playable fetch (same
 * pattern as Videos' LecturePlayerRoute) so a cold deep-link still works, and
 * hands it straight to SingalongPlayer — karaoke has no play-along keyboard/
 * staff chrome, so there's nothing else to wire up.
 */
function KaraokePlayerRoute({ playable }) {
  const { songId } = useParams();
  const navigate = useNavigate();
  const { items, info } = playable;
  const source = info?.title || '';
  const goBack = useCallback(() => navigate('..', { relative: 'path' }), [navigate]);

  const lecture = useMemo(
    () => (items || []).find((i) => String(lectureContentId(i)) === String(songId)) || null,
    [items, songId],
  );

  if (items === null) {
    return (
      <section className="piano-mode piano-karaoke">
        <SkeletonGrid count={12} aspect="square" />
      </section>
    );
  }
  if (!lecture) {
    return (
      <div className="piano-mode__placeholder">
        This song can’t be played.{' '}
        <button type="button" onClick={goBack}>Back</button>
      </div>
    );
  }
  return <SingalongPlayer lecture={lecture} source={source} onBack={goBack} />;
}

export default Karaoke;
