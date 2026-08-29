import path from 'node:path';
import { readDirectory } from '#system/utils/FileIO.mjs';

/** Lists YAML members of a contained household-relative directory deterministically. */
export class FilesystemYamlDirectoryCatalog {
  constructor({ root }) { this.root = root; }

  list(relativePath) {
    try {
      return readDirectory(path.join(this.root, relativePath))
        .filter((filename) => /\.ya?ml$/i.test(filename))
        .sort();
    } catch {
      return [];
    }
  }
}

export default FilesystemYamlDirectoryCatalog;
