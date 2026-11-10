import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock("../schoolApi.js", () => ({ schoolApi: { books: { resolve: vi.fn() } } }));
vi.mock("./teacherWorkspaceApi.js", () => ({ teacherWorkspaceApi: { bookReaders: vi.fn() } }));

import { useBookFacts } from "./useBookFacts.js";
import { schoolApi } from "../schoolApi.js";
import { teacherWorkspaceApi } from "./teacherWorkspaceApi.js";

const ISBN = '9780000000002';
const ok = (data) => ({ ok: true, status: 200, data });
const READERS = { isbn: ISBN, studyDay: '2026-09-06', pageCount: 32, suggestedMode: 'check', readers: [{ learnerId: 'learner_a', name: 'Learner A' }] };
const BOOK = { isbn13: ISBN, title: 'A Borrowed Title', pageCount: 32 };

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.books.resolve.mockResolvedValue(ok({ status: 'ok', book: BOOK }));
  teacherWorkspaceApi.bookReaders.mockResolvedValue(ok(READERS));
});

describe('useBookFacts — an API call that rejects is a failed read, never an unhandled rejection', () => {
  it('a rejected lookup leaves the book unnamed and still reads the readers', async () => {
    schoolApi.books.resolve.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useBookFacts(ISBN));
    await waitFor(() => expect(result.current.readersStatus).toBe('ok'));
    expect(result.current.bookStatus).toBe('unavailable');
    expect(result.current.book).toBeNull();
    expect(result.current.readers).toEqual(READERS);
  });

  it('a rejected first readers read is an error', async () => {
    teacherWorkspaceApi.bookReaders.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useBookFacts(ISBN));
    await waitFor(() => expect(result.current.readersStatus).toBe('error'));
    expect(result.current.bookStatus).toBe('ok');
    expect(result.current.readers).toBeNull();
  });

  it('a rejected reload keeps the last good readers', async () => {
    const { result, rerender } = renderHook(({ reloadKey }) => useBookFacts(ISBN, { reloadKey }), { initialProps: { reloadKey: 0 } });
    await waitFor(() => expect(result.current.readersStatus).toBe('ok'));
    teacherWorkspaceApi.bookReaders.mockRejectedValue(new Error('network down'));
    rerender({ reloadKey: 1 });
    await waitFor(() => expect(teacherWorkspaceApi.bookReaders).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(result.current.readersStatus).toBe('ok');
    expect(result.current.readers).toEqual(READERS);
    expect(result.current.book).toEqual(BOOK);
  });
});
