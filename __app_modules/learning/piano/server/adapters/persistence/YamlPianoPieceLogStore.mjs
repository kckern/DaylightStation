import path from 'node:path';
import YAML from 'yaml';
import { fileExists, readTextFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export const PIECE_LOG_SCHEMA = 'piano.piece-log/v1';

/**
 * The dated whole-piece certification log: `users/{id}/apps/piano/piece-log.yml`.
 *
 *   schema: piano.piece-log/v1
 *   entries:
 *     - { at: ISO, scoreId: 'files:…', level: silver|gold, passages: 12, fingerprint: '…' }
 *
 * Append-only by contract. Passage certification is derived on every read and
 * carries no "the whole piece was finished on" date, so this file is the only
 * record of WHEN a piece first became all Silver or all Gold.
 * See __docs/reference/piano/sheet-music-player.md (Piece log).
 */
export class YamlPianoPieceLogStore {
  constructor({ usersDir }) {
    if (!usersDir) throw new Error('YamlPianoPieceLogStore requires usersDir');
    this.usersDir = usersDir;
  }

  #file(userId) {
    if (!ID.test(String(userId))) throw new Error('Invalid piano profile');
    return path.join(this.usersDir, String(userId), 'apps', 'piano', 'piece-log.yml');
  }

  /** Every entry, oldest first. Throws when the file exists and cannot be read. */
  list(userId) {
    const file = this.#file(userId);
    if (!fileExists(file)) return [];
    const stored = YAML.parse(readTextFromPath(file), { uniqueKeys: true });
    return Array.isArray(stored?.entries) ? stored.entries : [];
  }

  append(userId, entry) {
    saveYamlToPathAtomic(this.#file(userId), { schema: PIECE_LOG_SCHEMA, entries: [...this.list(userId), entry] }, { durable: true });
    return true;
  }
}

export default YamlPianoPieceLogStore;
