import { describe, expect, it } from 'vitest';
import {
  countedWindowOf, countedWindowUnknown, inWindow, leavesWindow, reasonAsk,
  undoRefusal, undoShrinks, revisionPhrase, revisionChanges, unfinishes,
  OPS, UNDO_VERB,
} from './readingDetail.js';

const WEEK = { state: 'window', per: 'week', from: '2026-08-31', to: '2026-09-06' };

describe('the counted window — read off the server, never re-derived', () => {
  it('takes the bounds the server computed, and nothing else', () => {
    expect(countedWindowOf(WEEK)).toEqual({ from: '2026-08-31', to: '2026-09-06' });
    expect(countedWindowUnknown(WEEK)).toBe(false);
  });

  it('a child who owes no reading has no window — and that IS an answer', () => {
    const none = { state: 'none', per: null, from: null, to: null };
    expect(countedWindowOf(none)).toBeNull();
    expect(countedWindowUnknown(none)).toBe(false);
  });

  it('an obligation the server could not read is unknown, and so is a missing answer', () => {
    // The distinction the console needs: "nothing can leave a window that does
    // not exist" and "I cannot tell whether this leaves one" both mean no
    // pre-required reason, but only one of them is worth saying out loud.
    expect(countedWindowOf({ state: 'unknown', per: null, from: null, to: null })).toBeNull();
    expect(countedWindowUnknown({ state: 'unknown', per: null, from: null, to: null })).toBe(true);
    expect(countedWindowUnknown(null)).toBe(true);
    expect(countedWindowUnknown(undefined)).toBe(true);
  });

  it('a day inside the window is in it, and a day before it is not', () => {
    const window = countedWindowOf(WEEK);
    expect(inWindow('2026-09-02', window)).toBe(true);
    expect(inWindow('2026-08-30', window)).toBe(false);
    // No window means nothing can leave one.
    expect(inWindow('1999-01-01', null)).toBe(true);
  });

  it('only a re-date OUT of the window shrinks the record', () => {
    const window = countedWindowOf(WEEK);
    expect(leavesWindow(window, '2026-09-02', '2026-08-20')).toBe(true);
    expect(leavesWindow(window, '2026-09-02', '2026-09-01')).toBe(false);
    // Pulling a day back INTO the window makes the record bigger.
    expect(leavesWindow(window, '2026-08-20', '2026-09-02')).toBe(false);
    expect(leavesWindow(null, '2026-09-02', '2026-08-20')).toBe(false);
  });
});

describe('the reason the child reads', () => {
  it('names the book, the child, and what is being taken away', () => {
    const ask = reasonAsk('entry.delete', { book: 'Hatchet', child: 'learner_a' });
    expect(ask).toMatch(/Hatchet/);
    expect(ask).toMatch(/learner_a/);
    expect(ask).toMatch(/sent to them/);
  });

  it('a move says BOTH children are told, and names where it is going', () => {
    const ask = reasonAsk('move', { book: 'Hatchet', child: 'learner_a', to: 'learner_b' });
    expect(ask).toMatch(/learner_b/);
    expect(ask).toMatch(/both children/);
  });

  it('every shrinking verb has an ask, and nothing else does', () => {
    for (const action of ['entry.delete', 'unfinish', 'entry.redate', 'move', 'reading.delete']) {
      expect(reasonAsk(action, {})).toBeTruthy();
    }
    expect(reasonAsk('isbn', {})).toBeNull();
  });
});

describe('un-finishing is the one shrinking state change', () => {
  it('is true only when a finished book stops being finished', () => {
    expect(unfinishes({ status: 'finished' }, { status: 'reading' })).toBe(true);
    expect(unfinishes({ status: 'finished' }, { status: 'set-aside' })).toBe(true);
    expect(unfinishes({ status: 'reading' }, { status: 'finished' })).toBe(false);
    expect(unfinishes({ status: 'finished' }, { pageCount: 200 })).toBe(false);
  });
});

const reading = (over = {}) => ({
  id: 'rd_1', status: 'reading', entries: [], revisions: [], ...over,
});

describe('the undos the server refuses by name', () => {
  it('refuses a revision another undo already inverted', () => {
    const record = reading({ revisions: [{ id: 'rev_1' }, { id: 'rev_2', undoes: 'rev_1' }] });
    expect(undoRefusal(record, { id: 'rev_1', op: OPS.ENTRY_ADD })).toMatch(/already been undone/);
  });

  it('refuses undoing the opening of a reading, and names the verb that can', () => {
    expect(undoRefusal(reading(), { id: 'rev_1', op: OPS.READING_ADD })).toMatch(/Delete the reading instead/);
  });

  it('refuses undoing a move the receiving child has logged against', () => {
    const record = reading({
      entries: [{ id: 'e1', on: '2026-09-05', at: '2026-09-05T10:00:00.000Z' }],
      revisions: [{ id: 'rev_1', op: OPS.READING_MOVE, at: '2026-09-04T10:00:00.000Z' }],
    });
    const refusal = undoRefusal(record, record.revisions[0], { book: 'Hatchet' });
    expect(refusal).toMatch(/Hatchet has been read since it moved/);
    expect(refusal).toMatch(/Move it back instead/);
  });

  it('allows undoing a move nothing has been logged against since', () => {
    const record = reading({
      entries: [{ id: 'e1', on: '2026-09-01', at: '2026-09-01T10:00:00.000Z' }],
      revisions: [{ id: 'rev_1', op: OPS.READING_MOVE, at: '2026-09-04T10:00:00.000Z' }],
    });
    expect(undoRefusal(record, record.revisions[0])).toBeNull();
  });

  it('allows an ordinary correction to be undone', () => {
    expect(undoRefusal(reading(), { id: 'rev_1', op: OPS.READING_UPDATE })).toBeNull();
  });
});

describe('an undo inherits the reason requirement of its inverse', () => {
  const window = countedWindowOf(WEEK);

  it('undoing an added day deletes a day, so the child is told', () => {
    expect(undoShrinks(reading(), { op: OPS.ENTRY_ADD })).toBe(true);
  });

  it('undoing a deleted day restores it, so nothing is sent', () => {
    expect(undoShrinks(reading(), { op: OPS.ENTRY_DELETE })).toBe(false);
  });

  it('undoing a move is still a move', () => {
    expect(undoShrinks(reading(), { op: OPS.READING_MOVE })).toBe(true);
  });

  it('undoing a finish un-finishes, and that shrinks', () => {
    const record = reading({ status: 'finished' });
    expect(undoShrinks(record, {
      op: OPS.READING_UPDATE, before: { status: 'reading', finishedOn: null }, after: { status: 'finished' },
    })).toBe(true);
  });

  it('undoing an ISBN correction shrinks nothing', () => {
    expect(undoShrinks(reading(), {
      op: OPS.READING_UPDATE, before: { isbn: '9780000000001' }, after: { isbn: '9780000000002' },
    })).toBe(false);
  });

  it('undoing a re-date shrinks only when the day lands back outside the window', () => {
    const record = reading({ entries: [{ id: 'e1', on: '2026-09-02' }] });
    const out = { op: OPS.ENTRY_UPDATE, before: { id: 'e1', on: '2026-08-01' }, after: { id: 'e1', on: '2026-09-02' } };
    expect(undoShrinks(record, out, window)).toBe(true);
    const inside = { op: OPS.ENTRY_UPDATE, before: { id: 'e1', on: '2026-09-01' }, after: { id: 'e1', on: '2026-09-02' } };
    expect(undoShrinks(record, inside, window)).toBe(false);
  });
});

describe('what a history row says', () => {
  it('names the verb', () => {
    expect(revisionPhrase({ verb: OPS.ENTRY_DELETE, op: OPS.ENTRY_DELETE })).toBe('removed a day');
  });

  it('an undo says what it took back', () => {
    expect(revisionPhrase({ verb: UNDO_VERB, op: OPS.ENTRY_ADD, undoneVerb: OPS.ENTRY_DELETE }))
      .toBe('took back: removed a day');
  });

  it('lists only the fields that actually moved, labelled for a grown-up', () => {
    expect(revisionChanges({
      before: { status: 'finished', finishedOn: '2026-09-05', progressMode: 'page' },
      after: { status: 'finished', finishedOn: '2026-09-02', progressMode: 'page' },
    })).toEqual([{ field: 'finish day', from: '2026-09-05', to: '2026-09-02' }]);
  });

  it('shows an absent value as a dash rather than as nothing', () => {
    expect(revisionChanges({ before: { on: '2026-09-03', page: 84 }, after: null }))
      .toEqual([
        { field: 'day', from: '2026-09-03', to: '—' },
        { field: 'page', from: '84', to: '—' },
      ]);
  });

  it('ignores fields a grown-up has no business reading', () => {
    expect(revisionChanges({ before: { source: 'child', idempotencyKey: 'k' }, after: null })).toEqual([]);
  });
});
