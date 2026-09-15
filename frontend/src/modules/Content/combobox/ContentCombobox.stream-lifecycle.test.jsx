// Real ContentCombobox + shared SSE hook contract for bounded search failures.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ContentCombobox } from './ContentCombobox.jsx';

vi.mock('../../../lib/logging/singleton.js', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(), child: () => logger };
  return { getChildLogger: () => logger, getDaylightLogger: () => logger, default: () => logger };
});

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    MockEventSource.instances.push(this);
  }

  close() { this.readyState = 2; }
  simulateMessage(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  simulateError() { this.onerror?.(new Error('connection failed')); }
}
MockEventSource.instances = [];

function renderCombobox() {
  render(
    <MantineProvider>
      <ContentCombobox value="" onChange={vi.fn()} searchParams="capability=listable&scope=kids" />
    </MantineProvider>
  );
  const input = screen.getByRole('textbox');
  input.focus();
  return input;
}

function renderScopedCombobox(props = {}) {
  const view = render(
    <MantineProvider>
      <ContentCombobox
        value=""
        onChange={vi.fn()}
        searchParams="capability=listable&scope=kids"
        {...props}
      />
    </MantineProvider>
  );
  const input = screen.getByRole('textbox');
  input.focus();
  return { ...view, input };
}

async function typeSearch(input, text) {
  fireEvent.change(input, { target: { value: text } });
  await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
}

describe('ContentCombobox streaming-search lifecycle', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ sources: [], categories: [], providers: [] }) })));
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('keeps partial results visible and retries only the failed source with the active scope', async () => {
    // Break caught: whole-query status retry either drops successful results or
    // loses the caller's active scope instead of narrowing to the failed source.
    const input = renderCombobox();
    await typeSearch(input, 'arrival');
    const primary = MockEventSource.instances[0];

    act(() => {
      primary.simulateMessage({ event: 'pending', sources: ['plex', 'abs'] });
      primary.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:arrival', title: 'Arrival', source: 'plex', type: 'movie' }], pending: ['abs'] });
      primary.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
      primary.simulateMessage({ event: 'complete' });
    });

    expect(screen.getByText('Arrival')).toBeInTheDocument();
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stream-status-retry-abs'));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    expect(MockEventSource.instances[1].url).toContain('text=arrival');
    expect(MockEventSource.instances[1].url).toContain('capability=listable');
    expect(MockEventSource.instances[1].url).toContain('scope=kids');
    expect(MockEventSource.instances[1].url).toContain('source=abs');
    expect(screen.getByText('Arrival')).toBeInTheDocument();
  });

  it('shows a retryable service failure rather than an empty result state after transport failure', async () => {
    // Break caught: connection failure falls through to "No results", which
    // falsely says a completed search found nothing.
    const input = renderCombobox();
    await typeSearch(input, 'arrival');
    act(() => { MockEventSource.instances[0].simulateError(); });

    expect(screen.getByTestId('stream-global-error')).toHaveTextContent('Lost connection to the search service.');
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument();
    const retry = screen.getByTestId('stream-global-retry');
    expect(retry).toHaveAccessibleName('Retry');
    expect(retry).toHaveClass('stream-status-retry-btn');
    fireEvent.click(retry);
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    expect(MockEventSource.instances[1].url).toContain('capability=listable');
    expect(MockEventSource.instances[1].url).toContain('scope=kids');
  });

  it('suppresses every empty-success variant after the real bounded timeout', () => {
    // Break caught: the global timeout row is additive while the no-results
    // copy (and admin raw-value fallback) still claims the search completed.
    vi.useFakeTimers();
    const input = renderCombobox();
    act(() => {
      fireEvent.change(input, { target: { value: 'arrival' } });
      vi.advanceTimersByTime(350);
      vi.advanceTimersByTime(30000);
    });

    expect(screen.getByTestId('stream-global-error')).toHaveTextContent('Search service did not complete in time. Please retry.');
    expect(screen.queryByText(/No results/)).toBeNull();
    expect(screen.queryByTestId('freeform-commit-option')).toBeNull();
  });

  it('keeps a truthful searching state during text and scope debounce, after revoking old stream ownership', async () => {
    // RED: canceling a prior stream made the consumer show "No results" for
    // the 300ms before the replacement request actually opened.
    const { input, rerender } = renderScopedCombobox();
    fireEvent.change(input, { target: { value: 'arrival' } });
    expect(screen.getByTestId('combobox-loading')).toHaveTextContent('Searching...');
    expect(screen.queryByText(/No results/)).toBeNull();

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const oldStream = MockEventSource.instances[0];
    act(() => oldStream.simulateMessage({
      event: 'results', source: 'plex', pending: [],
      items: [{ id: 'plex:arrival', title: 'Arrival', source: 'plex', type: 'movie' }],
    }));
    expect(await screen.findByText('Arrival')).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <ContentCombobox value="" onChange={vi.fn()} searchParams="capability=listable&scope=family" />
      </MantineProvider>
    );
    await waitFor(() => expect(oldStream.readyState).toBe(2));
    expect(screen.getByTestId('combobox-loading')).toHaveTextContent('Searching...');
    expect(screen.queryByText('Arrival')).toBeNull();
    expect(screen.queryByText(/No results/)).toBeNull();
  });

  it('does not claim a failed widened search found nothing anywhere', async () => {
    // RED: fellBackToAll survived a widened transport failure and rendered
    // the terminal "nothing anywhere" copy beside the retryable error.
    const { input } = renderScopedCombobox({ fallbackSearchParams: '' });
    await typeSearch(input, 'arrival');
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'results', source: 'plex', items: [], pending: [] });
      MockEventSource.instances[0].simulateMessage({ event: 'complete' });
    });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    act(() => MockEventSource.instances[1].simulateError());

    expect(screen.getByTestId('stream-global-error')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-fallback-notice')).toBeNull();
    expect(screen.queryByText(/nothing found anywhere else either/i)).toBeNull();
    expect(screen.queryByText(/No results/)).toBeNull();
  });

  it('keeps a twice-failed widened source retry incomplete instead of claiming no results', async () => {
    // RED: the clean scoped empty widens, then the automatic named retry also
    // fails. The retained source error means neither empty-success copy nor
    // the raw-value escape hatch may claim a completed search.
    const { input } = renderScopedCombobox({ fallbackSearchParams: '' });
    await typeSearch(input, 'arrival');
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'results', source: 'plex', items: [], pending: [] });
      MockEventSource.instances[0].simulateMessage({ event: 'complete' });
    });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    act(() => {
      MockEventSource.instances[1].simulateMessage({ event: 'source_error', source: 'plex', error: 'offline', pending: [] });
      MockEventSource.instances[1].simulateMessage({ event: 'complete' });
    });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(3));
    expect(MockEventSource.instances[2].url).toContain('source=plex');
    act(() => {
      MockEventSource.instances[2].simulateMessage({ event: 'source_error', source: 'plex', error: 'offline', pending: [] });
      MockEventSource.instances[2].simulateMessage({ event: 'complete' });
    });

    expect(await screen.findByTestId('stream-status-retry-plex')).toBeInTheDocument();
    expect(screen.queryByTestId('combobox-fallback-notice')).toBeNull();
    expect(screen.queryByText(/nothing found anywhere else either/i)).toBeNull();
    expect(screen.queryByText(/No results/)).toBeNull();
    expect(screen.queryByTestId('freeform-commit-option')).toBeNull();
  });
});
