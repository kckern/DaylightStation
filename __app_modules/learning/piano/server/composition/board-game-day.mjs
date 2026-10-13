import { YamlPianoBoardGameDayStore } from '../adapters/persistence/YamlPianoBoardGameDayStore.mjs';
import { PianoBoardGameDayService } from '../application/game-platform/PianoBoardGameDayService.mjs';

export function createPianoBoardGameDayRuntime({configService,householdId,rootLogger}) {
  const pianoBoardGameDayStore = new YamlPianoBoardGameDayStore({
    historyRoot: configService.getHouseholdPath('history/piano-board-game-days', householdId),
  });
  const pianoBoardGameDayService = new PianoBoardGameDayService({
    store: pianoBoardGameDayStore,
    timezone: configService.getTimezone?.() || null,
    logger: rootLogger.child({ component: 'piano-board-game-day' }),
  });
  return pianoBoardGameDayService;
}
