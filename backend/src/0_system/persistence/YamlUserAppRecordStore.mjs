import path from 'path';
import { getStats, loadYaml, saveYaml } from '../utils/FileIO.mjs';

/** Per-user YAML records; callers supply the app and filename and own all record policy. */
export class YamlUserAppRecordStore {
  #configService;
  #app;
  #filename;

  constructor({ configService, app, filename }) {
    this.#configService = configService;
    this.#app = app;
    this.#filename = filename;
  }

  // Resolve afresh for each operation; unknown users never touch storage.
  forUser(userId) {
    if (!userId || !this.#configService.getUserProfile?.(userId)) return null;
    const dir = path.join(this.#configService.getUserDir(userId), 'apps', this.#app);
    return {
      read: () => loadYaml(path.join(dir, this.#filename)),
      write: (records) => saveYaml(path.join(dir, this.#filename), records),
      mtime: () => getStats(path.join(dir, `${this.#filename}.yml`))?.mtimeMs ?? 0,
    };
  }
}
