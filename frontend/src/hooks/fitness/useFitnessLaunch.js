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
 * @param {object} args
 * @param {(episodeId: string, meta: {learnerId: string|null}) => void} args.onLaunch
 *   - navigate to the episode (e.g. `/fitness/play/${episodeId}`)
 */
export function useFitnessLaunch({ onLaunch }) {
  const handle = useCallback((msg) => {
    const wellFormed = msg
      && msg.type === LAUNCH_TYPE
      && typeof msg.episodeId === 'string'
      && msg.episodeId.length > 0;
    if (!wellFormed) {
      logger().debug('launch-ignored', { type: msg?.type });
      return;
    }

    const { learnerId = null, episodeId } = msg;
    logger().info('launch-received', { learnerId, episodeId });
    onLaunch(episodeId, { learnerId });
  }, [onLaunch]);

  useWebSocketSubscription(TOPIC, handle, [handle]);
}

export default useFitnessLaunch;
