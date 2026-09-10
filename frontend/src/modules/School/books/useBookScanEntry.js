import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import { wsService } from '../../../services/WebSocketService';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { isPanelSurface } from '../schoolPathModel.js';

/** Retained anonymous preview. Busy work can defer it, never inherit its authority. */
export function useBookScanEntry({ screenId, safe, onLaunch }) {
  const enabled = isPanelSurface(screenId);
  const [intent, setIntent] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState(null);
  const state = useRef({ safe, screenId, onLaunch });
  state.current = { safe, screenId, onLaunch };
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
    if (!state.current.safe || !selected || claimLock.current || !['ready', 'not-found'].includes(selected.status)) return;
    const gen = generation.current;
    const claimToken = Symbol();
    claimLock.current = claimToken; setClaiming(true); setError(null);
    const result = await schoolApi.bookScans.claim(selected.id, { screenId, learnerId });
    if (claimLock.current !== claimToken) return;
    claimLock.current = false; setClaiming(false);
    if (gen !== generation.current || !state.current.safe || current.current?.id !== selected.id) return;
    if (!result.ok || result.data?.intentId !== selected.id || !result.data?.launchTarget?.bookGrant) {
      setError(result.data?.error?.message ?? 'Could not open this scan. Try again or rescan the book.');
      schoolLog.bookShelfError('scan.claim-failed', { status: result.status }); return;
    }
    remember(selected.id); current.current = null; setIntent(null);
    schoolLog.bookShelf('scan.launch', { screenId });
    state.current.onLaunch({ ...result.data.launchTarget, bookEntry: { ...result.data.bookEntry, intentId: selected.id } }, learnerId);
    void refresh();
  }, [screenId, refresh]);
  return { intent, claiming, error, claim, dismiss, enabled };
}
