/**
 * Application-owned persistence contract for the Admin Art library.
 *
 * All methods exchange structured records. Filesystem paths and serialized
 * YAML remain private to the implementing adapter.
 */
export class IArtAdminRepository {
  async listWorks(_query = {}) {
    throw new Error('IArtAdminRepository.listWorks must be implemented');
  }

  async loadCollections() {
    throw new Error('IArtAdminRepository.loadCollections must be implemented');
  }

  async patchWorkMetadata(_command) {
    throw new Error('IArtAdminRepository.patchWorkMetadata must be implemented');
  }
}

export default IArtAdminRepository;
