// ContentCombobox.actions.test.jsx — real hook + portal-menu interaction.
// The regression here is browser event order: pointerdown moves focus before
// click, so an action trigger must retain the typed combobox session until its
// explicit menu action runs.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ContentCombobox } from './ContentCombobox.jsx';

vi.mock('../../../lib/logging/singleton.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

const leaf = { id: 'plex:leaf-1', title: 'Bluey', source: 'plex', type: 'episode' };
const collection = { id: 'plex:collection-1', title: 'Bluey collection', source: 'plex', type: 'collection', isContainer: true };

function jsonResponse(items) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
}

/**
 * Mirrors a browser pointer activation closely enough for jsdom: focus moves
 * only if the target's pointer-down default was not prevented. Calling
 * .focus() exercises the real TextInput blur handler and real hook close path.
 */
function pointerActivate(element) {
  act(() => {
    const down = createEvent.mouseDown(element);
    fireEvent(element, down);
    if (!down.defaultPrevented) element.focus();
    fireEvent.mouseUp(element);
    fireEvent.click(element);
  });
}

async function renderSearchedCombobox(props = {}) {
  const onChange = vi.fn();
  const onMore = vi.fn();
  const onPlayAll = vi.fn();
  render(
    <MantineProvider>
      <>
        <ContentCombobox
          value=""
          onChange={onChange}
          onMore={onMore}
          onPlayAll={onPlayAll}
          selectContainers
          {...props}
        />
        <button type="button" data-testid="outside-focus">Outside</button>
      </>
    </MantineProvider>
  );
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.change(input, { target: { value: 'bluey' } });
  expect(await screen.findByTestId('result-more-plex:leaf-1')).toBeInTheDocument();
  return { input, onChange, onMore, onPlayAll };
}

describe('ContentCombobox result actions — real focus ownership', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse([leaf, collection])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the typed query open through the portaled More actions menu and dispatches Add exactly once', async () => {
    const { input, onChange, onMore } = await renderSearchedCombobox();

    pointerActivate(screen.getByTestId('result-more-plex:leaf-1'));
    const add = await screen.findByTestId('result-action-add-plex:leaf-1');
    expect(input).toHaveValue('bluey');
    expect(onChange).not.toHaveBeenCalled();

    pointerActivate(add);
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledWith('add', leaf);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats keyboard focus on More actions as internal before the portaled menu opens', async () => {
    const { input, onChange } = await renderSearchedCombobox();

    const more = screen.getByTestId('result-more-plex:leaf-1');
    act(() => { more.focus(); });
    fireEvent.click(more); // native Enter/Space activation dispatches this click

    expect(await screen.findByTestId('result-action-add-plex:leaf-1')).toBeInTheDocument();
    expect(input).toHaveValue('bluey');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('returns focus after Escape but still closes on the next outside focus move', async () => {
    const { input, onChange } = await renderSearchedCombobox();
    const more = screen.getByTestId('result-more-plex:leaf-1');
    act(() => { more.focus(); });
    fireEvent.click(more);
    const add = await screen.findByTestId('result-action-add-plex:leaf-1');

    act(() => { add.focus(); });
    fireEvent.keyDown(add, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('result-action-add-plex:leaf-1')).toBeNull());
    expect(more).toHaveFocus();

    act(() => { screen.getByTestId('outside-focus').focus(); });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the ordinary Tab close policy outside the action-menu boundary', async () => {
    const { input, onChange } = await renderSearchedCombobox();

    fireEvent.keyDown(input, { key: 'Tab' });

    await waitFor(() => expect(input).toHaveValue(''));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dispatches collection inline play once without selecting or browsing the collection', async () => {
    const { onChange, onPlayAll } = await renderSearchedCombobox();

    pointerActivate(screen.getByTestId('result-play-all-plex:collection-1'));

    expect(onPlayAll).toHaveBeenCalledTimes(1);
    expect(onPlayAll).toHaveBeenCalledWith(collection);
    expect(onChange).not.toHaveBeenCalled();
  });
});
