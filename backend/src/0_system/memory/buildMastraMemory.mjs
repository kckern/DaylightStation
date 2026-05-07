// backend/src/0_system/memory/buildMastraMemory.mjs

import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Build a Mastra Memory instance with LibSQL storage.
 *
 * @param {object} config
 * @param {string} config.dbPath              path to SQLite file, or ':memory:' for in-memory (tests)
 * @param {number} [config.lastMessages=20]   number of recent messages to include in context window
 * @param {object} [config.workingMemory]     WorkingMemory config (e.g. { type: 'text-stream', ... })
 * @returns {Memory}
 */
export function buildMastraMemory({ dbPath, lastMessages = 20, workingMemory = null } = {}) {
  if (!dbPath || typeof dbPath !== 'string') {
    throw new Error('buildMastraMemory: dbPath required (file path or ":memory:")');
  }

  // Ensure parent directory exists for file-backed stores
  if (dbPath !== ':memory:') {
    const resolvedPath = dbPath.startsWith('file:') ? dbPath.slice(5) : dbPath;
    try {
      mkdirSync(dirname(resolvedPath), { recursive: true });
    } catch {
      // ignore — directory may already exist or be read-only (will fail later on open)
    }
  }

  const url = dbPath === ':memory:' ? ':memory:' : (dbPath.startsWith('file:') ? dbPath : `file:${dbPath}`);
  const storage = new LibSQLStore({ id: 'daylight-agent-memory', url });

  const options = { lastMessages };
  if (workingMemory) options.workingMemory = workingMemory;

  return new Memory({ storage, options });
}

export default buildMastraMemory;
