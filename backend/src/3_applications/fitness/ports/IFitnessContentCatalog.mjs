/**
 * Fitness-facing content capability.
 *
 * Implementations own provider identifiers, hierarchy fields, collection
 * paths, and watch-state namespaces.  Application services consume only the
 * semantic aliases documented by these methods.
 */
export class IFitnessContentCatalog {
  canonicalize(_contentId) { throw new Error('IFitnessContentCatalog.canonicalize not implemented'); }
  async resolvePlayables(_contentId) { throw new Error('IFitnessContentCatalog.resolvePlayables not implemented'); }
  async enrichWatchState(_items, _contentRef) { throw new Error('IFitnessContentCatalog.enrichWatchState not implemented'); }
  async getContainerInfo(_contentId) { throw new Error('IFitnessContentCatalog.getContainerInfo not implemented'); }
  async getItem(_contentId) { throw new Error('IFitnessContentCatalog.getItem not implemented'); }
  async listConfiguredShows() { throw new Error('IFitnessContentCatalog.listConfiguredShows not implemented'); }
  async collectionShowIds(_collectionId) { throw new Error('IFitnessContentCatalog.collectionShowIds not implemented'); }
  async describeItem(_contentId) { throw new Error('IFitnessContentCatalog.describeItem not implemented'); }
  async enrichConfiguredPlaylists(_config) { throw new Error('IFitnessContentCatalog.enrichConfiguredPlaylists not implemented'); }
  async getGovernedItems(_labels, _options) { throw new Error('IFitnessContentCatalog.getGovernedItems not implemented'); }
}

export default IFitnessContentCatalog;
