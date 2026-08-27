/** Compact, factual cross-game memory for one player and one chess character. */

const VERSION = 1;
const RECENT_GAMES = 7;

function text(value, max = 96) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null;
}

export function rivalryKey(opponent) {
  const level = Number(opponent?.level);
  const name = text(opponent?.name, 40)?.toLowerCase();
  return Number.isInteger(level) && level >= 0 && name ? `level-${level}:${name}` : null;
}

function outcome(result) {
  return result === 'win' || result === 'loss' || result === 'draw' ? result : 'draw';
}

function kindFor(move) {
  if (String(move?.san || '').includes('#')) return 'checkmate';
  if (String(move?.san || '').includes('=')) return 'promotion';
  if (String(move?.san || '').includes('+')) return 'check';
  if (move?.captured || String(move?.san || '').includes('x')) return 'capture';
  return null;
}

function moveFact(move) {
  if (!move?.san) return null;
  return { ply: Number(move.ply) || null, san: text(move.san, 16), color: move.color === 'b' ? 'b' : 'w', kind: kindFor(move) };
}

export function summarizeArchive(record) {
  const key = rivalryKey(record?.opponent);
  if (!key || !record?.completed || !record?.game_id) return null;
  const moves = (Array.isArray(record.moves) ? record.moves : []).filter((move) => !move?.undone && move?.san);
  const finalMove = moveFact(moves.at(-1));
  const highlights = [];
  if (finalMove) highlights.push(finalMove);
  for (const wanted of ['promotion', 'check', 'capture']) {
    const match = [...moves].reverse().find((move) => kindFor(move) === wanted && Number(move.ply) !== finalMove?.ply);
    const fact = moveFact(match);
    if (fact && highlights.length < 3) highlights.push(fact);
  }
  return {
    gameId: text(record.game_id, 128),
    endedAt: text(record.ended_at, 40),
    result: outcome(record.result),
    outcome: text(record.outcome, 32),
    moves: Number(record.move_count) || moves.length,
    finalMove,
    highlights,
    finalLine: text(record.commentary?.final_line, 96),
  };
}

function normalize(memory) {
  return memory && memory.version === VERSION && memory.rivals && typeof memory.rivals === 'object'
    ? memory : { version: VERSION, rivals: {} };
}

function recordFor(rival, opponent, summary) {
  const games = Array.isArray(rival?.games) ? rival.games.filter((game) => game?.gameId !== summary.gameId) : [];
  games.push(summary);
  games.sort((a, b) => String(a.endedAt || '').localeCompare(String(b.endedAt || '')) || String(a.gameId).localeCompare(String(b.gameId)));
  return {
    opponent: { level: Number(opponent.level), name: text(opponent.name, 40) },
    games,
  };
}

function totals(games) {
  return games.reduce((all, game) => ({ ...all, [outcome(game.result)]: all[outcome(game.result)] + 1 }), { win: 0, loss: 0, draw: 0 });
}

export function createChessRivalryMemoryService({ readMemory, writeMemory, logger = null }) {
  return {
    async recall(userId, opponent) {
      const key = userId ? rivalryKey(opponent) : null;
      if (!key) return null;
      try {
        const rival = normalize(await readMemory(userId)).rivals[key];
        const games = Array.isArray(rival?.games) ? rival.games : [];
        if (!games.length) return null;
        return { games: games.length, record: totals(games), recent: games.slice(-RECENT_GAMES) };
      } catch (error) {
        logger?.warn?.('chess.rivalry.read-failed', { userId, key, reason: error.message });
        return null;
      }
    },

    async recordArchive(record) {
      const summary = summarizeArchive(record);
      const userId = record?.user_id;
      const key = userId ? rivalryKey(record?.opponent) : null;
      if (!summary || !userId || !key) return false;
      try {
        const memory = normalize(await readMemory(userId));
        memory.rivals[key] = recordFor(memory.rivals[key], record.opponent, summary);
        const saved = await writeMemory(userId, memory);
        if (saved) logger?.info?.('chess.rivalry.recorded', { userId, key, gameId: summary.gameId, games: memory.rivals[key].games.length });
        return !!saved;
      } catch (error) {
        logger?.warn?.('chess.rivalry.write-failed', { userId, key, reason: error.message });
        return false;
      }
    },
  };
}

export default { createChessRivalryMemoryService, rivalryKey, summarizeArchive };
