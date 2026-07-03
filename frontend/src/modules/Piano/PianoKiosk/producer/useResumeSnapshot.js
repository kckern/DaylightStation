/**
 * useResumeSnapshot — the lazy safety net (Task 8.2, design §6).
 *
 * While the transport plays, the live jam (+ song draft) is snapshotted to
 * localStorage every few bars. On the NEXT visit, if a recent, non-trivial
 * snapshot exists, the shell shows one quiet "Resume where you left off?" chip.
 * It NEVER auto-applies — proper saving stays an explicit act — and starting
 * anything new (CLEAR / new jam) clears it.
 *
 * WHAT'S IN THE SNAPSHOT: the whole `workspace` state and the `draft`. Take
 * layers embed their notes IN `workspace.layers[].source`, so recorded material
 * (not yet saved as a loop) survives verbatim. Library layers do NOT need their
 * notes snapshotted — they re-fetch by slug via the shell's ensureLayerNotes —
 * but including `notesById` makes resume instant, so we keep it WHEN IT FITS.
 *
 * QUOTA SAFETY (localStorage ~5MB): a stack with many take/library notes can
 * grow the payload. We try the full snapshot (with notesById); if it exceeds
 * MAX_SNAPSHOT_BYTES we retry WITHOUT notesById (library notes re-fetch, take
 * notes still ride in workspace.layers); if it STILL doesn't fit we skip the
 * write with a warn. Every localStorage access is try/catch'd — quota errors
 * and private-mode throws are swallowed. Corrupt JSON or a version mismatch on
 * read is treated as "no snapshot".
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';

export const SNAPSHOT_KEY = 'piano.producer.snapshot.v1';
export const SCHEMA_VERSION = 1;
/** Write cadence: once per this many bars while playing. */
export const SNAPSHOT_EVERY_BARS = 4;
/** Offer a resume only within this window (a day-old jam is stale context). */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Well under the 5MB localStorage quota — leaves room for every other key. */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-producer-resume' });
  return _logger;
}

function safeStringify(obj) {
  try { return JSON.stringify(obj); } catch { return null; }
}

/** A snapshot is worth offering only with real material to restore. */
function isNonTrivial(snap) {
  return !!(snap?.workspace?.layers?.length) || !!(snap?.draft?.sections?.length);
}

/** Serialize + write, dropping notesById if the payload is too fat, skipping
 * (with a warn) if even the lean form doesn't fit or the store throws. */
function persist(snap) {
  const base = {
    version: SCHEMA_VERSION,
    ts: Date.now(),
    workspace: snap.workspace,
    draft: snap.draft ?? null,
  };
  let json = safeStringify({ ...base, notesById: snap.notesById || {} });
  if (json && json.length > MAX_SNAPSHOT_BYTES) {
    // Library notes re-fetch by slug; takes live in workspace.layers — safe drop.
    json = safeStringify(base);
    logger().debug('piano.producer.resume.notes-dropped', {});
  }
  if (!json) return;
  if (json.length > MAX_SNAPSHOT_BYTES) {
    logger().warn('piano.producer.resume.too-large', { bytes: json.length });
    return;
  }
  try {
    localStorage.setItem(SNAPSHOT_KEY, json);
  } catch (err) {
    // QuotaExceededError, private-mode SecurityError, etc. — never fatal.
    logger().warn('piano.producer.resume.write-failed', { error: err?.message });
  }
}

/** Read + validate a stored snapshot; null on absent / corrupt / stale / wrong
 * version / trivial. Pure(ish) — used on mount and re-usable in tests. */
function readValid(maxAgeMs) {
  let raw = null;
  try { raw = localStorage.getItem(SNAPSHOT_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; } // corrupt JSON
  if (!parsed || parsed.version !== SCHEMA_VERSION) return null; // version mismatch
  if (!Number.isFinite(parsed.ts) || Date.now() - parsed.ts > maxAgeMs) return null; // stale
  if (!isNonTrivial(parsed)) return null;
  return parsed;
}

/**
 * @param {object} opts
 * @param {() => {workspace:object, draft:object|null, notesById?:object}} opts.getState
 *   current-state getter (called at each throttled write).
 * @param {boolean} opts.isPlaying transport play signal (writes only while true).
 * @param {number} opts.bar current bar (the throttle clock — writes when the
 *   4-bar bucket advances). Provide a value that updates ~per bar while playing.
 * @param {number} [opts.maxAgeMs] resume-offer window (default 24h).
 * @returns {{ hasResume:boolean, resumeData:object|null,
 *   applyResume:()=>object|null, dismiss:()=>void, clear:()=>void,
 *   snapshotNow:()=>void }}
 */
export function useResumeSnapshot({ getState, isPlaying, bar, maxAgeMs = DEFAULT_MAX_AGE_MS }) {
  const getStateRef = useRef(getState);
  getStateRef.current = getState;

  const [resumeData, setResumeData] = useState(null);
  const [hasResume, setHasResume] = useState(false);
  const resumeRef = useRef(null);
  resumeRef.current = resumeData;

  // Mount: detect a resumable snapshot (never auto-applies).
  useEffect(() => {
    const snap = readValid(maxAgeMs);
    if (snap) {
      setResumeData(snap);
      setHasResume(true);
      logger().info('piano.producer.resume.available', {
        layers: snap.workspace?.layers?.length ?? 0,
        sections: snap.draft?.sections?.length ?? 0,
        ageMs: Date.now() - snap.ts,
      });
    }
  }, [maxAgeMs]);

  const snapshotNow = useCallback(() => {
    let snap = null;
    try { snap = getStateRef.current?.(); } catch { snap = null; }
    if (!snap || !isNonTrivial(snap)) return; // nothing worth writing
    persist(snap);
  }, []);

  // Throttled write: fire when the SNAPSHOT_EVERY_BARS bucket advances while
  // playing. The rising edge (bucket 0 vs the reset -1) captures the start.
  const lastBucketRef = useRef(-1);
  useEffect(() => {
    if (!isPlaying) { lastBucketRef.current = -1; return; }
    const bucket = Math.floor((Number.isFinite(bar) ? bar : 0) / SNAPSHOT_EVERY_BARS);
    if (bucket === lastBucketRef.current) return;
    lastBucketRef.current = bucket;
    snapshotNow();
  }, [isPlaying, bar, snapshotNow]);

  const applyResume = useCallback(() => {
    const data = resumeRef.current;
    setHasResume(false);
    logger().info('piano.producer.resume.applied', {
      layers: data?.workspace?.layers?.length ?? 0,
      sections: data?.draft?.sections?.length ?? 0,
    });
    return data; // the shell dispatches loadStack + hydrate + restores notesById
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* private mode */ }
    setHasResume(false);
    setResumeData(null);
    resumeRef.current = null;
    logger().info('piano.producer.resume.dismissed', {});
  }, []);

  // clear() is dismiss() under a name that reads right at CLEAR / new-jam call
  // sites — same effect (wipe the stored snapshot + hide the chip).
  const clear = dismiss;

  return useMemo(() => ({
    hasResume, resumeData, applyResume, dismiss, clear, snapshotNow,
  }), [hasResume, resumeData, applyResume, dismiss, clear, snapshotNow]);
}

export default useResumeSnapshot;
