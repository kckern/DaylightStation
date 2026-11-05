import { join } from 'node:path';
import { YamlPianoAttemptStore } from "../adapters/persistence/YamlPianoAttemptStore.mjs";
import { DataServicePianoGameRepository } from "../adapters/game-platform/DataServicePianoGameRepository.mjs";
import { createPianoAchievementProvider } from "../application/PianoAchievementProvider.mjs";
import { createPianoRungLog } from "./rungLog.mjs";

/**
 * The piano's provider for the economy's achievement evidence
 * (CompositeAchievementEvidence). Pass the process's rung log and the
 * piano-games repository when you have them (`pianoGamesModule.rungLog`,
 * `pianoGamesModule.repository`) so the parse caches are shared; either is
 * built from `dataService` otherwise.
 */
export function createPianoAchievementEvidence({
  configService, dataService, rootLogger = null,
  rungLog = null, gameHistory = null, attemptStore = null,
}) {
  const logger = rootLogger?.child?.({ module: 'piano-achievements' }) ?? rootLogger;
  return createPianoAchievementProvider({
    gameHistory: gameHistory ?? new DataServicePianoGameRepository({ dataService, configService }),
    attemptStore: attemptStore ?? new YamlPianoAttemptStore({ usersDir: join(configService.getDataDir(), 'users') }),
    rungLog: rungLog ?? createPianoRungLog({ dataService, logger }),
    logger,
  });
}

export default createPianoAchievementEvidence;
