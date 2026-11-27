/**
 * Listened time: how much of an item was really heard, measured from the
 * progress reports every player already sends (play/log). Pure.
 *
 * Between two consecutive reports from one session, the listened time grows by
 *   min(Δposition, Δwall-clock × speed × SLACK)
 * only when the position moved forward and the reports are at most
 * `maxGapMs` apart (twice the report interval). So:
 * - normal play adds its time (Δposition ≈ Δwall × speed);
 * - a seek forward adds no more than the wall time that passed (a few seconds);
 * - a seek back, a pause or a gap (the app closed, a second device) adds nothing
 *   and starts a new run from the new report;
 * - playing at 1.5× counts 1.5 s of the book per wall second.
 *
 * Spec: ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md §13.
 *
 * @module playback/domain/listenedTime
 */

/** Players report about every 10 s (the phone's ProgressReporter, the web player). */
export const REPORT_INTERVAL_MS = 10_000;
/** A run breaks when two reports are further apart than this. */
export const MAX_GAP_MS = 2 * REPORT_INTERVAL_MS;
/** Tolerance for clocks and buffering: up to 10 % more than wall × speed. */
export const SLACK = 1.1;
const MAX_RATE = 4;

/** A usable playback speed (body `rate`); anything else is 1. */
export function normalizeRate(rate) {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 && n <= MAX_RATE ? n : 1;
}

/**
 * Fold one report into an item's listened time.
 *
 * @param {{listenedSec?: number, listenRun?: {key: string, pos: number, at: number}|null}|null} previous
 *   what the item's record holds (listenedSec undefined = never measured)
 * @param {{key: string, position: number, atMs: number, rate?: number}} report
 *   key: the session (a player's session id, else its device); position in seconds;
 *   atMs: when the position was heard (epoch ms)
 * @param {{maxGapMs?: number}} [opts]
 * @returns {{listenedSec: number, listenRun: {key: string, pos: number, at: number}, addedSec: number}}
 */
export function accumulateListened(previous, report, { maxGapMs = MAX_GAP_MS } = {}) {
  const before = Number(previous?.listenedSec) || 0;
  const run = previous?.listenRun ?? null;
  const key = String(report?.key ?? '');
  const position = Number(report?.position);
  const at = Number(report?.atMs);
  if (!Number.isFinite(position) || !Number.isFinite(at)) {
    return { listenedSec: before, listenRun: run, addedSec: 0 };
  }
  const next = { key, pos: position, at };
  // A report heard before the run's last one (kept offline, sent late) neither
  // counts nor moves the run back.
  if (run && run.key === key && Number(run.at) > at) {
    return { listenedSec: before, listenRun: run, addedSec: 0 };
  }
  let added = 0;
  if (run && run.key === key) {
    const dPos = position - Number(run.pos);
    const dWall = at - Number(run.at);
    if (dPos > 0 && dWall > 0 && dWall <= maxGapMs) {
      added = Math.min(dPos, (dWall / 1000) * normalizeRate(report.rate) * SLACK);
    }
  }
  return {
    listenedSec: Number((before + added).toFixed(3)),
    listenRun: next,
    addedSec: Number(added.toFixed(3)),
  };
}

export default { accumulateListened, normalizeRate, REPORT_INTERVAL_MS, MAX_GAP_MS, SLACK };
