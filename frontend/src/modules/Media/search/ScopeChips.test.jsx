// frontend/src/modules/Media/search/ScopeChips.test.jsx
// Tappable scope chips replacing the native scope <select> (spec D5). No
// props — everything is read from useSearchContext(), so the same test
// harness proves the contract SearchMode (Task 13) will rely on too.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setScopeKey = vi.fn();
const info = vi.fn();
let currentScopeKey = 'all';

// A parent WITHOUT its own `params` (Music) is grouping-only: tapping it
// reveals children but is not itself a selectable scope. Video/Books are
// plain leaves. This mirrors the shape documented in
// docs/reference/media/search-scopes.md ("a parent may also carry its own
// params, making the whole category searchable in addition to its leaves").
// The third shape — a parent with BOTH children AND its own params, e.g. a
// real "Video" scope that's searchable on its own but also drills into
// Movies/Shows — is covered by its own test below with a dedicated fixture,
// so it doesn't have to share the constraints of the other three tests.
const baseScopes = [
  { key: 'all', label: 'All', params: '' },
  { key: 'video', label: 'Video', params: 'mediaType=video' },
  {
    key: 'music',
    label: 'Music',
    children: [
      { key: 'music-library', label: 'Library', params: 'source=plex&plex.libraryId=6' },
      { key: 'music-hymns', label: 'Hymns', params: 'source=plex&plex.libraryId=7' },
      { key: 'music-children', label: "Children's", params: 'source=plex&plex.libraryId=8' },
      { key: 'music-ambient', label: 'Ambient', params: 'source=plex&plex.libraryId=9' },
    ],
  },
  { key: 'books', label: 'Books', params: 'mediaType=book' },
];

let scopes = baseScopes;

vi.mock('./SearchProvider.jsx', () => ({
  useSearchContext: () => ({
    scopes,
    currentScopeKey,
    currentScope: scopes.find((s) => s.key === currentScopeKey) ?? null,
    scopeError: null,
    setScopeKey,
    resetScope: vi.fn(),
  }),
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info }) }),
}));

import { ScopeChips } from './ScopeChips.jsx';

beforeEach(() => {
  scopes = baseScopes;
  currentScopeKey = 'all';
  setScopeKey.mockReset();
  info.mockReset();
});

describe('ScopeChips', () => {
  it('renders top-level scopes as chips with All selected', () => {
    render(<ScopeChips />);

    expect(screen.getByTestId('scope-chip-all')).toHaveTextContent('All');
    expect(screen.getByTestId('scope-chip-video')).toHaveTextContent('Video');
    expect(screen.getByTestId('scope-chip-music')).toHaveTextContent('Music');
    expect(screen.getByTestId('scope-chip-books')).toHaveTextContent('Books');

    expect(screen.getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-chip-video')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('scope-chip-music')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('scope-chip-books')).toHaveAttribute('aria-pressed', 'false');
  });

  it('tapping a parent with children reveals the child chip row', () => {
    render(<ScopeChips />);

    expect(screen.queryByTestId('scope-chip-music-library')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('scope-chip-music'));

    expect(screen.getByTestId('scope-chip-music-library')).toBeInTheDocument();
    expect(screen.getByTestId('scope-chip-music-hymns')).toBeInTheDocument();
    expect(screen.getByTestId('scope-chip-music-children')).toBeInTheDocument();
    expect(screen.getByTestId('scope-chip-music-ambient')).toBeInTheDocument();

    // Music carries no params of its own — revealing its children is not a
    // selection, so it must not narrow the search by itself.
    expect(setScopeKey).not.toHaveBeenCalled();
  });

  it('tapping a chip calls setScopeKey with its key and logs the selection', () => {
    render(<ScopeChips />);

    fireEvent.click(screen.getByTestId('scope-chip-video'));

    expect(setScopeKey).toHaveBeenCalledWith('video');
    expect(info).toHaveBeenCalledWith('search.scope_selected', { scopeKey: 'video', viaFallback: false });

    fireEvent.click(screen.getByTestId('scope-chip-music'));
    fireEvent.click(screen.getByTestId('scope-chip-music-hymns'));

    expect(setScopeKey).toHaveBeenCalledWith('music-hymns');
    expect(info).toHaveBeenCalledWith('search.scope_selected', { scopeKey: 'music-hymns', viaFallback: false });
  });

  it('auto-expands the owning parent row when mounted with a child scope already selected', () => {
    currentScopeKey = 'music-hymns';
    render(<ScopeChips />);

    expect(screen.getByTestId('scope-chip-music-hymns')).toBeInTheDocument();
    expect(screen.getByTestId('scope-chip-music-hymns')).toHaveAttribute('aria-pressed', 'true');
  });

  it('tapping a parent that also carries its own params selects it AND reveals its children', () => {
    // The real-config case (search-scopes.md): a parent that is itself a
    // searchable scope ("All Video") in addition to grouping leaves under
    // it. Distinct from the Music fixture above, which has no params and
    // must NOT select on tap.
    scopes = [
      { key: 'all', label: 'All', params: '' },
      {
        key: 'video',
        label: 'Video',
        params: 'mediaType=video',
        children: [
          { key: 'video-movies', label: 'Movies', params: 'mediaType=video&form=movie' },
          { key: 'video-shows', label: 'Shows', params: 'mediaType=video&form=show' },
        ],
      },
      { key: 'books', label: 'Books', params: 'mediaType=book' },
    ];

    render(<ScopeChips />);

    expect(screen.queryByTestId('scope-chip-video-movies')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('scope-chip-video'));

    // (a) selects the parent itself
    expect(setScopeKey).toHaveBeenCalledWith('video');
    // (b) logs the selection
    expect(info).toHaveBeenCalledWith('search.scope_selected', { scopeKey: 'video', viaFallback: false });
    // (c) reveals the child row
    expect(screen.getByTestId('scope-chip-video-movies')).toBeInTheDocument();
    expect(screen.getByTestId('scope-chip-video-shows')).toBeInTheDocument();
  });
});
