/** Gateway for minting a playback URL from a configured media source. */
export class IPlaybackStreamGateway {
  async mint(_request) { throw new Error('IPlaybackStreamGateway.mint not implemented'); }
}

export default IPlaybackStreamGateway;
