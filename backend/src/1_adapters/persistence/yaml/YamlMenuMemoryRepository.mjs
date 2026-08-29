import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';

/** Persistence adapter for the household media-menu memory document. */
export class YamlMenuMemoryRepository {
  constructor({ filePath } = {}) {
    if (!filePath) throw new Error('YamlMenuMemoryRepository requires filePath');
    this.filePath = filePath;
  }

  load = () => loadYaml(this.filePath);
  save = (value) => saveYaml(this.filePath, value);
}
