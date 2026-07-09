// ContentCombobox.test.jsx — smoke test pinning the component↔hook wiring
// contract (not visuals). The hook module is fully mocked; the machine's
// initialState/Modes are the real ones so the state shape can't drift.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { initialState, Modes } from './comboboxMachine.js';

vi.mock('../../../../lib/logging/singleton.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

let currentHook;
vi.mock('./useContentCombobox.js', () => ({
  useContentCombobox: () => currentHook,
}));

import { ContentCombobox } from './ContentCombobox.jsx';

function makeHook({ state = {}, ...api } = {}) {
  return {
    state: { ...initialState(''), ...state },
    dispatch: vi.fn(),
    handleInput: vi.fn(),
    openWithSiblings: vi.fn(),
    drill: vi.fn(),
    goUp: vi.fn(),
    paginate: vi.fn(),
    handleClose: vi.fn(),
    select: vi.fn(),
    resolvedTitle: null,
    isSearching: false,
    pendingSources: [],
    sourceErrors: [],
    ...api,
  };
}

function renderCombobox(props = {}) {
  return render(
    <MantineProvider>
      <ContentCombobox value="" onChange={vi.fn()} {...props} />
    </MantineProvider>
  );
}

describe('ContentCombobox (hook wiring)', () => {
  beforeEach(() => {
    currentHook = makeHook();
  });

  it('DISPLAY mode shows the committed value in the input and the resolved-title line', () => {
    currentHook = makeHook({
      state: { ...initialState('plex:123'), value: 'plex:123' },
      resolvedTitle: 'The Great Escape',
    });
    renderCombobox({ value: 'plex:123' });

    expect(screen.getByRole('textbox')).toHaveValue('plex:123');
    expect(screen.getByTestId('combobox-resolved-title')).toHaveTextContent('The Great Escape');
  });

  it('renderValue replaces the TextInput in DISPLAY mode and onStartEdit opens via the hook', () => {
    currentHook = makeHook({
      state: { ...initialState('plex:123'), value: 'plex:123' },
      resolvedTitle: 'The Great Escape',
    });
    renderCombobox({
      value: 'plex:123',
      renderValue: ({ onStartEdit, value, resolvedTitle }) => (
        <button type="button" data-testid="rich-display" onClick={onStartEdit}>
          {value} — {resolvedTitle}
        </button>
      ),
    });

    expect(screen.queryByRole('textbox')).toBeNull();
    const card = screen.getByTestId('rich-display');
    expect(card).toHaveTextContent('plex:123 — The Great Escape');

    fireEvent.click(card);
    expect(currentHook.openWithSiblings).toHaveBeenCalledTimes(1);
  });

  it('typing routes through handleInput', () => {
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: '' },
    });
    renderCombobox();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hym' } });
    expect(currentHook.handleInput).toHaveBeenCalledWith('hym');
  });

  it('ArrowDown dispatches ARROW with the current item count', () => {
    currentHook = makeHook({
      state: {
        ...initialState(''),
        mode: Modes.SEARCH,
        search: 'hy',
        results: [
          { id: 'hymn:1', title: 'Hymn 1', source: 'hymn' },
          { id: 'hymn:2', title: 'Hymn 2', source: 'hymn' },
        ],
      },
    });
    renderCombobox();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });
    expect(currentHook.dispatch).toHaveBeenCalledWith({ type: 'ARROW', dir: 1, itemCount: 2 });
  });

  it('Enter never selects an auto-highlighted row (Mar-01 gate): dismisses instead', () => {
    currentHook = makeHook({
      state: {
        ...initialState('plex:123'),
        value: 'plex:123',
        mode: Modes.SEARCH,
        search: 'plex:123', // unchanged text — nothing to commit
        results: [
          { id: 'plex:1', title: 'Result 1', source: 'plex' },
          { id: 'plex:2', title: 'Result 2', source: 'plex' },
        ],
        highlight: { idx: 0, userNavigated: false }, // auto-highlight, NOT user navigation
      },
    });
    renderCombobox({ value: 'plex:123' });

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(currentHook.select).not.toHaveBeenCalled();
    expect(currentHook.drill).not.toHaveBeenCalled();
    expect(currentHook.handleClose).toHaveBeenCalledWith('dismiss');
  });

  it('Escape closes via handleClose with reason escape', () => {
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: 'abc' },
    });
    renderCombobox();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(currentHook.handleClose).toHaveBeenCalledWith('escape');
  });
});
