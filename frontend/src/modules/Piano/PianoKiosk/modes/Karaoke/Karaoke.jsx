import { useCallback, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { usePianoCoursePlayable } from '../Videos/usePianoCoursePlayable.js';
import { lectureContentId } from '../Videos/lectureMeta.js';
import SingalongPlayer from '../Singalong/SingalongPlayer.jsx';
import { SkeletonGrid } from '../../Skeleton.jsx';
import { parseSongs, categoriesOf, filterSongs, categoryHue, songArt } from './karaokeBrowse.js';
import { MaterialGlyph } from '../../producer/MaterialGlyph.jsx';

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
export function Karaoke({ showId: showIdProp, startFresh = true }) {
  const { config } = usePianoKioskConfig();
  // Reusable song browser: defaults to the Karaoke show, but Play-along points it
  // at the Backing Tracks show (same seasons-as-tabs + song-list UX). `startFresh`
  // (true for karaoke & play-along) makes every pick start at 0 — no resume.
  const showId = idOf(showIdProp ?? config.karaoke?.plexShow);
  const playable = usePianoCoursePlayable(showId);

  return (
    <Routes>
      <Route index element={<KaraokeBrowseRoute playable={playable} />} />
      <Route path=":songId" element={<KaraokePlayerRoute playable={playable} startFresh={startFresh} />} />
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

/** The browse UI: search box + color-coded category chips + a recognition-art grid. */
function KaraokeBrowser({ playable, onSelect }) {
  // Single breadcrumb crumb — the chrome already shows the mode name, so a
  // second "Karaoke" here would render the "Karaoke › Karaoke" doubling the
  // audit flagged. Empty label = no crumb from this screen.
  usePianoBreadcrumb(useMemo(() => [], []));
  const { items, parents } = playable;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('song'); // 'song' | 'artist'

  const songs = useMemo(() => parseSongs(items), [items]);
  const categories = useMemo(() => categoriesOf(parents), [parents]);
  const filtered = useMemo(
    () => filterSongs(songs, { query, category, sort }),
    [songs, query, category, sort],
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
      <div className="piano-karaoke__toolbar">
        <input
          type="search"
          className="piano-karaoke__search"
          placeholder="Search songs or artists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="piano-karaoke__sort" role="group" aria-label="Sort by">
          <button
            type="button"
            className={`piano-karaoke__sort-btn${sort === 'song' ? ' is-on' : ''}`}
            aria-pressed={sort === 'song'}
            onClick={() => setSort('song')}
          >
            Song
          </button>
          <button
            type="button"
            className={`piano-karaoke__sort-btn${sort === 'artist' ? ' is-on' : ''}`}
            aria-pressed={sort === 'artist'}
            onClick={() => setSort('artist')}
          >
            Artist
          </button>
        </div>
      </div>

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
        {categories.map((c) => {
          const active = category === c;
          const hue = categoryHue(c);
          // The dot always shows the category's own hue (color-coding); an active
          // tab fills with that hue so selection is obvious AND stays category-keyed.
          const style = active
            ? { background: `hsl(${hue} 46% 32%)`, borderColor: `hsl(${hue} 52% 46%)`, color: '#fff' }
            : undefined;
          return (
            <button
              type="button"
              role="tab"
              key={c}
              aria-selected={active}
              className={`piano-karaoke__tab${active ? ' is-active' : ''}`}
              style={style}
              onClick={() => setCategory(c)}
            >
              <span className="piano-karaoke__tab-dot" style={{ background: `hsl(${hue} 60% 55%)` }} />
              {c}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="piano-karaoke__empty">No songs found.</p>
      ) : (
        <ul className="piano-karaoke__grid">
          {filtered.map((s) => {
            const art = songArt(s);
            return (
              <li key={s.id}>
                <button type="button" className="piano-karaoke__card" onClick={() => onSelect(s)}>
                  <span className="piano-karaoke__art" style={{ background: art.background }} aria-hidden="true">
                    <MaterialGlyph seed={art.seed} size={44} className="piano-karaoke__glyph" />
                    <span className="piano-karaoke__play">▶</span>
                  </span>
                  <span className="piano-karaoke__card-body">
                    <span className="piano-karaoke__card-song">{s.song}</span>
                    {s.artist && <span className="piano-karaoke__card-artist">{s.artist}</span>}
                    {showCategory && s.category && (
                      <span className="piano-karaoke__card-category">
                        <span
                          className="piano-karaoke__card-cat-dot"
                          style={{ background: `hsl(${categoryHue(s.category)} 60% 55%)` }}
                        />
                        {s.category}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
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
function KaraokePlayerRoute({ playable, startFresh }) {
  const { songId } = useParams();
  const navigate = useNavigate();
  const { items } = playable;
  // No `source` crumb: it would be the Plex show title ("Karaoke"), which duplicates
  // the chrome's mode crumb (also "Karaoke") → the "Karaoke › Karaoke › song" doubling.
  // The mode crumb already links back to the browser, so the song title alone is enough.
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
  return <SingalongPlayer lecture={lecture} onBack={goBack} startFresh={startFresh} />;
}

export default Karaoke;
