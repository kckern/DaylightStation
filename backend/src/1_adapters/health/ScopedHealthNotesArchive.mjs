import path from 'node:path';
import { IHealthNotesArchive } from '#apps/health/ports/IHealthNotesArchive.mjs';
import { readTextFromPathAsync } from '#system/utils/FileIO.mjs';

export class ScopedHealthNotesArchive extends IHealthNotesArchive {
  #dataRoot; #scopeFactory; #scope;
  constructor({ dataRoot, archiveScopeFactory = null, archiveScope = null }) {
    super(); this.#dataRoot = dataRoot; this.#scopeFactory = archiveScopeFactory; this.#scope = archiveScope;
  }
  async read(userId, relativeName) {
    const locator = path.join(this.#dataRoot, 'users', userId, 'lifelog/archives', relativeName);
    const scope = this.#scopeFactory?.forUser ? await this.#scopeFactory.forUser(userId) : this.#scope;
    if (!scope?.assertReadable) throw new Error('read_notes_file: archiveScope dependency missing');
    scope.assertReadable(locator, userId);
    return readTextFromPathAsync(locator);
  }
}
