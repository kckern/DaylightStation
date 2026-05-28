import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ScheduleWindowSummary } from './ScheduleWindowSummary.jsx';

vi.mock('../hooks/useContentTitle.js', () => ({
  useContentTitle: (id) => (id === 'plex:1' ? 'Lo-fi Beats' : null),
}));

function rsum(window) {
  return render(
    <MantineProvider>
      <ScheduleWindowSummary window={window} />
    </MantineProvider>
  );
}

describe('ScheduleWindowSummary', () => {
  it('renders start, end, resolved title, and shuffle marker', () => {
    rsum({ start: '07:00', end: '21:00', queue: 'plex:1', shuffle: true });
    expect(screen.getByText('07:00 – 21:00')).toBeInTheDocument();
    expect(screen.getByText('Lo-fi Beats')).toBeInTheDocument();
    expect(screen.getByText(/shuffle/i)).toBeInTheDocument();
  });

  it('omits shuffle marker when shuffle is false', () => {
    rsum({ start: '07:00', end: '21:00', queue: 'plex:1', shuffle: false });
    expect(screen.queryByText(/shuffle/i)).toBeNull();
  });

  it('falls back to raw id when title is unresolved', () => {
    rsum({ start: '07:00', end: '21:00', queue: 'plex:unknown', shuffle: false });
    expect(screen.getByText('plex:unknown')).toBeInTheDocument();
  });

  it('renders em-dash when start or end is blank', () => {
    rsum({ start: '', end: '', queue: 'plex:1', shuffle: false });
    expect(screen.getByText('— – —')).toBeInTheDocument();
  });
});
