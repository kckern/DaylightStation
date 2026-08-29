import { OpponentLadder } from '#domains/gaming/entities/OpponentLadder.mjs';

export class PianoGamesContainer {
  #games;
  #repository;
  #boardGameDayService;
  #logger;

  constructor({ games, repository, boardGameDayService = null, logger = null }) {
    if (!games || !repository) throw new Error('PianoGamesContainer: games and repository required');
    this.#games = games;
    this.#repository = repository;
    this.#boardGameDayService = boardGameDayService;
    this.#logger = logger;
  }

  game(gameId) {
    const game = this.#games[gameId];
    if (!game) throw Object.assign(new Error('unknown_game'), { code: 'unknown_game' });
    return game;
  }

  async ladder(gameId, userId) {
    const game = this.game(gameId);
    const progress = userId ? await this.#repository.readProgress(gameId, userId) : null;
    return new OpponentLadder({ opponents: game.opponents, progress, ...game.promotion }).snapshot();
  }

  async chooseMove(gameId, request) {
    const game = this.game(gameId);
    const progress = request.userId ? await this.#repository.readProgress(gameId, request.userId) : null;
    const ladder = new OpponentLadder({ opponents: game.opponents, progress, ...game.promotion });
    const resolved = ladder.resolve(request.level);
    const move = await game.opponentGateway.chooseMove({ ...request, level: resolved.level, opponent: resolved.opponent });
    this.#logger?.info?.('piano-game.opponent.move', { gameId, level: resolved.level, gameSessionId: request.gameSessionId });
    return { move, opponent: resolved };
  }

  async readConfig(gameId, userId) {
    this.game(gameId);
    return this.#repository.readConfig(gameId, userId);
  }

  async writeConfig(gameId, userId, config) {
    this.game(gameId);
    await this.#repository.writeConfig(gameId, userId, config);
    return this.readConfig(gameId, userId);
  }

  async recordGame(gameId, userId, record) {
    const game = this.game(gameId);
    const saved = await this.#repository.saveRecord(gameId, userId, record);
    if (!saved) return { saved: false, ladder: null };
    const progress = await this.#repository.readProgress(gameId, userId);
    const current = new OpponentLadder({ opponents: game.opponents, progress, ...game.promotion });
    // The offline-fallback flag is decided before the ladder ever sees the
    // game: Connect Four/Checkers set ranked: false the moment Wi-Fi drops
    // the real opponent, and there is nothing worth persisting about a game
    // the local engine partly played — a fresh read next time reproduces the
    // same unpromoted state. OpponentLadder.record() also accepts `ranked`
    // now (for callers, like a migrated Chess ladder, that want the game kept
    // in the series as a not-counted entry instead) — this caller just
    // doesn't need that history for an offline fallback.
    const boardGameDay = this.#boardGameDayService?.record({
      learnerId: userId,
      gameId,
      gameSessionId: record.game_id,
      completed: record.completed,
      result: record.result,
    }) ?? null;
    if (record.ranked === false) return { saved: true, ladder: current.snapshot(), boardGameDay };
    const ladder = current.record(record.result, record.level, { help: record.help });
    await this.#repository.writeProgress(gameId, userId, {
      unlockedThrough: ladder.unlockedThrough,
      series: ladder.series,
    });
    return { saved: true, ladder: ladder.snapshot(), boardGameDay };
  }

  boardGameDay(userId) {
    if (!this.#boardGameDayService) return null;
    return this.#boardGameDayService.current(userId);
  }

  async archiveGame(gameId, userSegment, record) {
    this.game(gameId);
    return this.#repository.saveArchive(gameId, userSegment, record);
  }

  dispose() {
    for (const game of Object.values(this.#games)) game.opponentGateway.dispose?.();
  }
}

export default PianoGamesContainer;
