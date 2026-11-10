import path from 'node:path';
import { deepMerge } from "#system/utils/deepMerge.mjs";
import yaml from 'js-yaml';
import { fileSignature, listSubdirectories, listYamlFiles, readTextFromPathAsync } from "#system/utils/FileIO.mjs";
import { IPianoGameRepository } from "../../application/game-platform/ports/IPianoGameRepository.mjs";

const DEFAULT_CONNECT_FOUR_CONFIG = Object.freeze({
  input_mode: 'notes',
  addressing: { vocabulary: 'staff', shuffle: 'never' },
  column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  default_level: 1,
});
/** Checkers and chess share file/rank instrument axes. */
const DEFAULT_CHECKERS_CONFIG = Object.freeze({
  addressing: { vocabulary: 'staff', shuffle: 'never' },
  file_notes: [60, 62, 64, 65, 67, 69, 71, 72],
  rank_notes: [47, 48, 50, 52, 53, 55, 57, 59],
  default_level: 1,
});

/**
 * Where a game's finished record can live. Per-user files under
 * `users/{id}/apps/{game}/games/`, and the household archive under
 * `household/gaming/log/{dir}/{YYYY-MM-DD}/`. Chess writes only the archive
 * now; `pianochess` is the archive's name before the chess move.
 */
const ARCHIVE_DIRS = Object.freeze({
  chess: ['gaming/log/chess', 'gaming/log/pianochess'],
  checkers: ['gaming/log/checkers'],
  'connect-four': ['gaming/log/connect-four'],
});
const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;

function msOf(value) {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The few fields a finished-game reader needs. Kept instead of the record so
 * the parse cache does not hold every move of ~2000 games in memory.
 */
function summarizeGame(gameId, record, fallbackUser) {
  if (!record || typeof record !== 'object') return null;
  const rawLevel = record.opponent?.level ?? record.level;
  const level = Number.isFinite(Number(rawLevel)) && rawLevel !== null && rawLevel !== '' ? Number(rawLevel) : null;
  return {
    gameId,
    userId: record.user_id ?? fallbackUser ?? null,
    result: record.result ?? null,
    completed: record.completed === true,
    endedBy: record.ended_by ?? null,
    level,
    atMs: msOf(record.ended_at) ?? msOf(record.created_at) ?? msOf(record.archived_at),
    playedOn: DAY_DIR.test(record.played_on || '') ? record.played_on : null,
  };
}

function stamp(record, field) {
  return { ...record, [field]: new Date().toISOString() };
}

export class DataServicePianoGameRepository extends IPianoGameRepository {
  // file -> { signature, summary }. Game files are written once, so after the
  // first full read a listing costs one stat per file.
  #summaries = new Map();

  constructor({ dataService, configService }) {
    super();
    this.dataService = dataService;
    this.configService = configService;
  }

  /**
   * The three layers, deep-merged: house defaults, then the household's YAML,
   * then this player's own overrides.
   *
   * DEEP, not shallow. A spread merge replaces a nested block wholesale, so a
   * player who overrode one addressing dimension —
   *   addressing: { x: { tier: 4 } }
   * — silently discarded the household's `vocabulary`, `clefs`, `shuffle` and
   * the other axis, and got defaults for all of them. Every dimension has to be
   * independently overridable at every layer or the layering is decorative.
   * See __docs/reference/piano/grid-addressing.md.
   */
  async readConfig(gameId, userId) {
    const household = this.configService.getHouseholdAppConfig(null, gameId) || {};
    const user = userId ? (this.dataService.user.read(`apps/${gameId}/config`, userId) || {}) : {};
    const defaults = gameId === 'connect-four' ? DEFAULT_CONNECT_FOUR_CONFIG
      : gameId === 'checkers' ? DEFAULT_CHECKERS_CONFIG : {};
    return deepMerge(deepMerge(defaults, household), user);
  }

  /**
   * A patch, deep-merged onto what this player already had — so writing one
   * dimension of a nested block leaves its siblings alone. A spread here made
   * `updateConfig({ addressing: { shuffle: 'each_game' } })` erase the player's
   * vocabulary and tiers.
   */
  writeConfig(gameId, userId, config) {
    const path = `apps/${gameId}/config`;
    const current = this.dataService.user.read(path, userId) || {};
    return this.dataService.user.write(path, deepMerge(current, config), userId);
  }

  readProgress(gameId, userId) {
    const stored = this.dataService.user.read(`apps/${gameId}/ladder`, userId);
    if (!stored) return null;
    if (gameId === 'chess' && Array.isArray(stored.results)) {
      const nativeLevel = Math.max(0, Number(stored.unlocked_through) || 0);
      return {
        // OpponentLadder presents positions one-based; Chess mechanics and its
        // durable ladder remain zero-based.
        unlockedThrough: nativeLevel + 1,
        series: stored.results
          .filter((entry) => Number(entry?.level) === nativeLevel)
          .slice(-7)
          .map((entry) => ({ result: entry.result, counted: entry.counted !== false })),
      };
    }
    return {
      unlockedThrough: stored.unlocked_through ?? stored.unlockedThrough,
      // Legacy ladders stored bare result strings. Normalize lazily so old
      // progress remains readable by the richer counted-series aggregate.
      series: Array.isArray(stored.series) ? stored.series.map((entry) => (
        typeof entry === 'string' ? { result: entry, counted: true } : entry
      )) : [],
    };
  }

  writeProgress(gameId, userId, progress) {
    if (gameId === 'chess') {
      const level = Math.max(0, Number(progress.unlockedThrough || 1) - 1);
      return this.dataService.user.write(`apps/${gameId}/ladder`, {
        unlocked_through: level,
        results: (progress.series || []).map((entry) => ({
          level, result: entry.result, counted: entry.counted !== false, at: null,
        })),
      }, userId);
    }
    return this.dataService.user.write(`apps/${gameId}/ladder`, {
      unlocked_through: progress.unlockedThrough,
      series: progress.series,
    }, userId);
  }

  saveRecord(gameId, userId, record) {
    return this.dataService.user.write(
      `apps/${gameId}/games/${Date.now()}.yml`, stamp({ ...record, user_id: userId }, 'created_at'), userId,
    );
  }

  saveArchive(gameId, userSegment, record) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(record.played_on || '')
      ? record.played_on : new Date().toISOString().slice(0, 10);
    return this.dataService.household.write(
      `gaming/log/${gameId}/${day}/${userSegment}-${Date.now()}.yml`, stamp(record, 'archived_at'),
    );
  }

  // Async on purpose: a cold read is ~2000 files with full move lists (about
  // 2s of parsing). Awaiting each read hands the event loop back between
  // files instead of holding it for the whole sweep.
  async #summaryOf(gameId, file, fallbackUser) {
    const signature = fileSignature(file);
    const cached = this.#summaries.get(file);
    if (signature && cached?.signature === signature) return cached.summary;
    let summary = null;
    try {
      summary = summarizeGame(gameId, yaml.load(await readTextFromPathAsync(file)), fallbackUser);
    } catch {
      summary = null; // a torn or hand-mangled file is not a game
    }
    if (signature) this.#summaries.set(file, { signature, summary });
    return summary;
  }

  /**
   * Every game these players have on file — per-user records plus the
   * household archive — as `{gameId, userId, result, completed, endedBy,
   * level, atMs, playedOn}`. The same game can appear twice (per-user file and
   * archive); a caller that asks "first time" does not care, one that counts
   * games must. `level` is the opponent level as the game stores it (chess
   * zero-based, the others one-based).
   */
  async listGameSummaries(gameId, userIds = []) {
    const wanted = new Set(userIds.map(String));
    const out = [];
    for (const userId of wanted) {
      const dir = this.dataService.user.resolveDir(`apps/${gameId}/games`, userId);
      for (const name of listYamlFiles(dir, { stripExtension: false })) {
        const summary = await this.#summaryOf(gameId, path.join(dir, name), userId);
        if (summary) out.push({ ...summary, userId: summary.userId ?? userId });
      }
    }
    for (const archive of ARCHIVE_DIRS[gameId] || []) {
      let root;
      try { root = this.dataService.household.resolveDir(archive); } catch { continue; }
      for (const day of listSubdirectories(root).filter((d) => DAY_DIR.test(d))) {
        const dir = path.join(root, day);
        for (const name of listYamlFiles(dir, { stripExtension: false })) {
          const summary = await this.#summaryOf(gameId, path.join(dir, name), null);
          if (summary && wanted.has(String(summary.userId))) out.push({ ...summary, playedOn: summary.playedOn ?? day });
        }
      }
    }
    return out;
  }

  readRivalry(gameId, userId) {
    return this.dataService.user.read(`apps/${gameId}/rivalries`, userId);
  }

  writeRivalry(gameId, userId, memory) {
    return this.dataService.user.write(`apps/${gameId}/rivalries`, memory, userId);
  }

  readLegacyChessRivalry(userId) {
    return this.dataService.user.read('apps/chess/rivalry', userId)
      || this.dataService.user.read('apps/chess/rivalries', userId);
  }
}

export default DataServicePianoGameRepository;
