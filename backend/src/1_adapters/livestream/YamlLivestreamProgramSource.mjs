import path from 'node:path';
import { loadYamlFromPath } from '#system/utils/FileIO.mjs';
export class YamlLivestreamProgramSource {
  constructor({ directory } = {}) { this.directory = directory; }
  load = (programPath) => loadYamlFromPath(path.join(this.directory, programPath));
}
