// Real desktop consumer regression: the More menu is portaled, so a pointer
// Add must retain MediaContentSearch's transient query after the menu finishes
// dismissing. The former component-stub suite could not observe that boundary.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const dispatchContent = vi.fn();
vi.mock('./useContentDispatch.js', () => ({
  useContentDispatch: () => ({ dispatch: dispatchContent, playContainerAsQueue: vi.fn() }),
}));
vi.mock('../logging/mediaLog.js', () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push: vi.fn() }) }));
vi.mock('./useSearchContext.js', () => ({
  useSearchContext: () => ({
    scopes: [{ key: 'all', label: 'All', params: '' }],
    currentScopeKey: 'all', currentScope: { key: 'all', label: 'All', params: '' }, scopeError: null,
  }),
}));
vi.mock('./ScopeChips.jsx', () => ({ ScopeChips: () => <div data-testid="scope-chips" /> }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));
vi.mock('../../../lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
}));

import { MediaContentSearch } from './MediaContentSearch.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';

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

function renderSearch() {
  const controller = createLocalSessionController({ clientId: 'combobox-action-test' });
  const play = vi.fn();
  controller.setPlayerHandle({ play, pause: vi.fn(), seek: vi.fn() });
  controller.queue.add({ contentId: 'plex:existing', title: 'Paused movie', format: 'video' });
  controller.transport.play();
  controller.onPlayerStateChange('paused', 'plex:existing');
  play.mockClear();
  render(
    <MantineProvider>
      <LocalSessionContext.Provider value={{ controller }}>
        <MediaContentSearch />
        <div data-testid="outside-surface" />
        <button data-testid="outside-focus">Outside</button>
      </LocalSessionContext.Provider>
    </MantineProvider>
  );
  return { controller, play };
}

describe('MediaContentSearch action-menu retention', () => {
  beforeEach(() => {
    dispatchContent.mockReset();
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([leaf])));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps the query after pointer More → Add finishes portal dismissal', async () => {
    const { controller, play } = renderSearch();
    const input = screen.getByRole('textbox', { name: 'Search media…' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'Disclosure Day' } });

    pointerActivate(await screen.findByTestId('result-more-plex:697368'));
    pointerActivate(await screen.findByTestId('result-action-add-plex:697368'));

    expect(controller.getSnapshot().queue.items.map(item => item.contentId)).toEqual(['plex:existing', 'plex:697368']);
    expect(controller.getSnapshot().state).toBe('paused');
    expect(play).not.toHaveBeenCalled();
    expect(dispatchContent).not.toHaveBeenCalled();
    await waitFor(() => expect(input).toHaveValue('Disclosure Day'));
  });

  it.each([
    { outsideId: 'outside-surface', addCount: 1 },
    { outsideId: 'outside-focus', addCount: 1 },
    { outsideId: 'outside-surface', addCount: 2 },
    { outsideId: 'outside-focus', addCount: 2 },
  ])('closes on the first $outsideId pointer after $addCount pointer Add actions without reopening', async ({ outsideId, addCount }) => {
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
    await waitFor(() => expect(input).toHaveValue(''));
    await nextFrame();
    await nextFrame();
    expect(input).toHaveValue('');
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
