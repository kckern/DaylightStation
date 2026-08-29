import path from 'node:path';
import { fileExists, loadYamlFromPath } from '#system/utils/FileIO.mjs';
export class ArchiveConfigSource {
  constructor({ configDirectory = null } = {}) { this.configDirectory = configDirectory; }
  read = () => {
    if (!this.configDirectory) return { services: {}, defaults: {} };
    const filePath = path.join(this.configDirectory, 'archive.yml');
    return fileExists(filePath) ? loadYamlFromPath(filePath) : { services: {}, defaults: {} };
  };
}
