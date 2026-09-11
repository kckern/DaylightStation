/**
 * The four things the living-room TV can be showing, driven by the payloads
 * the backend actually broadcasts on `reading:livingroom`.
 *
 * Everything here goes through the real hook — only the transport (WebSocket,
 * fetch), the overlay slot and the audio cue are stood in for. A test that
 * mocked the hook would prove the markup and nothing about the machine.
 */
import { render, screen, act, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

const h = vi.hoisted(() => ({ handler: null, overlay: { shown: [], dismissed: 0 }, cues: [] }));

vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handler = cb; },
}));

vi.mock('../../../screen-framework/overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({
    showOverlay: (Component, props, options) => { h.overlay.shown.push({ Component, props, options }); },
    dismissOverlay: () => { h.overlay.dismissed += 1; },
    hasOverlay: false,
  }),
}));

// The Player is a 1,500-line media stack; this suite is about what is handed
// TO it and what comes back OUT of it.
vi.mock('../../Player/Player.jsx', () => ({ default: () => null }));

vi.mock('../selfService/scanCeremonySound.js', () => ({
  playScanCeremonyTone: (tone) => { h.cues.push(tone); },
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info() {}, debug() {}, warn() {}, error() {} }) }),
}));

import { ReadingSessionScreen, Ceremony, clockTime, recentDayLabel } from './ReadingSessionScreen.jsx';

const SUMMARY = {
  learnerId: 'user_5', displayName: 'User_5', enrolled: true, error: false,
  count: 1, target: 2, progressLabel: '1 of 2 stories', doneToday: false,
  studyDay: '2026-09-02',
  recentDays: [
    { studyDay: '2026-09-02', books: [{ title: 'The Three Little Pigs', contentId: 'plex:620707', at: ['2026-09-03T01:26:42.729Z'], times: 2 }] },
    { studyDay: '2026-09-01', books: [{ title: 'Corduroy', contentId: 'plex:1', at: ['2026-09-01T18:00:00Z'], times: 1 }] },
  ],
  streak: [
    { studyDay: '2026-08-31', books: 0, target: 2, state: 'none' },
    { studyDay: '2026-09-01', books: 1, target: 2, state: 'partial' },
    { studyDay: '2026-09-02', books: 2, target: 2, state: 'met' },
  ],
  yesterday: [{ title: 'Corduroy', contentId: 'plex:1' }],
};

function stubFetch({ summary = SUMMARY, info = { title: 'Frog and Toad', image: '/img/frog.jpg' } } = {}) {
  return vi.fn((url) => {
    const href = String(url);
    if (href.includes('/reading/summary')) return Promise.resolve({ ok: true, status: 200, json: async () => summary });
    if (href.includes('/api/v1/info/')) return Promise.resolve({ ok: true, status: 200, json: async () => info });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

const deliver = async (payload) => {
  await act(async () => { h.handler(payload); });
};

describe('ReadingSessionScreen', () => {
  beforeEach(() => {
    h.handler = null;
    h.overlay.shown.length = 0;
    h.overlay.dismissed = 0;
    h.cues.length = 0;
    vi.stubGlobal('fetch', stubFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders NOTHING until a card opens a session — the screen keeps its own menu', () => {
    const { container } = render(<ReadingSessionScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it('open: the child sees themselves, the question, the count and recent history', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });

    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'open');
    expect(screen.getByText('What do you want to read today?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('User_5')).toBeInTheDocument());
    // The obligation is DRAWN now, not written: one pip per story owed, filled
    // as each is finished. The sentence survives as the accessible name.
    const pips = screen.getByTestId('reading-count');
    expect(pips).toHaveAttribute('aria-label', '1 of 2 stories');
    expect(pips.querySelectorAll('.reading-pip')).toHaveLength(2);
    expect(pips.querySelectorAll('.reading-pip--done')).toHaveLength(1);
    // No "Recent" heading any more: the day headings say what this is, and a
    // label above them was a third word for the same fact. It survives as the
    // section's accessible name.
    expect(screen.getByTestId('reading-recent')).toHaveAccessibleName('Recent stories');
    expect(screen.getByTestId('reading-recent')).toHaveTextContent('The Three Little Pigs');
    expect(screen.getByTestId('reading-recent')).toHaveTextContent('Today');
    expect(screen.getByTestId('reading-recent')).toHaveTextContent('Corduroy');
    expect(screen.getByTestId('reading-recent')).toHaveTextContent('Yesterday');
    // The day is the PARTITION: one group per day, each with its own heading —
    // and TODAY ALWAYS LEADS, drawn from the obligation rather than from the
    // history, so it holds its place whether or not a book has landed in it.
    // Two here, because today has already been read in and is not duplicated
    // behind itself: today's column, then yesterday's.
    const openDays = screen.getAllByTestId('reading-recent-day');
    expect(openDays).toHaveLength(2);
    expect(openDays[0]).toHaveTextContent('Today');
    expect(openDays[1]).toHaveTextContent('Yesterday');
    // Repeats are a badge on the cover they happened on, not a count in a caption.
    expect(screen.getByTestId('reading-recent-times')).toHaveTextContent('2');
  });

  it('open: today leads the shelf with an empty, waiting slot for each story owed', async () => {
    vi.stubGlobal('fetch', stubFetch({
      summary: { ...SUMMARY, count: 0, target: 2, studyDay: '2026-09-03', recentDays: SUMMARY.recentDays },
    }));
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });

    const shelf = await screen.findByTestId('reading-recent');
    const days = within(shelf).getAllByTestId('reading-recent-day');
    // Today leads, even with nothing read yet.
    expect(days[0]).toHaveTextContent('Today');
    // Two owed, none read: two empty slots.
    expect(within(days[0]).getAllByTestId('reading-slot')).toHaveLength(2);
    // Exactly ONE of them is the live one — the next book goes there.
    expect(within(days[0]).getAllByTestId('reading-slot')
      .filter((n) => n.className.includes('--live'))).toHaveLength(1);
  });

  it('open: a story already read today fills a slot and leaves the rest waiting', async () => {
    vi.stubGlobal('fetch', stubFetch({ summary: { ...SUMMARY, count: 1, target: 2 } }));
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });

    const today = (await screen.findAllByTestId('reading-recent-day'))[0];
    expect(within(today).getAllByTestId('reading-recent-card')).toHaveLength(1);
    expect(within(today).getAllByTestId('reading-slot')).toHaveLength(1);
  });

  it('open: a finished day shows today with no slot at all', async () => {
    vi.stubGlobal('fetch', stubFetch({ summary: { ...SUMMARY, count: 2, target: 2, doneToday: true } }));
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    const today = (await screen.findAllByTestId('reading-recent-day'))[0];
    // Today still leads — the column is the day's record once the slots are
    // gone, so nothing behind it may take the front of the shelf.
    expect(today).toHaveTextContent('Today');
    expect(within(today).getAllByTestId('reading-recent-card')).toHaveLength(1);
    expect(within(today).queryByTestId('reading-slot')).toBeNull();
  });

  it('the close is a receipt: today\'s covers, the clock time each finished, and the wall', () => {
    render(<Ceremony tier="day" name="User_5" learner={{ id: 'user_5' }} pick={null} summary={SUMMARY} />);
    const close = screen.getByTestId('reading-celebrate');
    expect(close).toHaveAttribute('data-tier', 'day');
    // The covers of what was read TODAY — the day group matching the study day.
    expect(within(close).getAllByTestId('reading-done-book')).toHaveLength(1);
    // A clock time, never a duration.
    expect(close.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(close.textContent).not.toMatch(/\bmin\b/i);
    // And the wall, so the child watches today's square land.
    expect(within(close).getByTestId('reading-streak')).toBeInTheDocument();
  });

  it('the book-done beat shows the one cover that landed, and no receipt', () => {
    render(<Ceremony tier="book" name="User_5" learner={{ id: 'user_5' }} pick={{ image: '/img/frog.jpg' }} summary={SUMMARY} />);
    const beat = screen.getByTestId('reading-book-done');
    expect(beat).toHaveAttribute('data-tier', 'book');
    expect(screen.queryByTestId('reading-done-books')).toBeNull();
    expect(screen.queryByTestId('reading-streak')).toBeNull();
    expect(beat.querySelector('.reading-session__book-done-cover')).toHaveAttribute('src', '/img/frog.jpg');
  });

  it('clockTime is a time of day, and refuses anything that is not one', () => {
    expect(clockTime('2026-09-09T21:06:33.000Z')).toMatch(/^\d{1,2}:\d{2}$/);
    expect(clockTime(null)).toBeNull();
    expect(clockTime('not a date')).toBeNull();
  });

  it('open: the streak wall shows a month of days, coloured by whether the goal was met', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    const wall = await screen.findByTestId('reading-streak');
    const cells = wall.querySelectorAll('.reading-streak__day');
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute('data-state', 'none');
    expect(cells[1]).toHaveAttribute('data-state', 'partial');
    expect(cells[2]).toHaveAttribute('data-state', 'met');
    // The colour is the streak; the number is the volume. A zero day is blank,
    // not a wall of noughts.
    expect(cells[0].textContent).toBe('');
    expect(cells[2].textContent).toBe('2');
    // Today is where the eye lands.
    expect(screen.getByTestId('reading-streak-today')).toBe(cells[2]);
  });

  it('picking: the cover, the title, a visible countdown and how to change your mind', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681' });

    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'picking');
    expect(screen.getByTestId('reading-countdown')).toBeInTheDocument();
    expect(screen.getByText('Tap another book to change your mind')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Frog and Toad')).toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Frog and Toad' })).toHaveAttribute('src', '/img/frog.jpg');
  });

  it('a different card during the countdown is refused and keeps the pick', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681' });
    await deliver({
      event: 'session-switch-refused', learnerId: 'user_3', currentLearnerId: 'user_5',
      currentSessionId: 'rs-1', state: 'confirm', location: 'livingroom',
    });

    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'picking');
    expect(screen.getByTestId('reading-pick')).toBeInTheDocument();
    expect(screen.getByTestId('reading-notice')).toHaveTextContent('Finish this first');
  });

  // D5, assignment mode. The tap was claimed by the backend precisely so that
  // nothing queues — the child's half of that is being told why.
  it('a refused mid-story tap says so on screen', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    await deliver({ event: 'book-refused', learnerId: 'user_5', contentId: 'plex:999', reason: 'finish-this-one' });

    expect(screen.getByTestId('reading-notice')).toHaveTextContent('Finish this one first');
    expect(h.cues).toContain('warn');
  });

  // §9: an obligation that cannot be read is surfaced, never silently relaxed —
  // and it must not stop a four-year-old picking a book.
  it('an unreadable obligation is said out loud, and the prompt stays usable', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    await deliver({ event: 'session-error', learnerId: 'user_5', reason: 'obligation-unreadable' });

    expect(screen.getByTestId('reading-notice')).toHaveTextContent("I can't check your reading list");
    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'open');
  });

  /**
   * `living-room.yml` runs the ArtMode screensaver with `showOnLoad: true`,
   * and a screensaver is a fullscreen overlay — so the prompt this widget
   * renders into the LAYOUT would be painted straight over by a framed
   * Rembrandt, and the child would tap their card and watch nothing happen.
   * The screensaver suppresses itself for active content and for a mounted
   * overlay, and a session is neither.
   */
  it('clears the screensaver when a session opens, so the prompt is actually visible', async () => {
    render(<ReadingSessionScreen />);
    expect(h.overlay.dismissed).toBe(0);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    expect(h.overlay.dismissed).toBe(1);
  });

  it('and does not keep clearing it for every event inside the session', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    await deliver({ event: 'session-open', learnerId: 'user_3', location: 'livingroom' });
    await deliver({ event: 'session-error', learnerId: 'user_3', reason: 'obligation-unreadable' });
    expect(h.overlay.dismissed).toBe(1);
  });

  /**
   * D2 — a card tapped while a movie is on. The backend refuses it: no session
   * opens and nothing touches the TV. What must NOT also happen is nothing on
   * screen. This is the one acknowledgement that has to render with no session
   * behind it at all, because there is no session — invariant 5, a child who
   * taps and sees nothing taps harder.
   */
  it('a refused card acknowledges the tap even with no session open', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-refused', learnerId: 'user_5', location: 'livingroom', reason: 'content-playing' });

    expect(screen.getByTestId('reading-notice')).toHaveTextContent('Something else is playing');
    expect(h.cues).toContain('warn');
  });

  it('and the refusal does not open a prompt, or otherwise take the screen', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-refused', learnerId: 'user_5', location: 'livingroom', reason: 'content-playing' });

    expect(screen.queryByTestId('reading-prompt')).toBeNull();
    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'idle');
    // Nothing was mounted over the movie, and nothing dismissed what was on it.
    expect(h.overlay.shown).toEqual([]);
    expect(h.overlay.dismissed).toBe(0);
  });

  it('the refusal notice clears itself, leaving the widget rendering nothing again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const { container } = render(<ReadingSessionScreen />);
      await deliver({ event: 'session-refused', learnerId: 'user_5', location: 'livingroom', reason: 'content-playing' });
      expect(screen.getByTestId('reading-notice')).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(8000); });
      expect(container).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a closed session takes the widget back to rendering nothing', async () => {
    const { container } = render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
    await deliver({ event: 'session-close', learnerId: 'user_5' });
    expect(container).toBeEmptyDOMElement();
  });

  describe('the countdown, and what happens when it runs out', () => {
    beforeEach(() => {
      // rAF is faked explicitly — it is NOT in vitest's default `toFake` set,
      // and a real 16 ms rAF under fake timers would never fire at all.
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date',
          'requestAnimationFrame', 'cancelAnimationFrame'],
      });
    });
    afterEach(() => { vi.useRealTimers(); });

    it('mounts the player with the picked book once the countdown expires', async () => {
      render(<ReadingSessionScreen confirmMs={2000} />);
      await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681' });
      expect(h.overlay.shown).toHaveLength(0);

      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      expect(h.overlay.shown).toHaveLength(1);
      expect(h.overlay.shown[0].props.play).toMatchObject({ contentId: 'plex:620681' });
      // Out of the Player's way for as long as the story is up.
      expect(screen.queryByTestId('reading-session')).toBeNull();
    });

    it('shows a refused learner card as a toast above Player without replacing it', async () => {
      render(<ReadingSessionScreen confirmMs={100} />);
      await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681' });
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      const player = h.overlay.shown[0];

      await deliver({
        event: 'session-switch-refused', learnerId: 'user_3', currentLearnerId: 'user_5',
        currentSessionId: 'rs-1', state: 'reading', location: 'livingroom',
      });

      expect(h.overlay.shown[0]).toBe(player);
      expect(h.overlay.shown[1]).toMatchObject({
        options: { mode: 'toast', timeout: 7000 },
        props: { notice: { title: 'Finish this first' } },
      });
    });

    it('records semantic Player completion once before cleanup, but not a genuine dismissal', async () => {
      render(<ReadingSessionScreen confirmMs={100} />);
      await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681', pickId: 'pick-1' });
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      const mounted = h.overlay.shown[0].props;

      let completion;
      act(() => {
        completion = mounted.onPlaybackCompleted({ reason: 'natural-end', assetId: 'plex:620681' });
        mounted.clear();
        mounted.onPlaybackCompleted({ reason: 'natural-end', assetId: 'plex:620681' });
      });
      await act(async () => { await completion; });

      const readPosts = fetch.mock.calls.filter(([url]) => String(url).includes('/reading/read'));
      expect(readPosts).toHaveLength(1);

      // A new story that is merely dismissed must not create another read.
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:999', pickId: 'pick-2' });
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      h.overlay.shown.at(-1).props.clear();
      expect(fetch.mock.calls.filter(([url]) => String(url).includes('/reading/read'))).toHaveLength(1);
    });

    // D10: a child tapping the same book twice is expressing certainty. The 3 s
    // media dedup window would otherwise swallow the second tap entirely.
    it('the SAME book tapped again confirms immediately', async () => {
      render(<ReadingSessionScreen confirmMs={20000} />);
      await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681' });
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681' });

      expect(h.overlay.shown).toHaveLength(1);
    });

    it('a DIFFERENT book restarts the countdown rather than committing', async () => {
      render(<ReadingSessionScreen confirmMs={2000} />);
      await deliver({ event: 'session-open', learnerId: 'user_5', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:620681' });
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      await deliver({ event: 'book-selected', learnerId: 'user_5', contentId: 'plex:999' });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

      expect(h.overlay.shown).toHaveLength(0);      // the first pick's clock is gone
      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
      expect(h.overlay.shown[0].props.play).toMatchObject({ contentId: 'plex:999' });
    });
  });
});

describe('recentDayLabel', () => {
  /* THE AMBIENT ZONE IS THE TEST, so it is pinned rather than inherited.
     A study day is a calendar date, not an instant. The bug parsed it at UTC
     midnight and then formatted the weekday in LOCAL time, which names the day
     BEFORE anywhere behind UTC — and names it correctly at UTC itself. So the
     assertions below can only fail in a zone behind UTC: run the buggy version
     under TZ=UTC and it passes, and this file becomes a description of the fix
     instead of a guard on it, handing every UTC container (CI, Docker, the
     homeserver) a green light from a test incapable of failing.

     Pinned by substituting the default zone rather than by setting TZ, because
     setting it cannot work here: the suite runs `pool: 'threads'`, and a
     worker_thread's `process.env` is a plain snapshot object with none of the
     magic setter Node uses to notify V8 of a zone change. `process.env.TZ` and
     `vi.stubEnv('TZ', …)` both change the string while `resolvedOptions()`
     keeps reporting the zone the worker booted in. Only the zone at spawn
     counts, and that is not per-file.

     So: every formatter that does not name its OWN zone gets the household's,
     which is what a kiosk in the living room actually sees. A formatter that
     names one — the fix — overrides it. That makes these assertions capable of
     failing in any ambient zone, UTC included. */
  const RealDateTimeFormat = Intl.DateTimeFormat;
  beforeAll(() => {
    Intl.DateTimeFormat = function DateTimeFormat(locales, options) {
      return new RealDateTimeFormat(locales, { timeZone: 'America/Los_Angeles', ...options });
    };
  });
  afterAll(() => { Intl.DateTimeFormat = RealDateTimeFormat; });

  it('names the weekday of the study day itself, not the day before it', () => {
    // 2026-09-09 is a Wednesday. Parsed at UTC midnight and formatted in any
    // timezone west of Greenwich, the naive version said "Tue".
    expect(recentDayLabel('2026-09-09', '2026-09-11')).toBe('Wed');
    expect(recentDayLabel('2026-09-08', '2026-09-11')).toBe('Tue');
  });

  it('still prefers the words for the two days that have them', () => {
    expect(recentDayLabel('2026-09-11', '2026-09-11')).toBe('Today');
    expect(recentDayLabel('2026-09-10', '2026-09-11')).toBe('Yesterday');
  });
});
