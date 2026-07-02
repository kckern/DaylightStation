/**
 * SongPicker — the full-bleed "Songs & Resume" front door (Task 8.2, design
 * §6/§7). A simple glyph-forward list of saved songs (title/author/date) plus,
 * at the top, the quiet resume affordance when a localStorage snapshot exists.
 *
 * Reuses the LibraryBrowser overlay surface classes (`piano-producer-mode__
 * overlay*`) so it feels like the other full-screen surfaces. A saved song's
 * glyph seeds from its meta signature when present, else its id — deterministic,
 * no network.
 *
 * PREFAB SONGS surface HERE, not in the LibraryBrowser (Task 9.1 scoping): a
 * song is sections + an arrangement, not an addable layer, so it belongs with
 * saved songs. They render as a read-only "Examples" group (no Delete) and load
 * through the SAME loadSong→HYDRATE path via `onLoadExample`.
 *
 * @param {object} props
 * @param {Array} props.songs - light song listings (id, title?, author, created, sectionCount, meta?)
 * @param {boolean} [props.loading]
 * @param {(id:string) => void} props.onLoad - load + hydrate a saved song
 * @param {() => void} props.onClose
 * @param {(id:string) => void} [props.onRemove] - delete a saved song (2-tap confirm)
 * @param {boolean} [props.hasResume] - a resume snapshot is available
 * @param {() => void} [props.onResume] - apply the resume snapshot
 * @param {() => void} [props.onDismissResume] - clear the resume snapshot
 * @param {Array} [props.examples] - curated prefab song listings (id, title?, author, sectionCount)
 * @param {(id:string) => void} [props.onLoadExample] - load + hydrate a prefab song
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { MaterialGlyph, seedFor } from './MaterialGlyph.jsx';
import './SongPicker.scss';

const REMOVE_ARM_MS = 3000;

function songDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
}

function SongRow({ song, onLoad, onRemove }) {
  const [removeArmed, setRemoveArmed] = useState(false);
  const disarmRef = useRef(null);
  useEffect(() => () => clearTimeout(disarmRef.current), []);
  const seed = useMemo(
    () => seedFor({ kind: 'song', id: song.meta?.signature || song.id }),
    [song.meta, song.id],
  );
  const handleRemove = () => {
    if (removeArmed) {
      clearTimeout(disarmRef.current);
      setRemoveArmed(false);
      onRemove(song.id);
      return;
    }
    setRemoveArmed(true);
    clearTimeout(disarmRef.current);
    disarmRef.current = setTimeout(() => setRemoveArmed(false), REMOVE_ARM_MS);
  };
  return (
    <li className="piano-song-picker__row">
      <button
        type="button"
        className="piano-song-picker__song"
        aria-label={song.title || `Untitled song ${song.id}`}
        onClick={() => onLoad(song.id)}
      >
        <MaterialGlyph seed={seed} size={44} />
        <span className="piano-song-picker__song-body">
          <span className="piano-song-picker__song-title">
            {song.title || 'Untitled'}
          </span>
          <span className="piano-song-picker__song-meta">
            {[song.author, `${song.sectionCount ?? 0} sections`, songDate(song.created)]
              .filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          className={`piano-song-picker__remove${removeArmed ? ' is-armed' : ''}`}
          aria-label={`delete ${song.title || song.id}`}
          onClick={handleRemove}
        >{removeArmed ? 'Sure?' : '✕'}</button>
      )}
    </li>
  );
}

export function SongPicker({
  songs = [],
  loading = false,
  onLoad,
  onClose,
  onRemove,
  hasResume = false,
  onResume,
  onDismissResume,
  examples = [],
  onLoadExample,
}) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer-song-picker' }), []);
  useEffect(() => { logger.info('song-picker.open', { songs: songs.length, examples: examples.length, hasResume }); }, [logger]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="piano-producer-mode__overlay piano-song-picker" role="dialog" aria-label="saved songs">
      <div className="piano-producer-mode__overlay-top">
        <span className="piano-song-picker__heading">Songs &amp; Resume</span>
        <button
          type="button"
          className="piano-producer-mode__overlay-close"
          aria-label="close songs"
          onClick={onClose}
        >✕</button>
      </div>

      {hasResume && (
        <div className="piano-song-picker__resume" role="status">
          <span className="piano-song-picker__resume-label">Resume where you left off?</span>
          <button type="button" className="piano-chip is-on" onClick={onResume}>Resume</button>
          <button type="button" className="piano-chip" aria-label="dismiss resume" onClick={onDismissResume}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="piano-producer-mode__library-empty"><p>Loading songs…</p></div>
      ) : songs.length === 0 ? (
        <div className="piano-producer-mode__library-empty">
          <p>No saved songs yet — build one and hit Save.</p>
        </div>
      ) : (
        <ul className="piano-song-picker__list">
          {songs.map((song) => (
            <SongRow key={song.id} song={song} onLoad={onLoad} onRemove={onRemove} />
          ))}
        </ul>
      )}

      {examples.length > 0 && (
        <div className="piano-song-picker__examples">
          <span className="piano-song-picker__group-heading">Examples</span>
          <ul className="piano-song-picker__list">
            {examples.map((song) => (
              // Read-only: no onRemove → no Delete affordance (the only catalog
              // difference from saved songs, design §4).
              <SongRow key={`ex:${song.id}`} song={song} onLoad={onLoadExample || onLoad} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SongPicker;
