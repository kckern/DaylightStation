import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const controller = {
  queue: {
    playNow: vi.fn(),
    add: vi.fn(),
    playNext: vi.fn(),
    addUpNext: vi.fn(),
  },
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => controller),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { SearchResults } from './SearchResults.jsx';

beforeEach(() => {
  controller.queue.playNow.mockClear();
  controller.queue.add.mockClear();
  controller.queue.playNext.mockClear();
  controller.queue.addUpNext.mockClear();
  navCtx.push.mockClear();
});

describe('SearchResults', () => {
  const row = { id: 'plex:660761', title: 'Lonesome Ghosts', thumbnail: '/t.jpg', mediaType: 'video' };

  it('renders nothing while still searching with no results yet', () => {
    const { container } = render(<SearchResults results={[]} pending={['plex']} isSearching={true} />);
    expect(container.textContent).toMatch(/searching/i);
  });

  it('renders results', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    expect(screen.getByText('Lonesome Ghosts')).toBeInTheDocument();
  });

  it('Play Now calls controller.queue.playNow with mapped input', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    fireEvent.click(screen.getByTestId('result-play-now-plex:660761'));
    expect(controller.queue.playNow).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:660761', title: 'Lonesome Ghosts', format: 'video' }),
      { clearRest: true }
    );
  });

  it('Add to Queue calls controller.queue.add', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    fireEvent.click(screen.getByTestId('result-add-plex:660761'));
    expect(controller.queue.add).toHaveBeenCalled();
  });

  it('clicking title navigates to detail', () => {
    render(<SearchResults results={[row]} pending={[]} isSearching={false} />);
    fireEvent.click(screen.getByTestId('result-open-plex:660761'));
    expect(navCtx.push).toHaveBeenCalledWith('detail', { contentId: 'plex:660761' });
  });
});
