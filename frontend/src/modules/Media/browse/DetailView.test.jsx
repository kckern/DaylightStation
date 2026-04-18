import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let infoState = { info: null, loading: true, error: null };
vi.mock('./useContentInfo.js', () => ({
  useContentInfo: vi.fn(() => infoState),
}));

const controller = { queue: { playNow: vi.fn(), add: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn() } };
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => controller),
}));

import { DetailView } from './DetailView.jsx';

beforeEach(() => {
  Object.values(controller.queue).forEach((f) => f.mockClear());
  infoState = { info: null, loading: true, error: null };
});

describe('DetailView', () => {
  it('renders loading state', () => {
    render(<DetailView contentId="plex:1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders title + thumbnail when info loaded', () => {
    infoState = { info: { title: 'Lonesome Ghosts', thumbnail: '/t.jpg' }, loading: false, error: null };
    render(<DetailView contentId="plex:1" />);
    expect(screen.getByText('Lonesome Ghosts')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/t.jpg');
  });

  it('Play Now dispatches queue.playNow with contentId', () => {
    infoState = { info: { title: 'X', mediaType: 'video' }, loading: false, error: null };
    render(<DetailView contentId="plex:5" />);
    fireEvent.click(screen.getByTestId('detail-play-now'));
    expect(controller.queue.playNow).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:5' }),
      { clearRest: true }
    );
  });

  it('renders error', () => {
    infoState = { info: null, loading: false, error: new Error('nope') };
    render(<DetailView contentId="plex:1" />);
    expect(screen.getByText(/nope/i)).toBeInTheDocument();
  });
});
