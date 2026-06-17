/**
 * @interface IVideoEncoder
 * Stitch an ordered frame sequence into a silent MP4.
 */
export class IVideoEncoder {
  /**
   * @param {{framesDir:string, pattern:string, fps:number, outputPath:string, crf?:number}} _params
   * @returns {Promise<{outputPath:string, frameCount?:number}>}
   */
  async encodeSequence(_params) {
    throw new Error('IVideoEncoder.encodeSequence must be implemented');
  }
}

export function isVideoEncoder(obj) {
  return obj && typeof obj.encodeSequence === 'function';
}
