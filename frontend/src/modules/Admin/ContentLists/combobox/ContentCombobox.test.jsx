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

  it('ID-lookup tagged results show the ID badge; untagged results do not (audit B2)', () => {
    currentHook = makeHook({
      state: {
        ...initialState(''),
        mode: Modes.SEARCH,
        search: '1989',
        results: [
          { id: 'plex:1989', title: 'Some Movie', source: 'plex', matchReason: 'id-lookup' },
          { id: 'plex:2', title: 'Text Match', source: 'plex' },
        ],
      },
    });
    renderCombobox();

    const badges = screen.getAllByTestId('match-reason-id');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('ID');
    expect(badges[0]).toHaveAttribute('title', 'Matched by content ID, not text');
    // The tagged badge sits in the id-lookup row, not the text-match row.
    expect(badges[0].closest('[data-value]')).toHaveAttribute('data-value', 'plex:1989');
  });

  it('marks the committed row with data-current and a salient Current badge (F1b)', () => {
    currentHook = makeHook({
      state: {
        ...initialState('plex:123'),
        value: 'plex:123',
        mode: Modes.SEARCH,
        search: 'plex',
        results: [
          { id: 'plex:123', title: 'Committed Item', source: 'plex' },
          { id: 'plex:2', title: 'Other Item', source: 'plex' },
        ],
      },
    });
    renderCombobox({ value: 'plex:123' });

    const row = screen.getByTestId('combobox-option-plex:123');
    expect(row).toHaveAttribute('data-current', 'true');

    const badge = screen.getByTestId('combobox-current-badge');
    expect(badge).toHaveTextContent('Current');
    expect(row).toContainElement(badge);

    // The non-committed row must NOT carry the Current marker.
    const otherRow = screen.getByTestId('combobox-option-plex:2');
    expect(otherRow).toHaveAttribute('data-current', 'false');
  });

  it('BROWSE mode shows the orientation anchor when the committed value is not in the window (F1)', () => {
    currentHook = makeHook({
      state: {
        ...initialState('singalong:hymn/1008'),
        value: 'singalong:hymn/1008',
        mode: Modes.BROWSE,
        browse: {
          items: [
            { id: 'singalong:hymn/1', title: 'The Morning Breaks', source: 'singalong' },
            { id: 'singalong:hymn/2', title: 'The Spirit of God', source: 'singalong' },
          ],
          breadcrumbs: [],
          pagination: null,
          loading: false,
        },
      },
      resolvedTitle: 'Nearer, My God, to Thee',
    });
    renderCombobox({ value: 'singalong:hymn/1008' });

    const anchor = screen.getByTestId('combobox-current-anchor');
    expect(anchor).toHaveTextContent('Nearer, My God, to Thee');
    expect(anchor).toHaveTextContent('not in this list');
  });

  it('BROWSE mode hides the orientation anchor when the committed value IS in the window (F1)', () => {
    currentHook = makeHook({
      state: {
        ...initialState('singalong:hymn/2'),
        value: 'singalong:hymn/2',
        mode: Modes.BROWSE,
        browse: {
          items: [
            { id: 'singalong:hymn/1', title: 'The Morning Breaks', source: 'singalong' },
            { id: 'singalong:hymn/2', title: 'The Spirit of God', source: 'singalong' },
          ],
          breadcrumbs: [],
          pagination: null,
          loading: false,
        },
      },
      resolvedTitle: 'The Spirit of God',
    });
    renderCombobox({ value: 'singalong:hymn/2' });

    expect(screen.queryByTestId('combobox-current-anchor')).toBeNull();
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
