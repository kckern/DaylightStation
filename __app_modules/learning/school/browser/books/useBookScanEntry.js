import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from "../../../../../frontend/src/hooks/useWebSocket.js";
import { wsService } from "../../../../../frontend/src/services/WebSocketService.js";
import { schoolApi } from "../schoolApi.js";
import { schoolLog } from "../schoolLog.js";
import { isPanelSurface } from "../schoolPathModel.js";

/**
 * Retained anonymous preview. Busy work can defer it, never inherit its authority.
 *
 * `scopeLearnerId` — THE ONE PLACE A SCAN IS ALREADY SOMEBODY'S (2026-09-30).
 * While a child's reading shelf is open, the shelf itself says "scan the
 * barcode": the learner is known, and asking "who's reading?" again — after
 * sending them home to be asked — was the bug. A scan that arrives then is
 * claimed for that child at once, once, when its lookup settles. Nothing else
 * about an anonymous scan changes: without a scope it still waits for `safe`.
 */
export function useBookScanEntry({ screenId, safe, onLaunch, scopeLearnerId = null, shelfLearnerId }) {
  const enabled = isPanelSurface(screenId);
  // `shelfLearnerId` — whose shelf is OPEN, ready for a barcode or not.
  // `scopeLearnerId` drops to null whenever the shelf is mid-step (a cover, an
  // update, a save, its own reload); only the shelf opening and closing may
  // decide which scan was "already waiting". Callers that do not pass it get
  // the old meaning (the scope is the shelf).
  const openLearnerId = shelfLearnerId === undefined ? scopeLearnerId : shelfLearnerId;
  const [intent, setIntent] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState(null);
  const state = useRef({ safe, screenId, onLaunch, scopeLearnerId, openLearnerId });
  state.current = { safe, screenId, onLaunch, scopeLearnerId, openLearnerId };
  // Intent ids a scoped claim has already been attempted for: a failed claim
  // says so once and is not retried on every poll.
  const scopedAttempts = useRef(new Set());
  const current = useRef(null);
  const seen = useRef(new Set());
  const generation = useRef(0);
  const reads = useRef(0);
  const claimLock = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const seq = ++reads.current;
    const gen = generation.current;
    // A POLL MUST NOT BECOME AN UNHANDLED REJECTION. `refresh` is fired from
    // three effects and a WebSocket handler, all as `void refresh()` — nothing
    // is holding the promise, so anything thrown in here escapes as an
    // unhandled rejection rather than an error the panel can report. The
    // `!result.ok` branch below only ever covered a request that came BACK.
    //
    // Caught live in the test run as three unhandled rejections
    // ("Cannot read properties of undefined (reading 'pending')"), but the
    // production shape is the same: a fetch that rejects on a dropped kiosk
    // connection took the same path. A failed poll costs this cycle's scan and
    // nothing else — the next one is a WebSocket message or 1.5s away.
    let result;
    try {
      result = await schoolApi.bookScans.pending(screenId);
    } catch (err) {
      // OPTIONAL CALL on purpose. The logger is real (`schoolLog.js`), but a
      // never-reject guard whose only statement can itself throw is not a
      // guard — it just moves the unhandled rejection one line down, which is
      // exactly what happened the first time this was written.
      schoolLog.bookShelfError?.('scan.pending-failed', { error: err?.message ?? String(err) });
      return;
    }
    if (seq !== reads.current || gen !== generation.current || claimLock.current) return;
    if (!result?.ok) { schoolLog.bookShelfError?.('scan.pending-failed', { status: result?.status ?? null }); return; }
    const next = result.data?.intent;
    const accepted = next?.screenId === screenId && !seen.current.has(next.id) && Date.parse(next.expiresAt) > Date.now() ? next : null;
    if (accepted && current.current && accepted.id !== current.current.id) {
      seen.current.add(current.current.id);
      if (seen.current.size > 32) seen.current.delete(seen.current.values().next().value);
    }
    current.current = accepted;
    setIntent(accepted);
  }, [enabled, screenId]);
  useWebSocketSubscription('school', msg => {
    if (msg?.type === 'school.book-scan' && msg.screenId === screenId) void refresh();
  }, [screenId, refresh]);
  useEffect(() => {
    generation.current += 1;
    current.current = null; setIntent(null); setError(null); setClaiming(false); claimLock.current = false;
    void refresh();
    const unsubscribe = enabled ? wsService.onStatusChange(status => { if (status.connected) void refresh(); }) : undefined;
    return () => { generation.current += 1; unsubscribe?.(); };
  }, [enabled, refresh]);
  const previousSafe = useRef(safe);
  useEffect(() => {
    if (previousSafe.current && !safe) generation.current += 1;
    previousSafe.current = safe;
    void refresh();
  }, [safe, refresh]);
  useEffect(() => {
    if (!intent) return undefined;
    const timer = setTimeout(() => {
      generation.current += 1; current.current = null; setIntent(null); setClaiming(false); claimLock.current = false;
      setError('This scan expired. Scan the book again.'); void refresh();
    }, Math.max(0, Date.parse(intent.expiresAt) - Date.now()));
    const poll = intent.status === 'loading' ? setInterval(refresh, 1500) : null;
    return () => { clearTimeout(timer); if (poll) clearInterval(poll); };
  }, [intent, refresh]);
  const remember = id => { seen.current.add(id); if (seen.current.size > 32) seen.current.delete(seen.current.values().next().value); };
  const dismiss = useCallback(async () => {
    const selected = current.current;
    if (!selected) return;
    generation.current += 1; reads.current += 1; remember(selected.id);
    current.current = null; setIntent(null); setClaiming(false); claimLock.current = false; setError(null);
    const result = await schoolApi.bookScans.dismiss(selected.id, { screenId });
    schoolLog.bookShelf('scan.dismissed', { ok: result.ok });
    void refresh();
  }, [screenId, refresh]);
  const claim = useCallback(async learnerId => {
    const selected = current.current;
    const allowed = () => state.current.safe || (learnerId && state.current.scopeLearnerId === learnerId);
    // Once the server has handed the book over it is no longer pending: a
    // shelf that stepped into a cover or an update meanwhile is still this
    // child's shelf, and it queues the book (`useBookShelf`). Dropping the
    // answer here would lose the book outright.
    const stillOwned = () => allowed() || (learnerId && state.current.openLearnerId === learnerId);
    if (!allowed() || !selected || claimLock.current || !['ready', 'not-found'].includes(selected.status)) return;
    const gen = generation.current;
    const claimToken = Symbol();
    claimLock.current = claimToken; setClaiming(true); setError(null);
    const result = await schoolApi.bookScans.claim(selected.id, { screenId, learnerId });
    if (claimLock.current !== claimToken) return;
    claimLock.current = false; setClaiming(false);
    if (gen !== generation.current || !stillOwned() || current.current?.id !== selected.id) return;
    if (!result.ok || result.data?.intentId !== selected.id || !result.data?.launchTarget?.bookGrant) {
      setError(result.data?.error?.message ?? 'Could not open this scan. Try again or rescan the book.');
      schoolLog.bookShelfError('scan.claim-failed', { status: result.status }); return;
    }
    remember(selected.id); current.current = null; setIntent(null);
    schoolLog.bookShelf('scan.launch', { screenId, scoped: state.current.scopeLearnerId === learnerId && !state.current.safe });
    // `receivedAt` (server clock) and `screenId` ride along so the shelf can
    // log how long the scan took to reach the screen (`scan.visible`).
    state.current.onLaunch({ ...result.data.launchTarget, bookEntry: { ...result.data.bookEntry, intentId: selected.id, receivedAt: selected.receivedAt ?? null, screenId } }, learnerId);
    void refresh();
  }, [screenId, refresh]);
  // A shelf only claims what is scanned WHILE it is open. A scan already
  // waiting when it FIRST opened belongs to the pile (another child's stack,
  // most likely); claiming it would launch this child's shelf with that book.
  // Keyed on the shelf opening, NOT on the scope: the scope goes null and back
  // every time the shelf leaves its scan-ready view, and seeding on that
  // marked every scan that arrived during a cover step as "already waiting"
  // (2026-11-05: two of four books lost that way).
  const openSeen = useRef(openLearnerId);
  const preOpen = useRef(new Set());
  useEffect(() => {
    if (openLearnerId && openSeen.current !== openLearnerId && current.current) preOpen.current.add(current.current.id);
    if (!openLearnerId) preOpen.current.clear();
    openSeen.current = openLearnerId;
  }, [openLearnerId]);
  useEffect(() => {
    if (!scopeLearnerId || !intent || claiming || !['ready', 'not-found'].includes(intent.status)) return;
    if (scopedAttempts.current.has(intent.id)) return;
    if (preOpen.current.has(intent.id)) {
      scopedAttempts.current.add(intent.id);
      schoolLog.bookShelfDebug?.('scan.scoped-claim-skipped', { screenId, learnerId: scopeLearnerId, reason: 'waiting-before-shelf-opened', isbn13: intent.isbn13 ?? null });
      return;
    }
    scopedAttempts.current.add(intent.id);
    schoolLog.bookShelf('scan.scoped-claim', { screenId, learnerId: scopeLearnerId, status: intent.status, isbn13: intent.isbn13 ?? null });
    void claim(scopeLearnerId);
  }, [scopeLearnerId, intent, claiming, claim, screenId]);
  // THE SCAN THE OPEN SHELF IS ABOUT TO TAKE (book-scan experience task 3):
  // landed after the shelf opened, while it is asking for a barcode (or its
  // claim is already in flight), and not yet tried and failed. The shelf says
  // "Got it — looking it up" for it at once. A scan that lands mid-step is
  // not this: it waits on the server, and the shelf counts it from the pile.
  const shelfScan = openLearnerId && intent && intent.screenId === screenId && !preOpen.current.has(intent.id)
    && intent.status !== 'invalid' && intent.status !== 'unavailable'
    && (claiming || (scopeLearnerId && !scopedAttempts.current.has(intent.id)))
    ? intent : null;
  return { intent, claiming, error, claim, dismiss, enabled, shelfScan };
}
