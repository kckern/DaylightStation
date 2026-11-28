// frontend/src/modules/Content/combobox/StreamStatusLine.test.jsx
// Task 10 (spec D3): one-line, fixed-height replacement for the per-source
// badge cloud. Three states: pending (count line), settled+clean (null),
// settled+error (per-source name + Retry wired to onRetry(source)).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const renderM = (ui) => render(ui, { wrapper: ({ children }) => <MantineProvider>{children}</MantineProvider> });
import { StreamStatusLine, SourceFailureNote, failurePlacement } from "./StreamStatusLine.jsx";

describe('StreamStatusLine', () => {
  it('renders a "Searching N sources…" line while sources are still pending', () => {
    render(<StreamStatusLine pending={['plex', 'abs', 'freshvideo']} sourceErrors={[]} onRetry={vi.fn()} />);

    const line = screen.getByTestId('stream-status-line');
    expect(line).toHaveTextContent('Searching 3 sources…');
  });

  it('uses singular phrasing for exactly one pending source', () => {
    render(<StreamStatusLine pending={['plex']} sourceErrors={[]} onRetry={vi.fn()} />);

    expect(screen.getByTestId('stream-status-line')).toHaveTextContent('Searching 1 source…');
  });

  it('renders nothing once settled with no errors', () => {
    const { container } = render(<StreamStatusLine pending={[]} sourceErrors={[]} onRetry={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('stream-status-line')).not.toBeInTheDocument();
  });

  it('renders a friendly source name and a Retry button once settled with a source error', () => {
    const onRetry = vi.fn();
    render(<StreamStatusLine pending={[]} sourceErrors={[{ source: 'plex', error: 'timeout' }]} onRetry={onRetry} />);

    const line = screen.getByTestId('stream-status-line');
    // Raw adapter slugs must never leak to the UI — resolved through sourceLabels.
    expect(line).toHaveTextContent('Movies & TV');
    expect(line).not.toHaveTextContent('plex didn');

    const retryBtn = screen.getByTestId('stream-status-retry-plex');
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledWith('plex');
  });

  it('renders one segment per errored source, each wired to its own retry', () => {
    const onRetry = vi.fn();
    render(
      <StreamStatusLine
        pending={[]}
        sourceErrors={[{ source: 'plex', error: 'timeout' }, { source: 'abs', error: 'boom' }]}
        onRetry={onRetry}
      />
    );

    expect(screen.getByTestId('stream-status-retry-plex')).toBeInTheDocument();
    expect(screen.getByTestId('stream-status-retry-abs')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('stream-status-retry-abs'));
    expect(onRetry).toHaveBeenCalledWith('abs');
    expect(onRetry).not.toHaveBeenCalledWith('plex');
  });

  it('pending takes precedence over errors: still shows the count line if a search restarts with a lingering stale error prop', () => {
    render(<StreamStatusLine pending={['plex']} sourceErrors={[{ source: 'abs', error: 'boom' }]} onRetry={vi.fn()} />);

    expect(screen.getByTestId('stream-status-line')).toHaveTextContent('Searching 1 source…');
    expect(screen.queryByTestId('stream-status-retry-abs')).not.toBeInTheDocument();
  });

  it('omits the Retry button when no onRetry handler is provided', () => {
    render(<StreamStatusLine pending={[]} sourceErrors={[{ source: 'plex', error: 'timeout' }]} />);

    expect(screen.getByTestId('stream-status-line')).toBeInTheDocument();
    expect(screen.queryByTestId('stream-status-retry-plex')).not.toBeInTheDocument();
  });

  it('reports failed sources before widening a zero-result scoped search', () => {
    render(
      <StreamStatusLine
        state={{
          query: 'holes',
          scope: 'audiobook',
          sources: { plex: 'failed', files: 'complete' },
          results: [],
          phase: 'partial',
          failedSources: ['plex'],
        }}
        widening={{ from: 'Audiobooks', active: true }}
        onRetry={vi.fn()}
        scopeParams="source=plex"
      />
    );

    expect(screen.getByText('Plex did not answer')).toBeVisible();
    expect(screen.getByText(/From everything/)).toBeVisible();
    expect(screen.queryByText(/Still searching/)).toBeNull();
  });

  it('shows failures and the still-arriving signal together while another source is pending', () => {
    render(
      <StreamStatusLine
        state={{
          query: 'bluey', scope: '',
          sources: { plex: 'failed', files: 'pending' },
          results: [], phase: 'partial', failedSources: ['plex'],
        }}
        onRetry={vi.fn()}
        scopeParams="source=plex,files"
      />
    );

    expect(screen.getByText('Plex did not answer')).toBeVisible();
    expect(screen.getByText(/Still searching/)).toBeVisible();
  });
});

describe('source failures by scope (owner 2026-11-27: "Photos did not answer" on a cartoon search)', () => {
  const state = (failedSources) => ({
    query: 'bluey', scope: '', sources: Object.fromEntries(failedSources.map((s) => [s, 'failed'])),
    results: [], phase: 'partial', failedSources,
  });

  it('an everything search names no source at the top', () => {
    const { container } = render(<StreamStatusLine state={state(['immich', 'familyphotos'])} onRetry={vi.fn()} scopeParams="take=50" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/did not answer/)).toBeNull();
  });

  it('an everything search says it once, quietly, with one Retry for every failed source', () => {
    const onRetry = vi.fn();
    renderM(<SourceFailureNote failedSources={['immich', 'familyphotos']} scopeParams="take=50" onRetry={onRetry} />);
    const note = screen.getByTestId('search-failure-note');
    expect(note).toHaveTextContent("Some libraries didn't answer");
    expect(note).not.toHaveTextContent(/Photos|Familyphotos/);
    fireEvent.click(screen.getByTestId('search-failure-note-retry'));
    expect(onRetry.mock.calls.map(([s]) => s)).toEqual(['immich', 'familyphotos']);
  });

  it('a source the scope does not ask for is never mentioned', () => {
    expect(failurePlacement(['familyphotos', 'plex'], 'source=plex&mediaType=video')).toEqual({ rows: ['plex'], note: [] });
    render(<StreamStatusLine state={state(['familyphotos'])} onRetry={vi.fn()} scopeParams="source=plex&mediaType=video" />);
    expect(screen.queryByText(/did not answer/)).toBeNull();
    renderM(<SourceFailureNote failedSources={['familyphotos']} scopeParams="source=plex&mediaType=video" onRetry={vi.fn()} />);
    expect(screen.queryByTestId('search-failure-note')).toBeNull();
  });
});
