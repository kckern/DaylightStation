import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const dispatchLeafVerb = vi.fn();
const queuePlayNow = vi.fn();
vi.mock('../session/recents.js', () => ({
  readRecents: () => [{ contentId: 'plex:685088', title: 'Episode 3', format: 'video', thumbnail: 'episode.jpg' }],
}));
vi.mock('../search/useContentDispatch.js', () => ({ useContentDispatch: () => ({ dispatchLeafVerb }) }));
vi.mock('../controller/useSessionController.js', () => ({ useSessionController: () => ({ queue: { playNow: queuePlayNow } }) }));

import { RecentsRow } from './RecentsRow.jsx';

describe('RecentsRow', () => {
  it('routes the exact recent item through the current destination dispatcher', () => {
    render(<MantineProvider><RecentsRow /></MantineProvider>);
    fireEvent.click(screen.getByTestId('recent-plex:685088'));

    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:685088', expect.objectContaining({
      id: 'plex:685088', title: 'Episode 3', format: 'video', thumbnail: 'episode.jpg',
    }));
    expect(queuePlayNow).not.toHaveBeenCalled();
  });
});
