import { join } from 'node:path';
import { YamlPianoPieceLogStore } from '../adapters/persistence/YamlPianoPieceLogStore.mjs';
import { PianoPieceLog } from '../application/PianoPieceLog.mjs';

/**
 * The dated whole-piece certification log (`users/{id}/apps/piano/piece-log.yml`).
 * The store reads its file on every call, so the coach service (writer) and the
 * achievement provider (reader) may each build their own.
 */
export function createPianoPieceLog({ configService, logger = null }) {
  return new PianoPieceLog({
    store: new YamlPianoPieceLogStore({ usersDir: join(configService.getDataDir(), 'users') }),
    logger: logger?.child?.({ component: 'piano-piece-log' }) ?? logger,
  });
}

export default createPianoPieceLog;
