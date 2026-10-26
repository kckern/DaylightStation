import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { projectCoach } from '../../../../../../../shared/music/learnCoach.mjs';
import { DaylightAPI } from '../../../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { usePianoKioskConfigOptional } from '../../PianoConfig.jsx';
import { practiceKeyOf } from './practiceKey.js';
import { coachScopeKey, createLearnCoachClient } from './learnCoachClient.js';

const request = (path, { method = 'GET', body } = {}) => DaylightAPI(path, body ?? {}, method);
const freshId = () => `coach-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const safeStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export default function useLearnCoach({ plan, legacy = {} }) {
  const { currentUser } = usePianoUser();
  const config = usePianoKioskConfigOptional()?.config;
  const timezone = config?.timezone;
  const scope = useMemo(() => ({ profileId: currentUser ?? 'guest', scoreId: plan.scoreId,
    scoreKey: practiceKeyOf(plan.scoreId), fingerprint: plan.fingerprint }), [currentUser, plan.scoreId, plan.fingerprint]);
  const key = coachScopeKey(scope);const scopeRef = useRef(key);scopeRef.current = key;
  const [snapshot, setSnapshot] = useState(null);
  const logger = useMemo(() => getLogger().child({ component: 'piano-learn-coach' }), []);
  const timezoneRef = useRef(timezone);timezoneRef.current = timezone;
  const dayKey = useCallback(() => timezoneRef.current
    ? new Intl.DateTimeFormat('en-CA', { timeZone: timezoneRef.current, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) : '', []);
  const [client] = useState(() => createLearnCoachClient({ request, storage: safeStorage(), logger, dayKey,
    onChange: (changedScope, value) => { if (coachScopeKey(changedScope) === scopeRef.current) setSnapshot({ ...value, key: coachScopeKey(changedScope) }); } }));
  useEffect(() => { client.load(scope, plan); }, [client, key, plan, scope]);
  useEffect(() => {
    const reconnect = () => { client.retry(scope).catch(() => {}); };
    globalThis.addEventListener?.('online', reconnect);
    return () => globalThis.removeEventListener?.('online', reconnect);
  }, [client, scope]);
  useEffect(() => () => client.dispose(), [client]);
  const active = snapshot?.key === key ? snapshot : { state: null, legacy: {}, loaded: currentUser === 'guest', saveStatus: currentUser === 'guest' ? 'guest' : 'loading' };
  const mergedLegacy = useMemo(() => ({ ...legacy, ...active.legacy }), [legacy, active.legacy]);
  const projection = useMemo(() => projectCoach({ plan, state: active.state, legacy: mergedLegacy, dayKey: dayKey() }), [plan, active.state, mergedLegacy, dayKey]);
  const send = useCallback((event) => client.enqueue(scope, event, plan).catch((error) => {
    logger.warn('piano.learn.queue-failed', { learnerId: scope.profileId, error: error.message });
    return { saveStatus: 'error' };
  }), [client, scope, plan, logger]);
  const record = useCallback((task, result) => send({ id: result.assessmentId ?? freshId(), type: 'outcome', task,
    result: { ...result, inputContractVersion: 'onsets-v1' } }), [send]);
  const selectTask = useCallback((task) => send({ id: freshId(), type: 'selection', task }), [send]);
  const retry = useCallback(() => client.retry(scope), [client, scope]);
  return { ...active, state: active.state ?? projection.state, projection, record, selectTask, retry, profileId: scope.profileId };
}
