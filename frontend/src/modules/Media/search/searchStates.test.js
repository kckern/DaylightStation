import { test, expect } from 'vitest';
import { deriveSearchState, SEARCH_STATE } from './searchStates.js';

test('idle when query is empty', () => {
  expect(deriveSearchState({ query: '', isSearching: false, results: [], error: null }))
    .toEqual({ kind: 'idle' });
});

test('idle when query is shorter than 2 chars', () => {
  expect(deriveSearchState({ query: 'a', isSearching: false, results: [], error: null }))
    .toEqual({ kind: 'idle' });
});

test('searching when isSearching and no results yet', () => {
  expect(deriveSearchState({ query: 'hi', isSearching: true, results: [], error: null }))
    .toEqual({ kind: 'searching' });
});

test('results when results are present, even if still searching', () => {
  const results = [{ id: 'plex:1', title: 'X' }];
  expect(deriveSearchState({ query: 'hi', isSearching: true, results, error: null }))
    .toEqual({ kind: 'results', results });
});

test('error overrides empty', () => {
  const error = { kind: 'connection', message: 'down' };
  expect(deriveSearchState({ query: 'hi', isSearching: false, results: [], error }))
    .toEqual({ kind: 'error', error });
});

test('empty when finished, no results, no error', () => {
  expect(deriveSearchState({ query: 'no-match', isSearching: false, results: [], error: null }))
    .toEqual({ kind: 'empty', query: 'no-match' });
});

test('shows results even when the query looks like a content ID', () => {
  const state = deriveSearchState({
    query: 'frozen: part 2', isSearching: false,
    results: [{ id: 'plex:1' }], error: null,
  });
  expect(state.kind).toBe(SEARCH_STATE.RESULTS);
});

test('falls through to EMPTY for content-id-like query with no results', () => {
  const state = deriveSearchState({
    query: 'plex-main:12345', isSearching: false, results: [], error: null,
  });
  expect(state.kind).toBe(SEARCH_STATE.EMPTY);
});
