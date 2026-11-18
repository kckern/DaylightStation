import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketSubscription } from '../../../../../frontend/src/hooks/useWebSocket.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

const CAPABILITY = 'piano.karaoke';
const QUERY = 'api/v1/entitlements?capabilityId=piano.karaoke&subjectKind=learner&periodKind=interval';
export const KARAOKE_SCHOOL_MESSAGE = 'Karaoke opens when everyone has finished their schoolwork.';

// Every learner instance evaluates the SAME household count. Never select by
// the active profile, reuse a personal games grant, or accept not_applicable.
function readAccess(payload, now) {
  const items = (Array.isArray(payload?.items) ? payload.items : []).filter((item) => (
    item?.capabilityId === CAPABILITY && item.subject?.kind === 'learner'
    && item.period?.kind === 'interval'
    && /^school-day:\d{4}-\d{2}-\d{2}$/.test(item.period.id ?? '')
    && Number.isFinite(item.period.startsAt) && Number.isFinite(item.period.endsAt)
    && now >= item.period.startsAt && now < item.period.endsAt
  ));
  const unlocked = items.length > 0 && items.every((item) => (
    item.decision === 'granted' && item.basisState === 'satisfied' && item.degraded === false
    && Number.isFinite(item.validFrom) && item.validFrom <= now
    && (item.validUntil == null || (Number.isFinite(item.validUntil) && item.validUntil > now))
  ));
  const expiresAt = unlocked ? Math.min(...items.map((item) => (
    Math.min(item.period.endsAt, item.validUntil ?? Infinity)
  ))) : null;
  return { status: 'ready', unlocked, expiresAt };
}

/** A shared household decision; no profile exemptions and no purchased game passes. */
export default function useKaraokeSchoolAccess() {
  const [snapshot, setSnapshot] = useState({ status: 'loading', unlocked: false, expiresAt: null });
  const generation = useRef(0);
  const lastVerdict = useRef(null);
  const logger = useMemo(() => getLogger().child({ component: 'piano-karaoke-school-access' }), []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const payload = await DaylightAPI(QUERY);
      if (request !== generation.current) return;
      setSnapshot(readAccess(payload, Date.now()));
    } catch (error) {
      if (request !== generation.current) return;
      logger.warn('piano.karaoke-school.read-failed', { error: error?.message ?? String(error) });
      setSnapshot({ status: 'error', unlocked: false, expiresAt: null });
    }
  }, [logger]);
  const onStateGates = useCallback((event) => {
    const capability = event?.payload?.current?.capabilityId ?? event?.payload?.capabilityId;
    if (capability === CAPABILITY) {
      // A cached grant is no longer authoritative after its own invalidation.
      // Close now, even if the confirming HTTP read never returns.
      setSnapshot({ status: 'loading', unlocked: false, expiresAt: null });
    }
    if (!capability || capability === CAPABILITY) void refresh();
  }, [refresh]);
  useWebSocketSubscription('state-gates', onStateGates, [onStateGates]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      generation.current += 1;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Local expiration closes playback even when offline or a read never returns.
  useEffect(() => {
    if (!snapshot.unlocked || snapshot.expiresAt == null) return undefined;
    const timer = setTimeout(() => {
      setSnapshot({ status: 'loading', unlocked: false, expiresAt: null });
      void refresh();
    }, Math.max(0, snapshot.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [snapshot.unlocked, snapshot.expiresAt, refresh]);

  const unlocked = snapshot.unlocked && snapshot.expiresAt > Date.now();
  useEffect(() => {
    const signature = `${snapshot.status}:${unlocked}`;
    if (lastVerdict.current === signature) return;
    lastVerdict.current = signature;
    logger.info('piano.karaoke-school.verdict', { status: snapshot.status, unlocked });
  }, [snapshot.status, unlocked, logger]);
  return { ...snapshot, unlocked };
}
