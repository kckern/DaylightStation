/** Pure domain strategy for classifying media progress status. */
export class MediaProgressClassificationStrategy {
  classify(_progress, _contentMeta = {}) {
    throw new Error('MediaProgressClassificationStrategy.classify must be implemented');
  }
}

export default MediaProgressClassificationStrategy;
