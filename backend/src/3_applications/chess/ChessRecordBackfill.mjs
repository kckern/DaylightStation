import {
  TOP_LEVEL, applyGameToProgress, createLadderProgress, normalizeProgress, promotionStatus,
} from '#shared/gaming/rulesets/chess/ladder.mjs';
import { chessNotableFacts } from '#shared/gaming/rulesets/chess/dialogueAdapter.mjs';
import { GameRivalryMemoryService } from '#apps/piano-games/GameRivalryMemoryService.mjs';

/**
 * Rebuild a player's derived chess state from the household archive.
 *
 * The ladder file and rivalry memory are both folds over games that were
 * played. They went wrong in the ordinary ways: rivalry memory started after
 * the first wins, ladder results were written without times, and the archive
 * itself lived in two directories. The archive is the one record that holds
 * every game, so replaying it through the live rules is the repair.
 *
 * Pure: no files. `cli/chess-backfill.cli.mjs` does the reading and writing.
 */

/** A game the ladder and rivalry memory would have seen: a named player's, played to the end. */
export function isFinishedGame(record) {
  return !!record && record.completed === true && record.ended_by === 'game_over'
    && typeof record.user_id === 'string' && record.user_id.length > 0;
}

/** The level a game was played at, or null when the record never said. */
export function recordLevel(record) {
  const raw = record?.level ?? record?.opponent?.level;
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.floor(Number(raw)));
}

const endedAt = (record) => String(record?.ended_at || record?.archived_at || record?.played_on || '');

/** Oldest first, by when each game ended. */
export function chronological(records) {
  return [...records].sort((a, b) => endedAt(a).localeCompare(endedAt(b)));
}

/**
 * Opponent ids for games archived before records carried one.
 *
 * Rivalry memory is keyed by id, and an old record has only a level and,
 * usually, a name. Where a later record from the *same player* used an id for
 * that same level and name, that id is the right one — borrowing is per
 * player, because two players' rosters are not the same roster. Otherwise it
 * is the id the live roster would build: that player's roster pack and a
 * one-based position, which applies whether or not the record carries a name.
 * A record with no opponent at all is left alone, because nothing can say who
 * it was.
 */
export function withOpponentIds(records, rosterPackFor) {
  const known = new Map();
  for (const record of records) {
    const level = recordLevel(record);
    if (record?.opponent?.id && record.opponent.name && level !== null) {
      known.set(`${record.user_id}|${level}|${record.opponent.name}`, record.opponent.id);
    }
  }
  return records.map((record) => {
    if (!record?.opponent || record.opponent.id) return record;
    const level = recordLevel(record);
    if (level === null) return record;
    const fallback = `${rosterPackFor(record.user_id)}:level-${level + 1}`;
    const id = record.opponent.name
      ? (known.get(`${record.user_id}|${level}|${record.opponent.name}`) || fallback)
      : fallback;
    return { ...record, opponent: { ...record.opponent, id } };
  });
}

/**
 * Replay finished games through the live promotion rule.
 *
 * Two floors keep a replay from taking anything away. A game played at level L
 * proves L was unlocked, because the move endpoint refuses to play above the
 * unlocked level, so the replay is raised to L before that game is applied.
 * And the stored level is never lowered, whatever the replay concludes.
 */
export function replayLadder(records, policy, storedLadder) {
  let progress = createLadderProgress();
  for (const record of chronological(records)) {
    const level = recordLevel(record);
    const floor = level === null ? progress.unlocked_through : Math.min(TOP_LEVEL, Math.max(progress.unlocked_through, level));
    // An unknown level must not read as level 0: `Number(null)` is 0, and that
    // would count a game nobody can place.
    const input = { ...record, level: level === null ? undefined : level };
    progress = applyGameToProgress({ ...progress, unlocked_through: floor }, input, policy).progress;
  }
  const stored = storedLadder ? normalizeProgress(storedLadder).unlocked_through : 0;
  return { unlocked_through: Math.max(stored, progress.unlocked_through), results: progress.results };
}

/** Rivalry memory as the live service would have built it, had it seen every game. */
export async function rebuildRivalries(records) {
  let memory = null;
  const service = new GameRivalryMemoryService({
    readMemory: async () => memory,
    writeMemory: async (_gameId, _userId, next) => { memory = structuredClone(next); return true; },
    notableFacts: { chess: chessNotableFacts },
  });
  for (const record of chronological(records)) await service.recordArchive('chess', record);
  return memory || { version: 2, rivals: {} };
}

/** Everything derived for one player, from their finished games. */
export async function planUserBackfill({ userId, records, policy, storedLadder }) {
  const finished = chronological(records.filter((record) => isFinishedGame(record) && record.user_id === userId));
  return {
    ladder: replayLadder(finished, policy, storedLadder),
    rivalries: await rebuildRivalries(finished),
  };
}

/**
 * Pair each per-player scorecard with the archived game it duplicates, so none
 * is retired unaccounted for.
 *
 * A card carrying a `game_id` matches only by that id — the archive not
 * having it means the archive never received that game, whatever its result
 * and duration happen to resemble, and that card must stay put. Scorecards
 * from before game ids carry none; those match on player, result and a
 * duration within 50ms (both writers took the duration from the same game
 * clock, and the measured drift between them is a few milliseconds), and
 * each archived game can satisfy at most one such card, so two id-less
 * scorecards never both claim the same game.
 */
export function matchScorecards(cards, archive) {
  const byId = new Map(archive.filter((record) => record?.game_id).map((record) => [record.game_id, record]));
  const consumed = new Set();
  const matched = [];
  const unmatched = [];
  for (const card of cards) {
    const record = card.record || {};
    let hit = null;
    if (record.game_id) {
      hit = byId.get(record.game_id) || null;
    } else {
      hit = archive.find((game) => !consumed.has(game) && game?.user_id === record.user_id
        && game?.result === record.result
        && Number.isFinite(Number(record.duration_ms))
        && Math.abs(Number(game?.duration_ms) - Number(record.duration_ms)) <= 50) || null;
      if (hit) consumed.add(hit);
    }
    // Each matched card carries the archive record it matched, as `archived`
    // — `withScorecardLevels` below uses that to recover a level a scorecard
    // is about to take to `_deleteme/` with it.
    if (hit) matched.push({ ...card, archived: hit });
    else unmatched.push(card);
  }
  return { matched, unmatched };
}

/**
 * Recover a level for an archive record that has none, from the scorecard
 * that duplicates it.
 *
 * A few games were archived before a record carried `level` (and, with it,
 * no `opponent` block either), so `recordLevel` returns null and a replay
 * files the game at the current level, uncounted, losing a real, already
 * counted win. The scorecard for that same game, about to be retired, is the
 * only place the level survives. Pairing reuses `matchScorecards`' own rule
 * rather than a second one, and this never rewrites anything on disk — only
 * the in-memory record used for the replay.
 */
export function withScorecardLevels(records, cards) {
  const { matched } = matchScorecards(cards, records);
  const levelByRecord = new Map();
  for (const { record: cardRecord, archived } of matched) {
    if (recordLevel(archived) !== null || levelByRecord.has(archived)) continue;
    const level = recordLevel(cardRecord);
    if (level !== null) levelByRecord.set(archived, level);
  }
  return records.map((record) => (levelByRecord.has(record) ? { ...record, level: levelByRecord.get(record) } : record));
}

/** One line's worth of a ladder file, for a before-and-after report. */
export function summarizeLadder(progress, policy) {
  if (!progress) return null;
  const normalized = normalizeProgress(progress);
  const status = promotionStatus(normalized, policy);
  return { unlocked_through: normalized.unlocked_through, wins: status.wins, needed: status.needed, results: normalized.results.length };
}

/** Each rival's lifetime record as `W-L-D`, keyed by name and id. */
export function summarizeRivalries(memory) {
  const summary = {};
  for (const [id, rival] of Object.entries(memory?.rivals || {})) {
    const record = rival?.record || {};
    summary[`${rival?.opponent?.name || 'unnamed'} (${id})`] = `${record.win || 0}-${record.loss || 0}-${record.draw || 0}`;
  }
  return summary;
}

export default {
  isFinishedGame, recordLevel, chronological, withOpponentIds, replayLadder, rebuildRivalries,
  planUserBackfill, matchScorecards, withScorecardLevels, summarizeLadder, summarizeRivalries,
};
