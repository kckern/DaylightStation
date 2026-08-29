import { IArtPresetCatalog } from '#apps/content/ports/IArtPresetCatalog.mjs';
import { loadArtCollections, loadArtmodeConfig } from './artmodeConfig.mjs';

/** Filesystem-backed ArtMode catalogs with their concrete household layout contained here. */
export class FilesystemArtPresetCatalog extends IArtPresetCatalog {
  constructor({ householdDir, logger = console }) {
    super();
    if (!householdDir) throw new Error('FilesystemArtPresetCatalog requires householdDir');
    this.householdDir = householdDir;
    this.logger = logger;
  }

  async load() {
    const [{ presets, defaults, frames }, collections] = await Promise.all([
      loadArtmodeConfig(this.householdDir, this.logger),
      loadArtCollections(this.householdDir, this.logger),
    ]);
    return { presets, defaults, frames, collections };
  }
}

export default FilesystemArtPresetCatalog;
