import { useEffect, useRef } from 'react';
import { wsService } from '../../../../../frontend/src/services/WebSocketService.js';
import { coalescer, SCHOOL_REFRESH_EVENTS } from '../status/schoolRefreshEvents.js';

const SCHOOL_TOPICS = ['school'];

/** Read-model repair only. Launch commands and session/room semantics remain with their owners.
 * `events` can filter School event names; `source` injects the existing bus interface for tests.
 */
export function useSchoolInvalidation({
  refresh, learnerId = null, learnerIds = null, enabled = true, topics = SCHOOL_TOPICS, events = SCHOOL_REFRESH_EVENTS, source = wsService,
}) {
  const latest = useRef(refresh);
  latest.current = refresh;
  // Compatibility with callers injecting their source through events.
  const bus = typeof events?.subscribe === 'function' ? events : source;
  const names = typeof events?.subscribe === 'function' ? SCHOOL_REFRESH_EVENTS : events;
  const topicKey = JSON.stringify(topics);
  const learnersKey = learnerIds == null ? null : JSON.stringify([...learnerIds].sort());
  const namesKey = JSON.stringify([...names].sort());
  useEffect(() => {
    if (!enabled) return undefined;
    const eventNames = new Set(JSON.parse(namesKey));
    const learners = learnersKey == null ? null : new Set(JSON.parse(learnersKey));
    let active = true;
    const burst = coalescer(() => { if (active) latest.current(); });
    const unsubscribe = bus.subscribe(JSON.parse(topicKey), message => {
      const payload = message?.payload ?? message;
      const subject = payload?.subject ?? payload?.current?.subject ?? message?.evaluation?.subject;
      const who = payload?.learnerId ?? message?.learnerId ?? (subject?.kind === 'learner' ? subject.id : null);
      if (learnerId && who && learnerId !== who) return;
      if (learners && who && !learners.has(who)) return;
      const gateId = payload?.gateId ?? payload?.current?.gateId ?? message?.evaluation?.gateId;
      if (gateId) {
        if (gateId.startsWith('school.') || gateId === 'fitness.weekly-rings') burst.poke();
      } else if (eventNames.has(payload?.event ?? message?.event)) burst.poke();
    });
    let connected = bus.getStatus?.().connected;
    const unsubscribeStatus = bus.onStatusChange(status => {
      if (status.connected && connected === false) burst.poke();
      connected = status.connected;
    });
    const visible = () => { if (document.visibilityState === 'visible') burst.poke(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      burst.cancel();
      unsubscribe();
      unsubscribeStatus();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [bus, enabled, learnerId, learnersKey, topicKey, namesKey]);
}

export default useSchoolInvalidation;
