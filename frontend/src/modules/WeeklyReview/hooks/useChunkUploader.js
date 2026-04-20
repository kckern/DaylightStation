import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { putChunk, markChunkUploaded, getChunksForSession, purgeExpired } from './chunkDb.js';

// M4: Lazy logger — avoids import-time timing issues
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'weekly-review-uploader' });
  return _logger;
}

const CHUNK_ENDPOINT = '/api/v1/weekly-review/recording/chunk';
const MAX_BACKOFF_MS = 30_000;

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  // btoa requires binary string; use chunked conversion to avoid call-stack limits on large blobs
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useChunkUploader({ sessionId, week }) {
  const [status, setStatus] = useState('idle'); // idle|syncing|offline|saved
  const [pendingCount, setPendingCount] = useState(0);
  const [lastAckedAt, setLastAckedAt] = useState(null);
  const [ackedSeq, setAckedSeq] = useState(-1);

  const queueRef = useRef([]);     // in-memory { seq, blob } queue
  const busyRef = useRef(false);
  const backoffRef = useRef(1000);
  const aliveRef = useRef(true);
  // C1: Single pending retry timer — cancellation prevents pile-up
  const retryTimerRef = useRef(null);
  // I3: Pre-encoded base64 cache keyed by seq — so beaconFlush is synchronous
  const base64CacheRef = useRef(new Map());

  // C1: Clear retry timer on unmount alongside aliveRef
  useEffect(() => {
    aliveRef.current = true;
    // Best-effort retention cleanup on mount
    purgeExpired().then(n => {
      if (n > 0) logger().info('chunks.purged-expired', { count: n });
    }).catch(err => logger().warn('chunks.purge-failed', { error: err.message }));
    return () => {
      aliveRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  const drain = useCallback(async () => {
    // C1: Cancel any pending retry — we are draining NOW; no need for a stale timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (busyRef.current) return;
    if (queueRef.current.length === 0) {
      setStatus(prev => prev === 'syncing' ? 'saved' : prev);
      return;
    }
    busyRef.current = true;
    setStatus('syncing');

    const next = queueRef.current[0];
    try {
      const chunkBase64 = await blobToBase64(next.blob);
      const resp = await fetch(CHUNK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, seq: next.seq, week, chunkBase64 }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await resp.json();

      // Success — mark IndexedDB row uploaded and pop queue
      await markChunkUploaded({ sessionId, seq: next.seq });
      queueRef.current.shift();
      // I3: Evict from base64 cache after successful upload
      base64CacheRef.current.delete(next.seq);
      backoffRef.current = 1000;
      setAckedSeq(next.seq);
      setLastAckedAt(Date.now());
      setPendingCount(queueRef.current.length);
      logger().info('chunk.uploaded', { sessionId, seq: next.seq, pending: queueRef.current.length });
      busyRef.current = false;
      if (aliveRef.current) drain();
    } catch (err) {
      logger().warn('chunk.upload-failed', { sessionId, seq: next.seq, error: err.message, backoffMs: backoffRef.current });
      setStatus('offline');
      busyRef.current = false;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      // C1: Ensure only one pending retry timer exists at a time
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (aliveRef.current) drain();
      }, delay);
    }
  }, [sessionId, week]);

  const enqueue = useCallback(async ({ seq, blob }) => {
    // M7: Synchronously push to in-memory queue FIRST — queue is authoritative for pending state.
    // This prevents tail chunks from being missed if stop/finalize drains immediately.
    queueRef.current.push({ seq, blob });
    setPendingCount(queueRef.current.length);
    // I3: Start base64 encoding in background so beaconFlush has it synchronously ready
    blobToBase64(blob).then(b64 => {
      base64CacheRef.current.set(seq, b64);
      // Evict old entries to keep cache bounded (keep last 10 seqs)
      if (base64CacheRef.current.size > 10) {
        const oldestSeq = Math.min(...base64CacheRef.current.keys());
        base64CacheRef.current.delete(oldestSeq);
      }
    }).catch(err => logger().warn('chunk.b64-precompute-failed', { seq, error: err.message }));
    // Layer 2 durability: write to IndexedDB with retry (parallel to queue work)
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await putChunk({ sessionId, seq, week, blob, uploaded: false });
          logger().info('chunk.saved-local', { sessionId, seq, bytes: blob.size, attempt });
          return;
        } catch (err) {
          if (attempt === 2) {
            logger().error('chunk.save-local-failed-final', { sessionId, seq, error: err.message });
          } else {
            logger().warn('chunk.save-local-retry', { sessionId, seq, attempt, error: err.message });
            await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          }
        }
      }
    })();
    drain();
  }, [sessionId, week, drain]);

  const flushNow = useCallback(() => { drain(); }, [drain]);

  // I3: beaconFlush is now fully synchronous — no awaits — uses precomputed base64 cache
  const beaconFlush = useCallback(() => {
    // Best-effort: send up to the next 3 pending chunks via sendBeacon.
    // sendBeacon is fire-and-forget; IndexedDB still has them for next load if they don't arrive.
    // Synchronous — no await allowed inside pagehide handlers (browser gives very limited time).
    const toSend = queueRef.current.slice(0, 3);
    for (const item of toSend) {
      const b64 = base64CacheRef.current.get(item.seq);
      if (!b64) {
        // Encoding hasn't finished yet — IndexedDB will recover on next mount
        logger().warn('chunk.beacon-skipped-no-b64', { sessionId, seq: item.seq });
        continue;
      }
      try {
        const payload = JSON.stringify({ sessionId, seq: item.seq, week, chunkBase64: b64 });
        const beaconBlob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(CHUNK_ENDPOINT, beaconBlob);
        logger().info('chunk.beacon-sent', { sessionId, seq: item.seq });
      } catch (err) {
        logger().warn('chunk.beacon-failed', { sessionId, seq: item.seq, error: err.message });
      }
    }
  }, [sessionId, week]);

  // C2: recoverLocal merges recovered chunks with any already-queued chunks, then sorts by seq
  // to prevent out-of-order delivery when enqueue and recoverLocal are called concurrently.
  const recoverLocal = useCallback(async () => {
    try {
      const rows = await getChunksForSession(sessionId);
      const unuploaded = rows.filter(r => !r.uploaded);
      if (unuploaded.length === 0) return { recovered: 0 };
      logger().info('chunks.recover-local', { sessionId, count: unuploaded.length });
      // Merge recovered chunks with any already-queued chunks, then sort by seq
      const merged = [
        ...unuploaded.map(r => ({ seq: r.seq, blob: r.blob })),
        ...queueRef.current,
      ];
      merged.sort((a, b) => a.seq - b.seq);
      // Dedupe by seq (in case the same seq is both queued in memory and in IndexedDB)
      const deduped = [];
      const seenSeqs = new Set();
      for (const item of merged) {
        if (seenSeqs.has(item.seq)) continue;
        seenSeqs.add(item.seq);
        deduped.push(item);
      }
      queueRef.current = deduped;
      setPendingCount(queueRef.current.length);
      drain();
      return { recovered: unuploaded.length };
    } catch (err) {
      logger().error('chunks.recover-local-failed', { sessionId, error: err.message });
      return { recovered: 0, error: err.message };
    }
  }, [sessionId, drain]);

  return {
    enqueue,
    flushNow,
    beaconFlush,
    recoverLocal,
    status,
    pendingCount,
    lastAckedAt,
    ackedSeq,
  };
}
