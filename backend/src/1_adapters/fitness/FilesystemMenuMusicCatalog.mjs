import { IMenuMusicCatalog } from '#apps/fitness/ports/IMenuMusicCatalog.mjs';
import { buildContainedPath, readDirectory } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const MENU_MUSIC_RELATIVE_ROOT = 'fitness/ux/menus';

/** Lists configured menu music while exposing only public media resource names. */
export class FilesystemMenuMusicCatalog extends IMenuMusicCatalog {
  #musicDir;
  #logger;

  constructor({ mediaDir, logger = console } = {}) {
    super();
    this.#musicDir = mediaDir && buildContainedPath(mediaDir, MENU_MUSIC_RELATIVE_ROOT);
    if (!this.#musicDir) {
      throw new InfrastructureError('FilesystemMenuMusicCatalog requires mediaDir', { code: 'MISSING_DEPENDENCY' });
    }
    this.#logger = logger;
  }

  listTracks() {
    try {
      return readDirectory(this.#musicDir)
        .filter(name => /\.(mp3|m4a|ogg|wav)$/i.test(name))
        .sort()
        .map(name => `media/${MENU_MUSIC_RELATIVE_ROOT}/${name}`);
    } catch (error) {
      this.#logger?.warn?.('fitness.menu_music.dir_unreadable', {
        musicDir: this.#musicDir,
        error: String(error?.message ?? error),
      });
      return [];
    }
  }
}
