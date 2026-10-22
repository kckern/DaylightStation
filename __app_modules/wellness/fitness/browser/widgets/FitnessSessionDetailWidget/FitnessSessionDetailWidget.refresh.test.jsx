import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

// Stub Mantine components so tests run without MantineProvider
vi.mock('@mantine/core', () => ({
  Text: ({ children, ...props }) => React.createElement('span', props, children),
  Skeleton: ({ children, ...props }) => React.createElement('div', props, children),
}));

let sessionsValue = null;
vi.mock("../../../../../../__capabilities/screen-host/browser/data/useScreenData.js", () => ({
  useScreenData: (key) => (key === 'sessions' ? sessionsValue : null),
  useScreenDataRefetch: () => vi.fn()
}));
// Stub the FitnessContext hook the widget uses (voice memo add path).
vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => ({ openVoiceMemoCapture: vi.fn() }),
  useFitness: () => ({ openVoiceMemoCapture: vi.fn() })
}));
// Stub FitnessScreenProvider (used for navigation)
vi.mock("../../useFitnessScreen.js", () => ({
  useFitnessScreen: () => ({ onNavigate: vi.fn() })
}));
// Stub useScreen (used for navigation)
vi.mock("../../../../../../__capabilities/screen-host/browser/providers/useScreen.js", () => ({
  useScreen: () => ({ restore: vi.fn() })
}));
// Stub widget registry
vi.mock("../../../../../../__capabilities/screen-host/browser/widgets/registry.js", () => ({
  getWidgetRegistry: () => ({ get: vi.fn() })
}));

import FitnessSessionDetailWidget from "./FitnessSessionDetailWidget.jsx";

const ID = '20260528194117';
let resolveFetch = null;

beforeEach(() => {
  sessionsValue = null;
  resolveFetch = null;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ sessionId: ID, summary: { voiceMemos: [] }, timeline: {} })
  });
});

// The real store shape: { sessions: [...] } from /api/v1/fitness/sessions.
const list = (...rows) => ({ sessions: rows });

describe('FitnessSessionDetailWidget — refresh when its list row changes', () => {
  it('shows an elapsed clock range and measured participant time for a singleton detail', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: {
          sessionId: ID,
          timezone: 'UTC',
          session: {
            date: '2026-05-28',
            start: '2026-05-28T13:00:00.000Z',
            end: '2026-05-28T15:45:00.000Z',
            duration_seconds: 80 * 60,
          },
          participants: { 'test-rider': { display_name: 'Test Rider' } },
          summary: {
            participants: { 'test-rider': { zone_minutes: { active: 41 } } },
            voiceMemos: [],
          },
          timeline: {},
        } }),
    });

    const { container } = render(<FitnessSessionDetailWidget sessionId={ID} />);

    await waitFor(() => expect(container.querySelector('.session-detail__header')).not.toBeNull());
    expect(container.textContent).toContain('1:00pm – 3:45pm');
    expect(container.textContent).toContain('2h 45m elapsed');
    expect(container.textContent).toContain('Test Rider 41m measured');
  });

  it('re-fetches in the background when this session\'s row changes (final save, memo)', async () => {
    sessionsValue = list({ sessionId: ID, voiceMemos: [] });
    const { rerender, container } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('.session-detail__header')).not.toBeNull());

    // Hold the refresh open so the in-flight state is observable.
    global.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    sessionsValue = list({ sessionId: ID, voiceMemos: [{ memoId: 'm1' }] });
    rerender(<FitnessSessionDetailWidget sessionId={ID} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    // The rendered detail stays up while it refreshes — no skeleton swap.
    expect(container.querySelector('.session-detail__header')).not.toBeNull();
    resolveFetch({ ok: true, json: async () => ({ sessionId: ID, summary: { voiceMemos: [] }, timeline: {} }) });
  });

  it('re-fetches when the session first appears in a refreshed list (post-session landing)', async () => {
    sessionsValue = list({ sessionId: 'older' });
    const { rerender } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    sessionsValue = list({ sessionId: ID }, { sessionId: 'older' });
    rerender(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('does not re-fetch when a list refresh leaves its row unchanged', async () => {
    sessionsValue = list({ sessionId: ID, voiceMemos: [] });
    const { rerender } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    // The 5-minute poll: a new store object, another session added, this row identical.
    sessionsValue = list({ sessionId: 'newer' }, { sessionId: ID, voiceMemos: [] });
    rerender(<FitnessSessionDetailWidget sessionId={ID} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch when the list arrives after the detail on a cold load', async () => {
    const { rerender } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    sessionsValue = list({ sessionId: ID });
    rerender(<FitnessSessionDetailWidget sessionId={ID} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('switching sessions keeps the outgoing detail up (dimmed) instead of a skeleton', async () => {
    const { rerender, container } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(container.querySelector('.session-detail__header')).not.toBeNull());

    global.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    rerender(<FitnessSessionDetailWidget sessionId="20260601080000" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    expect(container.querySelector('.session-detail--skeleton')).toBeNull();
    expect(container.querySelector('.session-detail--stale .session-detail__header')).not.toBeNull();
    expect(container.textContent).toContain(ID);

    resolveFetch({ ok: true, json: async () => ({ sessionId: '20260601080000', summary: { voiceMemos: [] }, timeline: {} }) });
    await waitFor(() => expect(container.querySelector('.session-detail--stale')).toBeNull());
    expect(container.textContent).toContain('20260601080000');
  });

  it('first load shows the layout skeleton (header, chart, lanes)', () => {
    global.fetch.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    const skel = container.querySelector('.session-detail--skeleton');
    expect(skel).not.toBeNull();
    expect(skel.querySelector('.session-detail__header .session-detail__poster')).not.toBeNull();
    expect(skel.querySelector('.session-detail__chart')).not.toBeNull();
    expect(skel.querySelector('.session-detail__timeline')).not.toBeNull();
  });

  it('delete takes two taps: the first only arms it', async () => {
    const { container } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(container.querySelector('.session-detail__delete')).not.toBeNull());
    const del = () => container.querySelector('.session-detail__delete');

    del().click();
    await waitFor(() => expect(del().textContent).toBe('Delete?'));
    expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    del().click();
    await waitFor(() => expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });

  it('switching to a session in the list renders its header from the row at once; only the charts wait', async () => {
    const NEXT = '20261009153448';
    sessionsValue = list(
      { sessionId: ID, date: '2026-05-28' },
      {
        sessionId: NEXT, date: '2026-10-09', timezone: 'UTC',
        startTime: Date.parse('2026-10-09T15:34:00Z'), endTime: Date.parse('2026-10-09T16:17:00Z'), elapsedMs: 43 * 60_000,
        media: { primary: { title: 'Sonic & Sega All Stars Racing', showTitle: 'Game Cycling', contentId: 'plex:1', grandparentId: 'plex:2' } },
        participants: { 'test-rider': { displayName: 'Test Rider', measuredDurationMs: 39 * 60_000 } },
        totalRings: 2293, maxSufferScore: 8,
        voiceMemos: [{ transcript: 'We finished the egg cup.' }],
      },
    );
    const { rerender, container } = render(<FitnessSessionDetailWidget sessionId={ID} />);
    await waitFor(() => expect(container.querySelector('.session-detail__header')).not.toBeNull());

    global.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    rerender(<FitnessSessionDetailWidget sessionId={NEXT} />);

    const root = container.querySelector('.session-detail');
    expect(root.classList.contains('session-detail--pending')).toBe(true);
    expect(root.classList.contains('session-detail--stale')).toBe(false);
    expect(container.textContent).toContain('Sonic & Sega All Stars Racing');
    expect(container.textContent).toContain('2293');
    expect(container.textContent).toContain('We finished the egg cup.');
    expect(container.textContent).toContain('Test Rider 39m measured');
    expect(container.textContent).toContain('3:34pm – 4:17pm');
    expect(container.querySelector('.session-detail__chart .session-detail__skeleton-plot')).not.toBeNull();
    expect(container.querySelectorAll('.session-detail__skeleton-lane')).toHaveLength(1);

    resolveFetch({ ok: true, json: async () => ({ sessionId: NEXT, summary: { voiceMemos: [] }, timeline: {} }) });
    await waitFor(() => expect(container.querySelector('.session-detail--pending')).toBeNull());
  });
});


it('shows saved playback and resets selected evidence when loading another session', async () => {
  const size = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  const start = Date.parse('2027-01-15T08:00:00Z');
  const detail = (id, recorded) => ({ session: { sessionId: id, session: { start: '2027-01-15T08:00:00Z', end: '2027-01-15T08:05:00Z' }, summary: {}, timeline: { tick_count: 61, interval_seconds: 5, events: [
    { type: 'media', data: { contentId: 'video:1', title: 'Episode', start, end: start + 300000 } },
    ...(recorded ? [
      { type: 'playback_state', timestamp: start, data: { version: 1, contentId: 'video:1', playbackRunId: id, state: 'waiting', observation: 'begin' } },
      { type: 'playback_state', timestamp: start + 60000, data: { version: 1, contentId: 'video:1', playbackRunId: id, state: 'playing', observation: 'change', evidence: { zone: 'hot', reason: 'startup_gate', hrBpm: 165 } } },
      { type: 'playback_state', timestamp: start + 300000, data: { version: 1, contentId: 'video:1', playbackRunId: id, state: 'none', observation: 'end' } },
    ] : []),
  ] } } });
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => detail(ID, true) });
  const { container, rerender, unmount } = render(<FitnessSessionDetailWidget sessionId={ID} />);
  try {
    await waitFor(() => expect(container.querySelector('.playback-strip')).not.toBeNull());
    fireEvent.click(container.querySelector('button[aria-label^="Video started"]'));
    // The explanation opens in a modal (portalled to the body), not in the chart.
    const details = () => document.querySelector('[role="dialog"][aria-label="Playback details"]');
    expect(details().querySelector('[role="status"]').textContent).toContain('165 BPM');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => detail('20270115080500', false) });
    rerender(<FitnessSessionDetailWidget sessionId="20270115080500" />);
    await waitFor(() => expect(container.querySelector('button[aria-label^="Playback not recorded"]')).not.toBeNull());
    expect(details()).toBeNull();
  } finally { unmount(); size.mockRestore(); }
});
