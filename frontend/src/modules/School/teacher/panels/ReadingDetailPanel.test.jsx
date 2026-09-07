/**
 * The reading detail — the console a grown-up corrects a child's reading
 * record from (teacher reading admin design §2, §3, §4, §6).
 *
 * The tests that carry this file are not the happy paths. They are:
 *  - the five verbs that make a child's record smaller cannot submit without
 *    a reason, because that reason is the sentence the child reads;
 *  - a stale save is shown and never merged or retried;
 *  - the two structural verbs arm before they act;
 *  - an undo the server would refuse renders the refusal instead of a button.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReadingDetailPanel from './ReadingDetailPanel.jsx';

vi.mock('../teacherWorkspaceApi.js', () => ({
  teacherWorkspaceApi: {
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
vi.mock('../../schoolApi.js', () => ({
  schoolApi: { books: { resolve: vi.fn() } },
}));

// The real context mints a grant ONLY for a step-up action; an ordinary write
// authorizes on the capability cookie and gets no token. A mock that always
// handed one back would make "the undo of a plain correction asks for no
// step-up" unfalsifiable.
const grantFor = async ({ action = null } = {}) => ({ ok: true, grantToken: action ? 'grant_1' : null });
const requestAuthorization = vi.fn(grantFor);
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'test-user', name: 'test-user' },
    openPicker: vi.fn(),
    pickerOpen: false,
    requestAuthorization: (...args) => requestAuthorization(...args),
    invalidateAuthorization: vi.fn(),
  }),
}));

import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import { schoolApi } from '../../schoolApi.js';

const KIDS = [
  { id: 'learner_a', name: 'learner_a' },
  { id: 'learner_b', name: 'learner_b' },
];
// What the SERVER answers with the reading. The console holds no second
// derivation of it, so a test that wants a different window says so here.
const WINDOW = { state: 'window', per: 'week', from: '2026-08-31', to: '2026-09-06' };
const ok = (data) => ({ ok: true, status: 200, data });

const reading = (over = {}) => ({
  id: 'rd_1',
  book: { isbn: '9780000000001', pageCount: 184 },
  isbn: '9780000000001',
  progressMode: 'page',
  status: 'reading',
  finishedOn: null,
  openedOn: '2026-09-01',
  title: 'A Borrowed Title',
  subtitle: null,
  authors: ['Paulsen, Gary'],
  coverUrl: null,
  entries: [
    { id: 'e_1', on: '2026-09-01', at: '2026-09-01T18:00:00.000Z', page: 12, minutes: null, source: 'child' },
    { id: 'e_2', on: '2026-09-03', at: '2026-09-03T18:00:00.000Z', page: 84, minutes: null, source: 'child' },
  ],
  revisions: [
    {
      id: 'rev_1', by: 'test-user', at: '2026-09-06T17:02:00.000Z',
      verb: 'reading.update', op: 'reading.update',
      before: { pageCount: 180 }, after: { pageCount: 184 },
      reason: 'the cover said 184', toldChild: false,
    },
  ],
  projection: { status: 'reading', page: 84, percent: 46, minutes: null, daysRead: 2, lastAt: '2026-09-03T18:00:00.000Z' },
  baseRevisionCount: 1,
  ...over,
});

const seed = (over = {}, countedWindow = WINDOW) => {
  teacherWorkspaceApi.readingDetail.mockResolvedValue(
    ok({ learnerId: 'learner_a', countedWindow, reading: reading(over) }),
  );
};

const mount = (props = {}) => render(
  <ReadingDetailPanel
    learnerId="learner_a"
    learnerName="learner_a"
    readingId="rd_1"
    kids={KIDS}
    onClose={props.onClose ?? vi.fn()}
    onChanged={props.onChanged ?? vi.fn()}
  />,
);

const band = (name) => screen.getByRole('heading', { name, level: 3 }).closest('section');

beforeEach(() => {
  vi.clearAllMocks();
  requestAuthorization.mockImplementation(grantFor);
  Object.values(teacherWorkspaceApi).forEach((fn) => fn.mockResolvedValue?.(ok({})));
  teacherWorkspaceApi.updateReading.mockResolvedValue(ok({ revision: { id: 'rev_2' } }));
  teacherWorkspaceApi.addReadingEntry.mockResolvedValue({ ok: true, status: 201, data: { revision: { id: 'rev_2' } } });
  teacherWorkspaceApi.updateReadingEntry.mockResolvedValue(ok({ revision: { id: 'rev_2' } }));
  teacherWorkspaceApi.deleteReadingEntry.mockResolvedValue(ok({ revision: { id: 'rev_2' } }));
  teacherWorkspaceApi.undoReadingRevision.mockResolvedValue(ok({ revision: { id: 'rev_2' } }));
  teacherWorkspaceApi.moveReading.mockResolvedValue(ok({ revision: { id: 'rev_2' } }));
  teacherWorkspaceApi.deleteReading.mockResolvedValue(ok({ revision: { id: 'rev_2' } }));
  schoolApi.books.resolve.mockResolvedValue(ok({ status: 'ok', book: { title: 'A Different Title', authors: ['Clements, Andrew'] } }));
});

describe('the four bands, in the order the design puts them', () => {
  it('draws identity, evidence, state and danger — most used first, most consequential last', async () => {
    seed();
    mount();
    await screen.findByRole('heading', { name: 'Identity', level: 3 });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual(['Identity', 'What was read', 'State', 'Danger', 'History']);
  });

  it('names the book, its ISBN, its length and its mode', async () => {
    seed();
    mount();
    expect(await screen.findByDisplayValue('9780000000001')).toBeTruthy();
    expect(screen.getByDisplayValue('184')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'page' }).checked).toBe(true);
  });
});

describe('identity — the silent corrections', () => {
  it('re-looks-up an ISBN without touching the record', async () => {
    seed();
    mount();
    const isbn = await screen.findByLabelText('ISBN');
    fireEvent.change(isbn, { target: { value: '9780000000002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Re-look-up' }));
    expect(await screen.findByText(/A Different Title/)).toBeTruthy();
    expect(schoolApi.books.resolve).toHaveBeenCalledWith('9780000000002');
    // A read is a read: nothing was saved by looking.
    expect(teacherWorkspaceApi.updateReading).not.toHaveBeenCalled();
  });

  it('saves the ISBN, the mode and the page count, with the count it loaded', async () => {
    seed();
    mount();
    fireEvent.change(await screen.findByLabelText('ISBN'), { target: { value: '9780000000002' } });
    fireEvent.click(screen.getByRole('radio', { name: 'minutes' }));
    fireEvent.change(screen.getByLabelText('Page count'), { target: { value: '200' } });
    fireEvent.click(within(band('Identity')).getByRole('button', { name: 'Save the book' }));
    await waitFor(() => expect(teacherWorkspaceApi.updateReading).toHaveBeenCalled());
    expect(teacherWorkspaceApi.updateReading).toHaveBeenCalledWith('learner_a', 'rd_1', expect.objectContaining({
      isbn: '9780000000002', progressMode: 'minutes', pageCount: 200, baseRevisionCount: 1,
    }));
  });

  it('refuses to save a page count that is not a number of pages, rather than silently clearing it', async () => {
    seed();
    mount();
    fireEvent.change(await screen.findByLabelText('Page count'), { target: { value: 'about 200' } });
    expect(within(band('Identity')).getByRole('button', { name: 'Save the book' }).disabled).toBe(true);
    expect(screen.getByText(/whole number of pages/)).toBeTruthy();
  });

  it('an identity correction needs no reason — nothing about it reaches the child', async () => {
    seed();
    mount();
    fireEvent.change(await screen.findByLabelText('Page count'), { target: { value: '200' } });
    const save = within(band('Identity')).getByRole('button', { name: 'Save the book' });
    expect(save.disabled).toBe(false);
  });
});

describe('what was read — one row per day of evidence', () => {
  it('lists the days newest first, with what each one recorded', async () => {
    seed();
    mount();
    await screen.findByRole('heading', { name: 'What was read', level: 3 });
    const rows = within(band('What was read')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/Sep 3/);
    expect(rows[0].textContent).toMatch(/page 84/);
    expect(rows[1].textContent).toMatch(/Sep 1/);
  });

  it('adds a day they read', async () => {
    seed();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a day they read' }));
    fireEvent.change(screen.getByLabelText('Day they read'), { target: { value: '2026-09-04' } });
    fireEvent.change(screen.getByLabelText('Page reached'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this day' }));
    await waitFor(() => expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalled());
    expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalledWith('learner_a', 'rd_1', expect.objectContaining({
      on: '2026-09-04', page: 120, baseRevisionCount: 1,
    }), expect.any(String));
  });

  it('will not save an edit that changes nothing', async () => {
    seed();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sep 3' }));
    expect(screen.getByRole('button', { name: 'Save this day' }).disabled).toBe(true);
  });

  it('writes evidence against the mode the record is STORED with, not an unsaved radio', async () => {
    seed();
    mount();
    // The radio moves to minutes but nothing is saved; the day added below is
    // still a page-mode day, because that is what the record says it is.
    fireEvent.click(await screen.findByRole('radio', { name: 'minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a day they read' }));
    expect(screen.getByLabelText('Page reached')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Day they read'), { target: { value: '2026-09-04' } });
    fireEvent.change(screen.getByLabelText('Page reached'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this day' }));
    await waitFor(() => expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalled());
    expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalledWith('learner_a', 'rd_1', expect.objectContaining({
      page: 120, minutes: null,
    }), expect.any(String));
  });

  it('corrects a page without asking for a reason', async () => {
    seed();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sep 3' }));
    fireEvent.change(screen.getByLabelText('Page reached'), { target: { value: '88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this day' }));
    await waitFor(() => expect(teacherWorkspaceApi.updateReadingEntry).toHaveBeenCalled());
    expect(teacherWorkspaceApi.updateReadingEntry).toHaveBeenCalledWith('learner_a', 'rd_1', 'e_2', expect.objectContaining({
      page: 88, baseRevisionCount: 1,
    }));
  });
});

describe('the five verbs that make a child’s record smaller', () => {
  it('will not delete a day of evidence without a reason, and says who reads it', async () => {
    seed();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Sep 3' }));
    const confirm = screen.getByRole('button', { name: 'Remove this day' });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/makes learner_a’s record smaller/)).toBeTruthy();
    expect(screen.getByText(/sent to them/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason for removing this day'), { target: { value: 'logged on the wrong book' } });
    expect(screen.getByRole('button', { name: 'Remove this day' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this day' }));
    await waitFor(() => expect(teacherWorkspaceApi.deleteReadingEntry).toHaveBeenCalled());
    expect(teacherWorkspaceApi.deleteReadingEntry).toHaveBeenCalledWith('learner_a', 'rd_1', 'e_2', expect.objectContaining({
      reason: 'logged on the wrong book', baseRevisionCount: 1,
    }));
  });

  it('will not un-finish a book without a reason', async () => {
    seed({ status: 'finished', finishedOn: '2026-09-05' });
    mount();
    await screen.findByRole('radio', { name: 'Finished' });
    fireEvent.click(screen.getByRole('radio', { name: 'Reading' }));
    const save = within(band('State')).getByRole('button', { name: 'Save the state' });
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/stop counting as finished/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason for the state change'), { target: { value: 'they were not done' } });
    fireEvent.click(within(band('State')).getByRole('button', { name: 'Save the state' }));
    await waitFor(() => expect(teacherWorkspaceApi.updateReading).toHaveBeenCalled());
    expect(teacherWorkspaceApi.updateReading).toHaveBeenCalledWith('learner_a', 'rd_1', expect.objectContaining({
      status: 'reading', reason: 'they were not done',
    }));
  });

  it('will not re-date a day OUT of the counted window without a reason', async () => {
    seed();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sep 3' }));
    fireEvent.change(screen.getByLabelText('Day they read'), { target: { value: '2026-08-01' } });
    expect(screen.getByRole('button', { name: 'Save this day' }).disabled).toBe(true);
    expect(screen.getByText(/takes it off learner_a’s total/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason for correcting this day'), { target: { value: 'they read it in August' } });
    expect(screen.getByRole('button', { name: 'Save this day' }).disabled).toBe(false);
  });

  it('a re-date INSIDE the counted window is silent and needs nothing', async () => {
    seed();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sep 3' }));
    fireEvent.change(screen.getByLabelText('Day they read'), { target: { value: '2026-09-02' } });
    expect(screen.getByRole('button', { name: 'Save this day' }).disabled).toBe(false);
    expect(screen.queryByText(/takes it off/)).toBeNull();
  });

  it('an obligation the server could not read says so, rather than pre-requiring nothing in silence', async () => {
    // The failure the served window exists to make visible: with no window,
    // the console cannot judge the re-date, and the old client-side mirror
    // simply stopped asking — with nothing on screen to say why.
    seed({}, { state: 'unknown', per: null, from: null, to: null });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sep 3' }));
    fireEvent.change(screen.getByLabelText('Day they read'), { target: { value: '2026-08-01' } });
    expect(screen.getByText(/counted window couldn’t be read/)).toBeTruthy();
    // The decision itself is unchanged: the server is still the one that refuses.
    expect(screen.getByRole('button', { name: 'Save this day' }).disabled).toBe(false);
  });

  it('a child who owes no reading has no window and no note — that is a settled answer', async () => {
    seed({}, { state: 'none', per: null, from: null, to: null });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sep 3' }));
    fireEvent.change(screen.getByLabelText('Day they read'), { target: { value: '2026-08-01' } });
    expect(screen.queryByText(/counted window couldn’t be read/)).toBeNull();
    expect(screen.queryByText(/takes it off/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save this day' }).disabled).toBe(false);
  });

  it('will not move the reading to a sibling without a reason', async () => {
    seed();
    mount();
    fireEvent.change(await screen.findByLabelText('Move to'), { target: { value: 'learner_b' } });
    expect(screen.getByRole('button', { name: 'Move to another child' }).disabled).toBe(true);
    expect(screen.getByText(/leave learner_a’s shelf for learner_b’s/)).toBeTruthy();
    expect(screen.getByText(/both children/)).toBeTruthy();
  });

  it('will not delete the reading without a reason', async () => {
    seed();
    mount();
    await screen.findByRole('heading', { name: 'Danger', level: 3 });
    expect(screen.getByRole('button', { name: 'Delete this reading' }).disabled).toBe(true);
    expect(screen.getByText(/everything logged against it will be destroyed/)).toBeTruthy();
  });
});

describe('the two structural verbs arm before they act', () => {
  it('a move names the consequence, then moves — with the step-up grant', async () => {
    const onClose = vi.fn();
    const onChanged = vi.fn();
    seed();
    mount({ onClose, onChanged });
    fireEvent.change(await screen.findByLabelText('Move to'), { target: { value: 'learner_b' } });
    fireEvent.change(screen.getByLabelText('Reason for moving this reading'), { target: { value: 'learner_b read it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move to another child' }));
    // The first tap only arms: nothing has moved yet.
    expect(teacherWorkspaceApi.moveReading).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/learner_b/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm the move' }));
    await waitFor(() => expect(teacherWorkspaceApi.moveReading).toHaveBeenCalled());
    expect(requestAuthorization).toHaveBeenCalledWith({ action: 'books.reading.reassign', resource: 'rd_1' });
    expect(teacherWorkspaceApi.moveReading).toHaveBeenCalledWith('learner_a', 'rd_1', expect.objectContaining({
      toLearnerId: 'learner_b', reason: 'learner_b read it', baseRevisionCount: 1,
    }), 'grant_1');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it('a delete names the consequence, then deletes — with its own step-up grant', async () => {
    const onClose = vi.fn();
    seed();
    mount({ onClose });
    fireEvent.change(await screen.findByLabelText('Reason for deleting this reading'), { target: { value: 'it was never read' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete this reading' }));
    expect(teacherWorkspaceApi.deleteReading).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/cannot be undone/i);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm the deletion' }));
    await waitFor(() => expect(teacherWorkspaceApi.deleteReading).toHaveBeenCalled());
    expect(requestAuthorization).toHaveBeenCalledWith({ action: 'books.reading.delete', resource: 'rd_1' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('cancelling an armed delete leaves the record alone', async () => {
    seed();
    mount();
    fireEvent.change(await screen.findByLabelText('Reason for deleting this reading'), { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete this reading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm the deletion' })).toBeNull();
    expect(teacherWorkspaceApi.deleteReading).not.toHaveBeenCalled();
  });
});

describe('a stale save is refused, never merged', () => {
  it('shows the server’s reload sentence, stops every write, and retries nothing', async () => {
    seed();
    teacherWorkspaceApi.updateReading.mockResolvedValue({
      ok: false, status: 409,
      data: { error: 'This reading changed since you loaded it — reload and try again.' },
    });
    mount();
    fireEvent.change(await screen.findByLabelText('Page count'), { target: { value: '200' } });
    fireEvent.click(within(band('Identity')).getByRole('button', { name: 'Save the book' }));
    expect(await screen.findByText(/reload and try again/)).toBeTruthy();
    // One attempt. A stale save is never replayed with a fresher count.
    expect(teacherWorkspaceApi.updateReading).toHaveBeenCalledTimes(1);
    // And nothing else can be written until the grown-up reloads.
    expect(within(band('Identity')).getByRole('button', { name: 'Save the book' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Reload this reading' })).toBeTruthy();
  });
});

describe('history — every revision, and the undos that are honest', () => {
  it('lists revisions newest first with who, when, what moved, why, and whether the child was told', async () => {
    seed({
      revisions: [
        {
          id: 'rev_1', by: 'test-user', at: '2026-09-05T17:02:00.000Z',
          verb: 'reading.update', op: 'reading.update',
          before: { pageCount: 180 }, after: { pageCount: 184 }, reason: 'the cover said 184', toldChild: false,
        },
        {
          id: 'rev_2', by: 'test-user', at: '2026-09-06T17:02:00.000Z',
          verb: 'reading.entry.delete', op: 'reading.entry.delete',
          before: { id: 'e_9', on: '2026-09-04', page: 90 }, after: null,
          reason: 'logged twice', toldChild: true,
        },
      ],
      baseRevisionCount: 2,
    });
    mount();
    await screen.findByRole('heading', { name: 'History', level: 3 });
    const rows = within(band('History')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/removed a day/);
    expect(rows[0].textContent).toMatch(/logged twice/);
    expect(rows[0].textContent).toMatch(/told/i);
    expect(rows[1].textContent).toMatch(/page count/);
    expect(rows[1].textContent).toMatch(/180/);
    expect(rows[1].textContent).toMatch(/184/);
  });

  it('undoes a correction that shrinks nothing, sending the loaded count', async () => {
    seed();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Undo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm the undo' }));
    await waitFor(() => expect(teacherWorkspaceApi.undoReadingRevision).toHaveBeenCalled());
    expect(teacherWorkspaceApi.undoReadingRevision).toHaveBeenCalledWith('learner_a', 'rd_1', expect.objectContaining({
      revisionId: 'rev_1', baseRevisionCount: 1,
    }), null);
  });

  it('an undo that would delete a day asks for its reason too', async () => {
    seed({
      revisions: [{
        id: 'rev_1', by: 'test-user', at: '2026-09-06T17:02:00.000Z',
        verb: 'reading.entry.add', op: 'reading.entry.add',
        before: null, after: { id: 'e_3', on: '2026-09-04', page: 100 }, reason: null, toldChild: false,
      }],
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Undo/ }));
    expect(screen.getByRole('button', { name: 'Confirm the undo' }).disabled).toBe(true);
    expect(screen.getByText(/record smaller/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason for this undo'), { target: { value: 'I added it to the wrong book' } });
    expect(screen.getByRole('button', { name: 'Confirm the undo' }).disabled).toBe(false);
  });

  it('renders the server’s refusal in place of a button that would fail', async () => {
    seed({
      entries: [{ id: 'e_9', on: '2026-09-05', at: '2026-09-05T10:00:00.000Z', page: 90, minutes: null, source: 'child' }],
      revisions: [{
        id: 'rev_1', by: 'test-user', at: '2026-09-04T10:00:00.000Z',
        verb: 'reading.move', op: 'reading.move',
        before: { learnerId: 'learner_b' }, after: { learnerId: 'learner_a' }, reason: 'mis-scanned', toldChild: true,
        canUndo: false,
        undoRefusal: 'A Borrowed Title has been read since it moved — undoing would delete that reading. Move it back instead, which keeps the days.',
      }],
    });
    mount();
    expect(await screen.findByText(/has been read since it moved/)).toBeTruthy();
    expect(screen.getByText(/Move it back instead/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
  });

  it('renders whatever sentence the server sent, WORD FOR WORD — it holds no copy of them', async () => {
    // The drift this exists to catch: reword a refusal server-side and the
    // console must follow without being edited. A sentence no client rule
    // could have produced proves it is reading, not deriving.
    seed({
      revisions: [{
        id: 'rev_1', by: 'test-user', at: '2026-09-06T17:02:00.000Z',
        verb: 'reading.update', op: 'reading.update',
        before: { pageCount: 180 }, after: { pageCount: 184 }, reason: null, toldChild: false,
        canUndo: false, undoRefusal: 'That one is spoken for, and the server said so.',
      }],
    });
    mount();
    expect(await screen.findByText('That one is spoken for, and the server said so.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
  });

  it('an already-undone revision says so instead of offering a second undo', async () => {
    seed({
      revisions: [
        {
          id: 'rev_1', by: 'test-user', at: '2026-09-05T10:00:00.000Z',
          verb: 'reading.update', op: 'reading.update',
          before: { pageCount: 180 }, after: { pageCount: 184 }, reason: null, toldChild: false,
          canUndo: false, undoRefusal: 'That change has already been undone — undo the undo instead.',
        },
        {
          id: 'rev_2', by: 'test-user', at: '2026-09-06T10:00:00.000Z',
          verb: 'reading.undo', op: 'reading.update', undoes: 'rev_1', undoneVerb: 'reading.update',
          before: { pageCount: 184 }, after: { pageCount: 180 }, reason: null, toldChild: false,
          canUndo: true, undoRefusal: null,
        },
      ],
      baseRevisionCount: 2,
    });
    mount();
    expect(await screen.findByText(/already been undone/)).toBeTruthy();
    // The undo of the undo is still offered — that is the way back.
    expect(screen.getAllByRole('button', { name: /^Undo/ })).toHaveLength(1);
  });

  it('an opening cannot be undone, and the sentence names the verb that can', async () => {
    seed({
      revisions: [{
        id: 'rev_1', by: 'test-user', at: '2026-09-01T10:00:00.000Z',
        verb: 'reading.add', op: 'reading.add',
        before: null, after: { id: 'rd_1', isbn: '9780000000001' }, reason: null, toldChild: false,
        canUndo: false,
        undoRefusal: 'Undoing the opening of a reading would destroy it and its whole history. Delete the reading instead, which says what it is.',
      }],
    });
    mount();
    expect(await screen.findByText(/Delete the reading instead/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
  });
});

describe('when the reading itself cannot be read', () => {
  it('is a named error with the server’s own sentence and no edit controls', async () => {
    teacherWorkspaceApi.readingDetail.mockResolvedValue({
      ok: false, status: 403, data: { error: 'Only a listed teacher can do this.' },
    });
    mount();
    expect(await screen.findByText(/Only a listed teacher can do this\./)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Danger', level: 3 })).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('a body that is not a reading is an error, never an empty detail', async () => {
    teacherWorkspaceApi.readingDetail.mockResolvedValue(ok({ learnerId: 'learner_a' }));
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Identity', level: 3 })).toBeNull();
  });
});
