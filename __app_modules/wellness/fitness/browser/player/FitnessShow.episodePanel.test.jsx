import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';

// The always-on episode panel: season mosaic, coverage, who's done it, and
// Resume / Start over for the focused episode.

beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));
vi.mock('@mantine/core', () => ({ LoadingOverlay: () => null, Alert: ({ children }) => <div>{children}</div> }));
const mockCtx = {
  setMusicAutoEnabled: vi.fn(), setCurrentMedia: vi.fn(), nomusicLabels: [],
  fitnessConfiguration: { locks: {} }, governedLabels: [], governedTypes: [],
  plexConfig: { resumable_labels: ['resumable'] },
  usersConfig: { primary: [
    { id: 'rider-a', name: 'Rider A' }, { id: 'rider-b', name: 'Rider B' },
    { id: 'rider-c', name: 'Rider C' }, { id: 'rider-z', name: 'Rider Z' },
  ] },
  fitnessSessionInstance: null,
};
vi.mock('../context/FitnessContext.jsx', () => ({ useFitness: () => mockCtx }));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => p,
  DaylightImagePath: (p) => `/api/v1/static/img/${p}`,
  ContentDisplayUrl: (id) => `display:${id}`,
  normalizeImageUrl: (u) => u || '',
}));
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => false }));
vi.mock('../identity/useIdentity.js', () => ({
  __esModule: true,
  useIdentity: () => ({ registerUnlock: vi.fn(), clearUnlock: vi.fn(), unlockState: 'idle', unlockedUser: null, activeLock: null }),
}));

import { DaylightAPI } from '@/lib/api.mjs';
import FitnessShow from './FitnessShow.jsx';

const show = (labels = []) => ({
  info: { type: 'show', title: 'Panel Show', labels, image: 'poster.jpg' },
  items: [
    { plex: '401', id: 'plex:401', label: 'Ep 1', parentId: 'p1', itemIndex: 1, image: 'e1.jpg', duration: 1800,
      isWatched: false, watchSeconds: 600, watchProgress: 33, summary: 'First one.' },
    { plex: '402', id: 'plex:402', label: 'Ep 2', parentId: 'p1', itemIndex: 2, image: 'e2.jpg', duration: 1800, isWatched: false, summary: 'Second one.' },
  ],
  parents: { p1: { index: 1, title: 'Season 1' } },
});

const rider = (id, minutes, extra = {}) => ({ id, displayName: id, minutes, rings: 40, isGuest: false, ...extra });
const HISTORY = {
  episodes: {
    'plex:401': [
      { sessionId: 's2', startTime: new Date(2026, 9, 14, 7).getTime(), playedMs: 1800000,
        riders: [rider('rider-a', 31), rider('rider-b', 29), rider('guest-x', 30, { isGuest: true })] },
      { sessionId: 's1', startTime: new Date(2026, 9, 1, 7).getTime(), playedMs: 1800000,
        riders: [rider('rider-c', 28), rider('rider-a', 20)] },
    ],
  },
};

function mockApi(data) {
  DaylightAPI.mockImplementation(async (url) => (String(url).includes('/sessions/episode-history') ? HISTORY : data));
}

const renderShow = () => {
  const setFitnessPlayQueue = vi.fn();
  const utils = render(<FitnessShow showId="plex:9000" setFitnessPlayQueue={setFitnessPlayQueue} onPlay={vi.fn()} onBack={() => {}} />);
  return { ...utils, setFitnessPlayQueue };
};
const panel = (container) => container.querySelector('[data-testid="episode-panel"]');

describe('FitnessShow episode panel', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  it('describes the next-up episode without a tap', async () => {
    mockApi(show());
    const { container } = renderShow();
    await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
    expect(panel(container).textContent).toContain('First one.');
  });

  it('shows the season as a mosaic of small thumbnails; a tap focuses without playing', async () => {
    mockApi(show());
    const { container, setFitnessPlayQueue } = renderShow();
    const mosaic = await waitFor(() => {
      const el = container.querySelector('[data-testid="episode-mosaic"]');
      expect(el).toBeTruthy();
      return el;
    });
    const tiles = [...mosaic.querySelectorAll('img')];
    expect(tiles.map((t) => t.getAttribute('src'))).toEqual(['e1.jpg?w=160&h=90', 'e2.jpg?w=160&h=90']);
    fireEvent.click(tiles[1].closest('[role="button"]'));
    await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 2'));
    expect(setFitnessPlayQueue).not.toHaveBeenCalled();
  });

  it("names everyone who did it, and the household members who haven't", async () => {
    mockApi(show());
    const { container } = renderShow();
    const rows = await waitFor(() => {
      const el = [...container.querySelectorAll('[data-testid="episode-riders"] .episode-rider-row')];
      expect(el.length).toBe(5);
      return el;
    });
    expect(rows.map((r) => r.querySelector('.episode-rider-row__name').textContent))
      .toEqual(['Rider A', 'Rider B', 'guest-x', 'Rider C', 'Rider Z']);
    expect(rows[0].textContent).toContain('2×');
    expect(rows.at(-1).textContent).toContain('Not yet');
  });

  it('counts each household rider across the season', async () => {
    mockApi(show());
    const { container } = renderShow();
    const chips = await waitFor(() => {
      const el = container.querySelector('[data-testid="season-coverage"]');
      expect(el).toBeTruthy();
      return el;
    });
    expect(chips.textContent).toContain('Rider A1/2');
    expect(chips.textContent).not.toContain('Rider Z');
  });

  it('offers Resume and Start over on a resumable show', async () => {
    mockApi(show(['Resumable']));
    const { container, setFitnessPlayQueue } = renderShow();
    const resume = await waitFor(() => within(panel(container)).getByRole('button', { name: /Resume 10:00/ }));
    fireEvent.click(resume);
    expect(setFitnessPlayQueue.mock.calls.at(-1)[0][0]).toMatchObject({ plex: '401', seconds: 600 });
    fireEvent.click(within(panel(container)).getByRole('button', { name: /Start over/ }));
    expect(setFitnessPlayQueue.mock.calls.at(-1)[0][0]).toMatchObject({ plex: '401', seconds: 0 });
  });

  it('just offers Play when the show does not resume', async () => {
    mockApi(show());
    const { container } = renderShow();
    await waitFor(() => within(panel(container)).getByRole('button', { name: /^Play/ }));
    expect(within(panel(container)).queryByRole('button', { name: /Resume/ })).toBeNull();
  });

  describe('gamepad and arrow keys', () => {
    it('moves focus along the grid without playing anything', async () => {
      mockApi(show());
      const { container, setFitnessPlayQueue } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 2'));
      expect(container.querySelector('[data-plex-id="402"]').closest('.episode-card').className).toContain('pad-focused');
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 1'));
      expect(setFitnessPlayQueue).not.toHaveBeenCalled();
    });

    it('plays the focused episode on Enter', async () => {
      mockApi(show());
      const { container, setFitnessPlayQueue } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 2'));
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(setFitnessPlayQueue.mock.calls.at(-1)[0][0]).toMatchObject({ plex: '402' });
    });

    it('leaves the keys to the sidebar menu while it is open', async () => {
      mockApi(show());
      const { container } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      const menu = document.createElement('div');
      menu.className = 'fitness-sidebar-menu';
      document.body.appendChild(menu);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await new Promise((r) => setTimeout(r, 50));
      expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 1');
      menu.remove();
    });

    it('focuses one card when episodes carry only an id (no plex field)', async () => {
      const data = show();
      data.items = data.items.map(({ plex, ...rest }) => rest);
      mockApi(data);
      const { container } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      expect(container.querySelectorAll('.episode-card.selected')).toHaveLength(1);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 2'));
      expect(container.querySelectorAll('.episode-card.pad-focused')).toHaveLength(1);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await new Promise((r) => setTimeout(r, 30));
      expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 2');
    });
  });
});
