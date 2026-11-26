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
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (target, key) => { if (!(key in target)) target[key] = vi.fn(); return target[key]; } });
  return { default: stub, mediaLog: stub };
});
import mediaLog from "../logging/mediaLog.js";
vi.mock("../actions/ItemDestinationPicker.jsx", () => ({
  ItemDestinationPicker: ({ action }) => (action ? <div data-testid="picker-open" data-kind={action.kind} /> : null),
}));

// Owner ruling 2026-11-26: everything past row 1 sits behind More ⋯.
const openMore = () => { fireEvent.click(screen.getByTestId('detail-more')); return screen.getByTestId('detail-more-menu'); };
const pickMore = (testId) => { openMore(); fireEvent.click(screen.getByTestId(testId)); };

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
    openMore();
    expect(screen.getByTestId('detail-play-next')).toHaveTextContent(/^Play Next$/);
    expect(screen.getByTestId('detail-up-next')).toHaveTextContent(/^Play First$/);
    expect(screen.getByTestId('detail-add')).toHaveTextContent(/^Add to Queue$/);
  });
  it('plays on the screen this browser learned for films, and still offers Play here', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    const fleet = { devices: [{ id: 'office-tv', name: 'Office Screen', type: 'linux-pc', content_control: { type: 'websocket' } }], identity: { deviceId: 'browser:me' } };
    render(<MantineProvider><FleetContext.Provider value={fleet}><DetailView contentId="plex:685088" /></FleetContext.Provider></MantineProvider>);
    expect(screen.getByTestId('detail-play-now')).toHaveTextContent('Play on Office Screen');
    fireEvent.click(screen.getByTestId('detail-play-here'));
    expect(dispatchLeafVerb).toHaveBeenLastCalledWith('playNow', 'plex:685088', expect.objectContaining({ id: 'plex:685088' }), { targetIds: [] });
  });
  it('offers explicit Shuffle for a collection, under More', () => {
    contentState.info = { title: 'Album', type: 'album' };
    render(<MantineProvider><DetailView contentId="plex:album" /></MantineProvider>);
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Shuffle' }));
    expect(dispatchLeafVerb).toHaveBeenLastCalledWith('shuffle', 'plex:album', expect.objectContaining({ type: 'album' }));
  });
  it('routes Next, First and Add through the displayed destination', () => {
    render(<MantineProvider><DetailView contentId="plex:685088" /></MantineProvider>);
    for (const [testId, verb] of [['detail-play-next', 'playNext'], ['detail-up-next', 'playFirst'], ['detail-add', 'add']]) {
      pickMore(testId);
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
    pickMore('detail-favourite');
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/favourites', expect.objectContaining({ id: 'plex:685088', kind: 'item' }), 'POST');
    pickMore('detail-watched');
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/watched', { contentId: 'plex:685088', watched: true }, 'POST');
  });
  it('a collection offers favourites but no watched marks', () => {
    contentState.info = { title: 'Album', type: 'album' };
    render(<MantineProvider><DetailView contentId="plex:album" /></MantineProvider>);
    openMore();
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
    expect(screen.getByTestId('detail-more')).not.toBeDisabled();
  });

  it('another item starting does not make this PLAY spin', async () => {
    const outcomes = new Map([['a1', { attemptId: 'a1', targetId: 'office-tv', distance: 'far', kind: 'play', phase: 'running', status: 'running', item: { contentId: 'plex:9' } }]]);
    mount(outcomes);
    expect(screen.getByTestId('detail-play-now')).not.toHaveAttribute('data-busy');
    await waitFor(() => expect(screen.getByTestId('detail-play-now')).not.toBeDisabled());
  });
});

// Owner ruling 2026-11-26: row 1 is three buttons; More ⋯ holds the rest.
describe('DetailView: row 1 and More ⋯', () => {
  const officeFleet = { devices: [{ id: 'office-tv', name: 'Office Screen', type: 'linux-pc', content_control: { type: 'websocket' } }], identity: { deviceId: 'browser:me' } };
  const onOffice = (ui) => { habitsStore().recordScreen('video', ['office-tv']); habitsStore().recordScreen('audio', ['office-tv']); return <MantineProvider><FleetContext.Provider value={officeFleet}>{ui}</FleetContext.Provider></MantineProvider>; };
  const rowOne = () => [...screen.getByTestId('detail-row-one').querySelectorAll('button')].map((b) => b.textContent.trim());
  const menuGroups = () => {
    const groups = [[]];
    for (const el of screen.getByTestId('detail-more-menu').querySelectorAll('[role="menuitem"], .mantine-Menu-divider')) {
      if (el.getAttribute('role') === 'menuitem') groups[groups.length - 1].push(el.textContent.trim());
      else groups.push([]);
    }
    return groups;
  };

  it('a film aimed at a screen: PLAY, Play here, Play on… and More — no queue caption', () => {
    contentState.info = { title: 'Arrival', type: 'movie' };
    render(onOffice(<DetailView contentId="plex:55854" />));
    expect(rowOne()).toEqual(['Play on Office Screen', 'Play here', 'Play on…', 'More']);
    expect(screen.queryByTestId('detail-queue-where')).toBeNull();
    for (const id of ['detail-play-next', 'detail-up-next', 'detail-add', 'detail-show-briefly', 'detail-favourite', 'detail-watched']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('a film: More holds the queue named for its screen, Show briefly, Quality, household', async () => {
    contentState.info = { title: 'Arrival', type: 'movie' };
    const { PlaybackQualityProvider } = await import('../quality/PlaybackQualityProvider.jsx');
    render(onOffice(<PlaybackQualityProvider><DetailView contentId="plex:55854" /></PlaybackQualityProvider>));
    openMore();
    expect(menuGroups()).toEqual([
      ['Play Next on Office Screen', 'Play First on Office Screen', 'Add to Queue on Office Screen', 'Add on…'],
      ['Show briefly on…'],
      ['Quality…'],
      ['Add to favourites', 'Mark watched', 'Mark unwatched'],
    ]);
    expect(mediaLog.detailMoreOpened).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:55854' }));
    fireEvent.click(screen.getByTestId('detail-add'));
    expect(dispatchLeafVerb).toHaveBeenLastCalledWith('add', 'plex:55854', expect.objectContaining({ title: 'Arrival' }));
    expect(mediaLog.detailMorePicked).toHaveBeenCalledWith({ contentId: 'plex:55854', verb: 'add' });
  });

  it('a track: no Quality; the queue still names its screen', () => {
    contentState.info = { title: 'Song', type: 'track' };
    render(onOffice(<DetailView contentId="plex:777" />));
    expect(rowOne()).toEqual(['Play on Office Screen', 'Play here', 'Play on…', 'More']);
    openMore();
    expect(menuGroups()).toEqual([
      ['Play Next on Office Screen', 'Play First on Office Screen', 'Add to Queue on Office Screen', 'Add on…'],
      ['Show briefly on…'],
      ['Add to favourites', 'Mark watched', 'Mark unwatched'],
    ]);
  });

  it('a show: Shuffle leads the queue, no watched marks', () => {
    contentState.info = { title: 'Bluey', type: 'show', childCount: 3 };
    render(<MantineProvider><DetailView contentId="plex:9" /></MantineProvider>);
    // Played here: no second Play here.
    expect(rowOne()).toEqual(['Play here', 'Play on…', 'More']);
    openMore();
    expect(menuGroups()).toEqual([
      ['Shuffle', 'Play Next', 'Play First', 'Add to Queue', 'Add on…'],
      ['Show briefly on…'],
      ['Add to favourites'],
    ]);
  });

  it('Show briefly on… closes More and opens the screen picker', () => {
    render(onOffice(<DetailView contentId="plex:685088" />));
    pickMore('detail-show-briefly');
    expect(screen.queryByTestId('detail-more-menu')).toBeNull();
    expect(screen.getByTestId('picker-open')).toHaveAttribute('data-kind', 'showBrieflyOn');
    pickMore('detail-add-on');
    expect(screen.getByTestId('picker-open')).toHaveAttribute('data-kind', 'addOn');
    expect(mediaLog.detailMorePicked).toHaveBeenCalledWith({ contentId: 'plex:685088', verb: 'showBrieflyOn' });
  });

  it('keyboard: Enter from search lands on PLAY, More is a Tab stop, Esc closes its menu and stays on the page', async () => {
    contentState.info = { title: 'Arrival', type: 'movie' };
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    try {
      render(onOffice(<DetailView contentId="plex:55854" focusPlay />));
      const play = screen.getByTestId('detail-play-now');
      await waitFor(() => expect(document.activeElement).toBe(play));
      const more = screen.getByTestId('detail-more');
      expect(more.tagName).toBe('BUTTON');
      expect(more).not.toHaveAttribute('tabindex', '-1');
      // Tab order: PLAY → Play here → Play on… → More.
      const tabbable = [...screen.getByTestId('detail-row-one').querySelectorAll('button')].filter((b) => b.tabIndex >= 0);
      expect(tabbable.map((b) => b.dataset.testid)).toEqual(['detail-play-now', 'detail-play-here', 'detail-play-on', 'detail-more']);
      more.focus();
      fireEvent.click(more);
      const menu = screen.getByTestId('detail-more-menu');
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
      fireEvent.keyDown(document.activeElement, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('detail-more-menu')).toBeNull());
      expect(document.activeElement).toBe(more);
      expect(pop).not.toHaveBeenCalled();
      expect(seen.mock.calls.some(([e]) => e.key === 'Escape')).toBe(false);
      expect(screen.getByTestId('detail-view')).toBeInTheDocument();
    } finally {
      document.removeEventListener('keydown', seen);
    }
  });
});
