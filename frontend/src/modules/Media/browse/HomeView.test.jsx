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

import { HomeView, tileMeta } from './HomeView.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
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
    'api/v1/media/household/carry-on?limit=12': { nowPlayingKnown: true,
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

let fleetEntries = {};
const fleetStore = {
  getEntry: (id) => fleetEntries[id] ?? null,
  getAll: () => fleetEntries,
  subscribeAll: () => () => {},
};

function renderHome() {
  return render(
    <MantineProvider>
      <FleetContext.Provider value={{ store: fleetStore, devices: [] }}><HomeView /></FleetContext.Provider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fleetEntries = { 'livingroom-tv': { snapshot: { currentItem: { contentId: 'plex:9' }, meta: { playbackOwner: { ownerInstanceId: 'o', playbackRevision: 1 } } } } };
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
    // ONE meta line: "time left · where".
    await waitFor(() => expect(within(arrival).getByTestId('home-tile-carry-on-plex:1-line-0')).toHaveTextContent('34 min left · Living Room TV'));
    expect(arrival.querySelectorAll('.home-tile-line')).toHaveLength(1);
    // Screens that stopped in different places: one short line per spot (FIND.10a/AC4).
    const two = screen.getByTestId('home-tile-carry-on-plex:2');
    await waitFor(() => expect(two.querySelectorAll('.home-tile-line')).toHaveLength(2));
  });

  it('draws no Play bar on a tile and an amber-free progress bar only for unfinished items', async () => {
    renderHome();
    const arrival = await screen.findByTestId('home-tile-carry-on-plex:1');
    expect(within(arrival).queryByRole('button', { name: /^Play$/ })).toBeNull();
    expect(arrival.querySelector('[data-testid$="-play"]')).toBeNull();
    expect(arrival.querySelector('.home-tile-progress')).not.toBeNull();
    const fresh = await screen.findByTestId('home-tile-new-plex:400');
    expect(fresh.querySelector('.home-tile-progress')).toBeNull();
    expect(fresh).toHaveTextContent('Recently added');
  });

  it('shapes the art by kind: stills 16:9, posters 2:3, music 1:1', async () => {
    renderHome();
    expect((await screen.findByTestId('home-tile-carry-on-plex:1'))).toHaveClass('home-tile--poster'); // movie
    expect(screen.getByTestId('home-tile-time-of-day-plex:300')).toHaveClass('home-tile--square'); // album
    expect(screen.getByTestId('home-tile-now-on-livingroom-tv-plex:9')).toHaveClass('home-tile--wide');
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
    // The next part is one entry of the tile's ⋯ menu, not a bar under it.
    fireEvent.click(within(fav).getByTestId('home-tile-favourites-plex:100-more'));
    fireEvent.click(await screen.findByTestId('home-tile-favourites-plex:100-verb-continue'));
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:105', expect.objectContaining({ id: 'plex:105' }));
  });

  it('a playable carry-on picture continues from its spot', async () => {
    renderHome();
    const tile = await screen.findByTestId('home-tile-carry-on-plex:1');
    fireEvent.click(within(tile).getByTestId('home-tile-carry-on-plex:1-picture'));
    // The named spot itself, not the server's last-write playhead (review B2).
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:1', expect.objectContaining({ id: 'plex:1' }), { startAt: 1800 });
  });

  it('asks which spot when screens hold different spots', async () => {
    renderHome();
    const tile = await screen.findByTestId('home-tile-carry-on-plex:2');
    await waitFor(() => expect(tile.querySelectorAll('.home-tile-line')).toHaveLength(2));
    fireEvent.click(within(tile).getByTestId('home-tile-carry-on-plex:2-picture'));
    const choice = await screen.findByTestId('spot-choice-1');
    expect(choice).toHaveTextContent('1 h 20 m on Living Room TV');
    fireEvent.click(choice);
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:2', expect.objectContaining({ id: 'plex:2' }), { startAt: 4800 });
  });

  it('a screen whose playback cannot be steered from here shows "Now on" without Remote or Move here', async () => {
    fleetEntries = {};
    renderHome();
    const card = await screen.findByTestId('home-tile-now-on-livingroom-tv-plex:9');
    await waitFor(() => expect(card).toHaveTextContent('Now on Living Room TV'));
    expect(within(card).queryByRole('button', { name: /Move here/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: /^Remote/ })).toBeNull();
    expect(within(card).getByRole('button', { name: /More actions for Playing Thing/ })).toBeInTheDocument();
  });

  it('a browser screen (no playback owner) offers Remote but not Move here, keyed by its browser id', async () => {
    routes({ 'api/v1/media/household/carry-on?limit=12': { nowPlayingKnown: true, items: [], nowOn: [{ contentId: 'plex:9', title: 'Playing Thing', deviceId: 'browser:abc', state: 'playing' }] } });
    fleetEntries = { 'browser:abc': { snapshot: { currentItem: { contentId: 'plex:9' }, meta: { ownerId: 'o', revision: 1 } } } };
    renderHome();
    const card = await screen.findByTestId('home-tile-now-on-browser:abc-plex:9');
    expect(within(card).queryByRole('button', { name: /Move here/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /Remote/ }));
    expect(push).toHaveBeenCalledWith('peek', { deviceId: 'browser:abc' });
  });

  it('reloads once, about 10 s later, when the server says its answer was degraded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      routes({ 'api/v1/media/household/recent?limit=24': { degraded: true, items: [] } });
      renderHome();
      await screen.findByTestId('home-row-favourites');
      const count = () => apiMock.mock.calls.filter(c => c[0] === 'api/v1/media/household/recent?limit=24').length;
      expect(count()).toBe(1);
      await vi.advanceTimersByTimeAsync(10_500);
      await waitFor(() => expect(count()).toBe(2));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(count()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leads into Browse when there is nothing to suggest', async () => {
    routes({ 'api/v1/media/suggestions?deviceId=browser%3Ame': { deviceId: 'browser:me', rows: [], empty: true } });
    renderHome();
    const empty = await screen.findByTestId('home-suggestions-empty');
    fireEvent.click(within(empty).getByRole('button', { name: 'Browse' }));
    expect(goToArea).toHaveBeenCalledWith('browse');
  });

  const SUGGESTIONS = 'api/v1/media/suggestions?deviceId=browser%3Ame';

  it('shows a date-named item as "<source> · <date>", never the bare date', async () => {
    routes({ [SUGGESTIONS]: { deviceId: 'browser:me', generatedAt: 'g2', empty: false, rows: [
      { id: 'carry-on', title: 'Carry on', items: [
        { id: 'plex:77', kind: 'item', type: 'video', title: '20261005', parentTitle: 'Aljazeera', reason: 'unfinished', percent: 30, playhead: 100, duration: 600 },
      ] },
    ] } });
    renderHome();
    const tile = await screen.findByTestId('home-tile-carry-on-plex:77');
    expect(tile).toHaveTextContent(/Aljazeera · Oct 5/);
    expect(tile).not.toHaveTextContent('20261005');
  });

  it('Carry on never merges same-named episodes of two shows: each keeps its own resume tile', async () => {
    routes({ [SUGGESTIONS]: { deviceId: 'browser:me', generatedAt: 'g4', empty: false, rows: [
      { id: 'carry-on', title: 'Carry on', items: [
        { id: 'plex:71', kind: 'item', type: 'episode', title: 'Pilot', grandparentTitle: 'Show A', reason: 'unfinished', percent: 30, playhead: 100, duration: 1600 },
        { id: 'plex:72', kind: 'item', type: 'episode', title: 'Pilot', grandparentTitle: 'Show B', reason: 'unfinished', percent: 40, playhead: 200, duration: 1600 },
      ] },
    ] } });
    renderHome();
    const a = await screen.findByTestId('home-tile-carry-on-plex:71');
    const b = screen.getByTestId('home-tile-carry-on-plex:72');
    expect(a).not.toHaveTextContent('editions');
    expect(b).not.toHaveTextContent('editions');
  });

  it('a collapsed group keeps the leader\'s meta and appends the edition count', () => {
    expect(tileMeta('new', { latest: { title: 'Ch 2' } }, null, () => null, { editionCount: 4 })).toBe('New: Ch 2 · 4 editions');
    expect(tileMeta('new', {}, null, () => null, { editionCount: 3 })).toBe('Recently added · 3 editions');
  });

  it('collapses editions of one title in a row into one tile that offers them from its menu', async () => {
    const book = (n) => ({ id: `plex:50${n}`, kind: 'collection', type: 'album', title: 'Persuasion', latest: null });
    routes({ [SUGGESTIONS]: { deviceId: 'browser:me', generatedAt: 'g3', empty: false, rows: [
      { id: 'new', title: 'New', items: [book(1), book(2), book(3), book(4), { id: 'plex:600', kind: 'collection', type: 'album', title: 'Emma' }] },
    ] } });
    renderHome();
    const tile = await screen.findByTestId('home-tile-new-plex:501');
    expect(document.querySelectorAll('[data-testid^="home-tile-new-plex:"][data-testid$="plex:502"]')).toHaveLength(0);
    expect(screen.queryByTestId('home-tile-new-plex:502')).toBeNull();
    expect(screen.getByTestId('home-tile-new-plex:600')).toBeInTheDocument();
    expect(tile).toHaveTextContent('4 editions');
    fireEvent.click(within(tile).getByTestId('home-tile-new-plex:501-more'));
    fireEvent.click(await screen.findByTestId('home-tile-new-plex:501-edition-2'));
    expect(dispatch).toHaveBeenCalledWith('plex:503', expect.objectContaining({ id: 'plex:503' }));
  });

  it('never shows a machine browser name: an unnamed browser is "a browser"', async () => {
    routes({ 'api/v1/media/screens': { screens: [{ id: 'browser:kid', name: 'Browser 4778f429', aliases: [] }] },
      'api/v1/media/household/recent?limit=24': { items: [
        { contentId: 'plex:50', title: 'Last Night Film', type: 'movie', lastPlayed: '2026-10-02 21:30:00', finished: true,
          playedOn: { deviceId: 'browser:kid' }, plays: [], spots: [] },
      ] } });
    renderHome();
    const tile = await screen.findByTestId('home-tile-recent-plex:50');
    await waitFor(() => expect(tile).toHaveTextContent('a browser'));
    expect(document.body.textContent).not.toMatch(/Browser [0-9a-f]{8}/);
  });
});
