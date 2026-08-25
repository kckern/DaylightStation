// frontend/src/modules/WeeklyReview/WeeklyReview.paging.test.jsx
//
// Multi-week paging at the component level. The assertion that matters most
// here is the pinned recording week: if the uploader ever follows the viewed
// window, a session's audio silently splits across two folders.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';

const api = vi.hoisted(() => ({ call: vi.fn() }));
const uploaderCalls = vi.hoisted(() => ({ weeks: [] }));

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => api.call(...args) }));

vi.mock('@/lib/logging/Logger.js', () => {
  const child = () => ({ child, debug() {}, info() {}, warn() {}, error() {}, sampled() {} });
  return { default: () => child(), configure() {} };
});

vi.mock('./hooks/useChunkUploader.js', () => ({
  useChunkUploader: ({ week }) => {
    uploaderCalls.weeks.push(week);
    return {
      enqueue: async () => {}, flushNow: () => {}, beaconFlush: () => {},
      status: 'idle', pendingCount: 0, pendingCountRef: { current: 0 }, lastAckedAt: null,
    };
  },
}));

vi.mock('./hooks/useAudioRecorder.js', () => ({
  useAudioRecorder: () => ({
    isRecording: true, duration: 12, micLevelRef: { current: 0.4 }, silenceWarning: false,
    error: null, startRecording: () => {}, stopRecording: () => {},
    firstAudibleFrameSeen: true, disconnected: false, reconnect: async () => true,
  }),
}));

vi.mock('./hooks/chunkDb.js', () => ({
  deleteSession: async () => {}, listSessions: async () => [], getChunksForSession: async () => [],
}));

const WeeklyReview = (await import('./WeeklyReview.jsx')).default;

// Eight days starting at `start`, each carrying one photo so nothing renders as
// an empty window by accident.
const windowPayload = (start) => {
  const days = [];
  const d = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < 8; i++) {
    const date = new Date(d);
    date.setUTCDate(d.getUTCDate() + i);
    const iso = date.toISOString().slice(0, 10);
    days.push({
      date: iso, label: 'Day', photoCount: 1,
      photos: [{ id: `${iso}-a`, type: 'image', url: '/x.jpg' }],
      calendar: [], fitness: [], weather: null, columnWeight: 1,
    });
  }
  return { week: start, days, recording: { exists: false } };
};

const NEWEST = '2026-08-08';
const PREV = '2026-07-31';

const press = (key) => act(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

// The recording bar names the pinned session week and the header names the
// viewed window; both hold a date range, so window assertions must be scoped to
// the header or they match twice.
const viewedWindow = () => document.querySelector('.window-range')?.textContent;
const expectWindow = (range) => waitFor(() => expect(viewedWindow()).toBe(range));

describe('WeeklyReview — multi-week paging', () => {
  beforeEach(() => {
    uploaderCalls.weeks = [];
    api.call.mockReset();
    api.call.mockImplementation(async (url) => {
      if (url.startsWith('/api/v1/weekly-review/bootstrap')) {
        const m = url.match(/week=([\d-]+)/);
        return windowPayload(m ? m[1] : NEWEST);
      }
      if (url.startsWith('/api/v1/weekly-review/extent')) {
        return { ok: true, oldestContentDate: '2026-07-02', hasOlder: true };
      }
      if (url.includes('/recording/drafts')) return { ok: true, drafts: [] };
      if (url.includes('/audio-bridge/heal')) return { ok: true };
      return { ok: true };
    });
  });

  // Explicit: every mount registers a document-level keydown listener, so a
  // instance left over from a previous test would eat this one's presses.
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  const mount = async () => {
    const utils = render(<WeeklyReview clear={() => {}} />);
    await expectWindow('Aug 8 – Aug 15');
    // WAIT FOR THE GRID TO SETTLE, not just for the header to name a window.
    // Arrow presses are ignored while a window is loading, and the edge hint is
    // suppressed outright (`edgeHint && !windowLoading`) — so a press landing
    // in that gap arms nothing and the assertion waits for a hint that will
    // never come. The header renders before the fetch resolves, so awaiting it
    // alone is a race the sweep loses when the machine is busy.
    await waitFor(() => expect(document.querySelector('.weekly-review-grid--loading')).toBeNull());
    return utils;
  };

  it('opens on the newest window and shows no "back" tag', async () => {
    const { container } = await mount();
    expect(container.querySelector('.window-back-tag')).toBeNull();
  });

  it('a single Up on the top row moves nothing and explains the second press', async () => {
    const { container } = await mount();
    // Focus starts on the last cell; walk up to the top row first.
    press('ArrowUp');
    press('ArrowUp');
    await waitFor(() => expect(container.querySelector('.window-hint')).not.toBeNull());
    expect(container.querySelector('.window-hint').textContent).toMatch(/Jul 31 – Aug 7/);
    // Still on the same window — an arming tap must not page.
    expect(viewedWindow()).toBe('Aug 8 – Aug 15');
  });

  it('a second Up pages back a window and tags how far back it is', async () => {
    const { container } = await mount();
    press('ArrowUp');
    press('ArrowUp'); // now on the top row, armed
    press('ArrowUp'); // fires pageBack
    await expectWindow('Jul 31 – Aug 7');
    expect(container.querySelector('.window-back-tag').textContent).toBe('1 window back');
    expect(api.call).toHaveBeenCalledWith(expect.stringContaining(`week=${PREV}`));
  });

  it('KEEPS THE RECORDING PINNED across a window change', async () => {
    await mount();
    const weekAtStart = uploaderCalls.weeks.at(-1);
    expect(weekAtStart).toBe(NEWEST);

    press('ArrowUp');
    press('ArrowUp');
    press('ArrowUp');
    await expectWindow('Jul 31 – Aug 7');

    // The grid moved; the uploader must not have.
    expect(uploaderCalls.weeks.every(w => w === NEWEST || w === '0000-00-00')).toBe(true);
    expect(uploaderCalls.weeks.at(-1)).toBe(NEWEST);
  });

  it('the recording bar keeps naming the session week, not the viewed window', async () => {
    await mount();
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp');
    await expectWindow('Jul 31 – Aug 7');
    expect(screen.getByText('Week of Aug 8 – Aug 15')).toBeInTheDocument();
  });

  it('serves a revisited window from cache instead of refetching', async () => {
    await mount();
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp');
    await expectWindow('Jul 31 – Aug 7');

    const bootstrapsAfterBack = api.call.mock.calls.filter(c => String(c[0]).includes('/bootstrap')).length;

    // Land on the bottom row, then double-Down back to the newest window.
    press('ArrowDown'); press('ArrowDown');
    await expectWindow('Aug 8 – Aug 15');

    const bootstrapsAfterForward = api.call.mock.calls.filter(c => String(c[0]).includes('/bootstrap')).length;
    expect(bootstrapsAfterForward).toBe(bootstrapsAfterBack);
  });

  it('Down is inert on the newest window — there is nothing newer to page into', async () => {
    const { container } = await mount();
    press('ArrowDown');
    press('ArrowDown');
    expect(viewedWindow()).toBe('Aug 8 – Aug 15');
    expect(container.querySelector('.window-hint')).toBeNull();
  });

  it('a third Up jumps to the window holding the oldest content', async () => {
    await mount();
    press('ArrowUp'); press('ArrowUp'); // arm on the top row
    press('ArrowUp');                   // pageBack
    press('ArrowUp');                   // jumpOldest
    await waitFor(() => expect(api.call).toHaveBeenCalledWith(expect.stringContaining('/extent?before=')));
    // 2026-07-02 snaps to the stride window starting 2026-06-29.
    await expectWindow('Jun 29 – Jul 6');
  });

  it('degrades a failed extent probe to an ordinary page back rather than doing nothing', async () => {
    api.call.mockImplementation(async (url) => {
      if (url.startsWith('/api/v1/weekly-review/extent')) throw new Error('immich down');
      if (url.startsWith('/api/v1/weekly-review/bootstrap')) {
        const m = url.match(/week=([\d-]+)/);
        return windowPayload(m ? m[1] : NEWEST);
      }
      if (url.includes('/recording/drafts')) return { ok: true, drafts: [] };
      return { ok: true };
    });
    await mount();
    press('ArrowUp'); press('ArrowUp');
    press('ArrowUp'); // pageBack → Jul 31
    await expectWindow('Jul 31 – Aug 7');
    press('ArrowUp'); // jumpOldest, probe throws → falls back one more window
    await expectWindow('Jul 23 – Jul 30');
  });

  it('keeps the current window painted when the next one fails to load', async () => {
    await mount();
    api.call.mockImplementation(async (url) => {
      if (url.startsWith('/api/v1/weekly-review/bootstrap')) throw new Error('backend down');
      return { ok: true };
    });
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp');
    await waitFor(() => expect(screen.getByText(/Couldn't load Jul 31 – Aug 7/)).toBeInTheDocument());
    // The window the user was narrating is still on screen.
    expect(viewedWindow()).toBe('Aug 8 – Aug 15');
  });
});
