import path from 'node:path';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/**
 * Filesystem-backed question-bank reader. The application only consumes the
 * `getBank(id)` port; locating and decoding YAML belongs at this boundary.
 */
export function createYamlBankReader({ dataDir } = {}) {
  const resolvedDataDir = dataDir
    ?? (process.env.DAYLIGHT_BASE_PATH ? path.join(process.env.DAYLIGHT_BASE_PATH, 'data') : '/usr/src/app/data');
  const directory = path.resolve(resolvedDataDir, 'content/school/learning-catalog/question-banks');
  let cache = null;

  function loadAll() {
    if (cache) return cache;
    cache = new Map();
    for (const relative of [...listYamlFiles(directory, { recursive: true })].sort()) {
      const raw = loadYaml(path.join(directory, relative));
      if (raw && typeof raw.id === 'string' && !cache.has(raw.id)) cache.set(raw.id, raw);
    }
    return cache;
  }

  return { getBank(bankId) { return loadAll().get(bankId) ?? null; } };
}
