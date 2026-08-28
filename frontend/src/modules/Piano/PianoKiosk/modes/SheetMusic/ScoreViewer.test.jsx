import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => h.api(...a) }));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));

// The REAL logger is used (not a stub) so the recent-events ring buffer can be
// read back: it tails each emitted event WITH its merged context, which is the
// only way to assert which log file the event routes to (context.sessionLog).
import { getRecentEvents } from '../../../../../lib/logging/Logger.js';
import ScoreViewer from './ScoreViewer.jsx';

const recent = (name) => getRecentEvents(300).filter((e) => e.event === name);

const route = (path) => (path.includes('/info/') ? 'info' : 'list');

beforeEach(() => { h.api.mockReset(); });

describe('ScoreViewer', () => {
  it('self-resolves title + cover from the info API when there are no child pages (H3)', async () => {
    h.api.mockImplementation((path) => Promise.resolve(
      route(path) === 'info' ? { title: 'Sonata', image: 'cover.jpg' } : { items: [] },
    ));
    render(<ScoreViewer score={{ id: 'plex:123' }} />);
    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'cover.jpg'); // falls back to the info cover, not "no pages"
    expect(img).toHaveAttribute('loading', 'lazy');  // M7
  });

  it('renders child page images lazily', async () => {
    h.api.mockImplementation((path) => Promise.resolve(
      route(path) === 'info' ? { title: 'X' } : { items: [{ image: 'p1.jpg' }, { image: 'p2.jpg' }] },
    ));
    render(<ScoreViewer score={{ id: 'plex:9' }} />);
    const imgs = await screen.findAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute('loading', 'lazy');
    expect(imgs[0]).toHaveAttribute('decoding', 'async');
  });

  it('shows a Try again button on load failure and refetches (M6)', async () => {
    h.api.mockRejectedValueOnce(new Error('net')).mockRejectedValueOnce(new Error('net'));
    render(<ScoreViewer score={{ id: 'plex:5' }} />);
    const retry = await screen.findByRole('button', { name: /try again/i });
    // Second attempt succeeds.
    h.api.mockImplementation((path) => Promise.resolve(
      route(path) === 'info' ? { title: 'Y', image: 'y.jpg' } : { items: [] },
    ));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'y.jpg'));
  });

  // Audit L2: the page-image path's open failure went only to the plain kiosk
  // logger, so the per-run session file (media/logs/piano-sheetmusic/{ts}.jsonl)
  // recorded the open and then nothing — no reason for the blank score.
  it('routes a failed page-image score open into the session log, exactly once (audit L2)', async () => {
    h.api.mockRejectedValue(new Error('list 500'));
    const startsBefore = recent('session-log.start').length;

    render(<ScoreViewer score={{ id: 'plex:777' }} />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy();

    const failures = recent('piano.score-open-failed').filter((e) => e.data?.id === '777');
    expect(failures.length).toBe(1);
    expect(failures[0].data).toMatchObject({ error: 'both info and list failed' });
    // app + sessionLog on the EVENT's context are what route it to the run file
    // (the backend sessionFile transport keys on both, per event).
    expect(failures[0].context).toMatchObject({ app: 'piano-sheetmusic', sessionLog: true });
    // ...and it must NOT open another session file: a fresh sessionLog CHILD
    // auto-emits session-log.start (Logger.js:217), fragmenting the run log.
    expect(recent('session-log.start').length).toBe(startsBefore);
  });

  // The failure tag alone leaves a run file whose first line is an error, with no
  // record that a score was ever opened. Tag the successful open the same way so
  // the session reads as a sequence rather than an orphaned complaint.
  it('routes a successful page-image score open into the session log too (audit L2)', async () => {
    h.api.mockImplementation((path) => Promise.resolve(
      route(path) === 'info' ? { title: 'Prelude' } : { items: [{ image: 'p1.jpg' }] },
    ));
    const startsBefore = recent('session-log.start').length;

    render(<ScoreViewer score={{ id: 'plex:778' }} />);
    await screen.findByRole('img');

    const opens = recent('piano.score-open').filter((e) => e.data?.id === '778');
    expect(opens.length).toBe(1);
    expect(opens[0].context).toMatchObject({ app: 'piano-sheetmusic', sessionLog: true });
    // Still no extra session file — same reasoning as the failure test above.
    expect(recent('session-log.start').length).toBe(startsBefore);
  });
});
