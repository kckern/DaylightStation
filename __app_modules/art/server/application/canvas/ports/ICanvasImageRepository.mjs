export class ICanvasImageRepository {
  async getImageResource(_imageId) {
    throw new Error('ICanvasImageRepository.getImageResource must be implemented');
  }
}
