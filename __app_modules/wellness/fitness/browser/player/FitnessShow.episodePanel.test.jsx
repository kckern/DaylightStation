import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, within, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The always-on episode panel: the rail (season poster + carousel of stills
// from inside the episode), title, blurb, Resume / Start over, and the history
// of actual completions.

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
import { resetEpisodeStillsCache } from './useEpisodeStills.js';

const show = (labels = []) => ({
  info: { type: 'show', title: 'Panel Show', labels, image: 'poster.jpg' },
  items: [
    { plex: '401', id: 'plex:401', label: 'Ep 1', parentId: 'p1', itemIndex: 1, image: 'e1.jpg', duration: 1800,
      isWatched: false, watchSeconds: 600, watchProgress: 33, summary: 'First one.' },
    { plex: '402', id: 'plex:402', label: 'Ep 2', parentId: 'p1', itemIndex: 2, image: 'e2.jpg', duration: 1800, isWatched: false, summary: 'Second one.' },
    { plex: '403', id: 'plex:403', label: 'Ep 3', parentId: 'p1', itemIndex: 3, image: 'e3.jpg', duration: 1800, isWatched: false, summary: 'Third one.' },
  ],
  parents: { p1: { index: 1, title: 'Season 1', thumbnail: 'season1.jpg' } },
});

const rider = (id, minutes, extra = {}) => ({ id, displayName: id, minutes, rings: 40, isGuest: false, ...extra });
const HISTORY = {
  episodes: {
    'plex:401': [
      { sessionId: 's2', startTime: new Date(2026, 9, 20, 7).getTime(), playedMs: 1800000, durationMs: 2760000, totalRings: 848, videoCount: 3,
        riders: [rider('rider-a', 31), rider('rider-b', 29), rider('guest-x', 30, { isGuest: true }), rider('rider-c', 2)] },
      { sessionId: 's1', startTime: new Date(2026, 9, 1, 7).getTime(), playedMs: 1800000,
        riders: [rider('rider-c', 28), rider('rider-a', 20)] },
    ],
    'plex:402': [
      { sessionId: 's3', startTime: new Date(2026, 9, 21, 7).getTime(), playedMs: 1800000, durationMs: 1800000, totalRings: 300, videoCount: 1,
        riders: [rider('rider-b', 30)] },
    ],
  },
};

// The media server's metadata for an episode whose part carries a preview index.
const METADATA = { MediaContainer: { Metadata: [{ duration: 1800000, Media: [{ Part: [{ id: 777, indexes: 'sd', duration: 1800000 }] }] }] } };

function mockApi(data) {
  DaylightAPI.mockImplementation(async (url) => (String(url).includes('/sessions/episode-history') ? HISTORY : data));
}
let fetchMock;
beforeEach(() => {
  vi.useRealTimers();
  resetEpisodeStillsCache();
  fetchMock = vi.fn(async (url) => ({ ok: true, json: async () => (String(url).includes('/library/metadata/') ? METADATA : {}) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const renderShow = () => {
  const setFitnessPlayQueue = vi.fn();
  const utils = render(<FitnessShow showId="plex:9000" setFitnessPlayQueue={setFitnessPlayQueue} onPlay={vi.fn()} onBack={() => {}} />);
  return { ...utils, setFitnessPlayQueue };
};
const panel = (container) => container.querySelector('[data-testid="episode-panel"]');
const historyRows = (container) => [...container.querySelectorAll('[data-testid="episode-history"] .episode-history__row')];
const waitForMosaic = (container) => waitFor(() => {
  const el = container.querySelector('[data-testid="episode-mosaic"]');
  expect(el).toBeTruthy();
  expect(el.querySelectorAll('img')).toHaveLength(9);
  return el;
}, { timeout: 3000 });
const loadAll = (mosaic) => act(() => { mosaic.querySelectorAll('img').forEach((img) => fireEvent.load(img)); });

describe('FitnessShow episode panel', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  it('describes the next-up episode without a tap: rail, title, blurb, Play, then history', async () => {
    mockApi(show());
    const { container } = renderShow();
    await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
    const el = panel(container);
    expect(el.querySelector('.episode-panel__description').textContent).toBe('First one.');
    expect(el.querySelector('.episode-panel__meta').textContent).toBe('Episode 1 · 30 min');
    const order = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const rail = el.querySelector('[data-testid="episode-rail"]');
    const title = el.querySelector('.episode-panel__title');
    const play = el.querySelector('[data-testid="play-episode-button"]');
    expect(order(rail, title)).toBe(true);
    expect(order(title, el.querySelector('.episode-panel__description'))).toBe(true);
    expect(order(el.querySelector('.episode-panel__description'), play)).toBe(true);
    expect(order(play, el.querySelector('[data-testid="episode-history"]'))).toBe(true);
  });

  describe('the rail', () => {
    it('is reserved from first paint: season poster and the episode art before any still arrives', async () => {
      mockApi(show());
      const { container } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      const rail = container.querySelector('[data-testid="episode-rail"]');
      expect(rail.querySelector('.episode-rail__poster img').getAttribute('src')).toBe('season1.jpg');
      expect(rail.querySelector('.episode-rail__art img').getAttribute('src')).toBe('e1.jpg');
      expect(rail.querySelector('.episode-rail__carousel').getAttribute('data-frame')).toBe('art');
    });

    it('asks the media server once for the part, then shows a 3×3 mosaic of nine stills spaced through the runtime', async () => {
      mockApi(show());
      const { container } = renderShow();
      const mosaic = await waitForMosaic(container);
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/v1/proxy/plex/library/metadata/401'))).toHaveLength(1);
      const srcs = [...mosaic.querySelectorAll('img')].map((i) => i.getAttribute('src'));
      expect(srcs[0]).toBe('/api/v1/proxy/plex/library/parts/777/indexes/sd/180000?w=400&h=225');
      expect(srcs[8]).toBe('/api/v1/proxy/plex/library/parts/777/indexes/sd/1620000?w=400&h=225');
      // Not live until every tile has loaded: the art stays, no blank tile ever shows.
      const carousel = container.querySelector('.episode-rail__carousel');
      expect(carousel.getAttribute('data-frame')).toBe('art');
      loadAll(mosaic);
      expect(carousel.getAttribute('data-frame')).toBe('0');
      expect(carousel.className).toContain('is-live');
      // Ten frames: the mosaic, then each still whole.
      const frames = carousel.querySelectorAll('.episode-rail__frame');
      expect(frames).toHaveLength(10);
      expect(frames[0].className).toContain('is-current');
      expect(frames[3].querySelector('img').getAttribute('src')).toBe(srcs[2]);
    });

    it('advances every 1.5 s and loops back to the mosaic', async () => {
      mockApi(show());
      const { container } = renderShow();
      const mosaic = await waitForMosaic(container);
      vi.useFakeTimers();
      loadAll(mosaic);
      const carousel = container.querySelector('.episode-rail__carousel');
      expect(carousel.getAttribute('data-frame')).toBe('0');
      act(() => { vi.advanceTimersByTime(1500); });
      expect(carousel.getAttribute('data-frame')).toBe('1');
      act(() => { vi.advanceTimersByTime(1500 * 9); });
      expect(carousel.getAttribute('data-frame')).toBe('0');
    });

    it('stands still on the mosaic under prefers-reduced-motion', async () => {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
      mockApi(show());
      const { container } = renderShow();
      const mosaic = await waitForMosaic(container);
      vi.useFakeTimers();
      loadAll(mosaic);
      const carousel = container.querySelector('.episode-rail__carousel');
      act(() => { vi.advanceTimersByTime(1500 * 4); });
      expect(carousel.getAttribute('data-frame')).toBe('0');
    });

    it('keeps the episode art, static, when the part has no preview index', async () => {
      fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ MediaContainer: { Metadata: [{ Media: [{ Part: [{ id: 778 }] }] }] } }) }));
      mockApi(show());
      const { container } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      await waitFor(() => expect(logSpy.info).toHaveBeenCalledWith('fitness.show.stills_unavailable', expect.objectContaining({ episode: '401' })));
      expect(container.querySelector('[data-testid="episode-mosaic"]')).toBeNull();
      expect(container.querySelector('.episode-rail__art img').getAttribute('src')).toBe('e1.jpg');
      expect(container.querySelector('.episode-rail__carousel').getAttribute('data-frame')).toBe('art');
    });
  });

  describe('history', () => {
    it('lists each time it was actually done, newest first: who, when in words, and the circumstances', async () => {
      mockApi(show());
      const { container } = renderShow();
      await waitFor(() => expect(historyRows(container)).toHaveLength(2));
      const rows = historyRows(container);
      // Rider C's 2-minute drop-in on s2 is not a completion; the guest's ride is.
      expect(rows[0].querySelector('.episode-history__who').textContent).toBe('Rider A, Rider B and guest-x');
      expect(rows[0].querySelectorAll('.episode-history__avatar')).toHaveLength(3);
      expect(rows[0].querySelector('.episode-history__facts').textContent).toBe('46 min · 848 rings · 2 other videos');
      expect(rows[1].querySelector('.episode-history__who').textContent).toBe('Rider C and Rider A');
      expect(rows[1].querySelector('.episode-history__facts').textContent).toBe('28 min · 80 rings');
      expect(rows[0].querySelector('.episode-history__when').textContent).not.toBe('');
      expect(panel(container).textContent).not.toContain('Not yet');
      expect(panel(container).textContent).not.toContain('Rider Z');
    });

    it('says so, in one line, when nobody has done it', async () => {
      mockApi(show());
      const { container } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 3'));
      expect(historyRows(container)).toHaveLength(0);
      expect(panel(container).querySelector('.episode-history__empty').textContent).toBe('Nobody has done this one yet');
    });
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
      await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 3'));
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await new Promise((r) => setTimeout(r, 30));
      expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 3');
    });

    it('ignores the pad while a modal overlay (voice memo, feedback, prompt) is open', async () => {
      mockApi(show());
      const { container, setFitnessPlayQueue } = renderShow();
      await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
      for (const make of [
        () => Object.assign(document.createElement('div'), { className: 'voice-memo-overlay voice-memo-overlay--record' }),
        () => { const d = document.createElement('div'); d.setAttribute('aria-modal', 'true'); return d; },
      ]) {
        const el = make();
        document.body.appendChild(el);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: 'Enter' });
        await new Promise((r) => setTimeout(r, 30));
        el.remove();
      }
      expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 1');
      expect(setFitnessPlayQueue).not.toHaveBeenCalled();
    });
  });
});

describe('FitnessShow episode panel — kiosk display standard (FitnessShow.scss)', () => {
  // Read from the bike: a thing is done or it is not — nothing rests dimmed
  // (the carousel crossfade goes 0 → 1), and headings are words, not tracked
  // capitals.
  const scss = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'FitnessShow.scss'), 'utf8');
  const block = scss.slice(scss.indexOf('/* Episode panel — '), scss.indexOf('/* Season/Episode Info Component Styling */'));

  it('has the episode panel block', () => { expect(block.length).toBeGreaterThan(1000); });
  it('never rests content at a fractional opacity', () => {
    expect(block.split('\n').filter((l) => /opacity\s*:\s*0?\.\d/.test(l))).toEqual([]);
  });
  it('never sets a heading in capitals', () => {
    expect(block.split('\n').filter((l) => /text-transform\s*:\s*uppercase|letter-spacing/.test(l))).toEqual([]);
  });
  it('keeps every size at 16px or more', () => {
    const small = [...block.matchAll(/font-size\s*:\s*([\d.]+)rem/g)].map((m) => Number(m[1])).filter((v) => v < 1);
    expect(small).toEqual([]);
  });
  it('shows stills whole (contain, never cover) and respects reduced motion', () => {
    const rail = block.slice(block.indexOf('.episode-rail {'), block.indexOf('.episode-panel__title {\n'));
    expect(rail).not.toMatch(/object-fit:\s*cover/);
    expect(rail).toMatch(/prefers-reduced-motion/);
  });
});

describe('FitnessShow episode panel — season selected', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  it('Enter plays nothing while a season, not an episode, is on the panel', async () => {
    const data = show();
    data.items = [...data.items, { plex: '501', id: 'plex:501', label: 'S2 Ep 1', parentId: 'p2', itemIndex: 1, image: 'f1.jpg', duration: 1800 }];
    data.parents = { ...data.parents, p2: { index: 2, title: 'Season 2' } };
    mockApi(data);
    const { container, setFitnessPlayQueue } = renderShow();
    const seasonButtons = await waitFor(() => {
      const el = container.querySelectorAll('.season-item');
      expect(el.length).toBe(2);
      return el;
    });
    fireEvent.pointerDown(seasonButtons[1]);
    await waitFor(() => expect(container.querySelector('[data-testid="episode-panel"]')).toBeNull());
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(setFitnessPlayQueue).not.toHaveBeenCalled();
  });
});

describe('FitnessShow episode panel — sequential lock', () => {
  beforeEach(() => { DaylightAPI.mockReset(); mockCtx.plexConfig = { sequential_labels: ['sequential'] }; });
  afterEach(() => { mockCtx.plexConfig = { resumable_labels: ['resumable'] }; });

  it('never offers Play for a locked episode reached with the pad', async () => {
    mockApi(show(['Sequential']));
    const { container, setFitnessPlayQueue } = renderShow();
    await waitFor(() => expect(panel(container)?.textContent).toContain('Ep 1'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(panel(container).querySelector('.episode-panel__title').textContent).toContain('Ep 3'));
    expect(within(panel(container)).queryByRole('button', { name: /Play|Resume|Start over/ })).toBeNull();
    expect(panel(container).textContent).toContain('Locked');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(setFitnessPlayQueue).not.toHaveBeenCalled();
  });
});
