/** Outbound catalog boundary for ArtMode preset configuration. */
export class IArtPresetCatalog {
  async load() { throw new Error('IArtPresetCatalog.load must be implemented'); }
}

export default IArtPresetCatalog;
