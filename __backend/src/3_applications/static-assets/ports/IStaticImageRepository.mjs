export class IStaticImageRepository {
  async getImage(_kind, _id) {
    throw new Error('IStaticImageRepository.getImage must be implemented');
  }
}
