// exerciseBrowserModel.js — filter/query logic and the in-view hook for
// ExerciseBrowser.jsx, split out so Fast Refresh can hot-reload the browser
// screen on its own.
import { useEffect, useRef, useState } from 'react';

export const EXERCISES_PATH = 'api/v1/fitness/exercises';
export const TAXONOMY_PATH = 'api/v1/fitness/exercises/taxonomy';

/** Cards mounted per page of the render window. See ExerciseBrowser's docblock, layer 1. */
export const PAGE_SIZE = 60;
/** How far outside the viewport a card starts loading its GIF. Layer 2/3. */
export const CARD_ROOT_MARGIN = '400px 0px';
export const EMPTY_FILTERS = Object.freeze({ groups: [], muscles: [], equipment: [], q: '' });

export const FACETS = Object.freeze([
  { id: 'groups', label: 'Body area' },
  { id: 'muscles', label: 'Muscle' },
  { id: 'equipment', label: 'Equipment' }
]);

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
export function activationKey(event) {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/**
 * Live viewport membership for one element.
 *
 * Deliberately NOT one-shot — see layer 3 of ExerciseBrowser's docblock. Returns
 * `true` immediately where IntersectionObserver does not exist (older WebViews)
 * so the grid degrades to plain lazy <img> rather than to a blank screen.
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
