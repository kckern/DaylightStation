/**
 * IAudioAssetResolver — application interface for resolving audio specs to
 * opaque playable resources.
 *
 * Specs can be:
 * - { type: 'file', assetId: 'music/track.mp3' }
 * - { type: 'tts', text: 'Hello', voice: 'nova' }
 *
 * Resolved assets expose `{ assetId, duration, resource }`; storage locations,
 * cache names, and cleanup remain adapter concerns.
 */
export class IAudioAssetResolver {
  async resolve(spec) {
    throw new Error('IAudioAssetResolver.resolve() must be implemented');
  }

  async resolveAll(specs) {
    return Promise.all(specs.map(s => this.resolve(s)));
  }
}

export default IAudioAssetResolver;
