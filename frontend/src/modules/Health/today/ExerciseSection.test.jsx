import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ExerciseSection } from './ExerciseSection.jsx';
import { RowPreviewProvider } from './RowPreview.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => api(...args),
  ContentDisplayUrl: id => `/api/v1/display/${id}`,
}));
const workout = { id: 'activity', title: 'Circuit', homeSessionId: 'segment-1', calories: 347.4, minutes: 44.3, avgHeartrate: 121.1, startTime: '01:20 pm' };
const linked = { sessionId: 'group-1', segments: [{ sessionId: 'segment-1', media: { primary: { grandparentId: 'plex:42', showTitle: 'Program', description: 'Build bigger arms.' } } }] };
const withMemo = { ...linked, voiceMemos: [{ transcript: 'I put in the work.' }, { transcript: 'Sore tomorrow.' }, { transcript: '  ' }] };
const show = sessions => render(<MantineProvider><div className="ds-root"><RowPreviewProvider>
  <ExerciseSection date="2026-09-05" sessions={sessions} /></RowPreviewProvider></div></MantineProvider>);
const row = () => document.querySelector('.health-exercise');
const hover = () => fireEvent.pointerEnter(row(), { clientX: 20, clientY: 300 });

beforeEach(() => { api.mockReset(); resetApiResourceCache(); });

describe('exercise row', () => {
  it('is one link to the session: poster, title, minutes and the ledger credit', async () => {
    api.mockResolvedValue({ sessions: [linked, { sessionId: 'unrelated', calories: 1000 }] });
    show([workout]);
    const link = await screen.findByRole('link', { name: /Circuit/ });
    expect(link).toHaveAttribute('href', '/fitness/home/session-group-1');
    expect(link).toBe(row());
    // Decorative inside the link: the title beside it already names the row.
    expect(row().querySelector('.health-exercise__art img')).toHaveAttribute('src', '/api/v1/display/plex:42');
    expect(row().querySelector('.health-exercise__art img')).toHaveAttribute('alt', '');
    expect(row().querySelector('.health-exercise__minutes')).toHaveTextContent('44 min');
    expect(row().querySelector('.health-exercise__kcal')).toHaveTextContent('+347 kcal');
    expect(screen.queryByText(/View session/)).toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('keeps start time and heart rate off the row', async () => {
    api.mockResolvedValue({ sessions: [linked] });
    show([workout]);
    await screen.findByRole('link');
    expect(row()).not.toHaveTextContent('bpm');
    expect(row()).not.toHaveTextContent('01:20 pm');
  });

  it('shows the first voice memo and hides the description when there is one', async () => {
    api.mockResolvedValue({ sessions: [withMemo] });
    show([workout]);
    expect(await screen.findByText('“I put in the work.”')).toHaveClass('health-exercise__memo');
    expect(row().querySelectorAll('.health-exercise__memo')).toHaveLength(1);
    expect(row()).not.toHaveTextContent('Build bigger arms.');
  });

  it('falls back to the description when there is no voice memo', async () => {
    api.mockResolvedValue({ sessions: [linked] });
    show([workout]);
    expect(await screen.findByText('Build bigger arms.')).toHaveClass('health-exercise__description');
    expect(row().querySelector('.health-exercise__memo')).toBeNull();
  });

  it('hovering opens a card with everything the row leaves out', async () => {
    api.mockResolvedValue({ sessions: [withMemo] });
    show([workout]);
    await screen.findByRole('link');
    hover();
    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent('Circuit');
    expect(card).toHaveTextContent('01:20 pm');
    expect(card).toHaveTextContent('44 min');
    expect(card).toHaveTextContent('121 bpm avg');
    expect(card).toHaveTextContent('+347 kcal');
    expect(card).toHaveTextContent('“I put in the work.”');
    expect(card).toHaveTextContent('“Sore tomorrow.”');
    expect(card).toHaveTextContent('Build bigger arms.');
    fireEvent.pointerLeave(row());
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('on a touch screen, tapping the poster toggles the card instead of navigating', async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = query => ({ matches: query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} });
    try {
      api.mockResolvedValue({ sessions: [linked] });
      show([workout]);
      await screen.findByRole('link');
      const poster = row().querySelector('.health-exercise__art');
      fireEvent.pointerDown(poster);
      expect(fireEvent.click(poster)).toBe(false); // default (navigation) prevented
      expect(screen.getByRole('tooltip')).toHaveTextContent('Circuit');
    } finally { window.matchMedia = matchMedia; }
  });

  it('drops a broken poster for the barbell and keeps the link', async () => {
    api.mockResolvedValue({ sessions: [linked] });
    show([workout]);
    await screen.findByRole('link');
    fireEvent.error(row().querySelector('.health-exercise__art img'));
    expect(row().querySelector('.health-exercise__art img')).toBeNull();
    expect(row().querySelector('.health-exercise__art svg')).toBeTruthy();
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('marks a heart-rate estimate (home session not on Strava yet)', async () => {
    api.mockResolvedValue({ sessions: [{ sessionId: 'home-1' }] });
    show([{ id: 'home-home-1', source: 'home', estimated: true, homeSessionId: 'home-1', title: 'Game Cycling', calories: 179, minutes: 20.55 }]);
    const kcal = row().querySelector('.health-exercise__kcal');
    expect(kcal).toHaveTextContent('+~179 kcal');
    expect(kcal).toHaveAttribute('title', 'Estimated from heart rate; not on Strava yet');
    expect(await screen.findByRole('link', { name: /Game Cycling/ })).toHaveAttribute('href', '/fitness/home/session-home-1');
    hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('+~179 kcal est.');
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

  it('puts the section subtotal in the header-right cluster, like a meal', () => {
    show([{ title: 'Run', calories: 250 }, { title: 'Walk', calories: 61 }]);
    expect(document.querySelector('.health-meal__header-right .health-meal__kcal')).toHaveTextContent('+311 kcal');
  });

  it('an unlinked workout still takes keyboard focus for its card', async () => {
    api.mockResolvedValue({ sessions: [{ sessionId: 'unrelated' }] });
    show([workout]);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(row().tagName).toBe('DIV');
    expect(row()).toHaveAttribute('tabindex', '0');
  });

  it('asks the fitness index again when a new home session reaches the ledger, not on every poll', async () => {
    api.mockResolvedValue({ sessions: [linked] });
    const { rerender } = show([workout]);
    await screen.findByRole('link');
    const again = sessions => rerender(<MantineProvider><div className="ds-root"><RowPreviewProvider>
      <ExerciseSection date="2026-09-05" sessions={sessions} /></RowPreviewProvider></div></MantineProvider>);
    again([{ ...workout }]); // the budget poll: same workouts, new objects
    expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValue({ sessions: [linked, { sessionId: 'later', voiceMemos: [{ transcript: 'Done.' }] }] });
    again([workout, { id: 'late', title: 'Evening ride', homeSessionId: 'later', calories: 90 }]);
    expect(await screen.findByRole('link', { name: /Evening ride/ })).toHaveAttribute('href', '/fitness/home/session-later');
    expect(api).toHaveBeenCalledTimes(2);
  });
});
