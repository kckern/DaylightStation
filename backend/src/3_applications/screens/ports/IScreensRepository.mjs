/**
 * Persistence port for screen configurations and their ArtMode catalogs.
 * Implementations own storage paths and serialization formats.
 */
export class IScreensRepository {
  async listScreenDocuments() {
    throw new Error('IScreensRepository.listScreenDocuments not implemented');
  }

  async findScreenById(_screenId) {
    throw new Error('IScreensRepository.findScreenById not implemented');
  }

  async getArtmodeConfig() {
    throw new Error('IScreensRepository.getArtmodeConfig not implemented');
  }

  async getArtCollections() {
    throw new Error('IScreensRepository.getArtCollections not implemented');
  }
}

export default IScreensRepository;
