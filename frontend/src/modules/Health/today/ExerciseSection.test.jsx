import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ExerciseSection } from './ExerciseSection.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => api(...args),
  ContentDisplayUrl: id => `/api/v1/display/${id}`,
}));
const workout = { id: 'activity', title: 'Circuit', homeSessionId: 'segment-1', calories: 347.4, minutes: 44.3, avgHeartrate: 121.1 };
const linked = { sessionId: 'group-1', segments: [{ sessionId: 'segment-1', media: { primary: { grandparentId: 'plex:42', showTitle: 'Program' } } }] };
const show = sessions => render(<MantineProvider><ExerciseSection date="2026-09-05" sessions={sessions} /></MantineProvider>);

beforeEach(() => { api.mockReset(); resetApiResourceCache(); });

describe('exercise enrichment', () => {
  it('matches a segment to its session, loads the program poster and retains ledger credit', async () => {
    api.mockResolvedValue({ sessions: [linked, { sessionId: 'unrelated', calories: 1000 }] });
    show([workout]);
    expect(await screen.findByRole('link', { name: 'View fitness session: Circuit' })).toHaveAttribute('href', '/fitness/home/session-group-1');
    expect(screen.getByAltText('Program poster')).toHaveAttribute('src', '/api/v1/display/plex:42');
    expect(document.querySelector('.health-exercise .health-row__kcal')).toHaveTextContent('+347 kcal');
    expect(screen.getByText('44 min')).toBeTruthy();
    expect(screen.getByText('121 bpm avg')).toBeTruthy();
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.error(screen.getByAltText('Program poster'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('leaves an unmatched workout readable without an invented session link', async () => {
    api.mockResolvedValue({ sessions: [{ sessionId: 'unrelated' }] });
    show([workout]);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Circuit')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not fetch session details for an ordinary outdoor activity', () => {
    show([{ title: 'Run', calories: 250 }]);
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText('Run')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps the workout visible when enrichment fails and supports retry', async () => {
    api.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ sessions: [linked] });
    show([workout]);
    fireEvent.click(await screen.findByRole('button', { name: /Workout details unavailable/ }));
    expect(screen.getByText('Circuit')).toBeTruthy();
    expect(await screen.findByRole('link')).toHaveAttribute('href', '/fitness/home/session-group-1');
  });
});
