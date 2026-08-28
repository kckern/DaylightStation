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

import {
  TAXONOMY_PATH, PAGE_SIZE, EMPTY_FILTERS, FACETS, activationKey, useInView,
  buildExerciseQuery, activeFilterCount, toggleFacetValue,
} from './exerciseBrowserModel.js';

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

/** One of the three large category selectors above the contextual option rail. */
function FacetTab({ id, label, active, selected, onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    onActivate();
  }, [onActivate]);

  return (
    <div
      className={`exercise-browser__facet-tab${active ? ' exercise-browser__facet-tab--on' : ''}`}
      data-testid={`exercise-browser-tab-${id}`}
      data-active={active ? 'true' : 'false'}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onPointerDown={onActivate}
      onKeyDown={onKeyDown}
    >
      <span>{label}</span>
      {selected > 0 && (
        <span className="exercise-browser__facet-badge" aria-label={`${selected} selected`}>
          {selected}
        </span>
      )}
    </div>
  );
}

FacetTab.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  active: PropTypes.bool,
  selected: PropTypes.number,
  onActivate: PropTypes.func.isRequired
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
  const [activeFacet, setActiveFacet] = useState('groups');

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

  // Facet rails. A failure here costs the chips, not the already-loaded grid,
  // so it is a warn and not an error state.
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
    applyFilters({ ...EMPTY_FILTERS, [facet]: [value] }, `detail:${facet}`);
    if (FACETS.some((item) => item.id === facet)) setActiveFacet(facet);
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

  /**
   * Muscle chips are gated on a group being picked.
   *
   * Muscles are children of groups (38 across 12), so the group rail is the
   * first cut and this is the second. Rendering all 38 with no group selected
   * was both unreadable AND the worst case for vertical space — measured in
   * Chromium at 1920x1080 it wrapped to 1,225px of scroll height inside a
   * 744px panel and squeezed the grid to 88px (11.8% of the container). The
   * default state now renders no muscle chips at all; picking a group yields at
   * most 8, which fits the single row the rail is bounded to.
   *
   * A muscle that is already filtering stays on the rail regardless — that
   * happens when a chip inside the detail sheet pushes a muscle in without a
   * group, and a filter you cannot see is a filter you cannot switch off.
   */
  const muscleOptions = useMemo(() => {
    const all = taxonomy.muscles;
    const wanted = new Set(filters.groups);
    const inGroups = filters.groups.length ? all.filter((m) => wanted.has(m?.group)) : [];
    const pinned = filters.muscles
      .filter((slug) => !inGroups.some((m) => m.slug === slug))
      .map((slug) => all.find((m) => m.slug === slug) || { slug, name: slug });
    return [...inGroups, ...pinned];
  }, [taxonomy.muscles, filters.groups, filters.muscles]);

  const filterCount = activeFilterCount(filters);
  const libraryMissing = library ? library.available === false : false;
  const facetOptions = activeFacet === 'groups'
    ? taxonomy.groups
    : activeFacet === 'muscles'
      ? muscleOptions
      : taxonomy.equipment;
  const activeFacetMeta = FACETS.find((facet) => facet.id === activeFacet) || FACETS[0];
  const optionTestId = activeFacet === 'groups'
    ? 'exercise-browser-groups'
    : activeFacet === 'muscles'
      ? 'exercise-browser-muscles'
      : 'exercise-browser-equipment';
  const optionPrefix = activeFacet === 'groups'
    ? 'group'
    : activeFacet === 'muscles'
      ? 'muscle'
      : 'equipment';

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

        <div className="exercise-browser__header-prompt" aria-hidden="true">
          <span className="exercise-browser__header-prompt-kicker">Touch to explore</span>
          <span className="exercise-browser__header-prompt-copy">Filter by body, muscle, or gear</span>
        </div>

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
          <section className="exercise-browser__filter-deck" aria-label="Exercise filters">
            <div className="exercise-browser__facet-tabs" role="tablist" aria-label="Filter category">
              {FACETS.map((facet) => (
                <FacetTab
                  key={facet.id}
                  id={facet.id}
                  label={facet.label}
                  active={activeFacet === facet.id}
                  selected={filters[facet.id].length}
                  onActivate={() => setActiveFacet(facet.id)}
                />
              ))}

              <div className="exercise-browser__filter-guide">
                {filterCount > 0
                  ? `${filterCount} ${filterCount === 1 ? 'filter' : 'filters'} active`
                  : 'Choose one or more'}
              </div>

              {filterCount > 0 && (
                <TapTarget
                  testId="exercise-browser-clear"
                  label="Clear all"
                  variant="compact"
                  onActivate={clearFilters}
                />
              )}
            </div>

            <div
              className="exercise-browser__option-rail"
              data-testid={optionTestId}
              role="tabpanel"
              aria-label={`${activeFacetMeta.label} choices`}
            >
              {activeFacet === 'muscles' && facetOptions.length === 0 ? (
                <div className="exercise-browser__facet-hint" data-testid="exercise-browser-muscle-hint">
                  Pick a body area first, then refine by muscle
                </div>
              ) : (
                facetOptions.map((option) => (
                  <Chip
                    key={option.slug}
                    testId={`exercise-${optionPrefix}-${option.slug}`}
                    label={option.name || option.slug}
                    active={filters[activeFacet].includes(option.slug)}
                    onToggle={() => toggleFacet(activeFacet, option.slug)}
                  />
                ))
              )}
            </div>
          </section>

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
              <p className="exercise-browser__notice-body">Drop a filter to see more choices.</p>
            </section>
          ) : (
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

              {/* A grid CELL, not a bar under the grid. As chrome it cost ~100px
                  of permanent vertical space to a control nobody needs until
                  they have scrolled to the end of the page — which is exactly
                  where it now sits. */}
              {exercises.length > visible.length && (
                <TapTarget
                  testId="exercise-browser-more"
                  label="Show more"
                  sub={`${exercises.length - visible.length} more`}
                  variant="tile"
                  onActivate={showMore}
                />
              )}
            </div>
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
