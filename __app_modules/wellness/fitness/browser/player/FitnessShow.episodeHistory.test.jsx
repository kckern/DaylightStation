import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Per-rider episode history on the show screen: the grid chip's avatars and
// the session list in an episode's details.

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
  fitnessConfiguration: { locks: {} }, governedLabels: [], governedTypes: [], plexConfig: {},
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

const SHOW = {
  info: { type: 'show', title: 'History Show', labels: [], image: 'poster.jpg' },
  items: [
    // 30 min episodes; watched per the media server, with its own date.
    { plex: '401', id: 'plex:401', label: 'Ep 1', parentId: 'p1', itemIndex: 1, image: 'e1.jpg', duration: 1800, isWatched: true, watchedDate: '2026-02-02 10:00:00am' },
    { plex: '402', id: 'plex:402', label: 'Ep 2', parentId: 'p1', itemIndex: 2, image: 'e2.jpg', duration: 1800, isWatched: true, watchedDate: '2026-02-03 10:00:00am' },
  ],
  parents: { p1: { index: 1, title: 'Season 1' } },
};

const rider = (id, minutes, extra = {}) => ({ id, displayName: id, minutes, rings: 40, isGuest: false, ...extra });
const HISTORY = {
  episodes: {
    'plex:401': [
      { sessionId: 's2', date: '2026-10-14', startTime: new Date(2026, 9, 14, 7).getTime(),
        riders: [rider('rider-a', 31), rider('rider-b', 29), rider('guest-x', 30, { isGuest: true })] },
      { sessionId: 's1', date: '2026-10-01', startTime: new Date(2026, 9, 1, 7).getTime(),
        riders: [rider('rider-c', 28), rider('rider-d', 4)] },
    ],
    // Only a three-minute drop-in: nobody did Ep 2, so the old chip stays.
    'plex:402': [
      { sessionId: 's3', date: '2026-10-20', startTime: new Date(2026, 9, 20, 7).getTime(), riders: [rider('rider-a', 3)] },
    ],
  },
};

function mockApi({ history = HISTORY, historyFails = false } = {}) {
  DaylightAPI.mockImplementation(async (url) => {
    if (String(url).includes('/sessions/episode-history')) {
      if (historyFails) throw new Error('boom');
      return history;
    }
    return SHOW;
  });
}

const renderShow = () => render(<FitnessShow showId="plex:9000" setFitnessPlayQueue={vi.fn()} onPlay={vi.fn()} onBack={() => {}} />);
const card = (container, plexId) => container.querySelector(`[data-plex-id="${plexId}"]`)?.closest('.episode-card');

describe('FitnessShow episode history', () => {
  beforeEach(() => { DaylightAPI.mockReset(); logSpy.warn.mockClear(); });

  it('asks for this show\'s episodes and puts credited household riders on the chip', async () => {
    mockApi();
    const { container } = renderShow();
    await waitFor(() => expect(card(container, '401')?.querySelector('[data-testid="episode-rider-badge"]')).toBeTruthy());

    const historyCall = DaylightAPI.mock.calls.find(([url]) => url.includes('/sessions/episode-history'));
    expect(decodeURIComponent(historyCall[0])).toContain('episodes=plex:401,plex:402');

    const badge = card(container, '401').querySelector('[data-testid="episode-rider-badge"]');
    // Newest session's riders first; the guest and the 4-minute drop-in are left off.
    expect([...badge.querySelectorAll('.episode-rider-avatar')].map((img) => img.getAttribute('src')))
      .toEqual(['/static/img/users/rider-a', '/static/img/users/rider-b', '/static/img/users/rider-c']);
    expect(badge.textContent).toContain('Oct 14');
    expect(badge.textContent).not.toContain('✔️');
  });

  it('keeps the plain watched chip when nobody did enough of the episode', async () => {
    mockApi();
    const { container } = renderShow();
    await waitFor(() => expect(card(container, '401')?.querySelector('[data-testid="episode-rider-badge"]')).toBeTruthy());
    const chip = card(container, '402').querySelector('.badge.watched-date');
    expect(chip.querySelector('.episode-rider-avatar')).toBeNull();
    expect(chip.textContent).toContain('✔️');
  });

  it('falls back to the plain chip and logs when the history call fails', async () => {
    mockApi({ historyFails: true });
    const { container } = renderShow();
    await waitFor(() => expect(logSpy.warn).toHaveBeenCalledWith('fitness.show.episode_history_failed', expect.objectContaining({ error: 'boom' })));
    expect(container.querySelector('[data-testid="episode-rider-badge"]')).toBeNull();
    expect(card(container, '401').querySelector('.badge.watched-date').textContent).toContain('✔️');
  });

  it('lists the sessions under the description in the episode details', async () => {
    mockApi();
    const { container } = renderShow();
    await waitFor(() => expect(card(container, '401')?.querySelector('[data-testid="episode-rider-badge"]')).toBeTruthy());
    fireEvent.pointerDown(card(container, '401').querySelector('.episode-title'));

    const list = await waitFor(() => {
      const el = container.querySelector('[data-testid="episode-history"]');
      expect(el).toBeTruthy();
      return el;
    });
    const rows = [...list.querySelectorAll('.episode-history__row')];
    expect(rows).toHaveLength(2);
    // A shared session: every credited rider, guests included, and no per-rider rings.
    expect(rows[0].querySelectorAll('.episode-rider-avatar')).toHaveLength(3);
    expect(rows[0].textContent).toMatch(/Oct 14 · 31 min$/);
    // A session where only one rider counts reads as that rider's.
    expect(rows[1].querySelectorAll('.episode-rider-avatar')).toHaveLength(1);
    expect(rows[1].textContent).toMatch(/Oct 1 · 28 min · 40 rings$/);
  });
});
