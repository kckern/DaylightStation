// CourseGrid.jsx
import { useState, useMemo, useEffect, useCallback } from 'react';
import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import CourseTile from './CourseTile.jsx';

const ratingKeyOf = (c) => (c ? String(c).replace(/^plex:/, '') : null);

// Pull both the collection's display title and its courses from one /list call.
const selectCollection = (r) => ({ title: r?.title || null, items: r?.items ?? [] });

/**
 * Stable sort putting multi-season "show" courses first, then everything else
 * (single-season `season`-type courses) in their original order. So a course
 * like Hoffman Academy leads its tab regardless of where it sits in the collection.
 */
function showsFirst(items) {
  const rank = (it) => (it?.type === 'show' ? 0 : 1);
  return items
    .map((it, i) => [it, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([it]) => it);
}

/** Dedupe + show-first a collection's items; null passes through (still loading). */
function coursesOf(items) {
  if (!Array.isArray(items)) return null;
  const seen = new Set();
  const uniq = items.filter((it) => (it?.id != null && !seen.has(it.id) ? seen.add(it.id) : false));
  return showsFirst(uniq);
}

/** Fetches one collection's `{ title, items }` and reports it up; renders nothing. */
function CollectionFetcher({ collection, onData }) {
  const ratingKey = ratingKeyOf(collection);
  const { data } = usePianoList(ratingKey ? `api/v1/list/plex/${ratingKey}` : null, selectCollection);
  useEffect(() => { onData(collection, data ?? null); }, [collection, data, onData]);
  return null;
}

/**
 * Grid of the configured collections' courses; tap one to open its lectures.
 *
 * `collection` is either a single Plex collection ratingKey (`plex:`-prefix
 * optional) OR a list of them (piano config `videos.plexCollection` may be an
 * array). Each collection becomes a TAB labeled by its Plex collection name
 * (e.g. "Music Lessons" / "Piano Courses"); the active tab shows that
 * collection's courses with multi-season shows sorted first. A single configured
 * collection renders as a plain grid with no tab bar.
 */
export default function CourseGrid({ collection, onSelect }) {
  const collections = useMemo(
    () => (Array.isArray(collection) ? collection : [collection]).filter(Boolean),
    [collection],
  );

  // collectionId -> { title, items } (null while loading).
  const [byCollection, setByCollection] = useState({});
  const onData = useCallback((c, payload) => setByCollection((m) => ({ ...m, [c]: payload })), []);

  // Drop stale collections if config changes.
  useEffect(() => {
    setByCollection((m) => {
      const next = {};
      for (const c of collections) if (c in m) next[c] = m[c];
      return next;
    });
  }, [collections]);

  // Active tab tracked by collection id so it survives re-fetches; falls back to
  // the first collection if the active one is removed from config.
  const [activeCol, setActiveCol] = useState(null);
  const active = (activeCol && collections.includes(activeCol)) ? activeCol : (collections[0] || null);
  const multi = collections.length > 1;

  const payloadOf = (c) => byCollection[c];
  const titleOf = (c) => { const p = payloadOf(c); return (p && !Array.isArray(p) && p.title) || null; };
  const itemsOf = (c) => { const p = payloadOf(c); return Array.isArray(p) ? p : (p?.items ?? null); };

  const courses = useMemo(() => coursesOf(active ? itemsOf(active) : null), [active, byCollection]); // eslint-disable-line react-hooks/exhaustive-deps

  const noCollections = collections.length === 0;
  const loading = !noCollections && courses === null;
  const empty = !noCollections && Array.isArray(courses) && courses.length === 0;

  return (
    <section className="piano-mode piano-mode--videos">
      {collections.map((c) => (
        <CollectionFetcher key={c} collection={c} onData={onData} />
      ))}

      {multi && (
        <div className="piano-course-tabs" role="tablist" aria-label="Course collections">
          {collections.map((c, i) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === active}
              className={`piano-course-tab${c === active ? ' is-active' : ''}`}
              onClick={() => setActiveCol(c)}
            >
              {titleOf(c) || `Courses ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="piano-course-tabpanel" role={multi ? 'tabpanel' : undefined}>
        {noCollections && <PianoEmpty message="No video library has been set up yet." />}
        {loading && <PianoEmpty loading />}
        {empty && <PianoEmpty message="No videos found." />}
        {courses && courses.length > 0 && (
          <ul className="piano-video-grid piano-video-grid--posters">
            {courses.map((item) => (
              <CourseTile key={item.id} item={item} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
