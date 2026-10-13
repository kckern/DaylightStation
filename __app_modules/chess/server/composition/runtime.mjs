import { createChessResumeService } from "../application/ChessResumeService.mjs";
import { createStockfishEngine } from "../adapters/StockfishEngineAdapter.mjs";
import { createStockfishAnalyst } from "../adapters/StockfishAnalysisAdapter.mjs";
import { createChessConfigService } from "../application/ChessConfigService.mjs";
import { createChessLadderService } from "../application/ChessLadderService.mjs";
import { mergeLadderConfig } from "../../portable/ladder.mjs";
import { createChessRouter } from "../api/chess.mjs";
import { chessArchiveDayDir } from "../../portable/archivePaths.mjs";
import { buildChessArchiveFilename } from "../adapters/persistence/ChessRecordNames.mjs";

export function createChessRuntime({configService,dataService,rootLogger,server}) {
  // Chess: server-side Stockfish behind a worker thread + household/user config layers.
  const chessEngine = createStockfishEngine({ logger: rootLogger.child({ module: 'chess-engine' }) });
  // A SECOND engine, never handicapped, for hints and analysis. Separate from
  // the opponent because the bottom ladder rungs are no longer Stockfish at all
  // — asking the opponent engine for the best move would now return a
  // beginner's guess — and because the two want different UCI conversations:
  // one throttled bestmove out versus a scored search.
  const chessAnalyst = createStockfishAnalyst({
    depth: 14,
    logger: rootLogger.child({ module: 'chess-analyst' }),
  });
  server?.once?.('close', () => { chessEngine.dispose(); chessAnalyst.dispose(); });
  const chessConfigService = createChessConfigService({
    readHouseholdConfig: () => configService.getHouseholdAppConfig(null, 'chess'),
    readUserConfig: (userId) => dataService.user.read('apps/chess/config', userId) || {},
    writeUserConfig: (userId, data) => dataService.user.write('apps/chess/config', data, userId),
    logger: rootLogger.child({ module: 'chess-config' }),
  });
  const readChessLadderConfig = async (userId) => mergeLadderConfig(
    configService.getHouseholdAppConfig(null, 'chess') || {},
    userId ? (dataService.user.read('apps/chess/config', userId) || {}) : {},
  );
  const chessLadderService = createChessLadderService({
    readConfig: readChessLadderConfig,
    readProgress: (userId) => dataService.user.read('apps/chess/ladder', userId) || null,
    writeProgress: (userId, progress) => dataService.user.write('apps/chess/ladder', progress, userId),
    logger: rootLogger.child({ module: 'chess-ladder' }),
  });

  return {createRouter({pianoBoardGameDayService,sharedChessCommentary,sharedChessRivalry}) {
  // The server's copy of each player's unfinished game, so a reload, a cleared
  // localStorage or a deploy mid-game cannot lose it (see resumeSlot.mjs).
  const chessResumeService = createChessResumeService({
    readSlot: (userId) => dataService.user.read('apps/chess/resume', userId) || null,
    writeSlot: (userId, slot) => dataService.user.write('apps/chess/resume', slot, userId),
    readConfig: (userId) => chessConfigService.read(userId),
    logger: rootLogger.child({ module: 'chess-resume' }),
  });
  const pianoChessRouter = createChessRouter({
    engine: chessEngine,
    analyst: chessAnalyst,
    configService: chessConfigService,
    // The household archive: one file per game, under the day it was played,
    // named for the player. Household rather than per-user because it is the
    // instrument's history — the basis for comparing progress across the
    // children who share this piano, and the corpus the engine reads back when
    // asked where a game went wrong.
    archiveStore: {
      save: (record, userSegment) => {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(record.played_on || '')
          ? record.played_on
          : new Date().toISOString().slice(0, 10);
        return dataService.household.write(
          `${chessArchiveDayDir(day)}/${buildChessArchiveFilename(record, userSegment)}`,
          { ...record, archived_at: new Date().toISOString() },
        );
      },
    },
    resumeService: chessResumeService,
    ladderService: chessLadderService,
    commentaryService: sharedChessCommentary,
    rivalryMemory: sharedChessRivalry,
    boardGameDayService: pianoBoardGameDayService,
    logger: rootLogger.child({ module: 'chess-api' }),
  });

    return pianoChessRouter;
  }};
}
