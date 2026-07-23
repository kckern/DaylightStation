/**
 * Shared session plumbing for a graded runner (GeoQuizRunner). Mirrors the
 * hardened dance in QuizRunner/FlashcardRunner — single open gated on profile
 * `ready`, identity pinned at open, synchronous abandon on identity change,
 * 410 -> onExit, unrecorded surfacing — but is NEW code consumed only here;
 * the existing runners are intentionally NOT migrated.
 */
import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';

export function useGradedSession({ bank, mode, onExit }) {
  const { status, currentUser, isGuest } = useSchoolProfile();
  const [sessionId, setSessionId] = useState(null);
  const identityKey = currentUser?.id ?? (isGuest ? 'guest' : 'none');
  const initialIdentity = useRef(null);
  const sessionOpenedRef = useRef(false);
  const abandonedRef = useRef(false);

  useEffect(() => {
    if (initialIdentity.current === null) return;
    if (identityKey !== initialIdentity.current) {
      abandonedRef.current = true;
      schoolLog.session('end', { sessionId, bankId: bank.id, mode, reason: 'identity-changed' });
      onExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  useEffect(() => {
    if (status !== 'ready' || sessionOpenedRef.current) return;
    sessionOpenedRef.current = true;
    initialIdentity.current = identityKey;
    let alive = true;
    const userId = currentUser?.id ?? null;
    schoolApi.openSession({ userId, bankId: bank.id, mode }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { onExit(); return; }
      setSessionId(data.sessionId);
      schoolLog.session('start', { sessionId: data.sessionId, bankId: bank.id, mode, userId, itemCount: bank.items.length });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, identityKey]);

  const submit = async (itemId, given) => {
    if (!sessionId || abandonedRef.current) return null;
    const { ok, status: st, data } = await schoolApi.answer(sessionId, { itemId, given });
    if (abandonedRef.current) return null;
    if (st === 410) { onExit(); return null; }
    if (!ok) {
      schoolLog.answerError('record-failed', { sessionId, itemId, status: st });
      return { unrecorded: true };
    }
    schoolLog.answer('graded', { sessionId, itemId, correct: data.correct });
    return data;
  };

  return { sessionId, submit, status };
}

export default useGradedSession;
