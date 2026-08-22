// frontend/src/modules/Media/search/MediaContentSearch.test.jsx
// The dock's transient content picker: a selection is handed to
// useContentDispatch and the destination it chose is logged.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable holders — factories close over these but only read at render time.
const dispatch = vi.fn();
const info = vi.fn();

vi.mock('./useContentDispatch.js', () => ({
  useContentDispatch: () => dispatch,
}));

// Mutable so a test can point currentScope/currentScopeKey at a narrowed
// scope to check the D5 fallback wiring (scopes[0] is always the catalog-wide
// "All" entry by convention — see SearchProvider.jsx).
let searchContext = {
  scopes: [{ key: 'all', label: 'All', params: '' }],
  currentScopeKey: 'all',
  currentScope: { key: 'all', label: 'All', params: '' },
  scopeError: null,
  setScopeKey: vi.fn(),
};

vi.mock('./SearchProvider.jsx', () => ({
  useSearchContext: () => searchContext,
}));

// Stand-in for the real combobox: one button that fires the same onChange
// contract (id, item) the combobox uses when a leaf is picked. Captures the
// props MediaContentSearch threads in (fallbackSearchParams/scopeKey/
// scopeLabel — Task 11 fix round) so tests can assert on them directly.
let comboboxProps;
vi.mock('../../Content/combobox/ContentCombobox.jsx', () => ({
  ContentCombobox: (props) => {
    comboboxProps = props;
    return (
      <button
        data-testid="pick-episode"
        onClick={() => props.onChange('plex:685088', { title: 'Episode 3', type: 'episode' })}
      >
        pick
      </button>
    );
  },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info }) }),
}));

import { MediaContentSearch } from './MediaContentSearch.jsx';

beforeEach(() => {
  dispatch.mockReset();
  info.mockReset();
  comboboxProps = undefined;
  searchContext = {
    scopes: [{ key: 'all', label: 'All', params: '' }],
    currentScopeKey: 'all',
    currentScope: { key: 'all', label: 'All', params: '' },
    scopeError: null,
    setScopeKey: vi.fn(),
  };
});

describe('MediaContentSearch', () => {
  it('logs the destination a selection was routed to', () => {
    dispatch.mockReturnValue('cast');
    render(<MediaContentSearch />);
    fireEvent.click(screen.getByTestId('pick-episode'));

    expect(dispatch).toHaveBeenCalledWith(
      'plex:685088',
      { title: 'Episode 3', type: 'episode' }
    );
    expect(info).toHaveBeenCalledWith('dispatch', {
      contentId: 'plex:685088',
      route: 'cast',
    });
  });

  it('records a local route distinctly from a cast', () => {
    dispatch.mockReturnValue('local');
    render(<MediaContentSearch />);
    fireEvent.click(screen.getByTestId('pick-episode'));

    expect(info).toHaveBeenCalledWith('dispatch', {
      contentId: 'plex:685088',
      route: 'local',
    });
  });

  // ── Task 11 fix round: D5 wiring — previously this was dead code because
  // nothing passed fallbackSearchParams anywhere. ──

  it('D5: passes scopes[0] (the catalog-wide "All" scope) as fallbackSearchParams to ContentCombobox', () => {
    searchContext = {
      scopes: [
        { key: 'all', label: 'All', params: '' },
        { key: 'music-ambient', label: 'Ambient', params: 'source=plex&plex.libraryId=9' },
      ],
      currentScopeKey: 'music-ambient',
      currentScope: { key: 'music-ambient', label: 'Ambient', params: 'source=plex&plex.libraryId=9' },
      scopeError: null,
      setScopeKey: vi.fn(),
    };
    render(<MediaContentSearch />);

    expect(comboboxProps.searchParams).toBe('source=plex&plex.libraryId=9'); // the narrowed scope
    expect(comboboxProps.fallbackSearchParams).toBe(''); // scopes[0]'s params — catalog-wide
    expect(comboboxProps.scopeKey).toBe('music-ambient');
    expect(comboboxProps.scopeLabel).toBe('Ambient');
  });

  it('D5: falls back to an empty-string fallbackSearchParams when scopes[0] carries no params key', () => {
    searchContext = {
      scopes: [{ key: 'all', label: 'All' }], // no `params` key at all
      currentScopeKey: 'all',
      currentScope: { key: 'all', label: 'All' },
      scopeError: null,
      setScopeKey: vi.fn(),
    };
    render(<MediaContentSearch />);

    expect(comboboxProps.fallbackSearchParams).toBe('');
  });
});
