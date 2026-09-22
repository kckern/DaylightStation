import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const dispatchLeafVerb = vi.fn();
const queuePlayNow = vi.fn();
const pop = vi.fn();
let backDestination = 'Browse';
let contentState;
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

    expect(screen.getByTestId('detail-back')).toHaveTextContent('← Home');
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

    expect(screen.getByTestId('detail-back')).toHaveTextContent('← Browse');
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
