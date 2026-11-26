// Real desktop consumer regression: the More menu is portaled, so a pointer
// Add must retain MediaContentSearch's transient query after the menu finishes
// dismissing. The former component-stub suite could not observe that boundary.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const dispatchContent = vi.fn();
const dispatchLeafVerb = vi.fn();
const resetScope = vi.fn();
vi.mock("./useContentDispatch.js", () => ({
  useContentDispatch: () => ({ dispatch: dispatchContent, dispatchLeafVerb, playContainerAsQueue: vi.fn() }),
}));
vi.mock("../logging/mediaLog.js", () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));
// Mutable so a test can walk the nav stack (home → detail → Back).
let navState;
const resetNav = () => { navState = { view: 'home', params: {}, depth: 1, push: vi.fn() }; };
resetNav();
vi.mock("../shell/NavProvider.jsx", () => ({ useNav: () => navState }));
vi.mock("./useSearchContext.js", () => ({
  useSearchContext: () => ({
    scopes: [{ key: 'all', label: 'All', params: '' }],
    currentScopeKey: 'all', currentScope: { key: 'all', label: 'All', params: '' }, scopeError: null, resetScope,
  }),
}));
vi.mock("./ScopeChips.jsx", () => ({ ScopeChips: () => <div data-testid="scope-chips" /> }));
vi.mock("../cast/DestinationLine.jsx", () => ({
  DestinationLine: () => <div data-testid="destination-line" />,
}));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const getLogger = () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) });
  return { default: getLogger, getLogger };
});
vi.mock("../../../../../frontend/src/lib/logging/singleton.js", () => ({
  getChildLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
}));

import { MediaContentSearch } from "./MediaContentSearch.jsx";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { createLocalSessionController } from "../session/LocalSessionController.js";
import { DismissStackProvider } from "@/lib/ui/dismiss/DismissStackProvider.jsx";

const leaf = { id: 'plex:697368', title: 'Disclosure Day', source: 'plex', type: 'movie' };

function jsonResponse(items) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
}

function pointerActivate(element) {
  act(() => {
    const pointerDown = createEvent.pointerDown(element);
    fireEvent(element, pointerDown);
    const down = createEvent.mouseDown(element);
    fireEvent(element, down);
    // happy-dom allows .focus() on plain divs; browsers do not. Preserve the
    // no-focus-move outside case instead of inventing a second blur event.
    if (!pointerDown.defaultPrevented && !down.defaultPrevented
      && element.matches('button,input,select,textarea,a[href],[tabindex]')) element.focus();
    fireEvent.mouseUp(element);
    fireEvent.click(element, { detail: 1 });
  });
}

async function nextFrame() {
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
}

function renderSearch({ onBaseDismiss = vi.fn() } = {}) {
  const controller = createLocalSessionController({ clientId: 'combobox-action-test' });
  const play = vi.fn();
  controller.setPlayerHandle({ play, pause: vi.fn(), seek: vi.fn() });
  controller.queue.add({ contentId: 'plex:existing', title: 'Paused movie', format: 'video' });
  controller.transport.play();
  controller.onPlayerStateChange('paused', 'plex:existing');
  play.mockClear();
  dispatchLeafVerb.mockImplementation((verb, contentId, item) => {
    const input = { contentId, title: item?.title ?? null, thumbnail: item?.thumbnail ?? null };
    if (verb === 'playNow') controller.queue.playNow(input);
    else if (verb === 'add') controller.queue.add(input);
    return 'local';
  });
  const tree = () => (
    <MantineProvider>
      <DismissStackProvider onBaseDismiss={onBaseDismiss}>
        <LocalSessionContext.Provider value={{ controller }}>
          <MediaContentSearch />
          <div data-testid="outside-surface" />
          <button data-testid="outside-focus">Outside</button>
        </LocalSessionContext.Provider>
      </DismissStackProvider>
    </MantineProvider>
  );
  const { rerender } = render(tree());
  // Move the (mocked) nav stack and let the search see it.
  const navigate = (next) => { navState = { ...navState, ...next }; rerender(tree()); };
  return { controller, play, onBaseDismiss, navigate };
}

describe('MediaContentSearch action-menu retention', () => {
  beforeEach(() => {
    dispatchContent.mockReset();
    dispatchContent.mockReturnValue('detail');
    dispatchLeafVerb.mockReset();
    resetNav();
    localStorage.clear();
    resetScope.mockReset();
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([leaf])));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('picking a playable row opens it (the list closes like any navigation) and plays nothing', async () => {
    const { controller } = renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Disclosure Day' } });

    pointerActivate(await screen.findByTestId('combobox-option-plex:697368'));

    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:existing');
    expect(dispatchContent).toHaveBeenCalledWith('plex:697368', expect.objectContaining({ title: 'Disclosure Day' }), { from: 'search', via: 'tap' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('keeps the query after pointer More → Add finishes portal dismissal', async () => {
    const { controller, play } = renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Disclosure Day' } });

    pointerActivate(await screen.findByTestId('result-more-plex:697368'));
    pointerActivate(await screen.findByTestId('result-action-add-plex:697368'));

    expect(controller.getSnapshot().queue.items.map(item => item.contentId)).toEqual(['plex:existing', 'plex:697368']);
    expect(controller.getSnapshot().state).toBe('paused');
    expect(play).not.toHaveBeenCalled();
    expect(dispatchContent).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveValue('Disclosure Day'));
  });

  it('[RELY.10a] Escape after pointer Add dismisses search before the Now Playing back action', async () => {
    const { controller, play, onBaseDismiss } = renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Disclosure Day' } });

    pointerActivate(await screen.findByTestId('result-more-plex:697368'));
    pointerActivate(await screen.findByTestId('result-action-add-plex:697368'));
    await waitFor(() => expect(screen.queryByTestId('result-action-add-plex:697368')).toBeNull());
    expect(screen.getByRole('listbox')).toBeVisible();

    // The real browser's pointer menu close leaves focus outside the combobox.
    // Fire at document.body to reproduce Playwright page.keyboard.press(), not
    // the input-only Escape path ContentCombobox already covers.
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onBaseDismiss).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      state: 'paused',
      currentItem: { contentId: 'plex:existing' },
      queue: { items: [{ contentId: 'plex:existing' }, { contentId: 'plex:697368' }] },
    });
    expect(play).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(onBaseDismiss).toHaveBeenCalledTimes(1));
  });

  it('[RELY.10a] retains the desktop draft and its scope across Escape, without the base dismissal', async () => {
    const { onBaseDismiss } = renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Frozen' } });
    await screen.findByTestId('combobox-option-plex:697368');

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(input).toHaveValue('Frozen');
    // The kept query keeps its scope: no reset on close.
    expect(resetScope).not.toHaveBeenCalled();
    expect(onBaseDismiss).not.toHaveBeenCalled();
    fireEvent.focus(input);
    expect(input).toHaveValue('Frozen');
    await expect(screen.getByRole('listbox')).toBeVisible();
  });

  it('a kept query reopens with the results it found, and ✕ clears it', async () => {
    renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Disclosure Day' } });
    await screen.findByTestId('combobox-option-plex:697368');
    pointerActivate(screen.getByTestId('outside-surface'));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.focus(input);
    expect(input).toHaveValue('Disclosure Day');
    expect(await screen.findByTestId('combobox-option-plex:697368')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-clear-search'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it.each([
    { outsideId: 'outside-surface', addCount: 1 },
    { outsideId: 'outside-focus', addCount: 1 },
    { outsideId: 'outside-surface', addCount: 2 },
    { outsideId: 'outside-focus', addCount: 2 },
  ])('closes on the first $outsideId pointer after $addCount pointer Add actions, keeping the query for next time', async ({ outsideId, addCount }) => {
    const { controller, play } = renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Disclosure Day' } });

    for (let count = 1; count <= addCount; count += 1) {
      pointerActivate(await screen.findByTestId('result-more-plex:697368'));
      const add = await screen.findByTestId('result-action-add-plex:697368');
      await waitFor(() => expect(document.activeElement.closest('[data-menu-dropdown]')).not.toBeNull());
      pointerActivate(add);
      await waitFor(() => expect(screen.queryByTestId('result-action-add-plex:697368')).toBeNull());
      await nextFrame();
      expect(input).toHaveValue('Disclosure Day');
      expect(screen.getByRole('listbox')).toBeVisible();
      expect(controller.getSnapshot().queue.items).toHaveLength(1 + count);
    }
    const focusBeforeOutside = document.activeElement;
    pointerActivate(screen.getByTestId(outsideId));
    if (outsideId === 'outside-surface') expect(document.activeElement).toBe(focusBeforeOutside);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await nextFrame();
    await nextFrame();
    // Closed, but the words stay: going back to the same search is the common case.
    expect(input).toHaveValue('Disclosure Day');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(controller.getSnapshot().queue.items.map(item => item.contentId)).toEqual(
      addCount === 1 ? ['plex:existing', 'plex:697368'] : ['plex:existing', 'plex:697368', 'plex:697368']
    );
    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:existing');
    expect(controller.getSnapshot().state).toBe('paused');
    expect(play).not.toHaveBeenCalled();
    expect(dispatchContent).not.toHaveBeenCalled();
  });
});

describe('MediaContentSearch: select opens the info view, Back returns to the same results', () => {
  const other = { id: 'plex:111', title: 'Disclosure', source: 'plex', type: 'movie' };
  beforeEach(() => {
    dispatchContent.mockReset();
    dispatchContent.mockReturnValue('detail');
    dispatchLeafVerb.mockReset();
    resetNav();
    localStorage.clear();
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([other, leaf])));
  });
  afterEach(() => vi.unstubAllGlobals());

  const highlighted = () => screen.getAllByRole('option').filter(o => o.getAttribute('data-highlighted') === 'true')
    .map(o => o.getAttribute('data-testid'));

  async function openSecondRowWithEnter() {
    const helpers = renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Disclosure' } });
    await screen.findByTestId('combobox-option-plex:697368');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    return { ...helpers, input };
  }

  it('Enter on the highlighted row opens it from search, plays nothing', async () => {
    const { controller, play } = await openSecondRowWithEnter();
    expect(dispatchContent).toHaveBeenCalledTimes(1);
    expect(dispatchContent).toHaveBeenCalledWith('plex:697368', expect.objectContaining({ title: 'Disclosure Day' }), { from: 'search', via: 'enter' });
    expect(dispatchLeafVerb).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:existing');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('Back from that info view puts focus in the box with the list open, same words, same row highlighted', async () => {
    const { input, navigate } = await openSecondRowWithEnter();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    // The info view takes focus (its PLAY), then Back pops it.
    navigate({ view: 'detail', params: { contentId: 'plex:697368', focusPlay: true, from: 'search' }, depth: 2 });
    act(() => screen.getByTestId('outside-focus').focus());
    navigate({ view: 'home', params: {}, depth: 1 });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(await screen.findByRole('listbox')).toBeVisible();
    expect(input).toHaveValue('Disclosure');
    // The pick now ranks first for these words; the highlight follows the id.
    await waitFor(() => expect(highlighted()).toEqual(['combobox-option-plex:697368']));
  });

  it('a detail not opened from search does not pull focus back to the box', async () => {
    const { input, navigate } = renderSearch();
    navigate({ view: 'detail', params: { contentId: 'plex:697368' }, depth: 2 });
    act(() => screen.getByTestId('outside-focus').focus());
    navigate({ view: 'home', params: {}, depth: 1 });
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByTestId('outside-focus'));
    expect(screen.queryByRole('listbox')).toBeNull();
    void input;
  });
});
