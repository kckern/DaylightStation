import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { assertDefinition, canonicalStringify } from '#shared/gaming/definition.mjs';

const GAME_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

export class YamlGamingDefinitionStore {
  constructor({ definitionsDir, archiveDir, builtIns = {}, builtInFiles = {}, logger = null }) {
    this.definitionsDir = definitionsDir;
    this.archiveDir = archiveDir;
    this.builtIns = builtIns;
    this.builtInFiles = builtInFiles;
    this.logger = logger;
    fs.mkdirSync(this.definitionsDir, { recursive: true });
    fs.mkdirSync(this.archiveDir, { recursive: true });
  }

  #hash(definition) {
    return crypto.createHash('sha256').update(canonicalStringify(definition)).digest('hex');
  }

  #archiveFile(hash) {
    if (!HASH_RE.test(String(hash))) return null;
    return path.join(this.archiveDir, `${hash}.yml`);
  }

  get(gameId) {
    if (!GAME_ID_RE.test(String(gameId))) return null;
    const file = path.join(this.definitionsDir, String(gameId), 'game.yml');
    let raw = null;
    let source = null;
    if (fs.existsSync(file)) {
      raw = YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
      source = file;
    } else if (this.builtIns[gameId]) {
      raw = this.builtIns[gameId];
      source = `builtin:${gameId}`;
    } else if (this.builtInFiles[gameId] && fs.existsSync(this.builtInFiles[gameId])) {
      raw = YAML.parse(fs.readFileSync(this.builtInFiles[gameId], 'utf8'), { uniqueKeys: true });
      source = this.builtInFiles[gameId];
    }
    if (!raw) return null;
    const definition = assertDefinition(raw);
    const hash = this.#hash(definition);
    return { definition, hash, source };
  }

  pin(definition) {
    const canonical = assertDefinition(definition);
    const hash = this.#hash(canonical);
    const file = this.#archiveFile(hash);
    if (!fs.existsSync(file)) fs.writeFileSync(file, YAML.stringify(canonical), { flag: 'wx' });
    return { hash, definition: canonical };
  }

  getPinned(hash) {
    const file = this.#archiveFile(hash);
    if (!file || !fs.existsSync(file)) return null;
    return assertDefinition(YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true }));
  }
}
