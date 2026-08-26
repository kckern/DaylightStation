/**
 * The four things the living-room TV can be showing, driven by the payloads
 * the backend actually broadcasts on `reading:livingroom`.
 *
 * Everything here goes through the real hook — only the transport (WebSocket,
 * fetch), the overlay slot and the audio cue are stood in for. A test that
 * mocked the hook would prove the markup and nothing about the machine.
 */
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { ReadingSessionScreen } from './ReadingSessionScreen.jsx';

const SUMMARY = {
  learnerId: 'learner-c', displayName: 'Learner C', enrolled: true, error: false,
  count: 1, target: 2, progressLabel: '1 of 2 stories', doneToday: false,
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

  it('open: the child sees themselves, the question, the count and yesterday', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });

    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'open');
    expect(screen.getByText('What do you want to read today?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Learner C')).toBeInTheDocument());
    expect(screen.getByTestId('reading-count')).toHaveTextContent('1 of 2 stories');
    expect(screen.getByTestId('reading-yesterday')).toHaveTextContent('Corduroy');
  });

  it('picking: the cover, the title, a visible countdown and how to change your mind', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
    await deliver({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:620681' });

    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'picking');
    expect(screen.getByTestId('reading-countdown')).toBeInTheDocument();
    expect(screen.getByText('Tap another book to change your mind')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Frog and Toad')).toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Frog and Toad' })).toHaveAttribute('src', '/img/frog.jpg');
  });

  // D3: a pick belongs to whoever made it. Transferring it would credit the
  // wrong child, so a different card drops it and goes back to the prompt.
  it('a different card during the countdown swaps the learner and DROPS the pick', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
    await deliver({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:620681' });
    await deliver({ event: 'session-open', learnerId: 'learner-d', location: 'livingroom' });

    expect(screen.getByTestId('reading-session')).toHaveAttribute('data-view', 'open');
    expect(screen.queryByTestId('reading-pick')).toBeNull();
  });

  // D5, assignment mode. The tap was claimed by the backend precisely so that
  // nothing queues — the child's half of that is being told why.
  it('a refused mid-story tap says so on screen', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
    await deliver({ event: 'book-refused', learnerId: 'learner-c', contentId: 'plex:999', reason: 'finish-this-one' });

    expect(screen.getByTestId('reading-notice')).toHaveTextContent('Finish this one first');
    expect(h.cues).toContain('warn');
  });

  // §9: an obligation that cannot be read is surfaced, never silently relaxed —
  // and it must not stop a four-year-old picking a book.
  it('an unreadable obligation is said out loud, and the prompt stays usable', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
    await deliver({ event: 'session-error', learnerId: 'learner-c', reason: 'obligation-unreadable' });

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
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
    expect(h.overlay.dismissed).toBe(1);
  });

  it('and does not keep clearing it for every event inside the session', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
    await deliver({ event: 'session-open', learnerId: 'learner-d', location: 'livingroom' });
    await deliver({ event: 'session-error', learnerId: 'learner-d', reason: 'obligation-unreadable' });
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
    await deliver({ event: 'session-refused', learnerId: 'learner-c', location: 'livingroom', reason: 'content-playing' });

    expect(screen.getByTestId('reading-notice')).toHaveTextContent('Something else is playing');
    expect(h.cues).toContain('warn');
  });

  it('and the refusal does not open a prompt, or otherwise take the screen', async () => {
    render(<ReadingSessionScreen />);
    await deliver({ event: 'session-refused', learnerId: 'learner-c', location: 'livingroom', reason: 'content-playing' });

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
      await deliver({ event: 'session-refused', learnerId: 'learner-c', location: 'livingroom', reason: 'content-playing' });
      expect(screen.getByTestId('reading-notice')).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(8000); });
      expect(container).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a closed session takes the widget back to rendering nothing', async () => {
    const { container } = render(<ReadingSessionScreen />);
    await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
    await deliver({ event: 'session-close', learnerId: 'learner-c' });
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
      await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:620681' });
      expect(h.overlay.shown).toHaveLength(0);

      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      expect(h.overlay.shown).toHaveLength(1);
      expect(h.overlay.shown[0].props.play).toMatchObject({ contentId: 'plex:620681' });
      // Out of the Player's way for as long as the story is up.
      expect(screen.queryByTestId('reading-session')).toBeNull();
    });

    // D10: a child tapping the same book twice is expressing certainty. The 3 s
    // media dedup window would otherwise swallow the second tap entirely.
    it('the SAME book tapped again confirms immediately', async () => {
      render(<ReadingSessionScreen confirmMs={20000} />);
      await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:620681' });
      await deliver({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:620681' });

      expect(h.overlay.shown).toHaveLength(1);
    });

    it('a DIFFERENT book restarts the countdown rather than committing', async () => {
      render(<ReadingSessionScreen confirmMs={2000} />);
      await deliver({ event: 'session-open', learnerId: 'learner-c', location: 'livingroom' });
      await deliver({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:620681' });
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      await deliver({ event: 'book-selected', learnerId: 'learner-c', contentId: 'plex:999' });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

      expect(h.overlay.shown).toHaveLength(0);      // the first pick's clock is gone
      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
      expect(h.overlay.shown[0].props.play).toMatchObject({ contentId: 'plex:999' });
    });
  });
});
