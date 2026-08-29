/** Application-owned capability for retrieving image bytes. */
export class IImageDownloader {
  async download(_url) {
    throw new Error('IImageDownloader.download must be implemented');
  }
}
