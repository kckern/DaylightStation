/**
 * IAudioAssetResolver — domain interface for resolving audio specs to playable files.
 *
 * Specs can be:
 * - { type: 'file', path: '/audio/track.mp3' } — pass-through
 * - { type: 'tts', text: 'Hello', voice: 'nova' } — generate speech, return cached path
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
