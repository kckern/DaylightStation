import { OpponentLadder } from '#domains/gaming/entities/OpponentLadder.mjs';
import { normalizeOpponentRoster } from '#shared/gaming/opponents/profile.mjs';

export class PianoGamesContainer {
  #games;
  #repository;
  #logger;
  #dialogue;
  #rivalries;

  constructor({ games, repository, logger = null, dialogue = null, rivalries = null }) {
    if (!games || !repository) throw new Error('PianoGamesContainer: games and repository required');
    this.#games = games;
    this.#repository = repository;
    this.#logger = logger;
    this.#dialogue = dialogue;
    this.#rivalries = rivalries;
  }

  game(gameId) {
    const game = this.#games[gameId];
    if (!game) throw Object.assign(new Error('unknown_game'), { code: 'unknown_game' });
    return game;
  }

  async ladderAggregate(gameId, userId) {
    const game = this.game(gameId);
    const progress = userId ? await this.#repository.readProgress(gameId, userId) : null;
    const config = await this.#repository.readConfig(gameId, userId);
    const pack = config?.ladder?.roster_pack || gameId;
    const authored = config?.ladder?.rosters?.[pack];
    const roster = Array.isArray(authored) && authored.length === game.opponents.length
      ? game.opponents.map((mechanics, index) => ({ ...mechanics, ...authored[index], dialogue: { ...mechanics.dialogue, ...authored[index]?.dialogue } }))
      : game.opponents;
    return { ladder: new OpponentLadder({ opponents: normalizeOpponentRoster(roster, pack), progress, ...game.promotion }), rosterPack: pack };
  }

  async ladder(gameId, userId) {
    return (await this.ladderAggregate(gameId, userId)).ladder.snapshot();
  }

  async resolveOpponent(gameId, userId, level) {
    const { ladder, rosterPack } = await this.ladderAggregate(gameId, userId);
    const resolved = ladder.resolve(level);
    return { ...resolved, position: resolved.level, rosterPack };
  }

  async chooseMove(gameId, request) {
    const game = this.game(gameId);
    const resolved = await this.resolveOpponent(gameId, request.userId, request.level);
    const move = await game.opponentGateway.chooseMove({ ...request, level: resolved.level, opponent: resolved.opponent });
    this.#logger?.info?.('piano-game.opponent.move', { gameId, level: resolved.level, gameSessionId: request.gameSessionId });
    return { move, opponent: resolved };
  }

  async dialogue(gameId, request) {
    this.game(gameId);
    if (!this.#dialogue) throw Object.assign(new Error('dialogue_unavailable'), { code: 'dialogue_unavailable' });
    return this.#dialogue.react(gameId, request);
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
    this.game(gameId);
    const saved = await this.#repository.saveRecord(gameId, userId, record);
    if (!saved) return { saved: false, ladder: null };
    const current = (await this.ladderAggregate(gameId, userId)).ladder;
    // The offline-fallback flag is decided before the ladder ever sees the
    // game: Connect Four/Checkers set ranked: false the moment Wi-Fi drops
    // the real opponent, and there is nothing worth persisting about a game
    // the local engine partly played — a fresh read next time reproduces the
    // same unpromoted state. OpponentLadder.record() also accepts `ranked`
    // now (for callers, like a migrated Chess ladder, that want the game kept
    // in the series as a not-counted entry instead) — this caller just
    // doesn't need that history for an offline fallback.
    if (record.ranked === false) return { saved: true, ladder: current.snapshot() };
    const ladder = current.record(record.result, record.level, { help: record.help });
    await this.#repository.writeProgress(gameId, userId, {
      unlockedThrough: ladder.unlockedThrough,
      series: ladder.series,
    });
    return { saved: true, ladder: ladder.snapshot() };
  }

  async archiveGame(gameId, userSegment, record) {
    this.game(gameId);
    const archived = await this.#repository.saveArchive(gameId, userSegment, record);
    if (archived && record?.completed && record?.user_id) await this.#rivalries?.recordArchive?.(gameId, record);
    return archived;
  }

  dispose() {
    for (const game of Object.values(this.#games)) game.opponentGateway.dispose?.();
  }
}

export default PianoGamesContainer;
