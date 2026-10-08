import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const dispatchLeafVerb = vi.fn();
const queuePlayNow = vi.fn();
const pop = vi.fn();
let backDestination = 'Browse';
let contentState;
const apiMock = vi.fn(() => Promise.resolve({ items: [] }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('./useContentInfo.js', () => ({
  useContentInfo: () => contentState,
}));
vi.mock('../search/useContentDispatch.js', () => ({ useContentDispatch: () => ({ dispatchLeafVerb }) }));
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ queue: { playNow: queuePlayNow, playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() } }),
}));
vi.mock('../cast/CastButton.jsx', () => ({ CastButton: () => null }));
vi.mock('../cast/DestinationLine.jsx', () => ({ DestinationLine: () => <div data-testid="detail-aim">Aim: This device</div> }));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ pop, backDestination }) }));

import { DetailView } from './DetailView.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  contentState = { info: { title: 'Episode 3', type: 'episode', thumbnail: 'episode.jpg' }, loading: false, error: null };
  backDestination = 'Browse';
  apiMock.mockReset();
  apiMock.mockImplementation(() => Promise.resolve({ items: [] }));
});

describe('DetailView facts (FIND.8a/AC2)', () => {
  it('states the kind and the length in words, and the summary as the description', () => {
    contentState.info = { title: 'Arrival', type: 'movie', duration: 6983, metadata: { type: 'movie', librarySectionTitle: 'Movies', summary: 'Linguist meets aliens.' } };
    render(<MantineProvider><DetailView contentId="plex:55854" /></MantineProvider>);
    expect(screen.getByTestId('detail-facts')).toHaveTextContent('Movie · 1 hr 56 min');
    expect(screen.getByText('Linguist meets aliens.')).toBeVisible();
  });
  it('knows how far anyone has got on a page opened straight to the item (lists not loaded yet)', async () => {
    contentState.info = { title: 'Arrival', type: 'movie', duration: 6000 };
    apiMock.mockImplementation((url) => Promise.resolve(String(url).includes('carry-on')
      ? { items: [{ contentId: 'plex:55854', playhead: 1560, duration: 6000, finished: false }] }
      : { items: [] }));
    render(<MantineProvider><DetailView contentId="plex:55854" /></MantineProvider>);
    await waitFor(() => expect(screen.getByTestId('detail-progress')).toHaveTextContent(/min left/));
  });
  it('says how many items a collection holds instead of a length', () => {
    contentState.info = { title: 'Show', type: 'show', childCount: 12 };
    render(<MantineProvider><DetailView contentId="plex:9" /></MantineProvider>);
    expect(screen.getByTestId('detail-facts')).toHaveTextContent('TV Show · 12 episodes');
  });
});

describe('DetailView Play Now', () => {
  it('keeps the visible aim beside every detail-page playback verb', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    expect(screen.getByTestId('detail-aim')).toHaveTextContent('Aim: This device');
    expect(screen.getByTestId('detail-play-now')).toBeVisible();
    expect(screen.getByTestId('detail-play-next')).toBeVisible();
    expect(screen.getByTestId('detail-up-next')).toBeVisible();
    expect(screen.getByTestId('detail-add')).toBeVisible();
  });
  it('offers explicit Shuffle beside collection Play', () => {
    contentState.info = { title: 'Album', type: 'album' };
    render(<MantineProvider><DetailView contentId="plex:album" /></MantineProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle', exact: true }));
    expect(dispatchLeafVerb).toHaveBeenLastCalledWith('shuffle', 'plex:album', expect.objectContaining({ type: 'album' }));
  });
  it('routes Next, First and Add through the displayed destination', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    for (const [testId, verb] of [['detail-play-next', 'playNext'], ['detail-up-next', 'playFirst'], ['detail-add', 'add']]) {
      fireEvent.click(screen.getByTestId(testId));
      expect(dispatchLeafVerb).toHaveBeenLastCalledWith(verb, 'plex:685088', expect.objectContaining({ title: 'Episode 3' }));
    }
  });
  it('shows a Back destination and uses the route pop seam', () => {
    backDestination = 'Home';
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);

    expect(screen.getByTestId('detail-back')).toHaveTextContent('Home');
    fireEvent.click(screen.getByTestId('detail-back'));
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['loading', { info: null, loading: true, error: null }],
    ['error', { info: null, loading: false, error: new Error('not found') }],
    ['empty', { info: null, loading: false, error: null }],
  ])('keeps Back available in the %s detail state', (_state, nextContentState) => {
    contentState = nextContentState;
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);

    expect(screen.getByTestId('detail-back')).toHaveTextContent('Browse');
    fireEvent.click(screen.getByTestId('detail-back'));
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it('routes the loaded detail item through the current destination dispatcher', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    fireEvent.click(screen.getByTestId('detail-play-now'));

    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:685088', expect.objectContaining({
      id: 'plex:685088', title: 'Episode 3', thumbnail: 'episode.jpg',
    }));
    expect(queuePlayNow).not.toHaveBeenCalled();
  });
});

describe('DetailView household verbs (FIND.12a, FIND.10a/AC6)', () => {
  it('adds to favourites and marks watched in one step each', async () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    fireEvent.click(screen.getByTestId('detail-favourite'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/favourites', expect.objectContaining({ id: 'plex:685088', kind: 'item' }), 'POST');
    fireEvent.click(screen.getByTestId('detail-watched'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/watched', { contentId: 'plex:685088', watched: true }, 'POST');
  });
  it('a collection offers favourites but no watched marks', () => {
    contentState.info = { title: 'Album', type: 'album' };
    render(<MantineProvider><DetailView contentId="plex:album" /></MantineProvider>);
    expect(screen.getByTestId('detail-favourite')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-watched')).toBeNull();
  });
});
