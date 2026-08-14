import getLogger from '../../../lib/logging/Logger.js';
import { createPianoGameClient } from '../game-platform/api/createPianoGameClient.js';

export const checkersClient = createPianoGameClient('checkers', {
  logger: getLogger().child({ component: 'checkers-api' }),
  moveTimeoutMs: 5000,
});

export default checkersClient;
