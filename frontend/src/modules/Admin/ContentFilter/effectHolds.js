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
 *
 * A fresh audit that disagrees is believed only when it answers a reload issued after the save
 * (`gen`): the audit digest is content-based, so a save that changes nothing leaves the audit fresh
 * and no stale answer ever comes. A hold also ends on its own 20 s after it began, saved or not.
 */

const SETTLE_TIMEOUT_MS = 20000;
const WRITE_TIMEOUT_MS = 15000;

// One chain per film: a timing autosave, an effect change and a card edit never race on one cue,
// and a click made while another write is out waits its turn instead of being dropped.
const chains = new Map();
export function queueWrite(rk, fn) {
  const key = String(rk);
  // A hung request must not stall every later write to the film: it rejects, and the chain moves on.
  // The request itself is not cancelled and may still land late; the queue only stops waiting for it.
  const bounded = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not answer this save in time. Check it, then try again.')), WRITE_TIMEOUT_MS);
    new Promise((r) => r(fn())).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
  // An idle film starts its write at once; a busy one waits for the tail.
  const prev = chains.get(key);
  const run = prev ? prev.then(bounded, bounded) : bounded();
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

export function useEffectHolds(raw, { rk, logger, gen = () => 0, now = () => Date.now() } = {}) {
  const holds = useRef({});
  const seq = useRef(0);
  // The newest click per part: a click is current until a later one replaces it (a hold that settled or timed out is still the latest).
  const latestSeq = useRef({});
  const [version, bump] = useReducer((n) => n + 1, 0);
  const notes = useRef([]);
  const rawRef = useRef(raw);
  rawRef.current = raw;

  const addNote = (rowId, text) => { notes.current = [...notes.current, { rowId, text, at: now() }]; };

  const hold = useCallback((rowId, to, label) => {
    seq.current += 1;
    latestSeq.current[rowId] = seq.current;
    const rowLabel = rawRef.current?.rows?.find?.((r) => r.id === rowId)?.label ?? null;
    holds.current = { ...holds.current, [rowId]: { to, label, rowLabel, seq: seq.current, at: now(), saved: null, afterGen: null } };
    bump();
    return seq.current;
  }, [now]);
  const isCurrent = useCallback((rowId, s) => latestSeq.current[rowId] === s, []);
  const drop = (rowId) => { const { [rowId]: _gone, ...rest } = holds.current; holds.current = rest; };
  const release = useCallback((rowId, s) => {
    if (holds.current[rowId]?.seq !== s) return;
    drop(rowId); bump();
  }, []);
  const saved = useCallback((rowId, s) => {
    const h = holds.current[rowId];
    if (!h || h.seq !== s) return;
    holds.current = { ...holds.current, [rowId]: { ...h, saved: now(), afterGen: gen() + 1 } };
  }, [now, gen]);
  const ackNotes = useCallback((upTo) => {
    const rest = notes.current.filter((n) => n.at >= upTo);
    if (rest.length === notes.current.length) return;
    notes.current = rest; bump();
  }, []);

  // Settle holds against what the server sends.
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
      } else if (fresh && gen() >= h.afterGen) {
        const playsAs = row ? (plays(row) ? 'unfiltered' : `as ${effectChip(row.effect).toLowerCase()}`) : null;
        logger?.info?.('content_filter.review.effect_resolved_differently', { rk, rowId, asked: h.to, plays: row ? (plays(row) ? 'off' : row.effect) : null, settleMs: now() - h.at });
        const part = row?.label ?? h.rowLabel;
        addNote(rowId, playsAs ? `${h.label} plays ${playsAs}${part ? ` on "${part}"` : ' on this part'}.` : `${h.label} saved; the part left this list.`);
        drop(rowId); changed = true;
      }
    }
    if (changed) bump();
  }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps

  // One timer, to the earliest deadline (measured from when each hold began, so later holds and
  // re-renders never push it out): a hold the audit never settles stops covering the row.
  useEffect(() => {
    const list = Object.values(holds.current);
    if (!list.length) return undefined;
    const deadline = Math.min(...list.map((h) => h.at)) + SETTLE_TIMEOUT_MS;
    const timer = setTimeout(() => {
      let changed = false;
      for (const [rowId, h] of Object.entries(holds.current)) {
        if (now() - h.at >= SETTLE_TIMEOUT_MS) {
          logger?.warn?.('content_filter.review.effect_unsettled', { rk, rowId, to: h.to, saved: Boolean(h.saved), waitedMs: now() - h.at });
          addNote(rowId, `${h.label} is taking long to confirm; showing what the server has.`);
          drop(rowId); changed = true;
        }
      }
      // A timer that fires a hair early leaves holds behind: re-arm for them.
      if (changed || Object.keys(holds.current).length) bump();
    }, Math.max(0, deadline - now()));
    return () => clearTimeout(timer);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => overlayHolds(raw, holds.current), [raw, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = notes.current;
  return { data, hold, isCurrent, release, saved, notes: list, note: list[list.length - 1] ?? null, ackNotes };
}
