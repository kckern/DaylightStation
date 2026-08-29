import path from 'node:path';
import { IContactSheetArtifacts } from '#apps/camera/ports/IContactSheetArtifacts.mjs';
import { ensureDirAsync } from '#system/utils/FileIO.mjs';
export class FilesystemContactSheetArtifacts extends IContactSheetArtifacts {
  async prepare(collection) { await ensureDirAsync(collection); }
  target(collection, name) { return { locator: path.join(collection, `${name}.jpg`), name: `${name}.jpg` }; }
}
