import getLogger from '../../../lib/logging/Logger.js';
import { createPianoGameClient } from '../game-platform/api/createPianoGameClient.js';

const log = getLogger().child({ component: 'connect-four-api' });
const client = createPianoGameClient('connect-four', { logger: log });

export const fetchConnectFourConfig = (userId) => client.readConfig(userId);
export const saveConnectFourConfig = (userId, config) => client.writeConfig(userId, config);
export const fetchConnectFourLadder = (userId) => client.readLadder(userId);
export const requestConnectFourMove = ({ transcript, level, gameId, userId }) => client.requestMove({
  transcript, level, gameSessionId: gameId, userId,
});
export const saveConnectFourGame = (userId, record) => client.saveGame(userId, record);
export const archiveConnectFourGame = (record) => client.archiveGame(record);
