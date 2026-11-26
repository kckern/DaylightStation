import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { resetApiResourceCache } from '../../../../../frontend/src/lib/hooks/useApiResource.js';

const dispatchLeafVerb = vi.fn();
const queuePlayNow = vi.fn();
const pop = vi.fn();
let backDestination = 'Browse';
let contentState;
const apiMock = vi.fn(() => Promise.resolve({ items: [] }));
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock("./useContentInfo.js", () => ({
  useContentInfo: () => contentState,
}));
vi.mock("../search/useContentDispatch.js", () => ({ useContentDispatch: () => ({ dispatchLeafVerb }) }));
vi.mock("../controller/useSessionController.js", () => ({
  useSessionController: () => ({ queue: { playNow: queuePlayNow, playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() } }),
}));
vi.mock("../cast/CastButton.jsx", () => ({ CastButton: () => null }));
vi.mock("../shell/NavProvider.jsx", () => ({ useNav: () => ({ pop, backDestination }) }));

import { DetailView } from "./DetailView.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { habitsStore } from "../habits/mediaHabits.js";
import { habitsStore as seedHabits } from "../habits/mediaHabits.js";
import { resetPreparedStarts } from "../cast/usePrepareStart.js";

// These tests describe a browser that has chosen to watch here: with nothing
// chosen, a film's ▶ asks where (Play on…) instead — see habits/playDestination.js.
beforeEach(() => { seedHabits().recordScreen('video', []); });

beforeEach(() => {
  vi.clearAllMocks();
  resetApiResourceCache();
  resetPreparedStarts();
  contentState = { info: { title: 'Episode 3', type: 'episode', thumbnail: 'episode.jpg' }, loading: false, error: null };
  backDestination = 'Browse';
  apiMock.mockReset();
  apiMock.mockImplementation(() => Promise.resolve({ items: [] }));
});

describe('DetailView facts (FIND.8a/AC2)', () => {
  it('states the kind and the length in words, and the summary as the description', () => {
    contentState.info = { title: 'Arrival', type: 'movie', duration: 6983, metadata: { type: 'movie', librarySectionTitle: 'Movies', summary: 'Linguist meets aliens.' } };
    render(<MantineProvider><DetailView contentId="plex:55854" /></MantineProvider>);
    expect(screen.getByTestId('detail-facts')).toHaveTextContent('Movie · 1 hr 56 min');
    expect(screen.getByText('Linguist meets aliens.')).toBeVisible();
  });
  it('knows how far anyone has got on a page opened straight to the item (lists not loaded yet)', async () => {
    contentState.info = { title: 'Arrival', type: 'movie', duration: 6000 };
    apiMock.mockImplementation((url) => Promise.resolve(String(url).includes('carry-on')
      ? { items: [{ contentId: 'plex:55854', playhead: 1560, duration: 6000, finished: false }] }
      : { items: [] }));
    render(<MantineProvider><DetailView contentId="plex:55854" /></MantineProvider>);
    await waitFor(() => expect(screen.getByTestId('detail-progress')).toHaveTextContent(/min left/));
  });
  it('says how many items a collection holds instead of a length', () => {
    contentState.info = { title: 'Show', type: 'show', childCount: 12 };
    render(<MantineProvider><DetailView contentId="plex:9" /></MantineProvider>);
    expect(screen.getByTestId('detail-facts')).toHaveTextContent('TV Show · 12 episodes');
  });
});

describe('DetailView Play Now', () => {
  it.each([
    ['recent fallback', [], 1440, '36 min left'],
    ['carry-on precedence', [{ contentId: 'plex:55854', playhead: 2460, duration: 3600 }], 2460, '19 min left'],
  ])('waits for the preferred resume source on a cold item link with %s', async (_case, carryOn, startAt, progress) => {
    contentState.info = { title: 'Arrival', type: 'movie', duration: 3600 };
    let finishCarryOn;
    const pending = new Promise(resolve => { finishCarryOn = resolve; });
    apiMock.mockImplementation(path => {
      if (path === 'api/v1/media/household/carry-on?limit=12') return pending;
      if (path === 'api/v1/media/household/recent?limit=24') {
        return Promise.resolve({ items: [{ contentId: 'plex:55854', playhead: 1440, duration: 3600 }] });
      }
      return Promise.resolve({ items: [] });
    });
    render(<MantineProvider><DetailView contentId="plex:55854" /></MantineProvider>);
    const play = screen.getByTestId('detail-play-now');
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/carry-on?limit=12', {}, 'GET', { signal: expect.any(AbortSignal) });
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/recent?limit=24', {}, 'GET', { signal: expect.any(AbortSignal) });
    expect(play).toBeDisabled();
    expect(screen.queryByTestId('detail-progress')).toBeNull();
    fireEvent.click(play);
    expect(dispatchLeafVerb).not.toHaveBeenCalled();

    await act(async () => { finishCarryOn({ items: carryOn }); });
    expect(screen.getByTestId('detail-progress')).toHaveTextContent(progress);
    expect(play).toBeEnabled();
    fireEvent.click(play);
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:55854', expect.any(Object), { startAt });
  });

  it('lets the playback resolver start the item when both household reads fail', async () => {
    apiMock.mockImplementation(path => path.includes('/household/')
      ? Promise.reject(new Error('History unavailable')) : Promise.resolve({ items: [] }));
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    const play = screen.getByTestId('detail-play-now');
    await waitFor(() => expect(play).toBeEnabled());
    fireEvent.click(play);
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:685088', expect.any(Object));
  });

  // A browser activates a focused button on Enter keydown unless that keydown
  // is default-prevented — so "plays" here means "the keydown was let through".
  const enterDown = (el, init = {}) => {
    const event = createEvent.keyDown(el, { key: 'Enter', ...init });
    fireEvent(el, event);
    return event.defaultPrevented;
  };

  it('opened from search (focusPlay) lands on PLAY; its activation plays', async () => {
    render(<MantineProvider><DetailView contentId="plex:685088" focusPlay /></MantineProvider>);
    const play = screen.getByTestId('detail-play-now');
    await waitFor(() => expect(document.activeElement).toBe(play));
    expect(play).toHaveTextContent('Play here');
    // The second Enter is the focused button's own activation (a click).
    fireEvent.click(document.activeElement);
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:685088', expect.any(Object));
  });

  it('a held Enter never plays: an auto-repeat Enter on PLAY is ignored, a first press is not', async () => {
    render(<MantineProvider><DetailView contentId="plex:685088" focusPlay /></MantineProvider>);
    const play = screen.getByTestId('detail-play-now');
    await waitFor(() => expect(document.activeElement).toBe(play));
    // The Enter that opened the page is still held: auto-repeat lands on PLAY.
    expect(enterDown(play, { repeat: true })).toBe(true);
    // The person released it in the search box (no keyup here): their first
    // deliberate Enter on PLAY is let through.
    expect(enterDown(play)).toBe(false);
    expect(dispatchLeafVerb).not.toHaveBeenCalled();
  });

  it('without focusPlay a first Enter on PLAY is let through', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    expect(enterDown(screen.getByTestId('detail-play-now'))).toBe(false);
  });

  it('without focusPlay the page does not take focus', async () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    const play = screen.getByTestId('detail-play-now');
    await waitFor(() => expect(play).toBeEnabled());
    expect(document.activeElement).not.toBe(play);
  });

  it('names where its one primary Play goes: here, when nothing is aimed or learned', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    expect(screen.getByTestId('detail-play-now')).toHaveTextContent('Play here');
    // Already here: no second "Play here".
    expect(screen.queryByTestId('detail-play-here')).toBeNull();
    expect(screen.getByTestId('detail-play-now')).toBeVisible();
    expect(screen.getByTestId('detail-play-next')).toBeVisible();
    expect(screen.getByTestId('detail-up-next')).toBeVisible();
    expect(screen.getByTestId('detail-add')).toBeVisible();
  });
  it('plays on the screen this browser learned for films, and still offers Play here', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    const fleet = { devices: [{ id: 'office-tv', name: 'Office Screen', type: 'linux-pc', content_control: { type: 'websocket' } }], identity: { deviceId: 'browser:me' } };
    render(<MantineProvider><FleetContext.Provider value={fleet}><DetailView contentId="plex:685088" /></FleetContext.Provider></MantineProvider>);
    expect(screen.getByTestId('detail-play-now')).toHaveTextContent('Play on Office Screen');
    fireEvent.click(screen.getByTestId('detail-play-here'));
    expect(dispatchLeafVerb).toHaveBeenLastCalledWith('playNow', 'plex:685088', expect.objectContaining({ id: 'plex:685088' }), { targetIds: [] });
  });
  it('offers explicit Shuffle beside collection Play', () => {
    contentState.info = { title: 'Album', type: 'album' };
    render(<MantineProvider><DetailView contentId="plex:album" /></MantineProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle', exact: true }));
    expect(dispatchLeafVerb).toHaveBeenLastCalledWith('shuffle', 'plex:album', expect.objectContaining({ type: 'album' }));
  });
  it('routes Next, First and Add through the displayed destination', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    for (const [testId, verb] of [['detail-play-next', 'playNext'], ['detail-up-next', 'playFirst'], ['detail-add', 'add']]) {
      fireEvent.click(screen.getByTestId(testId));
      expect(dispatchLeafVerb).toHaveBeenLastCalledWith(verb, 'plex:685088', expect.objectContaining({ title: 'Episode 3' }));
    }
  });
  it('shows a Back destination and uses the route pop seam', () => {
    backDestination = 'Home';
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);

    expect(screen.getByTestId('detail-back')).toHaveTextContent('Home');
    fireEvent.click(screen.getByTestId('detail-back'));
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['loading', { info: null, loading: true, error: null }],
    ['error', { info: null, loading: false, error: new Error('not found') }],
    ['empty', { info: null, loading: false, error: null }],
  ])('keeps Back available in the %s detail state', (_state, nextContentState) => {
    contentState = nextContentState;
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);

    expect(screen.getByTestId('detail-back')).toHaveTextContent('Browse');
    fireEvent.click(screen.getByTestId('detail-back'));
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it('routes the loaded detail item through the current destination dispatcher', async () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    const play = screen.getByTestId('detail-play-now');
    await waitFor(() => expect(play).toBeEnabled());
    fireEvent.click(play);

    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:685088', expect.objectContaining({
      id: 'plex:685088', title: 'Episode 3', thumbnail: 'episode.jpg',
    }));
    expect(queuePlayNow).not.toHaveBeenCalled();
  });
});

describe('DetailView household verbs (FIND.12a, FIND.10a/AC6)', () => {
  it('adds to favourites and marks watched in one step each', async () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    fireEvent.click(screen.getByTestId('detail-favourite'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/favourites', expect.objectContaining({ id: 'plex:685088', kind: 'item' }), 'POST');
    fireEvent.click(screen.getByTestId('detail-watched'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/watched', { contentId: 'plex:685088', watched: true }, 'POST');
  });
  it('a collection offers favourites but no watched marks', () => {
    contentState.info = { title: 'Album', type: 'album' };
    render(<MantineProvider><DetailView contentId="plex:album" /></MantineProvider>);
    expect(screen.getByTestId('detail-favourite')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-watched')).toBeNull();
  });
});

describe('DetailView prepares on look, touches no screen before PLAY (Task 4)', () => {
  const officeFleet = { devices: [{ id: 'office-tv', name: 'Office Screen', type: 'linux-pc', content_control: { type: 'websocket' } }], identity: { deviceId: 'browser:me' } };
  const renderOnOffice = () => render(
    <MantineProvider><FleetContext.Provider value={officeFleet}><DetailView contentId="plex:685088" focusPlay /></FleetContext.Provider></MantineProvider>,
  );
  const prepareCalls = () => apiMock.mock.calls.filter(([path]) => String(path).endsWith('/prepare'));
  const screenCalls = () => apiMock.mock.calls.filter(([path]) => /api\/v1\/device\/[^/]+\/(?!prepare$)/.test(String(path)));

  it('asks the server to prepare the stream once for the destination PLAY names', async () => {
    habitsStore().recordScreen('video', ['office-tv']);
    const view = renderOnOffice();
    expect(screen.getByTestId('detail-play-now')).toHaveTextContent('Play on Office Screen');
    // Debounced: nothing on the first frame of the look.
    expect(prepareCalls()).toHaveLength(0);
    await waitFor(() => expect(prepareCalls()).toHaveLength(1), { timeout: 1500 });
    expect(prepareCalls()[0]).toEqual(['api/v1/device/office-tv/prepare', { contentId: 'plex:685088' }, 'POST']);
    // Re-rendering (and re-opening) the same item for the same screen does not prepare again.
    view.unmount();
    renderOnOffice();
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    expect(prepareCalls()).toHaveLength(1);
  });

  it('never powers, wakes or loads a screen before PLAY', async () => {
    habitsStore().recordScreen('video', ['office-tv']);
    renderOnOffice();
    await waitFor(() => expect(prepareCalls()).toHaveLength(1), { timeout: 1500 });
    expect(screenCalls()).toEqual([]);
    expect(apiMock.mock.calls.some(([path]) => /\/(on|load|off|toggle|volume)(\?|$|\/)/.test(String(path)))).toBe(false);
    // Nothing recorded either: no history, progress or session write.
    expect(apiMock.mock.calls.some(([path]) => /play\/log|progress|session/.test(String(path)))).toBe(false);
  });

  it('a look whose PLAY plays here prepares nothing on any screen', async () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    expect(prepareCalls()).toEqual([]);
  });

  it('a look that leaves within the debounce prepares nothing', async () => {
    habitsStore().recordScreen('video', ['office-tv']);
    const view = renderOnOffice();
    view.unmount();
    await new Promise((resolve) => { setTimeout(resolve, 600); });
    expect(prepareCalls()).toEqual([]);
  });
});

// Addendum items 5 and 6 (2026-11-26).
import { PeekContext } from "../peek/PeekContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
describe('DetailView: already playing is shown; only PLAY spins (addendum 5, 6)', () => {
  const entries = {};
  const fleet = {
    devices: [{ id: 'office-tv', name: 'Office Screen', type: 'linux-pc', content_control: { type: 'websocket' } }],
    identity: { deviceId: 'browser:me' },
    store: { getEntry: (id) => entries[id] ?? null, subscribeAll: () => () => {}, subscribeDevice: () => () => {} },
  };
  const transport = { pause: vi.fn(async () => ({ ok: true })), play: vi.fn(async () => ({ ok: true })), restartCurrent: vi.fn(async () => ({ ok: true })) };
  const mount = (outcomes = new Map()) => render(
    <MantineProvider>
      <FleetContext.Provider value={fleet}>
        <PeekContext.Provider value={{ getController: () => ({ transport }) }}>
          <DispatchContext.Provider value={{ outcomes }}>
            <DetailView contentId="plex:266151" />
          </DispatchContext.Provider>
        </PeekContext.Provider>
      </FleetContext.Provider>
    </MantineProvider>,
  );
  beforeEach(() => { for (const k of Object.keys(entries)) delete entries[k]; contentState.info = { title: 'Hospital', type: 'movie' }; });

  it('an item on a screen reads "On <screen>" with Pause and Open, and PLAY is Start over there', async () => {
    entries['office-tv'] = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:266151', title: 'Hospital' } } };
    mount();
    expect(screen.getByTestId('detail-playing-on-text')).toHaveTextContent('On Office Screen · Playing');
    fireEvent.click(screen.getByTestId('detail-on-toggle'));
    expect(transport.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('detail-on-open')).toHaveTextContent('Open Office Screen');
    expect(screen.getByTestId('detail-play-now')).toHaveTextContent('Start over on Office Screen');
    await waitFor(() => expect(screen.getByTestId('detail-play-now')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('detail-play-now'));
    expect(transport.restartCurrent).toHaveBeenCalledTimes(1);
    expect(dispatchLeafVerb).not.toHaveBeenCalled();
  });

  it('a paused item offers Resume', () => {
    entries['office-tv'] = { snapshot: { state: 'paused', currentItem: { contentId: 'plex:266151' } } };
    mount();
    expect(screen.getByTestId('detail-on-toggle')).toHaveTextContent('Resume');
    fireEvent.click(screen.getByTestId('detail-on-toggle'));
    expect(transport.play).toHaveBeenCalledTimes(1);
  });

  it('PLAY spins while this item starts; the other verbs stay usable', () => {
    const outcomes = new Map([['a1', { attemptId: 'a1', targetId: 'office-tv', distance: 'far', kind: 'play', phase: 'running', status: 'running', item: { contentId: 'plex:266151' } }]]);
    mount(outcomes);
    expect(screen.getByTestId('detail-play-now')).toHaveAttribute('data-busy', 'true');
    expect(screen.getByTestId('detail-play-now')).toBeDisabled();
    expect(screen.getByTestId('detail-play-on')).not.toBeDisabled();
    expect(screen.getByTestId('detail-add')).not.toBeDisabled();
  });

  it('another item starting does not make this PLAY spin', async () => {
    const outcomes = new Map([['a1', { attemptId: 'a1', targetId: 'office-tv', distance: 'far', kind: 'play', phase: 'running', status: 'running', item: { contentId: 'plex:9' } }]]);
    mount(outcomes);
    expect(screen.getByTestId('detail-play-now')).not.toHaveAttribute('data-busy');
    await waitFor(() => expect(screen.getByTestId('detail-play-now')).not.toBeDisabled());
  });
});
