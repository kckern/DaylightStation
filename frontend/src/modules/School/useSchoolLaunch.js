import { useCallback } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';

const TOPIC = 'school';
const LAUNCH_TYPE = 'school.launch';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'school-launch' });
  return _logger;
}

/**
 * useSchoolLaunch — the Portal-launch subscription (design §4.3).
 *
 * The backend hands a scan's on-screen work to whatever screen has School
 * mounted by broadcasting `{ type: 'school.launch', learnerId, target }` on
 * the shared WS bus, topic `school`. `target` names a runner (`{kind:'bank',
 * bankId, unitId, sessionId}` or `{kind:'program', program}`) but this hook
 * does not interpret it — it only claims the learner (the same soft-claim
 * the touch flow uses) and hands `target` to the caller. Routing into the
 * right section/runner is a SchoolApp concern, not this hook's.
 *
 * Malformed or unrelated messages (wrong `type`, missing `learnerId`/
 * `target`) are ignored — every household screen sees every broadcast, so a
 * message this hook cannot make sense of is the common case, not an error.
 *
 * @param {object} args
 * @param {(id: string) => void} args.claim - soft-claim the learner's identity
 * @param {(target: object) => void} args.onLaunch - route into the named runner
 */
export function useSchoolLaunch({ claim, onLaunch }) {
  const handle = useCallback((msg) => {
    const wellFormed = msg
      && msg.type === LAUNCH_TYPE
      && typeof msg.learnerId === 'string'
      && msg.learnerId.length > 0
      && msg.target
      && typeof msg.target === 'object';
    if (!wellFormed) {
      logger().debug('launch-ignored', { type: msg?.type });
      return;
    }

    const { learnerId, target } = msg;
    logger().info('launch-received', { kind: target.kind, learnerId });
    claim(learnerId);
    onLaunch(target);
  }, [claim, onLaunch]);

  useWebSocketSubscription(TOPIC, handle, [handle]);
}

export default useSchoolLaunch;
