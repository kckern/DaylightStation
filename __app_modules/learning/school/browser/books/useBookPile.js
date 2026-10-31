import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketSubscription } from "../../../../../frontend/src/hooks/useWebSocket.js";
import { wsService } from "../../../../../frontend/src/services/WebSocketService.js";
import { schoolApi } from "../schoolApi.js";
import { schoolLog } from "../schoolLog.js";
import { isPanelSurface } from "../schoolPathModel.js";

const FILEABLE = new Set(['ready', 'not-found']);

/**
 * The Portal pile (see `PrepareBookScan`): every scan as a card, one learner
 * files them all.
 *
 * THE STICKY READER FILES FROM HERE. Once a face has been tapped in a session,
 * later scans file to that child as they arrive — whether or not the panel is
 * `safe`, because it needs no tap. The ONE exception is an open shelf
 * (`scopeLearnerId`): that child's own scoped claim owns the scan, and filing
 * it here too would put the book on two shelves.
 *
 * The server is idempotent per card; the in-flight lock only saves requests.
 */
export function useBookPile({ screenId, scopeLearnerId = null }) {
  const enabled = isPanelSurface(screenId);
  const [pile, setPile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const reads = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const seq = ++reads.current;
    const gen = generation.current;
    let result;
    // Never reject: every caller fires this as `void refresh()`.
    try {
      result = await schoolApi.bookScans.pile(screenId);
    } catch (err) {
      schoolLog.bookShelfError?.('book-pile.read-failed', { error: err?.message ?? String(err) });
      return;
    }
    if (seq !== reads.current || gen !== generation.current) return;
    if (!result?.ok) { schoolLog.bookShelfError?.('book-pile.read-failed', { status: result?.status ?? null }); return; }
    setPile(result.data?.pile ?? null);
  }, [enabled, screenId]);

  useWebSocketSubscription('school', (msg) => {
    if (msg?.type === 'school.book-scan' && msg.screenId === screenId) void refresh();
  }, [screenId, refresh]);

  useEffect(() => {
    generation.current += 1;
    setPile(null); setError(null);
    void refresh();
    const unsubscribe = enabled ? wsService.onStatusChange((status) => { if (status.connected) void refresh(); }) : undefined;
    return () => { generation.current += 1; unsubscribe?.(); };
  }, [enabled, refresh]);

  const cards = useMemo(() => pile?.cards ?? [], [pile]);
  const unfiled = useMemo(() => cards.filter((card) => card.state === 'unfiled'), [cards]);

  // Lookups and filings settle server-side; poll while any is outstanding.
  const settling = cards.some((card) => card.status === 'loading' || card.state === 'filing');
  useEffect(() => {
    if (!settling) return undefined;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [settling, refresh]);

  // The session ends on the server after a quiet gap; re-read then so `live`
  // and `reader` drop without waiting for the next scan.
  useEffect(() => {
    if (!pile?.live || !pile.lastScanAt) return undefined;
    const due = Date.parse(pile.lastScanAt) + (pile.quietGapMs ?? 120000) - Date.now() + 250;
    const timer = setTimeout(() => void refresh(), Math.max(0, due));
    return () => clearTimeout(timer);
  }, [pile, refresh]);

  const run = useCallback(async (label, call) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const gen = generation.current;
    let result;
    try { result = await call(); } catch (err) { result = { ok: false, data: { error: { message: err?.message } } }; }
    inFlight.current = false; setBusy(false);
    if (gen !== generation.current) return;
    if (!result?.ok) {
      setError(result?.data?.error?.message ?? 'Could not file these books. Try again.');
      schoolLog.bookShelfError?.(`book-pile.${label}-failed`, { status: result?.status ?? null });
      return;
    }
    setPile(result.data?.pile ?? null);
    schoolLog.bookShelf(`book-pile.${label}`, { screenId, count: result.data?.pile?.cards?.length ?? 0 });
  }, [screenId]);

  const file = useCallback((learnerId) => run('filed', () => schoolApi.bookScans.filePile({ screenId, learnerId })), [run, screenId]);
  const move = useCallback((cardId, learnerId) => run('card-moved', () => schoolApi.bookScans.moveCard(cardId, { screenId, learnerId })), [run, screenId]);
  const remove = useCallback((cardId) => run('card-removed', () => schoolApi.bookScans.removeCard(cardId, { screenId })), [run, screenId]);

  const reader = pile?.reader ?? null;
  const autoFileable = !scopeLearnerId && reader && unfiled.some((card) => FILEABLE.has(card.status) && !card.error);
  useEffect(() => {
    if (autoFileable) void file(reader);
  }, [autoFileable, reader, file, unfiled]);

  return { cards, reader, live: Boolean(pile?.live), unfiled, busy, error, file, move, remove, enabled };
}
