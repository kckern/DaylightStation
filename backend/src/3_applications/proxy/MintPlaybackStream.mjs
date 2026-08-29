/** Application operation for minting a media playback URL. */
export class MintPlaybackStream {
  #gateway;

  constructor({ gateway } = {}) {
    if (!gateway || typeof gateway.mint !== 'function') {
      throw new Error('MintPlaybackStream requires gateway');
    }
    this.#gateway = gateway;
  }

  async execute(request) {
    return this.#gateway.mint(request);
  }
}

export default MintPlaybackStream;
