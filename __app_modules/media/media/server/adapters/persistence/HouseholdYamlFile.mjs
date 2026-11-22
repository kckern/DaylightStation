import { readYamlFromPath, resolveYamlPathStrict, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** Read strictly; only an absent .yml and .yaml pair returns `found: false`. */
export function readHouseholdYamlFile(basePath) {
  const file = resolveYamlPathStrict(basePath);
  return file ? { found: true, file, value: readYamlFromPath(file) } : { found: false, file: null, value: null };
}

/** Atomically write to the existing extension, or create a mode-safe .yml file. */
export function writeHouseholdYamlFile(basePath, value) {
  const file = resolveYamlPathStrict(basePath) || `${basePath}.yml`;
  saveYamlToPathAtomic(file, value, { preserveMode: true });
  return file;
}
