import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

// Missing is a legitimate first run; unreadable or malformed is not an empty
// collection. Keep the in-memory DataService seam for isolated adapters.
export function readHealthYaml(dataService, relativePath, userId) {
  if (!dataService.user.resolvePath) return dataService.user.read(relativePath, userId);
  try { return readYamlFromPath(dataService.user.resolvePath(relativePath, userId)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function writeHealthYaml(dataService, relativePath, userId, value, code = 'HEALTH_WRITE_FAILED') {
  try {
    if (dataService.user.resolvePath) {
      saveYamlToPathAtomic(dataService.user.resolvePath(relativePath, userId), value, { durable: true });
    } else if (dataService.user.write(relativePath, value, userId) === false) {
      throw new Error('Write refused');
    }
  } catch (cause) {
    throw Object.assign(new Error(`Could not save ${relativePath} for ${userId}. Please retry.`, { cause }), { code });
  }
}
