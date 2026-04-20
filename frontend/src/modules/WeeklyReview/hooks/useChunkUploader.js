import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { putChunk, markChunkUploaded, getChunksForSession, purgeExpired } from './chunkDb.js';

const logger = getLogger().child({ component: 'weekly-review-uploader' });
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

  useEffect(() => {
    aliveRef.current = true;
    // Best-effort retention cleanup on mount
    purgeExpired().then(n => {
      if (n > 0) logger.info('chunks.purged-expired', { count: n });
    }).catch(err => logger.warn('chunks.purge-failed', { error: err.message }));
    return () => { aliveRef.current = false; };
  }, []);

  const drain = useCallback(async () => {
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
      backoffRef.current = 1000;
      setAckedSeq(next.seq);
      setLastAckedAt(Date.now());
      setPendingCount(queueRef.current.length);
      logger.info('chunk.uploaded', { sessionId, seq: next.seq, pending: queueRef.current.length });
      busyRef.current = false;
      if (aliveRef.current) drain();
    } catch (err) {
      logger.warn('chunk.upload-failed', { sessionId, seq: next.seq, error: err.message, backoffMs: backoffRef.current });
      setStatus('offline');
      busyRef.current = false;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      setTimeout(() => { if (aliveRef.current) drain(); }, delay);
    }
  }, [sessionId, week]);

  const enqueue = useCallback(async ({ seq, blob }) => {
    // Layer 2 durability: write to IndexedDB synchronously FIRST
    try {
      await putChunk({ sessionId, seq, week, blob, uploaded: false });
      logger.info('chunk.saved-local', { sessionId, seq, bytes: blob.size });
    } catch (err) {
      logger.error('chunk.save-local-failed', { sessionId, seq, error: err.message });
      // Still try upload — in-memory blob is the only remaining copy
    }
    queueRef.current.push({ seq, blob });
    setPendingCount(queueRef.current.length);
    drain();
  }, [sessionId, week, drain]);

  const flushNow = useCallback(() => { drain(); }, [drain]);

  const beaconFlush = useCallback(async () => {
    // Best-effort: send up to the next 3 pending chunks via sendBeacon.
    // sendBeacon is fire-and-forget; we don't know if they succeed,
    // but IndexedDB still has them for next load if they don't.
    const toSend = queueRef.current.slice(0, 3);
    for (const item of toSend) {
      try {
        const chunkBase64 = await blobToBase64(item.blob);
        const payload = JSON.stringify({ sessionId, seq: item.seq, week, chunkBase64 });
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(CHUNK_ENDPOINT, blob);
        logger.info('chunk.beacon-sent', { sessionId, seq: item.seq });
      } catch (err) {
        logger.warn('chunk.beacon-failed', { sessionId, seq: item.seq, error: err.message });
      }
    }
  }, [sessionId, week]);

  // Recovery: on mount, replay unuploaded chunks that were left in IndexedDB.
  const recoverLocal = useCallback(async () => {
    try {
      const rows = await getChunksForSession(sessionId);
      const unuploaded = rows.filter(r => !r.uploaded);
      if (unuploaded.length === 0) return { recovered: 0 };
      logger.info('chunks.recover-local', { sessionId, count: unuploaded.length });
      for (const row of unuploaded) queueRef.current.push({ seq: row.seq, blob: row.blob });
      setPendingCount(queueRef.current.length);
      drain();
      return { recovered: unuploaded.length };
    } catch (err) {
      logger.error('chunks.recover-local-failed', { sessionId, error: err.message });
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
