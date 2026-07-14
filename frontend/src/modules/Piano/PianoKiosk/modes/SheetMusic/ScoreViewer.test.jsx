import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => h.api(...a) }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info() {}, warn() {}, debug() {} }) }) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));

import ScoreViewer from './ScoreViewer.jsx';

const route = (path) => (path.includes('/info/') ? 'info' : 'list');

beforeEach(() => { h.api.mockReset(); });

describe('ScoreViewer', () => {
  it('self-resolves title + cover from the info API when there are no child pages (H3)', async () => {
    h.api.mockImplementation((path) => Promise.resolve(
      route(path) === 'info' ? { title: 'Sonata', image: 'cover.jpg' } : { items: [] },
    ));
    render(<ScoreViewer score={{ id: 'plex:123' }} />);
    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'cover.jpg'); // falls back to the info cover, not "no pages"
    expect(img).toHaveAttribute('loading', 'lazy');  // M7
  });

  it('renders child page images lazily', async () => {
    h.api.mockImplementation((path) => Promise.resolve(
      route(path) === 'info' ? { title: 'X' } : { items: [{ image: 'p1.jpg' }, { image: 'p2.jpg' }] },
    ));
    render(<ScoreViewer score={{ id: 'plex:9' }} />);
    const imgs = await screen.findAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute('loading', 'lazy');
    expect(imgs[0]).toHaveAttribute('decoding', 'async');
  });

  it('shows a Try again button on load failure and refetches (M6)', async () => {
    h.api.mockRejectedValueOnce(new Error('net')).mockRejectedValueOnce(new Error('net'));
    render(<ScoreViewer score={{ id: 'plex:5' }} />);
    const retry = await screen.findByRole('button', { name: /try again/i });
    // Second attempt succeeds.
    h.api.mockImplementation((path) => Promise.resolve(
      route(path) === 'info' ? { title: 'Y', image: 'y.jpg' } : { items: [] },
    ));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'y.jpg'));
  });
});
