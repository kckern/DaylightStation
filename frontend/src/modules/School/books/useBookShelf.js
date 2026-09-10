/**
 * useBookShelf — the reading shelf's state machine (book-shelf UI design
 * §2–§5, §7).
 *
 * A child's code opens the shelf; this hook owns everything that happens on
 * it — the tiles, the update overlay, the combined cover/action add flow, the day-by-day history — so
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
 *    they carry no verdict, because on the keystroke they are just as likely
 *    the first ten of thirteen. There is no `Look it up` button to judge them
 *    any more, so the CATALOG does: see the auto-advance below, which asks
 *    early, moves the child only on a real hit, and offers `Use this number`
 *    when the catalog cannot settle it.
 *
 * 3. EVERY WRITE IS IDEMPOTENT. The client mints the `entryId` when an update opens or an ISBN
 *    resolves (and a second one for the add flow's first progress event), and the same ids ride every retry of that write. A double tap
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
import { recentFinishes } from './readingHistory.js';

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
  priorRead: null,
  entryId: null,
  progressEntryId: null,
  finishedOn: null,
  metadataMissing: false,
  lookupHint: null,
  canRetry: false,
  // A ten-digit entry the catalog could not settle. Offers the one button the
  // pad ever shows, and only for as long as the number stays unresolved.
  unconfirmed: false,
});

const mintId = () => crypto.randomUUID();

/**
 * The pad has no `Look it up` button, so the entry itself says when to go.
 * Two settles, because thirteen digits and ten are different claims.
 *
 * THIRTEEN is a number the child read off a book: the checksum decides it and
 * nothing is left to confirm, so this is only the pause that keeps the
 * finishing gesture from being a digit key (the same reason and the same
 * length as `Keypad`'s `AUTO_SUBMIT_SETTLE_MS`).
 */
const AUTO_ADVANCE_SETTLE_MS = 300;
/**
 * TEN is a guess. The first ten digits of a thirteen-digit number pass the
 * ISBN-10 checksum one time in eleven (see `isbn.js`), so a ten-digit entry
 * fires its lookup at once — hiding the round trip behind the typing — but
 * waits this long with no further key before it acts on the answer. A child
 * still typing has cancelled it long before it fires; a child who stopped at
 * an older book's ten waits about a second. Fire early, commit late.
 */
const SPECULATIVE_QUIET_MS = 1000;

/** Digits as `checkIsbn` reads them, so a memo of "already fired" compares like for like. */
const compactIsbn = (value) => String(value ?? '').replace(/[\s-]/g, '').toUpperCase();

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
export function useBookShelf({ learnerId, grant, idleTimeoutSeconds = 90, onExit, initialBookEntry = null, openAdd = false }) {
  // The panel door opens the shelf to TYPE a number, so the pad is the landing
  // — not the tiles with `Add a book` to find. A ref, and read only inside the
  // first load: it decides where that load lands and must not move the child
  // again on any later read.
  const openAddRef = useRef(openAdd);
  openAddRef.current = openAdd;
  const entryRef = useRef(initialBookEntry);
  entryRef.current = initialBookEntry;
  const consumedScan = useRef(false);
  const [view, setView] = useState('loading');
  const [step, setStep] = useState(null);
  const [shelf, setShelf] = useState(null);
  const [learner, setLearner] = useState({ id: learnerId, name: learnerId });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Freshness survives unrelated write errors (notably a failed Undo).
  const [needsRefresh, updateNeedsRefresh] = useState(true);
  const needsRefreshRef = useRef(true);
  const setNeedsRefresh = useCallback((needed) => {
    needsRefreshRef.current = needed;
    updateNeedsRefresh(needed);
  }, []);
  const [add, setAdd] = useState(EMPTY_ADD);
  const [currentItemId, setCurrentItemId] = useState(null);
  const [updateEntryId, setUpdateEntryId] = useState(null);
  const [receipt, setReceipt] = useState(null);
  // Bumped by every interaction; the idle timer re-arms off it.
  const [activity, setActivity] = useState(0);

  // Rule 1. Bumped by every close; an in-flight request whose generation has
  // moved on drops its answer.
  const genRef = useRef(0);
  const initialLoadRef = useRef(true);
  // Single in-flight write slot — a ref, because two taps land in one React
  // batch and both read the same stale `busy`.
  const workRef = useRef(false);
  // Single in-flight lookup slot, for the same reason: two taps on Look Up
  // both read `step === 'number'` before React has painted `lookup`.
  const lookupRef = useRef(false);
  // The entry auto-advance has already spent. It PERSISTS past the round trip
  // on purpose: `Wrong book? Edit number` and `back` both return to the pad
  // with the digits intact, and re-firing on the same number would walk the
  // child straight back into the cover they just rejected. Any keystroke that
  // makes the entry differ from this clears it, so deliberately retyping the
  // same number does fire again.
  const autoFiredFor = useRef(null);
  // The number a speculative fetch is already out for, so a rerender does not
  // ask twice. It is ONLY a de-duplicator: the answer reaches `lookup` as an
  // argument from the one call site that has decided to use it, never through
  // a cache `lookup` reads for itself. A shared cache would silently hand a
  // manual lookup, or a retry, an answer fetched for a different reason.
  const speculatedFor = useRef(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Mirrors, so the async paths read the latest state rather than a closure's.
  const viewRef = useRef(view); viewRef.current = view;
  const stepRef = useRef(step); stepRef.current = step;
  const shelfRef = useRef(shelf); shelfRef.current = shelf;
  const addRef = useRef(add); addRef.current = add;
  const itemRef = useRef(currentItemId); itemRef.current = currentItemId;
  const updateEntryRef = useRef(updateEntryId); updateEntryRef.current = updateEntryId;
  const receiptRef = useRef(receipt); receiptRef.current = receipt;

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
    setReceipt(null);
    onExitRef.current?.(reason);
  }, []);

  /** Back to the tiles with the add/update state cleared. */
  const toShelf = useCallback(() => {
    viewRef.current = 'shelf';
    setView('shelf');
    setStep(null);
    setAdd(EMPTY_ADD);
    setCurrentItemId(null);
    setUpdateEntryId(null);
  }, []);

  /** Start the required shelf and optional roster reads together. */
  const load = useCallback(async () => {
    const gen = genRef.current;
    setError(null);
    const shelfRequest = schoolApi.books.shelf(learnerId, grant);
    // Normalize this optional request immediately so even a rejecting test
    // double (the real API never rejects) cannot become an unhandled promise
    // while a failed shelf takes the early return below.
    const rosterRequest = Promise.resolve(schoolApi.roster()).catch(() => null);
    const shelfRes = await shelfRequest;
    if (genRef.current !== gen) return; // rule 1

    if (!shelfRes.ok || !shelfRes.data) {
      setError({
        message: receiptRef.current ? 'Saved. Your shelf could not refresh.' : messageOf(shelfRes, LOAD_FAILED_SENTENCE),
      });
      schoolLog.bookShelfError('shelf.failed', { status: shelfRes.status, learnerId });
      return;
    }
    setShelf(shelfRes.data);
    setNeedsRefresh(false);
    // An empty shelf has nothing else to show; the door said the child came to
    // type. Either way this is the FIRST load's decision alone.
    const firstEmpty = initialLoadRef.current
      && ((shelfRes.data.items ?? []).length === 0 || openAddRef.current);
    initialLoadRef.current = false;
    viewRef.current = firstEmpty ? 'add' : 'shelf';
    setView(viewRef.current);
    setStep(firstEmpty ? 'number' : null);

    // A roster outage cannot hold a valid shelf behind the loading screen.
    void rosterRequest.then((rosterRes) => {
      if (genRef.current !== gen) return;
      const members = Array.isArray(rosterRes?.data) ? rosterRes.data : (rosterRes?.data?.learners ?? []);
      const me = rosterRes?.ok ? members.find((m) => m?.id === learnerId) : null;
      setLearner({ id: learnerId, name: me?.name || learnerId });
    });
  }, [learnerId, grant, setNeedsRefresh]);

  /** Show persisted success immediately, then refresh the shelf beneath it. */
  const refetch = useCallback(async ({ receipt: nextReceipt = null } = {}) => {
    setNeedsRefresh(true);
    const gen = genRef.current;
    if (nextReceipt) {
      setReceipt(nextReceipt);
      viewRef.current = 'shelf';
      setView('shelf');
    }
    const res = await schoolApi.books.shelf(learnerId, grant);
    if (genRef.current !== gen) return; // rule 1
    if (res.ok && res.data) {
      setShelf(res.data);
      setNeedsRefresh(false);
      setError(null);
    } else {
      // The write landed; only the re-read failed. Show the shelf as it was
      // and say so, rather than stranding the child on the overlay.
      setError({ message: 'Saved. Your shelf could not refresh.' });
      schoolLog.bookShelfError('shelf.failed', { status: res.status, learnerId });
    }
    setStep(null);
    setAdd(EMPTY_ADD);
    setCurrentItemId(null);
    setUpdateEntryId(null);
    setReceipt(nextReceipt);
    viewRef.current = 'shelf';
    setView('shelf');
  }, [learnerId, grant, setNeedsRefresh]);

  useEffect(() => {
    genRef.current += 1;
    initialLoadRef.current = true;
    consumedScan.current = false;
    setNeedsRefresh(true);
    workRef.current = false;
    lookupRef.current = false;
    viewRef.current = 'loading';
    setView('loading');
    setShelf(null);
    setLearner({ id: learnerId, name: learnerId });
    setAdd(EMPTY_ADD);
    setCurrentItemId(null);
    setReceipt(null);
    setBusy(false);
    schoolLog.bookShelf('opened', { learnerId });
    load();
    return () => { genRef.current += 1; };
  }, [learnerId, load, setNeedsRefresh]);

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

  useEffect(() => {
    window.addEventListener('keydown', noteActivity);
    return () => window.removeEventListener('keydown', noteActivity);
  }, [noteActivity]);

  const done = useCallback(() => close('done'), [close]);

  const retry = useCallback(async () => {
    if (isClosed() || workRef.current) return;
    touch();
    workRef.current = true;
    setBusy(true);
    const gen = genRef.current;
    await load();
    if (gen !== genRef.current) return;
    workRef.current = false;
    setBusy(false);
  }, [load, touch]);


  const startAdd = useCallback(() => {
    if (viewRef.current !== 'shelf' || workRef.current || needsRefreshRef.current) return;
    touch();
    setError(null);
    autoFiredFor.current = null;
    speculatedFor.current = null;
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
    if (viewRef.current !== 'shelf' || workRef.current || needsRefreshRef.current) return;
    const item = shelfRef.current?.items?.find((i) => i.itemId === itemId);
    if (!item) return;
    if (item.projection?.status === 'finished') {
      touch();
      setCurrentItemId(itemId);
      viewRef.current = 'completed';
      setView('completed');
      return;
    }
    enterUpdate(item);
  }, [enterUpdate, touch]);

  // Consume only after a successful fresh shelf read. Existing mutations own all writes.
  useEffect(() => {
    const entry = entryRef.current;
    if (consumedScan.current || !entry?.isbn13 || !shelf || needsRefresh || busy || !['shelf', 'add'].includes(view)) return;
    consumedScan.current = true;
    const active = shelf.items?.find(item => item.bookId === entry.isbn13 && ['reading', 'unread'].includes(item.projection?.status));
    const finished = recentFinishes(shelf.items).find(item => item.bookId === entry.isbn13);
    if (active) { enterUpdate(active); return; }
    if (finished) {
      setCurrentItemId(finished.itemId); viewRef.current = 'completed'; setView('completed'); setStep(null); return;
    }
    const book = entry.book ?? { isbn13: entry.isbn13, title: null, authors: [], coverUrl: null };
    setAdd({ ...EMPTY_ADD, entry: entry.isbn13, resolved: { book }, metadataMissing: !entry.book, entryId: mintId(), progressEntryId: mintId() });
    viewRef.current = 'add'; setView('add'); setStep('cover');
    schoolLog.bookShelf('scan.seeded', { learnerId });
  }, [shelf, needsRefresh, busy, view, enterUpdate, learnerId]);

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
    if (v === 'update' || v === 'completed' || v === 'receipt') { touch(); setError(null); toShelf(); return; }
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
    if (s === 'page' || s === 'when') { setStep('cover'); return; }
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
    const had = addRef.current.entry.length;
    // The pad clears on a held ⌫ and on Escape from the scanner's keyboard,
    // and logs nothing itself (see NumberPad's header). Without this line a
    // wiped number is indistinguishable in the store from one never typed —
    // which is exactly what a fat-fingered clear looked like in the field.
    if (had > 0 && entry.length === 0) schoolLog.bookShelf('pad.cleared', { had });
    // Editing away from the number auto-advance already spent re-arms it, so
    // a child who backspaces and retypes the same ISBN is not left with a pad
    // that has no way out (there is no button to fall back on).
    if (autoFiredFor.current !== null && compactIsbn(entry) !== autoFiredFor.current) {
      autoFiredFor.current = null;
    }
    const before = checkIsbn(addRef.current.entry);
    const after = checkIsbn(entry);
    // The local-validation copy that fired — once per verdict, not per key.
    if (after.state === 'invalid' && !(before.state === 'invalid' && before.reason === after.reason)) {
      schoolLog.bookShelf('add.rejected', { reason: after.reason });
    }
    setAdd((a) => ({ ...a, entry, lookupHint: null, canRetry: false, unconfirmed: false }));
  }, [touch]);

  const lookup = useCallback(async ({ prefetched = null } = {}) => {
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
    // `prefetched` is the auto-advance handing over the answer it already has
    // (and has already judged good enough to move on). Nobody else supplies it.
    const res = await (prefetched ?? schoolApi.books.resolve(check.isbn13));
    if (genRef.current !== gen) return; // rule 1 — back() or close() already freed the slot
    lookupRef.current = false;

    const status = res?.data?.status ?? 'unavailable';
    schoolLog.bookShelf('lookup', { status, httpStatus: res?.status ?? 0 });

    const showConfirmation = (book, { metadataMissing = false } = {}) => {
      // Duplicate guard (design §5): already `reading` on this shelf points
      // at that item. A finished copy is not a duplicate — a re-read opens a
      // fresh item (PRD S9).
      const dup = shelfRef.current?.items?.find(
        (i) => i.bookId === book.isbn13 && ['reading', 'unread'].includes(i.projection?.status),
      ) ?? null;
      setAdd((a) => ({
        ...a,
        resolved: { ...(res.data ?? {}), book },
        duplicateOf: dup?.itemId ?? null,
        priorRead: recentFinishes(shelfRef.current?.items).find(item => item.bookId === book.isbn13) ?? null,
        entryId: mintId(), progressEntryId: mintId(),
        metadataMissing,
      }));
      setStep('cover');
    };
    if (status === 'ok' && res.data.book) {
      showConfirmation(res.data.book);
      return;
    }
    if (status === 'not-found') {
      // The domain already checksum-validated and canonicalized this number.
      // A clean catalog miss may still be the real book in User_4's hands, so
      // confirmation continues with an honest placeholder instead of a fake
      // dead-end grown-up instruction. The backend independently validates
      // the ISBN again before accepting the shelf write.
      showConfirmation({
        isbn13: check.isbn13,
        title: null,
        subtitle: null,
        authors: [],
        description: null,
        coverUrl: null,
        pageCount: null,
      }, { metadataMissing: true });
      schoolLog.bookShelf('cover.unresolved', { reason: res.data?.reason ?? null });
      return;
    }
    // Every other outcome goes back to the pad WITH the number kept.
    let lookupHint;
    let canRetry = false;
    if (status === 'invalid') {
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

  /**
   * AUTO-ADVANCE. The ISBN pad has no submit button; a finished number is its
   * own instruction. `lookupHint` holds this off, so a verdict the child has
   * not answered yet is never talked over by another round trip.
   */
  useEffect(() => {
    if (view !== 'add' || step !== 'number' || busy || add.lookupHint) return undefined;
    const compact = compactIsbn(add.entry);
    if (autoFiredFor.current === compact) return undefined;
    const settled = checkIsbn(compact, { submit: true });
    if (settled.state !== 'valid') return undefined;

    // Thirteen digits, or a ten ending in `X` — a length that judges itself.
    if (checkIsbn(compact).state === 'valid') {
      const timer = setTimeout(() => {
        autoFiredFor.current = compact;
        void lookup();
      }, AUTO_ADVANCE_SETTLE_MS);
      return () => clearTimeout(timer);
    }

    // Ten bare digits. Ask now, decide when the typing stops.
    let live = true;
    if (speculatedFor.current?.isbn13 !== settled.isbn13) {
      speculatedFor.current = { isbn13: settled.isbn13, promise: schoolApi.books.resolve(settled.isbn13) };
    }
    const speculative = speculatedFor.current.promise;
    const timer = setTimeout(() => {
      void speculative.then((res) => {
        if (!live) return;
        // A CATALOG HIT IS THE CONFIRMATION. A ten that only passes the
        // checksum is as likely to be the front of someone's thirteen, and
        // that number names no book — so `not-found` advances nothing here,
        // where thirteen digits would carry it through on a placeholder.
        if (res?.data?.status === 'ok' && res.data.book) {
          autoFiredFor.current = compact;
          void lookup({ prefetched: res });
          return;
        }
        // The catalog cannot settle it, so ask the child instead of guessing.
        // A miss says NOTHING accusing — they may still be typing, and this is
        // also how a genuine ISBN-10 the catalog simply lacks gets logged, now
        // that there is no permanent button to fall back on.
        setAdd((a) => (compactIsbn(a.entry) === compact ? { ...a, unconfirmed: true } : a));
      }).catch(() => {});
    }, SPECULATIVE_QUIET_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [view, step, busy, add.entry, add.lookupHint, lookup]);

  const confirmCover = useCallback((yes) => {
    if (viewRef.current !== 'add' || stepRef.current !== 'cover') return;
    touch();
    schoolLog.bookShelf('cover', { accepted: Boolean(yes) });
    if (!yes) {
      // Provider ambiguity should cost one correction, not thirteen taps.
      setAdd((a) => ({ ...EMPTY_ADD, entry: a.entry }));
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
    // IDs were minted when lookup resolved; accepting never replaces them.
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
    const book = resolved.book;
    const nextReceipt = where === 'finished'
      ? {
        kind: 'finished', book, finishedOn: extra.finishedOn ?? null,
        itemId: res.data?.item?.itemId ?? null, undoEntryId: mintId(),
      }
      : where === 'partway'
        ? { kind: 'progress', book, page: extra.page ?? null }
        : { kind: 'added', book };
    await refetch({ receipt: nextReceipt });
    if (genRef.current !== gen) return; // rule 1 (close() already released)
    release();
  }, [learnerId, grant, refetch, release]);

  const choose = useCallback(async (where, finishedOn) => {
    if (viewRef.current !== 'add' || !['where', 'cover'].includes(stepRef.current) || workRef.current) return;
    if (addRef.current.duplicateOf) { openDuplicate(); return; }
    touch();
    setError(null);
    if (where === 'partway') { setStep('page'); return; }
    if (where === 'finished') {
      if (finishedOn) await openBook('finished', { finishedOn });
      else setStep('when');
      return;
    }
    if (where !== 'starting') return;
    await openBook('starting');
  }, [openBook, openDuplicate, touch]);

  const readAgain = useCallback(() => {
    if (viewRef.current !== 'completed') return;
    const item = shelfRef.current?.items?.find(i => i.itemId === itemRef.current);
    if (!item) return;
    touch();
    setError(null);
    const existing = shelfRef.current.items.find(i => i.bookId === item.bookId && ['reading', 'unread'].includes(i.projection?.status));
    if (existing) { enterUpdate(existing); return; }
    setAdd({ ...EMPTY_ADD, entry: item.bookId, resolved: { book: { ...item, isbn13: item.bookId } }, priorRead: item, rereading: true, entryId: mintId(), progressEntryId: mintId() });
    viewRef.current = 'add';
    setView('add');
    setStep('cover');
  }, [enterUpdate, touch]);

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
    const nextReceipt = event.kind === 'finished'
      ? {
        kind: 'finished', book: item, finishedOn: event.finishedOn ?? null,
        itemId, undoEntryId: mintId(),
      }
      : event.kind === 'set-aside'
        ? { kind: 'set-aside', book: item }
        : event.page
          ? { kind: 'progress', book: item, page: event.page }
          : event.minutes
            ? { kind: 'progress', book: item, minutes: event.minutes }
            : { kind: 'checkin', book: item };
    await refetch({ receipt: nextReceipt });
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

  /** Correct an accidental finish without deleting or rewriting evidence. */
  const undoFinish = useCallback(async () => {
    if (viewRef.current !== 'shelf' || workRef.current) return;
    const currentReceipt = receiptRef.current;
    if (currentReceipt?.kind !== 'finished' || !currentReceipt.itemId || !currentReceipt.undoEntryId) return;
    touch();
    workRef.current = true;
    setBusy(true);
    setError(null);
    const gen = genRef.current;
    const res = await schoolApi.books.progress(learnerId, grant, currentReceipt.itemId, {
      kind: 'reopened', entryId: currentReceipt.undoEntryId,
    });
    if (genRef.current !== gen) return;
    if (!res.ok) {
      release();
      setError({ message: messageOf(res, WRITE_FAILED_SENTENCE) });
      schoolLog.bookShelfError('write.failed', {
        kind: 'reopened', itemId: currentReceipt.itemId, status: res.status,
      });
      return;
    }
    schoolLog.bookShelf('progress', { kind: 'reopened', itemId: currentReceipt.itemId });
    await refetch({ receipt: { kind: 'reopened', book: currentReceipt.book } });
    if (genRef.current !== gen) return;
    release();
  }, [learnerId, grant, refetch, release, touch]);

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
  const current = ['update', 'completed'].includes(view) ? currentItem : (view === 'add' ? add.resolved?.book ?? null : null);

  const actions = useMemo(() => ({
    noteActivity, done, retry, back, startAdd,
    typeIsbn, lookup, retryLookup, confirmCover, choose, submitPage, submitDay,
    openItem, openDuplicate, readAgain, submitProgress, checkIn, finish, setAside, undoFinish, setMode,
  }), [
    noteActivity, done, retry, back, startAdd,
    typeIsbn, lookup, retryLookup, confirmCover, choose, submitPage, submitDay,
    openItem, openDuplicate, readAgain, submitProgress, checkIn, finish, setAside, undoFinish, setMode,
  ]);

  return {
    view,
    step,
    shelf,
    // The household study day the server read the shelf on (`YYYY-MM-DD`),
    // or null from a server that did not say. The panel's "Today".
    studyDay: typeof shelf?.studyDay === 'string' && shelf.studyDay ? shelf.studyDay : null,
    // The oldest day the server will accept a finish on, straight from the
    // shelf read. Null from a server that did not say — the day picker then
    // draws the window it always did rather than inventing a floor of its own.
    earliestFinishDay: typeof shelf?.earliestFinishDay === 'string' && shelf.earliestFinishDay
      ? shelf.earliestFinishDay
      : null,
    learner,
    error,
    busy,
    needsRefresh,
    current,
    receipt,
    add: {
      entry: add.entry,
      check,
      hint,
      canSubmit,
      canRetry: add.canRetry,
      unconfirmed: add.unconfirmed,
      resolved: add.resolved,
      duplicateOf: add.duplicateOf,
      priorRead: add.priorRead,
      rereading: add.rereading,
      entryId: add.entryId,
      progressEntryId: add.progressEntryId,
      finishedOn: add.finishedOn,
      metadataMissing: add.metadataMissing,
    },
    update: { entryId: updateEntryId },
    actions,
  };
}

export default useBookShelf;
