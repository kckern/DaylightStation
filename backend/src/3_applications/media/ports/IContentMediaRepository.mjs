/**
 * Application-owned port for resolving authored content media.
 *
 * Each lookup returns a result object whose `resource`, when present, is
 * opaque: `{ size, mimeType, open(options) }`.
 */
export class IContentMediaRepository {
  async findSingalong(_collection, _id) {
    throw new Error('IContentMediaRepository.findSingalong not implemented');
  }

  async findReadalong(_collection, _itemPath) {
    throw new Error('IContentMediaRepository.findReadalong not implemented');
  }

  async findAmbient(_id) {
    throw new Error('IContentMediaRepository.findAmbient not implemented');
  }
}

export function isContentMediaRepository(candidate) {
  return candidate
    && typeof candidate.findSingalong === 'function'
    && typeof candidate.findReadalong === 'function'
    && typeof candidate.findAmbient === 'function';
}

export default IContentMediaRepository;
