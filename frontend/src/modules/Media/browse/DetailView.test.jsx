import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const dispatchLeafVerb = vi.fn();
const queuePlayNow = vi.fn();
vi.mock('./useContentInfo.js', () => ({
  useContentInfo: () => ({ info: { title: 'Episode 3', type: 'episode', thumbnail: 'episode.jpg' }, loading: false, error: null }),
}));
vi.mock('../search/useContentDispatch.js', () => ({ useContentDispatch: () => ({ dispatchLeafVerb }) }));
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ queue: { playNow: queuePlayNow, playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() } }),
}));
vi.mock('../cast/CastButton.jsx', () => ({ CastButton: () => null }));

import { DetailView } from './DetailView.jsx';

describe('DetailView Play Now', () => {
  it('routes the loaded detail item through the current destination dispatcher', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    fireEvent.click(screen.getByTestId('detail-play-now'));

    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:685088', expect.objectContaining({
      id: 'plex:685088', title: 'Episode 3', thumbnail: 'episode.jpg',
    }));
    expect(queuePlayNow).not.toHaveBeenCalled();
  });
});
