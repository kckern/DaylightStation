// ContentCombobox.actions.test.jsx — real hook + portal-menu interaction.
// The regression here is browser event order: pointerdown moves focus before
// click, so an action trigger must retain the typed combobox session until its
// explicit menu action runs.
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ContentCombobox } from './ContentCombobox.jsx';
import { DestinationLine } from '../../Media/cast/DestinationLine.jsx';
import { CastTargetProvider } from '../../Media/cast/CastTargetProvider.jsx';
import { DispatchContext } from '../../Media/cast/DispatchProvider.jsx';
import { FleetContext } from '../../Media/fleet/FleetProvider.jsx';
import { createFleetStore } from '../../Media/fleet/fleetStore.js';

vi.mock('../../../lib/logging/singleton.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

vi.mock('../../Media/logging/mediaLog.js', () => ({
  default: new Proxy({}, { get: () => vi.fn() }),
}));

const leaf = { id: 'plex:leaf-1', title: 'Bluey', source: 'plex', type: 'episode' };
const collection = { id: 'plex:collection-1', title: 'Bluey collection', source: 'plex', type: 'collection', isContainer: true };

const fleetDevices = [
  {
    id: 'playroom-tablet',
    type: 'android-tablet',
    name: 'Playroom Tablet',
    location: 'Playroom',
    icon: '📱',
    fleet: true,
    content_control: { provider: 'fully-kiosk' },
  },
  {
    id: 'livingroom-tv',
    type: 'shield-tv',
    name: 'Living Room TV',
    location: 'Living Room',
    icon: '📺',
    fleet: true,
    content_control: { provider: 'fully-kiosk' },
  },
];

function DestinationSearchHarness({ comboboxProps }) {
  const [destinationInteractionActive, setDestinationInteractionActive] = useState(false);
  return (
    <>
      <ContentCombobox
        {...comboboxProps}
        destinationInteractionActive={destinationInteractionActive}
      />
      <DestinationLine
        surface="content-combobox-integration"
        onInteractionStart={() => setDestinationInteractionActive(true)}
        onInteractionEnd={() => setDestinationInteractionActive(false)}
      />
      <output data-testid="destination-interaction-state">
        {destinationInteractionActive ? 'active' : 'inactive'}
      </output>
    </>
  );
}

function jsonResponse(items) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
}

/**
 * Cancelled pointerdown suppresses compatibility mousedown/mouseup (but not
 * click). Focus moves only for an uncancelled mousedown. Calling
 * .focus() exercises the real TextInput blur handler and real hook close path.
 */
function pointerActivate(element) {
  const focusTarget = element.closest?.('button,input,select,textarea,a[href],[tabindex]');
  let pointerDown;
  act(() => {
    pointerDown = createEvent.pointerDown(element, { pointerType: 'mouse', isPrimary: true });
    fireEvent(element, pointerDown);
  });
  let down;
  act(() => {
    if (!pointerDown.defaultPrevented) {
      down = createEvent.mouseDown(element);
      fireEvent(element, down);
      if (!down.defaultPrevented && focusTarget) focusTarget.focus();
    }
  });
  act(() => {
    fireEvent.pointerUp(element, { pointerType: 'mouse', isPrimary: true });
    if (!pointerDown.defaultPrevented && !down?.defaultPrevented) fireEvent.mouseUp(element);
    fireEvent.click(element, { detail: 1 });
  });
}

// This repository does not install @testing-library/user-event. Mirror the
// browser's native <button> activation explicitly: the keyboard events are
// observed by Mantine, then the user agent dispatches the click for Enter or
// Space. Keeping that synthesized click here (rather than calling click in the
// test body) makes the keyboard path visible and prevents a focus-plus-click
// test from quietly standing in for it.
function keyboardActivate(element, key = 'Enter') {
  act(() => {
    fireEvent.keyDown(element, { key });
    fireEvent.keyUp(element, { key });
    fireEvent.click(element);
  });
}

async function renderSearchedCombobox(props = {}) {
  const onChange = vi.fn();
  const onMore = vi.fn();
  const onPlayAll = vi.fn();
  render(
    <MantineProvider>
      <FleetContext.Provider value={{
        devices: fleetDevices,
        store: createFleetStore(),
        loading: false,
        error: null,
        refresh: vi.fn(),
      }}>
        <DispatchContext.Provider value={{ dispatchToTarget: vi.fn() }}>
          <CastTargetProvider>
            <DestinationSearchHarness comboboxProps={{
              value: '',
              onChange,
              onMore,
              onPlayAll,
              selectContainers: true,
              ...props,
            }} />
            <button type="button" data-testid="outside-focus">Outside</button>
            <div data-testid="outside-surface" />
          </CastTargetProvider>
        </DispatchContext.Provider>
      </FleetContext.Provider>
    </MantineProvider>
  );
  const input = screen.getByRole('textbox');
  act(() => input.focus());
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
    await waitFor(() => expect(input).toHaveValue('bluey'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains query/results through nested device and submit actions across two destination picker cycles but closes on ordinary outside pointer', async () => {
    const { input } = await renderSearchedCombobox();

    for (const location of ['Playroom', 'Living Room']) {
      pointerActivate(screen.getByTestId('destination-line'));
      const nestedDeviceChild = await screen.findByText(location);
      expect(input).toHaveValue('bluey');
      expect(nestedDeviceChild).toHaveClass('cast-tile-location');
      pointerActivate(nestedDeviceChild);
      await waitFor(() => expect(input).toHaveValue('bluey'));
      await waitFor(() => expect(screen.getByTestId('result-more-plex:leaf-1')).toBeInTheDocument());

      pointerActivate(screen.getByTestId('picker-submit'));
      await waitFor(() => expect(screen.queryByTestId('destination-sheet')).toBeNull());
      expect(input).toHaveValue('bluey');
      expect(screen.getByTestId('result-more-plex:leaf-1')).toBeInTheDocument();
    }

    pointerActivate(screen.getByTestId('outside-surface'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it.each(['pointer cancel', 'press-drag release without click'])(
    'ends an orphaned destination %s before the next genuine outside interaction and leaves no stale owner',
    async (interruption) => {
      const { input } = await renderSearchedCombobox();
      const trigger = screen.getByTestId('destination-line');
      const outside = screen.getByTestId('outside-surface');

      act(() => {
        fireEvent.pointerDown(trigger, { pointerId: 41, pointerType: 'mouse', isPrimary: true });
      });
      act(() => {
        fireEvent.mouseDown(trigger);
        trigger.focus();
      });
      expect(screen.getByTestId('destination-interaction-state')).toHaveTextContent('active');
      act(() => {
        if (interruption === 'pointer cancel') {
          fireEvent.pointerCancel(trigger, { pointerId: 41, pointerType: 'mouse', isPrimary: true });
        } else {
          fireEvent.pointerUp(outside, { pointerId: 41, pointerType: 'mouse', isPrimary: true });
          fireEvent.mouseUp(outside);
        }
      });
      expect(screen.queryByTestId('destination-sheet')).toBeNull();
      expect(screen.getByTestId('destination-interaction-state')).toHaveTextContent('inactive');
      expect(input).toHaveValue('bluey');

      let outsidePointerDown;
      act(() => {
        outsidePointerDown = createEvent.pointerDown(outside, {
          pointerId: 42, pointerType: 'mouse', isPrimary: true,
        });
        fireEvent(outside, outsidePointerDown);
      });
      expect(outsidePointerDown.defaultPrevented).toBe(false);
      act(() => {
        fireEvent.mouseDown(outside);
        fireEvent.pointerUp(outside, { pointerId: 42, pointerType: 'mouse', isPrimary: true });
        fireEvent.mouseUp(outside);
        fireEvent.click(outside, { detail: 1 });
      });
      await waitFor(() => expect(input).toHaveValue(''));

      act(() => input.focus());
      fireEvent.change(input, { target: { value: 'bluey' } });
      await screen.findByTestId('result-more-plex:leaf-1');
      keyboardActivate(trigger);
      expect(await screen.findByTestId('destination-sheet')).toBeInTheDocument();
      expect(screen.getByTestId('destination-interaction-state')).toHaveTextContent('active');
      expect(input).toHaveValue('bluey');
      fireEvent.keyDown(trigger, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('destination-sheet')).toBeNull());
      expect(screen.getByTestId('destination-interaction-state')).toHaveTextContent('inactive');
      expect(input).toHaveValue('bluey');

      pointerActivate(outside);
      await waitFor(() => expect(input).toHaveValue(''));
    }
  );

  it('treats keyboard focus on More actions as internal before the portaled menu opens', async () => {
    const { input, onChange } = await renderSearchedCombobox();

    const more = screen.getByTestId('result-more-plex:leaf-1');
    act(() => { more.focus(); });
    fireEvent.click(more); // native Enter/Space activation dispatches this click

    expect(await screen.findByTestId('result-action-add-plex:leaf-1')).toBeInTheDocument();
    expect(input).toHaveValue('bluey');
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([1, 2])('dismisses on the first nonfocus outside click after %i pointer Add actions', async (count) => {
    const { input, onChange, onMore } = await renderSearchedCombobox();
    for (let index = 0; index < count; index += 1) {
      pointerActivate(screen.getByTestId('result-more-plex:leaf-1'));
      pointerActivate(await screen.findByTestId('result-action-add-plex:leaf-1'));
      await waitFor(() => expect(screen.queryByTestId('result-action-add-plex:leaf-1')).toBeNull());
      expect(input).toHaveValue('bluey');
      expect(screen.getByRole('listbox')).toBeVisible();
    }
    expect(onMore).toHaveBeenCalledTimes(count);
    expect(onMore).toHaveBeenLastCalledWith('add', leaf);

    const outside = screen.getByTestId('outside-surface');
    pointerActivate(outside);
    expect(outside).not.toHaveFocus();
    await waitFor(() => expect(input).toHaveValue(''));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens More and selects Add through a keyboard-only menu path', async () => {
    const { input, onChange, onMore } = await renderSearchedCombobox();
    const more = screen.getByTestId('result-more-plex:leaf-1');

    act(() => { more.focus(); });
    keyboardActivate(more);
    const add = await screen.findByTestId('result-action-add-plex:leaf-1');

    // Mantine initially focuses its portal sentinel, then ArrowDown enters its
    // menu and traverses each real action. Do not force focus onto Add: that
    // would turn this back into the old focus-plus-click coverage gap.
    await waitFor(() => expect(document.activeElement).not.toBe(more));
    const playNow = screen.getByTestId('result-action-playNow-plex:leaf-1');
    const playNext = screen.getByTestId('result-action-playNext-plex:leaf-1');
    const upNext = screen.getByTestId('result-action-upNext-plex:leaf-1');
    for (const expected of [playNow, playNext, upNext, add]) {
      fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
      await waitFor(() => expect(expected).toHaveFocus());
    }
    keyboardActivate(add);

    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledWith('add', leaf);
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

  it('closes when a pointer leaves an open More menu for an actual outside target', async () => {
    const { input } = await renderSearchedCombobox();
    pointerActivate(screen.getByTestId('result-more-plex:leaf-1'));
    await screen.findByTestId('result-action-add-plex:leaf-1');

    pointerActivate(screen.getByTestId('outside-focus'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('closes without delayed reopen for a non-focus-moving outside pointer after opening More', async () => {
    const { input } = await renderSearchedCombobox();
    pointerActivate(screen.getByTestId('result-more-plex:leaf-1'));
    await screen.findByTestId('result-action-add-plex:leaf-1');

    pointerActivate(screen.getByTestId('outside-surface'));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it.each(['outside-focus', 'outside-surface'])('closes on %s after keyboard Add removes menu focus', async (outsideId) => {
    const { input } = await renderSearchedCombobox();
    const more = screen.getByTestId('result-more-plex:leaf-1');
    act(() => { more.focus(); });
    keyboardActivate(more);
    const add = await screen.findByTestId('result-action-add-plex:leaf-1');
    const playNow = screen.getByTestId('result-action-playNow-plex:leaf-1');
    const playNext = screen.getByTestId('result-action-playNext-plex:leaf-1');
    const upNext = screen.getByTestId('result-action-upNext-plex:leaf-1');
    for (const expected of [playNow, playNext, upNext, add]) {
      fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
      await waitFor(() => expect(expected).toHaveFocus());
    }
    keyboardActivate(add);
    await waitFor(() => expect(screen.queryByTestId('result-action-add-plex:leaf-1')).toBeNull());
    pointerActivate(screen.getByTestId(outsideId));
    await waitFor(() => expect(input).toHaveValue(''));
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
