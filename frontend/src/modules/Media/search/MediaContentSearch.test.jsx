// frontend/src/modules/Media/search/MediaContentSearch.test.jsx
// The dock's transient content picker: a selection is handed to
// useContentDispatch and the destination it chose is logged.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable holders — factories close over these but only read at render time.
const dispatch = vi.fn();
const playContainerAsQueue = vi.fn();
const info = vi.fn();

vi.mock('./useContentDispatch.js', () => ({
  useContentDispatch: () => ({ dispatch, playContainerAsQueue }),
}));

// ── useSessionController: the ⋯ verb menu's four queue actions ──
const queuePlayNow = vi.fn();
const queuePlayNext = vi.fn();
const queueAddUpNext = vi.fn();
const queueAdd = vi.fn();
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    queue: { playNow: queuePlayNow, playNext: queuePlayNext, addUpNext: queueAddUpNext, add: queueAdd },
  }),
}));

// ── NavProvider: "Open detail" push ──
const navPush = vi.fn();
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: () => ({ push: navPush }),
}));

const notificationsShow = vi.fn();
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...a) => notificationsShow(...a) },
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

vi.mock('./useSearchContext.js', () => ({
  useSearchContext: () => searchContext,
}));

// Stand-in for the real combobox: buttons that fire the same onChange/
// onPlayAll/onMore contracts the real ContentCombobox uses (Task 14 wires
// these through to ResultRowActions — that wiring itself is covered by
// ContentCombobox.test.jsx; this suite only proves MediaContentSearch hands
// off the right callbacks). Captures the props MediaContentSearch threads in
// (fallbackSearchParams/scopeKey/scopeLabel — Task 11 fix round) so tests
// can assert on them directly.
let comboboxProps;
vi.mock('../../Content/combobox/ContentCombobox.jsx', () => ({
  ContentCombobox: (props) => {
    comboboxProps = props;
    const leaf = { id: 'plex:685088', title: 'Episode 3', type: 'episode' };
    const container = { id: 'plex:663508', title: 'Tuttle Twins', type: 'show' };
    return (
      <>
        <button data-testid="pick-episode" onClick={() => props.onChange(leaf.id, leaf)}>pick</button>
        <button data-testid="pick-container" onClick={() => props.onChange(container.id, container)}>pick container</button>
        <button data-testid="play-all-container" onClick={() => props.onPlayAll?.(container)}>play all</button>
        <button data-testid="more-play-next" onClick={() => props.onMore?.('playNext', leaf)}>play next</button>
        <button data-testid="more-detail" onClick={() => props.onMore?.('detail', leaf)}>open detail</button>
      </>
    );
  },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info }) }),
}));

import { MediaContentSearch } from './MediaContentSearch.jsx';

beforeEach(() => {
  dispatch.mockReset();
  playContainerAsQueue.mockReset();
  info.mockReset();
  queuePlayNow.mockReset();
  queuePlayNext.mockReset();
  queueAddUpNext.mockReset();
  queueAdd.mockReset();
  navPush.mockReset();
  notificationsShow.mockReset();
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
      { id: 'plex:685088', title: 'Episode 3', type: 'episode' }
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

  // ── Task 14 (spec D6): the desktop half of the same tap grammar — a
  // container tap still routes through dispatch() (browse, per the hook's
  // own tests); what's new here is the ▶/⋯ verbs MediaContentSearch now
  // hands to ContentCombobox. ──
  describe('tap grammar (Task 14)', () => {
    it('a container tap routes through dispatch(), not playContainerAsQueue', () => {
      dispatch.mockReturnValue('browse');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('pick-container'));

      expect(dispatch).toHaveBeenCalledWith('plex:663508', expect.objectContaining({ id: 'plex:663508' }));
      expect(playContainerAsQueue).not.toHaveBeenCalled();
    });

    it('▶ calls playContainerAsQueue and toasts on a local route', () => {
      playContainerAsQueue.mockReturnValue('local');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('play-all-container'));

      expect(playContainerAsQueue).toHaveBeenCalledWith('plex:663508', expect.objectContaining({ id: 'plex:663508' }));
      expect(notificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Playing Tuttle Twins' })
      );
    });

    it('▶ does not toast on a cast route (useContentDispatch already toasts it)', () => {
      playContainerAsQueue.mockReturnValue('cast');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('play-all-container'));

      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('⋯ Play Next calls queue.playNext', () => {
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('more-play-next'));

      expect(queuePlayNext).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:685088' }));
    });

    it('⋯ Open detail pushes the detail view, touching no queue applier', () => {
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('more-detail'));

      expect(navPush).toHaveBeenCalledWith('detail', { contentId: 'plex:685088' });
      expect(queuePlayNow).not.toHaveBeenCalled();
    });
  });
});
