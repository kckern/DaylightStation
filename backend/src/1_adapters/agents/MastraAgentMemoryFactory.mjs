import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { dirname } from 'node:path';
import { ensureDir } from '#system/utils/FileIO.mjs';

/** Build the vendor memory runtime; all SDK and SQLite addressing stays adapter-side. */
export function buildMastraMemory({ dbPath, lastMessages = 20, workingMemory = null } = {}) {
  if (!dbPath || typeof dbPath !== 'string') {
    throw new Error('buildMastraMemory: dbPath required (file path or ":memory:")');
  }
  if (dbPath !== ':memory:') {
    const resolvedPath = dbPath.startsWith('file:') ? dbPath.slice(5) : dbPath;
    try { ensureDir(dirname(resolvedPath)); } catch { /* connection reports an unusable location */ }
  }
  const url = dbPath === ':memory:' ? ':memory:' : (dbPath.startsWith('file:') ? dbPath : `file:${dbPath}`);
  const storage = new LibSQLStore({ id: 'daylight-agent-memory', url });
  const options = { lastMessages };
  if (workingMemory) options.workingMemory = workingMemory;
  return new Memory({ storage, options });
}

/** Adapter-side construction of the Mastra memory runtime. */
export class MastraAgentMemoryFactory {
  createMemory(options) {
    const { dataPath, dbPath: explicitDbPath, ...memoryOptions } = options ?? {};
    const dbPath = explicitDbPath
      ?? (dataPath === ':memory:' ? ':memory:' : `${dataPath}/agents/memory.db`);
    return buildMastraMemory({ dbPath, ...memoryOptions });
  }
}

export default MastraAgentMemoryFactory;
