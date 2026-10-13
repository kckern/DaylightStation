/**
 * Persistence port for screen configurations.
 * Implementations own storage paths and serialization formats.
 */
export class IScreensRepository {
  async listScreenDocuments() {
    throw new Error('IScreensRepository.listScreenDocuments not implemented');
  }

  async findScreenById(_screenId) {
    throw new Error('IScreensRepository.findScreenById not implemented');
  }


}

export default IScreensRepository;
