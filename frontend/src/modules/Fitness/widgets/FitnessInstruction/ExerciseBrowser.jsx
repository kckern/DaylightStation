import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI, DaylightMediaPath } from '@/lib/api.mjs';
import ExerciseDetail from './ExerciseDetail.jsx';
import './ExerciseBrowser.scss';

/**
 * Browse — the entry point into the exercise library, and the screen the athlete
 * spends the most time in.
 *
 * MULTI-VALUE FACETS ARE REPEATED KEYS, NOT COMMA LISTS
 * ----------------------------------------------------
 * The API expresses OR-within-a-facet as a repeated query key
 * (`?group=chest&group=back` = 366 matches) and AND-across-facets as different
 * keys (`?group=chest&equipment=barbell` = 12). Collapsing a facet to a single
 * value, or joining with commas, does NOT error — the server reads `chest,back`
 * as one unknown slug and returns 0. That silence is why `buildExerciseQuery` is
 * exported and asserted on directly: the bug it prevents looks like "the filter
 * is just very selective", not like a failure.
 *
 * 1,296 GIFS — THE ACTUAL ENGINEERING PROBLEM
 * -------------------------------------------
 * Every card's artwork is a looping demo GIF averaging ~470 KB; the unfiltered
 * corpus is ~282 MB. Rendering the result set naively would page the kiosk to
 * death. Three layers, each bounding a different quantity:
 *
 *   1. DOM cap — only `windowSize` cards (PAGE_SIZE = 60, grown by an explicit
 *      "Show more" tap) are ever mounted. An unfiltered browse renders 60 nodes,
 *      not 1,296, so layout and reconciliation stay flat no matter how broad the
 *      filter is. Changing any filter resets the window.
 *   2. Bytes in flight — a card's <img> is not rendered at all until its thumb
 *      intersects the viewport (IntersectionObserver, 400px margin). Scrolling a
 *      full window pulls its GIFs in a few at a time instead of 28 MB at once.
 *   3. Resident bytes — the observer is NOT one-shot: a card that scrolls far
 *      enough away drops its <img> again, so decoded GIF memory tracks the
 *      viewport (~viewport + margin, roughly 20-30 cards ≈ 10-14 MB) rather than
 *      accumulating with scroll depth. Re-entering re-reads from the HTTP cache.
 *      GIFs restart their loop on re-mount, which is invisible on a looping clip.
 *
 * The alternative — fetch each record's `stills[0]` and swap to the GIF on
 * interaction — was rejected: list responses carry only `image` (the GIF), so a
 * still-first grid would need 1,296 detail requests to find the stills, trading
 * an image problem for a request problem. Filtering is the real control, and the
 * count line above the grid exists to push the user toward it.
 *
 * INTERACTION
 * -----------
 * onPointerDown, not onClick — see the note near the top of FitnessApp.jsx: on
 * this touchscreen TV onClick's pointerup + capture delay is perceptible.
 * Enter/Space are kept on every focusable target. Nothing is hover-only.
 */

export const EXERCISES_PATH = 'api/v1/fitness/exercises';
export const TAXONOMY_PATH = 'api/v1/fitness/exercises/taxonomy';

/** Cards mounted per page of the render window. See the docblock, layer 1. */
export const PAGE_SIZE = 60;
/** How far outside the viewport a card starts loading its GIF. Layer 2/3. */
export const CARD_ROOT_MARGIN = '400px 0px';
/** Typing settles before a request goes out. */
export const SEARCH_DEBOUNCE_MS = 200;

export const EMPTY_FILTERS = Object.freeze({ groups: [], muscles: [], equipment: [], q: '' });

/**
 * Build the list-endpoint path for a filter set.
 *
 * `URLSearchParams.append` is used (never `set`, never `join(',')`) so a facet
 * holding several values emits the key several times — the only encoding the API
 * reads as OR.
 *
 * @param {{groups?: string[], muscles?: string[], equipment?: string[], q?: string}} filters
 * @returns {string} path with query string, ready for DaylightAPI
 */
export function buildExerciseQuery(filters = {}) {
  const params = new URLSearchParams();
  const append = (key, values) => {
    (Array.isArray(values) ? values : []).forEach((value) => {
      const v = typeof value === 'string' ? value.trim() : '';
      if (v) params.append(key, v);
    });
  };
  append('group', filters.groups);
  append('muscle', filters.muscles);
  append('equipment', filters.equipment);
  const term = typeof filters.q === 'string' ? filters.q.trim() : '';
  if (term) params.append('q', term);
  const qs = params.toString();
  return qs ? `${EXERCISES_PATH}?${qs}` : EXERCISES_PATH;
}

/** Total number of facet values selected — drives the "Clear filters" affordance. */
export function activeFilterCount(filters = {}) {
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  return len(filters.groups) + len(filters.muscles) + len(filters.equipment) +
    (typeof filters.q === 'string' && filters.q.trim() ? 1 : 0);
}

/** Toggle one value in one facet, returning a new filter object. */
export function toggleFacetValue(filters, facet, value) {
  const current = Array.isArray(filters?.[facet]) ? filters[facet] : [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return { ...filters, [facet]: next };
}

/** Enter/Space keep every pointer target reachable from a keyboard. */
function activationKey(event) {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/**
 * Live viewport membership for one element.
 *
 * Deliberately NOT one-shot — see layer 3 of the docblock. Returns `true`
 * immediately where IntersectionObserver does not exist (older WebViews) so the
 * grid degrades to plain lazy <img> rather than to a blank screen.
 */
export function useInView() {
  const ref = useRef(null);
  const supported = typeof IntersectionObserver === 'function';
  const [inView, setInView] = useState(!supported);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(Boolean(entry.isIntersecting));
      },
      { root: null, rootMargin: CARD_ROOT_MARGIN, threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, inView];
}

/** A filter chip. Multi-select — tapping an active chip removes it. */
function Chip({ testId, label, active, onToggle }) {
  const onKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    onToggle();
  }, [onToggle]);

  return (
    <div
      className={`exercise-browser__chip${active ? ' exercise-browser__chip--on' : ''}`}
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      role="button"
      aria-pressed={active}
      tabIndex={0}
      onPointerDown={() => onToggle()}
      onKeyDown={onKeyDown}
    >
      {label}
    </div>
  );
}

Chip.propTypes = {
  testId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  active: PropTypes.bool,
  onToggle: PropTypes.func.isRequired
};

/** A big tap target (build, show more, clear). */
function TapTarget({ testId, label, sub = null, variant = 'primary', onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    onActivate();
  }, [onActivate]);

  return (
    <div
      className={`exercise-browser__tap exercise-browser__tap--${variant}`}
      data-testid={testId}
      role="button"
      tabIndex={0}
      onPointerDown={() => onActivate()}
      onKeyDown={onKeyDown}
    >
      <span className="exercise-browser__tap-label">{label}</span>
      {sub && <span className="exercise-browser__tap-sub">{sub}</span>}
    </div>
  );
}

TapTarget.propTypes = {
  testId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  sub: PropTypes.string,
  variant: PropTypes.string,
  onActivate: PropTypes.func.isRequired
};

/**
 * One grid card: the looping demo, the name, and a `+` that drops it in the tray.
 * The whole card opens detail; the `+` stops propagation so adding never also
 * opens the sheet.
 */
export function ExerciseCard({ exercise, inTray = false, onOpen, onAdd }) {
  const [thumbRef, inView] = useInView();
  const { slug, name, image } = exercise;
  const display = typeof name === 'string' && name.trim() ? name.trim() : slug;

  const onCardKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    onOpen(slug);
  }, [onOpen, slug]);

  const add = useCallback((e) => {
    e.stopPropagation();
    onAdd(exercise);
  }, [onAdd, exercise]);

  const onAddKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    onAdd(exercise);
  }, [onAdd, exercise]);

  return (
    <div
      className="exercise-browser__card"
      data-testid={`exercise-card-${slug}`}
      data-in-view={inView ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={display}
      onPointerDown={() => onOpen(slug)}
      onKeyDown={onCardKeyDown}
    >
      <div className="exercise-browser__thumb" ref={thumbRef}>
        {inView && image ? (
          <img
            className="exercise-browser__gif"
            data-testid={`exercise-gif-${slug}`}
            src={DaylightMediaPath(image)}
            alt={display}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className="exercise-browser__thumb-placeholder" aria-hidden="true">
            {display.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>

      <div className="exercise-browser__card-name">{display}</div>

      <div
        className={`exercise-browser__add${inTray ? ' exercise-browser__add--on' : ''}`}
        data-testid={`exercise-add-${slug}`}
        data-in-tray={inTray ? 'true' : 'false'}
        role="button"
        aria-pressed={inTray}
        aria-label={inTray ? `Remove ${display}` : `Add ${display}`}
        tabIndex={0}
        onPointerDown={add}
        onKeyDown={onAddKeyDown}
      >
        {inTray ? '✓' : '+'}
      </div>
    </div>
  );
}

ExerciseCard.propTypes = {
  exercise: PropTypes.shape({
    slug: PropTypes.string.isRequired,
    name: PropTypes.string,
    image: PropTypes.string
  }).isRequired,
  inTray: PropTypes.bool,
  onOpen: PropTypes.func.isRequired,
  onAdd: PropTypes.func.isRequired
};

export default function ExerciseBrowser({ onStartBuild = null }) {
  const logger = useMemo(() => getLogger().child({ component: 'exercise-browser' }), []);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Raw input value; `filters.q` is the debounced copy that reaches the API.
  const [searchInput, setSearchInput] = useState('');

  const [taxonomy, setTaxonomy] = useState({ groups: [], muscles: [], equipment: [] });
  const [exercises, setExercises] = useState([]);
  const [total, setTotal] = useState(0);
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [windowSize, setWindowSize] = useState(PAGE_SIZE);
  const [tray, setTray] = useState([]);
  const [openSlug, setOpenSlug] = useState(null);

  // Mirrors state for handlers that need to LOG the transition they are making.
  // Reading these inside a setState updater is unsafe (React may invoke updaters
  // twice), so handlers compute the next value from the ref and set it directly.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const trayRef = useRef(tray);
  trayRef.current = tray;
  const windowRef = useRef(windowSize);
  windowRef.current = windowSize;
  const openSlugRef = useRef(openSlug);
  openSlugRef.current = openSlug;

  const onStartBuildRef = useRef(onStartBuild);
  onStartBuildRef.current = onStartBuild;

  // Debounce the search box into the filter set.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((prev) => (prev.q === searchInput.trim() ? prev : { ...prev, q: searchInput.trim() }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Facet rails. A failure here costs the chips, not the grid — search and the
  // already-loaded results keep working, so it is a warn and not an error state.
  useEffect(() => {
    let cancelled = false;
    DaylightAPI(TAXONOMY_PATH)
      .then((res) => {
        if (cancelled) return;
        const next = {
          groups: Array.isArray(res?.groups) ? res.groups : [],
          muscles: Array.isArray(res?.muscles) ? res.muscles : [],
          equipment: Array.isArray(res?.equipment) ? res.equipment : []
        };
        setTaxonomy(next);
        if (res?.library) setLibrary(res.library);
        logger.info('taxonomy-loaded', {
          groups: next.groups.length,
          muscles: next.muscles.length,
          equipment: next.equipment.length
        });
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('taxonomy-failed', { error: err?.message ?? String(err) });
      });
    return () => { cancelled = true; };
  }, [logger]);

  const path = useMemo(() => buildExerciseQuery(filters), [filters]);

  // Result set. `requestRef` drops out-of-order responses: chip taps are fast and
  // a slow broad query must not overwrite a fast narrow one that came after it.
  const requestRef = useRef(0);
  useEffect(() => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    setLoading(true);
    logger.debug('fetch-start', { path });

    DaylightAPI(path)
      .then((res) => {
        if (id !== requestRef.current) {
          logger.debug('fetch-dropped-stale', { path });
          return;
        }
        const list = Array.isArray(res?.exercises) ? res.exercises : [];
        const lib = res?.library ?? null;
        setExercises(list);
        setTotal(Number.isFinite(res?.total) ? res.total : list.length);
        setLibrary(lib);
        setError(null);
        setLoading(false);
        setWindowSize(PAGE_SIZE);
        logger.info('fetch-success', {
          path,
          count: list.length,
          total: Number.isFinite(res?.total) ? res.total : list.length,
          libraryAvailable: lib ? lib.available === true : null
        });
      })
      .catch((err) => {
        if (id !== requestRef.current) return;
        setExercises([]);
        setTotal(0);
        setLoading(false);
        setError(err?.message ?? String(err));
        logger.error('fetch-failed', { path, error: err?.message ?? String(err) });
      });
  }, [path, logger]);

  const applyFilters = useCallback((next, reason) => {
    setFilters(next);
    logger.info('filter-change', {
      reason,
      groups: next.groups,
      muscles: next.muscles,
      equipment: next.equipment,
      q: next.q,
      active: activeFilterCount(next)
    });
  }, [logger]);

  const toggleFacet = useCallback((facet, value) => {
    applyFilters(toggleFacetValue(filtersRef.current, facet, value), `toggle:${facet}`);
  }, [applyFilters]);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    applyFilters(EMPTY_FILTERS, 'clear');
  }, [applyFilters]);

  /**
   * A chip tapped inside the detail sheet REPLACES the filter set with that one
   * value rather than adding to it. Adding would AND across facets — tapping
   * "pectorals" while `group=back` is on would land the user on zero results,
   * which reads as a broken screen. "Show me everything like this" is the gesture
   * the chip is making.
   */
  const filterFromDetail = useCallback((facet, value) => {
    setSearchInput('');
    applyFilters({ ...EMPTY_FILTERS, [facet]: [value] }, `detail:${facet}`);
    setOpenSlug(null);
  }, [applyFilters]);

  const openDetail = useCallback((slug) => {
    setOpenSlug(slug);
    logger.info('detail-open', { slug });
  }, [logger]);

  const closeDetail = useCallback(() => {
    const slug = openSlugRef.current;
    if (!slug) return;
    setOpenSlug(null);
    logger.debug('detail-close', { slug });
  }, [logger]);

  const toggleTray = useCallback((exercise) => {
    const slug = exercise?.slug;
    if (!slug) return;
    const current = trayRef.current;
    const present = current.some((e) => e.slug === slug);
    const next = present ? current.filter((e) => e.slug !== slug) : [...current, exercise];
    setTray(next);
    logger.info(present ? 'tray-remove' : 'tray-add', { slug, size: next.length });
  }, [logger]);

  const showMore = useCallback(() => {
    const from = windowRef.current;
    const next = from + PAGE_SIZE;
    setWindowSize(next);
    logger.debug('window-grow', { from, to: next });
  }, [logger]);

  const startBuild = useCallback(() => {
    const picked = trayRef.current;
    logger.info('start-build', { count: picked.length, slugs: picked.map((e) => e.slug) });
    onStartBuildRef.current?.(picked);
  }, [logger]);

  const traySlugs = useMemo(() => new Set(tray.map((e) => e.slug)), [tray]);
  const visible = useMemo(() => exercises.slice(0, windowSize), [exercises, windowSize]);

  // Muscle chips narrow to the selected groups' muscles. All 38 at once is an
  // unreadable wall on a TV, and a muscle outside the selected groups can only
  // ever AND down to zero — so the rail shows the muscles that can still change
  // the result set.
  const muscleOptions = useMemo(() => {
    const all = taxonomy.muscles;
    if (!filters.groups.length) return all;
    const wanted = new Set(filters.groups);
    const narrowed = all.filter((m) => wanted.has(m?.group));
    // A selected muscle stays on the rail even if its group was just switched
    // off, otherwise the user cannot see (or undo) the filter that is running.
    const missing = filters.muscles
      .filter((slug) => !narrowed.some((m) => m.slug === slug))
      .map((slug) => all.find((m) => m.slug === slug) || { slug, name: slug });
    return [...narrowed, ...missing];
  }, [taxonomy.muscles, filters.groups, filters.muscles]);

  const filterCount = activeFilterCount(filters);
  const libraryMissing = library ? library.available === false : false;

  return (
    <div className="exercise-browser" data-testid="exercise-browser">
      <header className="exercise-browser__header">
        <div className="exercise-browser__heading">
          <h2 className="exercise-browser__title">Exercises</h2>
          <span className="exercise-browser__count" data-testid="exercise-browser-count">
            {libraryMissing
              ? 'Library not built'
              : `Showing ${visible.length} of ${total}`}
          </span>
        </div>

        <input
          className="exercise-browser__search"
          data-testid="exercise-browser-search"
          type="search"
          value={searchInput}
          placeholder="Search exercises"
          aria-label="Search exercises"
          onChange={(e) => setSearchInput(e.target.value)}
        />

        {/* Carries the container's transition test id: browse -> build is this
            one target, and the container owns the state machine behind it. */}
        <TapTarget
          testId="fitness-instruction-to-build"
          label="Build workout"
          sub={`${tray.length} selected`}
          variant="primary"
          onActivate={startBuild}
        />
      </header>

      {libraryMissing ? (
        // Distinct from "no results". An unbuilt index and a filter that matches
        // nothing both render zero cards; only this panel says which one happened
        // and what to run about it.
        <section
          className="exercise-browser__notice exercise-browser__notice--warn"
          data-testid="exercise-browser-unavailable"
        >
          <div className="exercise-browser__notice-title">The exercise library has not been built</div>
          <p className="exercise-browser__notice-body">
            {library?.hint || 'Run the exercise library index, then reload this screen.'}
          </p>
        </section>
      ) : (
        <>
          <nav className="exercise-browser__rail" data-testid="exercise-browser-groups" aria-label="Muscle groups">
            {taxonomy.groups.map((group) => (
              <Chip
                key={group.slug}
                testId={`exercise-group-${group.slug}`}
                label={group.name || group.slug}
                active={filters.groups.includes(group.slug)}
                onToggle={() => toggleFacet('groups', group.slug)}
              />
            ))}
          </nav>

          <div className="exercise-browser__facets">
            <div className="exercise-browser__facet" data-testid="exercise-browser-muscles">
              <span className="exercise-browser__facet-label">Muscle</span>
              <div className="exercise-browser__facet-chips">
                {muscleOptions.map((muscle) => (
                  <Chip
                    key={muscle.slug}
                    testId={`exercise-muscle-${muscle.slug}`}
                    label={muscle.name || muscle.slug}
                    active={filters.muscles.includes(muscle.slug)}
                    onToggle={() => toggleFacet('muscles', muscle.slug)}
                  />
                ))}
              </div>
            </div>

            <div className="exercise-browser__facet" data-testid="exercise-browser-equipment">
              <span className="exercise-browser__facet-label">Equipment</span>
              <div className="exercise-browser__facet-chips">
                {taxonomy.equipment.map((item) => (
                  <Chip
                    key={item.slug}
                    testId={`exercise-equipment-${item.slug}`}
                    label={item.name || item.slug}
                    active={filters.equipment.includes(item.slug)}
                    onToggle={() => toggleFacet('equipment', item.slug)}
                  />
                ))}
              </div>
            </div>

            {filterCount > 0 && (
              <TapTarget
                testId="exercise-browser-clear"
                label="Clear filters"
                variant="ghost"
                onActivate={clearFilters}
              />
            )}
          </div>

          {error ? (
            <section className="exercise-browser__notice" data-testid="exercise-browser-error">
              <div className="exercise-browser__notice-title">Could not load exercises</div>
              <p className="exercise-browser__notice-body">{error}</p>
            </section>
          ) : loading && exercises.length === 0 ? (
            <section className="exercise-browser__notice" data-testid="exercise-browser-loading">
              <div className="exercise-browser__notice-title">Loading exercises…</div>
            </section>
          ) : exercises.length === 0 ? (
            <section className="exercise-browser__notice" data-testid="exercise-browser-empty">
              <div className="exercise-browser__notice-title">No exercises match these filters</div>
              <p className="exercise-browser__notice-body">Drop a filter to widen the search.</p>
            </section>
          ) : (
            <>
              <div className="exercise-browser__grid" data-testid="exercise-browser-grid">
                {visible.map((exercise) => (
                  <ExerciseCard
                    key={exercise.slug}
                    exercise={exercise}
                    inTray={traySlugs.has(exercise.slug)}
                    onOpen={openDetail}
                    onAdd={toggleTray}
                  />
                ))}
              </div>

              {exercises.length > visible.length && (
                <TapTarget
                  testId="exercise-browser-more"
                  label="Show more"
                  sub={`${exercises.length - visible.length} more`}
                  variant="ghost"
                  onActivate={showMore}
                />
              )}
            </>
          )}
        </>
      )}

      {openSlug && (
        <ExerciseDetail
          slug={openSlug}
          inTray={traySlugs.has(openSlug)}
          onClose={closeDetail}
          onAdd={toggleTray}
          onFilter={filterFromDetail}
        />
      )}
    </div>
  );
}

ExerciseBrowser.propTypes = {
  /** Hands the tray to the container's `startBuild`. */
  onStartBuild: PropTypes.func
};
