// usePracticeRecord.js — follows usePianoPreferences' load/gate/optimistic-PUT idiom.
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { isPersistentUser } from '../../pianoUser.js';
import { practiceKeyOf } from './practiceKey.js';

const fpMatches = (a, b) => !!a && !!b && a.measureCount === b.measureCount && a.xmlBytes === b.xmlBytes;

/**
 * usePracticeRecord — per-user, per-score practice history (wave-3 C).
 * Guests / no-user: no reads, no writes — the record stays {} and the
 * heuristic runs history-less (the backend 400s guest anyway).
 */
export default function usePracticeRecord({ scoreId, fingerprint }) {
  const { currentUser } = usePianoUser();
  const key = useMemo(() => practiceKeyOf(scoreId), [scoreId]);
  const [record, setRecord] = useState({});
  const [loaded, setLoaded] = useState(false);
  const recordRef = useRef(record); recordRef.current = record;
  const fpRef = useRef(fingerprint); fpRef.current = fingerprint;

  useEffect(() => {
    setRecord({}); setLoaded(false);
    if (!isPersistentUser(currentUser)) {
      // Guest AND null (roster pending/failed) both run history-less but LOADED —
      // a false `loaded` here parks Learn's auto-range forever (it gates on it).
      // When a pending roster resolves, `currentUser` changes and this re-runs.
      setLoaded(true);
      return undefined;
    }
    let cancelled = false;
    DaylightAPI(`api/v1/piano/users/${currentUser}/practice/${key}`)
      .then((res) => {
        if (cancelled) return;
        // A record for a different engraving describes measures that no longer
        // exist — run history-less; the first write replaces it server-side.
        setRecord(res && fpMatches(res.fingerprint, fpRef.current) ? res : {});
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) { setRecord({}); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [currentUser, key]);

  const put = useCallback((patch) => {
    if (!isPersistentUser(currentUser)) return;
    DaylightAPI(`api/v1/piano/users/${currentUser}/practice/${key}`, patch, 'PUT').catch(() => {});
  }, [currentUser, key]);

  /** One completed, non-voided gate cycle: attempts for every measure in the
   *  range; a pass wherever the cycle logged no wrong for that measure. */
  const recordCycle = useCallback(({ measureIndices, wrongMeasures, bucket }) => {
    if (!isPersistentUser(currentUser) || !measureIndices?.length) return;
    const touched = {};
    const next = { ...recordRef.current, fingerprint: fpRef.current, measures: { ...(recordRef.current.measures || {}) } };
    for (const m of measureIndices) {
      const k = String(m);
      const cur = next.measures[k]?.[bucket] || { attempts: 0, passes: 0 };
      const entry = { attempts: cur.attempts + 1, passes: cur.passes + (wrongMeasures?.has(m) ? 0 : 1) };
      next.measures[k] = { ...(next.measures[k] || {}), [bucket]: entry };
      touched[k] = next.measures[k];
    }
    setRecord(next);
    put({ fingerprint: fpRef.current, measures: touched });
  }, [currentUser, put]);

  /** Tier best for the current hands bucket; only improvements write. */
  const recordTierBest = useCallback(({ bucket, tier, score }) => {
    if (!isPersistentUser(currentUser)) return;
    const cur = recordRef.current?.polish?.[bucket]?.[tier];
    if (Number.isFinite(cur) && cur >= score) return;
    const polish = { ...(recordRef.current.polish || {}) };
    polish[bucket] = { ...(polish[bucket] || {}), [tier]: score };
    setRecord({ ...recordRef.current, polish });
    put({ fingerprint: fpRef.current, polish: { [bucket]: { [tier]: score } } });
  }, [currentUser, put]);

  // `persistent` is exposed so a CALLER can log why a write was skipped: from
  // outside the hook, a guest (nothing can ever persist) and a run that simply
  // wasn't an improvement are indistinguishable — both leave the record empty and
  // both no-op silently. It is NOT a gate callers should re-implement; recordCycle
  // and recordTierBest already refuse to write on their own.
  return { record, loaded, persistent: isPersistentUser(currentUser), recordCycle, recordTierBest };
}
