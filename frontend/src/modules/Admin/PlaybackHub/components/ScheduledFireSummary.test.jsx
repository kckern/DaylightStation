import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ScheduledFireSummary } from './ScheduledFireSummary.jsx';

vi.mock('../hooks/useContentTitle.js', () => ({
  useContentTitle: (id) => (id === 'plex:1' ? 'Wake-up Playlist' : null),
}));

function rsum(row) {
  return render(
    <MantineProvider>
      <ScheduledFireSummary row={row} />
    </MantineProvider>
  );
}

describe('ScheduledFireSummary', () => {
  it('renders time, days chip, and resolved title', () => {
    rsum({ time: '07:30', days: 'weekdays', queue: 'plex:1' });
    expect(screen.getByText('07:30')).toBeInTheDocument();
    expect(screen.getByText('weekdays')).toBeInTheDocument();
    expect(screen.getByText('Wake-up Playlist')).toBeInTheDocument();
  });

  it('falls back to raw id when title unresolved', () => {
    rsum({ time: '07:30', days: 'all', queue: 'plex:zzz' });
    expect(screen.getByText('plex:zzz')).toBeInTheDocument();
  });

  it('shows em-dash for missing time', () => {
    rsum({ time: '', days: 'all', queue: 'plex:1' });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
