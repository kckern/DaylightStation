// ContentCombobox.freeform.test.jsx — pins the allowFreeform gate (RC4): the
// freeform "Use … as raw value" row is a deliberate power-user id-entry path
// for admin content-list editors, but in dispatch-to-play contexts (Media
// search) it was the only actionable row after an empty search, so raw title
// text got dispatched to the play pipeline -> 404. allowFreeform defaults to
// true (existing admin behavior unchanged) and MediaContentSearch opts out.
//
// Mirrors ContentCombobox.test.jsx's mocking pattern: the hook is mocked to a
// SEARCH-mode, no-results state. Mode !== DISPLAY drives the component's own
// `isEditing` effect to call combobox.openDropdown() on mount, so the options
// (or empty-state) render without needing a synthetic focus/click sequence
// (jsdom + Mantine's Combobox don't reliably surface options via those events).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { initialState, Modes } from './comboboxMachine.js';

vi.mock('../../../lib/logging/singleton.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

vi.mock('./useContentCombobox.js', () => ({
  useContentCombobox: () => ({
    state: {
      ...initialState(''),
      mode: Modes.SEARCH,
      search: 'think',
      results: [],
    },
    dispatch: vi.fn(),
    handleInput: vi.fn(),
    activeScope: null,
    clearScope: vi.fn(),
    openWithSiblings: vi.fn(),
    drill: vi.fn(),
    goUp: vi.fn(),
    goToCrumb: vi.fn(),
    paginate: vi.fn(),
    handleClose: vi.fn(),
    select: vi.fn(),
    commit: vi.fn(),
    resolvedTitle: null,
    isSearching: false,
    pendingSources: [],
    sourceErrors: [],
    truncatedAt: null,
  }),
}));

import { ContentCombobox } from './ContentCombobox.jsx';

function renderCombobox(props = {}) {
  return render(
    <MantineProvider>
      <ContentCombobox value="" onChange={vi.fn()} {...props} />
    </MantineProvider>
  );
}

describe('ContentCombobox freeform gating (RC4)', () => {
  it('renders the raw-value row by default (admin behavior unchanged)', () => {
    renderCombobox({});
    expect(screen.queryByTestId('freeform-commit-option')).toBeTruthy();
  });

  it('hides the raw-value row when allowFreeform={false}', () => {
    renderCombobox({ allowFreeform: false });
    expect(screen.queryByTestId('freeform-commit-option')).toBeNull();
  });

  it('empty-state copy mentions "Use as raw value" by default', () => {
    renderCombobox({});
    expect(screen.getByText(/Use as raw value/i)).toBeInTheDocument();
  });

  it('empty-state copy does not mention "Use as raw value" when allowFreeform={false}', () => {
    renderCombobox({ allowFreeform: false });
    expect(screen.queryByText(/Use as raw value/i)).toBeNull();
  });
});
