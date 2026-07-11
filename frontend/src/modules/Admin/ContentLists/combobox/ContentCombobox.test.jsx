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
let hookArgs; // captures the args the component threads into the hook (e.g. selectContainers)
vi.mock('./useContentCombobox.js', () => ({
  useContentCombobox: (args) => { hookArgs = args; return currentHook; },
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
    commit: vi.fn(),
    searchSettled: false,
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

  // Re-pointed for R3: the component no longer owns the pick/dismiss decision on
  // Enter. It unconditionally routes to commit('enter'); the Mar-01 gate (never
  // select an auto-highlighted row) now lives in decideCommit (covered by R1/R2).
  // What this test still pins at the COMPONENT layer: Enter does NOT itself call
  // select/drill/handleClose — it delegates entirely to commit.
  it('Enter routes through commit(\'enter\') and performs no component-side pick/dismiss (Mar-01 gate now in decideCommit)', () => {
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
    expect(currentHook.commit).toHaveBeenCalledWith('enter');
    // The component must not short-circuit any pick/dismiss itself.
    expect(currentHook.select).not.toHaveBeenCalled();
    expect(currentHook.drill).not.toHaveBeenCalled();
    expect(currentHook.handleClose).not.toHaveBeenCalled();
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

  it('F6: renders the results-truncated hint when the hook reports truncatedAt (transport-agnostic)', () => {
    const results = Array.from({ length: 50 }, (_, i) => ({ id: `plex:${i}`, title: `Item ${i}`, source: 'plex' }));
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: 'broad', results },
      isSearching: false,
      truncatedAt: 50,
    });
    renderCombobox();

    const hint = screen.getByTestId('results-truncated');
    expect(hint).toHaveTextContent('Showing first 50 — refine your search');
  });

  it('F14: renders a removable source-scope chip in search mode; clicking clear calls clearScope', () => {
    const clearScope = vi.fn();
    currentHook = makeHook({
      state: {
        ...initialState(''),
        mode: Modes.SEARCH,
        search: 'singalong:nearer',
        results: [{ id: 'singalong:hymn/100', title: 'Nearer', source: 'singalong' }],
      },
      activeScope: 'singalong',
      clearScope,
    });
    renderCombobox();

    const chip = screen.getByTestId('combobox-scope-chip');
    expect(chip).toHaveTextContent('Searching within singalong');

    fireEvent.click(screen.getByTestId('combobox-scope-clear'));
    expect(clearScope).toHaveBeenCalledTimes(1);
  });

  it('F14: no scope chip when activeScope is null', () => {
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: 'nearer' },
      activeScope: null,
    });
    renderCombobox();

    expect(screen.queryByTestId('combobox-scope-chip')).toBeNull();
  });

  it('F7: with selectContainers, a container row renders the interactive browse-into chevron; clicking it drills', () => {
    currentHook = makeHook({
      state: {
        ...initialState(''),
        mode: Modes.SEARCH,
        search: 'jazz',
        results: [
          { id: 'plex:playlist:99', title: 'Jazz Playlist', source: 'plex', type: 'playlist' },
          { id: 'plex:leaf:1', title: 'A Song', source: 'plex' },
        ],
      },
    });
    renderCombobox({ selectContainers: true });

    // The interactive drill affordance exists only for the container row.
    const chevron = screen.getByTestId('browse-into-plex:playlist:99');
    expect(screen.queryByTestId('browse-into-plex:leaf:1')).toBeNull();

    fireEvent.click(chevron);
    expect(currentHook.drill).toHaveBeenCalledTimes(1);
    expect(currentHook.drill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'plex:playlist:99' })
    );
    expect(currentHook.select).not.toHaveBeenCalled();
  });

  // Re-pointed for R3: the select-vs-drill-on-Enter decision for containers moved
  // out of the component into decideCommit (which reads selectContainers). At the
  // COMPONENT layer we now pin (a) that the prop is threaded INTO the hook, and
  // (b) that Enter routes through commit('enter'). The behavior flip itself is
  // covered by the R1/R2 decideCommit + hook tests.
  it('F7: with selectContainers, the prop is threaded into the hook and Enter routes through commit(\'enter\')', () => {
    currentHook = makeHook({
      state: {
        ...initialState(''),
        mode: Modes.SEARCH,
        search: 'jazz',
        results: [
          { id: 'plex:playlist:99', title: 'Jazz Playlist', source: 'plex', type: 'playlist' },
        ],
        highlight: { idx: 0, userNavigated: true },
      },
    });
    renderCombobox({ selectContainers: true });
    expect(hookArgs.selectContainers).toBe(true);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(currentHook.commit).toHaveBeenCalledWith('enter');
    // Component performs no direct pick — decideCommit owns select-vs-drill.
    expect(currentHook.select).not.toHaveBeenCalled();
    expect(currentHook.drill).not.toHaveBeenCalled();
  });

  it('F7: WITHOUT selectContainers, the hook receives selectContainers:false and Enter still routes through commit(\'enter\')', () => {
    currentHook = makeHook({
      state: {
        ...initialState(''),
        mode: Modes.SEARCH,
        search: 'jazz',
        results: [
          { id: 'plex:playlist:99', title: 'Jazz Playlist', source: 'plex', type: 'playlist' },
        ],
        highlight: { idx: 0, userNavigated: true },
      },
    });
    renderCombobox(); // no selectContainers → default false
    expect(hookArgs.selectContainers).toBe(false);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(currentHook.commit).toHaveBeenCalledWith('enter');
    expect(currentHook.drill).not.toHaveBeenCalled();
    expect(currentHook.select).not.toHaveBeenCalled();
  });

  it('Enter keeps the dropdown open when commit returns {action:\'open\'} (ambiguous — do not close)', () => {
    currentHook = makeHook({
      state: {
        ...initialState(''),
        mode: Modes.SEARCH,
        search: 'jazz',
        results: [
          { id: 'plex:1', title: 'Result 1', source: 'plex' },
          { id: 'plex:2', title: 'Result 2', source: 'plex' },
        ],
      },
      commit: vi.fn(() => ({ action: 'open' })),
    });
    renderCombobox();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(currentHook.commit).toHaveBeenCalledWith('enter');
    // The Enter handler never closes on its own — commit owns close semantics,
    // and 'open' closes nothing. The option rows must still be rendered.
    expect(currentHook.handleClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('combobox-option-plex:1')).toBeInTheDocument();
  });

  it('Escape routes through commit(\'escape\')', () => {
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: 'abc' },
    });
    renderCombobox();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(currentHook.commit).toHaveBeenCalledWith('escape');
  });

  it('Tab routes through commit(\'tab\')', () => {
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: 'abc' },
    });
    renderCombobox();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });
    expect(currentHook.commit).toHaveBeenCalledWith('tab');
  });

  it('Blur (outside close) routes through commit(\'outside\') — no junk-commit of typed text', () => {
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: 'unpicked typed query' },
    });
    renderCombobox();

    // onBlur closes the Mantine dropdown → onDropdownClose fires while the
    // machine is still editing (mode !== DISPLAY) → commit('outside') → revert.
    fireEvent.blur(screen.getByRole('textbox'));
    expect(currentHook.commit).toHaveBeenCalledWith('outside');
  });

  it('Freeform row commits the raw text via its own explicit path (onChange + handleClose), NOT via commit(\'enter\')', () => {
    const onChange = vi.fn();
    currentHook = makeHook({
      state: { ...initialState(''), mode: Modes.SEARCH, search: 'my raw text' },
    });
    renderCombobox({ onChange });

    fireEvent.click(screen.getByTestId('freeform-commit-option'));
    expect(onChange).toHaveBeenCalledWith('my raw text');
    expect(currentHook.handleClose).toHaveBeenCalledWith('select');
    // Explicit "save as raw" must NOT go through the resolving commit path
    // (no warn toast, no resolution).
    expect(currentHook.commit).not.toHaveBeenCalled();
  });
});
