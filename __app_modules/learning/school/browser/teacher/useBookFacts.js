/**
 * useBookFacts — what the console shows about one ISBN before a grown-up
 * logs it: the book (cover, title, author, length) and the household's
 * readers of it.
 *
 * The two reads are SEQUENTIAL on purpose. The readers view takes the book's
 * length from the server's book cache, and the lookup is what fills that
 * cache the first time a book is seen; asked side by side, a first scan of a
 * novel would be offered check mode.
 *
 * A lookup never blocks a log: a miss or an outage leaves `book` null and the
 * readers read still runs.
 *
 * A RELOAD (same ISBN, new `reloadKey`, e.g. after a save or an unlock) asks
 * for the readers again and nothing else, and keeps showing the last answer
 * until the new one lands: blanking the faces mid-batch would hide the ✓/✗
 * a grown-up is reading. "Same ISBN" means one whose lookup COMPLETED, so a
 * StrictMode double-run (whose first pass is abandoned) still loads the book.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from "../schoolApi.js";
import { useTeacherProfileOptional } from "./TeacherProfileContext.jsx";
import { teacherWorkspaceApi } from "./teacherWorkspaceApi.js";
import { teacherLog } from "./teacherLog.js";

/**
 * An API call that rejects (a network error, a thrown parse) is a failed
 * read like any other — `{ ok: false, status: 0 }` — and never an unhandled
 * rejection out of the effect.
 */
const settle = (call) => Promise.resolve().then(call).catch((error) => ({
  ok: false, status: 0, data: null, error: error?.message ?? String(error),
}));

export const IDLE_BOOK_FACTS = Object.freeze({ bookStatus: 'idle', book: null, readersStatus: 'idle', readers: null });

/**
 * @param {string|null} isbn13 - a validated ISBN-13, or null for nothing yet
 * @param {{reloadKey?: unknown}} [options] - change it to read the readers again
 * @returns {{bookStatus: 'idle'|'loading'|'ok'|'not-found'|'unavailable', book: object|null,
 *   readersStatus: 'idle'|'loading'|'ok'|'locked'|'error', readers: object|null}}
 */
export function useBookFacts(isbn13, { reloadKey = 0 } = {}) {
  // The picked teacher names the readers read (see teacherWorkspaceApi `byQuery`).
  const actorId = useTeacherProfileOptional()?.currentTeacher?.id ?? null;
  const [state, setState] = useState(IDLE_BOOK_FACTS);
  const resolvedFor = useRef(null);

  useEffect(() => {
    if (!isbn13) {
      resolvedFor.current = null;
      setState(IDLE_BOOK_FACTS);
      return undefined;
    }
    let alive = true;
    const reload = resolvedFor.current === isbn13;
    if (!reload) {
      resolvedFor.current = null;
      setState({ bookStatus: 'loading', book: null, readersStatus: 'loading', readers: null });
    }
    (async () => {
      if (!reload) {
        const resolved = await settle(() => schoolApi.books.resolve(isbn13));
        if (!alive) return;
        const book = resolved?.ok && resolved.data?.status === 'ok' && resolved.data.book ? resolved.data.book : null;
        const bookStatus = book ? 'ok' : (resolved?.data?.status === 'not-found' ? 'not-found' : 'unavailable');
        setState((value) => ({ ...value, bookStatus, book }));
        resolvedFor.current = isbn13;
        teacherLog.read('book-facts', { isbn: isbn13, state: bookStatus });
      }

      const readers = await settle(() => teacherWorkspaceApi.bookReaders(isbn13, actorId));
      if (!alive) return;
      const readable = readers?.ok && Array.isArray(readers.data?.readers);
      // A failed RELOAD keeps the last good answer: the saves already made
      // are still true, and the next save re-reads the readers anyway.
      if (!readable && reload) {
        teacherLog.fetch('book-readers-reload-failed', { isbn: isbn13, status: readers?.status ?? 0 });
        return;
      }
      setState((value) => ({
        ...value,
        readersStatus: readable ? 'ok' : (readers?.status === 403 ? 'locked' : 'error'),
        readers: readable ? readers.data : null,
      }));
      if (!readable) teacherLog.fetch('book-readers-failed', { isbn: isbn13, status: readers?.status ?? 0 });
    })();
    return () => { alive = false; };
  }, [isbn13, reloadKey, actorId]);

  return state;
}

export default useBookFacts;
