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

/** Dedupe + show-first a merged item list; null passes through (still loading). */
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

const itemsFromPayload = (p) => (Array.isArray(p) ? p : (p?.items ?? null));
const titleFromPayload = (p) => (p && !Array.isArray(p) ? p.title : null);

/**
 * Grid of the configured course collections; tap one to open its lectures.
 *
 * `groups` is an ordered list of `{ label, collections }`. Each group is one TAB
 * whose poster wall MERGES every collection it lists (multi-season shows sorted
 * first). A tab's label is its explicit `label`, else — for a single-collection
 * group — the collection's Plex name, else a positional fallback. A single group
 * renders as a plain grid with no tab bar.
 */
export default function CourseGrid({ groups = [], onSelect }) {
  // Every distinct collection across all groups is fetched once.
  const allCollections = useMemo(
    () => [...new Set(groups.flatMap((g) => g.collections || []))],
    [groups],
  );

  // collectionId -> { title, items } (null while loading).
  const [byCollection, setByCollection] = useState({});
  const onData = useCallback((c, payload) => setByCollection((m) => ({ ...m, [c]: payload })), []);

  // Drop stale collections if config changes.
  useEffect(() => {
    setByCollection((m) => {
      const next = {};
      for (const c of allCollections) if (c in m) next[c] = m[c];
      return next;
    });
  }, [allCollections]);

  const [activeIdx, setActiveIdx] = useState(0);
  const idx = groups.length ? Math.min(activeIdx, groups.length - 1) : 0;
  const activeGroup = groups[idx] || null;
  const multi = groups.length > 1;

  // Merge the active group's collections. Loading (null) until every collection
  // in the group has reported, so the wall doesn't flash a partial set.
  const merged = useMemo(() => {
    if (!activeGroup) return null;
    const payloads = activeGroup.collections.map((c) => byCollection[c]);
    if (payloads.some((p) => p == null)) return null;
    return payloads.flatMap((p) => itemsFromPayload(p) || []);
  }, [activeGroup, byCollection]);
  const courses = useMemo(() => coursesOf(merged), [merged]);

  // Per-course roster progress for the poster overlay. Sorted ids keep the
  // request path stable (cache-friendly); ids stay `plex:`-prefixed so the map
  // keys line up with each course item's id. Null while the wall is still loading.
  const progressIds = useMemo(
    () => (Array.isArray(courses) ? courses.map((c) => c.id).filter(Boolean).sort() : []),
    [courses],
  );
  const progressPath = progressIds.length
    ? `api/v1/piano/courses/progress?ids=${progressIds.join(',')}`
    : null;
  const { data: progressMap } = usePianoList(progressPath, (r) => r?.courses ?? {});

  const labelFor = (g, i) => {
    if (g.label) return g.label;
    if (g.collections.length === 1) return titleFromPayload(byCollection[g.collections[0]]) || `Courses ${i + 1}`;
    return `Courses ${i + 1}`;
  };

  const noGroups = groups.length === 0;
  const loading = !noGroups && courses === null;
  const empty = !noGroups && Array.isArray(courses) && courses.length === 0;

  return (
    <section className="piano-mode piano-mode--videos">
      {allCollections.map((c) => (
        <CollectionFetcher key={c} collection={c} onData={onData} />
      ))}

      {multi && (
        <div className="piano-course-tabs" role="tablist" aria-label="Course collections">
          {groups.map((g, i) => (
            <button
              key={g.label || g.collections.join(',') || i}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className={`piano-course-tab${i === idx ? ' is-active' : ''}`}
              onClick={() => setActiveIdx(i)}
            >
              {labelFor(g, i)}
            </button>
          ))}
        </div>
      )}

      <div className="piano-course-tabpanel" role={multi ? 'tabpanel' : undefined}>
        {noGroups && <PianoEmpty message="No video library has been set up yet." />}
        {loading && <PianoEmpty loading />}
        {empty && <PianoEmpty message="No videos found." />}
        {courses && courses.length > 0 && (
          <ul className="piano-video-grid piano-video-grid--posters">
            {courses.map((item) => (
              <CourseTile key={item.id} item={item} onSelect={onSelect} progress={progressMap?.[item.id]} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
