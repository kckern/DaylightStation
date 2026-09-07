import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReadingShelfPanel from './ReadingShelfPanel.jsx';

vi.mock('../teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: { readingShelf: vi.fn() },
}));
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';

const item = (over = {}) => ({
  itemId: 'itm_1', bookId: '9780000000001', progressMode: 'page', pageCount: 184,
  title: 'A Borrowed Title', subtitle: null, authors: ['Paulsen, Gary'], coverUrl: null,
  projection: { status: 'reading', page: 84, percent: 46, minutes: null, daysRead: 6, lastAt: '2026-09-03T18:00:00.000Z' },
  ...over,
});

const shelf = (over = {}) => ({
  learnerId: 'User_4', studyDay: '2026-09-06', earliestFinishDay: '2026-08-23',
  items: [item()],
  obligation: { label: '4 of 7 days', per: 'week', met: false, actual: 4, target: 7, metric: 'checkins', incompatibleBooks: [] },
  ...over,
});

const ok = (data) => ({ ok: true, status: 200, data });

describe('ReadingShelfPanel — what a grown-up sees', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the shelf for the learner in the URL', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    render(<ReadingShelfPanel learnerId="User_4" />);
    await screen.findByText(/A Borrowed Title/);
    expect(teacherWorkspaceApi.readingShelf).toHaveBeenCalledWith('User_4');
  });

  it('shows the obligation and the three counts', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf({ items: [
      item(),
      item({ itemId: 'itm_2', projection: { status: 'finished', page: null, percent: 100, minutes: null, daysRead: 9, lastAt: '2026-09-02T12:00:00.000Z' } }),
      item({ itemId: 'itm_3', projection: { status: 'set-aside', page: 20, percent: 11, minutes: null, daysRead: 2, lastAt: '2026-08-28T12:00:00.000Z' } }),
      item({ itemId: 'itm_4', projection: { status: 'unread', page: null, percent: null, minutes: null, daysRead: 0, lastAt: null } }),
    ] })));
    render(<ReadingShelfPanel learnerId="User_4" />);
    expect(await screen.findByText('4 of 7 days')).toBeTruthy();
    expect(screen.getByText('This week')).toBeTruthy();
    // A book opened but never logged is still on the shelf, not missing.
    expect(screen.getByText(/Reading now 2/)).toBeTruthy();
    expect(screen.getByText(/Finished 1/)).toBeTruthy();
    expect(screen.getByText(/Set aside 1/)).toBeTruthy();
  });

  it('groups the readings under their three headings', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf({ items: [
      item(),
      item({ itemId: 'itm_2', projection: { status: 'finished', page: null, percent: 100, minutes: null, daysRead: 9, lastAt: '2026-09-02T12:00:00.000Z' } }),
      item({ itemId: 'itm_3', projection: { status: 'set-aside', page: 20, percent: 11, minutes: null, daysRead: 2, lastAt: '2026-08-28T12:00:00.000Z' } }),
    ] })));
    render(<ReadingShelfPanel learnerId="User_4" />);
    expect(await screen.findByText('Reading now')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.getByText('Set aside')).toBeTruthy();
    expect(screen.getByText(/finished Sep 2/)).toBeTruthy();
    expect(screen.getByText(/set aside Aug 28/)).toBeTruthy();
  });

  it('names the title, the author and the progress in each mode', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf({ items: [
      item(),
      item({ itemId: 'itm_2', progressMode: 'minutes', pageCount: null, authors: ['Clements, Andrew'],
        projection: { status: 'reading', page: null, percent: null, minutes: 200, daysRead: 4, lastAt: '2026-09-05T12:00:00.000Z' } }),
      item({ itemId: 'itm_3', progressMode: 'check', pageCount: null, authors: ['Palacio, R.J.'],
        projection: { status: 'reading', page: null, percent: null, minutes: null, daysRead: 12, lastAt: '2026-09-04T12:00:00.000Z' } }),
    ] })));
    render(<ReadingShelfPanel learnerId="User_4" />);
    // presentBook humanizes "Paulsen, Gary" — the panel does not re-implement it.
    expect(await screen.findByText('Gary Paulsen')).toBeTruthy();
    expect(screen.getByText('p. 84 / 184')).toBeTruthy();
    expect(screen.getByText('3h 20m')).toBeTruthy();
    expect(screen.getByText('12 days')).toBeTruthy();
    expect(screen.getByText(/page mode · last logged Sep 3/)).toBeTruthy();
    expect(screen.getByText(/minutes mode · last logged Sep 5/)).toBeTruthy();
    expect(screen.getByText(/check-in mode · last logged Sep 4/)).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: '46% read' });
    expect(bar).toBeTruthy();
  });

  it('offers no control that could change the record', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    render(<ReadingShelfPanel learnerId="User_4" />);
    await screen.findByText(/A Borrowed Title/);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('carries ONE control per row, and it navigates rather than writes', async () => {
    const onOpenReading = vi.fn();
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    render(<ReadingShelfPanel learnerId="User_4" onOpenReading={onOpenReading} />);
    const open = await screen.findByRole('button', { name: 'Open A Borrowed Title' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    fireEvent.click(open);
    // The row names the reading; every verb lives one layer in, where no
    // browsing thumb lands on it.
    expect(onOpenReading).toHaveBeenCalledWith('itm_1');
  });

  it('reports the shelf state and its obligation upward, so the workspace can lock the edit surface', async () => {
    const onShelf = vi.fn();
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    render(<ReadingShelfPanel learnerId="User_4" onShelf={onShelf} />);
    await screen.findByText(/A Borrowed Title/);
    await waitFor(() => expect(onShelf).toHaveBeenCalledWith({
      state: 'ok',
      obligation: expect.objectContaining({ per: 'week' }),
      studyDay: '2026-09-06',
    }));
  });

  it('reports a shelf that could NOT be read as an error carrying no obligation', async () => {
    const onShelf = vi.fn();
    teacherWorkspaceApi.readingShelf.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<ReadingShelfPanel learnerId="User_4" onShelf={onShelf} />);
    await waitFor(() => expect(onShelf).toHaveBeenCalledWith({ state: 'error', obligation: null, studyDay: null }));
  });

  it('says "No books yet" when the child has no readings', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf({ items: [], obligation: null })));
    render(<ReadingShelfPanel learnerId="User_4" />);
    expect(await screen.findByText('No books yet.')).toBeTruthy();
  });

  it('a missing route is unavailable, not an error', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue({ ok: false, status: 404, data: null });
    render(<ReadingShelfPanel learnerId="User_4" />);
    await waitFor(() => expect(screen.getByText(/not available on this install/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a refused read is a named error carrying the server’s own sentence', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue({
      ok: false, status: 403, data: { error: 'Only a listed teacher can do this.' },
    });
    render(<ReadingShelfPanel learnerId="User_4" />);
    expect(await screen.findByText(/Only a listed teacher can do this\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No books yet.')).toBeNull();
  });

  it('a broken read is an error with a retry, never an empty shelf', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<ReadingShelfPanel learnerId="User_4" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
    expect(screen.queryByText('No books yet.')).toBeNull();
    expect(screen.queryByText('Reading now')).toBeNull();
  });

  it('an unreadable shelf that answers 200 is STILL an error, never "No books yet"', async () => {
    // The failure this rule exists for: a damaged year of a child's evidence
    // must never present as a shelf a grown-up would believe is empty.
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok({ learnerId: 'User_4', obligation: null }));
    render(<ReadingShelfPanel learnerId="User_4" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
    expect(screen.queryByText('No books yet.')).toBeNull();
    expect(screen.getByText(/couldn’t be read/i)).toBeTruthy();
  });
});
