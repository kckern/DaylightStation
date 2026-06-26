// CourseGrid.jsx
import { useState, useMemo, useEffect, useCallback } from 'react';
import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import CourseTile from './CourseTile.jsx';

const ratingKeyOf = (c) => (c ? String(c).replace(/^plex:/, '') : null);

/**
 * Stable sort putting multi-season "show" courses first, then everything else
 * (single-season `season`-type courses) in their original order. So a course
 * like Hoffman Academy leads the wall regardless of which collection it came
 * from or where it sits in config.
 */
function showsFirst(items) {
  const rank = (it) => (it?.type === 'show' ? 0 : 1);
  return items
    .map((it, i) => [it, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([it]) => it);
}

/** Fetches one collection's courses and reports them up; renders nothing itself. */
function CollectionFetcher({ collection, onItems }) {
  const ratingKey = ratingKeyOf(collection);
  const { data } = usePianoList(ratingKey ? `api/v1/list/plex/${ratingKey}` : null);
  useEffect(() => { onItems(collection, data ?? null); }, [collection, data, onItems]);
  return null;
}

/**
 * Grid of the configured collection's courses; tap one to open its lectures.
 *
 * `collection` is either a single Plex collection ratingKey (`plex:`-prefix
 * optional) OR a list of them (piano config `videos.plexCollection` may be an
 * array). The grid concatenates every collection's courses into one poster
 * wall, de-duplicated, with show-type (multi-season) courses sorted first.
 */
export default function CourseGrid({ collection, onSelect }) {
  const collections = useMemo(
    () => (Array.isArray(collection) ? collection : [collection]).filter(Boolean),
    [collection],
  );

  // collectionId -> items (null while loading).
  const [byCollection, setByCollection] = useState({});
  const onItems = useCallback((c, items) => setByCollection((m) => ({ ...m, [c]: items })), []);

  // Drop stale collections if config changes.
  useEffect(() => {
    setByCollection((m) => {
      const next = {};
      for (const c of collections) if (c in m) next[c] = m[c];
      return next;
    });
  }, [collections]);

  // Resolved = an array reported (`[]` empty or items); `null` means still loading.
  const settled = collections.every((c) => Array.isArray(byCollection[c]));
  const merged = useMemo(() => {
    const all = collections.flatMap((c) => byCollection[c] || []);
    const seen = new Set();
    const uniq = all.filter((it) => (it?.id != null && !seen.has(it.id) ? seen.add(it.id) : false));
    return showsFirst(uniq);
  }, [collections, byCollection]);

  const noCollections = collections.length === 0;
  const loading = !noCollections && !settled && merged.length === 0;
  const empty = !noCollections && settled && merged.length === 0;

  return (
    <section className="piano-mode piano-mode--videos">
      {collections.map((c) => (
        <CollectionFetcher key={c} collection={c} onItems={onItems} />
      ))}
      {noCollections && <PianoEmpty message="No video library has been set up yet." />}
      {loading && <PianoEmpty loading />}
      {empty && <PianoEmpty message="No videos found." />}
      {merged.length > 0 && (
        <ul className="piano-video-grid piano-video-grid--posters">
          {merged.map((item) => (
            <CourseTile key={item.id} item={item} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}
