// FIND.7a / 9a / 10a / 12b / 13a — the start page: server suggestions for this
// screen in order (favourites as large pictures first), Now-on cards instead
// of carry on for anything playing, Recent from every screen labelled with
// where it played, and a lead into Browse when there is nothing to suggest.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('../../../lib/deviceIdentity.js', () => ({ getDeviceId: () => 'browser:me' }));
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ controller: {}, snapshot: null, transport: {}, queue: { playNow: vi.fn() } }),
}));
vi.mock('../controller/usePlaybackPosition.js', () => ({ usePlaybackPosition: () => ({ seconds: 0 }) }));
const dispatch = vi.fn(); const dispatchLeafVerb = vi.fn(); const playContainerAsQueue = vi.fn(); const addContainerToQueue = vi.fn();
vi.mock('../search/useContentDispatch.js', () => ({
  useContentDispatch: () => ({ dispatch, dispatchLeafVerb, playContainerAsQueue, addContainerToQueue }),
}));
const push = vi.fn(); const goToArea = vi.fn();
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push, goToArea }) }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { HomeView } from './HomeView.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const SCREENS = { screens: [
  { id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV', aliases: [] },
  { id: 'browser:kid', name: "Kid's tablet", aliases: [] },
] };

function routes(overrides = {}) {
  const data = {
    'api/v1/media/suggestions?deviceId=browser%3Ame': { deviceId: 'browser:me', generatedAt: 'g1', empty: false, rows: [
      { id: 'favourites', title: 'Favourites', items: [
        { id: 'plex:100', kind: 'collection', type: 'show', title: 'Bluey', thumbnail: '/b.jpg', continue: { contentId: 'plex:105', title: 'Bingo' } },
      ] },
      { id: 'carry-on', title: 'Carry on', items: [
        { id: 'plex:1', kind: 'item', type: 'movie', title: 'Arrival', reason: 'unfinished', percent: 25, playhead: 1800, duration: 3840, playedOn: 'fleet:livingroom-tv' },
        { id: 'plex:2', kind: 'item', type: 'movie', title: 'Two Spots', reason: 'unfinished', percent: 10, playhead: 720, duration: 7200 },
      ] },
      { id: 'time-of-day', title: 'Usually here at this time', items: [{ id: 'plex:300', kind: 'collection', type: 'album', title: 'Morning Album', days: 4 }] },
      { id: 'new', title: 'New', items: [{ id: 'plex:400', kind: 'item', type: 'movie', title: 'Fresh Film' }] },
    ] },
    'api/v1/media/household/carry-on?limit=20': { nowPlayingKnown: true,
      items: [
        { contentId: 'plex:1', playhead: 1800, duration: 3840, percent: 47, playedOn: { deviceId: 'fleet:livingroom-tv' }, spots: [
          { deviceId: 'fleet:livingroom-tv', playhead: 1800, duration: 3840, open: true, lastPlayed: '2026-10-02 21:00:00' }] },
        { contentId: 'plex:2', playhead: 720, duration: 7200, spots: [
          { deviceId: 'browser:kid', playhead: 720, duration: 7200, open: true, lastPlayed: '2026-10-02 08:00:00' },
          { deviceId: 'fleet:livingroom-tv', playhead: 4800, duration: 7200, open: true, lastPlayed: '2026-10-01 21:00:00' }] },
      ],
      nowOn: [{ contentId: 'plex:9', title: 'Playing Thing', deviceId: 'fleet:livingroom-tv', state: 'playing' }] },
    'api/v1/media/household/recent?limit=24': { items: [
      { contentId: 'plex:50', title: 'Last Night Film', type: 'movie', lastPlayed: '2026-10-02 21:30:00', finished: true,
        playedOn: { deviceId: 'fleet:livingroom-tv' }, plays: [], spots: [] },
    ] },
    'api/v1/media/household/favourites': { items: [{ id: 'plex:100' }] },
    'api/v1/media/screens': SCREENS,
    ...overrides,
  };
  apiMock.mockImplementation((path, body, method) => {
    if (method && method !== 'GET') return Promise.resolve({ ok: true });
    if (path in data) return Promise.resolve(data[path]);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderHome() {
  return render(<MantineProvider><HomeView /></MantineProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetApiResourceCache();
  routes();
});

describe('HomeView start page', () => {
  it('asks for suggestions for THIS device and renders the rows in server order, favourites first and large', async () => {
    renderHome();
    await screen.findByTestId('home-row-favourites');
    expect(apiMock.mock.calls.map(call => call[0])).toContain('api/v1/media/suggestions?deviceId=browser%3Ame');
    const ids = [...document.querySelectorAll('[data-testid^="home-row-"]')].map(n => n.dataset.testid);
    expect(ids.slice(0, 4)).toEqual(['home-row-now-on', 'home-row-favourites', 'home-row-carry-on', 'home-row-time-of-day']);
    expect(ids).toContain('home-row-new');
    expect(screen.getByTestId('home-tile-favourites-plex:100')).toHaveClass('home-tile--large');
    expect(screen.getByText('Usually here at this time')).toBeInTheDocument();
  });

  it('carry on shows where it stopped, and both spots when screens differ', async () => {
    renderHome();
    const arrival = await screen.findByTestId('home-tile-carry-on-plex:1');
    expect(arrival).toHaveTextContent('34 min left · Living Room TV');
    await waitFor(() => expect(screen.getByTestId('home-tile-carry-on-plex:2'))
      .toHaveTextContent("12 m on Kid's tablet · 1 h 20 m on Living Room TV"));
  });

  it('shows playing items as "Now on <screen>" with Remote and Move here', async () => {
    renderHome();
    const card = await screen.findByTestId('home-tile-now-on-livingroom-tv-plex:9');
    await waitFor(() => expect(card).toHaveTextContent('Now on Living Room TV'));
    expect(within(card).getByRole('button', { name: /Move here/ })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /Remote/ }));
    expect(push).toHaveBeenCalledWith('peek', { deviceId: 'livingroom-tv' });
  });

  it('labels recent items from any screen with where they played', async () => {
    renderHome();
    const tile = await screen.findByTestId('home-tile-recent-plex:50');
    await waitFor(() => expect(tile).toHaveTextContent('Living Room TV'));
    expect(tile).toHaveTextContent(/Oct 2|Yesterday|\w{3} \d/);
  });

  it('follows the tap rule: a favourite picture opens, its Continue plays the next part', async () => {
    renderHome();
    const fav = await screen.findByTestId('home-tile-favourites-plex:100');
    fireEvent.click(within(fav).getByTestId('home-tile-favourites-plex:100-picture'));
    expect(dispatch).toHaveBeenCalledWith('plex:100', expect.objectContaining({ itemType: 'container' }));
    fireEvent.click(within(fav).getByRole('button', { name: /Continue Bingo/ }));
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:105', expect.objectContaining({ id: 'plex:105' }));
  });

  it('a playable carry-on picture continues from its spot', async () => {
    renderHome();
    const tile = await screen.findByTestId('home-tile-carry-on-plex:1');
    fireEvent.click(within(tile).getByTestId('home-tile-carry-on-plex:1-picture'));
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:1', expect.objectContaining({ id: 'plex:1' }), { resumedFrom: 1800 });
  });

  it('asks which spot when screens hold different spots', async () => {
    renderHome();
    const tile = await screen.findByTestId('home-tile-carry-on-plex:2');
    await waitFor(() => expect(tile).toHaveTextContent("Kid's tablet"));
    fireEvent.click(within(tile).getByTestId('home-tile-carry-on-plex:2-picture'));
    const choice = await screen.findByTestId('spot-choice-1');
    expect(choice).toHaveTextContent('1 h 20 m on Living Room TV');
    fireEvent.click(choice);
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:2', expect.objectContaining({ id: 'plex:2' }), { startAt: 4800 });
  });

  it('leads into Browse when there is nothing to suggest', async () => {
    routes({ 'api/v1/media/suggestions?deviceId=browser%3Ame': { deviceId: 'browser:me', rows: [], empty: true } });
    renderHome();
    const empty = await screen.findByTestId('home-suggestions-empty');
    fireEvent.click(within(empty).getByRole('button', { name: 'Browse' }));
    expect(goToArea).toHaveBeenCalledWith('browse');
  });
});
