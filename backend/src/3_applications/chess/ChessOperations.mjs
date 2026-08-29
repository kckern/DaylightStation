/** Cohesive chess use cases consumed by the Piano HTTP adapter. */
import { isValidFen } from '#shared/gaming/rulesets/chess/engine.mjs';

export class ChessOperations {
  constructor({
    engine,
    configuration,
    gameRecords = null,
    archive = null,
    ladder = null,
    commentary = null,
    rivalryMemory = null,
    analyst = null,
    logger = null,
  }) {
    this.engine = engine;
    this.configuration = configuration;
    this.gameRecords = gameRecords;
    this.archive = archive;
    this.ladder = ladder;
    this.commentary = commentary;
    this.rivalryMemory = rivalryMemory;
    this.analyst = analyst;
    this.logger = logger;
  }

  get analysisAvailable() { return !!this.analyst; }
  get commentaryAvailable() { return !!this.commentary; }
  get archiveAvailable() { return !!this.archive; }
  get ladderAvailable() { return !!this.ladder; }
  acceptsPosition(fen) { return isValidFen(fen); }

  async chooseMove({ userId, fen, rungId, level, gameId }) {
    const config = await this.configuration.read(userId);
    let rung;
    let opponent;
    if (level !== undefined && level !== null && this.ladder) {
      const resolved = await this.ladder.rungFor(userId, level);
      rung = resolved.rung;
      opponent = { source: 'ladder', level: resolved.level, name: resolved.opponent?.name || null };
    } else {
      rung = this.configuration.resolveRung(config, rungId || config.default_rung);
      opponent = { source: 'rung', level: null, name: null };
    }
    opponent.rung = {
      id: rung?.id || null,
      label: rung?.label || null,
      skill: rung?.skill ?? null,
      elo: rung?.elo ?? null,
      movetime_ms: rung?.movetime_ms ?? null,
      engine: rung?.engine ?? 'stockfish',
      depth: rung?.depth ?? null,
      blunder_rate: rung?.blunder_rate ?? null,
    };
    this.logger?.info?.('chess.move.requested', {
      userId,
      gameId: gameId || 'default',
      requested: { rung: rungId || null, level: level ?? null },
      effective: opponent,
    });
    return {
      move: await this.engine.chooseMove({ fen, rung, gameId: gameId || 'default' }),
      opponent,
    };
  }

  async analyze(fen, depth) {
    const evaluation = await this.analyst.evaluate(fen, depth ? { depth: Number(depth) } : undefined);
    if (evaluation.terminal || !evaluation.bestUci) {
      return { move: null, evaluation };
    }
    const uci = evaluation.bestUci;
    const move = { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) };
    this.logger?.info?.('chess.analyze.served', { depth: evaluation.depth ?? null, cp: evaluation.cp ?? null });
    return { move, evaluation };
  }

  react(input) { return this.commentary.react(input); }
  readConfiguration(userId) { return this.configuration.read(userId); }

  async updateConfiguration(userId, changes) {
    await this.configuration.writeUserLayer(userId, changes);
    return this.configuration.read(userId);
  }

  async recordGame(userId, record) {
    const saved = await this.gameRecords.save(userId, record);
    if (!saved) return { saved: false, ladder: null };
    return { saved: true, ladder: this.ladder ? await this.ladder.recordGame(userId, record) : null };
  }

  async archiveGame(record, userSegment) {
    const saved = await this.archive.save({ ...record, user_id: record.user_id || null }, userSegment);
    if (saved && record.completed && record.ended_by === 'game_over' && this.rivalryMemory) {
      await this.rivalryMemory.recordArchive(record);
    }
    return saved;
  }

  readLadder(userId) { return this.ladder.read(userId); }
}

export default ChessOperations;
