/**
 * The Reading workspace — the shelf, the detail it opens, and the one rule
 * that outranks both (teacher reading admin design §6).
 *
 * **A shelf that cannot be read shows no edit controls.** A damaged year of a
 * child's evidence must never present as a shelf a grown-up starts "fixing",
 * and a deep link into a reading must not walk around that.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReadingView } from './WorkspaceViews.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: { books: { resolve: vi.fn() } },
}));
vi.mock('./teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: {
    readingShelf: vi.fn(),
    readingDetail: vi.fn(),
    updateReading: vi.fn(),
    addReadingEntry: vi.fn(),
    updateReadingEntry: vi.fn(),
    deleteReadingEntry: vi.fn(),
    undoReadingRevision: vi.fn(),
    moveReading: vi.fn(),
    deleteReading: vi.fn(),
  },
}));
vi.mock('./TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'test-user', name: 'test-user' },
    openPicker: vi.fn(),
    pickerOpen: false,
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
  }),
}));
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';

const KIDS = [{ id: 'learner_a', name: 'learner_a' }, { id: 'learner_b', name: 'learner_b' }];
const ok = (data) => ({ ok: true, status: 200, data });

const shelf = (over = {}) => ({
  learnerId: 'learner_a', studyDay: '2026-09-06', earliestFinishDay: '2026-08-23',
  items: [{
    itemId: 'rd_1', bookId: '9780000000001', progressMode: 'page', pageCount: 184,
    title: 'A Borrowed Title', subtitle: null, authors: ['Paulsen, Gary'], coverUrl: null,
    projection: { status: 'reading', page: 84, percent: 46, minutes: null, daysRead: 6, lastAt: '2026-09-03T18:00:00.000Z' },
  }],
  obligation: { label: '4 of 7 days', per: 'week', met: false, actual: 4, target: 7, metric: 'checkins', incompatibleBooks: [] },
  ...over,
});

const detail = () => ({
  learnerId: 'learner_a',
  reading: {
    id: 'rd_1', book: { isbn: '9780000000001', pageCount: 184 }, isbn: '9780000000001',
    progressMode: 'page', status: 'reading', finishedOn: null, openedOn: '2026-09-01',
    title: 'A Borrowed Title', authors: ['Paulsen, Gary'], coverUrl: null,
    entries: [{ id: 'e_1', on: '2026-09-03', at: '2026-09-03T18:00:00.000Z', page: 84, minutes: null, source: 'child' }],
    revisions: [],
    projection: { status: 'reading', page: 84, percent: 46, minutes: null, daysRead: 1, lastAt: '2026-09-03T18:00:00.000Z' },
    baseRevisionCount: 0,
  },
});

const mount = () => render(<ReadingView learnerId="learner_a" learnerName="learner_a" kids={KIDS} />);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/school/teacher/students/learner_a/reading');
  teacherWorkspaceApi.readingDetail.mockResolvedValue(ok(detail()));
});

describe('opening a reading from the shelf', () => {
  it('opens the detail and writes it into the URL, so the link is complete state', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Open A Borrowed Title/ }));
    await waitFor(() => expect(teacherWorkspaceApi.readingDetail).toHaveBeenCalledWith('learner_a', 'rd_1'));
    expect(window.location.search).toBe('?reading=rd_1');
    expect(await screen.findByRole('heading', { name: 'Identity', level: 3 })).toBeTruthy();
  });

  it('a deep link opens the reading without a tap', async () => {
    window.history.replaceState({}, '', '/school/teacher/students/learner_a/reading?reading=rd_1');
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    mount();
    await waitFor(() => expect(teacherWorkspaceApi.readingDetail).toHaveBeenCalledWith('learner_a', 'rd_1'));
  });

  it('closing it takes the reading back out of the URL', async () => {
    window.history.replaceState({}, '', '/school/teacher/students/learner_a/reading?reading=rd_1');
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('heading', { name: 'Identity', level: 3 })).toBeNull();
  });

  it('hands the detail the counted window the obligation is measured over', async () => {
    window.history.replaceState({}, '', '/school/teacher/students/learner_a/reading?reading=rd_1');
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf()));
    mount();
    // A weekly obligation on Sep 6 counts back to Aug 31, so re-dating this
    // day to Aug 1 leaves the window and the child has to be told.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sep 3' }));
    fireEvent.change(screen.getByLabelText('Day they read'), { target: { value: '2026-08-01' } });
    expect(await screen.findByText(/takes it off learner_a’s total/)).toBeTruthy();
  });
});

describe('a shelf that cannot be read', () => {
  it('names the error and offers NOTHING that could change the record', async () => {
    teacherWorkspaceApi.readingShelf.mockResolvedValue({
      ok: false, status: 500, data: { error: 'The reading file for this child could not be opened.' },
    });
    mount();
    expect(await screen.findByText(/could not be opened/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('a deep-linked reading does not walk around the lockout', async () => {
    window.history.replaceState({}, '', '/school/teacher/students/learner_a/reading?reading=rd_1');
    teacherWorkspaceApi.readingShelf.mockResolvedValue({ ok: false, status: 500, data: null });
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
    expect(teacherWorkspaceApi.readingDetail).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Danger', level: 3 })).toBeNull();
  });

  it('an empty shelf offers no detail either — there is no reading to correct', async () => {
    window.history.replaceState({}, '', '/school/teacher/students/learner_a/reading?reading=rd_1');
    teacherWorkspaceApi.readingShelf.mockResolvedValue(ok(shelf({ items: [], obligation: null })));
    mount();
    expect(await screen.findByText('No books yet.')).toBeTruthy();
    expect(teacherWorkspaceApi.readingDetail).not.toHaveBeenCalled();
  });
});
