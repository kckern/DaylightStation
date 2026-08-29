import { loadYaml } from '#system/utils/FileIO.mjs';
export class ContentPrefixConfigSource {
  constructor({ filePath } = {}) { this.filePath = filePath; }
  read = () => loadYaml(this.filePath) || {};
}
