import { describe, it, expect } from 'vitest';
import { reducer, initialState, Modes, closeDecision, RENDER_CAP } from './comboboxMachine.js';

const open = (s) => reducer(s, { type: 'OPEN' });
const type_ = (s, text) => reducer(s, { type: 'INPUT', text });

describe('comboboxMachine', () => {
  it('open seeds search with committed value and enters SEARCH mode', () => {
    let s = open(initialState('plex:123'));
    expect(s.mode).toBe(Modes.SEARCH);
    expect(s.search).toBe('plex:123');
  });

  it('§3.1-2/10: CLOSE clears results, breadcrumbs, and pagination', () => {
    let s = open(initialState('plex:123'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'plex:1' }], breadcrumbs: [{ id: 'plex:0' }], pagination: { hasAfter: true } });
    s = reducer(s, { type: 'CLOSE', reason: 'outside' });
    expect(s.mode).toBe(Modes.DISPLAY);
    expect(s.browse.items).toEqual([]);
    expect(s.browse.pagination).toBeNull();
    expect(s.search).toBeNull();
  });

  it('S1: DRILL_LOADED replaces pagination (never inherits siblings window)', () => {
    let s = open(initialState('plex:123'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [], breadcrumbs: [], pagination: { hasAfter: true, offset: 40 } });
    s = reducer(s, { type: 'DRILL_LOADED', crumb: { id: 'plex:9' }, items: [{ id: 'plex:c1' }], pagination: null });
    expect(s.browse.pagination).toBeNull();
  });

  it('typing exits BROWSE, wipes browse state, enters SEARCH', () => {
    let s = open(initialState('plex:123'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'x' }], breadcrumbs: [{ id: 'p' }], pagination: {} });
    s = type_(s, 'be');
    expect(s.mode).toBe(Modes.SEARCH);
    expect(s.browse.items).toEqual([]);
    expect(s.browse.pagination).toBeNull();
  });

  it('RESULTS dedupes by id (duplicate keys corrupt DOM order vs items order)', () => {
    let s = open(initialState(''));
    s = type_(s, 'office');
    s = reducer(s, {
      type: 'RESULTS',
      items: [
        { id: 'files:a', title: 'first' },
        { id: 'files:b' },
        { id: 'files:a', title: 'dupe' },
        { id: 'plex:1' },
      ],
    });
    expect(s.results.map((r) => r.id)).toEqual(['files:a', 'files:b', 'plex:1']);
    expect(s.results[0].title).toBe('first'); // first occurrence wins
  });

  it('F6: RESULTS caps the machine results array at RENDER_CAP (after dedupe)', () => {
    let s = type_(open(initialState('')), 'broad');
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `plex:${i}`, title: `Item ${i}` }));
    s = reducer(s, { type: 'RESULTS', items });
    expect(RENDER_CAP).toBe(50);
    expect(s.results).toHaveLength(50);
    expect(s.results[0].id).toBe('plex:0');
    expect(s.results[49].id).toBe('plex:49');
  });

  it('F6: ARROW-down from the last capped row (49) wraps to 0 with itemCount === RENDER_CAP', () => {
    let s = type_(open(initialState('')), 'broad');
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `plex:${i}` }));
    s = reducer(s, { type: 'RESULTS', items });
    s = reducer(s, { type: 'HIGHLIGHT', idx: 49, userNavigated: true });
    s = reducer(s, { type: 'ARROW', dir: 1, itemCount: s.results.length }); // 49 → wrap 0
    expect(s.results.length).toBe(50);
    expect(s.highlight.idx).toBe(0);
    expect(s.highlight.userNavigated).toBe(true);
  });

  it('Mar-01 invariant: Enter selects only when userNavigated', () => {
    let s = open(initialState(''));
    s = type_(s, 'beet');
    s = reducer(s, { type: 'RESULTS', items: [{ id: 'plex:5' }] });
    expect(s.highlight.userNavigated).toBe(false);
    s = reducer(s, { type: 'HIGHLIGHT', idx: 0, userNavigated: true });
    expect(s.highlight.userNavigated).toBe(true);
  });

  it('closeDecision: escape reverts, id-like commits, exploratory reverts', () => {
    expect(closeDecision({ search: 'plex:9', value: 'plex:1' }, 'escape')).toEqual({ action: 'revert' });
    expect(closeDecision({ search: 'plex:9', value: 'plex:1' }, 'outside')).toEqual({ action: 'commit', value: 'plex:9' });
    expect(closeDecision({ search: 'beet', value: 'plex:1' }, 'outside')).toEqual({ action: 'revert' });
    expect(closeDecision({ search: 'plex:1', value: 'plex:1' }, 'outside')).toEqual({ action: 'none' });
    expect(closeDecision({ search: null, value: 'plex:1' }, 'outside')).toEqual({ action: 'none' });
  });

  it('closeDecision: select is none (selection already committed), tab follows outside policy', () => {
    expect(closeDecision({ search: 'plex:9', value: 'plex:1' }, 'select')).toEqual({ action: 'none' });
    expect(closeDecision({ search: 'plex:9', value: 'plex:1' }, 'tab')).toEqual({ action: 'commit', value: 'plex:9' });
    expect(closeDecision({ search: 'beet', value: 'plex:1' }, 'tab')).toEqual({ action: 'revert' });
  });

  it("closeDecision: 'dismiss' (Enter with unchanged text) follows the outside policy", () => {
    expect(closeDecision({ search: 'plex:1', value: 'plex:1' }, 'dismiss')).toEqual({ action: 'none' });
    expect(closeDecision({ search: null, value: 'plex:1' }, 'dismiss')).toEqual({ action: 'none' });
    expect(closeDecision({ search: 'b', value: 'plex:1' }, 'dismiss')).toEqual({ action: 'revert' });
  });

  it('BROWSE_LOADING sets browse.loading; *_LOADED, INPUT, and CLOSE clear it', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADING' });
    expect(s.browse.loading).toBe(true);
    expect(s.mode).toBe(Modes.SEARCH); // loading alone never changes mode

    // explicit clear (failed fetch)
    expect(reducer(s, { type: 'BROWSE_LOADING', loading: false }).browse.loading).toBe(false);
    // any browse level landing clears it
    expect(reducer(s, { type: 'BROWSE_LOADED', items: [], breadcrumbs: [] }).browse.loading).toBe(false);
    expect(reducer(s, { type: 'DRILL_LOADED', items: [], crumb: { id: 'x' } }).browse.loading).toBe(false);
    expect(reducer(s, { type: 'WENT_UP', items: [], breadcrumbs: [] }).browse.loading).toBe(false);
    // typing resets browse entirely
    expect(reducer(s, { type: 'INPUT', text: 'be' }).browse.loading).toBe(false);
    expect(reducer(s, { type: 'CLOSE' }).browse.loading).toBe(false);
  });

  it('VALUE_CHANGED (prop) returns to DISPLAY and clears editing state', () => {
    let s = type_(open(initialState('plex:1')), 'beet');
    s = reducer(s, { type: 'VALUE_CHANGED', value: 'plex:2' });
    expect(s.mode).toBe(Modes.DISPLAY);
    expect(s.search).toBeNull();
    expect(s.value).toBe('plex:2');
  });

  it('arrow wrap-around with userNavigated', () => {
    let s = type_(open(initialState('')), 'be');
    s = reducer(s, { type: 'RESULTS', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    s = reducer(s, { type: 'ARROW', dir: 1, itemCount: 3 });   // -1 → 0
    s = reducer(s, { type: 'ARROW', dir: -1, itemCount: 3 });  // 0 → 2 (wrap)
    expect(s.highlight.idx).toBe(2);
    expect(s.highlight.userNavigated).toBe(true);
  });

  it('PAGINATED after appends items and extends the window without touching highlight', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'a' }], breadcrumbs: [], pagination: { offset: 0, window: 1, total: 3, hasAfter: true, hasBefore: false } });
    s = reducer(s, { type: 'HIGHLIGHT', idx: 0, userNavigated: true });
    s = reducer(s, { type: 'PAGINATED', direction: 'after', items: [{ id: 'b' }, { id: 'c' }] });
    expect(s.browse.items.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(s.browse.pagination.hasAfter).toBe(false);
    expect(s.highlight.idx).toBe(0);
  });

  it('PAGINATED before prepends, decrements offset, and shifts highlight so it stays on the same item', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'c' }, { id: 'd' }], breadcrumbs: [], pagination: { offset: 40, window: 2, total: 100, hasBefore: true, hasAfter: true } });
    s = reducer(s, { type: 'HIGHLIGHT', idx: 1, userNavigated: true }); // on 'd'
    s = reducer(s, { type: 'PAGINATED', direction: 'before', items: [{ id: 'a' }, { id: 'b' }] });
    expect(s.browse.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(s.browse.pagination.offset).toBe(38);
    expect(s.browse.pagination.window).toBe(4);
    expect(s.browse.pagination.hasBefore).toBe(true);
    expect(s.browse.pagination.hasAfter).toBe(true); // 38 + 4 < 100
    expect(s.browse.items[s.highlight.idx].id).toBe('d'); // same item still highlighted
    expect(s.highlight.idx).toBe(3);
  });

  it('PAGINATED before floors offset at 0 and clears hasBefore', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'b' }], breadcrumbs: [], pagination: { offset: 1, window: 1, total: 2, hasBefore: true, hasAfter: false } });
    s = reducer(s, { type: 'PAGINATED', direction: 'before', items: [{ id: 'a' }, { id: 'phantom' }] });
    expect(s.browse.pagination.offset).toBe(0);
    expect(s.browse.pagination.hasBefore).toBe(false);
  });

  it('PAGINATED before with no highlight (idx -1) leaves highlight untouched', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'c' }], breadcrumbs: [], pagination: { offset: 2, window: 1, total: 3 } });
    s = reducer(s, { type: 'PAGINATED', direction: 'before', items: [{ id: 'a' }, { id: 'b' }] });
    expect(s.highlight.idx).toBe(-1);
  });

  it('WENT_UP replaces items/breadcrumbs/pagination and highlights the referenceIndex', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'root1' }], breadcrumbs: [], pagination: null });
    s = reducer(s, { type: 'DRILL_LOADED', crumb: { id: 'root1' }, items: [{ id: 'child1' }], pagination: { hasAfter: true, offset: 5 } });
    s = reducer(s, { type: 'ARROW', dir: 1, itemCount: 1 }); // userNavigated true
    s = reducer(s, { type: 'WENT_UP', items: [{ id: 'root0' }, { id: 'root1' }], breadcrumbs: [], pagination: { offset: 0, window: 2, total: 2 }, referenceIndex: 1 });
    expect(s.mode).toBe(Modes.BROWSE);
    expect(s.browse.items.map(i => i.id)).toEqual(['root0', 'root1']);
    expect(s.browse.breadcrumbs).toEqual([]);
    expect(s.browse.pagination).toEqual({ offset: 0, window: 2, total: 2 });
    expect(s.highlight.idx).toBe(1);
    expect(s.highlight.userNavigated).toBe(false);
  });

  it('WENT_UP defaults referenceIndex to 0', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'DRILL_LOADED', crumb: { id: 'p' }, items: [{ id: 'c' }], pagination: null });
    s = reducer(s, { type: 'WENT_UP', items: [{ id: 'p' }], breadcrumbs: [], pagination: null });
    expect(s.highlight.idx).toBe(0);
    expect(s.highlight.userNavigated).toBe(false);
  });

  it('ARROW with itemCount 0 is a no-op', () => {
    let s = type_(open(initialState('')), 'zzz');
    const before = s;
    s = reducer(s, { type: 'ARROW', dir: 1, itemCount: 0 });
    expect(s).toBe(before); // identical reference, nothing changed
    expect(s.highlight).toEqual({ idx: -1, userNavigated: false });
  });

  it('CLOSE preserves the committed value', () => {
    let s = type_(open(initialState('plex:42')), 'something else');
    s = reducer(s, { type: 'CLOSE', reason: 'escape' });
    expect(s.value).toBe('plex:42');
    expect(s.mode).toBe(Modes.DISPLAY);
  });

  it('OPEN with empty value seeds search:"" and enters SEARCH mode', () => {
    const s = open(initialState(''));
    expect(s.mode).toBe(Modes.SEARCH);
    expect(s.search).toBe('');
    expect(s.highlight).toEqual({ idx: -1, userNavigated: false });
  });

  it('INPUT always resets highlight to { idx: -1, userNavigated: false }', () => {
    let s = type_(open(initialState('')), 'be');
    s = reducer(s, { type: 'RESULTS', items: [{ id: 'a' }, { id: 'b' }] });
    s = reducer(s, { type: 'ARROW', dir: 1, itemCount: 2 });
    expect(s.highlight).toEqual({ idx: 0, userNavigated: true });
    s = type_(s, 'bee');
    expect(s.highlight).toEqual({ idx: -1, userNavigated: false });
  });

  it('reducer never mutates the previous state (PAGINATED case)', () => {
    let s = open(initialState('plex:1'));
    s = reducer(s, { type: 'BROWSE_LOADED', items: [{ id: 'a' }], breadcrumbs: [], pagination: { offset: 0, window: 1, total: 3, hasAfter: true } });
    const frozenItems = s.browse.items;
    const frozenPagination = s.browse.pagination;
    const next = reducer(s, { type: 'PAGINATED', direction: 'after', items: [{ id: 'b' }] });
    expect(frozenItems).toEqual([{ id: 'a' }]);
    expect(frozenPagination).toEqual({ offset: 0, window: 1, total: 3, hasAfter: true });
    expect(next.browse.items).not.toBe(frozenItems);
  });

  it('unknown event types are ignored', () => {
    const s = open(initialState('plex:1'));
    expect(reducer(s, { type: 'BOGUS' })).toBe(s);
  });
});
