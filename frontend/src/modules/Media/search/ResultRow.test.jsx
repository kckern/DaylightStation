import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const playNow = vi.fn();
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    queue: { playNow, playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() },
  }),
}));
vi.mock('../cast/CastButton.jsx', () => ({
  CastButton: () => <button data-testid="cast-stub">Cast</button>,
}));

import { ResultRow } from './ResultRow.jsx';

beforeEach(() => { playNow.mockClear(); });

describe('ResultRow', () => {
  it('renders a human subtitle — never the raw source id or "type • source" internals', () => {
    render(
      <ul>
        <ResultRow row={{
          id: 'plex:556671', title: 'Abbey Road', type: 'album', mediaType: 'audio',
          source: 'plex', duration: 47 * 60, metadata: { librarySectionTitle: 'Music' },
        }} />
      </ul>,
    );
    const row = screen.getByTestId('result-row-plex:556671');
    expect(row).toHaveTextContent('Music · Album · 47 min');
    expect(row.textContent).not.toMatch(/plex/i);
    expect(row.textContent).not.toContain('•');
  });

  it('has no debug peek panel and the title is not a toggle button', () => {
    render(
      <ul>
        <ResultRow row={{ id: 'plex:1', title: 'Bluey (2018)', type: 'show' }} />
      </ul>,
    );
    expect(screen.queryByTestId('result-peek-plex:1')).toBeNull();
    const title = screen.getByTestId('result-open-plex:1');
    expect(title.tagName).not.toBe('BUTTON');
    expect(screen.queryByText(/Source:/)).toBeNull();
    expect(screen.queryByText('plex:1', { selector: 'code' })).toBeNull();
  });

  it('de-uglifies machine filename titles', () => {
    render(
      <ul>
        <ResultRow row={{ id: 'files:x', title: '20240115_garage_workout.mp4' }} />
      </ul>,
    );
    expect(screen.getByTestId('result-open-files:x')).toHaveTextContent('20240115 garage workout');
  });

  it('keeps the queue actions intact', () => {
    render(
      <ul>
        <ResultRow row={{ id: 'plex:1', title: 'Bluey (2018)' }} />
      </ul>,
    );
    expect(screen.getByTestId('result-play-now-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('result-play-next-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('result-upnext-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('result-add-plex:1')).toBeInTheDocument();
    expect(screen.getByTestId('cast-stub')).toBeInTheDocument();
    screen.getByTestId('result-play-now-plex:1').click();
    expect(playNow).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:1' }),
      { clearRest: true },
    );
  });
});
