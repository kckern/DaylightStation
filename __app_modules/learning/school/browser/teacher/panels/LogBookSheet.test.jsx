import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scanner = vi.hoisted(() => ({ args: null, cameraState: 'live' }));
vi.mock("../../../../../../frontend/src/lib/camera/useBarcodeScanner.js", () => ({
  useBarcodeScanner: (args) => { scanner.args = args; return { cameraState: scanner.cameraState, stop: vi.fn() }; },
}));
vi.mock("../teacherWorkspaceApi.js", () => ({
  teacherWorkspaceApi: {
    bookReaders: vi.fn(), addReadingForLearner: vi.fn(), addReadingEntry: vi.fn(), updateReading: vi.fn(),
  },
}));
vi.mock("../../schoolApi.js", () => ({ schoolApi: { books: { resolve: vi.fn() } } }));
const profile = vi.hoisted(() => ({
  currentTeacher: { id: 'test-user', name: 'test-user' },
  authorization: { active: true },
  openPicker: () => {},
  openPinPrompt: () => {},
  pickerOpen: false,
  requestAuthorization: async () => ({ ok: true, grantToken: null }),
  invalidateAuthorization: () => {},
}));
vi.mock("../TeacherProfileContext.jsx", () => ({ useTeacherProfile: () => profile }));

import LogBookSheet from "./LogBookSheet.jsx";
import { teacherWorkspaceApi } from "../teacherWorkspaceApi.js";
import { schoolApi } from "../../schoolApi.js";

const ISBN = '9780000000002';
const DAY = '2026-09-06';
const ok = (data, status = 200) => ({ ok: true, status, data });
const fail = (error, status = 500) => ({ ok: false, status, data: { error } });
const LOST = { ok: false, status: 0, data: null };
const row = (learnerId, name, over = {}) => ({
  learnerId, name, suggestedMode: 'check', today: false, openReadingId: null, openReading: null,
  finishedTodayIds: [], unreadable: false, ...over,
});
const openRow = (revisionCount = 2, over = {}) => row('learner_b', 'Learner B', {
  openReadingId: 'rdg_b', openReading: { id: 'rdg_b', progressMode: 'check', pageCount: 32, revisionCount }, ...over,
});
const view = (readers) => ({ isbn: ISBN, studyDay: DAY, pageCount: 32, suggestedMode: 'check', readers });
const READERS = view([
  row('learner_a', 'Learner A', { today: true }),
  openRow(),
  row('learner_c', 'Learner C'),
]);

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const scan = async (value = ISBN) => {
  await act(async () => { scanner.args.onDecode(value); });
};
const face = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const summary = () => screen.getByRole('status').textContent;
const sheet = () => <LogBookSheet open onClose={vi.fn()} />;

beforeEach(() => {
  vi.clearAllMocks();
  scanner.args = null;
  scanner.cameraState = 'live';
  profile.currentTeacher = { id: 'test-user', name: 'test-user' };
  profile.authorization = { active: true };
  profile.openPinPrompt = vi.fn(async () => ({ ok: true }));
  profile.openPicker = vi.fn();
  profile.requestAuthorization = vi.fn(async () => ({ ok: true, grantToken: null }));
  profile.invalidateAuthorization = vi.fn();
  schoolApi.books.resolve.mockResolvedValue(ok({ status: 'ok', book: { isbn13: ISBN, title: 'A Borrowed Title', authors: ['Someone'], pageCount: 32, coverUrl: null } }));
  teacherWorkspaceApi.bookReaders.mockResolvedValue(ok(READERS));
  teacherWorkspaceApi.addReadingForLearner.mockResolvedValue(ok({ reading: { id: 'rdg_new' }, created: true }, 201));
  teacherWorkspaceApi.addReadingEntry.mockResolvedValue(ok({ revision: { id: 'rev_3' }, revisionCount: 3 }, 201));
  teacherWorkspaceApi.updateReading.mockResolvedValue(ok({ revision: { id: 'rev_4' } }));
});

describe('LogBookSheet — scan', () => {
  it('opens on the camera, with "Type the number" always offered', () => {
    render(sheet());
    expect(screen.getByRole('dialog', { name: 'Log a book' })).toBeTruthy();
    expect(scanner.args.active).toBe(true);
    expect(screen.getByRole('button', { name: 'Type the number' })).toBeTruthy();
  });

  it('renders nothing and runs no camera while closed', () => {
    render(<LogBookSheet open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(scanner.args).toBeNull();
  });

  it('falls back to typing when the camera is denied', () => {
    scanner.cameraState = 'denied';
    render(sheet());
    expect(screen.getByText(/camera isn’t available/i)).toBeTruthy();
    expect(screen.getByLabelText('ISBN')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Type the number' })).toBeNull();
  });

  it('takes a typed number only when it is a book number', async () => {
    render(sheet());
    fireEvent.click(screen.getByRole('button', { name: 'Type the number' }));
    expect(scanner.args.active).toBe(false);
    const input = screen.getByLabelText('ISBN');
    fireEvent.change(input, { target: { value: '9780000000003' } });
    expect(screen.getByText(/one digit is off/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this number' }).disabled).toBe(true);
    fireEvent.change(input, { target: { value: ISBN } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this number' }));
    expect(await screen.findByText('A Borrowed Title', { selector: 'strong' })).toBeTruthy();
  });

  it('a scanned code that is not an ISBN says so and scans again', async () => {
    render(sheet());
    const before = scanner.args.restartKey;
    await scan('012345678905');
    expect(screen.getByRole('alert').textContent).toMatch(/not a book number/i);
    expect(scanner.args.restartKey).not.toBe(before);
    expect(schoolApi.books.resolve).not.toHaveBeenCalled();
  });
});

describe('LogBookSheet — a real dialog', () => {
  it('focus lands inside on open and goes back where it was on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(sheet());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    rerender(<LogBookSheet open={false} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Escape closes it', () => {
    const onClose = vi.fn();
    render(<LogBookSheet open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab wraps inside the sheet', () => {
    render(sheet());
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Type the number' });
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe('LogBookSheet — the book and the readers', () => {
  it('looks the book up, then asks who has it', async () => {
    render(sheet());
    await scan();
    expect(await screen.findByText('A Borrowed Title', { selector: 'strong' })).toBeTruthy();
    await screen.findByRole('button', { name: /^Learner A/ });
    expect(schoolApi.books.resolve).toHaveBeenCalledWith(ISBN);
    expect(teacherWorkspaceApi.bookReaders).toHaveBeenCalledWith(ISBN);
    // Sequential: the readers view reads the length the lookup cached.
    expect(schoolApi.books.resolve.mock.invocationCallOrder[0])
      .toBeLessThan(teacherWorkspaceApi.bookReaders.mock.invocationCallOrder[0]);
  });

  it('a failed lookup shows the number and the flow carries on', async () => {
    schoolApi.books.resolve.mockResolvedValue({ ok: false, status: 404, data: { status: 'not-found' } });
    render(sheet());
    await scan();
    expect(await screen.findByRole('button', { name: /^Learner C/ })).toBeTruthy();
    expect(screen.getByText(`ISBN ${ISBN}`)).toBeTruthy();
    expect(screen.getByText(/We couldn’t find a book with that number\. You can still log it/)).toBeTruthy();
  });

  it('every face carries the server’s badges, named for a screen reader, and none is preselected', async () => {
    render(sheet());
    await scan();
    await screen.findByRole('button', { name: /^Learner A/ });
    expect(within(face('Learner A')).getByText('Logged today')).toBeTruthy();
    expect(within(face('Learner B')).getByText('Reading now')).toBeTruthy();
    expect(face('Learner A').getAttribute('aria-label')).toBe('Learner A, logged today');
    expect(face('Learner B').getAttribute('aria-label')).toBe('Learner B, reading now');
    expect(face('Learner C').getAttribute('aria-label')).toBe('Learner C');
    for (const name of ['Learner A', 'Learner B', 'Learner C']) expect(face(name).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('a child whose shelf could not be read cannot be chosen, and the face says why', async () => {
    teacherWorkspaceApi.bookReaders.mockResolvedValue(ok(view([
      row('learner_a', 'Learner A', { unreadable: true }), row('learner_c', 'Learner C'),
    ])));
    render(sheet());
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    expect(face('Learner A').disabled).toBe(true);
    expect(screen.getAllByText(/unreadable/i)).toHaveLength(1);
    expect(face('Learner A').getAttribute('aria-label')).toBe('Learner A, shelf unreadable');
  });

  it('warns when a child who logged it today is chosen, but allows it', async () => {
    render(sheet());
    await scan();
    fireEvent.click(await screen.findByRole('button', { name: /^Learner A/ }));
    expect(face('Learner A').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Already logged today/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);
  });

  it('defaults to Finished today and the server’s tracking; Partway only in page mode', async () => {
    render(sheet());
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    expect(screen.getByRole('button', { name: 'Finished today' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Started today' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Check-ins' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Partway' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Partway' })).toBeTruthy();
  });

  it('takes the server’s page-mode suggestion for a long book', async () => {
    teacherWorkspaceApi.bookReaders.mockResolvedValue(ok({ ...view([row('learner_c', 'Learner C')]), pageCount: 200, suggestedMode: 'page' }));
    render(sheet());
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Partway' })).toBeTruthy();
  });

  it('a locked console says so and unlocks; the unlock itself reads the readers again, once', async () => {
    profile.authorization = { active: false };
    teacherWorkspaceApi.bookReaders.mockResolvedValueOnce({ ok: false, status: 403, data: { error: 'The teacher PIN is missing or wrong.' } });
    const { rerender } = render(sheet());
    await scan();
    expect(await screen.findByText(/locked/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(profile.openPinPrompt).toHaveBeenCalled();
    await act(async () => {});
    expect(teacherWorkspaceApi.bookReaders).toHaveBeenCalledTimes(1);
    profile.authorization = { active: true };
    rerender(sheet());
    expect(await screen.findByRole('button', { name: /^Learner C/ })).toBeTruthy();
    expect(teacherWorkspaceApi.bookReaders).toHaveBeenCalledTimes(2);
  });

  it('a locked console with no teacher chosen asks who is here first', async () => {
    profile.currentTeacher = null;
    teacherWorkspaceApi.bookReaders.mockResolvedValue({ ok: false, status: 403, data: {} });
    render(sheet());
    await scan();
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }));
    expect(profile.openPicker).toHaveBeenCalled();
    expect(profile.openPinPrompt).not.toHaveBeenCalled();
  });
});

describe('LogBookSheet — save', () => {
  const ready = async (...names) => {
    const utils = render(sheet());
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    for (const name of names) fireEvent.click(face(name));
    return utils;
  };
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  it('opens a finished reading for a child with none, sending no day', async () => {
    await ready('Learner C');
    save();
    await waitFor(() => expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalled());
    const [learnerId, body, key] = teacherWorkspaceApi.addReadingForLearner.mock.calls[0];
    expect(learnerId).toBe('learner_c');
    expect(body).toEqual({ isbn: ISBN, progressMode: 'check', where: 'finished', by: 'test-user' });
    expect(typeof key).toBe('string');
    await waitFor(() => expect(summary()).toBe('Learner C ✓ saved'));
    expect(face('Learner C').getAttribute('aria-label')).toBe('Learner C, saved');
  });

  it('started today opens a reading in the chosen mode', async () => {
    await ready('Learner C');
    fireEvent.click(screen.getByRole('button', { name: 'Started today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    save();
    await waitFor(() => expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalled());
    expect(teacherWorkspaceApi.addReadingForLearner.mock.calls[0][1])
      .toEqual({ isbn: ISBN, progressMode: 'page', where: 'starting', by: 'test-user' });
  });

  it('finishes an open reading ON that reading, and opens no new one', async () => {
    await ready('Learner B');
    save();
    await waitFor(() => expect(teacherWorkspaceApi.updateReading).toHaveBeenCalled());
    expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalledWith(
      'learner_b', 'rdg_b', { on: DAY, baseRevisionCount: 2 }, expect.stringMatching(/:entry$/),
    );
    expect(teacherWorkspaceApi.updateReading).toHaveBeenCalledWith(
      'learner_b', 'rdg_b', { status: 'finished', finishedOn: DAY, baseRevisionCount: 3 },
    );
    expect(teacherWorkspaceApi.addReadingForLearner).not.toHaveBeenCalled();
    await waitFor(() => expect(summary()).toMatch(/Learner B ✓/));
  });

  it('partway asks for the page and will not save without one', async () => {
    await ready('Learner C');
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Partway' }));
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Page they are on'), { target: { value: '40' } });
    save();
    await waitFor(() => expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalled());
    expect(teacherWorkspaceApi.addReadingForLearner.mock.calls[0][1])
      .toMatchObject({ progressMode: 'page', where: 'partway', page: 40 });
  });

  it('a double tap on Save sends one batch', async () => {
    await ready('Learner C');
    save();
    save();
    await waitFor(() => expect(summary()).toMatch(/Learner C ✓/));
    expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalledTimes(1);
  });

  it('offers "Log another book", which reopens the camera', async () => {
    await ready('Learner C');
    save();
    fireEvent.click(await screen.findByRole('button', { name: 'Log another book' }));
    expect(screen.getByRole('button', { name: 'Type the number' })).toBeTruthy();
    expect(scanner.args.active).toBe(true);
  });

  it('while a save is running, Close, Escape and Log another book wait for it', async () => {
    const pending = deferred();
    teacherWorkspaceApi.addReadingForLearner.mockImplementation((learnerId) => (learnerId === 'learner_c'
      ? pending.promise : Promise.resolve(ok({ created: true }, 201))));
    const onClose = vi.fn();
    render(<LogBookSheet open onClose={onClose} />);
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    fireEvent.click(face('Learner A'));
    fireEvent.click(face('Learner C'));
    save();
    await waitFor(() => expect(summary()).toMatch(/Learner A ✓/));
    expect(screen.getByRole('button', { name: 'Close' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Log another book' }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(ok({ created: true }, 201)); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' }).disabled).toBe(false));
  });

  it('a sheet closed mid-save stops that batch, and the next book starts clean', async () => {
    const pending = deferred();
    teacherWorkspaceApi.addReadingForLearner.mockImplementation((learnerId) => (learnerId === 'learner_a'
      ? pending.promise : Promise.resolve(ok({ created: true }, 201))));
    const { rerender } = await ready('Learner A', 'Learner C');
    save();
    await waitFor(() => expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalledTimes(1));
    rerender(<LogBookSheet open={false} onClose={vi.fn()} />);
    await act(async () => { pending.resolve(ok({ created: true }, 201)); });
    await act(async () => {});
    expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalledTimes(1);

    rerender(sheet());
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    expect(face('Learner A').disabled).toBe(false);
    expect(face('Learner A').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the last book’s write error does not follow the grown-up to the next book', async () => {
    profile.requestAuthorization = vi.fn(async () => ({ ok: false, message: 'That PIN is not right.' }));
    await ready('Learner C');
    save();
    expect(await screen.findByText('That PIN is not right.')).toBeTruthy();
    expect(summary()).toBe('Learner C – not sent');
    fireEvent.click(screen.getByRole('button', { name: 'Log another book' }));
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    expect(screen.queryByText('That PIN is not right.')).toBeNull();
  });
});

describe('LogBookSheet — partial failure and retry', () => {
  const ready = async (...names) => {
    render(sheet());
    await scan();
    await screen.findByRole('button', { name: /^Learner C/ });
    for (const name of names) fireEvent.click(face(name));
  };
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  it('a new reading that failed is resent alone, with the same request and key; the saved child is not resent', async () => {
    teacherWorkspaceApi.addReadingForLearner.mockImplementation(async (learnerId) => (learnerId === 'learner_a'
      ? fail('The shelf could not be written.')
      : ok({ created: true }, 201)));
    await ready('Learner A', 'Learner C');
    save();
    expect(await screen.findByText('The shelf could not be written.')).toBeTruthy();
    expect(summary()).toBe('Learner A ✗ didn’t save · Learner C ✓ saved');
    expect(face('Learner C').disabled).toBe(true);
    const [, firstBody, firstKey] = teacherWorkspaceApi.addReadingForLearner.mock.calls.find(([id]) => id === 'learner_a');

    teacherWorkspaceApi.addReadingForLearner.mockReset();
    teacherWorkspaceApi.addReadingForLearner.mockResolvedValue(ok({ created: true }, 201));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Learner A' }));
    await waitFor(() => expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalledTimes(1));
    expect(teacherWorkspaceApi.addReadingForLearner.mock.calls[0]).toEqual(['learner_a', firstBody, firstKey]);
    await waitFor(() => expect(summary()).toBe('Learner A ✓ saved · Learner C ✓ saved'));
  });

  it('Save again after a failure resends only the children not yet saved', async () => {
    teacherWorkspaceApi.addReadingForLearner.mockImplementation(async (learnerId) => (learnerId === 'learner_a'
      ? fail('The shelf could not be written.', 422)
      : ok({ created: true }, 201)));
    await ready('Learner A', 'Learner C');
    save();
    await waitFor(() => expect(summary()).toMatch(/Learner A ✗.* · Learner C ✓/));
    teacherWorkspaceApi.addReadingForLearner.mockReset();
    teacherWorkspaceApi.addReadingForLearner.mockResolvedValue(ok({ created: true }, 201));
    save();
    await waitFor(() => expect(summary()).toMatch(/Learner A ✓.* · Learner C ✓/));
    expect(teacherWorkspaceApi.addReadingForLearner.mock.calls.map(([id]) => id)).toEqual(['learner_a']);
  });

  it('a deselected child who failed stays in the summary with their Retry', async () => {
    teacherWorkspaceApi.addReadingForLearner.mockImplementation(async (learnerId) => (learnerId === 'learner_a'
      ? fail('The shelf could not be written.', 422)
      : ok({ created: true }, 201)));
    await ready('Learner A', 'Learner C');
    save();
    await waitFor(() => expect(summary()).toMatch(/Learner A ✗/));
    fireEvent.click(face('Learner A'));
    expect(face('Learner A').getAttribute('aria-pressed')).toBe('false');
    expect(summary()).toMatch(/Learner A ✗.* · Learner C ✓/);
    expect(screen.getByRole('button', { name: 'Retry Learner A' })).toBeTruthy();
  });

  it('a clear refusal, then a new choice: a new key for that child', async () => {
    teacherWorkspaceApi.addReadingForLearner.mockResolvedValueOnce(fail('That book can’t be logged that way.', 422));
    await ready('Learner C');
    save();
    await screen.findByText('That book can’t be logged that way.');
    const firstKey = teacherWorkspaceApi.addReadingForLearner.mock.calls[0][2];

    fireEvent.click(screen.getByRole('button', { name: 'Started today' }));
    save();
    await waitFor(() => expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalledTimes(2));
    const [, body, key] = teacherWorkspaceApi.addReadingForLearner.mock.calls[1];
    expect(body.where).toBe('starting');
    expect(key).not.toBe(firstKey);
  });

  it('an unknown outcome freezes that child: a new choice still resends the first request on the first key', async () => {
    teacherWorkspaceApi.addReadingForLearner.mockResolvedValueOnce(LOST);
    await ready('Learner C');
    save();
    expect(await screen.findByText(/Retry sends what you chose first\. Fix it on their shelf afterwards if needed\./)).toBeTruthy();
    const [, firstBody, firstKey] = teacherWorkspaceApi.addReadingForLearner.mock.calls[0];

    fireEvent.click(screen.getByRole('button', { name: 'Started today' }));
    save();
    await waitFor(() => expect(teacherWorkspaceApi.addReadingForLearner).toHaveBeenCalledTimes(2));
    expect(teacherWorkspaceApi.addReadingForLearner.mock.calls[1]).toEqual(['learner_c', firstBody, firstKey]);
    expect(firstBody.where).toBe('finished');
  });

  it('an open reading’s entry refused outright: Retry keeps the same key', async () => {
    teacherWorkspaceApi.addReadingEntry.mockResolvedValueOnce(fail('Someone else just changed this reading.', 409));
    await ready('Learner B');
    save();
    await screen.findByText('Someone else just changed this reading.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry Learner B' }));
    await waitFor(() => expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalledTimes(2));
    const keys = teacherWorkspaceApi.addReadingEntry.mock.calls.map((call) => call[3]);
    expect(keys[1]).toBe(keys[0]);
  });

  it('an open reading’s entry whose answer was lost: Retry resends it on the same key, even after a new choice', async () => {
    teacherWorkspaceApi.addReadingEntry.mockResolvedValueOnce(LOST);
    await ready('Learner B');
    save();
    await screen.findByText(/Retry sends what you chose first/);
    fireEvent.click(screen.getByRole('button', { name: 'Started today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Learner B' }));
    await waitFor(() => expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalledTimes(2));
    const [first, second] = teacherWorkspaceApi.addReadingEntry.mock.calls;
    expect(second[3]).toBe(first[3]);
    expect(second[2]).toEqual(first[2]);
    // Still the first choice, Finished: the finish follows the entry.
    await waitFor(() => expect(teacherWorkspaceApi.updateReading).toHaveBeenCalled());
  });

  it('an open reading whose finish failed: Retry re-reads, sends only the finish, on the served count', async () => {
    teacherWorkspaceApi.updateReading.mockResolvedValueOnce(fail('Someone else just changed this reading.', 409));
    await ready('Learner B');
    save();
    await screen.findByText('Someone else just changed this reading.');
    expect(summary()).toMatch(/Learner B ✗/);

    teacherWorkspaceApi.bookReaders.mockResolvedValue(ok(view([openRow(5), row('learner_c', 'Learner C')])));
    const readsBefore = teacherWorkspaceApi.bookReaders.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry Learner B' }));
    await waitFor(() => expect(summary()).toMatch(/Learner B ✓/));
    expect(teacherWorkspaceApi.bookReaders.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(teacherWorkspaceApi.addReadingEntry).toHaveBeenCalledTimes(1);
    expect(teacherWorkspaceApi.updateReading).toHaveBeenLastCalledWith(
      'learner_b', 'rdg_b', { status: 'finished', finishedOn: DAY, baseRevisionCount: 5 },
    );
  });

  it('an open reading whose finish landed but whose answer was lost: Retry shows ✓ and writes nothing', async () => {
    teacherWorkspaceApi.updateReading.mockResolvedValueOnce(LOST);
    await ready('Learner B');
    save();
    await waitFor(() => expect(summary()).toMatch(/Learner B ✗/));

    teacherWorkspaceApi.bookReaders.mockResolvedValue(ok(view([
      row('learner_b', 'Learner B', { today: true, finishedTodayIds: ['rdg_b'] }), row('learner_c', 'Learner C'),
    ])));
    teacherWorkspaceApi.addReadingEntry.mockClear();
    teacherWorkspaceApi.updateReading.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Learner B' }));
    await waitFor(() => expect(summary()).toMatch(/Learner B ✓/));
    expect(teacherWorkspaceApi.addReadingEntry).not.toHaveBeenCalled();
    expect(teacherWorkspaceApi.updateReading).not.toHaveBeenCalled();
    expect(teacherWorkspaceApi.addReadingForLearner).not.toHaveBeenCalled();
  });

  it('an open reading that changed under a failed try: Retry says so and writes nothing', async () => {
    teacherWorkspaceApi.addReadingEntry.mockResolvedValueOnce(fail('Someone else just changed this reading.', 409));
    await ready('Learner B');
    save();
    await screen.findByText('Someone else just changed this reading.');

    teacherWorkspaceApi.bookReaders.mockResolvedValue(ok(view([row('learner_b', 'Learner B'), row('learner_c', 'Learner C')])));
    teacherWorkspaceApi.addReadingEntry.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Learner B' }));
    expect(await screen.findByText(/This reading changed/)).toBeTruthy();
    expect(teacherWorkspaceApi.addReadingEntry).not.toHaveBeenCalled();
    expect(teacherWorkspaceApi.updateReading).not.toHaveBeenCalled();
    expect(teacherWorkspaceApi.addReadingForLearner).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry Learner B' })).toBeNull();
  });

  it('a 403 mid-batch asks once and replays, skipping the children already saved', async () => {
    let refusedOnce = false;
    teacherWorkspaceApi.addReadingForLearner.mockImplementation(async (learnerId) => {
      if (learnerId === 'learner_c' && !refusedOnce) { refusedOnce = true; return fail('The teacher PIN is missing or wrong.', 403); }
      return ok({ created: true }, 201);
    });
    await ready('Learner A', 'Learner C');
    save();
    await waitFor(() => expect(summary()).toBe('Learner A ✓ saved · Learner C ✓ saved'));
    const calls = teacherWorkspaceApi.addReadingForLearner.mock.calls;
    expect(calls.filter(([id]) => id === 'learner_a')).toHaveLength(1);
    const forC = calls.filter(([id]) => id === 'learner_c');
    expect(forC).toHaveLength(2);
    expect(forC[1][2]).toBe(forC[0][2]);
    expect(profile.invalidateAuthorization).toHaveBeenCalledTimes(1);
    expect(profile.requestAuthorization).toHaveBeenCalledTimes(2);
  });

  it('a second 403 stops the batch, and a child it never reached reads "not sent"', async () => {
    teacherWorkspaceApi.addReadingForLearner.mockImplementation(async (learnerId) => (learnerId === 'learner_c'
      ? fail('The teacher PIN is missing or wrong.', 403)
      : ok({ created: true }, 201)));
    await ready('Learner A', 'Learner C');
    save();
    await waitFor(() => expect(summary()).toBe('Learner A ✓ saved · Learner C – not sent'));
    expect(screen.getByRole('button', { name: 'Retry Learner C' })).toBeTruthy();
  });
});
