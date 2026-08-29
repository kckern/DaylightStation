import path from 'node:path';
import { fileExists } from '#system/utils/FileIO.mjs';

export function backendModulePaths(moduleUrl) {
  const backendRoot = path.join(path.dirname(new URL(moduleUrl).pathname), '..', '..');
  return { backendRoot, envFile: path.join(backendRoot, '..', '.env'), repoRoot: path.join(backendRoot, '..') };
}

export function resolveRuntimeDataPaths({ isDocker = fileExists('/.dockerenv'), basePath } = {}) {
  const baseDir = isDocker ? '/usr/src/app' : basePath;
  if (!baseDir) return { isDocker, baseDir: null };
  const dataDir = path.join(baseDir, 'data');
  const configDir = path.join(dataDir, 'system', 'config');
  return {
    isDocker,
    baseDir,
    dataDir,
    configDir,
    configPaths: { configDir, dataDir, source: isDocker ? 'docker' : 'env' },
    configExists: fileExists(path.join(configDir, 'system.yml')) || fileExists(path.join(configDir, 'app.yml')),
  };
}

export const runtimeLogDirectory = (mediaDir) => path.join(mediaDir, 'logs');
