import { readYamlFromPath } from '#system/utils/FileIO.mjs';

/** Reads the packaged health-coach playbook seed through the YAML I/O gateway. */
export class YamlPlaybookSeedReader {
  constructor({ filePath }) {
    if (!filePath) throw new Error('YamlPlaybookSeedReader requires filePath');
    this.filePath = filePath;
  }

  async read() {
    return readYamlFromPath(this.filePath);
  }
}

export default YamlPlaybookSeedReader;
