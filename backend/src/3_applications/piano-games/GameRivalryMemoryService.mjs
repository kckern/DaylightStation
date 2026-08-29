const VERSION = 2;
const RECENT_LIMIT = 7;

const clean = (value, max = 96) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null;
const resultOf = (value) => ['win', 'loss', 'draw'].includes(value) ? value : 'draw';

export function rivalryOpponentId(record, gameId = null) {
  const explicit = clean(record?.opponent?.id, 80);
  if (explicit) return explicit;
  const level = Number(record?.opponent?.level ?? record?.level);
  if (!gameId || !Number.isFinite(level)) return null;
  const position = gameId === 'chess' ? level + 1 : Math.max(1, level);
  return `${gameId}:level-${position}`;
}

export function summarizeGameArchive(record, rulesetId = null) {
  const opponentId = rivalryOpponentId(record, rulesetId);
  const sessionId = clean(record?.game_id || record?.session_id, 128);
  if (!opponentId || !sessionId || !record?.completed) return null;
  const displayed = Array.isArray(record.dialogue) ? record.dialogue : record.commentary?.displayed;
  const finalLine = clean(displayed?.at?.(-1)?.quip || record.commentary?.final_line);
  return {
    gameId: sessionId,
    endedAt: clean(record.ended_at || record.archived_at || record.played_on, 40),
    result: resultOf(record.result),
    moves: Array.isArray(record.moves) ? record.moves.length : Number(record.move_count) || 0,
    notable: Array.isArray(record.notable) ? record.notable.map((item) => clean(item, 48)).filter(Boolean).slice(0, 3) : [],
    finalLine,
  };
}

function empty() { return { version: VERSION, rivals: {} }; }
function normalize(value) {
  if (!value?.rivals || typeof value.rivals !== 'object') return empty();
  const rivals = Object.fromEntries(Object.entries(value.rivals).map(([key, rival]) => {
    if (Array.isArray(rival?.recent) && rival.record) return [key, rival];
    const recent = Array.isArray(rival?.games) ? rival.games.slice(-RECENT_LIMIT) : [];
    const record = recent.reduce((totals, game) => {
      totals[resultOf(game.result)] += 1;
      return totals;
    }, { win: 0, loss: 0, draw: 0 });
    return [key, { opponent: rival?.opponent || { id: key }, record, recent }];
  }));
  return { version: VERSION, rivals };
}

/** Per-game memory keyed only by the stable opponent id. */
export class GameRivalryMemoryService {
  constructor({ readMemory, writeMemory, readLegacy = null, logger = null }) {
    this.readMemory = readMemory;
    this.writeMemory = writeMemory;
    this.readLegacy = readLegacy;
    this.logger = logger;
  }

  async load(gameId, userId) {
    let memory = normalize(await this.readMemory(gameId, userId));
    if (gameId === 'chess' && Object.keys(memory.rivals).length === 0 && this.readLegacy) {
      const legacy = normalize(await this.readLegacy(userId));
      if (Object.keys(legacy.rivals).length) {
        memory = legacy;
        await this.writeMemory(gameId, userId, memory);
      }
    }
    return memory;
  }

  async recall(gameId, userId, opponentId) {
    if (!userId || !opponentId) return null;
    const rival = (await this.load(gameId, userId)).rivals[opponentId];
    return rival ? { opponent: rival.opponent, record: rival.record, recent: rival.recent || [] } : null;
  }

  async recordArchive(gameId, record) {
    const userId = clean(record?.user_id, 80);
    const opponentId = rivalryOpponentId(record, gameId);
    const summary = summarizeGameArchive(record, gameId);
    if (!userId || !opponentId || !summary) return false;
    const memory = await this.load(gameId, userId);
    const old = memory.rivals[opponentId] || { record: { win: 0, loss: 0, draw: 0 }, recent: [] };
    const duplicate = old.recent?.some((game) => game.gameId === summary.gameId);
    if (duplicate) return true;
    const recordTotals = { win: 0, loss: 0, draw: 0, ...old.record };
    recordTotals[summary.result] += 1;
    memory.rivals[opponentId] = {
      opponent: { id: opponentId, name: clean(record.opponent.name, 40) },
      record: recordTotals,
      recent: [...(old.recent || []), summary].slice(-RECENT_LIMIT),
    };
    const saved = await this.writeMemory(gameId, userId, memory);
    this.logger?.info?.('piano-game.rivalry.recorded', { gameId, userId, opponentId, game: summary.gameId });
    return !!saved;
  }
}

export default GameRivalryMemoryService;
