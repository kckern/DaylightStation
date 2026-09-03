/**
 * useBookShelf — the reading shelf's state machine (book-shelf UI design
 * §2–§5, §7).
 *
 * A child's code opens the shelf; this hook owns everything that happens on
 * it — the tiles, the update overlay, the three-step add flow, history — so
 * the components (BookShelf, ShelfTile, UpdateBook, AddBook, History) stay
 * presentational. It mirrors `useSelfService`'s shape on purpose and holds
 * the same rules where they apply:
 *
 * 1. A LATE RESPONSE MAY NOT REOPEN A CLOSED CARD. The shelf is a WORKSPACE
 *    on a shared wall panel (design §2): `Done` and the idle close both
 *    happen while requests can still be in flight. Every `await` below is
 *    followed by a generation check; an answer whose generation has moved on
 *    is dropped on the floor. Without it the NEXT child sees the previous
 *    child's books.
 *
 * 2. THE NUMBER IS JUDGED BEFORE THE NETWORK, BEHIND A LENGTH GATE. `checkIsbn`
 *    runs on every keystroke, so a bad check digit or a library sticker is
 *    named on the panel without a round trip — but not before the child has
 *    typed enough to be wrong (see isbn.js). Ten digits are the exception:
 *    they light `Look it up` without a verdict, and the TAP judges them as
 *    an ISBN-10 (`submit: true`), because on the keystroke they are just as
 *    likely the first ten of thirteen.
 *
 * 3. EVERY WRITE IS IDEMPOTENT. The client mints the `entryId` when the
 *    overlay opens (and a second one for the add flow's first progress
 *    event), and the same ids ride every retry of that write. A double tap
 *    or a retried request appends once (`IBookLogStore` contract).
 *
 * 4. A FAILED WRITE LOSES NOTHING. The view stays where it was, the number or
 *    page the child typed stays on screen, the fault is named from the
 *    server's own message, and the next tap retries with the same ids.
 *
 * 5. IDENTITY IS NEVER CLIENT-SUPPLIED beyond the path. The grant the launch
 *    card handed over rides every shelf call; the server takes the learner
 *    from that. This hook never puts a learner in a body.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { checkIsbn, hintFor, COPY } from './isbn.js';

/** The shelf could not be read and the server said nothing usable. */
export const LOAD_FAILED_SENTENCE = 'Could not load your shelf';
/** A write failed and the server said nothing usable. */
export const WRITE_FAILED_SENTENCE = "That didn't save — try again";
/** Blank or zero on the update overlay's Save (design §4). */
export const EMPTY_PROGRESS_SENTENCE = 'Type a page or tap "I read some today"';
/** Blank or zero on the add flow's page step. */
export const EMPTY_PAGE_SENTENCE = 'Type the page you are on';

const EMPTY_ADD = Object.freeze({
  entry: '',
  resolved: null,
  duplicateOf: null,
  entryId: null,
  progressEntryId: null,
  finishedOn: null,
  lookupHint: null,
  canRetry: false,
});

const mintId = () => crypto.randomUUID();

/** The server's own sentence when it gave one; ours otherwise. */
function messageOf(res, fallback) {
  const message = res?.data?.error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/** Build a body with no undefined keys — the wire shape is asserted exactly. */
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * @param {object} p
 * @param {string} p.learnerId
 * @param {string} p.grant - the `X-School-Book-Grant` the launch card carried
 * @param {number} [p.idleTimeoutSeconds=90]
 * @param {(reason: 'done'|'idle') => void} [p.onExit]
 */
export function useBookShelf({ learnerId, grant, idleTimeoutSeconds = 90, onExit }) {
  const [view, setView] = useState('loading');
  const [step, setStep] = useState(null);
  const [shelf, setShelf] = useState(null);
  const [learner, setLearner] = useState({ id: learnerId, name: learnerId });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState(EMPTY_ADD);
  const [currentItemId, setCurrentItemId] = useState(null);
  const [updateEntryId, setUpdateEntryId] = useState(null);
  // Bumped by every interaction; the idle timer re-arms off it.
  const [activity, setActivity] = useState(0);

  // Rule 1. Bumped by every close; an in-flight request whose generation has
  // moved on drops its answer.
  const genRef = useRef(0);
  // Single in-flight write slot — a ref, because two taps land in one React
  // batch and both read the same stale `busy`.
  const workRef = useRef(false);
  // Single in-flight lookup slot, for the same reason: two taps on Look Up
  // both read `step === 'number'` before React has painted `lookup`.
  const lookupRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Mirrors, so the async paths read the latest state rather than a closure's.
  const viewRef = useRef(view); viewRef.current = view;
  const stepRef = useRef(step); stepRef.current = step;
  const shelfRef = useRef(shelf); shelfRef.current = shelf;
  const addRef = useRef(add); addRef.current = add;
  const itemRef = useRef(currentItemId); itemRef.current = currentItemId;
  const updateEntryRef = useRef(updateEntryId); updateEntryRef.current = updateEntryId;

  const touch = useCallback(() => setActivity((n) => n + 1), []);
  const isClosed = () => viewRef.current === 'closed';

  const close = useCallback((reason) => {
    if (viewRef.current === 'closed') return;
    genRef.current += 1;
    workRef.current = false;
    lookupRef.current = false;
    schoolLog.bookShelf('closed', { reason, view: viewRef.current });
    viewRef.current = 'closed';
    setView('closed');
    setStep(null);
    setBusy(false);
    setError(null);
    setAdd(EMPTY_ADD);
    setCurrentItemId(null);
    setUpdateEntryId(null);
    onExitRef.current?.(reason);
  }, []);

  /** Back to the tiles with the add/update state cleared. */
  const toShelf = useCallback(() => {
    setView('shelf');
    setStep(null);
    setAdd(EMPTY_ADD);
    setCurrentItemId(null);
    setUpdateEntryId(null);
  }, []);

  /** The parallel first read: the shelf and the child's name. */
  const load = useCallback(async () => {
    const gen = genRef.current;
    setError(null);
    const [shelfRes, rosterRes] = await Promise.all([
      schoolApi.books.shelf(learnerId, grant),
      schoolApi.roster(),
    ]);
    if (genRef.current !== gen) return; // rule 1

    const members = Array.isArray(rosterRes?.data) ? rosterRes.data : (rosterRes?.data?.learners ?? []);
    const me = rosterRes?.ok ? members.find((m) => m?.id === learnerId) : null;
    setLearner({ id: learnerId, name: me?.name || learnerId });

    if (!shelfRes.ok || !shelfRes.data) {
      setError({ message: messageOf(shelfRes, LOAD_FAILED_SENTENCE) });
      schoolLog.bookShelfError('shelf.failed', { status: shelfRes.status, learnerId });
      return;
    }
    setShelf(shelfRes.data);
    setView('shelf');
  }, [learnerId, grant]);

  /** Re-read the shelf after a write and land on the tiles. */
  const refetch = useCallback(async () => {
    const gen = genRef.current;
    const res = await schoolApi.books.shelf(learnerId, grant);
    if (genRef.current !== gen) return; // rule 1
    if (res.ok && res.data) {
      setShelf(res.data);
      setError(null);
    } else {
      // The write landed; only the re-read failed. Show the shelf as it was
      // and say so, rather than stranding the child on the overlay.
      setError({ message: messageOf(res, LOAD_FAILED_SENTENCE) });
      schoolLog.bookShelfError('shelf.failed', { status: res.status, learnerId });
    }
    toShelf();
  }, [learnerId, grant, toShelf]);

  useEffect(() => {
    schoolLog.bookShelf('opened', { learnerId });
    load();
  }, [learnerId, load]);

  // Rule 1 for the unmount: a write answering after the parent tore the shelf
  // down may neither refetch nor log.
  useEffect(() => () => { genRef.current += 1; }, []);

  // Idle close (design §2): 90s with no tap, resets on any interaction, no
  // exemptions — nothing on the shelf runs long. Not armed once closed.
  useEffect(() => {
    if (view === 'closed') return undefined;
    const ms = Number(idleTimeoutSeconds) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    const timer = setTimeout(() => close('idle'), ms);
    return () => clearTimeout(timer);
  }, [view, activity, idleTimeoutSeconds, close]);

  // ── Shelf-level actions ────────────────────────────────────────────────────

  const noteActivity = useCallback(() => { if (!isClosed()) touch(); }, [touch]);

  const done = useCallback(() => close('done'), [close]);

  const retry = useCallback(async () => {
    if (isClosed()) return;
    touch();
    await load();
  }, [load, touch]);

  const openHistory = useCallback(() => {
    if (viewRef.current !== 'shelf') return;
    touch();
    setView('history');
    schoolLog.bookShelf('history-opened', { learnerId });
  }, [learnerId, touch]);

  const startAdd = useCallback(() => {
    if (viewRef.current !== 'shelf') return;
    touch();
    setError(null);
    setAdd(EMPTY_ADD);
    setView('add');
    setStep('number');
    schoolLog.bookShelf('add-started', { learnerId });
  }, [learnerId, touch]);

  /** The update overlay, opened on `item` — no view guard; the callers hold it. */
  const enterUpdate = useCallback((item) => {
    touch();
    setError(null);
    setCurrentItemId(item.itemId);
    setUpdateEntryId(mintId()); // rule 3: minted when the overlay opens
    viewRef.current = 'update';
    setView('update');
    schoolLog.bookShelf('update-opened', { itemId: item.itemId, mode: item.progressMode });
  }, [touch]);

  const openItem = useCallback((itemId) => {
    if (viewRef.current !== 'shelf') return;
    const item = shelfRef.current?.items?.find((i) => i.itemId === itemId);
    if (!item) return;
    enterUpdate(item);
  }, [enterUpdate]);

  /**
   * The duplicate guard's way out (design §5): the cover step named an item
   * already being read; take the child to it. Leaves the add flow the way
   * `close()`/`toShelf()` do and opens the item in the same handler, so no
   * stale `viewRef` sits between the two.
   */
  const openDuplicate = useCallback(() => {
    if (viewRef.current !== 'add') return;
    const itemId = addRef.current.duplicateOf;
    if (!itemId) return;
    const item = shelfRef.current?.items?.find((i) => i.itemId === itemId);
    if (!item) return;
    viewRef.current = 'shelf';
    setStep(null);
    setAdd(EMPTY_ADD);
    enterUpdate(item);
  }, [enterUpdate]);

  const back = useCallback(() => {
    if (isClosed()) return;
    const v = viewRef.current;
    if (v === 'update' || v === 'history') { touch(); setError(null); toShelf(); return; }
    if (v !== 'add') return;
    const s = stepRef.current;
    touch();
    setError(null);
    if (s === 'lookup') {
      // Abandon the round trip: a bumped generation drops its answer when
      // it lands (rule 1), the slot frees for the next tap, and the pad
      // comes back with the digits — the child may fix one or try again.
      genRef.current += 1;
      lookupRef.current = false;
      schoolLog.bookShelf('lookup.abandoned', {});
      setStep('number');
      return;
    }
    if (s === 'page' || s === 'when') { setStep('where'); return; }
    if (s === 'where' || s === 'cover') {
      // The number survives; the cover and the ids minted for it do not.
      setAdd((a) => ({ ...EMPTY_ADD, entry: a.entry }));
      setStep('number');
      return;
    }
    toShelf();
  }, [toShelf, touch]);

  // ── The add flow ───────────────────────────────────────────────────────────

  const typeIsbn = useCallback((value) => {
    if (viewRef.current !== 'add' || stepRef.current !== 'number') return;
    touch();
    const entry = typeof value === 'string' ? value : '';
    const before = checkIsbn(addRef.current.entry);
    const after = checkIsbn(entry);
    // The local-validation copy that fired — once per verdict, not per key.
    if (after.state === 'invalid' && !(before.state === 'invalid' && before.reason === after.reason)) {
      schoolLog.bookShelf('add.rejected', { reason: after.reason });
    }
    setAdd((a) => ({ ...a, entry, lookupHint: null, canRetry: false }));
  }, [touch]);

  const lookup = useCallback(async () => {
    if (viewRef.current !== 'add' || stepRef.current !== 'number') return;
    if (lookupRef.current) return;
    // The child stopped here: ten digits are judged as an ISBN-10 now (rule 2).
    const check = checkIsbn(addRef.current.entry, { submit: true });
    if (check.state === 'invalid') {
      touch();
      schoolLog.bookShelf('add.rejected', { reason: check.reason });
      setAdd((a) => ({ ...a, lookupHint: COPY[check.reason] ?? null, canRetry: false }));
      return;
    }
    if (check.state !== 'valid') return;
    lookupRef.current = true;
    touch();
    setError(null);
    setAdd((a) => ({ ...a, lookupHint: null, canRetry: false }));
    setStep('lookup');
    const gen = genRef.current;
    const res = await schoolApi.books.resolve(check.isbn13);
    if (genRef.current !== gen) return; // rule 1 — back() or close() already freed the slot
    lookupRef.current = false;

    const status = res?.data?.status ?? 'unavailable';
    schoolLog.bookShelf('lookup', { status, httpStatus: res?.status ?? 0 });

    if (status === 'ok' && res.data.book) {
      const { book } = res.data;
      // Duplicate guard (design §5): already `reading` on this shelf points
      // at that item. A finished copy is not a duplicate — a re-read opens a
      // fresh item (PRD S9).
      const dup = shelfRef.current?.items?.find(
        (i) => i.bookId === book.isbn13 && i.projection?.status === 'reading',
      ) ?? null;
      setAdd((a) => ({ ...a, resolved: res.data, duplicateOf: dup?.itemId ?? null }));
      setStep('cover');
      return;
    }
    // Every other outcome goes back to the pad WITH the number kept.
    let lookupHint;
    let canRetry = false;
    if (status === 'not-found') {
      lookupHint = COPY['not-found'];
      schoolLog.bookShelf('cover.unresolved', { reason: res.data?.reason ?? null });
    } else if (status === 'invalid') {
      // The server disagreed with the local check; say what it said.
      lookupHint = COPY[res.data?.reason] ?? COPY['not-an-identifier'];
    } else {
      // `unavailable`, or a request that never completed (status 0).
      lookupHint = COPY.unavailable;
      canRetry = true;
    }
    setAdd((a) => ({ ...a, lookupHint, canRetry }));
    setStep('number');
  }, [touch]);

  const retryLookup = useCallback(() => lookup(), [lookup]);

  const confirmCover = useCallback((yes) => {
    if (viewRef.current !== 'add' || stepRef.current !== 'cover') return;
    touch();
    schoolLog.bookShelf('cover', { accepted: Boolean(yes) });
    if (!yes) {
      setAdd(EMPTY_ADD);
      setStep('number');
      return;
    }
    // Duplicate guard (design §5): no second `reading` item for one book. The
    // step stays put; `openDuplicate` is the way forward.
    const { duplicateOf } = addRef.current;
    if (duplicateOf) {
      schoolLog.bookShelf('add.rejected', { reason: 'duplicate', itemId: duplicateOf });
      return;
    }
    // Rule 3: both ids minted now, before any write, so a retry reuses them.
    setAdd((a) => ({ ...a, entryId: mintId(), progressEntryId: mintId() }));
    setStep('where');
  }, [touch]);

  /** Free the write slot. Held from the write through the re-read (or the failure). */
  const release = useCallback(() => {
    workRef.current = false;
    setBusy(false);
  }, []);

  /** The one write the add flow makes, on whichever step it ends. */
  const openBook = useCallback(async (where, extra = {}) => {
    if (workRef.current) return;
    const { resolved, entryId, progressEntryId } = addRef.current;
    const bookId = resolved?.book?.isbn13;
    if (!bookId || !entryId) return;
    workRef.current = true;
    setBusy(true);
    setError(null);
    const body = compact({
      bookId,
      entryId,
      where,
      ...extra,
      progressEntryId: where === 'starting' ? undefined : progressEntryId,
    });
    const gen = genRef.current;
    const res = await schoolApi.books.open(learnerId, grant, body);
    if (genRef.current !== gen) return; // rule 1
    if (!res.ok) {
      // Rule 4: stay put, name it, keep the ids for the retry.
      release();
      setError({ message: messageOf(res, WRITE_FAILED_SENTENCE) });
      schoolLog.bookShelfError('write.failed', { kind: 'open', where, status: res.status });
      return;
    }
    schoolLog.bookShelf('item-opened', { bookId, where });
    // The slot stays taken through the re-read: a second tap while the
    // overlay is still up must not send a second write.
    await refetch();
    if (genRef.current !== gen) return; // rule 1 (close() already released)
    release();
  }, [learnerId, grant, refetch, release]);

  const choose = useCallback(async (where) => {
    if (viewRef.current !== 'add' || stepRef.current !== 'where') return;
    touch();
    setError(null);
    if (where === 'partway') { setStep('page'); return; }
    if (where === 'finished') { setStep('when'); return; }
    if (where !== 'starting') return;
    await openBook('starting');
  }, [openBook, touch]);

  const submitPage = useCallback(async (page) => {
    if (viewRef.current !== 'add' || stepRef.current !== 'page') return;
    touch();
    const n = Number(page);
    if (!Number.isInteger(n) || n <= 0) {
      setError({ message: EMPTY_PAGE_SENTENCE });
      return;
    }
    await openBook('partway', { page: n });
  }, [openBook, touch]);

  const submitDay = useCallback(async (key) => {
    if (viewRef.current !== 'add' || stepRef.current !== 'when') return;
    if (typeof key !== 'string' || !key) return;
    touch();
    setAdd((a) => ({ ...a, finishedOn: key }));
    await openBook('finished', { finishedOn: key });
  }, [openBook, touch]);

  // ── Updating a book ────────────────────────────────────────────────────────

  /** One progress event against the open item, with the overlay's entryId. */
  const writeEvent = useCallback(async (event) => {
    if (viewRef.current !== 'update') return;
    const itemId = itemRef.current;
    const entryId = updateEntryRef.current;
    const item = shelfRef.current?.items?.find((i) => i.itemId === itemId);
    if (!itemId || !entryId || !item) return;
    if (workRef.current) return;
    touch();
    workRef.current = true;
    setBusy(true);
    setError(null);
    const body = compact({ ...event, entryId });
    const gen = genRef.current;
    const res = await schoolApi.books.progress(learnerId, grant, itemId, body);
    if (genRef.current !== gen) return; // rule 1
    if (!res.ok) {
      release();
      setError({ message: messageOf(res, WRITE_FAILED_SENTENCE) }); // rule 4
      schoolLog.bookShelfError('write.failed', { kind: event.kind, itemId, status: res.status });
      return;
    }
    schoolLog.bookShelf('progress', { kind: event.kind, mode: item.progressMode, itemId });
    await refetch();
    if (genRef.current !== gen) return; // rule 1 (close() already released)
    release();
  }, [learnerId, grant, refetch, release, touch]);

  const submitProgress = useCallback(async ({ page, minutes } = {}) => {
    if (viewRef.current !== 'update') return;
    const p = page === undefined || page === null || page === '' ? null : Number(page);
    const m = minutes === undefined || minutes === null || minutes === '' ? null : Number(minutes);
    const hasPage = Number.isInteger(p) && p > 0;
    const hasMinutes = Number.isInteger(m) && m > 0;
    if (!hasPage && !hasMinutes) {
      touch();
      setError({ message: EMPTY_PROGRESS_SENTENCE });
      return;
    }
    await writeEvent(compact({ kind: 'progress', page: hasPage ? p : undefined, minutes: hasMinutes ? m : undefined }));
  }, [writeEvent, touch]);

  const checkIn = useCallback(() => writeEvent({ kind: 'progress' }), [writeEvent]);

  const finish = useCallback((finishedOn) => writeEvent(compact({
    kind: 'finished',
    finishedOn: typeof finishedOn === 'string' && finishedOn ? finishedOn : undefined,
  })), [writeEvent]);

  const setAside = useCallback(() => writeEvent({ kind: 'set-aside' }), [writeEvent]);

  const setMode = useCallback(async (progressMode) => {
    if (viewRef.current !== 'update') return;
    const itemId = itemRef.current;
    if (!itemId || workRef.current) return;
    touch();
    workRef.current = true;
    setBusy(true);
    setError(null);
    const gen = genRef.current;
    const res = await schoolApi.books.mode(learnerId, grant, itemId, progressMode);
    if (genRef.current !== gen) return; // rule 1
    if (!res.ok) {
      release();
      setError({ message: messageOf(res, WRITE_FAILED_SENTENCE) }); // rule 4
      schoolLog.bookShelfError('write.failed', { kind: 'mode', itemId, status: res.status });
      return;
    }
    schoolLog.bookShelf('mode', { itemId, progressMode });
    await refetch();
    if (genRef.current !== gen) return; // rule 1 (close() already released)
    release();
  }, [learnerId, grant, refetch, release, touch]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const check = useMemo(() => checkIsbn(add.entry), [add.entry]);
  const hint = add.lookupHint ?? hintFor(check);
  // Lit on a valid number, and on ten digits with no verdict yet — a tap is
  // what judges those (rule 2). Never lit on a verdict of invalid, including
  // the tap-judged ten: its verdict lives in lookupHint until the next key.
  const submittable = useMemo(
    () => check.state === 'valid'
      || (check.state === 'typing' && !add.lookupHint
        && checkIsbn(add.entry, { submit: true }).state !== 'typing'),
    [check, add.entry, add.lookupHint],
  );
  const canSubmit = view === 'add' && step === 'number' && submittable;

  const currentItem = useMemo(
    () => (currentItemId ? shelf?.items?.find((i) => i.itemId === currentItemId) ?? null : null),
    [shelf, currentItemId],
  );
  const current = view === 'update' ? currentItem : (view === 'add' ? add.resolved?.book ?? null : null);

  const actions = useMemo(() => ({
    noteActivity, done, retry, openHistory, back, startAdd,
    typeIsbn, lookup, retryLookup, confirmCover, choose, submitPage, submitDay,
    openItem, openDuplicate, submitProgress, checkIn, finish, setAside, setMode,
  }), [
    noteActivity, done, retry, openHistory, back, startAdd,
    typeIsbn, lookup, retryLookup, confirmCover, choose, submitPage, submitDay,
    openItem, openDuplicate, submitProgress, checkIn, finish, setAside, setMode,
  ]);

  return {
    view,
    step,
    shelf,
    // The household study day the server read the shelf on (`YYYY-MM-DD`),
    // or null from a server that did not say. The panel's "Today".
    studyDay: typeof shelf?.studyDay === 'string' && shelf.studyDay ? shelf.studyDay : null,
    learner,
    error,
    busy,
    current,
    add: {
      entry: add.entry,
      check,
      hint,
      canSubmit,
      canRetry: add.canRetry,
      resolved: add.resolved,
      duplicateOf: add.duplicateOf,
      entryId: add.entryId,
      progressEntryId: add.progressEntryId,
      finishedOn: add.finishedOn,
    },
    update: { entryId: updateEntryId },
    actions,
  };
}

export default useBookShelf;
