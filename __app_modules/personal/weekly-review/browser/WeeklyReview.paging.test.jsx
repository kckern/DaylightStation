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

vi.mock("./hooks/useChunkUploader.js", () => ({
  useChunkUploader: ({ week }) => {
    uploaderCalls.weeks.push(week);
    return {
      enqueue: async () => {}, flushNow: () => {}, beaconFlush: () => {},
      status: 'idle', pendingCount: 0, pendingCountRef: { current: 0 }, lastAckedAt: null,
    };
  },
}));

vi.mock("./hooks/useAudioRecorder.js", () => ({
  useAudioRecorder: () => ({
    isRecording: true, duration: 12, micLevelRef: { current: 0.4 }, silenceWarning: false,
    error: null, startRecording: () => {}, stopRecording: () => {},
    firstAudibleFrameSeen: true, disconnected: false, reconnect: async () => true,
  }),
}));

vi.mock("./hooks/chunkDb.js", () => ({
  deleteSession: async () => {}, listSessions: async () => [], getChunksForSession: async () => [],
}));

const WeeklyReview = (await import("./WeeklyReview.jsx")).default;

// Eight days starting at `start`, each carrying one morning photo (so nothing
// renders as an empty window by accident) and one evening piece of school work,
// which the reel plays after the photo.
const windowPayload = (start) => {
  const days = [];
  const d = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < 8; i++) {
    const date = new Date(d);
    date.setUTCDate(d.getUTCDate() + i);
    const iso = date.toISOString().slice(0, 10);
    // Photo takenAt is Immich's format: wall-clock time with a misleading Z.
    // Work at 23:00Z lands after a 09:00 wall-clock photo in every real zone.
    const work = {
      learnerId: 'kid-a', learnerName: 'Mara', kind: 'book', verb: 'finished',
      title: `Book ${iso}`, subtitle: null, at: `${iso}T23:00:00Z`, studyDay: iso,
      imageUrl: null, groupKey: `book:${iso}`, weight: 1, subject: 'reading',
    };
    days.push({
      date: iso, label: 'Day', photoCount: 1,
      photos: [{ id: `${iso}-a`, type: 'image', url: '/x.jpg', takenAt: `${iso}T09:00:00.000Z` }],
      school: [work], schoolAll: [work],
      calendar: [], fitness: [], weather: null, columnWeight: 1,
    });
  }
  // Bootstrap carries plain showcase bullets; the showcase endpoint may later
  // replace them with drafted ones.
  const schoolShowcase = [{
    learnerId: 'kid-a', learnerName: 'Robin', bullets: [`Plain ${start}`], images: [], source: 'plain',
  }];
  return { week: start, days, schoolShowcase, recording: { exists: false } };
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

  it('Right in a day reel steps from the photo onto the work card', async () => {
    const { container } = await mount();
    press('Enter'); // open the focused (last) day
    await waitFor(() => expect(container.querySelector('.weekly-review-reel--photo')).not.toBeNull());
    expect(container.querySelector('.fullscreen-image-index').textContent).toBe('1 / 3');
    press('ArrowRight');
    await waitFor(() => expect(container.querySelector('.weekly-review-work-card')).not.toBeNull());
    expect(container.querySelector('.work-card-title').textContent).toBe('Book 2026-08-15');
    expect(container.querySelector('.work-card-index').textContent).toBe('2 / 3');
  });

  it('crossing back a day lands on that day\'s last reel item, the work card', async () => {
    const { container } = await mount();
    press('Enter');
    await waitFor(() => expect(container.querySelector('.weekly-review-reel--photo')).not.toBeNull());
    press('ArrowLeft'); // arm at the first item
    press('ArrowLeft'); // cross to the previous day
    await waitFor(() => expect(container.querySelector('.weekly-review-work-card')).not.toBeNull());
    expect(container.querySelector('.work-card-title').textContent).toBe('Book 2026-08-14');
  });

  it('draws the school strip on the grid', async () => {
    const { container } = await mount();
    expect(container.querySelectorAll('.day-school .school-chip')).toHaveLength(8);
    expect(container.querySelector('.school-chip').style.getPropertyValue('--kid')).toBe('#2f6fde');
  });

  // Routes every call like the default mock, with the showcase endpoint
  // answered by `showcase(week)`.
  const routeShowcase = (showcase) => api.call.mockImplementation(async (url) => {
    if (url.startsWith('/api/v1/weekly-review/school/showcase')) return showcase(url.match(/week=([\d-]+)/)[1]);
    if (url.startsWith('/api/v1/weekly-review/bootstrap')) {
      const m = url.match(/week=([\d-]+)/);
      return windowPayload(m ? m[1] : NEWEST);
    }
    if (url.startsWith('/api/v1/weekly-review/extent')) return { ok: true, oldestContentDate: '2026-07-02', hasOlder: true };
    if (url.includes('/recording/drafts')) return { ok: true, drafts: [] };
    return { ok: true };
  });
  const drafted = (week, text) => ({
    showcases: [{ learnerId: 'kid-a', learnerName: 'Robin', bullets: [text], images: [], source: 'ai' }],
  });
  const showcaseTitle = () => document.querySelector('.showcase-title')?.textContent;

  it('closes the last day with each child\'s showcase slide', async () => {
    routeShowcase(() => new Promise(() => {})); // drafting never finishes
    await mount();
    press('Enter');
    press('ArrowRight'); // photo → work card
    press('ArrowRight'); // work card → showcase
    await waitFor(() => expect(showcaseTitle()).toBe("Robin's School Work This Week"));
    expect(screen.getByText(`Plain ${NEWEST}`)).toBeInTheDocument();
    expect(document.querySelector('.work-card-index').textContent).toBe('3 / 3');
  });

  it('replaces the plain bullets with drafted ones when they arrive', async () => {
    routeShowcase((week) => drafted(week, `Drafted ${week}`));
    await mount();
    expect(api.call).toHaveBeenCalledWith(expect.stringContaining(`/school/showcase?week=${NEWEST}`));
    press('Enter');
    press('ArrowRight');
    press('ArrowRight');
    await waitFor(() => expect(screen.getByText(`Drafted ${NEWEST}`)).toBeInTheDocument());
  });

  it('ignores a drafted answer that arrives after paging away from its window', async () => {
    const pending = {};
    routeShowcase((week) => new Promise((resolve) => { pending[week] = resolve; }));
    await mount();
    await waitFor(() => expect(pending[NEWEST]).toBeTypeOf('function'));

    press('ArrowUp'); press('ArrowUp'); press('ArrowUp'); // page back to PREV
    await expectWindow('Jul 31 – Aug 7');
    await act(async () => { pending[NEWEST](drafted(NEWEST, 'Stale bullet')); });

    press('Enter'); // focus lands on PREV's last day
    press('ArrowRight');
    press('ArrowRight');
    await waitFor(() => expect(showcaseTitle()).toBe("Robin's School Work This Week"));
    expect(screen.getByText(`Plain ${PREV}`)).toBeInTheDocument();
    expect(screen.queryByText('Stale bullet')).toBeNull();

    // The late answer was dropped, not filed: coming back asks again.
    const asksFor = (week) => api.call.mock.calls.filter(c => String(c[0]).includes(`/school/showcase?week=${week}`)).length;
    expect(asksFor(NEWEST)).toBe(1);
    press('ArrowUp'); // back to the grid
    press('ArrowDown'); press('ArrowDown'); // page forward to the newest window
    await expectWindow('Aug 8 – Aug 15');
    await waitFor(() => expect(asksFor(NEWEST)).toBe(2));
  });
});
