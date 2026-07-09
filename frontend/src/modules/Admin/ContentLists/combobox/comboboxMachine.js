// comboboxMachine.js — pure state machine for the unified content combobox.
// Every historical combobox bug (stale results on reopen, pagination bleeding
// across browse levels, blur-vs-close commit races, auto-highlight Enter
// selection) is an illegal transition here. Keep this file free of React,
// fetch, and timers — the hook owns side effects.
import { isContentIdLike } from '../contentSearchLogic.js';

export const Modes = { DISPLAY: 'display', SEARCH: 'search', BROWSE: 'browse' };

const emptyBrowse = () => ({ items: [], breadcrumbs: [], pagination: null, loading: false });

export const initialState = (value = '') => ({
  mode: Modes.DISPLAY,
  value,
  search: null,                       // null = not editing
  results: [],
  browse: emptyBrowse(),
  highlight: { idx: -1, userNavigated: false },
});

// Commit policy on dropdown close. reason: 'escape'|'outside'|'select'|'tab'
export function closeDecision({ search, value }, reason) {
  if (reason === 'escape' || reason === 'select') return { action: reason === 'select' ? 'none' : 'revert' };
  if (search === null || search === value) return { action: 'none' };
  if (search && isContentIdLike(search)) return { action: 'commit', value: search };
  return { action: 'revert' };
}

export function reducer(state, event) {
  switch (event.type) {
    case 'OPEN':
      return { ...state, mode: Modes.SEARCH, search: state.value || '', highlight: { idx: -1, userNavigated: false } };
    case 'INPUT':
      return { ...state, mode: Modes.SEARCH, search: event.text, browse: emptyBrowse(), highlight: { idx: -1, userNavigated: false } };
    case 'RESULTS':
      return { ...state, results: event.items };
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
