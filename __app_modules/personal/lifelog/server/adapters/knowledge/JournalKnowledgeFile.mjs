import path from 'node:path';
import yaml from 'js-yaml';
import * as FileIO from '#system/utils/FileIO.mjs';
import { assertUsername } from './knowledgeFiles.mjs';
/** Strict owner source. Unavailable bytes must never masquerade as deleted evidence. */
export class JournalKnowledgeFile {
  #directory;
  #io;
  constructor({
    userDirForUser,
    io = FileIO
  }) {
    this.#directory = userDirForUser;
    this.#io = io;
  }
  async read(username) {
    assertUsername(username);
    let bytes;
    try {
      bytes = this.#io.readTextFromPath(path.join(this.#directory(username), 'lifelog', 'journalist', 'messages.yml'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const journal = yaml.load(bytes, {
      schema: yaml.JSON_SCHEMA
    });
    if (!journal || !Array.isArray(journal.messages)) throw new Error('Journal source unavailable');
    return journal;
  }
}
