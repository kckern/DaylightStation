import path from 'node:path';
import YAML from 'yaml';
import { ensureDir, fileExists, readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';
import { CharadesClueHistory } from '#apps/gaming/ports/CharadesClueHistory.mjs';

const DEFINITION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)
    || typeof entry.key !== 'string' || !entry.key.trim()
    || typeof entry.clue_id !== 'string' || !entry.clue_id.trim()) {
    throw new Error('invalid charades clue history entry');
  }
  return structuredClone(entry);
}

function validateDocument(value) {
  if (!value || value.version !== 1 || !value.definitions
    || typeof value.definitions !== 'object' || Array.isArray(value.definitions)) {
    throw new Error('invalid charades clue history');
  }
  const definitions = {};
  for (const [definitionId, entries] of Object.entries(value.definitions)) {
    if (!DEFINITION_ID.test(definitionId) || !Array.isArray(entries)) throw new Error('invalid charades clue history');
    definitions[definitionId] = entries.map(validateEntry);
  }
  return { version: 1, definitions };
}

export class YamlCharadesClueHistory extends CharadesClueHistory {
  constructor({ file }) {
    super();
    if (!file) throw new Error('charades clue history file is required');
    this.file = file;
    ensureDir(path.dirname(file));
  }

  #read() {
    if (!fileExists(this.file)) return { version: 1, definitions: {} };
    try { return validateDocument(YAML.parse(readTextFromPath(this.file), { uniqueKeys: true })); }
    catch (error) {
      if (error.message.startsWith('invalid charades clue history')) throw error;
      throw new Error(`invalid charades clue history: ${error.message}`);
    }
  }

  #write(document) {
    const value = validateDocument(document);
    writeFileAtomic(this.file, YAML.stringify(value));
    return value;
  }

  async list(definitionId) {
    if (!DEFINITION_ID.test(String(definitionId))) throw new Error('invalid charades definition id');
    return structuredClone(this.#read().definitions[definitionId] || []);
  }

  async append(definitionId, entry) {
    if (!DEFINITION_ID.test(String(definitionId))) throw new Error('invalid charades definition id');
    const document = this.#read();
    const entries = structuredClone(document.definitions[definitionId] || []);
    const value = validateEntry(entry);
    const existing = entries.find(candidate => candidate.key === value.key);
    if (existing) return existing;
    entries.push(value);
    document.definitions[definitionId] = entries;
    this.#write(document);
    return structuredClone(value);
  }

  async replace(definitionId, entries) {
    if (!DEFINITION_ID.test(String(definitionId))) throw new Error('invalid charades definition id');
    if (!Array.isArray(entries)) throw new Error('invalid charades clue history entries');
    const document = this.#read();
    document.definitions[definitionId] = entries.map(validateEntry);
    this.#write(document);
    return this.list(definitionId);
  }
}
