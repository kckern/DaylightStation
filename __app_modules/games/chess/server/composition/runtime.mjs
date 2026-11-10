import { createChessResumeService } from "../application/ChessResumeService.mjs";
import { createStockfishEngine } from "../adapters/StockfishEngineAdapter.mjs";
import { createStockfishAnalyst } from "../adapters/StockfishAnalysisAdapter.mjs";
import { createChessConfigService } from "../application/ChessConfigService.mjs";
import { createChessLadderService } from "../application/ChessLadderService.mjs";
import { mergeLadderConfig } from "../../portable/ladder.mjs";
import { createChessRouter } from "../api/chess.mjs";
import { chessArchiveDayDir } from "../../portable/archivePaths.mjs";
import { buildChessArchiveFilename } from "../adapters/persistence/ChessRecordNames.mjs";

function noteRung(rungLog, change) {
  try { rungLog?.note?.(change); } catch { /* best-effort: never fails the write */ }
}

const addressingRung = (config) => {
  const value = config?.addressing?.ladder?.unlocked_through;
  return value === undefined ? null : value;
};

/**
 * The two chess writes that can raise a rung, with the raise noted.
 *
 * `rungLog` is the piano's dated promotion log (`createPianoRungLog`, a
 * `{ note({userId, game, ladder, from, to}) }`). Optional; when given, every
 * raise of the chess match ladder (`ladder.yml unlocked_through`, zero-based)
 * and of the chess addressing ladder (`config.yml
 * addressing.ladder.unlocked_through`) is noted with its date. Detected at the
 * writes themselves, so no ladder path can raise a rung unlogged. The note is
 * best-effort and runs after the write: it can never fail or undo it.
 */
export function createChessRungLoggedWriters({ configService, dataService, rungLog = null }) {
  const householdRung = () => addressingRung(configService.getHouseholdAppConfig(null, 'chess'));
  return {
    writeUserConfig(userId, data) {
      const before = addressingRung(dataService.user.read('apps/chess/config', userId)) ?? householdRung();
      const written = dataService.user.write('apps/chess/config', data, userId);
      if (written !== false) {
        noteRung(rungLog, { userId, game: 'chess', ladder: 'addressing', from: before, to: addressingRung(data) ?? householdRung() });
      }
      return written;
    },
    writeProgress(userId, progress) {
      const before = dataService.user.read('apps/chess/ladder', userId)?.unlocked_through ?? null;
      const written = dataService.user.write('apps/chess/ladder', progress, userId);
      if (written !== false) {
        noteRung(rungLog, { userId, game: 'chess', ladder: 'match', from: before, to: progress?.unlocked_through ?? null });
      }
      return written;
    },
  };
}

export function createChessRuntime({configService,dataService,rootLogger,server,rungLog = null}) {
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
  const rungLoggedWriters = createChessRungLoggedWriters({ configService, dataService, rungLog });
  const chessConfigService = createChessConfigService({
    readHouseholdConfig: () => configService.getHouseholdAppConfig(null, 'chess'),
    readUserConfig: (userId) => dataService.user.read('apps/chess/config', userId) || {},
    writeUserConfig: rungLoggedWriters.writeUserConfig,
    logger: rootLogger.child({ module: 'chess-config' }),
  });
  const readChessLadderConfig = async (userId) => mergeLadderConfig(
    configService.getHouseholdAppConfig(null, 'chess') || {},
    userId ? (dataService.user.read('apps/chess/config', userId) || {}) : {},
  );
  const chessLadderService = createChessLadderService({
    readConfig: readChessLadderConfig,
    readProgress: (userId) => dataService.user.read('apps/chess/ladder', userId) || null,
    writeProgress: rungLoggedWriters.writeProgress,
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
