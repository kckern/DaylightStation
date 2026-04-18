import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let browseState = { items: [], total: 0, loading: false, error: null, loadMore: vi.fn() };
vi.mock('./useListBrowse.js', () => ({
  useListBrowse: vi.fn(() => browseState),
}));

const controller = { queue: { playNow: vi.fn(), add: vi.fn() } };
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => controller),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { BrowseView } from './BrowseView.jsx';

beforeEach(() => {
  controller.queue.playNow.mockClear();
  controller.queue.add.mockClear();
  navCtx.push.mockClear();
  browseState = { items: [], total: 0, loading: false, error: null, loadMore: vi.fn() };
});

describe('BrowseView', () => {
  it('shows loading state', () => {
    browseState = { items: [], total: 0, loading: true, error: null, loadMore: vi.fn() };
    render(<BrowseView path="music/recent" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders a leaf item with actions', () => {
    browseState = {
      items: [{ id: 'plex:1', title: 'Song A', itemType: 'leaf' }],
      total: 1, loading: false, error: null, loadMore: vi.fn(),
    };
    render(<BrowseView path="music/recent" />);
    expect(screen.getByText('Song A')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('result-play-now-plex:1'));
    expect(controller.queue.playNow).toHaveBeenCalled();
  });

  it('clicking a container navigates to a deeper browse view', () => {
    browseState = {
      items: [{ id: 'plex:folder', title: 'Folder', itemType: 'container' }],
      total: 1, loading: false, error: null, loadMore: vi.fn(),
    };
    render(<BrowseView path="music" />);
    fireEvent.click(screen.getByTestId('browse-open-plex:folder'));
    expect(navCtx.push).toHaveBeenCalledWith('browse', expect.objectContaining({ path: expect.stringContaining('plex:folder') }));
  });

  it('renders an error message', () => {
    browseState = { items: [], total: 0, loading: false, error: new Error('boom'), loadMore: vi.fn() };
    render(<BrowseView path="x" />);
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });
});
