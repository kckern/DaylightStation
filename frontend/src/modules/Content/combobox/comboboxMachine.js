// comboboxMachine.js — pure state machine for the unified content combobox.
// Every historical combobox bug (stale results on reopen, pagination bleeding
// across browse levels, blur-vs-close commit races, auto-highlight Enter
// selection) is an illegal transition here. Keep this file free of React,
// fetch, and timers — the hook owns side effects.
import { isContentIdLike } from '../lib/contentSearchLogic.js';

export const Modes = { DISPLAY: 'display', SEARCH: 'search', BROWSE: 'browse' };

// Hard cap on rendered search results. The SSE transport is intentionally
// uncapped, so a broad keyword can stream hundreds of hits — each rendered row
// mounts an Avatar + text + badges, causing mount/layout jank, and a huge list
// makes ARROW pac-man wrap span the whole set. The cap lives HERE (on the
// machine's results array) rather than at render time because the highlight is
// index-owned: DOM option order must equal `results` order and the highlight
// index domain is [0, results.length). Capping only at render would let the
// index point past the rendered rows. Applied AFTER dedupeById so the invariant
// holds on the same array the component maps over.
export const RENDER_CAP = 50;

const emptyBrowse = () => ({ items: [], breadcrumbs: [], pagination: null, loading: false });

// Search transports can emit the same content id twice (e.g. the files
// adapter matching a directory by name AND by path). Items render with
// key={item.id}, and the index-owned highlight requires DOM order === items
// order — duplicate keys corrupt React reconciliation and break that
// invariant, so RESULTS must be unique by id (first occurrence wins).
function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.id;
    if (key == null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const initialState = (value = '') => ({
  mode: Modes.DISPLAY,
  value,
  search: null,                       // null = not editing
  results: [],
  browse: emptyBrowse(),
  highlight: { idx: -1, userNavigated: false },
});

// Commit policy on dropdown close. reason: 'escape'|'outside'|'select'|'tab'
export function closeDecision({ search, value, allowFreeform = true }, reason) {
  if (reason === 'escape' || reason === 'select') return { action: reason === 'select' ? 'none' : 'revert' };
  if (search === null || search === value) return { action: 'none' };
  // RC4: dispatch-to-play contexts (allowFreeform:false) must never commit raw
  // typed text on blur/tab — even an id-like string. Revert instead.
  if (allowFreeform && search && isContentIdLike(search)) return { action: 'commit', value: search };
  return { action: 'revert' };
}

// Item-shape tolerance: hook-normalized browse items ({type, itemCount, parent})
// AND raw search API items ({metadata: {...}}) both flow through here. Moved
// here from ContentCombobox.jsx so the machine, hook, and component share one
// container predicate (decideCommit injects it; keep the logic unchanged).
export function isContainer(item) {
  return item.itemType === 'container'
    || item.isContainer
    || ['show', 'album', 'artist', 'watchlist', 'channel', 'series', 'conference', 'playlist', 'container']
      .includes(item.type || item.metadata?.type);
}

/**
 * Decide what a close gesture commits. Pure: no React/fetch.
 * @param {object} a
 * @param {'enter'|'blur'|'outside'|'tab'|'escape'} a.reason
 * @param {string|null} a.search   current editing text (null = not editing)
 * @param {string} a.value         committed value
 * @param {Array}  a.results       current search results (machine order)
 * @param {number} a.highlightIdx
 * @param {boolean} a.userNavigated
 * @param {boolean} a.selectContainers
 * @param {boolean} a.searchSettled  true iff a search for the current text has completed (not loading)
 * @param {(item:object)=>boolean} a.isContainer  injected predicate
 * @returns {{action:'select'|'drill'|'open'|'literal'|'revert'|'dismiss'|'none', item?:object, value?:string}}
 */
export function decideCommit({ reason, search, value, results, highlightIdx, userNavigated, selectContainers, searchSettled, isContainer, allowFreeform = true }) {
  // 1. Explicit pick — any reason. Mar-01 invariant: ONLY user-navigated rows count as a pick.
  if (userNavigated && highlightIdx >= 0 && results[highlightIdx]) {
    const item = results[highlightIdx];
    return (isContainer(item) && !selectContainers) ? { action: 'drill', item } : { action: 'select', item };
  }
  if (search === null || search === value) return { action: 'none' };
  // 2. Non-Enter closes never auto-render or literal-commit an unpicked query (no junk-on-blur).
  if (reason !== 'enter') return { action: 'revert' };
  // 3. Enter, no explicit pick:
  if (search.trim().length < 2) return { action: 'dismiss' };
  const q = search.trim();
  // 3a. An EXACT id match among results is a richer pick than a raw literal:
  // a leaf selects (carries title/metadata); a container falls through to the
  // level-choice logic below (stays open so the human picks the lineage level).
  const exactLeaf = results.find((r) => r.id === q && !isContainer(r));
  if (exactLeaf) return { action: 'select', item: exactLeaf };
  const exactContainer = results.some((r) => r.id === q && isContainer(r));
  // 3b. "Never deny manual entry": a content-id-like string the user typed (a
  // specific id / path / param, e.g. files:clips/x.mp4 or app:foo/param) commits
  // as the literal RAW value on Enter — even when partial-match results exist and
  // even before the search settles. Without this the single-partial-result branch
  // below would silently pick the WRONG neighbor (typing mirror.mp4 selecting
  // mothers-day), or a not-yet-settled query (e.g. after drilling in browse mode)
  // would fall through to 'open' and Enter would feel dead — both read as "my
  // manual entry was denied." NOT gated on searchSettled on purpose: an exact leaf
  // already present still wins via 3a, and the hook back-fills the title from the
  // info API after commit, so committing the raw id loses nothing. Skipped only
  // for an exact container match, which stays open for lineage-level choice (3a).
  if (!exactContainer && isContentIdLike(q)) {
    // RC4: suppress the raw-literal fallback in dispatch-to-play contexts —
    // only an actual resolved result (a SELECT above) may commit there.
    return allowFreeform ? { action: 'literal', value: search } : { action: 'dismiss' };
  }
  if (results.length === 0) {
    if (searchSettled) return allowFreeform ? { action: 'literal', value: search } : { action: 'dismiss' };
    return { action: 'open' };
  }
  // 4. Unambiguous leaf renders; containers / multiple stay open for the human to choose the level.
  const idLookupLeaf = results.find((r) => r.matchReason === 'id-lookup' && !isContainer(r));
  if (idLookupLeaf) return { action: 'select', item: idLookupLeaf };
  if (results.length === 1 && !isContainer(results[0])) return { action: 'select', item: results[0] };
  return { action: 'open' };
}

export function reducer(state, event) {
  switch (event.type) {
    case 'OPEN':
      return { ...state, mode: Modes.SEARCH, search: state.value || '', highlight: { idx: -1, userNavigated: false } };
    case 'INPUT':
      return { ...state, mode: Modes.SEARCH, search: event.text, browse: emptyBrowse(), highlight: { idx: -1, userNavigated: false } };
    case 'RESULTS':
      // Cap AFTER dedupe so results.length <= RENDER_CAP — keeps highlight math,
      // ARROW wrap, and rendered rows all consistent (see RENDER_CAP note).
      return { ...state, results: dedupeById(event.items).slice(0, RENDER_CAP) };
    case 'BROWSE_LOADING':
      // A browse fetch (siblings/drill/up) is in flight. Cleared by whichever
      // *_LOADED event lands, by INPUT (browse reset), by CLOSE, or explicitly
      // with { loading: false } from a failed fetch.
      return { ...state, browse: { ...state.browse, loading: event.loading ?? true } };
    case 'BROWSE_LOADED':
      return { ...state, mode: Modes.BROWSE,
        browse: { items: event.items, breadcrumbs: event.breadcrumbs, pagination: event.pagination ?? null, loading: false },
        highlight: { idx: event.referenceIndex ?? -1, userNavigated: false } };
    case 'DRILL_LOADED':
      return { ...state, mode: Modes.BROWSE,
        browse: { items: event.items, breadcrumbs: [...state.browse.breadcrumbs, event.crumb], pagination: event.pagination ?? null, loading: false },
        highlight: { idx: 0, userNavigated: false } };
    case 'WENT_UP':
      return { ...state, mode: Modes.BROWSE,
        browse: { items: event.items, breadcrumbs: event.breadcrumbs, pagination: event.pagination ?? null, loading: false },
        highlight: { idx: event.referenceIndex ?? 0, userNavigated: false } };
    case 'PAGINATED': {
      const items = event.direction === 'after'
        ? [...state.browse.items, ...event.items]
        : [...event.items, ...state.browse.items];
      const p = state.browse.pagination || {};
      const offset = event.direction === 'before' ? Math.max(0, (p.offset ?? 0) - event.items.length) : (p.offset ?? 0);
      const window_ = (p.window ?? state.browse.items.length) + event.items.length;
      const pagination = { ...p, offset, window: window_, hasBefore: offset > 0, hasAfter: offset + window_ < (p.total ?? Infinity) };
      const idx = event.direction === 'before' && state.highlight.idx >= 0 ? state.highlight.idx + event.items.length : state.highlight.idx;
      return { ...state, browse: { ...state.browse, items, pagination }, highlight: { ...state.highlight, idx } };
    }
    case 'ARROW': {
      const n = event.itemCount;
      if (n === 0) return state;
      const idx = event.dir > 0
        ? (state.highlight.idx + 1) % n
        : state.highlight.idx <= 0 ? n - 1 : state.highlight.idx - 1;
      return { ...state, highlight: { idx, userNavigated: true } };
    }
    case 'HIGHLIGHT':
      return { ...state, highlight: { idx: event.idx, userNavigated: !!event.userNavigated } };
    case 'VALUE_CHANGED':
      return { ...initialState(event.value), results: state.results };
    case 'CLOSE':
      return { ...initialState(state.value) };
    default:
      return state;
  }
}
