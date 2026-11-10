import { describe, it, expect, vi } from 'vitest';
import { FileBookPile } from "./FileBookPile.mjs";

const ISBN = '9780064400558';
const TODAY = '2026-10-30';

function fixture(readings = []) {
  const shelf = readings;
  const bookLog = {
    listForLearner: vi.fn(async () => shelf),
    deleteReading: vi.fn(async ({ readingId }) => { shelf.splice(shelf.findIndex((r) => r.id === readingId), 1); }),
  };
  const openBookShelfItem = { execute: vi.fn(async ({ bookId, entryId, progressEntryId }) => {
    const reading = { id: 'new-1', book: { isbn: bookId }, status: 'finished', finishedOn: TODAY,
      idempotencyKey: entryId, entries: [{ idempotencyKey: progressEntryId, kind: 'finished', on: TODAY }] };
    shelf.push(reading);
    return { item: { itemId: reading.id } };
  }) };
  const recordBookProgress = { execute: vi.fn(async ({ itemId, kind }) => {
    const reading = shelf.find((r) => r.id === itemId);
    if (kind === 'finished') Object.assign(reading, { status: 'finished', finishedOn: TODAY });
    if (kind === 'reopened') Object.assign(reading, { status: 'reading', finishedOn: null });
    return { item: { itemId } };
  }) };
  const filer = new FileBookPile({
    bookLog, openBookShelfItem, recordBookProgress,
    dayOf: () => TODAY, clock: () => new Date('2026-10-31T02:00:00Z'), logger: {},
  });
  return { filer, bookLog, openBookShelfItem, recordBookProgress, shelf };
}

describe('FileBookPile', () => {
  it('opens a new finished reading when the child has none', async () => {
    const f = fixture();
    const result = await f.filer.file({ learnerId: 'child', isbn13: ISBN, attemptKey: 'k1' });
    expect(f.openBookShelfItem.execute).toHaveBeenCalledWith({
      learnerId: 'child', bookId: ISBN, where: 'finished', finishedOn: TODAY,
      entryId: 'pile:k1:open', progressEntryId: 'pile:k1:finish',
    });
    expect(result).toEqual({ outcome: 'finished-new', itemId: 'new-1' });
  });

  it('finishes an open reading instead of opening a second', async () => {
    const f = fixture([{ id: 'r1', book: { isbn: ISBN }, status: 'reading', openedOn: '2026-10-29' }]);
    const result = await f.filer.file({ learnerId: 'child', isbn13: ISBN, attemptKey: 'k1' });
    expect(f.recordBookProgress.execute).toHaveBeenCalledWith({
      learnerId: 'child', itemId: 'r1', kind: 'finished', entryId: 'pile:k1:finish',
    });
    expect(f.openBookShelfItem.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'finished-open', itemId: 'r1' });
  });

  it('already finished today writes nothing', async () => {
    const f = fixture([{ id: 'r1', book: { isbn: ISBN }, status: 'finished', finishedOn: TODAY }]);
    const result = await f.filer.file({ learnerId: 'child', isbn13: ISBN, attemptKey: 'k1' });
    expect(f.openBookShelfItem.execute).not.toHaveBeenCalled();
    expect(f.recordBookProgress.execute).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'already-today', itemId: 'r1' });
  });

  it('a book finished on an earlier day is a new reading', async () => {
    const f = fixture([{ id: 'r1', book: { isbn: ISBN }, status: 'finished', finishedOn: '2026-10-20' }]);
    const result = await f.filer.file({ learnerId: 'child', isbn13: ISBN, attemptKey: 'k1' });
    expect(result.outcome).toBe('finished-new');
  });

  it('undoing a reading the pile created removes it, and re-filing creates it again', async () => {
    const f = fixture();
    const first = await f.filer.file({ learnerId: 'child', isbn13: ISBN, attemptKey: 'k1' });
    expect(await f.filer.undo({ learnerId: 'child', itemId: first.itemId, attemptKey: 'k1', outcome: first.outcome })).toEqual({ outcome: 'removed' });
    expect(f.bookLog.deleteReading).toHaveBeenCalledWith({ learnerId: 'child', readingId: 'new-1' });
    expect(f.shelf).toHaveLength(0);
    expect(f.recordBookProgress.execute).not.toHaveBeenCalled();
    const again = await f.filer.file({ learnerId: 'child', isbn13: ISBN, attemptKey: 'k2' });
    expect(again.outcome).toBe('finished-new');
  });

  it('a created reading the child has since added to is reopened, not deleted', async () => {
    const f = fixture();
    const first = await f.filer.file({ learnerId: 'child', isbn13: ISBN, attemptKey: 'k1' });
    f.shelf[0].entries.push({ idempotencyKey: 'child-note', kind: 'progress', on: TODAY });
    expect((await f.filer.undo({ learnerId: 'child', itemId: first.itemId, attemptKey: 'k1', outcome: 'finished-new' })).outcome).toBe('reopened');
    expect(f.bookLog.deleteReading).not.toHaveBeenCalled();
  });

  it('undo never touches a finish the child made themselves', async () => {
    const f = fixture([{ id: 'r1', book: { isbn: ISBN }, status: 'finished', finishedOn: TODAY }]);
    expect(await f.filer.undo({ learnerId: 'child', itemId: 'r1', attemptKey: 'u1', outcome: 'already-today' })).toEqual({ outcome: 'untouched' });
    expect(f.recordBookProgress.execute).not.toHaveBeenCalled();
    expect(f.bookLog.deleteReading).not.toHaveBeenCalled();
  });

  it('undo of a finished open reading reopens via RecordBookProgress', async () => {
    const f = fixture([{ id: 'r1', book: { isbn: ISBN }, status: 'finished', finishedOn: TODAY }]);
    const result = await f.filer.undo({ learnerId: 'child', itemId: 'r1', attemptKey: 'u1', outcome: 'finished-open' });
    expect(f.recordBookProgress.execute).toHaveBeenCalledWith({
      learnerId: 'child', itemId: 'r1', kind: 'reopened', entryId: 'pile:u1:undo',
    });
    expect(result).toEqual({ outcome: 'reopened' });
  });
});
