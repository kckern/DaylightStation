import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { effectButton, plays } from './reviewScope.js';

/**
 * Effect changes show at once, and every write to one film goes out in order.
 *
 * The review list is the film's audit, and an effect change makes that audit stale: the reload
 * right after a change still carries the old effect, and the new one arrives a few seconds later
 * when the re-audit lands. The card used to show the old effect for those seconds, so the reviewer
 * pressed again (review 2026-11-23: Skip pressed twice on two parts, Blur four times on one).
 * A hold shows the chosen effect on its row until a fresh audit settles it: the same effect (the
 * hold goes), or a different one (the player does something else with it, and the page says so).
 */

const SETTLE_TIMEOUT_MS = 20000;

// One chain per film: a timing autosave, an effect change and a card edit never race on one cue,
// and a click made while another write is out waits its turn instead of being dropped.
const chains = new Map();
export function queueWrite(rk, fn) {
  const key = String(rk);
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => {}, () => {});
  chains.set(key, tail);
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}
/** Tests only: forget every chain (a test left holding a write must not stall the next). */
export const resetWriteQueues = () => chains.clear();
/** True while a write for this film is out or waiting (logged with a click, so a wait is visible). */
export const writesWaiting = (rk) => chains.has(String(rk));

/** Does a row from the server show the effect a hold asked for? */
export function holdSettled(row, to) {
  if (!row) return false;
  if (to === 'off') return plays(row);
  return !plays(row) && effectButton(row.effect) === to;
}

/** The rows with every held effect shown in place of the audit's. */
export function overlayHolds(data, holds) {
  const ids = Object.keys(holds);
  if (!data || !Array.isArray(data.rows) || !ids.length) return data;
  return {
    ...data,
    rows: data.rows.map((r) => {
      const h = holds[r.id];
      if (!h) return r;
      return h.to === 'off' ? { ...r, acts: false, effectHeld: true } : { ...r, effect: h.to, acts: true, effectHeld: true };
    }),
  };
}

export function useEffectHolds(raw, { rk, logger, now = () => Date.now() } = {}) {
  const holds = useRef({});
  const seq = useRef(0);
  const [version, bump] = useReducer((n) => n + 1, 0);
  const note = useRef(null);

  const hold = useCallback((rowId, to, label) => {
    seq.current += 1;
    holds.current = { ...holds.current, [rowId]: { to, label, seq: seq.current, at: now(), saved: null, sawStale: false } };
    bump();
    return seq.current;
  }, [now]);
  const isCurrent = useCallback((rowId, s) => holds.current[rowId]?.seq === s, []);
  const drop = (rowId) => { const { [rowId]: _gone, ...rest } = holds.current; holds.current = rest; };
  const release = useCallback((rowId, s) => {
    if (holds.current[rowId]?.seq !== s) return;
    drop(rowId); bump();
  }, []);
  const saved = useCallback((rowId, s) => {
    const h = holds.current[rowId];
    if (!h || h.seq !== s) return;
    holds.current = { ...holds.current, [rowId]: { ...h, saved: now() } };
  }, [now]);

  // Settle holds against what the server sends. A fresh audit that still shows the old effect is
  // only believed after a stale one was seen (a poll sent before the save can land after it).
  useEffect(() => {
    if (!raw || !Array.isArray(raw.rows)) return;
    const fresh = !raw.audit || raw.audit.fresh !== false;
    let changed = false;
    for (const [rowId, h] of Object.entries(holds.current)) {
      if (!h.saved) continue;
      const row = raw.rows.find((r) => r.id === rowId);
      if (holdSettled(row, h.to)) {
        logger?.info?.('content_filter.review.effect_settled', { rk, rowId, to: h.to, settleMs: now() - h.at });
        drop(rowId); changed = true;
      } else if (!fresh) {
        if (!h.sawStale) holds.current = { ...holds.current, [rowId]: { ...h, sawStale: true } };
      } else if (h.sawStale || !row) {
        const plays_ = row ? (plays(row) ? 'plays' : effectChip(row.effect)) : null;
        logger?.info?.('content_filter.review.effect_resolved_differently', { rk, rowId, asked: h.to, plays: row ? (plays(row) ? 'off' : row.effect) : null, settleMs: now() - h.at });
        note.current = { rowId, text: plays_ ? `${h.label} plays as ${plays_.toLowerCase()} on this part.` : `${h.label} saved; the part left this list.`, at: now() };
        drop(rowId); changed = true;
      }
    }
    if (changed) bump();
  }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hold the audit never settles stops covering the row (the reviewer sees what the server says).
  useEffect(() => {
    const ids = Object.keys(holds.current);
    if (!ids.length) return undefined;
    const timer = setTimeout(() => {
      let changed = false;
      for (const [rowId, h] of Object.entries(holds.current)) {
        if (h.saved && now() - h.saved >= SETTLE_TIMEOUT_MS) {
          logger?.warn?.('content_filter.review.effect_unsettled', { rk, rowId, to: h.to, waitedMs: now() - h.at });
          drop(rowId); changed = true;
        }
      }
      // Re-arm while any hold is left (a save can land after this timer was set).
      if (changed || Object.keys(holds.current).length) bump();
    }, SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => overlayHolds(raw, holds.current), [raw, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, hold, isCurrent, release, saved, note: note.current };
}
