// CourseGrid.jsx
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import usePianoList from '../../usePianoList.js';
import { balancedGrid } from '../../tileGridLayout.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonPoster } from '../../Skeleton.jsx';
import CourseTile from './CourseTile.jsx';
import { tileScaleFor } from './tileScale.js';

const ratingKeyOf = (c) => (c ? String(c).replace(/^plex:/, '') : null);
const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

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
  // Every distinct collection across all groups is fetched once. Cherry-picked
  // `shows` get their own fetch through the same list endpoint — a standalone
  // show (in no collection) returns itself as a tile, so the pool covers it.
  const allCollections = useMemo(
    () => [...new Set([
      ...groups.flatMap((g) => g.collections || []),
      ...groups.flatMap((g) => g.shows || []),
    ])],
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
  // in the group has reported, so the wall doesn't flash a partial set. Groups
  // may also cherry-pick shows from the OTHER collections' pool (`shows`) or
  // hide shows their own collections include (`excludeShows`) — see
  // resolveCourseGroups.
  const merged = useMemo(() => {
    if (!activeGroup) return null;
    const own = activeGroup.collections.map((c) => byCollection[c]);
    if (own.some((p) => p == null)) return null;
    const wanted = new Set((activeGroup.shows || []).map(idOf));
    if (wanted.size) {
      // Cherry-picked shows live in other collections' payloads — wait for the
      // whole pool so the tab doesn't flash without its adopted shows.
      const pool = allCollections.map((c) => byCollection[c]);
      if (pool.some((p) => p == null)) return null;
    }
    const exclude = new Set((activeGroup.excludeShows || []).map(idOf));
    const base = own
      .flatMap((p) => itemsFromPayload(p) || [])
      .filter((it) => !exclude.has(idOf(it.id)));
    if (wanted.size) {
      const seen = new Set(base.map((it) => idOf(it.id)));
      for (const c of allCollections) {
        for (const it of itemsFromPayload(byCollection[c]) || []) {
          const id = idOf(it.id);
          if (wanted.has(id) && !seen.has(id)) { seen.add(id); base.push(it); }
        }
      }
    }
    return base;
  }, [activeGroup, byCollection, allCollections]);
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

  // Swipe left/right on the content panel steps through the tabs (touch
  // kiosk). Horizontal-dominant swipes only, so vertical poster-wall scrolling
  // never changes tabs; clamped at the ends.
  const swipeRef = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches?.[0];
    swipeRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    const t = e.changedTouches?.[0];
    if (!start || !t || !multi) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const next = Math.min(groups.length - 1, Math.max(0, idx + (dx < 0 ? 1 : -1)));
    setActiveIdx(next);
  };

  // Rows AND cols for the one-page wall (balancedGrid), so the tab's poster
  // count drives BOTH axes — more courses add rows and widen the cap, and the
  // CSS grid (--cols/--rows, both `fr`) shrinks tiles to fit rather than the
  // page ever scrolling. Only meaningful once courses are loaded; the loading
  // skeleton and empty state don't use it.
  const { rows: gridRows, cols: gridCols } = useMemo(
    () => balancedGrid(courses?.length ?? 0),
    [courses],
  );

  return (
    <section className="piano-mode piano-mode--videos piano-mode--videos-grid">
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

      <div
        className="piano-course-tabpanel"
        role={multi ? 'tabpanel' : undefined}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {noGroups && <PianoEmpty message="No video library has been set up yet." />}
        {loading && <SkeletonPoster count={8} />}
        {empty && <PianoEmpty message="No videos found." />}
        {courses && courses.length > 0 && (
          <ul
            className="piano-video-grid piano-video-grid--posters piano-video-grid--onepage"
            style={{ '--cols': gridCols, '--rows': gridRows, '--tile-scale': tileScaleFor(gridRows) }}
          >
            {courses.map((item) => (
              <CourseTile key={item.id} item={item} onSelect={onSelect} progress={progressMap?.[item.id]} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
