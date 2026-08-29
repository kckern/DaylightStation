import path from 'node:path';
import yaml from 'js-yaml';
import { readDirectory, readTextFromPath } from '#system/utils/FileIO.mjs';
import { IEmulatorConfigRepository } from '#apps/emulator/ports/IEmulatorConfigRepository.mjs';

function readOptionalYaml(filePath) {
  let source;
  try {
    source = readTextFromPath(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return yaml.load(source) ?? null;
  } catch {
    return null;
  }
}

/** Filesystem adapter for emulator manifests and shell configuration. */
export class FilesystemEmulatorConfigRepository extends IEmulatorConfigRepository {
  #emulationDir;

  constructor({ emulationDir } = {}) {
    super();
    if (!emulationDir) throw new Error('FilesystemEmulatorConfigRepository requires emulationDir');
    this.#emulationDir = emulationDir;
  }

  readManifests() {
    let entries;
    try {
      entries = readDirectory(this.#emulationDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }

    const manifests = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const systemDir = path.join(this.#emulationDir, entry.name);
      let files;
      try {
        files = readDirectory(systemDir);
      } catch {
        continue;
      }
      const yamlFiles = files
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort();
      if (yamlFiles.length === 0) continue;
      let manifest;
      try {
        manifest = readOptionalYaml(path.join(systemDir, yamlFiles[0]));
      } catch {
        continue;
      }
      if (!manifest) continue;
      manifests.push({ system: manifest.system || entry.name, manifest });
    }
    return manifests;
  }

  readInputConfig() { return readOptionalYaml(path.join(this.#emulationDir, 'input.yml')); }
  readConsolesConfig() { return readOptionalYaml(path.join(this.#emulationDir, 'consoles.yml')); }
  readSettingsConfig() { return readOptionalYaml(path.join(this.#emulationDir, 'settings.yml')); }
}

export default FilesystemEmulatorConfigRepository;
