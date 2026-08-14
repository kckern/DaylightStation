import { OpponentLadder } from '#domains/gaming/entities/OpponentLadder.mjs';

export class PianoGamesContainer {
  #games;
  #repository;
  #logger;

  constructor({ games, repository, logger = null }) {
    if (!games || !repository) throw new Error('PianoGamesContainer: games and repository required');
    this.#games = games;
    this.#repository = repository;
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
    if (record.ranked === false) return { saved: true, ladder: current.snapshot() };
    const ladder = current.record(record.result, record.level);
    await this.#repository.writeProgress(gameId, userId, {
      unlockedThrough: ladder.unlockedThrough,
      series: ladder.series,
    });
    return { saved: true, ladder: ladder.snapshot() };
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
