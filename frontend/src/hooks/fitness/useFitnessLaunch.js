import { useCallback } from 'react';
import { useWebSocketSubscription } from '../useWebSocket.js';
import getLogger from '../../lib/logging/Logger.js';

const TOPIC = 'fitness';
const LAUNCH_TYPE = 'fitness.launch';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'fitness-launch' });
  return _logger;
}

/**
 * useFitnessLaunch — the garage-fitness launch subscription (DoNow design
 * §5, surface `garage-fitness`). Mirrors `useSchoolLaunch` (School's Portal
 * launch): the backend hands a scan's/parent's dispatch to whatever screen
 * has this hook mounted by broadcasting `{ type: 'fitness.launch', learnerId,
 * episodeId }` on the shared WS bus, topic `fitness`
 * (`backend/src/3_applications/donow/surfaces/GarageFitnessSurface.mjs`).
 *
 * This surface had ZERO remote reachability before this hook — the garage
 * kiosk only ever started an episode from an on-screen tap. `onLaunch` is
 * expected to navigate FitnessApp to `/fitness/play/<episodeId>` (the same
 * route `handlePlayFromUrl` already serves), so a dispatched episode plays
 * exactly like a manually-tapped one.
 *
 * Malformed or unrelated messages (wrong `type`, missing/empty `episodeId`)
 * are ignored — every household screen sees every broadcast, so a message
 * this hook cannot make sense of is the common case, not an error.
 *
 * `busy` mirrors the household's fail-toward-not-clobbering posture that
 * FitnessApp's own URL-driven restore effect already applies (it refuses to
 * touch a non-empty `fitnessPlayQueue`): pass whether a queue/episode is
 * already loaded. Ordinary launches arriving mid-session are dropped. A
 * School activity is different: it is a request, not an instruction to
 * clobber the player, so the kiosk asks the person standing there whether to
 * switch. Rejecting the prompt leaves the current session untouched. Kept HERE
 * (not as an ad hoc check in the caller) so the guard is exercised by this
 * hook's own tests rather than living only in FitnessApp.jsx.
 *
 * @param {object} args
 * @param {(episodeId: string, meta: {learnerId: string|null, schoolActivity?: object}) => void} args.onLaunch
 *   - navigate to the episode (e.g. `/fitness/play/${episodeId}`)
 * @param {boolean} [args.busy] - true when a queue/episode is already loaded;
 *   suppresses the launch instead of clobbering it (default false)
 * @param {(message: string) => boolean} [args.confirmSwitch]
 * @param {(schoolActivity: object, meta: {learnerId: string|null}) => void} [args.onSchoolDecline]
 */
export function useFitnessLaunch({
  onLaunch,
  busy = false,
  confirmSwitch = (message) => (typeof window !== 'undefined' ? window.confirm(message) : false),
  onSchoolDecline = null,
}) {
  const handle = useCallback((msg) => {
    const wellFormed = msg
      && msg.type === LAUNCH_TYPE
      && typeof msg.episodeId === 'string'
      && msg.episodeId.length > 0;
    if (!wellFormed) {
      logger().debug('launch-ignored', { type: msg?.type });
      return;
    }

    const { learnerId = null, episodeId, schoolActivity = null } = msg;

    if (busy) {
      if (schoolActivity?.workSessionId) {
        const accepted = confirmSwitch(`Switch to ${learnerId ? `${learnerId}'s ` : 'the '}School fitness lesson?`);
        if (!accepted) {
          logger().info('school-fitness-launch-declined', { learnerId, episodeId, workSessionId: schoolActivity.workSessionId });
          onSchoolDecline?.(schoolActivity, { learnerId });
          return;
        }
        logger().info('school-fitness-launch-switch-accepted', { learnerId, episodeId, workSessionId: schoolActivity.workSessionId });
      } else {
        logger().warn('fitness-launch-ignored-queue-active', { learnerId, episodeId });
        return;
      }
    }

    logger().info('launch-received', { learnerId, episodeId, schoolActivity: Boolean(schoolActivity) });
    onLaunch(episodeId, { learnerId, ...(schoolActivity ? { schoolActivity } : {}) });
  }, [onLaunch, busy, confirmSwitch, onSchoolDecline]);

  useWebSocketSubscription(TOPIC, handle, [handle]);
}

export default useFitnessLaunch;
