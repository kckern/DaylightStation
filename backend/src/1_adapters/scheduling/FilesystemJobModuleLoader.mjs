import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Resolves and loads legacy scheduler modules relative to their configured root. */
export class FilesystemJobModuleLoader {
  constructor({ moduleBasePath = null } = {}) { this.moduleBasePath = moduleBasePath; }

  resolve(moduleRef) {
    if (!this.moduleBasePath) return moduleRef;
    return pathToFileURL(path.resolve(this.moduleBasePath, moduleRef)).href;
  }

  load(moduleRef) { return import(this.resolve(moduleRef)); }
}

export default FilesystemJobModuleLoader;
