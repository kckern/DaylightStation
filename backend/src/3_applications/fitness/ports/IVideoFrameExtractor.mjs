/**
 * @interface IVideoFrameExtractor
 * Extract a single still frame from a source video at a given offset.
 */
export class IVideoFrameExtractor {
  /**
   * @param {{source:string, offsetMs:number}} _params
   * @returns {Promise<Buffer>} JPEG buffer
   */
  async extractFrame(_params) {
    throw new Error('IVideoFrameExtractor.extractFrame must be implemented');
  }
}

export function isVideoFrameExtractor(obj) {
  return obj && typeof obj.extractFrame === 'function';
}
