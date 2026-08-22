// frontend/src/modules/Media/search/StreamStatusLine.test.jsx
// Task 10 (spec D3): one-line, fixed-height replacement for the per-source
// badge cloud. Three states: pending (count line), settled+clean (null),
// settled+error (per-source name + Retry wired to onRetry(source)).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StreamStatusLine } from './StreamStatusLine.jsx';

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
});
