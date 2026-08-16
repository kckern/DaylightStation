import getLogger from '../../../lib/logging/Logger.js';
import { createPianoGameClient } from '../game-platform/api/createPianoGameClient.js';

/**
 * Connect Four's transport. The HTTP grammar is the platform's; only the game
 * name is ours. Exported as the client itself rather than six wrapper functions
 * — the wrappers renamed `gameSessionId` to `gameId` and back on every call and
 * bought nothing for it.
 */
export const connectFourClient = createPianoGameClient('connect-four', {
  logger: getLogger().child({ component: 'connect-four-api' }),
});

export default connectFourClient;
