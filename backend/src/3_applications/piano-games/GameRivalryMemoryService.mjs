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

export function summarizeGameArchive(record, rulesetId = null, notableFacts = null) {
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
    notable: (Array.isArray(record.notable) ? record.notable : notableFacts?.(record) || [])
      .map((item) => clean(item, 48)).filter(Boolean).slice(0, 3),
    finalLine,
  };
}

function empty() { return { version: VERSION, rivals: {} }; }

function migratedChessId(key, rival) {
  if (rival?.opponent?.id) return clean(rival.opponent.id, 80);
  const level = Number(rival?.opponent?.level ?? String(key).match(/^level-(\d+)/)?.[1]);
  return Number.isFinite(level) ? `chess:level-${level + 1}` : clean(key, 80);
}

function normalize(value, gameId = null) {
  if (!value?.rivals || typeof value.rivals !== 'object') return empty();
  const rivals = {};
  for (const [key, rival] of Object.entries(value.rivals)) {
    const id = gameId === 'chess' ? migratedChessId(key, rival) : clean(rival?.opponent?.id, 80) || key;
    const all = Array.isArray(rival?.recent) ? rival.recent : Array.isArray(rival?.games) ? rival.games : [];
    const record = rival?.record || all.reduce((totals, game) => {
      totals[resultOf(game.result)] += 1;
      return totals;
    }, { win: 0, loss: 0, draw: 0 });
    const existing = rivals[id];
    const combined = [...(existing?.recent || []), ...all]
      .filter((game, index, list) => list.findIndex((item) => item?.gameId === game?.gameId) === index)
      .sort((a, b) => String(a?.endedAt || '').localeCompare(String(b?.endedAt || '')))
      .slice(-RECENT_LIMIT);
    rivals[id] = {
      opponent: { ...(rival?.opponent || {}), id },
      record: existing ? {
        win: Number(existing.record?.win || 0) + Number(record.win || 0),
        loss: Number(existing.record?.loss || 0) + Number(record.loss || 0),
        draw: Number(existing.record?.draw || 0) + Number(record.draw || 0),
      } : { win: Number(record.win || 0), loss: Number(record.loss || 0), draw: Number(record.draw || 0) },
      recent: combined,
    };
  }
  return { version: VERSION, rivals };
}

/** Per-game memory keyed only by the stable opponent id. */
export class GameRivalryMemoryService {
  constructor({ readMemory, writeMemory, readLegacy = null, notableFacts = {}, logger = null }) {
    this.readMemory = readMemory;
    this.writeMemory = writeMemory;
    this.readLegacy = readLegacy;
    this.notableFacts = notableFacts;
    this.logger = logger;
  }

  async load(gameId, userId) {
    let stored = null;
    try {
      stored = await this.readMemory(gameId, userId);
    } catch (error) {
      this.logger?.warn?.('piano-game.rivalry.read-failed', { gameId, userId, reason: error.message });
    }
    let memory = normalize(stored, gameId);
    if (gameId === 'chess' && Object.keys(memory.rivals).length === 0 && this.readLegacy) {
      let legacyStored = null;
      try { legacyStored = await this.readLegacy(userId); } catch (error) {
        this.logger?.warn?.('piano-game.rivalry.legacy-read-failed', { gameId, userId, reason: error.message });
      }
      const legacy = normalize(legacyStored, gameId);
      if (Object.keys(legacy.rivals).length) {
        memory = legacy;
        try { await this.writeMemory(gameId, userId, memory); } catch (error) {
          this.logger?.warn?.('piano-game.rivalry.migration-failed', { gameId, userId, reason: error.message });
        }
      }
    } else if (gameId === 'chess'
      && Object.keys(memory.rivals).length
      && (stored?.version !== VERSION || Object.entries(stored?.rivals || {}).some(([key, rival]) => migratedChessId(key, rival) !== key))) {
      try { await this.writeMemory(gameId, userId, memory); } catch (error) {
        this.logger?.warn?.('piano-game.rivalry.migration-failed', { gameId, userId, reason: error.message });
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
    const summary = summarizeGameArchive(record, gameId, this.notableFacts[gameId]);
    if (!userId || !opponentId || !summary) return false;
    const memory = await this.load(gameId, userId);
    const old = memory.rivals[opponentId] || { record: { win: 0, loss: 0, draw: 0 }, recent: [] };
    const duplicate = old.recent?.some((game) => game.gameId === summary.gameId);
    if (duplicate) return true;
    const recordTotals = { win: 0, loss: 0, draw: 0, ...old.record };
    recordTotals[summary.result] += 1;
    memory.rivals[opponentId] = {
      opponent: { id: opponentId, name: clean(record?.opponent?.name, 40) },
      record: recordTotals,
      recent: [...(old.recent || []), summary]
        .sort((a, b) => String(a?.endedAt || '').localeCompare(String(b?.endedAt || '')))
        .slice(-RECENT_LIMIT),
    };
    let saved = false;
    try {
      saved = await this.writeMemory(gameId, userId, memory);
    } catch (error) {
      this.logger?.warn?.('piano-game.rivalry.write-failed', { gameId, userId, opponentId, reason: error.message });
      return false;
    }
    this.logger?.info?.('piano-game.rivalry.recorded', { gameId, userId, opponentId, game: summary.gameId });
    return !!saved;
  }
}

export default GameRivalryMemoryService;
