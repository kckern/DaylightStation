import { getFileStats, readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Resolve an existing household YAML file, preserving FileIO's .yml-first rule. */
export function resolveHouseholdYamlFile(basePath) {
  for (const extension of ['.yml', '.yaml']) {
    const file = `${basePath}${extension}`;
    try { getFileStats(file); return file; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

/** Read strictly; only an absent .yml and .yaml pair returns `found: false`. */
export function readHouseholdYamlFile(basePath) {
  const file = resolveHouseholdYamlFile(basePath);
  return file ? { found: true, file, value: readYamlFromPath(file) } : { found: false, file: null, value: null };
}

/** Atomically write to the existing extension, or create a mode-safe .yml file. */
export function writeHouseholdYamlFile(basePath, value) {
  const file = resolveHouseholdYamlFile(basePath) || `${basePath}.yml`;
  saveYamlToPathAtomic(file, value, { preserveMode: true });
  return file;
}
