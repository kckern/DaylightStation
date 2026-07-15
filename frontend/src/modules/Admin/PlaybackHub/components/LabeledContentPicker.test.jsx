// LabeledContentPicker.test.jsx — pins the collapsed shape (2026-07-09 audit,
// C6): the picker IS the unified ContentCombobox, so the combobox's own
// resolved-title line (data-testid "combobox-resolved-title") is the ONLY
// title rendered — the wrapper's duplicate <Text> above the input is gone.
// The real hook + machine run here; fetch and EventSource are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { clearCache } from '../../../Content/lib/siblingsCache.js';

vi.mock('../../../../lib/logging/singleton.js', () => {
  const logger = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    sampled: () => {}, child: () => logger,
  };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

import { titleCache } from '../../../Content/combobox/useContentCombobox.js';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';
import ContentCombobox from '../../../Content/combobox/ContentCombobox.jsx';

const SIBLINGS_RESPONSE = {
  items: [
    { id: 'plex:9', title: 'Ep 9', source: 'plex', type: 'episode' },
    { id: 'plex:670208', title: 'Solo Piano', source: 'plex', type: 'album' },
  ],
  parent: { id: 'plex:100', title: 'Music', source: 'plex' },
  pagination: null,
  referenceIndex: 1,
};

let fetchMock;

function jsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

function renderPicker(props = {}) {
  return render(
    <MantineProvider>
      <LabeledContentPicker
        value={props.value ?? ''}
        onChange={props.onChange ?? vi.fn()}
        placeholder={props.placeholder}
      />
    </MantineProvider>
  );
}

describe('LabeledContentPicker (collapsed onto unified ContentCombobox)', () => {
  beforeEach(() => {
    titleCache.clear();
    clearCache();
    // No SSE in tests — the hook's search transport falls back to batch fetch.
    vi.stubGlobal('EventSource', undefined);
    fetchMock = vi.fn((url) => {
      if (String(url).startsWith('/api/v1/info/')) {
        return jsonResponse({ title: 'Solo Piano' });
      }
      if (String(url).startsWith('/api/v1/siblings/')) {
        return jsonResponse(SIBLINGS_RESPONSE);
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is the unified ContentCombobox (no wrapper layer left)', () => {
    expect(LabeledContentPicker).toBe(ContentCombobox);
  });

  it('renders exactly ONE title line — the combobox-owned resolved title', async () => {
    renderPicker({ value: 'plex:670208' });

    await waitFor(() => {
      expect(screen.getByTestId('combobox-resolved-title')).toHaveTextContent('Solo Piano');
    });

    // The /info fetch is the combobox's own resolution path.
    const infoCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/info/'));
    expect(infoCalls).toHaveLength(1);
    expect(infoCalls[0][0]).toBe('/api/v1/info/plex/670208');

    // Audit C6: no duplicate title line above the input.
    expect(screen.getAllByTestId('combobox-resolved-title')).toHaveLength(1);
    expect(screen.getAllByText('Solo Piano')).toHaveLength(1);
  });

  it('renders a cached title immediately without fetching /info', () => {
    titleCache.set('plex:670208', 'Cached Title');

    renderPicker({ value: 'plex:670208' });

    expect(screen.getByTestId('combobox-resolved-title')).toHaveTextContent('Cached Title');
    const infoCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/info/'));
    expect(infoCalls).toHaveLength(0);
  });

  it('renders no title line when there is no value', () => {
    renderPicker({ value: '' });

    expect(screen.queryByTestId('combobox-resolved-title')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes value and placeholder through to the combobox input', () => {
    renderPicker({ value: 'plex:670208', placeholder: 'Pick a queue...' });

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('plex:670208');
    expect(input).toHaveAttribute('placeholder', 'Pick a queue...');
  });

  it('forwards (id, item) through onChange when a dropdown row is selected', async () => {
    const onChange = vi.fn();
    renderPicker({ value: 'plex:670208', onChange });

    // Clicking the input opens siblings-browse for the committed value.
    fireEvent.click(screen.getByRole('textbox'));

    const option = await screen.findByText('Ep 9');
    fireEvent.click(option);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        'plex:9',
        expect.objectContaining({ id: 'plex:9', title: 'Ep 9' })
      );
    });
  });

  it('forwards the raw id (no item) on freeform Enter commit', () => {
    const onChange = vi.fn();
    renderPicker({ value: '', onChange });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'plex:12345' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('plex:12345');
  });
});
