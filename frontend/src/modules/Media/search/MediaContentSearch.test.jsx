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

vi.mock('./SearchProvider.jsx', () => ({
  useSearchContext: () => ({
    scopes: [{ key: 'all', label: 'All' }],
    currentScopeKey: 'all',
    currentScope: { params: '' },
    scopeError: null,
    setScopeKey: vi.fn(),
  }),
}));

// Stand-in for the real combobox: one button that fires the same onChange
// contract (id, item) the combobox uses when a leaf is picked.
vi.mock('../../Content/combobox/ContentCombobox.jsx', () => ({
  ContentCombobox: ({ onChange }) => (
    <button
      data-testid="pick-episode"
      onClick={() => onChange('plex:685088', { title: 'Episode 3', type: 'episode' })}
    >
      pick
    </button>
  ),
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info }) }),
}));

import { MediaContentSearch } from './MediaContentSearch.jsx';

beforeEach(() => {
  dispatch.mockReset();
  info.mockReset();
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
});
